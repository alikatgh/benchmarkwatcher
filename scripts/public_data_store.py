"""Indexed public observations, separate from accounts and private research.

Writers run offline from web requests. One source/dataset refresh is a transaction;
missing observations do not erase history and changed observations keep revisions.
"""
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import zlib
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

SOURCES = {'worldbank': 'World Bank', 'faostat': 'FAOSTAT', 'sec': 'SEC filings'}
JOURNAL_MODES = {'WAL', 'DELETE'}
MIN_FREE_BYTES = 256 * 1024 * 1024
DISK_CHECK_INTERVAL = 25000
FIELDS = ('id', 'source', 'dataset', 'entity_id', 'entity_name', 'entity_type',
          'country_code', 'indicator_id', 'indicator_name', 'unit', 'frequency',
          'source_url', 'attribution', 'license', 'metadata', 'search_text', 'checked_at')


def series_id(source, entity_id, indicator_id, unit):
    if source not in SOURCES:
        raise ValueError('Unknown public source')
    key = json.dumps([str(entity_id), str(indicator_id), str(unit)], ensure_ascii=False)
    return source + '_' + hashlib.sha256(key.encode()).hexdigest()[:32]


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'), sort_keys=True)


def encode_metadata(value, limit=64000):
    encoded = _json(value)
    if len(encoded.encode()) > limit:
        raise ValueError('Source metadata is too large')
    return zlib.compress(encoded.encode()) if len(encoded) > 1024 else encoded


def decode_metadata(value):
    if isinstance(value, bytes):
        decoder = zlib.decompressobj()
        value = decoder.decompress(value, 64001)
        if len(value) > 64000 or not decoder.eof:
            raise ValueError('Invalid compressed source metadata')
    return json.loads(value)


def _url(value):
    parts = urlsplit(value)
    if parts.scheme != 'https' or not parts.netloc or parts.username or parts.password:
        raise ValueError('Source evidence must be an HTTPS URL')
    return value


