"""Searchable public data library. Browsing only reads the local observation index."""
import csv
import io
import json
import re
import sqlite3
import time
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from flask import Blueprint, Response, abort, current_app, render_template, request, url_for

from app.extensions import limiter
from app.global_reference import exact_value, preview_value
from scripts.public_data_store import SOURCES, read_connection, decode_metadata
from scripts.faostat_catalog import DATASETS as FAOSTAT_DATASETS

bp = Blueprint('public_library', __name__)
PAGE_SIZE = 40
DATASET_NAMES = {'WDI': 'World Development Indicators', 'QCL': 'Crops and livestock',
                 'RL': 'Land use', 'TCL': 'Agricultural trade', 'frames': 'Company financial disclosures'}
DATASET_NAMES.update({code: spec.name for code, spec in FAOSTAT_DATASETS.items()
                     if code not in DATASET_NAMES})


def database_path():
    return Path(current_app.config.get('PUBLIC_LIBRARY_DB') or
                Path(current_app.config['JSON_DATA_DIR']) / 'public-library.sqlite3')


@contextmanager
def connection():
    conn = None
    try:
        conn = read_connection(database_path())
        if conn:
            started = time.monotonic()
            conn.set_progress_handler(lambda: time.monotonic() - started > 3, 10000)
            conn.execute('BEGIN')
        yield conn
    except sqlite3.Error:
        abort(503, description='The saved data library is temporarily unavailable. Please try again shortly.')
    finally:
        if conn:
            conn.close()


def _arg(name, limit=120):
    value = request.args.get(name, '').strip()
    if len(value) > limit or value and not value.isprintable():
        abort(400, description='Choose a shorter search or filter.')
    return value


def _page():
    raw = request.args.get('page', '1')
    if not re.fullmatch(r'[0-9]{1,5}', raw) or not 1 <= int(raw) <= 25000:
        abort(400, description='Choose a valid numbered page.')
    return int(raw)


def _search(q):
    tokens = re.findall(r'[^\W_]+', q, re.UNICODE)[:10]
    return ' AND '.join('"' + word + '"*' for word in tokens)


def _pagination(total, page, endpoint, **values):
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(page, pages)
    return dict(page=page, pages=pages, total=total, start=(page-1)*PAGE_SIZE+1 if total else 0,
                end=min(page*PAGE_SIZE, total),
                previous=url_for(endpoint, page=page-1, **values) if page>1 else None,
                next=url_for(endpoint, page=page+1, **values) if page<pages else None)


def _datasets(conn):
    return [dict(row) for row in conn.execute('SELECT * FROM datasets ORDER BY source,dataset')] if conn else []


@lru_cache(maxsize=1)
def _catalog_notice():
    # Company-directory cards do not read individual measure metadata. Include
    # the shipped taxonomy notice once for that company scope without a scan of
    # every saved series. The catalog is immutable for a deployed app revision.
    with (Path(__file__).resolve().parents[1] / 'scripts' / 'sec_concepts.json').open(encoding='utf-8') as stream:
        catalog = json.load(stream)
    return {'notice': catalog['authorized_uses_notice'], 'url': catalog['terms_url']}


def _taxonomy_notices(rows, company_directory=False):
    notices, seen = [], set()
    for row in rows:
        if row.get('source') != 'sec':
            continue
        raw = row.get('metadata', {})
        metadata = raw if isinstance(raw, dict) else decode_metadata(raw)
        notice = metadata.get('authorized_uses_notice') if isinstance(metadata, dict) else None
        if isinstance(notice, str) and notice and notice not in seen:
            seen.add(notice)
            notices.append({'notice': notice, 'url': metadata.get('taxonomy_terms_url', '')})
    if company_directory and rows and not notices:
        notices.append(_catalog_notice())
    return notices


