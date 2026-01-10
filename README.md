# BenchmarkWatcher

**A dashboard for monitoring publicly available commodity benchmark prices.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10+-green.svg)
![Flask](https://img.shields.io/badge/flask-3.0-lightgrey.svg)

---

## What This Is

BenchmarkWatcher is a monitoring tool that displays end-of-day benchmark prices for commodities like gold, silver, oil, and natural gas.

**This project is intended for:**
- Viewing historical benchmark price trends
- Tracking daily price changes
- Educational and informational purposes

**This project is NOT:**
- A trading platform
- A source of real-time market data
- Investment or financial advice
- A signal generator or trading tool

---

## Design Philosophy

BenchmarkWatcher is intentionally simple.

It prioritizes:
- **Clarity over complexity** — No hidden logic, no black boxes
- **Reference data over live feeds** — End-of-day benchmarks, not exchange prices
- **Monitoring over prediction** — Historical context, not trading signals

If you are looking for real-time prices, trading tools, or technical indicators, this project is not a fit.

---

## Data Sources

All data comes from freely accessible public sources:

| Category | Commodity | Source | Update Frequency |
|----------|-----------|--------|------------------|
| **Energy** | Brent Crude Oil | [EIA](https://www.eia.gov/opendata/) | Daily |
| **Energy** | WTI Crude Oil | [EIA](https://www.eia.gov/opendata/) | Daily |
| **Energy** | Natural Gas (Henry Hub) | [FRED](https://fred.stlouisfed.org/series/DHHNGSP) | Daily |
| **Energy** | Heating Oil, Gasoline, Jet Fuel, Propane | [EIA](https://www.eia.gov/opendata/) | Daily |
| **Precious** | Gold | [FreeGoldAPI](https://freegoldapi.com) (World Bank/Yahoo) | Daily |
| **Precious** | Silver, Platinum | [Yahoo Finance](https://finance.yahoo.com) (COMEX/NYMEX Futures) | Daily |
| **Metal** | Copper, Iron Ore, Aluminum, Zinc, Nickel, Lead, Tin | [FRED](https://fred.stlouisfed.org) (World Bank/IMF) | Monthly |
| **Agricultural** | Wheat, Corn, Soybeans, Rice, Sugar, Coffee, Cocoa, Cotton, Rubber, Palm Oil, Beef, Chicken | [FRED](https://fred.stlouisfed.org) (World Bank/IMF) | Monthly |

**Important:** This application displays benchmark/reference prices only. It does not show real-time exchange prices, intraday data, or proprietary trading data.

---

## Operational Notes

* Data availability depends entirely on third-party public sources.
* Some series update daily, others monthly or irregularly.
* Missing or delayed data is expected behavior and not considered a defect.
* Historical values may be revised by original publishers without notice.

---

## Disclaimer

This project is provided for informational and educational purposes only.

BenchmarkWatcher displays historical commodity price data obtained from publicly accessible third-party sources. The data presented may include both officially published benchmark series and publicly available market-derived reference prices, depending on availability.

In addition to raw historical prices, the application computes descriptive, backward-looking summary statistics (such as absolute and percentage changes over fixed historical observation windows). These calculations are mechanical summaries of past data only and do not constitute forecasts, predictions, trading signals, recommendations, or investment advice.

Derived values are calculated over fixed numbers of historical observations and may not correspond to exact calendar periods, particularly where source data is published at different frequencies (daily, monthly, or irregular).

All data is provided "as is." Data may be delayed, incomplete, revised retroactively by original publishers, or unavailable at times. Missing or inconsistent data is expected behavior and is not considered a defect.

BenchmarkWatcher does not provide real-time market data, does not execute trades, and does not attempt to model, predict, or infer future price movements.

**No financial decisions should be made based on the information produced by this software.**

The authors and contributors disclaim all liability for any use, misuse, or interpretation of the data or derived values presented.

---



## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [FRED](https://fred.stlouisfed.org/) — Federal Reserve Economic Data
- [EIA](https://www.eia.gov/) — U.S. Energy Information Administration
- [Tailwind CSS](https://tailwindcss.com/) — Styling
- [Chart.js](https://www.chartjs.org/) — Charts
