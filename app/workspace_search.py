"""Bounded discovery of saved public records; never refresh a data provider."""

import re
import sqlite3
import time

from flask import Blueprint, current_app, jsonify, request, url_for
from werkzeug.exceptions import HTTPException

from app import global_reference, market_data, public_library
from app.extensions import limiter
from scripts.market_data_catalog import CATALOG
from scripts.public_data_policy import public_sql
from scripts.public_data_store import SOURCES, read_connection

bp = Blueprint('workspace_search', __name__)
PER_KIND = 8
MARKET_ROWS = 300  # The standalone cache permits at most 100 stocks and 200 FX.
REFERENCE_CHECKS = 40
SERIES_ID = re.compile(r'(worldbank|faostat|sec)_[a-f0-9]{32}')
REFERENCE_ID = re.compile(r'[a-z][a-z0-9_]{1,100}')


@bp.after_request
def _no_query_cache(response):
    response.headers['Cache-Control'] = 'private, no-store'
    return response


def _text(value, limit=300):
    return value[:limit] if isinstance(value, str) else ''


def _tokens(value):
    return re.findall(r'[^\W_]+', value.casefold(), re.UNICODE)


def _matches(tokens, *fields):
    words = ' '.join(_tokens(' '.join(_text(field) for field in fields)))
    compact = words.replace(' ', '')
    return all(token in words or token in compact for token in tokens)


def _bounded_connection(conn):
    started = time.monotonic()
    conn.execute('PRAGMA busy_timeout=250')
    conn.set_progress_handler(lambda: time.monotonic() - started > 1, 1000)


def _market_results(tokens, unavailable):
    # This check precedes even resolving the configured cache path.
    if current_app.config.get('MARKET_DATA_ENABLED') is not True:
        return []
    conn = None
    try:
        conn = read_connection(market_data.database_path())
        if conn is None:
            return []
        _bounded_connection(conn)
        # Names and quote orientation come from the reviewed catalog. Only
        # saved instrument IDs are read: no histories, private quota tables or
        # provider calls are needed to discover an instrument.
        rows = conn.execute('SELECT id FROM instruments ORDER BY id LIMIT ?',
                            (MARKET_ROWS + 1,)).fetchall()
        if len(rows) > MARKET_ROWS:
            unavailable.extend(('stock', 'fx'))
            return []
        groups = {'stock': [], 'fx': []}
        for row in rows:
            item = CATALOG.get(row['id'])
            if item is None or item.kind not in groups or len(groups[item.kind]) >= PER_KIND:
                continue
            if not _matches(tokens, item.id, item.name, item.symbol, item.currency,
                            item.base_currency, item.quote_currency, item.exchange):
                continue
            endpoint = 'market_data.stock_detail' if item.kind == 'stock' else 'market_data.exchange_rate_detail'
            description = (item.quote_currency + ' per 1 ' + item.base_currency
                           if item.kind == 'fx' else item.symbol + ' · ' + item.currency + ' per share')
            groups[item.kind].append(dict(id=item.id, kind=item.kind,
                name=item.symbol if item.kind == 'fx' else item.name,
                description=description, href=url_for(endpoint, instrument_id=item.id)))
        return groups['stock'] + groups['fx']
    except (sqlite3.Error, OSError, ValueError, TypeError):
        unavailable.extend(('stock', 'fx'))
        return []
    finally:
        if conn is not None:
            conn.close()


