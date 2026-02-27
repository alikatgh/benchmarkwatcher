# Data Fetching & Maintenance Guide

Step-by-step guide for fetching commodity data, keeping it up to date, and troubleshooting common issues.

---

## 1. Prerequisites

### API Keys (all free)

| Service | Env Variable | Registration |
|---------|-------------|--------------|
| FRED (Federal Reserve) | `FRED_API_KEY` | https://fred.stlouisfed.org/docs/api/api_key.html |
| EIA (Energy Information) | `EIA_API_KEY` | https://www.eia.gov/opendata/register.php |
| USDA NASS (Agriculture) | `USDA_API_KEY` | https://quickstats.nass.usda.gov/api |

Yahoo Finance and FreeGoldAPI do not require API keys.

### Setup

```bash
# 1. Copy env template and fill in your keys
cp .env.example .env

# 2. Install Python dependencies
pip install -r requirements.txt
```

---

## 2. How Data Fetching Works

### Architecture Overview

```
scripts/commodities.json          # Commodity definitions (what to fetch)
        |
scripts/fetch_daily_data.py       # Orchestrator (loops through all commodities)
        |
scripts/fetchers/                 # Modular fetchers by source
    ├── fred.py                   #   FRED API (natural gas, metals, agriculture)
    ├── eia.py                    #   EIA API (oil, gasoline, diesel, propane)
    ├── freegold.py               #   FreeGoldAPI (gold prices)
    ├── yahoo.py                  #   Yahoo Finance (silver, platinum, etc.)
    ├── usda.py                   #   USDA NASS (US agricultural commodities)
    ├── worldbank.py              #   World Bank (global indices, misc.)
    └── _shared.py                #   Shared utilities (HTTP, merge, metrics)
        |
data/*.json                       # Output: one JSON file per commodity
```

### Fetcher Registry

Each commodity in `scripts/commodities.json` has a `source_type` that maps to a fetcher:

| source_type | Fetcher | Commodities |
|-------------|---------|-------------|
| `FRED` | `fetch_fred_series` | Natural gas, copper, aluminum, agricultural commodities |
| `EIA` | `fetch_eia_v2` | Brent/WTI oil, gasoline, diesel, heating oil, jet fuel, propane |
| `FREEGOLD` | `fetch_freegoldapi` | Gold |
| `YAHOO` | `fetch_yahoo_finance` | Silver, platinum, iron ore, coal, rubber, coffee, etc. |
| `USDA` | `fetch_usda_nass` | US wheat, soybeans, rice, cotton, cattle, hogs, milk, etc. |
| `WORLDBANK` | `fetch_worldbank_commodity` | Commodity indices, cocoa, tea, fish, timber, etc. |

---

## 3. Running a Data Fetch

### Full Fetch (all commodities)

```bash
python3 scripts/fetch_daily_data.py
```

This will:
1. Load commodity configs from `scripts/commodities.json`
2. For each commodity: fetch new data, merge with existing history, compute metrics
3. Save updated JSON files to `data/`
4. Print a summary of successes and failures

### What Happens Per Commodity

1. **Load existing data** from `data/{commodity_id}.json`
2. **Fetch new observations** from the source API
3. **Merge history** — new data overwrites existing entries for the same date, deduplicates by date, sorts chronologically
4. **Trim to 1000 observations** (keeps the most recent)
5. **Compute metrics** — observation-based statistics (1-obs change, 30-obs change, 365-obs change, direction)
6. **Atomic save** — writes to a temp file then renames to prevent corruption

---

## 4. Data File Format

Each `data/{id}.json` file has this structure:

```json
{
  "id": "brent_oil",
  "name": "Brent Crude Oil",
  "category": "energy",
  "price": 74.25,
  "currency": "USD",
  "unit": "barrel",
  "date": "2025-05-15",
  "source_name": "EIA",
  "source_url": "https://www.eia.gov/petroleum/gasdiesel/",
  "source_type": "EIA",
  "source_class": "official_benchmark",
  "simulated": false,
  "metrics": {
    "latest_price": 74.25,
    "observations": 500,
    "abs_change_1_obs": -0.35,
    "pct_change_1_obs": -0.47,
    "pct_change_30_obs": 2.15,
    "pct_change_365_obs": -8.32,
    "direction_30_obs": "up"
  },
  "derived": {
    "descriptive_stats": { "..." }
  },
  "history": [
    { "date": "2023-01-03", "price": 85.91 },
    { "date": "2023-01-04", "price": 84.12 }
  ],
  "updated_at": "2025-05-15T14:30:00"
}
```

---

## 5. Adding a New Commodity

1. **Add an entry to `scripts/commodities.json`:**

```json
{
  "id": "palladium",
  "name": "Palladium",
  "category": "metals",
  "unit": "troy ounce",
  "source_type": "YAHOO",
  "api_config": {
    "symbol": "PA=F",
    "source_info_url": "https://finance.yahoo.com/quote/PA=F/"
  }
}
```

