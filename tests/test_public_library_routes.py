from contextlib import closing
import json
import sqlite3
from unittest.mock import patch

import pytest

from scripts.public_data_store import LibraryWriter, read_connection, series_id


def seed(path, source='worldbank', entity='MNG', name='Mongolia', indicator='SP.POP.TOTL', label='Population'):
    definition = dict(id=series_id(source, entity, indicator, 'people' if source=='worldbank' else 'USD'),
                      source=source, dataset='WDI' if source=='worldbank' else 'frames', entity_id=entity,
                      entity_name=name, entity_type='country' if source=='worldbank' else 'company',
                      indicator_id=indicator, indicator_name=label, unit='people' if source=='worldbank' else 'USD',
                      frequency='annual', source_url='https://data.worldbank.org/indicator/SP.POP.TOTL',
                      attribution='Original source', license='CC BY-4.0', metadata={'definition': 'Details ' * 300})
    with LibraryWriter(path,source,definition['dataset']) as writer:
        writer.add_series(definition,[{'period':'2023','value':0}, {'period':'2024','value':3.14159265359,'metadata':{'flag':'E'}}])
    return definition['id']


@pytest.fixture
def library(app_client,tmp_path):
    path = tmp_path/'public.sqlite3'
    app_client.application.config['PUBLIC_LIBRARY_DB'] = str(path)
    identifier = seed(path)
    seed(path,'sec','320193','Apple Inc.','us-gaap:Assets','Total assets')
    return app_client,path,identifier


def test_empty_library_and_missing_record(app_client,tmp_path):
    path = tmp_path/'not-created.sqlite3'
    app_client.application.config['PUBLIC_LIBRARY_DB'] = str(path)
    assert app_client.get('/data').status_code==200
    assert b'not been populated' in app_client.get('/data').data
    assert app_client.get('/data/worldbank_'+'a'*32).status_code==404
    assert not path.exists()


def test_search_detail_csv_are_cache_only_and_preserve_values(library):
    client,path,identifier=library
    with patch('requests.get',side_effect=AssertionError('Public browsing must not fetch sources')):
        response=client.get('/data?q=Mongolia+population')
        assert response.status_code==200
        assert identifier.encode() in response.data
        assert b'Apple Inc.' not in response.data
        detail=client.get('/data/'+identifier)
        assert detail.status_code==200
        assert b'3.14159265359' in detail.data
        assert b'Original source' in detail.data
        assert b'Source notes' in detail.data
        exported=client.get('/data/'+identifier+'.csv')
        assert exported.status_code==200
        assert b'2023,0.0,people' in exported.data
        assert b'3.14159265359' in exported.data
        assert b'Original source' in exported.data and b'CC BY-4.0' in exported.data
        assert b'series_metadata' in exported.data and b'Details' in exported.data
        assert 'attachment' in exported.headers['Content-Disposition']


def test_company_directory_groups_and_links_to_measures(library):
    client,path,_=library
    assert b'Apple Inc.' in client.get('/companies').data
    company=client.get('/companies/320193')
    assert company.status_code==200
    assert b'Total assets' in company.data
    assert b'calendar frames' in company.data
    assert b'Apple Inc.' in client.get('/companies?q=Assets').data
    assert client.get('/companies/99999999').status_code==404


@pytest.mark.parametrize('url', ['/companies/320193', '/companies/320193?q=assets',
                                 '/companies/320193?dataset=frames',
                                 '/data?source=worldbank&entity=MNG'])
