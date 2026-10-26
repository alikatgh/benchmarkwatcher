"""Synthetic SQLite tests for the separate no-key public cache."""
import sqlite3
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from scripts import open_market_store as store

NOW = datetime(2026, 10, 24, 12, tzinfo=timezone.utc)
META = dict(key='ECB', pivot_currency='EUR', frequency='daily', currencies=['EUR', 'USD'],
            unknown_currencies=[], start_date='2026-01-01', end_date='2026-10-23')


def published(path, points=None):
    store.initialize(path)
    token = store.claim_job(path, NOW)
    store.begin_provider(path, token, 'frankfurter_ecb', NOW)
    store.prepare_fx(path, token, META, NOW)
    points = points or [dict(quote='USD', date='2026-01-02', value=1.1),
                        dict(quote='USD', date='2026-10-23', value=1.2)]
    store.stage_fx_chunk(path, token, '2026-01-01', '2026-10-23', points, NOW)
    store.publish_fx(path, token, NOW)
    store.release_job(path, token)


def test_missing_readers_never_initialize_or_create_parents(tmp_path):
    path = tmp_path / 'missing' / 'open.sqlite3'
    assert store.list_fx(path) == []
    assert store.read_fx(path, 'fx-ECB-EUR-USD') is None
    assert store.read_identity(path, 'stock-XNAS-AAPL') is None
    assert store.list_identities(path) == {}
    assert store.status(path)['network_requests'] == 0
    assert not path.parent.exists()


def test_exact_dates_gaps_provenance_and_summary_only_listing(tmp_path):
    path = tmp_path / 'open.sqlite3'
    published(path)
    real_connect, statements = store._connect, []
    def traced(*args, **kwargs):
        conn = real_connect(*args, **kwargs)
        conn.set_trace_callback(statements.append)
        return conn
    before = path.read_bytes()
    with patch.object(store, '_connect', side_effect=traced):
        rows = store.list_fx(path, NOW)
    assert len(rows) == 1
    assert not any('FROM observations' in sql for sql in statements)
    row = rows[0]
    assert row['id'] == 'fx-ECB-EUR-USD' and row['symbol'] == 'EUR/USD'
    assert row['base_currency'] == 'EUR' and row['provider'] == 'frankfurter_ecb'
    assert row['source_url'].startswith('https://www.ecb.europa.eu/')
    assert row['history_complete'] is True and row['observation_count'] == 2
    result = store.read_fx(path, row['id'], NOW)
    assert result['observations'] == [{'date': '2026-01-02', 'value': 1.1}, {'date': '2026-10-23', 'value': 1.2}]
    assert path.read_bytes() == before
    assert store.read_fx(path, 'fx-ECB-EUR-JPY', NOW) is None
    assert store.list_fx(path, NOW + timedelta(days=4))[0]['stale'] is True


def test_partial_backfill_is_private_and_cannot_publish(tmp_path):
    path = tmp_path / 'open.sqlite3'
    store.initialize(path)
    token = store.claim_job(path, NOW)
    store.begin_provider(path, token, 'frankfurter_ecb', NOW)
    meta = dict(META, start_date='2025-01-01')
    store.prepare_fx(path, token, meta, NOW)
    store.stage_fx_chunk(path, token, '2025-01-01', '2025-12-31', [dict(quote='USD', date='2025-01-02', value=1)], NOW)
    assert store.list_fx(path, NOW) == []
    with pytest.raises(store.OpenDataError, match='incomplete_history'):
        store.publish_fx(path, token, NOW)
    assert store.status(path)['staged_observations'] == 1
    store.release_job(path, token)


