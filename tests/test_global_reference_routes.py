"""Cached-only public reference routes, exact values, and path boundaries."""

import json
import re
import sqlite3
from html import unescape

import pytest

from app import create_app
from app import global_reference as gr


@pytest.fixture
def reference_client(tmp_path, monkeypatch):
    directory = tmp_path / 'global-reference'
    directory.mkdir()
    values = {
        'ecb_eur_usd': [{'date': '2026-09-01', 'period': '2026-09-01', 'price': 0},
                        {'date': '2026-10-02', 'period': '2026-10-02', 'price': 1.23456789, 'status': 'A'}],
        'de_hicp_annual_change': [{'date': '2026-07-01', 'period': '2026-07', 'price': 3.1},
                                  {'date': '2026-09-01', 'period': '2026-09', 'price': 3.4, 'status': 'e'}],
        'jp_wb_agriculture_share': [{'date': '2024-01-01', 'period': '2024', 'price': 1.01}],
        'my_diesel_east': [{'date': '2026-10-01', 'period': '2026-10-01', 'price': 2.15}],
    }
    for identifier, history in values.items():
        (directory / (identifier + '.json')).write_text(json.dumps({
            'id': identifier, 'history': history, 'fetched_at': '2026-10-03T00:00:00Z',
            'api_key': 'private-sentinel-never-display', 'name': '<script>private_name</script>'}))
    class Config:
        TESTING = True
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = False
        SECRET_KEY = 'reference-test-only'
        WORKSPACE_ENABLED = False
        JSON_DATA_DIR = str(tmp_path)
    def forbidden(*args, **kwargs):
        raise AssertionError('A public reference route made an outbound request')
    monkeypatch.setattr('requests.sessions.Session.request', forbidden)
    gr._read_json.cache_clear()
    yield create_app(Config).test_client(), directory
    gr._read_json.cache_clear()


def test_reference_list_is_typed_cached_and_country_searchable(reference_client):
    client, _ = reference_client
    response = client.get('/references')
    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert '14 configured references' in body
    assert '4 saved histories' in body
    assert 'No live provider calls' in body
    assert '1.23456789' in body
    assert 'private-sentinel-never-display' not in body
    assert 'private_name' not in body
    filtered = client.get('/references?q=Japan&kind=economic_indicator').get_data(as_text=True)
    assert '1 of 14 configured references' in filtered
    assert '/reference/jp_wb_agriculture_share' in filtered
    assert '/reference/ca_usd_cad' not in filtered


def test_homepage_exposes_saved_country_data_with_accurate_counts(reference_client):
    client, _ = reference_client
    home = client.get('/').get_data(as_text=True)
    assert 'Homepage datasets' in home and 'dataset=countries' in home
    assert '>Country highlights</a>' in home
    country_home = client.get('/?dataset=countries').get_data(as_text=True)
    assert '<h1>Country data</h1>' in country_home
    assert '1 saved histories · 1 economies' in country_home
    assert '1 of 1 saved country histories' in country_home
    assert '/reference/jp_wb_agriculture_share' in country_home
    assert '/reference/ecb_eur_usd' not in country_home
    assert 'private-sentinel-never-display' not in country_home
    assert 'id="index-page-state"' not in country_home


def test_homepage_country_data_has_empty_state_and_separate_commodity_fallback(reference_client):
    client, directory = reference_client
    path = directory / 'jp_wb_agriculture_share.json'
    payload = json.loads(path.read_text())
    payload['history'] = []
    path.write_text(json.dumps(payload))
    body = client.get('/?dataset=countries').get_data(as_text=True)
    assert '0 of 0 saved country histories' in body
    assert 'No matching references' in body
    assert client.get('/').status_code == 200


def test_homepage_country_pagination_retains_dataset_and_filters(reference_client):
    client, directory = reference_client
    entries = seed_bulk_fixture(directory, count=72)
    body = client.get('/?dataset=countries').get_data(as_text=True)
    assert body.count('class="gr-reference-row"') == 30
    assert 'dataset=countries' in body and 'page=2' in body
    next_page = client.get('/?dataset=countries&page=2').get_data(as_text=True)
    assert '31–60 of' in next_page
    assert next_page.count('class="gr-reference-row"') == 30
    indicator = entries[0]['indicator']
    filtered = client.get('/?dataset=countries&indicator=' + indicator).get_data(as_text=True)
    assert 'name="dataset" value="countries"' in filtered
    assert 'name="indicator"' in filtered
    assert client.get('/?dataset=countries&country=NOT_A_COUNTRY').status_code == 400


