import sys
import os
import traceback

# Ensure the project root is importable (Passenger's working directory may differ).
_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _ROOT)

_BOOT_ERROR_LOG = os.path.join(_ROOT, 'passenger_boot_error.log')


def _create_application():
    """Build the WSGI application.

    Imports live inside this function so that a broken/out-of-date production
    virtualenv (e.g. a missing dependency after a deploy) is caught below and
    written to passenger_boot_error.log instead of crashing opaquely behind the
    host's generic 500 page.
    """
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_ROOT, '.env'))

    from app import create_app
    return create_app()


try:
    application = _create_application()
except Exception:  # noqa: BLE001 - boot must surface ANY failure, not crash opaquely
    _tb = traceback.format_exc()

    # Persist the traceback so an otherwise-opaque host 500 is diagnosable.
    # After a failed boot, read this file via cPanel File Manager / SSH.
    try:
        with open(_BOOT_ERROR_LOG, 'w', encoding='utf-8') as _f:
            _f.write(_tb)
    except Exception:
        pass
    sys.stderr.write(_tb)

    def application(environ, start_response):  # noqa: F811 - fallback WSGI app
        start_response(
            '500 Internal Server Error',
            [('Content-Type', 'text/plain; charset=utf-8')],
        )
        return [
            b'BenchmarkWatcher failed to start. '
            b'See passenger_boot_error.log in the app root for the traceback.\n',
        ]
