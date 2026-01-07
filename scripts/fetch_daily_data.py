#!/usr/bin/env python3
"""
BenchmarkWatcher Daily Data Fetcher
Production-ready script for fetching commodity benchmark data.

Features:
- Robust HTTP handling with retries and backoff
- Proper date parsing and validation
- Atomic file writes to prevent corruption
- Monitoring-only metrics (no trading signals)
- Clear simulation flagging when APIs unavailable
"""

import os
import sys
import json
import time
import logging
from datetime import datetime, timedelta
from dateutil import parser as date_parser
import requests
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Load API keys from .env
load_dotenv()

FRED_API_KEY = os.getenv('FRED_API_KEY')
EIA_API_KEY = os.getenv('EIA_API_KEY')

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')


# =============================================================================
# HTTP Helper with Retries
# =============================================================================

def safe_get(url, params=None, headers=None, retries=3, backoff=1.0, timeout=15):
    """
    Robust HTTP GET with retries and exponential backoff.
    Raises exception only after all retries exhausted.
    """
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            if attempt + 1 == retries:
                raise
            wait_time = backoff * (2 ** attempt)
            logger.warning(f"Request failed (attempt {attempt + 1}/{retries}), retrying in {wait_time}s: {e}")
            time.sleep(wait_time)


# =============================================================================
# Data Fetchers
# =============================================================================

def fetch_fred_series(series_id, limit=365, start_date=None):
    """
    Fetch data from FRED API with proper validation.
    Returns list of {'date': 'YYYY-MM-DD', 'price': float} oldest-first, or None on failure.
    """
    if not FRED_API_KEY or FRED_API_KEY == 'your_key_here':
        return None
    
    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "sort_order": "desc",
        "limit": limit
    }
    if start_date:
        params["observation_start"] = start_date
    
    try:
        resp = safe_get(url, params=params)
        data = resp.json()
        observations = data.get("observations", [])
        
        results = []
        for obs in observations:
            value = obs.get("value")
            # FRED uses '.' for missing values
            if value in (".", "", None):
                continue
            try:
                price = float(value)
            except (ValueError, TypeError):
                continue
            
            raw_date = obs.get("date")
            if not raw_date:
                continue
            
            # Normalize date to ISO format
            try:
                dt = date_parser.parse(raw_date).date().isoformat()
            except (ValueError, TypeError):
                continue
            
            results.append({"date": dt, "price": round(price, 4)})
        
        # Return chronological order (oldest first)
        return list(reversed(results))
    
    except Exception as e:
        logger.error(f"Error fetching FRED series {series_id}: {e}")
        return None


def fetch_eia_series(series_id, length=365):
    """
    Fetch data from EIA API v2 with proper validation.
    Returns list of {'date': 'YYYY-MM-DD', 'price': float} oldest-first, or None on failure.
    """
    if not EIA_API_KEY or EIA_API_KEY == 'your_key_here':
        return None
    
    url = f"https://api.eia.gov/v2/seriesid/{series_id}/data"
    params = {
        "api_key": EIA_API_KEY,
        "length": length,
        "sort[0][column]": "period",
        "sort[0][direction]": "desc"
    }
    
    try:
        resp = safe_get(url, params=params)
        data = resp.json()
        data_list = data.get("response", {}).get("data", [])
        
        results = []
        for obs in data_list:
            value = obs.get("value")
            if value is None:
                continue
            try:
                price = float(value)
            except (ValueError, TypeError):
                continue
            
            # EIA uses 'period' or sometimes 'date'
            period = obs.get("period") or obs.get("date")
            if not period:
                continue
            
            # Normalize date to ISO format
            try:
                dt = date_parser.parse(str(period)).date().isoformat()
            except (ValueError, TypeError):
                continue
            
            results.append({"date": dt, "price": round(price, 4)})
        
        # Return chronological order (oldest first)
        return list(reversed(results))
    
    except Exception as e:
        logger.error(f"Error fetching EIA series {series_id}: {e}")
        return None


# =============================================================================
# History Management
# =============================================================================

def merge_history(existing_history, new_data):
    """
    Merge new data into existing history, updating existing dates and adding new ones.
    Returns sorted list (oldest first), deduped by date.
    """
    # Build dict keyed by date for deduplication
    history_by_date = {h['date']: h for h in existing_history}
    
    for item in new_data:
        date_key = item['date']
        # Update or add
        history_by_date[date_key] = {
            "date": date_key,
            "price": item['price']
        }
    
    # Sort by parsed date (handles any format variations)
    sorted_history = sorted(
        history_by_date.values(),
        key=lambda x: date_parser.parse(x['date'])
    )
    
    return sorted_history


