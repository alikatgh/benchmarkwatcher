"""Read-only coverage inventory: discovery, compatible readers and saved facts.

This is deliberately a finite, dated source inventory, not a claim that the
internet's free data is exhausted. Reading it performs no publisher requests.
"""
import argparse
from datetime import date
from functools import lru_cache
import json
from pathlib import Path
import sqlite3
import time

if __package__ in (None, ''):
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.public_data_store import read_connection

ROOT = Path(__file__).resolve().parent


@lru_cache(maxsize=8)
def _catalog(path, modified, size):
    if size > 4 * 1024 * 1024:
        raise ValueError('Coverage catalog exceeds its size cap')
    return json.loads(Path(path).read_text())


def load_catalog(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Coverage catalog must be a regular file')
    info = path.stat()
    return _catalog(str(path), info.st_mtime_ns, info.st_size)


def coverage(database, *, faostat_path=None, sec_path=None):
    fao = load_catalog(faostat_path or ROOT / 'faostat_catalog_snapshot.json')
    sec = load_catalog(sec_path or ROOT / 'sec_concepts.json')
    saved, imports = {}, {}
    unavailable = False
    conn = None
    try:
        conn = read_connection(database)
        if conn is not None:
            start = time.monotonic()
            conn.set_progress_handler(lambda: time.monotonic() - start > 3, 10000)
            conn.execute('BEGIN')
            saved = {(r['source'], r['dataset']): dict(r) for r in conn.execute('SELECT * FROM datasets')}
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='faostat_import_runs'").fetchone():
                for row in conn.execute('SELECT * FROM faostat_import_runs ORDER BY rowid'):
                    imports[row['dataset']] = dict(row)
    except (sqlite3.Error, ValueError, OSError):
        saved, imports, unavailable = {}, {}, True
    finally:
        if conn is not None:
            conn.close()
    domains = []
    for entry in fao['datasets']:
        record = saved.get(('faostat', entry['dataset']))
        proof = imports.get(entry['dataset'])
        # A saved dataset without an import-window record is never labelled
        # complete; legacy data may still contain only the 2000 onward window.
        full = bool(record and proof and proof['start_year'] <= 1900
                    and proof['end_year'] >= date.today().year - 1
                    and bool(entry.get('source_updated'))
                    and proof['source_updated_at'] == entry['source_updated'])
        state = ('saved_full_history' if full else 'saved_history' if record else
                 'ready_to_import' if entry['support_status'] == 'supported' else 'review_required')
        domains.append({**entry, 'coverage_status': state, 'saved': record,
                        'import_scope': proof,
                        'needs_historical_import': entry['support_status'] == 'supported' and not full})
    return {
        'scope': 'Historical country and company observations from the explicitly listed public sources. Excludes forecasts, regional aggregates and unreviewed reuse terms.',
        'discovered_on': fao['discovered_on'], 'unavailable': unavailable,
        'saved_dataset_count': len(saved),
        'saved_series_count': sum(r['series_count'] for r in saved.values()),
        'saved_observation_count': sum(r['observation_count'] for r in saved.values()),
        'faostat': {'dataset_count': len(domains), 'supported_count': sum(r['support_status'] == 'supported' for r in domains),
                    'saved_count': sum(bool(r['saved']) for r in domains),
                    'full_history_count': sum(r['coverage_status'] == 'saved_full_history' for r in domains),
                    'datasets': domains},
        'sec': {'catalog_id': sec['id'], 'catalog_concept_count': len(sec['concepts']),
                'core_concept_count': len(sec['core_tags']), 'scope': sec['scope'],
                'saved': saved.get(('sec', 'frames'))},
        'worldbank': {'dataset': 'WDI', 'default_start_year': 1960,
                      'saved': saved.get(('worldbank', 'WDI'))},
    }


def expansion_plan(database):
    report = coverage(database)
    # Small domains first. Manifest row counts include aggregates and missing
    # cells and are planning estimates, never imported-observation counts.
    ready = [r for r in report['faostat']['datasets'] if r['needs_historical_import']]
    ready.sort(key=lambda r: (bool(r['saved']), r['reported_row_count'], r['dataset']))
    report['queued_faostat'] = [
        {'dataset': r['dataset'], 'name': r['name'], 'start_year': 1900,
         'end_year': date.today().year - 1, 'reported_rows': r['reported_row_count'],
         'archive_bytes': r['reported_size_bytes'], 'backfill_existing': bool(r['saved'])}
        for r in ready]
    report['limitations'] = [
        'A queued job has not been downloaded or committed.',
        'SEC catalog discovery does not prove that a frame or issuer exists for every concept/year.',
        'Other catalogued publishers require their own dataset readers and reuse review.',
        'Disk capacity is checked separately before downloading or merging each dataset.',
    ]
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    args = parser.parse_args(argv)
    print(json.dumps(expansion_plan(args.database), ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
