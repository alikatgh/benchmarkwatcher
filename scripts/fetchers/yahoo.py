"""Yahoo Finance fetcher — commodity futures prices."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from scripts.fetchers._shared import Observation, safe_get

logger = logging.getLogger(__name__)


def _timestamps_to_observations(
    timestamps: List[int],
    closes: List[Optional[float]],
) -> List[Observation]:
    """Convert parallel timestamp/close arrays into [{date, price}] observations."""
    results: List[Observation] = []
    for ts, price in zip(timestamps, closes):
        if price is None:
            continue
        dt = datetime.fromtimestamp(ts, tz=timezone.utc).strftime('%Y-%m-%d')
        results.append({"date": dt, "price": round(float(price), 4)})
    return results


def fetch_yahoo_finance(symbol: str, days: int = 730) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch commodity prices from Yahoo Finance.
    Free, unlimited, no API key required.
    Symbols: SI=F (silver), PL=F (platinum), GC=F (gold), CL=F (oil), etc.
    """
    now = datetime.now(tz=timezone.utc)
    end = int(now.timestamp())
    start = int((now - timedelta(days=days)).timestamp())
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

    params: Dict[str, Any] = {
        "period1": start,
        "period2": end,
        "interval": "1d",
    }

    try:
        resp = safe_get(url, params=params)
        chart = resp.json().get("chart", {}).get("result", [])
        if not chart:
            return None

        timestamps = chart[0].get("timestamp", [])
        closes = chart[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])

        return _timestamps_to_observations(timestamps, closes)
    except Exception as e:
        logger.error(f"  Error fetching Yahoo Finance ({symbol}): {e}")
        return None
