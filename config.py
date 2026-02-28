import os
import secrets

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
    
    # Cache Configuration
    CACHE_TYPE = 'SimpleCache'
    CACHE_DEFAULT_TIMEOUT = 600  # 10 minutes

    RATELIMIT_HEADERS_ENABLED = True
    RATELIMIT_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI', 'memory://')
    PUBLIC_API_LIST_RATE_LIMIT = os.environ.get('PUBLIC_API_LIST_RATE_LIMIT', '60 per minute')
    PUBLIC_API_DETAIL_RATE_LIMIT = os.environ.get('PUBLIC_API_DETAIL_RATE_LIMIT', '120 per minute')
    INTERNAL_API_RATE_LIMIT = os.environ.get('INTERNAL_API_RATE_LIMIT', '30 per minute')
    
    # Use abspath to correctly resolve relative to config.py even in WSGI/Passenger where CWD may differ
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))
    JSON_DATA_DIR = os.path.join(BASE_DIR, 'data')
