"""Public native-client contract: SEC facts only, bounded and shared-cache backed.

No accounts, notes, saved workspace records or AI calls enter these responses.
The existing SEC downloader retains its cross-worker pacing and size limits.
"""
import hashlib
import json
import re
import time

from flask import Blueprint, current_app, jsonify, request

from app.company_financials import build_company_report
from app.extensions import limiter
from app.sec_client import SECError, connection, search_companies

bp = Blueprint('native_research', __name__, url_prefix='/api/v1/research')
TTL = 3600
LEASE = 90


def response(payload, status=200):
    result = jsonify(payload)
    result.status_code = status
    result.headers['Cache-Control'] = 'public, max-age=300' if status == 200 else 'no-store'
    if status == 200:
        result.set_etag(hashlib.sha256(result.data).hexdigest())
        result.make_conditional(request)
    elif status in (429, 503):
        result.headers['Retry-After'] = '60'
    return result


@bp.get('/companies')
@limiter.limit('30 per minute')
def search():
    query = request.args.get('q', '').strip()
    if len(query) > 100:
        return response({'error': 'Use at most 100 characters.'}, 400)
    if len(query) < 2:
        return response({'schema_version': 1, 'companies': [], 'stale': False})
    try:
        matches, stale = search_companies(query)
        return response({'schema_version': 1, 'companies': matches, 'stale': stale})
    except SECError as exc:
        return response({'error': str(exc)}, 503)


def snapshot(cik):
    """Reserve one job per issuer; global quota holds across worker processes."""
    now = time.time()
    with connection() as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS native_reports (cik TEXT PRIMARY KEY, body TEXT, fetched REAL NOT NULL DEFAULT 0, lease REAL NOT NULL DEFAULT 0)')
        conn.execute('CREATE TABLE IF NOT EXISTS native_budget (hour INTEGER PRIMARY KEY, jobs INTEGER NOT NULL)')
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT body,fetched,lease FROM native_reports WHERE cik=?', (cik,)).fetchone()
        if row and row[0] and now - row[1] < TTL:
            return json.loads(row[0])
        if row and row[2] > now:
            if row[0]:
                return dict(json.loads(row[0]), stale=True)
            raise SECError('This report is being prepared. Please try again shortly.')
        hour = int(now // 3600)
        used = conn.execute('SELECT jobs FROM native_budget WHERE hour=?', (hour,)).fetchone()
        maximum = max(1, min(500, int(current_app.config.get('NATIVE_REPORTS_PER_HOUR', 120))))
        if used and used[0] >= maximum:
            if row and row[0]:
                return dict(json.loads(row[0]), stale=True)
            raise SECError('The filing service has reached its hourly capacity. Please try again later.')
        conn.execute('INSERT INTO native_budget VALUES (?,1) ON CONFLICT(hour) DO UPDATE SET jobs=jobs+1', (hour,))
        conn.execute('INSERT INTO native_reports (cik,lease) VALUES (?,?) ON CONFLICT(cik) DO UPDATE SET lease=excluded.lease', (cik, now + LEASE))
    try:
        # Two cached SEC JSON resources; never fan out to filing HTML or AI.
        report = build_company_report(cik, fetch_documents=False)
        body = json.dumps(report, allow_nan=False)
        with connection() as conn:
            conn.execute('UPDATE native_reports SET body=?,fetched=?,lease=0 WHERE cik=?', (body, time.time(), cik))
        return report
    except Exception as exc:
        with connection() as conn:
            conn.execute('UPDATE native_reports SET lease=0 WHERE cik=?', (cik,))
        if isinstance(exc, SECError) and row and row[0]:
            return dict(json.loads(row[0]), stale=True)
        raise


@bp.get('/companies/<cik>')
@limiter.limit('6 per minute; 30 per hour')
def company(cik):
    if not re.fullmatch(r'[0-9]{10}', cik):
        return response({'error': 'Choose a company with a ten-digit SEC identifier.'}, 400)
    try:
        return response({'schema_version': 1, 'report': snapshot(cik)})
    except SECError as exc:
        return response({'error': str(exc)}, 503)