def test_incremental_merge_preserves_existing_history_without_cutoff(tmp_path):
    path = tmp_path / 'open.sqlite3'
    published(path)
    later = NOW + timedelta(days=1)
    token = store.claim_job(path, later)
    store.begin_provider(path, token, 'frankfurter_ecb', later)
    start, end, done = store.prepare_fx(path, token, dict(META, end_date='2026-10-24'), later)
    assert (start, end, done) == ('2026-10-16', '2026-10-24', set())
    store.stage_fx_chunk(path, token, start, end, [dict(quote='USD', date='2026-10-24', value=1.3)], later)
    store.publish_fx(path, token, later)
    row = store.read_fx(path, 'fx-ECB-EUR-USD', later)
    assert [point['date'] for point in row['observations']] == ['2026-01-02', '2026-10-23', '2026-10-24']
    assert row['observation_count'] == 3
    store.release_job(path, token)


def test_storage_failure_rolls_back_chunk_and_preserves_public_history(tmp_path, monkeypatch):
    path = tmp_path / 'open.sqlite3'
    published(path)
    prior = store.read_fx(path, 'fx-ECB-EUR-USD', NOW)
    later = NOW + timedelta(days=1)
    token = store.claim_job(path, later)
    store.begin_provider(path, token, 'frankfurter_ecb', later)
    start, end, _ = store.prepare_fx(path, token, dict(META, end_date='2026-10-24'), later)
    monkeypatch.setattr(store, 'MAX_OBSERVATIONS', 2)
    with pytest.raises(store.OpenDataError, match='storage_limit'):
        store.stage_fx_chunk(path, token, start, end, [dict(quote='USD', date='2026-10-24', value=1.3)], later)
    assert store.read_fx(path, prior['id'], NOW) == prior
    assert store.status(path)['staged_observations'] == 0
    store.release_job(path, token)


def test_global_lease_blocks_concurrent_jobs_and_wrong_release(tmp_path):
    path = tmp_path / 'open.sqlite3'
    store.initialize(path)
    token = store.claim_job(path, NOW)
    with pytest.raises(store.OpenDataError, match='job_running'):
        store.claim_job(path, NOW)
    store.release_job(path, 'wrong-token')
    with pytest.raises(store.OpenDataError, match='job_running'):
        store.claim_job(path, NOW + timedelta(seconds=624))
    replacement = store.claim_job(path, NOW + timedelta(seconds=626))
    with pytest.raises(store.OpenDataError, match='job_lease_lost'):
        store.begin_provider(path, token, 'openfigi', NOW + timedelta(seconds=626))
    store.release_job(path, replacement)


def test_failure_cooldown_and_attempt_reservation_are_durable(tmp_path):
    path = tmp_path / 'open.sqlite3'
    store.initialize(path)
    token = store.claim_job(path, NOW)
    store.begin_provider(path, token, 'openfigi', NOW)
    store.reserve_request(path, token, 'openfigi', NOW)
    with pytest.raises(store.OpenDataError, match='request_pacing'):
        store.reserve_request(path, token, 'openfigi', NOW + timedelta(seconds=2))
    store.fail_provider(path, token, 'openfigi', NOW, retry_after=900)
    store.release_job(path, token)
    state = store.status(path)['providers']['openfigi']
    assert state['requests'] == 1 and store.utc(state['next_allowed']) == NOW + timedelta(seconds=900)
    token = store.claim_job(path, NOW + timedelta(seconds=899))
    with pytest.raises(store.OpenDataError, match='cooldown'):
        store.begin_provider(path, token, 'openfigi', NOW + timedelta(seconds=899))
    store.release_job(path, token)


@pytest.mark.parametrize('variant', ['bytes', 'foreign', 'version', 'column', 'view'])
def test_corruption_or_wrong_schema_is_rejected_without_replacement(tmp_path, variant):
    path = tmp_path / 'open.sqlite3'
    if variant == 'bytes':
        path.write_bytes(b'not a sqlite database')
    elif variant == 'foreign':
        with sqlite3.connect(path) as conn:
            conn.execute('CREATE TABLE personal_history (value TEXT)')
            conn.execute("INSERT INTO personal_history VALUES ('preserve')")
    else:
        store.initialize(path)
        with sqlite3.connect(path) as conn:
            if variant == 'version':
                conn.execute('PRAGMA user_version=99')
            elif variant == 'column':
                conn.execute('ALTER TABLE identities ADD COLUMN unexpected TEXT')
            else:
                conn.execute('CREATE VIEW extra AS SELECT id FROM fx')
    before = path.read_bytes()
    with pytest.raises(store.OpenDataError):
        store.list_fx(path, NOW)
    with pytest.raises(store.OpenDataError):
        store.initialize(path)
    assert path.read_bytes() == before


