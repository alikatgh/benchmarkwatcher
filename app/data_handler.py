import json
import os
import logging
import math
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from flask import current_app
from app.extensions import cache

logger = logging.getLogger(__name__)

DAILY_SOURCE_TYPES = {'EIA', 'YAHOO', 'FREEGOLD'}
DAILY_COMMODITY_IDS = {
    'brent_oil',
    'wti_oil',
    'natural_gas',
    'heating_oil',
    'jet_fuel',
    'propane',
    'gold',
    'silver',
    'gasoline',
    'diesel',
    'rbob_gasoline',
    'platinum',
}

def get_date_range_days(date_range: str) -> Optional[int]:
    """Convert date range code to number of days for display filtering only.
    
    Note: This is UI-layer filtering for display purposes.
    All analytical calculations use observation-based metrics from the data model.
    """
    ranges = {
        '1W': 7,
        '1M': 30,
        '3M': 90,
        '6M': 180,
        '1Y': 365,
        'ALL': None
    }
    return ranges.get(date_range, None)

def filter_history_by_range(history: List[Dict[str, Any]], date_range: str) -> List[Dict[str, Any]]:
    """Filter history for display purposes only.
    
    Uses the latest observation date as reference (not current date).
    This handles datasets that aren't up-to-date.
    """
    days = get_date_range_days(date_range)
    if days is None or not history:
        return history
    
    try:
        latest_date = datetime.strptime(history[-1]['date'], '%Y-%m-%d')
    except (ValueError, KeyError, IndexError):
        return history
    
    cutoff_date = latest_date - timedelta(days=days)
    cutoff_date_str = cutoff_date.strftime('%Y-%m-%d')
    filtered = []
    for entry in history:
        date_str = entry.get('date', '')
        if date_str and date_str >= cutoff_date_str:
            filtered.append(entry)

    if not filtered:
        logger.warning(
            "filter_history_by_range: all %d entries were unparseable or outside range '%s'; "
            "falling back to last entry.",
            len(history), date_range
        )
        return history[-1:]
    return filtered


def _hydrate_change_fields(item: Dict[str, Any]) -> Dict[str, Any]:
    """Populate canonical and legacy change fields from derived metrics with fallback."""
    derived = item.get('derived', {}).get('descriptive_stats', {})
    metrics = item.get('metrics', {})

    item['change'] = derived.get('abs_change_1_obs', metrics.get('change_1d', 0.0))
    item['change_percent'] = derived.get('pct_change_1_obs', metrics.get('pct_1d', 0.0))
    item['daily_change'] = item['change']
    item['daily_change_percent'] = item['change_percent']
    item['derived_stats'] = derived
    return item


def _apply_latest_display_point(item: Dict[str, Any], history: List[Dict[str, Any]]) -> None:
    """Update top-level display price/date to match the latest entry in provided history."""
    if history:
        latest = history[-1]
        if 'price' in latest:
            item['price'] = latest['price']
        if 'date' in latest:
            item['date'] = latest['date']


def _set_previous_observation_fields(item: Dict[str, Any], history: List[Dict[str, Any]]) -> None:
    """Set previous observation fields for tooltip display."""
    if len(history) >= 2:
        previous = history[-2]
        item['prev_price'] = previous.get('price', item.get('price', 0))
        item['prev_date'] = previous.get('date', item.get('date', ''))
    else:
        item['prev_price'] = item.get('price', 0)
        item['prev_date'] = item.get('date', '')


def _set_display_change_fields_from_history(item: Dict[str, Any], history: List[Dict[str, Any]]) -> None:
    """Set display change fields from first→last observation in provided history window."""
    if not history:
        return

    try:
        first_price = float(history[0].get('price', 0))
        last_price = float(history[-1].get('price', first_price))
    except (TypeError, ValueError):
        return

    abs_change = last_price - first_price
    pct_change = (abs_change / first_price * 100) if first_price != 0 else 0.0

    item['change'] = abs_change
    item['change_percent'] = pct_change
    item['daily_change'] = abs_change
    item['daily_change_percent'] = pct_change


