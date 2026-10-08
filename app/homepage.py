"""Homepage coverage from the saved public-library dataset summaries."""

import sqlite3

from app.public_library import DATASET_NAMES, database_path
from scripts.public_data_policy import public_sql
from scripts.public_data_store import SOURCES, read_connection


# Short browse labels; the publisher and domain code remain visible beside them.
_DATASET_LABELS = {
    ('faostat', 'CB'): 'Non-food commodity balances',
    ('faostat', 'FDI'): 'Foreign direct investment',
    ('faostat', 'GF'): 'Forest emissions',
    ('faostat', 'GV'): 'Drained organic soil emissions',
    ('faostat', 'IC'): 'Agricultural credit',
    ('faostat', 'IG'): 'Government expenditure',
    ('faostat', 'LC'): 'Land cover',
    ('faostat', 'RM'): 'Machinery (RM archive)',
    ('faostat', 'RY'): 'Machinery (RY archive)',
}

_COUNTS = (
    'dataset_count', 'observation_count', 'history_count', 'country_histories',
    'company_histories', 'companies', 'country_dataset_count',
)


def _no_coverage(status):
    value = 0 if status == 'empty' else None
    return dict(status=status, datasets=[], **dict.fromkeys(_COUNTS, value))


def homepage_coverage():
    """Read published saved coverage without scanning histories or fetching data.

    The counts describe the public library only; commodity JSON histories are a
    separate collection. Company entities are known from the SEC frames summary,
    since summing entities across company datasets could count a company twice.
    """
    conn = None
    try:
        conn = read_connection(database_path())
        if conn is None:
            return _no_coverage('empty')
        rows = [dict(row) for row in conn.execute(
            'SELECT source,dataset,checked_at,series_count,entity_count,'
            'indicator_count,observation_count FROM datasets WHERE '
            + public_sql() + ' AND observation_count>0 ORDER BY source,dataset'
        )]
        if not rows:
            return _no_coverage('empty')
        for row in rows:
            for key in ('series_count', 'entity_count', 'indicator_count', 'observation_count'):
                if type(row[key]) is not int or row[key] < 0:
                    return _no_coverage('unavailable')
            row['name'] = _DATASET_LABELS.get((row['source'], row['dataset']),
                                               DATASET_NAMES.get(row['dataset'], row['dataset']))
            row['publisher'] = SOURCES.get(row['source'], row['source'])
        rows.sort(key=lambda row: ({'worldbank': 0, 'faostat': 1, 'sec': 2}.get(row['source'], 3), row['name']))
        countries = [row for row in rows if row['source'] != 'sec']
        companies = [row for row in rows if row['source'] == 'sec']
        frames = next((row for row in companies if row['dataset'] == 'frames'), None)
        return {
            'status': 'available',
            'datasets': rows,
            'dataset_count': len(rows),
            'observation_count': sum(row['observation_count'] for row in rows),
            'history_count': sum(row['series_count'] for row in rows),
            'country_histories': sum(row['series_count'] for row in countries),
            'company_histories': sum(row['series_count'] for row in companies),
            'companies': frames['entity_count'] if frames else None,
            'country_dataset_count': len(countries),
        }
    except sqlite3.Error:
        # Library failures should not take down the homepage or imply zero data.
        return _no_coverage('unavailable')
    finally:
        if conn is not None:
            conn.close()
