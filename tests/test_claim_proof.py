"""Claim proofs preserve offline source boundaries and bounded public inputs."""

from copy import deepcopy
from decimal import Decimal
from io import BytesIO
import json
from pathlib import Path
import re
import socket
from types import SimpleNamespace

import pytest

from app import create_app, native_research, sec_client
from app.claim_proof import routes
from app.claim_proof.audit import audit_claim
from app.claim_proof.engine import CalculationError
from app.claim_proof.filings import COMPANIES, DATA_DIR, FilingEngine, load_engines, records_hash, _annual


PAYLOAD = {'companies': ['MSFT', 'AAPL', 'GOOGL'],
           'claim_id': 'cash_keeps_pace', 'adjustment': '0'}
PATH = '/api/research/claims/proof'


@pytest.fixture
def client(tmp_path, monkeypatch):
    class Config:
        TESTING = True
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = False
        RATELIMIT_STORAGE_URI = 'memory://'
        SECRET_KEY = 'claim-proof-test-only'
        WORKSPACE_ENABLED = False
        JSON_DATA_DIR = str(tmp_path)

    app = create_app(Config)

    def forbidden(*args, **kwargs):
        pytest.fail('Claim proofs must not create network or native download requests')

    monkeypatch.setattr(socket, 'socket', forbidden)
    monkeypatch.setattr('requests.sessions.Session.request', forbidden)
    monkeypatch.setattr('app.claim_proof.filings.SECClient.fetch', forbidden)
    monkeypatch.setattr(sec_client, 'fetch', forbidden)
    monkeypatch.setattr(native_research, 'snapshot', forbidden)
    rendered = {}

    def render(template, **context):
        rendered.update(template=template, **context)
        return 'Claim proof'

    monkeypatch.setattr(routes, 'render_template', render)
    result = app.test_client()
    result.claim_context = rendered
    assert result.get('/research/claims').status_code == 200
    yield result


def headers(client):
    with client.session_transaction() as session:
        token = session[routes.CSRF_SESSION_KEY]
    return {'Origin': 'http://localhost', 'X-CSRF-Token': token}


def post(client, payload=None, **kwargs):
    if 'headers' not in kwargs:
        kwargs['headers'] = headers(client)
    return client.post(PATH, json=deepcopy(PAYLOAD if payload is None else payload), **kwargs)


def cards(board):
    return {company['ticker']: company for company in board['companies']}


def test_page_exposes_only_fixed_library_and_historical_scope(client):
    context = client.claim_context
    assert context['template'] == 'claim_proof.html'
    assert [company['ticker'] for company in context['companies']] == list(COMPANIES)
    assert all(company['company'] and company['fiscal_calendar_label']
               and company['measurement_note'] for company in context['companies'])
    assert context['default_companies'] == PAYLOAD['companies']
    assert set(context['claims']) == {'cash_keeps_pace', 'profit_keeps_pace'}
    assert context['csrf_token'] == headers(client)['X-CSRF-Token']
    assert context['initial_proof'] == audit_claim(load_engines(), 'cash_keeps_pace')
    response = client.get('/research/claims')
    assert response.headers['Cache-Control'] == 'no-store, private'
    assert 'Cookie' in response.vary
    assert not list(Path(client.application.config['JSON_DATA_DIR']).iterdir())


def test_canonical_factory_renders_actual_claim_template_and_serves_its_assets(client, monkeypatch):
    from flask import render_template

    monkeypatch.setattr(routes, 'render_template', render_template)
    response = client.get('/research/claims')
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert '<title>Claim proof | BenchmarkWatcher</title>' in html
    assert 'data-endpoint="/api/research/claims/proof"' in html
    assert 'data-frontend="2026-11-01.6"' in html
    token = re.search(r'data-csrf="([^"]+)"', html).group(1)
    assert token == headers(client)['X-CSRF-Token']
    embedded = json.loads(re.search(r'<script id="cp-initial" type="application/json">(.*?)</script>', html).group(1))
    assert embedded == post(client).json
    assert all(f'value="{ticker}"' in html for ticker in COMPANIES)
    assert 'not the latest filings' in html
    for asset in ('css/claim-proof.css', 'js/components/claim-proof.js'):
        assert client.get('/static/' + asset).status_code == 200


