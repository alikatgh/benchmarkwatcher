"""Homepage discovery reflects the saved library without fetching providers."""

from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit
from xml.etree import ElementTree

import pytest
from cryptography.fernet import Fernet

from app import create_app
from scripts.public_data_store import LibraryWriter, series_id


class _Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.links = []
        self.text = []
        self.anchor = None
        self.feed(html)
        self.text = ' '.join(''.join(self.text).split())

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            attrs = dict(attrs)
            self.anchor = {
                'href': attrs.get('href', ''),
                'classes': set(attrs.get('class', '').split()),
                'text': [],
            }

    def handle_data(self, text):
        self.text.append(text)
        if self.anchor is not None:
            self.anchor['text'].append(text)

    def handle_endtag(self, tag):
        if tag == 'a' and self.anchor is not None:
            self.anchor['text'] = ' '.join(''.join(self.anchor['text']).split())
            self.links.append(self.anchor)
            self.anchor = None


@pytest.fixture(autouse=True)
def no_provider_calls(monkeypatch):
    # Keep the shared public test fixture independent of local workspace secrets.
    monkeypatch.setenv('WORKSPACE_ENABLED', '0')
    provider = Mock(side_effect=AssertionError('Homepage must not run AI analysis'))
    network = Mock(side_effect=AssertionError('Homepage must not fetch provider data'))
    monkeypatch.setattr('app.analysis_providers._request', provider)
    monkeypatch.setattr('requests.sessions.Session.request', network)
    yield
    provider.assert_not_called()
    network.assert_not_called()


@pytest.fixture
def homepage_client(app_client, tmp_path):
    app_client.application.config.update(
        WORKSPACE_ENABLED=False,
        PUBLIC_LIBRARY_DB=str(tmp_path / 'public.sqlite3'),
    )
    return app_client


def _seed_dataset(path, source, dataset, measures):
    with LibraryWriter(path, source, dataset) as writer:
        for entity, name, indicator, values in measures:
            unit = 'USD' if source == 'sec' else 'people' if source == 'worldbank' else 't'
            writer.add_series({
                'id': series_id(source, entity, indicator, unit),
                'source': source,
                'dataset': dataset,
                'entity_id': entity,
                'entity_name': name,
                'entity_type': 'company' if source == 'sec' else 'country',
                'indicator_id': indicator,
                'indicator_name': indicator,
                'unit': unit,
                'frequency': 'annual',
                'source_url': 'https://example.com/source/' + dataset,
                'attribution': 'Local public fixture',
                'license': 'CC BY-4.0',
            }, [{'period': str(2020 + index), 'value': value}
                for index, value in enumerate(values)])
    return writer.summary()


@pytest.fixture
def saved_homepage(homepage_client):
    path = homepage_client.application.config['PUBLIC_LIBRARY_DB']
    published = [
        _seed_dataset(path, 'worldbank', 'WDI', [
            ('MNG', 'Mongolia', 'SP.POP.TOTL', [1, 2, 3]),
            ('USA', 'United States', 'SP.POP.TOTL', [4, 5]),
        ]),
        _seed_dataset(path, 'faostat', 'QCL', [
            ('FAO:141', 'Mongolia', 'QCL:wheat', [6, 7]),
        ]),
        _seed_dataset(path, 'sec', 'frames', [
            ('320193', 'Apple Inc.', 'us-gaap:Assets', [8, 9, 10]),
            ('320193', 'Apple Inc.', 'us-gaap:Revenues', [11, 12]),
        ]),
    ]
    _seed_dataset(path, 'faostat', 'TCL', [
        ('FAO:141', 'Mongolia', 'TCL:wheat', [13, 14, 15, 16]),
    ])
    return homepage_client, published


def test_homepage_renders_saved_published_coverage_and_dataset_links(saved_homepage):
    client, summaries = saved_homepage
    response = client.get('/')
    assert response.status_code == 200
    assert 'id="home-overview"' in response.text
    page = _Page(response.text)
    observations = sum(row['observation_count'] for row in summaries)
    histories = sum(row['series_count'] for row in summaries)
    country_histories = sum(row['series_count'] for row in summaries if row['source'] != 'sec')
    companies = next(row['entity_count'] for row in summaries if row['source'] == 'sec')
    assert f'{observations:,} observations in the country & company library' in page.text
    assert f'{histories:,} histories · {len(summaries)} datasets' in page.text

    collections = [link for link in page.links if 'home-collection' in link['classes']]
    assert len(collections) == 3
    assert '1 reference series' in collections[0]['text']  # One sample commodity, counted separately.
    assert urlsplit(collections[0]['href']).path == '/'
    assert parse_qs(urlsplit(collections[0]['href']).query) == {'view': ['compact']}
    assert f'{country_histories:,} histories' in collections[1]['text']
    assert urlsplit(collections[1]['href']).path == '/data'
    assert f'{companies:,} companies' in collections[2]['text']
    assert urlsplit(collections[2]['href']).path == '/companies'

    datasets = [link for link in page.links if 'home-dataset' in link['classes']]
    actual = {(urlsplit(link['href']).path,
               parse_qs(urlsplit(link['href']).query)['source'][0],
               parse_qs(urlsplit(link['href']).query)['dataset'][0])
              for link in datasets}
    expected = {('/companies' if row['source'] == 'sec' else '/data', row['source'], row['dataset'])
                for row in summaries}
    assert actual == expected
    assert any('World Development Indicators' in link['text'] for link in datasets)
    assert any('Crops and livestock' in link['text'] for link in datasets)
    assert any('Company financial disclosures' in link['text'] for link in datasets)
    assert not any(parse_qs(urlsplit(link['href']).query).get('dataset') == ['TCL']
                   for link in page.links)
    assert 'Agricultural trade' not in response.text
    for link in datasets:
        assert client.get(link['href']).status_code == 200


