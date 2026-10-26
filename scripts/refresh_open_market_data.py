#!/usr/bin/env python3
"""Explicit bounded no-key ECB/FIGI collection, isolated from paid vendor ledgers.

No import, reader, or --status operation performs network access. Each actual
request is reserved durably, paced, never retried, and executed by a killable
worker with its own terminating deadline. Only predefined status codes are output.
"""
import os
import signal
import sys

REQUEST_SECONDS = 20
RUN_SECONDS = 600
MAX_REQUESTS = 40
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
_WORKER_ARMED = False


def _arm_worker_deadline():
    global _WORKER_ARMED
    if _WORKER_ARMED:
        return
    try:
        signal.signal(signal.SIGALRM, signal.SIG_DFL)
        signal.setitimer(signal.ITIMER_REAL, REQUEST_SECONDS)
        if signal.getitimer(signal.ITIMER_REAL)[0] <= 0:
            raise OSError()
    except (AttributeError, OSError, ValueError, RuntimeError):
        os._exit(1)
    _WORKER_ARMED = True


if __name__ == '__main__' and sys.argv[1:] == ['--transport-worker']:
    _arm_worker_deadline()

import argparse
import json
import re
import sqlite3
import subprocess
import time
from datetime import timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.market_data_catalog import CATALOG
from scripts.open_market_store import (
    MAX_CURRENCIES, MAX_DATABASE_BYTES, REQUEST_SPACING_SECONDS, OpenDataError, begin_provider, claim_job,
    currency, day, fail_provider, initialize, number, prepare_fx, publish_fx, publish_identities,
    release_job, reserve_request, stage_fx_chunk, status, utc, validate_identity, year_chunks,
)

ROOT = Path(__file__).resolve().parents[1]
URLS = {
    'ecb_metadata': 'https://api.frankfurter.dev/v2/providers/ecb',
    'ecb_rates': 'https://api.frankfurter.dev/v2/providers/ecb/rates',
    'openfigi': 'https://api.openfigi.com/v3/mapping',
}
FAILURES = frozenset(('network_error', 'http_error', 'http_429', 'http_413', 'http_503',
    'response_too_large', 'deadline', 'invalid_response', 'identity_mismatch',
    'ambiguous_identity', 'mapping_unavailable', 'request_limit', 'cooldown', 'job_running',
    'storage_limit', 'source_coverage_changed', 'invalid_database_schema', 'database_unavailable',
    'unsafe_database_path', 'database_corrupt', 'invalid_cached_data', 'invalid_provider_state',
    'incomplete_history', 'job_lease_lost', 'request_pacing', 'invalid_chunk', 'invalid_identity',
    'invalid_date', 'invalid_currency', 'invalid_rate', 'invalid_timestamp', 'database_parent_missing'))


def _safe_code(exc):
    return str(exc) if isinstance(exc, OpenDataError) and str(exc) in FAILURES else 'network_error'


def _constant(_):
    raise ValueError()


def _decode(body):
    try:
        payload = json.loads(body.decode('utf-8'), parse_constant=_constant)
        if not isinstance(payload, (list, dict)):
            raise ValueError()
        return payload
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise OpenDataError('invalid_response') from None


def _request_shape(kind, params, payload):
    if kind == 'ecb_metadata':
        valid = params == {} and payload is None
    elif kind == 'ecb_rates':
        valid = isinstance(params, dict) and set(params) == {'base', 'from', 'to'} and params.get('base') == 'EUR' and payload is None
        if valid:
            valid = day(params['from']) <= day(params['to']) and (day(params['to']) - day(params['from'])).days <= 365
    elif kind == 'openfigi':
        valid = params == {} and isinstance(payload, list) and 1 <= len(payload) <= 10
        if valid:
            for job in payload:
                if (not isinstance(job, dict) or set(job) != {'idType', 'idValue', 'exchCode', 'currency', 'marketSecDes', 'securityType'} or
                        job['idType'] != 'TICKER' or job['currency'] != 'USD' or job['marketSecDes'] != 'Equity' or
                        job['exchCode'] != 'US' or job['securityType'] != 'Common Stock' or not isinstance(job['idValue'], str) or
                        re.fullmatch(r'[A-Z][A-Z0-9.\-]{0,14}', job['idValue'], flags=re.ASCII) is None):
                    valid = False
                    break
    else:
        valid = False
    if not valid:
        raise OpenDataError('invalid_response')


