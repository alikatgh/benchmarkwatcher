"""Public-only market transfer; no environment loading, network, or provider calls."""
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scripts import market_data_snapshot as snapshot
from scripts.market_data_catalog import FX, STOCKS
from scripts.vendor_data_store import (
    APPLICATION_ID, CACHE_SCHEMA, LEDGER_SCHEMA_VERSION, LEGACY_LEDGER_SCHEMA_VERSION, SCHEMA_VERSION, begin_job, enroll_provider,
    list_instruments, read_instrument, reserve_call, save_observations,
)

NOW = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
ID = STOCKS[0].id
OTHER = STOCKS[1].id
FX_ID = FX[0].id
SENTINEL = 'PRIVATE_QUOTA_JOB_RESERVATION_SENTINEL'


def ledger(path):
    enroll_provider(path, 'marketstack', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', 90, 4, now=NOW)
    token = begin_job(path, 'marketstack', SENTINEL, now=NOW)
    reservation = reserve_call(path, token, SENTINEL + ':call', ID, now=NOW)
    save_observations(path, token, reservation, {ID: [point()]}, now=NOW, refresh_days=7)
    return path


def point(day='2026-10-22', value=12.5):
    return dict(date=day, value=value, open=11.2, high=15.3, low=10.1, close=12.5,
                adjusted_close=12.4, volume=123456.0)


def fixture(path, identifiers=(ID,), stamp=NOW, value=12.5, days=('2026-10-22',)):
    with sqlite3.connect(path) as conn:
        conn.executescript(CACHE_SCHEMA)
        conn.execute(f'PRAGMA application_id={APPLICATION_ID}')
        conn.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
        for identifier in identifiers:
            conn.execute('INSERT INTO instruments VALUES (?,?,?)', (identifier, stamp.isoformat(), 7))
            for day in days:
                conn.execute('INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?)',
                             (identifier, day, value, 11.2, 15.3, 10.1, 12.5, 12.4, 123456.0))
    return path


def exported(tmp_path, name='incoming', **kwargs):
    source = fixture(tmp_path / (name + '-source.db'), **kwargs)
    target = tmp_path / (name + '.db')
    result = snapshot.export_snapshot(source, target, now=NOW)
    return target, result['sha256']


def install(source, destination, digest):
    return snapshot.install_snapshot(source, destination, expected_sha256=digest, now=NOW)


def test_export_rebuilds_only_public_tables_without_private_bytes_or_source_changes(tmp_path):
    source, target = ledger(tmp_path / 'ledger.db'), tmp_path / 'public.db'
    before = source.read_bytes()
    with sqlite3.connect(source) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == LEGACY_LEDGER_SCHEMA_VERSION
    assert SENTINEL.encode() in before
    result = snapshot.export_snapshot(source, target, now=NOW)
    assert source.read_bytes() == before
    assert result == dict(status='exported', instruments=1, observations=1,
                          sha256=hashlib.sha256(target.read_bytes()).hexdigest())
    assert SENTINEL.encode() not in target.read_bytes()
    for private in (b'CREATE TABLE periods', b'CREATE TABLE jobs', b'CREATE TABLE reservations', b'CREATE TABLE locks'):
        assert private not in target.read_bytes()
    with sqlite3.connect(target) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
        assert conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall() == [
            ('instruments',), ('observations',)]
    assert snapshot.check_snapshot(target, expected_sha256=result['sha256'], now=NOW)['status'] == 'valid'
    assert read_instrument(target, ID, now=NOW) == read_instrument(source, ID, now=NOW)
    assert list_instruments(target, 'stock', now=NOW) == list_instruments(source, 'stock', now=NOW)


def test_numeric_date_timestamp_cadence_and_fx_roundtrip(tmp_path):
    source = fixture(tmp_path / 'source.db', identifiers=(ID, FX_ID))
    with sqlite3.connect(source) as conn:
        conn.execute('UPDATE instruments SET last_success=?,refresh_days=1 WHERE id=?',
                     ('2026-10-23T13:30:00+02:00', FX_ID))
        conn.execute('UPDATE observations SET open=NULL,volume=0 WHERE instrument_id=?', (FX_ID,))
    target = tmp_path / 'public.db'
    snapshot.export_snapshot(source, target, now=NOW)
    for identifier in (ID, FX_ID):
        assert read_instrument(target, identifier, now=NOW) == read_instrument(source, identifier, now=NOW)
    assert read_instrument(target, FX_ID, now=NOW)['last_success'] == '2026-10-23T13:30:00+02:00'


def test_export_uses_one_consistent_read_transaction_during_concurrent_commit(tmp_path, monkeypatch):
    source = fixture(tmp_path / 'source.db')
    with sqlite3.connect(source) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
    real_connect = sqlite3.connect
    committed = []

    class Connection:
        def __init__(self, connection):
            self.connection = connection

        def __getattr__(self, name):
            return getattr(self.connection, name)

        def execute(self, sql, *args):
            if sql.startswith('SELECT instrument_id,date,value'):
                with real_connect(source) as writer:
                    writer.execute('UPDATE observations SET value=99')
                    writer.execute('UPDATE instruments SET refresh_days=1')
                committed.append(True)
            return self.connection.execute(sql, *args)

    def connect(path, *args, **kwargs):
        connection = real_connect(path, *args, **kwargs)
        return Connection(connection) if 'mode=ro' in str(path) else connection

    monkeypatch.setattr(snapshot.sqlite3, 'connect', connect)
    target = tmp_path / 'public.db'
    snapshot.export_snapshot(source, target, now=NOW)
    assert committed == [True]
    monkeypatch.setattr(snapshot.sqlite3, 'connect', real_connect)
    saved = read_instrument(target, ID, now=NOW)
    assert saved['latest_value'] == 12.5 and saved['refresh_days'] == 7
    with real_connect(source) as conn:
        assert conn.execute('SELECT value FROM observations').fetchone()[0] == 99


@pytest.mark.parametrize('mutation,code', [
    ("CREATE TABLE private(secret TEXT)", 'invalid_snapshot_schema'),
    ("CREATE VIEW exposed AS SELECT * FROM observations", 'invalid_snapshot_schema'),
    ("CREATE TRIGGER unsafe AFTER INSERT ON instruments BEGIN DELETE FROM observations; END", 'invalid_snapshot_schema'),
    ("UPDATE instruments SET id='unknown'", 'invalid_snapshot'),
    ("UPDATE instruments SET refresh_days=0", 'invalid_instruments'),
    ("UPDATE instruments SET last_success='bad'", 'invalid_timestamp'),
    ("UPDATE instruments SET last_success='2099-01-01T00:00:00Z'", 'invalid_timestamp'),
    ("UPDATE observations SET date='2026-02-30'", 'invalid_date'),
    ("UPDATE observations SET date='1800-01-01'", 'invalid_date'),
    ("UPDATE observations SET date='2026-10-24'", 'invalid_date'),
    ("UPDATE observations SET value=-1", 'invalid_value'),
    ("UPDATE observations SET value=1e999", 'invalid_value'),
    ("UPDATE observations SET high=-1", 'invalid_value'),
    ("UPDATE observations SET volume=1e30", 'invalid_value'),
    ("DELETE FROM observations", 'empty_instrument'),
])
def test_rejects_untrusted_schema_and_values(tmp_path, mutation, code):
    target, _ = exported(tmp_path)
    with sqlite3.connect(target) as conn:
        conn.execute(mutation)
    with pytest.raises(snapshot.SnapshotError, match=code):
        snapshot.check_snapshot(target, now=NOW)


def test_rejects_full_ledger_corrupt_and_oversize(tmp_path):
    source = ledger(tmp_path / 'ledger.db')
    with pytest.raises(snapshot.SnapshotError, match='invalid_snapshot_schema'):
        snapshot.check_snapshot(source, now=NOW)
    corrupt = tmp_path / 'corrupt.db'
    corrupt.write_bytes(b'not sqlite')
    with pytest.raises(snapshot.SnapshotError, match='invalid_snapshot'):
        snapshot.check_snapshot(corrupt, now=NOW)
    oversized = tmp_path / 'oversized.db'
    with oversized.open('wb') as stream:
        stream.truncate(snapshot.MAX_SNAPSHOT_BYTES + 1)
    with pytest.raises(snapshot.SnapshotError, match='snapshot_too_large'):
        snapshot.check_snapshot(oversized, now=NOW)


def test_cross_host_sqlite_header_is_accepted_and_install_rebuilds_public_rows(tmp_path):
    source, _ = exported(tmp_path)
    data = bytearray(source.read_bytes())
    # SQLite stores its writing library version in the header. The server can
    # run an older library than the Mac exporting the snapshot.
    data[96:100] = (3040001).to_bytes(4, 'big')
    # Opaque unused header bytes do not become part of the installed cache.
    data[72:76] = b'LEAK'
    source.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    assert snapshot.check_snapshot(source, expected_sha256=digest, now=NOW)['status'] == 'valid'
    destination = tmp_path / 'cache.db'
    result = install(source, destination, digest)
    assert result['sha256'] == hashlib.sha256(destination.read_bytes()).hexdigest()
    assert b'LEAK' not in destination.read_bytes()
    assert read_instrument(source, ID, now=NOW) == read_instrument(destination, ID, now=NOW)
    assert install(source, destination, digest)['status'] == 'unchanged'


def test_export_rejects_invalid_or_excessive_source_rows_and_existing_output(tmp_path):
    source = fixture(tmp_path / 'source.db')
    with sqlite3.connect(source) as conn:
        conn.execute('UPDATE instruments SET id=?', ('unknown',))
    output = tmp_path / 'public.db'
    with pytest.raises(snapshot.SnapshotError, match='invalid_instruments'):
        snapshot.export_snapshot(source, output, now=NOW)
    assert not output.exists()
    source = fixture(tmp_path / 'many.db')
    with sqlite3.connect(source) as conn:
        conn.executemany('INSERT INTO observations(instrument_id,date,value) VALUES (?,?,?)',
                         [(ID, (NOW.date() - timedelta(days=i + 2)).isoformat(), 1)
                          for i in range(snapshot.MAX_OBSERVATIONS)])
    with pytest.raises(snapshot.SnapshotError, match='too_many_observations'):
        snapshot.export_snapshot(source, output, now=NOW)
    output.write_text('preserve me')
    with pytest.raises(snapshot.SnapshotError, match='output_exists'):
        snapshot.export_snapshot(source, output, now=NOW)
    assert output.read_text() == 'preserve me'


def test_install_hash_gate_recovery_and_idempotency(tmp_path):
    old, old_hash = exported(tmp_path, 'old', stamp=NOW - timedelta(days=1))
    new, new_hash = exported(tmp_path, 'new', value=14)
    destination = tmp_path / 'cache.db'
    with pytest.raises(snapshot.SnapshotError, match='sha256_mismatch'):
        install(old, destination, '0' * 64)
    assert not destination.exists()
    assert install(old, destination, old_hash)['status'] == 'installed'
    assert install(old, destination, old_hash)['status'] == 'unchanged'
    assert not Path(str(destination) + '.previous').exists()
    assert install(new, destination, new_hash)['status'] == 'installed'
    previous = Path(str(destination) + '.previous')
    assert previous.read_bytes() == old.read_bytes()
    assert destination.read_bytes() == new.read_bytes()
    assert install(new, destination, new_hash)['status'] == 'unchanged'
    assert previous.read_bytes() == old.read_bytes()
    assert not list(tmp_path.glob('.*.tmp'))


@pytest.mark.parametrize('case', ['older', 'missing-id', 'less-history', 'missing-date'])
def test_install_rejects_stale_and_partial_snapshots(tmp_path, case):
    old, digest = exported(tmp_path, 'old', identifiers=(ID, OTHER),
                           days=('2026-10-20', '2026-10-21', '2026-10-22'))
    destination = tmp_path / 'cache.db'
    install(old, destination, digest)
    kwargs = dict(identifiers=(ID, OTHER), days=('2026-10-20', '2026-10-21', '2026-10-22'))
    if case == 'older':
        kwargs['stamp'] = NOW - timedelta(hours=1)
    elif case == 'missing-id':
        kwargs['identifiers'] = (ID,)
    elif case == 'less-history':
        kwargs['days'] = ('2026-10-22',)
    else:
        kwargs['days'] = ('2026-10-19', '2026-10-20', '2026-10-22')
    new, new_hash = exported(tmp_path, 'new', **kwargs)
    before = destination.read_bytes()
    with pytest.raises(snapshot.SnapshotError, match='stale_snapshot|partial_snapshot'):
        install(new, destination, new_hash)
    assert destination.read_bytes() == before
    assert not Path(str(destination) + '.previous').exists()


def test_installer_refuses_ledger_unrelated_files_links_aliases_and_sidecars(tmp_path):
    source, digest = exported(tmp_path)
    destination = ledger(tmp_path / 'ledger.db')
    before = destination.read_bytes()
    with pytest.raises(snapshot.SnapshotError, match='invalid_snapshot_schema'):
        install(source, destination, digest)
    assert destination.read_bytes() == before
    unrelated = tmp_path / 'unrelated'
    unrelated.write_text('user content')
    with pytest.raises(snapshot.SnapshotError):
        install(source, unrelated, digest)
    assert unrelated.read_text() == 'user content'
    for name, target in [('source-link', source), ('destination-link', unrelated)]:
        link = tmp_path / name
        link.symlink_to(target)
        with pytest.raises(snapshot.SnapshotError, match='unsafe_path'):
            install(link if name == 'source-link' else source,
                    tmp_path / 'unused.db' if name == 'source-link' else link, digest)
    hard = tmp_path / 'hard.db'
    os.link(source, hard)
    with pytest.raises(snapshot.SnapshotError, match='unsafe_path'):
        install(hard, tmp_path / 'unused.db', digest)
    hard.unlink()
    with pytest.raises(snapshot.SnapshotError, match='unsafe_alias'):
        install(source, source, digest)
    destination = tmp_path / 'cache.db'
    for suffix in ('.lock', '.previous'):
        link = Path(str(destination) + suffix)
        link.symlink_to(unrelated)
        with pytest.raises(snapshot.SnapshotError, match='unsafe_path'):
            install(source, destination, digest)
        link.unlink()
    Path(str(destination) + '-wal').write_bytes(b'preserve')
    with pytest.raises(snapshot.SnapshotError, match='snapshot_sidecars'):
        install(source, destination, digest)
    assert not destination.exists()
    assert unrelated.read_text() == 'user content'


def test_supported_symlink_parent_is_resolved_without_replacing_it(tmp_path):
    source, digest = exported(tmp_path)
    actual = tmp_path / 'state'
    actual.mkdir()
    parent = tmp_path / 'state-link'
    parent.symlink_to(actual, target_is_directory=True)
    assert install(source, parent / 'cache.db', digest)['status'] == 'installed'
    assert parent.is_symlink()
    assert (actual / 'cache.db').read_bytes() == source.read_bytes()


@pytest.mark.parametrize('phase', ['write', 'file-fsync', 'recovery-replace', 'install-replace', 'directory-fsync'])
def test_failed_staging_fsync_and_replacement_keep_valid_cache_and_recovery(tmp_path, monkeypatch, phase):
    old, digest = exported(tmp_path, 'old', stamp=NOW - timedelta(days=1))
    new, new_hash = exported(tmp_path, 'new', value=16)
    destination = tmp_path / 'cache.db'
    install(old, destination, digest)
    unrelated = tmp_path / 'other-user-data'
    unrelated.write_text('preserve')
    real_write, real_fsync, real_replace = snapshot._write_file, os.fsync, os.replace

    def write(path, data, check):
        if phase == 'write':
            raise OSError('private exception text')
        real_write(path, data, check)

    def fsync(descriptor):
        directory = os.path.isdir('/dev/fd/' + str(descriptor))
        if phase == 'file-fsync' and not directory or phase == 'directory-fsync' and directory:
            raise OSError('private exception text')
        real_fsync(descriptor)

    def replace(source, target):
        if (phase == 'recovery-replace' and str(target).endswith('.previous') or
                phase == 'install-replace' and target == destination):
            raise OSError('private exception text')
        real_replace(source, target)

    monkeypatch.setattr(snapshot, '_write_file', write)
    monkeypatch.setattr(snapshot.os, 'fsync', fsync)
    monkeypatch.setattr(snapshot.os, 'replace', replace)
    with pytest.raises(snapshot.SnapshotError, match='^install_failed$'):
        install(new, destination, new_hash)
    assert destination.read_bytes() == old.read_bytes()
    assert snapshot.check_snapshot(destination, now=NOW)['status'] == 'valid'
    previous = Path(str(destination) + '.previous')
    if previous.exists():
        assert previous.read_bytes() == old.read_bytes()
    assert unrelated.read_text() == 'preserve'
    assert not list(tmp_path.glob('.*.tmp'))


def test_failure_after_atomic_replace_leaves_new_cache_and_valid_recovery(tmp_path, monkeypatch):
    old, digest = exported(tmp_path, 'old', stamp=NOW - timedelta(days=1))
    new, new_hash = exported(tmp_path, 'new', value=16)
    destination = tmp_path / 'cache.db'
    install(old, destination, digest)
    real_sync = snapshot._fsync_directory
    calls = []

    def sync(parent):
        calls.append(True)
        if len(calls) == 2:
            raise OSError('directory sync failed after atomic replace')
        real_sync(parent)

    monkeypatch.setattr(snapshot, '_fsync_directory', sync)
    with pytest.raises(snapshot.SnapshotError, match='install_failed'):
        install(new, destination, new_hash)
    assert destination.read_bytes() == new.read_bytes()
    assert Path(str(destination) + '.previous').read_bytes() == old.read_bytes()
    assert snapshot.check_snapshot(destination, now=NOW)['status'] == 'valid'


def test_concurrent_installs_serialize_and_cannot_regress(tmp_path):
    old, digest = exported(tmp_path, 'old', stamp=NOW - timedelta(hours=2))
    middle, middle_hash = exported(tmp_path, 'middle', stamp=NOW - timedelta(hours=1), value=14)
    new, new_hash = exported(tmp_path, 'new', value=16)
    destination = tmp_path / 'cache.db'
    install(old, destination, digest)

    def worker(args):
        try:
            return install(args[0], destination, args[1])['status']
        except snapshot.SnapshotError as exc:
            return str(exc)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(worker, [(middle, middle_hash), (new, new_hash)]))
    assert all(result in ('installed', 'stale_snapshot') for result in results)
    assert destination.read_bytes() == new.read_bytes()
    assert snapshot.check_snapshot(Path(str(destination) + '.previous'), now=NOW)['status'] == 'valid'
    assert not list(tmp_path.glob('.*.tmp'))