def generate_simulated_history(base_price, days=730, frequency='daily'):
    """
    Generate simulated price history using simple random walk.
    Marks all entries as simulated.
    """
    import random
    
    history = []
    price = base_price
    volatility = 0.02 if frequency == 'daily' else 0.05  # Higher for monthly
    
    step_days = 1 if frequency == 'daily' else 30
    
    for i in range(days // step_days):
        date = (datetime.now() - timedelta(days=(days - i * step_days))).strftime("%Y-%m-%d")
        # Simple random walk
        change = random.gauss(0, volatility)
        price = price * (1 + change)
        price = max(price, base_price * 0.1)  # Floor at 10% of base
        history.append({
            "date": date,
            "price": round(price, 4)
        })
    
    return history


def generate_single_simulated_step(last_price, frequency='daily'):
    """Generate a single simulated price step."""
    import random
    
    volatility = 0.015 if frequency == 'daily' else 0.04
    change = random.gauss(0, volatility)
    new_price = last_price * (1 + change)
    new_price = max(new_price, last_price * 0.5)  # Floor
    
    return {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "price": round(new_price, 4)
    }


# =============================================================================
# Monitoring Metrics (Non-Trading)
# =============================================================================

def compute_reference_averages(history):
    """
    Compute neutral reference averages (NOT trading signals).
    Labels: '30-day reference average', '1-year reference average'
    """
    prices = [h['price'] for h in history]
    
    def rolling_mean(data, window):
        out = [None] * len(data)
        if len(data) >= window:
            running_sum = sum(data[:window])
            out[window - 1] = running_sum / window
            for i in range(window, len(data)):
                running_sum += data[i] - data[i - window]
                out[i] = running_sum / window
        return out
    
    avg_30 = rolling_mean(prices, 30)
    avg_365 = rolling_mean(prices, 365)
    
    for i, h in enumerate(history):
        h['avg_30'] = round(avg_30[i], 4) if avg_30[i] is not None else None
        h['avg_365'] = round(avg_365[i], 4) if avg_365[i] is not None else None


def compute_metrics(history):
    """
    Compute simple monitoring metrics for display.
    These are informational context, NOT trading signals.
    """
    if not history:
        return {}
    
    metrics = {}
    latest_price = history[-1]['price']
    metrics['latest_price'] = latest_price
    
    # 1-day change
    if len(history) >= 2:
        prev_price = history[-2]['price']
        metrics['change_1d'] = round(latest_price - prev_price, 4)
        metrics['pct_1d'] = round((latest_price / prev_price - 1) * 100, 2) if prev_price else None
    else:
        metrics['change_1d'] = None
        metrics['pct_1d'] = None
    
    # 30-day change
    if len(history) >= 31:
        price_30d_ago = history[-31]['price']
        metrics['pct_30d'] = round((latest_price / price_30d_ago - 1) * 100, 2) if price_30d_ago else None
    else:
        metrics['pct_30d'] = None
    
    # 1-year change
    if len(history) >= 366:
        price_1y_ago = history[-366]['price']
        metrics['pct_1y'] = round((latest_price / price_1y_ago - 1) * 100, 2) if price_1y_ago else None
    else:
        metrics['pct_1y'] = None
    
    # Simple trend context (1% threshold, conservative)
    metrics['trend'] = 'flat'
    if metrics.get('pct_30d') is not None:
        if metrics['pct_30d'] > 1.0:
            metrics['trend'] = 'up'
        elif metrics['pct_30d'] < -1.0:
            metrics['trend'] = 'down'
    
    return metrics


# =============================================================================
# File I/O with Atomic Writes
# =============================================================================

def load_existing_data(filepath):
    """Load existing JSON data file, return empty dict if not found."""
    if not os.path.exists(filepath):
        return None
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Could not load {filepath}: {e}")
        return None


def save_data_atomic(filepath, data):
    """Save data to JSON file atomically (write to temp, then rename)."""
    tmpfile = filepath + ".tmp"
    try:
        with open(tmpfile, 'w') as f:
            json.dump(data, f, indent=2)
        os.replace(tmpfile, filepath)
        return True
    except Exception as e:
        logger.error(f"Failed to save {filepath}: {e}")
        # Clean up temp file if it exists
        if os.path.exists(tmpfile):
            os.remove(tmpfile)
        return False


# =============================================================================
# Main Update Logic
# =============================================================================

def update_commodity_data(commodity):
    """Fetch, process, and save commodity data."""
    logger.info(f"Updating {commodity['name']}...")
    
    filepath = os.path.join(DATA_DIR, f"{commodity['id']}.json")
    existing_data = load_existing_data(filepath)
    existing_history = existing_data.get('history', []) if existing_data else []
    
    simulated = False
    frequency = commodity.get('frequency', 'daily')
    
    # Fetch fresh data from API
    new_data = None
    if commodity['source_type'] == 'FRED':
        new_data = fetch_fred_series(commodity['source_id'], limit=730)
    elif commodity['source_type'] == 'EIA':
        new_data = fetch_eia_series(commodity['source_id'], length=730)
    
    if new_data and len(new_data) > 0:
        # Merge with existing history
        history = merge_history(existing_history, new_data)
        latest = new_data[-1]
        logger.info(f"  Fetched {len(new_data)} data points from API")
    else:
        # Fallback to simulation
        simulated = True
        logger.warning(f"  [SIMULATION] No API data for {commodity['name']}, using simulated data")
        
        if not existing_history:
            # Generate full simulated history
            history = generate_simulated_history(
                commodity['price'],
                days=730,
                frequency=frequency
            )
            latest = history[-1]
        else:
            # Add single simulated step
            history = existing_history.copy()
            latest = generate_single_simulated_step(
                existing_history[-1]['price'],
                frequency=frequency
            )
            history = merge_history(history, [latest])
    
    # Trim history to last 1000 entries
    history = history[-1000:]
    
    # Compute reference averages (neutral, non-trading)
    compute_reference_averages(history)
    
    # Compute monitoring metrics
    metrics = compute_metrics(history)
    
    # Build record
    record = {
        "id": commodity['id'],
        "name": commodity['name'],
        "category": commodity['category'],
        "price": latest['price'],
        "currency": "USD",
        "unit": commodity['unit'],
        "date": latest['date'],
        "source_name": commodity['source_name'],
        "source_url": commodity['source_url'],
        "simulated": simulated,
        "history": history,
        "metrics": metrics,
        "updated_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    }
    
    # Save atomically
    if save_data_atomic(filepath, record):
        logger.info(f"  Saved {commodity['id']}.json ({len(history)} history points)")
    else:
        logger.error(f"  Failed to save {commodity['id']}.json")


# =============================================================================
# Configuration & Entry Point
# =============================================================================

COMMODITIES_CONFIG = [
    {
        "id": "gold",
        "name": "Gold",
        "category": "metal",
        "price": 2041.15,
        "unit": "troy ounce",
        "frequency": "daily",
        "source_type": "FRED",
        "source_id": "GOLDPMGBD228NLBM",
        "source_name": "LBMA PM Fix (FRED)",
        "source_url": "https://fred.stlouisfed.org/series/GOLDPMGBD228NLBM"
    },
    {
        "id": "brent_oil",
        "name": "Brent Crude Oil",
        "category": "energy",
        "price": 78.45,
        "unit": "barrel",
        "frequency": "daily",
        "source_type": "EIA",
        "source_id": "PET.RBRTE.D",
        "source_name": "EIA",
        "source_url": "https://www.eia.gov/opendata/"
    },
    {
        "id": "natural_gas",
        "name": "Natural Gas",
        "category": "energy",
        "price": 2.65,
        "unit": "MMBtu",
        "frequency": "daily",
        "source_type": "EIA",
        "source_id": "NG.RNGC1.D",
        "source_name": "EIA",
        "source_url": "https://www.eia.gov/opendata/"
    },
    {
        "id": "silver",
        "name": "Silver",
        "category": "metal",
        "price": 23.15,
        "unit": "troy ounce",
        "frequency": "daily",
        "source_type": "FRED",
        "source_id": "SLVPRUSD",
        "source_name": "LBMA Silver Price (FRED)",
        "source_url": "https://fred.stlouisfed.org/series/SLVPRUSD"
    },
    {
        "id": "iron_ore",
        "name": "Iron Ore",
        "category": "metal",
        "price": 135.20,
        "unit": "metric ton",
        "frequency": "monthly",  # Note: Monthly source, not daily!
        "source_type": "FRED",
        "source_id": "PIOREAUUSDM",
        "source_name": "World Bank (via FRED)",
        "source_url": "https://fred.stlouisfed.org/series/PIOREAUUSDM"
    }
]


def main():
    """Main entry point."""
    # Ensure data directory exists
    os.makedirs(DATA_DIR, exist_ok=True)
    
    logger.info("=" * 50)
    logger.info("BenchmarkWatcher Daily Data Update")
    logger.info("=" * 50)
    
    success_count = 0
    fail_count = 0
    
    for commodity in COMMODITIES_CONFIG:
        try:
            update_commodity_data(commodity)
            success_count += 1
        except Exception as e:
            logger.error(f"Failed to update {commodity['name']}: {e}")
            fail_count += 1
    
    logger.info("=" * 50)
    logger.info(f"Update complete: {success_count} succeeded, {fail_count} failed")
    logger.info("=" * 50)


if __name__ == "__main__":
    main()
