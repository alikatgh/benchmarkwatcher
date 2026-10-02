"""Private request accounting. Never store payloads, answers or credentials here."""
import json
import re
import sqlite3
import time
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from flask import current_app, g, has_request_context, request

from app.workspace_store import db

RATE_DATE = '2026-10-02'
PROVIDER_NAMES = {'deepseek': 'DeepSeek', 'typesafe': 'TypeSafe / Jev', 'sec': 'SEC EDGAR'}
SCHEMA = """
CREATE TABLE IF NOT EXISTS usage_metadata (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS usage_preferences (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), daily_limit INTEGER NOT NULL DEFAULT 30,
 paused INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS api_usage (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
 provider TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL,
 started_at INTEGER NOT NULL, status TEXT NOT NULL, billable INTEGER NOT NULL,
 input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER,
 cost_low_nano INTEGER, cost_high_nano INTEGER, rate_date TEXT,
 source_ref TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS api_usage_owner ON api_usage(user_id, started_at);
"""


def init_usage(conn):
    conn.executescript(SCHEMA)
    conn.execute("INSERT OR IGNORE INTO usage_metadata VALUES ('tracking_started', ?)", (int(time.time()),))


def _model(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.:/-]{1,128}', value) else 'unknown'


def _count(value):
    return value if type(value) is int and 0 <= value <= 1_000_000_000 else None


def token_counts(provider, usage):
    usage = usage if isinstance(usage, dict) else {}
    incoming = _count(usage.get('input_tokens' if provider == 'typesafe' else 'prompt_tokens'))
    outgoing = _count(usage.get('output_tokens' if provider == 'typesafe' else 'completion_tokens'))
    cached = _count(usage.get('prompt_cache_hit_tokens')) if provider == 'deepseek' else None
    if cached is not None and (incoming is None or cached > incoming):
        cached = None
    return incoming, outgoing, cached


