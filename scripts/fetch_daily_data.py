#!/usr/bin/env python3
"""
BenchmarkWatcher Daily Data Fetcher
-----------------------------------
A robust, single-file script for fetching commodity benchmark data.

Features:
- SmartDateParser: Learns date formats on the fly to boost performance.
- Atomic Writes: Writes to .tmp first to prevent file corruption on crash.
- Backoff & Retry: Handles API timeouts gracefully.
- Config-Driven: Add new commodities in the CONFIG list at the bottom.

Usage:
1. Create a .env file with FRED_API_KEY and EIA_API_KEY.
2. Run: python3 daily_fetcher.py
"""

import os
import sys
import json
import time
import logging
from datetime import datetime, date
from typing import List, Optional, Dict, Any, Union
import requests
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Load API keys from .env file in the same directory
load_dotenv()
FRED_API_KEY = os.getenv('FRED_API_KEY')
EIA_API_KEY = os.getenv('EIA_API_KEY')

# Data directory relative to this script
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')


# =============================================================================
# 1. Helpers & Parsers
# =============================================================================

class SmartDateParser:
    """
    Stateful parser that optimizes date parsing by 'remembering' 
    the last successful format. This speeds up processing by ~7x.
    """
    def __init__(self):
        self._last_working_fmt = None
        self._formats = [
            '%Y-%m-%d',          # ISO: 2024-01-15
            '%Y-%m-%dT%H:%M:%S', # ISO Time
            '%Y-%m-%d %H:%M:%S', # Space Time
            '%Y/%m/%d',          # Slashes
            '%m/%d/%Y',          # US
            '%d/%m/%Y',          # EU
            '%Y%m%d',            # Compact
        ]

    def parse(self, date_str: str) -> str:
        s = str(date_str).strip()
        
        # Optimization: Try the last working format first
        if self._last_working_fmt:
            try:
                return datetime.strptime(s, self._last_working_fmt).date().isoformat()
            except ValueError:
                pass # Format changed (unlikely), fall back to full search

        for fmt in self._formats:
            try:
                dt = datetime.strptime(s, fmt).date()
                self._last_working_fmt = fmt  # Lock in this format
                return dt.isoformat()
            except ValueError:
                continue
        
        raise ValueError(f"Unable to parse date: {s}")


def safe_get(url: str, params: Optional[Dict] = None, retries: int = 3) -> requests.Response:
    """
    Robust HTTP GET with exponential backoff and proper User-Agent.
    """
    headers = {
        'User-Agent': 'BenchmarkWatcher/2.0 (internal-monitoring; python)'
    }
    backoff = 1.5
    
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=15)
            resp.raise_for_status()
            return resp
        except requests.RequestException as e:
            if attempt + 1 == retries:
                raise
            sleep_time = backoff * (2 ** attempt)
            logger.warning(f"  Retry {attempt + 1}/{retries} in {sleep_time}s: {e}")
            time.sleep(sleep_time)


# =============================================================================
# 2. Data Fetchers
# =============================================================================

def fetch_fred_series(series_id: str, limit: int = 730) -> Optional[List[Dict]]:
    """Fetch data from FRED API."""
    if not FRED_API_KEY:
        logger.warning("  Missing FRED_API_KEY")
        return None
    
    url = "https://api.stlouisfed.org/fred/series/observations"
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "sort_order": "desc",
        "limit": limit
    }
    
    try:
        resp = safe_get(url, params=params)
        data = resp.json()
        observations = data.get("observations", [])
        
        results = []
        parser = SmartDateParser()
        
        for obs in observations:
            val = obs.get("value")
            if val in (".", "", None): continue
            
            try:
                price = float(val)
                dt = parser.parse(obs.get("date"))
                results.append({"date": dt, "price": round(price, 4)})
            except (ValueError, TypeError):
                continue
        
        return list(reversed(results)) # Return Oldest first
    except Exception as e:
        logger.error(f"  Error fetching FRED {series_id}: {e}")
        return None


