"""EIA (U.S. Energy Information Administration) API v2 fetcher."""

import os
import logging
from typing import Any, Dict, List, Optional, Tuple

from scripts.fetchers._shared import parse_records, safe_get

logger = logging.getLogger(__name__)


def _get_eia_api_key() -> str:
    """Read EIA_API_KEY at call time so env changes are picked up."""
    return os.getenv('EIA_API_KEY', '')


def _build_eia_params(
    api_key: str,
    facets: Dict[str, List[str]],
    length: int,
) -> List[Tuple[str, Any]]:
    """Build query params as list of tuples so repeated facet keys are preserved."""
    base: Dict[str, Any] = {
        "api_key": api_key,
        "length": length,
        "data[0]": "value",
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
    }
    query_params: List[Tuple[str, Any]] = list(base.items())
    for key, values in facets.items():
        for val in values:
            query_params.append((f"facets[{key}][]", val))
    return query_params


def fetch_eia_v2(
    api_url: str,
    facets: Dict[str, List[str]],
    length: int = 730,
) -> Optional[List[Dict[str, Any]]]:
    """
    Generic fetcher for EIA API v2.
    Fully driven by config arguments, no hardcoded series logic.
    """
    api_key = _get_eia_api_key()
    if not api_key:
        logger.warning("  Missing EIA_API_KEY")
        return None

    query_params = _build_eia_params(api_key, facets, length)

    try:
        resp = safe_get(api_url, params=query_params)
        records = resp.json().get("response", {}).get("data", [])
        return parse_records(records, value_key="value", date_key="period")
    except Exception as e:
        logger.error(f"  Error fetching EIA: {e}")
        return None