def _retry_after(value):
    if not isinstance(value, str) or len(value) > 80:
        return 0
    try:
        if value.isascii() and value.isdecimal():
            return min(10**12, int(value))
        stamp = parsedate_to_datetime(value)
        return max(0, min(10**12, int((utc(stamp) - utc()).total_seconds()) + 1))
    except (TypeError, ValueError, OverflowError, OpenDataError):
        return 0


class _WorkerTransfer:
    def __init__(self):
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.mount('https://', HTTPAdapter(max_retries=0))

    def close(self):
        self.session.close()

    def body(self, kind, params, payload):
        _request_shape(kind, params, payload)
        deadline = time.monotonic() + REQUEST_SECONDS
        try:
            method = self.session.post if kind == 'openfigi' else self.session.get
            options = dict(timeout=(3, 17), allow_redirects=False, stream=True,
                           headers={'Accept': 'application/json', 'User-Agent': 'BenchmarkWatcher-OpenData/1.0'})
            if kind == 'openfigi':
                options['json'] = payload
            elif params:
                options['params'] = params
            with method(URLS[kind], **options) as response:
                if response.status_code != 200:
                    code = 'http_' + str(response.status_code)
                    raise OpenDataError(code if code in ('http_429', 'http_413', 'http_503') else 'http_error',
                                        retry_after=_retry_after(response.headers.get('Retry-After')))
                length = response.headers.get('Content-Length')
                if length is not None:
                    try:
                        if not 0 <= int(length) <= MAX_RESPONSE_BYTES:
                            raise OpenDataError('response_too_large')
                    except ValueError:
                        raise OpenDataError('invalid_response') from None
                body = bytearray()
                for chunk in response.iter_content(chunk_size=8192):
                    if time.monotonic() > deadline:
                        raise OpenDataError('deadline')
                    if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise OpenDataError('response_too_large')
                    body.extend(chunk)
                if time.monotonic() > deadline:
                    raise OpenDataError('deadline')
                return bytes(body)
        except OpenDataError:
            raise
        except requests.Timeout:
            raise OpenDataError('deadline') from None
        except (requests.RequestException, OSError):
            raise OpenDataError('network_error') from None
        except (TypeError, ValueError, UnicodeError):
            raise OpenDataError('invalid_response') from None


def _transport_worker():
    _arm_worker_deadline()
    transfer = None
    try:
        raw = sys.stdin.buffer.read(32769)
        if len(raw) > 32768:
            raise OpenDataError('invalid_response')
        job = _decode(raw)
        if not isinstance(job, dict) or set(job) != {'kind', 'params', 'payload'}:
            raise OpenDataError('invalid_response')
        _request_shape(job['kind'], job['params'], job['payload'])
        transfer = _WorkerTransfer()
        body = transfer.body(job['kind'], job['params'], job['payload'])
        sys.stdout.buffer.write(b'OK\n' + body)
        sys.stdout.buffer.flush()
        return 0
    except Exception as exc:
        sys.stdout.buffer.write(b'ERR\n' + json.dumps(dict(code=_safe_code(exc), retry_after=getattr(exc, 'retry_after', 0))).encode('ascii'))
        sys.stdout.buffer.flush()
        return 1
    finally:
        if transfer is not None:
            transfer.close()


