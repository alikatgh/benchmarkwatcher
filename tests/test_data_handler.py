import json
import os
from datetime import datetime
import pytest

# Import functions under test
from app.data_handler import (
    build_market_summary,
    get_all_commodities,
    get_commodity,
    filter_history_by_range
)

# app_with_data fixture is provided by conftest.py


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

def test_filter_history_by_range_uses_latest_date():
    """History filtering is display-only and anchored to latest observation."""
    history = [
        {"date": "2024-01-01", "price": 100},
        {"date": "2024-01-10", "price": 110},
    ]

    filtered = filter_history_by_range(history, "1W")

    # Should include only entries >= latest_date - 7 days
    assert len(filtered) == 1
    assert filtered[0]["date"] == "2024-01-10"


def test_get_all_commodities_uses_filtered_history_for_display_change(app_with_data):
    """get_all_commodities() derives display change from filtered history window."""
    commodities = get_all_commodities(date_range="ALL")

    assert len(commodities) == 1
    item = commodities[0]

    # Values are first->last over the selected display history window
    # 1950 -> 2000 = +50.0 ; +2.564102...%
    assert item["change"] == pytest.approx(50.0)
    assert item["change_percent"] == pytest.approx((50.0 / 1950.0) * 100)

    # Legacy aliases must not diverge
    assert item["daily_change"] == item["change"]
    assert item["daily_change_percent"] == item["change_percent"]

    # Frequency fields should be present and inferred from history cadence
    assert item["is_daily"] is True
    assert item["frequency_badge"] == "D"
    assert item["frequency_label"] == "Daily data"


def test_derived_stats_exposed(app_with_data):
    """Derived stats are exposed to templates."""
    commodities = get_all_commodities()

    item = commodities[0]
    derived = item["derived_stats"]

    assert derived["direction_30_obs"] == "up"
    assert derived["observations"] == 3


def test_get_all_commodities_skips_unsafe_id_files(app_with_data):
    """A *.json with an unsafe id stem must not enter the public list,
    matching get_commodity's id validation."""
    from flask import current_app

    data_dir = current_app.config["JSON_DATA_DIR"]
    # Filename stem 'bad name' contains a space -> fails _is_safe_commodity_id.
    with open(os.path.join(data_dir, "bad name.json"), "w") as f:
        json.dump({"id": "bad name", "name": "Bad", "price": 1.0, "history": []}, f)

    commodities = get_all_commodities()

    # Only the safely-named gold file should be present; the unsafe one skipped.
    ids = {c.get("id") for c in commodities}
    assert "gold" in ids
    assert "bad name" not in ids
    assert "Bad" not in {c.get("name") for c in commodities}


def test_build_market_summary_counts_breadth_and_movers():
    """Market summary describes the current display set without extra data sources."""
    commodities = [
        {
            "id": "gold",
            "name": "Gold",
            "category": "precious",
            "change_percent": 2.5,
            "change": 50.0,
            "currency": "USD",
            "date": "2024-01-10",
            "is_daily": True,
        },
        {
            "id": "corn",
            "name": "Corn",
            "category": "agricultural",
            "change_percent": -4.0,
            "change": -0.2,
            "currency": "USD",
            "date": "2024-01-09",
            "is_daily": False,
        },
        {
            "id": "wheat",
            "name": "Wheat",
            "category": "agricultural",
            "change_percent": 0.0,
            "change": 0.0,
            "currency": "USD",
            "date": "2024-01-10",
            "is_daily": False,
        },
    ]

    summary = build_market_summary(commodities)

    assert summary["total"] == 3
    assert summary["up_count"] == 1
    assert summary["down_count"] == 1
    assert summary["flat_count"] == 1
    assert summary["daily_count"] == 1
    assert summary["monthly_count"] == 2
    assert summary["latest_date"] == "2024-01-10"
    assert summary["latest_count"] == 2
    assert summary["headline"] == "Benchmarks were evenly split"
    assert summary["biggest_up"]["id"] == "gold"
    assert summary["biggest_down"]["id"] == "corn"
    assert summary["categories"][0]["slug"] == "agricultural"
    assert summary["categories"][0]["name"] == "Agriculture"
    assert summary["categories"][0]["breadth_percent"] == 0.0
    assert summary["categories"][0]["flat_percent"] == 50.0
    assert summary["categories"][0]["down_percent"] == 50.0
    assert [m["id"] for m in summary["top_movers_up"]] == ["gold"]
    assert [m["id"] for m in summary["top_movers_down"]] == ["corn"]
    assert summary["top_movers_up"][0]["id"] == summary["biggest_up"]["id"]


def test_build_market_summary_top_movers_sorted_and_capped():
    """top_movers_up/down are sorted by magnitude and capped at 5 each."""
    commodities = (
        [
            {"id": f"up{i}", "name": f"Up {i}", "category": "x",
             "change_percent": float(i), "change": 1.0, "date": "2024-01-01"}
            for i in range(1, 8)
        ]
        + [
            {"id": f"dn{i}", "name": f"Dn {i}", "category": "x",
             "change_percent": -float(i), "change": -1.0, "date": "2024-01-01"}
            for i in range(1, 8)
        ]
    )

    summary = build_market_summary(commodities)

    assert [m["id"] for m in summary["top_movers_up"]] == ["up7", "up6", "up5", "up4", "up3"]
    assert [m["id"] for m in summary["top_movers_down"]] == ["dn7", "dn6", "dn5", "dn4", "dn3"]
    assert summary["biggest_up"]["id"] == "up7"
    assert summary["biggest_down"]["id"] == "dn7"


