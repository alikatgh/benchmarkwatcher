#!/usr/bin/env python3
"""Refresh one due, already-populated public dataset from the existing daily job."""
import argparse
import fcntl
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.public_data_store import read_connection

INTERVALS = {('worldbank', 'WDI'): 14, ('faostat', 'QCL'): 30,
             ('faostat', 'RL'): 30, ('faostat', 'TCL'): 30, ('sec', 'frames'): 7}
ROOT = Path(__file__).resolve().parents[1]
REFRESH_TIMEOUTS = {('worldbank','WDI'): 3600, ('faostat','TCL'): 7200}


def configured_database(data_dir=None):
    return Path(os.environ.get('PUBLIC_LIBRARY_DB') or
                Path(data_dir or ROOT/'data')/'public-library.sqlite3')


def due_dataset(database, now=None):
    now = now or datetime.now(timezone.utc)
    conn = read_connection(database)
    if conn is None:
        return None
    try:
        due = []
        attempts = {}
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='refresh_attempts'").fetchone():
            attempts = {(r['source'], r['dataset']): datetime.fromisoformat(r['attempted_at'])
                        for r in conn.execute('SELECT * FROM refresh_attempts')}
        for row in conn.execute('SELECT source,dataset,checked_at FROM datasets'):
            interval = INTERVALS.get((row['source'], row['dataset']))
            if interval is None:
                continue
            attempted = attempts.get((row['source'], row['dataset']))
            # A failing provider must not monopolize every subsequent daily run.
            if attempted and now - attempted < timedelta(days=3):
                continue
            checked = datetime.fromisoformat(row['checked_at'].replace('Z', '+00:00'))
            overdue = (now - checked).total_seconds() - timedelta(days=interval).total_seconds()
            if overdue >= 0:
                # Unattempted, then least-recently attempted datasets get a turn.
                # Several failing domains must not monopolize the daily job.
                due.append((attempted.timestamp() if attempted else float('-inf'),
                            -overdue, row['source'], row['dataset']))
        return min(due)[2:] if due else None
    finally:
        conn.close()


def command_for(source, dataset, database, scratch):
    scripts = {'worldbank': 'import_worldbank_library.py', 'faostat': 'import_faostat_library.py',
               'sec': 'import_sec_library.py'}
    if (source, dataset) not in INTERVALS:
        raise ValueError('Unsupported maintained dataset')
    command = [sys.executable, str(ROOT/'scripts'/scripts[source]), '--database', str(database),
               '--scratch-dir', str(scratch)]
    if source == 'faostat':
        command += ['--dataset', dataset]
        if dataset == 'TCL':
            command += ['--max-seconds', '7000']
    elif source == 'sec':
        # Eight measures across at most twelve years stay within 100 requests.
        # The merge retains previously saved older periods.
        end_year = date.today().year - 1
        command += ['--start-year', str(max(2015, end_year - 11)), '--end-year', str(end_year)]
    return command


def record_attempt(database, source, dataset, now):
    with sqlite3.connect(database, timeout=60) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS refresh_attempts (source TEXT,dataset TEXT,attempted_at TEXT NOT NULL,PRIMARY KEY(source,dataset))')
        conn.execute('INSERT OR REPLACE INTO refresh_attempts VALUES (?,?,?)', (source, dataset, now.isoformat()))


def refresh_due(database, scratch_root=None, now=None):
    now = now or datetime.now(timezone.utc)
    database = Path(database).resolve()
    if not database.is_file():
        return {'status': 'not_populated', 'network_requests': 0}
    lock_path = database.with_suffix('.refresh.lock')
    if lock_path.is_symlink():
        raise ValueError('Refusing a symlinked refresh lock')
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'already_running', 'network_requests': 0}
        selected = due_dataset(database, now)
        if not selected:
            return {'status': 'current', 'network_requests': 0}
        # The transaction can journal old pages alongside the current library.
        # Keep a reserve and defer without erasing any data if space is tight.
        needed = max(1024**3, int(database.stat().st_size * 1.3) + 512*1024**2)
        if shutil.disk_usage(database.parent).free < needed:
            return {'status': 'deferred_storage', 'network_requests': 0,
                    'required_free_bytes': needed, 'source': selected[0], 'dataset': selected[1]}
        root = Path(scratch_root) if scratch_root else database.parent
        record_attempt(database, *selected, now)
        with tempfile.TemporaryDirectory(prefix='library-refresh-', dir=root) as scratch:
            result = subprocess.run(command_for(*selected, database, scratch), cwd=ROOT,
                                    env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                                    capture_output=True, text=True,
                                    timeout=REFRESH_TIMEOUTS.get(selected, 1800))
        if result.returncode:
            return {'status': 'failed', 'source': selected[0], 'dataset': selected[1],
                    'reason': (result.stderr or result.stdout)[-1000:]}
        return {'status': 'refreshed', 'source': selected[0], 'dataset': selected[1],
                'result': json.loads(result.stdout)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=configured_database())
    parser.add_argument('--scratch-dir', type=Path)
    parser.add_argument('--status', action='store_true', help='Report which dataset is due without any writes or network requests')
    args = parser.parse_args(argv)
    if args.status:
        print(json.dumps({'next_due': due_dataset(args.database), 'network_requests': 0}))
        return 0
    try:
        report = refresh_due(args.database, args.scratch_dir)
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'status': 'failed', 'reason': str(exc)[:500]}))
        return 1
    print(json.dumps(report))
    return 1 if report['status'] == 'failed' else 0


if __name__ == '__main__':
    raise SystemExit(main())
