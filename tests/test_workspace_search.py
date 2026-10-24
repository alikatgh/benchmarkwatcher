"""Workspace discovery reads bounded local public metadata, never providers."""

from collections import Counter
from contextlib import closing
import hashlib
import json
import sqlite3
import time

import pytest

from app import workspace_search as search
from scripts.public_data_store import LibraryWriter, read_connection, series_id


@pytest.fixture
def workspace(app_client, tmp_path, monkeypatch):
    app_client.application.config.update(MARKET_DATA_ENABLED=True,
        MARKET_DATA_DB=str(tmp_path / 'market.sqlite3'),
        PUBLIC_LIBRARY_DB=str(tmp_path / 'library.sqlite3'),
        GLOBAL_REFERENCE_DATA_DIR=str(tmp_path / 'references'))
    monkeypatch.setattr(search.global_reference, '_catalogs', lambda **kwargs:
                        ([], {'sources': []}, {'worldbank': {'economies': []}}))

    def forbidden(*args, **kwargs):
        raise AssertionError('Workspace search must not contact a provider')

    monkeypatch.setattr('requests.sessions.Session.request', forbidden)
    return app_client, tmp_path


def market(path, *identifiers):
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE instruments (id TEXT PRIMARY KEY)')
        conn.executemany('INSERT INTO instruments VALUES (?)', [(value,) for value in identifiers])


def series(path, *, source='worldbank', dataset='WDI', entity='AUS', name='Australia',
           indicator='POP', label='Population', kind='country', unit='people'):
    identifier = series_id(source, entity, indicator, unit)
    with LibraryWriter(path, source, dataset, journal_mode='DELETE') as writer:
        writer.add_series(dict(id=identifier, source=source, dataset=dataset, entity_id=entity,
            entity_name=name, entity_type=kind, indicator_id=indicator, indicator_name=label,
            unit=unit, frequency='annual', source_url='https://example.org/source',
            attribution='Test publisher', license='Public test fixture'),
            [{'period': '2025', 'value': 123}])
    return identifier


def find(client, query):
    response = client.get('/api/workspace-search', query_string={'q': query})
    assert response.status_code == 200
    return response.get_json()


def references(monkeypatch, directory, definitions):
    directory.mkdir()
    for row in definitions:
        (directory / (row['id'] + '.json')).write_text(json.dumps(dict(id=row['id'],
            history=[{'date': '2025-01-01', 'price': 1.25}], fetched_at='2025-01-02')))
    monkeypatch.setattr(search.global_reference, '_catalogs', lambda **kwargs:
        (definitions, {'sources': [{'id': 'ecb', 'name': 'European Central Bank'}]},
         {'worldbank': {'economies': [{'iso2': 'AU', 'name': 'Australia'}]}}))


def reference(identifier, name, currency='EUR', unit='CAD per 1 EUR'):
    return dict(id=identifier, name=name, source_id='ecb', source_name='European Central Bank',
                reference_type='exchange_reference', countries=['euro_area'], unit=unit, currency=currency)


@pytest.mark.parametrize('query', ['', '   ', '...'])
def test_empty_or_tokenless_query_does_not_open_any_source(workspace, monkeypatch, query):
    client, path = workspace

    def forbidden(*args, **kwargs):
        raise AssertionError('Empty search opened a source')

    monkeypatch.setattr(search, 'read_connection', forbidden)
    monkeypatch.setattr(search.public_library, 'connection', forbidden)
    monkeypatch.setattr(search.global_reference, '_catalogs', forbidden)
    assert find(client, query) == {'results': [], 'unavailable': []}
    assert not (path / 'market.sqlite3').exists()
    assert not (path / 'library.sqlite3').exists()


@pytest.mark.parametrize('enabled', [False, None, 'true', '1', 1])
def test_market_requires_literal_true_before_resolving_or_reading_path(workspace, monkeypatch, enabled):
    client, _ = workspace
    client.application.config['MARKET_DATA_ENABLED'] = enabled

    def forbidden(*args, **kwargs):
        raise AssertionError('Disabled market source read')

    monkeypatch.setattr(search.market_data, 'database_path', forbidden)
    monkeypatch.setattr(search, 'read_connection', forbidden)
    assert find(client, 'Apple')['results'] == []


