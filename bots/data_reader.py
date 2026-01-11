"""
BenchmarkWatcher Data Reader
Shared data access layer for bots - reads from ../data/*.json
"""
import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from config import DATA_DIR, CATEGORIES, ALIASES


def get_commodity_data(commodity_id: str) -> Optional[Dict]:
    """Load a single commodity's data from JSON file."""
    # Resolve aliases
    commodity_id = ALIASES.get(commodity_id.lower(), commodity_id.lower())
    
    filepath = os.path.join(DATA_DIR, f"{commodity_id}.json")
    
    if not os.path.exists(filepath):
        return None
    
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def get_all_commodities() -> List[Dict]:
    """Load all commodities."""
    commodities = []
    
    if not os.path.exists(DATA_DIR):
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
    price = data.get('price', 0)
    unit = data.get('unit', 'USD')
    
    # Get change from derived stats
    derived = data.get('derived', {}).get('descriptive_stats', {})
    metrics = data.get('metrics', {})
    
    change = derived.get('abs_change_1_obs', metrics.get('change_1d', 0))
    change_pct = derived.get('pct_change_1_obs', metrics.get('pct_1d', 0))
    
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
    price = data.get('price', 0)
    
    derived = data.get('derived', {}).get('descriptive_stats', {})
    metrics = data.get('metrics', {})
    change_pct = derived.get('pct_change_1_obs', metrics.get('pct_1d', 0))
    
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


def get_top_movers(limit: int = 5) -> Tuple[List[Dict], List[Dict]]:
    """Get top gainers and losers."""
    commodities = get_all_commodities()
    
    # Calculate percentage change for each
    for c in commodities:
        derived = c.get('derived', {}).get('descriptive_stats', {})
        metrics = c.get('metrics', {})
        c['_change_pct'] = derived.get('pct_change_1_obs', metrics.get('pct_1d', 0))
    
    # Sort by change
    sorted_commodities = sorted(commodities, key=lambda x: x['_change_pct'], reverse=True)
    
    gainers = [c for c in sorted_commodities if c['_change_pct'] > 0][:limit]
    losers = [c for c in sorted_commodities if c['_change_pct'] < 0][-limit:][::-1]
    
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
