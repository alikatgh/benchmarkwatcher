# Private financial research workspace

## Production deployment — September 21, 2026

- Live at https://benchmarkwatcher.online/workspace/ on the existing Hetzner
  host `89.167.29.166` (`wallmarkets-hel` in the console; `turgen-hel` in the OS).
- Deployed application commit: `b7546fa4120443ce352b9e9307a6803efab5d7ea`, from
  `codex/jev-model-analysis`. The server checkout is detached at this release;
  do not assume `origin/main` contains it. Review: GitHub PR #1.
- App: `/home/benchmarkwatcher/app`, `benchmarkwatcher.service`, loopback port
  8001 behind the existing Caddy route. No DNS or sibling service changes.
- Private DB: `/home/benchmarkwatcher/state/accounts/workspace.sqlite3` (0600,
  parent 0700). The service's `workspace.conf` drop-in allows writes only to this
  additional account directory and sets `UMask=0077`.
- Library: `/home/benchmarkwatcher/state/model-source`, pinned to source commit
  `c5ef2e191f3689bdb8ac08aae9b80f804cef6e18`. It is outside public file paths and
  read-only under the app service sandbox. All 609 workbooks opened: 364 supported,
  245 require mappings. A serial full-library audit peaked at 99.5 MiB RSS;
  this is not a concurrency/load-test result.
- Secrets remain in the private production `.env`. Redis on loopback provides
  shared limits with the `benchmarkwatcher` key prefix. No other Redis keys were
  cleared. One trusted Caddy forwarding hop is enabled.
- `benchmarkwatcher-workspace-backup.timer` runs daily around 05:15 UTC, keeping
  seven integrity-checked SQLite snapshots in `/home/benchmarkwatcher/state/backups`.
  The initial backup passed. These are local server backups, not off-site copies.
- Rollback materials: root-only `/var/backups/benchmarkwatcher-release-20260921/`
  contains the previous commit, prior environment/service/dependency manifest,
  new workspace environment, and a separate copy of the persistent workspace
  secrets. Do not print these environment files or generate replacement keys.
- To roll back the application: preserve account DB/backups and the workspace
  environment; switch only the clean app checkout to the recorded previous
  commit as its service user, restore `production.env`, remove only the added
  `workspace.conf` drop-in, reload systemd, restart BenchmarkWatcher, and verify
  `/health`. Before re-enabling accounts, restore the saved workspace secrets;
  generating new encryption keys would make existing provider keys unreadable.
- Verification: 115 Python tests (one skipped), 241 Jest tests, vocabulary check,
  and all GitHub CI jobs including browser tests passed. Public HTTPS health,
  dashboard, commodity API/detail, register/login pages returned 200. Private
  pages redirected unauthenticated visitors; secure cookie flags were checked.
  The live registration page was inspected in Chrome. Neighboring services
  remained active. Live provider responses still need testing with a user's key.

The CI browser server now uses isolated synthetic data and opens the existing
coverage disclosure before checking its contents; production data is never used
as a test fixture.

The first increment adds private accounts, encrypted user-owned DeepSeek and
TypeSafe keys, a searchable XLSX library, deterministic calculations, and saved
analyses. The public commodity dashboard continues to work without accounts.

## What works

- Username/password registration, sign-in, logout, and one-time recovery codes.
  Recovery changes the password, rotates the recovery code, and revokes all
  previous sessions. There is no email verification or email password reset.
- Provider keys are tested before storage, encrypted with Fernet, scoped to the
  owning account, and never returned to the browser. Replacement failures retain
  the old key. Removal stops future use here, not use at the provider itself.
- Each user explicitly selects their own connected provider/model. There are no
  platform credits, environment API-key fallbacks, or automatic provider changes.
- Jev selects a metric, operation, and periods using typed Choice questions.
  Ambiguous selections require clarification. DeepSeek selects the same IDs via
  JSON. Both plans pass the same validation and Python calculation path.
- Supported operations: a single metric's series, one named period, or a change
  between two named periods of the same frequency. Relative change is unavailable
  for zero or negative starting values. Missing cached values remain unavailable.
- DeepSeek explanations are separately opted into. They are displayed as AI
  commentary beside the canonical calculation and cell evidence.
- Saved results retain source values, cell references, file SHA-256, question,
  provider/model, and returned token usage. They do not change when files update.

## Configuration

The feature is **off by default**. Enabling it without stable independent keys
fails startup deliberately. Add to the server's private environment:

```dotenv
WORKSPACE_ENABLED=1
WORKSPACE_SESSION_SECRET=<random secret of at least 32 characters>
WORKSPACE_ENCRYPTION_KEY=<Fernet key>
WORKSPACE_DB=/private/persistent/path/workspace.sqlite3
MODEL_LIBRARY_DIR=/private/read-only/path/to/workbooks
MODEL_LIBRARY_SOURCE_URL=https://github.com/martinshkreli/models
RATELIMIT_STORAGE_URI=redis://127.0.0.1:6379/0
TRUST_PROXY_HEADERS=1
```