def test_lock_wait_is_bounded_and_preserves_cache(tmp_path, monkeypatch):
    source, digest = exported(tmp_path)
    destination = tmp_path / 'cache.db'
    monkeypatch.setattr(snapshot, 'MAX_SECONDS', 0.02)

    def blocked(*args):
        raise BlockingIOError()

    monkeypatch.setattr(snapshot.fcntl, 'flock', blocked)
    with pytest.raises(snapshot.SnapshotError, match='snapshot_timeout'):
        install(source, destination, digest)
    assert not destination.exists()


def test_cli_outputs_only_fixed_codes_counts_and_hash(tmp_path):
    source = ledger(tmp_path / 'ledger.db')
    target = tmp_path / 'public.db'
    environment = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
    result = subprocess.run([sys.executable, '-m', 'scripts.market_data_snapshot', 'export', str(source), str(target)],
                            capture_output=True, text=True, timeout=20, env=environment)
    assert result.returncode == 0 and not result.stderr
    report = json.loads(result.stdout)
    assert set(report) == {'status', 'instruments', 'observations', 'sha256'}
    assert SENTINEL not in result.stdout and str(tmp_path) not in result.stdout
    failed = subprocess.run([sys.executable, '-m', 'scripts.market_data_snapshot', 'check', str(source)],
                            capture_output=True, text=True, timeout=20, env=environment)
    assert failed.returncode == 1 and not failed.stderr
    assert json.loads(failed.stdout) == {'status': 'error', 'code': 'invalid_snapshot_schema'}


