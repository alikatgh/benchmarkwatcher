import os
import secrets

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or secrets.token_hex(32)

    # Use abspath to correctly resolve relative to config.py even in WSGI/Passenger where CWD may differ
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))
    JSON_DATA_DIR = os.path.join(BASE_DIR, 'data')

    # Cache Configuration — FileSystemCache (shared across ALL Passenger workers AND
    # persistent across restarts), NOT SimpleCache (per-process, wiped on every restart).
    # SimpleCache meant each `touch tmp/restart.txt` left every worker with a COLD cache,
    # so the next wave of requests all recomputed the 71-file data load at once — a
    # thundering herd that exhausted the small LSAPI worker pool and returned 503. A
    # shared on-disk cache computes once; every worker (and every restart) reads it back.
    CACHE_TYPE = os.environ.get('CACHE_TYPE', 'FileSystemCache')
    CACHE_DIR = os.environ.get('CACHE_DIR', os.path.join(BASE_DIR, 'tmp', 'flask_cache'))
    CACHE_DEFAULT_TIMEOUT = 600  # 10 minutes
    CACHE_THRESHOLD = 1000  # max cached entries before pruning (~150 in practice)

    RATELIMIT_HEADERS_ENABLED = True
    RATELIMIT_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI', 'memory://')
    PUBLIC_API_LIST_RATE_LIMIT = os.environ.get('PUBLIC_API_LIST_RATE_LIMIT', '60 per minute')
    PUBLIC_API_DETAIL_RATE_LIMIT = os.environ.get('PUBLIC_API_DETAIL_RATE_LIMIT', '120 per minute')
    INTERNAL_API_RATE_LIMIT = os.environ.get('INTERNAL_API_RATE_LIMIT', '30 per minute')
