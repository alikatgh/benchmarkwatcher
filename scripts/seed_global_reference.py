#!/usr/bin/env python3
"""Validate and import a downloaded World Bank batch without upstream requests.

Existing histories and revision archives are merged. The index is written last.
A dry run validates every staged/destination record without changing any files.
"""

import argparse
import json
import math
import re
import sys
from datetime import date, datetime
from pathlib import Path

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.fetchers._shared import compute_metrics, save_atomic
from scripts.fetchers.global_reference import SourceError
from scripts.global_sources import (BULK_MANIFEST, SCRIPT_DIR, _archive, load_series,
                                     load_worldbank_bulk, merge_reference_history,
                                     worldbank_definition, validate_worldbank_archive,
                                     WORLD_BANK_DEFINITION_FIELDS, REFERENCE_OBSERVATION_FIELDS)

MAX_BYTES = 4 * 1024 * 1024
LEGACY_DEFINITIONS = {row['id']: row for row in load_series() if row.get('source_id') == 'worldbank'}
DEFINITION_FIELDS = WORLD_BANK_DEFINITION_FIELDS


def _base(path):
    path = Path(path).absolute()
    if path.is_symlink():
        raise SourceError('Staging and destination directories must not be symlinks')
    return path.parent.resolve() / path.name


def _stamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise SourceError('A saved source fetch timestamp is invalid')
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if stamp.utcoffset() is None:
            raise ValueError('Timezone required')
        return stamp
    except ValueError as exc:
        raise SourceError('A saved source fetch timestamp is invalid') from exc


def _history(payload):
    rows = payload.get('history')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 20000:
        raise SourceError('A saved country history is empty or invalid')
    seen = set()
    for point in rows:
        if (not isinstance(point, dict) or not isinstance(point.get('period'), str)
                or not re.fullmatch(r'\d{4}', point['period'])
                or not 1900 <= int(point['period']) < date.today().year
                or point.get('date') != point['period'] + '-01-01'
                or isinstance(point.get('price'), bool)
                or not isinstance(point.get('price'), (int, float)) or not math.isfinite(point['price'])
                or point['date'] in seen):
            raise SourceError('A saved country observation is invalid or duplicated')
        seen.add(point['date'])
        if ((point.get('status') is not None and not isinstance(point['status'], str)) or
                (point.get('footnote') is not None and
                 (not isinstance(point['footnote'], str) or len(point['footnote']) > 4000)) or
                (point.get('source_decimal') is not None and
                 (isinstance(point['source_decimal'], bool) or not isinstance(point['source_decimal'], int)
                  or not 0 <= point['source_decimal'] <= 20))):
            raise SourceError('A saved country observation has invalid source annotations')
    if rows != sorted(rows, key=lambda row: row['date']):
        raise SourceError('Country histories must be ordered by source year')
    return rows


def _revision_union(*groups):
    def identity(revision):
        return ({key: revision.get(key) for key in ('date', 'previous', 'replacement', 'checked_at')}
                if isinstance(revision, dict) and 'previous' in revision and 'replacement' in revision
                else revision)
    # Retain the destination archive byte-for-byte at the object level,
    # including intentional duplicate events and any operator annotations.
    result = list(groups[0])
    seen = {json.dumps(identity(revision), sort_keys=True, ensure_ascii=False) for revision in result}
    for group in groups[1:]:
        for revision in group:
            # The same source replacement may be witnessed by two cached
            # copies with different previous fetch timestamps. Preserve one
            # event, with the destination's existing archive taking priority.
            key = json.dumps(identity(revision), sort_keys=True, ensure_ascii=False)
            if key not in seen:
                seen.add(key); result.append(revision)
    return result


def _definition_maps():
    config = load_worldbank_bulk()
    snapshot = json.loads((SCRIPT_DIR / 'global_catalog_snapshot.json').read_text())['worldbank']
    economies = {row['id']: row for row in snapshot['economies']}
    indicators = {row['indicator']: row for row in config['indicators'] if row.get('enabled') is True}
    aliases = {(row['api_config']['country'], row['api_config']['indicator']): row['id']
               for row in load_series() if row.get('source_id') == 'worldbank'}
    return economies, indicators, aliases


