"""Transfer public market observations without credentials or the local quota ledger.

This module never loads environment files or imports the provider collector. Only
explicit SELECTs from one read transaction enter a newly built two-table cache.
Installers cooperate through flock in a trusted application directory. Last-moment
identity/content checks detect ordinary operator changes; POSIX replace is not a
compare-and-swap against a malicious same-user writer racing the final syscall.
"""
import argparse
import fcntl
import hashlib
import json
import math
import os
import re
import sqlite3
import stat
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.market_data_catalog import CATALOG
from scripts.vendor_data_store import (
    APPLICATION_ID, CACHE_SCHEMA, LEDGER_SCHEMA_VERSION, MAX_OBSERVATIONS, SCHEMA_VERSION,
)

MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_SECONDS = 15
MAX_NUMBER = 1e18
MAX_INSTRUMENTS = 300
MAX_STOCK_INSTRUMENTS = 100
MAX_FX_INSTRUMENTS = 200
STAMP = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\Z')


class SnapshotError(Exception):
    """A fixed operator error code; never a path, row, or vendor response."""


def _deadline():
    end = time.monotonic() + MAX_SECONDS

    def check():
        if time.monotonic() >= end:
            raise SnapshotError('snapshot_timeout')
    check.end = end
    return check


def _path(value):
    # Resolve parent links (including macOS /tmp and configured state links), but
    # never follow a link at the database, recovery, or lock filename itself.
    path = Path(value)
    if path.name in ('', '.', '..'):
        raise SnapshotError('unsafe_path')
    try:
        result = path.parent.resolve(strict=True) / path.name
        if result.is_symlink():
            raise SnapshotError('unsafe_path')
        if result.exists():
            info = result.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise SnapshotError('unsafe_path')
        return result
    except (OSError, RuntimeError):
        raise SnapshotError('unsafe_path') from None


def _sidecars(path):
    if any(os.path.lexists(str(path) + suffix) for suffix in ('-wal', '-shm', '-journal')):
        raise SnapshotError('snapshot_sidecars')


def _schema(conn):
    return conn.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()


def _expected_schema():
    with sqlite3.connect(':memory:') as conn:
        conn.executescript(CACHE_SCHEMA)
        return _schema(conn)


EXPECTED_SCHEMA = _expected_schema()


def _configure(conn, check):
    conn.execute('PRAGMA trusted_schema=OFF')
    conn.execute('PRAGMA query_only=ON')
    conn.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 65536)
    conn.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 10000)
    conn.set_progress_handler(lambda: int(time.monotonic() >= check.end), 1000)


def _clock():
    return _deadline()


def _read_public(conn, now, check):
    instruments = conn.execute('SELECT id,last_success,refresh_days FROM instruments ORDER BY id LIMIT ?',
                               (MAX_INSTRUMENTS + 1,)).fetchall()
    if not 1 <= len(instruments) <= MAX_INSTRUMENTS:
        raise SnapshotError('invalid_instruments')
    counts_by_kind = {'stock': 0, 'fx': 0}
    for identifier, _, _ in instruments:
        item = CATALOG.get(identifier)
        if item is None or item.kind not in counts_by_kind:
            raise SnapshotError('invalid_instruments')
        counts_by_kind[item.kind] += 1
    if (counts_by_kind['stock'] > MAX_STOCK_INSTRUMENTS or
            counts_by_kind['fx'] > MAX_FX_INSTRUMENTS):
        raise SnapshotError('invalid_instruments')
    identifiers, stamps = set(), {}
    for identifier, stamp, cadence in instruments:
        if identifier not in CATALOG or type(cadence) is not int or not 1 <= cadence <= 32:
            raise SnapshotError('invalid_instruments')
        if not isinstance(stamp, str) or not STAMP.fullmatch(stamp):
            raise SnapshotError('invalid_timestamp')
        try:
            parsed = datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone(timezone.utc)
        except (ValueError, OverflowError):
            raise SnapshotError('invalid_timestamp') from None
        if not datetime(1970, 1, 1, tzinfo=timezone.utc) <= parsed <= now:
            raise SnapshotError('invalid_timestamp')
        identifiers.add(identifier)
        stamps[identifier] = parsed
    observations = conn.execute(
        'SELECT instrument_id,date,value,open,high,low,close,adjusted_close,volume FROM observations '
        'ORDER BY instrument_id,date LIMIT ?', (MAX_INSTRUMENTS * MAX_OBSERVATIONS + 1,)).fetchall()
    if len(observations) > MAX_INSTRUMENTS * MAX_OBSERVATIONS:
        raise SnapshotError('too_many_observations')
    counts = dict.fromkeys(identifiers, 0)
    for identifier, day, value, *optional in observations:
        check()
        try:
            parsed_day = date.fromisoformat(day)
        except (ValueError, TypeError):
            raise SnapshotError('invalid_date') from None
        if (identifier not in identifiers or day != parsed_day.isoformat() or
                not date(1900, 1, 1) <= parsed_day <= stamps[identifier].date()):
            raise SnapshotError('invalid_date')
        if (type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= MAX_NUMBER or
                any(v is not None and (type(v) not in (int, float) or not math.isfinite(v) or
                                       not 0 <= v <= MAX_NUMBER) for v in optional)):
            raise SnapshotError('invalid_value')
        counts[identifier] += 1
        if counts[identifier] > MAX_OBSERVATIONS:
            raise SnapshotError('too_many_observations')
    if not all(counts.values()):
        raise SnapshotError('empty_instrument')
    return instruments, observations


