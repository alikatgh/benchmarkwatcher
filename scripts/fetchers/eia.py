"""EIA (U.S. Energy Information Administration) API v2 fetcher."""

import os
import logging
from typing import List, Optional, Dict

from scripts.fetchers._shared import SmartDateParser, safe_get

logger = logging.getLogger(__name__)

EIA_API_KEY = os.getenv('EIA_API_KEY')


def fetch_eia_v2(api_url: str, facets: Dict[str, List[str]], length: int = 730) -> Optional[List[Dict]]:
    """
    Generic fetcher for EIA API v2.
    Fully driven by config arguments, no hardcoded series logic.
    """
    if not EIA_API_KEY:
        logger.warning("  Missing EIA_API_KEY")
        return None

    params = {
        "api_key": EIA_API_KEY,
        "length": length,
        "data[0]": "value",  # Must explicitly request value column
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
    }

    # Build query params as list of tuples so repeated facet keys are preserved.
    query_params = list(params.items())

    # Add facets dynamically
    for key, values in facets.items():
        for val in values:
            query_params.append((f"facets[{key}][]", val))

    try:
        resp = safe_get(api_url, params=query_params)
        data = resp.json()
        records = data.get("response", {}).get("data", [])

        results = []
        parser = SmartDateParser()

        for rec in records:
            val = rec.get("value")
            if val is None:
                continue
            try:
                price = float(val)
                dt = parser.parse(rec.get("period"))
                results.append({"date": dt, "price": round(price, 4)})
            except (ValueError, TypeError):
                continue

        return list(reversed(results))
    except Exception as e:
        logger.error(f"  Error fetching EIA: {e}")
        return None