def _infer_is_daily(item: Dict[str, Any], history: List[Dict[str, Any]]) -> bool:
    """Infer whether a commodity is daily-frequency.

    Priority:
    1) Known daily sources / IDs
    2) Observed history cadence (median interval <= 10 days)
    """
    source_type = str(item.get('source_type', '')).upper()
    commodity_id = str(item.get('id', ''))

    if source_type in DAILY_SOURCE_TYPES or commodity_id in DAILY_COMMODITY_IDS:
        return True

    if len(history) < 3:
        return False

    parsed_dates: List[datetime] = []
    for entry in history[-40:]:
        try:
            parsed_dates.append(datetime.strptime(entry.get('date', ''), '%Y-%m-%d'))
        except (TypeError, ValueError):
            continue

    if len(parsed_dates) < 3:
        return False

    day_diffs: List[int] = []
    for idx in range(1, len(parsed_dates)):
        diff = (parsed_dates[idx] - parsed_dates[idx - 1]).days
        if diff > 0:
            day_diffs.append(diff)

    if not day_diffs:
        return False

    sorted_diffs = sorted(day_diffs)
    median_diff = sorted_diffs[len(sorted_diffs) // 2]
    return median_diff <= 10


def _set_frequency_fields(item: Dict[str, Any], history: List[Dict[str, Any]]) -> None:
    """Set unified frequency fields for UI consumers."""
    is_daily = _infer_is_daily(item, history)
    item['is_daily'] = is_daily
    item['frequency_badge'] = 'D' if is_daily else 'M'
    item['frequency_label'] = 'Daily data' if is_daily else 'Monthly data'


def _finite_float(value: Any) -> Optional[float]:
    """Convert numeric-ish values to finite floats."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _first_finite_value(item: Dict[str, Any], keys: List[str]) -> float:
    """Read the first finite numeric field from *item*."""
    for key in keys:
        parsed = _finite_float(item.get(key))
        if parsed is not None:
            return parsed
    return 0.0


def _parse_date(date_value: Any) -> Optional[datetime]:
    """Parse the project date format safely."""
    if not date_value:
        return None
    try:
        return datetime.strptime(str(date_value), '%Y-%m-%d')
    except ValueError:
        return None


def _movement_payload(item: Dict[str, Any], pct_change: float, abs_change: float) -> Dict[str, Any]:
    """Build the compact mover object used by API meta and dashboard UI."""
    return {
        'id': item.get('id', ''),
        'name': item.get('name', 'Unknown benchmark'),
        'category': item.get('category', 'uncategorized'),
        'change_percent': pct_change,
        'change': abs_change,
        'currency': item.get('currency', ''),
    }


def _category_display_name(category_slug: str) -> str:
    """Return compact labels for category summary UI."""
    labels = {
        'agricultural': 'Agriculture',
        'metal': 'Metals',
        'index': 'Indices',
        'precious': 'Precious',
        'energy': 'Energy',
    }
    return labels.get(category_slug, category_slug.replace('_', ' ').title())


def build_market_summary(commodities: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build dashboard-level summary stats from already-loaded commodities.

    The summary is descriptive only: it counts current display-window changes
    and highlights the largest positive/negative observed moves.
    """
    summary: Dict[str, Any] = {
        'total': 0,
        'up_count': 0,
        'down_count': 0,
        'flat_count': 0,
        'daily_count': 0,
        'monthly_count': 0,
        'latest_date': None,
        'latest_count': 0,
        'breadth_percent': 0.0,
        'net_count': 0,
        'headline': 'No benchmarks loaded',
        'biggest_up': None,
        'biggest_down': None,
        'top_movers_up': [],
        'top_movers_down': [],
        'categories': [],
    }

    if not isinstance(commodities, list) or not commodities:
        return summary

    category_totals: Dict[str, Dict[str, Any]] = {}
    dated_items: List[tuple[datetime, Dict[str, Any]]] = []
    movers: List[Dict[str, Any]] = []

    for item in commodities:
        if not isinstance(item, dict):
            continue

        summary['total'] += 1
        pct_change = _first_finite_value(item, ['change_percent', 'daily_change_percent'])
        abs_change = _first_finite_value(item, ['change', 'daily_change'])

        if pct_change > 0:
            direction = 'up'
            summary['up_count'] += 1
        elif pct_change < 0:
            direction = 'down'
            summary['down_count'] += 1
        else:
            direction = 'flat'
            summary['flat_count'] += 1

        if item.get('is_daily') is True:
            summary['daily_count'] += 1
        else:
            summary['monthly_count'] += 1

        category = str(item.get('category') or 'uncategorized').strip().lower()
        category_bucket = category_totals.setdefault(
            category,
            {
                'slug': category,
                'name': _category_display_name(category),
                'total': 0,
                'up_count': 0,
                'down_count': 0,
                'flat_count': 0,
                'breadth_percent': 0.0,
                'flat_percent': 0.0,
                'down_percent': 0.0,
            }
        )
        category_bucket['total'] += 1
        category_bucket[f'{direction}_count'] += 1

        parsed_date = _parse_date(item.get('date'))
        if parsed_date:
            dated_items.append((parsed_date, item))

        if pct_change != 0:
            movers.append(_movement_payload(item, pct_change, abs_change))

    if summary['total'] == 0:
        return summary

    active_count = summary['up_count'] + summary['down_count']
    summary['breadth_percent'] = round((summary['up_count'] / summary['total']) * 100, 1)
    summary['net_count'] = summary['up_count'] - summary['down_count']

    if summary['up_count'] > summary['down_count']:
        summary['headline'] = 'More benchmarks rose than fell'
    elif summary['down_count'] > summary['up_count']:
        summary['headline'] = 'More benchmarks fell than rose'
    elif active_count == 0:
        summary['headline'] = 'Benchmarks were unchanged'
    else:
        summary['headline'] = 'Benchmarks were evenly split'

    if dated_items:
        latest_date = max(date for date, _item in dated_items)
        latest_date_str = latest_date.strftime('%Y-%m-%d')
        summary['latest_date'] = latest_date_str
        summary['latest_count'] = sum(1 for date, _item in dated_items if date == latest_date)

    risers = sorted(
        (m for m in movers if m['change_percent'] > 0),
        key=lambda m: m['change_percent'],
        reverse=True,
    )
    fallers = sorted(
        (m for m in movers if m['change_percent'] < 0),
        key=lambda m: m['change_percent'],
    )
    summary['top_movers_up'] = risers[:5]
    summary['top_movers_down'] = fallers[:5]
    summary['biggest_up'] = risers[0] if risers else None
    summary['biggest_down'] = fallers[0] if fallers else None

    for category in category_totals.values():
        category['breadth_percent'] = round((category['up_count'] / category['total']) * 100, 1)
        category['flat_percent'] = round((category['flat_count'] / category['total']) * 100, 1)
        category['down_percent'] = round((category['down_count'] / category['total']) * 100, 1)

    summary['categories'] = sorted(
        category_totals.values(),
        key=lambda category: (-category['total'], category['name'])
    )
    return summary


@cache.memoize(timeout=600)
def get_all_commodities(date_range: str = 'ALL', include_history: bool = True) -> List[Dict[str, Any]]:
    """Load all commodities with display-filtered history.
    
    Uses pre-computed metrics from derived.descriptive_stats.
    Does NOT recompute financial calculations in the UI layer.
    """
    data_dir = current_app.config['JSON_DATA_DIR']
    commodities = []
    
    if not os.path.exists(data_dir):
        return commodities

    for filename in os.listdir(data_dir):
        if filename.endswith('.json') and filename != 'schema.json':
            # Only load files whose id passes the same validation as get_commodity,
            # so a stray/unsafe-named *.json can't enter the public list.
            cid = filename[:-5]
            if not _is_safe_commodity_id(cid):
                logger.warning("Skipping file with unsafe id: %s", filename)
                continue
            try:
                with open(os.path.join(data_dir, filename), 'r') as f:
                    item = json.load(f)

                    # Filter history for display only
                    full_history = item.get('history', [])
                    filtered_history = filter_history_by_range(full_history, date_range)
                    if include_history:
                        item['history'] = filtered_history
                    else:
                        item.pop('history', None)
                    
                    _apply_latest_display_point(item, filtered_history)
                    # _set_display_change_fields_from_history overwrites the same change/change_percent
                    # fields that _hydrate_change_fields would set, so skip the latter here.
                    # _hydrate_change_fields is still used by get_commodity (no history recalculation).
                    _set_display_change_fields_from_history(item, filtered_history)
                    # Expose derived stats for list views (grid tooltips, compact table)
                    item['derived_stats'] = item.get('derived', {}).get('descriptive_stats', {})
                    _set_frequency_fields(item, full_history)
                        
                    commodities.append(item)
            except (json.JSONDecodeError, IOError) as e:
                logger.warning("Skipping %s: %s", filename, e)
                continue
    
    # Sort for stable UI display
    commodities.sort(key=lambda x: x.get('name', ''))
    return commodities


def _is_safe_commodity_id(commodity_id: str) -> bool:
    """Validate commodity ID to prevent path traversal attacks."""
    if not commodity_id or not isinstance(commodity_id, str):
        return False
    # Only allow alphanumeric, underscore, and hyphen
    return all(c.isalnum() or c in ('_', '-') for c in commodity_id)


def _is_path_within_directory(filepath: str, directory: str) -> bool:
    """Check if filepath is safely within the given directory."""
    try:
        real_filepath = os.path.realpath(filepath)
        real_directory = os.path.realpath(directory)
        return real_filepath.startswith(real_directory + os.sep)
    except (OSError, ValueError):
        return False


@cache.memoize(timeout=600)
def get_commodity(commodity_id: str) -> Optional[Dict[str, Any]]:
    """Load single commodity with all data.

    Uses pre-computed metrics from derived.descriptive_stats.
    Does NOT recompute financial calculations in the UI layer.
    """
    # Validate commodity_id to prevent path traversal
    if not _is_safe_commodity_id(commodity_id):
        logger.warning("Invalid commodity_id rejected: %s", commodity_id)
        return None

    data_dir = current_app.config['JSON_DATA_DIR']
    filepath = os.path.join(data_dir, f"{commodity_id}.json")

    # Additional path safety check
    if not _is_path_within_directory(filepath, data_dir):
        logger.warning("Path traversal attempt blocked: %s", commodity_id)
        return None

    if os.path.exists(filepath):
        try:
            with open(filepath, 'r') as f:
                item = json.load(f)
                history = item.get('history', [])

                _hydrate_change_fields(item)
                _set_previous_observation_fields(item, history)
                _set_frequency_fields(item, history)
                
                return item
        except (json.JSONDecodeError, IOError) as e:
            logger.warning("Failed to load commodity %s: %s", commodity_id, e)
            return None
    return None
