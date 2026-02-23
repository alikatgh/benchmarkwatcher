"""FreeGoldAPI fetcher — gold/silver prices from freegoldapi.com."""

import logging
from typing import List, Optional, Dict

from scripts.fetchers._shared import safe_get

logger = logging.getLogger(__name__)


def fetch_freegoldapi(data_type: str = 'gold', limit: int = 730) -> Optional[List[Dict]]:
    """
    Fetch gold/silver prices from FreeGoldAPI.com.
    Free, unlimited, no API key required. Sources World Bank + Yahoo Finance.
    data_type: 'gold' for gold prices, 'silver' for gold/silver ratio data
    """
    url = f"https://www.freegoldapi.com/api/{data_type}"

    try:
        resp = safe_get(url)
        data = resp.json()

        if isinstance(data, dict) and 'prices' in data:
            records = data['prices']
        elif isinstance(data, list):
            records = data
        else:
            logger.warning(f"  Unexpected FreeGoldAPI response structure")
            return None

        results = []
        for rec in records[-limit:]:
            try:
                dt = rec.get('date', '')[:10]
                price = float(rec.get('price', rec.get('value', 0)))
                if dt and price > 0:
                    results.append({"date": dt, "price": round(price, 4)})
            except (ValueError, TypeError):
                continue

        return results
    except Exception as e:
        logger.error(f"  Error fetching FreeGoldAPI ({data_type}): {e}")
        return None
