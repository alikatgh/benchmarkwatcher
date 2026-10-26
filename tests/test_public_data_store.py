"""Source refreshes must not corrupt or silently erase public history."""
import sqlite3
from types import SimpleNamespace

import pytest

from scripts.public_data_store import LibraryWriter, read_connection, series_id
from scripts import public_data_store


def definition(unit='people'):
    return dict(id=series_id('worldbank', 'MNG', 'population', unit), source='worldbank',
                dataset='WDI', entity_id='MNG', entity_name='Mongolia', entity_type='country',
                country_code='MN', indicator_id='population', indicator_name='Population',
                unit=unit, frequency='annual', source_url='https://data.worldbank.org/indicator/SP.POP.TOTL',
                attribution='World Bank; original publisher', license='CC BY-4.0')


def write(path, points, stamp='2026-10-07T00:00:00+00:00', journal_mode=None):
    with LibraryWriter(path, 'worldbank', 'WDI', stamp, journal_mode=journal_mode) as writer:
        writer.add_series(definition(), points)
    return writer.summary()


def test_refresh_preserves_history_and_records_revisions(tmp_path):
    path = tmp_path / 'library.sqlite3'
    write(path, [{'period': '2000', 'value': 0}, {'period': '2024', 'value': 10, 'metadata': {'flag': 'E'}}])
    with LibraryWriter(path, 'worldbank', 'WDI', '2026-10-08T00:00:00+00:00') as writer:
        writer.add_series(definition(), [{'period': '2024', 'value': 11, 'metadata': {'flag': 'A'}}])
        writer.add_series(definition(), [{'period': '2025', 'value': 12}])
    assert writer.summary()['observation_count'] == 3
    conn = read_connection(path)
    try:
        assert [tuple(r) for r in conn.execute('SELECT period,value FROM observations ORDER BY period')] == [
            ('2000', 0), ('2024', 11), ('2025', 12)]
        assert conn.execute('SELECT COUNT(*) FROM observation_revisions').fetchone()[0] == 1
        assert tuple(conn.execute('SELECT observation_count,last_period,last_value FROM series').fetchone()) == (3, '2025', 12)
        assert conn.execute("SELECT COUNT(*) FROM series_search WHERE series_search MATCH 'Mongolia'").fetchone()[0] == 1
    finally:
        conn.close()
    write(path, [{'period': '2024', 'value': 11, 'metadata': {'flag': 'A'}}], '2026-10-09T00:00:00+00:00')
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM observation_revisions').fetchone()[0] == 1


@pytest.mark.parametrize('journal_mode', ['WAL', 'DELETE'])
def test_failed_refresh_rolls_back_every_record(tmp_path, journal_mode):
    path = tmp_path / 'library.sqlite3'
    write(path, [{'period': '2024', 'value': 10}], journal_mode=journal_mode)
    with pytest.raises(ValueError):
        write(path, [{'period': '2024', 'value': 999}, {'period': '2025', 'value': float('nan')}],
              '2026-10-08T00:00:00+00:00', journal_mode=journal_mode)
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT value FROM observations').fetchone()[0] == 10
        assert conn.execute('SELECT COUNT(*) FROM observation_revisions').fetchone()[0] == 0
        assert conn.execute('SELECT checked_at FROM datasets').fetchone()[0].startswith('2026-10-07')


def test_old_empty_or_mismatched_refresh_rejected(tmp_path):
    path = tmp_path / 'library.sqlite3'
    write(path, [{'period': '2024', 'value': 10}])
    with pytest.raises(ValueError, match='newer dataset'):
        write(path, [{'period': '2024', 'value': 9}], '2026-10-06T00:00:00+00:00')
    with pytest.raises(ValueError, match='No usable'):
        write(path, [])
    with pytest.raises(ValueError, match='identity'):
        with LibraryWriter(path, 'worldbank', 'WDI') as writer:
            item = definition()
            item['unit'] = 'USD'
            writer.add_series(item, [{'period': '2024', 'value': 9}])


