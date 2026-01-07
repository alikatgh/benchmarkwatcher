from flask import Blueprint, render_template, request
from app.data_handler import get_all_commodities

bp = Blueprint('main', __name__)

@bp.route('/')
def index():
    date_range = request.args.get('range', 'ALL')
    commodities = get_all_commodities(date_range=date_range)
    return render_template('index.html', commodities=commodities, date_range=date_range)

@bp.route('/commodity/<string:commodity_id>')
def commodity_detail(commodity_id):
    from app.data_handler import get_commodity
    commodity = get_commodity(commodity_id)
    if not commodity:
        return "Commodity not found", 404
    return render_template('commodity.html', commodity=commodity)
