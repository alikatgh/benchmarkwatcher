"""Fake network only: no provider calls, credentials or production database use."""
import copy
import json
import sqlite3
import subprocess
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import pytest
import requests

from scripts import open_market_store as store
from scripts import refresh_open_market_data as fetch
from scripts.market_data_catalog import STOCKS

NOW = datetime(2026, 10, 24, 12, tzinfo=timezone.utc)
META = dict(key='ECB', pivot_currency='EUR', frequency='daily', currencies=['EUR', 'USD', 'JPY'],
            unknown_currencies=[], start_date='2025-01-01', end_date='2026-10-23')


class Clock:
    def __init__(self):
        self.value = 0
        self.sleeps = []
    def monotonic(self):
        return self.value
    def sleep(self, duration):
        self.sleeps.append(duration)
        self.value += duration


def mapping(item):
    return dict(data=[dict(figi='BBG000B9XRY4', compositeFIGI='BBG000B9XRY4', shareClassFIGI='BBG001S5N8V8',
        ticker=item.symbol, name=item.name, exchCode='US', marketSector='Equity', securityType='Common Stock', securityType2='Common Stock')])


class FakeTransport:
    def __init__(self, metadata=None):
        self.calls = []
        self.metadata = metadata or META
        self.failure_on = None
        self.failure = fetch.OpenDataError('network_error')
        self.ambiguous = False
    def get_json(self, kind, params=None, payload=None, timeout_seconds=20):
        self.calls.append((kind, copy.deepcopy(params), copy.deepcopy(payload), timeout_seconds))
        if self.failure_on == len(self.calls):
            raise self.failure
        if kind == 'ecb_metadata':
            return copy.deepcopy(self.metadata)
        if kind == 'ecb_rates':
            return [dict(base='EUR', quote=quote, date=when, rate=rate)
                    for quote, rate in [('USD', 1.1), ('JPY', 160)]
                    for when in sorted({params['from'], params['to']})]
        result = [mapping(next(item for item in STOCKS if item.symbol == job['idValue'])) for job in payload]
        if self.ambiguous:
            result[-1]['data'].append(copy.deepcopy(result[-1]['data'][0]))
        return result


def run(path, transport, clock=None, **kwargs):
    clock = clock or Clock()
    return fetch.refresh(path, transport=transport, monotonic=clock.monotonic, sleep=clock.sleep, now=kwargs.pop('now', NOW), **kwargs)


def market_cache(path, count=3):
    with sqlite3.connect(path) as conn:
        conn.execute('PRAGMA application_id=1113017675')
        conn.execute('PRAGMA user_version=1')
        conn.execute('CREATE TABLE instruments (id TEXT PRIMARY KEY,last_success TEXT NOT NULL,refresh_days INTEGER NOT NULL)')
        conn.executemany('INSERT INTO instruments VALUES (?,?,?)', [(item.id, NOW.isoformat(), 30) for item in STOCKS[:count]])
    return path


def test_full_history_is_year_chunked_paced_and_source_pinned(tmp_path):
    path, transport, clock = tmp_path / 'open.sqlite3', FakeTransport(), Clock()
    result = run(path, transport, clock, provider='frankfurter')
    assert result['status'] == 'complete' and result['network_requests'] == 3
    assert [call[0] for call in transport.calls] == ['ecb_metadata', 'ecb_rates', 'ecb_rates']
    assert transport.calls[1][1] == {'base': 'EUR', 'from': '2025-01-01', 'to': '2025-12-31'}
    assert transport.calls[2][1] == {'base': 'EUR', 'from': '2026-01-01', 'to': '2026-10-23'}
    assert clock.sleeps == [1, 1]
    row = store.read_fx(path, 'fx-ECB-EUR-USD', NOW)
    assert row['observation_count'] == 4 and row['coverage_start'] == '2025-01-01'
    again = run(path, transport, provider='frankfurter')
    assert again['network_requests'] == 0 and len(transport.calls) == 3
    assert store.status(path)['providers']['frankfurter_ecb']['requests'] == 3


