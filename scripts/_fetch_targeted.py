#!/usr/bin/env python3
"""Targeted fetcher: only updates specified commodity IDs."""
import os
import sys
import json
import logging

from dotenv import load_dotenv

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)
load_dotenv(os.path.join(PROJECT_ROOT, '.env'))

from scripts.fetchers import FETCHER_REGISTRY
from scripts.fetchers._shared import merge_history, compute_metrics, save_atomic

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

TARGET_IDS = {
    'gold',
    'usda_barley', 'usda_cattle', 'usda_cotton', 'usda_hay',
    'usda_hogs', 'usda_milk', 'usda_oats', 'usda_rice',
    'usda_sorghum', 'usda_soybeans', 'usda_wheat',
}

CONFIG_PATH = os.path.join(PROJECT_ROOT, 'scripts', 'commodities.json')
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')

config = json.load(open(CONFIG_PATH))

for commodity in config:
    cid = commodity.get('id', '')
    if cid not in TARGET_IDS:
        continue

    source_type = commodity.get('source_type', '')
    conf = commodity.get('api_config', {})
    fetcher = FETCHER_REGISTRY.get(source_type)

    if not fetcher:
        logger.warning(f'No fetcher for source_type={source_type!r} ({cid})')
        continue

    logger.info(f'Updating {commodity["name"]}...')
    try:
        if source_type == 'YAHOO':
            new_rows = fetcher(conf.get('symbol'))
        elif source_type == 'USDA':
            new_rows = fetcher(
                commodity_desc=conf.get('commodity_desc'),
                unit_desc=conf.get('unit_desc', '$ / BU'),
                year_start=conf.get('year_start', 2020),
            )
        else:
            logger.warning(f'  Unhandled source_type {source_type!r}, skipping')
            continue

        if not new_rows:
            logger.warning(f'  FAILED: No data returned for {cid}')
            continue

        fp = os.path.join(DATA_DIR, f'{cid}.json')
        existing = json.load(open(fp)) if os.path.exists(fp) else {}
        merged = merge_history(existing.get('history', []), new_rows)
        existing['history'] = merged
        existing['metrics'] = compute_metrics(merged)
        save_atomic(fp, existing)
        logger.info(f'  Success: {len(merged)} records, latest={merged[-1]["date"]}')
    except Exception as e:
        logger.error(f'  Error updating {cid}: {e}')

logger.info('Done.')