def _listing(company=False, entity_id=None):
    q, source, dataset, indicator = _arg('q'), _arg('source', 20), _arg('dataset', 60), _arg('indicator', 180)
    page = _page()
    if source and source not in SOURCES:
        abort(400, description='Choose a saved publisher.')
    source = 'sec' if company else source
    entity_id = entity_id or _arg('entity', 80)
    grouped = company and not entity_id
    with connection() as conn:
        datasets = _datasets(conn)
        applicable = [row for row in datasets if (row['source']=='sec') == company]
        if dataset and (source, dataset) not in {(d['source'], d['dataset']) for d in applicable}:
            abort(400, description='Choose a saved dataset and its publisher.')
        where, args = ["s.entity_type='company'" if company else "s.entity_type='country'", 's.observation_count>0'], []
        for key, value in [('source', source), ('dataset', dataset), ('indicator_id', indicator), ('entity_id', entity_id)]:
            if value:
                where.append('s.' + key + '=?')
                args.append(value)
        match = _search(q)
        small_search = False
        if q:
            match = match or '"__no_search_tokens__"'
            # Only bounded FTS results may read full rows while counting or sorting.
            if conn:
                small_search = len(conn.execute('SELECT rowid FROM series_search WHERE series_search MATCH ? LIMIT ?',
                                               (match, PAGE_SIZE+1)).fetchall()) <= PAGE_SIZE
            where.append('s.rowid IN (SELECT rowid FROM series_search WHERE series_search MATCH ?)')
            args.append(match)
        clause = ' WHERE ' + ' AND '.join(where)
        count = 'COUNT(DISTINCT s.entity_id)' if grouped else 'COUNT(*)'
        count_index = 'library_summary' if company or entity_id else 'library_indicator_saved'
        index = ' NOT INDEXED' if small_search else ' INDEXED BY ' + count_index
        total = conn.execute('SELECT '+count+' FROM series s'+index+clause, args).fetchone()[0] if conn else 0
        endpoint = 'public_library.company' if entity_id and company else 'public_library.companies' if company else 'public_library.index'
        values = dict(q=q, source=source, dataset=dataset, indicator=indicator)
        if entity_id:
            values['entity_id' if company else 'entity'] = entity_id
        pagination = _pagination(total, page, endpoint, **values)
        limit, offset = PAGE_SIZE, (pagination['page']-1)*PAGE_SIZE
        if grouped:
            select = '''SELECT s.entity_id,MIN(s.entity_name) AS entity_name,COUNT(*) AS series_count,
                        SUM(s.observation_count) AS observation_count,MAX(s.checked_at) AS checked_at
                        FROM series s'''+index+clause+' GROUP BY s.entity_id ORDER BY entity_name,s.entity_id LIMIT ? OFFSET ?'
        else:
            index = ' NOT INDEXED' if small_search else ' INDEXED BY library_browse_saved'
            limit = min(PAGE_SIZE, max(0, total-offset))
            back_offset = total-offset-limit
            direction = ''
            if back_offset < offset:
                offset, direction = back_offset, ' DESC'
            page_clause, page_args = clause, args
            if conn and total and source and entity_id and not small_search:
                names = [row[0] for row in conn.execute('SELECT DISTINCT s.entity_name FROM series s INDEXED BY library_summary '
                    'WHERE s.entity_type=? AND s.observation_count>0 AND s.source=? AND s.entity_id=?',
                    ('company' if company else 'country', source, entity_id))]
                page_clause += ' AND s.entity_name IN (' + ','.join('?' for _ in names) + ')'
                page_args = [*args, *names]
            select = ('WITH page AS (SELECT s.rowid FROM series s'+index+page_clause+
                      ' ORDER BY s.entity_name'+direction+',s.indicator_name'+direction+',s.id'+direction+' LIMIT ? OFFSET ?) '
                      'SELECT s.* FROM page JOIN series s ON s.rowid=page.rowid '
                      'ORDER BY s.entity_name,s.indicator_name,s.id')
            args = page_args
        rows = [dict(row) for row in conn.execute(select,
                [*args, limit, offset])] if conn else []
        entity_name = None
        if entity_id and company:
            entity = conn.execute('SELECT entity_name FROM series WHERE source=? AND entity_id=? LIMIT 1',
                                  ('sec', entity_id)).fetchone() if conn else None
            if not entity:
                abort(404)
            entity_name = entity[0]
    return render_template('public_library/index.html', meta_title=(entity_name or 'Companies' if company else 'Country data')+' | BenchmarkWatcher',
                           records=rows, datasets=applicable, all_datasets=datasets, company=company, grouped=grouped,
                           entity_name=entity_name, entity_id=entity_id, q=q, source=source, dataset=dataset,
                           indicator=indicator, pagination=pagination, sources=SOURCES, dataset_names=DATASET_NAMES,
                           preview_value=preview_value, exact_value=exact_value,
                           taxonomy_notices=_taxonomy_notices(rows, company_directory=grouped))


