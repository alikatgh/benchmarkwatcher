"""Optional public FX/identity metadata integrates without any provider calls."""

import hashlib
import json
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest

from app import create_app, market_data, workspace_search
from scripts import open_market_store as open_store
from scripts import vendor_data_store as vendor_store


NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
STOCK_ID = 'stock-XNAS-AAPL'
FX_ID = 'fx-ECB-EUR-USD'
QUOTES = ('AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CYP', 'CZK', 'DKK', 'EEK',
          'GBP', 'HKD', 'HRK', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW',
          'LTL', 'LVL', 'MTL', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'ROL',
          'RON', 'RUB', 'SEK', 'SGD', 'SIT', 'SKK', 'THB', 'TRL', 'TRY', 'USD', 'ZAR')


@pytest.fixture
def open_client(tmp_path, monkeypatch):
    class Config:
        TESTING = True
        SECRET_KEY = 'open-market-test-only'
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = False
        WORKSPACE_ENABLED = False
        JSON_DATA_DIR = str(tmp_path)
        MARKET_DATA_ENABLED = True
        MARKET_DATA_DB = str(tmp_path / 'vendor.sqlite3')
        OPEN_MARKET_DATA_ENABLED = True
        OPEN_MARKET_DATA_DB = str(tmp_path / 'open.sqlite3')
        PUBLIC_LIBRARY_DB = str(tmp_path / 'library.sqlite3')

    def forbidden(*args, **kwargs):
        raise AssertionError('A page or search attempted an outbound connection')

    monkeypatch.setattr('requests.sessions.Session.request', forbidden)
    monkeypatch.setattr('socket.create_connection', forbidden)
    monkeypatch.setattr(workspace_search.global_reference, '_catalogs', lambda **kwargs:
                        ([], {'sources': []}, {'worldbank': {'economies': []}}))
    list_fx, read_fx = open_store.list_fx, open_store.read_fx
    monkeypatch.setattr(open_store, 'list_fx', lambda path: list_fx(path, now=NOW))
    monkeypatch.setattr(open_store, 'read_fx', lambda path, identifier: read_fx(path, identifier, now=NOW))
    list_vendor, read_vendor = vendor_store.list_instruments, vendor_store.read_instrument
    monkeypatch.setattr(market_data, 'list_instruments', lambda path, kind: list_vendor(path, kind, now=NOW))
    monkeypatch.setattr(market_data, 'read_instrument', lambda path, identifier:
                        read_vendor(path, identifier, now=NOW))
    client = create_app(Config).test_client()
    return client, tmp_path / 'vendor.sqlite3', tmp_path / 'open.sqlite3'


def seed_vendor(path):
    for provider, identifier, value in (('marketstack', STOCK_ID, 245.12345678),
                                        ('exchangerate_host', 'fx-USD-EUR', .92345678)):
        vendor_store.enroll_provider(path, provider, '2026-10-01T00:00:00Z',
                                    '2026-11-01T00:00:00Z', 90, 0, now=NOW)
        token = vendor_store.begin_job(path, provider, 'fixture', now=NOW)
        reservation = vendor_store.reserve_call(path, token, 'fixture:' + identifier, identifier, now=NOW)
        point = dict(date='2026-10-22', value=value)
        if provider == 'marketstack':
            point['close'] = value
        vendor_store.save_observations(path, token, reservation, {identifier: [point]}, now=NOW)
        vendor_store.finish_job(path, token, now=NOW)


def identity():
    return dict(instrument_id=STOCK_ID, figi='BBG000B9XRY4', composite_figi='BBG000B9XRY4',
                share_class_figi='BBG001S5N8V8', ticker='AAPL', name='APPLE INC',
                exchange_code='US', market_sector='Equity', security_type='Common Stock',
                matched_mic='', last_success=NOW.isoformat())


