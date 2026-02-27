import json
import os
import logging
from datetime import datetime, timedelta
from flask import current_app
from app.extensions import cache

logger = logging.getLogger(__name__)

def get_date_range_days(date_range):
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

def filter_history_by_range(history, date_range):
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


@cache.memoize(timeout=600)
def get_all_commodities(date_range='ALL'):
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
                    item['history'] = filtered_history
                    
                    # Update display price/date from filtered history
                    if filtered_history:
                        item['price'] = filtered_history[-1]['price']
                        item['date'] = filtered_history[-1]['date']
                    
                    # Use pre-computed metrics from data model (single source of truth)
                    derived = item.get('derived', {}).get('descriptive_stats', {})
                    metrics = item.get('metrics', {})
                    
                    # Pass through observation-based metrics (no recomputation)
                    item['change'] = derived.get('abs_change_1_obs', metrics.get('change_1d', 0.0))
                    item['change_percent'] = derived.get('pct_change_1_obs', metrics.get('pct_1d', 0.0))
                    item['daily_change'] = item['change']  # Legacy alias
                    item['daily_change_percent'] = item['change_percent']  # Legacy alias
                    
                    # Expose derived stats for templates that want them
                    item['derived_stats'] = derived
                        
                    commodities.append(item)
            except (json.JSONDecodeError, IOError):
                continue
    
    # Sort for stable UI display
    commodities.sort(key=lambda x: x.get('name', ''))
    return commodities


def get_commodity(commodity_id):
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
                
                # Use pre-computed metrics from data model (single source of truth)
                derived = item.get('derived', {}).get('descriptive_stats', {})
                metrics = item.get('metrics', {})
                
                # Pass through observation-based metrics (no recomputation)
                item['change'] = derived.get('abs_change_1_obs', metrics.get('change_1d', 0.0))
                item['change_percent'] = derived.get('pct_change_1_obs', metrics.get('pct_1d', 0.0))
                
                # Store previous observation for tooltip display
                if len(history) >= 2:
                    item['prev_price'] = history[-2]['price']
                    item['prev_date'] = history[-2]['date']
                else:
                    item['prev_price'] = item.get('price', 0)
                    item['prev_date'] = item.get('date', '')
                
                # Expose full derived stats for templates
                item['derived_stats'] = derived
                
                return item
        except (json.JSONDecodeError, IOError):
            return None
    return None