def test_symlink_path_and_oversize_file_rejected(tmp_path, monkeypatch):
    target = tmp_path / 'target.sqlite3'
    store.initialize(target)
    link = tmp_path / 'link.sqlite3'
    link.symlink_to(target)
    with pytest.raises(store.OpenDataError, match='unsafe_database_path'):
        store.list_fx(link)
    monkeypatch.setattr(store, 'MAX_DATABASE_BYTES', 1)
    with pytest.raises(store.OpenDataError, match='unsafe_database_path'):
        store.initialize(target)


def test_tampered_history_fails_closed_without_affecting_other_reads(tmp_path):
    path = tmp_path / 'open.sqlite3'
    published(path)
    with sqlite3.connect(path) as conn:
        conn.execute("UPDATE observations SET value=-1 WHERE date='2026-01-02'")
    with pytest.raises(store.OpenDataError, match='invalid_rate'):
        store.read_fx(path, 'fx-ECB-EUR-USD', NOW)


def test_invalid_chunk_cannot_write_or_change_completed_progress(tmp_path):
    path = tmp_path / 'open.sqlite3'
    store.initialize(path)
    token = store.claim_job(path, NOW)
    store.begin_provider(path, token, 'frankfurter_ecb', NOW)
    store.prepare_fx(path, token, META, NOW)
    for points in ([dict(quote='EUR', date='2026-01-02', value=1)],
                   [dict(quote='USD', date='2025-01-02', value=1)],
                   [dict(quote='USD', date='2026-01-02', value=True)]):
        with pytest.raises(store.OpenDataError):
            store.stage_fx_chunk(path, token, '2026-01-01', '2026-10-23', points, NOW)
    assert store.status(path)['staged_observations'] == 0
    store.release_job(path, token)


def test_complete_old_source_history_is_fresh_after_successful_collection(tmp_path):
    path = tmp_path / 'open.sqlite3'
    published(path, [dict(quote='USD', date='2026-01-02', value=1.1)])
    row = store.read_fx(path, 'fx-ECB-EUR-USD', NOW)
    assert row['coverage_end'] == '2026-01-02'
    assert row['stale'] is False and row['archived'] is False


def test_readonly_sql_work_has_progress_deadline(tmp_path):
    path = tmp_path / 'open.sqlite3'
    store.initialize(path)
    conn = store._connect(path, readonly=True)
    try:
        with pytest.raises(sqlite3.OperationalError, match='interrupted'):
            conn.execute('WITH RECURSIVE counter(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM counter '
                         'WHERE x<100000000) SELECT sum(x) FROM counter').fetchone()
    finally:
        conn.close()


def test_frankfurter_durable_reservation_requires_ten_second_spacing(tmp_path):
    path = tmp_path / 'open.sqlite3'
    store.initialize(path)
    token = store.claim_job(path, NOW)
    store.begin_provider(path, token, 'frankfurter_ecb', NOW)
    store.reserve_request(path, token, 'frankfurter_ecb', NOW)
    with pytest.raises(store.OpenDataError, match='request_pacing'):
        store.reserve_request(path, token, 'frankfurter_ecb', NOW + timedelta(seconds=9))
    assert store.status(path)['providers']['frankfurter_ecb']['requests'] == 1
    store.reserve_request(path, token, 'frankfurter_ecb', NOW + timedelta(seconds=10))
    state = store.status(path)['providers']['frankfurter_ecb']
    assert state['requests'] == 2 and store.utc(state['last_request']) == NOW + timedelta(seconds=10)
    store.release_job(path, token)
