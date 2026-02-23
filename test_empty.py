import os
from flask import Flask
from app.data_handler import get_all_commodities

app = Flask(__name__)
app.config['JSON_DATA_DIR'] = os.path.join(os.path.dirname(__file__), 'data')

with app.app_context():
    comms = get_all_commodities('1W')
    print("1W length:", len(comms))
    comms_all = get_all_commodities('ALL')
    print("ALL length:", len(comms_all))
