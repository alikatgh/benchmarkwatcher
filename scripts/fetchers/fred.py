"""FRED (Federal Reserve Economic Data) fetcher."""

import os
import logging
from typing import Any, Dict, List, Optional

from scripts.fetchers._shared import parse_records, safe_get

logger = logging.getLogger(__name__)


def _get_fred_api_key() -> str:
    """Read FRED_API_KEY at call time so env changes are picked up."""
    return os.getenv('FRED_API_KEY', '')


def fetch_fred_series(series_id: str, limit: int = 730) -> Optional[List[Dict[str, Any]]]:
    """Fetch data from FRED API."""
    api_key = _get_fred_api_key()
    if not api_key:
        logger.warning("  Missing FRED_API_KEY")
        return None

    url = "https://api.stlouisfed.org/fred/series/observations"
    params: Dict[str, Any] = {
        "series_id": series_id,
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "desc",
        "limit": limit,
    }

    try:
        resp = safe_get(url, params=params)
        observations = resp.json().get("observations", [])
        return parse_records(observations, value_key="value", date_key="date", skip_values=(".", ""))
    except Exception as e:
        logger.error(f"  Error fetching FRED {series_id}: {e}")
        return None
