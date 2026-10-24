"""Separate no-key reference-data cache. Public readers never create or refresh it.

Only collector-owned staging is discarded after publication. Existing public
histories are merged without retention deletion, interpolation or date changes.
"""
import json
import math
import os
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from scripts.market_data_catalog import CATALOG

APPLICATION_ID = 1113017679
SCHEMA_VERSION = 1
MAX_DATABASE_BYTES = 64 * 1024 * 1024
MAX_CURRENCIES = 64
MAX_OBSERVATIONS = 512_000
MAX_HISTORY = 20_000
PROVIDERS = ('frankfurter_ecb', 'openfigi')
# Conservative local pacing; Frankfurter publishes no numeric request quota.
REQUEST_SPACING_SECONDS = {'frankfurter_ecb': 10, 'openfigi': 3}
ECB_SOURCE_URL = 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html'
COLUMNS = {
    'fx': ('id', 'quote', 'latest_date', 'latest_value', 'coverage_start', 'coverage_end', 'observation_count', 'provider_start', 'provider_end', 'last_success'),
    'observations': ('instrument_id', 'date', 'value'),
    'identities': ('instrument_id', 'figi', 'composite_figi', 'share_class_figi', 'ticker', 'name', 'exchange_code', 'market_sector', 'security_type', 'matched_mic', 'last_success'),
    'providers': ('provider', 'next_allowed', 'last_request', 'requests', 'last_complete', 'range_start', 'range_end', 'metadata'),
    'job_lock': ('id', 'token', 'expires'),
    'chunks': ('start', 'end'),
    'staging': ('quote', 'date', 'value'),
}
SCHEMA = '''
CREATE TABLE fx (
 id TEXT PRIMARY KEY, quote TEXT NOT NULL UNIQUE, latest_date TEXT NOT NULL,
 latest_value REAL NOT NULL, coverage_start TEXT NOT NULL, coverage_end TEXT NOT NULL,
 observation_count INTEGER NOT NULL, provider_start TEXT NOT NULL,
 provider_end TEXT NOT NULL, last_success TEXT NOT NULL
);
CREATE TABLE observations (
 instrument_id TEXT NOT NULL REFERENCES fx(id), date TEXT NOT NULL, value REAL NOT NULL,
 PRIMARY KEY(instrument_id,date)
) WITHOUT ROWID;
CREATE TABLE identities (
 instrument_id TEXT PRIMARY KEY, figi TEXT NOT NULL, composite_figi TEXT, share_class_figi TEXT,
 ticker TEXT NOT NULL, name TEXT NOT NULL, exchange_code TEXT NOT NULL,
 market_sector TEXT NOT NULL, security_type TEXT NOT NULL, matched_mic TEXT NOT NULL,
 last_success TEXT NOT NULL
);
CREATE TABLE providers (
 provider TEXT PRIMARY KEY, next_allowed TEXT NOT NULL, last_request TEXT,
 requests INTEGER NOT NULL DEFAULT 0, last_complete TEXT, range_start TEXT,
 range_end TEXT, metadata TEXT
);
CREATE TABLE job_lock (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, expires TEXT NOT NULL);
CREATE TABLE chunks (start TEXT NOT NULL, end TEXT NOT NULL, PRIMARY KEY(start,end)) WITHOUT ROWID;
CREATE TABLE staging (quote TEXT NOT NULL, date TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY(quote,date)) WITHOUT ROWID;
'''


class OpenDataError(Exception):
    """A bounded nonsecret error code, never upstream content or paths."""
    def __init__(self, code, retry_after=0):
        super().__init__(code)
        self.retry_after = retry_after


def utc(value=None):
    value = datetime.now(timezone.utc) if value is None else value
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            raise OpenDataError('invalid_timestamp') from None
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise OpenDataError('invalid_timestamp')
    return value.astimezone(timezone.utc)


def day(value):
    if not isinstance(value, str) or re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value) is None:
        raise OpenDataError('invalid_date')
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise OpenDataError('invalid_date') from None


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 < value <= 1e15:
        raise OpenDataError('invalid_rate')
    return float(value)


def currency(value):
    if not isinstance(value, str) or re.fullmatch(r'[A-Z]{3}', value, flags=re.ASCII) is None or value == 'EUR':
        raise OpenDataError('invalid_currency')
    return value


