import json
import os
import logging
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
        item['price'] = latest['price']
        item['date'] = latest['date']


def _set_previous_observation_fields(item: Dict[str, Any], history: List[Dict[str, Any]]) -> None:
    """Set previous observation fields for tooltip display."""
    if len(history) >= 2:
        previous = history[-2]
        item['prev_price'] = previous['price']
        item['prev_date'] = previous['date']
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


@cache.memoize(timeout=600)
def get_commodity(commodity_id: str) -> Optional[Dict[str, Any]]:
    """Load single commodity with all data.

    Uses pre-computed metrics from derived.descriptive_stats.
    Does NOT recompute financial calculations in the UI layer.
    """
    data_dir = current_app.config['JSON_DATA_DIR']
    filepath = os.path.join(data_dir, f"{commodity_id}.json")
    
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