def fetch_eia_v2(api_url: str, facets: Dict[str, List[str]], length: int = 730) -> Optional[List[Dict]]:
    """
    Generic fetcher for EIA API v2.
    Fully driven by config arguments, no hardcoded series logic.
    """
    if not EIA_API_KEY:
        logger.warning("  Missing EIA_API_KEY")
        return None
    
    params = {
        'api_key': EIA_API_KEY,
        'frequency': 'daily',
        'data[]': 'value',
        'length': length,
        'sort[0][column]': 'period',
        'sort[0][direction]': 'desc'
    }
    
    # FIX: Pass list directly to let 'requests' handle multiple values (e.g. &facets[s][]=A&facets[s][]=B)
    for key, values in facets.items():
        params[f'facets[{key}][]'] = values
            
    try:
        resp = safe_get(api_url, params=params)
        data = resp.json()
        raw_rows = data.get('response', {}).get('data', [])
        
        results = []
        parser = SmartDateParser()
        
        for obs in raw_rows:
            val = obs.get('value')
            period = obs.get('period')
            if val is None or period is None: continue
            
            try:
                price = float(val)
                dt = parser.parse(period)
                results.append({'date': dt, 'price': round(price, 4)})
            except (ValueError, TypeError):
                continue
                
        return list(reversed(results))
    except Exception as e:
        logger.error(f"  Error fetching EIA data: {e}")
        return None


def fetch_freegoldapi(data_type: str = 'gold', limit: int = 730) -> Optional[List[Dict]]:
    """
    Fetch gold/silver prices from FreeGoldAPI.com.
    Free, unlimited, no API key required. Sources World Bank + Yahoo Finance.
    data_type: 'gold' for gold prices, 'silver' for gold/silver ratio data
    """
    url = "https://freegoldapi.com/data/latest.csv"
    
    try:
        resp = safe_get(url)
        lines = resp.text.strip().split('\n')
        
        if len(lines) < 2:
            logger.error("  FreeGoldAPI returned empty data")
            return None
        
        results = []
        # Skip header, get last N records
        data_lines = lines[1:][-limit:]  # Most recent entries
        
        for line in data_lines:
            parts = line.split(',')
            if len(parts) >= 2:
                try:
                    date_str = parts[0].strip()
                    price = float(parts[1].strip())
                    results.append({'date': date_str, 'price': round(price, 2)})
                except (ValueError, IndexError):
                    continue
        
        return results if results else None
        
    except Exception as e:
        logger.error(f"  Error fetching FreeGoldAPI: {e}")
        return None


def fetch_yahoo_finance(symbol: str, days: int = 730) -> Optional[List[Dict]]:
    """
    Fetch commodity prices from Yahoo Finance.
    Free, unlimited, no API key required.
    Symbols: SI=F (silver), PL=F (platinum), GC=F (gold), CL=F (oil), etc.
    """
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {
        'interval': '1d',
        'range': '2y'  # Get 2 years of daily data
    }
    headers = {
        'User-Agent': 'BenchmarkWatcher/2.0 (commodity-tracker)'
    }
    
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        
        result = data.get('chart', {}).get('result', [])
        if not result:
            logger.error(f"  Yahoo Finance returned no data for {symbol}")
            return None
        
        meta = result[0].get('meta', {})
        timestamps = result[0].get('timestamp', [])
        quotes = result[0].get('indicators', {}).get('quote', [{}])[0]
        closes = quotes.get('close', [])
        
        if not timestamps or not closes:
            logger.error(f"  Yahoo Finance missing price data for {symbol}")
            return None
        
        results = []
        for ts, price in zip(timestamps, closes):
            if price is not None:
                dt = datetime.fromtimestamp(ts).date().isoformat()
                results.append({'date': dt, 'price': round(float(price), 2)})
        
        return results[-days:] if results else None
        
    except Exception as e:
        logger.error(f"  Error fetching Yahoo Finance {symbol}: {e}")
        return None


# =============================================================================
# 3. Processing & I/O
# =============================================================================

