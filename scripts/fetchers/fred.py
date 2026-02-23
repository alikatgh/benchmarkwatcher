"""FRED (Federal Reserve Economic Data) fetcher."""

import os
import logging
from typing import List, Optional, Dict

from scripts.fetchers._shared import SmartDateParser, safe_get

logger = logging.getLogger(__name__)

FRED_API_KEY = os.getenv('FRED_API_KEY')


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
            if val in (".", "", None):
                continue

            try:
                price = float(val)
                dt = parser.parse(obs.get("date"))
                results.append({"date": dt, "price": round(price, 4)})
            except (ValueError, TypeError):
                continue

        return list(reversed(results))  # Return Oldest first
    except Exception as e:
        logger.error(f"  Error fetching FRED {series_id}: {e}")
        return None
