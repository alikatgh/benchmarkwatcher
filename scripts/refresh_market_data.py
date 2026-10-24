#!/usr/bin/env python3
"""Bounded, opt-in vendor snapshots. Reads never initiate vendor requests.

Enrollment and enablement are separate operator actions. This module does not
verify publication rights or provider billing caps and must remain disabled until
those account-specific prerequisites have been verified. No retry or pagination
follow-up is performed, and uncertain calls retain their charged reservations.
"""
# Arm the dedicated worker before third-party/project imports or stdin reads.
# SIGALRM uses its terminating OS disposition; no Python handler must run in a
# stalled DNS lookup, response-header read or buffered body read. The worker is
# bounded even if its parent is terminated before it can perform cleanup.
import os
import signal
import sys

REQUEST_SECONDS = 20
_WORKER_DEADLINE_ARMED = False


def _arm_worker_deadline():
    global _WORKER_DEADLINE_ARMED
    if _WORKER_DEADLINE_ARMED:
        return
    try:
        signal.signal(signal.SIGALRM, signal.SIG_DFL)
        signal.setitimer(signal.ITIMER_REAL, REQUEST_SECONDS)
        if signal.getitimer(signal.ITIMER_REAL)[0] <= 0:
            raise OSError('Worker timer unavailable')
    except (AttributeError, OSError, ValueError, RuntimeError):
        os._exit(1)  # Fail closed before imports/stdin/network; never expose input.
    _WORKER_DEADLINE_ARMED = True


if __name__ == '__main__' and sys.argv[1:] == ['--transport-worker']:
    _arm_worker_deadline()

import argparse
import json
import math
import sqlite3
import subprocess
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.market_data_catalog import FX, PROFILES
from scripts.vendor_data_store import (
    StoreError, begin_job, enroll_initial_provider, enroll_provider, finish_job, last_attempt, mark_failure,
    read_instrument, read_status, reserve_call, save_observations, utc,
)

ROOT = Path(__file__).resolve().parents[1]
URLS = {'marketstack': 'https://api.marketstack.com/v2/eod',
        'exchangerate_host': 'https://api.exchangerate.host/historical'}
ENV_KEYS = {'marketstack': ('MARKETSTACK_ENABLED', 'MARKETSTACK_API_KEY'),
            'exchangerate_host': ('EXCHANGERATE_HOST_ENABLED', 'EXCHANGERATE_HOST_API_KEY')}
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
RUN_SECONDS = 480


class FetchError(Exception):
    """Only predefined codes may cross the operator/report boundary."""


FAILURES = frozenset(('network_error', 'http_error', 'response_too_large', 'deadline',
                      'invalid_response', 'identity_mismatch', 'pagination_truncated', 'no_observations'))


def configured_database(data_dir=None):
    return Path(os.environ.get('MARKET_DATA_DB') or Path(data_dir or ROOT / 'data') / 'vendor-market-data.sqlite3')


def _constant(_):
    raise ValueError('Non-finite JSON number')


class _WorkerTransfer:
    """One worker-owned HTTP transfer; the parent enforces its hard lifetime.

    Socket timeouts and per-chunk checks are only additional defenses. They do
    not establish a wall-clock bound for DNS, headers or slowly dripped bodies.
    """
    def __init__(self):
        self.session = requests.Session()
        self.session.trust_env = False
        self.session.mount('https://', HTTPAdapter(max_retries=0))

    def close(self):
        self.session.close()

    def get_body(self, provider, params):
        if provider not in URLS:
            raise FetchError('invalid_response')
        deadline = time.monotonic() + REQUEST_SECONDS
        try:
            with self.session.get(URLS[provider], params=params, timeout=(3, 5),
                                  allow_redirects=False, stream=True) as response:
                if response.status_code != 200:
                    raise FetchError('http_error')
                length = response.headers.get('Content-Length')
                if length is not None:
                    try:
                        if not 0 <= int(length) <= MAX_RESPONSE_BYTES:
                            raise FetchError('response_too_large')
                    except ValueError:
                        raise FetchError('invalid_response') from None
                body = bytearray()
                for chunk in response.iter_content(chunk_size=8192):
                    if time.monotonic() > deadline:
                        raise FetchError('deadline')
                    if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise FetchError('response_too_large')
                    body.extend(chunk)
                if time.monotonic() > deadline:
                    raise FetchError('deadline')
                return bytes(body)
        except FetchError:
            raise
        except (requests.RequestException, OSError):
            raise FetchError('network_error') from None
        except (ValueError, UnicodeError, TypeError):
            raise FetchError('invalid_response') from None


