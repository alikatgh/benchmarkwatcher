import json
import os
from datetime import datetime, timedelta
from flask import current_app

def get_date_range_days(date_range):
    """Convert date range code to number of days"""
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
    """Filter history to only include data points within the specified range"""
    days = get_date_range_days(date_range)
    if days is None or not history:
        return history
    
    cutoff_date = datetime.now() - timedelta(days=days)
    filtered = []
    for entry in history:
        try:
            entry_date = datetime.strptime(entry['date'], '%Y-%m-%d')
            if entry_date >= cutoff_date:
                filtered.append(entry)
        except (ValueError, KeyError):
            continue
    
    return filtered if filtered else history[-1:]  # Return at least the latest entry

def get_all_commodities(date_range='ALL'):
    data_dir = os.path.join(current_app.root_path, '..', 'data')
    commodities = []
    
    # Placeholder for loading data from JSON files
    if not os.path.exists(data_dir):
        return commodities

    for filename in os.listdir(data_dir):
        if filename.endswith('.json') and filename != 'schema.json':
            try:
                with open(os.path.join(data_dir, filename), 'r') as f:
                    item = json.load(f)
                    
                    # Filter history based on date range
                    full_history = item.get('history', [])
                    filtered_history = filter_history_by_range(full_history, date_range)
                    item['history'] = filtered_history
                    
                    # Calculate daily change based on filtered history
                    if len(filtered_history) >= 2:
                        latest_price = filtered_history[-1]['price']
                        first_price = filtered_history[0]['price']
                        # Calculate change from first to last in range
                        item['change'] = round(latest_price - filtered_history[-2]['price'], 2)
                        item['change_percent'] = round((item['change'] / filtered_history[-2]['price']) * 100, 2)
                        # Also calculate period change (from start of range)
                        item['period_change'] = round(latest_price - first_price, 2)
                        item['period_change_percent'] = round((item['period_change'] / first_price) * 100, 2) if first_price else 0
                    else:
                        item['change'] = 0.0
                        item['change_percent'] = 0.0
                        item['period_change'] = 0.0
                        item['period_change_percent'] = 0.0
                        
                    commodities.append(item)
            except (json.JSONDecodeError, IOError):
                continue
    
    # Sort for stable UI display
    commodities.sort(key=lambda x: x.get('name', ''))
    return commodities

def get_commodity(commodity_id):
    data_dir = os.path.join(current_app.root_path, '..', 'data')
    filepath = os.path.join(data_dir, f"{commodity_id}.json")
    
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r') as f:
                item = json.load(f)
                history = item.get('history', [])
                if len(history) >= 2:
                    latest_price = history[-1]['price']
                    prev_price = history[-2]['price']
                    item['change'] = round(latest_price - prev_price, 2)
                    item['change_percent'] = round((item['change'] / prev_price) * 100, 2)
                else:
                    item['change'] = 0.0
                    item['change_percent'] = 0.0
                return item
        except (json.JSONDecodeError, IOError):
            return None
    return None