def test_replay_is_deterministic_and_never_mutates_sources(client):
    before = {path.name: path.read_bytes() for path in DATA_DIR.glob('*.json')}
    payload = dict(PAYLOAD, adjustment='-25')
    first = post(client, payload)
    replay = post(client, payload)
    assert first.status_code == replay.status_code == 200
    assert first.json == replay.json == audit_claim(load_engines(), 'cash_keeps_pace', '-25')
    assert first.headers['Cache-Control'] == 'no-store, private'
    assert 'Cookie' in first.vary
    assert {path.name: path.read_bytes() for path in DATA_DIR.glob('*.json')} == before
    assert first.json['actual_counts'] == {'supported': 0, 'contradicted': 3, 'unavailable': 0}
    assert first.json['periods'] == ['FY2024', 'FY2025']
    assert first.json['sensitivity']['hypothetical'] is True
    json.dumps(first.json, allow_nan=False)


@pytest.mark.parametrize('ticker', list(COMPANIES))
def test_all_six_verified_companies_preserve_original_operands_and_citations(client, ticker):
    response = post(client, dict(PAYLOAD, companies=[ticker], adjustment='-50'))
    assert response.status_code == 200
    card = response.json['companies'][0]
    assert card['ticker'] == ticker
    assert card['actual_status'] in ('supported', 'contradicted')
    assert len(card['facts']) == 8
    source = json.loads((DATA_DIR / f'{ticker.lower()}.json').read_text())
    for fact in card['facts']:
        sign = -1 if fact['id'].endswith('cash_ppe_signed') else 1
        assert Decimal(fact['reported_value']) * sign == Decimal(fact['normalized_usd'])
        assert Decimal(fact['value']) * 1_000_000 == Decimal(fact['normalized_usd'])
        assert fact['source_sha256'] == source['source']['raw_sha256']
        assert fact['source_retrieved_at'] == source['source']['fetched_at']
        assert fact['url'] == card['citations'][0]['url']
        assert fact['accession'] == card['citations'][0]['accession']
    fact_ids = {fact['id'] for fact in card['facts']}
    assert all(set(formula['operand_ids']) <= fact_ids for formula in card['formulas'])
    current = card['actuals'][1]
    assert Decimal(card['scenario_ppe']) == Decimal(current['cash_ppe']) / 2
    assert Decimal(card['scenario_fcf']) == Decimal(current['operating_cash_flow']) - Decimal(card['scenario_ppe'])


def test_fiscal_dates_and_company_measurement_caveats_remain_distinct(client):
    result = post(client).json
    assert {ticker: card['period_details'][1]['end'] for ticker, card in cards(result).items()} == {
        'MSFT': '2025-06-30', 'AAPL': '2025-09-27', 'GOOGL': '2025-12-31'}
    result = post(client, dict(PAYLOAD, companies=['AMZN', 'META', 'TSLA'])).json
    assert 'gross cash PP&E' in cards(result)['AMZN']['measurement_note']
    assert 'finance-lease principal' in cards(result)['META']['measurement_note']
    assert 'including leasing' in cards(result)['TSLA']['measurement_note']


def test_profit_claim_uses_original_actuals_without_cash_sensitivity(client):
    response = post(client, dict(PAYLOAD, claim_id='profit_keeps_pace'))
    assert response.status_code == 200
    assert response.json['actual_counts'] == {'supported': 2, 'contradicted': 1, 'unavailable': 0}
    assert response.json['sensitivity']['applies_to'] is None
    assert all(card['scenario_status'] == card['actual_status']
               and card['scenario_ppe'] is None for card in response.json['companies'])


@pytest.mark.parametrize('value', [None, [], {}, 'MSFT', ['MSFT', 'MSFT'], ['msft'],
    ['UNKNOWN'], [None], [True], [1], [['MSFT']],
    ['MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NFLX', 'AMD', 'NOW', 'PLTR', 'EXTRA']])
def test_company_input_rejects_unknown_duplicate_nonlist_and_oversized_scope(client, value):
    assert post(client, dict(PAYLOAD, companies=value)).status_code == 400


def test_full_library_scope_returns_fourteen_ranked_companies(client):
    library = ['MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NFLX', 'AMD', 'NOW', 'PLTR',
               'AMGN', 'HON', 'UNP', 'BKNG']
    response = post(client, dict(PAYLOAD, companies=library))
    assert response.status_code == 200
    assert [company['ticker'] for company in response.json['companies']] == library
    assert all(len(company['facts']) == 8 for company in response.json['companies'])


@pytest.mark.parametrize('value', [None, 0, True, 1.5, '', 'NaN', 'Infinity', '-Infinity',
    '1e1', ' 0', '0 ', '-51', '51', '-50.000001', '50.000001',
    '0.0000000000000000000000001', '0' * 40, [], {}])
def test_adjustment_requires_finite_bounded_decimal_string(client, value):
    assert post(client, dict(PAYLOAD, adjustment=value)).status_code == 400


