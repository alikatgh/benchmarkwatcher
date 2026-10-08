"""Local FAOSTAT schema profiles; live inventory comes from the official manifest.

These profiles identify importer capabilities, not a claim that any dataset has
been downloaded. Unlisted manifest domains stay visible as requiring review.
"""

from dataclasses import dataclass


BULK_BASE = "https://bulks-faostat.fao.org/production/"


# These normalized CSVs leave units blank for specific dimensionless measures.
# Match both code and source name against the official dataset unit metadata;
# unrelated missing units remain invalid.
IC_METADATA_URL = "https://data.fao.org/catalog/dataset/416665a7-6b87-4304-a476-9e73939d7181"
IG_METADATA_URL = "https://data.fao.org/catalog/dataset/b2d69af9-55f2-4fb7-8876-389fec38eede"
BLANK_UNIT_RESOLUTIONS = {
    ("IC", "6193"): {
        "element_name": "Agriculture orientation index US$, 2015 prices",
        "unit": "index", "source_url": IC_METADATA_URL,
        "basis": "FAO metadata: share of total credit to agriculture divided by share of GDP from agriculture value added is an index.",
    },
    ("IC", "61631"): {
        "element_name": "Ratio of Value Added (Agriculture, Forestry and Fishing) US$, 2015 prices",
        "unit": "ratio", "source_url": IC_METADATA_URL,
        "basis": "FAO metadata: credit to agriculture divided by agriculture value added is a ratio.",
    },
    ("IG", "6197"): {
        "element_name": "SDG 2.a.1: Agriculture Orientation Index (AOI) for Government Expenditure",
        "unit": "ratio", "source_url": IG_METADATA_URL,
        "basis": "FAO government-expenditure metadata explicitly identifies the agriculture orientation index unit as ratio.",
    },
}


# Official CAHD Releases.csv and the normalized rows share this alphanumeric
# release code. Keep its exact spelling in metadata and series identity.
NON_NUMERIC_CODE_PROFILES = {
    ("CAHD", "Release", "7S2026"): "July 2026 (SOFI report)",
}


@dataclass(frozen=True)
class Dataset:
    code: str
    name: str
    filename_base: str
    # Dimensions are part of series identity, never discarded or averaged.
    dimensions: tuple = ()
    measure: str = "Element"

    @property
    def csv_name(self):
        return self.filename_base + "_E_All_Data_(Normalized).csv"

    @property
    def archive_url(self):
        return BULK_BASE + self.filename_base + "_E_All_Data_(Normalized).zip"

    @property
    def source_url(self):
        return "https://www.fao.org/faostat/en/#data/" + self.code

    def companion(self, name):
        return self.filename_base + "_E_" + name + ".csv"