def test_reference_detail_retains_zero_precision_period_and_flags(reference_client):
    client, _ = reference_client
    body = client.get('/reference/ecb_eur_usd').get_data(as_text=True)
    assert '1.23456789' in body
    assert '<td>0</td>' in body
    assert '2026-09-01' in body
    assert 'Source flag A' in body
    assert 'gr-chart-data' in body
    assert 'Indicative currency reference rates' in body
    assert 'private-sentinel-never-display' not in body


def test_percentage_points_original_annual_period_and_administered_scope(reference_client):
    client, _ = reference_client
    inflation = client.get('/reference/de_hicp_annual_change').get_data(as_text=True)
    assert '+0.3 percentage points' in inflation
    assert '<th scope="row">2026-09</th>' in inflation
    assert 'Source flag e' in inflation
    assert 'not publication dates' in inflation
    annual = client.get('/reference/jp_wb_agriculture_share').get_data(as_text=True)
    assert '<th scope="row">2024</th>' in annual
    fuel = client.get('/reference/my_diesel_east').get_data(as_text=True)
    assert 'MYR / litre' in fuel
    assert 'Sabah' in fuel and 'Sarawak' in fuel and 'Labuan' in fuel
    assert 'Administered retail fuel prices' in fuel


@pytest.mark.parametrize('identifier', ['unknown_series', 'ca_bcpi_bcpi', 'GLOBAL_SECRET', '..', 'secret.json'])
def test_only_allowlisted_noncommodity_ids_have_reference_details(reference_client, identifier):
    client, _ = reference_client
    assert client.get('/reference/' + identifier).status_code == 404


def test_symlinked_and_oversized_snapshot_entries_remain_unavailable(reference_client, tmp_path, monkeypatch):
    client, directory = reference_client
    identifier = 'ecb_eur_gbp'
    target = tmp_path / 'private.json'
    target.write_text(json.dumps({'id': identifier, 'history': [{'date': '2026-10-02', 'price': 99}]}))
    (directory / (identifier + '.json')).symlink_to(target)
    body = client.get('/reference/' + identifier).get_data(as_text=True)
    assert 'No saved observations yet' in body
    assert 'gr-chart-data' not in body
    monkeypatch.setattr(gr, 'MAX_JSON_BYTES', 32)
    assert gr.safe_json(target) is None


def test_symlinked_reference_directory_is_not_followed(reference_client, tmp_path):
    client, directory = reference_client
    alias = tmp_path / 'data-alias'
    alias.mkdir()
    (alias / 'global-reference').symlink_to(directory, target_is_directory=True)
    client.application.config['JSON_DATA_DIR'] = str(alias)
    assert 'No saved observations yet' in client.get('/reference/ecb_eur_usd').get_data(as_text=True)


def test_configured_base_alias_is_accepted_without_following_entry_symlinks(reference_client, tmp_path):
    client, directory = reference_client
    alias = tmp_path / 'configured-alias'
    alias.symlink_to(directory.parent, target_is_directory=True)
    client.application.config['JSON_DATA_DIR'] = str(alias)
    assert '1.23456789' in client.get('/reference/ecb_eur_usd').get_data(as_text=True)


def test_missing_and_invalid_values_never_become_zero_observations(reference_client):
    client, directory = reference_client
    path = directory / 'ecb_eur_usd.json'
    payload = json.loads(path.read_text())
    payload['history'].extend([{'date': '2026-10-03', 'period': '2026-10-03', 'price': None},
                              {'date': '2026-10-04', 'period': '2026-10-04', 'price': True},
                              {'date': '2026-13-01', 'period': '2026-13-01', 'price': 9}])
    path.write_text(json.dumps(payload))
    body = client.get('/reference/ecb_eur_usd').get_data(as_text=True)
    assert '2 saved observations' in body
    assert '<th scope="row">2026-10-03</th>' not in body


