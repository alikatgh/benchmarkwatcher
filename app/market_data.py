"""Cached daily stock and currency histories; browsing never refreshes providers."""

import math
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from flask import Blueprint, abort, current_app, render_template, request, url_for

from app.extensions import limiter
from app.global_reference import exact_value, preview_value
from scripts.vendor_data_store import StoreError, list_instruments, read_instrument

bp = Blueprint('market_data', __name__)
PAGE_SIZE = 30
HISTORY_PAGE_SIZE = 50
PROVIDER_NAMES = {'marketstack': 'Marketstack', 'exchangerate_host': 'exchangerate.host'}
IDENTIFIER = re.compile(r'(?:stock|fx)-[A-Za-z0-9][A-Za-z0-9-]{0,119}')


@bp.before_request
def _require_enabled():
    # Activation follows a separate provider/licensing review. Missing config
    # must leave every route unavailable, including when the database exists.
    if current_app.config.get('MARKET_DATA_ENABLED') is not True:
        abort(404)


def database_path():
    return Path(current_app.config.get('MARKET_DATA_DB') or
                Path(current_app.config['JSON_DATA_DIR']) / 'vendor-market-data.sqlite3')


def _text(value, fallback='', limit=300):
    return value[:limit] if isinstance(value, str) and value else fallback


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        return None


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def _source_url(value):
    if not isinstance(value, str) or len(value) > 2048 or any(ord(char) < 33 for char in value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme in {'http', 'https'} and parsed.hostname and not parsed.username and not parsed.password:
            return value
    except ValueError:
        pass
    return None


def _refresh_time(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        stamp = stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp.astimezone(timezone.utc)
        return stamp.strftime('%Y-%m-%d %H:%M:%S UTC')
    except ValueError:
        return None


def _record(raw, kind, include_history=False):
    if (not isinstance(raw, dict) or raw.get('kind') != kind or
            not isinstance(raw.get('id'), str) or not IDENTIFIER.fullmatch(raw['id'])):
        return None
    record = {key: _text(raw.get(key)) for key in
              ('id', 'name', 'symbol', 'currency', 'base_currency', 'quote_currency')}
    provider = _text(raw.get('provider'), 'Source unavailable')
    refresh_days = raw.get('refresh_days')
    record.update(provider=PROVIDER_NAMES.get(provider, provider),
                  refresh_label='Daily' if refresh_days == 1 else (
                      'Every ' + str(refresh_days) + ' days' if type(refresh_days) is int and 1 < refresh_days <= 7
                      else 'Unavailable'),
                  frequency=_text(raw.get('frequency'), 'daily', 30),
                  source_url=_source_url(raw.get('source_url')),
                  latest_value=_number(raw.get('latest_value')),
                  latest_date=_date(raw.get('latest_date')),
                  last_success=_refresh_time(raw.get('last_success')),
                  stale=raw.get('stale') is True, kind=kind)
    record['name'] = record['name'] or record['symbol'] or record['id']
    record['unit_label'] = (record['quote_currency'] + ' per 1 ' + record['base_currency']
                            if kind == 'fx' else record['currency'] + ' per share')
    if include_history:
        points = {}
        observations = raw.get('observations', [])
        if not isinstance(observations, list):
            observations = []
        for point in observations:
            if not isinstance(point, dict):
                continue
            when, value = _date(point.get('date')), _number(point.get('value'))
            if when is None or value is None:
                continue
            points[when] = dict(date=when, period=when, price=value)
        record['history'] = [points[key] for key in sorted(points)]
        if record['history']:
            latest = record['history'][-1]
            record.update(latest_value=latest['price'], latest_date=latest['date'])
        else:
            record.update(latest_value=None, latest_date=None)
    record['available'] = record['latest_value'] is not None and record['latest_date'] is not None
    return record


def _page():
    value = request.args.get('page', '1')
    if not re.fullmatch(r'[0-9]{1,5}', value) or not 1 <= int(value) <= 25000:
        abort(400, description='Choose a valid numbered page.')
    return int(value)


def _pagination(rows, size, endpoint, **values):
    total = len(rows)
    pages = max(1, (total + size - 1) // size)
    page = min(_page(), pages)
    offset = (page - 1) * size
    return dict(items=rows[offset:offset + size], total=total, page=page, pages=pages,
                start=offset + 1 if total else 0, end=min(offset + size, total),
                previous=url_for(endpoint, page=page - 1, **values) if page > 1 else None,
                next=url_for(endpoint, page=page + 1, **values) if page < pages else None)


def _unavailable():
    abort(503, description='Saved histories are temporarily unavailable. Please try again shortly.')


def _listing(kind):
    q = request.args.get('q', '').strip()
    if len(q) > 100 or q and not q.isprintable():
        abort(400, description='Choose a shorter search.')
    try:
        rows = [_record(row, kind) for row in list_instruments(database_path(), kind)]
    except (StoreError, sqlite3.Error, OSError, ValueError):
        _unavailable()
    rows = [row for row in rows if row is not None]
    total = len(rows)
    if q:
        query = q.casefold()
        rows = [row for row in rows if query in ' '.join(row[key] for key in
                ('name', 'symbol', 'provider', 'currency', 'base_currency', 'quote_currency')).casefold()]
    title = 'Stocks' if kind == 'stock' else 'Exchange rates'
    endpoint = 'market_data.stocks' if kind == 'stock' else 'market_data.exchange_rates'
    pagination = _pagination(rows, PAGE_SIZE, endpoint, q=q)
    return render_template('market_data/list.html', kind=kind, title=title, q=q,
                           total=total, pagination=pagination, reset_url=url_for(endpoint),
                           detail_endpoint='market_data.stock_detail' if kind == 'stock' else 'market_data.exchange_rate_detail',
                           exact_value=exact_value, preview_value=preview_value,
                           meta_title=title + ' · BenchmarkWatcher',
                           meta_description='Browse saved daily ' + ('share-price' if kind == 'stock' else 'currency') +
                                            ' histories with source credits and observation dates.')


def _detail(identifier, kind):
    if not IDENTIFIER.fullmatch(identifier) or not identifier.startswith('stock-' if kind == 'stock' else 'fx-'):
        abort(404)
    try:
        raw = read_instrument(database_path(), identifier)
    except (StoreError, sqlite3.Error, OSError, ValueError):
        _unavailable()
    record = _record(raw, kind, include_history=True)
    if record is None or record['id'] != identifier:
        abort(404)
    endpoint = 'market_data.stock_detail' if kind == 'stock' else 'market_data.exchange_rate_detail'
    history = _pagination(list(reversed(record['history'])), HISTORY_PAGE_SIZE, endpoint, instrument_id=identifier)
    return render_template('market_data/detail.html', record=record, kind=kind, history=history,
                           exact_value=exact_value,
                           meta_title=record['name'] + ' history · BenchmarkWatcher',
                           meta_description='Saved daily observations for ' + record['name'] +
                                            ', with historical charts, source credits and observation dates.')


@bp.get('/stocks')
@limiter.limit('60 per minute')
def stocks():
    return _listing('stock')


@bp.get('/stocks/<instrument_id>')
@limiter.limit('60 per minute')
def stock_detail(instrument_id):
    return _detail(instrument_id, 'stock')


@bp.get('/exchange-rates')
@limiter.limit('60 per minute')
def exchange_rates():
    return _listing('fx')


@bp.get('/exchange-rates/<instrument_id>')
@limiter.limit('60 per minute')
def exchange_rate_detail(instrument_id):
    return _detail(instrument_id, 'fx')
