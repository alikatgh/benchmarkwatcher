import sqlite3
from datetime import date

from scripts.library_coverage import coverage, expansion_plan
from scripts.public_data_store import LibraryWriter, series_id
from scripts.import_faostat_library import FAOSTAT_IMPORT_RUN_SCHEMA


def seed(path):
    with LibraryWriter(path, 'faostat', 'IC') as writer:
        writer.add_series(dict(id=series_id('faostat','1','IC_use','t'),source='faostat',dataset='IC',
            entity_id='1',entity_name='Example',entity_type='country',country_code='',
            indicator_id='IC_use',indicator_name='Pesticide use',unit='t',frequency='annual',
            source_url='https://www.fao.org/faostat/en/#data/RP',attribution='FAO',license='CC-BY-4.0'),
            [{'period':'2024','value':1}])


def test_catalogs_and_plans_do_not_imply_downloads(tmp_path, monkeypatch):
    monkeypatch.setattr('requests.sessions.Session.request',lambda *a,**k: (_ for _ in ()).throw(AssertionError('No network')))
    missing=tmp_path/'absent.sqlite3'
    report=expansion_plan(missing)
    assert not missing.exists()
    assert report['saved_dataset_count'] == 0
    assert report['faostat']['dataset_count'] == 69
    assert report['faostat']['supported_count'] == 39
    assert report['faostat']['saved_count'] == 0
    assert report['faostat']['full_history_count'] == 0
    assert report['sec']['catalog_concept_count'] == 7868
    assert report['sec']['core_concept_count'] == 98
    assert len(report['queued_faostat']) == 28
    assert all(r['start_year'] == 1900 for r in report['queued_faostat'])
    assert 'TM' not in {r['dataset'] for r in report['queued_faostat']}


def test_saved_legacy_dataset_is_not_labelled_full_history(tmp_path):
    path=tmp_path/'data.sqlite3'
    seed(path)
    report=coverage(path)
    entry=next(r for r in report['faostat']['datasets'] if r['dataset']=='IC')
    assert report['saved_observation_count'] == 1
    assert entry['coverage_status'] == 'saved_history'
    assert entry['needs_historical_import']


def test_completed_import_window_separates_saved_and_full_scope(tmp_path):
    path=tmp_path/'data.sqlite3'
    seed(path)
    with sqlite3.connect(path) as conn:
        conn.execute(FAOSTAT_IMPORT_RUN_SCHEMA)
        conn.execute('INSERT INTO faostat_import_runs VALUES (?,?,?,?,?,?,?,?,?,?)',
                     ('IC','2026-10-08T00:00:00+00:00',next(r['source_updated'] for r in coverage(path)['faostat']['datasets'] if r['dataset']=='IC'),1900,date.today().year-1,
                      'archive.zip',100,1,1,'{}'))
    entry=next(r for r in coverage(path)['faostat']['datasets'] if r['dataset']=='IC')
    assert entry['coverage_status']=='saved_full_history'
    assert not entry['needs_historical_import']


def test_corrupt_database_does_not_turn_catalog_entries_into_saved_data(tmp_path):
    path=tmp_path/'data.sqlite3'
    path.write_bytes(b'not a sqlite database')
    report=coverage(path)
    assert report['unavailable']
    assert report['saved_observation_count']==0
    assert report['faostat']['full_history_count']==0


def test_new_source_vintage_requeues_previous_full_window(tmp_path):
    path = tmp_path / 'data.sqlite3'
    seed(path)
    with sqlite3.connect(path) as conn:
        conn.execute(FAOSTAT_IMPORT_RUN_SCHEMA)
        conn.execute('INSERT INTO faostat_import_runs VALUES (?,?,?,?,?,?,?,?,?,?)',
                     ('IC','2026-10-08T00:00:00+00:00','2000-01-01',1900,date.today().year-1,
                      'archive.zip',100,1,1,'{}'))
    entry = next(r for r in coverage(path)['faostat']['datasets'] if r['dataset']=='IC')
    assert entry['coverage_status'] == 'saved_history'
    assert entry['needs_historical_import']
