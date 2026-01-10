import json
import os
import tempfile
from datetime import datetime
import pytest

from flask import Flask

# Import functions under test
from app.data_handler import (
    get_all_commodities,
    get_commodity,
    filter_history_by_range
)


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def app_with_data(tmp_path):
    """
    Creates a Flask app context with a temporary data directory
    containing one valid commodity JSON file.
    """
    app = Flask(__name__)

    # Create structure: tmp_path/app/ and tmp_path/data/
    # So that from app, ../data resolves to data dir
    app_dir = tmp_path / "app"
    app_dir.mkdir()
    
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    sample = {
        "id": "gold",
        "name": "Gold",
        "category": "precious",
        "price": 2000.0,
        "date": "2024-01-10",
        "history": [
            {"date": "2024-01-08", "price": 1950.0},
            {"date": "2024-01-09", "price": 1980.0},
            {"date": "2024-01-10", "price": 2000.0},
        ],
        "derived": {
            "descriptive_stats": {
                "abs_change_1_obs": 20.0,
                "pct_change_1_obs": 1.01,
                "pct_change_30_obs": 4.5,
                "direction_30_obs": "up",
                "observations": 3,
                "latest_observation_date": "2024-01-10",
            }
        },
        "metrics": {
            # legacy compatibility
            "change_1d": 20.0,
            "pct_1d": 1.01
        }
    }

    with open(data_dir / "gold.json", "w") as f:
        json.dump(sample, f)

    # Set root_path to app dir so ../data resolves to data_dir
    app.root_path = str(app_dir)

    with app.app_context():
        yield app


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


def test_get_all_commodities_uses_derived_metrics(app_with_data):
    """get_all_commodities() does NOT recompute metrics."""
    commodities = get_all_commodities(date_range="ALL")

    assert len(commodities) == 1
    item = commodities[0]

    # Values must come from derived.descriptive_stats
    assert item["change"] == 20.0
    assert item["change_percent"] == 1.01

    # Legacy aliases must not diverge
    assert item["daily_change"] == item["change"]
    assert item["daily_change_percent"] == item["change_percent"]


def test_derived_stats_exposed(app_with_data):
    """Derived stats are exposed to templates."""
    commodities = get_all_commodities()

    item = commodities[0]
    derived = item["derived_stats"]

    assert derived["direction_30_obs"] == "up"
    assert derived["observations"] == 3


def test_date_range_does_not_change_metrics(app_with_data):
    """Date-range filtering does NOT affect metrics."""
    all_range = get_all_commodities("ALL")[0]
    short_range = get_all_commodities("1W")[0]

    assert all_range["change"] == short_range["change"]
    assert all_range["change_percent"] == short_range["change_percent"]


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
    # Import compute_metrics from fetcher
    import sys
    sys.path.insert(0, '.')
    from scripts.fetch_daily_data import compute_metrics
    
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
    
    # Allow certain exceptions
    allowed_contexts = ['does not', 'not for', 'should not', 'no ', 'disclaimer']
    filtered_violations = []
    for v in violations:
        # Re-check with context
        template_name = v.split(':')[0]
        word = v.split("'")[1]
        template_path = [t for t in templates if os.path.basename(t) == template_name][0]
        with open(template_path, 'r') as f:
            content = f.read().lower()
            # Find the word's context
            idx = content.find(word)
            context = content[max(0, idx-50):idx+len(word)+50]
            if not any(allowed in context for allowed in allowed_contexts):
                filtered_violations.append(v)
    
    assert len(filtered_violations) == 0, f"Forbidden strings found: {filtered_violations}"


def test_metric_naming_uses_observation_based_keys():
    """
    Metrics must use observation-based naming, not calendar-based.
    
    This locks in legal semantics and prevents future developers from
    accidentally reintroducing time-based assumptions.
    """
    import sys
    sys.path.insert(0, '.')
    from scripts.fetch_daily_data import compute_metrics
    
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
