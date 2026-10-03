"""Cached-only public reference routes, exact values, and path boundaries."""

import json
import re

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
    assert '4 saved series' in body
    assert 'No live provider calls' in body
    assert '1.23456789' in body
    assert 'private-sentinel-never-display' not in body
    assert 'private_name' not in body
    filtered = client.get('/references?q=Japan&kind=economic_indicator').get_data(as_text=True)
    assert '1 of 14 configured references' in filtered
    assert '/reference/jp_wb_agriculture_share' in filtered
    assert '/reference/ca_usd_cad' not in filtered


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
    assert '6 configured economy series' in indicator
    providers = client.get('/sources?status=needs_registration').get_data(as_text=True)
    assert 'id="source-ecb"' not in providers


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
