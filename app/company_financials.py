"""Source-preserving historical analysis. Arithmetic is independent of AI.

Metric definitions are application code, informed by internal model examples.
No workbook files, formulas, or saved workbook values enter generated reports.
"""
import copy
import hashlib
import json
import math
import re
from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal

from app.sec_client import SECError, fetch, filing_url, issuer_data
from app.sec_inline import label, parse_filing

VERSION = 1
# id, label, section, behavior, canonical GAAP/IFRS concepts in preference order.
DEFINITIONS = [
 ('revenue', 'Revenue', 'income', 'flow', ['RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'Revenue']),
 ('cost', 'Cost of revenue', 'income', 'flow', ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfSales']),
 ('gross_profit', 'Gross profit', 'income', 'flow', ['GrossProfit']),
 ('rd', 'Research and development', 'income', 'flow', ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost']),
 ('sga', 'Selling, general and administrative', 'income', 'flow', ['SellingGeneralAndAdministrativeExpense']),
 ('operating_expenses', 'Operating expenses', 'income', 'flow', ['OperatingExpenses', 'OperatingExpense']),
 ('operating_income', 'Operating income', 'income', 'flow', ['OperatingIncomeLoss', 'ProfitLossFromOperatingActivities']),
 ('interest_expense', 'Interest expense', 'income', 'flow', ['InterestExpense', 'InterestAndDebtExpense', 'FinanceCosts']),
 ('pretax_income', 'Income before tax', 'income', 'flow', ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments', 'ProfitLossBeforeTax']),
 ('tax', 'Income tax expense', 'income', 'flow', ['IncomeTaxExpenseBenefit', 'IncomeTaxExpenseContinuingOperations']),
 ('net_income', 'Net income attributable to owners', 'income', 'flow', ['NetIncomeLoss', 'ProfitLossAttributableToOwnersOfParent']),
 ('eps', 'Diluted EPS', 'income', 'per_share', ['EarningsPerShareDiluted', 'DilutedEarningsLossPerShare']),
 ('diluted_shares', 'Weighted average diluted shares', 'income', 'shares_average', ['WeightedAverageNumberOfDilutedSharesOutstanding', 'AdjustedWeightedAverageShares']),
 ('cash', 'Cash and cash equivalents', 'balance', 'instant', ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents']),
 ('short_investments', 'Short-term investments', 'balance', 'instant', ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'OtherShortTermInvestments']),
 ('receivables', 'Receivables', 'balance', 'instant', ['AccountsReceivableNetCurrent', 'TradeAndOtherCurrentReceivables']),
 ('inventory', 'Inventories', 'balance', 'instant', ['InventoryNet', 'Inventories']),
 ('current_assets', 'Current assets', 'balance', 'instant', ['AssetsCurrent', 'CurrentAssets']),
 ('ppe', 'Property, plant and equipment', 'balance', 'instant', ['PropertyPlantAndEquipmentNet', 'PropertyPlantAndEquipment']),
 ('assets', 'Total assets', 'balance', 'instant', ['Assets']),
 ('payables', 'Accounts payable', 'balance', 'instant', ['AccountsPayableCurrent', 'TradeAndOtherCurrentPayables']),
 ('current_liabilities', 'Current liabilities', 'balance', 'instant', ['LiabilitiesCurrent', 'CurrentLiabilities']),
 ('debt_current', 'Current debt', 'balance', 'instant', ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'CurrentBorrowings']),
 ('debt_noncurrent', 'Noncurrent debt', 'balance', 'instant', ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligationsNoncurrent', 'NoncurrentBorrowings']),
 ('liabilities', 'Total liabilities', 'balance', 'instant', ['Liabilities']),
 ('equity', 'Equity attributable to owners', 'balance', 'instant', ['StockholdersEquity', 'EquityAttributableToOwnersOfParent']),
 ('operating_cash', 'Operating cash flow', 'cashflow', 'flow', ['NetCashProvidedByUsedInOperatingActivities', 'CashFlowsFromUsedInOperatingActivities']),
 ('capex', 'Capital expenditure', 'cashflow', 'flow', ['PaymentsToAcquirePropertyPlantAndEquipment', 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities']),
 ('depreciation', 'Depreciation and amortization', 'cashflow', 'flow', ['DepreciationDepletionAndAmortization', 'DepreciationDepletionAndAmortizationPropertyPlantAndEquipment', 'DepreciationAmortisationAndImpairmentExpense']),
 ('stock_comp', 'Share-based compensation', 'cashflow', 'flow', ['ShareBasedCompensation', 'SharebasedPaymentExpense']),
 ('investing_cash', 'Investing cash flow', 'cashflow', 'flow', ['NetCashProvidedByUsedInInvestingActivities', 'CashFlowsFromUsedInInvestingActivities']),
 ('financing_cash', 'Financing cash flow', 'cashflow', 'flow', ['NetCashProvidedByUsedInFinancingActivities', 'CashFlowsFromUsedInFinancingActivities']),
 ('dividends', 'Dividends paid', 'cashflow', 'flow', ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock', 'DividendsPaidClassifiedAsFinancingActivities']),
 ('buybacks', 'Share repurchases', 'cashflow', 'flow', ['PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity']),
 ('net_interest', 'Net interest income', 'banking', 'flow', ['InterestIncomeExpenseNet']),
 ('noninterest_income', 'Noninterest income', 'banking', 'flow', ['NoninterestIncome']),
 ('credit_losses', 'Provision for credit losses', 'banking', 'flow', ['ProvisionForLoanLeaseAndOtherLosses', 'ProvisionForLoanLeaseAndOtherLossesIncurred', 'CreditLossExpense']),
 ('loans', 'Loans, net', 'banking', 'instant', ['LoansAndLeasesReceivableNetReportedAmount', 'LoansAndLeasesReceivableNetOfDeferredIncomeAndAllowanceForCreditLosses']),
 ('deposits', 'Deposits', 'banking', 'instant', ['Deposits']),
 ('premiums', 'Premiums earned', 'insurance', 'flow', ['PremiumsEarnedNet', 'PremiumsEarnedNetPropertyAndCasualty', 'InsuranceRevenue']),
 ('claims', 'Policyholder benefits and claims', 'insurance', 'flow', ['PolicyholderBenefitsAndClaimsIncurredNet']),
 ('insurance_liabilities', 'Insurance contract liabilities', 'insurance', 'instant', ['LiabilityForFuturePolicyBenefitsAndUnpaidClaimsAndClaimsAdjustmentExpense', 'InsuranceContractsLiabilities']),
]
SECTIONS = {'income': 'Income statement', 'balance': 'Balance sheet', 'cashflow': 'Cash flow',
            'ratios': 'Margins and growth', 'banking': 'Banking', 'insurance': 'Insurance', 'business': 'Business breakdowns'}


def day(value):
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def finite(value):
    return type(value) in (int, float) and math.isfinite(value) and abs(value) < 1e30


def arithmetic(value):
    result = float(value)
    return result if finite(result) else None


def source(cik, fact, tag, documents):
    accession = fact.get('accn', '')
    return {'url': documents.get(accession, filing_url(cik, accession)), 'tag': tag,
            'filed': fact.get('filed', ''), 'accession': accession, 'form': fact.get('form', ''),
            'start': fact.get('start'), 'end': fact['end'], 'value': fact['val'], 'unit': fact.get('unit', '')}


def point(value, unit, start, end, sources, method='Reported', **extra):
    return {'value': value, 'unit': unit, 'start': start, 'end': end, 'sources': sources,
            'method': method, **extra}


def formula(name, operands, function):
    if any(p is None or p.get('value') is None for p in operands):
        return None
    if len({p['unit'] for p in operands}) > 1:
        return None
    try:
        value = arithmetic(function(*[Decimal(str(p['value'])) for p in operands]))
    except (ArithmeticError, ValueError):
        return None
    if value is None:
        return None
    sources = []
    for p in operands:
        for s in p['sources']:
            if s not in sources:
                sources.append(s)
    return point(value, operands[0]['unit'], operands[0]['start'], operands[0]['end'], sources, name)


def _candidates(facts, tags, currency, behavior, cik, documents):
    selected = {}
    unit = 'shares' if behavior == 'shares_average' else currency + '/shares' if behavior == 'per_share' else currency
    # Newer restatements win; semantic tag preference breaks same-filing ties.
    for priority, tag in reversed(list(enumerate(tags))):
        for taxonomy in ('us-gaap', 'ifrs-full'):
            for f in facts.get(taxonomy, {}).get(tag, {}).get('units', {}).get(unit, []):
                end, start = day(f.get('end')), day(f.get('start'))
                if not end or end > date.today() or not finite(f.get('val')) or f.get('form') not in ('10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '40-F', '40-F/A'):
                    continue
                if behavior == 'instant' and start or behavior != 'instant' and not start:
                    continue
                if not day(f.get('filed')) or not filing_url(cik, f.get('accn', '')):
                    continue
                key = (f.get('start'), f['end'])
                rank = (f['filed'], -priority, f['accn'])
                if key not in selected or rank > selected[key][0]:
                    raw = dict(f, unit=unit)
                    selected[key] = (rank, point(f['val'], unit, f.get('start'), f['end'], [source(cik, raw, taxonomy + ':' + tag, documents)]))
    return [value[1] for value in selected.values()]


def _duration(p):
    return (day(p['end']) - day(p['start'])).days + 1 if p.get('start') and day(p['start']) else 0


def period_for(end, annual_ends):
    value = day(end)
    anchors = [d for d in annual_ends if 0 <= (d - value).days <= 370]
    if anchors:
        anchor = min(anchors)
    else:
        last = max(annual_ends)
        # 52/53-week calendars move by a few days. Do not relabel a September
        # fourth quarter as next year's first quarter just because it ends later.
        this_anchor = date(value.year, last.month, min(last.day, 28) if last.month == 2 else last.day)
        year = value.year + (1 if (value - this_anchor).days > 45 else 0)
        anchor = date(year, last.month, min(last.day, 28) if last.month == 2 else last.day)
    quarter = max(1, min(4, 4 - round((anchor - value).days / 91.25)))
    return f'Q{quarter}-{anchor.year}', f'Q{quarter} {anchor.year}', anchor.year, quarter


def _series(rows, behavior, annual_ends):
    annual, quarters = {}, {}
    for p in rows:
        duration = _duration(p)
        if 330 <= duration <= 380:
            pid = f'FY{day(p["end"]).year}'
            old = annual.get(pid)
            if old is None or (p['end'], p['sources'][0]['filed']) > (old['end'], old['sources'][0]['filed']):
                annual[pid] = p
        elif 70 <= duration <= 110:
            pid, _, _, _ = period_for(p['end'], annual_ends)
            old = quarters.get(pid)
            if old is None or p['sources'][0]['filed'] > old['sources'][0]['filed']:
                quarters[pid] = p
    # Cash-flow statements are cumulative. Subtract matching year-to-date facts,
    # never EPS or weighted-average shares. Missing inputs remain missing.
    if behavior == 'flow':
        for current in rows:
            duration = _duration(current)
            if not 150 <= duration <= 380:
                continue
            pid, _, _, _ = period_for(current['end'], annual_ends)
            if pid in quarters:
                continue
            prior = [p for p in rows if p['start'] == current['start'] and
                     70 <= (day(current['end']) - day(p['end'])).days <= 110]
            if prior:
                previous = max(prior, key=lambda p: p['end'])
                derived = formula('Derived quarter: cumulative value minus previous cumulative value', [current, previous], lambda a, b: a - b)
                if derived:
                    from datetime import timedelta
                    derived['start'] = (day(previous['end']) + timedelta(days=1)).isoformat()
                    quarters[pid] = derived
    return {**annual, **quarters}


def build_company_report(cik, ticker='', fetch_documents=True):
    submissions, raw, filings, checked, stale = issuer_data(cik)
    facts = raw['facts']
    sic = int(submissions.get('sic') or 0)
    sector = 'banking' if 6000 <= sic < 6200 else 'insurance' if 6300 <= sic < 6500 else 'general'
    documents = {f['accessionNumber']: f['url'] for f in filings}
    currency_votes = Counter()
    for taxonomy in ('us-gaap', 'ifrs-full'):
        for _, _, _, behavior, tags in DEFINITIONS[:11]:
            for tag in tags:
                units = facts.get(taxonomy, {}).get(tag, {}).get('units', {})
                for unit, records in units.items():
                    if re.fullmatch('[A-Z]{3}', unit):
                        newest = max((f.get('end', '') for f in records), default='')
                        if newest >= f'{date.today().year - 3}-01-01':
                            currency_votes[unit] += 1
    currency = currency_votes.most_common(1)[0][0] if currency_votes else 'USD'
    # For financial institutions, customer-contract revenue is often just fees,
    # excluding premiums, investment income or net interest. Never call it total revenue.
    rows = {key: _candidates(facts, ['Revenues', 'RevenuesNetOfInterestExpense', 'Revenue'] if key == 'revenue' and sector != 'general' else tags, currency, behavior, cik, documents)
            for key, _, _, behavior, tags in DEFINITIONS}
    anchors = [p for key in ('revenue', 'net_income', 'operating_cash', 'net_interest', 'premiums') for p in rows[key] if 330 <= _duration(p) <= 380]
    if not anchors:
        raise SECError('This issuer has no supported annual financial statements in SEC structured data. Its filings remain available on SEC.gov.')
    annual_ends = sorted({day(p['end']) for p in anchors})
    periods = {}
    for key in ('revenue', 'net_income', 'operating_cash', 'net_interest', 'premiums'):
        for pid, p in _series(rows[key], 'flow', annual_ends).items():
            if pid.startswith('FY'):
                year = int(pid[2:]); frequency = 'annual'; caption = str(year); quarter = None
            else:
                _, caption, year, quarter = period_for(p['end'], annual_ends); frequency = 'quarterly'
            # Same fiscal period must use the same end date across all metrics.
            if pid not in periods or p['end'] > periods[pid]['end']:
                periods[pid] = {'id': pid, 'label': caption, 'frequency': frequency, 'year': year,
                                'quarter': quarter, 'end': p['end'], 'start': p['start']}
    annual_ids = sorted((p for p in periods.values() if p['frequency'] == 'annual'), key=lambda p: p['end'])[-10:]
    quarterly_ids = sorted((p for p in periods.values() if p['frequency'] == 'quarterly'), key=lambda p: p['end'])[-24:]
    periods = {p['id']: p for p in annual_ids + quarterly_ids}
    metrics = []
    for key, caption, section, behavior, tags in DEFINITIONS:
        if section in ('banking', 'insurance') and sector != section:
            continue
        values = _series(rows[key], behavior, annual_ends) if behavior != 'instant' else {}
        if behavior == 'instant':
            by_end = {p['end']: p for p in rows[key]}
            values = {pid: by_end[p['end']] for pid, p in periods.items() if p['end'] in by_end}
        values = {pid: p for pid, p in values.items() if pid in periods and p['end'] == periods[pid]['end']}
        metrics.append({'id': key, 'label': caption, 'section': section, 'behavior': behavior, 'values': values,
                        'unit': 'shares' if behavior == 'shares_average' else currency + '/share' if behavior == 'per_share' else currency})
    lookup = {m['id']: m for m in metrics}

    def add(key, caption, section, operands, func, unit=None, positive=None, fill=False):
        values = {}
        for pid in periods:
            inputs = [lookup[k]['values'].get(pid) for k in operands]
            if any(p is None for p in inputs) or len({(p['start'], p['end']) for p in inputs}) != 1:
                continue
            if positive is not None and (inputs[positive] is None or inputs[positive]['value'] <= 0):
                continue
            calculated = formula(caption + ': ' + ' / '.join(lookup[k]['label'] for k in operands) if unit == '%' else caption + ' calculation', inputs, func)
            if calculated:
                calculated['unit'] = unit or currency
                values[pid] = calculated
        if fill:
            for pid, value in values.items():
                lookup[key]['values'].setdefault(pid, value)
        else:
            item = {'id': key, 'label': caption, 'section': section, 'behavior': 'ratio' if unit == '%' else 'flow', 'unit': unit or currency, 'values': values}
            metrics.append(item); lookup[key] = item

    if sector == 'general':
        add('gross_profit', 'Gross profit', 'income', ['revenue', 'cost'], lambda a, b: a-b, fill=True)
        add('free_cash', 'Free cash flow', 'cashflow', ['operating_cash', 'capex'], lambda a, b: a-abs(b))
        lookup['free_cash']['definition'] = 'Operating cash flow minus purchases of property, plant and equipment. Other definitions may differ.'
        for key, caption, numerator in [('gross_margin', 'Gross margin', 'gross_profit'), ('operating_margin', 'Operating margin', 'operating_income'), ('net_margin', 'Net margin', 'net_income'), ('fcf_margin', 'Free cash flow margin', 'free_cash')]:
            add(key, caption, 'ratios', [numerator, 'revenue'], lambda a, b: a/b*100, '%', positive=1)
    add('cash_conversion', 'Operating cash flow / net income', 'ratios', ['operating_cash', 'net_income'], lambda a, b: a/b*100, '%', positive=1)
    # Year-over-year means the same fiscal quarter, or two annual periods.
    for base, caption in [('revenue', 'Revenue year over year'), ('net_income', 'Net income year over year')]:
        values = {}
        for pid, p in periods.items():
            prior_id = f'FY{p["year"]-1}' if p['frequency'] == 'annual' else f'Q{p["quarter"]}-{p["year"]-1}'
            a, b = lookup[base]['values'].get(pid), lookup[base]['values'].get(prior_id)
            if a and b and b['value'] > 0:
                calculated = formula('Year-over-year percentage change', [a, b], lambda x, y: (x/y-1)*100)
                if calculated:
                    calculated['unit'] = '%'; values[pid] = calculated
        metrics.append({'id': base + '_yoy', 'label': caption, 'section': 'ratios', 'behavior': 'ratio', 'unit': '%', 'values': values})
    # Rolling totals require four consecutive quarters and contiguous coverage.
    for index in range(3, len(quarterly_ids)):
        window = quarterly_ids[index-3:index+1]
        ordinals = [p['year']*4+p['quarter'] for p in window]
        if any(b-a != 1 for a, b in zip(ordinals, ordinals[1:])):
            continue
        last = window[-1]; pid = 'TTM-' + last['id']
        periods[pid] = dict(last, id=pid, label='TTM ' + last['label'], frequency='ttm', start=window[0]['start'])
        for m in metrics:
            inputs = [m['values'].get(p['id']) for p in window]
            if m['behavior'] == 'instant':
                if inputs[-1]: m['values'][pid] = copy.deepcopy(inputs[-1])
            elif m['behavior'] == 'flow' and all(inputs):
                if any(abs((day(b['start'])-day(a['end'])).days-1) > 7 for a, b in zip(inputs, inputs[1:])):
                    continue
                calculated = formula('Trailing four quarters: sum of four consecutive quarters', inputs, lambda *v: sum(v))
                if calculated:
                    calculated.update(start=window[0]['start'], end=last['end']); m['values'][pid] = calculated
    # Calculate margins from rolling numerators/denominators, never sum ratios.
    if sector == 'general':
        for key, numerator in [('gross_margin', 'gross_profit'), ('operating_margin', 'operating_income'), ('net_margin', 'net_income'), ('fcf_margin', 'free_cash')]:
            for pid, p in periods.items():
                if p['frequency'] != 'ttm': continue
                a, b = lookup[numerator]['values'].get(pid), lookup['revenue']['values'].get(pid)
                if a and b and b['value'] > 0:
                    value = formula('Rolling margin: trailing four-quarter numerator / revenue', [a, b], lambda x, y:x/y*100)
                    if value: value['unit'] = '%'; lookup[key]['values'][pid] = value

    gaps = ['Market prices, analyst estimates and future assumptions are not part of this filing-based report.']
    gaps.append('Derived quarters can use cumulative inputs from different filings. Reclassifications or restatements between those filings may affect comparability; inspect both input sources.')
    if sector != 'general':
        gaps.append('Industry-specific statement rows are used where reported. Free cash flow and industrial-company margins are not applied to this sector.')
    business, excerpts = [], []
    selected = []
    for forms in [('10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A'), ('10-Q', '10-Q/A')]:
        item = next((f for f in filings if f['form'] in forms), None)
        if item and fetch_documents: selected.append(item)
    for filing in selected:
        try:
            html, _, doc_stale = fetch(filing['url'], ttl=7*86400, limit=12*1024*1024)
            inline, paragraphs = parse_filing(html.decode('utf-8', errors='replace'))
            stale = stale or doc_stale
            excerpts.extend({'text': p, 'url': filing['url'], 'form': filing['form'], 'filed': filing['filingDate']} for p in paragraphs[:12])
            for f in inline:
                dimensions = [d for d in f['dimensions'] if d != ('srt:ConsolidationItemsAxis', 'us-gaap:OperatingSegmentsMember')]
                if f['unit'] != currency or len(dimensions) != 1 or not f['start'] or not day(f['end']): continue
                axis, member = dimensions[0]
                if not re.search(r'ProductOrService|Geograph|BusinessSegments|OperatingSegments', axis, re.I): continue
                concept = f['tag'].split(':')[-1]
                if not (concept in DEFINITIONS[0][4] or concept in ('NetSales', 'SalesToExternalCustomers')): continue
                if not (70 <= _duration(f) <= 110 or 330 <= _duration(f) <= 380): continue
                pid = f'FY{day(f["end"]).year}' if _duration(f) > 300 else period_for(f['end'], annual_ends)[0]
                if pid not in periods or f['end'] != periods[pid]['end']: continue
                contract_subset = sector != 'general' and 'RevenueFromContractWithCustomer' in concept
                basis_label = 'Revenue from customer contracts' if contract_subset else 'Revenue'
                key = axis + '|' + member + '|' + basis_label
                row = next((r for r in business if r['key'] == key), None)
                if row is None:
                    row = {'key': key, 'id': 'segment_' + hashlib.sha256(key.encode()).hexdigest()[:12],
                           'label': label(member) + (' · Customer-contract revenue' if contract_subset else ''), 'axis': label(axis), 'section': 'business', 'behavior': 'flow', 'unit': currency, 'values': {},
                           'definition': basis_label + ('. This excludes financial-institution income outside customer contracts; it is not total segment revenue.' if contract_subset else ' for this disclosed business category.')}
                    business.append(row)
                raw_fact = {'accn': filing['accessionNumber'], 'form': filing['form'], 'filed': filing['filingDate'], 'val': f['value'], 'unit': currency, 'start': f['start'], 'end': f['end']}
                s = source(cik, raw_fact, f['tag'], documents)
                if re.fullmatch(r'[A-Za-z0-9_.:-]+', f['id']): s['url'] += '#' + f['id']
                # Latest-filed value wins even when documents are loaded out of order.
                if pid not in row['values'] or filing['filingDate'] > row['values'][pid]['sources'][0]['filed']:
                    row['values'][pid] = point(f['value'], currency, f['start'], f['end'], [s])
        except (SECError, ValueError, RecursionError):
            gaps.append(f'{filing["form"]} business breakdowns could not be read. Consolidated financials remain available.')
    if not business:
        gaps.append('No supported product or geographic revenue breakdown was extracted. See the linked filings for company-specific disclosures.')
    else:
        gaps.append('Business breakdowns come from the latest annual and quarterly filings. Categories on different axes overlap and must not be added together.')
    metrics.extend(business[:40])
    missing = [m['label'] for m in metrics if not m['values']]
    active = [m for m in metrics if m['values']]
    sources = []
    for m in active:
        for p in m['values'].values():
            for s in p['sources']:
                if s['accession'] not in {x['accession'] for x in sources}:
                    sources.append({k: s[k] for k in ('accession', 'url', 'form', 'filed')})
    sources.sort(key=lambda s: s['filed'], reverse=True)
    report = {'kind': 'sec_report', 'cik': cik, 'company': submissions.get('name', raw.get('entityName', 'Company')),
              'ticker': ticker or next(iter(submissions.get('tickers', [])), ''), 'exchange': ', '.join(submissions.get('exchanges', [])),
              'industry': submissions.get('sicDescription', ''), 'sector': sector, 'currency': currency,
              'fiscal_year_end': submissions.get('fiscalYearEnd', ''), 'periods': list(periods.values()),
              'metrics': active, 'missing': missing, 'sections': SECTIONS, 'gaps': gaps,
              'checked': datetime.fromtimestamp(checked, timezone.utc).isoformat(), 'stale': stale,
              'sources': sources, 'excerpts': excerpts[:24], 'calculation_version': VERSION,
              'basis': 'Historical SEC filings. Latest available filed facts are selected for each reporting period. Derived quarters and ratios retain their input sources. Missing disclosures are never zero-filled.'}
    report['version'] = hashlib.sha256(json.dumps(report, sort_keys=True, allow_nan=False).encode()).hexdigest()
    report['summary'] = summarize(report)
    return report


def display_value(value, unit, compact=True):
    if value is None: return '—'
    if unit == '%': return f'{value:,.1f}%'
    if '/share' in unit: return f'{value:,.2f}'
    if compact:
        for size, suffix in [(1e12, 'T'), (1e9, 'B'), (1e6, 'M'), (1e3, 'K')]:
            if abs(value) >= size: return f'{value/size:,.2f}'.rstrip('0').rstrip('.') + suffix
    return f'{value:,.2f}'


def summarize(report):
    annual = sorted((p for p in report['periods'] if p['frequency'] == 'annual'), key=lambda p:p['end'])
    if not annual: return []
    latest = annual[-1]; pid = latest['id']; metrics = {m['id']:m for m in report['metrics']}
    notes = []
    for key in ('revenue', 'net_interest', 'premiums', 'operating_income', 'net_income', 'operating_cash', 'free_cash'):
        m = metrics.get(key); p = m['values'].get(pid) if m else None
        if p:
            notes.append({'text': f'{m["label"]} was {display_value(p["value"],m["unit"])} {m["unit"]} in fiscal {latest["label"]}.', 'metric': key, 'period': pid, 'sources': p['sources']})
    return notes[:6]


def calculate_company(report, metric_id, operation='series', start=None, end=None, frequency='annual'):
    metric = next((m for m in report['metrics'] if m['id'] == metric_id), None)
    if not metric or operation not in ('series', 'value', 'change'):
        raise ValueError('Choose an available metric and calculation.')
    periods = {p['id']: p for p in report['periods']}
    if operation == 'series':
        chosen = sorted((p for p in periods.values() if p['frequency'] == frequency), key=lambda p:p['end'])
    else:
        ids = [start, end] if operation == 'change' else [end]
        if any(pid not in periods for pid in ids): raise ValueError('Choose reporting periods available in this report.')
        chosen = [periods[pid] for pid in ids]
        if operation == 'change' and (start == end or chosen[0]['frequency'] != chosen[1]['frequency']):
            raise ValueError('Compare two different periods of the same frequency.')
    points = [dict(metric['values'].get(p['id'], point(None, metric['unit'], p['start'], p['end'], [], 'Unavailable')),
                   period=p['label'], period_id=p['id']) for p in chosen]
    if not any(p['value'] is not None for p in points):
        raise ValueError('This metric has no values for the selected reporting periods.')
    result = {'kind': 'sec_calculation', 'company': report['company'], 'metric': metric['label'], 'metric_id': metric_id,
              'operation': operation, 'frequency': frequency, 'unit': metric['unit'], 'points': points,
              'version': report['version'], 'basis': report['basis']}
    if operation == 'change':
        a, b = points
        if a['value'] is None or b['value'] is None:
            raise ValueError('One selected period is unavailable. Missing data cannot be treated as zero.')
        result['difference'] = arithmetic(Decimal(str(b['value'])) - Decimal(str(a['value'])))
        result['relative_change'] = arithmetic((Decimal(str(b['value'])) / Decimal(str(a['value'])) - 1)*100) if a['value'] > 0 else None
    return result