def test_missing_sources_do_not_create_databases(workspace):
    client, directory = workspace
    before = set(directory.iterdir())
    assert find(client, 'Apple') == {'results': [], 'unavailable': []}
    assert set(directory.iterdir()) == before


@pytest.mark.parametrize('query', ['Apple', ' apple ', 'AAPL', 'aapl', 'XNAS AAPL'])
def test_stocks_match_names_symbols_and_punctuation(workspace, query):
    client, directory = workspace
    market(directory / 'market.sqlite3', 'stock-XNAS-AAPL', 'fx-USD-EUR')
    rows = find(client, query)['results']
    assert rows == [dict(id='stock-XNAS-AAPL', kind='stock', name='Apple',
                        description='AAPL · USD per share', href='/stocks/stock-XNAS-AAPL')]


@pytest.mark.parametrize('query', ['USD/EUR', 'usd eur', 'USD-EUR', 'USDEUR', 'EUR/USD'])
def test_fx_pair_search_preserves_saved_quote_orientation(workspace, query):
    client, directory = workspace
    market(directory / 'market.sqlite3', 'fx-USD-EUR', 'fx-USD-CAD')
    rows = find(client, query)['results']
    assert [row['id'] for row in rows] == ['fx-USD-EUR']
    assert rows[0]['name'] == 'USD/EUR'
    assert rows[0]['description'] == 'EUR per 1 USD'
    assert rows[0]['href'] == '/exchange-rates/fx-USD-EUR'


def test_unstored_cross_pair_is_not_fabricated(workspace):
    client, directory = workspace
    market(directory / 'market.sqlite3', 'fx-USD-EUR', 'fx-USD-CAD')
    assert find(client, 'EUR/CAD')['results'] == []


def test_company_grouping_country_datasets_and_explicit_financial_measures(workspace):
    client, directory = workspace
    path = directory / 'library.sqlite3'
    population = series(path)
    assets = series(path, source='sec', dataset='frames', entity='320193', name='Apple Inc.',
                    indicator='us-gaap:Assets', label='Total assets', kind='company', unit='USD')
    series(path, source='sec', dataset='frames', entity='320193', name='Apple Inc.',
           indicator='us-gaap:Revenues', label='Revenue', kind='company', unit='USD')
    apple = find(client, 'Apple')['results']
    assert apple == [dict(id='320193', kind='company', name='Apple Inc.',
                         description='SEC filings · CIK 320193', href='/companies/320193')]
    for query in ['320193', '0000320193', 'CIK 320193']:
        assert [row['id'] for row in find(client, query)['results'] if row['kind'] == 'company'] == ['320193']
    assert find(client, 'AAPL')['results'] == []  # SEC metadata is not a ticker directory.
    country = find(client, 'Australia population')['results']
    assert [row['id'] for row in country] == [population]
    assert country[0]['href'] == '/data/' + population
    assert country[0]['name'] == 'Australia · Population'
    assert [row['id'] for row in find(client, 'Apple assets')['results']] == [assets]
    assert all(row['kind'] == 'dataset' for row in find(client, 'assets')['results'])


@pytest.mark.parametrize('stored_cik', ['320193', '0000320193'])
@pytest.mark.parametrize('query', ['320193', '0000320193', 'CIK 320193', 'CIK 0000320193'])
def test_company_cik_matches_plain_and_padded_sec_metadata(workspace, stored_cik, query):
    client, directory = workspace
    series(directory / 'library.sqlite3', source='sec', dataset='frames', entity=stored_cik,
           name='Apple Inc.', indicator='us-gaap:Assets', label='Total assets', kind='company', unit='USD')
    rows = find(client, query)['results']
    assert rows == [dict(id=stored_cik, kind='company', name='Apple Inc.',
                        description='SEC filings · CIK ' + stored_cik, href='/companies/' + stored_cik)]


