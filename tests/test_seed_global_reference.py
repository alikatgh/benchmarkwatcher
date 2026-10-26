"""Deterministic staged imports preserve archives and fail before unsafe writes."""

import json
from pathlib import Path

import pytest

from scripts import global_sources as gs
from scripts import seed_global_reference as seed
from scripts.fetchers.global_reference import SourceError


@pytest.fixture
def batch(tmp_path):
    stage, destination = tmp_path / 'stage', tmp_path / 'destination'
    stage.mkdir(); destination.mkdir()
    config = gs.load_worldbank_bulk()
    snapshot = json.loads((gs.SCRIPT_DIR / 'global_catalog_snapshot.json').read_text())
    economy = next(row for row in snapshot['worldbank']['economies'] if row['id'] == 'JPN')
    aliases = {('JP', 'NV.AGR.TOTL.ZS'): 'jp_wb_agriculture_share'}
    entries, records = [], []
    for code in ('SP.POP.TOTL', 'NV.AGR.TOTL.ZS'):
        indicator = next(row for row in config['indicators'] if row['indicator'] == code)
        record = gs.worldbank_definition(indicator, economy, aliases)
        rows = [{'date': '2024-01-01', 'period': '2024', 'price': 0},
                {'date': '2025-01-01', 'period': '2025', 'price': 1.234567891234, 'footnote': 'Official estimate'}]
        record.update(history=rows, revisions=[], price=rows[-1]['price'], date=rows[-1]['date'], period='2025',
                      simulated=False, fetched_at='2026-10-03T01:00:00+00:00', updated_at='2026-10-03T01:00:00+00:00')
        (stage / (record['id'] + '.json')).write_text(json.dumps(record))
        entries.append({'id': record['id'], 'economy_id': 'JPN', 'indicator': code, 'latest': rows[-1],
                        'observation_count': 2, 'checked_on': '2026-10-03'})
        records.append(record)
    manifest = {'schema_version': 1, 'source_id': 'worldbank', 'source_database': 2, 'billing_enabled': False,
                'series_count': 2, 'economies_count': 1, 'indicator_count': 2, 'observation_count': 4,
                'series': entries, 'results': []}
    (stage / gs.BULK_MANIFEST).write_text(json.dumps(manifest))
    return stage, destination, records


def old_agriculture(destination):
    record = {'id': 'jp_wb_agriculture_share', 'unit': '% of GDP', 'currency': 'PERCENT',
              'source_id': 'worldbank', 'custom_metadata': 'Keep this operator annotation',
              'fetched_at': '2026-10-02T01:00:00+00:00', 'history': [
                  {'date': '1990-01-01', 'period': '1990', 'price': 9},
                  {'date': '2025-01-01', 'period': '2025', 'price': 2, 'status': 'e'}],
              'revisions': [{'date': '1989-01-01', 'note': 'Retain the previous archive'}]}
    (destination / 'jp_wb_agriculture_share.json').write_text(json.dumps(record))
    return record


def test_dry_run_then_import_preserves_older_observations_custom_metadata_and_revisions(batch):
    stage, destination, _ = batch
    original = old_agriculture(destination)
    before = {path.name: path.read_bytes() for path in destination.iterdir()}
    result = seed.import_staged(stage, destination, dry_run=True)
    assert result['created'] == 1 and result['existing_agriculture_merged'] == 1
    assert result['observation_count'] == 5 and result['network_requests'] == 0
    assert before == {path.name: path.read_bytes() for path in destination.iterdir()}
    result = seed.import_staged(stage, destination)
    saved = json.loads((destination / 'jp_wb_agriculture_share.json').read_text())
    assert saved['history'][0] == original['history'][0]
    assert saved['custom_metadata'] == original['custom_metadata']
    assert saved['revisions'][0] == original['revisions'][0]
    assert saved['revisions'][-1]['previous']['price'] == 2
    assert saved['revisions'][-1]['replacement']['price'] == 1.234567891234
    manifest = json.loads((destination / gs.BULK_MANIFEST).read_text())
    assert manifest['observation_count'] == 5
    assert next(row for row in manifest['series'] if row['id'] == saved['id'])['observation_count'] == 3
    seed.import_staged(stage, destination)
    assert len(json.loads((destination / saved['id']).with_suffix('.json').read_text())['revisions']) == 2


def test_conflicting_unexpected_destination_is_rejected_before_any_mutation(batch):
    stage, destination, records = batch
    record = records[0]; record['history'][-1]['price'] = 99
    path = destination / (record['id'] + '.json'); path.write_text(json.dumps(record))
    before = path.read_bytes()
    with pytest.raises(SourceError, match='conflicting observations'):
        seed.import_staged(stage, destination)
    assert path.read_bytes() == before
    assert not (destination / gs.BULK_MANIFEST).exists()
    assert len(list(destination.iterdir())) == 1


