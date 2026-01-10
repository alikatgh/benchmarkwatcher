from flask import Blueprint, render_template, request, jsonify, abort
from app.data_handler import get_all_commodities, get_commodity

bp = Blueprint('main', __name__)

# Valid parameter values
VALID_RANGES = {'ALL', '1W', '1M', '3M', '6M', '1Y'}


def filter_commodities(date_range, category):
    """Fetch and filter commodities by date range and category."""
    commodities = get_all_commodities(date_range=date_range)
    if category:
        commodities = [
            c for c in commodities
            if c.get('category', '').lower() == category.lower()
        ]
    return commodities


def validate_range(date_range):
    """Validate and sanitize the date range parameter."""
    return date_range if date_range in VALID_RANGES else 'ALL'


@bp.route('/api/commodities')
def api_commodities():
    """API endpoint for fetching commodities data without page reload."""
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
