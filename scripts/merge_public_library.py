"""Append one absent public dataset from a staging SQLite database, offline.

No target copy is made. DELETE/FULL journaling, a page ceiling, an elapsed-time
limit, and a physical allocation/free-space guard bound the transaction; any
rejection rolls it back.
Existing datasets and observations are never updated or replaced.
"""
import argparse
import json
import math
import os
import re
import shutil
import sqlite3
import time
from contextlib import closing
from datetime import date
from pathlib import Path

try:
    from .public_data_store import (FIELDS, SCHEMA, SOURCES, _timestamp, _url,
                                    decode_metadata, encode_metadata, series_id)
except ImportError:  # Direct CLI invocation.
    from public_data_store import (FIELDS, SCHEMA, SOURCES, _timestamp, _url,
                                   decode_metadata, encode_metadata, series_id)

MIB = 1024 * 1024
MIN_RESERVE_BYTES = 512 * MIB
CHECK_HEADROOM_BYTES = 16 * MIB
CHECK_INTERVAL = 128
SERIES_COLUMNS = FIELDS + ('observation_count', 'first_period', 'last_period', 'last_value')
OBSERVATION_COLUMNS = ('series_id', 'period', 'value', 'metadata', 'source_url', 'checked_at')
REVISION_COLUMNS = OBSERVATION_COLUMNS + ('superseded_at',)
DATASET_COLUMNS = ('source', 'dataset', 'checked_at', 'series_count', 'entity_count',
                   'indicator_count', 'observation_count')
CORE_TABLES = ('series', 'observations', 'observation_revisions', 'datasets')
FAOSTAT_RUN_COLUMNS = ('dataset', 'checked_at', 'source_updated_at', 'start_year', 'end_year',
                       'archive_name', 'archive_bytes', 'rows_read', 'observations_imported', 'skipped_counts')
# Evidence table created by the FAOSTAT importer. Explicitly supported rather
# than accepting arbitrary staging SQL or silently dropping extra source data.
FAOSTAT_RUN_SCHEMA = '''CREATE TABLE IF NOT EXISTS faostat_import_runs (
    dataset TEXT NOT NULL, checked_at TEXT NOT NULL, source_updated_at TEXT,
    start_year INTEGER NOT NULL, end_year INTEGER NOT NULL, archive_name TEXT NOT NULL,
    archive_bytes INTEGER NOT NULL, rows_read INTEGER NOT NULL,
    observations_imported INTEGER NOT NULL, skipped_counts TEXT NOT NULL,
    PRIMARY KEY (dataset, checked_at)
)'''


class MergeError(ValueError):
    """The dataset was not committed; the target's prior data is preserved."""