def _path(path):
    path = Path(path).absolute()
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise OpenDataError('unsafe_database_path')
    if path.exists() and (not path.is_file() or path.stat().st_size > MAX_DATABASE_BYTES):
        raise OpenDataError('unsafe_database_path')
    return path


def _schema_signature():
    conn = sqlite3.connect(':memory:')
    try:
        conn.executescript(SCHEMA)
        return {name: (tuple(tuple(row[1:]) for row in conn.execute('PRAGMA table_info(' + name + ')')),
                       conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()[0])
                for name in COLUMNS}
    finally:
        conn.close()


_SCHEMA_SIGNATURE = _schema_signature()


def _schema(conn):
    if (conn.execute('PRAGMA application_id').fetchone()[0] != APPLICATION_ID or
            conn.execute('PRAGMA user_version').fetchone()[0] != SCHEMA_VERSION):
        raise OpenDataError('invalid_database_schema')
    objects = conn.execute("SELECT name,type FROM sqlite_master WHERE substr(name,1,7) != 'sqlite_'").fetchall()
    if {row[0] for row in objects if row[1] == 'table'} != set(COLUMNS) or any(row[1] != 'table' for row in objects):
        raise OpenDataError('invalid_database_schema')
    for table, expected in COLUMNS.items():
        signature = (tuple(tuple(row[1:]) for row in conn.execute('PRAGMA table_info(' + table + ')')),
                     conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()[0])
        if signature != _SCHEMA_SIGNATURE[table]:
            raise OpenDataError('invalid_database_schema')


def _connect(path, *, readonly=False):
    path = _path(path)
    if not path.exists():
        raise OpenDataError('database_missing')
    conn = None
    try:
        conn = sqlite3.connect(path.as_uri() + ('?mode=ro' if readonly else '?mode=rw'), uri=True, timeout=1)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA trusted_schema=OFF')
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA busy_timeout=250' if readonly else 'PRAGMA busy_timeout=1000')
        if readonly:
            conn.execute('PRAGMA query_only=ON')
            started = time.monotonic()
            conn.set_progress_handler(lambda: time.monotonic() - started > 1, 1000)
        _schema(conn)
        if not readonly:
            conn.execute('PRAGMA max_page_count=' + str(MAX_DATABASE_BYTES // conn.execute('PRAGMA page_size').fetchone()[0]))
        return conn
    except (sqlite3.Error, OSError):
        if conn is not None:
            conn.close()
        raise OpenDataError('database_unavailable') from None
    except BaseException:
        if conn is not None:
            conn.close()
        raise


def initialize(path):
    path = _path(path)
    if path.exists():
        with _transaction(path):
            pass
        return
    if not path.parent.is_dir():
        raise OpenDataError('database_parent_missing')
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0), 0o600)
        os.close(fd)
    except FileExistsError:
        with _transaction(path):
            pass
        return
    except OSError:
        raise OpenDataError('database_unavailable') from None
    conn = None
    try:
        conn = sqlite3.connect(path)
        conn.executescript('BEGIN IMMEDIATE;\n' + SCHEMA)
        conn.execute('PRAGMA application_id=' + str(APPLICATION_ID))
        conn.execute('PRAGMA user_version=' + str(SCHEMA_VERSION))
        conn.commit()
    except sqlite3.Error:
        if conn is not None:
            conn.rollback()
        # A failed initialization is left in place for explicit inspection;
        # never replace or delete a path that may contain user data.
        raise OpenDataError('database_unavailable') from None
    finally:
        if conn is not None:
            conn.close()


@contextmanager
def _transaction(path):
    conn = _connect(path)
    try:
        conn.execute('BEGIN IMMEDIATE')
        if conn.execute('PRAGMA quick_check').fetchone()[0] != 'ok' or conn.execute('PRAGMA foreign_key_check').fetchone():
            raise OpenDataError('database_corrupt')
        yield conn
        conn.commit()
    except sqlite3.Error:
        conn.rollback()
        raise OpenDataError('database_unavailable') from None
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def claim_job(path, now=None):
    now, token = utc(now), uuid.uuid4().hex
    with _transaction(path) as conn:
        row = conn.execute('SELECT * FROM job_lock WHERE id=1').fetchone()
        if row and utc(row['expires']) > now:
            raise OpenDataError('job_running')
        # A killed parent may leave a 20-second transport worker. The extra
        # margin prevents overlap even when the 600-second parent deadline ends.
        conn.execute('INSERT OR REPLACE INTO job_lock VALUES (1,?,?)', (token, (now + timedelta(seconds=625)).isoformat()))
    return token