def test_source_catalog_pagination_search_economies_and_readiness_are_honest(reference_client):
    client, _ = reference_client
    body = client.get('/sources').get_data(as_text=True)
    assert '31 publishers catalogued' in body and '5 readers implemented' in body
    assert '1498 WDI indicators and 217 economies' in body
    assert '1–30 of 1498' in body
    assert 'Catalogued · Not connected' in body
    assert 'Registration needed' in body and 'Access review' in body
    page = client.get('/sources?page=2').get_data(as_text=True)
    assert '31–60 of 1498' in page
    economy = client.get('/sources?catalog=economies&q=Japan').get_data(as_text=True)
    assert '1 economies matching' in economy
    assert 'JPN · JP' in economy
    indicator = client.get('/sources?q=NV.AGR.TOTL.ZS').get_data(as_text=True)
    assert '1 saved economy histories' in indicator
    providers = client.get('/sources?status=needs_registration').get_data(as_text=True)
    assert 'id="source-ecb"' not in providers


def seed_public_library(client, directory, *, include_worldbank=True, database=None):
    """Small corpus with a WDI history overlapping the legacy Japan fixture."""
    from scripts.public_data_store import LibraryWriter, series_id
    database = database or directory.parent / 'public-library.sqlite3'
    rows = [
        ('worldbank', 'WDI', 'JPN', 'Japan', 'NV.AGR.TOTL.ZS', 'Agriculture share', '%', [('2023', 1.0), ('2024', 1.01)]),
        ('worldbank', 'WDI', 'MNG', 'Mongolia', 'NV.AGR.TOTL.ZS', 'Agriculture share', '%', [('2024', 12.0)]),
        ('worldbank', 'WDI', 'JPN', 'Japan', 'SP.POP.TOTL', 'Population, total', 'people', [('2024', 123_000_000)]),
        ('faostat', 'QCL', 'FAO:141', 'Mongolia', 'QCL:15:5510', 'Wheat — Production', 't', [('2024', 400_000)]),
        ('sec', 'frames', '0000320193', 'Apple Inc.', 'us-gaap:Assets', 'Total assets', 'USD', [('2024-09-30', 364_980_000_000)]),
    ]
    for source, dataset in [('worldbank', 'WDI'), ('faostat', 'QCL'), ('sec', 'frames')]:
        if source == 'worldbank' and not include_worldbank:
            continue
        with LibraryWriter(database, source, dataset, fetched_at='2026-10-07T00:00:00Z') as writer:
            for publisher, group, entity, name, indicator, measure, unit, points in rows:
                if publisher != source or group != dataset:
                    continue
                writer.add_series(dict(id=series_id(source, entity, indicator, unit), source=source,
                    dataset=dataset, entity_id=entity, entity_name=name,
                    entity_type='company' if source == 'sec' else 'country', indicator_id=indicator,
                    indicator_name=measure, unit=unit, frequency='annual',
                    source_url='https://data.worldbank.org/indicator/' + indicator if source == 'worldbank'
                        else 'https://www.fao.org/faostat/en/#data/QCL' if source == 'faostat'
                        else 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces',
                    attribution='Official source test fixture', license='CC BY-4.0' if source != 'sec' else 'Public SEC filings'),
                    [{'period': period, 'value': value} for period, value in points])
    return database


def saved_catalog_link(body, label):
    return unescape(re.search(r'href="([^"]+)">' + re.escape(label), body).group(1))


def test_source_directory_uses_corpus_totals_without_double_counting_legacy(reference_client, monkeypatch):
    client, directory = reference_client
    database = seed_public_library(client, directory)
    queries = []
    original = gr.read_connection

    def traced(path):
        connection = original(path)
        connection.set_trace_callback(queries.append)
        return connection

    def forbidden_legacy(*args, **kwargs):
        raise AssertionError('Broad WDI coverage must not scan or count legacy histories')

    monkeypatch.setattr(gr, 'read_connection', traced)
    monkeypatch.setattr(gr, '_record', forbidden_legacy)
    monkeypatch.setattr(gr, '_bulk_definitions', forbidden_legacy)
    before = database.read_bytes()
    response = client.get('/sources?q=NV.AGR.TOTL.ZS')
    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert '3 saved country histories · 2 economies' in body
    assert 'contains 2 measures and 4 observations' in body
    assert '2 saved economy histories' in body
    assert 'Saved dataset coverage' in body
    assert 'FAOSTAT · Crops and livestock' in body and 'SEC filings · Company financial disclosures' in body
    assert '/data?source=faostat&amp;dataset=QCL' in body
    assert '/companies?source=sec&amp;dataset=frames' in body
    assert '4 saved country histories' not in body  # The overlapping JSON history is not added.
    assert database.read_bytes() == before
    assert all(query.lstrip().upper().startswith(('SELECT ', 'BEGIN')) for query in queries)
    counts = [query for query in queries if 'FROM series ' in query]
    assert len(counts) == 1 and "indicator_id IN ('NV.AGR.TOTL.ZS')" in counts[0]
    assert not any('metadata' in query.lower() or 'FROM observations' in query for query in queries)


