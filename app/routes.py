from flask import Blueprint, render_template, request, jsonify, abort
from app.data_handler import get_all_commodities, get_commodity
import os
import warnings
from datetime import datetime

bp = Blueprint('main', __name__)

# Valid parameter values
VALID_RANGES = {'ALL', '1W', '1M', '3M', '6M', '1Y'}

# Internal API key for bot authentication (optional but recommended)
INTERNAL_API_KEY = os.getenv('INTERNAL_API_KEY', '')
if not INTERNAL_API_KEY:
    warnings.warn(
        "INTERNAL_API_KEY is not set. The /internal/api/commodities endpoint will "
        "always return 403, making it inaccessible to bots.",
        stacklevel=1
    )


def validate_range(date_range):
    """Validate and sanitize the date range parameter."""
    return date_range if date_range in VALID_RANGES else 'ALL'


def validate_since(since_str):
    """Validate the since date parameter. Returns None if invalid."""
    if not since_str:
        return None
    try:
        datetime.strptime(since_str, '%Y-%m-%d')
        return since_str
    except ValueError:
        return None


def filter_commodities(date_range, category, since=None):
    """Fetch and filter commodities by date range, category, and optionally a since date."""
    commodities = get_all_commodities(date_range=date_range)
    if category:
        commodities = [
            c for c in commodities
            if c.get('category', '').lower() == category.lower()
        ]
    if since:
        # Incremental fetch: only return commodities with new data since the given date
        commodities = [c for c in commodities if c.get('date', '') > since]
    return commodities


@bp.route('/api/commodities')
def api_commodities():
    """Public API endpoint for browser AJAX and mobile app.

    Supports optional `since` parameter for incremental fetching:
    - If provided, only commodities with date > since are returned.
    - Mobile clients use this to avoid re-downloading unchanged data.
    """
    date_range = validate_range(request.args.get('range', 'ALL'))
    category = request.args.get('category', None)
    since = validate_since(request.args.get('since', None))

    commodities = filter_commodities(date_range, category, since=since)

    return jsonify({
        'data': commodities,
        'meta': {
            'count': len(commodities),
            'range': date_range,
            'category': category,
            'since': since,
            'partial': since is not None,
        }
    })


@bp.route('/internal/api/commodities')
def internal_api_commodities():
    """Internal API endpoint for bots.

    STRICT: Requires valid X-Internal-Key header.
    Used by Telegram/Discord bots deployed externally.
    """
    provided_key = request.headers.get('X-Internal-Key', '')

    # Strict check: key must be set AND match
    if not INTERNAL_API_KEY or provided_key != INTERNAL_API_KEY:
        return jsonify({'error': 'Forbidden: valid API key required'}), 403

    date_range = validate_range(request.args.get('range', 'ALL'))
    category = request.args.get('category', None)

    commodities = filter_commodities(date_range, category)

    return jsonify({
        'data': commodities,
        'meta': {
            'count': len(commodities),
            'range': date_range,
            'category': category
        }
    })


@bp.route('/')
def index():
    """Main index page with commodity grid."""
    date_range = validate_range(request.args.get('range', 'ALL'))
    category = request.args.get('category', None)

    commodities = filter_commodities(date_range, category)

    return render_template(
        'index.html',
        commodities=commodities,
        date_range=date_range,
        selected_category=category
    )


@bp.route('/commodity/<string:commodity_id>')
def commodity_detail(commodity_id):
    """Commodity detail page."""
    commodity = get_commodity(commodity_id)
    if not commodity:
        abort(404, description="Commodity not found")
    return render_template('commodity.html', commodity=commodity)

@bp.route('/api/commodity/<string:commodity_id>')
def api_commodity_detail(commodity_id):
    """API Commodity detail endpoint."""
    commodity = get_commodity(commodity_id)
    if not commodity:
        return jsonify({'error': 'Commodity not found'}), 404
    return jsonify({'data': commodity})


@bp.route('/changelog')
def changelog():
    """Changelog page with updates and new features."""
    return render_template('changelog.html')