def seed_open(path, quotes=('USD',), dates=('2026-10-21', '2026-10-22'), identities=None):
    """Use the production writer; no fixture bypasses the public reader schema."""
    open_store.initialize(path)
    token = open_store.claim_job(path, now=NOW)
    if dates:
        open_store.begin_provider(path, token, 'frankfurter_ecb', now=NOW)
        metadata = dict(start_date=dates[0], end_date=dates[-1], currencies=list(quotes))
        start, end, _ = open_store.prepare_fx(path, token, metadata, now=NOW)
        for first, last in open_store.year_chunks(start, end):
            points = [dict(quote=quote, date=when, value=1.1 + index / 100000)
                      for index, when in enumerate(dates) if first <= when <= last for quote in quotes]
            open_store.stage_fx_chunk(path, token, first, last, points, now=NOW)
        open_store.publish_fx(path, token, now=NOW)
    if identities:
        open_store.begin_provider(path, token, 'openfigi', now=NOW)
        open_store.publish_identities(path, token, identities, now=NOW)
    open_store.release_job(path, token)


def search(client, query):
    response = client.get('/api/workspace-search', query_string={'q': query})
    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'private, no-store'
    return response.get_json()


@pytest.mark.parametrize('enabled', [False, None, 'true', '1', 1])
def test_optional_flag_is_literal_and_precedes_path_resolution(open_client, monkeypatch, enabled):
    client, vendor, optional = open_client
    seed_vendor(vendor)
    client.application.config['OPEN_MARKET_DATA_ENABLED'] = enabled

    def forbidden(*args):
        raise AssertionError('Disabled optional cache was resolved or read')

    monkeypatch.setattr(market_data, 'open_database_path', forbidden)
    for name in ('list_fx', 'read_fx', 'list_identities', 'read_identity'):
        monkeypatch.setattr(open_store, name, forbidden)
    assert client.get('/exchange-rates').status_code == 200
    assert client.get('/stocks/' + STOCK_ID).status_code == 200
    assert client.get('/exchange-rates/' + FX_ID).status_code == 404
    assert search(client, 'Apple')['results'][0]['id'] == STOCK_ID
    assert not optional.exists()


@pytest.mark.parametrize('enabled', [False, None, '1', 1])
def test_market_flag_still_gates_optional_pages_and_search(open_client, monkeypatch, enabled):
    client, _, _ = open_client
    client.application.config['MARKET_DATA_ENABLED'] = enabled
    monkeypatch.setattr(market_data, 'open_database_path', lambda: pytest.fail('Disabled path resolved'))
    assert client.get('/exchange-rates').status_code == 404
    assert client.get('/exchange-rates/' + FX_ID).status_code == 404
    assert search(client, 'EUR/USD') == {'results': [], 'unavailable': []}


def test_optional_path_defaults_and_missing_cache_preserve_old_behavior(open_client):
    client, vendor, optional = open_client
    seed_vendor(vendor)
    client.application.config.pop('OPEN_MARKET_DATA_DB')
    with client.application.app_context():
        default = market_data.open_database_path()
        assert default == optional.parent / 'open-market-data.sqlite3'
    before = set(optional.parent.iterdir())
    assert 'exchangerate.host' in client.get('/exchange-rates').get_data(as_text=True)
    assert 'Security identity' not in client.get('/stocks/' + STOCK_ID).get_data(as_text=True)
    assert search(client, 'Apple')['unavailable'] == []
    assert set(optional.parent.iterdir()) == before
    assert not default.exists()


def test_fx_sources_stay_distinct_with_orientation_coverage_and_credits(open_client):
    client, vendor, optional = open_client
    seed_vendor(vendor)
    seed_open(optional)
    before = (hashlib.sha256(optional.read_bytes()).hexdigest(), optional.stat().st_mtime_ns)
    body = client.get('/exchange-rates').get_data(as_text=True)
    assert '/exchange-rates/fx-USD-EUR' in body and '/exchange-rates/' + FX_ID in body
    assert 'USD per 1 EUR' in body and 'EUR per 1 USD' in body
    assert 'European Central Bank via Frankfurter' in body and 'exchangerate.host' in body
    assert 'Complete source history' in body and '2026-10-21 — 2026-10-22' in body
    assert 'https://frankfurter.dev/' in body and 'European Central Bank ↗' in body
    only_free = client.get('/exchange-rates?source=frankfurter_ecb').get_data(as_text=True)
    assert '/exchange-rates/' + FX_ID in only_free
    assert '/exchange-rates/fx-USD-EUR' not in only_free
    only_vendor = client.get('/exchange-rates?source=exchangerate_host').get_data(as_text=True)
    assert '/exchange-rates/fx-USD-EUR' in only_vendor
    assert '/exchange-rates/' + FX_ID not in only_vendor
    detail = client.get('/exchange-rates/' + FX_ID).get_data(as_text=True)
    assert 'USD per 1 EUR' in detail and 'EUR per 1 USD' not in detail
    assert 'Source retrieval range 2026-10-21 — 2026-10-22' in detail
    assert 'Frankfurter data service ↗' in detail and 'European Central Bank source ↗' in detail
    assert before == (hashlib.sha256(optional.read_bytes()).hexdigest(), optional.stat().st_mtime_ns)
    assert not list(optional.parent.glob('*-journal'))
    assert client.get('/exchange-rates?source=https://example.org').status_code == 400