def test_source_catalog_corpus_links_open_matching_indicator_and_economy_histories(reference_client):
    client, directory = reference_client
    seed_public_library(client, directory)
    indicator = client.get('/sources?q=NV.AGR.TOTL.ZS').get_data(as_text=True)
    indicator_link = saved_catalog_link(indicator, '2 saved economy histories')
    assert indicator_link == '/data?source=worldbank&indicator=NV.AGR.TOTL.ZS'
    result = client.get(indicator_link)
    assert result.status_code == 200
    assert 'Japan' in result.get_data(as_text=True) and 'Mongolia' in result.get_data(as_text=True)
    economy = client.get('/sources?catalog=economies&q=Japan').get_data(as_text=True)
    economy_link = saved_catalog_link(economy, '2 saved histories')
    assert economy_link == '/data?source=worldbank&entity=JPN'
    result = client.get(economy_link)
    assert result.status_code == 200 and 'Population, total' in result.get_data(as_text=True)
    histories = re.search(r'<ul class="gr-reference-list">(.*?)</ul>', result.get_data(as_text=True), re.S).group(1)
    assert 'Mongolia' not in histories


@pytest.mark.parametrize('url, field, lookup', [
    ('/sources?page=2', 'indicator_id', 'library_indicator_saved (source=? AND dataset=? AND indicator_id=?)'),
    ('/sources?catalog=economies&page=2', 'entity_id', 'library_summary (entity_type=? AND source=? AND entity_id=?)'),
])
def test_source_catalog_only_counts_displayed_page_of_corpus(reference_client, monkeypatch, url, field, lookup):
    client, directory = reference_client
    database = seed_public_library(client, directory)
    statements = []
    original = gr.read_connection

    def traced(path):
        connection = original(path)
        connection.set_trace_callback(statements.append)
        return connection

    monkeypatch.setattr(gr, 'read_connection', traced)
    assert client.get(url).status_code == 200
    query = next(statement for statement in statements if 'FROM series ' in statement)
    page_ids = re.search(field + r' IN \((.*?)\)', query).group(1)
    assert len(re.findall(r"'[^']+'", page_ids)) == gr.PAGE_SIZE
    with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as connection:
        plan = [row[3] for row in connection.execute('EXPLAIN QUERY PLAN ' + query)]
    assert any(lookup in step for step in plan), plan
    assert not any('TEMP B-TREE FOR GROUP BY' in step for step in plan), plan


@pytest.mark.parametrize('state', ['absent', 'empty', 'unavailable'])
def test_source_directory_preserves_legacy_fallback_when_corpus_is_not_ready(reference_client, state):
    client, directory = reference_client
    database = directory.parent / 'public-library.sqlite3'
    if state == 'empty':
        from scripts.public_data_store import SCHEMA
        with sqlite3.connect(database) as connection:
            connection.executescript(SCHEMA)
    elif state == 'unavailable':
        database.write_bytes(b'Invalid SQLite fixture')
    response = client.get('/sources?q=NV.AGR.TOTL.ZS')
    body = response.get_data(as_text=True)
    assert response.status_code == 200
    assert '1 saved country histories · 1 economies' in body
    assert '1 saved economy histories' in body
    assert '/references?indicator=NV.AGR.TOTL.ZS' in body
    assert 'Saved dataset coverage' not in body
    if state == 'absent':
        assert not database.exists()
    if state == 'unavailable':
        assert 'saved data library is temporarily unavailable' in body
        assert database.read_bytes() == b'Invalid SQLite fixture'