def _timestamp(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('Refresh timestamps require a timezone')
    return stamp.astimezone(timezone.utc).isoformat()


SCHEMA = """
CREATE TABLE IF NOT EXISTS series (
 id TEXT UNIQUE NOT NULL, source TEXT NOT NULL, dataset TEXT NOT NULL,
 entity_id TEXT NOT NULL, entity_name TEXT NOT NULL, entity_type TEXT NOT NULL,
 country_code TEXT NOT NULL, indicator_id TEXT NOT NULL, indicator_name TEXT NOT NULL,
 unit TEXT NOT NULL, frequency TEXT NOT NULL, source_url TEXT NOT NULL,
 attribution TEXT NOT NULL, license TEXT NOT NULL, metadata TEXT NOT NULL,
 search_text TEXT NOT NULL, checked_at TEXT NOT NULL,
 observation_count INTEGER NOT NULL DEFAULT 0, first_period TEXT, last_period TEXT, last_value REAL
);
CREATE INDEX IF NOT EXISTS library_filter ON series(source,dataset,entity_type,entity_name,id);
CREATE INDEX IF NOT EXISTS library_entity ON series(source,entity_id,indicator_id);
CREATE INDEX IF NOT EXISTS library_measure ON series(source,dataset,indicator_id);
CREATE INDEX IF NOT EXISTS library_indicator_saved ON series(source,dataset,indicator_id)
 WHERE entity_type='country' AND observation_count>0;
CREATE INDEX IF NOT EXISTS library_browse ON series(entity_type,entity_name,indicator_name,id);
CREATE INDEX IF NOT EXISTS library_summary ON series(
 entity_type,source,entity_id,entity_name,observation_count,checked_at,dataset,indicator_id
) WHERE observation_count>0;
CREATE INDEX IF NOT EXISTS library_browse_saved ON series(
 entity_type,entity_name,indicator_name,id,source,dataset,entity_id,indicator_id,observation_count
) WHERE observation_count>0;
CREATE TABLE IF NOT EXISTS observations (
 series_id TEXT NOT NULL REFERENCES series(id), period TEXT NOT NULL, value REAL NOT NULL,
 metadata TEXT NOT NULL, source_url TEXT NOT NULL, checked_at TEXT NOT NULL,
 PRIMARY KEY(series_id,period)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS observation_revisions (
 series_id TEXT NOT NULL, period TEXT NOT NULL, value REAL NOT NULL,
 metadata TEXT NOT NULL, source_url TEXT NOT NULL, checked_at TEXT NOT NULL,
 superseded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS library_revisions ON observation_revisions(series_id);
CREATE TABLE IF NOT EXISTS datasets (
 source TEXT NOT NULL, dataset TEXT NOT NULL, checked_at TEXT NOT NULL,
 series_count INTEGER NOT NULL, entity_count INTEGER NOT NULL,
 indicator_count INTEGER NOT NULL, observation_count INTEGER NOT NULL,
 PRIMARY KEY(source,dataset)
) WITHOUT ROWID;
CREATE VIRTUAL TABLE IF NOT EXISTS series_search USING fts5(search_text, content='series', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS library_search_insert AFTER INSERT ON series BEGIN
 INSERT INTO series_search(rowid,search_text) VALUES(new.rowid,new.search_text);
END;
CREATE TRIGGER IF NOT EXISTS library_search_delete AFTER DELETE ON series BEGIN
 INSERT INTO series_search(series_search,rowid,search_text) VALUES('delete',old.rowid,old.search_text);
END;
CREATE TRIGGER IF NOT EXISTS library_search_update AFTER UPDATE OF search_text ON series
 WHEN old.search_text != new.search_text BEGIN
 INSERT INTO series_search(series_search,rowid,search_text) VALUES('delete',old.rowid,old.search_text);
 INSERT INTO series_search(rowid,search_text) VALUES(new.rowid,new.search_text);
END;
"""


class LibraryWriter:
    """Bounded-memory transaction for one source dataset. Never deletes history.

    WAL remains the default. PUBLIC_LIBRARY_JOURNAL_MODE or an explicit argument
    can select DELETE for serial offline bootstrap, avoiding a WAL copy of newly
    appended pages. Existing-page updates still need rollback-journal space;
    large DELETE-mode transactions can block readers until commit or rollback.
    A 256 MiB disk reserve is checked before opening SQLite, periodically while
    writing observations, and before finalizing the dataset.
    """
    def __init__(self, db_path, source, dataset, fetched_at=None, journal_mode=None):
        if source not in SOURCES or not re.fullmatch(r'[A-Za-z0-9_-]{1,60}', dataset):
            raise ValueError('Unsupported source dataset')
        mode = journal_mode if journal_mode is not None else os.environ.get('PUBLIC_LIBRARY_JOURNAL_MODE', 'WAL')
        if not isinstance(mode, str) or mode.strip().upper() not in JOURNAL_MODES:
            raise ValueError('Public library journal mode must be WAL or DELETE')
        self.journal_mode = mode.strip().upper()
        self.path, self.source, self.dataset = Path(db_path), source, dataset
        self.stamp = _timestamp(fetched_at or datetime.now(timezone.utc).isoformat())
        self.conn = None
        self._definitions = OrderedDict()
        self._count = 0
        self._summary = {}

    def __enter__(self):
        if self.path.is_symlink() or self.path.parent.is_symlink():
            raise ValueError('Refusing a symlinked data library')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._check_disk_reserve()
        self.conn = sqlite3.connect(self.path, timeout=60)
        try:
            self.conn.execute('PRAGMA foreign_keys=ON')
            # Bound the offline writer cache at 64 MiB. SQLite's small default
            # repeatedly spills pages while maintaining indexes over millions of rows.
            self.conn.execute('PRAGMA cache_size=-65536')
            actual_mode = self.conn.execute('PRAGMA journal_mode=' + self.journal_mode).fetchone()
            if not actual_mode or actual_mode[0].upper() != self.journal_mode:
                raise ValueError('The requested public library journal mode could not be enabled')
            self.conn.executescript(SCHEMA)
            self.conn.execute('BEGIN IMMEDIATE')
            prior = self.conn.execute('SELECT checked_at FROM datasets WHERE source=? AND dataset=?',
                                      (self.source, self.dataset)).fetchone()
            if prior and prior[0] > self.stamp:
                raise ValueError('A newer dataset refresh is already saved')
            return self
        except BaseException:
            self.conn.close()
            self.conn = None
            raise

    def _check_disk_reserve(self):
        if shutil.disk_usage(self.path.parent).free < MIN_FREE_BYTES:
            raise ValueError('Insufficient disk space for public library refresh; at least 256 MiB free is required')

    def add_series(self, definition, observations):
        d = dict(definition)
        if d.get('source') != self.source or d.get('dataset') != self.dataset:
            raise ValueError('Series belongs to another source dataset')
        for key in FIELDS[:14]:
            if key == 'country_code':
                d.setdefault(key, '')
            if not isinstance(d.get(key), str) or (not d[key] and key != 'country_code') or len(d[key]) > 16000:
                raise ValueError('Invalid public series field: ' + key)
        if d['entity_type'] not in ('country', 'company') or d['id'] != series_id(
                self.source, d['entity_id'], d['indicator_id'], d['unit']):
            raise ValueError('Invalid public series identity')
        _url(d['source_url'])
        d['metadata'] = encode_metadata(d.get('metadata', {}))
        d['search_text'] = ' '.join(str(d[k]) for k in
                                   ('entity_name', 'entity_id', 'country_code', 'indicator_name', 'indicator_id', 'unit'))
        d['checked_at'] = self.stamp
        values = tuple(d[k] for k in FIELDS)
        initialized = False
        for point in observations:
            period, value = point.get('period'), point.get('value')
            if (not isinstance(period, str) or not 1 <= len(period) <= 80 or
                    not period.isprintable() or type(value) not in (int, float) or not math.isfinite(value)):
                raise ValueError('Invalid public observation')
            metadata = encode_metadata(point.get('metadata', {}), 16000)
            evidence = _url(point.get('source_url') or d['source_url'])
            if self._count % DISK_CHECK_INTERVAL == 0:
                self._check_disk_reserve()
            if not initialized:
                if self._definitions.get(d['id']) != values:
                    prior = self.conn.execute('SELECT source,dataset,entity_id,indicator_id,unit,entity_type FROM series WHERE id=?',
                                              (d['id'],)).fetchone()
                    if prior and prior != tuple(d[k] for k in ('source', 'dataset', 'entity_id', 'indicator_id', 'unit', 'entity_type')):
                        raise ValueError('Existing series identity conflicts with this refresh')
                    self.conn.execute('INSERT INTO series (' + ','.join(FIELDS) + ') VALUES (' +
                                      ','.join('?' for _ in FIELDS) + ') ON CONFLICT(id) DO UPDATE SET ' +
                                      ','.join(k + '=excluded.' + k for k in FIELDS if k != 'id'), values)
                    self._definitions[d['id']] = values
                    self._definitions.move_to_end(d['id'])
                    if len(self._definitions) > 4096:
                        self._definitions.popitem(last=False)
                initialized = True
            old = self.conn.execute('SELECT value,metadata,source_url,checked_at FROM observations WHERE series_id=? AND period=?',
                                    (d['id'], period)).fetchone()
            if old and old[:3] != (value, metadata, evidence):
                if old[3] > self.stamp:
                    raise ValueError('Refusing to overwrite a newer observation')
                self.conn.execute('INSERT INTO observation_revisions VALUES (?,?,?,?,?,?,?)',
                                  (d['id'], period, *old, self.stamp))
            self.conn.execute('INSERT INTO observations VALUES (?,?,?,?,?,?) ON CONFLICT(series_id,period) DO UPDATE SET '
                              'value=excluded.value,metadata=excluded.metadata,source_url=excluded.source_url,checked_at=excluded.checked_at',
                              (d['id'], period, value, metadata, evidence, self.stamp))
            self._count += 1

    def _finish(self):
        if not self._count:
            raise ValueError('No usable observations; previous dataset preserved')
        self._check_disk_reserve()
        self.conn.execute('''UPDATE series SET
            observation_count=(SELECT COUNT(*) FROM observations o WHERE o.series_id=series.id),
            first_period=(SELECT MIN(period) FROM observations o WHERE o.series_id=series.id),
            last_period=(SELECT MAX(period) FROM observations o WHERE o.series_id=series.id),
            last_value=(SELECT value FROM observations o WHERE o.series_id=series.id ORDER BY period DESC LIMIT 1)
            WHERE source=? AND dataset=?''', (self.source, self.dataset))
        counts = self.conn.execute('''SELECT COUNT(*),COUNT(DISTINCT entity_id),COUNT(DISTINCT indicator_id),
                                   COALESCE(SUM(observation_count),0) FROM series WHERE source=? AND dataset=?''',
                                   (self.source, self.dataset)).fetchone()
        self.conn.execute('INSERT OR REPLACE INTO datasets VALUES (?,?,?,?,?,?,?)',
                          (self.source, self.dataset, self.stamp, *counts))
        self._summary = dict(zip(('series_count', 'entity_count', 'indicator_count', 'observation_count'), counts))
        self._summary.update(source=self.source, dataset=self.dataset, checked_at=self.stamp,
                             observations_processed=self._count)

    def summary(self):
        return dict(self._summary or {'source': self.source, 'dataset': self.dataset,
                                     'observations_processed': self._count})

    def __exit__(self, exc_type, exc, traceback):
        try:
            if exc_type is None:
                self._finish()
                self.conn.commit()
            else:
                self.conn.rollback()
        except BaseException:
            self.conn.rollback()
            raise
        finally:
            self.conn.close()
            self.conn = None


def read_connection(path):
    """Read-only connection; public browsing cannot create or change the database."""
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        return None
    conn = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA query_only=ON')
    return conn