def test_explicit_compact_view_keeps_commodity_table_without_coverage_read(homepage_client, monkeypatch):
    def fail_coverage():
        raise AssertionError('The focused commodity workspace must not read library coverage')
    monkeypatch.setattr('app.homepage.homepage_coverage', fail_coverage)
    response = homepage_client.get('/?view=compact')
    assert response.status_code == 200
    assert 'id="home-overview"' not in response.text
    assert 'id="compact-view"' in response.text
    assert 'href="/commodity/gold"' in response.text


@pytest.mark.parametrize('state', ['missing', 'corrupt'])
def test_library_failure_leaves_homepage_and_commodity_workspace_available(homepage_client, state):
    path = Path(homepage_client.application.config['PUBLIC_LIBRARY_DB'])
    if state == 'corrupt':
        path.write_bytes(b'Not a SQLite database')
    response = homepage_client.get('/')
    assert response.status_code == 200
    assert 'id="home-overview"' in response.text
    if state == 'corrupt':
        assert 'Library counts are temporarily unavailable.' in response.text
        assert path.read_bytes() == b'Not a SQLite database'
    else:
        assert 'Library observations have not been loaded yet.' in response.text
        assert not path.exists()
    assert 'id="compact-view"' in response.text
    assert 'href="/commodity/gold"' in response.text
    compact = homepage_client.get('/?view=compact')
    assert compact.status_code == 200
    assert 'href="/commodity/gold"' in compact.text


def test_disabled_workspace_links_to_public_company_guide(homepage_client):
    response = homepage_client.get('/')
    assert response.status_code == 200
    page = _Page(response.text)
    assert any(urlsplit(link['href']).path == '/blog/company-research-from-sec-filings'
               and 'Company research guide' in link['text'] for link in page.links)
    assert not any(urlsplit(link['href']).path == '/workspace/' for link in page.links)
    assert homepage_client.get('/workspace/').status_code == 404


def test_enabled_workspace_links_to_registered_account_route(homepage_client, tmp_path):
    class Config:
        TESTING = True
        SECRET_KEY = 'homepage-public-test'
        CACHE_TYPE = 'NullCache'
        RATELIMIT_ENABLED = False
        JSON_DATA_DIR = homepage_client.application.config['JSON_DATA_DIR']
        PUBLIC_LIBRARY_DB = homepage_client.application.config['PUBLIC_LIBRARY_DB']
        WORKSPACE_ENABLED = True
        WORKBOOK_LIBRARY_ENABLED = False
        WORKSPACE_SESSION_SECRET = 'homepage-workspace-test-secret-at-least-32'
        WORKSPACE_ENCRYPTION_KEY = Fernet.generate_key().decode()
        WORKSPACE_COOKIE_SECURE = False
        WORKSPACE_DB = str(tmp_path / 'private' / 'workspace.sqlite3')
    client = create_app(Config).test_client()
    response = client.get('/')
    assert response.status_code == 200
    page = _Page(response.text)
    assert any(urlsplit(link['href']).path == '/workspace/'
               and 'Company research' in link['text'] for link in page.links)
    workspace = client.get('/workspace/')
    assert workspace.status_code == 302
    assert urlsplit(workspace.headers['Location']).path == '/workspace/login'


def test_homepage_story_is_discoverable_and_in_sitemap(homepage_client):
    path = '/blog/explore-the-whole-library'
    article = homepage_client.get(path)
    assert article.status_code == 200
    assert 'A homepage for the whole library' in article.text
    assert f'<link rel="canonical" href="https://benchmarkwatcher.online{path}">' in article.text
    for target in ('/', '/blog', '/changelog'):
        response = homepage_client.get(target)
        assert response.status_code == 200
        assert path in {urlsplit(link['href']).path for link in _Page(response.text).links}
    response = homepage_client.get('/sitemap.xml')
    assert response.status_code == 200
    locations = {node.text for node in ElementTree.fromstring(response.data).iter(
        '{http://www.sitemaps.org/schemas/sitemap/0.9}loc')}
    assert 'https://benchmarkwatcher.online' + path in locations
