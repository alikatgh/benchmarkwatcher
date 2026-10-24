from scripts.market_data_catalog import CATALOG, FX, PROFILES, STOCKS


def test_reviewed_catalog_has_one_hundred_unique_usd_stocks_and_preserves_original_fifteen():
    assert len(STOCKS) == len({item.id for item in STOCKS}) == len({item.symbol for item in STOCKS}) == 100
    assert [(item.symbol, item.name) for item in STOCKS[:15]] == [
        ('AAPL', 'Apple'), ('MSFT', 'Microsoft'), ('NVDA', 'NVIDIA'), ('AMZN', 'Amazon'),
        ('GOOGL', 'Alphabet'), ('META', 'Meta Platforms'), ('TSLA', 'Tesla'),
        ('AVGO', 'Broadcom'), ('AMD', 'Advanced Micro Devices'), ('INTC', 'Intel'),
        ('CSCO', 'Cisco Systems'), ('ADBE', 'Adobe'), ('NFLX', 'Netflix'),
        ('JPM', 'JPMorgan Chase'), ('V', 'Visa'),
    ]
    assert all(item.kind == 'stock' and item.currency == 'USD' and item.provider == 'marketstack' for item in STOCKS)
    assert {item.exchange for item in STOCKS} == {'XNYS', 'XNAS'}
    assert PROFILES['weekly-15']['stocks'] == STOCKS[:15]
    assert PROFILES['daily-3']['stocks'] == STOCKS[:3]
    assert PROFILES['monthly-100'] == {'stocks': STOCKS, 'interval_days': 32, 'period_units': 100}


def test_dynamic_quote_catalog_preserves_lookup_contract_and_rejects_malformed_identifiers():
    for item in STOCKS + FX:
        assert item.id in CATALOG and CATALOG.get(item.id) == item == CATALOG[item.id]
    assert CATALOG['fx-USD-AED'].quote_currency == 'AED'
    for identifier in ('fx-USD-aed', 'fx-EUR-USD', 'fx-USD-USD', 'fx-USD-AED-more', 'fx-USD-ＡＥＤ', '', None):
        assert identifier not in CATALOG and CATALOG.get(identifier) is None
