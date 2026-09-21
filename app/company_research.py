"""Versioned company facts and deterministic research calculations.

The first mapped issuer is Samsung Electronics. All source amounts below are
KRW trillion, except the quoted balance sheet which is converted from billion.
No workbook formulas or AI-produced arithmetic are executed.
"""
import copy
import hashlib
import json
import re
from decimal import Decimal, InvalidOperation

SOURCE_ROOT = 'https://images.samsung.com/is/content/samsung/assets/global/ir/docs/'
SOURCES = [
    {'id': 'q2', 'title': 'Samsung Electronics 2Q 2026 earnings presentation',
     'url': SOURCE_ROOT + '2026_2Q_conference_eng.pdf',
     'sha256': 'e90b8e4829403339206fa77821aeadd71e39a611f3830a4cbcd349321de9e0cf'},
    {'id': 'fy', 'title': 'Samsung Electronics 4Q 2025 earnings presentation',
     'url': SOURCE_ROOT + '2025_4Q_conference_eng.pdf',
     'sha256': '3d6e2e12d3a28376ad93833b01429d3bb1bd306eadb866c890f463ec116b0325'},
]
# Columns are 2Q25, 1Q26, 2Q26. Each table is from the same presentation.
EARNINGS = [
    ('Revenue', ['74.6', '133.9', '171.5']),
    ('Gross earnings', ['25.5', '81.9', '119.3']),
    ('Operating earnings', ['4.7', '57.2', '89.5']),
    ('Net earnings attributable to owners', ['4.9', '47.1', '71.3']),
    ('Research and development', ['9.0', '11.3', '16.0']),
]
SEGMENTS = [
    ('DS — Semiconductors', '27.9', '127.5', '0.4', '89.2'),
    ('DX — Devices', '43.6', '48.0', '3.3', '-0.8'),
    ('SDC — Displays', '6.4', '7.5', '0.5', '0.7'),
    ('Harman — Automotive and audio', '3.8', '4.6', '0.5', '0.4'),
]
BALANCE = [
    ('Cash and short-term financial assets', ['100728.2', '147378.1', '189999.0']),
    ('Debt', ['14029.7', '28138.8', '22408.7']),
    ('Inventories', ['51037.4', '58278.4', '71389.1']),
    ('Receivables', ['43550.5', '82285.0', '96409.0']),
    ('Assets', ['504875.2', '633339.6', '759480.5']),
    ('Liabilities', ['105313.2', '146703.6', '180170.8']),
    ('Equity including non-controlling interests', ['399562.0', '486636.0', '579309.7']),
]
CASH_FLOW = [
    ('Operating cash flow', ['17.31', '40.27', '105.08']),
    ('Purchases of property, plant and equipment', ['13.04', '17.13', '14.11']),
]


def number(value, label, low, high):
    try:
        if isinstance(value, bool) or len(str(value)) > 40:
            raise InvalidOperation
        result = Decimal(str(value))
        if not result.is_finite() or not Decimal(str(low)) <= result <= Decimal(str(high)):
            raise InvalidOperation
        return result
    except (InvalidOperation, ValueError):
        raise ValueError(f'{label} must be a finite number between {low} and {high}.') from None


def rounded(value):
    return float(value.quantize(Decimal('.0001')))


def resolve_company(question):
    """A small explicit entity catalog, never a guessed company match."""
    text = question.strip().casefold()
    if re.fullmatch(r'(?:(?:analy[sz]e|research)\s+)?(?:samsung(?: electronics)?|005930(?:\.ks)?|005935(?:\.ks)?)[.!?]?', text):
        return 'samsung-electronics'
    raise ValueError('Start with Samsung Electronics or 005930. Other companies are not mapped yet.')


def _table(rows, page, divisor=1):
    return [{'label': label, 'values': [rounded(Decimal(v) / divisor) for v in values],
             'source': SOURCES[0]['url'] + f'#page={page}', 'page': page}
            for label, values in rows]


