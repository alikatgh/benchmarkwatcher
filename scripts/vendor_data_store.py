"""Dedicated vendor cache and durable quota ledger, never shared with user data.

Only explicit enrollment creates the database. Every reservation stays recorded,
including failed/uncertain calls. Explicit rolling authorization can replace an
initial grant without resetting history: at most 100 units in any rolling 32-day
window, with a separately renewed authorization lasting at most 32 days. Legacy
grants and their one-time stock recovery remain readable and never auto-renew.
The ledger must cover every process using these provider keys.
"""
import math
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from scripts.market_data_catalog import CATALOG

PROVIDERS = ('marketstack', 'exchangerate_host')
# Public observation snapshots retain their independent version-1 format.
SCHEMA_VERSION = 1
LEGACY_LEDGER_SCHEMA_VERSION = 2
LEDGER_SCHEMA_VERSION = 3
APPLICATION_ID = 1113017675
MAX_PERIOD_UNITS = 90
MAX_ROLLING_UNITS = 100
ROLLING_WINDOW = timedelta(days=32)
MAX_INITIAL_GRANT_DURATION = timedelta(hours=24)
LEASE_SECONDS = 600
INITIAL_STOCK_RECOVERY_KEY = 'initial-stock-recovery-v1'
MAX_OBSERVATIONS = 1100


class StoreError(Exception):
    """Safe bounded error code, without connection strings or vendor content."""


def utc(value=None):
    value = datetime.now(timezone.utc) if value is None else value
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            raise StoreError('invalid_timestamp') from None
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise StoreError('invalid_timestamp')
    return value.astimezone(timezone.utc)


def _provider(provider):
    if provider not in PROVIDERS:
        raise StoreError('unknown_provider')


def _check_schema(conn, *, ledger=True):
    version = conn.execute('PRAGMA user_version').fetchone()[0]
    if conn.execute('PRAGMA application_id').fetchone()[0] != APPLICATION_ID:
        raise StoreError('ledger_uninitialized')
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    cache_tables = {'instruments', 'observations'}
    if version in (LEGACY_LEDGER_SCHEMA_VERSION, LEDGER_SCHEMA_VERSION):
        expected = cache_tables | {'periods', 'jobs', 'locks', 'reservations'}
        if version == LEDGER_SCHEMA_VERSION:
            expected |= {'rolling_authorizations'}
        if tables != expected:
            raise StoreError('ledger_uninitialized')
        columns = tuple(row[1] for row in conn.execute('PRAGMA table_info(periods)'))
        if columns != ('provider', 'starts', 'ends', 'unit_limit', 'already_used', 'budget_kind'):
            raise StoreError('ledger_uninitialized')
        if version == LEDGER_SCHEMA_VERSION:
            columns = tuple(row[1] for row in conn.execute('PRAGMA table_info(rolling_authorizations)'))
            if columns != ('id', 'provider', 'valid_from', 'expires_at', 'authorized_at', 'unit_limit'):
                raise StoreError('ledger_uninitialized')
    elif ledger or version != SCHEMA_VERSION or tables != cache_tables:
        # Old private ledgers are never silently migrated or treated as public
        # snapshots. Pure version-1 observation snapshots remain readable.
        raise StoreError('ledger_uninitialized')