class _RuntimeGuard:
    def __init__(self, max_seconds):
        if (type(max_seconds) not in (int, float) or not math.isfinite(max_seconds)
                or max_seconds <= 0):
            raise MergeError('Maximum runtime must be a positive finite seconds value')
        self.max_seconds = max_seconds
        self.deadline = time.monotonic() + max_seconds
        self.failure = None

    def check(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            self.failure = MergeError('Merge exceeds maximum elapsed runtime of ' + str(self.max_seconds) + ' seconds')
            raise self.failure
        return remaining

    def progress(self):
        try:
            self.check()
            return 0
        except MergeError:
            return 1

    def configure(self, conn):
        conn.set_progress_handler(self.progress, 10000)
        self.busy_timeout(conn)

    def busy_timeout(self, conn):
        # SQLite progress callbacks do not run while waiting for a lock.
        conn.execute('PRAGMA busy_timeout=' + str(max(0, int(min(30, self.check()) * 1000))))


def _schema_statements():
    pending = ''
    for line in SCHEMA.splitlines(keepends=True):
        pending += line
        if sqlite3.complete_statement(pending):
            yield pending
            pending = ''
    if pending.strip():
        raise MergeError('Incomplete canonical library schema')


def _canonical_schema(runtime):
    with closing(sqlite3.connect(':memory:')) as conn:
        runtime.configure(conn)
        conn.executescript(SCHEMA)
        conn.execute(FAOSTAT_RUN_SCHEMA)
        columns = {name: conn.execute('PRAGMA table_info(' + name + ')').fetchall()
                   for name in CORE_TABLES + ('faostat_import_runs',)}
        objects = dict(conn.execute("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL"))
    return columns, objects


def _normalized_sql(sql):
    return re.sub(r'\s+', '', sql or '').lower()


def _check_schema(conn, *, target, runtime):
    runtime.busy_timeout(conn)
    expected_columns, expected_objects = _canonical_schema(runtime)
    actual_objects = dict(conn.execute("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL"))
    for name, columns in expected_columns.items():
        runtime.check()
        if name == 'faostat_import_runs' and name not in actual_objects:
            continue
        if conn.execute('PRAGMA table_info(' + name + ')').fetchall() != columns:
            raise MergeError('Unsupported library schema: ' + name)
    for name, sql in expected_objects.items():
        runtime.check()
        if name in actual_objects and _normalized_sql(actual_objects[name]) != _normalized_sql(sql):
            raise MergeError('Unsupported library schema object: ' + name)
    if target:
        for name in ('series_search', 'library_search_insert', 'library_search_delete', 'library_search_update'):
            if name not in actual_objects:
                raise MergeError('Target library is missing its search schema: ' + name)
        triggers = conn.execute("SELECT name,tbl_name FROM sqlite_master WHERE type='trigger'")
        for name, table in triggers:
            runtime.check()
            if table in CORE_TABLES + ('faostat_import_runs',) and name not in expected_objects:
                raise MergeError('Unsupported target library trigger: ' + name)
    else:
        # Extra source-specific tables may carry evidence that this merger does
        # not understand. Refuse to silently leave that evidence behind.
        for name, in conn.execute("SELECT name FROM sqlite_master WHERE type='table'"):
            runtime.check()
            if name in expected_objects or name.startswith('sqlite_'):
                continue
            quoted = '"' + name.replace('"', '""') + '"'
            if conn.execute('SELECT 1 FROM ' + quoted + ' LIMIT 1').fetchone():
                raise MergeError('Unsupported populated staging table: ' + name)


def _paths(staging, database):
    staging, database = Path(staging), Path(database)
    # Check the supplied components before resolving: resolution would hide
    # both leaf aliases and symlinked directories from the safety check.
    for label, path in (('staging', staging), ('target', database)):
        absolute = path.absolute()
        if any(component.is_symlink() for component in (absolute, *absolute.parents)):
            raise MergeError('Refusing a symlinked ' + label + ' library path')
    if not staging.is_file() or not database.is_file():
        raise MergeError('Staging and target libraries must already exist as regular files')
    if os.path.samefile(staging, database):
        raise MergeError('Staging and target must be different files, including links')
    return staging.resolve(), database.resolve()


def _limits(source, dataset, max_growth_mb, reserve_mb):
    if source not in SOURCES or not isinstance(dataset, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,60}', dataset):
        raise MergeError('Unsupported source dataset')
    if (type(max_growth_mb) not in (int, float) or not math.isfinite(max_growth_mb)
            or max_growth_mb <= 0):
        raise MergeError('Maximum growth must be a positive finite MiB value')
    if (type(reserve_mb) not in (int, float) or not math.isfinite(reserve_mb)
            or reserve_mb < MIN_RESERVE_BYTES / MIB):
        raise MergeError('Disk reserve must be at least 512 MiB')
    return int(max_growth_mb * MIB), int(reserve_mb * MIB)


def _reader(path, runtime):
    conn = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=min(30, runtime.check()))
    try:
        runtime.configure(conn)
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        return conn
    except BaseException as error:
        conn.set_progress_handler(None, 0)
        conn.close()
        if isinstance(error, sqlite3.Error):
            if runtime.failure is not None:
                raise runtime.failure from error
            runtime.check()
        raise


def _metadata(value, limit):
    if not isinstance(value, (str, bytes)):
        raise MergeError('Invalid public source metadata storage')
    # Validate using the shared decoder/size/JSON rules, but insert the original
    # value unchanged, including compressed bytes and source precision strings.
    encode_metadata(decode_metadata(value), limit)


def _stamp(value):
    if not isinstance(value, str) or len(value) > 80:
        raise MergeError('Invalid public source timestamp')
    _timestamp(value)