def test_date_range_changes_display_metrics(app_with_data):
    """Date-range filtering affects list display metrics via filtered history."""
    all_range = get_all_commodities("ALL")[0]
    short_range = get_all_commodities("1W")[0]

    assert all_range["change"] != short_range["change"]
    assert all_range["change_percent"] != short_range["change_percent"]
    # In this fixture, 1W excludes the oldest point and keeps last two
    assert short_range["change"] == pytest.approx(20.0)
    assert short_range["change_percent"] == pytest.approx((20.0 / 1980.0) * 100)


def test_get_commodity_prev_observation(app_with_data):
    """get_commodity() exposes previous observation safely."""
    item = get_commodity("gold")

    assert item["prev_price"] == 1980.0
    assert item["prev_date"] == "2024-01-09"


def test_missing_derived_falls_back_to_metrics(app_with_data):
    """Graceful handling of missing derived stats (fallback)."""
    # Load and corrupt JSON
    data_dir = os.path.join(app_with_data.root_path, "..", "data")
    path = os.path.join(data_dir, "gold.json")

    with open(path, "r") as f:
        data = json.load(f)

    del data["derived"]

    with open(path, "w") as f:
        json.dump(data, f)

    item = get_commodity("gold")

    assert item["change"] == 20.0
    assert item["change_percent"] == 1.01


def test_metrics_are_observation_based_not_calendar_based():
    """
    Critical legal semantics test.
    
    Metrics are computed over OBSERVATIONS, not calendar time.
    A "1 observation" change with 4 years between dates should still work.
    This prevents future devs from reintroducing time assumptions.
    """
    fetch_module = pytest.importorskip(
        "scripts.fetch_daily_data",
        reason="scripts/fetch_daily_data.py not found — skipping observation semantics test"
    )
    compute_metrics = fetch_module.compute_metrics
    
    # Two observations 4 years apart
    history = [
        {"date": "2020-01-01", "price": 100.0},
        {"date": "2024-01-01", "price": 110.0},
    ]

    metrics = compute_metrics(history)

    # "1 observation back" is 10.0 change, NOT "1 day back"
    assert metrics["abs_change_1_obs"] == 10.0
    assert metrics["pct_change_1_obs"] == 10.0
    
    # Observation count is 2, not 1461 days
    assert metrics["observations"] == 2


# ------------------------------------------------------------------
# Semantic Regression Tests (Forbidden Strings)
# ------------------------------------------------------------------

def test_templates_do_not_contain_forbidden_strings():
    """
    Templates must not contain words that imply forward-looking analysis.
    
    This prevents semantic drift back toward trading/signal language.
    """
    import os
    import glob
    
    # Forbidden strings in UI context (case-insensitive)
    forbidden = ['return', 'signal', 'forecast', 'predict', 'recommendation']
    
    # Find all templates
    template_dir = os.path.join(os.path.dirname(__file__), '..', 'app', 'templates')
    templates = glob.glob(os.path.join(template_dir, '**', '*.html'), recursive=True)
    
    violations = []
    for template_path in templates:
        with open(template_path, 'r') as f:
            content = f.read().lower()
            for word in forbidden:
                if word in content:
                    # Check it's not in a comment or aria-label explaining what we DON'T do
                    violations.append(f"{os.path.basename(template_path)}: contains '{word}'")
    
    # Allow certain exceptions (negation phrases near the forbidden word)
    allowed_contexts = ['does not', 'not for', 'should not', 'no ', 'disclaimer', 'generate', 'changelog', 'window']
    filtered_violations = []
    for v in violations:
        # Re-check with context
        template_name = v.split(':')[0]
        word = v.split("'")[1]
        template_path = [t for t in templates if os.path.basename(t) == template_name][0]
        with open(template_path, 'r') as f:
            content = f.read().lower()
            # Widen context window to 200 chars to catch negations further before the word
            idx = content.find(word)
            context = content[max(0, idx-200):idx+len(word)+200]
            if not any(allowed in context for allowed in allowed_contexts):
                filtered_violations.append(v)
    
    assert len(filtered_violations) == 0, f"Forbidden strings found: {filtered_violations}"


def test_metric_naming_uses_observation_based_keys():
    """
    Metrics must use observation-based naming, not calendar-based.
    
    This locks in legal semantics and prevents future developers from
    accidentally reintroducing time-based assumptions.
    """
    fetch_module = pytest.importorskip(
        "scripts.fetch_daily_data",
        reason="scripts/fetch_daily_data.py not found — skipping metric naming test"
    )
    compute_metrics = fetch_module.compute_metrics
    
    history = [
        {"date": "2024-01-01", "price": 100.0},
        {"date": "2024-01-02", "price": 110.0},
    ]
    
    metrics = compute_metrics(history)
    
    # Required observation-based keys must exist
    required_obs_keys = [
        'abs_change_1_obs',
        'pct_change_1_obs', 
        'pct_change_30_obs',
        'pct_change_365_obs',
        'direction_30_obs',
        'observations',
        'latest_observation_date'
    ]
    
    for key in required_obs_keys:
        assert key in metrics, f"Missing required observation-based key: {key}"
    
    # Legacy aliases may exist but must equal their obs-based counterparts
    if 'trend' in metrics:
        assert metrics['trend'] == metrics['direction_30_obs'], "Legacy 'trend' must equal 'direction_30_obs'"
    if 'pct_30d' in metrics:
        assert metrics['pct_30d'] == metrics['pct_change_30_obs'], "Legacy 'pct_30d' must equal 'pct_change_30_obs'"
