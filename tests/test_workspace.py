"""Security boundaries and deterministic workbook/provider integration."""
import json
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import pytest
from cryptography.fernet import Fernet

from app import create_app
from app import analysis_providers as providers
from app.model_library import calculate, catalog, load_model
from app.workspace_store import db, read_key, reserve_analysis


def write_book(path):
    def cell(ref, value, formula=None, style='0'):
        if isinstance(value, str):
            return f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
        formula_xml = f'<f>{escape(formula)}</f>' if formula else ''
        val = '' if value is None else f'<v>{value}</v>'
        return f'<c r="{ref}" s="{style}">{formula_xml}{val}</c>'
    rows = [cell('B2', 'Metric')+cell('C2', 'Q124')+cell('D2', 'Q224')+cell('E2', 2024),
            cell('B3', 'Revenue')+cell('C3', 100)+cell('D3', 125, 'C3*1.25')+cell('E3', 500),
            cell('B4', 'Margin')+cell('C4', .2, style='1')+cell('D4', .25, style='1'),
            cell('B5', '<script>alert(1)</script>')+cell('C5', 0)+cell('D5', None, 'C5*2')]
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Model" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/model.xml"/></Relationships>')
        z.writestr('xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs><xf numFmtId="0"/><xf numFmtId="10"/></cellXfs></styleSheet>')
        z.writestr('xl/worksheets/model.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+''.join(f'<row r="{i+2}">{row}</row>' for i,row in enumerate(rows))+'</sheetData></worksheet>')


@pytest.fixture
def workspace(tmp_path):
    library = tmp_path / 'models'
    library.mkdir()
    write_book(library / 'DEMO.xlsx')
    class Config:
        TESTING = True
        SECRET_KEY = 'public-test'
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = False
        WORKSPACE_ENABLED = True
        WORKSPACE_SESSION_SECRET = 'workspace-session-test-secret-at-least-32'
        WORKSPACE_ENCRYPTION_KEY = Fernet.generate_key().decode()
        WORKSPACE_COOKIE_SECURE = False
        WORKSPACE_DB = str(tmp_path / 'private' / 'workspace.sqlite3')
        MODEL_LIBRARY_DIR = str(library)
    return create_app(Config)


def csrf(client):
    with client.session_transaction() as s:
        return s['csrf']


def post(client, url, **data):
    return client.post(url, data={'csrf': csrf(client), **data})


def register(client, username='alice'):
    client.get('/workspace/register')
    return post(client, '/workspace/register', username=username, password='correct horse battery staple')


def model_url(app):
    return '/workspace/models/' + catalog(app.config['MODEL_LIBRARY_DIR'])[0]['id']


def connect(client, monkeypatch, provider='deepseek', key='private-api-key'):
    monkeypatch.setattr('app.workspace_routes.test_key', lambda p,k: ['test-model'])
    return post(client, '/workspace/settings', provider=provider, api_key=key, action='connect', consent='yes')


def test_workspace_disabled_and_stable_secrets_required(tmp_path, monkeypatch):
    for name in ('WORKSPACE_ENABLED', 'WORKSPACE_SESSION_SECRET', 'WORKSPACE_ENCRYPTION_KEY'):
        monkeypatch.delenv(name, raising=False)
    class Disabled:
        TESTING = True
        SECRET_KEY = 'public'
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = False
    assert create_app(Disabled).test_client().get('/workspace/').status_code == 404
    class Broken(Disabled):
        WORKSPACE_ENABLED = True
    with pytest.raises(RuntimeError, match='persistent'):
        create_app(Broken)


def test_auth_csrf_and_session_revocation(workspace):
    client = workspace.test_client()
    assert client.get('/workspace/').status_code == 302
    assert client.post('/workspace/register', data={'username':'alice','password':'x'}).status_code == 400
    response = register(client)
    assert b'Save your recovery code' in response.data
    assert response.headers['Cache-Control'] == 'no-store, private'
    assert 'noindex' in response.headers['X-Robots-Tag']
    assert b'alice' in client.get('/workspace/').data
    with client.session_transaction() as s:
        assert 'password' not in s and 'api_key' not in s
    post(client, '/workspace/logout')
    assert client.get('/workspace/settings').status_code == 302


def test_recovery_invalidates_other_sessions(workspace):
    first, second = workspace.test_client(), workspace.test_client()
    response = register(first)
    code = re.search(rb'class="recovery-code">([^<]+)', response.data).group(1).decode()
    second.get('/workspace/login')
    post(second, '/workspace/login', username='alice', password='correct horse battery staple')
    post(first, '/workspace/recover', username='alice', recovery=code, password='replacement password twelve')
    assert second.get('/workspace/').status_code == 302
    assert first.get('/workspace/').status_code == 200


def test_encryption_key_isolation_removal_and_failed_replacement(workspace, monkeypatch):
    first, second = workspace.test_client(), workspace.test_client()
    register(first)
    register(second, 'bob')
    connect(first, monkeypatch)
    with workspace.app_context():
        encrypted = db().execute('SELECT ciphertext FROM provider_keys').fetchone()[0]
        assert 'private-api-key' not in encrypted
        assert read_key(1, 'deepseek') == 'private-api-key'
        with pytest.raises(ValueError, match='Connect'):
            read_key(2, 'deepseek')
        assert db().execute('SELECT password_hash FROM users WHERE id=1').fetchone()[0].startswith('scrypt:')
    page = first.get('/workspace/settings').data
    assert b'private-api-key' not in page and encrypted.encode() not in page
    assert b'Connected' not in second.get('/workspace/settings').data
    def fail(*args):
        raise providers.ProviderError('Connection failed.')
    monkeypatch.setattr('app.workspace_routes.test_key', fail)
    post(first, '/workspace/settings', provider='deepseek', api_key='replacement', action='connect', consent='yes')
    with workspace.app_context():
        assert read_key(1, 'deepseek') == 'private-api-key'
    post(first, '/workspace/settings', provider='deepseek', action='remove')
    with workspace.app_context():
        with pytest.raises(ValueError):
            read_key(1, 'deepseek')


def test_manual_calculation_and_owner_scoped_history(workspace):
    first, second = workspace.test_client(), workspace.test_client()
    register(first)
    register(second, 'bob')
    response = post(first, model_url(workspace), action='manual', metric='r3', operation='change', start='C', end='D')
    assert response.status_code == 302
    location = response.headers['Location']
    result = first.get(location)
    assert b'+25.00' in result.data and b'Model!D3' in result.data
    assert second.get(location).status_code == 404
    assert post(second, location+'/delete').status_code == 404
    assert first.get(location).status_code == 200
    assert b'DEMO' in first.get('/workspace/').data
    assert b'Local calculation' not in second.get('/workspace/').data
    assert post(first, location+'/delete').status_code == 302
    assert first.get(location).status_code == 404


def test_workbook_missing_percent_and_source_preservation(workspace):
    root = workspace.config['MODEL_LIBRARY_DIR']
    model = load_model(root, catalog(root)[0]['id'])
    assert model['periods'][-1]['label'] == '2024'
    with pytest.raises(ValueError, match='same frequency'):
        calculate(model, 'r3', 'change', 'C', 'E')
    result = calculate(model, 'r4', 'change', 'C', 'D')
    assert result['difference'] == pytest.approx(5)
    assert result['difference_unit'] == 'percentage points'
    assert result['points'][0]['header'] == 'Model!C2'
    with pytest.raises(ValueError, match='no usable'):
        calculate(model, 'r5', 'change', 'C', 'D')
    series = calculate(model, 'r5', 'series', '', '')
    assert series['points'][0]['value'] == 0
    assert series['points'][1]['value'] is None
    with pytest.raises(KeyError):
        load_model(root, '../../secrets')
    assert len(model['version']) == 64
    client = workspace.test_client()
    register(client)
    assert b'&lt;script&gt;' in client.get(model_url(workspace)).data


def test_calculation_rejects_overflow_after_percentage_scaling(workspace):
    import copy
    root = workspace.config['MODEL_LIBRARY_DIR']
    model = copy.deepcopy(load_model(root, catalog(root)[0]['id']))
    margin = next(m for m in model['metrics'] if m['id'] == 'r4')
    margin['values']['C']['value'] = -1e306
    margin['values']['D']['value'] = 1e306
    with pytest.raises(ValueError, match='calculation range'):
        calculate(model, 'r4', 'change', 'C', 'D')
    margin['values']['D']['value'] = 1e308
    with pytest.raises(ValueError, match='calculation range'):
        calculate(model, 'r4', 'value', '', 'D')


def test_negative_base_keeps_difference_without_relative_percentage(workspace):
    import copy
    root = workspace.config['MODEL_LIBRARY_DIR']
    model = copy.deepcopy(load_model(root, catalog(root)[0]['id']))
    model['metrics'][0]['values']['C']['value'] = -100
    result = calculate(model, 'r3', 'change', 'C', 'D')
    assert result['difference'] == 225
    assert result['relative_change'] is None


def test_consent_and_model_allowlist_before_provider_call(workspace, monkeypatch):
    client = workspace.test_client()
    register(client)
    connect(client, monkeypatch)
    calls = []
    monkeypatch.setattr('app.workspace_routes.analyze', lambda *a,**k: calls.append(a))
    payload = dict(action='ask', question='Revenue in Q224', provider_model='deepseek:test-model')
    assert b'Confirm sharing' in post(client, model_url(workspace), **payload).data
    payload.update(consent='yes', provider_model='deepseek:unlisted')
    assert b'Select a model' in post(client, model_url(workspace), **payload).data
    assert calls == []


def test_budget_is_persistent_and_atomic(workspace):
    register(workspace.test_client())
    workspace.config['WORKSPACE_DAILY_ANALYSES'] = 1
    with workspace.app_context():
        reserve_analysis(1)
        with pytest.raises(ValueError, match='daily'):
            reserve_analysis(1)
        assert db().execute('SELECT count(*) FROM attempts').fetchone()[0] == 1


def test_deepseek_calculates_in_code_and_explanation_is_opt_in(workspace, monkeypatch):
    model = load_model(workspace.config['MODEL_LIBRARY_DIR'], catalog(workspace.config['MODEL_LIBRARY_DIR'])[0]['id'])
    calls = []
    def response(provider, key, payload=None):
        calls.append(payload)
        return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'metric':'r3','operation':'change','start':'C','end':'D'})}}], 'usage':{'prompt_tokens':50}}
    monkeypatch.setattr(providers, '_request', response)
    result = providers.analyze('deepseek','key','test-model','Compare revenue Q124 and Q224',model)
    assert result['difference'] == 25
    assert len(calls) == 1 and 'explanation' not in result
    assert '"value": 100' not in json.dumps(calls[0])
    assert 'private-api-key' not in json.dumps(result)


