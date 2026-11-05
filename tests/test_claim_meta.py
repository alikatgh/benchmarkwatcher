"""Optional local Meta integration, exercised without a provider or real key."""

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import socket
import sys
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app import create_app
from app.claim_proof import routes
from app.claim_proof.filings import COMPANIES, DATA_DIR, load_engines
from app.claim_proof.meta import ERROR_CODES, MetaError, off_status, safe_status


BASE = 'http://127.0.0.1:5059'
STATUS = '/api/research/claims/meta-status'
INVESTIGATE = '/api/research/claims/investigate'
PROOF = '/api/research/claims/proof'
CANONICAL = Path(__file__).resolve().parents[1]
STANDALONE = CANONICAL.parent / 'benchmarkwatcher-hackathon'
PAYLOAD = {'companies': ['MSFT', 'AAPL', 'GOOGL'], 'claim_id': 'cash_keeps_pace',
           'adjustment': '0', 'question': 'Rank the loaded companies by cash flow shortfall.',
           'basis': 'reported'}


def payload(**changes):
    return {**deepcopy(PAYLOAD), 'request_id': str(uuid4()), **changes}


class Adapter:
    def __init__(self):
        self.calls = []
        self.status_calls = 0

    def status(self):
        self.status_calls += 1
        return {**off_status('ready'), 'enabled': True, 'available': True,
                'budget_limit_usd': '100.000000000', 'remaining_usd': '99.500000000',
                'reserved_usd': '0.500000000', 'credential': 'never-return-this-private-value'}

    def cohort(self, *args):
        self.calls.append(args)
        return {'result': {'findings': [], 'selection': {'basis': args[-1]}},
                'reservation_usd': '0.050000000', 'estimated_usage_cost_usd': None}


