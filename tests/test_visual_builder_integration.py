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
    html = response.get_data(as_text=True)
    assert 'aria-label="Quick visual for Mongolia Population"' in html
    assert 'data-visual-catalog-actions' in html
    row, = embedded_json(html, 'bw-visual-catalog')
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


def test_energy_page_keeps_the_table_and_contextual_visual_entry(app_client):
    response = app_client.get('/?category=energy&view=compact&range=1M')
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert 'id="table-workspace"' in html
    assert 'id="range-1M"' in html
    assert 'id="tw-visual-actions"' in html
    assert 'id="tw-selection"' in html
    assert 'id="bw-category-graphic"' not in html
    assert 'data-category-preview' not in html
    assert 'Energy in graphics' not in html
    assert 'data-open-visual-builder' not in html
    assert 'js/components/quick_visuals.js' in html
    assert 'css/quick-visuals.css' in html
    assert html.index('js/components/visual_builder.js') < html.index('js/components/quick_visuals.js')
    assert html.index('js/components/quick_visuals.js') < html.index('js/components/visual_builder_sources.js')


def test_shared_header_does_not_launch_a_global_editor(library):
    client, _, identifier = library
    for route in ('/help', '/data', '/data/' + identifier):
        response = client.get(route)
        assert response.status_code == 200
        assert 'data-open-visual-builder' not in response.get_data(as_text=True)