def test_fx_source_and_query_survive_list_pagination(open_client):
    client, _, optional = open_client
    seed_open(optional, quotes=QUOTES)
    body = client.get('/exchange-rates?q=EUR&source=frankfurter_ecb').get_data(as_text=True)
    assert 'Page 1 / 2' in body and '1–30 of 41' in body
    assert 'page=2' in body and 'q=EUR' in body and 'source=frankfurter_ecb' in body
    last = client.get('/exchange-rates?q=EUR&source=frankfurter_ecb&page=2').get_data(as_text=True)
    assert 'Page 2 / 2' in last and '31–41 of 41' in last


def test_full_7000_point_history_is_kept_with_50_row_observation_pages(open_client):
    client, _, optional = open_client
    first = date(1999, 1, 4)
    dates = [(first + timedelta(days=index)).isoformat() for index in range(7000)]
    seed_open(optional, dates=dates)
    response = client.get('/exchange-rates/' + FX_ID + '?page=2')
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    payload = re.search(r'<script id="gr-chart-data" type="application/json">(.*?)</script>', body).group(1)
    chart = json.loads(payload)
    assert len(chart['history']) == 7000
    assert chart['history'][0]['date'] == dates[0] and chart['history'][-1]['date'] == dates[-1]
    assert chart['allowExport'] is False and chart['unit'] == 'USD per 1 EUR'
    assert len(payload) < 1_000_000
    assert body.count('<th scope="row">') == 50
    assert '51–100 of 7000' in body and 'Page 2 / 140' in body


def test_stock_identity_is_attributed_escaped_and_keeps_prices_separate(open_client):
    client, vendor, optional = open_client
    seed_vendor(vendor)
    row = identity()
    row['name'] = 'APPLE <script>alert("identity")</script>'
    seed_open(optional, identities=[row])
    body = client.get('/stocks/' + STOCK_ID).get_data(as_text=True)
    for label in ('Security identity · OpenFIGI', 'US composite FIGI', 'Share-class FIGI',
                  'Catalogue MIC', 'Security type', 'Retrieved', 'OpenFIGI by Bloomberg'):
        assert label in body
    assert 'BBG001S5N8V8' in body and 'XNAS' in body and 'Common Stock' in body
    assert '2026-10-23 12:00:00 UTC' in body
    assert 'APPLE &lt;script&gt;alert(&#34;identity&#34;)&lt;/script&gt;' in body
    assert '<script>alert(' not in body
    assert '<td>245.12345678</td>' in body and 'Marketstack' in body
    assert 'https://www.openfigi.com/' in body


def test_corrupt_optional_cache_preserves_existing_lists_details_and_search(open_client):
    client, vendor, optional = open_client
    seed_vendor(vendor)
    optional.write_bytes(b'broken SQLite: private-diagnostic-sentinel')
    before = optional.read_bytes()
    for route in ('/exchange-rates', '/stocks/' + STOCK_ID, '/exchange-rates/fx-USD-EUR'):
        response = client.get(route)
        assert response.status_code == 200
        body = response.get_data(as_text=True)
        if route != '/exchange-rates/fx-USD-EUR':
            assert 'temporarily unavailable' in body
        assert 'private-diagnostic-sentinel' not in body and str(optional) not in body
    result = search(client, 'Apple')
    assert result['results'][0]['id'] == STOCK_ID
    assert set(result['unavailable']) == {'stock', 'fx'}
    assert client.get('/exchange-rates/' + FX_ID).status_code == 503
    assert optional.read_bytes() == before


