# BenchmarkWatcher Data Engineering Specifications

All identified sources are free, public, and reputable. For professional use, these sources provide the most "legal-to-display" paths without high-cost licensing.

| Commodity | Data Source | Update Frequency | Format | Notes (Delays/Holidays) |
| :--- | :--- | :--- | :--- | :--- |
| **Gold** | [FRED (Series GOLDPMGBD228NLBM)](https://fred.stlouisfed.org/series/GOLDPMGBD228NLBM) | Daily (PM Fix) | JSON / CSV | 24h delay on FRED. Follows UK Bank Holidays. |
| **Silver** | [FRED (Series SLVPRUSD)](https://fred.stlouisfed.org/series/SLVPRUSD) | Daily | JSON / CSV | 24h delay. Follows UK Bank Holidays. |
| **Brent Crude Oil** | [EIA Open Data (Series PET.RBRTE.D)](https://www.eia.gov/opendata/) | Daily | JSON | Updated by 1:00 PM ET. No data on US Federal Holidays. |
| **Natural Gas** | [EIA Open Data (Series NG.RNGC1.D)](https://www.eia.gov/opendata/) | Daily | JSON | Henry Hub Spot Price. No data on US Federal Holidays. |
| **Copper** | [World Bank Pink Sheet](https://www.worldbank.org/en/research/commodity-markets) | Monthly (Official) | CSV / JSON | Daily data is typically proprietary; monthly is the standard free reference. |
| **Iron Ore** | [FRED (Series PIOREAUUSDM)](https://fred.stlouisfed.org/series/PIOREAUUSDM) | Monthly (Official) | JSON / CSV | Based on 62% fe CFR China. Updated ~3rd week of the month. |

## Technical Implementation Notes

### 1. API Access
- **EIA**: Requires a free API Key (V2). Returns nested JSON.
- **FRED**: Requires a free API Key. Supports `file_type=json` or `file_type=csv` parameters.
- **World Bank**: Uses a RESTful API (e.g., `indicators/PALLFNFGRP`) but CSV downloads are more reliable for the "Pink Sheet" benchmarks.

### 2. Timezones & Delays
- All data is **End-of-Day (EOD)**.
- Sources provide data after the close of the respective market (London for Gold/Silver/Brent, NY for Gas).
- Expect a natural 12-24 hour delay for "free" public aggregation.

### 3. Holiday Logic
- Systems should check for "null" values on UK/US bank holidays rather than assuming data is missing or broken.
