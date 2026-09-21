# Private financial research workspace

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
No LICENSE file was found in that checkout; redistribution permissions need to
be resolved before hosting the source collection for other users.

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