def test_partial_backfill_resumes_only_remaining_chunks_after_failure_cooldown(tmp_path):
    path, transport = tmp_path / 'open.sqlite3', FakeTransport()
    partial = run(path, transport, provider='frankfurter', max_requests=2)
    assert partial['status'] == 'incomplete' and partial['network_requests'] == 2
    assert store.list_fx(path, NOW) == [] and store.status(path)['staged_observations'] == 4
    blocked = run(path, transport, provider='frankfurter', now=NOW + timedelta(minutes=4))
    assert blocked['network_requests'] == 0
    resumed = FakeTransport()
    result = run(path, resumed, provider='frankfurter', now=NOW + timedelta(minutes=6))
    assert result['status'] == 'complete' and result['network_requests'] == 2
    assert resumed.calls[-1][1]['from'] == '2026-01-01'
    assert store.read_fx(path, 'fx-ECB-EUR-USD', NOW + timedelta(minutes=6))['observation_count'] == 4
    assert store.status(path)['staged_observations'] == 0


def test_incremental_overlap_idempotence_and_old_history_retention(tmp_path):
    path = tmp_path / 'open.sqlite3'
    run(path, FakeTransport(), provider='frankfurter')
    later = NOW + timedelta(days=1)
    transport = FakeTransport(dict(META, end_date='2026-10-24'))
    result = run(path, transport, provider='frankfurter', now=later)
    assert result['network_requests'] == 2
    assert transport.calls[-1][1]['from'] == '2026-10-16'
    row = store.read_fx(path, 'fx-ECB-EUR-USD', later)
    assert row['coverage_start'] == '2025-01-01' and row['coverage_end'] == '2026-10-24'
    assert row['observation_count'] == 6
    assert run(path, FakeTransport(), provider='frankfurter', now=later)['network_requests'] == 0


def test_failed_refresh_preserves_all_previous_public_rows_and_redacts_errors(tmp_path):
    path = tmp_path / 'open.sqlite3'
    run(path, FakeTransport(), provider='frankfurter')
    prior = store.read_fx(path, 'fx-ECB-EUR-USD', NOW)
    transport = FakeTransport(dict(META, end_date='2026-10-24'))
    transport.failure_on, transport.failure = 2, requests.Timeout('private upstream message')
    result = run(path, transport, provider='frankfurter', now=NOW + timedelta(days=1))
    assert result['status'] == 'failed' and result['network_requests'] == 2
    assert 'private upstream message' not in json.dumps(result)
    assert store.read_fx(path, prior['id'], NOW) == prior
    assert store.status(path)['providers']['frankfurter_ecb']['requests'] == 5


def test_openfigi_only_saved_reviewed_stocks_batched_and_no_key(tmp_path):
    cache, path = market_cache(tmp_path / 'market.sqlite3', 23), tmp_path / 'open.sqlite3'
    transport, clock = FakeTransport(), Clock()
    before = cache.read_bytes()
    result = run(path, transport, clock, provider='openfigi', market_cache=cache)
    assert result['status'] == 'complete' and result['network_requests'] == 3
    assert [len(call[2]) for call in transport.calls] == [10, 10, 3]
    assert clock.sleeps == [3, 3]
    assert set(transport.calls[0][2][0]) == {'idType', 'idValue', 'exchCode', 'currency', 'marketSecDes', 'securityType'}
    assert all(job['exchCode'] == 'US' and job['securityType'] == 'Common Stock'
               for call in transport.calls for job in call[2])
    assert cache.read_bytes() == before
    identities = store.list_identities(path)
    assert len(identities) == 23 and set(identities) == {item.id for item in STOCKS[:23]}
    value = store.read_identity(path, STOCKS[0].id)
    assert value['figi'] == 'BBG000B9XRY4' and value['share_class_figi'] == 'BBG001S5N8V8'
    assert value['matched_mic'] == '' and value['catalog_mic'] == STOCKS[0].exchange
    assert value['mapping_scope'] == 'us_composite' and value['query_exchange_code'] == 'US'
    assert run(path, transport, provider='openfigi', market_cache=cache, now=NOW + timedelta(days=29))['network_requests'] == 0