class OpenTransport:
    def close(self):
        pass

    def get_json(self, kind, params=None, payload=None, timeout_seconds=REQUEST_SECONDS):
        params = params or {}
        _request_shape(kind, params, payload)
        if type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= REQUEST_SECONDS:
            raise OpenDataError('deadline')
        encoded = json.dumps(dict(kind=kind, params=params, payload=payload), allow_nan=False).encode('utf-8')
        if len(encoded) > 32768:
            raise OpenDataError('invalid_response')
        child = None
        started = time.monotonic()
        try:
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--transport-worker'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                cwd=str(ROOT), env={'PATH': os.defpath, 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'})
            try:
                output, _ = child.communicate(input=encoded, timeout=max(.001, timeout_seconds - (time.monotonic() - started)))
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()
                raise OpenDataError('deadline') from None
            if time.monotonic() - started > timeout_seconds:
                raise OpenDataError('deadline')
            if len(output) > MAX_RESPONSE_BYTES + 4:
                raise OpenDataError('response_too_large')
            if output.startswith(b'ERR\n'):
                error = _decode(output[4:])
                if not isinstance(error, dict) or type(error.get('retry_after')) is not int or not 0 <= error['retry_after'] <= 10**12:
                    raise OpenDataError('network_error')
                code = error.get('code')
                raise OpenDataError(code if code in FAILURES else 'network_error', retry_after=error['retry_after'])
            if child.returncode or not output.startswith(b'OK\n'):
                raise OpenDataError('network_error')
            return _decode(output[3:])
        except OSError:
            raise OpenDataError('network_error') from None
        finally:
            if child is not None:
                if child.poll() is None:
                    child.kill()
                    child.communicate()
                for pipe in (child.stdin, child.stdout):
                    if pipe is not None:
                        pipe.close()


def parse_metadata(payload, now=None):
    if (not isinstance(payload, dict) or payload.get('key') != 'ECB' or payload.get('pivot_currency') != 'EUR' or
            payload.get('frequency') != 'daily' or not isinstance(payload.get('currencies'), list) or
            not 1 <= len(payload['currencies']) <= MAX_CURRENCIES or payload.get('unknown_currencies') != []):
        raise OpenDataError('invalid_response')
    codes = payload['currencies']
    if any(not isinstance(code, str) for code in codes) or len(set(codes)) != len(codes) or 'EUR' not in codes:
        raise OpenDataError('invalid_response')
    for code in codes:
        if code != 'EUR':
            currency(code)
    if not day(payload.get('start_date')) <= day(payload.get('end_date')) <= utc(now).date():
        raise OpenDataError('invalid_response')
    return {key: payload[key] for key in ('key', 'pivot_currency', 'frequency', 'currencies', 'unknown_currencies', 'start_date', 'end_date')}


def parse_rates(payload, start, end, metadata):
    # Upstream's daily range anchors a silent start using the provider's
    # 14-day carry-forward window, while keeping the actual observation date.
    # https://github.com/lineofflight/frankfurter/blob/main/lib/versions/v2/rate_query.rb
    first, last = day(start), day(end)
    floor = max(day(metadata['start_date']), first - timedelta(days=14))
    if not isinstance(payload, list) or not 1 <= len(payload) <= MAX_CURRENCIES * (366 + 14):
        raise OpenDataError('invalid_response')
    points, seen = [], set()
    for row in payload:
        if not isinstance(row, dict) or row.get('base') != 'EUR':
            raise OpenDataError('identity_mismatch')
        quote, when = row.get('quote'), row.get('date')
        observed = day(when)
        if quote not in metadata['currencies'] or not floor <= observed <= last or (quote, when) in seen:
            raise OpenDataError('invalid_response')
        seen.add((quote, when))
        value = number(row.get('rate'))
        if quote == 'EUR':
            # The pinned ECB endpoint includes EUR/EUR self rows. They are not
            # exchange-rate instruments; accept only the exact identity rate.
            if value != 1:
                raise OpenDataError('identity_mismatch')
            continue
        quote = currency(quote)
        if observed < first:
            # Earlier chunks already contain these observations. Excluding the
            # leading anchor never creates a fixing on a holiday/weekend.
            continue
        points.append(dict(quote=quote, date=when, value=value))
    if not points:
        raise OpenDataError('invalid_response')
    return points