@pytest.fixture(autouse=True)
def offline_only(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('Canonical Meta tests must not open a socket or provider request')
    monkeypatch.setattr(socket, 'socket', forbidden)
    monkeypatch.setattr('requests.sessions.Session.request', forbidden)


@pytest.fixture
def client(tmp_path):
    class Config:
        TESTING = True
        DEBUG = False
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = False
        RATELIMIT_STORAGE_URI = 'memory://'
        SECRET_KEY = 'synthetic-canonical-meta-test-only'
        WORKSPACE_ENABLED = False
        TRUST_PROXY_HEADERS = False
        JSON_DATA_DIR = str(tmp_path)

    app = create_app(Config)
    client = app.test_client()
    assert client.get('/research/claims', base_url=BASE).status_code == 200
    return client


def headers(client):
    with client.session_transaction(base_url=BASE) as current:
        token = current[routes.CSRF_SESSION_KEY]
    return {'Origin': BASE, 'X-CSRF-Token': token}


def post(client, data=None, **kwargs):
    return client.post(INVESTIGATE, json=payload() if data is None else data,
                       base_url=BASE, headers=kwargs.pop('headers', headers(client)), **kwargs)


def install(client):
    adapter = Adapter()
    client.application.extensions['claim_proof_meta'] = adapter
    return adapter


def test_default_is_off_and_existing_proof_never_enters_adapter(client):
    status = client.get(STATUS, base_url=BASE)
    assert status.status_code == 200
    assert status.json == {'meta': off_status(), 'provider_requests': 0}
    assert status.headers['Cache-Control'] == 'no-store, private'
    response = post(client)
    assert response.status_code == 503 and response.json['code'] == 'not_activated'
    assert response.json['provider_requests'] == 0 and 'result' not in response.json
    adapter = install(client)
    proof = client.post(PROOF, json={k: deepcopy(PAYLOAD[k]) for k in ('companies', 'claim_id', 'adjustment')},
                        headers=headers(client), base_url=BASE)
    assert proof.status_code == 200 and len(proof.json['companies']) == 3
    assert adapter.calls == [] and adapter.status_calls == 0


def test_status_is_safe_and_never_calls_cohort(client):
    adapter = install(client)
    response = client.get(STATUS, base_url=BASE)
    assert response.status_code == 200 and response.json['provider_requests'] == 0
    assert response.json['meta']['available'] is True
    assert response.json['meta']['budget_limit_usd'] == '100.000000000'
    assert response.json['meta']['provider_invoice_cap_verified'] is False
    assert 'credential' not in response.json['meta']
    assert 'private-value' not in response.get_data(as_text=True)
    assert adapter.calls == [] and adapter.status_calls == 1


@pytest.mark.parametrize('status', [None, [], {'code': 'private-value'}, {'code': ['ready']}])
def test_bad_adapter_status_fails_closed(status):
    assert safe_status(SimpleNamespace(status=lambda: status)) == off_status('ledger_unavailable')


def test_status_exception_is_not_exposed():
    def failed():
        raise ValueError('private-value')
    assert safe_status(SimpleNamespace(status=failed)) == off_status('ledger_unavailable')


@pytest.mark.parametrize('claim,basis,adjustment', [
    ('cash_keeps_pace', 'reported', '0'), ('cash_keeps_pace', 'scenario', '-25'),
    ('cash_keeps_pace', 'break_even', '-50'), ('profit_keeps_pace', 'reported', '0'),
])
def test_valid_research_injects_only_explicit_scope(client, claim, basis, adjustment):
    adapter = install(client)
    data = payload(claim_id=claim, basis=basis, adjustment=adjustment)
    response = post(client, data)
    assert response.status_code == 200 and response.json['provider_requests'] == 1
    assert adapter.calls == [(data['question'], data['request_id'], tuple(data['companies']), claim, adjustment, basis)]
    result = response.json['result']
    assert result['question'] == data['question']
    assert result['mode'] == result['selection_source'] == 'meta'
    assert result['provider_requests'] == 1
    assert result['reservation_usd'] == '0.050000000'
    assert result['estimated_usage_cost_usd'] is None
    assert result['provider_invoice_cap_verified'] is False


@pytest.mark.parametrize('missing', list(PAYLOAD) + ['request_id'])
def test_exact_required_fields_before_adapter(client, missing):
    adapter = install(client)
    data = payload()
    del data[missing]
    response = post(client, data)
    assert response.status_code == 400 and response.json['provider_requests'] == 0
    assert adapter.calls == [] and adapter.status_calls == 0


@pytest.mark.parametrize('changes', [
    {'extra': True}, {'question': None}, {'question': []}, {'question': ''}, {'question': '  '},
    {'question': 'x' * 1201}, {'basis': None}, {'basis': []}, {'basis': 'forecast'},
    {'claim_id': 'profit_keeps_pace', 'basis': 'scenario'},
    {'claim_id': 'profit_keeps_pace', 'basis': 'break_even'},
    {'claim_id': 'profit_keeps_pace', 'adjustment': '1'}, {'claim_id': []}, {'claim_id': 'unknown'},
    {'request_id': None}, {'request_id': True}, {'request_id': 'bad'},
    {'request_id': '00000000-0000-0000-0000-000000000000'},
    {'request_id': '6ba7b810-9dad-11d1-80b4-00c04fd430c8'},
    {'companies': None}, {'companies': 'MSFT'}, {'companies': []},
    {'companies': ['MSFT'] * 2}, {'companies': ['MSFT', 'AAPL', 'GOOGL', 'AMZN']},
    {'companies': ['UNKNOWN']}, {'companies': [[]]},
    {'adjustment': True}, {'adjustment': 10}, {'adjustment': 'NaN'},
    {'adjustment': '50.1'}, {'adjustment': '-50.1'}, {'adjustment': '1e2'},
])
def test_invalid_inputs_never_reach_adapter_or_status(client, changes):
    adapter = install(client)
    response = post(client, payload(**changes))
    assert response.status_code == 400 and response.json['provider_requests'] == 0
    assert adapter.calls == [] and adapter.status_calls == 0


@pytest.mark.parametrize('body', [
    b'[]', b'{', b'{"companies":[],"companies":[]}',
    b'{"companies":[],"claim_id":"cash_keeps_pace","adjustment":NaN}',
    b'[' * 1200,
])
def test_strict_json_rejections_preserve_zero_requests(client, body):
    adapter = install(client)
    response = client.post(INVESTIGATE, data=body, content_type='application/json',
                           headers=headers(client), base_url=BASE)
    assert response.status_code == 400 and response.json['provider_requests'] == 0
    assert adapter.calls == [] and adapter.status_calls == 0


def test_content_type_body_sentinel_and_csrf_checks_apply_before_adapter(client):
    adapter = install(client)
    assert post(client, headers={}).status_code == 403
    for changed in ({'Origin': 'https://elsewhere.invalid'}, {'X-CSRF-Token': 'bad'},
                    {'Sec-Fetch-Site': 'same-site'}, {'Sec-Fetch-Site': 'cross-site'}):
        response = post(client, headers={**headers(client), **changed})
        assert response.status_code == 403 and response.json['provider_requests'] == 0
    wrong_type = client.post(INVESTIGATE, data='{}', content_type='text/plain',
                             headers=headers(client), base_url=BASE)
    assert wrong_type.status_code == 415 and wrong_type.json['provider_requests'] == 0
    too_large = client.post(INVESTIGATE, data=b' ' * 8193, content_type='application/json',
                            headers=headers(client), base_url=BASE)
    assert too_large.status_code == 413 and too_large.json['provider_requests'] == 0
    chunked = client.post(INVESTIGATE, data=b' ' * 8193, content_type='application/json',
                          headers=headers(client), base_url=BASE,
                          environ_overrides={'CONTENT_LENGTH': '', 'wsgi.input_terminated': True})
    assert chunked.status_code == 413 and chunked.json['provider_requests'] == 0
    assert adapter.calls == [] and adapter.status_calls == 0


@pytest.mark.parametrize('host,peer,original', [
    ('127.0.0.1:5059.evil.invalid', '127.0.0.1', None),
    ('localhost', '127.0.0.1', None), ('localhost:5058', '127.0.0.1', None),
    ('127.0.0.2:5059', '127.0.0.1', None), ('127.0.0.1:5059@evil.invalid', '127.0.0.1', None),
    ('127.0.0.1:5059', '203.0.113.1', None), ('127.0.0.1:5059', None, None),
    ('127.0.0.1:5059', '127.0.0.1', {'REMOTE_ADDR': '203.0.113.1'}),
])
def test_meta_routes_require_exact_host_and_original_loopback_peer(client, host, peer, original):
    adapter = install(client)
    environ = {'HTTP_HOST': host, 'REMOTE_ADDR': peer}
    if original is not None:
        environ['werkzeug.proxy_fix.orig'] = original
    supplied = {**headers(client), 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Host': '127.0.0.1:5059'}
    for method, path in (('GET', STATUS), ('POST', INVESTIGATE)):
        response = client.open(path, method=method, json=payload() if method == 'POST' else None,
                               headers=supplied, base_url=BASE, environ_overrides=environ)
        assert response.status_code == 403 and response.json['provider_requests'] == 0
    assert adapter.calls == [] and adapter.status_calls == 0


@pytest.mark.parametrize('base,peer', [('http://localhost:5059', '127.0.0.1'), ('http://[::1]:5059', '::1')])
def test_literal_loopback_aliases_can_read_status(client, base, peer):
    response = client.get(STATUS, base_url=base, environ_overrides={'REMOTE_ADDR': peer})
    assert response.status_code == 200 and response.json['provider_requests'] == 0


def test_source_proof_failure_happens_before_adapter(client, monkeypatch):
    adapter = install(client)
    monkeypatch.setattr(routes, '_proof', lambda *args: {'companies': [{'facts': []}]})
    response = post(client)
    assert response.status_code == 503 and response.json['code'] == 'source_unavailable'
    assert response.json['provider_requests'] == 0
    assert adapter.calls == [] and adapter.status_calls == 0


@pytest.mark.parametrize('code,count,status', [
    ('not_activated', 0, 503), ('budget_exhausted', 0, 429), ('grant_busy', 0, 409),
    ('duplicate_request', 0, 409), ('idempotency_conflict', 0, 409),
    ('request_deadline_exceeded', 1, 504), ('response_rejected', 1, 502), ('provider_http_429', 1, 502),
])
def test_fixed_meta_errors_preserve_attempt_accounting(client, code, count, status):
    adapter = install(client)
    def failed(*args):
        raise MetaError(code, provider_requests=count)
    adapter.cohort = failed
    response = post(client)
    assert response.status_code == status
    assert response.json['code'] == code and response.json['provider_requests'] == count
    assert 'result' not in response.json and response.json['mode'] == 'meta'


def test_unexpected_errors_are_safe_and_never_logged(client, caplog):
    adapter = install(client)
    def failed(*args):
        raise RuntimeError('private-value')
    adapter.cohort = failed
    response = post(client)
    assert response.status_code == 502 and response.json['provider_requests'] == 1
    assert 'private-value' not in response.get_data(as_text=True) + caplog.text


@pytest.fixture
def bridge(monkeypatch):
    if not STANDALONE.is_dir():
        pytest.skip('Standalone Meta broker is not adjacent to this checkout.')
    # Canonical app is already imported. Only append standalone helper modules.
    monkeypatch.setattr(sys, 'path', [*sys.path, str(STANDALONE)])
    import browser_meta
    import canonical_meta
    import cohort_research
    monkeypatch.setattr(browser_meta.time, 'time', lambda: browser_meta.EXPIRY_EPOCH - 3600)
    def forbidden(*args, **kwargs):
        pytest.fail('No provider worker may run in canonical integration tests')
    monkeypatch.setattr(browser_meta, '_request_in_subprocess', forbidden)
    return SimpleNamespace(browser=browser_meta, adapter=canonical_meta, cohort=cohort_research)


@pytest.mark.parametrize('ticker', list(COMPANIES))
def test_adapter_loads_standalone_types_from_canonical_sources(bridge, ticker):
    before = {path.name: path.read_bytes() for path in DATA_DIR.glob('*.json')}
    calls = []
    def investigate(question, identifier, engines, claim, adjustment, basis):
        import filings
        assert isinstance(engines[ticker], filings.FilingEngine)
        assert not isinstance(engines[ticker], type(load_engines(companies=[ticker])[ticker]))
        result = bridge.cohort.execute_selection(engines, bridge.cohort.example_for(claim, basis, [ticker])[1],
                                                 claim, adjustment, basis=basis)
        calls.append((engines, claim))
        return {'result': result, 'reservation_usd': '0.050000000', 'estimated_usage_cost_usd': None}
    adapter = bridge.adapter.CanonicalMeta(SimpleNamespace(investigate=investigate))
    planned = adapter.cohort('Rank my selected company.', str(uuid4()), (ticker,), 'cash_keeps_pace', '0', 'reported')
    assert len(calls) == 1 and planned['result']['findings'][0]['audit']['ticker'] == ticker
    assert {path.name: path.read_bytes() for path in DATA_DIR.glob('*.json')} == before


def test_adapter_rejects_engine_drift_before_broker(bridge, monkeypatch):
    calls = []
    monkeypatch.setattr(bridge.adapter, 'standalone_audit', lambda *args: {'companies': []})
    adapter = bridge.adapter.CanonicalMeta(SimpleNamespace(investigate=lambda *args: calls.append(args)))
    with pytest.raises(MetaError, match='source_unavailable') as caught:
        adapter.cohort('Rank my selected companies.', str(uuid4()), ('MSFT',), 'cash_keeps_pace', '0', 'reported')
    assert caught.value.provider_requests == 0 and calls == []


def test_adapter_translates_only_known_broker_errors(bridge):
    assert set(bridge.browser.ERROR_MESSAGES) <= ERROR_CODES
    def failed(*args):
        raise bridge.browser.BrowserMetaError('response_rejected', provider_requests=1)
    adapter = bridge.adapter.CanonicalMeta(SimpleNamespace(investigate=failed))
    with pytest.raises(MetaError) as caught:
        adapter.cohort('Rank my selected companies.', str(uuid4()), ('MSFT',), 'cash_keeps_pace', '0', 'reported')
    assert caught.value.code == 'response_rejected' and caught.value.provider_requests == 1


def test_canonical_adapter_reuses_durable_shared_reservation_without_retry(client, bridge, monkeypatch, tmp_path):
    browser = bridge.browser
    grant = browser.BrowserMetaGrant('browser-v1', 100_000_000, tmp_path / 'private' / 'ledger.json')
    environment = {'META_API_KEY': 'synthetic-test-value-never-a-real-credential'}
    broker = browser.BrowserMeta(grant, environment=environment)
    client.application.extensions['claim_proof_meta'] = bridge.adapter.CanonicalMeta(broker)
    calls = []
    selection = bridge.cohort.example_for('cash_keeps_pace')[1]
    def send(body, key, identifier, nonce):
        calls.append(identifier)
        assert key == environment['META_API_KEY']
        assert len(body) <= browser.MAX_INPUT_BYTES
        state = json.loads(grant.ledger_path.read_text())
        assert state['reserved_nanodollars'] == len(calls) * browser.RESERVATION_NANODOLLARS
        return {'plan': deepcopy(selection), 'usage': None}
    monkeypatch.setattr(browser, '_request_in_subprocess', send)
    data = payload()
    first = post(client, data)
    assert first.status_code == 200 and first.json['provider_requests'] == 1
    assert first.json['meta']['reserved_usd'] == '0.050000000'
    # The same existing grant and ledger also back a newly constructed adapter.
    restarted = browser.BrowserMeta(grant, environment=environment)
    client.application.extensions['claim_proof_meta'] = bridge.adapter.CanonicalMeta(restarted)
    duplicate = post(client, data)
    assert duplicate.status_code == 409 and duplicate.json['code'] == 'duplicate_request'
    assert duplicate.json['provider_requests'] == 0 and len(calls) == 1
    assert post(client).status_code == 200 and len(calls) == 2
    exhausted = post(client)
    assert exhausted.status_code == 429 and exhausted.json['code'] == 'budget_exhausted'
    assert exhausted.json['provider_requests'] == 0 and len(calls) == 2
    assert browser.REQUEST_SECONDS == 20 and browser.RESERVATION_NANODOLLARS == 50_000_000


@pytest.fixture
def bootstrap(bridge):
    spec = importlib.util.spec_from_file_location('canonical_meta_server_test', STANDALONE / 'tools/meta-canonical-server.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_bootstrap_imports_canonical_app_and_exposes_only_claim_preview(bootstrap):
    import app
    assert Path(app.__file__).resolve() == CANONICAL / 'app/__init__.py'
    assert bootstrap.CANONICAL_ROOT == CANONICAL
    preview = bootstrap.application()
    assert preview.debug is False and preview.testing is False
    for setting in ('TRUST_PROXY_HEADERS', 'WORKSPACE_ENABLED', 'MARKET_DATA_ENABLED', 'OPEN_MARKET_DATA_ENABLED'):
        assert preview.config[setting] is False
    assert preview.config['CACHE_TYPE'] == 'NullCache'
    assert preview.config['RATELIMIT_STORAGE_URI'] == 'memory://'
    client = preview.test_client()
    assert client.get('/', base_url=BASE).location == '/research/claims'
    page = client.get('/research/claims', base_url=BASE)
    assert page.status_code == 200 and b'Claim proof' in page.data
    assert client.get('/static/css/claim-proof.css', base_url=BASE).status_code == 200
    assert client.get('/static/js/components/claim-proof.js', base_url=BASE).status_code == 200
    for path in ('/api/v1/research/companies?q=Microsoft', '/api/v1/research/companies/0000789019',
                 '/market-data', '/workspace', '/api/commodities'):
        assert client.get(path, base_url=BASE).status_code == 404
    response = client.get(STATUS, base_url=BASE)
    assert response.status_code == 200 and response.json['meta']['available'] is False
    assert response.json['provider_requests'] == 0


def test_bootstrap_main_has_fixed_loopback_port_quiet_handler_and_one_shutdown(bootstrap, monkeypatch):
    calls = []
    grant = object()
    instance = SimpleNamespace(serve_forever=lambda: calls.append('serve'), server_close=lambda: calls.append('close'))
    monkeypatch.setattr(bootstrap, 'from_manifest', lambda: grant)
    monkeypatch.setenv('META_API_KEY', 'synthetic-test-value-never-a-real-credential')
    monkeypatch.setattr(bootstrap, 'application', lambda supplied: calls.append(('application', supplied)) or 'canonical-app')
    def server(host, port, application, **options):
        assert (host, port, application) == ('127.0.0.1', 5059, 'canonical-app')
        assert options == {'threaded': True, 'request_handler': bootstrap.QuietHandler}
        return instance
    monkeypatch.setattr(bootstrap, 'make_server', server)
    assert bootstrap.main() == 0
    assert calls == [('application', grant), 'serve', 'close']


def test_bootstrap_missing_activation_or_key_never_starts_server(bootstrap, monkeypatch):
    monkeypatch.setattr(bootstrap, 'make_server', lambda *a, **k: pytest.fail('An inactive preview must not start'))
    monkeypatch.setattr(bootstrap, 'from_manifest', lambda: None)
    assert bootstrap.main() == 2
    monkeypatch.setattr(bootstrap, 'from_manifest', lambda: object())
    monkeypatch.delenv('META_API_KEY', raising=False)
    assert bootstrap.main() == 2
