"""The durable detail route must retain unavailable and zero source values."""
import re

import pytest


@pytest.mark.parametrize("price,change,percent,expected", [
    (None, None, None, "Unavailable"),
    (0, 0, 0, "0.00"),
    (12.5, -2.5, -16.67, "12.50"),
])
def test_detail_handles_missing_and_zero_observations(
    app_client, monkeypatch, price, change, percent, expected
):
    record = {
        "id": "test_benchmark", "name": "Source observation", "category": "metals",
        "price": price, "change": change, "change_percent": percent,
        "currency": "USD", "unit": "tonne", "date": "2025-05-01",
        "is_daily": False, "prev_price": None, "prev_date": None,
        "source_name": "Public source", "source_url": "https://example.org/source",
        "updated_at": None, "derived_stats": {}, "history": [],
    }
    monkeypatch.setattr("app.routes.get_commodity", lambda _: record)

    response = app_client.get("/commodity/test_benchmark")

    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert expected in html
    assert "Not supplied" in html
    assert 'data-pct30=""' in html
    assert 'data-pct365=""' in html
    if price is None:
        assert 'aria-label="Copy price to clipboard"' not in html
        assert 'data-pct1=""' in html
        assert re.search(r'id="change-pct-display"[^>]*>\s*Unavailable', html)
    else:
        assert 'aria-label="Copy price to clipboard"' in html
        assert f'data-pct1="{percent}"' in html
