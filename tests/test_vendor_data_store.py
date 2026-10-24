"""Durable vendor budgets and cache fencing, entirely on isolated SQLite files."""
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

from scripts.market_data_catalog import STOCKS
from scripts.vendor_data_store import (
    APPLICATION_ID, INITIAL_STOCK_RECOVERY_KEY, LEDGER_SCHEMA_VERSION, SCHEMA_VERSION, StoreError,
    authorize_rolling_budget, reserve_batch,
    begin_initial_stock_recovery, begin_job, enroll_initial_provider, enroll_provider, finish_job, last_attempt,
    list_instruments, mark_failure, read_instrument, read_status,
    reserve_call, save_observations,
)

NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
START, END = '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'
IDENTIFIER = STOCKS[0].id


def enroll(path, provider='marketstack', limit=90, used=0):
    enroll_provider(path, provider, START, END, limit, used, now=NOW)


def reserved(path, key='fixture', now=NOW):
    token = begin_job(path, 'marketstack', key, now=now)
    reservation = reserve_call(path, token, key + ':aapl', IDENTIFIER, now=now)
    return token, reservation


def save(path, token, reservation, points=None, now=NOW):
    save_observations(path, token, reservation,
                      {IDENTIFIER: points or [{'date': '2026-10-22', 'value': 10, 'close': 10}]},
                      now=now, refresh_days=7)


def test_missing_cache_reads_do_not_create_database_or_parent(tmp_path):
    path = tmp_path / 'absent' / 'market.sqlite3'
    assert list_instruments(path, 'stock') == []
    assert read_instrument(path, IDENTIFIER) is None
    assert read_status(path)['status'] == 'ledger_missing'
    with pytest.raises(StoreError, match='ledger_missing'):
        begin_job(path, 'marketstack', 'test', now=NOW)
    assert not path.parent.exists()


def test_explicit_enrollment_preserves_baseline_across_restarts(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path, used=88)
    token, reservation = reserved(path)
    mark_failure(path, token, reservation, 'network_error', now=NOW)
    finish_job(path, token, now=NOW)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 89
    token, _ = reserved(path, 'restart')
    with pytest.raises(StoreError, match='quota_exhausted'):
        reserve_call(path, token, 'one-too-many', IDENTIFIER, now=NOW)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 90


@pytest.mark.parametrize('initial', [False, True])
def test_final_unit_is_atomic_across_separate_processes(tmp_path, initial):
    path = tmp_path / 'market.sqlite3'
    if initial:
        enroll_initial_provider(path, 'marketstack', NOW, NOW + timedelta(hours=1), 90, 89, now=NOW)
    else:
        enroll(path, used=89)
    token = begin_job(path, 'marketstack', 'concurrent', now=NOW)
    code = '''
import sys
from scripts.vendor_data_store import reserve_call, StoreError
try:
 reserve_call(sys.argv[1],sys.argv[2],sys.argv[3],'stock-XNAS-AAPL',now='2026-10-23T12:00:00Z')
 print('reserved')
except StoreError as exc:
 print(str(exc))
'''
    workers = [subprocess.Popen([sys.executable, '-c', code, str(path), token, f'call-{i}'],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}) for i in range(2)]
    results = [worker.communicate(timeout=20) for worker in workers]
    assert all(worker.returncode == 0 for worker in workers), results
    assert sorted(out.strip() for out, _ in results) == ['quota_exhausted', 'reserved']
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 90


