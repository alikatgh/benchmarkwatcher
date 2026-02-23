import os
import secrets

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
    JSON_DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