def estimate(provider, model, incoming, outgoing, cached, stamp):
    """USD in integer nanodollars, using the published rate card at request time.

    DeepSeek peak windows may be Chinese public holidays. Return a range in
    those windows instead of pretending to know the account's final tariff.
    Missing cache counts also widen the range rather than assuming cache misses.
    Unknown models and dates outside this rate card remain unpriced.
    """
    if datetime.fromtimestamp(stamp, timezone.utc).date().isoformat() < RATE_DATE:
        return None, None
    if incoming is None:
        return None, None
    def nano(value):
        return int((value * 1000).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    if provider == 'typesafe' and model in ('jev-latest', 'jev-preview', 'jev-1.13.0'):
        cost = nano(Decimal(incoming) * Decimal('0.042'))
        return cost, cost
    if provider != 'deepseek' or outgoing is None:
        return None, None
    rates = {
        'deepseek-flash': ('0.006', '0.30', '1.20'),
        'deepseek-v4-flash': ('0.006', '0.30', '1.20'),
        'deepseek-v4-flash-vision-exp': ('0.006', '0.30', '1.20'),
        'deepseek-v4-pro': ('0.044', '1.32', '3.96'),
    }.get(model)
    if rates is None:
        return None, None
    hit, miss, output = map(Decimal, rates)
    low_cached, high_cached = (incoming, 0) if cached is None else (cached, cached)
    low = low_cached * hit + (incoming - low_cached) * miss + outgoing * output
    high = high_cached * hit + (incoming - high_cached) * miss + outgoing * output
    when = datetime.fromtimestamp(stamp, timezone.utc)
    peak_window = when.weekday() < 5 and (1 <= when.hour < 4 or 6 <= when.hour < 10)
    return nano(low / 2), nano(high if peak_window else high / 2)


def preferences(user_id):
    row = db().execute('SELECT daily_limit,paused FROM usage_preferences WHERE user_id=?', (user_id,)).fetchone()
    maximum = min(60, max(1, int(current_app.config.get('WORKSPACE_DAILY_API_REQUESTS', 30))))
    return {'daily_limit': min(row['daily_limit'], maximum) if row else maximum,
            'paused': bool(row['paused']) if row else False, 'maximum': maximum}


def start_call(provider, model='', billable=True):
    """Commit a reservation BEFORE network I/O; limits hold across workers."""
    if not has_request_context() or not getattr(g, 'workspace_user', None):
        return None
    user_id = g.workspace_user['id']
    conn, now = db(), int(time.time())
    endpoint = request.endpoint
    purpose = 'Connection test' if endpoint == 'workspace.settings' else 'AI request' if billable else 'Filing data'
    try:
        conn.execute('BEGIN IMMEDIATE')
        if billable:
            limits = preferences(user_id)
            if limits['paused']:
                raise ValueError('Paid AI requests are paused in your Profile. Built-in calculations remain available.')
            used = conn.execute('SELECT count(*) FROM api_usage WHERE user_id=? AND billable=1 '
                                'AND source_ref IS NULL AND started_at>?', (user_id, now - 86400)).fetchone()[0]
            if used >= limits['daily_limit']:
                raise ValueError('Your API request limit for the last 24 hours has been reached. See Profile for usage and controls.')
        cursor = conn.execute('INSERT INTO api_usage(user_id,provider,model,purpose,started_at,status,billable) '
                              "VALUES (?,?,?,?,?,'pending',?)", (user_id, provider, _model(model), purpose, now, int(billable)))
        conn.commit()
        return cursor.lastrowid
    except (ValueError, sqlite3.Error) as exc:
        conn.rollback()
        if isinstance(exc, ValueError):
            raise
        raise ValueError('Usage tracking is unavailable. No API request was sent; please try again later.') from None


def finish_call(call_id, response=None, failed=False):
    if call_id is None:
        return
    row = db().execute('SELECT * FROM api_usage WHERE id=? AND user_id=?', (call_id, g.workspace_user['id'])).fetchone()
    if row is None:
        return
    response = response if isinstance(response, dict) else {}
    model = _model(response.get('model', row['model']))
    incoming, outgoing, cached = token_counts(row['provider'], response.get('usage'))
    low, high = (None, None) if failed else estimate(row['provider'], model, incoming, outgoing, cached, row['started_at'])
    if not row['billable']:
        low = high = 0
    try:
        with db():
            db().execute('UPDATE api_usage SET status=?,model=?,input_tokens=?,output_tokens=?,cached_tokens=?, '
                         'cost_low_nano=?,cost_high_nano=?,rate_date=? WHERE id=? AND user_id=?',
                         ('failed' if failed else 'received', model, incoming, outgoing, cached, low, high,
                          RATE_DATE if low is not None and row['billable'] else None, call_id, g.workspace_user['id']))
    except sqlite3.Error:
        # The durable reservation remains visible as unknown; never retry a paid call.
        current_app.logger.warning('API usage completion could not be recorded.')


def import_saved_usage(user_id):
    """Recover earlier saved token counts once, without inventing old prices.

    Past failures, connection tests and deleted answers cannot be reconstructed.
    New answers already have ledger entries and must never be double counted.
    """
    conn = db()
    with conn:
        marker = 'legacy_import:' + str(user_id)
        if conn.execute('SELECT 1 FROM usage_metadata WHERE name=?', (marker,)).fetchone():
            return
        cutoff = conn.execute("SELECT value FROM usage_metadata WHERE name='tracking_started'").fetchone()[0]
        for table in ('analyses', 'company_messages'):
            rows = conn.execute(f'SELECT id,provider,result,created_at FROM {table} WHERE user_id=? AND created_at<?',
                                (user_id, cutoff)).fetchall()
            for row in rows:
                try:
                    result = json.loads(row['result'])
                except (ValueError, TypeError):
                    continue
                if not isinstance(result, dict):
                    continue
                primary = result.get('provider_metadata')
                explanation = result.get('explanation_provider_metadata', {})
                explanation_usage = result.get('explanation_usage')
                if isinstance(explanation_usage, dict) and 'usage' in explanation_usage:
                    explanation = explanation_usage
                elif isinstance(explanation, dict) and (explanation_usage is not None or explanation):
                    explanation = dict(explanation, usage=explanation_usage)
                for kind, provider, meta in (('primary', row['provider'], primary), ('explanation', 'deepseek', explanation)):
                    if provider not in ('deepseek', 'typesafe') or not isinstance(meta, dict) or not meta:
                        continue
                    counts = token_counts(provider, meta.get('usage'))
                    conn.execute('INSERT OR IGNORE INTO api_usage(user_id,provider,model,purpose,started_at,status,billable,'
                                 'input_tokens,output_tokens,cached_tokens,source_ref) VALUES (?,?,?,?,?,?,1,?,?,?,?)',
                                 (user_id, provider, _model(meta.get('model')), 'Earlier saved answer', row['created_at'],
                                  'historical', *counts, f'{table}:{row["id"]}:{kind}'))
        conn.execute('INSERT OR IGNORE INTO usage_metadata VALUES (?,?)', (marker, int(time.time())))


def money(low, high=None):
    if low is None:
        return 'Unavailable'
    def amount(value):
        if value == 0:
            return '$0.00'
        if value < 1000:
            return '<$0.000001'
        return '$' + format(Decimal(value) / 1_000_000_000, ',.6f').rstrip('0').rstrip('.')
    return amount(low) if high in (None, low) else amount(low) + '–' + amount(high)


def usage_summary(user_id, period='month'):
    import_saved_usage(user_id)
    now = datetime.now(timezone.utc)
    start = int(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()) if period == 'month' else 0
    conn = db()
    aggregate = '''SELECT provider, count(*) AS requests, sum(billable) AS paid_requests,
        sum(CASE WHEN cost_low_nano IS NULL AND billable=1 THEN 1 ELSE 0 END) AS unknown_cost,
        sum(CASE WHEN input_tokens IS NULL AND billable=1 THEN 1 ELSE 0 END) AS unknown_tokens,
        sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens, sum(cached_tokens) AS cached_tokens,
        sum(CASE WHEN billable=1 OR provider='sec' THEN cost_low_nano END) AS cost_low,
        sum(CASE WHEN billable=1 OR provider='sec' THEN cost_high_nano END) AS cost_high
        FROM api_usage WHERE user_id=? AND started_at>=? GROUP BY provider ORDER BY provider'''
    providers = [dict(row) for row in conn.execute(aggregate, (user_id, start))]
    for item in providers:
        item['name'] = PROVIDER_NAMES[item['provider']]
        if not item['paid_requests']:
            item['cost_low'] = item['cost_high'] = 0
        item['cost'] = money(item['cost_low'], item['cost_high'])
    ai = [item for item in providers if item['provider'] != 'sec']
    paid = [item for item in ai if item['paid_requests']]
    known = [item for item in paid if item['cost_low'] is not None]
    low = sum(item['cost_low'] for item in known) if known or not paid else None
    high = sum(item['cost_high'] for item in known) if known or not paid else None
    recent = [dict(row) for row in conn.execute('SELECT * FROM api_usage WHERE user_id=? AND started_at>=? '
                                               'ORDER BY started_at DESC,id DESC LIMIT 40', (user_id, start))]
    for row in recent:
        row['name'] = PROVIDER_NAMES[row['provider']]
        row['date'] = datetime.fromtimestamp(row['started_at'], timezone.utc).strftime('%b %d, %H:%M')
        row['cost'] = money(row['cost_low_nano'], row['cost_high_nano'])
        row['status_label'] = {'received': 'Response received', 'failed': 'Failed · check provider',
                               'pending': 'Outcome unknown', 'historical': 'Recovered from saved answer'}[row['status']]
    stamp = conn.execute("SELECT value FROM usage_metadata WHERE name='tracking_started'").fetchone()[0]
    return {'period': period, 'period_label': now.strftime('%B %Y') if period == 'month' else 'All recorded usage',
            'providers': providers, 'recent': recent, 'cost': money(low, high),
            'requests': sum(item['requests'] for item in providers),
            'paid_requests': sum(item['paid_requests'] for item in ai),
            'tokens': sum((item['input_tokens'] or 0) + (item['output_tokens'] or 0) for item in ai),
            'unknown_cost': sum(item['unknown_cost'] for item in ai),
            'tracking_started': datetime.fromtimestamp(stamp, timezone.utc).strftime('%b %d, %Y %H:%M UTC'),
            'today_used': conn.execute('SELECT count(*) FROM api_usage WHERE user_id=? AND billable=1 AND source_ref IS NULL '
                                      'AND started_at>?', (user_id, int(time.time()) - 86400)).fetchone()[0]}
