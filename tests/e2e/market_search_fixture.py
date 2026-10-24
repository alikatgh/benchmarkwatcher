"""Explicitly synthetic, local-only stock/FX/company search fixtures."""
import sqlite3
from datetime import datetime, timedelta, timezone
from scripts.vendor_data_store import APPLICATION_ID, CACHE_SCHEMA, SCHEMA_VERSION
from scripts.public_data_store import LibraryWriter, series_id


def seed_search(market_path, library_path):
    now = datetime.now(timezone.utc)
    day = (now.date() - timedelta(days=1)).isoformat()
    with sqlite3.connect(market_path) as conn:
        conn.executescript(CACHE_SCHEMA)
        conn.execute(f'PRAGMA application_id={APPLICATION_ID}')
        conn.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
        for identifier, value in [('stock-XNAS-AAPL', 200.0), ('fx-USD-EUR', .92)]:
            conn.execute('INSERT INTO instruments VALUES (?,?,?)', (identifier, now.isoformat(), 1))
            conn.execute('INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?)',
                         (identifier, day, value, None, None, None, value, None, None))
    identifier = series_id('sec', '320193', 'us-gaap:Assets', 'USD')
    with LibraryWriter(library_path, 'sec', 'frames') as writer:
        writer.add_series(dict(id=identifier, source='sec', dataset='frames',
            entity_id='320193', entity_name='Apple Inc.', entity_type='company',
            indicator_id='us-gaap:Assets', indicator_name='Synthetic total assets',
            unit='USD', frequency='annual', source_url='https://example.com/synthetic-company',
            attribution='Synthetic test observations, not real company data.',
            license='Test fixture', metadata={}), [{'period':'2025', 'value':12345}])
