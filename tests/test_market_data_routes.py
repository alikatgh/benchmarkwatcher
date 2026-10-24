"""Public market histories are opt-in and read only their standalone cache."""

import json
import re
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import pytest

from app import create_app
from app import market_data
from scripts import vendor_data_store as store


NOW = datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def market_client(tmp_path, monkeypatch):
    database = tmp_path / 'vendor-market-data.sqlite3'
    attempted = []

    def forbidden(*args, **kwargs):
        attempted.append(True)
        raise AssertionError('Public browsing attempted an outbound request')

    monkeypatch.setattr('requests.sessions.Session.request', forbidden)
    for method in ('request', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options'):
        monkeypatch.setattr('requests.' + method, forbidden)
    monkeypatch.setattr(market_data, 'list_instruments',
                        lambda path, kind: store.list_instruments(path, kind, now=NOW))
    monkeypatch.setattr(market_data, 'read_instrument',
                        lambda path, identifier: store.read_instrument(path, identifier, now=NOW))

    class Config:
        TESTING = True
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = False
        SECRET_KEY = 'market-test-only'
        WORKSPACE_ENABLED = False
        JSON_DATA_DIR = str(tmp_path)
        MARKET_DATA_ENABLED = True
        MARKET_DATA_DB = str(database)

    app = create_app(Config)
    yield app.test_client(), database, attempted
    assert attempted == []


def seed_cache(database):
    """Exercise the production writer against a synthetic, standalone database."""
    for provider, identifier, points, refresh_days in (
        ('marketstack', 'stock-XNAS-AAPL', [
            {'date': '2026-10-21', 'value': 245.12345678, 'close': 245.12345678},
            {'date': '2026-10-22', 'value': 246.5, 'close': 246.5}], 7),
        ('exchangerate_host', 'fx-USD-EUR', [
            {'date': '2026-10-21', 'value': 0.91234567},
            {'date': '2026-10-22', 'value': 0.92345678}], 1),
    ):
        store.enroll_provider(database, provider, '2026-10-01T00:00:00Z',
                              '2026-11-01T00:00:00Z', 90, 0, now=NOW)
        token = store.begin_job(database, provider, 'fixture', now=NOW)
        reservation = store.reserve_call(database, token, 'fixture:' + identifier, identifier, now=NOW)
        store.save_observations(database, token, reservation, {identifier: points},
                                now=NOW, refresh_days=refresh_days)
        store.finish_job(database, token, now=NOW)


@pytest.mark.parametrize('enabled', [False, None, 'false', '1'])
def test_unactivated_routes_return_404_without_reading_cache(market_client, monkeypatch, enabled):
    client, database, _ = market_client
    client.application.config['MARKET_DATA_ENABLED'] = enabled

    def forbidden_read(*args):
        raise AssertionError('Disabled routes read market data')

    monkeypatch.setattr(market_data, 'list_instruments', forbidden_read)
    monkeypatch.setattr(market_data, 'read_instrument', forbidden_read)
    for path in ('/stocks', '/stocks/stock-XNAS-AAPL', '/exchange-rates', '/exchange-rates/fx-USD-EUR'):
        assert client.get(path).status_code == 404
    assert not database.exists()


def test_empty_pages_are_useful_and_never_create_a_database(market_client):
    client, database, _ = market_client
    before = {path.name for path in database.parent.iterdir()}
    for _ in range(3):
        for path, heading in (('/stocks', 'No saved stock histories yet'),
                              ('/exchange-rates', 'No saved exchange-rate histories yet')):
            response = client.get(path)
            assert response.status_code == 200
            body = response.get_data(as_text=True)
            assert heading in body
            if path == '/exchange-rates':
                assert 'Official currency references' in body
            assert 'first successful refresh' in body
        assert client.get('/stocks/stock-XNAS-AAPL').status_code == 404
        assert client.get('/exchange-rates/fx-USD-EUR').status_code == 404
    assert not database.exists()
    assert {path.name for path in database.parent.iterdir()} == before


def test_cached_lists_and_details_show_source_dates_units_and_manual_updates(market_client):
    client, database, _ = market_client
    seed_cache(database)
    before = database.read_bytes()
    before_mtime = database.stat().st_mtime_ns
    for _ in range(3):
        stocks = client.get('/stocks').get_data(as_text=True)
        assert 'Apple' in stocks and '/stocks/stock-XNAS-AAPL' in stocks
        assert 'Marketstack' in stocks
        assert 'USD per share' in stocks
        assert 'Observation 2026-10-22' in stocks
        assert 'Manual updates' in stocks
        assert '2026-10-23 12:00:00 UTC' in stocks
        assert 'fx-USD-EUR' not in stocks
        fx = client.get('/exchange-rates').get_data(as_text=True)
        assert 'USD/EUR' in fx and 'EUR per 1 USD' in fx
        assert 'exchangerate.host' in fx and 'Manual updates' in fx
        assert 'stock-XNAS-AAPL' not in fx
        stock = client.get('/stocks/stock-XNAS-AAPL').get_data(as_text=True)
        assert 'Stock history' in stock and 'Reference history' in stock
        assert '<td>245.12345678</td>' in stock
        assert '<th scope="row">2026-10-22</th>' in stock
        assert 'Last successful refresh' in stock
        assert 'Latest observation' in stock
        assert 'https://marketstack.com/' in stock
        currency = client.get('/exchange-rates/fx-USD-EUR').get_data(as_text=True)
        assert '<td>0.92345678</td>' in currency
        assert 'EUR per 1 USD' in currency
        chart = json.loads(re.search(r'<script id="gr-chart-data" type="application/json">(.*?)</script>', currency).group(1))
        assert chart['frequency'] == 'daily'
        assert chart['allowExport'] is False
        stock_chart = json.loads(re.search(r'<script id="gr-chart-data" type="application/json">(.*?)</script>', stock).group(1))
        assert stock_chart['allowExport'] is False
        assert chart['history'] == [
            {'date': '2026-10-21', 'period': '2026-10-21', 'price': 0.91234567},
            {'date': '2026-10-22', 'period': '2026-10-22', 'price': 0.92345678}]
    assert database.read_bytes() == before
    assert database.stat().st_mtime_ns == before_mtime
    assert not list(database.parent.glob('*-journal'))


def test_stale_history_remains_available_with_an_explicit_status(market_client):
    client, database, _ = market_client
    seed_cache(database)
    import sqlite3
    with sqlite3.connect(database) as conn:
        conn.execute("UPDATE instruments SET last_success='2026-10-01T12:00:00+00:00'")
    for path in ('/stocks', '/exchange-rates', '/stocks/stock-XNAS-AAPL', '/exchange-rates/fx-USD-EUR'):
        response = client.get(path)
        assert response.status_code == 200
        body = response.get_data(as_text=True)
        assert 'Refresh delayed' in body
        assert '2026-10-22' in body
        assert '2026-10-01 12:00:00 UTC' in body


@pytest.mark.parametrize('path', [
    '/stocks/unknown', '/stocks/fx-USD-EUR', '/exchange-rates/stock-XNAS-AAPL',
    '/stocks/stock-XNAS-UNKNOWN', '/stocks/..', '/stocks/secret.json',
    '/stocks/stock-XNAS-AAPL.csv', '/exchange-rates/fx-USD-EUR.csv'])
def test_invalid_ids_and_cross_kind_paths_do_not_expose_data(market_client, path):
    client, _, _ = market_client
    assert client.get(path).status_code == 404


def test_search_filters_saved_history_and_escapes_the_query(market_client):
    client, database, _ = market_client
    seed_cache(database)
    assert 'Apple' in client.get('/stocks?q=AAPL').get_data(as_text=True)
    empty = client.get('/stocks?q=%3Cscript%3Ebad%3C/script%3E').get_data(as_text=True)
    assert 'No matching histories' in empty
    assert '<script>bad</script>' not in empty
    assert '&lt;script&gt;bad&lt;/script&gt;' in empty
    assert client.get('/stocks?q=' + 'a' * 101).status_code == 400
    assert client.get('/exchange-rates?page=-1').status_code == 400


@pytest.mark.parametrize('identifier,path,source,query', [
    ('stock-XNAS-AAPL', '/stocks', 'marketstack', 'AAPL'),
    ('fx-USD-EUR', '/exchange-rates', 'exchangerate_host', 'USD/EUR'),
])
def test_detail_return_and_observation_pages_keep_only_validated_list_context(
        market_client, monkeypatch, identifier, path, source, query):
    client, database, _ = market_client
    seed_cache(database)
    raw = store.read_instrument(database, identifier, now=NOW)
    start = date(2026, 1, 1)
    raw['observations'] = [dict(date=(start + timedelta(days=index)).isoformat(), value=index)
                           for index in range(101)]
    monkeypatch.setattr(market_data, 'read_instrument', lambda *args: raw)
    captured = {}

    def render(template, **context):
        captured.update(context)
        return 'detail'

    monkeypatch.setattr(market_data, 'render_template', render)
    response = client.get(path + '/' + identifier, query_string=dict(
        q=query, source=source, list_page=3, page=2, return_to='https://example.org/escape'))
    assert response.status_code == 200
    back = urlsplit(captured['list_url'])
    assert back.scheme == back.netloc == '' and back.path == path
    assert parse_qs(back.query) == dict(q=[query], source=[source], page=['3'])
    assert len(captured['record']['history']) == 101
    for name, page in [('previous', '1'), ('next', '3')]:
        link = urlsplit(captured['history'][name])
        assert link.scheme == link.netloc == '' and link.path == path + '/' + identifier
        assert parse_qs(link.query) == dict(q=[query], source=[source], list_page=['3'], page=[page])


@pytest.mark.parametrize('args', [
    {'q': 'a' * 101}, {'q': 'U\nSD'}, {'source': 'https://example.org'},
    {'source': 'frankfurter_ecb'}, {'list_page': '-1'}, {'list_page': '25001'},
    {'list_page': '//example.org'}, {'list_page': '1.0'},
])
def test_detail_rejects_invalid_return_context_before_cache_reads(market_client, monkeypatch, args):
    client, _, _ = market_client
    monkeypatch.setattr(market_data, 'read_instrument', lambda *args: pytest.fail('Invalid context read cache'))
    assert client.get('/stocks/stock-XNAS-AAPL', query_string=args).status_code == 400


def test_catalog_content_is_escaped_and_unsafe_source_links_are_omitted(market_client, monkeypatch):
    client, database, _ = market_client
    seed_cache(database)
    original = store.CATALOG['stock-XNAS-AAPL']
    monkeypatch.setattr(store, 'CATALOG', {**store.CATALOG, original.id: replace(original,
        name='Apple <script>alert("catalog")</script>', source_url='javascript:alert(1)')})
    for path in ('/stocks', '/stocks/stock-XNAS-AAPL'):
        body = client.get(path).get_data(as_text=True)
        assert '<script>alert(' not in body
        assert '&lt;script&gt;' in body
        assert 'javascript:alert(1)' not in body
    detail = client.get('/stocks/stock-XNAS-AAPL').get_data(as_text=True)
    chart = re.search(r'<script id="gr-chart-data" type="application/json">(.*?)</script>', detail).group(1)
    assert '<script>' not in chart
    assert json.loads(chart)['name'] == 'Apple <script>alert("catalog")</script>'


def test_corrupt_cache_returns_a_safe_unavailable_response(market_client):
    client, database, _ = market_client
    database.write_bytes(b'not a database; private-debug-sentinel')
    before = database.read_bytes()
    for path in ('/stocks', '/stocks/stock-XNAS-AAPL'):
        response = client.get(path)
        assert response.status_code == 503
        body = response.get_data(as_text=True)
        assert 'private-debug-sentinel' not in body
        assert str(database) not in body
        assert 'Traceback' not in body
    assert database.read_bytes() == before


def test_empty_instrument_and_private_metadata_do_not_become_demo_values(market_client, monkeypatch):
    client, database, _ = market_client
    seed_cache(database)
    raw = store.read_instrument(database, 'stock-XNAS-AAPL', now=NOW)
    raw.update(observations=[], api_key='private-key-sentinel', budget='private-budget-sentinel')
    monkeypatch.setattr(market_data, 'read_instrument', lambda *args: raw)
    body = client.get('/stocks/stock-XNAS-AAPL').get_data(as_text=True)
    assert 'No saved observations yet' in body
    assert 'gr-chart-data' not in body
    assert 'private-key-sentinel' not in body and 'private-budget-sentinel' not in body
    assert '<td>0</td>' not in body


def test_default_database_path_stays_in_the_configured_data_directory(market_client):
    client, database, _ = market_client
    client.application.config.pop('MARKET_DATA_DB')
    with client.application.app_context():
        assert market_data.database_path() == database
    assert client.get('/stocks').status_code == 200
    assert not database.exists()


def test_cached_market_histories_do_not_add_download_routes_or_expose_private_fields(market_client, monkeypatch):
    client, database, _ = market_client
    seed_cache(database)
    raw = store.read_instrument(database, 'stock-XNAS-AAPL', now=NOW)
    raw.update(api_key='private-key-sentinel', quota_remaining='private-quota-sentinel',
               debug='private-debug-sentinel')
    monkeypatch.setattr(market_data, 'read_instrument', lambda *args: raw)
    response = client.get('/stocks/stock-XNAS-AAPL?file=private.sqlite3')
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert '246.5' in body
    assert 'private-key-sentinel' not in body
    assert 'private-quota-sentinel' not in body
    assert 'private-debug-sentinel' not in body
    assert client.get('/stocks/stock-XNAS-AAPL.csv').status_code == 404
    assert client.get('/exchange-rates/fx-USD-EUR.csv').status_code == 404