def test_cli_invalid_arguments_do_not_echo_untrusted_values(capsys):
    assert snapshot.main(['install', 'private-input-value']) == 1
    result = capsys.readouterr()
    assert not result.err
    assert json.loads(result.out) == {'status': 'error', 'code': 'invalid_arguments'}


def test_invalid_sha256_and_previous_file_fail_closed(tmp_path):
    source, digest = exported(tmp_path)
    destination = tmp_path / 'cache.db'
    for invalid in ('', 'Z' * 64, '0' * 63, None):
        with pytest.raises(snapshot.SnapshotError, match='invalid_sha256'):
            install(source, destination, invalid)
    previous = Path(str(destination) + '.previous')
    previous.write_text('preserve unrelated recovery filename')
    with pytest.raises(snapshot.SnapshotError, match='invalid_snapshot'):
        install(source, destination, digest)
    assert previous.read_text() == 'preserve unrelated recovery filename'
    assert not destination.exists()


def test_export_source_size_and_operation_time_are_bounded(tmp_path, monkeypatch):
    source = fixture(tmp_path / 'source.db')
    destination = tmp_path / 'output.db'
    monkeypatch.setattr(snapshot, 'MAX_SOURCE_BYTES', 1)
    with pytest.raises(snapshot.SnapshotError, match='source_too_large'):
        snapshot.export_snapshot(source, destination, now=NOW)
    assert not destination.exists()
    monkeypatch.setattr(snapshot, 'MAX_SOURCE_BYTES', 64 * 1024 * 1024)
    monkeypatch.setattr(snapshot, 'MAX_SECONDS', 0)
    with pytest.raises(snapshot.SnapshotError, match='snapshot_timeout'):
        snapshot.export_snapshot(source, destination, now=NOW)
    assert not destination.exists()


