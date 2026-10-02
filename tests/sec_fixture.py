"""Entirely synthetic SEC-shaped evidence. Never contains model-file values."""
import copy
import json

CIK = '0000000001'
STAMP = 1786000000


def evidence(cik=CIK, sic='3571', currency='USD', taxonomy='us-gaap'):
    facts = {}
    def add(tag, value, start, end, filed=None, form=None, unit=None):
        year = int(end[:4])
        fact = {'val': value, 'end': end, 'filed': filed or f'{year+1}-02-01',
                'accn': f'{cik}-{str(year+1)[-2:]}-000001', 'form': form or '10-K'}
        if start: fact['start'] = start
        facts.setdefault(tag, {'units': {}})['units'].setdefault(unit or currency, []).append(fact)
    for year in range(2020, 2026):
        total = (400 + (year-2020)*200)*1_000_000
        for tag, fraction in [('RevenueFromContractWithCustomerExcludingAssessedTax',1),('CostOfRevenue',.55),('OperatingIncomeLoss',.25),('NetIncomeLoss',.2),('ResearchAndDevelopmentExpense',.12),('InterestIncomeExpenseNet',.4),('PremiumsEarnedNet',.7)]:
            add(tag, total*fraction, f'{year}-01-01', f'{year}-12-31')
            for q, (start, end, weight) in enumerate([('01-01','03-31',.2),('04-01','06-30',.23),('07-01','09-30',.27),('10-01','12-31',.3)],1):
                add(tag, total*fraction*weight, f'{year}-{start}', f'{year}-{end}', form='10-Q' if q<4 else '10-K')
        for tag, fraction in [('NetCashProvidedByUsedInOperatingActivities',.3),('PaymentsToAcquirePropertyPlantAndEquipment',.08),('PaymentsForRepurchaseOfCommonStock',.05)]:
            for end, weight in [('03-31',.2),('06-30',.43),('09-30',.7),('12-31',1)]:
                add(tag,total*fraction*weight,f'{year}-01-01',f'{year}-{end}',form='10-K' if weight==1 else '10-Q')
        for tag, fraction in [('Assets',2),('CashAndCashEquivalentsAtCarryingValue',.5),('Liabilities',.8),('StockholdersEquity',1.2),('Deposits',.9)]:
            for end in ['03-31','06-30','09-30','12-31']: add(tag,total*fraction,None,f'{year}-{end}')
        add('EarningsPerShareDiluted', 1+(year-2020)*.2, f'{year}-01-01', f'{year}-12-31', unit=currency+'/shares')
    submissions = {'cik':int(cik), 'name':'Example Devices (synthetic)', 'tickers':['AAPL'], 'exchanges':['Nasdaq'], 'sic':sic,
                   'sicDescription':'Synthetic fixture · Electronic devices', 'fiscalYearEnd':'1231',
                   'filings':{'recent':{'accessionNumber':[f'{cik}-26-000001'], 'form':['10-K'], 'filingDate':['2026-02-01'], 'primaryDocument':['fixture-20251231.htm']}}}
    return submissions, {'cik':int(cik), 'entityName':submissions['name'], 'facts':{taxonomy:facts}}


def filing():
    return '''<html><body><xbrli:context id="product"><xbrli:entity><xbrli:segment><xbrldi:explicitMember dimension="us-gaap:ProductOrServiceAxis">example:DevicesMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><ix:nonFraction id="devices" name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" contextRef="product" unitRef="usd" scale="6">700</ix:nonFraction><p>Revenue in this synthetic company is provided only to exercise the application. These are invented financial figures for browser and unit tests and do not describe an actual issuer.</p></body></html>'''


def fake_fetch(url, ttl=3600, limit=None):
    from app.sec_client import SECError
    if url.endswith('company_tickers_exchange.json'):
        data = {'fields':['cik','name','ticker','exchange'], 'data':[[1,'Example Devices (synthetic)','AAPL','Nasdaq'],[2,'Example Bank (synthetic)','JPM','NYSE'],[3,'Example Unavailable (synthetic)','MISS','NYSE']]}
    elif '/CIK0000000001.json' in url or '/CIK0000000002.json' in url:
        cik = '0000000002' if '0000000002' in url else CIK
        submissions, facts = evidence(cik, sic='6021' if cik.endswith('2') else '3571')
        if cik.endswith('2'): submissions.update(name='Example Bank (synthetic)',tickers=['JPM'])
        data = facts if '/companyfacts/' in url else submissions
    elif url.endswith('.htm'):
        return filing().encode(), STAMP, False
    else: raise SECError('No supported annual financial statements are available for this issuer.')
    return json.dumps(copy.deepcopy(data)).encode(), STAMP, False