def _validate_series(row, source, dataset):
    d = dict(zip(SERIES_COLUMNS, row))
    if d['source'] != source or d['dataset'] != dataset:
        raise MergeError('Series belongs to another source dataset')
    for name in FIELDS[:14]:
        value = d[name]
        if not isinstance(value, str) or (not value and name != 'country_code') or len(value) > 16000:
            raise MergeError('Invalid public series field: ' + name)
    if d['entity_type'] not in ('country', 'company') or d['id'] != series_id(
            source, d['entity_id'], d['indicator_id'], d['unit']):
        raise MergeError('Invalid public series identity')
    _url(d['source_url'])
    _metadata(d['metadata'], 64000)
    _stamp(d['checked_at'])
    search = ' '.join(d[name] for name in
                      ('entity_name', 'entity_id', 'country_code', 'indicator_name', 'indicator_id', 'unit'))
    if d['search_text'] != search:
        raise MergeError('Invalid public series search text')
    if type(d['observation_count']) is not int or d['observation_count'] <= 0:
        raise MergeError('Invalid public series observation count')
    return d


def _validate_point(row, identity, *, revision=False):
    if row[0] != identity:
        raise MergeError('Observation belongs to another series')
    period, value = row[1:3]
    if (not isinstance(period, str) or not 1 <= len(period) <= 80 or not period.isprintable()
            or type(value) not in (int, float) or not math.isfinite(value)):
        raise MergeError('Invalid public observation')
    _metadata(row[3], 16000)
    if not isinstance(row[4], str) or len(row[4]) > 16000:
        raise MergeError('Invalid public observation evidence URL')
    _url(row[4])
    _stamp(row[5])
    if revision:
        _stamp(row[6])
        if _timestamp(row[6]) < _timestamp(row[5]):
            raise MergeError('Observation revision predates its evidence')


def _has_runs(conn):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='faostat_import_runs'").fetchone() is not None


def _validate_run(row, dataset):
    if row[0] != dataset:
        raise MergeError('Import evidence belongs to another dataset')
    _stamp(row[1])
    if row[2] is not None:
        if not isinstance(row[2], str):
            raise MergeError('Invalid source release date')
        date.fromisoformat(row[2])
    if (any(type(value) is not int for value in row[3:5])
            or not 1900 <= row[3] <= row[4] <= 3000):
        raise MergeError('Invalid import evidence year range')
    if (not isinstance(row[5], str) or not row[5] or len(row[5]) > 512
            or '/' in row[5] or '\\' in row[5] or not row[5].isprintable()):
        raise MergeError('Import evidence must contain only an archive basename')
    if (any(type(value) is not int or value <= 0 for value in row[6:9]) or row[8] > row[7]):
        raise MergeError('Invalid import evidence row counts')
    if not isinstance(row[9], str) or len(row[9]) > 16000:
        raise MergeError('Invalid import evidence skipped counts')
    skipped = json.loads(row[9])
    if (not isinstance(skipped, dict) or not set(skipped) <= {'aggregate', 'missing', 'year', 'forecast'}
            or any(type(value) is not int or value < 0 for value in skipped.values())
            or sum(skipped.values()) + row[8] != row[7]):
        raise MergeError('Import evidence skipped counts do not match rows read')


