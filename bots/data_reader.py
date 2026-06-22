"""
BenchmarkWatcher Data Reader
Shared data access layer for bots - reads from ../data/*.json
"""
import json
import os
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from config import DATA_DIR, CATEGORIES, ALIASES


def _coerce_price(price) -> float:
    """Coerce a possibly null/non-numeric price to a safe float for formatting."""
    # bool is an int subclass; treat numeric-but-not-bool as a real price.
    if isinstance(price, (int, float)) and not isinstance(price, bool):
        return float(price)
    return 0.0


def _coerce_pct(data: Dict) -> float:
    """Extract the 1-observation percent change, coercing None/missing to 0.0.

    Both `derived.descriptive_stats.pct_change_1_obs` and `metrics.pct_1d` can be
    present-but-None for a <2-observation commodity; `dict.get(k, default)` does
    NOT fall back when the stored value is None, so an explicit None check is
    required to avoid `TypeError` when the pct is later compared/formatted.
    """
    derived = data.get('derived', {}).get('descriptive_stats', {})
    metrics = data.get('metrics', {})
    v = derived.get('pct_change_1_obs')
    if v is None:
        v = metrics.get('pct_1d')
    return v if v is not None else 0.0


def _is_safe_path(filepath: str) -> bool:
    """Check if filepath is safely within DATA_DIR (prevent directory traversal)."""
    try:
        real_filepath = os.path.realpath(filepath)
        real_data_dir = os.path.realpath(DATA_DIR)
        return real_filepath.startswith(real_data_dir + os.sep) or real_filepath == real_data_dir
    except (OSError, ValueError):
        return False


def get_commodity_data(commodity_id: str) -> Optional[Dict]:
    """Load a single commodity's data from JSON file."""
    if not isinstance(commodity_id, str):
        return None

    # Resolve aliases
    commodity_id = ALIASES.get(commodity_id.lower(), commodity_id.lower())

    # Sanitize: only allow alphanumeric, underscore, hyphen
    if not commodity_id or not all(c.isalnum() or c in ('_', '-') for c in commodity_id):
        return None

    filepath = os.path.join(DATA_DIR, f"{commodity_id}.json")

    # Validate path is within DATA_DIR (prevent directory traversal)
    if not _is_safe_path(filepath):
        return None

    if not os.path.exists(filepath):
        return None

    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


# Short-TTL module cache for the full directory scan. A single bot command
# (e.g. !top) reads every commodity; without a cache each call re-listdir's
# DATA_DIR and re-reads every JSON file. The TTL keeps data fresh enough for a
# chat bot while collapsing the repeated full scans within a burst of activity.
_ALL_COMMODITIES_TTL_SECONDS = 30.0
_all_commodities_cache: Optional[List[Dict]] = None
_all_commodities_cache_ts: float = 0.0


def _invalidate_all_commodities_cache() -> None:
    """Drop the cached commodity list (used by tests)."""
    global _all_commodities_cache, _all_commodities_cache_ts
    _all_commodities_cache = None
    _all_commodities_cache_ts = 0.0


def get_all_commodities() -> List[Dict]:
    """Load all commodities (short-TTL cached)."""
    global _all_commodities_cache, _all_commodities_cache_ts

    now = time.monotonic()
    if (
        _all_commodities_cache is not None
        and (now - _all_commodities_cache_ts) < _ALL_COMMODITIES_TTL_SECONDS
    ):
        return _all_commodities_cache

    commodities = []

    if not os.path.exists(DATA_DIR):
        _all_commodities_cache = commodities
        _all_commodities_cache_ts = now
        return commodities

    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json') and filename != 'schema.json':
            try:
                with open(os.path.join(DATA_DIR, filename), 'r') as f:
                    item = json.load(f)
                    item['id'] = filename.replace('.json', '')
                    commodities.append(item)
            except (json.JSONDecodeError, IOError):
                continue

    _all_commodities_cache = commodities
    _all_commodities_cache_ts = now
    return commodities


def get_commodities_by_category(category: str) -> List[Dict]:
    """Get commodities for a specific category."""
    category = category.lower()
    if category not in CATEGORIES:
        return []

    commodities = []
    for commodity_id in CATEGORIES[category]:
        data = get_commodity_data(commodity_id)
        if data:
            data['id'] = commodity_id
            commodities.append(data)

    return commodities


def format_price_message(data: Dict, include_link: bool = True) -> str:
    """Format a commodity price for bot response."""
    name = data.get('name', 'Unknown')
    price = _coerce_price(data.get('price'))
    unit = data.get('unit', 'USD')

    # Get change from derived stats (coerced to handle null/missing pct)
    change_pct = _coerce_pct(data)

    # Format date
    date_str = data.get('date', '')
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        formatted_date = date_obj.strftime('%b %d')
    except ValueError:
        formatted_date = date_str

    # Direction emoji
    if change_pct > 0:
        direction = '📈'
        sign = '+'
    elif change_pct < 0:
        direction = '📉'
        sign = ''
    else:
        direction = '➡️'
        sign = ''

    # Build message
    msg = f"{direction} **{name}**: ${price:,.2f} ({sign}{change_pct:.2f}%)"
    msg += f"\n   └ Updated: {formatted_date}"

    return msg


def format_compact_price(data: Dict) -> str:
    """Format a commodity price in compact form for lists."""
    name = data.get('name', 'Unknown')
    price = _coerce_price(data.get('price'))
    change_pct = _coerce_pct(data)

    if change_pct > 0:
        sign = '+'
        emoji = '🟢'
    elif change_pct < 0:
        sign = ''
        emoji = '🔴'
    else:
        sign = ''
        emoji = '⚪'

    return f"{emoji} {name}: ${price:,.2f} ({sign}{change_pct:.2f}%)"


def _get_change_pct(c: Dict) -> float:
    """Extract percentage change from a commodity dict without mutating it.

    Routes through the shared coercer so a present-but-None pct (a <2-observation
    commodity) is treated as 0.0 instead of crashing the sort/comparison.
    """
    return _coerce_pct(c)


def get_top_movers(limit: int = 5) -> Tuple[List[Dict], List[Dict]]:
    """Get top gainers and losers."""
    commodities = get_all_commodities()

    # Compute the pct once per commodity (decorate-sort-undecorate) instead of
    # re-deriving it inside the sort key AND twice more in the filters.
    decorated = sorted(
        ((_get_change_pct(c), c) for c in commodities),
        key=lambda pair: pair[0],
        reverse=True,
    )

    gainers = [c for pct, c in decorated if pct > 0][:limit]
    losers = [c for pct, c in decorated if pct < 0][-limit:][::-1]

    return gainers, losers


def get_available_commodities() -> List[str]:
    """Get list of all available commodity IDs."""
    if not os.path.exists(DATA_DIR):
        return []

    commodities = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json') and filename != 'schema.json':
            commodities.append(filename.replace('.json', ''))

    return sorted(commodities)


def search_commodity(query: str) -> Optional[Dict]:
    """Search for a commodity by name or alias."""
    query = query.lower().strip()

    # Check aliases first
    if query in ALIASES:
        return get_commodity_data(ALIASES[query])

    # Try direct match
    data = get_commodity_data(query)
    if data:
        return data

    # Try partial name match
    all_commodities = get_all_commodities()
    for c in all_commodities:
        if query in c.get('name', '').lower():
            return c

    return None