def _decode_payload(body):
    try:
        payload = json.loads(body.decode('utf-8'), parse_constant=_constant)
        if not isinstance(payload, dict):
            raise FetchError('invalid_response')
        return payload
    except (ValueError, UnicodeError, TypeError, RecursionError):
        raise FetchError('invalid_response') from None


def _transport_worker():
    """Private subprocess entry point; bounded pipe protocol, never logs input.

    The key enters only through stdin. The child inherits neither credentials nor
    proxy settings. It may emit at most a 2 MiB body or one predefined error code.
    """
    _arm_worker_deadline()  # Also protects direct internal invocation in tests.
    transfer = None
    try:
        raw = sys.stdin.buffer.read(4097)
        if len(raw) > 4096:
            raise FetchError('invalid_response')
        try:
            job = json.loads(raw.decode('utf-8'))
        except (ValueError, UnicodeError):
            raise FetchError('invalid_response') from None
        if not isinstance(job, dict):
            raise FetchError('invalid_response')
        provider, params = job.get('provider'), job.get('params')
        allowed = ({'access_key', 'symbols', 'exchange', 'date_from', 'date_to', 'limit', 'offset', 'sort'}
                   if provider == 'marketstack' else {'access_key', 'date', 'currencies'})
        if (provider not in URLS or not isinstance(params, dict) or
                not set(params) <= allowed or not isinstance(params.get('access_key'), str) or
                not 1 <= len(params['access_key']) <= 512 or
                any(type(value) not in (str, int) for value in params.values())):
            raise FetchError('invalid_response')
        transfer = _WorkerTransfer()
        body = transfer.get_body(provider, params)
        sys.stdout.buffer.write(b'OK\n' + body)
        sys.stdout.buffer.flush()
        return 0
    except Exception as exc:
        code = _safe_code(exc)
        sys.stdout.buffer.write(b'ERR\n' + code.encode('ascii'))
        sys.stdout.buffer.flush()
        return 1
    finally:
        if transfer is not None:
            transfer.close()


class VendorTransport:
    """Killable per-call process bounds DNS, headers and the complete body.

    There are no worker threads to outlive a lease. Timeout or interruption kills
    and reaps the sole child before returning; the reservation remains charged.
    The child also has an independent terminating timer if the parent dies.
    Credentials travel through a pipe, never argv, inherited env or a file.
    """
    def close(self):
        # Each call owns and reaps its process; no persistent client exists.
        pass

    def get_json(self, provider, params):
        if provider not in URLS:
            raise FetchError('invalid_response')
        try:
            request = json.dumps({'provider': provider, 'params': params},
                                 ensure_ascii=True, allow_nan=False).encode('utf-8')
        except (ValueError, TypeError):
            raise FetchError('invalid_response') from None
        if len(request) > 4096:
            raise FetchError('invalid_response')
        # A fixed entry point, fixed origin allowlist and minimal environment
        # prevent command injection, proxy inheritance and accidental key copies.
        command = [sys.executable, str(Path(__file__).resolve()), '--transport-worker']
        child_env = {'PATH': os.defpath, 'PYTHONDONTWRITEBYTECODE': '1', 'LANG': 'C.UTF-8'}
        started = time.monotonic()
        try:
            child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, env=child_env, cwd=str(ROOT))
        except OSError:
            raise FetchError('network_error') from None
        try:
            remaining = max(0.001, REQUEST_SECONDS - (time.monotonic() - started))
            try:
                output, _ = child.communicate(input=request, timeout=remaining)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()  # SIGKILL interrupts DNS/socket waits; reap before returning.
                raise FetchError('deadline') from None
            if time.monotonic() - started > REQUEST_SECONDS:
                raise FetchError('deadline')
            if len(output) > MAX_RESPONSE_BYTES + 3:
                raise FetchError('response_too_large')
            if output.startswith(b'ERR\n'):
                code = output[4:].decode('ascii', errors='replace')
                raise FetchError(code if code in FAILURES else 'network_error')
            if child.returncode != 0 or not output.startswith(b'OK\n'):
                raise FetchError('network_error')
            return _decode_payload(output[3:])
        except BaseException:
            if child.poll() is None:
                child.kill()
                child.communicate()
            raise
        finally:
            for pipe in (child.stdin, child.stdout):
                if pipe is not None:
                    pipe.close()


