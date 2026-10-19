"""The workspace update is discoverable and describes its actual web scope."""
from html.parser import HTMLParser
from xml.etree import ElementTree


class _StoryPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs = set()
        self.meta = {}
        self.canonical = None
        self.story_text = []
        self.in_article = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'article':
            self.in_article = True
        elif tag == 'a':
            self.hrefs.add(attrs.get('href'))
        elif tag == 'meta':
            self.meta[attrs.get('name') or attrs.get('property')] = attrs.get('content')
        elif tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonical = attrs.get('href')

    def handle_endtag(self, tag):
        if tag == 'article':
            self.in_article = False

    def handle_data(self, data):
        if self.in_article:
            self.story_text.append(data)


def test_reui_story_has_metadata_and_describes_selective_web_update(app_client):
    path = '/blog/a-clearer-research-workspace'
    response = app_client.get(path)
    assert response.status_code == 200
    page = _StoryPage()
    page.feed(response.text)
    text = ' '.join(' '.join(page.story_text).split())

    assert '<h1 class="text-2xl sm:text-3xl font-bold mb-4">A clearer research workspace</h1>' in response.text
    assert '<time datetime="2026-10-19">October 19, 2026</time>' in response.text
    assert page.canonical == 'https://benchmarkwatcher.online' + path
    assert page.meta['og:title'] == 'A clearer research workspace | BenchmarkWatcher'
    assert page.meta['description']
    assert page.meta['og:description'] == page.meta['description']

    # Cover the scope and evidence boundaries without freezing the article wording.
    for detail in ('local research notes', 'Retry', 'more than twelve options',
                   'six appearances', 'historical-change palettes', 'D3',
                   'Exact values', 'units', 'source details', 'MIT-licensed',
                   'existing Flask application'):
        assert detail in text
    assert 'adds no calls to data or AI providers' in text
    for unsupported_claim in ('fully migrated', 'real-time data', 'native app release',
                              'predict future', 'faster than'):
        assert unsupported_claim not in text.lower()
    assert {
        '/?view=compact', '/data', '/companies', '/sources',
        '/changelog#reui-workspace', 'https://github.com/keenthemes/reui',
    } <= page.hrefs


def test_reui_story_is_linked_from_blog_changelog_and_sitemap(app_client):
    path = '/blog/a-clearer-research-workspace'
    for target in ('/blog', '/changelog'):
        response = app_client.get(target)
        assert response.status_code == 200
        page = _StoryPage()
        page.feed(response.text)
        assert path in page.hrefs
    assert 'id="reui-workspace"' in app_client.get('/changelog').text

    response = app_client.get('/sitemap.xml')
    assert response.status_code == 200
    locations = {node.text for node in ElementTree.fromstring(response.data).iter(
        '{http://www.sitemaps.org/schemas/sitemap/0.9}loc')}
    assert 'https://benchmarkwatcher.online' + path in locations
