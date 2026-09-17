from xml.etree import ElementTree
from urllib.parse import urlsplit


def test_sitemap_contains_public_pages_and_catalog(app_client):
    robots = app_client.get('/robots.txt')
    assert robots.status_code == 200 and robots.mimetype == 'text/plain'
    assert 'Sitemap: https://benchmarkwatcher.online/sitemap.xml' in robots.text
    response = app_client.get('/sitemap.xml')
    assert response.status_code == 200 and response.mimetype == 'application/xml'
    urls = [n.text for n in ElementTree.fromstring(response.data).findall('{*}url/{*}loc')]
    assert urls == ['https://benchmarkwatcher.online/', 'https://benchmarkwatcher.online/changelog', 'https://benchmarkwatcher.online/commodity/gold']
    for url in urls:
        page = app_client.get(urlsplit(url).path)
        assert page.status_code == 200
        assert f'<link rel="canonical" href="{url}">' in page.text
        assert 'name="google-site-verification"' in page.text


def test_commodity_metadata_and_query_canonical(app_client):
    page = app_client.get('/commodity/gold?range=1Y')
    assert '<title>Gold historical benchmark prices' in page.text
    assert 'Explore historical Gold benchmark observations' in page.text
    assert 'href="https://benchmarkwatcher.online/commodity/gold"' in page.text
    assert app_client.get('/commodity/missing').status_code == 404