# Added profiles were checked against official normalized CSVs on 2026-10-08.
# QCL/RL/TCL retain their original identifiers and file names.
DATASETS = {
    "QCL": Dataset("QCL", "Production: Crops and livestock products", "Production_Crops_Livestock"),
    "RL": Dataset("RL", "Land, Inputs and Sustainability: Land Use", "Inputs_LandUse"),
    "TCL": Dataset("TCL", "Trade: Crops and livestock products", "Trade_CropsLivestock"),
    "RP": Dataset("RP", "Land, Inputs and Sustainability: Pesticides Use", "Inputs_Pesticides_Use"),
    "RFN": Dataset("RFN", "Land, Inputs and Sustainability: Fertilizers by Nutrient", "Inputs_FertilizersNutrient"),
    "RFB": Dataset("RFB", "Land, Inputs and Sustainability: Fertilizers by Product", "Inputs_FertilizersProduct"),
    "RT": Dataset("RT", "Land, Inputs and Sustainability: Pesticides Trade", "Inputs_Pesticides_Trade"),
    "LC": Dataset("LC", "Land, Inputs and Sustainability: Land Cover", "Environment_LandCover"),
    "BE": Dataset("BE", "Land, Inputs and Sustainability: Bioenergy", "Environment_Bioenergy"),
    "IC": Dataset("IC", "Investment: Credit to Agriculture", "Investment_CreditAgriculture"),
    "FDI": Dataset("FDI", "Investment: Foreign Direct Investment (FDI)", "Investment_ForeignDirectInvestment"),
    "CB": Dataset("CB", "Food Balances: Commodity Balances (non-food) (2010-)", "CommodityBalances_(non-food)_(2010-)"),
    "GN": Dataset("GN", "Climate Change: Agrifood systems emissions: Emissions from Energy use in agriculture", "Emissions_Agriculture_Energy"),
    "GF": Dataset("GF", "Climate Change: Agrifood systems emissions: Emissions from Forests", "Emissions_Land_Use_Forests", ("Source",)),
    "GV": Dataset("GV", "Climate Change: Agrifood systems emissions: Emissions from Drained organic soils", "Emissions_Drained_Organic_Soils", ("Source",)),
    "CAHD": Dataset("CAHD", "Cost and Affordability of a Healthy Diet: Cost and Affordability of a Healthy Diet (CoAHD)", "Cost_Affordability_Healthy_Diet_(CoAHD)", ("Release",)),
    "TCLI": Dataset("TCLI", "Trade: Crops and livestock products indicators", "Trade_CropsLivestockIndicators", measure="Indicator"),
    "QV": Dataset("QV", "Production: Value of Agricultural Production", "Value_of_Production"),
    "FO": Dataset("FO", "Forestry: Forestry Production and Trade", "Forestry"),
    "CBH": Dataset("CBH", "Food Balances: Commodity Balances (non-food) (-2013, old methodology)", "CommodityBalances_(non-food)_(-2013_old_methodology)"),
    "FBS": Dataset("FBS", "Food Balances: Food Balances (2010-)", "FoodBalanceSheets"),
    "FBSH": Dataset("FBSH", "Food Balances: Food Balances (-2013, old methodology and population)", "FoodBalanceSheetsHistoric"),
    "SCL": Dataset("SCL", "Food Balances: Supply Utilization Accounts (2010-)", "SUA_Crops_Livestock"),
    "IG": Dataset("IG", "Investment: Government Expenditure", "Investment_GovernmentExpenditure"),
    "MK": Dataset("MK", "Macro-Economic Indicators: Macro Indicators", "Macro-Statistics_Key_Indicators"),
    "PD": Dataset("PD", "Prices: Deflators", "Deflators"),
    "PA": Dataset("PA", "Discontinued archives and data series: Producer Prices (old series)", "PricesArchive"),
    "RA": Dataset("RA", "Discontinued archives and data series: Fertilizers archive", "Inputs_FertilizersArchive"),
    "RM": Dataset("RM", "Discontinued archives and data series: Machinery", "Investment_Machinery"),
    "RY": Dataset("RY", "Discontinued archives and data series: Machinery Archive", "Investment_MachineryArchive"),
    "EI": Dataset("EI", "Climate Change: Agrifood systems emissions: Emissions intensities", "Environment_Emissions_intensities"),
    "EK": Dataset("EK", "Land, Inputs and Sustainability: Livestock Patterns", "Environment_LivestockPatterns"),
    "EM": Dataset("EM", "Climate Change: Agrifood systems emissions: Emissions indicators", "Climate_change_Emissions_indicators"),
    "EMN": Dataset("EMN", "Land, Inputs and Sustainability: Livestock Manure", "Environment_LivestockManure"),
    "ESB": Dataset("ESB", "Land, Inputs and Sustainability: Cropland Nutrient Balance", "Environment_Cropland_nutrient_budget"),
    "GCE": Dataset("GCE", "Climate Change: Agrifood systems emissions: Emissions from Crops", "Emissions_crops", ("Source",)),
    "GI": Dataset("GI", "Climate Change: Agrifood systems emissions: Emissions from Fires", "Emissions_Land_Use_Fires", ("Source",)),
    "GLE": Dataset("GLE", "Climate Change: Agrifood systems emissions: Emissions from Livestock", "Emissions_livestock", ("Source",)),
    "GT": Dataset("GT", "Climate Change: Agrifood systems emissions: Emissions totals", "Emissions_Totals", ("Source",)),
    "GPP": Dataset("GPP", "Climate Change: Agrifood systems emissions: Emissions from pre and post agricultural production", "Emissions_Pre_Post_Production"),
}


