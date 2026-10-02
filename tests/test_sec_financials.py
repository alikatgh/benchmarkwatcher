import copy
from datetime import date
import json

import pytest
from flask import Flask

from app import company_financials as f
from app import sec_client
from app.company_answers import local_answer, provider_answer
from app.sec_inline import parse_filing
from tests.sec_fixture import CIK, evidence, fake_fetch, filing


@pytest.fixture
def report(monkeypatch):
    monkeypatch.setattr(sec_client, 'fetch', fake_fetch)
    monkeypatch.setattr(f, 'fetch', fake_fetch)
    return f.build_company_report(CIK)


def metric(report, key):
    return next(m for m in report['metrics'] if m['id']==key)['values']


def test_financial_statements_derived_quarters_ttm_and_sources(report):
    assert metric(report,'revenue')['FY2025']['value'] == 1_400_000_000
    cash = metric(report,'operating_cash')
    assert cash['Q2-2025']['value'] == pytest.approx(96_600_000)
    assert cash['Q4-2025']['value'] == pytest.approx(126_000_000)
    assert 'Derived quarter' in cash['Q4-2025']['method']
    assert len(cash['Q4-2025']['sources']) == 2
    assert metric(report,'free_cash')['FY2025']['value'] == 308_000_000
    assert metric(report,'free_cash')['TTM-Q4-2025']['value'] == pytest.approx(308_000_000)
    assert metric(report,'net_margin')['TTM-Q4-2025']['value'] == 20
    assert metric(report,'cash')['TTM-Q4-2025']['value'] == 700_000_000
    assert set(metric(report,'eps')) == {f'FY{y}' for y in range(2020,2026)}
    assert all(s['url'].startswith('https://www.sec.gov/Archives/') for s in report['sources'])
    business = next(m for m in report['metrics'] if m['section']=='business')
    assert business['values']['FY2025']['value'] == 700_000_000
    assert business['values']['FY2025']['sources'][0]['url'].endswith('#devices')
    assert 'Inventories' in report['missing']


def test_restatement_currency_zero_and_invalid_facts():
    _, raw = evidence()
    rows = raw['facts']['us-gaap']['NetIncomeLoss']['units']['USD']
    original = next(p for p in rows if p['start']=='2025-01-01' and p['end']=='2025-12-31')
    rows.extend([dict(original,val=0,filed='2026-03-01',form='10-K/A'),dict(original,val=999999,filed='2026-04-01',form='8-K'),dict(original,val=float('nan'),filed='2026-05-01')])
    raw['facts']['us-gaap']['NetIncomeLoss']['units']['EUR']=[dict(original,val=22)]
    selected=f._candidates(raw['facts'],['NetIncomeLoss'],'USD','flow',CIK,{})
    result=next(p for p in selected if p['start']=='2025-01-01' and p['end']=='2025-12-31')
    assert result['value']==0 and result['sources'][0]['form']=='10-K/A'
    assert result['unit']=='USD'
    assert f.formula('mix',[result,dict(result,unit='EUR')],lambda a,b:a+b) is None


def test_fiscal_calendar_and_53_week_boundary():
    assert f.period_for('2025-12-27',[date(2025,9,27)])[:2] == ('Q1-2026','Q1 2026')
    assert f.period_for('2026-09-28',[date(2025,9,27)])[0] == 'Q4-2026'
    assert f.period_for('2025-03-31',[date(2025,12,31)])[0] == 'Q1-2025'


def test_gaps_do_not_become_quarters_or_trailing_totals(monkeypatch):
    submissions, raw = evidence()
    # A missing Q2 cumulative disclosure prevents standalone Q2 and Q3 cash flow.
    vals=raw['facts']['us-gaap']['NetCashProvidedByUsedInOperatingActivities']['units']['USD']
    vals[:]=[v for v in vals if not (v.get('start')=='2025-01-01' and v['end']=='2025-06-30')]
    monkeypatch.setattr(f,'issuer_data',lambda cik:(submissions,raw,[],1786000000,False))
    report=f.build_company_report(CIK,fetch_documents=False)
    assert 'Q2-2025' not in metric(report,'operating_cash')
    assert 'Q3-2025' not in metric(report,'operating_cash')
    assert 'TTM-Q4-2025' not in metric(report,'operating_cash')
    with pytest.raises(ValueError,match='Missing data'):
        f.calculate_company(report,'operating_cash','change','Q1-2025','Q2-2025')


def test_banking_insurance_and_ifrs_templates(monkeypatch):
    for sic, expected in [('6021','net_interest'),('6311','premiums')]:
        submissions, raw = evidence(sic=sic)
        monkeypatch.setattr(f,'issuer_data',lambda cik:(submissions,raw,[],1786000000,False))
        report=f.build_company_report(CIK,fetch_documents=False)
        ids={m['id'] for m in report['metrics']}
        assert expected in ids and 'free_cash' not in ids and 'net_margin' not in ids
    submissions, raw=evidence(currency='EUR',taxonomy='ifrs-full')
    gaap=raw['facts']['ifrs-full']
    for old,new in [('RevenueFromContractWithCustomerExcludingAssessedTax','Revenue'),('NetIncomeLoss','ProfitLossAttributableToOwnersOfParent'),('NetCashProvidedByUsedInOperatingActivities','CashFlowsFromUsedInOperatingActivities')]: gaap[new]=gaap.pop(old)
    for item in gaap.values():
        for values in item['units'].values():
            for value in values: value['form']='20-F'
    monkeypatch.setattr(f,'issuer_data',lambda cik:(submissions,raw,[],1786000000,False))
    report=f.build_company_report(CIK,fetch_documents=False)
    assert report['currency']=='EUR'
    assert metric(report,'revenue')['FY2025']['unit']=='EUR'