def test_library_queries_use_proven_bounded_lookup_plans(workspace, monkeypatch):
    client, directory = workspace
    path = directory / 'library.sqlite3'
    series(path, name='Apple country', label='Apple production')
    series(path, source='sec', dataset='frames', entity='0000320193', name='Apple Inc.',
           indicator='us-gaap:Assets', label='Total assets', kind='company', unit='USD')
    statements = []

    def traced_connection(database):
        conn = read_connection(database)
        conn.set_trace_callback(statements.append)
        return conn

    monkeypatch.setattr(search.public_library, 'read_connection', traced_connection)
    assert find(client, 'Apple')['unavailable'] == []
    assert find(client, '320193')['unavailable'] == []
    queries = [sql for sql in statements if 'FROM series s ' in sql]
    assert len(queries) == 4
    with closing(read_connection(path)) as conn:
        conn.create_function('workspace_company_match', 2, lambda *args: 1)
        conn.create_function('workspace_measure_match', 4, lambda *args: 1)
        for sql in queries:
            plan = [row['detail'] for row in conn.execute('EXPLAIN QUERY PLAN ' + sql)]
            if 'SELECT s.entity_id' in sql:
                if 's.entity_id IN (' in sql:
                    assert any('COVERING INDEX library_summary (entity_type=? AND source=?' in step
                               for step in plan), plan
                    assert any('entity_id=?)' in step for step in plan), plan
                else:
                    assert any('SEARCH s USING INTEGER PRIMARY KEY (rowid=?)' in step for step in plan), plan
            else:
                # The OR over country and SEC metadata otherwise makes SQLite
                # scan large source indexes before testing FTS membership.
                assert any('SEARCH s USING INTEGER PRIMARY KEY (rowid=?)' in step for step in plan), plan
                assert not any('MULTI-INDEX OR' in step for step in plan), plan


def test_broad_search_merges_complete_ordered_groups_and_company_aliases(workspace, monkeypatch):
    client, directory = workspace
    path = directory / 'library.sqlite3'
    expected = []
    companies = []
    for index in range(24):
        name = f'USD {index * 2:03d} country'
        identifier = series(path, entity=str(index), name=name, unit='USD')
        expected.append((name, 'Population', identifier))
        name = f'USD {index * 2 + 1:03d} Company'
        entity = str(1000 + index)
        identifier = series(path, source='sec', dataset='frames', entity=entity,
                            name=name, kind='company', unit='USD')
        expected.append((name, 'Population', identifier))
        companies.append((name, entity))
    # A company's saved aliases may differ per measure. Only aliases matching
    # the name query may supply the displayed company name.
    alias = series(path, source='sec', dataset='frames', entity='1000', name='Aardvark',
                   indicator='ALT', label='Other USD measure', kind='company', unit='USD')
    expected.append(('Aardvark', 'Other USD measure', alias))
    series(path, source='sec', dataset='frames', entity='1000', name='USD Zulu',
           indicator='THIRD', label='Third measure', kind='company', unit='USD')
    series(path, source='faostat', dataset='TCL', entity='held', name='A held USD country', unit='USD')
    unsaved = series(path, entity='empty', name='A empty USD country', unit='USD')
    with sqlite3.connect(path) as conn:
        conn.execute('DELETE FROM observations WHERE series_id=?', (unsaved,))
        conn.execute('UPDATE series SET observation_count=0 WHERE id=?', (unsaved,))
    statements = []

    def traced_connection(database):
        conn = read_connection(database)
        conn.set_trace_callback(statements.append)
        return conn

    monkeypatch.setattr(search.public_library, 'read_connection', traced_connection)
    result = find(client, 'USD')
    assert result['unavailable'] == []
    assert [row['id'] for row in result['results'] if row['kind'] == 'dataset'] == [
        row[2] for row in sorted(expected)[:search.PER_KIND]]
    assert [(row['name'], row['id']) for row in result['results'] if row['kind'] == 'company'] == sorted(companies)[:search.PER_KIND]
    assert any('WITH names AS MATERIALIZED' in sql for sql in statements)
    page = next(sql for sql in statements if sql.startswith('WITH countries AS'))
    with closing(read_connection(path)) as conn:
        conn.create_function('workspace_measure_match', 4, lambda *args: 1)
        plan = [row['detail'] for row in conn.execute('EXPLAIN QUERY PLAN ' + page)]
    assert any('COVERING INDEX library_browse_saved (entity_type=?)' in step for step in plan), plan
    assert any('SEARCH s USING INTEGER PRIMARY KEY (rowid=?)' in step for step in plan), plan
    # Planning does not cache results: a newly saved earlier row is immediately
    # discoverable, including when it displaces an old first-page result.
    identifier = series(path, entity='fresh', name='A fresh USD country', unit='USD')
    assert next(row for row in find(client, 'USD')['results'] if row['kind'] == 'dataset')['id'] == identifier


