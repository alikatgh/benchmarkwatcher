from xml.etree import ElementTree
from datetime import date, timedelta
import json


def test_canonical_pages_and_sitemap(app_client):
    result = app_client.get('/sitemap.xml')
    assert result.status_code == 200
    root = ElementTree.fromstring(result.data)
    urls = [el.text for el in root.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
    assert 'https://benchmarkwatcher.online/commodity/gold' in urls
    assert len(urls) == len(set(urls))
    assert all('?' not in url and '/api/' not in url for url in urls)
    page = app_client.get('/commodity/gold').get_data(as_text=True)
    assert '<link rel="canonical" href="https://benchmarkwatcher.online/commodity/gold">' in page
    assert 'Gold price history | BenchmarkWatcher' in page
    assert 'OBSERVATION DATE' in page and 'RETRIEVED' in page
    assert 'Sitemap: https://benchmarkwatcher.online/sitemap.xml' in app_client.get('/robots.txt').text


def test_long_history_and_non_dollar_units_survive_refresh(tmp_path, monkeypatch):
    from scripts import fetch_daily_data as fetch
    history = [{'date': (date(2000, 1, 1) + timedelta(days=i)).isoformat(), 'price': 100+i/10} for i in range(1200)]
    record = {'id':'sample', 'name':'Sample', 'category':'index', 'unit':'2016 = 100', 'currency':'Index', 'source_type':'FRED', 'api_config':{}}
    monkeypatch.setattr(fetch, 'DATA_DIR', str(tmp_path))
    monkeypatch.setattr(fetch, 'fetch_new_data', lambda _: history)
    assert fetch.update_commodity(record)
    saved = json.loads((tmp_path/'sample.json').read_text())
    assert len(saved['history']) == 1200
    assert saved['history'][0]['date'] == '2000-01-01'
    assert saved['currency'] == 'Index'
    assert saved['price'] == history[-1]['price']