def _number(value, *, optional=False, positive=False):
    if value is None and optional:
        return None
    if (type(value) not in (int, float) or not math.isfinite(value) or
            value < 0 or positive and value <= 0):
        raise FetchError('invalid_response')
    return float(value)


def parse_stocks(payload, instrument, start, end):
    if not isinstance(payload, dict) or 'error' in payload:
        raise FetchError('invalid_response')
    pagination, rows = payload.get('pagination'), payload.get('data')
    if not isinstance(pagination, dict) or not isinstance(rows, list) or len(rows) > 1000:
        raise FetchError('invalid_response')
    total, count, offset = (pagination.get(k) for k in ('total', 'count', 'offset'))
    if any(type(v) is not int or v < 0 for v in (total, count, offset)) or count != len(rows):
        raise FetchError('invalid_response')
    if offset != 0 or total != count:
        raise FetchError('pagination_truncated')
    if not rows:
        raise FetchError('no_observations')
    points, seen = [], set()
    for row in rows:
        if not isinstance(row, dict):
            raise FetchError('invalid_response')
        currency = row.get('price_currency')
        if (row.get('symbol') != instrument.symbol or row.get('exchange') != instrument.exchange or
                not isinstance(currency, str) or currency.lower() != instrument.currency.lower()):
            raise FetchError('identity_mismatch')
        asset = row.get('asset_type')
        if asset is not None and (not isinstance(asset, str) or
                                  asset.lower() not in ('stock', 'stocks', 'equity', 'common stock')):
            raise FetchError('identity_mismatch')
        try:
            raw_day = row['date']
            if not isinstance(raw_day, str) or len(raw_day) > 40:
                raise ValueError
            # EOD timestamps must identify a UTC calendar day, not a local-day
            # conversion which could silently shift the observed date.
            if len(raw_day) == 10:
                day = date.fromisoformat(raw_day)
            else:
                stamp = utc(raw_day)
                day = stamp.date()
        except (KeyError, ValueError, TypeError, StoreError):
            raise FetchError('invalid_response') from None
        if not start <= day <= end or day in seen:
            raise FetchError('invalid_response')
        seen.add(day)
        if 'close' in row and row['close'] is None:
            continue
        close = _number(row.get('close'), positive=True)
        point = dict(date=day.isoformat(), value=close, close=close,
                     open=_number(row.get('open'), optional=True),
                     high=_number(row.get('high'), optional=True),
                     low=_number(row.get('low'), optional=True),
                     adjusted_close=_number(row.get('adj_close'), optional=True),
                     volume=_number(row.get('volume'), optional=True))
        if (point['low'] is not None and point['high'] is not None and point['low'] > point['high'] or
                point['low'] is not None and point['low'] > close or
                point['high'] is not None and point['high'] < close):
            raise FetchError('invalid_response')
        points.append(point)
    if not points:
        raise FetchError('no_observations')
    return sorted(points, key=lambda p: p['date'])