def test_source_directory_shows_other_saved_datasets_without_claiming_broad_wdi(reference_client):
    client, directory = reference_client
    seed_public_library(client, directory, include_worldbank=False)
    body = client.get('/sources?q=NV.AGR.TOTL.ZS').get_data(as_text=True)
    assert 'Saved dataset coverage' in body
    assert 'FAOSTAT · Crops and livestock' in body and 'SEC filings · Company financial disclosures' in body
    assert '1 saved country histories · 1 economies' in body
    assert '/references?indicator=NV.AGR.TOTL.ZS' in body


def test_source_directory_reads_configured_library_and_refreshes_dynamic_totals(reference_client):
    client, directory = reference_client
    database = directory.parent / 'configured-library.sqlite3'
    client.application.config['PUBLIC_LIBRARY_DB'] = str(database)
    seed_public_library(client, directory, database=database)
    assert '3 saved country histories · 2 economies' in client.get('/sources').get_data(as_text=True)
    from scripts.public_data_store import LibraryWriter, series_id
    with LibraryWriter(database, 'worldbank', 'WDI', fetched_at='2026-10-08T00:00:00Z') as writer:
        writer.add_series(dict(id=series_id('worldbank', 'MNG', 'SP.POP.TOTL', 'people'),
            source='worldbank', dataset='WDI', entity_id='MNG', entity_name='Mongolia',
            entity_type='country', indicator_id='SP.POP.TOTL', indicator_name='Population, total',
            unit='people', frequency='annual', source_url='https://data.worldbank.org/indicator/SP.POP.TOTL',
            attribution='World Bank fixture', license='CC BY-4.0'), [{'period': '2024', 'value': 3_500_000}])
    body = client.get('/sources?q=SP.POP.TOTL').get_data(as_text=True)
    assert '4 saved country histories · 2 economies' in body and '2 saved economy histories' in body
    assert 'contains 2 measures and 5 observations' in body
    assert not (directory.parent / 'public-library.sqlite3').exists()


@pytest.mark.parametrize('path', ['/references?kind=bad', '/sources?catalog=bad', '/sources?page=-1',
                                  '/sources?page=bad', '/sources?status=active', '/sources?region=Unknown',
                                  '/references?q=' + 'x' * 101])
def test_invalid_filters_are_bounded(reference_client, path):
    client, _ = reference_client
    assert client.get(path).status_code == 400


def test_observation_tables_paginate_without_truncating_chart_history(reference_client):
    client, directory = reference_client
    path = directory / 'jp_wb_agriculture_share.json'
    rows = [{'date': f'{year}-01-01', 'period': str(year), 'price': year / 1000} for year in range(1960, 2026)]
    path.write_text(json.dumps({'id': 'jp_wb_agriculture_share', 'history': rows}))
    body = client.get('/reference/jp_wb_agriculture_share?page=2').get_data(as_text=True)
    table = re.search(r'<tbody>(.*?)</tbody>', body, re.S).group(1)
    assert table.count('<tr>') == 30
    assert '31–60 of 66' in body
    embedded = re.search(r'id="gr-chart-data" type="application/json">(.*?)</script>', body, re.S).group(1)
    assert len(json.loads(embedded)['history']) == 66


def test_snapshot_stat_change_refreshes_cached_values(reference_client):
    client, directory = reference_client
    client.get('/reference/ecb_eur_usd')
    path = directory / 'ecb_eur_usd.json'
    payload = json.loads(path.read_text())
    payload['history'][-1]['price'] = 1.25
    path.write_text(json.dumps(payload))
    assert '<strong>1.25</strong>' in client.get('/reference/ecb_eur_usd').get_data(as_text=True)


