"""Reviewed stock coverage and strictly identified USD quote instruments.

Stock metadata was checked against Marketstack's public supported_tickers_2.csv
(NASDAQ -> XNAS, NYSE -> XNYS, Stock/USD); its stale endDate is not a delisting
claim. Company labels are familiar trading names, rather than CSV metadata.
Company identity/exchange cross-check: https://www.sec.gov/files/company_tickers_exchange.json
Public support file: https://marketstack.com/marketstack-supported-tickers
"""
import re
from collections.abc import Mapping
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
    _stock('NEM', 'Newmont', 'XNYS'), _stock('XOM', 'Exxon Mobil', 'XNYS'),
    _stock('UNH', 'UnitedHealth Group', 'XNYS'), _stock('JNJ', 'Johnson & Johnson', 'XNYS'),
    _stock('PG', 'Procter & Gamble', 'XNYS'), _stock('MA', 'Mastercard', 'XNYS'),
    _stock('HD', 'Home Depot', 'XNYS'), _stock('BAC', 'Bank of America', 'XNYS'),
    _stock('ABBV', 'AbbVie', 'XNYS'), _stock('PFE', 'Pfizer', 'XNYS'),
    _stock('KO', 'Coca-Cola', 'XNYS'), _stock('PEP', 'PepsiCo'), _stock('COST', 'Costco'),
    _stock('CRM', 'Salesforce', 'XNYS'), _stock('ORCL', 'Oracle', 'XNYS'),
    _stock('ACN', 'Accenture', 'XNYS'), _stock('MCD', "McDonald's", 'XNYS'),
    _stock('TMO', 'Thermo Fisher Scientific', 'XNYS'), _stock('ABT', 'Abbott Laboratories', 'XNYS'),
    _stock('DHR', 'Danaher', 'XNYS'), _stock('DIS', 'Walt Disney', 'XNYS'),
    _stock('WFC', 'Wells Fargo', 'XNYS'), _stock('VZ', 'Verizon Communications', 'XNYS'),
    _stock('T', 'AT&T', 'XNYS'), _stock('CMCSA', 'Comcast'),
    _stock('NKE', 'Nike', 'XNYS'), _stock('UPS', 'United Parcel Service', 'XNYS'),
    _stock('CAT', 'Caterpillar', 'XNYS'), _stock('RTX', 'RTX', 'XNYS'),
    _stock('BA', 'Boeing', 'XNYS'), _stock('GE', 'GE Aerospace', 'XNYS'),
    _stock('HON', 'Honeywell International'), _stock('IBM', 'IBM', 'XNYS'),
    _stock('QCOM', 'Qualcomm'), _stock('TXN', 'Texas Instruments'),
    _stock('AMAT', 'Applied Materials'), _stock('MU', 'Micron Technology'),
    _stock('LRCX', 'Lam Research'), _stock('KLAC', 'KLA'), _stock('ADI', 'Analog Devices'),
    _stock('PANW', 'Palo Alto Networks'), _stock('CRWD', 'CrowdStrike'),
    _stock('FCX', 'Freeport-McMoRan', 'XNYS'), _stock('NOW', 'ServiceNow', 'XNYS'),
    _stock('UBER', 'Uber Technologies', 'XNYS'), _stock('BKNG', 'Booking Holdings'),
    _stock('ABNB', 'Airbnb'), _stock('INTU', 'Intuit'), _stock('ISRG', 'Intuitive Surgical'),
    _stock('GILD', 'Gilead Sciences'), _stock('REGN', 'Regeneron Pharmaceuticals'),
    _stock('VRTX', 'Vertex Pharmaceuticals'), _stock('AMGN', 'Amgen'),
    _stock('SYK', 'Stryker', 'XNYS'), _stock('MDT', 'Medtronic', 'XNYS'),
    _stock('BSX', 'Boston Scientific', 'XNYS'), _stock('ELV', 'Elevance Health', 'XNYS'),
    _stock('CI', 'The Cigna Group', 'XNYS'), _stock('CVS', 'CVS Health', 'XNYS'),
    _stock('HUM', 'Humana', 'XNYS'), _stock('UNP', 'Union Pacific', 'XNYS'),
    _stock('DE', 'Deere & Company', 'XNYS'), _stock('LMT', 'Lockheed Martin', 'XNYS'),
    _stock('GD', 'General Dynamics', 'XNYS'), _stock('NOC', 'Northrop Grumman', 'XNYS'),
    _stock('GS', 'Goldman Sachs', 'XNYS'), _stock('MS', 'Morgan Stanley', 'XNYS'),
    _stock('C', 'Citigroup', 'XNYS'), _stock('SCHW', 'Charles Schwab', 'XNYS'),
    _stock('BLK', 'BlackRock', 'XNYS'), _stock('SPGI', 'S&P Global', 'XNYS'),
    _stock('ICE', 'Intercontinental Exchange', 'XNYS'), _stock('CME', 'CME Group'),
    _stock('AXP', 'American Express', 'XNYS'), _stock('PYPL', 'PayPal'),
    _stock('COF', 'Capital One Financial', 'XNYS'), _stock('SO', 'Southern Company', 'XNYS'),
    _stock('DUK', 'Duke Energy', 'XNYS'), _stock('NEE', 'NextEra Energy', 'XNYS'),
    _stock('ETN', 'Eaton', 'XNYS'), _stock('LIN', 'Linde'),
    _stock('COP', 'ConocoPhillips', 'XNYS'), _stock('CVX', 'Chevron', 'XNYS'),
    _stock('SLB', 'SLB', 'XNYS'), _stock('EOG', 'EOG Resources', 'XNYS'),
)
FX_QUOTES = ('EUR', 'GBP', 'JPY', 'CNY', 'MNT', 'CAD', 'AUD', 'NZD', 'KRW', 'INR',
             'CHF', 'SGD', 'HKD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'ZAR', 'BRL')
_QUOTE_NAMES = {'XAU': 'Gold (troy ounce)', 'XAG': 'Silver (troy ounce)',
                'XPT': 'Platinum (troy ounce)', 'XPD': 'Palladium (troy ounce)',
                'BTC': 'Bitcoin'}


def fx_instrument(quote):
    """A quote code identifies a unit; it does not imply a fiat currency."""
    if not isinstance(quote, str) or re.fullmatch(r'[A-Z]{3}', quote, flags=re.ASCII) is None or quote == 'USD':
        raise KeyError(quote)
    return Instrument(f'fx-USD-{quote}', 'fx', f'US dollar / {_QUOTE_NAMES.get(quote, quote)}',
                      f'USD/{quote}', 'exchangerate_host', quote, base_currency='USD',
                      quote_currency=quote, source_url='https://exchangerate.host/')


FX = tuple(fx_instrument(quote) for quote in FX_QUOTES)
PROFILES = {
    'weekly-15': {'stocks': STOCKS[:15], 'interval_days': 7, 'period_units': 90},
    'daily-3': {'stocks': STOCKS[:3], 'interval_days': 1, 'period_units': 90},
    'monthly-100': {'stocks': STOCKS, 'interval_days': 32, 'period_units': 100},
}


class _Catalog(Mapping):
    """Enumerate reviewed defaults while resolving strict provider quote IDs."""
    def __init__(self):
        self._reviewed = {item.id: item for item in STOCKS + FX}

    def __getitem__(self, identifier):
        if not isinstance(identifier, str):
            raise KeyError(identifier)
        if identifier in self._reviewed:
            return self._reviewed[identifier]
        if re.fullmatch(r'fx-USD-[A-Z]{3}', identifier, flags=re.ASCII):
            return fx_instrument(identifier[-3:])
        raise KeyError(identifier)

    def __iter__(self):
        return iter(self._reviewed)

    def __len__(self):
        return len(self._reviewed)


CATALOG = _Catalog()