def _build(public, check):
    with sqlite3.connect(':memory:') as conn:
        conn.execute('PRAGMA page_size=4096')
        conn.executescript(CACHE_SCHEMA)
        conn.execute(f'PRAGMA application_id={APPLICATION_ID}')
        conn.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
        conn.executemany('INSERT INTO instruments VALUES (?,?,?)', public[0])
        conn.executemany('INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?)', public[1])
        conn.commit()
        check()
        data = conn.serialize()
    if len(data) > MAX_SNAPSHOT_BYTES:
        raise SnapshotError('snapshot_too_large')
    return data


def _parse(data, now, check):
    if not data or len(data) > MAX_SNAPSHOT_BYTES:
        raise SnapshotError('snapshot_too_large')
    try:
        with sqlite3.connect(':memory:') as conn:
            conn.deserialize(data)
            _configure(conn, check)
            if (conn.execute('PRAGMA application_id').fetchone()[0] != APPLICATION_ID or
                    conn.execute('PRAGMA user_version').fetchone()[0] != SCHEMA_VERSION or
                    _schema(conn) != EXPECTED_SCHEMA):
                raise SnapshotError('invalid_snapshot_schema')
            if (conn.execute('PRAGMA page_size').fetchone()[0] != 4096 or
                    conn.execute('PRAGMA page_count').fetchone()[0] * 4096 != len(data) or
                    conn.execute('PRAGMA freelist_count').fetchone()[0] != 0 or
                    conn.execute('PRAGMA quick_check(1)').fetchall() != [('ok',)] or
                    conn.execute('PRAGMA foreign_key_check').fetchone()):
                raise SnapshotError('invalid_snapshot')
            public = _read_public(conn, now, check)
            return public
    except sqlite3.Error:
        check()
        raise SnapshotError('invalid_snapshot') from None


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _read_file(path, check, *, capture=False):
    _sidecars(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise SnapshotError('unsafe_path')
        if before.st_size > MAX_SNAPSHOT_BYTES:
            raise SnapshotError('snapshot_too_large')
        with os.fdopen(descriptor, 'rb', closefd=False) as stream:
            data = stream.read(MAX_SNAPSHOT_BYTES + 1)
        after = os.fstat(descriptor)
        check()
        if _identity(before) != _identity(after) or _identity(after) != _identity(path.lstat()):
            raise SnapshotError('snapshot_changed')
        return (data, _identity(after)) if capture else data
    finally:
        os.close(descriptor)


def _load(path, now, check, expected_sha256=None, *, capture=False):
    loaded = _read_file(path, check, capture=capture)
    data, identity = loaded if capture else (loaded, None)
    digest = hashlib.sha256(data).hexdigest()
    if expected_sha256 is not None:
        if not isinstance(expected_sha256, str) or not re.fullmatch('[0-9a-f]{64}', expected_sha256):
            raise SnapshotError('invalid_sha256')
        if digest != expected_sha256:
            raise SnapshotError('sha256_mismatch')
    result = data, _parse(data, now, check), digest
    return (*result, (identity, digest)) if capture else result


def _assert_target(path, expected, check):
    try:
        _sidecars(path)
        if expected is None:
            if os.path.lexists(path):
                raise SnapshotError('target_changed')
        else:
            data, identity = _read_file(path, check, capture=True)
            if (identity, hashlib.sha256(data).hexdigest()) != expected:
                raise SnapshotError('target_changed')
    except (OSError, SnapshotError) as exc:
        if isinstance(exc, SnapshotError) and str(exc) == 'snapshot_timeout':
            raise
        raise SnapshotError('target_changed') from None


def _report(status, public, digest):
    return dict(status=status, instruments=len(public[0]), observations=len(public[1]), sha256=digest)


def _now(value):
    result = value or datetime.now(timezone.utc)
    if not isinstance(result, datetime) or result.tzinfo is None:
        raise SnapshotError('invalid_timestamp')
    return result.astimezone(timezone.utc)


def _fsync_directory(parent):
    descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_file(path, data, check):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    identity = os.fstat(descriptor)
    try:
        with os.fdopen(descriptor, 'wb', closefd=False) as stream:
            for offset in range(0, len(data), 65536):
                check()
                stream.write(data[offset:offset + 65536])
            stream.flush()
            os.fsync(descriptor)
    except BaseException:
        if path.exists() and path.stat().st_ino == identity.st_ino:
            path.unlink()
        raise
    finally:
        os.close(descriptor)


def export_snapshot(source, output, *, now=None):
    check, now = _clock(), _now(now)
    source, output = _path(source), _path(output)
    if os.path.lexists(output):
        raise SnapshotError('output_exists')
    _sidecars(output)
    try:
        if source.stat().st_size + sum(Path(str(source) + suffix).stat().st_size
                                      for suffix in ('-wal', '-journal')
                                      if Path(str(source) + suffix).exists()) > MAX_SOURCE_BYTES:
            raise SnapshotError('source_too_large')
        conn = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=1)
        try:
            _configure(conn, check)
            conn.execute('BEGIN')
            if (conn.execute('PRAGMA application_id').fetchone()[0] != APPLICATION_ID or
                    conn.execute('PRAGMA user_version').fetchone()[0] not in
                    (SCHEMA_VERSION, 2, LEDGER_SCHEMA_VERSION)):
                raise SnapshotError('invalid_source_schema')
            public = _read_public(conn, now, check)
        finally:
            conn.close()
        data = _build(public, check)
        _parse(data, now, check)
        _write_file(output, data, check)
        _fsync_directory(output.parent)
        return _report('exported', public, hashlib.sha256(data).hexdigest())
    except (OSError, sqlite3.Error):
        check()
        raise SnapshotError('export_failed') from None


