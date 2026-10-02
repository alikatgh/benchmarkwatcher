import json
from unittest.mock import Mock

import pytest

from app import company_financials, sec_client
from app.workspace_store import db
from tests.sec_fixture import CIK, fake_fetch
from tests.test_workspace import workspace, register, post, csrf, connect, model_url


@pytest.fixture
def companies(workspace,monkeypatch):
    workspace.config['WORKBOOK_LIBRARY_ENABLED']=False
    monkeypatch.setattr(sec_client,'fetch',fake_fetch)
    monkeypatch.setattr(company_financials,'fetch',fake_fetch)
    return workspace


def open_report(client):
    response=post(client,'/workspace/companies/open',cik=CIK)
    assert response.status_code==302
    return response.location


def test_company_home_replaces_examples_and_saved_reports_are_owned(companies):
    a,b=companies.test_client(),companies.test_client()
    assert a.get('/workspace/companies/search?q=AAPL').status_code==302
    register(a)
    home=a.get('/workspace/').get_data(as_text=True)
    assert 'Start with a company.' in home
    assert 'Workbook library' not in home and 'DEMO' not in home
    assert a.get(model_url(companies)).status_code==404
    assert a.get('/workspace/companies/search?q=APPL').json['companies'][0]['suggested']
    assert a.post('/workspace/companies/open',data={'cik':CIK}).status_code==400
    url=open_report(a)
    response=a.get(url)
    assert response.status_code==200
    assert b'Example Devices (synthetic)' in response.data and b'company-report-data' in response.data
    assert response.headers['Cache-Control']=='no-store, private'
    assert open_report(a)==url  # Identical evidence reuses the immutable snapshot.
    register(b,'bob')
    assert b.get(url).status_code==404
    assert post(b,url+'/ask',question='Revenue').status_code==404
    assert b.get(url+'/export.csv').status_code==404
    assert a.get('/workspace/').data.count(b'Financial report')==1


def test_company_followups_export_missing_and_consent(companies,monkeypatch):
    client=companies.test_client();register(client);url=open_report(client)
    response=post(client,url+'/ask',question='Compare revenue in 2024 and 2025')
    assert response.status_code==200 and '200M' in response.json['html']
    previous=response.json['id']
    response=post(client,url+'/ask',question='Compare Q1 2025 and Q2 2025',previous=previous)
    assert response.status_code==200 and '42M' in response.json['html']
    assert post(client,url+'/ask',question='Compare Q1 2025 and 2025',previous=previous).status_code==422
    assert post(client,url+'/calculate',metric='unknown',operation='series').status_code==422
    response=post(client,url+'/calculate',metric='revenue',operation='change',start='FY2024',end='FY2025')
    assert response.json['result']['difference']==200_000_000
    export=client.get(url+'/export.csv')
    assert export.status_code==200 and export.mimetype=='text/csv'
    assert 'Filing sources' in export.text and 'https://www.sec.gov/Archives/' in export.text
    assert 'Model!' not in export.text
    connect(client,monkeypatch)
    provider=Mock(return_value={'kind':'company_answer','text':'Synthetic answer [S1]','calculations':[],'metric_id':None,'sources':[],'ai':True})
    monkeypatch.setattr('app.company_routes.provider_answer',provider)
    assert post(client,url+'/ask',question='Discuss revenue',provider='deepseek:test-model').status_code==422
    assert not provider.called
    with companies.app_context(): assert db().execute('SELECT COUNT(*) FROM attempts').fetchone()[0]==0
    assert post(client,url+'/ask',question='Discuss revenue',provider='deepseek:test-model',consent='yes').status_code==200
    assert provider.call_count==1
    assert 'Compare revenue' in client.get(url).text


def test_sec_unavailable_is_honest_and_creates_no_report(companies):
    client=companies.test_client();register(client)
    response=client.post('/workspace/companies/open',data={'csrf':csrf(client),'cik':'0000000003'},headers={'Accept':'application/json'})
    assert response.status_code==503 and 'No supported' in response.json['error']
    with companies.app_context(): assert db().execute('SELECT COUNT(*) FROM company_reports').fetchone()[0]==0


def test_saved_legacy_analysis_survives_catalog_removal(companies):
    # Existing results are owned snapshots and do not require example files.
    from tests.test_workspace import model_url
    client=companies.test_client();register(client)
    companies.config['WORKBOOK_LIBRARY_ENABLED']=True
    from app.model_library import load_model
    with companies.app_context():
        from app.model_library import catalog
        book=load_model(companies.config['MODEL_LIBRARY_DIR'],catalog(companies.config['MODEL_LIBRARY_DIR'])[0]['id'])
    result=post(client,model_url(companies),action='manual',metric=book['metrics'][0]['id'],operation='series')
    assert result.status_code==302
    companies.config['WORKBOOK_LIBRARY_ENABLED']=False
    assert client.get(result.location).status_code==200
    assert 'Earlier saved analyses' in client.get('/workspace/').text
