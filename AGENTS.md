# BenchmarkWatcher Agent Notes

## Project Map

- Flask dashboard for public commodity benchmark/reference prices.
- `app/` contains the Flask web app, templates, static CSS/JS, routes, and data handling.
- `data/` contains generated or cached commodity data files.
- `scripts/` contains data fetchers, validation helpers, and project scripts.
- `tests/` contains Python tests; `tests/e2e/` contains Playwright tests.
- `__tests__/` contains Jest/jsdom tests for web UI modules.
- `mobile/` is the Expo React Native app.
- `bots/` contains Telegram and Discord bots that read commodity data.
- `docs/` contains hardening, deployment, vocabulary, release, and mobile planning notes.

## Product Boundaries

- This is not a trading platform, real-time market data source, signal generator,
  or investment advice product.
- Keep copy aligned with the README disclaimer: historical benchmark/reference
  data only, descriptive backward-looking summaries only, no predictions.
- Missing, delayed, or revised source data is expected behavior.
- Do not add proprietary feeds, intraday trading claims, forecasting language, or
  financial advice framing unless explicitly requested and reviewed.

## Commands

Python setup:

- `python3 -m venv .venv`
- `source .venv/bin/activate`
- `pip install -r requirements.txt`

Web app and CSS:

- Build CSS: `npm run build:css`

Verification:

- Python tests: `python -m pytest tests`
- Jest UI tests: `npm test`
- E2E tests: `npm run test:e2e`
- Vocabulary guard: `npm run check:vocab`
- Full JS/e2e: `npm run test:all`
- CI preflight: `npm run ci:preflight`

Mobile:

- Start Expo: `cd mobile && npm start`
- Mobile tests: `cd mobile && npm test`
- Mobile typecheck: `cd mobile && npm run typecheck`
- Mobile release preflight: `cd mobile && npm run preflight:release`

Bots:

- Install bot deps: `cd bots && pip install -r requirements.txt`
- Telegram bot: `cd bots && python telegram_bot.py`
- Discord bot: `cd bots && python discord_bot.py`

Prefer targeted tests for the touched layer. Run e2e or full preflight only for
cross-cutting UI/data/API changes or when requested.

## Current-State Caution

This repo may contain active uncommitted work across Flask app files, web UI,
mobile app, bots, tests, and Playwright specs. Always check `git status` before
editing and preserve existing user changes.

Do not clean, delete, regenerate, or reformat broad areas such as `data/`,
`playwright-report/`, `test-results/`, `mobile/dist/`, caches, virtualenvs, or
generated CSS unless the task is explicitly about those artifacts.

## High-Risk Areas

- Public API hardening: read `docs/API_HARDENING.md` and `SECURITY.md` before
  auth, rate limiting, or public endpoint changes.
- Data fetching: read `docs/DATA_FETCHING_GUIDE.md` before source/fetcher changes.
- Release work: read `docs/RELEASE_CHECKLIST.md` and `docs/DEPLOYMENT.md`.
- UI text changes should satisfy `npm run check:vocab`.
- Mobile release or EAS commands should not be run unless the user explicitly asks.
- Bot tokens live in `.env` files; never print or commit secrets.

## Working Style

- For vague requests, choose one bounded bug or UI issue and verify only that.
- Keep Flask web, mobile, and bot changes scoped unless a data contract requires
  coordination.
- Prefer adding or updating focused tests near the changed behavior.
- Report skipped broader checks clearly.