@bp.get('/data')
@limiter.limit('60 per minute')
def index():
    return _listing()


@bp.get('/companies')
@limiter.limit('60 per minute')
def companies():
    return _listing(company=True)


@bp.get('/companies/<entity_id>')
@limiter.limit('60 per minute')
def company(entity_id):
    if not re.fullmatch(r'[0-9]{1,10}', entity_id):
        abort(404)
    return _listing(company=True, entity_id=entity_id)


def _detail(identifier):
    if not re.fullmatch(r'(?:worldbank|faostat|sec)_[a-f0-9]{32}', identifier):
        abort(404)
    with connection() as conn:
        row = conn.execute('SELECT * FROM series WHERE id=? AND observation_count>0', (identifier,)).fetchone() if conn else None
        if not row:
            abort(404)
        record = dict(row)
        if record['observation_count'] > 2000:
            abort(503, description='This history exceeds the supported display size.')
        record['metadata'] = decode_metadata(record['metadata'])
        history = []
        for item in conn.execute('SELECT * FROM observations WHERE series_id=? ORDER BY period', (identifier,)):
            point = dict(item)
            point['metadata'] = decode_metadata(point['metadata'])
            point['price'] = point['value']
            point['display_value'] = source_value(point)
            point['source_url'] = point['source_url'] or record['source_url']
            period = point['period']
            end = point['metadata'].get('end') or period.split('/')[-1]
            point['date'] = end + '-01-01' if re.fullmatch(r'\d{4}', end) else end
            point['status'] = point['metadata'].get('flag', point['metadata'].get('status', ''))
            point['footnote'] = point['metadata'].get('note', point['metadata'].get('footnote', ''))
            history.append(point)
        record['history'] = history
        record['revision_count'] = conn.execute('SELECT COUNT(*) FROM observation_revisions WHERE series_id=?', (identifier,)).fetchone()[0]
    return record


def source_value(point):
    raw = point.get('metadata', {}).get('source_value')
    if isinstance(raw, str) and re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', raw):
        return raw
    return point['value']


@bp.get('/data/<identifier>')
@limiter.limit('60 per minute')
def detail(identifier):
    record = _detail(identifier)
    return render_template('public_library/detail.html', meta_title=record['entity_name']+' · '+record['indicator_name'],
                           record=record, sources=SOURCES, exact_value=exact_value,
                           taxonomy_notices=_taxonomy_notices([record]),
                           chart=dict(name=record['indicator_name'], unit=record['unit'], frequency='annual', history=record['history']))


@bp.get('/data/<identifier>.csv')
@limiter.limit('20 per minute')
def download(identifier):
    record = _detail(identifier)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['period', 'value', 'unit', 'source_url', 'source_metadata', 'entity',
                     'indicator', 'publisher', 'dataset', 'attribution', 'license', 'series_metadata'])
    def cell(value):
        value = str(value)
        return "'"+value if value.startswith(('=', '+', '-', '@', '\t', '\r')) else value
    for point in record['history']:
        writer.writerow([cell(point['period']), source_value(point), cell(record['unit']), point['source_url'],
                         json.dumps(point['metadata'], ensure_ascii=False), cell(record['entity_name']),
                         cell(record['indicator_name']), SOURCES[record['source']], cell(record['dataset']),
                         cell(record['attribution']), cell(record['license']), json.dumps(record['metadata'], ensure_ascii=False)])
    return Response(out.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': 'attachment; filename="'+identifier+'.csv"'})
