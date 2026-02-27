from flask import Blueprint, render_template, request, jsonify, abort
from app.data_handler import get_all_commodities, get_commodity
from app.extensions import cache
import os
import secrets
import warnings
from datetime import datetime

bp = Blueprint('main', __name__)

# Valid parameter values
VALID_RANGES = {'ALL', '1W', '1M', '3M', '6M', '1Y'}
VALID_VIEWS = {'grid', 'compact'}

# Internal API key for bot authentication (optional but recommended)
def get_internal_api_key():
    """Read INTERNAL_API_KEY at runtime."""
    return os.getenv('INTERNAL_API_KEY', '')


if not get_internal_api_key():
    warnings.warn(
        "INTERNAL_API_KEY is not set. The /internal/api/commodities endpoint will "
        "always return 403, making it inaccessible to bots.",
        stacklevel=1
    )


def _positive_int_from_env(name, default):
    """Read positive integer environment values with safe fallback."""
    value = os.getenv(name)
    if value is None or value == '':
        return default
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except ValueError:
        return default


INTERNAL_API_RATE_LIMIT_WINDOW_SECONDS = 60
INTERNAL_API_RATE_LIMIT_PER_WINDOW = _positive_int_from_env(
    'INTERNAL_API_RATE_LIMIT_PER_MINUTE', 120
)


def get_client_identifier():
    """Best-effort client identity for simple per-client rate limiting."""
    forwarded_for = request.headers.get('X-Forwarded-For', '')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip() or 'unknown'
    return request.remote_addr or 'unknown'


def is_internal_rate_limited():
    """Rate limit internal endpoint by client identity in a short window."""
    client_id = get_client_identifier()
    key = f'internal-api-rate:{client_id}'
    current = cache.get(key)

    if current is None:
        cache.set(key, 1, timeout=INTERNAL_API_RATE_LIMIT_WINDOW_SECONDS)
        return False

    current_count = int(current) + 1
    cache.set(key, current_count, timeout=INTERNAL_API_RATE_LIMIT_WINDOW_SECONDS)
    return current_count > INTERNAL_API_RATE_LIMIT_PER_WINDOW


def validate_range(date_range):
    """Validate and sanitize the date range parameter."""
    return date_range if date_range in VALID_RANGES else 'ALL'


def validate_view(view_mode):
    """Validate and sanitize the view mode parameter."""
    return view_mode if view_mode in VALID_VIEWS else None


def parse_bool_flag(value, default=False):
    """Parse permissive boolean query values."""
    if value is None:
        return default
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def validate_since(since_str):
    """Validate the since date parameter. Returns None if invalid."""
    if not since_str:
        return None
    try:
        datetime.strptime(since_str, '%Y-%m-%d')
        return since_str
    except ValueError:
        return None


def filter_commodities(date_range, category, since=None, include_history=True):
    """Fetch and filter commodities by range/category and optionally by since date."""
    commodities = get_all_commodities(
        date_range=date_range,
        include_history=include_history
    )
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
    include_history = parse_bool_flag(
        request.args.get('include_history'),
        default=False
    )

    commodities = filter_commodities(
        date_range,
        category,
        since=since,
        include_history=include_history
    )

    return jsonify({
        'data': commodities,
        'meta': {
            'count': len(commodities),
            'range': date_range,
            'category': category,
            'since': since,
            'partial': since is not None,
            'include_history': include_history,
        }
    })


@bp.route('/internal/api/commodities')
def internal_api_commodities():
    """Internal API endpoint for bots.

    STRICT: Requires valid X-Internal-Key header.
    Used by Telegram/Discord bots deployed externally.
    """
    if is_internal_rate_limited():
        return jsonify({'error': 'Too many requests'}), 429

    internal_api_key = get_internal_api_key()
    provided_key = request.headers.get('X-Internal-Key', '')

    # Strict check: key must be set AND match
    if (
        not internal_api_key
        or not provided_key
        or not secrets.compare_digest(provided_key, internal_api_key)
    ):
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
    active_view = (
        validate_view(request.args.get('view'))
        or 'grid'
    )

    commodities = filter_commodities(
        date_range=date_range,
        category=category,
        include_history=False
    )

    return render_template(
        'index.html',
        commodities=commodities,
        date_range=date_range,
        selected_category=category,
        active_view=active_view
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
