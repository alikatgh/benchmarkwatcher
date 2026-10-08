import json
import re

from tests.test_public_library_routes import library  # noqa: F401


def embedded_json(html, identifier):
    match = re.search(r'<script id="' + identifier + r'" type="application/json">(.*?)</script>', html, re.S)
    assert match, identifier
    return json.loads(match.group(1))


def test_catalog_graphic_keeps_latest_flag_precision_and_publisher(library):
    client, _, identifier = library
    response = client.get('/data?q=Mongolia')
    assert response.status_code == 200
    row, = embedded_json(response.get_data(as_text=True), 'bw-visual-catalog')
    assert row['id'] == identifier
    assert row['period'] == '2024'
    assert row['status'] == 'E'
    assert row['value'] == 3.14159265359
    assert 'worldbank.org' in row['sourceUrl']


def test_history_graphic_contains_full_periods_and_source(library):
    client, _, identifier = library
    html = client.get('/data/' + identifier).get_data(as_text=True)
    chart = embedded_json(html, 'gr-chart-data')
    metadata = embedded_json(html, 'bw-visual-source')
    assert chart['history'][0]['price'] == 0
    assert chart['history'][-1]['status'] == 'E'
    assert metadata['title'] == 'Mongolia · Population'
    assert 'Original source' in metadata['notes']
    assert metadata['sourceUrl'].startswith('https://')
