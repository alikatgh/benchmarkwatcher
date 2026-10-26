"""The public library guide is discoverable without a populated local corpus."""
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit
from xml.etree import ElementTree


class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.hrefs.extend(value for name, value in attrs if name == 'href')


def test_public_library_story_is_linked_and_preserves_source_boundaries(app_client):
    path = '/blog/a-public-data-library-for-country-and-company-research'
    title = 'A public data library for country and company research'
    response = app_client.get(path)
    assert response.status_code == 200
    html = response.text
    assert title in html
    assert f'<link rel="canonical" href="https://benchmarkwatcher.online{path}">' in html
    assert f'<meta property="og:title" content="{title} | BenchmarkWatcher">' in html
    assert '<time datetime="2026-10-07">' in html
    for claim in ('700,178', '11,813,386', '1,488 populated indicators',
                  '12,363 reporting companies', 'currently ends in 2024',
                  'actual reporting start and end dates', 'original decimal text',
                  'restricted indicators are excluded', 'at most one due',
                  'not a global company census'):
        assert claim in html

    links = _Links()
    links.feed(html)
    examples = [urlsplit(href) for href in links.hrefs]
    assert any(link.path == '/data' and parse_qs(link.query) == {
        'source': ['faostat'], 'dataset': ['QCL'], 'q': ['Mongolia wheat']
    } for link in examples)
    assert any(link.path == '/companies' and parse_qs(link.query) == {'q': ['Apple']}
               for link in examples)
    for target in ('/data', '/companies', '/sources', '/references'):
        assert target in {link.path for link in examples}
        assert app_client.get(target).status_code == 200

    for target in ('/blog', '/changelog'):
        page = app_client.get(target)
        assert page.status_code == 200
        assert f'href="{path}"' in page.text
    sitemap = app_client.get('/sitemap.xml')
    assert sitemap.status_code == 200
    locations = {node.text for node in ElementTree.fromstring(sitemap.data).iter(
        '{http://www.sitemaps.org/schemas/sitemap/0.9}loc')}
    assert all('https://benchmarkwatcher.online' + target in locations
               for target in (path, '/data', '/companies'))
