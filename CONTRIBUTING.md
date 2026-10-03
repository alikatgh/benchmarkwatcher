# Contributing to BenchmarkWatcher

Help make public reference data easier to explore and verify. Bug fixes, documentation, accessibility improvements and focused pull requests are welcome.

## Find a place to start

- Fix a confusing interaction or a reproducible bug.
- Improve a small-screen layout, keyboard journey or light/dark contrast.
- Clarify setup instructions, examples or source attribution.
- Add an official public data reader with explicit units and source periods.
- Improve the native Swift/SwiftUI or Kotlin/Jetpack Compose apps.
- Contribute translations, performance improvements or focused tests.

[Browse existing issues](https://github.com/alikatgh/benchmarkwatcher/issues) before starting. A small fix can go straight to a PR; open an issue first for a substantial feature or new source so the approach can be discussed.

## Run an isolated preview

Use Python 3.11+ and Node.js 20+. Fork and clone the repository, then create a branch:

```sh
git switch -c fix/describe-your-change
bash scripts/setup_local.sh
PLAYWRIGHT_PORT=5784 .venv/bin/python -m tests.e2e.server --companies
```

Open **http://127.0.0.1:5784**. The preview uses synthetic public-reference and company fixtures with temporary accounts. You do not need production credentials, a paid provider or private data.

See [local development](docs/LOCAL_DEVELOPMENT.md) for normal Flask configuration, data setup and the complete command reference. The public repository does not bundle the complete production dataset.

## Make a useful pull request

Keep the change focused and follow the surrounding implementation. Use the existing Flask, CSS and JavaScript patterns; native work belongs in its Swift or Kotlin target. Explain the problem and the resulting behaviour so a reviewer can understand the change without reading an earlier conversation.

Run checks that cover the behaviour you changed:

| Change | Useful checks |
| --- | --- |
| Python routes, data or calculations | `.venv/bin/python -m pytest` with the relevant test file(s) |
| JavaScript behaviour | `npm test -- --runTestsByPath` with the relevant test file(s) |
| Visible web UI | Relevant Playwright journey and screenshots at phone and desktop widths; check keyboard access |
| UI wording | `npm run check:vocab` |
| Tailwind inputs | `npm run build:css`, then inspect the rendered result |
| Native targets | Build and validate the affected target; see [`native/README.md`](native/README.md) |

`npm run test:e2e`, `npm run test:visuals` and `npm run test:companies` cover broader browser journeys using isolated fixtures. Report the exact checks you ran and any you could not run. A screenshot helps explain a visible change; remove personal information before sharing it.

Push your branch to your fork and open a PR against `main`. Include the related issue if there is one, a short explanation of the change, and validation results. The PR template provides those prompts.

## Add data responsibly

A useful source is reproducible and attributable. Include its official documentation, access conditions, reuse license, request limits, observation cadence, original periods and units. Describe revisions, gaps and any normalization. Test the reader with deterministic fixtures and bounded requests rather than relying on an upstream service during tests.

Keep catalog entries distinct from integrated readers and available histories. Do not claim a source is live until its reader, cached observations and user-facing attribution work together. Free access alone does not establish permission to redistribute data.

Read [global source coverage](docs/GLOBAL_SOURCES.md) and [data fetching](docs/DATA_FETCHING_GUIDE.md) before implementing a reader. Check [security guidance](SECURITY.md) and [API hardening](docs/API_HARDENING.md) for public endpoint changes.

## Keep the product's scope clear

BenchmarkWatcher explores historical benchmark/reference data, country indicators and public company disclosures. Summaries and comparisons describe past observations. Optional company commentary must preserve filing evidence and explicit provider-sharing consent.

Trading signals, trade execution, real-time feed claims, price predictions, forecasts and financial advice are outside the project's scope. Missing or delayed observations are expected and must not be silently turned into zeros or invented values.

Never include credentials, personal provider keys, private accounts, databases or workbooks in a commit, screenshot or issue. Report vulnerabilities through the process in [SECURITY.md](SECURITY.md), rather than publishing sensitive details in an ordinary issue.

## Ask for help

An issue with the expected behaviour, what happened, and concise reproduction steps is a useful starting point. [Open an issue](https://github.com/alikatgh/benchmarkwatcher/issues/new) and describe where you got stuck.