def test_jev_rejects_uncertain_or_invalid_choices(workspace, monkeypatch):
    model = load_model(workspace.config['MODEL_LIBRARY_DIR'], catalog(workspace.config['MODEL_LIBRARY_DIR'])[0]['id'])
    def response(provider, key, payload):
        return {'answers': {name:{'type':'choice','choice': {'metric':'r3','operation':'change','start':'C','end':'D'}[name], 'confidence':.3} for name in payload['questions']}}
    monkeypatch.setattr(providers, '_request', response)
    with pytest.raises(ValueError, match='ambiguous'):
        providers.analyze('typesafe','key','jev-latest','Compare revenue',model)
    monkeypatch.setattr(providers, '_request', lambda *a: {'answers': {'metric': {'type':'choice','choice':'r999','confidence':1}}})
    with pytest.raises(providers.ProviderError, match='invalid'):
        providers.analyze('typesafe','key','jev-latest','Compare revenue',model)


def test_jev_selection_runs_the_same_canonical_calculation(workspace, monkeypatch):
    root = workspace.config['MODEL_LIBRARY_DIR']
    model = load_model(root, catalog(root)[0]['id'])
    observed = []
    def response(provider, key, payload):
        observed.append(payload)
        return {'answers': {name: {'type': 'choice', 'choice': choice, 'confidence': .99}
            for name, choice in {'metric': 'r3', 'operation': 'change', 'start': 'C', 'end': 'D'}.items()}}
    monkeypatch.setattr(providers, '_request', response)
    result = providers.analyze('typesafe', 'key', 'jev-latest', 'Compare Revenue Q124 and Q224', model)
    assert result['difference'] == 25
    assert result['points'][1]['source'] == 'Model!D3'
    assert '"value": 100' not in json.dumps(observed)
    assert '"value": 125' not in json.dumps(observed)


