"""Cost visibility, owner isolation and guards at the actual HTTP boundary."""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier

import pytest
import requests
from flask import g

from app import analysis_providers as providers
from app.api_usage import estimate, finish_call, money, start_call, token_counts, usage_summary
from app.workspace_store import db
from tests.test_workspace import workspace, register, post


def stamp(value):
    return int(datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp())


def test_rates_cache_and_unavailable_are_not_zero():
    peak = stamp('2026-10-02T08:00:00')
    off_peak = stamp('2026-10-03T08:00:00')
    assert estimate('deepseek', 'deepseek-flash', 1000, 100, 200, peak) == (180600, 361200)
    assert estimate('deepseek', 'deepseek-flash', 1000, 100, 200, off_peak) == (180600, 180600)
    assert estimate('deepseek', 'deepseek-flash', 1000, 100, None, off_peak) == (63000, 210000)
    assert estimate('typesafe', 'jev-1.13.0', 1000, 900, None, peak) == (42000, 42000)
    for provider, model, incoming, outgoing, when in [
        ('deepseek', 'new-model', 1000, 10, peak),
        ('deepseek', 'deepseek-flash', 1000, None, peak),
        ('typesafe', 'jev-latest', None, 10, peak),
        ('typesafe', 'jev-latest', 1000, 10, stamp('2026-09-01T08:00:00')),
    ]:
        assert estimate(provider, model, incoming, outgoing, None, when) == (None, None)
    assert token_counts('deepseek', {'prompt_tokens': True, 'completion_tokens': -1}) == (None, None, None)
    assert token_counts('deepseek', {'prompt_tokens': 20, 'prompt_cache_hit_tokens': 21}) == (20, None, None)
    assert money(None) == 'Unavailable'
    assert money(42) == '<$0.000001'
    assert money(42000) == '$0.000042'


def test_profile_is_private_owner_scoped_and_csrf_protected(workspace):
    alice, bob = workspace.test_client(), workspace.test_client()
    assert alice.get('/workspace/profile').status_code == 302
    register(alice)
    register(bob, 'bob')
    with workspace.app_context():
        with db():
            db().execute("INSERT INTO api_usage(user_id,provider,model,purpose,started_at,status,billable,input_tokens,output_tokens,cost_low_nano,cost_high_nano) VALUES (1,'deepseek','deepseek-flash','AI request',?,'received',1,123456,789,123000,246000)", (int(time.time()),))
    response = alice.get('/workspace/profile')
    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'no-store, private'
    assert response.headers['X-Robots-Tag'] == 'noindex, nofollow'
    assert b'123,456' in response.data and b'$0.000123' in response.data
    assert b'123,456' not in bob.get('/workspace/profile?period=all').data
    assert alice.post('/workspace/profile', data={'daily_limit': '1'}).status_code == 400
    assert post(alice, '/workspace/profile', daily_limit='1', paused='yes').status_code == 302
    assert b'API controls saved' in alice.get('/workspace/profile').data
    post(alice, '/workspace/profile', daily_limit='999')
    assert b'Choose a request limit between 1 and 30' in alice.get('/workspace/profile').data
    assert post(alice, '/workspace/profile', daily_limit='9' * 5000).status_code == 302


def test_transport_records_tests_failures_and_rejected_answers(workspace, monkeypatch):
    client = workspace.test_client(); register(client)
    calls = []
    class Response:
        status_code = 200
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def iter_content(self, size):
            yield json.dumps({'model': 'jev-1.13.0', 'usage': {'input_tokens': 1000, 'output_tokens': 20},
                              'answers': {'connected': {'type': 'noul', 'noul': 1}}}).encode()
    def send(*args, **kwargs):
        calls.append(1)
        return Response()
    monkeypatch.setattr(providers.requests, 'request', send)
    post(client, '/workspace/settings', action='connect', provider='typesafe', api_key='fixture-private-key', consent='yes')
    with workspace.app_context():
        row = db().execute('SELECT * FROM api_usage').fetchone()
        assert row['purpose'] == 'Connection test' and row['input_tokens'] == 1000
        assert row['cost_high_nano'] == 42000
        assert 'fixture-private-key' not in json.dumps(dict(row))
    # Account controls block actual outbound calls, including connection tests.
    post(client, '/workspace/profile', daily_limit='1')
    post(client, '/workspace/settings', action='connect', provider='typesafe', api_key='another-fixture-key', consent='yes')
    assert len(calls) == 1
    assert b'request limit' in client.get('/workspace/settings').data
    post(client, '/workspace/profile', daily_limit='30')
    def timeout(*a, **kw):
        raise requests.Timeout('fixture-private-key must never appear')
    monkeypatch.setattr(providers.requests, 'request', timeout)
    post(client, '/workspace/settings', action='connect', provider='typesafe', api_key='fixture-private-key', consent='yes')
    with workspace.app_context():
        row = db().execute('SELECT * FROM api_usage ORDER BY id DESC').fetchone()
        assert row['status'] == 'failed' and row['cost_low_nano'] is None
    html = client.get('/workspace/profile').text
    assert '1 request with unknown cost excluded' in html and 'fixture-private-key' not in html
    # A parse/validation failure after a paid response still records its tokens.
    monkeypatch.setattr(providers.requests, 'request', send)
    with workspace.test_request_context('/workspace/test'):
        g.workspace_user = {'id': 1}
        with pytest.raises(providers.ProviderError):
            providers._deepseek_chat('fixture-key', 'deepseek-flash', [])
        row = db().execute('SELECT * FROM api_usage ORDER BY id DESC').fetchone()
        assert row['status'] == 'received' and row['cost_low_nano'] is None