def test_ambiguous_or_partial_figi_batch_never_publishes_or_replaces_prior(tmp_path):
    cache, path = market_cache(tmp_path / 'market.sqlite3', 11), tmp_path / 'open.sqlite3'
    run(path, FakeTransport(), provider='openfigi', market_cache=cache)
    previous = store.list_identities(path)
    ambiguous = FakeTransport()
    ambiguous.ambiguous = True
    result = run(path, ambiguous, provider='openfigi', market_cache=cache, now=NOW + timedelta(days=31))
    assert result['providers']['openfigi']['error'] == 'ambiguous_identity'
    assert store.list_identities(path) == previous
    partial = FakeTransport()
    partial.failure_on = 2
    result = run(path, partial, provider='openfigi', market_cache=cache, now=NOW + timedelta(days=32))
    assert result['status'] == 'failed' and result['network_requests'] == 2
    assert store.list_identities(path) == previous


def test_figi_throttle_stops_without_retry_and_respects_retry_after(tmp_path):
    path, transport = tmp_path / 'open.sqlite3', FakeTransport()
    cache = market_cache(tmp_path / 'market.sqlite3', 23)
    transport.failure_on, transport.failure = 1, store.OpenDataError('http_429', retry_after=900)
    report = run(path, transport, provider='openfigi', market_cache=cache)
    assert report['status'] == 'failed' and report['network_requests'] == 1
    assert len(transport.calls) == 1 and store.list_identities(path) == {}
    assert store.utc(store.status(path)['providers']['openfigi']['next_allowed']) == NOW + timedelta(seconds=900)
    assert run(path, transport, provider='openfigi', market_cache=cache, now=NOW + timedelta(minutes=10))['network_requests'] == 0


def test_missing_saved_stocks_and_status_never_create_transport_or_network(tmp_path, capsys):
    path = tmp_path / 'missing.sqlite3'
    with patch.object(fetch, 'OpenTransport', side_effect=AssertionError('network forbidden')):
        assert fetch.main(['--database', str(path), '--status']) == 0
    assert json.loads(capsys.readouterr().out)['status'] == 'missing' and not path.exists()
    report = run(path, FakeTransport(), provider='openfigi', market_cache=tmp_path / 'missing-market.sqlite3')
    assert report['network_requests'] == 0 and report['providers']['openfigi']['status'] == 'no_saved_stocks'


@pytest.mark.parametrize('payload', [None, {}, [dict(base='USD', quote='JPY', date='2025-01-01', rate=1)],
    [dict(base='EUR', quote='USD', date='2024-12-31', rate=1)],
    [dict(base='EUR', quote='EUR', date='2025-01-01', rate=1)],
    [dict(base='EUR', quote='USD', date='2025-01-01', rate=float('inf'))]])
def test_rate_response_identity_dates_and_numbers_strictly_validated(payload):
    with pytest.raises(store.OpenDataError):
        fetch.parse_rates(payload, '2025-01-01', '2025-12-31', META)


def test_duplicate_rates_and_unverified_identity_are_rejected():
    row = dict(base='EUR', quote='USD', date='2025-01-01', rate=1)
    with pytest.raises(store.OpenDataError):
        fetch.parse_rates([row, row], '2025-01-01', '2025-12-31', META)
    payload = [mapping(STOCKS[0])]
    for field, value in [('ticker', 'MSFT'), ('marketSector', 'Govt'), ('securityType', 'ETF'), ('figi', 'invalid')]:
        bad = copy.deepcopy(payload)
        bad[0]['data'][0][field] = value
        with pytest.raises(store.OpenDataError):
            fetch.parse_identities(bad, [STOCKS[0]], NOW)
    with pytest.raises(store.OpenDataError):
        fetch.parse_identities([], [STOCKS[0]], NOW)


def test_corrupt_or_foreign_saved_cache_cannot_trigger_network(tmp_path):
    cache = tmp_path / 'market.sqlite3'
    cache.write_bytes(b'not sqlite')
    transport = FakeTransport()
    with pytest.raises(store.OpenDataError):
        run(tmp_path / 'open.sqlite3', transport, provider='openfigi', market_cache=cache)
    assert transport.calls == [] and not (tmp_path / 'open.sqlite3').exists()


