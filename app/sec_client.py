"""Bounded, cached access to public SEC data. No user data goes to the SEC."""
import difflib
import json
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

import requests
from flask import current_app


class SECError(ValueError):
    pass


@contextmanager
def connection():
    workspace_path = current_app.config.get('WORKSPACE_DB')
    path = Path(current_app.config.get('SEC_CACHE_DB') or
                (Path(workspace_path).with_name('sec-cache.sqlite3') if workspace_path else
                 Path(current_app.instance_path) / 'sec-cache.sqlite3'))
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    conn = sqlite3.connect(path, timeout=10)
    conn.execute('CREATE TABLE IF NOT EXISTS cache (url TEXT PRIMARY KEY, body BLOB, fetched REAL NOT NULL, retry REAL NOT NULL DEFAULT 0)')
    conn.execute('CREATE TABLE IF NOT EXISTS traffic (id INTEGER PRIMARY KEY, next REAL NOT NULL)')
    conn.commit()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _download(url, limit):
    # A shared clock limits all Gunicorn workers together to at most 4 requests/s.
    with connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT next FROM traffic WHERE id=1').fetchone()
        now = time.time()
        slot = max(now, row[0] if row else now)
        if slot - now > 3:
            raise SECError('The filing service is busy. Please try again shortly.')
        conn.execute('INSERT OR REPLACE INTO traffic VALUES (1, ?)', (slot + .25,))
    time.sleep(max(0, slot - time.time()))
    agent = current_app.config.get('SEC_USER_AGENT') or os.getenv('SEC_USER_AGENT') or 'BenchmarkWatcher https://benchmarkwatcher.online (research application)'
    from app.api_usage import start_call, finish_call
    try:
        call_id = start_call('sec', billable=False)
    except ValueError:
        raise SECError('Filing usage could not be recorded. Please try again shortly.') from None
    try:
        with requests.get(url, headers={'User-Agent': agent, 'Accept-Encoding': 'gzip, deflate'},
                          timeout=(5, 12), allow_redirects=False, stream=True) as response:
            if response.status_code == 404:
                raise SECError('The SEC has no supported financial data at this address.')
            if response.status_code != 200:
                raise SECError('The SEC could not serve these filings right now. Please try again later.')
            body = bytearray()
            started = time.monotonic()
            for chunk in response.iter_content(65536):
                body.extend(chunk)
                if len(body) > limit or time.monotonic() - started > 18:
                    raise SECError('This filing exceeds the supported download size or time.')
            finish_call(call_id)
            return bytes(body)
    except requests.RequestException:
        finish_call(call_id, failed=True)
        raise SECError('The SEC connection was interrupted. Please try again later.') from None
    except SECError:
        finish_call(call_id, failed=True)
        raise


def fetch(url, ttl=3600, limit=24 * 1024 * 1024):
    """Return bytes, checked timestamp, stale flag; coalesce identical requests."""
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc not in ('www.sec.gov', 'data.sec.gov') or parsed.query or parsed.fragment:
        raise SECError('Unsupported filing address.')
    deadline = time.monotonic() + 25
    while True:
        now = time.time()
        with connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT body,fetched,retry FROM cache WHERE url=?', (url,)).fetchone()
            if row and row[0] is not None and now - row[1] < ttl:
                return row[0], row[1], False
            if row and row[2] > now:
                if row[0] is not None:
                    return row[0], row[1], True
                waiting = True
            else:
                waiting = False
                conn.execute('INSERT INTO cache VALUES (?,NULL,0,?) ON CONFLICT(url) DO UPDATE SET retry=excluded.retry', (url, now + 30))
        if not waiting:
            break
        if time.monotonic() >= deadline:
            raise SECError('The filing service is still preparing this data. Please try again shortly.')
        time.sleep(.2)
    try:
        body = _download(url, limit)
        # Do not cache an HTML block/error page as successful JSON.
        if url.endswith('.json'):
            json.loads(body)
        stamp = time.time()
        with connection() as conn:
            conn.execute('UPDATE cache SET body=?,fetched=?,retry=0 WHERE url=?', (body, stamp, url))
        return body, stamp, False
    except (SECError, ValueError, UnicodeError):
        with connection() as conn:
            conn.execute('UPDATE cache SET retry=? WHERE url=?', (time.time() + 60, url))
        if row and row[0] is not None:
            return row[0], row[1], True
        raise SECError('SEC data is temporarily unavailable. Try again shortly; no figures have been guessed.') from None