def test_held_unsaved_and_invalid_library_identifiers_are_never_published(workspace):
    client, directory = workspace
    path = directory / 'library.sqlite3'
    held = series(path, source='faostat', dataset='TCL', indicator='held', label='Apple held data')
    invalid = series(path, indicator='invalid', label='Apple invalid data')
    unsaved = series(path, indicator='empty', label='Apple empty data')
    with sqlite3.connect(path) as conn:
        conn.execute('UPDATE series SET id=? WHERE id=?', ('https://evil.test/path', invalid))
        conn.execute('UPDATE series SET observation_count=0 WHERE id=?', (unsaved,))
    assert find(client, 'Apple')['results'] == []
    assert held not in json.dumps(find(client, 'held'))


def test_unknown_market_ids_and_arbitrary_urls_are_ignored(workspace):
    client, directory = workspace
    market(directory / 'market.sqlite3', 'stock-XNAS-AAPL', 'stock-FAKE-FAKE',
           'https://example.org/Apple', '../../Apple')
    assert [row['id'] for row in find(client, 'Apple')['results']] == ['stock-XNAS-AAPL']


def test_long_public_titles_remain_discoverable_with_bounded_result_labels(workspace):
    client, directory = workspace
    identifier = series(directory / 'library.sqlite3', name='Australia ' + 'A' * 300,
                        label='Population ' + 'B' * 300, unit='people ' + 'C' * 1000)
    rows = find(client, 'Australia population')['results']
    assert len(rows) == 1
    assert rows[0]['id'] == identifier
    assert len(rows[0]['name']) == 200
    assert len(rows[0]['description']) <= 500


def test_reference_catalog_is_filtered_before_opening_histories(workspace, monkeypatch):
    client, directory = workspace
    definitions = [reference('ecb_eur_cad', 'Euro / Canadian dollar'),
                   reference('australia_inflation', 'Australia inflation', 'PCT', '%')]
    references(monkeypatch, directory / 'references', definitions)
    original = search.global_reference._record
    opened = []

    def record(definition, *args, **kwargs):
        opened.append(definition['id'])
        return original(definition, *args, **kwargs)

    monkeypatch.setattr(search.global_reference, '_record', record)
    assert [row['id'] for row in find(client, 'EUR/CAD')['results']] == ['ecb_eur_cad']
    assert opened == ['ecb_eur_cad']
    assert find(client, 'Australia')['results'][0]['href'] == '/reference/australia_inflation'
    opened.clear()
    assert find(client, 'Not-a-saved-reference')['results'] == []
    assert opened == []
    (directory / 'references' / 'ecb_eur_cad.json').write_text('{invalid')
    assert find(client, 'EUR/CAD')['results'] == []


def test_unavailable_reference_checks_are_bounded(workspace, monkeypatch):
    client, directory = workspace
    definitions = [reference('eur_ref_' + str(index), 'Euro reference') for index in range(100)]
    monkeypatch.setattr(search.global_reference, '_catalogs', lambda **kwargs:
        (definitions, {'sources': []}, {'worldbank': {'economies': []}}))
    opened = []

    def unavailable(definition, *args, **kwargs):
        opened.append(definition['id'])
        return {'available': False}

    monkeypatch.setattr(search.global_reference, '_record', unavailable)
    assert find(client, 'Euro') == {'results': [], 'unavailable': ['reference']}
    assert len(opened) == search.REFERENCE_CHECKS


@pytest.mark.parametrize('query', ['a' * 101, 'Apple\n', '\tApple', 'Ap\x00ple', 'Ap\x7fple'])
def test_invalid_queries_return_json_400_before_source_reads(workspace, monkeypatch, query):
    client, _ = workspace
    monkeypatch.setattr(search, '_market_results', lambda *args: pytest.fail('Invalid input read source'))
    response = client.get('/api/workspace-search', query_string={'q': query})
    assert response.status_code == 400
    assert isinstance(response.get_json()['error'], str)


