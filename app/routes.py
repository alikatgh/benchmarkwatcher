from flask import Blueprint, render_template, request, jsonify, abort, send_from_directory, current_app
from app.data_handler import get_all_commodities, get_commodity
from app.extensions import limiter
import os
import secrets
import warnings
from datetime import datetime
from typing import Any, Dict, Optional

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


def _public_list_rate_limit() -> str:
    return current_app.config.get('PUBLIC_API_LIST_RATE_LIMIT', '60 per minute')


def _public_detail_rate_limit() -> str:
    return current_app.config.get('PUBLIC_API_DETAIL_RATE_LIMIT', '120 per minute')


def _internal_rate_limit() -> str:
    return current_app.config.get('INTERNAL_API_RATE_LIMIT', '30 per minute')


def validate_range(date_range: str) -> str:
    """Validate and sanitize the date range parameter."""
    return date_range if date_range in VALID_RANGES else 'ALL'


def validate_view(view_mode: Optional[str]) -> Optional[str]:
    """Validate and sanitize the view mode parameter."""
    return view_mode if view_mode in VALID_VIEWS else None


def parse_bool_flag(value: Optional[str], default: bool = False) -> bool:
    """Parse permissive boolean query values."""
    if value is None:
        return default
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def validate_since(since_str: Optional[str]) -> Optional[str]:
    """Validate the since date parameter. Returns None if invalid."""
    if not since_str:
        return None
    try:
        datetime.strptime(since_str, '%Y-%m-%d')
        return since_str
    except ValueError:
        return None


def is_valid_internal_key(provided_key: str, expected_key: str) -> bool:
    """Strict check: expected key must exist and provided key must match."""
    return bool(expected_key and provided_key and secrets.compare_digest(provided_key, expected_key))


def build_commodities_response(
    commodities: Any,
    date_range: str,
    category: Optional[str],
    *,
    since: Optional[str] = None,
    include_history: Optional[bool] = None,
) -> Dict[str, Any]:
    """Build a consistent commodities API response envelope."""
    meta: Dict[str, Any] = {
        'count': len(commodities),
        'range': date_range,
        'category': category,
    }
    if since is not None:
        meta['since'] = since
        meta['partial'] = True
    elif include_history is not None:
        # Preserve public API shape in /api/commodities where since is always emitted.
        meta['since'] = None
        meta['partial'] = False
    if include_history is not None:
        meta['include_history'] = include_history
    return {'data': commodities, 'meta': meta}


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
@limiter.limit(_public_list_rate_limit)
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

    return jsonify(
        build_commodities_response(
            commodities,
            date_range,
            category,
            since=since,
            include_history=include_history,
        )
    )


@bp.route('/internal/api/commodities')
@limiter.limit(_internal_rate_limit)
def internal_api_commodities():
    """Internal API endpoint for bots.

    STRICT: Requires valid X-Internal-Key header.
    Used by Telegram/Discord bots deployed externally.
    """
    internal_api_key = get_internal_api_key()
    provided_key = request.headers.get('X-Internal-Key', '')

    if not is_valid_internal_key(provided_key, internal_api_key):
        return jsonify({'error': 'Forbidden: valid API key required'}), 403

    date_range = validate_range(request.args.get('range', 'ALL'))
    category = request.args.get('category', None)

    commodities = filter_commodities(date_range, category)

    return jsonify(build_commodities_response(commodities, date_range, category))


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
@limiter.limit(_public_detail_rate_limit)
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


@bp.route('/favicon.ico')
def favicon():
    """Serve favicon to avoid browser 404 noise in console."""
    return send_from_directory(
        os.path.join(bp.root_path, 'static', 'images'),
        'og-image.png',
        mimetype='image/png'
    )