def parse_fx(payload, target):
    """One explicitly dated USD historical snapshot; no inferred rates or dates."""
    if not isinstance(payload, dict) or payload.get('success') is not True:
        raise FetchError('invalid_response')
    if payload.get('source') != 'USD' or payload.get('historical') is not True:
        raise FetchError('identity_mismatch')
    if payload.get('date') != target.isoformat():
        raise FetchError('identity_mismatch')
    timestamp = payload.get('timestamp')
    if (type(timestamp) is not int or
            not datetime.combine(target, datetime.min.time(), tzinfo=timezone.utc).timestamp() <=
                timestamp < datetime.combine(target + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).timestamp()):
        raise FetchError('invalid_response')
    quotes = payload.get('quotes')
    if not isinstance(quotes, dict) or len(quotes) > 200:
        raise FetchError('invalid_response')
    result = {}
    for instrument in FX:
        value = _number(quotes.get(instrument.base_currency + instrument.quote_currency), positive=True)
        result[instrument.id] = [{'date': target.isoformat(), 'value': value}]
    return result


def _report(status, requests_count=0, **extra):
    return dict(status=status, network_requests=requests_count, **extra)


def _safe_code(exc):
    return str(exc) if isinstance(exc, FetchError) and str(exc) in FAILURES else 'network_error'


def _refresh_provider(database, provider, config, now, transport, clock):
    enabled_key, credential_key = ENV_KEYS[provider]
    if config.get(enabled_key) != '1':
        return _report('disabled')
    credential = config.get(credential_key)
    if not isinstance(credential, str) or not credential or len(credential) > 512:
        return _report('credential_missing')
    profile_name = config.get('MARKETSTACK_PROFILE', 'weekly-15')
    if provider == 'marketstack' and profile_name not in PROFILES:
        return _report('invalid_profile')
    profile = PROFILES[profile_name] if provider == 'marketstack' else None
    target = now.date() - timedelta(days=1)
    if profile_name == 'daily-3' and profile and target.weekday() >= 5:
        return _report('non_trading_day')
    selected = profile['stocks'] if profile else FX[:1]
    interval = profile['interval_days'] if profile else 1
    try:
        due = [item for item in selected if not (attempt := last_attempt(database, provider, item.id)) or
               (now.date() - attempt.date()).days >= interval]
        if not due:
            return _report('current')
        # This bucket is only duplicate suppression. It never resets billing.
        slot = int(now.timestamp()) // (interval * 86400)
        job_key = f'{profile_name if profile else "daily-fx"}:{slot}'
        token = begin_job(database, provider, job_key, now=now)
    except StoreError as exc:
        return _report(str(exc))
    requests_count, updated, failures = 0, 0, []
    started = clock()
    try:
        for instrument in due[:15 if profile else 1]:
            elapsed = clock() - started
            if elapsed > RUN_SECONDS:
                failures.append('deadline')
                break
            call_now = now + timedelta(seconds=elapsed)
            target = now.date() - timedelta(days=1)
            start = target - timedelta(days=364)
            if profile:
                existing = read_instrument(database, instrument.id, now=now)
                if existing and existing['latest_date']:
                    start = max(start, date.fromisoformat(existing['latest_date']) - timedelta(days=7))
            try:
                reservation = reserve_call(database, token, f'{job_key}:{instrument.id}', instrument.id,
                                           now=call_now, profile_limit=profile['period_units'] if profile else 90)
            except StoreError as exc:
                failures.append(str(exc))
                break
            requests_count += 1
            params = {'access_key': credential}
            if profile:
                params.update(symbols=instrument.symbol, exchange=instrument.exchange,
                              date_from=start.isoformat(), date_to=target.isoformat(),
                              limit=1000, offset=0, sort='ASC')
            else:
                params.update(date=target.isoformat(),
                              currencies=','.join(item.quote_currency for item in FX))
            try:
                payload = transport.get_json(provider, params)
                observations = ({instrument.id: parse_stocks(payload, instrument, start, target)}
                                if profile else parse_fx(payload, target))
                save_observations(database, token, reservation, observations,
                                  now=now + timedelta(seconds=clock() - started), refresh_days=interval)
                updated += len(observations)
            except StoreError as exc:
                failures.append(str(exc))
                break
            except Exception as exc:
                code = _safe_code(exc)
                failures.append(code)
                try:
                    mark_failure(database, token, reservation, code,
                                 now=now + timedelta(seconds=clock() - started))
                except StoreError:
                    pass  # The committed uncertain reservation remains charged.
    finally:
        try:
            finish_job(database, token, now=now + timedelta(seconds=clock() - started))
        except StoreError:
            failures.append('ledger_unavailable')
    return _report('partial' if failures and updated else 'failed' if failures else 'refreshed',
                   requests_count, updated=updated, failures=failures)