def json_data(url, ttl=3600):
    body, stamp, stale = fetch(url, ttl)
    return json.loads(body), stamp, stale


def companies():
    data, _, stale = json_data('https://www.sec.gov/files/company_tickers_exchange.json', 86400)
    if not isinstance(data, dict) or not isinstance(data.get('data'), list):
        raise SECError('The SEC company directory could not be read.')
    fields = data.get('fields', [])
    entries = []
    for values in data['data']:
        item = dict(zip(fields, values))
        if isinstance(item.get('cik'), int) and item.get('ticker') and item.get('name'):
            entries.append({'cik': str(item['cik']).zfill(10), 'ticker': str(item['ticker'])[:32],
                            'name': str(item['name'])[:200], 'exchange': str(item.get('exchange') or 'Other')[:60]})
    return entries, stale


def search_companies(query):
    text = re.sub(r'\s+', ' ', query.strip())[:100]
    if not text:
        return [], False
    entries, stale = companies()
    key = text.upper()
    if ':' in key:
        exchange, key = key.split(':', 1)
        entries = [e for e in entries if exchange in e['exchange'].upper()]
    scored = []
    for entry in entries:
        ticker, name = entry['ticker'].upper(), entry['name'].upper()
        exact = key == ticker or key == name or (key.isdigit() and key.zfill(10) == entry['cik'])
        score = 100 if exact else 80 if ticker.startswith(key) else 70 if name.startswith(key) else 60 if key in name else 0
        if not score and 2 <= len(key) <= 8:
            ratio = difflib.SequenceMatcher(None, key, ticker).ratio()
            if ratio >= .7:
                score = ratio * 50
        if score:
            scored.append((score, dict(entry, exact=exact, suggested=score < 60)))
    scored.sort(key=lambda pair: (-pair[0], len(pair[1]['name']), pair[1]['ticker']))
    return [entry for _, entry in scored[:12]], stale


def filing_url(cik, accession, document=None):
    if not re.fullmatch(r'\d{1,10}', str(cik)) or not re.fullmatch(r'\d{10}-\d{2}-\d{6}', accession or ''):
        return ''
    base = f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace("-", "")}/'
    if document and re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:htm|html)', document) and '..' not in document:
        return base + document
    return base + accession + '-index.htm'


def issuer_data(cik):
    if not re.fullmatch(r'\d{10}', cik):
        raise SECError('Choose a company from the SEC directory.')
    submissions, checked, stale = json_data(f'https://data.sec.gov/submissions/CIK{cik}.json')
    if str(submissions.get('cik', '')).zfill(10) != cik:
        raise SECError('The filing identity did not match the selected company.')
    facts, facts_checked, facts_stale = json_data(f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json')
    if str(facts.get('cik', '')).zfill(10) != cik or not isinstance(facts.get('facts'), dict):
        raise SECError('The financial data did not match the selected company.')
    recent = submissions.get('filings', {}).get('recent', {})
    filings = []
    for index, accession in enumerate(recent.get('accessionNumber', [])):
        item = {key: values[index] for key, values in recent.items() if isinstance(values, list) and index < len(values)}
        if item.get('form') not in ('10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '40-F', '40-F/A'):
            continue
        item['url'] = filing_url(cik, accession, item.get('primaryDocument'))
        if item['url']:
            filings.append(item)
    return submissions, facts, filings, min(checked, facts_checked), stale or facts_stale