def check_snapshot(snapshot, *, expected_sha256=None, now=None):
    try:
        _, public, digest = _load(_path(snapshot), _now(now), _clock(), expected_sha256)
        return _report('valid', public, digest)
    except OSError:
        raise SnapshotError('snapshot_unavailable') from None


def _not_stale(current, incoming):
    old = {row[0]: row[1:] for row in current[0]}
    new = {row[0]: row[1:] for row in incoming[0]}
    if not old.keys() <= new.keys():
        raise SnapshotError('partial_snapshot')
    for identifier, (stamp, _) in old.items():
        parse = lambda value: datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parse(new[identifier][0]) < parse(stamp):
            raise SnapshotError('stale_snapshot')
        before = [r for r in current[1] if r[0] == identifier]
        after = [r for r in incoming[1] if r[0] == identifier]
        if len(after) < len(before) or after[-1][1] < before[-1][1]:
            raise SnapshotError('partial_snapshot')
        dates = {r[1] for r in after}
        evicted = [row[1] for row in before if row[1] not in dates]
        if evicted and (len(after) != MAX_OBSERVATIONS or
                        any(day >= after[0][1] for day in evicted)):
            raise SnapshotError('partial_snapshot')


@contextmanager
def _locked(path, check):
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise SnapshotError('unsafe_path')
        while True:
            check()
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                time.sleep(0.01)
        def guard():
            check()
            try:
                current = path.lstat()
                if ((current.st_dev, current.st_ino) != (info.st_dev, info.st_ino) or
                        not stat.S_ISREG(current.st_mode) or current.st_nlink != 1):
                    raise SnapshotError('lock_changed')
            except OSError:
                raise SnapshotError('lock_changed') from None
        guard()
        yield guard
    finally:
        os.close(descriptor)


