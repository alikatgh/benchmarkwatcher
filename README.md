# BenchmarkWatcher

**A clean, open-source dashboard for monitoring publicly available commodity benchmark prices.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10+-green.svg)
![Flask](https://img.shields.io/badge/flask-3.0-lightgrey.svg)

---

## What This Is

BenchmarkWatcher is a simple monitoring tool that displays end-of-day benchmark prices for commodities like gold, silver, oil, and natural gas.

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

All data comes from freely accessible, public sources:

| Commodity | Source | Update Frequency |
|-----------|--------|------------------|
| Gold | LBMA PM Fix via [FRED](https://fred.stlouisfed.org/series/GOLDPMGBD228NLBM) | Daily (end-of-day) |
| Silver | LBMA Silver Price via [FRED](https://fred.stlouisfed.org/series/SLVPRUSD) | Daily (end-of-day) |
| Brent Crude Oil | [EIA](https://www.eia.gov/opendata/) | Daily (end-of-day) |
| Natural Gas | [EIA](https://www.eia.gov/opendata/) | Daily (end-of-day) |
| Iron Ore | World Bank via [FRED](https://fred.stlouisfed.org/series/PIOREAUUSDM) | Monthly |

**Important:** This application displays benchmark/reference prices only. It does not show real-time exchange prices, intraday data, or proprietary trading data.

---

## Features

- 📊 **Clean Dashboard** — View all commodities at a glance
- 📈 **Historical Charts** — Interactive price trend visualization
- 🎨 **Multiple Themes** — Light, Dark, Terminal, and Financial-style options
- ⚙️ **Customizable Display** — Configure columns, date formats, and ranges
- 📱 **Responsive Design** — Works on desktop and mobile
- 🔄 **Daily Updates** — Automated data fetching script included

> **Note:** Theme names are descriptive only and are not affiliated with or endorsed by any third party.

---

## Quick Start

### Prerequisites

- Python 3.10+
- pip

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/benchmarkwatcher.git
cd benchmarkwatcher

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the development server
flask run
```

Visit `http://127.0.0.1:5000` in your browser.

### Configuration

1. Copy `.env.example` to `.env`
2. Add your API keys (optional — simulation mode works without keys):

```env
FRED_API_KEY=your_fred_api_key_here
EIA_API_KEY=your_eia_api_key_here
```

Get free API keys:
- FRED: https://fred.stlouisfed.org/docs/api/api_key.html
- EIA: https://www.eia.gov/opendata/register.php

### Fetching Data

```bash
# Activate virtual environment
source venv/bin/activate

# Run the data fetcher
python scripts/fetch_daily_data.py
```

The script will fetch latest data from APIs, or use simulation mode if no API keys are configured.

---

## Project Structure

```
benchmarkwatcher/
├── app/
│   ├── templates/          # Jinja2 HTML templates
│   │   ├── components/     # Reusable UI components
│   │   ├── base.html       # Base template with themes
│   │   ├── index.html      # Main dashboard
│   │   └── commodity.html  # Detail view
│   ├── routes.py           # Flask routes
│   └── data_handler.py     # Data loading logic
├── data/                   # JSON data files (gitignored)
├── scripts/
│   └── fetch_daily_data.py # Data fetching script
├── requirements.txt
├── run.py                  # Flask entry point
└── README.md
```

---

## Deployment

This app is designed to run on shared hosting (e.g., Namecheap) via Passenger WSGI. It can also run locally or on any standard WSGI-compatible environment.

```python
# passenger_wsgi.py
import sys
sys.path.insert(0, '/path/to/benchmarkwatcher')
from run import app as application
```

Set up a cron job to run `fetch_daily_data.py` daily.

---

## Simulation Mode

When API keys are not configured or APIs are unavailable, the data fetcher uses simulation mode to generate realistic price movements. Simulated data is clearly marked:

```json
{
  "id": "gold",
  "simulated": true,
  ...
}
```

**Note:** Simulated data is for development/demo purposes only and does not represent actual market prices.

---

## Disclaimer

> **This project is for informational and educational purposes only.**
>
> BenchmarkWatcher does not provide real-time market data, trading signals, or investment advice. The data displayed consists of publicly available benchmark prices with inherent delays.
>
> Benchmark prices may be revised by original sources and may differ from exchange-traded prices.
>
> **Do not make financial decisions based on this data.**
>
> The authors and contributors are not responsible for any losses or damages arising from the use of this software. Always consult qualified financial professionals before making investment decisions.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/improvement`)
3. Commit your changes (`git commit -am 'Add improvement'`)
4. Push to the branch (`git push origin feature/improvement`)
5. Open a Pull Request

Please ensure your contributions maintain the monitoring-only nature of this project. We do not accept contributions that add trading signals, predictions, or real-time data features.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [FRED](https://fred.stlouisfed.org/) — Federal Reserve Economic Data
- [EIA](https://www.eia.gov/) — U.S. Energy Information Administration
- [Tailwind CSS](https://tailwindcss.com/) — Styling
- [Chart.js](https://www.chartjs.org/) — Charts
