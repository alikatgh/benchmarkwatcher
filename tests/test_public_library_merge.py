"""A failed bounded append must preserve every existing public observation."""
import json
import os
import sqlite3
from types import SimpleNamespace

import pytest

from scripts import merge_public_library as merger
from scripts.public_data_store import LibraryWriter, series_id


def definition(source='faostat', dataset='RP', indicator='prices', entity='MNG'):
    return dict(id=series_id(source, entity, indicator, 'USD/t'), source=source, dataset=dataset,
                entity_id=entity, entity_name='Mongolia', entity_type='country', country_code='MN',
                indicator_id=indicator, indicator_name='Producer prices', unit='USD/t', frequency='annual',
                source_url='https://example.org/official-prices', attribution='Original public publisher',
                license='CC-BY-4.0', metadata={'source_updated_at': '2026-08-01', 'detail': 'evidence ' * 400})


def write(path, *, source='faostat', dataset='RP', indicator='prices', points=None,
          stamp='2026-10-07T00:00:00+00:00', entity='MNG'):
    if points is None:
        points = [{'period': '2024', 'value': 1.23456789012345,
                   'metadata': {'flag': 'E', 'original_value': '1.234567890123450000', 'note': 'detail ' * 300}}]
    with LibraryWriter(path, source, dataset, stamp, journal_mode='DELETE') as writer:
        writer.add_series(definition(source, dataset, indicator, entity), points)


def rows(path):
    with sqlite3.connect(path) as conn:
        return {table: conn.execute('SELECT * FROM ' + table + ' ORDER BY 1,2').fetchall()
                for table in ('series', 'observations', 'observation_revisions', 'datasets')}


@pytest.fixture
def databases(tmp_path):
    staging, target = tmp_path / 'staging.sqlite3', tmp_path / 'target.sqlite3'
    write(staging)
    write(target, source='worldbank', dataset='WDI', indicator='population')
    return staging, target


def test_exact_rows_precision_compressed_metadata_revisions_and_fts(databases):
    staging, target = databases
    write(staging, points=[{'period': '2024', 'value': 1.23456789012346,
                           'metadata': {'flag': 'A', 'original_value': '1.23456789012346000',
                                        'note': 'revised detail ' * 250}},
                          {'period': '2025', 'value': 0, 'metadata': {'flag': 'E'}}],
          stamp='2026-10-08T00:00:00+00:00')
    before, expected = rows(target), rows(staging)
    plan = merger.plan_merge(staging, target, 'faostat', 'RP')
    assert plan['status'] == 'planned'
    assert plan['series_count'] == 1 and plan['observation_count'] == 2 and plan['revision_count'] == 1
    assert rows(target) == before
    report = merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert report['status'] == 'merged'
    assert report['series_count'] == 1 and report['observation_count'] == 2 and report['revision_count'] == 1
    assert 0 <= report['allocated_growth_bytes'] <= report['max_growth_bytes']
    assert report['free_bytes'] >= report['reserve_bytes']
    after = rows(target)
    for table in before:
        assert set(after[table]) == set(before[table] + expected[table])
    assert rows(staging) == expected
    with sqlite3.connect(target) as conn:
        assert conn.execute('PRAGMA journal_mode').fetchone()[0] == 'delete'
        assert conn.execute("SELECT COUNT(*) FROM series_search WHERE series_search MATCH 'Mongolia'").fetchone()[0] == 2
        assert conn.execute('PRAGMA foreign_key_check').fetchall() == []
        assert isinstance(conn.execute("SELECT metadata FROM series WHERE source='faostat'").fetchone()[0], bytes)
        assert isinstance(conn.execute("SELECT metadata FROM observations WHERE period='2024' AND series_id LIKE 'faostat_%'").fetchone()[0], bytes)
    assert not target.with_name(target.name + '-journal').exists()


