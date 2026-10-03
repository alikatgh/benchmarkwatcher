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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from dotenv import load_dotenv

# Ensure project root is on sys.path for package imports
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Load API keys BEFORE importing fetchers (they read env at import time)
load_dotenv(os.path.join(PROJECT_ROOT, '.env'))

from scripts.fetchers import FETCHER_REGISTRY
from scripts.fetchers.global_reference import OfficialClient
from scripts.global_sources import load_series, merge_reference_history, update_worldbank_bulk
from scripts.fetchers._shared import (
    merge_history,
    compute_metrics,
    save_atomic,
    build_commodity_record,
)

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
    """Load commodities and enabled official commodity indices only."""
    with open(CONFIG_PATH, 'r') as f:
        config = json.load(f)
    existing_ids = {commodity['id'] for commodity in config}
    config.extend(series for series in load_series()
                  if series.get('enabled') is True and series.get('reference_type') == 'commodity_index'
                  and series['id'] not in existing_ids)
    logger.info(f"Loaded {len(config)} commodities from {os.path.basename(CONFIG_PATH)}")
    return config


def load_reference_config() -> List[Dict[str, Any]]:
    """FX/statistics/retail references are separate from commodity storage."""
    return [series for series in load_series() if series.get('enabled') is True
            and series.get('reference_type') != 'commodity_index']


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


def fetch_new_data(commodity: Dict[str, Any],
                   client: Optional[OfficialClient] = None) -> Optional[List[Dict[str, Any]]]:
    """Dispatch to the appropriate fetcher based on source_type."""
    source_type = commodity.get('source_type', '')
    conf = commodity.get('api_config', {})
    fetcher = FETCHER_REGISTRY.get(source_type)

    if not fetcher:
        logger.warning(f"  No fetcher for source_type '{source_type}'")
        return None

    if source_type == 'GLOBAL_REFERENCE':
        return fetcher(client=client, **conf)

    adapter = FETCH_ADAPTERS.get(source_type, _fetch_default)
    return adapter(fetcher, conf)


def _merge_reference_history(existing: Dict[str, Any], new_data: List[Dict[str, Any]],
                             checked_at: str) -> tuple:
    return merge_reference_history(existing, new_data, checked_at)


def update_commodity(commodity: Dict[str, Any],
                     client: Optional[OfficialClient] = None) -> bool:
    """Orchestrates the update process for a single commodity. Returns True on success."""
    logger.info(f"Updating {commodity['name']}...")

    # 1. Load Existing
    is_global = commodity.get('source_type') == 'GLOBAL_REFERENCE'
    directory = (os.path.join(DATA_DIR, 'global-reference') if is_global and
                 commodity.get('reference_type') != 'commodity_index' else DATA_DIR)
    filepath = os.path.join(directory, f"{commodity['id']}.json")
    existing_history = []
    data = {}
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
                # Purge simulated data if present
                if not data.get('simulated', False):
                    existing_history = data.get('history', [])
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"  Could not read existing data for {commodity['name']}: {e}")
            if is_global:
                return False  # Never replace an unreadable reference archive.
            # Continue with empty history — new fetch will start fresh

    # 2. Fetch New Data
    new_data = fetch_new_data(commodity, client=client) if client is not None else fetch_new_data(commodity)

    if not new_data:
        logger.warning(f"  FAILED: No data fetched for {commodity['name']}")
        return False

    # 3. Merge & Process
    conf = commodity.get('api_config', {})
    checked_at = datetime.now(timezone.utc).isoformat()
    revisions = None
    if is_global:
        history, revisions = _merge_reference_history(data, new_data, checked_at)
    else:
        history = merge_history(existing_history, new_data)
    metrics = compute_metrics(history)

    # 4. Construct Record — config-derived fields, then shared builder sets the
    # history-derived top-level fields (price/date/derived/metrics/updated_at).
    config_fields = {
        "id": commodity['id'],
        "name": commodity['name'],
        "category": commodity['category'],
        "currency": commodity.get("currency", "USD"),
        "unit": commodity['unit'],
        "source_name": commodity.get('source_name', commodity['source_type']),
        "source_url": commodity.get('source_url', conf.get('source_info_url', '')),
        "source_type": commodity['source_type'],
        "source_class": commodity.get('source_class') or (
            "official_benchmark"
            if commodity['source_type'] in ("FRED", "EIA", "USDA")
            else "public_market_reference"
        ),
        "simulated": False,
    }
    if is_global:
        config_fields.update({key: commodity[key] for key in
                              ('kind', 'reference_type', 'countries', 'frequency', 'date_semantics',
                               'attribution', 'source_id')})
        config_fields.update({'period': history[-1].get('period', history[-1]['date']),
                              'fetched_at': checked_at, 'revisions': revisions,
                              'calculations_note': 'Descriptive changes are calculated by BenchmarkWatcher; source observations are unchanged.'})
        if 'status' in history[-1]:
            config_fields['status'] = history[-1]['status']
        else:
            data.pop('status', None)
    record = build_commodity_record(
        data, history, metrics, overrides=config_fields
    )

    os.makedirs(directory, exist_ok=True)
    if save_atomic(filepath, record):
        logger.info(f"  Success: {len(history)} records saved.")
        return True
    else:
        logger.error(f"  FAILED: Could not save {commodity['name']}")
        return False


def main():
    """Update commodities and isolated global references with a shared budget."""
    os.makedirs(DATA_DIR, exist_ok=True)

    config = load_config()
    references = load_reference_config()

    success = 0
    fail = 0
    client = OfficialClient(max_requests=20)
    try:
        for commodity in config + [row for row in references if row.get('source_id') != 'worldbank']:
            try:
                result = (update_commodity(commodity, client=client)
                          if commodity.get('source_type') == 'GLOBAL_REFERENCE'
                          else update_commodity(commodity))
                if result:
                    success += 1
                else:
                    fail += 1
            except Exception as e:
                logger.error(f"  Exception updating {commodity.get('name', '?')}: {e}")
                fail += 1
        try:
            bulk = update_worldbank_bulk(client, Path(DATA_DIR) / 'global-reference')
            success += sum(row['status'] == 'fetched' for row in bulk['results'])
            fail += sum(row['status'] == 'failed' for row in bulk['results'])
            logger.info('World Bank bulk: %s saved histories across %s economies / %s indicators',
                        bulk['series_count'], bulk['economies_count'], bulk['indicator_count'])
        except Exception as exc:
            logger.error('World Bank bulk update failed; existing histories retained: %s', exc)
            fail += 1
    finally:
        client.close()

    logger.info(f"\n{'=' * 50}")
    logger.info(f"Fetch complete: {success} success, {fail} failed, {len(config)} commodities, {len(references)} global references")
    logger.info(f"Global official requests: {client.request_count}/20; no automatic retries")
    logger.info(f"{'=' * 50}")


if __name__ == "__main__":
    main()
