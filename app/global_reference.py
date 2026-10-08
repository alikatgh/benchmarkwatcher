"""Read-only global reference pages; public requests never contact a provider."""

import json
import math
import os
import re
import sqlite3
import stat
import time
from decimal import Decimal
from datetime import date
from functools import lru_cache
from pathlib import Path

from flask import Blueprint, abort, current_app, render_template, request, url_for
from scripts.global_sources import worldbank_definition
from scripts.public_data_store import SOURCES, read_connection
from scripts.faostat_catalog import DATASETS as FAOSTAT_DATASETS
from scripts.library_coverage import coverage as expansion_coverage

bp = Blueprint('global_reference', __name__)
SCRIPT_DIR = Path(__file__).resolve().parents[1] / 'scripts'
MAX_JSON_BYTES = 4 * 1024 * 1024
PAGE_SIZE = 30
TYPES = {'exchange_reference': 'Exchange references', 'consumer_inflation': 'Consumer inflation',
         'economic_indicator': 'Country statistics', 'retail_fuel_price': 'Administered fuel prices'}
READINESS = {'adapter_ready': 'Reader ready', 'catalogued': 'Catalogued',
             'needs_registration': 'Registration needed', 'access_review': 'Access review'}
ACCESS = {'free_public': 'Free public access', 'free_registered': 'Free registered access',
          'public_access_documented_cost_not_verified': 'Public access; cost not verified',
          'cost_not_verified': 'Cost not verified', 'access_not_verified': 'Access not verified'}
LIBRARY_DATASET_NAMES = {'WDI': 'World Development Indicators', 'QCL': 'Crops and livestock',
                         'RL': 'Land use', 'TCL': 'Agricultural trade',
                         'frames': 'Company financial disclosures'}
LIBRARY_DATASET_NAMES.update({code: spec.name for code, spec in FAOSTAT_DATASETS.items()
                             if code not in LIBRARY_DATASET_NAMES})


