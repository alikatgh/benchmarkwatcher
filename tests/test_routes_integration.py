"""Integration tests for Flask routes using the test client.

These tests exercise actual HTTP request/response cycles through the app,
unlike test_routes_helpers.py which tests helper functions in isolation.
"""

# app_client fixture is provided by conftest.py


# ------------------------------------------------------------------
# Public list endpoint
# ------------------------------------------------------------------

def test_api_commodities_returns_json_envelope(app_client):
    resp = app_client.get("/api/commodities")
    assert resp.status_code == 200
    body = resp.get_json()
    assert "data" in body
    assert "meta" in body
    assert body["meta"]["count"] == 1


def test_api_commodities_respects_category_filter(app_client):
    resp = app_client.get("/api/commodities?category=precious")
    assert resp.get_json()["meta"]["count"] == 1

    resp = app_client.get("/api/commodities?category=energy")
    assert resp.get_json()["meta"]["count"] == 0


def test_api_commodities_range_param(app_client):
    resp = app_client.get("/api/commodities?range=1W")
    body = resp.get_json()
    assert body["meta"]["range"] == "1W"


def test_api_commodities_invalid_range_defaults_to_all(app_client):
    resp = app_client.get("/api/commodities?range=INVALID")
    body = resp.get_json()
    assert body["meta"]["range"] == "ALL"


def test_api_commodities_since_incremental(app_client):
    # Since date after the commodity's latest date → no results
    resp = app_client.get("/api/commodities?since=2025-01-01")
    body = resp.get_json()
    assert body["meta"]["count"] == 0
    assert body["meta"]["partial"] is True

    # Since date before → returns the commodity
    resp = app_client.get("/api/commodities?since=2023-01-01")
    body = resp.get_json()
    assert body["meta"]["count"] == 1


def test_api_commodities_include_history(app_client):
    resp = app_client.get("/api/commodities?include_history=true")
    items = resp.get_json()["data"]
    assert "history" in items[0]

    resp = app_client.get("/api/commodities?include_history=false")
    items = resp.get_json()["data"]
    assert "history" not in items[0]


# ------------------------------------------------------------------
# Public detail endpoint
# ------------------------------------------------------------------

def test_api_commodity_detail_returns_data(app_client):
    resp = app_client.get("/api/commodity/gold")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["data"]["id"] == "gold"
    assert "history" in body["data"]


def test_api_commodity_detail_not_found(app_client):
    resp = app_client.get("/api/commodity/nonexistent")
    assert resp.status_code == 404
    body = resp.get_json()
    assert "error" in body


# ------------------------------------------------------------------
# Internal API endpoint
# ------------------------------------------------------------------

def test_internal_api_requires_key(app_client):
    resp = app_client.get("/internal/api/commodities")
    assert resp.status_code == 403


def test_internal_api_rejects_wrong_key(app_client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "correct-key")
    resp = app_client.get(
        "/internal/api/commodities",
        headers={"X-Internal-Key": "wrong-key"},
    )
    assert resp.status_code == 403


def test_internal_api_accepts_valid_key(app_client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_KEY", "correct-key")
    resp = app_client.get(
        "/internal/api/commodities",
        headers={"X-Internal-Key": "correct-key"},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["meta"]["count"] == 1


# ------------------------------------------------------------------
# Error handlers
# ------------------------------------------------------------------

def test_404_json_for_api_paths(app_client):
    resp = app_client.get("/api/nonexistent")
    assert resp.status_code == 404
    body = resp.get_json()
    assert body["error"] == "Not found"


def test_404_html_for_browser_paths(app_client):
    resp = app_client.get(
        "/nonexistent-page",
        headers={"Accept": "text/html"},
    )
    assert resp.status_code == 404
    assert b"Page not found" in resp.data


# ------------------------------------------------------------------
# HTML pages
# ------------------------------------------------------------------

def test_index_page_loads(app_client):
    resp = app_client.get("/")
    assert resp.status_code == 200
    assert b"BenchmarkWatcher" in resp.data


def test_commodity_detail_page_loads(app_client):
    resp = app_client.get("/commodity/gold")
    assert resp.status_code == 200


def test_commodity_detail_page_404(app_client):
    resp = app_client.get("/commodity/nonexistent")
    assert resp.status_code == 404


def test_changelog_page_loads(app_client):
    resp = app_client.get("/changelog")
    assert resp.status_code == 200