def build_report():
    result = {
        'kind': 'company_report', 'company': 'Samsung Electronics', 'ticker': 'KRX 005930 / 005935',
        'company_id': 'samsung-electronics', 'period': '2Q 2026', 'period_end': '2026-06-30',
        'source_checked': '2026-09-21', 'unit': 'KRW trillion', 'sources': copy.deepcopy(SOURCES),
        'basis': 'Reported consolidated K-IFRS figures from earnings presentations, transcribed and checked on September 21, 2026. The presentations precede external review/audit and may be revised. This is a dated source snapshot, not a live feed.',
        'periods': ['2Q 2025', '1Q 2026', '2Q 2026'],
        'balance_dates': ['June 30, 2025', 'March 31, 2026', 'June 30, 2026'],
        'earnings': _table(EARNINGS, 12), 'balance': _table(BALANCE, 14, Decimal(1000)),
        'cash_flow': _table(CASH_FLOW, 15), 'segments': [],
        'business': 'Samsung Electronics combines semiconductors, consumer devices, displays, and automotive/audio systems. Memory is part of DS; mobile and networks are part of DX. These nested businesses must not be added twice.',
        'risks': [
            'Memory exposure: changes in selling prices, product mix, or volumes can materially change earnings. The scenario isolates price; it does not estimate demand.',
            'Cash quality: compare operating cash flow with receivables, inventories, and equipment spending. A strong quarter does not establish a recurring cash level.',
            'Group complexity: segment sales include internal transactions. Segment totals and consolidated revenue are not interchangeable.',
        ],
        'gaps': ['No live stock quote, consensus estimates, or peer valuation feed is connected.',
                 'No separate memory operating margin is disclosed in this source; DS also contains foundry and System LSI.',
                 'No automatic filing refresh yet. Saved reports retain the source snapshot they used.'],
    }
    for name, old_sales, sales, old_op, op in SEGMENTS:
        result['segments'].append({'name': name, 'previous_sales': float(old_sales),
            'sales': float(sales), 'previous_earnings': float(old_op), 'earnings': float(op),
            'margin': rounded(Decimal(op) / Decimal(sales) * 100),
            'earnings_change': rounded(Decimal(op) - Decimal(old_op))})
    result['derived'] = {
        'revenue_yoy': rounded((Decimal('171.5') / Decimal('74.6') - 1) * 100),
        'operating_margin': rounded(Decimal('89.5') / Decimal('171.5') * 100),
        'net_cash': rounded((Decimal('189999.0') - Decimal('22408.7')) / 1000),
        'cash_after_ppe': rounded(Decimal('105.08') - Decimal('14.11')),
        'ds_earnings_change': rounded(Decimal('89.2') - Decimal('.4')),
        'total_earnings_change': rounded(Decimal('89.5') - Decimal('4.7')),
    }
    result['valuation_basis'] = {'period': 'FY 2025', 'revenue': 333.6, 'parent_earnings': 44.3,
                                 'source': SOURCES[1]['url'] + '#page=6'}
    result['memory_sales'] = {'value': 120.8, 'source': SOURCES[0]['url'] + '#page=13'}
    result['calculation_version'] = 1
    result['version'] = hashlib.sha256(json.dumps({k: v for k, v in result.items() if k != 'version'}, sort_keys=True).encode()).hexdigest()
    return result


def scenario(report, price_change, flow_through):
    """Counterfactual at the saved reporting period, not future guidance."""
    change = number(price_change, 'Memory price change (%)', -100, 100)
    flow = number(flow_through, 'Incremental earnings flow-through (%)', 0, 100)
    base_sales = Decimal(str(report['earnings'][0]['values'][-1]))
    base_op = Decimal(str(report['earnings'][2]['values'][-1]))
    memory_sales = Decimal(str(report['memory_sales']['value']))
    delta_sales = memory_sales * change / 100
    delta_op = delta_sales * flow / 100
    sales, op = base_sales + delta_sales, base_op + delta_op
    return {'price_change': float(change), 'flow_through': float(flow),
            'base_memory_sales': float(memory_sales), 'base_sales': float(base_sales),
            'base_earnings': float(base_op), 'sales_change': rounded(delta_sales),
            'earnings_change': rounded(delta_op), 'sales': rounded(sales), 'earnings': rounded(op),
            'margin': rounded(op / sales * 100) if sales > 0 else None,
            'source': report['memory_sales']['source'],
            'assumptions': 'Sensitivity applied to 2Q 2026. Memory volume, mix, FX, other businesses, and intersegment eliminations are held fixed. Memory sales include internal transactions, so this is an illustrative group bridge. Flow-through is your assumption, not a disclosed memory margin. No tax, cash-flow, or share-price effect is inferred.'}


def valuation(report, market_cap, as_of):
    cap = number(market_cap, 'Combined equity market capitalization (KRW trillion)', '.0001', 100000)
    from datetime import date
    try:
        parsed = date.fromisoformat(as_of)
        if parsed > date.today() or parsed < date(2000, 1, 1):
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError('Enter the market capitalization date, from 2000 through today.') from None
    basis = report['valuation_basis']
    return {'market_cap': float(cap), 'as_of': as_of,
            'price_sales': rounded(cap / Decimal(str(basis['revenue']))),
            'price_earnings': rounded(cap / Decimal(str(basis['parent_earnings']))),
            'basis': 'User-supplied combined common and preferred equity value divided by FY 2025 revenue / earnings attributable to owners. Historical annual multiples, not trailing-twelve-month multiples or a fair-value estimate.'}
