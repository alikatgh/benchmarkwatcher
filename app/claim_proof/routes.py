"""Bounded filing proofs with an optional, loopback-only Meta adapter."""

import json
import secrets
from urllib.parse import urlsplit
from uuid import UUID

from flask import Blueprint, current_app, jsonify, render_template, request, session
from werkzeug.exceptions import RequestEntityTooLarge

from app.extensions import limiter
from .audit import CLAIMS, _adjustment, audit_claim
from .engine import CalculationError, exact
from .meta import MetaError, safe_status
from .filings import (
    COMPANIES, DEFAULT_COMPANIES, DEFAULT_MEASUREMENT_NOTE, load_engines,
    select_companies,
)


bp = Blueprint('claim_proof', __name__)
MAX_REQUEST_BYTES = 8 * 1024
CSRF_SESSION_KEY = 'claim_proof_csrf'
META_ENDPOINTS = frozenset({'claim_proof.meta_status', 'claim_proof.investigate'})
LOCAL_META_HOSTS = frozenset({'127.0.0.1:5059', 'localhost:5059', '[::1]:5059'})


def _error(message, status):
    if request.endpoint in META_ENDPOINTS:
        return jsonify(error=message, mode='meta', provider_requests=0), status
    return jsonify(error=message), status


def _origin(value):
    """Normalize only HTTP origins, rejecting credentials, paths and null."""
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            return None
        return (parsed.scheme, parsed.hostname,
                parsed.port or (443 if parsed.scheme == 'https' else 80))
    except (ValueError, TypeError):
        return None


@bp.before_request
def protect():
    # Reserve one sentinel byte for a terminated/chunked stream. Werkzeug can
    # otherwise truncate a read at its limit and leave trailing bytes unseen.
    # The explicit length/read checks still reject every body over 8 KiB.
    request.max_content_length = MAX_REQUEST_BYTES + 1
    if request.endpoint in META_ENDPOINTS:
        # Read the original peer if some outer application enabled ProxyFix.
        # Forwarded headers can never turn a remote caller into a local one.
        original = request.environ.get('werkzeug.proxy_fix.orig', {})
        peer = original.get('REMOTE_ADDR', request.environ.get('REMOTE_ADDR'))
        if (peer not in {'127.0.0.1', '::1'}
                or request.environ.get('HTTP_HOST') not in LOCAL_META_HOSTS):
            return _error('Meta research is available only in the local preview.', 403)
    if request.method != 'POST':
        return None
    if request.content_length is not None and request.content_length > MAX_REQUEST_BYTES:
        return _error('Use a request body of at most 8 KiB.', 413)
    supplied_origin = _origin(request.headers.get('Origin', ''))
    if (supplied_origin is None or supplied_origin != _origin(request.host_url)
            or request.headers.get('Sec-Fetch-Site') in ('cross-site', 'same-site')):
        return _error('Submit this request from the claim-proof page on this site.', 403)
    expected = session.get(CSRF_SESSION_KEY)
    supplied = request.headers.get('X-CSRF-Token', '')
    if (not isinstance(expected, str) or not isinstance(supplied, str)
            or len(supplied) > 128
            or not secrets.compare_digest(supplied.encode(), expected.encode())):
        return _error('The form expired. Reload the page and try again.', 403)
    return None


@bp.after_request
def private_response(response):
    # The page embeds a session-bound token; never share its cached response.
    response.headers['Cache-Control'] = 'no-store, private'
    response.vary.add('Cookie')
    return response


@bp.errorhandler(RequestEntityTooLarge)
def too_large(error):
    return _error('Use a request body of at most 8 KiB.', 413)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON field.')
        result[key] = value
    return result


def _nonfinite(value):
    raise ValueError('Nonfinite JSON value.')


def _payload(*, meta=False):
    if request.mimetype != 'application/json':
        return None, _error('Use an application/json request body.', 415)
    # Read at most the accepted body plus one sentinel byte before parsing.
    # Werkzeug retains its safe empty-stream fallback for unterminated bodies
    # without Content-Length, rather than reading until an untrusted EOF.
    raw = request.stream.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        return None, _error('Use a request body of at most 8 KiB.', 413)
    try:
        payload = json.loads(raw, object_pairs_hook=_unique_object, parse_constant=_nonfinite)
    except (ValueError, UnicodeError, RecursionError):
        return None, _error('Use one valid JSON object with distinct fields.', 400)
    required = {'companies', 'claim_id', 'adjustment'}
    if meta:
        required |= {'question', 'basis', 'request_id'}
    if not isinstance(payload, dict) or set(payload) != required:
        message = ('Provide exactly companies, claim_id, adjustment, question, basis and request_id.'
                   if meta else 'Provide exactly companies, claim_id and adjustment.')
        return None, _error(message, 400)
    try:
        if not isinstance(payload['companies'], list):
            raise CalculationError('Choose one to ten distinct verified company IDs.')
        payload['companies'] = select_companies(payload['companies'])
        claim_id = payload['claim_id']
        if not isinstance(claim_id, str) or claim_id not in CLAIMS:
            raise CalculationError('Select cash_keeps_pace or profit_keeps_pace.')
        adjustment = _adjustment(payload['adjustment'])
        if claim_id == 'profit_keeps_pace' and adjustment != 0:
            raise CalculationError('Cash PP&E sensitivity applies only to the cash_keeps_pace claim.')
        if meta:
            if len(payload['companies']) > 3:
                raise CalculationError('Meta investigates up to three companies; test the full library with Test claim instead.')
            question = payload['question']
            if not isinstance(question, str) or not question.strip() or len(question) > 1200:
                raise CalculationError('Use a question of one to 1,200 characters.')
            basis = payload['basis']
            if not isinstance(basis, str) or basis not in {'reported', 'scenario', 'break_even'}:
                raise CalculationError('Select reported, scenario or break_even research.')
            if claim_id == 'profit_keeps_pace' and basis != 'reported':
                raise CalculationError('Profit comparisons use reported evidence only.')
            identifier = payload['request_id']
            try:
                parsed = UUID(identifier) if isinstance(identifier, str) else None
            except (ValueError, AttributeError):
                parsed = None
            if parsed is None or parsed.version != 4 or str(parsed) != identifier:
                raise CalculationError('Use a new UUIDv4 request ID for Meta research.')
    except CalculationError as error:
        return None, _error(str(error), 400)
    return payload, None