def _connect(path, *, create=False, readonly=False, ledger=True):
    path = Path(path)
    if path.is_symlink():
        raise StoreError('unsafe_database_path')
    if not path.is_file() and not create:
        raise StoreError('ledger_missing')
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
    try:
        conn = sqlite3.connect(path.resolve().as_uri() + ('?mode=ro' if readonly else '?mode=rw')
                               if not create else str(path), uri=not create, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA busy_timeout=5000')
        if readonly:
            conn.execute('PRAGMA query_only=ON')
        if not create:
            _check_schema(conn, ledger=ledger)
        return conn
    except (sqlite3.Error, OSError):
        if 'conn' in locals():
            conn.close()
        raise StoreError('ledger_unavailable') from None
    except BaseException:
        if 'conn' in locals():
            conn.close()
        raise


@contextmanager
def _transaction(path):
    conn = _connect(path)
    try:
        conn.execute('BEGIN IMMEDIATE')
        yield conn
        conn.commit()
    except sqlite3.Error:
        conn.rollback()
        raise StoreError('ledger_unavailable') from None
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE periods (
 provider TEXT NOT NULL, starts TEXT NOT NULL, ends TEXT NOT NULL,
 unit_limit INTEGER NOT NULL CHECK(unit_limit BETWEEN 1 AND 90),
 already_used INTEGER NOT NULL CHECK(already_used >= 0),
 budget_kind TEXT NOT NULL CHECK(budget_kind IN ('provider_period','application_grant')),
 PRIMARY KEY(provider,starts)
);
CREATE TABLE jobs (
 token TEXT PRIMARY KEY, provider TEXT NOT NULL, job_key TEXT NOT NULL,
 started TEXT NOT NULL, expires TEXT NOT NULL, finished TEXT,
 UNIQUE(provider,job_key)
);
CREATE TABLE locks (provider TEXT PRIMARY KEY, token TEXT NOT NULL);
CREATE TABLE reservations (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, period_start TEXT NOT NULL,
 job_token TEXT NOT NULL REFERENCES jobs(token), call_key TEXT NOT NULL,
 subject TEXT NOT NULL, units INTEGER NOT NULL CHECK(units > 0),
 reserved_at TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'uncertain',
 UNIQUE(provider,call_key),
 FOREIGN KEY(provider,period_start) REFERENCES periods(provider,starts)
);
CREATE INDEX reservation_period ON reservations(provider,period_start);
CREATE INDEX reservation_subject ON reservations(provider,subject,reserved_at);
"""

CACHE_SCHEMA = """
CREATE TABLE instruments (
 id TEXT PRIMARY KEY, last_success TEXT NOT NULL, refresh_days INTEGER NOT NULL
);
CREATE TABLE observations (
 instrument_id TEXT NOT NULL REFERENCES instruments(id), date TEXT NOT NULL,
 value REAL NOT NULL, open REAL, high REAL, low REAL, close REAL,
 adjusted_close REAL, volume REAL,
 PRIMARY KEY(instrument_id,date)
) WITHOUT ROWID;
"""


SCHEMA += CACHE_SCHEMA

ROLLING_SCHEMA = '''
CREATE TABLE rolling_authorizations (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL,
 valid_from TEXT NOT NULL, expires_at TEXT NOT NULL, authorized_at TEXT NOT NULL,
 unit_limit INTEGER NOT NULL CHECK(unit_limit=100),
 UNIQUE(provider,valid_from)
);
CREATE INDEX rolling_authorization_provider ON rolling_authorizations(provider,valid_from);
'''


def _rolling_authorization(conn, provider):
    if conn.execute('PRAGMA user_version').fetchone()[0] != LEDGER_SCHEMA_VERSION:
        return None
    row = conn.execute('SELECT * FROM rolling_authorizations WHERE provider=? '
                       'ORDER BY valid_from DESC LIMIT 1', (provider,)).fetchone()
    if row and (type(row['unit_limit']) is not int or row['unit_limit'] != MAX_ROLLING_UNITS or
                not timedelta(0) < utc(row['expires_at']) - utc(row['valid_from']) <= ROLLING_WINDOW or
                not utc(row['valid_from']) <= utc(row['authorized_at']) < utc(row['expires_at'])):
        raise StoreError('invalid_rolling_authorization')
    return row


def _rolling_used(conn, provider, now):
    # External baseline dates are unknown: keep every baseline charged forever.
    # In particular, renewal cannot turn an ambiguous baseline into free units.
    baseline = conn.execute('SELECT COALESCE(SUM(already_used),0) FROM periods WHERE provider=?',
                            (provider,)).fetchone()[0]
    # Parse timestamps rather than compare strings: legacy timestamps can carry
    # equivalent offsets. Future timestamps also count, failing closed on rollback.
    charged = sum(row['units'] for row in conn.execute(
        'SELECT units,reserved_at FROM reservations WHERE provider=?', (provider,))
                  if utc(row['reserved_at']) >= now - ROLLING_WINDOW)
    return baseline + charged


def _validate_rolling_source(conn):
    if (conn.execute('PRAGMA quick_check').fetchone()[0] != 'ok' or
            conn.execute('PRAGMA foreign_key_check').fetchone()):
        raise StoreError('invalid_rolling_source')
    for row in conn.execute('SELECT * FROM periods'):
        if (row['provider'] not in PROVIDERS or type(row['already_used']) is not int or
                type(row['unit_limit']) is not int or not 1 <= row['unit_limit'] <= MAX_PERIOD_UNITS or
                not 0 <= row['already_used'] <= row['unit_limit'] or
                row['budget_kind'] not in ('provider_period', 'application_grant') or
                not utc(row['starts']) < utc(row['ends'])):
            raise StoreError('invalid_rolling_source')
    for row in conn.execute('SELECT r.*,j.provider AS job_provider FROM reservations r '
                            'LEFT JOIN jobs j ON j.token=r.job_token'):
        if (row['provider'] not in PROVIDERS or row['job_provider'] != row['provider'] or
                type(row['units']) is not int or row['units'] <= 0 or
                row['subject'] not in CATALOG or CATALOG[row['subject']].provider != row['provider']):
            raise StoreError('invalid_rolling_source')
        utc(row['reserved_at'])
    for row in conn.execute('SELECT * FROM jobs'):
        if row['provider'] not in PROVIDERS or not utc(row['started']) < utc(row['expires']):
            raise StoreError('invalid_rolling_source')
        if row['finished'] is not None:
            utc(row['finished'])
    if conn.execute('SELECT 1 FROM locks l LEFT JOIN jobs j ON j.token=l.token '
                    'WHERE j.token IS NULL OR j.provider<>l.provider').fetchone():
        raise StoreError('invalid_rolling_source')


def authorize_rolling_budget(path, provider, valid_from, expires_at, *, expected_used, now=None):
    """Explicit operator conversion/renewal, with no transport or counter reset.

    A 32-day sliding window covers every possible monthly interval of at most
    31 days without claiming to know the provider's reset date. Authorization
    expires within 32 days and must be explicitly renewed. All old reservations,
    periods (including original baselines), jobs and cache records stay intact.
    A nonzero external baseline remains charged indefinitely, conservatively.
    """
    _provider(provider)
    if valid_from is None or expires_at is None:
        raise StoreError('invalid_rolling_authorization')
    valid_from, expires_at, now = utc(valid_from), utc(expires_at), utc(now)
    if (not timedelta(0) < expires_at - valid_from <= ROLLING_WINDOW or
            not valid_from <= now < expires_at or type(expected_used) is not int or
            not 0 <= expected_used <= MAX_ROLLING_UNITS):
        raise StoreError('invalid_rolling_authorization')
    with _transaction(path) as conn:
        _validate_rolling_source(conn)
        if not conn.execute('SELECT 1 FROM periods WHERE provider=?', (provider,)).fetchone():
            raise StoreError('provider_unenrolled')
        if any(utc(row['expires']) > now for row in conn.execute(
                'SELECT expires FROM jobs WHERE finished IS NULL')):
            raise StoreError('already_running')
        prior = _rolling_authorization(conn, provider)
        if prior and valid_from <= utc(prior['valid_from']):
            raise StoreError('rolling_authorization_exists')
        used = _rolling_used(conn, provider, now)
        if used != expected_used or used > MAX_ROLLING_UNITS:
            raise StoreError('rolling_usage_mismatch')
        if conn.execute('PRAGMA user_version').fetchone()[0] == LEGACY_LEDGER_SCHEMA_VERSION:
            # DDL remains in this same IMMEDIATE transaction. Never use
            # executescript (which would commit the pre-migration transaction).
            for statement in ROLLING_SCHEMA.split(';'):
                if statement.strip():
                    conn.execute(statement)
            conn.execute(f'PRAGMA user_version={LEDGER_SCHEMA_VERSION}')
        conn.execute('INSERT INTO rolling_authorizations VALUES (?,?,?,?,?,?)',
                     (uuid.uuid4().hex, provider, valid_from.isoformat(), expires_at.isoformat(),
                      now.isoformat(), MAX_ROLLING_UNITS))
        _check_schema(conn)


def enroll_provider(path, provider, starts, ends, unit_limit, already_used, *, now=None):
    """Enroll a verified provider period, unless an initial grant was ever used.

    A new provider period may only be enrolled after its predecessor has ended.
    The caller must verify the provider's actual billing dates/usage and hard cap.
    """
    _enroll(path, provider, starts, ends, unit_limit, already_used,
            'provider_period', timedelta(days=32), now=now)


def enroll_initial_provider(path, provider, valid_from, expires_at, unit_limit, already_used, *, now=None):
    """One application grant, lasting at most 24 hours, with observed account usage.

    These are application validity dates, never provider billing-period dates.
    Any prior enrollment forbids this grant. Once granted, all future enrollment
    for this provider is blocked pending a separately implemented reconciliation.
    """
    _enroll(path, provider, valid_from, expires_at, unit_limit, already_used,
            'application_grant', MAX_INITIAL_GRANT_DURATION, now=now)


def _enroll(path, provider, starts, ends, unit_limit, already_used, budget_kind, max_duration, *, now=None):
    _provider(provider)
    if starts is None or ends is None:
        raise StoreError('invalid_enrollment')
    starts, ends, now = utc(starts), utc(ends), utc(now)
    if (not timedelta(0) < ends - starts <= max_duration or
            not starts <= now < ends or type(unit_limit) is not int or
            not 1 <= unit_limit <= MAX_PERIOD_UNITS or type(already_used) is not int or
            not 0 <= already_used <= unit_limit):
        raise StoreError('invalid_enrollment')
    conn = _connect(path, create=True)
    try:
        # Inspect and initialize only after acquiring the write lock, so separate
        # first-enrollment processes cannot race schema creation or the tombstone.
        conn.execute('BEGIN IMMEDIATE')
        application_id = conn.execute('PRAGMA application_id').fetchone()[0]
        version = conn.execute('PRAGMA user_version').fetchone()[0]
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        if not tables and application_id == 0 and version == 0:
            for statement in SCHEMA.split(';'):
                if statement.strip():
                    conn.execute(statement)
            conn.execute(f'PRAGMA application_id={APPLICATION_ID}')
            conn.execute(f'PRAGMA user_version={LEGACY_LEDGER_SCHEMA_VERSION}')
        _check_schema(conn)
        if _rolling_authorization(conn, provider):
            raise StoreError('rolling_budget_requires_authorization')
        if conn.execute("SELECT 1 FROM periods WHERE provider=? AND budget_kind='application_grant'",
                        (provider,)).fetchone():
            raise StoreError('initial_grant_not_renewable')
        prior = conn.execute('SELECT starts,ends FROM periods WHERE provider=? ORDER BY starts DESC LIMIT 1',
                             (provider,)).fetchone()
        if budget_kind == 'application_grant' and prior:
            raise StoreError('provider_already_enrolled')
        if prior and (starts.isoformat() < prior['ends'] or utc(prior['ends']) > now):
            raise StoreError('period_overlap')
        conn.execute('INSERT INTO periods VALUES (?,?,?,?,?,?)',
                     (provider, starts.isoformat(), ends.isoformat(), unit_limit, already_used, budget_kind))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        raise StoreError('period_exists') from None
    except sqlite3.Error:
        conn.rollback()
        raise StoreError('ledger_unavailable') from None
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def _budget(conn, provider, now, *, require_active=True):
    row = conn.execute('SELECT * FROM periods WHERE provider=? ORDER BY starts DESC LIMIT 1',
                       (provider,)).fetchone()
    if not row:
        raise StoreError('provider_unenrolled')
    authorization = _rolling_authorization(conn, provider)
    if authorization:
        if require_active and not utc(authorization['valid_from']) <= now < utc(authorization['expires_at']):
            raise StoreError('rolling_authorization_expired')
        return dict(row, budget_kind='rolling_window', unit_limit=MAX_ROLLING_UNITS,
                    authorization_valid_from=authorization['valid_from'],
                    authorization_expires_at=authorization['expires_at']), _rolling_used(conn, provider, now)
    if require_active and not utc(row['starts']) <= now < utc(row['ends']):
        raise StoreError('application_grant_expired' if row['budget_kind'] == 'application_grant'
                         else 'period_expired')
    used = conn.execute('SELECT COALESCE(SUM(units),0) FROM reservations WHERE provider=? AND period_start=?',
                        (provider, row['starts'])).fetchone()[0] + row['already_used']
    return row, used


def _initial_stock_recovery_candidates(conn, budget, *, recovery_token=None):
    """Reconstruct the immutable original scope; recovery rows are never inputs."""
    rows = conn.execute('SELECT * FROM reservations WHERE provider=? AND period_start=? '
                        'AND (? IS NULL OR job_token<>?) ORDER BY subject',
                        ('marketstack', budget['starts'], recovery_token, recovery_token)).fetchall()
    if (len(rows) != 15 or len({row['subject'] for row in rows}) != 15 or
            any(row['units'] != 1 or row['subject'] not in CATALOG or
                CATALOG[row['subject']].provider != 'marketstack' or CATALOG[row['subject']].kind != 'stock'
                for row in rows)):
        raise StoreError('initial_recovery_scope_invalid')
    successes = [row for row in rows if row['outcome'] == 'success']
    failures = [row for row in rows if row['outcome'] in ('invalid_response', 'identity_mismatch')]
    if len(successes) != 1 or len(failures) != 14:
        raise StoreError('initial_recovery_scope_invalid')
    if not conn.execute('SELECT 1 FROM instruments i JOIN observations o ON o.instrument_id=i.id '
                        'WHERE i.id=? LIMIT 1', (successes[0]['subject'],)).fetchone():
        raise StoreError('initial_recovery_scope_invalid')
    return [dict(original_reservation_id=row['id'], subject=row['subject'],
                 call_key=f"{INITIAL_STOCK_RECOVERY_KEY}:{row['id']}") for row in failures]


def begin_initial_stock_recovery(path, *, expected_used=15, now=None):
    """Authorize one 14-ticker repair job, without resetting the original grant.

    This operator-only action performs no transport. It requires exactly the
    original 15 charged units, one cached success and 14 explicit parse/identity
    failures. All original charges and grant dates remain unchanged. Neither
    this authorization nor its lease can be renewed or resumed after expiry.
    """
    if type(expected_used) is not int or not 0 <= expected_used <= MAX_PERIOD_UNITS:
        raise StoreError('invalid_recovery_authorization')
    now = utc(now)
    with _transaction(path) as conn:
        budget, used = _budget(conn, 'marketstack', now)
        if conn.execute('SELECT 1 FROM jobs WHERE provider=? AND job_key=?',
                        ('marketstack', INITIAL_STOCK_RECOVERY_KEY)).fetchone():
            raise StoreError('initial_recovery_exists')
        if budget['budget_kind'] != 'application_grant':
            raise StoreError('initial_recovery_not_available')
        if (used != expected_used or used != 15 or budget['unit_limit'] != 15 or
                budget['already_used'] != 0):
            raise StoreError('initial_recovery_usage_mismatch')
        if conn.execute('SELECT 1 FROM jobs WHERE provider=? AND finished IS NULL AND expires>?',
                        ('marketstack', now.isoformat())).fetchone():
            raise StoreError('already_running')
        candidates = _initial_stock_recovery_candidates(conn, budget)
        new_limit = budget['unit_limit'] + len(candidates)
        if new_limit > MAX_PERIOD_UNITS:
            raise StoreError('invalid_recovery_authorization')
        changed = conn.execute('UPDATE periods SET unit_limit=? WHERE provider=? AND starts=? '
                               'AND unit_limit=15 AND already_used=0 AND budget_kind=?',
                               (new_limit, 'marketstack', budget['starts'], 'application_grant'))
        if changed.rowcount != 1:
            raise StoreError('initial_recovery_usage_mismatch')
        token = uuid.uuid4().hex
        conn.execute('INSERT INTO jobs VALUES (?,?,?,?,?,NULL)',
                     (token, 'marketstack', INITIAL_STOCK_RECOVERY_KEY, now.isoformat(),
                      (now + timedelta(seconds=LEASE_SECONDS)).isoformat()))
        conn.execute('INSERT INTO locks VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET token=excluded.token',
                     ('marketstack', token))
        return token, candidates


def begin_job(path, provider, job_key, *, now=None):
    _provider(provider)
    now = utc(now)
    if (not isinstance(job_key, str) or not 1 <= len(job_key) <= 120 or
            job_key == INITIAL_STOCK_RECOVERY_KEY):
        raise StoreError('invalid_job')
    with _transaction(path) as conn:
        budget, _ = _budget(conn, provider, now)
        if budget['budget_kind'] != 'rolling_window' and conn.execute('SELECT 1 FROM jobs WHERE provider=? AND job_key=?',
                        (provider, INITIAL_STOCK_RECOVERY_KEY)).fetchone():
            raise StoreError('initial_recovery_only')
        if conn.execute('SELECT 1 FROM jobs WHERE provider=? AND job_key=?', (provider, job_key)).fetchone():
            raise StoreError('duplicate_job')
        active = conn.execute('SELECT j.* FROM locks l JOIN jobs j ON j.token=l.token WHERE l.provider=?',
                              (provider,)).fetchone()
        if active and not active['finished'] and utc(active['expires']) > now:
            raise StoreError('already_running')
        token = uuid.uuid4().hex
        conn.execute('INSERT INTO jobs VALUES (?,?,?,?,?,NULL)',
                     (token, provider, job_key, now.isoformat(),
                      (now + timedelta(seconds=LEASE_SECONDS)).isoformat()))
        conn.execute('INSERT INTO locks VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET token=excluded.token',
                     (provider, token))
        return token


def _lease(conn, token, now, margin_seconds=0):
    row = conn.execute('SELECT j.* FROM jobs j JOIN locks l ON l.provider=j.provider AND l.token=j.token '
                       'WHERE j.token=? AND j.finished IS NULL', (token,)).fetchone()
    if not row or utc(row['expires']) <= now + timedelta(seconds=margin_seconds):
        raise StoreError('lease_lost')
    return row


def reserve_call(path, token, call_key, subject, units=1, *, now=None, profile_limit=100):
    """Commit worst-case billable units before networking; there are no refunds."""
    return _reserve_calls(path, token, [(subject, call_key, units)], now=now,
                          profile_limit=profile_limit)[subject]


def reserve_batch(path, token, calls, *, now=None, profile_limit=100):
    """Atomically charge each requested subject once; return subject -> reservation.

    ``calls`` maps each subject to its globally unique call key. Any invalid,
    duplicate or overbudget member rejects the entire batch before transport.
    Each resulting reservation fences only that subject's successful stock save.
    """
    if not isinstance(calls, dict) or not 1 <= len(calls) <= MAX_ROLLING_UNITS:
        raise StoreError('invalid_reservation')
    return _reserve_calls(path, token, [(subject, key, 1) for subject, key in calls.items()],
                          now=now, profile_limit=profile_limit)


def _reserve_calls(path, token, calls, *, now=None, profile_limit=100):
    now = utc(now)
    if (type(profile_limit) is not int or not 1 <= profile_limit <= MAX_ROLLING_UNITS or
            any(type(units) is not int or not 1 <= units <= 15 or
                not isinstance(key, str) or not 1 <= len(key) <= 180 or
                not isinstance(subject, str) or subject not in CATALOG
                for subject, key, units in calls)):
        raise StoreError('invalid_reservation')
    if len({key for _, key, _ in calls}) != len(calls):
        raise StoreError('duplicate_call')
    with _transaction(path) as conn:
        job = _lease(conn, token, now, margin_seconds=40)
        provider = job['provider']
        if any(CATALOG[subject].provider != provider for subject, _, _ in calls):
            raise StoreError('invalid_reservation')
        budget, used = _budget(conn, provider, now)
        marker = conn.execute('SELECT token FROM jobs WHERE provider=? AND job_key=?',
                              (provider, INITIAL_STOCK_RECOVERY_KEY)).fetchone()
        if marker and budget['budget_kind'] != 'rolling_window':
            if marker['token'] != token:
                raise StoreError('initial_recovery_only')
            if (budget['budget_kind'] != 'application_grant' or
                    budget['unit_limit'] != 29 or budget['already_used'] != 0):
                raise StoreError('invalid_recovery_reservation')
            candidates = _initial_stock_recovery_candidates(conn, budget, recovery_token=token)
            allowed = {(item['subject'], item['call_key']) for item in candidates}
            if any(units != 1 or (subject, key) not in allowed for subject, key, units in calls):
                raise StoreError('invalid_recovery_reservation')
        elif marker and marker['token'] == token:
            raise StoreError('initial_recovery_exists')
        if any(conn.execute('SELECT 1 FROM reservations WHERE provider=? AND call_key=?',
                            (provider, key)).fetchone() for _, key, _ in calls):
            raise StoreError('duplicate_call')
        if used + sum(units for _, _, units in calls) > min(budget['unit_limit'], profile_limit):
            raise StoreError('quota_exhausted')
        reservations = {}
        for subject, key, units in calls:
            reservation = uuid.uuid4().hex
            conn.execute('INSERT INTO reservations VALUES (?,?,?,?,?,?,?,?,?)',
                         (reservation, provider, budget['starts'], token, key, subject,
                          units, now.isoformat(), 'uncertain'))
            reservations[subject] = reservation
        return reservations


def finish_job(path, token, *, now=None):
    with _transaction(path) as conn:
        # Never remove a successor's lock, even after this lease expired.
        conn.execute('UPDATE jobs SET finished=COALESCE(finished,?) WHERE token=?',
                     (utc(now).isoformat(), token))


def mark_failure(path, token, reservation, code, *, now=None):
    if code not in ('network_error', 'http_error', 'response_too_large', 'deadline',
                    'invalid_response', 'identity_mismatch', 'pagination_truncated', 'no_observations'):
        code = 'invalid_response'
    with _transaction(path) as conn:
        _lease(conn, token, utc(now))
        conn.execute('UPDATE reservations SET outcome=? WHERE id=? AND job_token=?',
                     (code, reservation, token))


def last_attempt(path, provider, subject):
    conn = _connect(path, readonly=True)
    try:
        row = conn.execute('SELECT MAX(reserved_at) FROM reservations WHERE provider=? AND subject=?',
                           (provider, subject)).fetchone()
        return utc(row[0]) if row and row[0] else None
    except sqlite3.Error:
        raise StoreError('ledger_unavailable') from None
    finally:
        conn.close()


def save_observations(path, token, reservation, batches, *, now=None, refresh_days=1):
    """Fenced atomic cache merge. A partial/invalid batch never changes history."""
    now = utc(now)
    if (type(refresh_days) is not int or not 1 <= refresh_days <= 32 or
            not isinstance(batches, dict) or not batches or len(batches) > 200):
        raise StoreError('invalid_observations')
    validated = []
    for identifier, points in batches.items():
        item = CATALOG.get(identifier)
        if item is None or not isinstance(points, list) or not 1 <= len(points) <= 1000:
            raise StoreError('invalid_observations')
        seen = set()
        for point in points:
            if not isinstance(point, dict):
                raise StoreError('invalid_observations')
            try:
                day = date.fromisoformat(point['date'])
            except (TypeError, ValueError, KeyError):
                raise StoreError('invalid_observations') from None
            if day.isoformat() != point['date'] or day > now.date() or day in seen:
                raise StoreError('invalid_observations')
            seen.add(day)
            values = [point.get(k) for k in ('value', 'open', 'high', 'low', 'close', 'adjusted_close', 'volume')]
            if (type(values[0]) not in (int, float) or values[0] <= 0 or
                    any(v is not None and (type(v) not in (int, float) or not math.isfinite(v) or v < 0)
                        for v in values)):
                raise StoreError('invalid_observations')
            validated.append((identifier, day.isoformat(), *values))
    with _transaction(path) as conn:
        job = _lease(conn, token, now)
        reserved = conn.execute('SELECT * FROM reservations WHERE id=? AND job_token=? AND outcome=?',
                                (reservation, token, 'uncertain')).fetchone()
        if not reserved or any(CATALOG[key].provider != job['provider'] for key in batches):
            raise StoreError('invalid_reservation')
        if (job['provider'] == 'marketstack' and set(batches) != {reserved['subject']} or
                job['provider'] == 'exchangerate_host' and any(CATALOG[key].kind != 'fx' for key in batches)):
            raise StoreError('invalid_reservation')
        for identifier in batches:
            prior = conn.execute('SELECT last_success FROM instruments WHERE id=?', (identifier,)).fetchone()
            if prior and utc(prior[0]) > now:
                raise StoreError('newer_snapshot_exists')
            conn.execute('INSERT INTO instruments VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET '
                         'last_success=excluded.last_success,refresh_days=excluded.refresh_days',
                         (identifier, now.isoformat(), refresh_days))
        conn.executemany('INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(instrument_id,date) '
                         'DO UPDATE SET value=excluded.value,open=excluded.open,high=excluded.high,low=excluded.low,'
                         'close=excluded.close,adjusted_close=excluded.adjusted_close,volume=excluded.volume', validated)
        for identifier in batches:
            # This retention bound applies only to this purpose-built cache.
            conn.execute('DELETE FROM observations WHERE instrument_id=? AND date NOT IN '
                         '(SELECT date FROM observations WHERE instrument_id=? ORDER BY date DESC LIMIT ?)',
                         (identifier, identifier, MAX_OBSERVATIONS))
        conn.execute("UPDATE reservations SET outcome='success' WHERE id=?", (reservation,))


def _public(conn, row, now):
    item = CATALOG.get(row['id'])
    if not item:
        return None
    latest = conn.execute('SELECT date,value FROM observations WHERE instrument_id=? ORDER BY date DESC LIMIT 1',
                          (item.id,)).fetchone()
    return dict(id=item.id, kind=item.kind, name=item.name, symbol=item.symbol, provider=item.provider,
                currency=item.currency, base_currency=item.base_currency, quote_currency=item.quote_currency,
                frequency=item.frequency, refresh_days=row['refresh_days'], source_url=item.source_url,
                latest_value=latest['value'] if latest else None, latest_date=latest['date'] if latest else None,
                last_success=row['last_success'], stale=(not latest or
                    now - utc(row['last_success']) > timedelta(days=row['refresh_days'] + 2) or
                    now.date() - date.fromisoformat(latest['date']) > timedelta(days=row['refresh_days'] + 3)))


def list_instruments(db_path, kind, *, now=None):
    if kind not in ('stock', 'fx'):
        return []
    if not Path(db_path).is_file():
        return []
    conn = _connect(db_path, readonly=True, ledger=False)
    try:
        result = [_public(conn, row, utc(now)) for row in conn.execute('SELECT * FROM instruments ORDER BY id')]
        return [item for item in result if item and item['kind'] == kind]
    except sqlite3.Error:
        raise StoreError('cache_unavailable') from None
    finally:
        conn.close()


def read_instrument(db_path, identifier, *, now=None):
    if identifier not in CATALOG or not Path(db_path).is_file():
        return None
    conn = _connect(db_path, readonly=True, ledger=False)
    try:
        row = conn.execute('SELECT * FROM instruments WHERE id=?', (identifier,)).fetchone()
        if not row:
            return None
        result = _public(conn, row, utc(now))
        result['observations'] = [dict(row) for row in conn.execute(
            'SELECT date,value,open,high,low,close,adjusted_close,volume FROM observations '
            'WHERE instrument_id=? ORDER BY date', (identifier,))]
        return result
    except sqlite3.Error:
        raise StoreError('cache_unavailable') from None
    finally:
        conn.close()


def read_status(db_path, *, now=None):
    """Internal operator status. Never return this via public market routes."""
    if not Path(db_path).is_file():
        return {'status': 'ledger_missing', 'providers': {}, 'network_requests': 0}
    now = utc(now)
    conn = _connect(db_path, readonly=True)
    try:
        result = {}
        for provider in PROVIDERS:
            try:
                budget, used = _budget(conn, provider, now, require_active=False)
                active = utc(budget['starts']) <= now < utc(budget['ends'])
                if budget['budget_kind'] == 'rolling_window':
                    active = (utc(budget['authorization_valid_from']) <= now <
                              utc(budget['authorization_expires_at']))
                    fields = dict(status='rolling_authorized' if active else 'rolling_authorization_expired',
                                  authorization_valid_from=budget['authorization_valid_from'],
                                  authorization_expires_at=budget['authorization_expires_at'],
                                  rolling_window_days=ROLLING_WINDOW.days,
                                  window_start=(now - ROLLING_WINDOW).isoformat())
                elif budget['budget_kind'] == 'application_grant':
                    fields = dict(status='application_grant' if active else 'application_grant_expired',
                                  grant_valid_from=budget['starts'], grant_expires_at=budget['ends'])
                else:
                    fields = dict(status='enrolled' if active else 'period_expired',
                                  period_start=budget['starts'], period_end=budget['ends'])
                result[provider] = dict(fields, limit=budget['unit_limit'], used=used,
                                        remaining=max(0, budget['unit_limit'] - used))
            except StoreError as exc:
                result[provider] = {'status': str(exc)}
        return {'status': 'ready', 'providers': result, 'network_requests': 0}
    finally:
        conn.close()