def test_job_deadline_blocks_next_call_and_timeout_cannot_publish(tmp_path):
    class Slow(FakeTransport):
        def get_json(self, *args, **kwargs):
            result = super().get_json(*args, **kwargs)
            clock.value += 601
            return result
    clock = Clock()
    path, transport = tmp_path / 'open.sqlite3', Slow()
    report = run(path, transport, clock, provider='frankfurter')
    assert report['providers']['frankfurter_ecb']['error'] == 'deadline'
    assert report['network_requests'] == 1 and store.list_fx(path, NOW) == []


def response(body=None, status_code=200, headers=None):
    result = Mock()
    result.status_code, result.headers = status_code, headers or {}
    result.iter_content.return_value = body or [b'[]']
    result.__enter__ = Mock(return_value=result)
    result.__exit__ = Mock(return_value=False)
    return result


def test_transport_fixed_paths_no_redirect_proxy_retry_or_cookie_reuse():
    with patch.object(fetch.requests, 'Session') as factory:
        session = factory.return_value
        session.get.return_value = response()
        transfer = fetch._WorkerTransfer()
        assert session.trust_env is False
        assert transfer.body('ecb_metadata', {}, None) == b'[]'
        args, kwargs = session.get.call_args
        assert args == ('https://api.frankfurter.dev/v2/providers/ecb',)
        assert kwargs['allow_redirects'] is False and kwargs['stream'] is True
        assert kwargs['timeout'] == (3, 17)
        assert sum(kwargs['timeout']) <= fetch.REQUEST_SECONDS == 20
        assert session.mount.call_args.args[1].max_retries.total == 0
        with pytest.raises(store.OpenDataError):
            transfer.body('arbitrary-host', {}, None)
        assert session.get.call_count == 1
        transfer.close()


@pytest.mark.parametrize('variant', ['declared', 'streamed', 'badlength', 'http503', 'timeout'])
def test_worker_rejects_oversize_http_failure_and_timeout(variant, monkeypatch):
    monkeypatch.setattr(fetch, 'MAX_RESPONSE_BYTES', 8)
    with patch.object(fetch.requests, 'Session') as factory:
        session = factory.return_value
        if variant == 'timeout':
            session.get.side_effect = requests.Timeout('untrusted upstream string')
        elif variant == 'declared':
            session.get.return_value = response(headers={'Content-Length': '9'})
        elif variant == 'streamed':
            session.get.return_value = response(body=[b'12345', b'6789'])
        elif variant == 'badlength':
            session.get.return_value = response(headers={'Content-Length': 'nope'})
        else:
            session.get.return_value = response(status_code=503, headers={'Retry-After': '1000'})
        transfer = fetch._WorkerTransfer()
        with pytest.raises(store.OpenDataError) as error:
            transfer.body('ecb_metadata', {}, None)
        assert 'untrusted upstream' not in str(error.value)
        if variant == 'http503':
            assert error.value.retry_after == 1000
        if variant == 'timeout':
            assert str(error.value) == 'deadline'
        transfer.close()


def test_hard_transport_timeout_kills_and_reaps_worker():
    child = Mock()
    child.communicate.side_effect = [subprocess.TimeoutExpired('worker', 1), (b'', b'')]
    child.poll.return_value = -9
    with patch.object(fetch.subprocess, 'Popen', return_value=child) as popen:
        with pytest.raises(store.OpenDataError, match='deadline'):
            fetch.OpenTransport().get_json('ecb_metadata', timeout_seconds=.01)
    assert child.kill.call_count == 1 and child.communicate.call_count == 2
    assert popen.call_args.kwargs['stderr'] == subprocess.DEVNULL
    assert set(popen.call_args.kwargs['env']) == {'PATH', 'LANG', 'PYTHONDONTWRITEBYTECODE'}


def test_request_budget_cli_invalid_and_bad_json_fail_without_network(tmp_path, capsys):
    for budget in (0, 41):
        with patch.object(fetch, 'OpenTransport', side_effect=AssertionError('no client')):
            assert fetch.main(['--database', str(tmp_path / 'missing.sqlite3'), '--max-requests', str(budget)]) == 1
        assert json.loads(capsys.readouterr().out)['status'] == 'failed'
    for body in (b'{', b'NaN', b'123', b'\xff'):
        with pytest.raises(store.OpenDataError, match='invalid_response'):
            fetch._decode(body)


