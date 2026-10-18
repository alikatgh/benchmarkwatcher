"""The Pele guide remains discoverable and keeps source/calculation roles clear."""
from html.parser import HTMLParser
from xml.etree import ElementTree


class _Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = set()

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.hrefs.update(value for name, value in attrs if name == 'href')


def test_pele_story_has_metadata_and_explains_source_boundaries(app_client):
    path = '/blog/pele-source-diagrams'
    title = 'Follow the source with Pele diagrams'
    response = app_client.get(path)
    assert response.status_code == 200
    html = response.text
    assert f'<h1 class="text-2xl sm:text-3xl font-bold mb-4">{title}</h1>' in html
    assert f'<link rel="canonical" href="https://benchmarkwatcher.online{path}">' in html
    assert f'<meta property="og:title" content="{title} | BenchmarkWatcher">' in html
    assert '<time datetime="2026-10-18">October 18, 2026</time>' in html
    for detail in (
        'How this data reaches the chart',
        'Sources, coverage and calculation methods',
        'Source data',
        'original reporting periods, units, source flags, gaps and filing links',
        'Workbook formulas are not executed here',
        'a workbook may include assumptions',
        'Opening a diagram does not request a refresh',
        'Ordered source steps remain readable without JavaScript',
        'D3 continues to draw the numerical histories',
        'customization, exact-value views and exports remain available',
    ):
        assert detail in html

    links = _Links()
    links.feed(html)
    assert 'https://github.com/obsidianmd/pele' in links.hrefs
    for target in ('/data', '/companies', '/references', '/changelog#pele-source-diagrams'):
        assert target in links.hrefs


def test_pele_story_is_linked_from_blog_changelog_and_sitemap(app_client):
    path = '/blog/pele-source-diagrams'
    for target in ('/blog', '/changelog'):
        response = app_client.get(target)
        assert response.status_code == 200
        assert f'href="{path}"' in response.text
    changelog = app_client.get('/changelog').text
    assert 'id="pele-source-diagrams"' in changelog
    assert 'Aligned the compact Range, Chart and Quick visuals controls' in changelog
    response = app_client.get('/sitemap.xml')
    assert response.status_code == 200
    locations = {node.text for node in ElementTree.fromstring(response.data).iter(
        '{http://www.sitemaps.org/schemas/sitemap/0.9}loc')}
    assert 'https://benchmarkwatcher.online' + path in locations
