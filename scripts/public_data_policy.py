"""Publication holds preserve local observations while reuse evidence is resolved.

Access without payment is not permission to redistribute third-party rows.
Reviewed 2026-10-08 against the individual FAO metadata and upstream terms.
"""
COMTRADE = 'https://comtradeplus.un.org/LicenseAgreement'
ENERGY = 'https://unstats.un.org/unsd/energystats/data/'
PUBLICATION_HOLDS = {
    'CAHD': ('World Bank ICP source-data exceptions and processing scope need reuse review.', 'https://data.fao.org/catalog/dataset/b8f254c0-40a0-4911-90e5-0208c60917dd'),
    'TCL': ('Third-party trade data requires redistribution permission or row-level clearance.', COMTRADE),
    'TCLI': ('Trade-data reuse and index-unit definitions need review.', COMTRADE),
    'RFN': ('UN Comtrade source rows require redistribution permission or row-level clearance.', COMTRADE),
    'RFB': ('UN Comtrade source rows require redistribution permission or row-level clearance.', COMTRADE),
    'RT': ('UN Comtrade source rows require redistribution permission or row-level clearance.', COMTRADE),
    'BE': ('UN energy source terms restrict reuse for profit without permission.', ENERGY),
    'GN': ('Includes raw UN energy activity data; source-rights applicability needs review.', ENERGY),
    'RP': ('Eurostat source attribution and third-party exceptions need row-level review.', 'https://ec.europa.eu/eurostat/help/copyright-notice'),
    'PD': ('UNdata attribution and source-rights provenance need review.', 'https://data.un.org/Host.aspx?Content=UNdataUse'),
    'PA': ('The discontinued archive needs an individual reuse-terms check.', 'https://www.fao.org/faostat/en/#data/PA/metadata'),
    'RA': ('The discontinued archive needs an individual reuse-terms check.', 'https://www.fao.org/faostat/en/#data/RA/metadata'),
}


def publication_hold(source, dataset):
    return PUBLICATION_HOLDS.get(dataset) if source == 'faostat' else None


def publication_allowed(source, dataset):
    return publication_hold(source, dataset) is None


def public_sql(alias=''):
    if alias not in ('', 's.'):
        raise ValueError('Unexpected SQL alias')
    # Codes are static, reviewed identifiers, never request input.
    codes = ','.join("'" + code + "'" for code in PUBLICATION_HOLDS)
    return f"({alias}source != 'faostat' OR {alias}dataset NOT IN ({codes}))"