def saved_stocks(path):
    """Read only saved IDs from the existing sanitized cache, never its ledger."""
    if path is None:
        return []
    path = Path(path).absolute()
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise OpenDataError('unsafe_database_path')
    if not path.exists():
        return []
    if not path.is_file() or path.stat().st_size > MAX_DATABASE_BYTES:
        raise OpenDataError('unsafe_database_path')
    conn = None
    try:
        conn = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)
        conn.execute('PRAGMA query_only=ON')
        conn.execute('PRAGMA trusted_schema=OFF')
        if (conn.execute('PRAGMA application_id').fetchone()[0] != 1113017675 or
                conn.execute('PRAGMA user_version').fetchone()[0] not in (1, 2, 3) or
                tuple(row[1] for row in conn.execute('PRAGMA table_info(instruments)')) != ('id', 'last_success', 'refresh_days')):
            raise OpenDataError('invalid_database_schema')
        rows = conn.execute("SELECT id FROM instruments WHERE id LIKE 'stock-%' ORDER BY id LIMIT 101").fetchall()
        if len(rows) > 100:
            raise OpenDataError('storage_limit')
        return [CATALOG[row[0]] for row in rows if row[0] in CATALOG and CATALOG[row[0]].kind == 'stock']
    except (sqlite3.Error, OSError):
        raise OpenDataError('database_unavailable') from None
    finally:
        if conn is not None:
            conn.close()


def parse_identities(payload, items, now=None, *, unmatched=None):
    if not isinstance(payload, list) or len(payload) != len(items):
        raise OpenDataError('invalid_response')
    result = []
    for response, item in zip(payload, items):
        # V3 documents warnings for absent FIGIs; this exact no-match warning
        # is also shown in the official OpenFIGI/api-examples issue #64.
        if response == {'warning': 'No identifier found.'}:
            if unmatched is not None:
                unmatched.append(item.id)
            continue
        if not isinstance(response, dict) or 'error' in response or 'warning' in response:
            raise OpenDataError('mapping_unavailable')
        data = response.get('data')
        if not isinstance(data, list) or not data:
            raise OpenDataError('mapping_unavailable')
        if len(data) != 1:
            raise OpenDataError('ambiguous_identity')
        row = data[0]
        if not isinstance(row, dict) or row.get('securityType2', 'Common Stock') != 'Common Stock':
            raise OpenDataError('identity_mismatch')
        identity = dict(instrument_id=item.id, figi=row.get('figi'), composite_figi=row.get('compositeFIGI'),
            share_class_figi=row.get('shareClassFIGI'), ticker=row.get('ticker'), name=row.get('name'),
            exchange_code=row.get('exchCode'), market_sector=row.get('marketSector'), security_type=row.get('securityType'),
            # No MIC is queried or verified by this US-composite request.
            matched_mic='', last_success=utc(now).isoformat())
        validate_identity(identity)
        result.append(identity)
    return result


class _Job:
    def __init__(self, path, token, now, transport, max_requests, monotonic, sleep):
        self.path, self.token, self.now, self.transport = path, token, now, transport
        self.max_requests, self.monotonic, self.sleep = max_requests, monotonic, sleep
        self.started, self.last_request, self.count = monotonic(), {}, 0

    def stamp(self):
        return self.now + timedelta(seconds=max(0, self.monotonic() - self.started))

    def request(self, provider, kind, params=None, payload=None):
        if self.count >= self.max_requests:
            raise OpenDataError('request_limit')
        spacing = REQUEST_SPACING_SECONDS[provider]
        elapsed = self.monotonic()
        if provider in self.last_request:
            wait = spacing - (elapsed - self.last_request[provider])
            if wait > 0:
                if elapsed - self.started + wait >= RUN_SECONDS:
                    raise OpenDataError('deadline')
                self.sleep(wait)
        remaining = RUN_SECONDS - (self.monotonic() - self.started)
        if remaining <= 0:
            raise OpenDataError('deadline')
        reserve_request(self.path, self.token, provider, self.stamp())
        self.count += 1
        self.last_request[provider] = self.monotonic()
        try:
            result = self.transport.get_json(kind, params=params, payload=payload, timeout_seconds=min(REQUEST_SECONDS, remaining))
        except OpenDataError:
            raise
        except Exception:
            raise OpenDataError('network_error') from None
        if self.monotonic() - self.started >= RUN_SECONDS:
            raise OpenDataError('deadline')
        return result


