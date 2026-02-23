"""
BenchmarkWatcher Data Fetchers
------------------------------
Modular fetcher package. Each source has its own module.
The FETCHER_REGISTRY maps source_type strings to callable fetchers.
"""

from scripts.fetchers.fred import fetch_fred_series
from scripts.fetchers.eia import fetch_eia_v2
from scripts.fetchers.freegold import fetch_freegoldapi
from scripts.fetchers.yahoo import fetch_yahoo_finance
from scripts.fetchers.worldbank import fetch_worldbank_commodity
from scripts.fetchers.usda import fetch_usda_nass

FETCHER_REGISTRY = {
    "FRED": fetch_fred_series,
    "EIA": fetch_eia_v2,
    "FREEGOLD": fetch_freegoldapi,
    "YAHOO": fetch_yahoo_finance,
    "WORLDBANK": fetch_worldbank_commodity,
    "USDA": fetch_usda_nass,
}
