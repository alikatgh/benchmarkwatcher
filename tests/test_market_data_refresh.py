"""Vendor integration tests use synthetic credentials and fake transports only."""
import copy
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from datetime import date, datetime, timedelta, timezone
from unittest.mock import Mock, patch

import pytest
import requests

from scripts.market_data_catalog import CATALOG, FX, PROFILES, STOCKS
from scripts.refresh_market_data import (
    FetchError, VendorTransport, _WorkerTransfer, _decode_payload, configured_database, main, parse_fx, parse_stock_batch, parse_stocks, refresh_due,
)
from scripts.vendor_data_store import StoreError, authorize_rolling_budget, enroll_initial_provider, enroll_provider, list_instruments, read_instrument, read_status

NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
SECRET = 'synthetic-test-key-do-not-echo'
STOCK_CONFIG = {'MARKETSTACK_ENABLED': '1', 'MARKETSTACK_API_KEY': SECRET, 'MARKETSTACK_PROFILE': 'daily-3'}
FX_CONFIG = {'EXCHANGERATE_HOST_ENABLED': '1', 'EXCHANGERATE_HOST_API_KEY': SECRET}


def enrolled(path, provider='marketstack', used=0, limit=90):
    enroll_provider(path, provider, '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', limit, used, now=NOW)


def stock_payload(symbol='AAPL', exchange='XNAS', day='2026-10-22', currency='USD'):
    return {'pagination': {'total': 1, 'count': 1, 'offset': 0, 'limit': 1000},
            'data': [{'symbol': symbol, 'exchange': exchange, 'date': day + 'T00:00:00+0000',
                      'price_currency': currency, 'asset_type': 'stock', 'open': 99, 'high': 102,
                      'low': 98, 'close': 100, 'adj_close': 99.5, 'volume': 1000}]}


def fx_payload(day='2026-10-22'):
    return {'success': True, 'historical': True, 'date': day, 'timestamp': int(datetime.combine(date.fromisoformat(day), datetime.min.time(), tzinfo=timezone.utc).timestamp()),
            'source': 'USD', 'quotes': {item.base_currency + item.quote_currency: 1.5 for item in FX}}


class FakeTransport:
    def __init__(self, failure=None, payload=None):
        self.calls = []
        self.failure, self.payload = failure, payload

    def get_json(self, provider, params):
        self.calls.append((provider, dict(params)))
        if self.failure:
            raise self.failure
        if self.payload is not None:
            return copy.deepcopy(self.payload)
        if provider != 'marketstack':
            return fx_payload(params['date'])
        payload = stock_payload()
        payload['data'] = [stock_payload(symbol, params['exchange'], params['date_to'])['data'][0]
                           for symbol in params['symbols'].split(',')]
        payload['pagination'].update(total=len(payload['data']), count=len(payload['data']))
        return payload


class CompleteDateRangeTransport(FakeTransport):
    """Synthetic worst case: every requested calendar day has a valid row."""
    def get_json(self, provider, params):
        payload = super().get_json(provider, params)
        start, end = date.fromisoformat(params['date_from']), date.fromisoformat(params['date_to'])
        payload['data'] = [stock_payload(symbol, params['exchange'], (start + timedelta(days=index)).isoformat())['data'][0]
                           for symbol in params['symbols'].split(',') for index in range((end - start).days + 1)]
        payload['pagination'].update(total=len(payload['data']), count=len(payload['data']))
        assert len(payload['data']) <= 1000
        return payload


def test_default_disabled_has_no_database_writes_or_client_creation(tmp_path):
    path = tmp_path / 'missing' / 'market.sqlite3'
    with patch('scripts.refresh_market_data.VendorTransport', side_effect=AssertionError('No client')):
        report = refresh_due(path, environ={}, now=NOW)
    assert report['status'] == 'disabled' and report['network_requests'] == 0
    assert not path.parent.exists()


def test_missing_ledger_credential_and_unenrolled_provider_never_call(tmp_path):
    path = tmp_path / 'market.sqlite3'
    transport = FakeTransport()
    assert refresh_due(path, STOCK_CONFIG, NOW, transport)['providers']['marketstack']['status'] == 'ledger_missing'
    assert not path.exists()
    assert refresh_due(path, {'MARKETSTACK_ENABLED': '1'}, NOW, transport)['providers']['marketstack']['status'] == 'credential_missing'
    enrolled(path, 'exchangerate_host')
    assert refresh_due(path, STOCK_CONFIG, NOW, transport)['providers']['marketstack']['status'] == 'provider_unenrolled'
    assert not transport.calls