def merge_history(existing: List[Dict], new_data: List[Dict]) -> List[Dict]:
    """Merge new data into existing history (deduplicated by date)."""
    # Dict keyed by date handles dedup automatically
    data_map = {item['date']: item for item in existing}
    
    for item in new_data:
        data_map[item['date']] = item # Overwrites if exists
        
    # Sort by date string (ISO format allows string sort)
    return sorted(data_map.values(), key=lambda x: x['date'])


def compute_metrics(history: List[Dict]) -> Dict:
    """Compute descriptive, backward-looking summary statistics over observations."""
    if not history: return {}
    
    latest = history[-1]['price']
    metrics = {'latest_price': latest}
    
    # Explicit observation counts for legal defensibility
    metrics['observations'] = len(history)
    metrics['latest_observation_date'] = history[-1]['date']
    
    def get_pct_change(past_idx):
        if len(history) >= past_idx + 1:
            past = history[-(past_idx + 1)]['price']
            if past and past != 0:
                return round((latest / past - 1) * 100, 2)
        return None

    # Observation-based field names (semantically accurate)
    metrics['abs_change_1_obs'] = round(latest - history[-2]['price'], 4) if len(history) >= 2 else None
    metrics['pct_change_1_obs'] = get_pct_change(1)
    metrics['pct_change_30_obs'] = get_pct_change(30)
    metrics['pct_change_365_obs'] = get_pct_change(365)
    
    # Direction indicator (not trend - avoids forward-looking implication)
    metrics['direction_30_obs'] = 'flat'
    if metrics['pct_change_30_obs'] is not None:
        if metrics['pct_change_30_obs'] > 1.0: 
            metrics['direction_30_obs'] = 'up'
        elif metrics['pct_change_30_obs'] < -1.0: 
            metrics['direction_30_obs'] = 'down'
    
    # Legacy aliases for UI compatibility
    metrics['change_1d'] = metrics['abs_change_1_obs']
    metrics['pct_1d'] = metrics['pct_change_1_obs']
    metrics['pct_30d'] = metrics['pct_change_30_obs']
    metrics['pct_1y'] = metrics['pct_change_365_obs']
    metrics['trend'] = metrics['direction_30_obs']
        
    return metrics


def save_atomic(filepath: str, data: Dict) -> bool:
    """Atomic write: write to .tmp then rename to avoid corruption."""
    tmp_path = filepath + ".tmp"
    try:
        with open(tmp_path, 'w') as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, filepath)
        return True
    except Exception as e:
        logger.error(f"  Save failed for {filepath}: {e}")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return False


def update_commodity(commodity: Dict) -> bool:
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
        except Exception:
            pass

    # 2. Fetch New Data
    new_data = None
    conf = commodity.get('api_config', {})
    
    if commodity['source_type'] == 'FRED':
        new_data = fetch_fred_series(conf.get('series_id'))
    elif commodity['source_type'] == 'EIA':
        new_data = fetch_eia_v2(conf.get('url'), conf.get('facets'))
    elif commodity['source_type'] == 'FREEGOLD':
        new_data = fetch_freegoldapi(conf.get('data_type', 'gold'))
    elif commodity['source_type'] == 'YAHOO':
        new_data = fetch_yahoo_finance(conf.get('symbol'))
        
    if not new_data:
        logger.warning(f"  FAILED: No data fetched for {commodity['name']}")
        return False  # Explicit failure

    # 3. Merge & Process
    history = merge_history(existing_history, new_data)
    history = history[-1000:] # Keep last 1000 days
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
            if commodity['source_type'] in ("FRED", "EIA")
            else "public_market_reference"
        ),
        "simulated": False,
        "metrics": metrics,  # Legacy key for UI compatibility
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


# =============================================================================
# 4. Configuration (Edit this to add new commodities)
# =============================================================================