def _proof(companies, claim_id, adjustment):
    # These are fixed, checked-in extracts. There is deliberately no SEC client,
    # native research downloader, provider, or fallback at this boundary.
    return audit_claim(load_engines(companies=companies), claim_id, adjustment)


FRONTEND_REV = '2026-11-01.6'

@bp.get('/research/claims')
@limiter.limit('60 per minute')
def page():
    session.setdefault(CSRF_SESSION_KEY, secrets.token_urlsafe(32))
    try:
        initial_proof = _proof(DEFAULT_COMPANIES, 'cash_keeps_pace', '0')
    except (CalculationError, OSError, KeyError, TypeError, AttributeError, ValueError):
        return render_template('errors/503.html'), 503
    companies = [
        {'ticker': ticker, 'company': company['company'],
         'fiscal_calendar': company['fiscal_calendar'],
         'fiscal_calendar_label': company['fiscal_calendar_label'],
         'measurement_note': company.get('measurement_note', DEFAULT_MEASUREMENT_NOTE)}
        for ticker, company in COMPANIES.items()
    ]
    return render_template(
        'claim_proof.html', companies=companies, claims=CLAIMS,
        default_companies=list(DEFAULT_COMPANIES), csrf_token=session[CSRF_SESSION_KEY],
        initial_proof=initial_proof, frontend_rev=FRONTEND_REV,
    )


@bp.post('/api/research/claims/proof')
@limiter.limit('12 per minute')
def proof():
    payload, failure = _payload()
    if failure is not None:
        return failure
    try:
        result = _proof(payload['companies'], payload['claim_id'], payload['adjustment'])
    except (CalculationError, OSError, KeyError, TypeError, AttributeError, ValueError):
        return _error('The retained filing proof is temporarily unavailable.', 503)
    return jsonify(result)


@bp.post('/api/research/claims/recheck')
@limiter.limit('6 per minute')
def recheck():
    payload, failure = _payload()
    if failure is not None:
        return failure
    try:
        result = _proof(payload['companies'], payload['claim_id'], payload['adjustment'])
        if any(len(company['facts']) != 8 for company in result['companies']):
            raise CalculationError('Unverified source.')
    except (CalculationError, OSError, KeyError, TypeError, AttributeError, ValueError):
        return _error('The retained filing proof is temporarily unavailable.', 503)
    return jsonify(version=1,
                   scope={'companies': list(payload['companies']),
                          'claim_id': payload['claim_id'],
                          'adjustment': exact(_adjustment(payload['adjustment']))},
                   result=result, provider_requests=0)


@bp.get('/api/research/claims/meta-status')
@limiter.limit('60 per minute')
def meta_status():
    return jsonify(meta=safe_status(current_app.extensions.get('claim_proof_meta')),
                   provider_requests=0)


@bp.post('/api/research/claims/investigate')
@limiter.limit('6 per minute')
def investigate():
    payload, failure = _payload(meta=True)
    if failure is not None:
        return failure
    # Fail before adapter access, credential handling or any reservation when
    # one of the fixed source records no longer supports the displayed proof.
    try:
        board = _proof(payload['companies'], payload['claim_id'], payload['adjustment'])
        if any(len(company['facts']) != 8 for company in board['companies']):
            raise CalculationError('Unverified source.')
    except (CalculationError, OSError, KeyError, TypeError, AttributeError, ValueError):
        error = MetaError('source_unavailable')
        return jsonify(error=error.message, code=error.code, mode='meta', provider_requests=0), error.status
    adapter = current_app.extensions.get('claim_proof_meta')
    if adapter is None:
        error = MetaError('not_activated')
        return jsonify(error=error.message, code=error.code, mode='meta',
                       provider_requests=0, meta=safe_status(None)), error.status
    try:
        planned = adapter.cohort(payload['question'], payload['request_id'], payload['companies'],
                                 payload['claim_id'], payload['adjustment'], payload['basis'])
        result = dict(planned['result'])
        result.update(question=payload['question'].strip(), mode='meta', selection_source='meta',
                      provider_requests=1, reservation_usd=planned['reservation_usd'],
                      estimated_usage_cost_usd=planned['estimated_usage_cost_usd'],
                      provider_invoice_cap_verified=False)
        return jsonify(result=result, meta=safe_status(adapter), provider_requests=1)
    except MetaError as error:
        return jsonify(error=error.message, code=error.code, mode='meta',
                       provider_requests=error.provider_requests,
                       meta=safe_status(adapter)), error.status
    except Exception:
        # The adapter owns precise attempt accounting. An unexpected failure
        # after entering it is conservatively reported as a possible attempt.
        error = MetaError('local_execution_failed', provider_requests=1)
        return jsonify(error=error.message, code=error.code, mode='meta',
                       provider_requests=1, meta=safe_status(adapter)), error.status