def test_direct_script_cli_works_outside_repo_without_pythonpath(tmp_path):
    script = Path(snapshot.__file__).resolve()
    environment = {key: value for key, value in os.environ.items() if key != 'PYTHONPATH'}
    environment['PYTHONDONTWRITEBYTECODE'] = '1'
    for arguments, status in [(['--help'], 0), (['check', 'missing-private-filename'], 1)]:
        result = subprocess.run([sys.executable, str(script), *arguments], cwd=tmp_path,
                                capture_output=True, text=True, timeout=20, env=environment)
        assert result.returncode == status and not result.stderr
        if status:
            assert json.loads(result.stdout) == {'status': 'error', 'code': 'snapshot_unavailable'}
            assert 'missing-private-filename' not in result.stdout


def test_install_rejects_three_row_rollover_below_retention_cap(tmp_path):
    old, old_hash = exported(tmp_path, 'old', days=('2026-10-20', '2026-10-21', '2026-10-22'))
    new, new_hash = exported(tmp_path, 'new', days=('2026-10-21', '2026-10-22', '2026-10-23'))
    destination = tmp_path / 'cache.db'
    install(old, destination, old_hash)
    with pytest.raises(snapshot.SnapshotError, match='partial_snapshot'):
        install(new, destination, new_hash)
    assert destination.read_bytes() == old.read_bytes()
    assert not Path(str(destination) + '.previous').exists()