def _owns(conn, token, now):
    row = conn.execute('SELECT token,expires FROM job_lock WHERE id=1').fetchone()
    if not row or row['token'] != token or utc(row['expires']) <= utc(now):
        raise OpenDataError('job_lease_lost')


def release_job(path, token):
    with _transaction(path) as conn:
        conn.execute('DELETE FROM job_lock WHERE id=1 AND token=?', (token,))


def begin_provider(path, token, provider, now=None):
    if provider not in PROVIDERS:
        raise OpenDataError('invalid_provider')
    now = utc(now)
    with _transaction(path) as conn:
        _owns(conn, token, now)
        row = conn.execute('SELECT * FROM providers WHERE provider=?', (provider,)).fetchone()
        if row and utc(row['next_allowed']) > now:
            raise OpenDataError('cooldown')
        cooldown = timedelta(days=1 if provider == 'frankfurter_ecb' else 30)
        conn.execute('INSERT INTO providers(provider,next_allowed) VALUES (?,?) ON CONFLICT(provider) '
                     'DO UPDATE SET next_allowed=excluded.next_allowed', (provider, (now + cooldown).isoformat()))


def fail_provider(path, token, provider, now=None, retry_after=0):
    now = utc(now)
    if provider not in PROVIDERS or type(retry_after) is not int or not 0 <= retry_after <= 10**12:
        raise OpenDataError('invalid_provider_state')
    try:
        until = now + timedelta(seconds=max(300, retry_after))
    except OverflowError:
        until = datetime.max.replace(tzinfo=timezone.utc)
    with _transaction(path) as conn:
        _owns(conn, token, now)
        conn.execute('UPDATE providers SET next_allowed=? WHERE provider=?', (until.isoformat(), provider))


def reserve_request(path, token, provider, now=None):
    now = utc(now)
    with _transaction(path) as conn:
        _owns(conn, token, now)
        row = conn.execute('SELECT last_request,requests FROM providers WHERE provider=?', (provider,)).fetchone()
        if row is None or type(row['requests']) is not int or row['requests'] < 0:
            raise OpenDataError('invalid_provider_state')
        spacing = REQUEST_SPACING_SECONDS[provider]
        if row['last_request'] and now - utc(row['last_request']) < timedelta(seconds=spacing):
            raise OpenDataError('request_pacing')
        conn.execute('UPDATE providers SET last_request=?,requests=requests+1 WHERE provider=?', (now.isoformat(), provider))


def prepare_fx(path, token, metadata, now=None):
    with _transaction(path) as conn:
        _owns(conn, token, utc(now))
        state = conn.execute("SELECT * FROM providers WHERE provider='frankfurter_ecb'").fetchone()
        if not state:
            raise OpenDataError('invalid_provider_state')
        saved = json.loads(state['metadata']) if state['metadata'] else None
        if saved is None and state['last_complete']:
            # Version-1 caches created before metadata retention cannot prove
            # coverage for an unpublished quote. Backfill conservatively once.
            rows = conn.execute('SELECT quote,provider_start FROM fx').fetchall()
            saved = dict(currencies=['EUR'] + [row['quote'] for row in rows],
                         start_date=min((row['provider_start'] for row in rows), default=metadata['start_date']))
        expanded = bool(saved and (set(metadata['currencies']) - set(saved['currencies']) or
                                    day(metadata['start_date']) < day(saved['start_date'])))
        if saved and day(metadata['start_date']) > day(saved['start_date']):
            raise OpenDataError('source_coverage_changed')
        if state['last_complete'] and day(metadata['end_date']) < day(state['last_complete']):
            raise OpenDataError('source_coverage_changed')
        if state['range_start'] and not expanded:
            start, end = state['range_start'], state['range_end']
            if day(start) > day(end) or day(end) > day(metadata['end_date']):
                raise OpenDataError('source_coverage_changed')
        else:
            start = metadata['start_date']
            if state['last_complete'] and not expanded:
                start = max(day(start), day(state['last_complete']) - timedelta(days=7)).isoformat()
            end = metadata['end_date']
            if expanded:
                # These markers describe the old quote set. Re-request the
                # complete bounded range, preserving staged/public observations.
                conn.execute('DELETE FROM chunks')
            conn.execute("UPDATE providers SET range_start=?,range_end=?,metadata=? WHERE provider='frankfurter_ecb'",
                         (start, end, json.dumps(metadata, sort_keys=True, separators=(',', ':'))))
        done = {(row['start'], row['end']) for row in conn.execute('SELECT * FROM chunks')}
        return start, end, done