# Reasons identify concrete unsupported structures or review work. They are
# shown alongside newly discovered domains rather than omitted from coverage.
DOMAIN_LIMITATIONS = {
    "TCLI": ("unsupported_units", "The official archive has blank units for ratio/index indicators and decimal indicator code 509.02. The catalog's generic Percent (%) unit does not establish their individual units; exact indicator profiles and UNSD/Eurostat redistribution exceptions require review."),
    "QI": ("unsupported_units", "Production-index rows have blank source units; an explicit index-unit profile is required without inventing units."),
    "TI": ("schema_review_required", "Trade-index source units and series identity need a reviewed index profile."),
    "SUA": ("unsupported_dimensions", "Food-group and nutrient-indicator dimensions require a separate schema profile."),
    "GFDI": ("unsupported_dimensions", "Food-value, industry and primary-factor dimensions require a separate schema profile."),
    "OEA": ("unsupported_dimensions", "Employment source, indicator and sex dimensions require explicit identity and provider-term review."),
    "OER": ("unsupported_dimensions", "Rural employment source, indicator and sex dimensions require explicit identity and provider-term review."),
    "FA": ("unsupported_dimensions", "Recipient-country fields need an explicit entity profile and WFP provider-term review."),
    "AE": ("unsupported_dimensions", "Indicator, cost-category and institution dimensions need a separate schema profile."),
    "AF": ("unsupported_dimensions", "Indicator, degree, sex and institution dimensions need a separate schema profile."),
    "CP": ("unsupported_periods", "Monthly price-index periods and provider terms need review."),
    "ET": ("unsupported_periods", "Monthly and seasonal temperature periods need explicit period identity."),
    "EA": ("unsupported_dimensions", "Donor/recipient development flows need explicit entity and purpose dimensions; OECD reuse terms need review."),
    "TM": ("unsupported_dimensions", "Reporter/partner trade matrix needs two country dimensions and exceeds the default archive/row caps."),
    "RFM": ("unsupported_dimensions", "Reporter/partner fertilizer trade matrix needs two country dimensions."),
    "FT": ("unsupported_dimensions", "Forestry trade flows need reporter/partner country dimensions."),
    "FOP": ("forecast_review_required", "Capacity survey includes future years without a forecast flag; planned and observed capacity need separation."),
    "CS": ("forecast_review_required", "Metadata describes extrapolated values; historical estimates and forecasts need explicit separation and provider-term review."),
    "FDIQ": ("unsupported_dimensions", "Dietary survey, population, sex and age breakdowns require a survey schema."),
    "HCES": ("unsupported_dimensions", "Household survey breakdowns require a survey schema."),
    "HS": ("unsupported_dimensions", "Household, sex, area and socioeconomic breakdowns require explicit dimensions."),
    "MDDW": ("unsupported_dimensions", "Dietary diversity survey/population dimensions require a survey schema."),
    "RLIS": ("unsupported_dimensions", "Rural livelihood survey and population breakdowns require explicit dimensions."),
    "SDGB": ("unsupported_dimensions", "SDG age, sex, product and other breakdowns require explicit dimensions and indicator-specific terms review."),
    "SXS": ("unsupported_dimensions", "Sex-disaggregated indicators require explicit dimensions and indicator-specific provider-term review."),
    "WCAD": ("unsupported_dimensions", "Census rounds, land-size, tenure, age and sex breakdowns require explicit dimensions."),
    "FS": ("unsupported_periods", "Food-security series include multi-year reference periods needing an explicit period profile."),
    "PP": ("unsupported_periods", "Producer-price annual and monthly rows need explicit period identity."),
    "PE": ("unsupported_periods", "Exchange-rate annual and monthly rows need explicit period identity and provider-term review."),
    "OA": ("forecast_review_required", "Population observations and projections need source-specific separation; years alone do not distinguish them."),
}
