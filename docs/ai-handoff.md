# AI Handoff

## Current Goal

Continue BenchmarkWatcher work while preserving the active uncommitted changes.

## Current Status

- Repo has a broad dirty worktree across Flask web, mobile, bots, tests, and E2E.
- Added `AGENTS.md` with project guardrails, command map, product boundaries, and verification preferences.
- Existing work appears to involve compact table/grid UI, mobile compare/search/chart work, bot data reader updates, vocabulary checks, and E2E/test coverage.

## Files Touched By Codex Setup

- `AGENTS.md`
- `docs/ai-handoff.md`

## Existing Dirty Areas To Preserve

- `app/` Flask routes, data handling, templates, CSS, and JS components
- `__tests__/` web UI tests
- `tests/` Python tests and `tests/e2e/` Playwright specs
- `bots/` Telegram/data reader code
- `mobile/` Expo app code and tests
- `playwright.config.ts`
- `scripts/check-vocab.js`

## Tests/Checks Already Run

- None for product behavior. This setup only added instruction/handoff files.

## Current Risk

- Do not infer intent behind the existing diff without reading it first.
- Keep product language within the README boundary: benchmark/reference data only, no trading signals, no advice.
- UI copy changes should satisfy `npm run check:vocab`.

## Exact Next Step

Run `Review pass` or `Handoff` inside this repo before making product edits. Start by checking `git status` and reading the relevant changed files for the specific task.

## Commands To Run Next

- Targeted Python tests: `python -m pytest tests`
- Web UI tests: `npm test`
- Vocabulary check: `npm run check:vocab`
- E2E only when needed: `npm run test:e2e`
- Mobile tests: `cd mobile && npm test`
- Mobile typecheck: `cd mobile && npm run typecheck`

## Things Not To Change

- Do not clean generated reports, caches, `data/`, `playwright-report/`, `test-results/`, or `mobile/dist/` unless asked.
- Do not run EAS/release commands unless explicitly requested.
- Do not broaden financial/product claims beyond the disclaimer.
