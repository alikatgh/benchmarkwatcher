import time

import pytest

from app import create_app, sec_client
from app import native_research as native
from tests.sec_fixture import CIK, fake_fetch


@pytest.fixture
def api(tmp_path, monkeypatch):
    class Config:
        TESTING = True
        SECRET_KEY = 'test-only'
        WORKSPACE_ENABLED = False
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = False
        SEC_CACHE_DB = str(tmp_path / 'sec.sqlite3')
        NATIVE_REPORTS_PER_HOUR = 2
    app = create_app(Config)
    monkeypatch.setattr(sec_client, 'fetch', fake_fetch)
    return app


def test_anonymous_contract_preserves_financial_provenance(api):
    client = api.test_client()
    matches = client.get('/api/v1/research/companies?q=APPL')
    assert matches.status_code == 200
    assert matches.json['companies'][0]['suggested']
    report = client.get(f'/api/v1/research/companies/{CIK}')
    assert report.status_code == 200
    assert report.json['schema_version'] == 1
    body = report.json['report']
    point = next(m for m in body['metrics'] if m['id'] == 'revenue')['values']['FY2025']
    assert point['value'] == 1_400_000_000
    assert point['sources'][0]['url'].startswith('https://www.sec.gov/Archives/')
    assert body['excerpts'] == []  # No expensive filing-HTML fan-out.
    assert 'public' in report.headers['Cache-Control']
    assert client.get(f'/api/v1/research/companies/{CIK}', headers={'If-None-Match': report.headers['ETag']}).status_code == 304
    assert not any(word in report.text for word in ('user_id', 'password', 'api_key', 'workspace_user'))


def test_cached_report_never_rebuilds_and_quota_holds(api, monkeypatch):
    client = api.test_client()
    original = native.build_company_report
    calls = []
    def build(cik, **kwargs):
        calls.append(cik)
        return original(cik, **kwargs)
    monkeypatch.setattr(native, 'build_company_report', build)
    assert client.get(f'/api/v1/research/companies/{CIK}').status_code == 200
    assert client.get(f'/api/v1/research/companies/{CIK}').status_code == 200
    assert calls == [CIK]
    assert client.get('/api/v1/research/companies/0000000002').status_code == 200
    busy = client.get('/api/v1/research/companies/0000000003')
    assert busy.status_code == 503 and 'hourly capacity' in busy.json['error']
    assert busy.headers['Retry-After'] == '60'
    assert calls == [CIK, '0000000002']


def test_leases_and_stale_fallback_keep_saved_evidence(api, monkeypatch):
    client = api.test_client()
    assert client.get(f'/api/v1/research/companies/{CIK}').status_code == 200
    with api.app_context(), sec_client.connection() as conn:
        conn.execute('UPDATE native_reports SET fetched=?,lease=? WHERE cik=?', (time.time()-7200, time.time()+60, CIK))
    stale = client.get(f'/api/v1/research/companies/{CIK}')
    assert stale.status_code == 200 and stale.json['report']['stale']
    with api.app_context(), sec_client.connection() as conn:
        conn.execute('UPDATE native_reports SET lease=0 WHERE cik=?', (CIK,))
    def unavailable(*args, **kwargs):
        raise sec_client.SECError('Temporarily unavailable')
    monkeypatch.setattr(native, 'build_company_report', unavailable)
    assert client.get(f'/api/v1/research/companies/{CIK}').json['report']['stale']
    with api.app_context(), sec_client.connection() as conn:
        assert conn.execute('SELECT lease FROM native_reports WHERE cik=?', (CIK,)).fetchone()[0] == 0


def test_invalid_inputs_and_unknown_issuers_fail_closed(api, monkeypatch):
    client = api.test_client()
    monkeypatch.setattr(native, 'search_companies', lambda q: pytest.fail('Empty input must not download'))
    assert client.get('/api/v1/research/companies?q=A').json['companies'] == []
    assert client.get('/api/v1/research/companies?q='+'a'*101).status_code == 400
    for cik in ('1', 'abcdefghij', '１２３４５６７８９０'):
        assert client.get('/api/v1/research/companies/'+cik).status_code == 400
    unknown = client.get('/api/v1/research/companies/0000000003')
    assert unknown.status_code == 503 and unknown.headers['Cache-Control'] == 'no-store'


def test_native_routes_have_anonymous_rate_limits(api):
    from types import SimpleNamespace
    config = dict(api.config, RATELIMIT_ENABLED=True, RATELIMIT_STORAGE_URI='memory://')
    app = create_app(SimpleNamespace(**config))
    from app.extensions import limiter
    limiter.reset()
    try:
        client = app.test_client()
        statuses = [client.get('/api/v1/research/companies?q=A').status_code for _ in range(31)]
        assert statuses[-1] == 429
    finally:
        limiter.enabled = False
