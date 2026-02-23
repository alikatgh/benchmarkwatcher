"""
World Bank Commodity Prices fetcher.

NOTE: The World Bank's commodity price data (Pink Sheet) is NOT available
through their standard indicator API (v2). It is only distributed as
downloadable Excel/CSV files from:
https://www.worldbank.org/en/research/commodity-markets

The same underlying data (IMF Primary Commodity Prices) is already available
on FRED, which is why most World Bank commodity series are fetched via
the FRED fetcher using series IDs like PCOALAUUSDM, POILBREUSDM, etc.

This module is reserved for future integration if the World Bank
publishes a proper JSON API for commodity prices.
"""

import logging
from typing import List, Optional, Dict

logger = logging.getLogger(__name__)


def fetch_worldbank_commodity(indicator: str, **kwargs) -> Optional[List[Dict]]:
    """
    Placeholder for World Bank commodity price data.

    Currently, the World Bank does not expose commodity prices through their
    standard API. Their Pink Sheet data is available via FRED instead.

    Returns None (not implemented).
    """
    logger.warning(
        f"  World Bank fetcher not yet implemented for {indicator}. "
        f"Use FRED series instead (same underlying IMF data)."
    )
    return None