def test_duplicate_job_provider_lock_and_call_suppression(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, _ = reserved(path)
    with pytest.raises(StoreError, match='already_running'):
        begin_job(path, 'marketstack', 'different', now=NOW)
    with pytest.raises(StoreError, match='duplicate_job'):
        begin_job(path, 'marketstack', 'fixture', now=NOW)
    with pytest.raises(StoreError, match='duplicate_call'):
        reserve_call(path, token, 'fixture:aapl', IDENTIFIER, now=NOW)
    finish_job(path, token, now=NOW)
    with pytest.raises(StoreError, match='duplicate_job'):
        begin_job(path, 'marketstack', 'fixture', now=NOW + timedelta(hours=1))
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 1


def test_expired_lease_cannot_reserve_or_commit_after_successor(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    old, reservation = reserved(path)
    later = NOW + timedelta(minutes=11)
    new = begin_job(path, 'marketstack', 'successor', now=later)
    for action in (lambda: reserve_call(path, old, 'stale', IDENTIFIER, now=later),
                   lambda: save(path, old, reservation, now=later)):
        with pytest.raises(StoreError, match='lease_lost'):
            action()
    finish_job(path, old, now=later)
    new_reservation = reserve_call(path, new, 'valid', IDENTIFIER, now=later)
    save(path, new, new_reservation, now=later)
    assert read_instrument(path, IDENTIFIER, now=later)['latest_value'] == 10
    assert read_status(path, now=later)['providers']['marketstack']['used'] == 2


def test_provider_budgets_and_locks_are_independent(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path, used=89)
    enroll(path, 'exchangerate_host', used=20)
    stock_token, _ = reserved(path)
    fx_token = begin_job(path, 'exchangerate_host', 'fx', now=NOW)
    reserve_call(path, fx_token, 'fx-call', 'fx-USD-EUR', now=NOW)
    assert read_status(path, now=NOW)['providers']['exchangerate_host']['used'] == 21
    with pytest.raises(StoreError, match='quota_exhausted'):
        reserve_call(path, stock_token, 'extra', IDENTIFIER, now=NOW)


@pytest.mark.parametrize('limit,used', [(91, 0), (0, 0), (90, -1), (90, 91), (True, 0), (90, True)])
def test_invalid_enrollment_fails_before_creating_db(tmp_path, limit, used):
    path = tmp_path / 'market.sqlite3'
    with pytest.raises(StoreError, match='invalid_enrollment'):
        enroll(path, limit=limit, used=used)
    assert not path.exists()


def test_overlap_and_repeat_enrollment_cannot_reset_reservations(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path, used=10)
    reserved(path)
    for start in (START, '2026-10-22T00:00:00Z'):
        with pytest.raises(StoreError, match='period_overlap'):
            enroll_provider(path, 'marketstack', start, END, 90, 0, now=NOW)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 11


def test_period_expiry_stops_until_explicit_verified_renewal(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    reserved(path)
    later = datetime(2026, 11, 1, tzinfo=timezone.utc)
    with pytest.raises(StoreError, match='period_expired'):
        begin_job(path, 'marketstack', 'november', now=later)
    assert read_status(path, now=later)['providers']['marketstack']['status'] == 'period_expired'
    enroll_provider(path, 'marketstack', END, '2026-12-01T00:00:00Z', 90, 7, now=later)
    token = begin_job(path, 'marketstack', 'november', now=later)
    reserve_call(path, token, 'nov-call', IDENTIFIER, now=later)
    assert read_status(path, now=later)['providers']['marketstack']['used'] == 8
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM reservations').fetchone()[0] == 2
        assert conn.execute('SELECT COUNT(*) FROM periods').fetchone()[0] == 2


def test_uninitialized_database_fails_closed_and_preserves_unrelated_tables(tmp_path):
    path = tmp_path / 'unrelated.sqlite3'
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE personal (value TEXT)')
        conn.execute("INSERT INTO personal VALUES ('keep')")
    with pytest.raises(StoreError, match='ledger_uninitialized'):
        begin_job(path, 'marketstack', 'test', now=NOW)
    with pytest.raises(StoreError, match='ledger_uninitialized'):
        enroll(path)
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT value FROM personal').fetchone()[0] == 'keep'
        assert conn.execute("SELECT name FROM sqlite_master WHERE name='periods'").fetchone() is None


def test_atomic_merge_revisions_and_safe_public_contract(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, reservation = reserved(path)
    save(path, token, reservation)
    finish_job(path, token, now=NOW)
    later = NOW + timedelta(days=1)
    token, reservation = reserved(path, 'second', now=later)
    save(path, token, reservation, [{'date': '2026-10-22', 'value': 11},
                                  {'date': '2026-10-23', 'value': 12}], now=later)
    result = read_instrument(path, IDENTIFIER, now=later)
    assert [(p['date'], p['value']) for p in result['observations']] == [('2026-10-22', 11), ('2026-10-23', 12)]
    assert result['latest_value'] == 12
    assert result['currency'] == 'USD' and result['frequency'] == 'daily' and result['refresh_days'] == 7
    assert result['stale'] is False
    assert list_instruments(path, 'fx', now=later) == []
    assert 'observations' not in list_instruments(path, 'stock', now=later)[0]
    assert not {'unit_limit', 'already_used', 'token', 'access_key', 'quota', 'used'} & result.keys()
    assert result['source_url'] == 'https://marketstack.com/'


@pytest.mark.parametrize('bad', [float('nan'), float('inf'), True, -1, None, '10'])
def test_invalid_observation_rolls_back_entire_batch(tmp_path, bad):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, reservation = reserved(path)
    save(path, token, reservation)
    finish_job(path, token, now=NOW)
    token, reservation = reserved(path, 'invalid')
    with pytest.raises(StoreError, match='invalid_observations'):
        save(path, token, reservation, [{'date': '2026-10-21', 'value': 999},
                                      {'date': '2026-10-22', 'value': bad}])
    assert read_instrument(path, IDENTIFIER, now=NOW)['latest_value'] == 10
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 2


def test_success_cannot_be_committed_twice_or_to_another_ticker(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, reservation = reserved(path)
    with pytest.raises(StoreError, match='invalid_reservation'):
        save_observations(path, token, reservation, {STOCKS[1].id: [{'date': '2026-10-22', 'value': 1}]}, now=NOW)
    save(path, token, reservation)
    with pytest.raises(StoreError, match='invalid_reservation'):
        save(path, token, reservation)


def test_staleness_uses_both_source_date_and_refresh_success(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, reservation = reserved(path)
    save(path, token, reservation, [{'date': '2026-10-01', 'value': 1}])
    assert read_instrument(path, IDENTIFIER, now=NOW)['stale'] is True
    assert last_attempt(path, 'marketstack', IDENTIFIER) == NOW


def test_cache_retention_is_bounded_to_new_cache_and_preserves_other_instruments(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, reservation = reserved(path)
    first = NOW.date() - timedelta(days=1199)
    points = [{'date': (first + timedelta(days=i)).isoformat(), 'value': i + 1} for i in range(1000)]
    save(path, token, reservation, points)
    more = [{'date': (first + timedelta(days=i)).isoformat(), 'value': i + 1} for i in range(1000, 1200)]
    reservation = reserve_call(path, token, 'more', IDENTIFIER, now=NOW)
    save(path, token, reservation, more)
    second = STOCKS[1].id
    reservation = reserve_call(path, token, 'second-stock', second, now=NOW)
    save_observations(path, token, reservation, {second: [{'date': '2026-10-22', 'value': 20}]}, now=NOW)
    observed = read_instrument(path, IDENTIFIER, now=NOW)['observations']
    assert len(observed) == 1100 and observed[0]['value'] == 101 and observed[-1]['value'] == 1200
    assert read_instrument(path, second, now=NOW)['latest_value'] == 20


def test_configured_directory_alias_is_allowed_but_database_symlink_is_not(tmp_path):
    target = tmp_path / 'state'
    target.mkdir()
    alias = tmp_path / 'configured'
    alias.symlink_to(target, target_is_directory=True)
    path = alias / 'market.sqlite3'
    enroll(path)
    token, reservation = reserved(path)
    save(path, token, reservation)
    assert read_instrument(path, IDENTIFIER, now=NOW)['latest_value'] == 10
    linked_db = tmp_path / 'linked.sqlite3'
    linked_db.symlink_to(target / 'market.sqlite3')
    with pytest.raises(StoreError, match='unsafe_database_path'):
        read_instrument(linked_db, IDENTIFIER)


@pytest.mark.parametrize('duration,limit,used', [
    (timedelta(hours=24, seconds=1), 90, 0), (timedelta(0), 90, 0),
    (timedelta(hours=1), 91, 0), (timedelta(hours=1), True, 0),
    (timedelta(hours=1), 15, -1), (timedelta(hours=1), 15, 16),
    (timedelta(hours=1), 15, True),
])
def test_initial_application_grant_is_bounded_before_database_creation(tmp_path, duration, limit, used):
    path = tmp_path / 'missing' / 'market.sqlite3'
    with pytest.raises(StoreError, match='invalid_enrollment'):
        enroll_initial_provider(path, 'marketstack', NOW, NOW + duration, limit, used, now=NOW)
    assert not path.parent.exists()


@pytest.mark.parametrize('offset', [timedelta(seconds=1), timedelta(hours=-2)])
def test_initial_application_grant_must_be_current(tmp_path, offset):
    path = tmp_path / 'market.sqlite3'
    with pytest.raises(StoreError, match='invalid_enrollment'):
        enroll_initial_provider(path, 'marketstack', NOW + offset, NOW + offset + timedelta(hours=1),
                                15, 0, now=NOW)
    assert not path.exists()


def test_initial_grant_failure_restart_expiry_and_enrollment_cannot_reset_allowance(tmp_path):
    path = tmp_path / 'market.sqlite3'
    expires = NOW + timedelta(hours=24)
    enroll_initial_provider(path, 'marketstack', NOW, expires, 3, 1, now=NOW)
    token, reservation = reserved(path)
    mark_failure(path, token, reservation, 'network_error', now=NOW)
    finish_job(path, token, now=NOW)
    token, _ = reserved(path, 'restart', now=NOW + timedelta(minutes=1))
    with pytest.raises(StoreError, match='quota_exhausted'):
        reserve_call(path, token, 'extra', IDENTIFIER, now=NOW + timedelta(minutes=1))
    status = read_status(path, now=NOW)['providers']['marketstack']
    assert status == dict(status='application_grant', grant_valid_from=NOW.isoformat(),
                          grant_expires_at=expires.isoformat(), limit=3, used=3, remaining=0)
    assert not {'period_start', 'period_end'} & status.keys()
    finish_job(path, token, now=NOW + timedelta(minutes=1))
    for later in (NOW + timedelta(hours=1), expires, expires + timedelta(days=31)):
        before = path.read_bytes()
        for enrollment in (enroll_initial_provider, enroll_provider):
            with pytest.raises(StoreError, match='initial_grant_not_renewable'):
                enrollment(path, 'marketstack', later, later + timedelta(hours=24), 90, 0, now=later)
        assert path.read_bytes() == before
    with pytest.raises(StoreError, match='application_grant_expired'):
        begin_job(path, 'marketstack', 'expired', now=expires)
    expired = read_status(path, now=expires)['providers']['marketstack']
    assert expired['status'] == 'application_grant_expired'
    assert expired['used'] == 3 and expired['remaining'] == 0
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM periods').fetchone()[0] == 1
        assert conn.execute('SELECT COUNT(*) FROM reservations').fetchone()[0] == 2


def test_initial_grant_cannot_replace_any_verified_period(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path, used=89)
    for later in (NOW, datetime(2026, 11, 1, tzinfo=timezone.utc)):
        before = path.read_bytes()
        with pytest.raises(StoreError, match='provider_already_enrolled'):
            enroll_initial_provider(path, 'marketstack', later, later + timedelta(hours=24),
                                    90, 0, now=later)
        assert path.read_bytes() == before
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 89


@pytest.mark.parametrize('providers', [('marketstack', 'marketstack'), ('marketstack', 'exchangerate_host')])
def test_simultaneous_initial_enrollment_is_serialized_from_missing_ledger(tmp_path, providers):
    path = tmp_path / 'market.sqlite3'
    code = """
import sys
from scripts.vendor_data_store import enroll_initial_provider, StoreError
print('ready', flush=True)
sys.stdin.readline()
try:
 enroll_initial_provider(sys.argv[1],sys.argv[2],'2026-10-23T12:00:00Z',
                         '2026-10-24T12:00:00Z',15,0,now='2026-10-23T12:00:00Z')
 print('enrolled')
except StoreError as exc:
 print(str(exc))
"""
    workers = [subprocess.Popen([sys.executable, '-c', code, str(path), provider],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                env={'PATH': os.defpath, 'PYTHONDONTWRITEBYTECODE': '1', 'LANG': 'C.UTF-8'})
               for provider in providers]
    try:
        for worker in workers:
            assert worker.stdout.readline().strip() == 'ready'
        for worker in workers:
            worker.stdin.write('go\n')
            worker.stdin.flush()
        results = [worker.communicate(timeout=20) for worker in workers]
        assert all(worker.returncode == 0 for worker in workers), results
        expected = ['enrolled', 'initial_grant_not_renewable'] if providers[0] == providers[1] else ['enrolled'] * 2
        assert sorted(out.strip() for out, _ in results) == expected
        with sqlite3.connect(path) as conn:
            assert conn.execute('SELECT COUNT(*) FROM periods').fetchone()[0] == len(set(providers))
    finally:
        for worker in workers:
            if worker.poll() is None:
                worker.kill()
                worker.communicate(timeout=5)


def test_old_private_ledger_cannot_be_migrated_or_reenrolled(tmp_path):
    path = tmp_path / 'old-ledger.sqlite3'
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE periods (provider TEXT, starts TEXT, ends TEXT, unit_limit INTEGER, already_used INTEGER)')
        conn.execute('INSERT INTO periods VALUES (?,?,?,?,?)', ('marketstack', START, END, 90, 89))
        conn.execute(f'PRAGMA application_id={APPLICATION_ID}')
        conn.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
    before = path.read_bytes()
    for action in (lambda: enroll(path),
                   lambda: enroll_initial_provider(path, 'marketstack', NOW, NOW + timedelta(hours=1), 15, 0, now=NOW),
                   lambda: begin_job(path, 'marketstack', 'old', now=NOW),
                   lambda: read_status(path, now=NOW)):
        with pytest.raises(StoreError, match='ledger_uninitialized'):
            action()
        assert path.read_bytes() == before


@pytest.mark.parametrize('start,end,code', [
    (None, NOW + timedelta(hours=1), 'invalid_enrollment'),
    (NOW, None, 'invalid_enrollment'),
    ('', NOW + timedelta(hours=1), 'invalid_timestamp'),
    (NOW, '', 'invalid_timestamp'),
    (False, NOW + timedelta(hours=1), 'invalid_timestamp'),
])
def test_initial_grant_cannot_infer_missing_or_empty_application_dates(tmp_path, start, end, code):
    path = tmp_path / 'missing' / 'market.sqlite3'
    with pytest.raises(StoreError, match=code):
        enroll_initial_provider(path, 'marketstack', start, end, 15, 0, now=NOW)
    assert not path.parent.exists()



def recovery_ready(path, *, expires=None):
    enroll_initial_provider(path, 'marketstack', NOW, expires or NOW + timedelta(hours=24), 15, 0, now=NOW)
    token = begin_job(path, 'marketstack', 'original-first-fetch', now=NOW)
    originals = []
    for index, stock in enumerate(STOCKS[:15]):
        reservation = reserve_call(path, token, 'original:' + stock.id, stock.id, now=NOW)
        originals.append(reservation)
        if index == 14:
            save_observations(path, token, reservation, {stock.id: [{'date': '2026-10-22', 'value': 10}]},
                              now=NOW, refresh_days=7)
        else:
            mark_failure(path, token, reservation, 'invalid_response' if index < 3 else 'identity_mismatch', now=NOW)
    finish_job(path, token, now=NOW)
    return token, originals


def test_initial_stock_recovery_preserves_original_charges_and_repairs_fourteen_once(tmp_path):
    path = tmp_path / 'market.sqlite3'
    _, originals = recovery_ready(path)
    with sqlite3.connect(path) as conn:
        original_rows = conn.execute('SELECT * FROM reservations ORDER BY id').fetchall()
        original_dates = conn.execute('SELECT starts,ends,already_used FROM periods').fetchone()
    token, candidates = begin_initial_stock_recovery(path, expected_used=15, now=NOW)
    assert len(candidates) == len({item['subject'] for item in candidates}) == 14
    assert {item['original_reservation_id'] for item in candidates} == set(originals[:-1])
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 15
    assert read_status(path, now=NOW)['providers']['marketstack']['limit'] == 29
    for item in candidates:
        reservation = reserve_call(path, token, item['call_key'], item['subject'], now=NOW)
        save_observations(path, token, reservation, {item['subject']: [{'date': '2026-10-22', 'value': 11}]},
                          now=NOW, refresh_days=7)
    assert len(list_instruments(path, 'stock', now=NOW)) == 15
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 29
    assert read_status(path, now=NOW)['providers']['marketstack']['remaining'] == 0
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT starts,ends,already_used FROM periods').fetchone() == original_dates
        assert [row for row in conn.execute('SELECT * FROM reservations ORDER BY id') if row[0] in originals] == original_rows
        assert conn.execute('SELECT COUNT(*) FROM jobs WHERE job_key=?', (INITIAL_STOCK_RECOVERY_KEY,)).fetchone()[0] == 1
        assert conn.execute('SELECT COUNT(*) FROM periods').fetchone()[0] == 1
    finish_job(path, token, now=NOW)
    with pytest.raises(StoreError, match='initial_recovery_exists'):
        begin_initial_stock_recovery(path, expected_used=29, now=NOW)
    with pytest.raises(StoreError, match='initial_grant_not_renewable'):
        enroll_initial_provider(path, 'marketstack', NOW, NOW + timedelta(hours=1), 90, 0, now=NOW)


def test_initial_stock_recovery_scope_and_duplicate_attempts_are_fenced(tmp_path):
    path = tmp_path / 'market.sqlite3'
    original_token, _ = recovery_ready(path)
    token, candidates = begin_initial_stock_recovery(path, now=NOW)
    item = candidates[0]
    for key, subject, units in [('arbitrary', item['subject'], 1),
                                (item['call_key'], STOCKS[14].id, 1),
                                (item['call_key'], item['subject'], 2)]:
        with pytest.raises(StoreError, match='invalid_recovery_reservation'):
            reserve_call(path, token, key, subject, units=units, now=NOW)
    with pytest.raises(StoreError, match='initial_recovery_only'):
        begin_job(path, 'marketstack', 'ordinary-refresh', now=NOW)
    with pytest.raises(StoreError, match='invalid_job'):
        begin_job(path, 'marketstack', INITIAL_STOCK_RECOVERY_KEY, now=NOW)
    with pytest.raises(StoreError, match='lease_lost'):
        reserve_call(path, original_token, 'old-job', item['subject'], now=NOW)
    reservation = reserve_call(path, token, item['call_key'], item['subject'], now=NOW)
    mark_failure(path, token, reservation, 'invalid_response', now=NOW)
    with pytest.raises(StoreError, match='duplicate_call'):
        reserve_call(path, token, item['call_key'], item['subject'], now=NOW)
    with pytest.raises(StoreError, match='invalid_recovery_reservation'):
        reserve_call(path, token, item['call_key'] + ':retry', item['subject'], now=NOW)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 16


def test_recovery_reservation_rejects_other_valid_job_even_if_lock_changes(tmp_path):
    path = tmp_path / 'market.sqlite3'
    recovery_ready(path)
    token, candidates = begin_initial_stock_recovery(path, now=NOW)
    # Exercise the explicit reservation fence independently of begin_job's own
    # guard, as a stale caller or future job entry point must not gain allowance.
    with sqlite3.connect(path) as conn:
        conn.execute('INSERT INTO jobs VALUES (?,?,?,?,?,NULL)',
                     ('other-token', 'marketstack', 'other-job', NOW.isoformat(),
                      (NOW + timedelta(minutes=10)).isoformat()))
        conn.execute('UPDATE locks SET token=? WHERE provider=?', ('other-token', 'marketstack'))
    with pytest.raises(StoreError, match='initial_recovery_only'):
        reserve_call(path, 'other-token', candidates[0]['call_key'], candidates[0]['subject'], now=NOW)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 15


@pytest.mark.parametrize('expected', [14, 16])
def test_recovery_authorization_compares_expected_current_usage_without_changes(tmp_path, expected):
    path = tmp_path / 'market.sqlite3'
    recovery_ready(path)
    before = path.read_bytes()
    with pytest.raises(StoreError, match='initial_recovery_usage_mismatch'):
        begin_initial_stock_recovery(path, expected_used=expected, now=NOW)
    assert path.read_bytes() == before


@pytest.mark.parametrize('expected', [True, -1, 91, '15'])
def test_recovery_authorization_rejects_invalid_expected_usage_before_io(tmp_path, expected):
    path = tmp_path / 'missing' / 'market.sqlite3'
    with pytest.raises(StoreError, match='invalid_recovery_authorization'):
        begin_initial_stock_recovery(path, expected_used=expected, now=NOW)
    assert not path.parent.exists()


@pytest.mark.parametrize('change', ['duplicate_subject', 'wrong_count', 'uncertain', 'network_failure',
                                    'two_successes', 'missing_success_cache', 'baseline', 'limit'])
def test_recovery_authorization_requires_exact_original_failed_scope(tmp_path, change):
    path = tmp_path / 'market.sqlite3'
    _, originals = recovery_ready(path)
    with sqlite3.connect(path) as conn:
        if change == 'duplicate_subject':
            conn.execute('UPDATE reservations SET subject=? WHERE id=?', (STOCKS[0].id, originals[1]))
        elif change == 'wrong_count':
            conn.execute('UPDATE reservations SET units=2 WHERE id=?', (originals[0],))
            conn.execute('DELETE FROM reservations WHERE id=?', (originals[1],))
        elif change in ('uncertain', 'network_failure', 'two_successes'):
            conn.execute('UPDATE reservations SET outcome=? WHERE id=?',
                         ({'uncertain': 'uncertain', 'network_failure': 'network_error',
                           'two_successes': 'success'}[change], originals[0]))
        elif change == 'missing_success_cache':
            conn.execute('DELETE FROM observations')
        elif change == 'baseline':
            conn.execute('UPDATE periods SET already_used=1')
        else:
            conn.execute('UPDATE periods SET unit_limit=16')
    before = path.read_bytes()
    with pytest.raises(StoreError, match='initial_recovery_usage_mismatch' if change in ('baseline', 'limit')
                       else 'initial_recovery_scope_invalid'):
        begin_initial_stock_recovery(path, now=NOW)
    assert path.read_bytes() == before


def test_recovery_authorization_refuses_active_work_without_consuming_marker(tmp_path):
    path = tmp_path / 'market.sqlite3'
    recovery_ready(path)
    active = begin_job(path, 'marketstack', 'active-job', now=NOW)
    before = path.read_bytes()
    with pytest.raises(StoreError, match='already_running'):
        begin_initial_stock_recovery(path, now=NOW)
    assert path.read_bytes() == before
    finish_job(path, active, now=NOW)
    token, candidates = begin_initial_stock_recovery(path, now=NOW)
    assert token and len(candidates) == 14


def test_recovery_authorization_is_atomic_across_separate_processes(tmp_path):
    path = tmp_path / 'market.sqlite3'
    recovery_ready(path)
    code = """
import sys
from scripts.vendor_data_store import begin_initial_stock_recovery, StoreError
print('ready', flush=True)
sys.stdin.readline()
try:
 token, candidates = begin_initial_stock_recovery(sys.argv[1],expected_used=15,now='2026-10-23T12:00:00Z')
 print('authorized:' + str(len(candidates)))
except StoreError as exc:
 print(str(exc))
"""
    workers = [subprocess.Popen([sys.executable, '-c', code, str(path)],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                env={'PATH': os.defpath, 'PYTHONDONTWRITEBYTECODE': '1', 'LANG': 'C.UTF-8'})
               for _ in range(2)]
    try:
        for worker in workers:
            assert worker.stdout.readline().strip() == 'ready'
        for worker in workers:
            worker.stdin.write('go\n')
            worker.stdin.flush()
        results = [worker.communicate(timeout=20) for worker in workers]
        assert all(worker.returncode == 0 for worker in workers), results
        assert sorted(out.strip() for out, _ in results) == ['authorized:14', 'initial_recovery_exists']
        status = read_status(path, now=NOW)['providers']['marketstack']
        assert status['used'] == 15 and status['limit'] == 29
        with sqlite3.connect(path) as conn:
            assert conn.execute('SELECT COUNT(*) FROM reservations').fetchone()[0] == 15
            assert conn.execute('SELECT COUNT(*) FROM jobs WHERE job_key=?', (INITIAL_STOCK_RECOVERY_KEY,)).fetchone()[0] == 1
    finally:
        for worker in workers:
            if worker.poll() is None:
                worker.kill()
                worker.communicate(timeout=5)


def test_recovery_lease_expiry_stops_unconsumed_units_and_cannot_restart(tmp_path):
    path = tmp_path / 'market.sqlite3'
    recovery_ready(path)
    token, candidates = begin_initial_stock_recovery(path, now=NOW)
    first = candidates[0]
    reservation = reserve_call(path, token, first['call_key'], first['subject'], now=NOW)
    later = NOW + timedelta(minutes=10, seconds=1)
    with pytest.raises(StoreError, match='lease_lost'):
        reserve_call(path, token, candidates[1]['call_key'], candidates[1]['subject'], now=later)
    with pytest.raises(StoreError, match='lease_lost'):
        save_observations(path, token, reservation, {first['subject']: [{'date': '2026-10-22', 'value': 20}]}, now=later)
    with pytest.raises(StoreError, match='initial_recovery_exists'):
        begin_initial_stock_recovery(path, expected_used=16, now=later)
    with pytest.raises(StoreError, match='initial_recovery_only'):
        begin_job(path, 'marketstack', 'replacement-job', now=later)
    assert read_status(path, now=later)['providers']['marketstack']['used'] == 16


def test_recovery_does_not_extend_grant_expiry_even_while_lease_remains_active(tmp_path):
    path = tmp_path / 'market.sqlite3'
    expiry = NOW + timedelta(minutes=1)
    recovery_ready(path, expires=expiry)
    token, candidates = begin_initial_stock_recovery(path, now=NOW)
    with pytest.raises(StoreError, match='application_grant_expired'):
        reserve_call(path, token, candidates[0]['call_key'], candidates[0]['subject'], now=expiry)
    with pytest.raises(StoreError, match='application_grant_expired'):
        begin_initial_stock_recovery(path, now=expiry)
    status = read_status(path, now=expiry)['providers']['marketstack']
    assert status['grant_expires_at'] == expiry.isoformat() and status['used'] == 15


def test_recovery_missing_unenrolled_period_and_old_ledger_fail_closed(tmp_path):
    missing = tmp_path / 'missing' / 'market.sqlite3'
    with pytest.raises(StoreError, match='ledger_missing'):
        begin_initial_stock_recovery(missing, now=NOW)
    assert not missing.parent.exists()
    period = tmp_path / 'period.sqlite3'
    enroll(period)
    before = period.read_bytes()
    with pytest.raises(StoreError, match='initial_recovery_not_available'):
        begin_initial_stock_recovery(period, now=NOW)
    assert period.read_bytes() == before
    fx = tmp_path / 'fx-only.sqlite3'
    enroll(fx, 'exchangerate_host')
    with pytest.raises(StoreError, match='provider_unenrolled'):
        begin_initial_stock_recovery(fx, now=NOW)
    old = tmp_path / 'old.sqlite3'
    with sqlite3.connect(old) as conn:
        conn.execute('CREATE TABLE periods (provider TEXT, starts TEXT, ends TEXT, unit_limit INTEGER, already_used INTEGER)')
        conn.execute(f'PRAGMA application_id={APPLICATION_ID}')
        conn.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
    before = old.read_bytes()
    with pytest.raises(StoreError, match='ledger_uninitialized'):
        begin_initial_stock_recovery(old, now=NOW)
    assert old.read_bytes() == before



def rolling(path, *, expected=0, now=NOW, expires=None):
    authorize_rolling_budget(path, 'marketstack', now, expires or now + timedelta(days=32),
                             expected_used=expected, now=now)


def completed_recovery(path):
    recovery_ready(path)
    token, candidates = begin_initial_stock_recovery(path, now=NOW)
    for item in candidates:
        reservation = reserve_call(path, token, item['call_key'], item['subject'], now=NOW)
        save_observations(path, token, reservation,
                          {item['subject']: [{'date': '2026-10-22', 'value': 11}]}, now=NOW)
    finish_job(path, token, now=NOW)


def database_rows(path):
    with sqlite3.connect(path) as conn:
        return {table: conn.execute(f'SELECT * FROM {table} ORDER BY 1').fetchall()
                for table in ('periods', 'jobs', 'locks', 'reservations', 'instruments', 'observations')}


def test_explicit_rolling_migration_preserves_all_29_charges_and_original_baseline(tmp_path):
    path = tmp_path / 'market.sqlite3'
    completed_recovery(path)
    before = database_rows(path)
    with sqlite3.connect(path) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == 2
    # Ordinary reads cannot migrate or make a completed recovery grant renewable.
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 29
    with pytest.raises(StoreError, match='initial_recovery_only'):
        begin_job(path, 'marketstack', 'before-authorization', now=NOW)
    rolling(path, expected=29)
    assert database_rows(path) == before
    with sqlite3.connect(path) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == LEDGER_SCHEMA_VERSION == 3
        assert conn.execute('SELECT already_used FROM periods').fetchone()[0] == 0
    status = read_status(path, now=NOW)['providers']['marketstack']
    assert status == dict(status='rolling_authorized', authorization_valid_from=NOW.isoformat(),
                          authorization_expires_at=(NOW + timedelta(days=32)).isoformat(),
                          rolling_window_days=32, window_start=(NOW - timedelta(days=32)).isoformat(),
                          limit=100, used=29, remaining=71)
    token = begin_job(path, 'marketstack', 'ordinary-after-authorization', now=NOW)
    reserve_batch(path, token, {STOCKS[0].id: 'new-stock'}, now=NOW)
    finish_job(path, token, now=NOW)
    with pytest.raises(StoreError, match='initial_recovery_exists'):
        begin_initial_stock_recovery(path, expected_used=30, now=NOW)
    with pytest.raises(StoreError, match='invalid_job'):
        begin_job(path, 'marketstack', INITIAL_STOCK_RECOVERY_KEY, now=NOW)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 30


def test_rolling_100_cap_includes_initial_29_across_batches_and_restart(tmp_path):
    path = tmp_path / 'market.sqlite3'
    completed_recovery(path)
    rolling(path, expected=29)
    for part, count in enumerate((15, 15, 15, 15, 10)):
        token = begin_job(path, 'marketstack', f'fill-{part}', now=NOW)
        reservations = reserve_batch(path, token,
                                     {stock.id: f'fill-{part}:{stock.id}' for stock in STOCKS[:count]}, now=NOW)
        assert len(reservations) == count
        finish_job(path, token, now=NOW)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 99
    token = begin_job(path, 'marketstack', 'last-units', now=NOW)
    before = database_rows(path)
    with pytest.raises(StoreError, match='quota_exhausted'):
        reserve_batch(path, token, {stock.id: f'over:{stock.id}' for stock in STOCKS[:2]}, now=NOW)
    assert database_rows(path) == before
    reserve_batch(path, token, {STOCKS[0].id: 'last-one'}, now=NOW)
    finish_job(path, token, now=NOW)
    token = begin_job(path, 'marketstack', 'restart-after-100', now=NOW)
    with pytest.raises(StoreError, match='quota_exhausted'):
        reserve_call(path, token, '101st', IDENTIFIER, now=NOW)
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 100


def test_batch_duplicate_and_cross_subject_save_are_atomic_and_fenced(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    rolling(path)
    token = begin_job(path, 'marketstack', 'batch', now=NOW)
    first, second, third = (stock.id for stock in STOCKS[:3])
    mapping = reserve_batch(path, token, {first: 'first', second: 'second'}, now=NOW)
    assert set(mapping) == {first, second} and len(set(mapping.values())) == 2
    before = database_rows(path)
    with pytest.raises(StoreError, match='duplicate_call'):
        reserve_batch(path, token, {third: 'new-third', first: 'first'}, now=NOW)
    assert database_rows(path) == before
    with pytest.raises(StoreError, match='duplicate_call'):
        reserve_batch(path, token, {first: 'identical', second: 'identical'}, now=NOW)
    with pytest.raises(StoreError, match='invalid_reservation'):
        save_observations(path, token, mapping[first],
                          {second: [{'date': '2026-10-22', 'value': 100}]}, now=NOW, refresh_days=32)
    for subject, reservation in mapping.items():
        save_observations(path, token, reservation,
                          {subject: [{'date': '2026-10-22', 'value': 100}]}, now=NOW, refresh_days=32)
        assert read_instrument(path, subject, now=NOW)['refresh_days'] == 32
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 2


@pytest.mark.parametrize('calls', [None, [], {}, {'bad': 'key'}, {IDENTIFIER: ''},
                                   {IDENTIFIER: True}, {IDENTIFIER: 'x' * 181}])
def test_invalid_batch_cannot_create_missing_ledger(tmp_path, calls):
    path = tmp_path / 'missing' / 'market.sqlite3'
    with pytest.raises(StoreError, match='invalid_reservation'):
        reserve_batch(path, 'token', calls, now=NOW)
    assert not path.parent.exists()


def test_batch_rejects_different_provider_before_any_reservation(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    rolling(path)
    token = begin_job(path, 'marketstack', 'batch', now=NOW)
    before = database_rows(path)
    with pytest.raises(StoreError, match='invalid_reservation'):
        reserve_batch(path, token, {IDENTIFIER: 'valid', 'fx-USD-EUR': 'invalid'}, now=NOW)
    assert database_rows(path) == before


def test_rolling_final_unit_is_atomic_across_processes(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path, used=89)
    rolling(path, expected=89)
    token = begin_job(path, 'marketstack', 'concurrent', now=NOW)
    reserve_call(path, token, 'first-ten', IDENTIFIER, units=10, now=NOW)
    code = """
import sys
from scripts.vendor_data_store import reserve_batch, StoreError
try:
 reserve_batch(sys.argv[1],sys.argv[2],{'stock-XNAS-AAPL':sys.argv[3]},now='2026-10-23T12:00:00Z')
 print('reserved')
except StoreError as exc:
 print(str(exc))
"""
    workers = [subprocess.Popen([sys.executable, '-B', '-c', code, str(path), token, f'last-{i}'],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                env={'PATH': os.defpath, 'PYTHONDONTWRITEBYTECODE': '1'}) for i in range(2)]
    try:
        results = [worker.communicate(timeout=20) for worker in workers]
        assert all(worker.returncode == 0 for worker in workers), results
        assert sorted(out.strip() for out, _ in results) == ['quota_exhausted', 'reserved']
        assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 100
    finally:
        for worker in workers:
            if worker.poll() is None:
                worker.kill()
                worker.communicate(timeout=5)


def test_rolling_boundary_and_renewal_never_reset_charged_history(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, _ = reserved(path)
    finish_job(path, token, now=NOW)
    rolling(path, expected=1)
    boundary = NOW + timedelta(days=32)
    before = database_rows(path)
    with pytest.raises(StoreError, match='rolling_authorization_expired'):
        begin_job(path, 'marketstack', 'expired-authorization', now=boundary)
    # Calls exactly 32 days old remain charged; renewal cannot erase them.
    rolling(path, expected=1, now=boundary)
    assert database_rows(path) == before
    status = read_status(path, now=boundary)['providers']['marketstack']
    assert status['used'] == 1
    later = boundary + timedelta(microseconds=1)
    assert read_status(path, now=later)['providers']['marketstack']['used'] == 0
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM reservations').fetchone()[0] == 1
        assert conn.execute('SELECT COUNT(*) FROM rolling_authorizations').fetchone()[0] == 2
    # A subsequent authorization also cannot reset reservations from its window.
    token = begin_job(path, 'marketstack', 'new-window', now=later)
    reserve_call(path, token, 'new-window-call', IDENTIFIER, now=later)
    finish_job(path, token, now=later)
    renewal = later + timedelta(days=1)
    with pytest.raises(StoreError, match='rolling_usage_mismatch'):
        rolling(path, expected=0, now=renewal)
    rolling(path, expected=1, now=renewal)
    assert read_status(path, now=renewal)['providers']['marketstack']['used'] == 1


def test_nonzero_external_baseline_remains_charged_after_window_and_renewal(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path, used=27)
    token, _ = reserved(path)
    finish_job(path, token, now=NOW)
    rolling(path, expected=28)
    later = NOW + timedelta(days=32, seconds=1)
    rolling(path, expected=27, now=later)
    assert read_status(path, now=later)['providers']['marketstack']['used'] == 27
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT already_used FROM periods').fetchone()[0] == 27
        assert conn.execute('SELECT COUNT(*) FROM reservations').fetchone()[0] == 1


@pytest.mark.parametrize('start,end,expected', [
    (NOW, NOW + timedelta(days=32, microseconds=1), 0), (NOW, NOW, 0),
    (NOW + timedelta(seconds=1), NOW + timedelta(days=1), 0),
    (NOW - timedelta(days=1), NOW, 0), (NOW, NOW + timedelta(days=1), True),
    (NOW, NOW + timedelta(days=1), -1), (NOW, NOW + timedelta(days=1), 101),
    (None, NOW + timedelta(days=1), 0), (NOW, None, 0),
])
def test_rolling_authorization_requires_explicit_current_bounded_dates(tmp_path, start, end, expected):
    path = tmp_path / 'missing' / 'market.sqlite3'
    with pytest.raises(StoreError, match='invalid_rolling_authorization'):
        authorize_rolling_budget(path, 'marketstack', start, end, expected_used=expected, now=NOW)
    assert not path.parent.exists()


def test_rolling_authorization_expiry_and_backdated_clock_fail_closed(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    rolling(path, expires=NOW + timedelta(minutes=2))
    token = begin_job(path, 'marketstack', 'expiry', now=NOW)
    for at in (NOW - timedelta(seconds=1), NOW + timedelta(minutes=2)):
        with pytest.raises(StoreError, match='rolling_authorization_expired'):
            begin_job(path, 'marketstack', 'outside-validity', now=at)
        with pytest.raises(StoreError, match='rolling_authorization_expired'):
            reserve_call(path, token, 'outside-call', IDENTIFIER, now=at)
        assert read_status(path, now=at)['providers']['marketstack']['status'] == 'rolling_authorization_expired'
    assert read_status(path, now=NOW)['providers']['marketstack']['used'] == 0


def test_rolling_conversion_and_renewal_reject_active_lease_and_usage_mismatch(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, _ = reserved(path)
    before = path.read_bytes()
    with pytest.raises(StoreError, match='already_running'):
        rolling(path, expected=1)
    assert path.read_bytes() == before
    finish_job(path, token, now=NOW)
    before = path.read_bytes()
    with pytest.raises(StoreError, match='rolling_usage_mismatch'):
        rolling(path, expected=0)
    assert path.read_bytes() == before
    rolling(path, expected=1)
    token = begin_job(path, 'marketstack', 'active-renewal', now=NOW)
    before = path.read_bytes()
    with pytest.raises(StoreError, match='already_running'):
        rolling(path, expected=1, now=NOW + timedelta(seconds=1))
    assert path.read_bytes() == before
    finish_job(path, token, now=NOW)
    with pytest.raises(StoreError, match='rolling_authorization_exists'):
        rolling(path, expected=1)
    with pytest.raises(StoreError, match='rolling_budget_requires_authorization'):
        enroll_provider(path, 'marketstack', NOW, NOW + timedelta(days=1), 90, 0, now=NOW)


def test_expired_legacy_grant_requires_explicit_conversion_and_no_new_enrollment(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll_initial_provider(path, 'marketstack', NOW, NOW + timedelta(hours=1), 15, 0, now=NOW)
    token, _ = reserved(path)
    finish_job(path, token, now=NOW)
    later = NOW + timedelta(days=1)
    with pytest.raises(StoreError, match='application_grant_expired'):
        begin_job(path, 'marketstack', 'expired', now=later)
    rolling(path, expected=1, now=later)
    assert read_status(path, now=later)['providers']['marketstack']['used'] == 1
    assert begin_job(path, 'marketstack', 'converted', now=later)


def test_failed_migration_rolls_back_schema_version_and_original_bytes(tmp_path, monkeypatch):
    from scripts import vendor_data_store as store
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, _ = reserved(path)
    finish_job(path, token, now=NOW)
    before = path.read_bytes()
    monkeypatch.setattr(store, 'ROLLING_SCHEMA', store.ROLLING_SCHEMA + 'CREATE TABLE periods (broken TEXT);')
    with pytest.raises(StoreError, match='ledger_unavailable'):
        rolling(path, expected=1)
    assert path.read_bytes() == before
    with sqlite3.connect(path) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == 2
        assert conn.execute("SELECT name FROM sqlite_master WHERE name='rolling_authorizations'").fetchone() is None


@pytest.mark.parametrize('corruption', ['timestamp', 'subject', 'foreign_key', 'unknown_table'])
def test_corrupt_source_cannot_migrate_or_change_source(tmp_path, corruption):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, reservation = reserved(path)
    finish_job(path, token, now=NOW)
    with sqlite3.connect(path) as conn:
        if corruption == 'timestamp':
            conn.execute("UPDATE reservations SET reserved_at='uncertain'")
        elif corruption == 'subject':
            conn.execute("UPDATE reservations SET subject='private-unreviewed'")
        elif corruption == 'foreign_key':
            conn.execute("UPDATE reservations SET job_token='missing'")
        else:
            conn.execute('CREATE TABLE unrelated (content TEXT)')
    before = path.read_bytes()
    with pytest.raises(StoreError):
        rolling(path, expected=1)
    assert path.read_bytes() == before


def test_rolling_conversion_missing_and_unenrolled_provider_fail_closed(tmp_path):
    missing = tmp_path / 'missing' / 'market.sqlite3'
    with pytest.raises(StoreError, match='ledger_missing'):
        rolling(missing)
    assert not missing.parent.exists()
    path = tmp_path / 'fx-only.sqlite3'
    enroll(path, 'exchangerate_host')
    before = path.read_bytes()
    with pytest.raises(StoreError, match='provider_unenrolled'):
        rolling(path)
    assert path.read_bytes() == before


def test_rolling_preserves_and_counts_all_legacy_periods_not_only_latest(tmp_path):
    path = tmp_path / 'market.sqlite3'
    first = datetime(2026, 10, 1, tzinfo=timezone.utc)
    middle = first + timedelta(days=10)
    later = middle + timedelta(days=10)
    enroll_provider(path, 'marketstack', first, middle, 90, 2, now=first)
    token, _ = reserved(path, now=first)
    finish_job(path, token, now=first)
    enroll_provider(path, 'marketstack', middle, later + timedelta(days=10), 90, 3, now=middle)
    rolling(path, expected=6, now=later)
    assert read_status(path, now=later)['providers']['marketstack']['used'] == 6
    after = first + timedelta(days=33)
    assert read_status(path, now=after)['providers']['marketstack']['used'] == 5


def test_fx_200_validated_currencies_save_atomically_with_32_day_cadence(tmp_path, monkeypatch):
    from dataclasses import replace
    from scripts import vendor_data_store as store
    from scripts.market_data_catalog import FX
    # Explicit deterministic fixture currencies keep this store test independent
    # of whether a live provider currently includes a particular ISO-like code.
    identifiers = [f'fx-USD-A{chr(65 + i // 26)}{chr(65 + i % 26)}' for i in range(201)]
    catalog = {identifier: replace(FX[0], id=identifier, quote_currency=identifier[-3:])
               for identifier in identifiers}
    catalog.update({item.id: item for item in STOCKS})
    monkeypatch.setattr(store, 'CATALOG', catalog)
    path = tmp_path / 'market.sqlite3'
    enroll(path, 'exchangerate_host')
    authorize_rolling_budget(path, 'exchangerate_host', NOW, NOW + timedelta(days=32), expected_used=0, now=NOW)
    token = begin_job(path, 'exchangerate_host', 'all-currencies', now=NOW)
    reservation = reserve_call(path, token, 'all-currencies', identifiers[0], now=NOW)
    batches = {identifier: [{'date': '2026-10-22', 'value': index + 1}]
               for index, identifier in enumerate(identifiers[:200])}
    before = database_rows(path)
    with pytest.raises(StoreError, match='invalid_observations'):
        save_observations(path, token, reservation,
                          dict(batches, **{identifiers[200]: [{'date': '2026-10-22', 'value': 1}]}),
                          now=NOW, refresh_days=32)
    assert database_rows(path) == before
    save_observations(path, token, reservation, batches, now=NOW, refresh_days=32)
    assert len(list_instruments(path, 'fx', now=NOW)) == 200
    assert read_status(path, now=NOW)['providers']['exchangerate_host']['used'] == 1


@pytest.mark.parametrize('refresh_days', [True, 0, 33, 1.5, '32'])
def test_refresh_cadence_requires_integer_between_one_and_32(tmp_path, refresh_days):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    token, reservation = reserved(path)
    with pytest.raises(StoreError, match='invalid_observations'):
        save_observations(path, token, reservation, {IDENTIFIER: [{'date': '2026-10-22', 'value': 1}]},
                          now=NOW, refresh_days=refresh_days)
    assert read_instrument(path, IDENTIFIER, now=NOW) is None



def test_corrupt_rolling_authorization_cannot_extend_32_day_permission(tmp_path):
    path = tmp_path / 'market.sqlite3'
    enroll(path)
    rolling(path)
    with sqlite3.connect(path) as conn:
        conn.execute('UPDATE rolling_authorizations SET expires_at=?',
                     ((NOW + timedelta(days=32, seconds=1)).isoformat(),))
    before = path.read_bytes()
    with pytest.raises(StoreError, match='invalid_rolling_authorization'):
        begin_job(path, 'marketstack', 'bad-authorization', now=NOW)
    assert read_status(path, now=NOW)['providers']['marketstack']['status'] == 'invalid_rolling_authorization'
    assert path.read_bytes() == before
