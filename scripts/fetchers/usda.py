"""
USDA NASS QuickStats API fetcher.
Requires API key from https://quickstats.nass.usda.gov/api
Provides US agricultural commodity prices, production data, and livestock stats.

Reference: https://quickstats.nass.usda.gov/api
"""

import os
import logging
from typing import List, Optional, Dict

from scripts.fetchers._shared import SmartDateParser, safe_get

logger = logging.getLogger(__name__)

USDA_API_KEY = os.getenv('USDA_API_KEY')
USDA_API_BASE = "https://quickstats.nass.usda.gov/api/api_GET/"


def fetch_usda_nass(
    commodity_desc: str,
    statisticcat_desc: str = "PRICE RECEIVED",
    unit_desc: str = "$ / BU",
    freq_desc: str = "MONTHLY",
    agg_level_desc: str = "NATIONAL",
    year_start: int = 2000,
    **extra_params
) -> Optional[List[Dict]]:
    """
    Fetch commodity data from USDA NASS QuickStats API.

    Args:
        commodity_desc: e.g., 'CORN', 'WHEAT', 'SOYBEANS', 'CATTLE'
        statisticcat_desc: e.g., 'PRICE RECEIVED', 'PRODUCTION'
        unit_desc: e.g., '$ / BU', '$ / CWT', '$ / LB'
        freq_desc: 'MONTHLY', 'ANNUAL', 'WEEKLY'
        agg_level_desc: 'NATIONAL', 'STATE'
        year_start: earliest year to fetch
        **extra_params: additional NASS API params

    Returns:
        List of {date, price} dicts, oldest first. None on failure.
    """
    if not USDA_API_KEY:
        logger.warning("  Missing USDA_API_KEY")
        return None

    params = {
        "key": USDA_API_KEY,
        "commodity_desc": commodity_desc,
        "statisticcat_desc": statisticcat_desc,
        "unit_desc": unit_desc,
        "freq_desc": freq_desc,
        "agg_level_desc": agg_level_desc,
        "year__GE": str(year_start),
        "format": "JSON",
    }
    params.update(extra_params)

    try:
        resp = safe_get(USDA_API_BASE, params=params)
        data = resp.json()

        records = data.get("data", [])
        if not records:
            logger.warning(f"  No USDA data for {commodity_desc}")
            return None

        results = []
        parser = SmartDateParser()

        for rec in records:
            val = rec.get("Value", "").replace(",", "").strip()
            if not val or val in ("(D)", "(NA)", "(S)", "(Z)"):
                continue

            try:
                price = float(val)
                year = rec.get("year", "")
                # Build date from year + reference_period_desc
                ref_period = rec.get("reference_period_desc", "").upper()

                month_map = {
                    "JAN": "01", "FEB": "02", "MAR": "03", "APR": "04",
                    "MAY": "05", "JUN": "06", "JUL": "07", "AUG": "08",
                    "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12",
                    "YEAR": "06",  # Annual → mid-year
                    "MARKETING YEAR": "06",
                }

                month = month_map.get(ref_period, None)
                if not month:
                    # Try to parse from begin_code or other fields
                    begin_code = rec.get("begin_code", "")
                    if begin_code and begin_code.isdigit():
                        month = begin_code.zfill(2)
                    else:
                        continue

                dt = f"{year}-{month}-01"
                results.append({"date": dt, "price": round(price, 4)})
            except (ValueError, TypeError):
                continue

        # Sort oldest first, deduplicate by date
        seen = {}
        for r in results:
            seen[r["date"]] = r
        results = sorted(seen.values(), key=lambda x: x["date"])

        return results if results else None

    except Exception as e:
        logger.error(f"  Error fetching USDA {commodity_desc}: {e}")
        return None