@pytest.mark.parametrize('journal_mode', ['WAL', 'DELETE'])
def test_reader_is_read_only_and_sees_previous_committed_snapshot(tmp_path, journal_mode):
    path = tmp_path / 'library.sqlite3'
    assert read_connection(path) is None
    write(path, [{'period': '2024', 'value': 10}], journal_mode=journal_mode)
    with LibraryWriter(path, 'worldbank', 'WDI', '2026-10-08T00:00:00+00:00', journal_mode=journal_mode) as writer:
        writer.add_series(definition(), [{'period': '2024', 'value': 11}])
        reader = read_connection(path)
        try:
            assert reader.execute('SELECT value FROM observations').fetchone()[0] == 10
            with pytest.raises(sqlite3.OperationalError):
                reader.execute('DELETE FROM series')
        finally:
            reader.close()
    reader = read_connection(path)
    try:
        assert reader.execute('SELECT value FROM observations').fetchone()[0] == 11
    finally:
        reader.close()


def test_default_stays_wal_and_environment_can_select_delete(tmp_path, monkeypatch):
    monkeypatch.delenv('PUBLIC_LIBRARY_JOURNAL_MODE', raising=False)
    default = tmp_path / 'default.sqlite3'
    with LibraryWriter(default, 'worldbank', 'WDI') as writer:
        assert writer.journal_mode == 'WAL'
        assert writer.conn.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
        writer.add_series(definition(), [{'period': '2024', 'value': 10}])
    monkeypatch.setenv('PUBLIC_LIBRARY_JOURNAL_MODE', 'DELETE')
    offline = tmp_path / 'offline.sqlite3'
    with LibraryWriter(offline, 'worldbank', 'WDI') as writer:
        assert writer.conn.execute('PRAGMA journal_mode').fetchone()[0] == 'delete'
        writer.add_series(definition(), [{'period': '2024', 'value': 10}])
        assert not offline.with_name(offline.name + '-wal').exists()
    assert not offline.with_name(offline.name + '-journal').exists()
    with sqlite3.connect(offline) as conn:
        assert conn.execute('PRAGMA journal_mode').fetchone()[0] == 'delete'
        assert conn.execute('SELECT observation_count FROM datasets').fetchone()[0] == 1


def test_explicit_mode_overrides_environment(tmp_path, monkeypatch):
    monkeypatch.setenv('PUBLIC_LIBRARY_JOURNAL_MODE', 'DELETE')
    with LibraryWriter(tmp_path / 'explicit.sqlite3', 'worldbank', 'WDI', journal_mode='WAL') as writer:
        assert writer.conn.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
        writer.add_series(definition(), [{'period': '2024', 'value': 10}])


@pytest.mark.parametrize('mode', ['', 'OFF', 'MEMORY', 'TRUNCATE', 'WAL; DROP TABLE series',
                                  'WAL\nPRAGMA writable_schema=ON'])
def test_invalid_environment_fails_before_filesystem_mutation(tmp_path, monkeypatch, mode):
    monkeypatch.setenv('PUBLIC_LIBRARY_JOURNAL_MODE', mode)
    path = tmp_path / 'absent' / 'library.sqlite3'
    with pytest.raises(ValueError, match='WAL or DELETE'):
        LibraryWriter(path, 'worldbank', 'WDI')
    assert not path.parent.exists()


@pytest.mark.parametrize('mode', ['OFF', 'WAL; DROP TABLE series', 'DELETE\x00', False, 1])
def test_invalid_explicit_setting_preserves_existing_database_bytes(tmp_path, mode):
    path = tmp_path / 'library.sqlite3'
    write(path, [{'period': '2024', 'value': 10}])
    before = path.read_bytes()
    with pytest.raises(ValueError, match='WAL or DELETE'):
        LibraryWriter(path, 'worldbank', 'WDI', journal_mode=mode)
    assert path.read_bytes() == before


def test_switch_to_delete_preserves_prior_periods_and_commits_revisions(tmp_path):
    path = tmp_path / 'library.sqlite3'
    write(path, [{'period': '2000', 'value': 0}, {'period': '2024', 'value': 10}], journal_mode='WAL')
    write(path, [{'period': '2024', 'value': 12}], '2026-10-08T00:00:00+00:00', journal_mode='DELETE')
    with sqlite3.connect(path) as conn:
        assert conn.execute('PRAGMA journal_mode').fetchone()[0] == 'delete'
        assert conn.execute('SELECT period,value FROM observations ORDER BY period').fetchall() == [('2000', 0), ('2024', 12)]
        assert conn.execute('SELECT value FROM observation_revisions').fetchall() == [(10,)]
        assert conn.execute('SELECT observation_count FROM datasets').fetchone()[0] == 2
    assert not path.with_name(path.name + '-wal').exists()
    assert not path.with_name(path.name + '-journal').exists()


