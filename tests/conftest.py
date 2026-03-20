"""Shared fixtures and sample data for the test suite."""
import json
import pytest
from flask import Flask
from app import create_app
from app.extensions import cache


# ------------------------------------------------------------------
# Canonical sample commodity (superset of all fields used by tests)
# ------------------------------------------------------------------

SAMPLE_GOLD = {
    "id": "gold",
    "name": "Gold",
    "category": "precious",
    "price": 2000.0,
    "currency": "USD",
    "unit": "troy oz",
    "date": "2024-01-10",
    "source_name": "FreeGoldAPI",
    "source_url": "https://freegoldapi.com",
    "source_type": "FREEGOLD",
    "history": [
        {"date": "2023-12-20", "price": 1950.0},
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
        "change_1d": 20.0,
        "pct_1d": 1.01,
    },
    "updated_at": "2024-01-10T18:00:00.000000",
}


def write_sample_data(data_dir, commodities=None):
    """Write commodity JSON files into a data directory.

    *commodities* defaults to a single gold entry if not provided.
    """
    if commodities is None:
        commodities = [SAMPLE_GOLD]
    for item in commodities:
        with open(data_dir / f"{item['id']}.json", "w") as f:
            json.dump(item, f)


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------


class _TestConfig:
    TESTING = True
    CACHE_TYPE = "SimpleCache"
    RATELIMIT_ENABLED = False
    SECRET_KEY = "test-secret"
    JSON_DATA_DIR = ""


@pytest.fixture
def app_with_data(tmp_path):
    """Bare Flask app with app context and a temp data directory.

    Useful for testing data_handler functions directly (no routes).
    """
    app = Flask(__name__)
    app.config["CACHE_TYPE"] = "SimpleCache"
    cache.init_app(app)

    app_dir = tmp_path / "app"
    app_dir.mkdir()
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    write_sample_data(data_dir)

    app.root_path = str(app_dir)
    app.config["JSON_DATA_DIR"] = str(data_dir)

    with app.app_context():
        yield app


@pytest.fixture
def app_client(tmp_path):
    """Full app with test client backed by a temp data directory.

    Useful for integration tests that exercise routes end-to-end.
    """
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    write_sample_data(data_dir)

    _TestConfig.JSON_DATA_DIR = str(data_dir)
    app = create_app(_TestConfig)

    with app.app_context():
        cache.clear()
    yield app.test_client()
