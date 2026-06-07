"""Error-page tests — render correctness, the 404 path, and brand fidelity.

The 404/429/500 pages were the last unbranded surface (stock `slate-*` colors)
and had ZERO test coverage. These guards lock in the fix:
- they extend base.html and render without a Jinja error,
- they carry the FT brand tokens (`text-brand-*`) and NOT stock `slate-*`,
- the 404 path works end-to-end (unknown route AND unknown commodity).

The brand guard checks the *whole* rendered page; base/header/footer are
themselves brand-clean (0 off-brand colors), so any `slate-` would be a real
regression in the error template.
"""
from flask import render_template

# app_client fixture is provided by conftest.py


# ------------------------------------------------------------------
# 404 — end-to-end through the real handler
# ------------------------------------------------------------------

def test_404_unknown_route_renders_branded(app_client):
    resp = app_client.get("/this-route-does-not-exist")
    assert resp.status_code == 404
    body = resp.get_data(as_text=True)
    assert "404" in body
    assert "Page not found" in body
    assert "Back to dashboard" in body
    # forward action (the UX fix) and brand tokens present; no stock slate
    assert "Browse all benchmarks" in body
    assert "text-brand-" in body
    assert "slate-" not in body


def test_404_unknown_commodity_uses_error_page(app_client):
    # routes.py abort(404) path for a missing commodity id
    resp = app_client.get("/commodity/no-such-commodity")
    assert resp.status_code == 404
    assert "Page not found" in resp.get_data(as_text=True)


# ------------------------------------------------------------------
# All three templates: render + on-brand (429/500 can't be triggered
# via the client without forcing real errors, so render them directly)
# ------------------------------------------------------------------

def test_error_templates_render_on_brand(app_client):
    app = app_client.application
    cases = [
        ("errors/404.html", "404", "Page not found"),
        ("errors/429.html", "429", "Too many requests"),
        ("errors/500.html", "500", "Something went wrong"),
    ]
    for template, code, headline in cases:
        with app.test_request_context("/"):
            html = render_template(template)
        assert code in html, template
        assert headline in html, template
        assert "text-brand-" in html, f"{template} missing brand tokens"
        assert "slate-" not in html, f"{template} leaked stock slate colors"