def test_bad_manifest_counts_fail_before_directory_creation(batch, tmp_path):
    stage, _, _ = batch
    path = stage / gs.BULK_MANIFEST; payload = json.loads(path.read_text()); payload['observation_count'] = 999
    path.write_text(json.dumps(payload))
    destination = tmp_path / 'not-created'
    with pytest.raises(SourceError, match='observation total'):
        seed.import_staged(stage, destination)
    assert not destination.exists()


def test_atomic_write_failure_keeps_old_index_and_is_safely_resumable(batch, monkeypatch):
    stage, destination, _ = batch
    original = old_agriculture(destination)
    write = seed.save_atomic
    monkeypatch.setattr(seed, 'save_atomic', lambda path, payload: False if path.endswith('jp_wb_agriculture_share.json') else write(path, payload))
    with pytest.raises(SourceError, match='previous manifest preserved'):
        seed.import_staged(stage, destination)
    assert json.loads((destination / 'jp_wb_agriculture_share.json').read_text()) == original
    assert not (destination / gs.BULK_MANIFEST).exists()
    monkeypatch.setattr(seed, 'save_atomic', write)
    result = seed.import_staged(stage, destination)
    assert result['identical_records_resumed'] == 1
    assert result['existing_agriculture_merged'] == 1
    assert json.loads((destination / gs.BULK_MANIFEST).read_text())['series_count'] == 2


def test_staged_symlinks_are_not_followed(batch, tmp_path):
    stage, destination, records = batch
    path = stage / (records[0]['id'] + '.json')
    target = tmp_path / 'outside.json'; target.write_bytes(path.read_bytes())
    path.unlink(); path.symlink_to(target)  # Temporary test fixture only.
    with pytest.raises(SourceError, match='symlinked'):
        seed.import_staged(stage, destination)
    assert not list(destination.iterdir())


def test_newer_destination_values_are_not_replaced_by_stale_evidence(batch):
    stage, destination, _ = batch
    original = old_agriculture(destination); original['fetched_at'] = '2026-10-03T02:00:00+00:00'
    path = destination / 'jp_wb_agriculture_share.json'; path.write_text(json.dumps(original)); before = path.read_bytes()
    with pytest.raises(SourceError, match='newer source value'):
        seed.import_staged(stage, destination)
    assert path.read_bytes() == before


@pytest.mark.parametrize('field,value', [('footnote', 'Newer official correction'), ('source_decimal', 8)])
def test_newer_legacy_annotations_cannot_be_replaced_by_stale_evidence(batch, field, value):
    stage, destination, records = batch
    original = records[1]
    original['fetched_at'] = original['updated_at'] = '2026-10-03T02:00:00+00:00'
    original['history'][-1][field] = value
    path = destination / (original['id'] + '.json'); path.write_text(json.dumps(original)); before = path.read_bytes()
    with pytest.raises(SourceError, match='newer source value'):
        seed.import_staged(stage, destination)
    assert path.read_bytes() == before
    assert len(list(destination.iterdir())) == 1  # Entire batch rejected before any writes.


def test_unchanged_newer_destinations_retain_timestamps_and_observation_annotations(batch):
    stage, destination, records = batch
    for record in records:
        record['fetched_at'] = '2026-10-03T02:00:00+00:00'
        record['updated_at'] = '2026-10-03T02:15:00+00:00'
        record['history'][-1]['operator_note'] = 'Keep this reviewed observation'
        (destination / (record['id'] + '.json')).write_text(json.dumps(record))
    result = seed.import_staged(stage, destination)
    assert result['identical_records_resumed'] == 1
    for record in records:
        saved = json.loads((destination / (record['id'] + '.json')).read_text())
        assert saved['fetched_at'] == record['fetched_at']
        assert saved['updated_at'] == record['updated_at']
        assert saved['history'][-1]['operator_note'] == 'Keep this reviewed observation'
        assert saved['revisions'] == []


def test_existing_duplicate_revision_annotations_are_preserved_exactly():
    first = {'date': '2020-01-01', 'previous': {'price': 1}, 'replacement': {'price': 2},
             'checked_at': '2026-10-02', 'previous_fetched_at': '2026-09-01', 'annotation': 'First witness'}
    second = {**first, 'previous_fetched_at': '2026-09-02', 'annotation': 'Second witness'}
    assert seed._revision_union([first, second], [first], [second]) == [first, second]
