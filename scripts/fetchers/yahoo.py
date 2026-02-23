"""Yahoo Finance fetcher — commodity futures prices."""

import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict

from scripts.fetchers._shared import safe_get

logger = logging.getLogger(__name__)


def fetch_yahoo_finance(symbol: str, days: int = 730) -> Optional[List[Dict]]:
    """
    Fetch commodity prices from Yahoo Finance.
    Free, unlimited, no API key required.
    Symbols: SI=F (silver), PL=F (platinum), GC=F (gold), CL=F (oil), etc.
    """
    end = int(datetime.now().timestamp())
    start = int((datetime.now() - timedelta(days=days)).timestamp())
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

    params = {
        "period1": start,
        "period2": end,
        "interval": "1d",
    }

    try:
        resp = safe_get(url, params=params)
        data = resp.json()

        chart = data.get("chart", {}).get("result", [])
        if not chart:
            return None

        timestamps = chart[0].get("timestamp", [])
        closes = chart[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])

        results = []
        for ts, price in zip(timestamps, closes):
            if price is None:
                continue
            dt = datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d')
            results.append({"date": dt, "price": round(float(price), 4)})

        return results
    except Exception as e:
        logger.error(f"  Error fetching Yahoo Finance ({symbol}): {e}")
        return None
