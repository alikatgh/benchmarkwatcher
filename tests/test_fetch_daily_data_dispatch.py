from typing import Any, Dict, List

from pytest import MonkeyPatch

import scripts.fetch_daily_data as fetch_daily_data


def test_fetch_new_data_dispatch_fred(monkeypatch: MonkeyPatch):
    calls: Dict[str, Any] = {}

    def fake_fetcher(series_id: str) -> List[Dict[str, Any]]:
        calls['series_id'] = series_id
        return [{'date': '2026-01-01', 'price': 1.0}]

    monkeypatch.setitem(fetch_daily_data.FETCHER_REGISTRY, 'FRED', fake_fetcher)

    out = fetch_daily_data.fetch_new_data({
        'source_type': 'FRED',
        'api_config': {'series_id': 'DCOILWTICO'}
    })

    assert out and out[0]['price'] == 1.0
    assert calls['series_id'] == 'DCOILWTICO'


def test_fetch_new_data_dispatch_eia(monkeypatch: MonkeyPatch):
    calls: Dict[str, Any] = {}

    def fake_fetcher(url: str, facets: Dict[str, List[str]]) -> List[Dict[str, Any]]:
        calls['url'] = url
        calls['facets'] = facets
        return [{'date': '2026-01-01', 'price': 2.0}]

    monkeypatch.setitem(fetch_daily_data.FETCHER_REGISTRY, 'EIA', fake_fetcher)

    out = fetch_daily_data.fetch_new_data({
        'source_type': 'EIA',
        'api_config': {'url': '/v2/petroleum', 'facets': {'product': ['EPM0']}}
    })

    assert out and out[0]['price'] == 2.0
    assert calls['url'] == '/v2/petroleum'
    assert calls['facets'] == {'product': ['EPM0']}


def test_fetch_new_data_dispatch_yahoo(monkeypatch: MonkeyPatch):
    calls: Dict[str, Any] = {}

    def fake_fetcher(symbol: str) -> List[Dict[str, Any]]:
        calls['symbol'] = symbol
        return [{'date': '2026-01-01', 'price': 3.0}]

    monkeypatch.setitem(fetch_daily_data.FETCHER_REGISTRY, 'YAHOO', fake_fetcher)

    out = fetch_daily_data.fetch_new_data({
        'source_type': 'YAHOO',
        'api_config': {'symbol': 'GC=F'}
    })

    assert out and out[0]['price'] == 3.0
    assert calls['symbol'] == 'GC=F'


def test_fetch_new_data_dispatch_usda_with_default_unit(monkeypatch: MonkeyPatch):
    calls: Dict[str, Any] = {}

    def fake_fetcher(*, commodity_desc: str, unit_desc: str) -> List[Dict[str, Any]]:
        calls['commodity_desc'] = commodity_desc
        calls['unit_desc'] = unit_desc
        return [{'date': '2026-01-01', 'price': 4.0}]

    monkeypatch.setitem(fetch_daily_data.FETCHER_REGISTRY, 'USDA', fake_fetcher)

    out = fetch_daily_data.fetch_new_data({
        'source_type': 'USDA',
        'api_config': {'commodity_desc': 'WHEAT'}
    })

    assert out and out[0]['price'] == 4.0
    assert calls['commodity_desc'] == 'WHEAT'
    assert calls['unit_desc'] == '$ / BU'


def test_fetch_new_data_dispatch_default_kwargs(monkeypatch: MonkeyPatch):
    calls: Dict[str, Any] = {}

    def fake_fetcher(**kwargs: Any) -> List[Dict[str, Any]]:
        calls['kwargs'] = kwargs
        return [{'date': '2026-01-01', 'price': 5.0}]

    monkeypatch.setitem(fetch_daily_data.FETCHER_REGISTRY, 'CUSTOM', fake_fetcher)

    out = fetch_daily_data.fetch_new_data({
        'source_type': 'CUSTOM',
        'api_config': {'a': 1, 'b': 2}
    })

    assert out and out[0]['price'] == 5.0
    assert calls['kwargs'] == {'a': 1, 'b': 2}


def test_fetch_new_data_missing_fetcher_returns_none():
    out = fetch_daily_data.fetch_new_data({
        'source_type': 'DOES_NOT_EXIST',
        'api_config': {'x': 1}
    })

    assert out is None
