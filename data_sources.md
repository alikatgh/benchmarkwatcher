# Data Sources Reference

This document lists all external data sources used by BenchmarkWatcher to fetch commodity price data.

> **BenchmarkWatcher aggregates and standardizes publicly available commodity benchmark data from government agencies, international institutions, and market operators — all in one place.**

---

## Overview

| Provider | Status | Commodities | Registration | Cost |
|----------|--------|-------------|--------------|------|
| EIA (U.S. Energy Information Administration) | ✅ Active | Brent, WTI, Heating Oil, Gasoline, Jet Fuel, Propane | Email only | **FREE** |
| FRED (Federal Reserve) | ✅ Active | Natural Gas, Copper, Iron Ore, Nickel, Zinc | Email only | **FREE** |
| World Bank (Pink Sheet) | 🔜 Planned | Metals, Agriculture | None | **FREE** |
| USDA | 🔜 Planned | Grains, Livestock | Email only | **FREE** |
| FAO | 🔜 Planned | Food Price Index | None | **FREE** |

**Active APIs: 2** | **Active Commodities: 11**  
**Total Monthly Cost: $0**

---

## Tier 1 — Active Sources

### EIA (U.S. Energy Information Administration)

**Official U.S. government energy statistics — Primary source for petroleum products**

| Field | Value |
|-------|-------|
| **Website** | https://www.eia.gov/opendata/ |
| **API Docs** | https://www.eia.gov/opendata/documentation.php |
| **Get API Key** | https://www.eia.gov/opendata/register.php |
| **License** | Public domain (US Government) |
| **Rate Limits** | Generous (no practical limits) |

#### Active Commodities (6)

| Commodity | Series ID | Frequency | Description |
|-----------|-----------|-----------|-------------|
| Brent Crude Oil | `PET.RBRTE.D` | Daily | Europe Brent Spot (USD/barrel) |
| WTI Crude Oil | `PET.RWTC.D` | Daily | Cushing OK Spot (USD/barrel) |
| Heating Oil | `PET.HEATING_OIL.D` | Daily | NY Harbor No. 2 (USD/gallon) |
| Gasoline | `PET.GASOLINE.D` | Daily | Gulf Coast Regular (USD/gallon) |
| Jet Fuel | `PET.JET_FUEL.D` | Daily | Gulf Coast Kerosene-Type (USD/gallon) |
| Propane | `PET.PROPANE.D` | Daily | Mont Belvieu TX (USD/gallon) |

---

### FRED (Federal Reserve Economic Data)

**World Bank commodity data via FRED mirrors**

| Field | Value |
|-------|-------|
| **Website** | https://fred.stlouisfed.org/ |
| **API Docs** | https://fred.stlouisfed.org/docs/api/fred/ |
| **Get API Key** | https://fred.stlouisfed.org/docs/api/api_key.html |
| **License** | Public domain (US Government) |
| **Rate Limits** | 120 requests/minute |

#### Active Commodities (5)

| Commodity | Series ID | Frequency | Description |
|-----------|-----------|-----------|-------------|
| Natural Gas | `DHHNGSP` | Daily | Henry Hub Spot Price (USD/MMBtu) |
| Copper | `PCOPPUSDM` | Monthly | World Bank Copper (USD/metric ton) |
| Iron Ore | `PIORECRUSDM` | Monthly | World Bank Iron Ore (USD/metric ton) |
| Nickel | `PNICKUSDM` | Monthly | World Bank Nickel (USD/metric ton) |
| Zinc | `PZINCUSDM` | Monthly | World Bank Zinc (USD/metric ton) |

---

## Tier 2 — Planned Sources

### World Bank (Pink Sheet)

**Global commodities via monthly Pink Sheet**

| Field | Value |
|-------|-------|
| **Website** | https://www.worldbank.org/en/research/commodity-markets |
| **Data Access** | Direct CSV download or FRED mirrors |
| **License** | Creative Commons (CC BY 4.0) |
| **Frequency** | Monthly |

**Covers:** Metals, Energy, Fertilizers, Agriculture, Precious Metals

---

### London Metal Exchange (LME)

**Official delayed reference prices**

| Field | Value |
|-------|-------|
| **Website** | https://www.lme.com/ |
| **Data Access** | Public reference prices (delayed) |
| **License** | Reference use with attribution |

**Covers:** Copper, Aluminum, Nickel, Zinc, Lead, Tin

⚠️ *Use clearly labeled "reference / delayed" — no intraday feeds*

---

### USDA

**U.S. Department of Agriculture**

| Field | Value |
|-------|-------|
| **Website** | https://www.usda.gov/ |
| **API** | https://quickstats.nass.usda.gov/api |
| **License** | Public domain (US Government) |

**Covers:** Grain prices, Livestock, Export benchmarks

---

### FAO (Food and Agriculture Organization)

**UN food price indices**

| Field | Value |
|-------|-------|
| **Website** | https://www.fao.org/worldfoodsituation/foodpricesindex |
| **Data Access** | Direct download |
| **License** | Open (UN) |
| **Frequency** | Monthly |

**Covers:** Food Price Index, Cereals, Oils, Dairy, Meat, Sugar

---

## Tier 3 — Future Consideration

| Source | Coverage | Notes |
|--------|----------|-------|
| **ICE Futures Europe** | Brent, Gasoil, Power | End-of-day references |
| **CME Group** | Settlement prices | Limited historical |
| **BP Statistical Review** | Energy production | Annual context |
| **IEA** | Oil, Gas, Power | Monthly summaries |
| **USGS** | Metals, Minerals | Supply/demand context |

---

## What We Do NOT Include

To maintain trust and legal clarity, BenchmarkWatcher does **not** use:

- ❌ Yahoo Finance
- ❌ TradingView
- ❌ Investing.com
- ❌ Quandl paid datasets
- ❌ Any scraped exchange UI
- ❌ Real-time trading data

---

## Setup Instructions

### 1. Get FRED API Key

1. Go to https://fred.stlouisfed.org/docs/api/api_key.html
2. Sign in or create a free account
3. Copy your API key

### 2. Get EIA API Key

1. Go to https://www.eia.gov/opendata/register.php
2. Enter your email
3. Check email for API key

### 3. Configure Environment

```env
FRED_API_KEY=your_fred_api_key
EIA_API_KEY=your_eia_api_key
```

### 4. Fetch Data

```bash
source venv/bin/activate
python3 scripts/fetch_daily_data.py
```

---

## Data Update Schedule

| Frequency | Commodities |
|-----------|-------------|
| Daily | Gold, Silver, Brent, WTI, Natural Gas |
| Monthly | Iron Ore, Copper, Aluminum |

Recommended: Run `fetch_daily_data.py` daily at 8 PM local time.

---

## Fallback Behavior

If APIs are unavailable, the script **skips the commodity** and logs an error:
- No fake/simulated data is ever generated
- Only real API data is stored
- Check your API keys and network connection if commodities are skipped

---

*Last Updated: January 2026*