def test_install_accepts_legitimate_full_retention_rollover(tmp_path):
    old_days = tuple((NOW.date() - timedelta(days=i)).isoformat()
                     for i in range(snapshot.MAX_OBSERVATIONS, 0, -1))
    new_days = (*old_days[1:], NOW.date().isoformat())
    old, old_hash = exported(tmp_path, 'old', stamp=NOW - timedelta(days=1), days=old_days)
    new, new_hash = exported(tmp_path, 'new', days=new_days)
    destination = tmp_path / 'cache.db'
    install(old, destination, old_hash)
    assert install(new, destination, new_hash)['status'] == 'installed'
    assert destination.read_bytes() == new.read_bytes()
    assert Path(str(destination) + '.previous').read_bytes() == old.read_bytes()
    saved = read_instrument(destination, ID, now=NOW)['observations']
    assert len(saved) == snapshot.MAX_OBSERVATIONS
    assert saved[0]['date'] == old_days[1] and saved[-1]['date'] == NOW.date().isoformat()


@pytest.mark.parametrize('target_name,method', [
    ('destination', 'replace'), ('destination', 'in-place'),
    ('previous', 'replace'), ('previous', 'in-place'), ('lock', 'replace'),
])
def test_operator_target_changes_during_staging_are_preserved(tmp_path, monkeypatch, target_name, method):
    oldest, oldest_hash = exported(tmp_path, 'oldest', stamp=NOW - timedelta(hours=2))
    old, old_hash = exported(tmp_path, 'old', stamp=NOW - timedelta(hours=1), value=14)
    new, new_hash = exported(tmp_path, 'new', value=16)
    destination = tmp_path / 'cache.db'
    install(oldest, destination, oldest_hash)
    install(old, destination, old_hash)
    previous, lock = Path(str(destination) + '.previous'), Path(str(destination) + '.lock')
    target = dict(destination=destination, previous=previous, lock=lock)[target_name]
    private = b'operator-created-unrelated-file'
    real_write = snapshot._write_file
    changed = []

    def write(path, data, check):
        real_write(path, data, check)
        if not changed:
            if method == 'replace':
                incoming = tmp_path / 'operator-change'
                incoming.write_bytes(private)
                os.replace(incoming, target)
            else:
                target.write_bytes(private)
            changed.append(True)

    monkeypatch.setattr(snapshot, '_write_file', write)
    with pytest.raises(snapshot.SnapshotError, match='target_changed|lock_changed'):
        install(new, destination, new_hash)
    assert changed == [True]
    assert target.read_bytes() == private
    if target != destination:
        assert destination.read_bytes() == old.read_bytes()
    if target != previous:
        assert previous.read_bytes() == oldest.read_bytes()
    assert not list(tmp_path.glob('.*.tmp'))