def _source_plan(staging, target, source, dataset, runtime):
    _check_schema(staging, target=False, runtime=runtime)
    _check_schema(target, target=True, runtime=runtime)
    if target.execute('PRAGMA journal_mode').fetchone()[0].lower() != 'delete':
        raise MergeError('Target must already use DELETE journaling; WAL checkpointing is a separate operation')
    if target.execute('SELECT 1 FROM datasets WHERE source=? AND dataset=?', (source, dataset)).fetchone():
        raise MergeError('Dataset already exists in target')
    if target.execute('SELECT 1 FROM series WHERE source=? AND dataset=? LIMIT 1', (source, dataset)).fetchone():
        raise MergeError('Dataset series already exist in target')
    if source == 'faostat' and _has_runs(target) and target.execute(
            'SELECT 1 FROM faostat_import_runs WHERE dataset=? LIMIT 1', (dataset,)).fetchone():
        raise MergeError('Dataset import evidence already exists in target')
    row = staging.execute('SELECT ' + ','.join(DATASET_COLUMNS) +
                          ' FROM datasets WHERE source=? AND dataset=?', (source, dataset)).fetchone()
    if row is None:
        raise MergeError('Requested dataset is absent from staging')
    _stamp(row[2])
    if any(type(count) is not int or count <= 0 for count in row[3:]):
        raise MergeError('Invalid staged dataset counts')
    counts = staging.execute('''SELECT COUNT(*),COUNT(DISTINCT entity_id),COUNT(DISTINCT indicator_id)
        FROM series WHERE source=? AND dataset=?''', (source, dataset)).fetchone()
    observation_count = staging.execute('''SELECT COUNT(*) FROM observations o JOIN series s ON s.id=o.series_id
        WHERE s.source=? AND s.dataset=?''', (source, dataset)).fetchone()[0]
    if (*counts, observation_count) != row[3:]:
        raise MergeError('Staged dataset counts do not match actual rows')
    for table in ('observations', 'observation_revisions'):
        if staging.execute('SELECT 1 FROM ' + table +
                           ' o WHERE NOT EXISTS(SELECT 1 FROM series s WHERE s.id=o.series_id) LIMIT 1').fetchone():
            raise MergeError('Staging contains orphaned ' + table)
    revision_count = staging.execute('''SELECT COUNT(*) FROM observation_revisions o JOIN series s ON s.id=o.series_id
        WHERE s.source=? AND s.dataset=?''', (source, dataset)).fetchone()[0]
    run_count = staging.execute('SELECT COUNT(*) FROM faostat_import_runs WHERE dataset=?',
                                (dataset,)).fetchone()[0] if source == 'faostat' and _has_runs(staging) else 0
    # Identity checks are streamed; retaining millions of IDs is unnecessary.
    for identity, in staging.execute('SELECT id FROM series WHERE source=? AND dataset=? ORDER BY id', (source, dataset)):
        runtime.check()
        if target.execute('SELECT 1 FROM series WHERE id=?', (identity,)).fetchone():
            raise MergeError('Staged series identity already exists in target: ' + identity)
        for table in ('observations', 'observation_revisions'):
            if target.execute('SELECT 1 FROM ' + table + ' WHERE series_id=? LIMIT 1', (identity,)).fetchone():
                raise MergeError('Staged series identity conflicts with existing target ' + table)
    runtime.check()
    return row, dict(source=source, dataset=dataset, checked_at=row[2],
                     series_count=row[3], entity_count=row[4], indicator_count=row[5],
                     observation_count=row[6], revision_count=revision_count, import_run_count=run_count)


def _allocated(path):
    try:
        return path.stat().st_blocks * 512
    except FileNotFoundError:
        return 0


class _DiskGuard:
    def __init__(self, path, max_growth_bytes, reserve_bytes):
        self.path, self.max_growth_bytes, self.reserve_bytes = path, max_growth_bytes, reserve_bytes
        self.paths = [path] + [Path(str(path) + suffix) for suffix in ('-journal', '-wal', '-shm')]
        self.baseline = sum(_allocated(item) for item in self.paths)
        self.base_pages = self.page_size = None
        self.failure = None
        self.peak_allocated_growth_bytes = 0
        self.peak_required_growth_bytes = 0
        self.check()

    def check(self, conn=None):
        growth = max(0, sum(_allocated(item) for item in self.paths) - self.baseline)
        self.peak_allocated_growth_bytes = max(self.peak_allocated_growth_bytes, growth)
        pending_append = 0
        if conn is not None:
            pages = conn.execute('PRAGMA page_count').fetchone()[0]
            # Dirty appended pages may still live in SQLite's bounded cache.
            # Reserve their full uncompressed allocation before COMMIT flushes
            # them, while the rollback journal still occupies physical space.
            pending_append = max(0, pages * self.page_size - self.path.stat().st_size)
            if max(0, pages - self.base_pages) * self.page_size > self.max_growth_bytes:
                raise MergeError('Merge exceeds maximum logical database growth')
        required_growth = growth + pending_append
        self.peak_required_growth_bytes = max(self.peak_required_growth_bytes, required_growth)
        if required_growth > self.max_growth_bytes:
            raise MergeError('Merge exceeds maximum allocated database/journal growth')
        if shutil.disk_usage(self.path.parent).free < self.reserve_bytes + CHECK_HEADROOM_BYTES + pending_append:
            raise MergeError('Insufficient disk space; preserving at least 512 MiB free plus check headroom')

    def configure(self, conn, runtime):
        # Called only after BEGIN IMMEDIATE owns the writer lock. A writer that
        # finished while we waited must not distort this transaction's baseline.
        self.baseline = sum(_allocated(item) for item in self.paths)
        self.peak_allocated_growth_bytes = self.peak_required_growth_bytes = 0
        self.base_pages = conn.execute('PRAGMA page_count').fetchone()[0]
        self.page_size = conn.execute('PRAGMA page_size').fetchone()[0]
        free_growth = max(0, shutil.disk_usage(self.path.parent).free - self.reserve_bytes - CHECK_HEADROOM_BYTES)
        pages = self.base_pages + min(self.max_growth_bytes, free_growth) // self.page_size
        conn.execute('PRAGMA max_page_count=' + str(pages))

        def progress():
            try:
                # SQLite calls cannot be made recursively from its callback.
                runtime.check()
                self.check()
                return 0
            except MergeError as error:
                self.failure = error
                return 1

        conn.set_progress_handler(progress, 10000)

    def report(self, conn):
        return dict(allocated_growth_bytes=max(0, _allocated(self.path) - self.baseline),
                    peak_allocated_growth_bytes=self.peak_allocated_growth_bytes,
                    peak_required_growth_bytes=self.peak_required_growth_bytes,
                    logical_growth_bytes=max(0, conn.execute('PRAGMA page_count').fetchone()[0] - self.base_pages) * self.page_size,
                    max_growth_bytes=self.max_growth_bytes, reserve_bytes=self.reserve_bytes,
                    free_bytes=shutil.disk_usage(self.path.parent).free)