def seed_bulk_fixture(directory, count=1001):
    from scripts import global_sources as gs
    config = gs.load_worldbank_bulk()
    snapshot = json.loads((gs.SCRIPT_DIR / 'global_catalog_snapshot.json').read_text())
    aliases = {(row['api_config']['country'], row['api_config']['indicator']): row['id']
               for row in gs.load_series() if row['source_id'] == 'worldbank'}
    entries = []
    for economy in snapshot['worldbank']['economies']:
        for indicator in config['indicators']:
            if len(entries) >= count:
                break
            definition = gs.worldbank_definition(indicator, economy, aliases)
            history = [{'date': '2023-01-01', 'period': '2023', 'price': 0},
                       {'date': '2025-01-01', 'period': '2025', 'price': 1.234567891234,
                        'status': 'e', 'footnote': 'Official source estimate <not html>', 'source_decimal': 2}]
            (directory / (definition['id'] + '.json')).write_text(json.dumps({'id': definition['id'], 'history': history, 'fetched_at': '2026-10-03T00:00:00Z'}))
            entries.append({'id': definition['id'], 'economy_id': economy['id'], 'indicator': indicator['indicator'],
                            'latest': history[-1], 'observation_count': 2, 'checked_on': '2026-10-03'})
    manifest = {'schema_version': 1, 'source_id': 'worldbank', 'source_database': 2, 'series': entries}
    (directory / 'worldbank_manifest.json').write_text(json.dumps(manifest))
    return entries


def test_thousand_saved_histories_are_paged_filtered_and_linked_without_reading_all_files(reference_client, monkeypatch):
    client, directory = reference_client
    entries = seed_bulk_fixture(directory)
    reads = []; original = gr.safe_json
    def observe(path):
        reads.append(str(path)); return original(path)
    monkeypatch.setattr(gr, 'safe_json', observe)
    body = client.get('/references').get_data(as_text=True)
    assert '1,001 nonempty country histories' in body
    assert body.count('class="gr-reference-row"') == 30
    assert '/references?' in body and 'page=2' in body
    # The manifest supplies list summaries; the thousand histories are never
    # opened on a browse request. Only the remaining original series are read.
    assert len([path for path in reads if '/global-reference/' in path and not path.endswith('worldbank_manifest.json')]) <= 14
    filtered = client.get('/references?country=JP&indicator=SP.POP.TOTL').get_data(as_text=True)
    assert filtered.count('class="gr-reference-row"') == 1
    assert '/reference/wb_jpn_population' in filtered
    assert 'Page 1 / 1' in filtered
    page = client.get('/references?page=2').get_data(as_text=True)
    assert '31–60 of' in page
    evidence = client.get('/sources?catalog=economies&q=Japan').get_data(as_text=True)
    assert '6 saved histories' in evidence and 'country=JP' in evidence
    indicator = client.get('/sources?q=SP.POP.TOTL').get_data(as_text=True)
    assert 'saved economy histories' in indicator and 'indicator=SP.POP.TOTL' in indicator


def test_bulk_detail_retains_exact_values_annual_periods_source_notes_and_correct_units(reference_client):
    client, directory = reference_client
    seed_bulk_fixture(directory)
    body = client.get('/reference/wb_jpn_population').get_data(as_text=True)
    assert '1.234567891234' in body and '<td>0</td>' in body
    assert '<th scope="row">2025</th>' in body
    assert 'Official source estimate &lt;not html&gt;' in body
    assert 'CC BY-4.0' in body and 'Indicator license evidence' in body
    assert 'Values are percentages' not in body
    gdp = client.get('/reference/wb_jpn_gdp_constant').get_data(as_text=True)
    assert 'constant 2015 US$' in gdp and 'Values are percentages' not in gdp
    inflation = client.get('/reference/wb_jpn_consumer_inflation').get_data(as_text=True)
    assert 'Values are percentages' in inflation and 'percentage points' in inflation


def test_bulk_manifest_cannot_allow_unknown_ids_aggregate_regions_or_missing_files(reference_client):
    client, directory = reference_client
    entries = seed_bulk_fixture(directory, 1)
    manifest_path = directory / 'worldbank_manifest.json'
    payload = json.loads(manifest_path.read_text())
    payload['series'].extend([{**entries[0], 'id': 'private_file'}, {**entries[0], 'economy_id': 'HIC', 'id': 'wb_hic_population'}])
    (directory / (entries[0]['id'] + '.json')).unlink()  # Temporary test fixture only.
    manifest_path.write_text(json.dumps(payload))
    body = client.get('/references').get_data(as_text=True)
    assert '4 saved histories' in body
    assert client.get('/reference/private_file').status_code == 404
    assert client.get('/reference/wb_hic_population').status_code == 404


@pytest.mark.parametrize('query', ['country=UNKNOWN', 'indicator=UNREVIEWED', 'page=0'])
def test_bulk_browse_filters_are_allowlisted(reference_client, query):
    client, _ = reference_client
    assert client.get('/references?' + query).status_code == 400