@pytest.mark.parametrize('target_name', ['destination', 'previous'])
def test_operator_creation_of_absent_target_during_staging_is_preserved(tmp_path, monkeypatch, target_name):
    source, digest = exported(tmp_path)
    destination = tmp_path / 'cache.db'
    target = destination if target_name == 'destination' else Path(str(destination) + '.previous')
    private = b'new unrelated operator file'
    real_write = snapshot._write_file

    def write(path, data, check):
        real_write(path, data, check)
        target.write_bytes(private)

    monkeypatch.setattr(snapshot, '_write_file', write)
    with pytest.raises(snapshot.SnapshotError, match='target_changed'):
        install(source, destination, digest)
    assert target.read_bytes() == private
    if target != destination:
        assert not destination.exists()
    assert not list(tmp_path.glob('.*.tmp'))


def test_operator_destination_replacement_after_recovery_commit_is_preserved(tmp_path, monkeypatch):
    old, old_hash = exported(tmp_path, 'old', stamp=NOW - timedelta(days=1))
    new, new_hash = exported(tmp_path, 'new', value=16)
    destination = tmp_path / 'cache.db'
    install(old, destination, old_hash)
    real_sync = snapshot._fsync_directory
    private = b'operator destination replacement after recovery write'
    changed = []

    def sync(parent):
        real_sync(parent)
        if not changed:
            incoming = tmp_path / 'operator-change'
            incoming.write_bytes(private)
            os.replace(incoming, destination)
            changed.append(True)

    monkeypatch.setattr(snapshot, '_fsync_directory', sync)
    with pytest.raises(snapshot.SnapshotError, match='target_changed'):
        install(new, destination, new_hash)
    assert destination.read_bytes() == private
    assert Path(str(destination) + '.previous').read_bytes() == old.read_bytes()
    assert not list(tmp_path.glob('.*.tmp'))


