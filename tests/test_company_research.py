import json
from decimal import Decimal

import pytest

from app.company_research import build_report, number, resolve_company, scenario, valuation
from app import analysis_providers as providers
from app.workspace_store import db
from tests.test_workspace import workspace, register, post, connect


def test_report_reconciles_sources_units_and_calculations():
    report = build_report()
    assert report['balance'][0]['values'][-1] == 189.999
    assert report['derived']['net_cash'] == 167.5903
    assert report['derived']['cash_after_ppe'] == 90.97
    assert report['derived']['revenue_yoy'] == pytest.approx(129.8928)
    assert report['derived']['operating_margin'] == pytest.approx(52.1866)
    assert report['derived']['ds_earnings_change'] == 88.8
    assert report['balance'][4]['values'][-1] == pytest.approx(
        report['balance'][5]['values'][-1] + report['balance'][6]['values'][-1])
    assert len(report['version']) == 64
    assert all(row['source'].endswith('#page=12') for row in report['earnings'])
    assert build_report()['version'] == report['version']


def test_price_sensitivity_is_a_bridge_not_an_invented_memory_margin():
    report = build_report()
    full = scenario(report, -15, 100)
    half = scenario(report, -15, 50)
    assert full['sales_change'] == -18.12
    assert full['sales'] == 153.38
    assert full['earnings'] == 71.38
    assert half['earnings'] == 80.44
    assert 'scenario' not in report
    report['memory_sales']['value'] = 100
    assert scenario(report, -15, 100)['sales_change'] == -15  # use the saved snapshot
    assert scenario(report, 0, 0)['earnings'] == 89.5
    assert scenario(report, -100, 100)['earnings'] == -10.5  # negative cases are valid


@pytest.mark.parametrize('bad', ['NaN', 'Infinity', '-Infinity', '1e99999', True, None, '1000000000000000000000000000000000000000000'])
def test_numeric_inputs_fail_closed(bad):
    with pytest.raises(ValueError):
        number(bad, 'input', -100, 100)


def test_company_resolution_and_valuation_dates():
    for question in ['Samsung', 'Analyze Samsung Electronics', '005930.KS', 'research 005935']:
        assert resolve_company(question) == 'samsung-electronics'
    for question in ['Samsung Biologics', 'compare Samsung and Apple', 'Samsung price target', '']:
        with pytest.raises(ValueError):
            resolve_company(question)
    result = valuation(build_report(), 443, '2026-01-30')
    assert result['price_earnings'] == 10
    for day in ['2999-01-01', 'yesterday', '', None]:
        with pytest.raises(ValueError):
            valuation(build_report(), 443, day)


def test_saved_company_report_and_followups_are_private(workspace):
    alice, bob = workspace.test_client(), workspace.test_client()
    register(alice)
    register(bob, 'bob')
    saved = post(alice, '/workspace/research', company='Analyze Samsung')
    url = saved.location
    page = alice.get(url)
    assert page.status_code == 200
    assert b'Samsung Electronics' in page.data
    assert b'2Q 2026' in page.data
    assert b'Cash generation' in page.data
    assert page.headers['Cache-Control'] == 'no-store, private'
    assert bob.get(url).status_code == 404
    assert post(bob, url+'/follow-up', action='scenario', price_change='-15', flow_through='100').status_code == 404
    assert alice.post(url+'/follow-up', data={'action':'scenario'}).status_code == 400
    changed = post(alice, url+'/follow-up', action='scenario', price_change='-15', flow_through='100')
    assert changed.location != url
    assert b'153.38' in alice.get(changed.location).data
    assert b'153.38' not in alice.get(url).data
    assert b'Previous saved case' in alice.get(changed.location).data
    multiples = post(alice, changed.location+'/follow-up', action='valuation', market_cap='443', as_of='2026-01-30')
    assert b'10.00' in alice.get(multiples.location).data
    with workspace.app_context():
        assert db().execute('SELECT count(*) FROM analyses').fetchone()[0] == 3
        assert db().execute('SELECT count(*) FROM attempts').fetchone()[0] == 0


def test_followup_consent_and_failed_ai_do_not_destroy_report(workspace, monkeypatch):
    client = workspace.test_client()
    register(client)
    connect(client, monkeypatch)
    url = post(client, '/workspace/research', company='Samsung').location
    calls = []
    def plan(*args):
        calls.append(args)
        return {'operation':'memory_price','price_change':-15}, {'model':'test-model', 'usage':{'total_tokens':100}}
    monkeypatch.setattr('app.workspace_routes.research_plan', plan)
    def failed_note(*args):
        raise providers.ProviderError('failed')
    monkeypatch.setattr('app.workspace_routes.explain_research', failed_note)
    params = dict(action='ask',question='What if memory prices fall 15%?', provider_model='deepseek:test-model',
                  explanation_model='deepseek:test-model',flow_through='100')
    post(client, url+'/follow-up', **params)
    assert not calls
    saved = post(client, url+'/follow-up', consent='yes', **params)
    assert len(calls) == 1
    assert b'The AI explanation failed' in client.get(saved.location).data
    assert b'153.38' in client.get(saved.location).data
    assert b'private-api-key' not in client.get(saved.location).data
    with workspace.app_context():
        assert db().execute('SELECT count(*) FROM attempts').fetchone()[0] == 1


def test_typed_jev_plan_uses_only_explicit_magnitude(monkeypatch):
    response = {'answers': {k: {'type':'choice', 'choice':v, 'confidence':.96} for k,v in
                           {'operation':'memory_price','percentage':'p0','direction':'down'}.items()}}
    monkeypatch.setattr(providers, '_request', lambda *args: response)
    plan, metadata = providers.research_plan('typesafe','key','jev-latest','Memory prices fall 15%')
    assert plan['price_change'] == -15
    with pytest.raises(ValueError):
        providers.research_plan('typesafe','key','jev-latest','Memory prices fall 15% and volume rises 5%')
    with pytest.raises(ValueError):
        providers.research_plan('typesafe','key','jev-latest','Memory prices fall +15%')
    response['answers']['operation']['confidence'] = .7
    with pytest.raises(ValueError, match='ambiguous'):
        providers.research_plan('typesafe','key','jev-latest','Memory prices fall 15%')
    response['answers']['operation']['confidence'] = float('nan')
    with pytest.raises(ValueError, match='invalid'):
        providers.research_plan('typesafe','key','jev-latest','Memory prices fall 15%')


def test_deepseek_invalid_ids_and_explanation_payload(monkeypatch):
    calls = []
    def chat(key, model, messages, structured=False):
        calls.append(messages)
        return json.dumps({'operation':'memory_price','percentage':'made-up','direction':'down'}), {}
    monkeypatch.setattr(providers, '_deepseek_chat', chat)
    with pytest.raises(ValueError, match='invalid'):
        providers.research_plan('deepseek','secret','model','Memory prices fall 15%')
    report = build_report()
    report['private_extra'] = 'do-not-send'
    providers.explain_research('secret','model','Explain the report',report)
    payload = json.dumps(calls[-1])
    assert 'do-not-send' not in payload
    assert 'secret' not in payload
    assert '171.5' in payload
    assert '2026_2Q_conference_eng.pdf' in payload
