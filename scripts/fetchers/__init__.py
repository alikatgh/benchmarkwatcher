"""
BenchmarkWatcher Data Fetchers
------------------------------
Modular fetcher package. Each source has its own module.
The FETCHER_REGISTRY maps source_type strings to callable fetchers.
"""

from scripts.fetchers.fred import fetch_fred_series
from scripts.fetchers.eia import fetch_eia_v2
from scripts.fetchers.yahoo import fetch_yahoo_finance
from scripts.fetchers.usda import fetch_usda_nass

FETCHER_REGISTRY = {
    "FRED": fetch_fred_series,
    "EIA": fetch_eia_v2,
    "YAHOO": fetch_yahoo_finance,
    "USDA": fetch_usda_nass,
}