def test_selects_one_dataset_and_preserves_other_staged_dataset(databases):
    staging, target = databases
    write(staging, dataset='QCL', indicator='production')
    before = rows(staging)
    merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(staging) == before
    with sqlite3.connect(target) as conn:
        assert conn.execute("SELECT dataset FROM datasets WHERE source='faostat'").fetchall() == [('RP',)]


def test_duplicate_dataset_rejected_without_changes(databases):
    staging, target = databases
    merger.merge_dataset(staging, target, 'faostat', 'RP')
    before = rows(target)
    with pytest.raises(merger.MergeError, match='already exists'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(target) == before


def test_conflicting_series_id_in_another_dataset_rejected(databases):
    staging, target = databases
    write(target, dataset='OLD')
    before = rows(target)
    with pytest.raises(merger.MergeError, match='identity already exists'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(target) == before


def test_conflicting_orphan_revision_identity_rejected(databases):
    staging, target = databases
    with sqlite3.connect(staging) as conn:
        point = conn.execute('SELECT * FROM observations').fetchone()
    with sqlite3.connect(target) as conn:
        conn.execute('INSERT INTO observation_revisions VALUES (?,?,?,?,?,?,?)',
                     (*point, '2026-10-08T00:00:00+00:00'))
    before = rows(target)
    with pytest.raises(merger.MergeError, match='conflicts with existing target observation_revisions'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(target) == before


def test_invalid_later_observation_rolls_back_every_insert(databases):
    staging, target = databases
    write(staging, points=[{'period': '2024', 'value': 1}, {'period': '2025', 'value': 2}])
    with sqlite3.connect(staging) as conn:
        conn.execute("UPDATE observations SET source_url='http://insecure.example.org' WHERE period='2025'")
    before = rows(target)
    with pytest.raises(ValueError, match='HTTPS'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(target) == before
    with sqlite3.connect(target) as conn:
        assert conn.execute("SELECT COUNT(*) FROM series_search WHERE series_search MATCH 'prices'").fetchone()[0] == 1


@pytest.mark.parametrize('table,statement', [
    ('datasets', 'UPDATE datasets SET observation_count=observation_count+1'),
    ('series', 'UPDATE series SET observation_count=observation_count+1'),
    ('series', "UPDATE series SET last_period='2099'"),
    ('series', 'UPDATE series SET last_value=99')])
def test_staged_count_and_summary_mismatches_are_rejected(databases, table, statement):
    staging, target = databases
    with sqlite3.connect(staging) as conn:
        conn.execute(statement)
    before = rows(target)
    with pytest.raises(merger.MergeError, match='(counts|summary)'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(target) == before


@pytest.mark.parametrize('kind', ['same', 'hardlink', 'symlink'])
def test_same_file_aliases_rejected(tmp_path, kind):
    staging = tmp_path / 'library.sqlite3'
    write(staging)
    alias = tmp_path / 'alias.sqlite3'
    if kind == 'same':
        alias = staging
    elif kind == 'hardlink':
        os.link(staging, alias)
    else:
        alias.symlink_to(staging)
    before = staging.read_bytes()
    with pytest.raises(merger.MergeError, match='different files|symlinked'):
        merger.merge_dataset(staging, alias, 'faostat', 'RP')
    assert staging.read_bytes() == before


@pytest.mark.parametrize('role', ['staging', 'target'])
@pytest.mark.parametrize('kind', ['leaf', 'parent'])
def test_distinct_database_symlink_paths_are_rejected_without_mutation(databases, tmp_path, role, kind):
    staging, target = databases
    before = staging.read_bytes(), target.read_bytes()
    original = staging if role == 'staging' else target
    if kind == 'leaf':
        alias = tmp_path / 'alias.sqlite3'
        alias.symlink_to(original)
    else:
        parent = tmp_path / 'alias-directory'
        parent.symlink_to(original.parent, target_is_directory=True)
        alias = parent / original.name
    supplied_staging = alias if role == 'staging' else staging
    supplied_target = alias if role == 'target' else target
    for operation in (merger.plan_merge, merger.merge_dataset):
        with pytest.raises(merger.MergeError, match='symlinked ' + role):
            operation(supplied_staging, supplied_target, 'faostat', 'RP')
    assert (staging.read_bytes(), target.read_bytes()) == before
    assert alias.exists()


def test_missing_or_malformed_schema_fails_without_creating_target(databases, tmp_path):
    staging, target = databases
    missing = tmp_path / 'absent.sqlite3'
    with pytest.raises(merger.MergeError, match='already exist'):
        merger.merge_dataset(staging, missing, 'faostat', 'RP')
    assert not missing.exists()
    with sqlite3.connect(staging) as conn:
        conn.execute('ALTER TABLE observations ADD COLUMN unexpected TEXT')
    before = rows(target)
    with pytest.raises(merger.MergeError, match='schema'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(target) == before


def test_unknown_source_evidence_table_is_not_silently_discarded(databases):
    staging, target = databases
    with sqlite3.connect(staging) as conn:
        conn.execute('CREATE TABLE sec_facts (evidence TEXT NOT NULL)')
        conn.execute("INSERT INTO sec_facts VALUES ('original filing')")
    before = rows(target)
    with pytest.raises(merger.MergeError, match='Unsupported populated staging table: sec_facts'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(target) == before


def test_faostat_coverage_evidence_is_preserved_exactly(databases):
    from scripts.import_faostat_library import FAOSTAT_IMPORT_RUN_SCHEMA

    assert merger._normalized_sql(merger.FAOSTAT_RUN_SCHEMA) == merger._normalized_sql(FAOSTAT_IMPORT_RUN_SCHEMA)
    staging, target = databases
    evidence = ('RP', '2026-10-07T00:00:00+00:00', '2026-08-01', 1900, 2025,
                'Prices_E_All_Data_(Normalized).zip', 1234, 4, 1, '{"aggregate":1,"missing":2}')
    other = ('QCL', *evidence[1:])
    with sqlite3.connect(staging) as conn:
        conn.execute(merger.FAOSTAT_RUN_SCHEMA)
        conn.executemany('INSERT INTO faostat_import_runs VALUES (?,?,?,?,?,?,?,?,?,?)', [evidence, other])
    report = merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert report['import_run_count'] == 1
    with sqlite3.connect(target) as conn:
        assert conn.execute('SELECT * FROM faostat_import_runs').fetchall() == [evidence]
    with sqlite3.connect(staging) as conn:
        assert conn.execute('SELECT COUNT(*) FROM faostat_import_runs').fetchone()[0] == 2


def test_invalid_evidence_after_point_inserts_rolls_back(databases):
    staging, target = databases
    with sqlite3.connect(staging) as conn:
        conn.execute(merger.FAOSTAT_RUN_SCHEMA)
        conn.execute('INSERT INTO faostat_import_runs VALUES (?,?,?,?,?,?,?,?,?,?)',
                     ('RP', '2026-10-07T00:00:00+00:00', None, 1900, 2025,
                      '/private/secret/archive.zip', 100, 1, 1, '{}'))
    before = rows(target)
    with pytest.raises(merger.MergeError, match='basename'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(target) == before
    with sqlite3.connect(target) as conn:
        assert conn.execute("SELECT name FROM sqlite_master WHERE name='faostat_import_runs'").fetchall() == []


def test_low_disk_before_transaction_preserves_target_bytes(databases, monkeypatch):
    staging, target = databases
    before = target.read_bytes()
    monkeypatch.setattr(merger.shutil, 'disk_usage', lambda path: SimpleNamespace(free=merger.MIN_RESERVE_BYTES - 1))
    with pytest.raises(merger.MergeError, match='512 MiB'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert target.read_bytes() == before


def test_disk_reserve_rechecked_before_commit_and_rolls_back(databases, monkeypatch):
    staging, target = databases
    before = rows(target)
    original = merger._validate_point
    inserted = False

    def validate(*args, **kwargs):
        nonlocal inserted
        original(*args, **kwargs)
        inserted = True

    monkeypatch.setattr(merger, '_validate_point', validate)
    monkeypatch.setattr(merger.shutil, 'disk_usage', lambda path: SimpleNamespace(
        free=merger.MIN_RESERVE_BYTES if inserted else 2 * 1024 * merger.MIB))
    with pytest.raises(merger.MergeError, match='512 MiB'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    assert rows(target) == before


def test_tiny_page_growth_ceiling_rolls_back_sqlite_full(databases):
    staging, target = databases
    write(staging, points=[{'period': str(year), 'value': year,
                           'metadata': {'unique': '-'.join(str(year * number) for number in range(100))}}
                          for year in range(2000, 2010)])
    before = rows(target)
    with pytest.raises(merger.MergeError, match='SQLite merge failed; transaction rolled back: database or disk is full'):
        merger.merge_dataset(staging, target, 'faostat', 'RP', max_growth_mb=0.0001)
    assert rows(target) == before


def test_allocated_journal_growth_bound_rolls_back(databases, monkeypatch):
    staging, target = databases
    before = rows(target)
    allocated = merger._allocated
    validate = merger._validate_point
    inserted = False

    def point(*args, **kwargs):
        nonlocal inserted
        validate(*args, **kwargs)
        inserted = True

    monkeypatch.setattr(merger, '_validate_point', point)
    monkeypatch.setattr(merger, '_allocated', lambda path:
                        allocated(path) + (2 * merger.MIB if inserted and str(path).endswith('-journal') else 0))
    with pytest.raises(merger.MergeError, match='allocated'):
        merger.merge_dataset(staging, target, 'faostat', 'RP', max_growth_mb=1)
    assert rows(target) == before


def test_wal_target_explicitly_blocked(databases):
    staging, target = databases
    with sqlite3.connect(target) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
    before = rows(target)
    with pytest.raises(merger.MergeError, match='DELETE journaling'):
        merger.merge_dataset(staging, target, 'faostat', 'RP')
    with pytest.raises(merger.MergeError, match='DELETE journaling'):
        merger.plan_merge(staging, target, 'faostat', 'RP')
    assert rows(target) == before


@pytest.mark.parametrize('operation', [merger.plan_merge, merger.merge_dataset])
@pytest.mark.parametrize('max_seconds', [0, -1, float('nan'), float('inf'), float('-inf'), True, '900', None])
def test_invalid_runtime_budget_is_rejected_before_changes(databases, operation, max_seconds):
    staging, target = databases
    before = staging.read_bytes(), target.read_bytes()
    with pytest.raises(merger.MergeError, match='positive finite seconds'):
        operation(staging, target, 'faostat', 'RP', max_seconds=max_seconds)
    assert (staging.read_bytes(), target.read_bytes()) == before


LONG_QUERY = '''WITH RECURSIVE counter(n) AS (
    VALUES(0) UNION ALL SELECT n+1 FROM counter WHERE n<100000
) SELECT SUM(n) FROM counter'''


@pytest.mark.parametrize('operation', [merger.plan_merge, merger.merge_dataset])
@pytest.mark.parametrize('connection', ['staging', 'target'])
def test_sql_validation_is_interrupted_when_runtime_expires(databases, monkeypatch, operation, connection):
    staging, target = databases
    before = rows(target)
    clock = [0.0]
    monkeypatch.setattr(merger.time, 'monotonic', lambda: clock[0])

    def source_plan(src, dst, *args):
        clock[0] = 11.0
        (src if connection == 'staging' else dst).execute(LONG_QUERY).fetchone()
        pytest.fail('The expired SQLite query was not interrupted')

    monkeypatch.setattr(merger, '_source_plan', source_plan)
    with pytest.raises(merger.MergeError, match='maximum elapsed runtime of 10 seconds'):
        operation(staging, target, 'faostat', 'RP', max_seconds=10)
    assert rows(target) == before
    assert not target.with_name(target.name + '-journal').exists()


@pytest.mark.parametrize('timeout_kind', ['python_validation', 'sqlite_insertion'])
def test_runtime_expiry_after_insertion_clears_progress_and_rolls_back(databases, monkeypatch, timeout_kind):
    staging, target = databases
    write(staging, points=[{'period': '2024', 'value': 1}, {'period': '2025', 'value': 2}])
    before = rows(target)
    clock, configured, rollback_callbacks = [0.0], [], []
    original_connect = sqlite3.connect

    class TrackingConnection(sqlite3.Connection):
        progress_callback = None

        def set_progress_handler(self, callback, steps):
            self.progress_callback = callback
            return super().set_progress_handler(callback, steps)

        def rollback(self):
            rollback_callbacks.append(self.progress_callback)
            return super().rollback()

    monkeypatch.setattr(merger.time, 'monotonic', lambda: clock[0])
    monkeypatch.setattr(merger.sqlite3, 'connect', lambda *args, **kwargs:
                        original_connect(*args, factory=TrackingConnection, **kwargs))
    original_configure, original_validate = merger._DiskGuard.configure, merger._validate_point

    def configure(guard, conn, runtime):
        original_configure(guard, conn, runtime)
        configured.append(conn)

    def validate(point, *args, **kwargs):
        original_validate(point, *args, **kwargs)
        if point[1] == '2025':
            # One earlier point and its search-index entry are already written.
            assert configured[0].execute("SELECT COUNT(*) FROM observations WHERE series_id LIKE 'faostat_%'").fetchone()[0] == 1
            clock[0] = 11.0
            if timeout_kind == 'sqlite_insertion':
                configured[0].execute(LONG_QUERY).fetchone()
                pytest.fail('The expired SQLite query was not interrupted')

    monkeypatch.setattr(merger._DiskGuard, 'configure', configure)
    monkeypatch.setattr(merger, '_validate_point', validate)
    with pytest.raises(merger.MergeError, match='maximum elapsed runtime of 10 seconds'):
        merger.merge_dataset(staging, target, 'faostat', 'RP', max_seconds=10)
    assert rollback_callbacks == [None]
    assert rows(target) == before
    assert not target.with_name(target.name + '-journal').exists()
    with sqlite3.connect(target) as conn:
        assert conn.execute("SELECT COUNT(*) FROM series_search WHERE series_search MATCH 'prices'").fetchone()[0] == 1


def test_cli_failure_status_is_nonzero_and_plan_is_read_only(databases, capsys):
    staging, target = databases
    arguments = ['--staging', str(staging), '--database', str(target), '--source', 'faostat', '--dataset', 'RP']
    before = rows(target)
    assert merger.main(arguments + ['--plan']) == 0
    assert json.loads(capsys.readouterr().out)['status'] == 'planned'
    assert rows(target) == before
    assert merger.main(arguments) == 0
    assert json.loads(capsys.readouterr().out)['status'] == 'merged'
    assert merger.main(arguments) == 1
    assert json.loads(capsys.readouterr().out)['status'] == 'failed'


def test_cli_invalid_runtime_budget_returns_failure_without_changes(databases, capsys):
    staging, target = databases
    before = target.read_bytes()
    arguments = ['--staging', str(staging), '--database', str(target), '--source', 'faostat', '--dataset', 'RP',
                 '--max-seconds', '0']
    assert merger.main(arguments) == 1
    report = json.loads(capsys.readouterr().out)
    assert report['status'] == 'failed'
    assert 'positive finite seconds' in report['error']
    assert target.read_bytes() == before