def test_entity_listing_uses_selective_index(library, url):
    client, path, _ = library
    seed(path, entity='320193', name='Country entry', label='Country-only measure')
    statements = []

    def traced_connection(database):
        conn = read_connection(database)
        conn.set_trace_callback(statements.append)
        return conn

    with patch('app.public_library.read_connection', side_effect=traced_connection):
        response = client.get(url)
    assert response.status_code == 200
    if url.startswith('/companies/'):
        assert b'Total assets' in response.data
        assert b'Country-only measure' not in response.data
    queries = [sql for sql in statements if sql.startswith(('WITH page AS',
                                                           'SELECT COUNT(*) FROM series s'))]
    assert len(queries) == 2
    with closing(read_connection(path)) as conn:
        for query in queries:
            plan = [row['detail'] for row in conn.execute('EXPLAIN QUERY PLAN ' + query)]
            if '?q=' in url:
                assert any('SEARCH s USING INTEGER PRIMARY KEY (rowid=?)' in step for step in plan), plan
            elif query.startswith('SELECT COUNT(*)'):
                assert any('COVERING INDEX library_summary (entity_type=? AND source=? AND entity_id=?)'
                           in step for step in plan), plan
            else:
                assert any('COVERING INDEX library_browse_saved (entity_type=? AND entity_name=?)'
                           in step for step in plan), plan


@pytest.mark.parametrize('url, total', [('/data', 3),
                                       ('/data?source=worldbank&dataset=WDI', 3),
                                       ('/data?indicator=SP.POP.TOTL', 2),
                                       ('/companies', 2)])
def test_broad_listings_use_covering_indexes(library, url, total):
    from app.public_library import render_template

    client, path, _ = library
    seed(path, entity='USA', name='United States')
    seed(path, entity='USA', name='United States', indicator='INCOME', label='Income')
    seed(path, 'sec', '320193', 'Apple Inc.', 'us-gaap:Revenues', 'Revenue')
    seed(path, 'sec', '9000', 'Baker Inc.', 'us-gaap:Assets', 'Total assets')
    statements, rendered = [], []

    def traced_connection(database):
        conn = read_connection(database)
        conn.set_trace_callback(statements.append)
        return conn

    def capture(template, **context):
        rendered.append(context)
        return render_template(template, **context)

    with patch('app.public_library.read_connection', side_effect=traced_connection), \
         patch('app.public_library.render_template', side_effect=capture):
        response = client.get(url)
    assert response.status_code == 200
    assert rendered[0]['pagination']['total'] == total
    assert len(rendered[0]['records']) == total
    queries = [sql for sql in statements if 'FROM series s' in sql]
    assert len(queries) == 2
    with closing(read_connection(path)) as conn:
        for query in queries:
            plan = [row['detail'] for row in conn.execute('EXPLAIN QUERY PLAN ' + query)]
            if query.startswith('WITH page AS'):
                assert any('COVERING INDEX library_browse_saved' in step for step in plan), plan
                assert any('SEARCH s USING INTEGER PRIMARY KEY (rowid=?)' in step for step in plan), plan
            elif query.startswith('SELECT COUNT(*)'):
                assert any('library_indicator_saved' in step for step in plan), plan
                ops = conn.execute('EXPLAIN ' + query).fetchall()
                assert not any(row[1] == 'Column' and row[2] == 0 for row in ops)
            else:
                assert any('COVERING INDEX library_summary' in step for step in plan), plan


