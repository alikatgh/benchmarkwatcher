"""The homepage reads only published, saved dataset-summary metadata."""

import sqlite3

import pytest
from flask import Flask

from app.homepage import homepage_coverage


COUNT_KEYS = (
    'dataset_count', 'observation_count', 'history_count', 'country_histories',
    'company_histories', 'companies', 'country_dataset_count',
)


@pytest.fixture
def coverage_app(tmp_path):
    app = Flask(__name__)
    app.config.update(
        JSON_DATA_DIR=str(tmp_path),
        PUBLIC_LIBRARY_DB=str(tmp_path / 'library.sqlite3'),
    )
    return app


def save_summaries(app, rows):
    # Intentionally omit series/observations tables: a history scan would fail.
    with sqlite3.connect(app.config['PUBLIC_LIBRARY_DB']) as conn:
        conn.execute('''CREATE TABLE datasets (
            source TEXT NOT NULL, dataset TEXT NOT NULL, checked_at TEXT NOT NULL,
            series_count INTEGER NOT NULL, entity_count INTEGER NOT NULL,
            indicator_count INTEGER NOT NULL, observation_count INTEGER NOT NULL,
            PRIMARY KEY (source,dataset)
        ) WITHOUT ROWID''')
        conn.executemany('INSERT INTO datasets VALUES (?,?,?,?,?,?,?)', rows)


def test_coverage_uses_only_published_saved_dataset_summaries(coverage_app, tmp_path):
    save_summaries(coverage_app, [
        ('worldbank', 'WDI', '2026-10-08', 8, 2, 4, 30),
        ('faostat', 'QCL', '2026-10-07', 3, 1, 3, 20),
        ('sec', 'frames', '2026-10-06', 4, 2, 2, 10),
        ('sec', 'other', '2026-10-06', 3, 2, 2, 12),
        ('faostat', 'TCL', '2026-10-08', 500, 50, 10, 4000),
        ('faostat', 'BE', '2026-10-08', 600, 60, 10, 5000),
        ('faostat', 'RL', '2026-10-08', 200, 20, 10, 0),
    ])
    # Commodity data belongs to a separate collection and must not enter totals.
    (tmp_path / 'gold.json').write_text('{"history":[{"price":2000}]}')
    database = tmp_path / 'library.sqlite3'
    before = database.read_bytes()
    files_before = set(tmp_path.iterdir())

    with coverage_app.app_context():
        result = homepage_coverage()

    assert result['status'] == 'available'
    assert {key: result[key] for key in COUNT_KEYS} == {
        'dataset_count': 4,
        'observation_count': 72,
        'history_count': 18,
        'country_histories': 11,
        'company_histories': 7,
        'companies': 2,
        'country_dataset_count': 2,
    }
    assert [(row['source'], row['dataset']) for row in result['datasets']] == [
        ('worldbank', 'WDI'), ('faostat', 'QCL'), ('sec', 'frames'), ('sec', 'other'),
    ]
    by_key = {(row['source'], row['dataset']): row for row in result['datasets']}
    assert by_key['faostat', 'QCL']['name'] == 'Crops and livestock'
    assert by_key['faostat', 'QCL']['publisher'] == 'FAOSTAT'
    assert by_key['sec', 'frames']['name'] == 'Company financial disclosures'
    assert by_key['sec', 'other']['name'] == 'other'
    assert by_key['worldbank', 'WDI']['publisher'] == 'World Bank'
    assert by_key['worldbank', 'WDI']['name'] == 'World Development Indicators'
    assert database.read_bytes() == before
    assert set(tmp_path.iterdir()) == files_before


def test_company_count_is_unknown_without_sec_frames_summary(coverage_app):
    save_summaries(coverage_app, [
        ('worldbank', 'WDI', '2026-10-08', 8, 2, 4, 30),
        ('sec', 'other', '2026-10-08', 3, 2, 2, 12),
    ])
    with coverage_app.app_context():
        result = homepage_coverage()
    assert result['status'] == 'available'
    assert result['company_histories'] == 3
    assert result['companies'] is None


def test_missing_database_is_empty_and_is_not_created(coverage_app, tmp_path):
    with coverage_app.app_context():
        result = homepage_coverage()
    assert result['status'] == 'empty'
    assert result['datasets'] == []
    assert all(result[key] == 0 for key in COUNT_KEYS)
    assert list(tmp_path.iterdir()) == []


def test_default_database_path_is_used_without_creating_it(coverage_app, tmp_path):
    coverage_app.config.pop('PUBLIC_LIBRARY_DB')
    with coverage_app.app_context():
        result = homepage_coverage()
    assert result['status'] == 'empty'
    assert not (tmp_path / 'public-library.sqlite3').exists()


def test_only_held_or_unsaved_dataset_metadata_is_empty(coverage_app):
    save_summaries(coverage_app, [
        ('faostat', 'TCL', '2026-10-08', 500, 50, 10, 4000),
        ('worldbank', 'WDI', '2026-10-08', 200, 20, 10, 0),
    ])
    with coverage_app.app_context():
        result = homepage_coverage()
    assert result['status'] == 'empty'
    assert result['datasets'] == []
    assert all(result[key] == 0 for key in COUNT_KEYS)


@pytest.mark.parametrize('failure', ['open', 'query'])
def test_sqlite_failures_are_unavailable_without_raising(coverage_app, monkeypatch, failure):
    if failure == 'open':
        def fail_open(path):
            raise sqlite3.OperationalError('unable to open database')
        monkeypatch.setattr('app.homepage.read_connection', fail_open)
    else:
        # A saved file with no dataset-summary schema must not report zero data.
        sqlite3.connect(coverage_app.config['PUBLIC_LIBRARY_DB']).close()
    with coverage_app.app_context():
        result = homepage_coverage()
    assert result['status'] == 'unavailable'
    assert result['datasets'] == []
    assert all(result[key] is None for key in COUNT_KEYS)


def test_invalid_summary_counts_are_not_presented_as_measurements(coverage_app):
    save_summaries(coverage_app, [
        ('worldbank', 'WDI', '2026-10-08', -1, 2, 4, 30),
    ])
    with coverage_app.app_context():
        result = homepage_coverage()
    assert result['status'] == 'unavailable'
    assert all(result[key] is None for key in COUNT_KEYS)
