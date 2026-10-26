"""Deterministic synthetic reference corpus for public browser journeys.

The dimensions deliberately cover realistic pagination without copying cached
provider data. Only the two Japan detail histories and monthly inflation need
more than two observations. This module is used by the isolated test server.
"""
import json

from scripts import global_sources as sources


def seed_references(directory):
    directory.mkdir()
    stamp = '2026-10-03'
    definitions = sources.load_series()
    snapshot = json.loads((sources.SCRIPT_DIR / 'global_catalog_snapshot.json').read_text())
    indicators = sources.load_worldbank_bulk()['indicators']
    aliases = {(row['api_config']['country'], row['api_config']['indicator']): row['id']
               for row in definitions if row['source_id'] == 'worldbank'}
    # Keep all six published aliases inside the fixture, followed by catalog
    # order. Different indicator coverage also exercises missing country data.
    alias_countries = {country for country, _ in aliases}
    economies = sorted(snapshot['worldbank']['economies'],
                       key=lambda row: (row['iso2'] not in alias_countries, row['id']))

    def write(identifier, history):
        (directory / f'{identifier}.json').write_text(json.dumps({
            'id': identifier, 'history': history, 'fetched_at': stamp + 'T00:00:00Z',
            'fixture_note': 'Synthetic browser-test observations; not provider data.',
        }, separators=(',', ':')))

    entries = []
    for index, indicator in enumerate(indicators):
        # 209 + 209 + 209 + 208 + 205 + 208 = 1,248 country histories.
        count = 205 if indicator['slug'] == 'agriculture_share' else 209 if index < 3 else 208
        for economy_index, economy in enumerate(economies[:count]):
            definition = sources.worldbank_definition(indicator, economy, aliases)
            detail = economy['id'] == 'JPN' and indicator['slug'] in {'population', 'gdp_constant'}
            years = range(2000, 2026) if detail else (2000, 2025)
            base = 120_000_000 if indicator['slug'] == 'population' else 4_000_000_000_000 if indicator['slug'] == 'gdp_constant' else 10
            history = [{'date': f'{year}-01-01', 'period': str(year),
                        'price': round(base + base * .001 * (year - 2000) + economy_index, 4)}
                       for year in years]
            write(definition['id'], history)
            entries.append({'id': definition['id'], 'economy_id': economy['id'],
                            'indicator': indicator['indicator'], 'latest': history[-1],
                            'observation_count': len(history), 'checked_on': stamp})
    (directory / 'worldbank_manifest.json').write_text(json.dumps({
        'schema_version': 1, 'source_id': 'worldbank', 'source_database': 2,
        'series': entries,
    }, separators=(',', ':')))

    for row in definitions:
        if row['source_id'] == 'worldbank' or row.get('reference_type') not in {
                'exchange_reference', 'consumer_inflation', 'retail_fuel_price'}:
            continue
        if row['id'] == 'de_hicp_annual_change':
            history = [{'date': f'{2016 + month // 12}-{month % 12 + 1:02d}-01',
                        'period': f'{2016 + month // 12}-{month % 12 + 1:02d}',
                        'price': round(2 + month * .01, 2)} for month in range(120)]
        else:
            history = [{'date': f'2026-09-{day:02d}', 'period': f'2026-09-{day:02d}',
                        'price': 2 + day * .01} for day in (1, 2)]
        write(row['id'], history)
