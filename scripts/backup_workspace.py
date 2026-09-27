"""Create a consistent, private SQLite snapshot; retain the newest seven."""
import argparse
import os
from datetime import datetime, timezone
from pathlib import Path
import sqlite3


def backup(database, directory):
    source = Path(database).resolve()
    target = Path(directory).resolve()
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = target / f'workspace-{stamp}.sqlite3'
    pending = output.with_suffix('.partial')
    os.close(os.open(pending, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
    try:
        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src:
            with sqlite3.connect(pending) as dst:
                src.backup(dst)
                if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Workspace backup integrity check failed.')
        pending.replace(output)
    except Exception:
        pending.unlink(missing_ok=True)
        raise
    for old in sorted(target.glob('workspace-*.sqlite3'), reverse=True)[7:]:
        old.unlink()
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('database')
    parser.add_argument('directory')
    args = parser.parse_args()
    backup(args.database, args.directory)
    print('Workspace backup completed and integrity checked.')
