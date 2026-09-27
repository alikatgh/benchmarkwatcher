"""Only explicitly trusted deployments consume proxy headers."""
from flask import request
from app import create_app


def test_forwarded_addresses_require_explicit_proxy_trust():
    for trusted, expected_ip, expected_scheme in ((False, '127.0.0.1', 'http'), (True, '198.51.100.20', 'https')):
        class Config:
            TESTING = True
            SECRET_KEY = 'test'
            CACHE_TYPE = 'NullCache'
            RATELIMIT_ENABLED = False
            WORKSPACE_ENABLED = False
            TRUST_PROXY_HEADERS = trusted
        app = create_app(Config)

        @app.get('/proxy-test')
        def inspect():
            return {'ip': request.remote_addr, 'scheme': request.scheme, 'host': request.host}

        response = app.test_client().get('/proxy-test', headers={
            'X-Forwarded-For': '203.0.113.99, 198.51.100.20',
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-Host': 'untrusted.example',
        })
        assert response.json == {'ip': expected_ip, 'scheme': expected_scheme, 'host': 'localhost'}