@pytest.mark.parametrize('journal_mode', ['WAL', 'DELETE'])
def test_low_disk_before_first_observation_preserves_previous_dataset(tmp_path, monkeypatch, journal_mode):
    path = tmp_path / 'library.sqlite3'
    write(path, [{'period': '2024', 'value': 10}], journal_mode=journal_mode)
    monkeypatch.setattr(public_data_store.shutil, 'disk_usage',
                        lambda location: SimpleNamespace(free=public_data_store.MIN_FREE_BYTES - 1))
    with pytest.raises(ValueError, match='256 MiB'):
        write(path, [{'period': '2024', 'value': 999}], '2026-10-08T00:00:00+00:00', journal_mode=journal_mode)
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT period,value FROM observations').fetchall() == [('2024', 10)]
        assert conn.execute('SELECT checked_at FROM datasets').fetchone()[0].startswith('2026-10-07')
        assert conn.execute('SELECT COUNT(*) FROM observation_revisions').fetchone()[0] == 0


@pytest.mark.parametrize('journal_mode', ['WAL', 'DELETE'])
def test_low_disk_midtransaction_rolls_back_values_revisions_and_new_rows(tmp_path, monkeypatch, journal_mode):
    path = tmp_path / 'library.sqlite3'
    write(path, [{'period': '2024', 'value': 10}], journal_mode=journal_mode)
    monkeypatch.setattr(public_data_store, 'DISK_CHECK_INTERVAL', 2)
    checked_paths = []

    def disk_usage(location):
        checked_paths.append(location)
        return SimpleNamespace(free=public_data_store.MIN_FREE_BYTES + 1 if len(checked_paths) <= 2 else 0)

    monkeypatch.setattr(public_data_store.shutil, 'disk_usage', disk_usage)
    with pytest.raises(ValueError, match='disk space'):
        write(path, [{'period': '2024', 'value': 999}, {'period': '2025', 'value': 20}, {'period': '2026', 'value': 30}],
              '2026-10-08T00:00:00+00:00', journal_mode=journal_mode)
    assert checked_paths == [path.parent, path.parent, path.parent]
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT period,value FROM observations').fetchall() == [('2024', 10)]
        assert conn.execute('SELECT COUNT(*) FROM observation_revisions').fetchone()[0] == 0
        assert conn.execute('SELECT observation_count FROM series').fetchone()[0] == 1
        assert conn.execute('SELECT observation_count,checked_at FROM datasets').fetchone() == (
            1, '2026-10-07T00:00:00+00:00')


def test_disk_reserve_is_rechecked_before_finalization(tmp_path, monkeypatch):
    path = tmp_path / 'library.sqlite3'
    write(path, [{'period': '2024', 'value': 10}], journal_mode='DELETE')
    remaining = iter([public_data_store.MIN_FREE_BYTES, public_data_store.MIN_FREE_BYTES,
                      public_data_store.MIN_FREE_BYTES - 1])
    monkeypatch.setattr(public_data_store.shutil, 'disk_usage', lambda location: SimpleNamespace(free=next(remaining)))
    with pytest.raises(ValueError, match='disk space'):
        write(path, [{'period': '2025', 'value': 20}], '2026-10-08T00:00:00+00:00', journal_mode='DELETE')
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT period,value FROM observations').fetchall() == [('2024', 10)]


def test_low_disk_rejects_before_database_or_journal_creation(tmp_path, monkeypatch):
    path = tmp_path / 'library.sqlite3'
    monkeypatch.setattr(public_data_store.shutil, 'disk_usage', lambda location: SimpleNamespace(free=0))
    with pytest.raises(ValueError, match='disk space'):
        with LibraryWriter(path, 'worldbank', 'WDI', journal_mode='DELETE'):
            pytest.fail('No writer should be opened')
    assert list(tmp_path.iterdir()) == []