def plan_merge(staging, database, source, dataset, *, max_growth_mb=256, reserve_mb=512, max_seconds=900):
    """Read-only validation/counts; exact allocation is measured during merging."""
    max_growth, reserve = _limits(source, dataset, max_growth_mb, reserve_mb)
    runtime = _RuntimeGuard(max_seconds)
    staging, database = _paths(staging, database)
    _DiskGuard(database, max_growth, reserve)
    try:
        with closing(_reader(staging, runtime)) as src, closing(_reader(database, runtime)) as target:
            try:
                _, report = _source_plan(src, target, source, dataset, runtime)
            finally:
                src.set_progress_handler(None, 0)
                target.set_progress_handler(None, 0)
    except sqlite3.Error as error:
        if runtime.failure is not None:
            raise runtime.failure from error
        runtime.check()
        raise
    return dict(report, status='planned', max_growth_bytes=max_growth, reserve_bytes=reserve,
                free_bytes=shutil.disk_usage(database.parent).free)


def merge_dataset(staging, database, source, dataset, *, max_growth_mb=256, reserve_mb=512, max_seconds=900):
    """Commit one new dataset, preserving staged values/metadata/evidence exactly."""
    max_growth, reserve = _limits(source, dataset, max_growth_mb, reserve_mb)
    runtime = _RuntimeGuard(max_seconds)
    staging, database = _paths(staging, database)
    guard = _DiskGuard(database, max_growth, reserve)
    with closing(_reader(staging, runtime)) as src, closing(sqlite3.connect(database, timeout=min(30, runtime.check()))) as target:
        try:
            runtime.configure(target)
            target.execute('PRAGMA foreign_keys=ON')
            target.execute('PRAGMA synchronous=FULL')
            target.execute('PRAGMA cache_size=-8192')
            target.execute('PRAGMA temp_store=MEMORY')
            # A large WAL checkpoint has its own space requirements and is outside
            # this append-only transaction. It must be handled separately.
            if target.execute('PRAGMA journal_mode').fetchone()[0].lower() != 'delete':
                raise MergeError('Target must already use DELETE journaling; WAL checkpointing is a separate operation')
            # Waiting for a writer lock also consumes this operation's budget.
            runtime.busy_timeout(target)
            target.execute('BEGIN IMMEDIATE')
            runtime.check()
            guard.configure(target, runtime)
            dataset_row, report = _source_plan(src, target, source, dataset, runtime)
            for statement in _schema_statements():
                runtime.check()
                target.execute(statement)
            processed_series = processed_points = processed_revisions = 0
            insert_series = 'INSERT INTO series (' + ','.join(SERIES_COLUMNS) + ') VALUES (' + ','.join('?' for _ in SERIES_COLUMNS) + ')'
            insert_point = 'INSERT INTO observations (' + ','.join(OBSERVATION_COLUMNS) + ') VALUES (?,?,?,?,?,?)'
            insert_revision = 'INSERT INTO observation_revisions (' + ','.join(REVISION_COLUMNS) + ') VALUES (?,?,?,?,?,?,?)'
            for row in src.execute('SELECT ' + ','.join(SERIES_COLUMNS) +
                                   ' FROM series WHERE source=? AND dataset=? ORDER BY id', (source, dataset)):
                runtime.check()
                guard.check(target)
                definition = _validate_series(row, source, dataset)
                runtime.check()
                target.execute(insert_series, row)
                count, first, last, last_value = 0, None, None, None
                for point in src.execute('SELECT ' + ','.join(OBSERVATION_COLUMNS) +
                                         ' FROM observations WHERE series_id=? ORDER BY period', (definition['id'],)):
                    runtime.check()
                    _validate_point(point, definition['id'])
                    runtime.check()
                    target.execute(insert_point, point)
                    count += 1
                    processed_points += 1
                    first = point[1] if first is None else first
                    last, last_value = point[1], point[2]
                    if processed_points % CHECK_INTERVAL == 0:
                        guard.check(target)
                if (count, first, last, last_value) != tuple(definition[name] for name in
                        ('observation_count', 'first_period', 'last_period', 'last_value')):
                    raise MergeError('Staged series summary does not match actual observations')
                for revision in src.execute('SELECT ' + ','.join(REVISION_COLUMNS) +
                                            ' FROM observation_revisions WHERE series_id=? ORDER BY rowid', (definition['id'],)):
                    runtime.check()
                    _validate_point(revision, definition['id'], revision=True)
                    runtime.check()
                    target.execute(insert_revision, revision)
                    processed_revisions += 1
                    if processed_revisions % CHECK_INTERVAL == 0:
                        guard.check(target)
                processed_series += 1
            if (processed_series, processed_points, processed_revisions) != (
                    report['series_count'], report['observation_count'], report['revision_count']):
                raise MergeError('Merged row counts do not match the staged dataset')
            processed_runs = 0
            if report['import_run_count']:
                target.execute(FAOSTAT_RUN_SCHEMA)
                for run in src.execute('SELECT ' + ','.join(FAOSTAT_RUN_COLUMNS) +
                                       ' FROM faostat_import_runs WHERE dataset=? ORDER BY checked_at', (dataset,)):
                    runtime.check()
                    _validate_run(run, dataset)
                    runtime.check()
                    target.execute('INSERT INTO faostat_import_runs VALUES (?,?,?,?,?,?,?,?,?,?)', run)
                    processed_runs += 1
                    guard.check(target)
            if processed_runs != report['import_run_count']:
                raise MergeError('Merged import evidence count does not match staging')
            runtime.check()
            target.execute('INSERT INTO datasets VALUES (?,?,?,?,?,?,?)', dataset_row)
            actual = target.execute('''SELECT COUNT(*),COUNT(DISTINCT entity_id),COUNT(DISTINCT indicator_id),
                (SELECT COUNT(*) FROM observations o JOIN series x ON x.id=o.series_id WHERE x.source=? AND x.dataset=?)
                FROM series WHERE source=? AND dataset=?''', (source, dataset, source, dataset)).fetchone()
            if actual != dataset_row[3:]:
                raise MergeError('Target dataset counts do not match actual inserted rows')
            guard.check(target)
            runtime.busy_timeout(target)
            runtime.check()
            target.commit()
        except BaseException as error:
            src.set_progress_handler(None, 0)
            target.set_progress_handler(None, 0)
            target.rollback()
            if runtime.failure is not None:
                raise runtime.failure from error
            if guard.failure is not None:
                raise guard.failure from error
            if isinstance(error, sqlite3.Error):
                runtime.check()
                raise MergeError('SQLite merge failed; transaction rolled back: ' + str(error)) from error
            raise
        src.set_progress_handler(None, 0)
        target.set_progress_handler(None, 0)
        report['status'] = 'merged'
        try:
            report.update(guard.report(target))
        except (OSError, sqlite3.Error) as error:
            # A post-commit measurement problem cannot undo durable data and
            # must never be reported as a failed/rolled-back merge.
            report['post_commit_measurement_error'] = str(error)
        return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staging', required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--source', required=True, choices=tuple(SOURCES))
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--max-growth-mb', type=float, default=256)
    parser.add_argument('--reserve-mb', type=float, default=512)
    parser.add_argument('--max-seconds', type=float, default=900, help='Maximum elapsed validation/merge runtime (default: 900 seconds)')
    parser.add_argument('--plan', action='store_true', help='Read-only counts and compatibility checks')
    args = parser.parse_args(argv)
    try:
        operation = plan_merge if args.plan else merge_dataset
        report = operation(args.staging, args.database, args.source, args.dataset,
                           max_growth_mb=args.max_growth_mb, reserve_mb=args.reserve_mb, max_seconds=args.max_seconds)
    except (ValueError, sqlite3.Error, OSError) as error:
        print(json.dumps(dict(status='failed', source=args.source, dataset=args.dataset, error=str(error))))
        return 1
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