@pytest.mark.parametrize('url, total', [
    ('/data?source=faostat&dataset=TCL&q=Mongolia+wheat', 2),
    ('/data?q=Mongolia+wheat', 3),
    ('/data?q=Mongolia+population', 1),
    ('/companies?q=assets', 2),
])
def test_search_reads_matching_fts_rowids(library, url, total):
    from app.public_library import render_template

    client, path, _ = library
    seed(path, 'sec', '9000', 'Baker Inc.', 'us-gaap:Assets', 'Total assets')
    seed(path, entity='320193', name='Country entry', label='Total assets')
    for dataset, indicators in [('TCL', ['TCL:15:5610', 'TCL:15:5910']), ('QCL', ['QCL:15:5510'])]:
        with LibraryWriter(path, 'faostat', dataset) as writer:
            for indicator in indicators:
                writer.add_series(dict(id=series_id('faostat', 'FAO:141', indicator, 't'), source='faostat',
                    dataset=dataset, entity_id='FAO:141', entity_name='Mongolia', entity_type='country',
                    indicator_id=indicator, indicator_name='Wheat ' + indicator, unit='t', frequency='annual',
                    source_url='https://www.fao.org/faostat/en/#data/' + dataset,
                    attribution='FAOSTAT fixture', license='CC BY-4.0'), [{'period': '2024', 'value': 10}])
    statements, rendered = [], []

    def traced_connection(database):
        conn = read_connection(database)
        conn.set_trace_callback(statements.append)
        return conn

    def capture(template, **context):
        rendered.append(context)
        return render_template(template, **context)

    with patch('app.public_library.read_connection', side_effect=traced_connection), \
         patch('app.public_library.render_template', side_effect=capture):
        response = client.get(url)
    assert response.status_code == 200
    assert rendered[0]['pagination']['total'] == total
    assert len(rendered[0]['records']) == total
    if 'dataset=TCL' in url:
        assert all(row['source'] == 'faostat' and row['dataset'] == 'TCL' and row['unit'] == 't'
                   for row in rendered[0]['records'])
    if url.startswith('/companies'):
        assert [row['entity_name'] for row in rendered[0]['records']] == ['Apple Inc.', 'Baker Inc.']
    queries = [sql for sql in statements if 'FROM series s' in sql]
    assert len(queries) == 2
    with closing(read_connection(path)) as conn:
        for query in queries:
            plan = [row['detail'] for row in conn.execute('EXPLAIN QUERY PLAN ' + query)]
            assert any('SEARCH s USING INTEGER PRIMARY KEY (rowid=?)' in step for step in plan), plan


@pytest.mark.parametrize('company', [False, True])
def test_broad_listings_keep_order_and_clamp_pagination(library, company):
    from app.public_library import render_template

    client, path, _ = library
    names = ['Apple Inc.' if company else 'Mongolia']
    for index in range(45):
        name = ('Company ' if company else 'Country ') + f'{index:03d}'
        seed(path, 'sec' if company else 'worldbank', f'{1000000000+index}' if company else f'C{index}', name)
        names.append(name)
    names.sort()
    rendered = []

    def capture(template, **context):
        rendered.append(context)
        return render_template(template, **context)

    with patch('app.public_library.render_template', side_effect=capture):
        for page in (1, 2, 25000):
            assert client.get(('/companies' if company else '/data') + f'?page={page}').status_code == 200
    for context, page in zip(rendered, (1, 2, 2)):
        assert context['pagination']['total'] == 46
        assert context['pagination']['page'] == page
        assert [row['entity_name'] for row in context['records']] == names[(page-1)*40:page*40]


@pytest.mark.parametrize('url, total', [
    ('/data?q=population', 46), ('/data?q=a', 45),
    ('/data?indicator=SP.POP.TOTL', 46),
    ('/data?source=worldbank&dataset=WDI&indicator=SP.POP.TOTL', 46),
    ('/data?source=worldbank&entity=MNG&indicator=SP.POP.TOTL&q=population', 1),
])
def test_large_search_and_filter_only_fetch_final_page_records(library, url, total):
    from app.public_library import render_template

    client, path, _ = library
    for index in range(45):
        seed(path, entity=f'P{index}', name=f'A country {index:03d}')
    statements, rendered = [], []

    def traced_connection(database):
        conn = read_connection(database)
        conn.set_trace_callback(statements.append)
        return conn

    def capture(template, **context):
        rendered.append(context)
        return render_template(template, **context)

    with patch('app.public_library.read_connection', side_effect=traced_connection), \
         patch('app.public_library.render_template', side_effect=capture):
        assert client.get(url + '&page=2').status_code == 200
    context = rendered[0]
    assert context['pagination']['total'] == total
    assert len(context['records']) == (total-40 if total>40 else total)
    assert all(row['source'] == 'worldbank' and row['unit'] == 'people' for row in context['records'])
    query = next(sql for sql in statements if sql.startswith('SELECT COUNT(*) FROM series s'))
    page = next((sql for sql in statements if sql.startswith('WITH page AS')), None)
    with closing(read_connection(path)) as conn:
        plan = [row['detail'] for row in conn.execute('EXPLAIN QUERY PLAN ' + query)]
        if 'entity=MNG' in url:
            assert any('COVERING INDEX library_summary' in step for step in plan), plan
        else:
            assert any('library_indicator_saved' in step for step in plan), plan
            ops = conn.execute('EXPLAIN ' + query).fetchall()
            assert not any(row[1] == 'Column' and row[2] == 0 for row in ops)
        assert page is not None
        plan = [row['detail'] for row in conn.execute('EXPLAIN QUERY PLAN ' + page)]
        assert any('MATERIALIZE page' in step or 'CO-ROUTINE page' in step for step in plan), plan
        assert any('COVERING INDEX library_browse_saved' in step for step in plan), plan
        assert any('SEARCH s USING INTEGER PRIMARY KEY (rowid=?)' in step for step in plan), plan