def refresh_due(database, environ=None, now=None, transport=None, *, clock=time.monotonic):
    """The existing scheduled fetch may call this; defaults perform zero calls.

    Passing a fake transport and UTC clock allows all failure paths to be tested
    without credentials or vendor requests. No database is created implicitly.
    """
    config, now = os.environ if environ is None else environ, utc(now)
    own_transport = None
    reports = {}
    try:
        # Construct no network client at all while both providers are disabled.
        if any(config.get(flag) == '1' for flag, _ in ENV_KEYS.values()):
            own_transport = VendorTransport() if transport is None else None
        active_transport = transport or own_transport
        for provider in ENV_KEYS:
            try:
                reports[provider] = _refresh_provider(database, provider, config, now, active_transport, clock)
            except (StoreError, sqlite3.Error, OSError, ValueError):
                reports[provider] = _report('ledger_unavailable')
    finally:
        if own_transport:
            own_transport.close()
    return dict(status='disabled' if all(r['status'] == 'disabled' for r in reports.values()) else 'complete',
                providers=reports, network_requests=sum(r['network_requests'] for r in reports.values()))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=configured_database())
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--status', action='store_true', help='Read local status only; no writes or requests')
    modes.add_argument('--enroll-provider', choices=tuple(ENV_KEYS), help='Enroll verified provider billing dates')
    modes.add_argument('--enroll-initial-provider', choices=tuple(ENV_KEYS),
                       help='Create one nonrenewable application grant, at most 24 hours')
    parser.add_argument('--period-start')
    parser.add_argument('--period-end')
    parser.add_argument('--application-valid-from')
    parser.add_argument('--application-expires-at')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--already-used', type=int)
    args = parser.parse_args(argv)
    period_dates = (args.period_start, args.period_end)
    application_dates = (args.application_valid_from, args.application_expires_at)
    baseline = (args.limit, args.already_used)
    if args.enroll_initial_provider:
        if any(value is not None for value in period_dates):
            parser.error('initial application grants cannot use provider period dates')
        if any(value is None for value in application_dates + baseline):
            parser.error('initial enrollment requires application validity dates, limit and already-used baseline')
    elif args.enroll_provider:
        if any(value is not None for value in application_dates):
            parser.error('provider period enrollment cannot use application grant dates')
        if any(value is None for value in period_dates + baseline):
            parser.error('enrollment requires verified period dates, limit and already-used baseline')
    elif any(value is not None for value in period_dates + application_dates + baseline):
        parser.error('enrollment options require an explicit enrollment mode')
    try:
        if args.status:
            report = read_status(args.database)
        elif args.enroll_initial_provider:
            enroll_initial_provider(args.database, args.enroll_initial_provider,
                                    args.application_valid_from, args.application_expires_at,
                                    args.limit, args.already_used)
            report = _report('application_grant_enrolled')
        elif args.enroll_provider:
            enroll_provider(args.database, args.enroll_provider, args.period_start, args.period_end,
                            args.limit, args.already_used)
            report = _report('enrolled')
        else:
            report = refresh_due(args.database)
    except StoreError as exc:
        report = _report(str(exc))
        print(json.dumps(report))
        return 1
    print(json.dumps(report))
    return 1 if any(r['status'] in ('failed', 'partial', 'ledger_unavailable')
                   for r in report.get('providers', {}).values()) else 0


if __name__ == '__main__':
    raise SystemExit(_transport_worker() if sys.argv[1:] == ['--transport-worker'] else main())
