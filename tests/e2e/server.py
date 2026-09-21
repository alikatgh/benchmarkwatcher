"""Isolated fixture server for CI browser tests; never writes production data."""
from datetime import date, timedelta
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from app import create_app


def main():
    with TemporaryDirectory(prefix='benchmarkwatcher-e2e-') as directory:
        for name, category, base, step in [('Gold', 'precious', 2000, 1.25), ('Oil', 'energy', 80, -.05), ('Copper', 'metal', 9000, 2.5)]:
            history = [{'date': (date.today() - timedelta(days=119-i)).isoformat(),
                        'price': round(base + i * step, 4)} for i in range(120)]
            item = {'id': name.lower(), 'name': name, 'category': category,
                    'price': history[-1]['price'], 'date': history[-1]['date'],
                    'currency': 'USD', 'unit': 'test unit', 'frequency': 'daily',
                    'source_name': 'Synthetic test data', 'source_url': 'https://example.com',
                    'source_type': 'FIXTURE', 'history': history}
            (Path(directory) / f'{item["id"]}.json').write_text(json.dumps(item))

        class Config:
            SECRET_KEY = 'ci-only-fixture-server'
            JSON_DATA_DIR = directory
            CACHE_TYPE = 'SimpleCache'
            RATELIMIT_ENABLED = False
            WORKSPACE_ENABLED = False
            TESTING = True

        app = create_app(Config)
        app.run(host='127.0.0.1', port=int(os.getenv('PLAYWRIGHT_PORT', '5781')))


if __name__ == '__main__':
    main()
