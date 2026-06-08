import os
import secrets

_BASE_DIR = os.path.abspath(os.path.dirname(__file__))


def _code_version():
    """Short token identifying the deployed code so the on-disk response cache
    auto-invalidates on DEPLOY without being cleared on every restart (which would
    re-trigger the cold-cache 503 stampede). `.git/index` mtime changes on a
    `git pull`/checkout but not on a plain `touch tmp/restart.txt`."""
    try:
        return str(int(os.path.getmtime(os.path.join(_BASE_DIR, '.git', 'index'))))
    except Exception:
        return 'base'


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or secrets.token_hex(32)

    # Use abspath to correctly resolve relative to config.py even in WSGI/Passenger where CWD may differ
    BASE_DIR = _BASE_DIR
    JSON_DATA_DIR = os.path.join(_BASE_DIR, 'data')

    # Cache Configuration — FileSystemCache (shared across ALL Passenger workers AND
    # persistent across restarts), NOT SimpleCache (per-process, wiped on every restart).
    # SimpleCache meant each `touch tmp/restart.txt` left every worker with a COLD cache,
    # so the next wave of requests all recomputed the 71-file data load at once — a
    # thundering herd that exhausted the small LSAPI worker pool and returned 503. A
    # shared on-disk cache computes once; every worker (and every restart) reads it back.
    # The dir is stamped with the code version so a DEPLOY serves fresh renders (a stale
    # pre-deploy page could otherwise load now-blocked assets), while a plain restart
    # reuses the warm cache.
    CACHE_TYPE = os.environ.get('CACHE_TYPE', 'FileSystemCache')
    CACHE_DIR = os.environ.get('CACHE_DIR') or os.path.join(_BASE_DIR, 'tmp', 'flask_cache', _code_version())
    CACHE_DEFAULT_TIMEOUT = 600  # 10 minutes
    CACHE_THRESHOLD = 1000  # max cached entries before pruning (~150 in practice)

    RATELIMIT_HEADERS_ENABLED = True
    RATELIMIT_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI', 'memory://')
    PUBLIC_API_LIST_RATE_LIMIT = os.environ.get('PUBLIC_API_LIST_RATE_LIMIT', '60 per minute')
    PUBLIC_API_DETAIL_RATE_LIMIT = os.environ.get('PUBLIC_API_DETAIL_RATE_LIMIT', '120 per minute')
    INTERNAL_API_RATE_LIMIT = os.environ.get('INTERNAL_API_RATE_LIMIT', '30 per minute')
