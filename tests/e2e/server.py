"""Isolated fixture server for CI browser tests; never writes production data."""
from datetime import date, timedelta
import argparse
import json
import logging
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from cryptography.fernet import Fernet
import secrets

from app import create_app
from app import analysis_providers
from tests.e2e.workbook_fixture import write_workbook, provider_response


def main(workbooks=False):
    with TemporaryDirectory(prefix='benchmarkwatcher-e2e-') as directory:
        library = Path(directory) / 'models'
        library.mkdir()
        write_workbook(library / 'Sample Company.xlsx')
        for name, category, base, step in [('Gold', 'precious', 2000, 1.25), ('Oil', 'energy', 80, -.05), ('Copper', 'metal', 9000, 2.5)]:
            history = [{'date': (date.today() - timedelta(days=119-i)).isoformat(),
                        'price': round(base + i * step, 4)} for i in range(120)]
            item = {'id': name.lower(), 'name': name, 'category': category,
                    'price': history[-1]['price'], 'date': history[-1]['date'],
                    'currency': 'USD', 'unit': 'test unit', 'frequency': 'daily',
                    'source_name': 'Synthetic test data', 'source_url': 'https://example.com',
                    'updated_at': history[-1]['date'] + 'T00:00:00Z',
                    'source_type': 'FIXTURE', 'history': history}
            (Path(directory) / f'{item["id"]}.json').write_text(json.dumps(item))

        class Config:
            SECRET_KEY = 'ci-only-fixture-server'
            JSON_DATA_DIR = directory
            CACHE_TYPE = 'SimpleCache'
            RATELIMIT_ENABLED = False
            WORKSPACE_ENABLED = workbooks
            WORKSPACE_SESSION_SECRET = secrets.token_hex(32)
            WORKSPACE_ENCRYPTION_KEY = Fernet.generate_key().decode()
            WORKSPACE_COOKIE_SECURE = False
            WORKSPACE_DB = str(Path(directory) / 'workspace.sqlite3')
            MODEL_LIBRARY_DIR = str(library)
            MODEL_LIBRARY_SOURCE_URL = ''
            TESTING = True

        if workbooks:
            analysis_providers._request = provider_response
        app = create_app(Config)
        logging.getLogger('werkzeug').setLevel(logging.WARNING)
        print('SYNTHETIC PREVIEW: temporary data; workbook mode uses simulated providers.', flush=True)
        app.run(host='127.0.0.1', port=int(os.getenv('PLAYWRIGHT_PORT', '5781')),
                load_dotenv=False, debug=False, use_reloader=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbooks', action='store_true', help='Enable temporary workbook accounts and simulated providers.')
    main(workbooks=parser.parse_args().workbooks)
