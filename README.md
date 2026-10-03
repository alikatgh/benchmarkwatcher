# BenchmarkWatcher

Historical benchmarks, country data and company research with links to the evidence behind each number.

[Open BenchmarkWatcher](https://benchmarkwatcher.online) · [Country data](https://benchmarkwatcher.online/?dataset=countries) · [Source catalog](https://benchmarkwatcher.online/sources) · [What's new](https://benchmarkwatcher.online/changelog)

## Explore and compare

- **Commodity workspace:** search benchmarks, filter categories, sort results, choose columns, save views and keep a watchlist. Phones show compact benchmark rows rather than requiring a wide desktop table.
- **Historical charts:** inspect dates and values by hovering, tapping or using the arrow keys. Switch between line, area, step, bars and dots; choose preset or custom date windows; export data or the chart.
- **Comparisons:** select two to four benchmarks in the workspace and choose **Compare**, or open a commodity and use **Compare** beside its chart heading. Each line has a name, colour and dash pattern. Percentage change starts each series at **0%**; the workspace also offers **Index 100**. Raw **Value** comparisons require matching currency and units. Tooltips identify the series, observation date and value.
- **Visual explorer:** examine distributions, cumulative distributions, quartiles, monthly patterns, year/month heatmaps and observation coverage. Exact values remain available beside every view.
- **Country data:** switch the homepage to **Country data**, then search or filter by economy and measure. Open a history to see its chart, source periods, units and exact observations.

Comparison baselines use each series' first available observation in the selected window, so their dates can differ. Percentage change and indexed comparisons require a positive baseline. Missing observations are not filled or treated as zero. Source units and baseline dates stay visible; normalized lines do not imply equal prices.

Public dashboard views and watchlists use browser-local storage. The signed-in company workspace stores private research separately.

## Current data coverage

The public snapshot on **3 October 2026** includes:

| Dataset | Available histories | Coverage |
| --- | ---: | --- |
| Commodities and commodity indices | 93 | Energy, metals, precious metals, agriculture and indices; daily or monthly observations depending on the source |
| World Bank country data | 1,248 | 217 economies; six measures; 31,088 observations spanning 2000–2025 |
| Other global references | 8 | Selected exchange references, European consumer inflation and Malaysian administered retail fuel prices |

The six country measures are population, GDP in constant 2015 US dollars, GDP per capita, consumer inflation, agriculture/forestry/fishing share, and industry including construction share. Coverage varies by measure and year. Estimates and missing periods retain their source meaning.

**1,248 histories are country/indicator combinations from the World Bank, not 1,248 different APIs or publishers.** The source catalog separately records 31 publishers and their access and integration status. The newer global-source readers cover the Bank of Canada, European Central Bank, Eurostat, World Bank and Malaysia Ministry of Finance. Catalogued sources without a reader are labelled accordingly.

Commodity references also use FRED, EIA, USDA NASS and public Yahoo Finance references where available. Every history identifies its provider, units and observation cadence. Public pages read cached data; opening a page does not trigger an upstream download. Scheduled readers use bounded request budgets.

See [global source coverage](docs/GLOBAL_SOURCES.md) and the [data fetching guide](docs/DATA_FETCHING_GUIDE.md) for definitions, attribution, access conditions and update commands. Free access does not remove publisher-specific reuse terms or rate limits.

## Company research

The signed-in **Company research** workspace resolves company names or tickers to public SEC disclosures, builds historical financial statements, and links calculations and saved questions to filing evidence. Built-in metric answers need no AI key. Optional commentary uses the user's connected provider with explicit sharing consent.

Coverage depends on SEC disclosures; it does not include every global company or live share prices. Read [company research](docs/COMPANY_RESEARCH.md) for coverage, period rules and calculation methods.

## Run locally

Use **Python 3.11+** and **Node.js 20+**. From the repository root:

```sh
bash scripts/setup_local.sh
PLAYWRIGHT_PORT=5784 .venv/bin/python -m tests.e2e.server --companies
```

Open **http://127.0.0.1:5784**. This isolated preview uses synthetic benchmark and company fixtures with temporary accounts. It needs no production credentials or paid provider, and its sample data is separate from production data. The complete public dataset is not bundled with the repository.

For a normal development setup, configuration and public-data fetching, follow [local development](docs/LOCAL_DEVELOPMENT.md). Production configuration must follow [security guidance](SECURITY.md) and [API hardening](docs/API_HARDENING.md); never commit credentials, personal provider keys or private account data.

## Checks

Run the checks relevant to your change:

```sh
.venv/bin/python -m pytest tests
npm test
npm run check:vocab
npm run test:e2e
npm run test:visuals
npm run test:companies
```

Browser checks use isolated fixtures. `npm run build:css` rebuilds the Tailwind stylesheet when its inputs change. Development and test configuration details are in [local development](docs/LOCAL_DEVELOPMENT.md).

## Native apps

[`native/`](native/README.md) contains the developing Swift/SwiftUI apps for iPhone and macOS and Kotlin/Jetpack Compose app for Android. Their navigation and layouts follow each platform. These are development targets, **not published App Store or Google Play releases**.

[`mobile/`](mobile/) contains the older Expo/React Native implementation. It is separate from the new Swift and Kotlin targets. [`bots/`](bots/) contains Telegram and Discord readers for commodity data.

## Data limits and disclaimer

BenchmarkWatcher provides historical reference data and descriptive, backward-looking calculations for informational and educational use. It provides no real-time market feed, trade execution, forecasts, trading signals or financial advice.

Data may be delayed, incomplete, unavailable or revised by its publisher. Observation windows based on a fixed number of records may differ from calendar periods. Normalized comparisons describe changes from their stated baselines; they do not establish comparable price levels or causation. All data is provided as is. Do not make financial decisions based on this software. The authors and contributors disclaim liability for its use or interpretation.

## License and support

The application code is [MIT licensed](LICENSE). Upstream datasets retain their own licenses and attribution requirements.

[Support](https://benchmarkwatcher.online/support) · [Privacy](https://benchmarkwatcher.online/privacy) · [Report a public issue](https://github.com/alikatgh/benchmarkwatcher/issues)