def stage_fx_chunk(path, token, start, end, points, now=None):
    if day(start) > day(end) or not points or len(points) > MAX_CURRENCIES * 366:
        raise OpenDataError('invalid_chunk')
    validated = []
    seen = set()
    for point in points:
        quote, when, value = currency(point['quote']), point['date'], number(point['value'])
        if not day(start) <= day(when) <= day(end) or (quote, when) in seen:
            raise OpenDataError('invalid_chunk')
        seen.add((quote, when))
        validated.append((quote, when, value))
    with _transaction(path) as conn:
        _owns(conn, token, utc(now))
        state = conn.execute("SELECT range_start,range_end FROM providers WHERE provider='frankfurter_ecb'").fetchone()
        if not state or not state['range_start'] or not day(state['range_start']) <= day(start) <= day(end) <= day(state['range_end']):
            raise OpenDataError('invalid_chunk')
        conn.executemany('INSERT INTO staging VALUES (?,?,?) ON CONFLICT(quote,date) DO UPDATE SET value=excluded.value', validated)
        if (conn.execute('SELECT COUNT(DISTINCT quote) FROM staging').fetchone()[0] > MAX_CURRENCIES or
                conn.execute('SELECT (SELECT COUNT(*) FROM staging)+(SELECT COUNT(*) FROM observations)').fetchone()[0] > MAX_OBSERVATIONS):
            raise OpenDataError('storage_limit')
        conn.execute('INSERT OR IGNORE INTO chunks VALUES (?,?)', (start, end))


def year_chunks(start, end):
    start, end = day(start), day(end)
    while start <= end:
        stop = min(date(start.year, 12, 31), end)
        yield start.isoformat(), stop.isoformat()
        start = stop + timedelta(days=1)


def publish_fx(path, token, now=None):
    now = utc(now)
    with _transaction(path) as conn:
        _owns(conn, token, now)
        state = conn.execute("SELECT * FROM providers WHERE provider='frankfurter_ecb'").fetchone()
        if not state or not state['range_start']:
            raise OpenDataError('incomplete_history')
        expected = set(year_chunks(state['range_start'], state['range_end']))
        actual = {(row['start'], row['end']) for row in conn.execute('SELECT * FROM chunks')}
        if actual != expected:
            raise OpenDataError('incomplete_history')
        meta = json.loads(state['metadata'])
        if state['range_start'] == meta['start_date']:
            observed = {row[0] for row in conn.execute('SELECT DISTINCT quote FROM staging')}
            if set(meta['currencies']) - {'EUR'} - observed:
                raise OpenDataError('incomplete_history')
        quotes = {row[0] for row in conn.execute('SELECT quote FROM staging UNION SELECT quote FROM fx')}
        if not quotes or len(quotes) > MAX_CURRENCIES:
            raise OpenDataError('storage_limit')
        for quote in sorted(quotes):
            currency(quote)
            identifier = 'fx-ECB-EUR-' + quote
            conn.execute('INSERT OR IGNORE INTO fx VALUES (?,?,?,?,?,?,?,?,?,?)',
                         (identifier, quote, state['range_end'], 1.0, meta['start_date'], state['range_end'], 0,
                          meta['start_date'], state['range_end'], now.isoformat()))
            conn.execute('INSERT INTO observations SELECT ?,date,value FROM staging WHERE quote=? '
                         'ON CONFLICT(instrument_id,date) DO UPDATE SET value=excluded.value', (identifier, quote))
            summary = conn.execute('SELECT COUNT(*),MIN(date),MAX(date) FROM observations WHERE instrument_id=?', (identifier,)).fetchone()
            if not 1 <= summary[0] <= MAX_HISTORY:
                raise OpenDataError('storage_limit')
            latest = conn.execute('SELECT value FROM observations WHERE instrument_id=? AND date=?', (identifier, summary[2])).fetchone()[0]
            conn.execute('UPDATE fx SET latest_date=?,latest_value=?,coverage_start=?,coverage_end=?,observation_count=?,'
                         'provider_start=?,provider_end=?,last_success=? WHERE id=?',
                         (summary[2], latest, summary[1], summary[2], summary[0], meta['start_date'], state['range_end'], now.isoformat(), identifier))
        if conn.execute('SELECT COUNT(*) FROM observations').fetchone()[0] > MAX_OBSERVATIONS:
            raise OpenDataError('storage_limit')
        conn.execute('DELETE FROM staging')
        conn.execute('DELETE FROM chunks')
        conn.execute("UPDATE providers SET last_complete=range_end,range_start=NULL,range_end=NULL WHERE provider='frankfurter_ecb'")
        return len(quotes)