def test_pause_and_request_size_prevent_network_io_but_free_calls_work(workspace, monkeypatch):
    client = workspace.test_client(); register(client)
    post(client, '/workspace/profile', daily_limit='30', paused='yes')
    calls = []
    monkeypatch.setattr(providers, '_send', lambda *a: calls.append(1) or {'data': [{'id': 'deepseek-flash'}]})
    with workspace.test_request_context('/workspace/settings'):
        g.workspace_user = {'id': 1}
        with pytest.raises(providers.ProviderError, match='paused'):
            providers.test_key('typesafe', 'fixture-key')
        with pytest.raises(providers.ProviderError, match='too large'):
            providers._request('deepseek', 'fixture-key', {'model': 'deepseek-flash', 'messages': ['x' * 100000]})
        assert not calls
        assert providers.test_key('deepseek', 'fixture-key') == ['deepseek-flash']
        sec = start_call('sec', billable=False)
        finish_call(sec, failed=True)
        assert db().execute('SELECT count(*) FROM api_usage WHERE billable=1').fetchone()[0] == 0
        assert db().execute('SELECT cost_high_nano FROM api_usage WHERE provider="sec"').fetchone()[0] == 0


def test_limit_reservation_is_atomic_across_workers(workspace):
    client = workspace.test_client(); register(client)
    post(client, '/workspace/profile', daily_limit='1')
    barrier = Barrier(2)
    def reserve():
        with workspace.test_request_context('/workspace/test'):
            g.workspace_user = {'id': 1}
            barrier.wait()
            try:
                return start_call('deepseek', 'deepseek-flash')
            except ValueError:
                return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: reserve(), range(2)))
    assert sum(result is not None for result in results) == 1


def test_old_tokens_recovered_once_without_repricing_or_double_counting(workspace):
    client = workspace.test_client(); register(client)
    with workspace.app_context():
        cutoff = db().execute("SELECT value FROM usage_metadata WHERE name='tracking_started'").fetchone()[0]
        result = {'provider_metadata': {'model': 'deepseek-flash', 'usage': {'prompt_tokens': 10, 'completion_tokens': 5}},
                  'explanation_usage': {'model': 'deepseek-flash', 'usage': {'prompt_tokens': 20, 'completion_tokens': 6}}}
        with db():
            db().execute('INSERT INTO analyses VALUES (?,?,?,?,?,?,?,?)',
                         ('old', 1, 'private title', 'private workbook', 'private question', 'deepseek', json.dumps(result), cutoff-86400))
            db().execute('INSERT INTO analyses VALUES (?,?,?,?,?,?,?,?)',
                         ('new', 1, 'private title', 'private workbook', 'private question', 'deepseek', json.dumps(result), cutoff+1))
        summary = usage_summary(1, 'all')
        assert summary['tokens'] == 41 and summary['paid_requests'] == 2
        assert summary['unknown_cost'] == 2 and summary['cost'] == 'Unavailable'
        assert usage_summary(1, 'all')['paid_requests'] == 2
        assert 'private question' not in json.dumps(summary)
        assert summary['today_used'] == 0


def test_no_extra_explanation_is_invented_for_old_answers(workspace):
    client = workspace.test_client(); register(client)
    with workspace.app_context():
        with db():
            db().execute('INSERT INTO analyses VALUES (?,?,?,?,?,?,?,?)',
                         ('old', 1, 'title', 'book', 'question', 'typesafe',
                          json.dumps({'provider_metadata': {'model': 'jev-latest', 'usage': {'input_tokens': 33}}}), 1))
        summary = usage_summary(1, 'all')
        assert summary['paid_requests'] == 1 and summary['tokens'] == 33


def test_month_filter_and_unknown_subtotal(workspace):
    client = workspace.test_client(); register(client)
    with workspace.app_context():
        with db():
            for when, cost in ((1, 999000000), (int(time.time()), None)):
                db().execute('INSERT INTO api_usage(user_id,provider,model,purpose,started_at,status,billable,cost_low_nano,cost_high_nano) '
                             "VALUES (1,'typesafe','unknown','AI request',?,'failed',1,?,?)", (when, cost, cost))
        assert usage_summary(1)['cost'] == 'Unavailable'
        summary = usage_summary(1, 'all')
        assert summary['cost'] == '$0.999' and summary['unknown_cost'] == 1


def test_free_model_list_does_not_turn_unknown_ai_cost_into_zero(workspace):
    client = workspace.test_client(); register(client)
    with workspace.test_request_context('/workspace/settings'):
        g.workspace_user = {'id': 1}
        free = start_call('deepseek', billable=False)
        finish_call(free, {'data': []})
        paid = start_call('deepseek', 'unknown-model')
        finish_call(paid, {'usage': {'prompt_tokens': 50, 'completion_tokens': 10}})
        summary = usage_summary(1)
        assert summary['cost'] == 'Unavailable' and summary['providers'][0]['cost'] == 'Unavailable'
