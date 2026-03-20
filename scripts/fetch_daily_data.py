#!/usr/bin/env python3
"""
BenchmarkWatcher Daily Data Fetcher
-----------------------------------
Slim orchestrator that loads commodity configs from commodities.json
and dispatches to modular fetcher functions.

Usage:
    1. Ensure .env has FRED_API_KEY, EIA_API_KEY, USDA_API_KEY.
    2. Run: python3 scripts/fetch_daily_data.py
"""

import os
import sys
import json
import logging
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from dotenv import load_dotenv

# Ensure project root is on sys.path for package imports
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Load API keys BEFORE importing fetchers (they read env at import time)
load_dotenv(os.path.join(PROJECT_ROOT, '.env'))

from scripts.fetchers import FETCHER_REGISTRY
from scripts.fetchers._shared import merge_history, compute_metrics, save_atomic

# Re-export for backward compatibility (tests import from here)
__all__ = ['compute_metrics', 'merge_history', 'main']

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'data')
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'commodities.json')


def load_config() -> List[Dict[str, Any]]:
    """Load commodity configuration from commodities.json."""
    with open(CONFIG_PATH, 'r') as f:
        config = json.load(f)
    logger.info(f"Loaded {len(config)} commodities from {os.path.basename(CONFIG_PATH)}")
    return config


def _fetch_fred(fetcher: Callable[..., List[Dict[str, Any]]], conf: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    return fetcher(conf.get('series_id'))


def _fetch_eia(fetcher: Callable[..., List[Dict[str, Any]]], conf: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    return fetcher(conf.get('url'), conf.get('facets'))


def _fetch_yahoo(fetcher: Callable[..., List[Dict[str, Any]]], conf: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    return fetcher(conf.get('symbol'))


def _fetch_usda(fetcher: Callable[..., List[Dict[str, Any]]], conf: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    return fetcher(
        commodity_desc=conf.get('commodity_desc'),
        unit_desc=conf.get('unit_desc', '$ / BU'),
    )


def _fetch_default(fetcher: Callable[..., List[Dict[str, Any]]], conf: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    return fetcher(**conf)


FETCH_ADAPTERS: Dict[
    str,
    Callable[[Callable[..., List[Dict[str, Any]]], Dict[str, Any]], Optional[List[Dict[str, Any]]]]
] = {
    'FRED': _fetch_fred,
    'EIA': _fetch_eia,
    'YAHOO': _fetch_yahoo,
    'USDA': _fetch_usda,
}


def fetch_new_data(commodity: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    """Dispatch to the appropriate fetcher based on source_type."""
    source_type = commodity.get('source_type', '')
    conf = commodity.get('api_config', {})
    fetcher = FETCHER_REGISTRY.get(source_type)

    if not fetcher:
        logger.warning(f"  No fetcher for source_type '{source_type}'")
        return None

    adapter = FETCH_ADAPTERS.get(source_type, _fetch_default)
    return adapter(fetcher, conf)


def update_commodity(commodity: Dict[str, Any]) -> bool:
    """Orchestrates the update process for a single commodity. Returns True on success."""
    logger.info(f"Updating {commodity['name']}...")

    # 1. Load Existing
    filepath = os.path.join(DATA_DIR, f"{commodity['id']}.json")
    existing_history = []
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
                # Purge simulated data if present
                if not data.get('simulated', False):
                    existing_history = data.get('history', [])
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"  Could not read existing data for {commodity['name']}: {e}")
            # Continue with empty history — new fetch will start fresh

    # 2. Fetch New Data
    new_data = fetch_new_data(commodity)

    if not new_data:
        logger.warning(f"  FAILED: No data fetched for {commodity['name']}")
        return False

    # 3. Merge & Process
    conf = commodity.get('api_config', {})
    history = merge_history(existing_history, new_data)
    history = history[-1000:]  # Keep last 1000 observations
    metrics = compute_metrics(history)
    latest = history[-1]

    # 4. Construct Record
    record = {
        "id": commodity['id'],
        "name": commodity['name'],
        "category": commodity['category'],
        "price": latest['price'],
        "currency": "USD",
        "unit": commodity['unit'],
        "date": latest['date'],
        "source_name": commodity.get('source_name', commodity['source_type']),
        "source_url": conf.get('source_info_url', ''),
        "source_type": commodity['source_type'],
        "source_class": (
            "official_benchmark"
            if commodity['source_type'] in ("FRED", "EIA", "USDA")
            else "public_market_reference"
        ),
        "simulated": False,
        "metrics": metrics,
        "derived": {
            "descriptive_stats": metrics
        },
        "history": history,
        "updated_at": datetime.now().isoformat()
    }

    if save_atomic(filepath, record):
        logger.info(f"  Success: {len(history)} records saved.")
        return True
    else:
        logger.error(f"  FAILED: Could not save {commodity['name']}")
        return False


def main():
    """Main entry point. Loads config and updates all commodities."""
    os.makedirs(DATA_DIR, exist_ok=True)

    config = load_config()

    success = 0
    fail = 0
    for commodity in config:
        try:
            if update_commodity(commodity):
                success += 1
            else:
                fail += 1
        except Exception as e:
            logger.error(f"  Exception updating {commodity.get('name', '?')}: {e}")
            fail += 1

    logger.info(f"\n{'=' * 50}")
    logger.info(f"Fetch complete: {success} success, {fail} failed, {len(config)} total")
    logger.info(f"{'=' * 50}")


if __name__ == "__main__":
    main()