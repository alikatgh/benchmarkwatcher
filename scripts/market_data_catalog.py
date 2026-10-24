"""Small, reviewed vendor catalog; no discovery calls or paid fallbacks."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Instrument:
    id: str
    kind: str
    name: str
    symbol: str
    provider: str
    currency: str
    exchange: str = ''
    base_currency: str = ''
    quote_currency: str = ''
    frequency: str = 'daily'
    source_url: str = ''


def _stock(symbol, name, exchange='XNAS'):
    return Instrument(f'stock-{exchange}-{symbol}', 'stock', name, symbol,
                      'marketstack', 'USD', exchange=exchange,
                      source_url='https://marketstack.com/')


STOCKS = (
    _stock('AAPL', 'Apple'), _stock('MSFT', 'Microsoft'), _stock('NVDA', 'NVIDIA'),
    _stock('AMZN', 'Amazon'), _stock('GOOGL', 'Alphabet'), _stock('META', 'Meta Platforms'),
    _stock('TSLA', 'Tesla'), _stock('AVGO', 'Broadcom'), _stock('AMD', 'Advanced Micro Devices'),
    _stock('INTC', 'Intel'), _stock('CSCO', 'Cisco Systems'), _stock('ADBE', 'Adobe'),
    _stock('NFLX', 'Netflix'), _stock('JPM', 'JPMorgan Chase', 'XNYS'),
    _stock('V', 'Visa', 'XNYS'),
)
FX_QUOTES = ('EUR', 'GBP', 'JPY', 'CNY', 'MNT', 'CAD', 'AUD', 'NZD', 'KRW', 'INR',
             'CHF', 'SGD', 'HKD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'ZAR', 'BRL')
FX = tuple(Instrument(f'fx-USD-{quote}', 'fx', f'US dollar / {quote}', f'USD/{quote}',
                      'exchangerate_host', quote, base_currency='USD', quote_currency=quote,
                      source_url='https://exchangerate.host/') for quote in FX_QUOTES)
PROFILES = {
    'weekly-15': {'stocks': STOCKS, 'interval_days': 7, 'period_units': 90},
    'daily-3': {'stocks': STOCKS[:3], 'interval_days': 1, 'period_units': 90},
}
CATALOG = {item.id: item for item in STOCKS + FX}