@pytest.mark.parametrize('query', ['" OR 1=1 --', "'; DROP TABLE series; --", '*:*', 'Apple OR Revenue', '"NEAR('])
def test_query_metacharacters_are_data_not_fts_or_sql_syntax(workspace, query):
    client, directory = workspace
    series(directory / 'library.sqlite3')
    assert find(client, query)['results'] == []
    assert find(client, 'Australia')['results']


def test_corrupt_source_is_reported_without_losing_healthy_groups(workspace):
    client, directory = workspace
    market(directory / 'market.sqlite3', 'stock-XNAS-AAPL')
    (directory / 'library.sqlite3').write_bytes(b'not a SQLite database')
    started = time.monotonic()
    result = find(client, 'Apple')
    assert time.monotonic() - started < 2
    assert [row['kind'] for row in result['results']] == ['stock']
    assert result['unavailable'] == ['company', 'dataset']
    (directory / 'market.sqlite3').write_bytes(b'broken market cache')
    result = find(client, 'Apple')
    assert result['results'] == []
    assert set(result['unavailable']) == {'stock', 'fx', 'company', 'dataset'}


def test_each_group_and_whole_response_are_capped(workspace, monkeypatch):
    client, directory = workspace
    stocks = list(search.CATALOG)[:20]
    market(directory / 'market.sqlite3', *stocks, *['fx-USD-' + quote for quote in
           ('EUR', 'CAD', 'AUD', 'GBP', 'JPY', 'CNY', 'MNT', 'NZD', 'KRW', 'INR')])
    library = directory / 'library.sqlite3'
    for index in range(10):
        series(library, entity=str(index), name='USD country ' + str(index), unit='USD')
        series(library, source='sec', dataset='frames', entity=str(1000 + index),
               name='USD Company ' + str(index), kind='company', unit='USD')
    references(monkeypatch, directory / 'references',
               [reference('usd_ref_' + str(index), 'USD reference ' + str(index)) for index in range(10)])
    rows = find(client, 'USD')['results']
    assert Counter(row['kind'] for row in rows) == {kind: 8 for kind in
                                                  ('stock', 'fx', 'company', 'dataset', 'reference')}
    assert len(rows) == 40
    assert all(set(row) == {'id', 'kind', 'name', 'description', 'href'} for row in rows)


def test_search_never_reads_histories_or_quota_tables_or_mutates_databases(workspace, monkeypatch):
    client, directory = workspace
    market(directory / 'market.sqlite3', 'stock-XNAS-AAPL', 'fx-USD-EUR')
    series(directory / 'library.sqlite3', name='Apple country', unit='USD')
    paths = [directory / 'market.sqlite3', directory / 'library.sqlite3']
    before = {path: (hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns) for path in paths}
    reads = []

    def connect(path):
        conn = read_connection(path)
        if conn is not None:
            def authorize(action, table, column, database, trigger):
                if action == sqlite3.SQLITE_READ:
                    reads.append(table)
                    assert table not in {'observations', 'observation_revisions', 'periods', 'jobs',
                                         'locks', 'reservations', 'rolling_authorizations'}
                return sqlite3.SQLITE_OK
            conn.set_authorizer(authorize)
        return conn

    monkeypatch.setattr(search, 'read_connection', connect)
    monkeypatch.setattr(search.public_library, 'read_connection', connect)
    assert find(client, 'Apple')['results']
    assert find(client, 'USD/EUR')['results']
    assert {'instruments', 'series'}.issubset(reads)
    for path in paths:
        assert (hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns) == before[path]


def test_route_uses_standard_public_rate_limit(workspace):
    from app import create_app

    _, directory = workspace

    class Config:
        TESTING = True
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = True
        RATELIMIT_STORAGE_URI = 'memory://'
        WORKSPACE_ENABLED = False
        JSON_DATA_DIR = str(directory)

    client = create_app(Config).test_client()
    for _ in range(60):
        assert client.get('/api/workspace-search?q=').status_code == 200
    assert client.get('/api/workspace-search?q=').status_code == 429


@pytest.mark.parametrize('query', ['', 'Apple', 'x' * 101])
def test_search_queries_are_not_cached(workspace, query):
    client, _ = workspace
    response = client.get('/api/workspace-search', query_string={'q': query})
    assert response.headers['Cache-Control'] == 'private, no-store'