@pytest.mark.parametrize('payload', [[], None, 1, True, 'query', {},
    {'companies': ['MSFT'], 'claim_id': 'cash_keeps_pace'},
    dict(PAYLOAD, url='https://example.com'), dict(PAYLOAD, question='make a forecast'),
    dict(PAYLOAD, claim_id='unknown'), dict(PAYLOAD, claim_id=[]),
    dict(PAYLOAD, claim_id=None), dict(PAYLOAD, claim_id='profit_keeps_pace', adjustment='1')])
def test_exact_request_schema_and_claim_allowlist(client, payload):
    response = client.post(PATH, data=json.dumps(payload), content_type='application/json', headers=headers(client))
    assert response.status_code == 400
    assert set(response.json) == {'error'}


@pytest.mark.parametrize('raw', [b'{', b'\xff', b'{"companies":["MSFT"],"claim_id":"cash_keeps_pace","adjustment":NaN}',
    b'{"companies":["MSFT"],"claim_id":"cash_keeps_pace","adjustment":"0","adjustment":"1"}',
    b'[' * 1100 + b'0' + b']' * 1100])
def test_invalid_nonfinite_duplicate_and_deep_json_fail_closed(client, raw):
    assert client.post(PATH, data=raw, content_type='application/json', headers=headers(client)).status_code == 400


@pytest.mark.parametrize('content_type', ['text/plain', 'application/x-www-form-urlencoded', 'application/merge-patch+json'])
def test_only_json_is_accepted(client, content_type):
    response = client.post(PATH, data=json.dumps(PAYLOAD), content_type=content_type, headers=headers(client))
    assert response.status_code == 415


def test_size_cap_is_enforced_before_json_parsing_for_known_and_streamed_bodies(client, monkeypatch):
    raw = json.dumps(PAYLOAD).encode()
    boundary = raw + b' ' * (routes.MAX_REQUEST_BYTES - len(raw))
    assert client.post(PATH, data=boundary, content_type='application/json', headers=headers(client)).status_code == 200
    assert client.post(PATH, content_type='application/json', headers=headers(client),
                       environ_overrides={'wsgi.input': BytesIO(boundary),
                                          'wsgi.input_terminated': True, 'CONTENT_LENGTH': ''}).status_code == 200

    def forbidden(*args, **kwargs):
        pytest.fail('Oversized JSON was parsed')

    monkeypatch.setattr(routes, '_unique_object', forbidden)
    oversized = boundary + b' '
    response = client.post(PATH, data=oversized, content_type='application/json', headers=headers(client))
    assert response.status_code == 413
    # Simulate a server exposing a chunked/terminated stream without Content-Length.
    response = client.post(PATH, content_type='application/json', headers=headers(client),
                           environ_overrides={'wsgi.input': BytesIO(oversized),
                                              'wsgi.input_terminated': True, 'CONTENT_LENGTH': ''})
    assert response.status_code == 413


@pytest.mark.parametrize('origin', ['', 'null', 'http://evil.example', 'https://localhost',
    'http://localhost.evil.example', 'http://localhost:81', 'http://user@localhost',
    'http://localhost/path', 'http://localhost?query=1', 'http://localhost:bad'])
def test_requests_require_exact_same_origin(client, origin):
    supplied = dict(headers(client), Origin=origin)
    assert post(client, headers=supplied).status_code == 403


@pytest.mark.parametrize('site', ['same-site', 'cross-site'])
def test_cross_origin_fetch_metadata_is_rejected(client, site):
    assert post(client, headers=dict(headers(client), **{'Sec-Fetch-Site': site})).status_code == 403


def test_csrf_is_required_and_bound_to_the_signed_session(client):
    supplied = headers(client)
    assert post(client, headers={'Origin': 'http://localhost'}).status_code == 403
    assert post(client, headers=dict(supplied, **{'X-CSRF-Token': 'incorrect'})).status_code == 403
    assert post(client, headers=dict(supplied, **{'X-CSRF-Token': 'x' * 129})).status_code == 403
    other = client.application.test_client()
    assert post(other, headers=supplied).status_code == 403
    assert post(client, headers=supplied).status_code == 200


def test_missing_or_invalid_source_has_no_network_fallback(client, monkeypatch):
    def missing(*args, **kwargs):
        raise FileNotFoundError('Synthetic missing fixture')

    monkeypatch.setattr(routes, 'load_engines', missing)
    response = post(client)
    assert response.status_code == 503
    assert response.json == {'error': 'The retained filing proof is temporarily unavailable.'}
    assert client.get('/research/claims').status_code == 503