class ExpandedCurrencies(FakeTransport):
    def get_json(self, kind, params=None, payload=None, timeout_seconds=20):
        result = super().get_json(kind, params, payload, timeout_seconds)
        if kind == 'ecb_rates':
            result.extend(dict(base='EUR', quote='CHF', date=when, rate=.9)
                          for when in sorted({params['from'], params['to']}))
        return result


def test_new_currency_gets_full_resumable_backfill_before_publication(tmp_path):
    path = tmp_path / 'open.sqlite3'
    run(path, FakeTransport(), provider='frankfurter')
    prior = store.read_fx(path, 'fx-ECB-EUR-USD', NOW)
    later = NOW + timedelta(days=1)
    expanded = dict(META, currencies=['EUR', 'USD', 'JPY', 'CHF'], end_date='2026-10-24')
    first = ExpandedCurrencies(expanded)
    result = run(path, first, provider='frankfurter', now=later, max_requests=2)
    assert result['status'] == 'incomplete'
    assert first.calls[1][1]['from'] == '2025-01-01'
    assert store.read_fx(path, 'fx-ECB-EUR-CHF', later) is None
    assert store.read_fx(path, prior['id'], NOW) == prior
    resumed = ExpandedCurrencies(expanded)
    result = run(path, resumed, provider='frankfurter', now=later + timedelta(minutes=6))
    assert result['status'] == 'complete' and result['network_requests'] == 2
    assert resumed.calls[1][1]['from'] == '2026-01-01'
    row = store.read_fx(path, 'fx-ECB-EUR-CHF', later + timedelta(minutes=6))
    assert row['coverage_start'] == '2025-01-01' and row['observation_count'] == 4 and row['history_complete'] is True
    with sqlite3.connect(path) as conn:
        saved = json.loads(conn.execute("SELECT metadata FROM providers WHERE provider='frankfurter_ecb'").fetchone()[0])
    assert saved['currencies'] == expanded['currencies']


def test_currency_expansion_mid_backfill_rechecks_completed_years(tmp_path):
    path = tmp_path / 'open.sqlite3'
    run(path, FakeTransport(), provider='frankfurter', max_requests=2)
    later = NOW + timedelta(minutes=6)
    expanded = dict(META, currencies=['EUR', 'USD', 'JPY', 'CHF'])
    transport = ExpandedCurrencies(expanded)
    assert run(path, transport, provider='frankfurter', now=later, max_requests=2)['status'] == 'incomplete'
    assert transport.calls[1][1]['from'] == '2025-01-01'
    final = ExpandedCurrencies(expanded)
    assert run(path, final, provider='frankfurter', now=later + timedelta(minutes=6))['status'] == 'complete'
    assert store.read_fx(path, 'fx-ECB-EUR-CHF', later + timedelta(minutes=6))['coverage_start'] == '2025-01-01'


def test_full_backfill_missing_advertised_currency_preserves_public_data(tmp_path):
    path = tmp_path / 'open.sqlite3'
    run(path, FakeTransport(), provider='frankfurter')
    prior = store.read_fx(path, 'fx-ECB-EUR-USD', NOW)
    expanded = dict(META, currencies=['EUR', 'USD', 'JPY', 'CHF'])
    report = run(path, FakeTransport(expanded), provider='frankfurter', now=NOW + timedelta(days=1))
    assert report['providers']['frankfurter_ecb']['error'] == 'incomplete_history'
    assert store.read_fx(path, prior['id'], NOW) == prior
    assert store.read_fx(path, 'fx-ECB-EUR-CHF', NOW) is None


def test_earlier_source_start_triggers_backfill_instead_of_overlap(tmp_path):
    path = tmp_path / 'open.sqlite3'
    run(path, FakeTransport(), provider='frankfurter')
    transport = FakeTransport(dict(META, start_date='2024-01-01'))
    report = run(path, transport, provider='frankfurter', now=NOW + timedelta(days=1))
    assert report['status'] == 'complete' and transport.calls[1][1]['from'] == '2024-01-01'
    assert store.read_fx(path, 'fx-ECB-EUR-USD', NOW + timedelta(days=1))['coverage_start'] == '2024-01-01'