def _expanded_fx_ids(count):
    import itertools
    return ['fx-USD-' + ''.join(parts)
            for parts in list(itertools.product('ABCDEFGHIJKLMNOPQRSTUVWXYZ', repeat=3))[:count]]


def test_expanded_catalog_roundtrip_preserves_all_series(tmp_path):
    identifiers = tuple(item.id for item in STOCKS) + tuple(_expanded_fx_ids(200))
    assert len(STOCKS) == 100
    source = fixture(tmp_path / 'expanded-source.db', identifiers=identifiers)
    with sqlite3.connect(source) as conn:
        conn.execute("UPDATE instruments SET refresh_days=32 WHERE id LIKE 'stock-%'")
    before = source.read_bytes()
    incoming, destination = tmp_path / 'expanded.db', tmp_path / 'installed.db'
    report = snapshot.export_snapshot(source, incoming, now=NOW)
    assert source.read_bytes() == before
    assert report['instruments'] == 300 and report['observations'] == 300
    assert install(incoming, destination, report['sha256'])['instruments'] == 300
    assert len(list_instruments(destination, 'stock', now=NOW)) == 100
    assert len(list_instruments(destination, 'fx', now=NOW)) == 200
    assert read_instrument(destination, STOCKS[-1].id, now=NOW)['refresh_days'] == 32
    assert read_instrument(destination, identifiers[-1], now=NOW)['latest_value'] == 12.5