def _library_results(query, tokens, unavailable):
    match = public_library._search(query)
    if not match:
        return []
    cik = re.fullmatch(r'(?:CIK[\s:#-]*)?0*([0-9]{1,10})', query, re.IGNORECASE)
    company_tokens = tokens
    if cik:
        identifier = str(int(cik[1]))
        # SEC imports use both plain and ten-digit CIKs. Prefix FTS cannot
        # match an unpadded query against a zero-padded indexed token.
        company_where = 's.entity_id IN (?,?)'
        company_args = [identifier, identifier.zfill(10)]
    else:
        company_where = '''s.rowid IN (SELECT rowid FROM series_search WHERE series_search MATCH ?)
                           AND workspace_company_match(s.entity_name,s.entity_id)'''
        company_args = [match]
    results = []
    try:
        with public_library.connection() as conn:
            if conn is None:
                return []
            _bounded_connection(conn)
            # FTS narrows the candidates; these metadata predicates keep an
            # indicator-only match out of the company directory and avoid
            # duplicating company-name hits as individual financial measures.
            conn.create_function('workspace_company_match', 2,
                lambda name, identifier: int(_matches(company_tokens, name, identifier)))
            conn.create_function('workspace_measure_match', 4,
                lambda name, identifier, unit, dataset: int(any(
                    _matches([token], name, identifier, unit, dataset) for token in tokens)))
            companies = conn.execute('''
                SELECT s.entity_id, MIN(s.entity_name) AS entity_name
                FROM series s INDEXED BY library_summary
                WHERE s.source='sec' AND s.entity_type='company' AND s.observation_count>0
                  AND ''' + public_sql('s.') + '''
                  AND ''' + company_where + '''
                GROUP BY s.entity_id ORDER BY entity_name,s.entity_id LIMIT ?
                ''', [*company_args, PER_KIND]).fetchall()
            for row in companies:
                identifier = row['entity_id']
                if not isinstance(identifier, str) or not re.fullmatch(r'[0-9]{1,10}', identifier):
                    continue
                results.append(dict(id=identifier, kind='company', name=_text(row['entity_name']),
                    description='SEC filings · CIK ' + identifier,
                    href=url_for('public_library.company', entity_id=identifier)))
            records = conn.execute('''
                SELECT s.id,s.source,s.dataset,s.entity_name,s.indicator_name,s.unit
                FROM series s NOT INDEXED
                WHERE s.rowid IN (SELECT rowid FROM series_search WHERE series_search MATCH ?)
                  AND s.source IN ('worldbank','faostat','sec') AND s.observation_count>0
                  AND ''' + public_sql('s.') + '''
                  AND (s.entity_type='country' OR (s.source='sec' AND s.entity_type='company'
                       AND workspace_measure_match(s.indicator_name,s.indicator_id,s.unit,s.dataset)))
                ORDER BY s.entity_name,s.indicator_name,s.id LIMIT ?
                ''', (match, PER_KIND)).fetchall()
            for row in records:
                identifier = row['id']
                if (not isinstance(identifier, str) or not SERIES_ID.fullmatch(identifier)
                        or not identifier.startswith(row['source'] + '_')):
                    continue
                results.append(dict(id=identifier, kind='dataset',
                    name=_text(row['entity_name']) + ' · ' + _text(row['indicator_name']),
                    description=SOURCES[row['source']] + ' · ' + _text(row['unit']),
                    href=url_for('public_library.detail', identifier=identifier)))
    except HTTPException as exc:
        if exc.code != 503:
            raise
        unavailable.extend(('company', 'dataset'))
    except (sqlite3.Error, OSError, ValueError, TypeError):
        unavailable.extend(('company', 'dataset'))
    return results


def _reference_results(tokens, unavailable):
    results = []
    checked = 0
    started = time.monotonic()
    try:
        definitions, registry, snapshot = global_reference._catalogs(include_bulk=False)
        sources = {row['id']: row.get('name', '') for row in registry['sources']}
        economies = global_reference._economies(snapshot)
        for definition in definitions:
            identifier = definition.get('id')
            if not isinstance(identifier, str) or not REFERENCE_ID.fullmatch(identifier):
                continue
            if not _matches(tokens, definition.get('name'), identifier, definition.get('unit'),
                            definition.get('currency'), definition.get('source_id'),
                            definition.get('source_name'), sources.get(definition.get('source_id'))):
                continue
            if checked >= REFERENCE_CHECKS or time.monotonic() - started > 1:
                if 'reference' not in unavailable:
                    unavailable.append('reference')
                break
            checked += 1
            # Only matched public catalog entries may open an observation file.
            try:
                record = global_reference._record(definition, economies, full_history=False)
            except (OSError, ValueError, TypeError, KeyError):
                if 'reference' not in unavailable:
                    unavailable.append('reference')
                continue
            if not record['available']:
                continue
            results.append(dict(id=identifier, kind='reference', name=_text(record['name']),
                description=_text(sources.get(record['source_id'])) + ' · ' + _text(record['unit_label']),
                href=url_for('global_reference.detail', identifier=identifier)))
            if len(results) >= PER_KIND:
                break
    except HTTPException as exc:
        if exc.code != 503:
            raise
        unavailable.append('reference')
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        if 'reference' not in unavailable:
            unavailable.append('reference')
    return results


@bp.get('/api/workspace-search')
@limiter.limit('60 per minute')
def search():
    raw = request.args.get('q', '')
    query = raw.strip()
    if len(query) > 100 or any(not character.isprintable() for character in raw):
        return jsonify(error='Search must be at most 100 printable characters.'), 400
    if not query:
        return jsonify(results=[], unavailable=[])
    tokens = _tokens(query)
    if not tokens:
        return jsonify(results=[], unavailable=[])
    unavailable = []
    results = (_market_results(tokens, unavailable) + _library_results(query, tokens, unavailable)
               + _reference_results(tokens, unavailable))
    results = [dict(row, name=_text(row['name'], 200), description=_text(row['description'], 500))
               for row in results[:PER_KIND * 5]]
    return jsonify(results=results, unavailable=unavailable)
