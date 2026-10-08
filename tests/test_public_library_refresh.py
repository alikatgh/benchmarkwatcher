from datetime import date, datetime, timezone, timedelta
from unittest.mock import patch
from types import SimpleNamespace

from scripts.public_data_store import LibraryWriter, series_id, read_connection
from scripts.refresh_public_library import due_dataset, refresh_due, command_for, configured_database, main


def test_operational_entry_points_honor_configured_database(tmp_path,monkeypatch):
    path=tmp_path/'alternative-volume'/'public-library.sqlite3'
    monkeypatch.setenv('PUBLIC_LIBRARY_DB',str(path))
    assert configured_database(tmp_path/'legacy-data')==path
    with patch('scripts.refresh_public_library.due_dataset',return_value=None) as due:
        assert main(['--status'])==0
        due.assert_called_once_with(path)
    monkeypatch.delenv('PUBLIC_LIBRARY_DB')
    assert configured_database(tmp_path/'legacy-data')==tmp_path/'legacy-data'/'public-library.sqlite3'


def populated(path, source='worldbank', dataset='WDI', stamp='2026-09-01T00:00:00Z'):
    with LibraryWriter(path,source,dataset,stamp) as writer:
        writer.add_series(dict(id=series_id(source,'test',dataset,'count'), source=source,dataset=dataset,
                               entity_id='test',entity_name='Test',entity_type='country', indicator_id=dataset,
                               indicator_name='Test',unit='count',frequency='annual',source_url='https://example.org',
                               attribution='Test',license='Test'),[{'period':'2024','value':1}])


def test_due_selection_uses_intervals_and_does_not_bootstrap(tmp_path):
    path=tmp_path/'library.sqlite3'
    assert due_dataset(path) is None
    assert refresh_due(path)['status']=='not_populated'
    assert not path.exists()
    populated(path)
    assert due_dataset(path,datetime(2026,9,10,tzinfo=timezone.utc)) is None
    assert due_dataset(path,datetime(2026,10,7,tzinfo=timezone.utc))==('worldbank','WDI')
    with patch('subprocess.run',side_effect=AssertionError('Not due')):
        assert refresh_due(path,now=datetime(2026,9,10,tzinfo=timezone.utc))['status']=='current'


def test_low_storage_defers_without_network_or_mutating_observations(tmp_path):
    path=tmp_path/'library.sqlite3'
    populated(path)
    with patch('scripts.refresh_public_library.shutil.disk_usage') as usage, patch('subprocess.run',side_effect=AssertionError('Low disk')):
        usage.return_value.free=100
        report=refresh_due(path,now=datetime(2026,10,7,tzinfo=timezone.utc))
    assert report['status']=='deferred_storage'
    assert report['network_requests']==0


def test_refresh_command_keeps_dataset_specific_defaults(tmp_path):
    command=command_for('faostat','RL',tmp_path/'library.sqlite3',tmp_path)
    assert command[-2:]==['--dataset','RL']
    assert '--database' in command and '--scratch-dir' in command


def test_scheduled_sec_refresh_stays_inside_request_budget_after_2027(tmp_path):
    with patch('scripts.refresh_public_library.date') as calendar:
        calendar.today.return_value=date(2031,1,1)
        command=command_for('sec','frames',tmp_path/'library.sqlite3',tmp_path)
    start=int(command[command.index('--start-year')+1])
    end=int(command[command.index('--end-year')+1])
    assert (start,end)==(2019,2030)
    assert int(command[command.index('--max-requests')+1]) == 400
    assert int(command[command.index('--frame-limit')+1]) <= 400
    assert command[command.index('--frame-offset')+1] == '0'
    assert '--expected-catalog-sha256' in command


def test_sec_refresh_rotation_uses_only_matching_committed_batches(tmp_path):
    import sqlite3
    from scripts.refresh_public_library import next_sec_offset
    path=tmp_path/'library.sqlite3'
    populated(path, 'sec', 'frames')
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE sec_frame_batches (id INTEGER PRIMARY KEY, committed_at TEXT, catalog_sha256 TEXT, start_year INTEGER, end_year INTEGER, frame_offset INTEGER, frame_limit INTEGER)')
        conn.execute("INSERT INTO sec_frame_batches VALUES (1,'2026-01-01','current',2014,2025,0,400)")
        conn.execute("INSERT INTO sec_frame_batches VALUES (2,'2026-02-01','other',2014,2025,800,376)")
    assert next_sec_offset(path,'current',2014,2025,1176) == 400
    assert next_sec_offset(path,'current',2015,2026,1176) == 0
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO sec_frame_batches VALUES (3,'2026-03-01','current',2014,2025,800,376)")
    assert next_sec_offset(path,'current',2014,2025,1176) == 0


def test_new_faostat_domains_participate_in_maintenance(tmp_path):
    path=tmp_path/'library.sqlite3'
    populated(path, 'faostat', 'RP', '2026-01-01T00:00:00Z')
    assert due_dataset(path,datetime(2026,10,8,tzinfo=timezone.utc)) == ('faostat','RP')
    assert command_for('faostat','RP',path,tmp_path)[-2:] == ['--dataset','RP']


def test_failed_oldest_source_does_not_starve_another_due_source(tmp_path):
    path = tmp_path/'library.sqlite3'
    populated(path)
    populated(path,'sec','frames','2026-09-15T00:00:00Z')
    with patch('scripts.refresh_public_library.shutil.disk_usage') as usage, patch('subprocess.run') as run:
        usage.return_value.free=10**12
        run.return_value=SimpleNamespace(returncode=1,stderr='Provider unavailable',stdout='')
        first=refresh_due(path,tmp_path,now=datetime(2026,10,7,tzinfo=timezone.utc))
        second=refresh_due(path,tmp_path,now=datetime(2026,10,8,tzinfo=timezone.utc))
    assert first['source']=='worldbank'
    assert second['source']=='sec'
    assert due_dataset(path,datetime(2026,10,9,tzinfo=timezone.utc)) is None
    assert due_dataset(path,datetime(2026,10,10,tzinfo=timezone.utc))==('worldbank','WDI')


def test_multiple_failed_domains_do_not_starve_other_publishers(tmp_path):
    path=tmp_path/'library.sqlite3'
    for dataset in ('QCL','RL','TCL'):
        populated(path,'faostat',dataset,'2026-08-01T00:00:00Z')
    populated(path,'worldbank','WDI','2026-09-15T00:00:00Z')
    populated(path,'sec','frames','2026-09-27T00:00:00Z')
    now=datetime(2026,10,7,tzinfo=timezone.utc)
    selected=[]
    with patch('scripts.refresh_public_library.shutil.disk_usage') as usage, patch('subprocess.run') as run:
        usage.return_value.free=10**12
        run.return_value=SimpleNamespace(returncode=1,stderr='Provider unavailable',stdout='')
        for day in range(12):
            report=refresh_due(path,tmp_path,now=now+timedelta(days=day))
            selected.append((report['source'],report['dataset']))
    assert set(selected[:5])=={('faostat','QCL'),('faostat','RL'),('faostat','TCL'),('worldbank','WDI'),('sec','frames')}
    assert selected[5:10]==selected[:5]
    conn=read_connection(path)
    try:
        stamps={(r['source'],r['dataset']):r['checked_at'][:10] for r in conn.execute('SELECT * FROM datasets')}
        assert stamps[('worldbank','WDI')]=='2026-09-15'
        assert stamps[('sec','frames')]=='2026-09-27'
        assert all(stamps[('faostat',d)]=='2026-08-01' for d in ('QCL','RL','TCL'))
    finally:
        conn.close()