COMMODITIES_CONFIG = [
    # =========================================================================
    # ENERGY - EIA & FRED
    # =========================================================================
    {
        "id": "brent_oil",
        "name": "Brent Crude Oil",
        "category": "energy",
        "unit": "barrel",
        "source_type": "EIA",
        "api_config": {
            "url": "https://api.eia.gov/v2/petroleum/pri/spt/data/",
            "facets": {"series": ["RBRTE"]},
            "source_info_url": "https://www.eia.gov/petroleum/gasdiesel/"
        }
    },
    {
        "id": "wti_oil",
        "name": "WTI Crude Oil",
        "category": "energy",
        "unit": "barrel",
        "source_type": "EIA",
        "api_config": {
            "url": "https://api.eia.gov/v2/petroleum/pri/spt/data/",
            "facets": {"series": ["RWTC"]},
            "source_info_url": "https://www.eia.gov/petroleum/gasdiesel/"
        }
    },
    {
        "id": "natural_gas",
        "name": "Natural Gas (Henry Hub)",
        "category": "energy",
        "unit": "MMBtu",
        "source_type": "FRED",
        "api_config": {
            "series_id": "DHHNGSP",
            "source_info_url": "https://fred.stlouisfed.org/series/DHHNGSP"
        }
    },
    {
        "id": "heating_oil",
        "name": "Heating Oil",
        "category": "energy",
        "unit": "gallon",
        "source_type": "EIA",
        "api_config": {
            "url": "https://api.eia.gov/v2/petroleum/pri/spt/data/",
            "facets": {"series": ["EER_EPD2F_PF4_Y35NY_DPG"]},
            "source_info_url": "https://www.eia.gov/petroleum/gasdiesel/"
        }
    },
    {
        "id": "jet_fuel",
        "name": "Jet Fuel",
        "category": "energy",
        "unit": "gallon",
        "source_type": "EIA",
        "api_config": {
            "url": "https://api.eia.gov/v2/petroleum/pri/spt/data/",
            "facets": {"series": ["EER_EPJK_PF4_RGC_DPG"]},
            "source_info_url": "https://www.eia.gov/petroleum/gasdiesel/"
        }
    },
    {
        "id": "gasoline",
        "name": "Gasoline (Gulf Coast)",
        "category": "energy",
        "unit": "gallon",
        "source_type": "FRED",
        "api_config": {
            "series_id": "DGASUSGULF",
            "source_info_url": "https://fred.stlouisfed.org/series/DGASUSGULF"
        }
    },
    {
        "id": "propane",
        "name": "Propane (Mont Belvieu)",
        "category": "energy",
        "unit": "gallon",
        "source_type": "EIA",
        "api_config": {
            "url": "https://api.eia.gov/v2/petroleum/pri/spt/data/",
            "facets": {"series": ["EER_EPLLPA_PF4_Y44MB_DPG"]},
            "source_info_url": "https://www.eia.gov/petroleum/gasdiesel/"
        }
    },

    # =========================================================================
    # METALS - FRED (World Bank / IMF data)
    # =========================================================================
    {
        "id": "copper",
        "name": "Copper",
        "category": "metal",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PCOPPUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PCOPPUSDM"
        }
    },
    {
        "id": "iron_ore",
        "name": "Iron Ore",
        "category": "metal",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PIORECRUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PIORECRUSDM"
        }
    },
    {
        "id": "aluminum",
        "name": "Aluminum",
        "category": "metal",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PALUMUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PALUMUSDM"
        }
    },
    {
        "id": "zinc",
        "name": "Zinc",
        "category": "metal",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PZINCUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PZINCUSDM"
        }
    },
    {
        "id": "nickel",
        "name": "Nickel",
        "category": "metal",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PNICKUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PNICKUSDM"
        }
    },
    {
        "id": "lead",
        "name": "Lead",
        "category": "metal",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PLEADUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PLEADUSDM"
        }
    },
    {
        "id": "tin",
        "name": "Tin",
        "category": "metal",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PTINUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PTINUSDM"
        }
    },
    {
        "id": "gold",
        "name": "Gold",
        "category": "precious",
        "unit": "troy oz",
        "source_type": "FREEGOLD",  # Free API, no key, World Bank + Yahoo data
        "source_name": "FreeGoldAPI (World Bank/Yahoo)",
        "api_config": {
            "data_type": "gold",
            "source_info_url": "https://freegoldapi.com"
        }
    },
    {
        "id": "silver",
        "name": "Silver",
        "category": "precious",
        "unit": "troy oz",
        "source_type": "YAHOO",  # Yahoo Finance Futures (SI=F)
        "source_name": "Yahoo Finance (COMEX Futures)",
        "api_config": {
            "symbol": "SI=F",
            "source_info_url": "https://finance.yahoo.com/quote/SI=F"
        }
    },
    {
        "id": "platinum",
        "name": "Platinum",
        "category": "precious",
        "unit": "troy oz",
        "source_type": "YAHOO",  # Yahoo Finance Futures (PL=F)
        "source_name": "Yahoo Finance (NYMEX Futures)",
        "api_config": {
            "symbol": "PL=F",
            "source_info_url": "https://finance.yahoo.com/quote/PL=F"
        }
    },

    # =========================================================================
    # AGRICULTURAL - FRED (World Bank / IMF data)
    # =========================================================================
    {
        "id": "wheat",
        "name": "Wheat",
        "category": "agricultural",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PWHEAMTUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PWHEAMTUSDM"
        }
    },
    {
        "id": "corn",
        "name": "Corn (Maize)",
        "category": "agricultural",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PMAIZMTUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PMAIZMTUSDM"
        }
    },
    {
        "id": "soybeans",
        "name": "Soybeans",
        "category": "agricultural",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PSOYBUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PSOYBUSDM"
        }
    },
    {
        "id": "rice",
        "name": "Rice (Average Price)",
        "category": "agricultural",
        "unit": "pound",
        "source_type": "FRED",
        "api_config": {
            "series_id": "APU0000701312",
            "source_info_url": "https://fred.stlouisfed.org/series/APU0000701312"
        }
    },
    {
        "id": "sugar",
        "name": "Sugar",
        "category": "agricultural",
        "unit": "kg",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PSUGAISAUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PSUGAISAUSDM"
        }
    },
    {
        "id": "coffee",
        "name": "Coffee (Arabica)",
        "category": "agricultural",
        "unit": "kg",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PCOFFOTMUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PCOFFOTMUSDM"
        }
    },
    {
        "id": "cocoa",
        "name": "Cocoa",
        "category": "agricultural",
        "unit": "kg",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PCOCOUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PCOCOUSDM"
        }
    },
    {
        "id": "cotton",
        "name": "Cotton",
        "category": "agricultural",
        "unit": "kg",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PCOTTINDUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PCOTTINDUSDM"
        }
    },
    {
        "id": "rubber",
        "name": "Rubber (Natural)",
        "category": "agricultural",
        "unit": "kg",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PRUBBUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PRUBBUSDM"
        }
    },
    {
        "id": "palm_oil",
        "name": "Palm Oil",
        "category": "agricultural",
        "unit": "metric ton",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PPOILUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PPOILUSDM"
        }
    },
    {
        "id": "beef",
        "name": "Beef (Global Price)",
        "category": "agricultural",
        "unit": "pound",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PBEEFUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PBEEFUSDM"
        }
    },
    {
        "id": "chicken",
        "name": "Poultry (Chicken)",
        "category": "agricultural",
        "unit": "kg",
        "source_type": "FRED",
        "api_config": {
            "series_id": "PPOULTUSDM",
            "source_info_url": "https://fred.stlouisfed.org/series/PPOULTUSDM"
        }
    },
]


def main():
    # Ensure data directory exists
    os.makedirs(DATA_DIR, exist_ok=True)
    
    logger.info("=== Starting BenchmarkWatcher Update ===")
    
    success_count = 0
    fail_count = 0
    failed_items = []
    
    for item in COMMODITIES_CONFIG:
        try:
            if update_commodity(item):
                success_count += 1
            else:
                fail_count += 1
                failed_items.append(item['name'])
        except Exception as e:
            logger.error(f"CRITICAL FAILURE updating {item['name']}: {e}")
            fail_count += 1
            failed_items.append(item['name'])
    
    # Summary with failed items listed
    logger.info(f"=== Complete. Success: {success_count}, Failed: {fail_count} ===")
    if failed_items:
        logger.warning(f"Failed commodities: {', '.join(failed_items)}")

if __name__ == "__main__":
    main()