@lru_cache(maxsize=48)
def _read_json(path, modified, size):
    """The stat signature invalidates the bounded per-process snapshot cache."""
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(descriptor, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('Not a regular snapshot')
        body = stream.read(MAX_JSON_BYTES + 1)
    if len(body) > MAX_JSON_BYTES:
        raise ValueError('Snapshot exceeds its size limit')
    return json.loads(body)


def safe_json(path):
    """Only callers' fixed catalog paths or allowlisted series IDs enter here."""
    path = Path(path).absolute()
    try:
        if path.is_symlink() or path.parent.is_symlink():
            return None
        # Trusted base locations can use macOS aliases such as /var. Only the
        # fixed snapshot entry is added after resolving that base location.
        path = path.parent.resolve() / path.name
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_JSON_BYTES:
            return None
        return _read_json(str(path), info.st_mtime_ns, info.st_size)
    except (OSError, ValueError, TypeError):
        return None


def _catalogs(include_bulk=True):
    definitions = safe_json(SCRIPT_DIR / 'global_series.json')
    registry = safe_json(SCRIPT_DIR / 'source_registry.json')
    snapshot = safe_json(SCRIPT_DIR / 'global_catalog_snapshot.json')
    if (not isinstance(definitions, dict) or not isinstance(definitions.get('series'), list) or
            not isinstance(registry, dict) or not isinstance(registry.get('sources'), list) or
            not isinstance(snapshot, dict) or not isinstance(snapshot.get('worldbank'), dict)):
        abort(503, description='The saved source directory is temporarily unavailable.')
    series = [row for row in definitions['series'] if row.get('enabled') is True and
              row.get('reference_type') in TYPES and re.fullmatch(r'[a-z][a-z0-9_]{1,100}', row.get('id', ''))]
    indicator_names = {row['id']: row['name'] for row in snapshot['worldbank'].get('indicators', [])}
    series = [dict(row, indicator=row['api_config']['indicator'],
                   indicator_name=indicator_names.get(row['api_config']['indicator'], row['name']))
              if row.get('source_id') == 'worldbank' else row for row in series]
    if include_bulk:
        bulk = _bulk_definitions(series, snapshot)
        bulk_ids = {row['id'] for row in bulk}
        series = [row for row in series if row['id'] not in bulk_ids] + bulk
    return series, registry, snapshot


def _bulk_definitions(series, snapshot):
    """A small saved index enables paging without reading every history file."""
    manifest = safe_json(_data_directory() / 'worldbank_manifest.json')
    if manifest is None:
        return []
    config = safe_json(SCRIPT_DIR / 'worldbank_bulk_series.json')
    if (not isinstance(manifest, dict) or manifest.get('schema_version') != 1 or
            manifest.get('source_id') != 'worldbank' or manifest.get('source_database') != 2 or
            not isinstance(manifest.get('series'), list) or len(manifest['series']) > 2000 or
            not isinstance(config, dict) or not isinstance(config.get('indicators'), list)):
        abort(503, description='The saved country reference index is temporarily unavailable.')
    economies = {row['id']: row for row in snapshot['worldbank'].get('economies', [])}
    indicators = {row['indicator']: row for row in config['indicators'] if row.get('enabled') is True and
                  row.get('license') == 'CC BY-4.0' and row.get('reference_type') in TYPES}
    aliases = {(row['api_config']['country'], row['api_config']['indicator']): row['id']
               for row in series if row.get('source_id') == 'worldbank'}
    result, seen = [], set()
    for row in manifest['series']:
        if not isinstance(row, dict):
            continue
        economy, indicator = economies.get(row.get('economy_id')), indicators.get(row.get('indicator'))
        if economy is None or indicator is None:
            continue
        try:
            definition = worldbank_definition(indicator, economy, aliases)
        except (KeyError, TypeError):
            abort(503, description='The saved country reference configuration is temporarily unavailable.')
        if row.get('id') != definition['id'] or definition['id'] in seen:
            continue
        path = _data_directory() / (definition['id'] + '.json')
        try:
            if path.is_symlink() or path.parent.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON_BYTES:
                continue
        except OSError:
            continue
        latest = _points({'history': [row.get('latest')]})
        count = row.get('observation_count')
        checked = row.get('checked_on')
        if (not latest or isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 20000 or
                not isinstance(checked, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', checked)):
            continue
        definition['_saved_summary'] = {'latest': latest[0], 'count': count, 'checked': checked}
        seen.add(definition['id'])
        result.append(definition)
    return result


def _data_directory():
    configured = current_app.config.get('GLOBAL_REFERENCE_DATA_DIR')
    return Path(configured).resolve() if configured else Path(current_app.config['JSON_DATA_DIR']).resolve() / 'global-reference'


def _points(payload):
    rows = payload.get('history', [])
    if not isinstance(rows, list) or len(rows) > 20000:
        return []
    points = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        value, when, period = row.get('price'), row.get('date'), row.get('period', row.get('date'))
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or
                not isinstance(when, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', when) or
                not isinstance(period, str) or not re.fullmatch(r'\d{4}(?:-\d{2}(?:-\d{2})?)?', period)):
            continue
        try:
            date.fromisoformat(when)
        except ValueError:
            continue
        point = {'date': when, 'period': period, 'price': value}
        if isinstance(row.get('status'), str):
            point['status'] = row['status'][:40]
        if isinstance(row.get('footnote'), str):
            point['footnote'] = row['footnote'][:4000]
        if isinstance(row.get('source_decimal'), int) and not isinstance(row['source_decimal'], bool):
            point['source_decimal'] = row['source_decimal']
        points[when] = point
    return [points[key] for key in sorted(points)]


def exact_value(value):
    """Source precision for the table/readout, including a valid zero value."""
    return str(value) if value is not None else 'Unavailable'


def preview_value(value):
    """Keep list comparisons readable; exact source values remain in detail."""
    if value is None:
        return 'Unavailable'
    divisor, suffix = next(((size, suffix) for size, suffix in
                            ((1e12, 'T'), (1e9, 'B'), (1e6, 'M')) if abs(value) >= size), (1, ''))
    label = format(Decimal(format(value / divisor, '.6g')), ',f')
    if '.' in label:
        label = label.rstrip('0').rstrip('.')
    return label + suffix


def _record(series, economies, full_history=True):
    # Definition metadata is trusted public catalog content; only observations
    # and safe timestamps are read from the cached data file.
    record = dict(series)
    summary = series.get('_saved_summary') if not full_history else None
    payload = None if summary else safe_json(_data_directory() / (series['id'] + '.json'))
    points = _points(payload) if isinstance(payload, dict) and payload.get('id') == series['id'] else []
    record['history'] = points
    record['available'] = bool(points) or bool(summary)
    record['latest'] = summary['latest'] if summary else points[-1] if points else None
    record['observation_count'] = summary['count'] if summary else len(points)
    record['type_label'] = TYPES[series['reference_type']]
    record['countries_label'] = ' · '.join(economies.get(code, 'Euro area' if code == 'euro_area' else code)
                                         for code in series['countries'])
    record['unit_label'] = (series['currency'] + ' / ' + series['unit']
                            if series['reference_type'] == 'retail_fuel_price' else series['unit'])
    stamp = payload.get('fetched_at', '') if isinstance(payload, dict) else ''
    record['checked'] = summary['checked'] if summary else stamp[:10] if isinstance(stamp, str) and re.match(r'^\d{4}-\d{2}-\d{2}', stamp) else None
    record['revision_count'] = len(payload.get('revisions', [])) if isinstance(payload, dict) and isinstance(payload.get('revisions'), list) else 0
    if len(points) > 1:
        change = round(points[-1]['price'] - points[-2]['price'], 6)
        record['change'] = ('+' if change > 0 else '') + str(change)
        record['change_unit'] = 'percentage points' if series['reference_type'] in {'consumer_inflation', 'economic_indicator'} and '%' in series['unit'] else record['unit_label']
    return record


def _economies(snapshot):
    return {row['iso2']: row['name'] for row in snapshot['worldbank'].get('economies', [])}


def _query(name):
    value = request.args.get(name, '').strip()
    if len(value) > 100:
        abort(400, description='Search terms must be at most 100 characters.')
    return value


def _pagination(rows, endpoint, **parameters):
    try:
        page = int(request.args.get('page', '1'))
    except ValueError:
        abort(400, description='Choose a numbered page.')
    if not 1 <= page <= 1000:
        abort(400, description='Choose a valid numbered page.')
    total = len(rows)
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(page, pages)
    start = (page - 1) * PAGE_SIZE
    return {'items': rows[start:start + PAGE_SIZE], 'page': page, 'pages': pages, 'total': total,
            'start': start + 1 if total else 0, 'end': min(start + PAGE_SIZE, total),
            'previous': url_for(endpoint, page=page - 1, **parameters) if page > 1 else None,
            'next': url_for(endpoint, page=page + 1, **parameters) if page < pages else None}


def country_summary():
    """Homepage counts from the saved index, without loading every history."""
    series, _, snapshot = _catalogs()
    records = [_record(row, _economies(snapshot), full_history=False)
               for row in series if row['source_id'] == 'worldbank']
    loaded = [row for row in records if row['available']]
    return {'histories': len(loaded),
            'economies': len({code for row in loaded for code in row['countries']})}


def listing_context(endpoint='global_reference.index', countries_only=False):
    """One cache-only listing for both the homepage and reference directory."""
    series, registry, snapshot = _catalogs()
    q, kind, country, indicator, publisher = _query('q'), _query('kind'), _query('country'), _query('indicator'), _query('source')
    if kind and kind not in TYPES:
        abort(400, description='Choose a reference type from the list.')
    if publisher and publisher not in {row['source_id'] for row in series}:
        abort(400, description='Choose a publisher with saved references.')
    records = [_record(row, _economies(snapshot), full_history=False) for row in series]
    if countries_only:
        records = [row for row in records if row['source_id'] == 'worldbank' and row['available']]
        series = records
        publisher = 'worldbank'
    countries = sorted({(code, _economies(snapshot).get(code, 'Euro area' if code == 'euro_area' else code))
                        for row in series for code in row['countries']}, key=lambda item: item[1])
    indicators = sorted({(row['indicator'], row['indicator_name']) for row in series if row.get('indicator')}, key=lambda item: item[1])
    if country and country not in {code for code, _ in countries} or indicator and indicator not in {code for code, _ in indicators}:
        abort(400, description='Choose a country or measure from the saved references.')
    filtered = [row for row in records if (not kind or row['reference_type'] == kind) and
                (not publisher or row['source_id'] == publisher) and
                (not country or country in row['countries']) and (not indicator or row.get('indicator') == indicator) and
                (not q or q.casefold() in (' '.join([row['name'], row['countries_label'], row['source_name'], row['type_label']])).casefold())]
    filtered.sort(key=lambda row: (row['countries_label'], row.get('indicator_name', row['name'])))
    parameters = dict(q=q, kind=kind, country=country, indicator=indicator, source=publisher)
    if countries_only:
        parameters['dataset'] = 'countries'
    pagination = _pagination(filtered, endpoint, **parameters)
    loaded = [row for row in records if row['available']]
    return dict(records=pagination['items'], q=q, kind=kind,
                           country=country, indicator=indicator, countries=countries, indicators=indicators,
                           publisher=publisher, publisher_label=next((row['source_name'] for row in series if row['source_id'] == publisher), ''),
                           pagination=pagination, country_count=len({code for row in loaded if row.get('source_id') == 'worldbank' for code in row['countries']}),
                           worldbank_count=sum(row['source_id'] == 'worldbank' for row in loaded),
                           types=TYPES, total=len(records), available=sum(row['available'] for row in records),
                           publishers=len({row['source_id'] for row in records}), exact_value=exact_value,
                           preview_value=preview_value, countries_only=countries_only,
                           reset_url=url_for(endpoint, dataset='countries') if countries_only else url_for(endpoint, source=publisher),
                           meta_title='Global references | BenchmarkWatcher',
                           meta_description='Explore saved official currency references, inflation, country statistics and administered fuel prices with source evidence.')


@bp.get('/references')
def index():
    return render_template('global_reference/index.html', **listing_context())


@bp.get('/reference/<identifier>')
def detail(identifier):
    if not re.fullmatch(r'[a-z][a-z0-9_]{1,100}', identifier):
        abort(404)
    series, registry, snapshot = _catalogs()
    definition = next((row for row in series if row['id'] == identifier), None)
    if definition is None:
        abort(404)
    record = _record(definition, _economies(snapshot))
    source = next(row for row in registry['sources'] if row['id'] == record['source_id'])
    history = _pagination(list(reversed(record['history'])), 'global_reference.detail', identifier=identifier)
    return render_template('global_reference/detail.html', record=record, source=source,
                           history=history, exact_value=exact_value,
                           meta_title=record['name'] + ' history | BenchmarkWatcher',
                           meta_description='Exact saved source observations, original reporting periods, historical D3 chart and attribution for ' + record['name'] + '.')


@bp.get('/sources')
def sources():
    series, registry, snapshot = _catalogs(include_bulk=False)
    provider_q, region, status = _query('provider_q'), _query('region'), _query('status')
    regions = sorted({row['region'] for row in registry['sources']})
    if region and region not in regions or status and status not in READINESS:
        abort(400, description='Choose a region or readiness from the list.')
    providers = [row for row in registry['sources'] if (not region or row['region'] == region) and
                 (not status or row['status'] == status) and
                 (not provider_q or provider_q.casefold() in (' '.join([row['name'], row['region'], *row['categories'], *row['countries']])).casefold())]
    catalog_kind, q = _query('catalog') or 'indicators', _query('q')
    if catalog_kind not in {'indicators', 'economies'}:
        abort(400, description='Choose indicators or economies.')
    catalog_rows = snapshot['worldbank'].get(catalog_kind, [])
    fields = ('id', 'name', 'original_source', 'topics') if catalog_kind == 'indicators' else ('id', 'iso2', 'name', 'region')
    filtered = [row for row in catalog_rows if not q or q.casefold() in ' '.join(
        ' '.join(row.get(field, [])) if isinstance(row.get(field), list) else str(row.get(field, '')) for field in fields).casefold()]
    catalog = _pagination(filtered, 'global_reference.sources', catalog=catalog_kind, q=q,
                          provider_q=provider_q, region=region, status=status)
    library = _library_coverage(catalog_kind, catalog['items'])
    expansion = expansion_coverage(Path(current_app.config.get('PUBLIC_LIBRARY_DB') or
                Path(current_app.config['JSON_DATA_DIR']) / 'public-library.sqlite3'))
    counts, catalog_links = library['counts'], {}
    wdi = library['worldbank']
    if wdi:
        loaded_worldbank, loaded_economies = wdi['series_count'], wdi['entity_count']
        for item in catalog['items']:
            if counts.get(item['id']):
                values = {'indicator': item['id']} if catalog_kind == 'indicators' else {'entity': item['id']}
                catalog_links[item['id']] = url_for('public_library.index', source='worldbank', **values)
    else:
        # The legacy JSON subset remains the fallback. Once broad WDI exists,
        # its overlapping histories are neither opened nor counted a second time.
        bulk = _bulk_definitions(series, snapshot)
        bulk_ids = {row['id'] for row in bulk}
        series = [row for row in series if row['id'] not in bulk_ids] + bulk
        loaded, counts = [], {}
        for row in series:
            if row['source_id'] == 'worldbank' and _record(row, _economies(snapshot), full_history=False)['available']:
                loaded.append(row)
                key = row['api_config']['indicator'] if catalog_kind == 'indicators' else row['api_config']['country']
                counts[key] = counts.get(key, 0) + 1
        loaded_worldbank = len(loaded)
        loaded_economies = len({row['api_config']['country'] for row in loaded})
        for item in catalog['items']:
            key = item['id'] if catalog_kind == 'indicators' else item['iso2']
            if counts.get(key):
                catalog_links[item['id']] = (url_for('global_reference.index', indicator=item['id'])
                    if catalog_kind == 'indicators' else url_for('global_reference.index', country=item['iso2'], source='worldbank'))
        counts = {item['id']: counts.get(item['id'] if catalog_kind == 'indicators' else item['iso2'], 0)
                  for item in catalog['items']}
    return render_template('global_reference/sources.html', providers=providers, provider_q=provider_q,
                           region=region, status=status, regions=regions, readiness=READINESS, access=ACCESS,
                           catalog=catalog, catalog_kind=catalog_kind, q=q, snapshot=snapshot,
                           registry=registry, counts=counts, catalog_links=catalog_links,
                           loaded_worldbank=loaded_worldbank, loaded_economies=loaded_economies,
                           library=library, library_sources=SOURCES, dataset_names=LIBRARY_DATASET_NAMES,
                           expansion=expansion,
                           saved_worldbank_url=url_for('public_library.index', source='worldbank') if wdi else url_for('global_reference.index'),
                           meta_title='Public source directory | BenchmarkWatcher',
                           meta_description='Review official source access, licensing and readiness, and search the saved World Bank indicator and economy catalog.')


def _library_coverage(catalog_kind, items):
    """Read committed coverage and at most one catalog page of indexed counts."""
    empty = {'datasets': [], 'worldbank': None, 'counts': {}, 'unavailable': False}
    path = Path(current_app.config.get('PUBLIC_LIBRARY_DB') or
                Path(current_app.config['JSON_DATA_DIR']) / 'public-library.sqlite3')
    connection = None
    try:
        connection = read_connection(path)
        if connection is None:
            return empty
        started = time.monotonic()
        connection.set_progress_handler(lambda: time.monotonic() - started > 3, 10000)
        connection.execute('BEGIN')  # One read snapshot across totals and page counts.
        datasets = [dict(row) for row in connection.execute(
            'SELECT * FROM datasets WHERE series_count>0 AND observation_count>0 ORDER BY source,dataset')
            if row['source'] in SOURCES]
        for dataset in datasets:
            endpoint = 'public_library.companies' if dataset['source'] == 'sec' else 'public_library.index'
            dataset['url'] = url_for(endpoint, source=dataset['source'], dataset=dataset['dataset'])
        wdi = next((row for row in datasets if row['source'] == 'worldbank' and row['dataset'] == 'WDI'), None)
        counts = {}
        if wdi and items:
            field = 'indicator_id' if catalog_kind == 'indicators' else 'entity_id'
            index = 'library_indicator_saved' if catalog_kind == 'indicators' else 'library_summary'
            identifiers = [item['id'] for item in items]
            placeholders = ','.join('?' for _ in identifiers)
            query = (f'SELECT {field},COUNT(*) FROM series INDEXED BY {index} WHERE source=? AND dataset=? '
                     f"AND entity_type='country' AND observation_count>0 AND {field} IN ({placeholders}) GROUP BY {field}")
            counts = {row[0]: row[1] for row in connection.execute(query, ['worldbank', 'WDI', *identifiers])}
        return {'datasets': datasets, 'worldbank': wdi, 'counts': counts, 'unavailable': False}
    except (sqlite3.Error, OSError, ValueError):
        return {**empty, 'unavailable': True}
    finally:
        if connection is not None:
            connection.close()
