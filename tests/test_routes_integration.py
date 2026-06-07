"""Integration tests for Flask routes using the test client.

These tests exercise actual HTTP request/response cycles through the app,
unlike test_routes_helpers.py which tests helper functions in isolation.
"""
import re

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
    assert body["meta"]["summary"]["total"] == 1


def test_api_commodities_respects_category_filter(app_client):
    resp = app_client.get("/api/commodities?category=precious")
    body = resp.get_json()
    assert body["meta"]["count"] == 1
    assert body["meta"]["summary"]["total"] == 1
    assert body["meta"]["summary"]["categories"][0]["name"] == "Precious"

    resp = app_client.get("/api/commodities?category=energy")
    body = resp.get_json()
    assert body["meta"]["count"] == 0
    assert body["meta"]["summary"]["total"] == 0
    assert body["meta"]["summary"]["categories"] == []


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
    assert "summary" not in body["meta"]

    # Since date before → returns the commodity
    resp = app_client.get("/api/commodities?since=2023-01-01")
    body = resp.get_json()
    assert body["meta"]["count"] == 1


def test_api_commodities_invalid_since_rejects_without_full_payload(app_client):
    resp = app_client.get("/api/commodities?since=2999-01-01")
    body = resp.get_json()

    assert resp.status_code == 400
    assert body["data"] == []
    assert body["meta"]["count"] == 0
    assert body["meta"]["since"] == "2999-01-01"
    assert body["meta"]["partial"] is True
    assert "summary" not in body["meta"]
    assert "Invalid since parameter" in body["error"]


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


def test_index_category_nav_preserves_range_and_view(app_client):
    resp = app_client.get("/?range=1M&view=compact")
    assert resp.status_code == 200
    assert b"category=index&amp;range=1M&amp;view=compact" in resp.data
    assert b"range=1M&amp;view=compact" in resp.data
    assert b"Indices" in resp.data


def test_index_selected_category_marks_active_nav_and_pulse_link(app_client):
    resp = app_client.get("/?category=precious&range=1M&view=compact")
    assert resp.status_code == 200
    assert b'aria-current="page">Precious</a>' in resp.data
    assert b'aria-current="page">All</a>' not in resp.data
    assert b'href="/?category=precious&amp;range=1M&amp;view=compact"' in resp.data
    assert b'id="market-pulse-total">1</span>' in resp.data


def test_index_quick_find_controls_and_item_metadata_render(app_client):
    resp = app_client.get("/")
    assert resp.status_code == 200
    assert b'id="quick-find-input"' in resp.data
    assert b'id="quick-find-export"' in resp.data
    assert b'id="quick-find-summary"' in resp.data
    assert b'data-quick-filter="up"' in resp.data
    assert b'data-id="gold"' in resp.data
    assert b'data-frequency="daily"' in resp.data
    assert b'data-direction="up"' in resp.data


def test_index_empty_mover_card_is_not_actionable(app_client):
    resp = app_client.get("/")
    html = resp.data.decode("utf-8")
    match = re.search(r'<a id="market-pulse-drop-link"(?P<attrs>[^>]*)>', html)

    assert resp.status_code == 200
    assert match is not None
    attrs = match.group("attrs")
    assert "href=" not in attrs
    assert 'aria-disabled="true"' in attrs
    assert 'tabindex="-1"' in attrs


def test_commodity_detail_page_loads(app_client):
    resp = app_client.get("/commodity/gold")
    assert resp.status_code == 200


def test_commodity_detail_page_404(app_client):
    resp = app_client.get("/commodity/nonexistent")
    assert resp.status_code == 404


def test_changelog_page_loads(app_client):
    resp = app_client.get("/changelog")
    assert resp.status_code == 200