def test_bad_retained_source_is_rejected_and_tampered_operand_becomes_unavailable():
    extract = json.loads((DATA_DIR / 'msft.json').read_text())
    extract['records'][0]['record']['val'] += 1
    with pytest.raises(CalculationError, match='checksum'):
        FilingEngine(extract)
    engines = load_engines()
    engines['MSFT'].fixture['facts']['FY2024.revenue']['value'] = '1'
    card = cards(audit_claim(engines, 'cash_keeps_pace'))['MSFT']
    assert card['actual_status'] == card['scenario_status'] == 'unavailable'
    assert card['facts'] == card['actuals'] == card['citations'] == []


def test_exact_boundary_comparison_does_not_depend_on_rounded_percentages():
    engine = load_engines(companies=['MSFT'])['MSFT']
    extract = deepcopy(engine._extract)
    values = {('FY2024', 'revenue'): 100, ('FY2025', 'revenue'): 110,
              ('FY2024', 'operating_cash_flow'): 150, ('FY2024', 'cash_ppe_signed'): 50,
              ('FY2025', 'operating_cash_flow'): 150, ('FY2025', 'cash_ppe_signed'): 80}
    for record in extract['records']:
        key = record['period'], record['metric']
        if key in values:
            record['record']['val'] = values[key] * 1_000_000
    extract['source']['records_sha256'] = records_hash(extract['records'])
    engine = FilingEngine(extract)
    card = audit_claim({'MSFT': engine}, 'cash_keeps_pace', '-50')['companies'][0]
    assert card['actual_status'] == 'contradicted'
    assert card['scenario_status'] == 'supported'
    assert Decimal(card['scenario_growth']) == Decimal(card['revenue_growth']) == 10


def test_public_proof_route_has_a_rate_limit(client):
    from app.extensions import limiter

    app = create_app(SimpleNamespace(**dict(client.application.config, RATELIMIT_ENABLED=True)))
    limiter.reset()
    try:
        limited = app.test_client()
        assert limited.get('/research/claims').status_code == 200
        statuses = [post(limited).status_code for _ in range(13)]
        assert statuses == [200] * 12 + [429]
    finally:
        limiter.enabled = False


RECHECK_PATH = '/api/research/claims/recheck'


def recheck(client, payload=None, **kwargs):
    if 'headers' not in kwargs:
        kwargs['headers'] = headers(client)
    return client.post(RECHECK_PATH, json=deepcopy(PAYLOAD if payload is None else payload), **kwargs)


def test_recheck_returns_versioned_scope_and_deterministic_proof(client):
    response = recheck(client)
    assert response.status_code == 200
    body = response.json
    assert body['version'] == 1
    assert body['scope'] == {'companies': PAYLOAD['companies'], 'claim_id': 'cash_keeps_pace', 'adjustment': '0'}
    assert body['provider_requests'] == 0
    assert body['result'] == post(client).json
    assert all(len(company['facts']) == 8 for company in body['result']['companies'])
    assert response.headers['Cache-Control'] == 'no-store, private'


def test_recheck_rejects_non_exact_scope(client):
    assert recheck(client, dict(PAYLOAD, claim_id='unknown_claim')).status_code == 400
    assert recheck(client, {'companies': PAYLOAD['companies'], 'claim_id': 'cash_keeps_pace'}).status_code == 400


def test_recheck_has_no_source_fallback_when_facts_fail(client, monkeypatch):
    board = audit_claim(load_engines(), 'cash_keeps_pace', '0')
    board['companies'][0]['facts'] = board['companies'][0]['facts'][:7]
    monkeypatch.setattr(routes, '_proof', lambda *args, **kwargs: board)
    assert recheck(client).status_code == 503


def test_broken_source_renders_branded_unavailable_page(client, monkeypatch):
    def gone(*args, **kwargs):
        raise CalculationError('Unverified source.')
    monkeypatch.setattr(routes, '_proof', gone)
    response = client.get('/research/claims')
    assert response.status_code == 503
    assert client.claim_context['template'] == 'errors/503.html'


def test_december_saturday_fiscal_calendar_matches_only_true_week_years():
    assert _annual('AMD', 2024, '2023-12-31', '2024-12-28')
    assert _annual('AMD', 2025, '2024-12-29', '2025-12-27')
    assert not _annual('AMD', 2025, '2025-01-01', '2025-12-31')
    assert not _annual('AMD', 2024, '2023-12-31', '2024-12-29')
    assert not _annual('AMD', 2024, '2023-12-30', '2024-12-28')
    assert _annual('NFLX', 2025, '2025-01-01', '2025-12-31')
    assert not _annual('NFLX', 2025, '2024-12-29', '2025-12-27')