def _definition(entry, maps):
    economies, indicators, aliases = maps
    if not isinstance(entry, dict):
        raise SourceError('A country manifest entry is invalid')
    economy, indicator = economies.get(entry.get('economy_id')), indicators.get(entry.get('indicator'))
    if economy is None or indicator is None:
        raise SourceError('A country manifest contains an unreviewed economy or indicator')
    definition = worldbank_definition(indicator, economy, aliases)
    if entry.get('id') != definition['id']:
        raise SourceError('A country manifest identifier does not match its reviewed definition')
    return definition


def _manifest(path):
    payload = _archive(path)
    rows = payload.get('series')
    if (payload.get('schema_version') != 1 or payload.get('source_id') != 'worldbank'
            or payload.get('source_database') != 2 or not isinstance(rows, list)
            or not 1 <= len(rows) <= 2000 or payload.get('billing_enabled') is not False):
        raise SourceError('The country manifest has an invalid identity or schema')
    ids = [row.get('id') for row in rows if isinstance(row, dict)]
    if len(ids) != len(rows) or len(set(ids)) != len(rows):
        raise SourceError('The country manifest contains duplicate or invalid identifiers')
    expected = {'series_count': len(rows), 'economies_count': len({row.get('economy_id') for row in rows}),
                'indicator_count': len({row.get('indicator') for row in rows})}
    if any(payload.get(key) != value for key, value in expected.items()):
        raise SourceError('The country manifest counts do not match its entries')
    return payload