Generate secrets locally, save directly to a private environment file, and keep
them out of terminal transcripts and Git. The session secret and Fernet key must
be consistent across workers and restarts. Back up the encryption key separately
from the database. Replacing the encryption key without a migration makes saved
provider keys unreadable; the application never silently rotates it.

Local HTTP preview only: set `WORKSPACE_LOCAL_HTTP=1`. Production defaults to
Secure, HttpOnly, SameSite=Lax cookies and must use HTTPS. Database files are
created mode 0600. Keep the database and its containing directory outside static
paths, owned by the service account. Back up SQLite using its backup API.
The proxy option trusts one forwarding hop and is only appropriate when Gunicorn
is inaccessible publicly and the front proxy replaces client-supplied forwarding
headers. It lets per-IP limits distinguish visitors behind Caddy. Redis keys use
the `benchmarkwatcher` prefix; no Redis database or sibling keys are cleared.

Start with `python run.py`, then visit `/workspace/register`. Save the recovery
code, connect a key in AI settings, open a workbook, and select a supported
calculation. An AI request explicitly discloses the destination and payload.
TypeSafe connection testing is a small billable request. DeepSeek connection
testing retrieves the account's model list.

## Security and limits

- All mutating workspace forms require a session CSRF token, including login.
- Server-side session records expire after seven days and are revocable.
- Every key and analysis read/write is scoped to the authenticated account.
- Private responses use `no-store` and `noindex`. Keys are excluded from sessions,
  templates, analysis snapshots, and error messages.
- HTTP adapters use fixed HTTPS hosts, disallow redirects, bound response sizes,
  set timeouts, and never expose raw upstream errors.
- Login, recovery, registration, provider tests, and analysis calls are rate
  limited. SQLite atomically enforces a rolling 30 AI analyses/account/day across
  workers (failed provider attempts count). There are no automatic billable POST
  retries. Existing deployment rate-limit storage still controls IP limits.
- Workbooks are read only. Formula execution, macros, external-link refresh,
  arbitrary URL providers, uploads, and public sharing are not supported.

## Workbook coverage and boundaries

The local collection was identified as a checkout of
`https://github.com/martinshkreli/models`. It contains 609 workbooks, including
company files, sector references, and screens. It is not bundled with this code.
No LICENSE file was found in that checkout; this application does not claim
ownership of the collection or relicense it. Workbooks stay outside public file
paths; the analysis UI links to the original collection and displays selected
values with source cells. Administrators remain responsible for choosing a
collection appropriate for their use.

The reader recognizes visible `Model` sheets with explicit quarterly/annual
period headers (including numeric year cells) and metric labels in column B.
A read-only pass over the local collection found 364 supported workbooks and 245
requiring a table mapping; none failed to open. Other layouts show a mapping-needed
state. It preserves workbook period labels and percentage formats. It does not
infer currency, scale, whether a period is actual or assumed, or whether a saved
formula result is fresh. These qualifications are visible on model/result pages.

Next increments: verified table mappings and units, actual/assumption boundaries,
source refreshes, multi-company comparisons, editable scenario models, and
conversational follow-ups. Public profiles, recommendations, subscriptions,
trade execution, and portfolio imports are not part of this increment.

## Validation

```sh
python -m pytest tests/test_workspace.py
npm run check:vocab
```

Provider contracts: https://docs.typesafe.ai/api and
https://api-docs.deepseek.com/api/create-chat-completion/ .
Jev arithmetic limitations: https://docs.typesafe.ai/model-jaggedness/jev-1.13 .

Mock-provider tests establish application behavior, not live model accuracy.
Before public activation, verify real keys, representative questions, persistence
across server restarts, production HTTPS cookies, and backup/recovery. Enabling
the workspace is a separate deployment operation.

## Samsung company research increment

The company entry accepts Samsung Electronics, Samsung, 005930, or 005935
(optionally preceded by Analyze). It saves a private report from curated official
2Q2026 and 4Q2025 Samsung presentations, checked September 21, 2026. Income,
segments, cash flow, balance sheet, and annual valuation inputs include source
pages and document hashes. This is one mapped issuer, not an automatic filing
crawler or a claim to reproduce an analyst's complete research.

Memory-price sensitivities and FY2025 valuation multiples run in Python without
AI charges. Each saves a new case linked to the previous one and retains its
source snapshot. Market capitalization must include common and preferred shares;
no live quote is assumed. Memory scenarios hold volume, mix, FX, and other
businesses fixed, with explicit user-controlled earnings flow-through.

Optional follow-ups use the user's Jev or DeepSeek connection to select a typed
action and an explicit percentage from the question. DeepSeek written notes
require a separate model selection and visible payload consent. Invalid or
ambiguous plans stop; explanation failures retain the calculated report.

Validation: `python -m pytest tests/test_workspace.py tests/test_company_research.py`
(33 passed); full Python suite (129 passed, one skipped), Jest (241 passed),
vocabulary guard, and browser checks for company search, saved scenario,
valuation inputs, and 390px report layout. Mocked provider tests do not establish live
provider accuracy. No provider key was used for these checks.