def test_detail_keeps_one_snapshot_during_dataset_refresh(library):
    from app.public_library import _detail

    client, path, identifier = library
    refreshed = []

    def interleaved_connection(database):
        conn = read_connection(database)

        class InterleavedConnection:
            def __getattr__(self, name):
                return getattr(conn, name)

            def execute(self, sql, parameters=()):
                if sql.startswith('SELECT * FROM observations') and not refreshed:
                    with closing(sqlite3.connect(path)) as writer, writer:
                        writer.execute('INSERT INTO observations SELECT series_id,?,?,?,?,checked_at '
                                       'FROM observations WHERE series_id=? AND period=?',
                                       ('2025', 9, '{}', 'https://data.worldbank.org/indicator/SP.POP.TOTL',
                                        identifier, '2024'))
                        writer.execute('UPDATE series SET observation_count=3,last_period=?,last_value=9,metadata=? WHERE id=?',
                                       ('2025', json.dumps({'definition': 'After refresh'}), identifier))
                    refreshed.append(True)
                return conn.execute(sql, parameters)

        return InterleavedConnection()

    with patch('app.public_library.read_connection', side_effect=interleaved_connection), \
         client.application.test_request_context():
        record = _detail(identifier)
    assert refreshed
    assert record['observation_count'] == len(record['history']) == 2
    assert record['last_period'] == record['history'][-1]['period'] == '2024'
    assert record['metadata']['definition'].startswith('Details ')
    with closing(read_connection(path)) as conn:
        assert conn.execute('SELECT observation_count FROM series WHERE id=?', (identifier,)).fetchone()[0] == 3


def test_dataset_search_keeps_publisher_and_offers_clear(library):
    response = library[0].get('/data?source=worldbank&dataset=WDI')
    assert response.status_code == 200
    assert b'type="hidden" name="source" value="worldbank"' in response.data
    assert b'<select name="source"' not in response.data
    assert b'>Clear</a>' in response.data


def test_source_decimal_text_survives_table_and_export(library):
    client,path,identifier=library
    import sqlite3,json
    precise='3141592653589793.2384626433832795'
    with sqlite3.connect(path) as conn:
        conn.execute('UPDATE observations SET metadata=? WHERE series_id=? AND period=?',
                     (json.dumps({'source_value':precise}),identifier,'2024'))
    assert precise.encode() in client.get('/data/'+identifier).data
    assert precise.encode() in client.get('/data/'+identifier+'.csv').data


@pytest.mark.parametrize('url',['/data?page=0','/data?page=-1','/data?page=NaN','/data?source=unknown',
                              '/data?dataset=missing&source=worldbank','/data?q='+'x'*121])
def test_invalid_filters_rejected(library,url):
    assert library[0].get(url).status_code==400


def test_html_escaped_and_fts_syntax_not_executable(library):
    client,path,_=library
    identifier=seed(path,entity='TEST',name='<script>evil()</script>')
    response=client.get('/data/'+identifier)
    assert b'<script>evil()</script>' not in response.data
    assert b'&lt;script&gt;evil()&lt;/script&gt;' in response.data
    assert client.get('/data?q=%22+OR+NOT+*').status_code==200
    assert b'No matching data' in client.get('/data?q=NoSuchCountry').data