def _fx_public(row, now):
    quote = currency(row['quote'])
    if row['id'] != 'fx-ECB-EUR-' + quote or type(row['observation_count']) is not int or not 1 <= row['observation_count'] <= MAX_HISTORY:
        raise OpenDataError('invalid_cached_data')
    if not day(row['provider_start']) <= day(row['coverage_start']) <= day(row['coverage_end']) <= day(row['provider_end']):
        raise OpenDataError('invalid_cached_data')
    if row['latest_date'] != row['coverage_end'] or utc(row['last_success']) > now + timedelta(minutes=5):
        raise OpenDataError('invalid_cached_data')
    return dict(id=row['id'], kind='fx', name='Euro / ' + quote, symbol='EUR/' + quote, provider='frankfurter_ecb',
                currency=quote, base_currency='EUR', quote_currency=quote, frequency='daily', refresh_days=1,
                source_url=ECB_SOURCE_URL, source_name='European Central Bank via Frankfurter',
                latest_date=row['latest_date'], latest_value=number(row['latest_value']), last_success=row['last_success'],
                coverage_start=row['coverage_start'], coverage_end=row['coverage_end'], observation_count=row['observation_count'],
                provider_start=row['provider_start'], provider_end=row['provider_end'], history_complete=True,
                # Old observations indicate historical coverage, not an official
                # declaration that a currency has ceased publication.
                archived=False, stale=now - utc(row['last_success']) > timedelta(days=3))


def list_fx(path, now=None):
    path = _path(path)
    if not path.exists():
        return []
    conn = _connect(path, readonly=True)
    try:
        rows = conn.execute('SELECT * FROM fx ORDER BY id LIMIT ?', (MAX_CURRENCIES + 1,)).fetchall()
        if len(rows) > MAX_CURRENCIES:
            raise OpenDataError('storage_limit')
        return [_fx_public(row, utc(now)) for row in rows]
    except sqlite3.Error:
        raise OpenDataError('database_unavailable') from None
    finally:
        conn.close()


def read_fx(path, identifier, now=None):
    path = _path(path)
    if not path.exists():
        return None
    conn = _connect(path, readonly=True)
    try:
        conn.execute('BEGIN')
        row = conn.execute('SELECT * FROM fx WHERE id=?', (identifier,)).fetchone()
        if row is None:
            return None
        result = _fx_public(row, utc(now))
        points = [dict(row) for row in conn.execute('SELECT date,value FROM observations WHERE instrument_id=? ORDER BY date LIMIT ?', (identifier, MAX_HISTORY + 1))]
        if len(points) != result['observation_count']:
            raise OpenDataError('invalid_cached_data')
        for point in points:
            day(point['date'])
            number(point['value'])
        if not points or points[0]['date'] != result['coverage_start'] or points[-1] != {'date': result['latest_date'], 'value': result['latest_value']}:
            raise OpenDataError('invalid_cached_data')
        result['observations'] = points
        return result
    except sqlite3.Error:
        raise OpenDataError('database_unavailable') from None
    finally:
        conn.close()