def test_explanation_shares_only_selected_calculation_and_failure_preserves_it(workspace, monkeypatch):
    root = workspace.config['MODEL_LIBRARY_DIR']
    model = load_model(root, catalog(root)[0]['id'])
    calls = []
    def response(provider, key, payload):
        calls.append(payload)
        if len(calls) == 1:
            return {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(
                {'metric': 'r3', 'operation': 'change', 'start': 'C', 'end': 'D'})}}]}
        raise providers.ProviderError('Unavailable')
    monkeypatch.setattr(providers, '_request', response)
    result = providers.analyze('deepseek', 'key', 'test-model', 'Compare Revenue Q124 and Q224', model, explain=True)
    assert len(calls) == 2
    sent = json.loads(calls[1]['messages'][1]['content'])['result']
    assert [p['value'] for p in sent['points']] == [100, 125]
    assert 'Margin' not in json.dumps(sent)
    assert result['difference'] == 25 and 'explanation_notice' in result


@pytest.mark.parametrize('status', [302, 401, 402, 429, 500])
def test_provider_errors_never_echo_secrets(status, monkeypatch):
    class Response:
        status_code = status
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def iter_content(self, size): yield b'{"secret":"user-key-SECRET"}'
    observed = {}
    def request(method, url, **kwargs):
        observed.update(url=url, **kwargs)
        return Response()
    monkeypatch.setattr(providers.requests, 'request', request)
    with pytest.raises(providers.ProviderError) as error:
        providers._request('deepseek', 'user-key-SECRET')
    assert 'SECRET' not in str(error.value)
    assert observed['allow_redirects'] is False
    assert observed['url'] == 'https://api.deepseek.com/models'