def install_snapshot(snapshot, destination, *, expected_sha256, now=None):
    if not isinstance(expected_sha256, str) or not re.fullmatch('[0-9a-f]{64}', expected_sha256):
        raise SnapshotError('invalid_sha256')
    check, now = _clock(), _now(now)
    snapshot, destination = _path(snapshot), _path(destination)
    previous = _path(str(destination) + '.previous')
    lock = _path(str(destination) + '.lock')
    if snapshot in (destination, previous, lock):
        raise SnapshotError('unsafe_alias')
    stages = []
    try:
        _, public, _ = _load(snapshot, now, check, expected_sha256)
        # Rebuild rather than copy opaque database bytes. SQLite versions can
        # encode identical rows differently; transport hashes authenticate the
        # received file, while this fresh file contains only validated data.
        data = _build(public, check)
        digest = hashlib.sha256(data).hexdigest()
        with _locked(lock, check) as lock_guard:
            # Recheck targets after locking: another installer may have replaced
            # them while this process waited. No existing ledger is ever replaced.
            destination, previous = _path(destination), _path(previous)
            _sidecars(destination)
            _sidecars(previous)
            current_data, current = None, None
            destination_state, previous_state = None, None
            if destination.exists():
                _, current, current_digest, destination_state = _load(destination, now, check, capture=True)
                _not_stale(current, public)
                current_data = _build(current, check)
            if previous.exists():
                _, _, _, previous_state = _load(previous, now, check, capture=True)

            def guard_targets():
                lock_guard()
                _assert_target(destination, destination_state, check)
                _assert_target(previous, previous_state, check)
                lock_guard()

            if current == public:
                guard_targets()
                return _report('unchanged', public, current_digest)
            stage = destination.with_name('.' + destination.name + '.' + uuid.uuid4().hex + '.tmp')
            stages.append(stage)
            _write_file(stage, data, check)
            if current_data is not None:
                recovery = destination.with_name('.' + destination.name + '.' + uuid.uuid4().hex + '.tmp')
                stages.append(recovery)
                _write_file(recovery, current_data, check)
                recovery_identity = _identity(recovery.stat())
                guard_targets()
                os.replace(recovery, previous)
                _, _, recovery_digest, previous_state = _load(previous, now, check, capture=True)
                if (previous_state[0][:2] != recovery_identity[:2] or
                        recovery_digest != hashlib.sha256(current_data).hexdigest()):
                    raise SnapshotError('target_changed')
                _fsync_directory(destination.parent)
            guard_targets()
            os.replace(stage, destination)
            _fsync_directory(destination.parent)
        return _report('installed', public, digest)
    except OSError:
        raise SnapshotError('install_failed') from None
    finally:
        for stage in stages:
            try:
                if stage.exists():
                    stage.unlink()
            except OSError:
                raise SnapshotError('install_failed') from None


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise SnapshotError('invalid_arguments')


def main(argv=None):
    parser = _Parser(description='Offline public market snapshot transfer')
    commands = parser.add_subparsers(dest='command', required=True)
    export = commands.add_parser('export')
    export.add_argument('source')
    export.add_argument('output')
    verify = commands.add_parser('check')
    verify.add_argument('snapshot')
    verify.add_argument('--sha256')
    install = commands.add_parser('install')
    install.add_argument('snapshot')
    install.add_argument('destination')
    install.add_argument('--sha256', required=True)
    try:
        args = parser.parse_args(argv)
        if args.command == 'export':
            result = export_snapshot(args.source, args.output)
        elif args.command == 'check':
            result = check_snapshot(args.snapshot, expected_sha256=args.sha256)
        else:
            result = install_snapshot(args.snapshot, args.destination, expected_sha256=args.sha256)
    except SnapshotError as exc:
        print(json.dumps({'status': 'error', 'code': str(exc)}, sort_keys=True))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