def test_expanded_snapshot_rejects_oversized_fx_subset_even_below_total_bound(tmp_path):
    source = fixture(tmp_path / 'too-many-fx.db', identifiers=tuple(_expanded_fx_ids(201)))
    with pytest.raises(snapshot.SnapshotError, match='invalid_instruments'):
        snapshot.export_snapshot(source, tmp_path / 'rejected.db', now=NOW)


def test_monthly_cadence_has_explicit_upper_bound(tmp_path):
    source = fixture(tmp_path / 'cadence.db')
    with sqlite3.connect(source) as conn:
        conn.execute('UPDATE instruments SET refresh_days=33')
    with pytest.raises(snapshot.SnapshotError, match='invalid_instruments'):
        snapshot.export_snapshot(source, tmp_path / 'rejected.db', now=NOW)


def test_original_private_v2_export_does_not_migrate_source(tmp_path):
    source = ledger(tmp_path / 'original-v2.db')
    with sqlite3.connect(source) as conn:
        conn.execute('DROP TABLE IF EXISTS rolling_authorizations')
        conn.execute('PRAGMA user_version=2')
    before = source.read_bytes()
    result = snapshot.export_snapshot(source, tmp_path / 'public-v1.db', now=NOW)
    assert result['instruments'] == 1
    assert source.read_bytes() == before
    with sqlite3.connect(tmp_path / 'public-v1.db') as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == 1
        assert conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall() == [
            ('instruments',), ('observations',)]


def test_rolling_authorization_is_never_in_public_snapshot(tmp_path):
    from scripts.vendor_data_store import authorize_rolling_budget, finish_job
    source = ledger(tmp_path / 'rolling-private.db')
    with sqlite3.connect(source) as conn:
        token = conn.execute('SELECT token FROM jobs').fetchone()[0]
    finish_job(source, token, now=NOW)
    authorize_rolling_budget(source, 'marketstack', NOW, NOW + timedelta(days=32),
                             expected_used=5, now=NOW)
    before = source.read_bytes()
    assert b'rolling_authorizations' in before
    output = tmp_path / 'rolling-public.db'
    assert snapshot.export_snapshot(source, output, now=NOW)['instruments'] == 1
    assert source.read_bytes() == before
    assert b'rolling_authorizations' not in output.read_bytes()
    assert SENTINEL.encode() not in output.read_bytes()
    with sqlite3.connect(output) as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0] == 1
        assert conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall() == [
            ('instruments',), ('observations',)]
