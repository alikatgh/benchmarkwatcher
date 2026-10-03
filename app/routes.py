from flask import Blueprint, render_template, request, jsonify, abort, send_from_directory, current_app, Response, url_for
from app.data_handler import build_market_summary, get_all_commodities, get_commodity
from app.extensions import limiter, cache
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


@bp.route('/health')
@limiter.exempt
def health():
    """Liveness probe. A 200 here means create_app() succeeded and Flask is
    serving, so a monitor (or a quick curl) can tell an *app* failure apart from
    the host's generic 500 page. Does no data
    loading and is exempt from rate limiting so it can be polled freely."""
    return jsonify(status='ok'), 200


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
    """Validate the since date parameter. Returns None if invalid.

    Rejects future dates and dates before 2000-01-01.
    """
    if not since_str:
        return None
    try:
        parsed_date = datetime.strptime(since_str, '%Y-%m-%d')
        # Reject future dates
        if parsed_date > datetime.now():
            return None
        # Reject unreasonably old dates
        if parsed_date.year < 2000:
            return None
        return since_str
    except ValueError:
        return None


def is_valid_internal_key(provided_key: str, expected_key: str) -> bool:
    """Strict check: expected key must exist and provided key must match.

    ``secrets.compare_digest`` raises ``TypeError`` on non-ASCII ``str`` inputs,
    which would surface as a 500 instead of a 403. A non-ASCII provided key can
    never match an ASCII expected key, so reject it up front.
    """
    if not expected_key or not provided_key:
        return False
    if not provided_key.isascii():
        return False
    return secrets.compare_digest(provided_key, expected_key)