def validate_identity(row):
    item = CATALOG.get(row.get('instrument_id'))
    if not item or item.kind != 'stock' or row.get('ticker') != item.symbol or row.get('matched_mic') != '':
        raise OpenDataError('identity_mismatch')
    for key in ('figi', 'composite_figi', 'share_class_figi'):
        value = row.get(key)
        if value is None and key != 'figi':
            continue
        if not isinstance(value, str) or re.fullmatch(r'[A-Z0-9]{12}', value, flags=re.ASCII) is None:
            raise OpenDataError('invalid_identity')
    # US is the country composite, not a particular NASDAQ/NYSE venue. The
    # The empty matched MIC prevents claiming a venue match; expose the price
    # catalog's independently reviewed MIC as a separate derived field.
    if row.get('exchange_code') != 'US' or row.get('figi') != row.get('composite_figi'):
        raise OpenDataError('identity_mismatch')
    if row.get('market_sector') != 'Equity' or row.get('security_type') != 'Common Stock':
        raise OpenDataError('identity_mismatch')
    for key, limit in (('name', 200), ('exchange_code', 20)):
        value = row.get(key)
        if not isinstance(value, str) or not 1 <= len(value) <= limit or not value.isprintable():
            raise OpenDataError('invalid_identity')
    if not isinstance(row.get('last_success'), str):
        raise OpenDataError('invalid_identity')
    utc(row['last_success'])
    result = {key: row.get(key) for key in COLUMNS['identities'] if key != 'instrument_id'}
    result.update(mapping_scope='us_composite', query_exchange_code='US', catalog_mic=item.exchange)
    return result


def publish_identities(path, token, rows, now=None):
    if not isinstance(rows, list) or not 0 <= len(rows) <= 100:
        raise OpenDataError('invalid_identity')
    seen, validated = set(), []
    for row in rows:
        validate_identity(row)
        if row['instrument_id'] in seen:
            raise OpenDataError('invalid_identity')
        seen.add(row['instrument_id'])
        validated.append(tuple(row.get(key) for key in COLUMNS['identities']))
    now = utc(now)
    with _transaction(path) as conn:
        _owns(conn, token, now)
        if conn.execute("UPDATE providers SET last_complete=? WHERE provider='openfigi'", (now.date().isoformat(),)).rowcount != 1:
            raise OpenDataError('invalid_provider_state')
        conn.executemany('INSERT INTO identities VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(instrument_id) DO UPDATE SET '
                         + ','.join(key + '=excluded.' + key for key in COLUMNS['identities'][1:]), validated)
        if conn.execute('SELECT COUNT(*) FROM identities').fetchone()[0] > 100:
            raise OpenDataError('storage_limit')
    return len(rows)


def list_identities(path):
    path = _path(path)
    if not path.exists():
        return {}
    conn = _connect(path, readonly=True)
    try:
        rows = conn.execute('SELECT * FROM identities ORDER BY instrument_id LIMIT 101').fetchall()
        if len(rows) > 100:
            raise OpenDataError('storage_limit')
        return {row['instrument_id']: validate_identity(dict(row)) for row in rows}
    except sqlite3.Error:
        raise OpenDataError('database_unavailable') from None
    finally:
        conn.close()


def read_identity(path, instrument_id):
    path = _path(path)
    if not path.exists():
        return None
    conn = _connect(path, readonly=True)
    try:
        row = conn.execute('SELECT * FROM identities WHERE instrument_id=?', (instrument_id,)).fetchone()
        return validate_identity(dict(row)) if row else None
    except sqlite3.Error:
        raise OpenDataError('database_unavailable') from None
    finally:
        conn.close()


def status(path):
    path = _path(path)
    if not path.exists():
        return dict(status='missing', network_requests=0, fx=0, identities=0, providers={})
    conn = _connect(path, readonly=True)
    try:
        return dict(status='ready', network_requests=0, fx=conn.execute('SELECT COUNT(*) FROM fx').fetchone()[0],
                    identities=conn.execute('SELECT COUNT(*) FROM identities').fetchone()[0],
                    staged_observations=conn.execute('SELECT COUNT(*) FROM staging').fetchone()[0],
                    providers={row['provider']: {key: row[key] for key in ('next_allowed', 'last_request', 'requests', 'last_complete')}
                               for row in conn.execute('SELECT * FROM providers')})
    except sqlite3.Error:
        raise OpenDataError('database_unavailable') from None
    finally:
        conn.close()
