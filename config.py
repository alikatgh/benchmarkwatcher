import os
import secrets

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
    
    # Use abspath to correctly resolve relative to config.py even in WSGI/Passenger where CWD may differ
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))
    JSON_DATA_DIR = os.path.join(BASE_DIR, 'data')
