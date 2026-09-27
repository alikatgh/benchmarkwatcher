import sqlite3
from scripts.backup_workspace import backup


def test_backup_preserves_database_and_keeps_seven_private_snapshots(tmp_path):
    source = tmp_path / 'workspace.sqlite3'
    destination = tmp_path / 'backups'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE results (value TEXT)')
        db.execute("INSERT INTO results VALUES ('saved result')")
    for _ in range(8):
        saved = backup(source, destination)
    assert len(list(destination.glob('*.sqlite3'))) == 7
    assert saved.stat().st_mode & 0o077 == 0
    with sqlite3.connect(saved) as db:
        assert db.execute('SELECT value FROM results').fetchone()[0] == 'saved result'