def prepare_import(staging, destination):
    """Validate the entire batch before any mutation and construct merged data."""
    staging, destination = _base(staging), _base(destination)
    if staging == destination or not staging.is_dir():
        raise SourceError('Choose a separate existing staging directory')
    if destination.exists() and not destination.is_dir():
        raise SourceError('Destination must be a directory')
    manifest = _manifest(staging / BULK_MANIFEST)
    maps = _definition_maps()
    records, incoming = {}, {}
    observations = 0
    for entry in manifest['series']:
        definition = _definition(entry, maps)
        identifier = definition['id']
        staged = _archive(staging / (identifier + '.json'), identifier)
        if not staged or any(staged.get(key) != definition[key] for key in DEFINITION_FIELDS):
            raise SourceError('A staged record does not match its reviewed identity or units')
        history = _history(staged)
        _stamp(staged.get('fetched_at'))
        if (staged.get('simulated') is not False or history[-1] != entry.get('latest') or
                len(history) != entry.get('observation_count') or
                staged['fetched_at'][:10] != entry.get('checked_on') or
                staged.get('price') != history[-1]['price'] or staged.get('period') != history[-1]['period']):
            raise SourceError('A staged record does not match its manifest observations')
        observations += len(history)
        incoming[identifier] = (definition, staged)
    if manifest.get('observation_count') != observations:
        raise SourceError('The country manifest observation total is incorrect')
    old_manifest_path = destination / BULK_MANIFEST
    old_entries = _manifest(old_manifest_path)['series'] if old_manifest_path.exists() else []
    for entry in old_entries:
        definition = _definition(entry, maps)
        identifier = definition['id']
        if identifier not in incoming:
            record = _archive(destination / (identifier + '.json'), identifier)
            if any(record.get(key) != definition[key] for key in DEFINITION_FIELDS):
                raise SourceError('An existing indexed country record has conflicting metadata')
            _history(record); _stamp(record.get('fetched_at'))
            records[identifier] = record
    created = merged = resumed = 0
    for identifier, (definition, staged) in incoming.items():
        existing = _archive(destination / (identifier + '.json'), identifier)
        if existing:
            prior = _history(existing)
            validate_worldbank_archive(existing, definition, LEGACY_DEFINITIONS.get(identifier))
            if identifier not in LEGACY_DEFINITIONS:
                by_date = {point['date']: point for point in prior}
                if any(point['date'] in by_date and any(by_date[point['date']].get(key) != point.get(key)
                                                       for key in REFERENCE_OBSERVATION_FIELDS)
                       for point in staged['history']):
                    raise SourceError('Unexpected existing country record has conflicting observations')
                resumed += 1
            else:
                merged += 1
            if existing.get('fetched_at') and _stamp(existing['fetched_at']) > _stamp(staged['fetched_at']):
                by_date = {point['date']: point for point in prior}
                if any(point['date'] in by_date and any(by_date[point['date']].get(key) != point.get(key)
                                                       for key in REFERENCE_OBSERVATION_FIELDS) for point in staged['history']):
                    raise SourceError('The staged batch would replace a newer source value; preserve the destination')
        else:
            created += 1
        history, revisions = merge_reference_history(existing, staged['history'], staged['fetched_at'])
        record = dict(existing)
        record.update(definition)
        record.update({'history': history,
                       'revisions': _revision_union(existing.get('revisions', []), staged.get('revisions', []), revisions),
                       'price': history[-1]['price'], 'date': history[-1]['date'], 'period': history[-1]['period'],
                       'simulated': False, 'fetched_at': max((value for value in
                           (existing.get('fetched_at'), staged['fetched_at']) if value), key=_stamp),
                       'updated_at': max((value for value in
                           (existing.get('updated_at', existing.get('fetched_at')),
                            staged.get('updated_at', staged['fetched_at'])) if value), key=_stamp),
                       'metrics': compute_metrics(history),
                       'calculations_note': 'Descriptive changes are calculated by BenchmarkWatcher; source observations are unchanged.'})
        records[identifier] = record
    entries = [{'id': record['id'], 'economy_id': record['economy_id'], 'indicator': record['indicator'],
                'latest': record['history'][-1], 'observation_count': len(record['history']),
                'checked_on': record['fetched_at'][:10]} for record in records.values()]
    entries.sort(key=lambda row: (row['economy_id'], row['indicator']))
    updated_manifest = dict(manifest)
    updated_manifest.update(series=entries, series_count=len(entries),
                            economies_count=len({row['economy_id'] for row in entries}),
                            indicator_count=len({row['indicator'] for row in entries}),
                            observation_count=sum(row['observation_count'] for row in entries))
    summary = {key: updated_manifest[key] for key in ('series_count', 'economies_count', 'indicator_count', 'observation_count')}
    summary.update(created=created, existing_agriculture_merged=merged, identical_records_resumed=resumed,
                   existing_unlisted_records_retained=len(records) - len(incoming), billing_enabled=False)
    return records, updated_manifest, summary


def import_staged(staging, destination, dry_run=False):
    records, manifest, summary = prepare_import(staging, destination)
    if not dry_run:
        destination = _base(destination)
        destination.mkdir(parents=True, exist_ok=True)
        for identifier, record in records.items():
            if not save_atomic(str(destination / (identifier + '.json')), record):
                raise SourceError('A country record could not be saved; previous manifest preserved. Resume after fixing storage.')
        if not save_atomic(str(destination / BULK_MANIFEST), manifest):
            raise SourceError('Country manifest could not be saved; previous manifest preserved. Record files remain resumable.')
    return {**summary, 'dry_run': dry_run, 'network_requests': 0}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staging-dir', type=Path, required=True)
    parser.add_argument('--destination-dir', type=Path, required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = import_staged(args.staging_dir, args.destination_dir, args.dry_run)
    except (SourceError, OSError, ValueError, TypeError, KeyError) as exc:
        print(json.dumps({'status': 'failed', 'reason': str(exc)[:240], 'network_requests': 0, 'billing_enabled': False}))
        return 1
    print(json.dumps({'status': 'validated' if args.dry_run else 'imported', **result}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