def refresh(database, market_cache=None, provider='all', max_requests=MAX_REQUESTS, now=None,
            transport=None, monotonic=time.monotonic, sleep=time.sleep):
    if provider not in ('all', 'frankfurter', 'openfigi') or type(max_requests) is not int or not 1 <= max_requests <= MAX_REQUESTS:
        raise OpenDataError('invalid_response')
    now = utc(now)
    # Validate saved stock IDs before creating collector state or taking a lease.
    stocks = saved_stocks(market_cache) if provider in ('all', 'openfigi') else []
    initialize(database)
    token = claim_job(database, now)
    own_transport = transport is None
    transport = transport or OpenTransport()
    job = _Job(database, token, now, transport, max_requests, monotonic, sleep)
    report = dict(status='complete', network_requests=0, providers={})
    try:
        for source in ('frankfurter_ecb', 'openfigi'):
            if provider != 'all' and source != {'frankfurter': 'frankfurter_ecb', 'openfigi': 'openfigi'}[provider]:
                continue
            info = report['providers'][source] = dict(status='complete', updated=0)
            if source == 'openfigi' and not stocks:
                info['status'] = 'no_saved_stocks'
                continue
            try:
                begin_provider(database, token, source, job.stamp())
                if source == 'frankfurter_ecb':
                    metadata = parse_metadata(job.request(source, 'ecb_metadata'), job.stamp())
                    start, end, done = prepare_fx(database, token, metadata, job.stamp())
                    for first, last in year_chunks(start, end):
                        if (first, last) in done:
                            continue
                        points = parse_rates(job.request(source, 'ecb_rates', params={'base': 'EUR', 'from': first, 'to': last}), first, last, metadata)
                        stage_fx_chunk(database, token, first, last, points, job.stamp())
                    info['updated'] = publish_fx(database, token, job.stamp())
                else:
                    identities, unmatched = [], []
                    for offset in range(0, len(stocks), 10):
                        batch = stocks[offset:offset + 10]
                        payload = [dict(idType='TICKER', idValue=item.symbol, exchCode='US', currency='USD',
                                        marketSecDes='Equity', securityType='Common Stock') for item in batch]
                        identities.extend(parse_identities(job.request(source, 'openfigi', payload=payload), batch, job.stamp(), unmatched=unmatched))
                    info['updated'] = publish_identities(database, token, identities, job.stamp())
                    info.update(unmatched_count=len(unmatched), unmatched_ids=unmatched)
            except Exception as exc:
                code = _safe_code(exc)
                if code != 'cooldown':
                    fail_provider(database, token, source, job.stamp(), getattr(exc, 'retry_after', 0))
                info.update(status='cooldown' if code == 'cooldown' else 'incomplete' if code == 'request_limit' else 'failed', error=code)
                if code != 'cooldown':
                    report['status'] = 'incomplete' if code == 'request_limit' else 'failed'
                if code in ('deadline', 'request_limit', 'job_lease_lost'):
                    break
        report['network_requests'] = job.count
        return report
    finally:
        try:
            release_job(database, token)
        finally:
            if own_transport:
                transport.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=ROOT / 'data' / 'open-market-data.sqlite3')
    parser.add_argument('--market-cache', type=Path, default=ROOT / 'data' / 'vendor-market-data.sqlite3')
    parser.add_argument('--provider', choices=('all', 'frankfurter', 'openfigi'), default='all')
    parser.add_argument('--max-requests', type=int, default=MAX_REQUESTS)
    parser.add_argument('--status', action='store_true', help='Read cache state; never initialize or fetch')
    args = parser.parse_args(argv)
    try:
        if not 1 <= args.max_requests <= MAX_REQUESTS:
            raise OpenDataError('invalid_response')
        result = status(args.database) if args.status else refresh(args.database, args.market_cache, args.provider, args.max_requests)
    except Exception as exc:
        result = dict(status='failed', error=_safe_code(exc), network_requests=0)
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 1 if result['status'] in ('failed', 'incomplete') else 0


if __name__ == '__main__':
    sys.exit(_transport_worker() if sys.argv[1:] == ['--transport-worker'] else main())
