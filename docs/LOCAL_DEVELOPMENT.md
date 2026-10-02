# Local development and chat verification

For the current company-first workflow, see [SEC company research](COMPANY_RESEARCH.md).
Run `npm run test:companies`, or start a synthetic preview with
`PLAYWRIGHT_PORT=5784 .venv/bin/python -m tests.e2e.server --companies`.
The workbook instructions below remain useful for legacy saved-analysis regression
checks; the example-workbook catalog is disabled in the normal product.

From the project root, with Python 3.11+ and Node.js 20+ installed:

```sh
bash scripts/setup_local.sh
npm run preview:fixture
```

The setup creates this checkout's `.venv`, installs the declared Python development
dependencies and the locked npm dependencies, and installs Playwright Chromium.
Python dependencies follow `requirements-dev.txt` and its version ranges; they
are not a complete transitive lock. Setup can be rerun in a fresh worktree.
It does not load `.env`, copy private databases or workbooks, or regenerate CSS.

Open `http://127.0.0.1:5781/workspace/register`, create a temporary account, and
continue to the workspace. The preview has a **Sample Company** workbook with
synthetic values. In AI settings use `fixture-typesafe-key` for Jev or
`fixture-deepseek-key` for DeepSeek. All provider responses are simulated; these
strings are fixture inputs, not credentials. Questions supported by the fixture:

> Show Operating Income across the available periods.

Other questions exercise the unsupported-question feedback. All preview accounts
and saved results are temporary and disappear when the server stops. Use Ctrl-C
to stop the preview. Set `PLAYWRIGHT_PORT` to choose another local port.

## Checks

```sh
npm run test:chat
.venv/bin/python -m pytest tests/test_workspace.py -q
npm test -- --runInBand __tests__/workspaceStudio.test.js
npm run build:css
```

`test:chat` starts its own fixture server on port 5782 and refuses to reuse an
existing service. It runs one browser worker across desktop and mobile profiles.
The journey uses the real registration, encrypted connection storage, provider
response parsing, workbook calculation, and saved-analysis routes. Only the
outbound provider transport is simulated, and browser requests to external
origins are blocked. It covers result navigation, refresh, scroll positioning,
intentional minimize/reopen, paired Jev/DeepSeek use, and error recovery.

This check establishes application behavior, not live provider availability.
The existing public-page E2E suite uses `playwright.config.ts`; the authenticated
journey uses `playwright.chat.config.ts`. Both run in CI. Failure traces and
screenshots are saved under `test-results/` and `playwright-report/` and uploaded
by CI. Open the chat report with `npx playwright show-report playwright-report/chat`.

## Codex actions

`.codex/environments/environment.toml` defines fresh-worktree setup and desktop
actions for the sample preview, chat regression, workspace backend tests, and CSS
build. The environment contains project-relative commands and no private state.
See the [official local environments documentation](https://learn.chatgpt.com/docs/environments/local-environment).