2. **Run the fetcher:**

```bash
python3 scripts/fetch_daily_data.py
```

3. **Verify** the new file exists at `data/palladium.json`.

The web and mobile apps will automatically pick up the new commodity — no code changes needed.

---

## 6. Scheduling Automated Fetches

### Using cron (Linux/macOS)

```bash
# Edit crontab
crontab -e

# Run daily at 6 PM UTC (after most markets close)
0 18 * * * cd /path/to/benchmarkwatcher && /path/to/venv/bin/python3 scripts/fetch_daily_data.py >> /var/log/benchmarkwatcher-fetch.log 2>&1
```

### Using systemd timer (Linux)

Create `/etc/systemd/system/benchmarkwatcher-fetch.timer`:
```ini
[Unit]
Description=BenchmarkWatcher daily data fetch

[Timer]
OnCalendar=*-*-* 18:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

---

## 7. How the Web & Mobile Apps Serve Data

### Backend (Flask)

The Flask app reads JSON files from `data/` and serves them via API endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/commodities` | List all commodities (supports `?category=`, `?range=`, `?sort=`, `?order=`, `?since=`, `?include_history=`) |
| `GET /api/commodity/{id}` | Single commodity detail with full history |
| `GET /internal/api/commodities` | Bot-only endpoint (requires `X-Internal-Key` header) |

**`since` parameter**: When provided (format `YYYY-MM-DD`), only returns commodities with dates newer than the given value. Used by the mobile app for incremental/partial refreshes.

**`include_history` parameter**: Controls whether each commodity includes its `history` array in list responses. Defaults to `false` to reduce response size. Set `include_history=1` when list endpoints need sparkline/history data.

### Starting the backend for development

```bash
# Activate virtual environment
source venv/bin/activate

# Run Flask on all interfaces (required for mobile device access)
python run.py
# Starts on http://0.0.0.0:5002
```

The backend MUST bind to `0.0.0.0` (not `127.0.0.1`) for physical mobile devices on the same LAN to connect.

### Mobile App Data Flow

```
useCommodities hook
  → fetchCommodities() (api/commodities.ts)
    → apiClient() (api/client.ts)
      → HTTP GET http://{host}:5002/api/commodities?category=&sort=&order=&range=
```

**Host resolution (development):**
- iOS Simulator: `localhost`
- Android Emulator: `10.0.2.2` (maps to host machine)
- Physical device: auto-detected from Expo's `hostUri`
- Production: `EXPO_PUBLIC_API_URL` environment variable

**Sync behavior:**
- Initial load: full fetch of all commodities
- Background sync (every 30s when enabled): incremental fetch using `since` parameter
- App resume: incremental fetch if sync enabled
- Pull-to-refresh: incremental fetch
- Force sync (Settings): full refetch

---

## 8. Troubleshooting

### Fetch Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `No data fetched for {name}` | API key missing or invalid | Check `.env` has correct keys |
| `HTTP 403` | Rate limited or key expired | Wait and retry, or regenerate key |
| `Retry 1/3 in 1.5s` | Temporary network issue | Usually self-resolves with retries |
| All USDA commodities fail | USDA API down (common on weekends) | Retry on next business day |

### Mobile Network Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| `TypeError: Network request failed` | Backend not running or not reachable | Start backend with `python run.py` |
| Same error on physical device | Backend bound to localhost only | Ensure `run.py` uses `host="0.0.0.0"` |
| Same error on Android emulator | Wrong host address | Should auto-detect as `10.0.2.2` |
| Infinite retries in logs | Backend crashed or port blocked | Check backend logs, firewall settings |

### Data Quality

- **Stale data**: Some sources (World Bank, USDA) update monthly, not daily. This is expected.
- **Missing dates**: Weekends/holidays have no market data. The app uses observation-based metrics, not calendar-based.
- **Duplicate entries**: `merge_history` deduplicates by date automatically.
- **Corrupt JSON**: `save_atomic` uses temp-file-then-rename to prevent corruption. If a file is corrupt, delete it and re-fetch.

---

## 9. Maintenance Checklist

### Daily (automated)
- [ ] Data fetch runs successfully (check logs)
- [ ] No API key expirations

### Weekly
- [ ] Spot-check a few `data/*.json` files for reasonable prices
- [ ] Review fetch logs for recurring failures

### Monthly
- [ ] Verify all API keys are still valid
- [ ] Check if any data sources have changed their API (especially Yahoo Finance)
- [ ] Review `scripts/commodities.json` for any commodities to add/remove

### After Deployment
- [ ] Verify `data/` directory exists and is writable
- [ ] Confirm `.env` has all required API keys
- [ ] Run one manual fetch to populate initial data
- [ ] Check Flask is accessible from expected clients