@pytest.mark.parametrize('query', ['BBG000B9XRY4', 'bbg001s5n8v8', 'APPLE INC'])
def test_figi_and_identity_names_find_only_existing_saved_stocks(open_client, query):
    client, vendor, optional = open_client
    seed_vendor(vendor)
    seed_open(optional, identities=[identity()])
    result = search(client, query)
    assert result['unavailable'] == []
    assert result['results'] == [dict(id=STOCK_ID, kind='stock', name='Apple',
        description='AAPL · USD per share', href='/stocks/' + STOCK_ID)]
    vendor.unlink()  # Synthetic fixture: identity metadata alone must not imply a price history.
    assert search(client, query)['results'] == []


def test_free_fx_search_preserves_orientation_prioritizes_exact_pair_and_caps_group(open_client):
    client, vendor, optional = open_client
    seed_vendor(vendor)
    seed_open(optional, quotes=QUOTES)
    result = search(client, 'EUR/USD')
    assert result['results'][0] == dict(id=FX_ID, kind='fx', name='EUR/USD',
        description='USD per 1 EUR · ECB via Frankfurter', href='/exchange-rates/' + FX_ID)
    assert result['results'][1]['id'] == 'fx-USD-EUR'
    assert result['results'][1]['description'] == 'EUR per 1 USD'
    assert len([row for row in search(client, 'EUR')['results'] if row['kind'] == 'fx']) == 8
    assert all(row['href'].startswith('/') and not row['href'].startswith('//')
               for row in search(client, 'EUR')['results'])


def test_partial_or_mismatched_history_never_claims_complete_coverage(open_client, monkeypatch):
    client, _, optional = open_client
    seed_open(optional)
    with client.application.app_context():
        raw = open_store.read_fx(optional, FX_ID)
    raw['observations'].pop()
    monkeypatch.setattr(open_store, 'read_fx', lambda *args: raw)
    body = client.get('/exchange-rates/' + FX_ID).get_data(as_text=True)
    assert 'Partial saved history' in body and 'Complete source history' not in body
    raw['observations'] = []
    body = client.get('/exchange-rates/' + FX_ID).get_data(as_text=True)
    assert 'No saved observations yet' in body and 'Complete source history' not in body


def test_archived_status_requires_explicit_metadata_and_reports_final_coverage(open_client, monkeypatch):
    client, _, optional = open_client
    seed_open(optional)
    with client.application.app_context():
        raw = open_store.read_fx(optional, FX_ID)
    raw.update(archived=True, stale=True)
    monkeypatch.setattr(open_store, 'read_fx', lambda *args: raw)
    body = client.get('/exchange-rates/' + FX_ID).get_data(as_text=True)
    assert 'Archived currency' in body and 'Final source observation saved' in body
    assert 'Refresh delayed' not in body


def test_private_optional_metadata_and_unreviewed_identity_ids_are_not_searchable(open_client, monkeypatch):
    client, vendor, optional = open_client
    seed_vendor(vendor)
    seed_open(optional, identities=[identity()])
    original = open_store.list_identities

    def identities(path):
        rows = original(path)
        rows[STOCK_ID]['private_notes'] = 'private-note-sentinel'
        rows['stock-FAKE-FAKE'] = dict(rows[STOCK_ID], name='Unreviewed identity')
        return rows

    monkeypatch.setattr(open_store, 'list_identities', identities)
    assert search(client, 'private-note-sentinel')['results'] == []
    assert search(client, 'Unreviewed identity')['results'] == []
    assert 'private-note-sentinel' not in json.dumps(search(client, 'BBG000B9XRY4'))


def test_optional_search_reads_metadata_only(open_client, monkeypatch):
    client, vendor, optional = open_client
    seed_vendor(vendor)
    seed_open(optional, identities=[identity()])
    original = open_store._connect
    reads = []

    def connect(*args, **kwargs):
        connection = original(*args, **kwargs)

        def authorize(action, table, column, database, trigger):
            if action == sqlite3.SQLITE_READ:
                reads.append(table)
                assert table not in {'observations', 'staging', 'providers', 'job_lock', 'chunks'}
            return sqlite3.SQLITE_OK

        connection.set_authorizer(authorize)
        return connection

    monkeypatch.setattr(open_store, '_connect', connect)
    assert search(client, 'EUR')['results']
    assert search(client, 'BBG000B9XRY4')['results']
    assert {'fx', 'identities'}.issubset(reads)