def test_insurance_customer_fees_are_not_total_revenue(monkeypatch):
    submissions, raw=evidence(sic='6311')
    fees=raw['facts']['us-gaap']['RevenueFromContractWithCustomerExcludingAssessedTax']
    raw['facts']['us-gaap']['Revenues']=copy.deepcopy(fees)
    for p in fees['units']['USD']: p['val']/=10
    monkeypatch.setattr(f,'issuer_data',lambda cik:(submissions,raw,[],1786000000,False))
    report=f.build_company_report(CIK,fetch_documents=False)
    assert metric(report,'revenue')['FY2025']['value']==1_400_000_000


def test_inline_scaling_nil_and_dimension_safety():
    html=filing()
    facts,_=parse_filing(html.replace('scale="6">700','scale="3" sign="-">1,250'))
    assert facts[0]['value']==-1_250_000
    assert facts[0]['dimensions']==[('us-gaap:ProductOrServiceAxis','example:DevicesMember')]
    facts,_=parse_filing(html.replace('scale="6"','xsi:nil="true" scale="6"'))
    assert facts==[]
    typed=html.replace('</xbrli:segment>','<xbrldi:typedMember dimension="custom:Axis">private</xbrldi:typedMember></xbrli:segment>')
    facts,_=parse_filing(typed)
    assert len(facts[0]['dimensions'])==2
    facts,_=parse_filing(html.replace('scale="6">700','format="ixt:num-comma-decimal" scale="3">1.250,25'))
    assert facts[0]['value']==1_250_250


def test_search_typos_are_suggestions_and_urls_are_bounded(monkeypatch,tmp_path):
    monkeypatch.setattr(sec_client,'fetch',fake_fetch)
    matches,_=sec_client.search_companies('appl')
    assert matches[0]['ticker']=='AAPL' and matches[0]['suggested'] and not matches[0]['exact']
    assert sec_client.search_companies('Nasdaq:AAPL')[0][0]['exact']
    assert sec_client.search_companies('xyznotacompany')[0]==[]
    assert not sec_client.filing_url('../../', '0000000001-26-000001')
    assert '..' not in sec_client.filing_url(CIK,'0000000001-26-000001','../../secret.htm')


def test_fetch_allowlist_cache_stale_fallback_and_private_permissions(monkeypatch,tmp_path):
    app=Flask(__name__); app.config['WORKSPACE_DB']=str(tmp_path/'workspace.db')
    calls=[]
    def download(url,limit): calls.append(url); return b'{"valid":true}'
    monkeypatch.setattr(sec_client,'_download',download)
    with app.app_context():
        for url in ['http://www.sec.gov/a','https://evil.example/a','https://www.sec.gov@evil.example/a','https://data.sec.gov/a?q=1']:
            with pytest.raises(sec_client.SECError): sec_client.fetch(url)
        url='https://data.sec.gov/test.json'
        assert sec_client.json_data(url)[0]=={'valid':True}
        assert sec_client.json_data(url)[2] is False and len(calls)==1
        def fail(url,limit): raise sec_client.SECError('temporarily unavailable')
        monkeypatch.setattr(sec_client,'_download',fail)
        assert sec_client.fetch(url,ttl=0)[2] is True
    assert (tmp_path/'sec-cache.sqlite3').stat().st_mode & 0o077 == 0


def test_local_questions_followups_and_provider_evidence(report,monkeypatch):
    answer=local_answer(report,'Compare revenue in 2024 and 2025')
    assert answer['calculations'][0]['difference']==200_000_000
    assert local_answer(report,'Compare Q1 2025 and Q2 2025','revenue')['calculations'][0]['difference']==42_000_000
    assert local_answer(report,'Give me an overview','revenue')['calculations']==[]
    with pytest.raises(ValueError): local_answer(report,'Forecast next year revenue')
    with pytest.raises(ValueError): local_answer(report,'Revenue for 2032')
    captured=[]
    def chat(key,model,messages): captured.extend(messages); return 'Filing-based discussion. [S1]',{}
    monkeypatch.setattr('app.company_answers._deepseek_chat',chat)
    answer=provider_answer(report,'Discuss revenue','deepseek','synthetic-key','test-model')
    assert answer['ai'] and answer['sources']
    evidence_json=json.loads(captured[-1]['content'])['evidence']
    assert evidence_json['metrics'] and 'filing_excerpts' in evidence_json
    assert 'synthetic-key' not in json.dumps(captured) and 'workbook' not in json.dumps(evidence_json)
    monkeypatch.setattr('app.company_answers._deepseek_chat',lambda *a:('Wrong source [S999]',{}))
    with pytest.raises(ValueError,match='invalid source'): provider_answer(report,'revenue','deepseek','key','model')