def test_known_figi_no_match_preserves_prior_identity_and_reports_unmatched(tmp_path):
    path, cache = tmp_path / 'open.sqlite3', market_cache(tmp_path / 'market.sqlite3', 3)
    run(path, FakeTransport(), provider='openfigi', market_cache=cache)
    first_id = fetch.saved_stocks(cache)[0].id
    prior = store.read_identity(path, first_id)
    class MissingOne(FakeTransport):
        def get_json(self, kind, params=None, payload=None, timeout_seconds=20):
            result = super().get_json(kind, params, payload, timeout_seconds)
            if kind == 'openfigi':
                result[0] = {'warning': 'No identifier found.'}
            return result
    later = NOW + timedelta(days=31)
    report = run(path, MissingOne(), provider='openfigi', market_cache=cache, now=later)
    assert report['status'] == 'complete'
    assert report['providers']['openfigi']['unmatched_count'] == 1
    assert report['providers']['openfigi']['unmatched_ids'] == [first_id]
    assert report['providers']['openfigi']['updated'] == 2
    assert store.read_identity(path, first_id) == prior
    assert store.status(path)['providers']['openfigi']['last_complete'] == later.date().isoformat()


def test_all_documented_no_matches_complete_without_inventing_identities(tmp_path):
    path, cache = tmp_path / 'open.sqlite3', market_cache(tmp_path / 'market.sqlite3', 3)
    class MissingAll(FakeTransport):
        def get_json(self, kind, params=None, payload=None, timeout_seconds=20):
            super().get_json(kind, params, payload, timeout_seconds)
            return [{'warning': 'No identifier found.'} for _ in payload]
    report = run(path, MissingAll(), provider='openfigi', market_cache=cache)
    assert report['status'] == 'complete' and report['providers']['openfigi']['unmatched_count'] == 3
    assert store.list_identities(path) == {}
    assert store.status(path)['providers']['openfigi']['last_complete'] == NOW.date().isoformat()


@pytest.mark.parametrize('response', [
    {'warning': 'different warning'}, {'error': 'No identifier found.'},
    {'warning': 'No identifier found.', 'data': []}, {'data': []}])
def test_other_figi_warning_error_and_conflicting_shapes_remain_failures(response):
    with pytest.raises(store.OpenDataError):
        fetch.parse_identities([response], [STOCKS[0]], NOW, unmatched=[])


def test_verified_ecb_self_quotes_are_checked_then_excluded():
    rows = [dict(base='EUR', quote='EUR', date='2025-01-02', rate=1),
            dict(base='EUR', quote='USD', date='2025-01-02', rate=1.1)]
    assert fetch.parse_rates(rows, '2025-01-01', '2025-12-31', META) == [dict(quote='USD', date='2025-01-02', value=1.1)]
    for replacement in (dict(rows[0], rate=2), dict(rows[0], rate=True), dict(rows[0], date='2024-12-31')):
        with pytest.raises(store.OpenDataError):
            fetch.parse_rates([replacement, rows[1]], '2025-01-01', '2025-12-31', META)
    with pytest.raises(store.OpenDataError):
        fetch.parse_rates([rows[0], rows[0], rows[1]], '2025-01-01', '2025-12-31', META)


@pytest.mark.parametrize('field,value', [('exchCode', 'UW'), ('compositeFIGI', 'BBG000BLNNH6')])
def test_us_composite_mapping_cannot_be_mislabeled_as_listing(field, value):
    response = mapping(STOCKS[0])
    response['data'][0][field] = value
    with pytest.raises(store.OpenDataError, match='identity_mismatch'):
        fetch.parse_identities([response], [STOCKS[0]], NOW)


def test_worker_request_shape_is_explicit_us_composite_not_mic_substitution():
    job = dict(idType='TICKER', idValue='AAPL', exchCode='US', currency='USD', marketSecDes='Equity', securityType='Common Stock')
    fetch._request_shape('openfigi', {}, [job])
    for bad in (dict(job, exchCode='UW'), {**{key: value for key, value in job.items() if key != 'exchCode'}, 'micCode': 'XNAS'}):
        with pytest.raises(store.OpenDataError):
            fetch._request_shape('openfigi', {}, [bad])
