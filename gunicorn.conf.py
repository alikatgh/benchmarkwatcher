"""Gunicorn configuration for the hosted app.

Replaces the previous Phusion Passenger WSGI server. The entry point is
`run:app` — `run.py` calls `load_dotenv()` then `create_app()`, so the `.env`
in the WorkingDirectory is loaded exactly as it was under Passenger.

Worker model — deliberately small because the app is I/O-bound (it reads small
JSON files and serves cached renders), so threads buy more than processes.

So: 2 gthread workers × 4 threads. `preload_app` loads the app once in the
master and forks (copy-on-write) to keep memory down.

CAVEAT: Flask-Limiter uses
`memory://` storage, which is PER-PROCESS. With 2 workers, a configured
"60 per minute" limit is enforced as up to 2×60 across the pool. The on-disk
FileSystemCache (config.py) IS shared across workers, so only the rate limiter
is affected. If you ever need exact global limits, point
RATELIMIT_STORAGE_URI at a shared store.
"""

# Bind to loopback only; the reverse proxy terminates TLS.
bind = "127.0.0.1:8001"

workers = 2
worker_class = "gthread"
threads = 4

# Load the app before forking workers (shared memory via copy-on-write).
preload_app = True

# Recycle workers periodically so any slow leak can't grow unbounded — a cheap
# "always available" safety net. The jitter avoids all workers recycling at once.
max_requests = 1000
max_requests_jitter = 100

# A worker blocked longer than this is killed and replaced (the master keeps
# serving on the others). graceful_timeout bounds shutdown on restart/deploy.
timeout = 60
graceful_timeout = 30
keepalive = 5

# Log to stdout/stderr → captured by journald (journalctl -u benchmarkwatcher).
accesslog = "-"
errorlog = "-"
loglevel = "info"

proc_name = "benchmarkwatcher"