def test_weekly_profile_batches_15_billed_tickers_then_skips_not_due(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    config = {k: v for k, v in STOCK_CONFIG.items() if k != 'MARKETSTACK_PROFILE'}
    transport = FakeTransport()
    report = refresh_due(path, config, NOW, transport)
    assert report['network_requests'] == 8
    assert report['providers']['marketstack']['updated'] == 15
    for _, params in transport.calls:
        assert len(params['symbols'].split(',')) <= 2
        assert params['limit'] == 1000 and params['offset'] == 0 and params['sort'] == 'ASC'
        assert (date.fromisoformat(params['date_to']) - date.fromisoformat(params['date_from'])).days == 364
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 15
    assert len(list_instruments(path, 'stock', now=NOW)) == 15
    again = refresh_due(path, config, NOW + timedelta(days=1), transport)
    assert again['network_requests'] == 0 and len(transport.calls) == 8
    next_week = refresh_due(path, config, NOW + timedelta(days=7), transport)
    assert next_week['network_requests'] == 2
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 30
    assert transport.calls[-1][1]['date_from'] == '2026-10-15'


def test_quota_exhaustion_stops_before_next_ticker_and_restart(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path, used=89)
    transport = FakeTransport()
    report = refresh_due(path, STOCK_CONFIG, NOW, transport)
    assert report['network_requests'] == 1
    assert report['providers']['marketstack']['failures'] == ['quota_exhausted']
    assert len(transport.calls) == 1
    retry = refresh_due(path, STOCK_CONFIG, NOW + timedelta(days=1), FakeTransport())
    assert retry['network_requests'] == 0
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 90


def test_timeout_is_charged_no_retry_and_secret_exception_is_redacted(tmp_path, capsys):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    transport = FakeTransport(requests.Timeout('https://api.marketstack.com/?access_key=' + SECRET))
    report = refresh_due(path, STOCK_CONFIG, NOW, transport)
    assert report['network_requests'] == 2 and len(transport.calls) == 2
    assert report['providers']['marketstack']['failures'] == ['network_error'] * 3
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 3
    assert SECRET not in json.dumps(report) + capsys.readouterr().out
    again = refresh_due(path, STOCK_CONFIG, NOW + timedelta(hours=1), transport)
    assert again['network_requests'] == 0 and len(transport.calls) == 2
    assert list_instruments(path, 'stock', now=NOW) == []


def test_bad_new_response_preserves_previous_cache(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    refresh_due(path, STOCK_CONFIG, NOW, FakeTransport())
    before = read_instrument(path, STOCKS[0].id, now=NOW)
    bad = FakeTransport(payload={'error': {'info': SECRET}})
    report = refresh_due(path, STOCK_CONFIG, NOW + timedelta(days=1), bad)
    assert report['providers']['marketstack']['status'] == 'failed'
    after = read_instrument(path, STOCKS[0].id, now=NOW)
    assert before == after and SECRET not in json.dumps(report)


@pytest.mark.parametrize('currency', ['usd', 'USD', 'UsD'])
def test_stock_currency_code_casing_matches_documented_v2_response(currency):
    # APILayer's Marketstack v2 Postman EOD example uses price_currency: "usd".
    payload = stock_payload(currency=currency)
    assert parse_stocks(payload, STOCKS[0], date(2026, 10, 22), date(2026, 10, 22)) == [
        {'date': '2026-10-22', 'value': 100.0, 'close': 100.0, 'open': 99.0,
         'high': 102.0, 'low': 98.0, 'adjusted_close': 99.5, 'volume': 1000.0},
    ]


def test_stock_explicit_null_close_preserves_other_observation_days():
    payload = stock_payload(day='2026-10-20', currency='usd')
    missing = copy.deepcopy(payload['data'][0])
    missing.update(date='2026-10-21T00:00:00+0000', close=None, adj_close=None)
    latest = copy.deepcopy(payload['data'][0])
    latest.update(date='2026-10-22T00:00:00+0000', close=101)
    payload['data'].extend([missing, latest])
    payload['pagination'].update(total=3, count=3)
    points = parse_stocks(payload, STOCKS[0], date(2026, 10, 20), date(2026, 10, 22))
    assert [(point['date'], point['close']) for point in points] == [
        ('2026-10-20', 100.0), ('2026-10-22', 101.0),
    ]


def test_stock_all_explicit_null_closes_have_no_observations():
    payload = stock_payload()
    payload['data'][0].update(close=None, adj_close=None)
    with pytest.raises(FetchError, match='no_observations'):
        parse_stocks(payload, STOCKS[0], date(2026, 10, 22), date(2026, 10, 22))


def test_stock_missing_close_field_is_invalid():
    payload = stock_payload()
    del payload['data'][0]['close']
    with pytest.raises(FetchError, match='invalid_response'):
        parse_stocks(payload, STOCKS[0], date(2026, 10, 22), date(2026, 10, 22))


@pytest.mark.parametrize('field,value,reason', [
    ('symbol', 'WRONG', 'identity_mismatch'), ('exchange', 'XNYS', 'identity_mismatch'),
    ('price_currency', 'EUR', 'identity_mismatch'), ('price_currency', None, 'identity_mismatch'),
    ('price_currency', 'eur', 'identity_mismatch'), ('price_currency', 3, 'identity_mismatch'),
    ('price_currency', 'usd ', 'identity_mismatch'), ('price_currency', 'uſd', 'identity_mismatch'),
    ('asset_type', 'crypto', 'identity_mismatch'), ('asset_type', 3, 'identity_mismatch'),
    ('close', float('nan'), 'invalid_response'), ('close', -1, 'invalid_response'),
    ('close', 0, 'invalid_response'), ('close', True, 'invalid_response'),
    ('close', '100', 'invalid_response'), ('volume', True, 'invalid_response'),
    ('date', '2026-10-24T00:00:00Z', 'invalid_response'), ('low', 200, 'invalid_response'),
])
def test_stock_identity_and_numerics_are_verified(field, value, reason):
    payload = stock_payload()
    payload['data'][0][field] = value
    with pytest.raises(FetchError, match=reason):
        parse_stocks(payload, STOCKS[0], date(2025, 10, 23), date(2026, 10, 22))


def test_truncated_pagination_is_rejected_without_followup(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path, used=89)
    payload = stock_payload()
    payload['pagination']['total'] = 1001
    transport = FakeTransport(payload=payload)
    report = refresh_due(path, STOCK_CONFIG, NOW, transport)
    assert len(transport.calls) == 1
    assert report['providers']['marketstack']['failures'][0] == 'pagination_truncated'
    assert list_instruments(path, 'stock', now=NOW) == []
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 90


def test_fx_one_historical_call_populates_all_named_pairs_without_backfill(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path, 'exchangerate_host')
    transport = FakeTransport()
    report = refresh_due(path, FX_CONFIG, NOW, transport)
    assert report['network_requests'] == 1
    assert report['providers']['exchangerate_host']['updated'] == len(FX) == 20
    assert len(list_instruments(path, 'fx', now=NOW)) == 20
    _, params = transport.calls[0]
    assert params['date'] == '2026-10-22' and 'source' not in params
    assert 'currencies' not in params
    assert refresh_due(path, FX_CONFIG, NOW + timedelta(hours=1), transport)['network_requests'] == 0
    assert refresh_due(path, FX_CONFIG, NOW + timedelta(days=3), transport)['network_requests'] == 1
    assert [call[1]['date'] for call in transport.calls] == ['2026-10-22', '2026-10-25']
    assert [p['date'] for p in read_instrument(path, FX[0].id)['observations']] == ['2026-10-22', '2026-10-25']


@pytest.mark.parametrize('change', ['date', 'source', 'historical', 'nonfinite', 'success'])
def test_fx_wrong_identity_or_incomplete_snapshot_is_rejected(change):
    payload = fx_payload()
    if change == 'nonfinite':
        payload['quotes']['USDEUR'] = float('inf')
    else:
        payload[change] = {'date': '2026-10-21', 'source': 'EUR', 'historical': False, 'success': False}[change]
    with pytest.raises(FetchError):
        parse_fx(payload, date(2026, 10, 22))


@pytest.mark.parametrize('key,value', [('EURGBP', 1.1), ('USDeur', 1), ('USDEURO', 1),
                                       ('USDＸＡＵ', 1), ('USDAAA', 0), ('USDAAA', -1),
                                       ('USDAAA', True), ('USDAAA', float('nan')), ('USDUSD', 0.9)])
def test_fx_every_returned_key_and_value_is_validated(key, value):
    payload = fx_payload()
    payload['quotes'][key] = value
    with pytest.raises(FetchError):
        parse_fx(payload, date(2026, 10, 22))


def test_fx_dynamic_quotes_preserve_metal_crypto_units_and_optional_self_rate():
    payload = fx_payload()
    payload['quotes'] = {'USDXAU': 0.0003, 'USDXAG': 0.03, 'USDBTC': 0.00001, 'USDUSD': 1}
    assert set(parse_fx(payload, date(2026, 10, 22))) == {'fx-USD-XAU', 'fx-USD-XAG', 'fx-USD-BTC'}
    assert CATALOG['fx-USD-XAU'].quote_currency == 'XAU'
    assert 'troy ounce' in CATALOG['fx-USD-XAU'].name
    assert 'Bitcoin' in CATALOG['fx-USD-BTC'].name
    assert CATALOG.get('fx-USD-xau') is None
    assert 'fx-USD-XAU-extra' not in CATALOG
    assert 'fx-USD-USD' not in CATALOG


def test_fx_one_unfiltered_request_saves_every_available_quote_up_to_200(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path, 'exchangerate_host')
    payload = fx_payload()
    codes = [a + b + c for a in 'AB' for b in 'ABCDEFGHIJ' for c in 'ABCDEFGHIJ']
    payload['quotes'] = {'USD' + code: index + 0.5 for index, code in enumerate(codes)}
    transport = FakeTransport(payload=payload)
    report = refresh_due(path, FX_CONFIG, NOW, transport)
    result = report['providers']['exchangerate_host']
    assert result['network_requests'] == result['quota_units'] == 1
    assert result['updated'] == len(result['outcomes']) == 200
    assert len(list_instruments(path, 'fx', now=NOW)) == 200
    assert set(transport.calls[0][1]) == {'access_key', 'date'}
    payload['quotes']['USDZZZ'] = 1
    with pytest.raises(FetchError, match='invalid_response'):
        parse_fx(payload, date(2026, 10, 22))


def test_stock_batch_bad_member_isolated_without_dropping_its_bad_row(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    payload = stock_payload()
    payload['data'].append(stock_payload('MSFT')['data'][0])
    invalid_aapl = copy.deepcopy(payload['data'][0])
    invalid_aapl.update(date='2026-10-21', close=-1)
    payload['data'].append(invalid_aapl)
    payload['pagination'].update(total=3, count=3)
    transport = FakeTransport(payload=payload)
    report = refresh_due(path, STOCK_CONFIG, NOW, transport, coverage_limit=2)
    result = report['providers']['marketstack']
    assert result['network_requests'] == 1 and result['quota_units'] == 2
    assert result['updated'] == 1 and result['failures'] == ['invalid_response']
    assert read_instrument(path, STOCKS[0].id, now=NOW) is None
    assert read_instrument(path, STOCKS[1].id, now=NOW)['latest_date'] == '2026-10-22'
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 2


@pytest.mark.parametrize('mode,reason', [('foreign_symbol', 'identity_mismatch'),
                                       ('wrong_exchange', 'identity_mismatch'),
                                       ('truncated', 'pagination_truncated'),
                                       ('malformed', 'invalid_response')])
def test_stock_batch_global_identity_or_completeness_error_rejects_all(mode, reason):
    payload = stock_payload()
    payload['data'].append(stock_payload('MSFT')['data'][0])
    payload['pagination'].update(total=2, count=2)
    if mode == 'foreign_symbol':
        payload['data'][1]['symbol'] = 'UNREQUESTED'
    elif mode == 'wrong_exchange':
        payload['data'][1]['exchange'] = 'XNYS'
    elif mode == 'truncated':
        payload['pagination']['total'] = 3
    else:
        payload['data'][1] = None
    with pytest.raises(FetchError, match=reason):
        parse_stock_batch(payload, STOCKS[:2], date(2025, 10, 23), date(2026, 10, 22))


def test_stock_batch_missing_requested_member_does_not_invent_observations():
    observations, failures = parse_stock_batch(stock_payload(), STOCKS[:2], date(2025, 10, 23), date(2026, 10, 22))
    assert set(observations) == {STOCKS[0].id}
    assert failures == {STOCKS[1].id: 'no_observations'}


MONTHLY_CONFIG = STOCK_CONFIG | {'MARKETSTACK_PROFILE': 'monthly-100'}


def rolling_enrolled(path, used=0):
    enrolled(path, used=used)
    authorize_rolling_budget(path, 'marketstack', NOW, NOW + timedelta(days=32),
                             expected_used=used, now=NOW)


def test_monthly_profile_full_year_batches_charge_100_tickers_once_and_obey_32_day_cadence(tmp_path):
    path = tmp_path / 'market.sqlite3'
    rolling_enrolled(path)

    transport = CompleteDateRangeTransport()
    report = refresh_due(path, MONTHLY_CONFIG, NOW, transport, clock=lambda: 0)
    result = report['providers']['marketstack']
    assert result['status'] == 'refreshed' and result['updated'] == result['quota_units'] == 100
    assert result['network_requests'] <= 51 and result['remaining_due'] == 0
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 100
    for instrument in STOCKS:
        cached = read_instrument(path, instrument.id, now=NOW)
        assert cached['refresh_days'] == 32 and len(cached['observations']) == 365
        assert cached['observations'][0]['date'] == '2025-10-23'
        assert cached['observations'][-1]['date'] == '2026-10-22'
    calls = len(transport.calls)
    for day in (0, 1, 7, 31):
        assert refresh_due(path, MONTHLY_CONFIG, NOW + timedelta(days=day), transport)['network_requests'] == 0
    assert len(transport.calls) == calls
    later = NOW + timedelta(days=32, seconds=1)
    authorize_rolling_budget(path, 'marketstack', later, later + timedelta(days=32), expected_used=0, now=later)
    update = refresh_due(path, MONTHLY_CONFIG, later, transport, clock=lambda: 0)
    assert update['providers']['marketstack']['updated'] == 100
    assert update['network_requests'] <= 6


def test_recent_history_window_saves_one_hundred_stocks_in_two_requests_with_one_hundred_charges(tmp_path):
    path = tmp_path / 'market.sqlite3'
    rolling_enrolled(path)
    transport = CompleteDateRangeTransport()
    result = refresh_due(path, MONTHLY_CONFIG, NOW, transport, clock=lambda: 0,
                         history_days=7)['providers']['marketstack']
    assert result['status'] == 'refreshed' and result['failures'] == []
    assert result['updated'] == result['quota_units'] == 100
    assert result['history_days'] == 7 and result['network_requests'] == 2
    assert {params['exchange'] for _, params in transport.calls} == {'XNYS', 'XNAS'}
    for _, params in transport.calls:
        assert params['date_from'] == '2026-10-16' and params['date_to'] == '2026-10-22'
        assert len(params['symbols'].split(',')) * 7 <= 1000
        assert params['limit'] == 1000 and params['offset'] == 0
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 100
    for instrument in STOCKS:
        observations = read_instrument(path, instrument.id, now=NOW)['observations']
        assert len(observations) == 7
        assert observations[0]['date'] == '2026-10-16' and observations[-1]['date'] == '2026-10-22'


def test_shorter_history_window_keeps_all_previously_saved_dates(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    transport = CompleteDateRangeTransport()
    initial = refresh_due(path, STOCK_CONFIG, NOW, transport, clock=lambda: 0)['providers']['marketstack']
    assert initial['history_days'] == 365
    before = read_instrument(path, STOCKS[0].id, now=NOW)['observations']
    assert len(before) == 365
    later = NOW + timedelta(days=1)
    updated = refresh_due(path, STOCK_CONFIG, later, transport, clock=lambda: 0,
                          history_days=7)['providers']['marketstack']
    after = read_instrument(path, STOCKS[0].id, now=later)['observations']
    assert updated['history_days'] == 7 and updated['updated'] == 3
    assert len(after) == 366 and after[:-1] == before
    assert after[-1]['date'] == '2026-10-23'


@pytest.mark.parametrize('history_days', [0, 366, -1, True, False, 7.0, '7', None])
def test_invalid_history_window_fails_before_transport_or_ledger_work(tmp_path, history_days):
    path = tmp_path / 'missing.sqlite3'
    with patch('scripts.refresh_market_data.VendorTransport', side_effect=AssertionError('No transport')):
        with pytest.raises(ValueError):
            refresh_due(path, MONTHLY_CONFIG, NOW, history_days=history_days)
    assert not path.exists()


@pytest.mark.parametrize('used,remaining', [(29, 71), (99, 1)])
def test_monthly_odd_remaining_units_are_spent_per_ticker_and_replay_never_retries(tmp_path, used, remaining):
    path = tmp_path / 'market.sqlite3'
    if used <= 90:
        rolling_enrolled(path, used=used)
    else:
        rolling_enrolled(path, used=90)
        refresh_due(path, MONTHLY_CONFIG, NOW, FakeTransport(), coverage_limit=used - 90)
    transport = FakeTransport()
    report = refresh_due(path, MONTHLY_CONFIG, NOW, transport)
    result = report['providers']['marketstack']
    assert result['quota_units'] == result['updated'] == remaining
    assert result['remaining_due'] == (29 if used == 29 else 90)
    assert result['failures'] == ['quota_exhausted']
    assert sum(len(params['symbols'].split(',')) for _, params in transport.calls) == remaining
    assert any(len(params['symbols'].split(',')) == 1 for _, params in transport.calls)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 100
    assert refresh_due(path, MONTHLY_CONFIG, NOW, transport)['network_requests'] == 0


def test_monthly_coverage_chunks_resume_unattempted_instruments_with_same_clock(tmp_path):
    path = tmp_path / 'market.sqlite3'
    rolling_enrolled(path)
    transport = FakeTransport()
    for index in range(3):
        result = refresh_due(path, MONTHLY_CONFIG, NOW, transport, clock=lambda: 0, coverage_limit=1)['providers']['marketstack']
        assert result['status'] == 'refreshed' and result['quota_units'] == result['updated'] == 1
        assert result['remaining_due'] == 99 - index and result['failures'] == []
    assert [call[1]['symbols'] for call in transport.calls] == ['AAPL', 'MSFT', 'NVDA']
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 3


def test_monthly_deadline_preserves_progress_and_next_job_only_resumes_untouched_members(tmp_path):
    path = tmp_path / 'market.sqlite3'
    rolling_enrolled(path)
    transport = FakeTransport()
    clock = Mock(side_effect=[0, 0, 481, 481, 481])
    first = refresh_due(path, MONTHLY_CONFIG, NOW, transport, clock=clock)['providers']['marketstack']
    assert first['quota_units'] == first['updated'] == 2 and first['failures'] == ['deadline']
    assert transport.calls[0][1]['symbols'] == 'AAPL,MSFT'
    second = refresh_due(path, MONTHLY_CONFIG, NOW + timedelta(seconds=482), transport,
                         clock=lambda: 0, coverage_limit=2)['providers']['marketstack']
    assert second['quota_units'] == second['updated'] == 2 and second['failures'] == []
    assert transport.calls[1][1]['symbols'] == 'NVDA,AMZN'
    assert read_status(path, now=NOW + timedelta(seconds=482))['providers']['marketstack']['used'] == 4


@pytest.mark.parametrize('limit', [0, 101, -1, True, 1.5, '10'])
def test_invalid_coverage_limit_fails_before_any_network_or_ledger_work(tmp_path, limit):
    path = tmp_path / 'missing.sqlite3'
    transport = FakeTransport()
    with pytest.raises(ValueError):
        refresh_due(path, MONTHLY_CONFIG, NOW, transport, coverage_limit=limit)
    assert not transport.calls and not path.exists()


def test_monthly_prioritizes_missing_catalog_members_over_existing_not_due_cache(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    refresh_due(path, STOCK_CONFIG | {'MARKETSTACK_PROFILE': 'weekly-15'}, NOW, FakeTransport(), clock=lambda: 0)
    authorize_rolling_budget(path, 'marketstack', NOW, NOW + timedelta(days=32), expected_used=15, now=NOW)
    transport = FakeTransport()
    result = refresh_due(path, MONTHLY_CONFIG, NOW, transport, coverage_limit=2)['providers']['marketstack']
    assert result['quota_units'] == 2
    assert set(transport.calls[0][1]['symbols'].split(',')) <= {item.symbol for item in STOCKS[15:]}


def test_expired_period_does_not_roll_over_or_make_requests(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    transport = FakeTransport()
    report = refresh_due(path, STOCK_CONFIG, datetime(2026, 11, 3, tzinfo=timezone.utc), transport)
    assert report['providers']['marketstack']['status'] == 'period_expired'
    assert not transport.calls


def test_exhausted_stock_provider_does_not_prevent_fx(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path, used=90)
    enrolled(path, 'exchangerate_host')
    transport = FakeTransport()
    report = refresh_due(path, STOCK_CONFIG | FX_CONFIG, NOW, transport)
    assert report['providers']['marketstack']['network_requests'] == 0
    assert report['providers']['exchangerate_host']['network_requests'] == 1


def test_status_is_read_only_even_with_enabled_flags(tmp_path, monkeypatch, capsys):
    path = tmp_path / 'missing' / 'market.sqlite3'
    monkeypatch.setenv('MARKETSTACK_ENABLED', '1')
    monkeypatch.setenv('MARKETSTACK_API_KEY', SECRET)
    with patch('scripts.refresh_market_data.VendorTransport', side_effect=AssertionError('No network')):
        assert main(['--database', str(path), '--status']) == 0
    assert json.loads(capsys.readouterr().out)['status'] == 'ledger_missing'
    assert not path.parent.exists()


def test_database_configuration_honors_explicit_path(tmp_path, monkeypatch):
    monkeypatch.delenv('MARKET_DATA_DB', raising=False)
    assert configured_database(tmp_path) == tmp_path / 'vendor-market-data.sqlite3'
    monkeypatch.setenv('MARKET_DATA_DB', str(tmp_path / 'custom.sqlite3'))
    assert configured_database(tmp_path) == tmp_path / 'custom.sqlite3'


def test_transport_has_fixed_hosts_no_proxy_no_redirect_no_retry():
    transport = _WorkerTransfer()
    assert transport.session.trust_env is False
    assert transport.session.adapters['https://'].max_retries.total == 0
    response = Mock()
    response.status_code = 200
    response.headers = {}
    response.iter_content.return_value = [b'{"success":true}']
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    with patch.object(transport.session, 'get', return_value=response) as get:
        assert _decode_payload(transport.get_body('marketstack', {'access_key': SECRET})) == {'success': True}
    assert get.call_args.args[0] == 'https://api.marketstack.com/v2/eod'
    assert get.call_args.kwargs['allow_redirects'] is False
    assert get.call_args.kwargs['stream'] is True
    assert get.call_args.kwargs['timeout'] == (3, 5)
    transport.close()


@pytest.mark.parametrize('mode,expected', [('redirect', 'http_error'), ('large', 'response_too_large'),
                                         ('stream', 'response_too_large'), ('malformed', 'invalid_response'),
                                         ('timeout', 'network_error'), ('deadline', 'deadline')])
def test_transport_failure_paths_are_bounded_and_redacted(mode, expected):
    transport = _WorkerTransfer()
    response = Mock()
    response.status_code = 302 if mode == 'redirect' else 200
    response.headers = {'Content-Length': '999999999'} if mode == 'large' else {}
    response.iter_content.return_value = ([b'x' * (2 * 1024 * 1024 + 1)] if mode == 'stream' else
                                          [SECRET.encode()] if mode == 'malformed' else [b'{}'])
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    with patch.object(transport.session, 'get', side_effect=requests.Timeout(SECRET) if mode == 'timeout' else None,
                      return_value=response), patch('scripts.refresh_market_data.time.monotonic',
                                                   side_effect=[0, 21] if mode == 'deadline' else None,
                                                   return_value=0):
        with pytest.raises(FetchError, match=expected) as error:
            _decode_payload(transport.get_body('marketstack', {'access_key': SECRET}))
    assert SECRET not in str(error.value)
    transport.close()


def test_disable_flag_stops_new_work_and_keeps_cached_history(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    refresh_due(path, STOCK_CONFIG, NOW, FakeTransport())
    before = read_instrument(path, STOCKS[0].id, now=NOW)
    transport = FakeTransport(failure=AssertionError('Disabled path made a call'))
    report = refresh_due(path, {'MARKETSTACK_ENABLED': '0', 'MARKETSTACK_API_KEY': SECRET},
                         NOW + timedelta(days=1), transport)
    assert report['status'] == 'disabled' and not transport.calls
    assert read_instrument(path, STOCKS[0].id, now=NOW) == before
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 3


def test_network_completion_after_lease_expiry_cannot_commit_and_is_charged(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    clock = Mock(side_effect=[0, 0, 601, 601])
    transport = FakeTransport()
    report = refresh_due(path, STOCK_CONFIG, NOW, transport, clock=clock)
    assert report['network_requests'] == 1 and len(transport.calls) == 1
    assert report['providers']['marketstack']['failures'] == ['lease_lost']
    assert list_instruments(path, 'stock', now=NOW) == []
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 2


def test_run_deadline_stops_before_network_reservation(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    clock = Mock(side_effect=[0, 481, 481])
    transport = FakeTransport()
    report = refresh_due(path, STOCK_CONFIG, NOW, transport, clock=clock)
    assert report['network_requests'] == 0 and not transport.calls
    assert report['providers']['marketstack']['failures'] == ['deadline']
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 0


def test_fx_available_snapshot_preserves_unreturned_prior_quote_history(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path, 'exchangerate_host')
    refresh_due(path, FX_CONFIG, NOW, FakeTransport())
    before = list_instruments(path, 'fx', now=NOW)
    payload = fx_payload('2026-10-23')
    payload['quotes'].pop('USDMNT')
    report = refresh_due(path, FX_CONFIG, NOW + timedelta(days=1), FakeTransport(payload=payload))
    assert report['providers']['exchangerate_host']['status'] == 'refreshed'
    assert report['providers']['exchangerate_host']['updated'] == 19
    assert len(list_instruments(path, 'fx', now=NOW)) == len(before)
    assert read_instrument(path, 'fx-USD-MNT', now=NOW)['latest_date'] == '2026-10-22'
    assert read_status(path, now=NOW)['providers']['exchangerate_host']['used'] == 2


def test_malformed_stream_json_does_not_expose_vendor_error_content():
    transport = _WorkerTransfer()
    response = Mock(status_code=200, headers={})
    response.iter_content.return_value = [b'{"error":"' + SECRET.encode() + b'","value":NaN}']
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    with patch.object(transport.session, 'get', return_value=response):
        with pytest.raises(FetchError, match='invalid_response') as error:
            _decode_payload(transport.get_body('marketstack', {'access_key': SECRET}))
    assert SECRET not in str(error.value)
    transport.close()


def test_subprocess_credentials_only_use_stdin_and_environment_is_minimal(monkeypatch):
    monkeypatch.setenv('UNRELATED_PRIVATE_KEY', 'synthetic-must-not-be-inherited')
    child = Mock(returncode=0)
    child.poll.return_value = 0
    child.communicate.return_value = (b'OK\n{"success":true}', None)
    with patch('scripts.refresh_market_data.subprocess.Popen', return_value=child) as spawn:
        assert VendorTransport().get_json('marketstack', {'access_key': SECRET}) == {'success': True}
    command = spawn.call_args.args[0]
    worker_path = Path(__file__).resolve().parents[1] / 'scripts' / 'refresh_market_data.py'
    assert command == [sys.executable, str(worker_path), '--transport-worker']
    assert SECRET not in ' '.join(command)
    env = spawn.call_args.kwargs['env']
    assert set(env) == {'PATH', 'PYTHONDONTWRITEBYTECODE', 'LANG'}
    assert 'UNRELATED_PRIVATE_KEY' not in env
    assert spawn.call_args.kwargs['stderr'] is subprocess.DEVNULL
    assert SECRET.encode() in child.communicate.call_args.kwargs['input']
    assert child.communicate.call_args.kwargs['timeout'] <= 20
    child.stdin.close.assert_called_once()
    child.stdout.close.assert_called_once()


@pytest.mark.parametrize('prefix,expected', [(b'ERR\nhttp_error', 'http_error'),
                                            (b'ERR\n' + SECRET.encode(), 'network_error'),
                                            (b'garbled', 'network_error'),
                                            (b'OK\n{"value":NaN}', 'invalid_response')])
def test_subprocess_error_protocol_never_exposes_child_content(prefix, expected):
    child = Mock(returncode=0)
    child.poll.return_value = 0
    child.communicate.return_value = (prefix, None)
    with patch('scripts.refresh_market_data.subprocess.Popen', return_value=child):
        with pytest.raises(FetchError, match=expected) as error:
            VendorTransport().get_json('marketstack', {'access_key': SECRET})
    assert SECRET not in str(error.value)


def _blocking_worker(tmp_path, mode):
    """A real child blocked in pre-header work or a socket-backed chunk read.

    No provider or external socket is contacted. The slow-body case reproduces
    an 8192-byte buffered read kept alive by bytes arriving below idle timeout.
    """
    worker = tmp_path / f'blocking-{mode}.py'
    marker = tmp_path / f'reached-{mode}'
    worker.write_text('''
import socket
import sys
import threading
import time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from scripts import refresh_market_data as refresh
mode, marker = sys.argv[2], Path(sys.argv[3])
class Response:
    status_code = 200
    headers = {}
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def iter_content(self, chunk_size):
        receiver, sender = socket.socketpair()
        receiver.settimeout(0.1)
        def drip():
            while True:
                sender.sendall(b'x')
                time.sleep(0.02)
        threading.Thread(target=drip, daemon=True).start()
        marker.write_text('body')
        with receiver.makefile('rb') as body:
            yield body.read(chunk_size)
class Session:
    def mount(self, *args): pass
    def close(self): pass
    def get(self, *args, **kwargs):
        if mode == 'body': return Response()
        marker.write_text(mode)
        if mode == 'dns':
            socket.getaddrinfo = lambda *args, **kwargs: time.sleep(60)
            socket.getaddrinfo('fixed.test', 443)
        else:
            time.sleep(60)
refresh.requests.Session = Session
raise SystemExit(refresh._transport_worker())
''')
    return worker, marker


def _spawn_blocking_worker(tmp_path, mode, monkeypatch):
    from scripts import refresh_market_data as refresh
    worker, marker = _blocking_worker(tmp_path, mode)
    real_popen, children = subprocess.Popen, []

    def spawn(command, **kwargs):
        assert command[2:] == ['--transport-worker']
        child = real_popen([sys.executable, str(worker), str(refresh.ROOT), mode, str(marker)], **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(refresh, 'REQUEST_SECONDS', 2.0)
    monkeypatch.setattr(refresh.subprocess, 'Popen', spawn)
    return marker, children


@pytest.mark.parametrize('mode', ['dns', 'headers', 'body'])
def test_hard_deadline_kills_and_reaps_real_blocked_worker(tmp_path, monkeypatch, mode):
    marker, children = _spawn_blocking_worker(tmp_path, mode, monkeypatch)
    started = time.monotonic()
    with pytest.raises(FetchError, match='deadline'):
        VendorTransport().get_json('marketstack', {'access_key': SECRET})
    elapsed = time.monotonic() - started
    assert marker.read_text() == mode  # Child entered the actual blocked phase.
    assert 1.9 <= elapsed < 5
    assert len(children) == 1 and children[0].returncode < 0
    with pytest.raises(ChildProcessError):
        os.waitpid(children[0].pid, os.WNOHANG)  # Already reaped; no orphan worker.


def test_hard_timeout_keeps_reservations_charged_and_does_not_retry(tmp_path, monkeypatch):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    _, children = _spawn_blocking_worker(tmp_path, 'body', monkeypatch)
    report = refresh_due(path, STOCK_CONFIG, NOW, VendorTransport())
    assert report['network_requests'] == len(children) == 2
    assert report['providers']['marketstack']['failures'] == ['deadline'] * 3
    assert all(child.returncode < 0 for child in children)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 3
    assert list_instruments(path, 'stock', now=NOW) == []


@pytest.mark.parametrize('day', ['2026-10-25', '2026-10-26'])
def test_daily_stocks_skip_weekend_closing_dates_without_reservation(tmp_path, day):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    transport = FakeTransport()
    now = datetime.fromisoformat(day + 'T06:30:00+00:00')
    report = refresh_due(path, STOCK_CONFIG, now, transport)
    assert report['providers']['marketstack']['status'] == 'non_trading_day'
    assert report['network_requests'] == 0 and not transport.calls
    assert read_status(path, now=now)['providers']['marketstack']['used'] == 0


def test_daily_stocks_fit_31_day_period_without_spending_weekend_units(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    transport = FakeTransport()
    start = datetime(2026, 10, 1, 6, 30, tzinfo=timezone.utc)
    reports = [refresh_due(path, STOCK_CONFIG, start + timedelta(days=day), transport) for day in range(31)]
    eligible = sum((start.date() + timedelta(days=day - 1)).weekday() < 5 for day in range(31))
    assert len(transport.calls) == eligible + 1 == 24
    assert all(date.fromisoformat(call[1]['date_to']).weekday() < 5 for call in transport.calls)
    assert all('quota_exhausted' not in report['providers']['marketstack'].get('failures', []) for report in reports)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 69


def test_interrupted_parent_kills_reaps_worker_and_closes_pipes():
    child = Mock()
    child.poll.return_value = None
    child.communicate.side_effect = [KeyboardInterrupt(), (b'', None)]
    with patch('scripts.refresh_market_data.subprocess.Popen', return_value=child):
        with pytest.raises(KeyboardInterrupt):
            VendorTransport().get_json('marketstack', {'access_key': SECRET})
    child.kill.assert_called_once()
    assert child.communicate.call_count == 2
    child.stdin.close.assert_called_once()
    child.stdout.close.assert_called_once()


def test_real_worker_rejects_invalid_pipe_input_without_echo_or_network():
    worker_path = Path(__file__).resolve().parents[1] / 'scripts' / 'refresh_market_data.py'
    result = subprocess.run([sys.executable, str(worker_path), '--transport-worker'],
                            input=SECRET.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env={'PATH': os.defpath, 'PYTHONDONTWRITEBYTECODE': '1', 'LANG': 'C.UTF-8'},
                            timeout=5)
    assert result.returncode == 1
    assert result.stdout == b'ERR\ninvalid_response'
    assert result.stderr == b''
    assert SECRET.encode() not in result.stdout


def _process_has_exited(pid):
    """An orphan may briefly be a zombie until the OS reaps it; it cannot work."""
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'stat='],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            text=True, timeout=2)
    state = result.stdout.strip()
    return not state or state.startswith('Z')


def test_worker_independent_timer_exits_after_parent_sigterm_and_keeps_charge(tmp_path):
    from scripts import refresh_market_data as refresh
    import signal

    path = tmp_path / 'market.sqlite3'
    enrolled(path)
    worker, ready = _blocking_worker(tmp_path, 'body')
    # The same internal entry point arms the independent timer before stdin or
    # the socket-backed body. A short test-only constant keeps the test fast.
    worker.write_text(worker.read_text().replace('refresh.requests.Session = Session',
                                                 'refresh.REQUEST_SECONDS = 0.8\nrefresh.requests.Session = Session'))
    pid_file = tmp_path / 'orphan-worker.pid'
    parent_script = tmp_path / 'parent-refresh.py'
    parent_script.write_text('''
import json
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from scripts import refresh_market_data as refresh
job = json.loads(sys.stdin.buffer.read())
real_popen = subprocess.Popen
worker, ready, pid_file = sys.argv[2:5]
def spawn(command, **kwargs):
    child = real_popen([sys.executable, worker, str(refresh.ROOT), 'body', ready], **kwargs)
    Path(pid_file).write_text(str(child.pid))
    return child
refresh.subprocess.Popen = spawn
refresh.refresh_due(job['database'], job['config'], job['now'], refresh.VendorTransport())
''')
    child_pid = None
    parent = subprocess.Popen([sys.executable, str(parent_script), str(refresh.ROOT),
                               str(worker), str(ready), str(pid_file)],
                              stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              env={'PATH': os.defpath, 'PYTHONDONTWRITEBYTECODE': '1', 'LANG': 'C.UTF-8'})
    try:
        job = dict(database=str(path), config=STOCK_CONFIG, now=NOW.isoformat())
        parent.stdin.write(json.dumps(job).encode())
        parent.stdin.close()
        until_ready = time.monotonic() + 5
        while not ready.exists() and time.monotonic() < until_ready:
            assert parent.poll() is None
            time.sleep(0.01)
        assert ready.read_text() == 'body'
        child_pid = int(pid_file.read_text())
        assert not _process_has_exited(child_pid)
        parent.send_signal(signal.SIGTERM)
        assert parent.wait(timeout=2) == -signal.SIGTERM
        killed_at = time.monotonic()
        while not _process_has_exited(child_pid) and time.monotonic() - killed_at < 2:
            time.sleep(0.02)
        assert _process_has_exited(child_pid)
        assert time.monotonic() - killed_at < 2
        assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 2
        assert list_instruments(path, 'stock', now=NOW) == []
    finally:
        if parent.poll() is None:
            parent.kill()
            parent.wait(timeout=2)
        if child_pid is None and pid_file.exists():
            child_pid = int(pid_file.read_text())
        if child_pid is not None and not _process_has_exited(child_pid):
            os.kill(child_pid, signal.SIGKILL)
        if parent.stdin is not None:
            parent.stdin.close()


def test_worker_timer_unavailable_fails_closed_before_stdin_or_transfer():
    from scripts import refresh_market_data as refresh
    code = '''
import sys
sys.path.insert(0, sys.argv[1])
from scripts import refresh_market_data as refresh
def unavailable(*args): raise OSError('No timer')
refresh.signal.setitimer = unavailable
refresh._transport_worker()
'''
    result = subprocess.run([sys.executable, '-c', code, str(refresh.ROOT)],
                            input=b'{}', stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env={'PATH': os.defpath, 'PYTHONDONTWRITEBYTECODE': '1', 'LANG': 'C.UTF-8'},
                            timeout=5)
    assert result.returncode == 1
    assert result.stdout == result.stderr == b''



def test_one_time_initial_grants_fetch_only_fifteen_stocks_and_one_fx_then_stop(tmp_path):
    path = tmp_path / 'market.sqlite3'
    for provider, limit in (('marketstack', 15), ('exchangerate_host', 1)):
        enroll_initial_provider(path, provider, NOW, NOW + timedelta(hours=24), limit, 0, now=NOW)
    config = STOCK_CONFIG | FX_CONFIG | {'MARKETSTACK_PROFILE': 'weekly-15'}
    transport = FakeTransport()
    report = refresh_due(path, config, NOW, transport)
    assert report['network_requests'] == 9 and len(transport.calls) == 9
    assert report['providers']['marketstack']['updated'] == 15
    assert report['providers']['exchangerate_host']['updated'] == 20
    assert len(list_instruments(path, 'stock', now=NOW)) == 15
    assert len(list_instruments(path, 'fx', now=NOW)) == 20
    status = read_status(path, now=NOW)['providers']
    assert status['marketstack']['used'] == status['marketstack']['limit'] == 15
    assert status['exchangerate_host']['used'] == status['exchangerate_host']['limit'] == 1
    for offset in (timedelta(minutes=1), timedelta(hours=24), timedelta(days=7), timedelta(days=60)):
        assert refresh_due(path, config, NOW + offset, transport)['network_requests'] == 0
    assert len(transport.calls) == 9
    for provider in ('marketstack', 'exchangerate_host'):
        expired = read_status(path, now=NOW + timedelta(days=60))['providers'][provider]
        assert expired['status'] == 'application_grant_expired' and expired['remaining'] == 0


def test_initial_failed_calls_consume_fifteen_and_one_units_without_retry_or_renewal(tmp_path):
    path = tmp_path / 'market.sqlite3'
    for provider, limit in (('marketstack', 15), ('exchangerate_host', 1)):
        enroll_initial_provider(path, provider, NOW, NOW + timedelta(hours=24), limit, 0, now=NOW)
    transport = FakeTransport(failure=requests.Timeout('synthetic failure'))
    config = STOCK_CONFIG | FX_CONFIG | {'MARKETSTACK_PROFILE': 'weekly-15'}
    report = refresh_due(path, config, NOW, transport)
    assert report['network_requests'] == 9
    assert report['providers']['marketstack']['failures'] == ['network_error'] * 15
    assert report['providers']['exchangerate_host']['failures'] == ['network_error']
    assert refresh_due(path, config, NOW + timedelta(days=7), transport)['network_requests'] == 0
    for provider, limit in (('marketstack', 15), ('exchangerate_host', 1)):
        assert read_status(path, now=NOW)['providers'][provider]['used'] == limit
        with pytest.raises(StoreError, match='initial_grant_not_renewable'):
            enroll_provider(path, provider, NOW + timedelta(days=7), NOW + timedelta(days=8), 90, 0,
                            now=NOW + timedelta(days=7))
    assert len(transport.calls) == 9
    assert list_instruments(path, 'stock', now=NOW) == list_instruments(path, 'fx', now=NOW) == []


def test_expired_initial_grant_fails_before_any_provider_transport(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll_initial_provider(path, 'marketstack', NOW, NOW + timedelta(hours=1), 15, 0, now=NOW)
    transport = FakeTransport(failure=AssertionError('Expired grant made a request'))
    report = refresh_due(path, STOCK_CONFIG, NOW + timedelta(hours=1), transport)
    assert report['providers']['marketstack']['status'] == 'application_grant_expired'
    assert report['network_requests'] == 0 and not transport.calls


def test_initial_enrollment_cli_and_status_never_construct_transport(tmp_path, monkeypatch, capsys):
    path = tmp_path / 'market.sqlite3'
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=1)
    monkeypatch.setenv('MARKETSTACK_ENABLED', '1')
    monkeypatch.setenv('MARKETSTACK_API_KEY', SECRET)
    with patch('scripts.refresh_market_data.VendorTransport', side_effect=AssertionError('No transport')):
        assert main(['--database', str(path), '--enroll-initial-provider', 'marketstack',
                     '--application-valid-from', now.isoformat(), '--application-expires-at', expires.isoformat(),
                     '--limit', '15', '--already-used', '0']) == 0
        assert json.loads(capsys.readouterr().out)['status'] == 'application_grant_enrolled'
        before = path.read_bytes()
        assert main(['--database', str(path), '--status']) == 0
        report = json.loads(capsys.readouterr().out)
        assert report['network_requests'] == 0
        assert report['providers']['marketstack']['status'] == 'application_grant'
        assert not {'period_start', 'period_end'} & report['providers']['marketstack'].keys()
        assert path.read_bytes() == before


@pytest.mark.parametrize('options', [
    ['--status', '--enroll-initial-provider', 'marketstack'],
    ['--enroll-provider', 'marketstack', '--enroll-initial-provider', 'marketstack'],
    ['--enroll-initial-provider', 'marketstack', '--period-start', '2026-10-01T00:00:00Z'],
    ['--enroll-provider', 'marketstack', '--application-valid-from', NOW.isoformat()],
    ['--enroll-initial-provider', 'marketstack', '--limit', '15', '--already-used', '0'],
    ['--application-expires-at', (NOW + timedelta(hours=1)).isoformat()],
    ['--period-start', NOW.isoformat()], ['--limit', '15'], ['--status', '--already-used', '0'],
])
def test_cli_enrollment_modes_and_date_types_are_exclusive_before_transport(tmp_path, monkeypatch, options):
    path = tmp_path / 'missing' / 'market.sqlite3'
    monkeypatch.setenv('MARKETSTACK_ENABLED', '1')
    monkeypatch.setenv('MARKETSTACK_API_KEY', SECRET)
    with patch('scripts.refresh_market_data.VendorTransport', side_effect=AssertionError('No transport')):
        with pytest.raises(SystemExit) as error:
            main(['--database', str(path)] + options)
    assert error.value.code == 2
    assert not path.parent.exists()