def build_commodities_response(
    commodities: Any,
    date_range: str,
    category: Optional[str],
    *,
    since: Optional[str] = None,
    include_history: Optional[bool] = None,
    summary: Optional[Dict[str, Any]] = None,
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
    if summary is not None:
        meta['summary'] = summary
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
@cache.cached(timeout=600, query_string=True)
def api_commodities():
    """Public API endpoint for browser AJAX and mobile app.

    Supports optional `since` parameter for incremental fetching:
    - If provided, only commodities with date > since are returned.
    - Mobile clients use this to avoid re-downloading unchanged data.
    """
    date_range = validate_range(request.args.get('range', '1Y'))
    category = request.args.get('category', None)
    raw_since = request.args.get('since', None)
    since = validate_since(raw_since)
    include_history = parse_bool_flag(
        request.args.get('include_history'),
        default=False
    )
    if raw_since and since is None:
        payload = build_commodities_response(
            [],
            date_range,
            category,
            since=raw_since,
            include_history=include_history,
        )
        payload['error'] = (
            'Invalid since parameter. Use YYYY-MM-DD between 2000-01-01 and today.'
        )
        return jsonify(payload), 400

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
            summary=None if since else build_market_summary(commodities),
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
        return jsonify({'data': None, 'error': 'Forbidden: valid API key required'}), 403

    date_range = validate_range(request.args.get('range', '1Y'))
    category = request.args.get('category', None)

    commodities = filter_commodities(date_range, category)

    return jsonify(
        build_commodities_response(
            commodities,
            date_range,
            category,
            summary=build_market_summary(commodities),
        )
    )


@bp.route('/')
@cache.cached(timeout=600, query_string=True)
def index():
    """Browse commodity observations or saved country histories at home."""
    from app.global_reference import country_summary, listing_context
    from werkzeug.exceptions import HTTPException

    if request.args.get('dataset') == 'countries':
        context = listing_context(endpoint='main.index', countries_only=True)
        return render_template('global_reference/home.html', **context,
                               country_summary={'histories': context['available'], 'economies': context['country_count']},
                               commodity_count=len(get_all_commodities(include_history=False)),
                               active_dataset='countries', active_view='compact', date_range='1Y')

    try:
        countries = country_summary()
    except HTTPException:
        # A damaged reference index must not block the independent commodity view.
        countries = None
    date_range = validate_range(request.args.get('range', '1Y'))
    category = request.args.get('category', None)
    active_view = (
        validate_view(request.args.get('view'))
        or 'compact'
    )

    commodities = filter_commodities(
        date_range=date_range,
        category=category,
        include_history=False
    )

    return render_template(
        'index.html',
        commodities=commodities,
        market_summary=build_market_summary(commodities),
        date_range=date_range,
        selected_category=category,
        active_view=active_view,
        active_dataset='commodities', country_summary=countries,
        commodity_count=len(get_all_commodities(include_history=False))
    )


@bp.route('/commodity/<string:commodity_id>')
@cache.cached(timeout=600)
def commodity_detail(commodity_id):
    """Commodity detail page."""
    commodity = get_commodity(commodity_id)
    if not commodity:
        abort(404, description="Commodity not found")
    return render_template('commodity.html', commodity=commodity)

@bp.route('/api/commodity/<string:commodity_id>')
@limiter.limit(_public_detail_rate_limit)
@cache.cached(timeout=600)
def api_commodity_detail(commodity_id):
    """API Commodity detail endpoint."""
    commodity = get_commodity(commodity_id)
    if not commodity:
        return jsonify({'data': None, 'error': 'Commodity not found'}), 404
    return jsonify({'data': commodity})


@bp.route('/changelog')
def changelog():
    """Changelog page with updates and new features."""
    return render_template('changelog.html',
                           meta_description='BenchmarkWatcher release notes: SEC company research, D3 visualizations, source-linked financial tables and conversations beside your report.')


@bp.route('/blog')
def blog():
    """Product stories and practical guides to the public reference workspace."""
    return render_template(
        'blog/index.html',
        meta_title='Blog | BenchmarkWatcher',
        meta_description='Practical guides to SEC company research, D3 charts and historical commodity benchmarks in BenchmarkWatcher.',
    )


@bp.route('/blog/a-workspace-for-benchmark-research')
def research_workspace_story():
    """The launch story for customizable tables and browser-local Research."""
    return render_template(
        'blog/research_workspace.html',
        meta_title='A workspace for benchmark research | BenchmarkWatcher',
        meta_description='Explore the redesigned BenchmarkWatcher: customizable tables, saved views, historical comparisons and a personal Research workspace with portable backups.',
    )


@bp.route('/help')
def help_page():
    """Public instructions for workbook questions and personal AI connections."""
    return render_template('help.html', meta_title='Help | BenchmarkWatcher',
                           meta_description='Learn what Jev does in BenchmarkWatcher, connect your own provider, and ask workbook questions with clear examples.')


@bp.route('/support')
def support_page():
    """Public contact and troubleshooting entry point."""
    return render_template('support.html', meta_title='Support | BenchmarkWatcher',
                           meta_description='Get help with BenchmarkWatcher data, account access and privacy requests.')


@bp.route('/privacy')
def privacy_page():
    """Public description of site data handling."""
    return render_template('privacy.html', meta_title='Privacy | BenchmarkWatcher',
                           meta_description='How BenchmarkWatcher handles browser preferences, account data, saved research and optional AI requests.')


@bp.route('/blog/using-jev-for-workbook-analysis')
def jev_workbook_story():
    """Explain Jev's role and the supported workbook question workflow."""
    return render_template('blog/jev_workbooks.html',
                           meta_title='Using Jev for workbook analysis | BenchmarkWatcher',
                           meta_description='Start with an Operating Income example, understand why BenchmarkWatcher uses Jev, and follow workbook calculations back to their source cells.')


@bp.route('/blog/company-research-from-sec-filings')
def company_research_story():
    """A practical guide to reports built from public company filings."""
    return render_template('blog/company_research.html',
                           meta_title='From a ticker to the filing behind a number | BenchmarkWatcher',
                           meta_description='Search a company, explore annual, quarterly and trailing-year financials, inspect filing sources and ask questions beside your report.')


@bp.route('/blog/d3-charts-and-visual-explorer')
def d3_visuals_story():
    """Explain the chart migration and how to choose an observation view."""
    return render_template('blog/d3_visuals.html',
                           meta_title='More ways to read the same observations with D3 | BenchmarkWatcher',
                           meta_description='Explore D3 histories, distributions, monthly heatmaps and coverage views, with exact values, publication gaps and source dates kept visible.')


@bp.route('/blog/a-new-mark-for-benchmarkwatcher')
def new_icon_story():
    """Explain the shared brand symbol and its use across icon sizes."""
    return render_template('blog/new-icon.html',
                           meta_title='A new mark for BenchmarkWatcher | BenchmarkWatcher',
                           meta_description='Meet the new BenchmarkWatcher icon: a reference stem and three observation points, fitted for the website, browser tab and mobile app.')


@bp.route('/blog/public-data-around-the-world')
def global_sources_story():
    return render_template('blog/global_sources.html',
                           meta_title='Public data around the world | BenchmarkWatcher',
                           meta_description='Explore official international reference series and a searchable public-source catalog, with units, periods and access conditions kept visible.')


@bp.route('/blog/research-on-each-device')
def native_research_story():
    return render_template('blog/native_research.html',
                           meta_title='Research that fits each device | BenchmarkWatcher',
                           meta_description='A development update on the Swift Mac and iPhone apps and Kotlin Android app: historical filings, offline research and source-linked notes.')


@bp.route('/blog/benchmarks-on-a-small-screen')
def mobile_workspace_story():
    return render_template('blog/mobile_workspace.html',
                           meta_title='Benchmarks on a small screen | BenchmarkWatcher',
                           meta_description='Search and filter historical benchmarks on a phone, with compact controls, readable observations and focused detail views.')


@bp.route('/favicon.ico')
def favicon():
    """Serve the dedicated multi-size brand favicon."""
    return send_from_directory(
        os.path.join(bp.root_path, 'static', 'images'),
        'favicon.ico',
        mimetype='image/x-icon'
    )


@bp.route('/robots.txt')
def robots():
    return Response('User-agent: *\nAllow: /\nDisallow: /internal/\nDisallow: /api/\nSitemap: https://benchmarkwatcher.online/sitemap.xml\n', mimetype='text/plain')


@bp.route('/sitemap.xml')
@cache.cached(timeout=600)
def sitemap():
    """Canonical, publicly rendered pages only; no parameter permutations."""
    from xml.etree.ElementTree import Element, SubElement, tostring
    root = Element('urlset', xmlns='http://www.sitemaps.org/schemas/sitemap/0.9')
    paths = ['/', '/changelog', url_for('main.blog'), url_for('main.research_workspace_story'),
             url_for('main.help_page'), url_for('main.support_page'), url_for('main.privacy_page'),
             url_for('main.jev_workbook_story'),
             url_for('main.company_research_story'), url_for('main.d3_visuals_story'),
             url_for('main.new_icon_story'), url_for('main.global_sources_story'),
             url_for('main.native_research_story'), url_for('main.mobile_workspace_story'), url_for('global_reference.index'),
             url_for('global_reference.sources')]
    paths.extend(url_for('main.commodity_detail', commodity_id=item['id'])
                 for item in get_all_commodities(include_history=False))
    for path in sorted(set(paths)):
        SubElement(SubElement(root, 'url'), 'loc').text = 'https://benchmarkwatcher.online' + path
    return Response(tostring(root, encoding='utf-8', xml_declaration=True), mimetype='application/xml')
