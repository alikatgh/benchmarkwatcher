# Hetzner + Cloudflare Deploy Playbook — benchmarkwatcher.online

## Expanded stocks and FX coverage — verified 24 October 2026

This later release supersedes the four-stock / 20-pair initial activation below.

- User authorized maximum useful coverage within each Free plan's 100 monthly
  units. Official Marketstack FAQ confirms one unit per requested ticker even
  in a batch; no verified whole-exchange one-unit exception. Public ticker CSV
  discovery costs no authenticated quota. FX historical `currencies` is optional:
  omitting it returned 173 non-USD quote pairs in one request.
- Live totals: **65 stocks / 173 FX and asset pairs / 1,474 observations**.
  Four older stock histories retain their 996 observations. Sixty-one new stocks
  have five daily closes, 19–23 October; FX quotes are dated 23 October. New stock
  coverage used a seven-calendar-day query window, not a claimed full year.
- First six new full-year histories failed identity validation (NEM, XOM, UNH,
  JNJ, PG, MA). Captured responses mixed USD with MXN/ARS on the same requested
  symbol/exchange. A bounded recent-week query then requested 65 different new
  stocks in **two HTTP requests / 65 ticker units**; 61 passed. RTX, BSX and HUM
  had identity mismatches; HON had no observations. Nothing was relabeled or
  filtered into a misleading partial history. All prior failed charges remain.
- Conservative local ledger totals: **Marketstack 100/100; FX 2/100**. This
  expansion made five stock HTTP requests (71 ticker units) and one FX request.
  Explicit ledger-v3 authorization runs from 2026-10-24 04:20:47 UTC to
  2026-11-25 04:20:47 UTC. A hard 100-unit trailing 32-day window preserves earlier
  charges without guessing provider reset dates; expiration fails closed. No new
  automatic schedule. Keys remain laptop-only through Varlock; server provider
  flags remain 0. Page views use only the sanitized cache and spend no API quota.
- Clean local public commit `2ec94cfdd41f21fbcb12fb2c445088d252c7a066`, branch
  `codex/market-coverage-20261024`, is **not pushed**. Production private commit
  `939185b1042ba4a9efd13857306d94e9c80c71fe` follows `d635551b8a4119811e8bc0a2105635779903f105`.
  Only `scripts/vendor_data_store.py`, `scripts/market_data_catalog.py`, and
  `scripts/market_data_snapshot.py` were installed on the server. Collector and
  quota state remain local; unrelated private analytics and data were preserved.
- Public snapshot: schema v1, only `instruments` and `observations`, 176,128 bytes,
  runtime owner 994, mode 0600. Transfer SHA256:
  `a579690dfb03b3a7acd76e7057f1a1e1e8c28aebbcad977cf78a3b1cf3fbf928`.
  Reconstructed installed SHA256:
  `a1d798605c1704b9eac5271c17d3cab1bc59f54d4a138b2165eff8683b961f5c`.
  The previous compatible snapshot is retained as `.sqlite3.previous`.
- Final integrated verification: **311 Python tests passed**, including the
  orphan-worker deadline test. FX one-shot helper: 24 fake tests; guarded installer:
  34 tests. Independent source, helper, activation and recovery review passed.
  Review found and fixed atomic aggregate cache overflow and activation's completed
  status check before release. Exact source/release secret scans were clean.
- Live source hashes, healthy origin routes, both totals, stock pagination,
  AMAT's five observations, Line-to-Bars interaction, FX search and exact XAU
  table were verified. Reads leave the snapshot unchanged. Existing service and
  fetch timer stay active. Shared tiny-value chart labels still round to two
  decimals; exact FX headlines/tables retain precision. This display limitation
  was recorded, not changed in this quota/coverage release.
- Release and recovery evidence:
  `/home/benchmarkwatcher/releases/market-coverage-20261024`.
  Guarded rollback preflight passed. Disable market pages before source rollback;
  preserve the expanded snapshot and restore/recheck the old compatible snapshot
  before reenabling old source. Never restore the pre-migration local ledger over
  current quota state after new calls: that would erase already incurred usage.
- Owned drop-in SHA256:
  `93341662de4a24ac5a9ed69849fae2252ba08cb8ee4b9d30d3ae30034d0bd92f`.
  Fresh cache: `/home/benchmarkwatcher/app/tmp/flask_cache/market-coverage-20261024-enabled`.
- Session cleanup removed 255,729,000 apparent / 122,937,344 allocated bytes of
  synthetic fixtures, scanner, downloaded discovery CSV and temporary Git index.
  Reviewed source, release evidence, screenshots and filtered provider evidence
  remain in `/private/tmp/codex-session-storage/c2a04023db6c96ab03619cc1/373b99f954144838b4178433d1eccccf`
  until release/provider-issue review ends. Canonical ledger and existing files
  were preserved. See `docs/MARKET_DATA.md` for bounded collector usage.

## Stocks and Exchange rates — verified 24 October 2026

- User confirmed non-commercial open-source use and authorized deployment and
  initial API calls. Keys remain on the laptop behind the existing Varlock
  wrapper. No key transfer, server credentialed collector, or new timer.
- Clean local source commit `082d6d116fbb8f437a7ba5bad4546d91a9022b91`, branch
  `codex/market-data-20261024`, is based on public `dd870e2` and is **not pushed**.
  Only its 11 runtime files were deployed. Production private commit is
  `d635551b8a4119811e8bc0a2105635779903f105`; previous private parent was `1215c21`.
  Existing private analytics and unrelated source/data were preserved.
- Live: `/stocks` contains Apple, Amazon, Broadcom and Netflix, with 996 daily
  close observations combined. `/exchange-rates` contains 20 USD-based pairs,
  each with one observation dated 2026-10-23. Both list/detail pages show manual
  updates, original observation dates and source attribution. Page visits use
  local snapshot reads and do not make authenticated provider requests.
- Initial local fetch plus one finite recovery recorded 29 Marketstack requests
  and one exchangerate.host request. Both accounts were verified Free, 100/month,
  $0/month, no overage and zero initial use. Provider reset dates remain unknown;
  the application used a non-renewing grant (03:10:02 UTC 24 October to 03:10:02
  UTC 25 October), now exhausted at 29/29 and 1/1. Preserve the local ledger;
  no resetting counters or automatically renewing enrollment.
- Eleven stock histories remain excluded: ADBE, AMD, CSCO, GOOGL, INTC, META,
  MSFT, NVDA, TSLA, JPM, V. Provider responses contained inconsistent currency
  or instrument metadata, including other currencies/ETF labels. Do not weaken
  identity validation to publish them. Currency casing and explicitly null close
  values were repaired and tested; missing field/invalid price checks remain
  strict. The older filtered AAPL capture did not preserve whether two missing
  closes were explicit null or absent; its 249 retained numeric prices passed
  identity/date/value validation. No missing prices were fabricated.
- Public snapshot: 118,784 bytes, exactly `instruments` and `observations`,
  schema v1, 24 instruments / 1,016 observations. Installed as runtime user,
  mode 0600 at `/home/benchmarkwatcher/app/data/vendor-market-data.sqlite3`.
  Installed SHA256:
  `a123d4567c1eb7d61640e7b4fb6365451ef8d54c84c61396a37a094bdaa18940`.
  Source transfer SHA256:
  `dbcc1c530cb8a355c1e26618d96f9e12eb8feb4d584ebf2fa8dd0d7e5e6c498a`.
  Private quota/job tables were not transferred. Cross-version reconstruction
  explains the byte hash difference; logical validation passed before and after.
- Verification: 223 focused Python tests passed, followed by 21 route tests after
  the final manual-update wording. Twelve affected Jest and two Node behavior
  checks passed; vocabulary and final source/payload secret scans passed.
  Eight operator-helper, 23 installer and three interrupted-rollback checks
  passed. Fresh independent source/accounting and deployment reviews found no
  unresolved material issue. No new hosted CI run or mobile-device check.
- Live origin list/detail/health responses are 200. Public Chrome verified four
  stocks, Apple 249 observations and Line-to-Bars interaction, 20 FX pairs,
  EUR's single observation, and home navigation. Both public changed JavaScript
  hashes match release; all 11 installed files match manifest. Snapshot remained
  unchanged after reads; service and existing fetch timer are active.
- Runtime override: `/etc/systemd/system/benchmarkwatcher.service.d/zz-market-data.conf`
  enables `MARKET_DATA_ENABLED=1`, keeps both provider flags `0`, and uses fresh
  `CACHE_DIR=/home/benchmarkwatcher/app/tmp/flask_cache/market-data-20261024-enabled-v2`.
  An initial immediate readiness probe preceded worker startup; the disabled
  setting was restored and health verified. A bounded 15-attempt readiness
  check then completed activation successfully at 03:41:41 UTC.
- Release payload, backups, gate, intent/result and activation/verification proof:
  `/home/benchmarkwatcher/releases/market-data-20261024`.
  `python3 rollback-market.py --check` passed read-only on the deployed revision.
  Recovery: disable market pages in the owned nonsecret override, reload/restart
  with a bounded health check; then use guarded source rollback `--check` before
  `--apply` if needed. Retain added files and the data snapshot. Do not delete
  the local durable request ledger or server release backups.
- Installer SHA256 `75a3be857019cfb8302ca19e86d6a06e8ffe40fc609e007b1ba9ffa6df4562c3`;
  rollback SHA256 `19105d1d2fc9a8f602bd1572c63219618d7fc08f1fbdf297c577ec3e63537b5d`.
- Session cleanup removed 70,918,768 apparent bytes / 54,579,200 allocated
  bytes of disposable tests, scanner and staging copies. About 1.7 MB allocated
  remains in `/private/tmp/codex-session-storage/c2a04023db6c96ab03619cc1/fa84d68043e148aea3b0923421840475`
  for clean source, release/review evidence, `stocks-live.jpg`, and filtered
  provider responses (retain through release/provider-issue review). The older
  26 KB integration baseline remains in sibling asset `b82202a0c1f5463a8b2968ad2b19104d`
  until review of the isolated source commit completes. Canonical source, the
  durable local ledger, existing environments and server backups were preserved.
  Final local free space was 15,505,092,608 bytes; swap allocation was
  16,106,127,360 bytes. Volume changes include concurrent activity and are not
  attributed to this session's artifacts.

## ReUI workspace, blog and release notes — verified 19 October 2026

- Public UI source is `6f0a4d38c6a663a1c0e91ba9f52e74d15b8b52f0`.
  Public `main` and `codex/reui-release-20261019` also contain test-only
  follow-up `dd870e202f9aeadeba3a548d8ca25f159ae84d8e`; application
  runtime files are identical. Production source is
  `1215c219acf9d7856f8ec6a5f37ead9d40bfc8a0`.
- Selected free MIT ReUI components now provide shared command search,
  six appearance previews and three historical-change palettes, stable
  table/library/source/chart selectors, and searchable lists over 12 options.
  Existing Flask controllers, D3 numerical charts, source evidence and
  original native-field form submission remain intact.
- New public article `/blog/a-clearer-research-workspace`, blog index,
  changelog `#reui-workspace` and sitemap return HTTP 200. Both public
  ReUI asset hashes match the reviewed source (CSS `fe569618bb976120`,
  JS `c88bd18883bc04a0`). Changed assets/controllers use `v=20261019.2`.
- Clean source passed 463 Jest tests, 698 Python tests (one skipped), UI
  types/build reproducibility, vocabulary, and runtime dependency audit.
  All 97 public browser cases have passing local evidence across targeted
  runs; affected builder/Pele checks passed four cases. Final ReUI suite
  passed all 11 workflows. Immediate theme colors and six-theme Axe checks
  passed five repetitions after removing reduced-motion interpolation.
  Independent product and deployment reviews found no remaining material issue.
- All 16 offline install/recovery tests passed in one final run. Production
  preflight, exact ten-file installation, origin/public health and read-only
  guarded rollback check passed. Existing analytics and 5,941,952,512-byte
  data library are preserved; app and fetch timer are active.
- Live Chrome verified settings selected state, dark appearance, keyboard
  Gold search/detail handoff, and 320px mobile filtering (17/93 Energy,
  restored 93/93). Saved-view trigger is 32px; page overflow is zero.
  Original theme and viewport restored; production tab kept for review.
- Final hosted run passes unit, Python, vocabulary, public E2E, D3 and all
  11 ReUI workflows. The test-only follow-up fixes the D3 Exact dates
  disclosure interaction. Full CI remains red on one mobile workbook fixture
  layout assertion: first chart y=564.25, expected <524 after three saved
  questions (workbook-chat.spec.ts:355); 15 other chat checks pass and the
  following company step was not reached:
  https://github.com/alikatgh/benchmarkwatcher/actions/runs/39210558415
  Workbook templates/controllers/styles/spec/config are unchanged from public
  b347d973. All 582 emitted ReUI CSS selectors are scoped to ReUI islands,
  outside workbook content. A single clean b347d973 baseline run on the mobile
  Chrome project fails with the identical y=564.25 and <524 threshold (664px
  viewport), confirming this failure predates ReUI. Its specific layout cause
  remains uninvestigated; preserve the assertion. Production's workbook-library
  flag is disabled. Baseline source and compact result remain in session asset
  904c7c03653e47539d14ea84f03f52a6; its 3.7 MB disposable scratch was removed.
- Source-only release adds no providers, billable calls, auth/data migrations,
  timers or proxy changes. Existing standard public CI runners/retention are
  unchanged. Backups, manifest, payload, installer and guarded rollback:
  `/home/benchmarkwatcher/releases/reui-workspace-20261019`.
  Installer SHA256 `15b284072b6399ec8dec20a17284b88c352e91a23feef0c01998198440329071`;
  rollback `50bee9f3ee430a8a6873864a80c4a818da7a61348cafe0c69dcf7dff4f667532`.
- About 174.5 MiB of verified session test fixtures/caches and the local preview
  were cleaned; original
  environments remain. Public source worktree and compact release evidence
  remain in session assets `a10ce4b77d22493ca8ddb837a16c03df` and
  `f2b0aa52c7d7497eb6cd1836df12ee47` under
  `/private/tmp/codex-session-storage/09d0257191a849e638ec05ba/`.
  Preserve source; retain payload/evidence through rollback review.
- Local disk pressure temporarily blocked screenshot saving and Git metadata
  writes. The test correction was safely published through GitHub's contents API,
  guarding its previous blob. After headroom recovered, the retained worktree's
  index and branch were advanced to public dd870e2 with exact tree/blob and CAS
  guards; no worktree files were changed. A live search JPEG was then saved with
  a 1 GiB free-space guard and retained in release evidence. No user files,
  original environments or unrelated artifacts were removed.

## Pele source paths and compact history controls — verified 18 October 2026

- Public `b347d9737617c33eb9e680cee017b1abc66b1ab2` is pushed to `main`
  and `codex/pele-source-diagrams-20261018` (feature commit `c1cc748` plus
  stylesheet URL refresh). Production source is
  `210502d5ad7fe840abd1ef0630b279d702c9620c`. All 17 runtime files match the
  reviewed public source, with the existing private analytics addition retained.
- Pele 1.6.0 renders lazy source paths in saved public histories, populated
  reference histories, company-report methodology and workbook source data.
  D3 numerical visuals remain intact. History Range, Chart and Quick visual
  controls measure 32px high with regular 12px text and aligned bottoms.
  Changed stylesheet URLs include `v=20261018.1` to avoid the four-hour cache.
- Clean candidate verification: 463 Jest tests, 126 focused Python tests,
  eight Pele browser checks in installed Chrome, vocabulary and diff checks
  passed. Twelve offline deployment/recovery fixture groups passed after the
  final installer correction. Independent product and deployment reviews passed.
  Final hosted run has passing Python/unit/vocabulary jobs, 90 browser passes
  and the same seven preexisting missing-reference-fixture failures:
  https://github.com/alikatgh/benchmarkwatcher/actions/runs/39123657556
- Live Chrome verified actual chart data and ready four-node Pele SVGs on:
  - https://benchmarkwatcher.online/data/worldbank_be4ee7db368c93b3a8372c1a42517c27
  - https://benchmarkwatcher.online/data/faostat_7005fbcab995cd6c85285ada94fa9731
  - https://benchmarkwatcher.online/data/sec_c7f3ef1049b8826d777711072eae24c7
  - https://benchmarkwatcher.online/reference/wb_usa_consumer_inflation
  - https://benchmarkwatcher.online/reference/ecb_eur_usd
  Quick visual opened successfully; Step and one-year range interactions passed.
  Currency controls and source flow fit 320px in dark mode without page overflow.
  Theme and viewport were restored. This is browser verification, not phone proof.
- Public article `/blog/pele-source-diagrams`, blog index, changelog anchor
  `#pele-source-diagrams` and sitemap registration are live. Public stylesheet
  and Pele vendor SHA256 values match the reviewed payload. Public/origin health,
  app/fetch-timer activity and read-only rollback preflight passed. The library
  remains 5,941,952,512 bytes. No dependency, provider, timer or proxy changes.
- Source backup, manifest, exact patch, installer and guarded rollback remain at
  `/home/benchmarkwatcher/releases/pele-source-diagrams-20261018`.
  `python3 rollback-pele.py --check` passed. Rollback retains all added files.
  Installer SHA256 is `5592f13c9197b1699d1d2b092e657b335a98d7586125e072e408d3f488445dcc`;
  rollback SHA256 is `c1ad102bbdfc5547292549d4a24e051b4bff7e3060c887d8fa281c5b252d7e1c`.
- Removed this session's server test fixtures/cache (about 22 MB) and local
  dependency symlinks; original environments remain present. Local source and
  release artifacts retain 21,581,824 allocated bytes in asset
  `3b2625ac148c4b3a8dd414ba184ba523`; review screenshots retain 401,408 bytes in
  `98f81a3f9c754d1c8a599d128e276210`. Preserve source; retain release artifacts
  through rollback review and screenshots through user review.

## Toolbar matches View settings — verified 8 October 2026

- Public `b60b97baefb1560b0a6c670194179435654a7a1e` is pushed to `main`
  and `codex/toolbar-reference-20261008`; production commit is
  `0aa74825fd0ec24b2ea02df595e1da231968694e`. Two release files match public
  source. Toolbar controls now use the measured View settings scale: 32px
  height, 12px regular text, 18px line height, 6px corners and 10px horizontal
  inset. Selected desktop ranges retain fill plus underline at regular weight.
- All eleven responsive scenarios covered by passing checks: initial ten
  passed, then final four affected cases passed including desktop/reference
  comparison and 320/390/600px geometry. Independent read-only review found
  no final defect. Live Inter metrics matched reference on desktop and compact
  layouts; 320px had no overflow. Compact toolbar is 129px high, down from165px.
  Viewport reset; final screenshot and live review tab retained. Physical
  devices and WebKit not checked. Hosted CI was still in progress:
  https://github.com/alikatgh/benchmarkwatcher/actions/runs/37771876370
- Public/origin health and app/fetch timer activity passed. Analytics and
  5,941,952,512-byte library preserved. Source backup, installer, manifest and
  guarded rollback are in `/home/benchmarkwatcher/releases/toolbar-reference-20261008`;
  `python3 rollback-reference.py` read-only preflight passed.
- Cleaned 815,104 allocated bytes of current fixtures/caches/intermediate tests.
  Retained 249,856 allocated bytes of baseline, release scripts and final proof
  in asset `e38826ee4dac48bb93d03628522a2805` through release review; retire
  disposable evidence afterward. Final free space758,624,256bytes and
  swap7,516,192,768bytes; volume changes include concurrent activity.

## Normal toolbar typography — verified 8 October 2026

- Public source `f597be4b608d91d96cd278a48b24defa4cc3518b` is pushed to
  `main` and `codex/toolbar-type-20261008`; production source is
  `96a790d6cf86ce5356f6efdec95c864b24aaf93d`. The compact toolbar font token
  is now 14px, matching normal table text. Control geometry is unchanged.
- All eleven responsive toolbar checks passed on the clean public artifact.
  Live Chrome at 600px and 320px confirmed regular 14px Inter for search,
  view/range selectors, count and chips, with no page overflow. Viewport reset;
  screenshot and live review tab retained. Hosted CI remained in progress:
  https://github.com/alikatgh/benchmarkwatcher/actions/runs/37768937240
- Public/origin health and app/fetch-timer activity passed. Two release files
  match public source. Analytics/library preserved. Source backup, installer,
  manifest and guarded rollback are in
  `/home/benchmarkwatcher/releases/toolbar-type-20261008`;
  `python3 rollback-type.py` read-only preflight passed.
- Cleaned 675,840 allocated bytes of current disposable test fixtures/caches
  and unlinked two dependency symlinks. Retained 843,776 allocated bytes of
  baseline, release scripts and review evidence in session asset
  `fa1d59df087a4e25b2bce0ab8917440a` through release review; retire disposable
  evidence afterward. Final volume free space 540,659,712 bytes and swap
  7,516,192,768 bytes; changes include concurrent activity.

## Toolbar grid and dropdown alignment — verified 8 October 2026

- Public source `593c7ab38e50f882602925095a08639ebe471c30` is pushed to
  `main` and `codex/toolbar-grid-20261008`; production source is
  `5cc48ece94bd703c8cdf0046e9f2cc0855814c92`. This includes toolbar release
  `7c728f63092e0e7784694a3ca58e84e019492528` and its compact-inset follow-up.
  Four source/test files changed overall; private history remains local.
- Compact controls share 44px heights, regular 16px/20px typography, 6px
  corners and 8px gaps/insets. Search/view/More surfaces and borders match.
  Both dropdown arrows use the same 16px chevron with a 12px right inset.
  Range and removable filter chips are 112px wide; chip labels truncate
  independently of their close icon. Tiny visual filter counts are removed,
  with active filter count retained in the accessible name. Clear scrolls
  with multiple chips. Compact result count is `17/93`, with its full ARIA name.
- 32 focused JavaScript tests, vocabulary and syntax checks passed. Eleven
  responsive toolbar browser cases and eight clean-public builder cases passed.
  After live 320px validation found a clipped default label, outer insets were
  reduced from 12px to 8px; all eleven responsive cases passed again. The final
  real-count label assertion passed at 320/390/600px after independent review
  identified that count measurement must retain tabular digit styling.
- Live Chrome at 320px and 600px, with Inter loaded, showed the full default
  view label beside `17/93`, aligned controls and zero page overflow. Range
  selection changed to 1Y and returned to ALL successfully. Final screenshots
  retained; viewport reset and live review tab kept. No physical-phone claim.
- Public/origin health passed; application and fetch timer remain active.
  Analytics and the 5,941,952,512-byte library remain intact. Installers,
  source backups, manifests and guarded rollback scripts are retained in
  `/home/benchmarkwatcher/releases/toolbar-grid-20261008` and
  `/home/benchmarkwatcher/releases/toolbar-inset-20261008`.
  Latest `python3 rollback-inset.py` read-only preflight passed.
- Hosted CI remained in progress at verification:
  https://github.com/alikatgh/benchmarkwatcher/actions/runs/37765255091
  Full hosted success is not claimed. A local rerun first lacked Playwright's
  bundled browser; using installed Chrome completed the passing checks above.
- Cleanup stopped the preview, removed 1,261,568 allocated bytes of current
  synthetic fixtures/caches, and unlinked two temporary dependency links.
  Original environments remain intact. Baselines, scripts and browser proof
  retain 2,039,808 allocated bytes in asset `5fd074706f4545aba8748cf3ac837fa5`
  under `/private/tmp/codex-session-storage/42df92a06a702d93bd0091bf/` through
  release review; retire disposable evidence afterward. Clean public source
  stays in `aa11c5200c8443aca92e28f5fd1ad943`. Final volume free space was
  1,256,476,672 bytes and swap 7,516,192,768 bytes; volume changes include
  concurrent activity.

## Control consistency and detail hierarchy — verified 8 October 2026

- Public source `789ad0c0fc716b8bba9fa21391e17696bdfc7473` is pushed to
  `main` and `codex/consistent-controls-20261008`; production source is
  `8df660a00e174b691557b1090f3af8b1c6c517f5`. All six release files match
  reviewed public source. Private operational history remains local.
- Toolbar search/actions/range/chips now share 36px/14px desktop and
  44px/16px compact sizing, 6px corners and 8px gaps. Search borders no longer
  add height; visual actions adapt by container width. Short Search placeholder
  remains readable at 320px with its full accessible label preserved.
- Detail chart type and dots are grouped left; disclosure rows use a consistent
  neutral treatment. Source name/link, update date/context and research
  heading/action have a tighter ordered hierarchy. Source truth, exact-date and
  slider behavior, and browser-only research storage disclosure are preserved.
- Clean public artifact passed 40 focused JavaScript tests, vocabulary guard,
  22 responsive table/detail browser cases and 18 desktop/mobile builder cases.
  Independent Sol review found no new defect. Live Chrome measured equal 44px
  heights, 16px labels and 6px corners; 320px detail had no overflow. Chart style
  and dots interactions passed live and were returned to Line/no dots afterward.
  Viewport reset; live review tab retained. No physical-phone claim.
- Public/origin health passed; app and fetch timer remain active. Analytics and
  5,941,952,512-byte library were preserved. Backup/manifest/installer/guarded
  rollback live at `/home/benchmarkwatcher/releases/consistent-controls-20261008`.
  `python3 rollback-consistent.py` passed its read-only preflight.
- Hosted CI remained in progress at verification:
  https://github.com/alikatgh/benchmarkwatcher/actions/runs/37761320993
  Previous `3a7a6f0` browser CI failed the same seven country/reference fixture
  cases. Focused results above are passing; full hosted success is not claimed.
- Cleanup stopped the preview server, removed 4,411,392 allocated bytes of
  synthetic fixtures/caches and unlinked two temporary dependency links.
  Retained source baselines, scripts, final screenshots and browser evidence
  total 2,662,400 allocated bytes in session asset
  `401ffc64d48c4adbbea6b173af690009` under
  `/private/tmp/codex-session-storage/42df92a06a702d93bd0091bf/` through release
  review; then retire disposable evidence. Public checkout is retained in
  `aa11c5200c8443aca92e28f5fd1ad943`. Final volume free space 562,053,120 bytes;
  swap 7,516,192,768 bytes. Volume-wide change includes concurrent activity.

## Compact toolbar and chart dates — verified 8 October 2026

- Public source `3a7a6f0b4e5a334fdc6579e1ef5ecec71b1510e7` is pushed to
  `main` and `codex/compact-controls-20261008`; production source is
  `4603a4aa47ca8b412edd3d962e9cc2b6237a2a44`. All twelve release files match
  the reviewed public source. Private history and operational records stay local.
- Narrow table containers use three compact control rows, a native range picker,
  icon actions with accessible names and a compact count. Single removable
  filters no longer need a duplicate Clear button; multiple chips scroll locally.
  Desktop controls and on-demand D3 quick visuals retain their behavior.
- Benchmark detail/comparison chart settings offer two native date handles,
  preview dates while dragging and update on release or keyboard adjustment.
  Exact dates remain available in a disclosure with existing validation.
  Empty intervals retain truthful dates and hide unusable handles; collapsed
  intervals can expand in either direction. The full commodity page is unchanged.
- Final clean-public-artifact checks passed: 72 focused JavaScript tests,
  vocabulary guard, 22 table/detail browser cases and all 18 desktop/mobile
  builder cases. Independent Sol review found no remaining material issues.
  Browser checks cover 320/390/600px, desktop split panes, enlarged text,
  accessibility, pointer/keyboard interaction, failed range requests and focus.
- Live Chrome confirmed a 157px toolbar at 320px with no horizontal overflow,
  a slider change immediately updating the custom chart, and exact Jan 1–Jul 1
  2026 application. Viewport restored; live review tab retained. These are
  browser viewport checks, not physical-phone verification.
- Public/origin health and the application/fetch timer passed. Analytics bytes
  and the 5,941,952,512-byte library were preserved. Exact prior source, manifest,
  installer and guarded rollback are retained under
  `/home/benchmarkwatcher/releases/compact-controls-20261008`.
  `python3 rollback-compact.py` passed its read-only preflight; `--apply`
  restores only the twelve release paths after source/index/analytics checks.
- Hosted CI was still running at final verification:
  https://github.com/alikatgh/benchmarkwatcher/actions/runs/37751054160
  Previous revision CI passed unit/Python/vocabulary and failed the same seven
  existing country/reference fixture browser cases. Full hosted success is not claimed.
- Cleanup stopped the preview server, removed 8,069,120 allocated bytes of
  session-owned synthetic fixtures and caches, and unlinked two temporary
  dependency links. Original environments remain intact. Release evidence and
  final screenshots total 2,703,360 allocated bytes in session asset
  `e60f8663f5194072be268bf831d83ef7` under
  `/private/tmp/codex-session-storage/42df92a06a702d93bd0091bf/`; retain through
  release review, then retire disposable evidence. Source checkout remains in
  asset `aa11c5200c8443aca92e28f5fd1ad943`. Final free space was 2,248,994,816
  bytes and swap 7,516,192,768 bytes; volume changes include concurrent activity.

## On-demand D3 correction — verified 8 October 2026

- Public source `af423567a03d948f793531a45c8a26bd8a4375c8` is pushed to
  `main` and `codex/on-demand-visuals-20261008`. Production source is
  `00291b10a6a3f9fc1c53d39c2a313ca461d218e2`. All 16 release files match public
  bytes, apart from the preserved private analytics snippet. This supersedes
  the automatic category graphic and global editor launch described below.
- Energy/category pages now keep their table primary. Row chart actions,
  selection/filtered controls and contextual reference/library/Research/company/
  workbook actions open a compact themed D3 quick view only after a click.
  It uses the active table range and loaded observations, keeps units separate,
  and exposes exact keyboard/hover values. Full editing/export is optional via
  Customize graphic. No new source feeds or native mobile release was added.
- Final clean-public-artifact verification: 95 focused JavaScript tests,
  nine Python checks, vocabulary guard, all 18 desktop/mobile builder cases and
  14 affected public-fixture table/layout regressions passed. Includes dark
  320px axe, ranges/selection/empty states, source evidence, modal focus,
  optional exports and contextual adapters. Independent Sol review's concrete
  renderer and rollback findings were fixed and checked; staged-edit and
  staged-deletion rollback guard regressions passed in an isolated fixture.
- Live HTTPS and origin health passed. Actual Chrome checked no automatic
  hero/dialog, a 760px desktop quick view, exact keyboard values, close/focus
  return, and 320px row/filtered controls with a 304px modal and zero horizontal
  overflow. Browser viewport was reset. These are browser checks, not physical
  phone verification. App and fetch timer are active; library remains
  5,941,952,512 bytes. Runtime lock and analytics were preserved.
- Deployment source backup, exact manifest, installer and guarded rollback
  are retained at `/home/benchmarkwatcher/releases/quick-visuals-20261008`.
  `python3 rollback-quick.py` is a verified read-only preflight; `--apply` restores
  only the release's exact prior paths and records a rollback commit. It stops
  on changed source/index content. Current installed rollback dry-run passed.
- Hosted CI for this revision was still running when live verification ended:
  https://github.com/alikatgh/benchmarkwatcher/actions/runs/37744493800
  Full hosted-suite success is not claimed. Previous main CI remained failed
  after its earlier reference-fixture failures; local focused checks above pass.
- User-authorized cleanup removed 65,325 inactive Chromium HTTP/compiled-code
  cache entries (1,257,246,720 allocated bytes), with fresh identity/timestamp/open
  checks. Personal files, profiles/history/downloads, environments and source
  were preserved. Cleanup also removed 13,864,960 allocated bytes of this
  correction's completed synthetic fixtures/compiler caches and unlinked its
  two temporary dependency links. All session test servers are stopped.
- Final storage snapshot: 3,199,176,704 free bytes; 7,516,192,768 allocated swap
  bytes. Free-space changes also include concurrent activity/APFS and are not
  a direct cleanup-byte measure. Compact cleanup audit, release scripts,
  final screenshots and test evidence remain in session asset
  `a6190c984bcf4c06928334f98257ff4f` under
  `/private/tmp/codex-session-storage/42df92a06a702d93bd0091bf/` (about 6 MiB)
  through release review. Published source remains in asset
  `aa11c5200c8443aca92e28f5fd1ad943`; retire only disposable evidence after review.

## Shared Visual Builder — verified 8 October 2026

- Public source `8cd0faf28d04a35129b99ac8e443365cfaec31ae` is pushed to `main`
  and `codex/visual-builder-20261008`. Production source is
  `2527169f814ad5d16e645d875c2145167688e309` on the existing private deployment
  branch. All 31 affected source files match public source, apart from the
  preserved local analytics snippet. No private history or data was published.
- Shared editor is available from the header, Energy/category graphics,
  benchmark details, references/library histories, Research, companies and
  workbooks. Supports line, area, bar, dot, ranking and supplied GeoJSON map
  graphics, source notes, local drafts, CSV/TSV data and SVG/PNG export.
  This release adds no wind-capacity or data-centre feeds and no native UI.
- Clean release verification: 418 JavaScript tests, 48 focused Python tests and
  12 desktop/mobile builder browser tests passed. Cache follow-up passed seven
  Python and six affected browser cases. The final 320px header regression
  passed in both builder configurations; all 14 parameterized cases covering
  the nine new hosted-CI failures then passed against the public CI fixture.
  Independent Sol reviews found no blocking release defects.
- Live HTTPS checks passed Energy rendering, builder editing, actual PNG
  download, desktop and 390px layout, and final 320px header/builder preview
  with zero horizontal overflow. Viewport was reset after inspection; these
  are browser viewport checks, not physical-phone verification. Origin/public
  health passed; application and fetch timer are active. Library size remains
  5,941,952,512 bytes. Analytics and the refresh runtime lock were preserved.
- Hosted CI for the initial feature passed unit/Python/vocabulary jobs but
  exposed nine new narrow-header failures, fixed in the final source. Seven
  older reference-fixture browser failures already existed on baseline
  `63e0e17`. Final CI was still running at release verification:
  https://github.com/alikatgh/benchmarkwatcher/actions/runs/37739221184
  Full hosted-suite success is not claimed. Minor known keyboard issue:
  closing a builder opened by the async header launcher does not restore focus
  to its trigger; the launcher is disabled before its focus is captured.
- Rollback archives, manifests and `final-result.json` are retained under
  `/home/benchmarkwatcher/releases/visual-builder-20261008`. Initial worktree
  patching as the app account hit root-owned paths and partially removed source;
  every original was immediately restored from the exact archive and verified
  before proceeding. Deployment now stages as the app account, writes exact
  reviewed blobs as root, preserves analytics, verifies bytes and restarts only
  the app. Use command-scoped deployment Git identity; no global config change.
- Local release checkout, scripts, live screenshot/export and review evidence
  are retained in session asset `aa11c5200c8443aca92e28f5fd1ad943` under
  `/private/tmp/codex-session-storage/42df92a06a702d93bd0091bf/` through release
  review (about 22 MiB). Removed 30,265,344 allocated file bytes of synthetic
  fixtures/compiler caches and unlinked only the two session dependency links;
  original environments are intact. All session test servers are stopped.

## Homepage library overview — verified 8 October 2026

- Public source `63e0e172d64f5949e6ad235f70cfd3f8087e6428` is pushed to `main`
  and `codex/homepage-library-20261008`. Production source is
  `7d94476a15bc4a63634125e4f394e792cf3d70bd` on the existing private deployment
  branch. Nineteen reviewed files match the release and canonical copy.
- Homepage now presents 93 commodity series, 361,616 country/agriculture
  histories and 12,363 SEC companies, plus all thirteen published dataset links
  and research entry points. The saved library total is 7,222,096 observations
  across 431,584 histories, excluding the separate commodity collection.
  Counts read published dataset summaries only; no provider calls or large scans.
- Added `/blog/explore-the-whole-library` and changelog entry `#homepage-library`.
  Renamed the six-indicator country selection to Country highlights; sidebar
  Country data now opens the complete country library.
- Verification: 690 Python tests passed, one skipped; final affected homepage
  tests 15 passed after label/order changes. All 371 JavaScript tests passed.
  Nineteen distinct targeted browser tests passed across the final/reused runs:
  four new homepage cases, twelve workspace-shell cases and three country
  navigation cases. Includes 320/390/1440 px, six themes, axe, keyboard entry,
  saved-range reload and heading semantics. One intermediate browser failure was
  a cached preview template; it passed after restarting that preview.
- Independent Sol review found no remaining defects after the heading fix.
  Live HTTPS verification passed homepage counts, full dataset listing links,
  Land cover search for Mongolia, a 31-observation chart, company directory,
  blog and 390 px no-overflow layout. Origin checks returned 200 for home,
  focused benchmark view, blog, changelog and Sources. Both service and timer
  are active; database size remains 5,941,952,512 bytes and analytics is unchanged.
- Production source backups and deployment manifest remain under
  `/home/benchmarkwatcher/releases/homepage-20261008` for rollback/review.
  Live screenshot: `docs/readme-media/homepage-library-32ba8af.jpg`.
  Hosted validation: https://github.com/alikatgh/benchmarkwatcher/actions/runs/37730600248
  Initial CI passed Python, JavaScript-unit and vocabulary. Its browser job
  had 82 passes and nine failures: seven pre-existing missing-reference-fixture
  failures plus two phone first-viewport regressions from the extra Overview
  tab. Removed that redundant link in `63e0e17`; the header still opens home.
  The exact two phone cases and five homepage/navigation cases then passed
  locally against the CI fixture server. Twenty-one distinct affected browser
  cases have now passed locally. Live 390 px verification puts the first value
  at 817.84 px within the 844 px viewport after loading, with no overflow.
  Correction CI: https://github.com/alikatgh/benchmarkwatcher/actions/runs/37731446492
  (running at final local verification). Full hosted-browser success is not claimed.
  The correction has its own rollback record under
  `/home/benchmarkwatcher/releases/homepage-navigation-20261008`.
- Cleanup removed 196,136,960 allocated bytes of session-owned test fixtures,
  temporary npm dependencies/cache and preview data; the localhost server is
  stopped. About 400 KiB of release/test evidence remains in session asset
  `86abefe7a9c14c39b7a13dd370eb93c7` through release review, plus the 100 KiB
  live screenshot and committed source checkout. Final Mac free space was
  4,900,941,824 bytes with 6 GiB swap after initial cleanup, versus 1,783,336,960 bytes and 10 GiB
  swap before this homepage task; volume changes include concurrent activity.
  Phone-fix verification allocated and then removed an additional 110080000
  disposable bytes; its fixture server is stopped. The complete source and
  small release/test records remain available through review.

## Shared server cleanup — verified 8 October 2026

- User authorized removing unneeded files only when the projects remain unharmed.
  Removed **3,429,896,192 allocated bytes**. Available disk space increased from
  1,042,227,200 to 4,585,492,480 bytes; use fell from 98% to 89%. Free-space change
  also includes concurrent activity and filesystem accounting.
- Removed 57 WallMarkets backup staging directories (including all 48 `.pending`
  copies), after full byte/metadata comparison with retained archives under the
  existing backup lock. All 156 completed backup archives remain unchanged.
- Removed 2,550 exact duplicate Mappster deployment files and 15 completely empty
  staging trees. Retained 250 unique source/recovery artifacts, including 43
  unique archives. Hardlinks into live data were preserved and counted correctly.
- Rotated/vacuumed system journals to about 545 MB and cleared downloaded apt
  packages. Removed only the obsolete Node installer download and npm download
  cache from the old QA worktree. Its uncommitted edits, installed environment
  and test server remain intact. No application source, dataset, configured
  model-source checkout or unique recovery archive was removed.
- Independent Sol review covered candidate proofs and the execution script.
  Final remote dry-runs and locked/fresh revalidation passed; no deletion errors.
  BenchmarkWatcher, WallMarkets, Mappster, Sciencebouk HTTP roots return 200;
  Atlas retains its 301 redirect. All ten checked application/database/monitoring
  services are active. BenchmarkWatcher Sources returns 200 and the live library
  remains 5,941,952,512 bytes.
- Private compressed manifests, exact deleted paths, executor and verification
  reports (about 1.8 MiB) remain in session asset `4e4d938523e5492cbc6391ed8d021c83` under
  `/private/tmp/codex-session-storage/21f836c7e78e9f1ce29706be/`.
  Keep this small audit/recovery record through review; retire it when no longer
  needed. The current library refresh guard still requires 8,261,409,177 free bytes.

## Historical coverage expansion — verified 8 October 2026

- Public source: `20391188fd74775aa5a788e15f4f186ca1eb6de1` on `main` and
  `codex/exhaustive-free-data-20261008`. Production source:
  `6364408124e865ef41387567c3cfa204d1dab9ef` on the existing private deployment branch.
  Reviewed source files were copied and verified; no private history was pushed.
  The existing analytics change in `app/templates/base.html` is unchanged and
  remains the only production working-tree modification. Service and fetch timer are active.
- Nine newly published FAOSTAT domains (LC, IC, FDI, CB, GF, GV, RM, RY, IG)
  add 51,246 histories and 916,719 observations. All nine preserve available
  country histories across the requested 1900–2025 window, with matching-vintage audits.
  Public totals are **13 datasets, 431,584 histories, 7,222,096 observations**.
- The 5,941,952,512-byte production SQLite library retains 20 datasets,
  803,186 histories and 13,643,283 observations. Seven saved datasets are private
  under the new reuse gate. Twelve domains are held in the catalog pending
  source-specific reuse/attribution review: TCL, TCLI, RFN, RFB, RT, BE, GN,
  RP, PD, PA, RA, CAHD. This includes previously public TCL; its data is preserved.
  Details, CSV, search, listings, counts and refresh scheduling enforce these holds.
- Reader/catalog coverage: 69 discovered FAOSTAT domains; 39 reviewed readers;
  11 FAOSTAT domains with published observations; nine full-historical audits.
  SEC has 7,868 catalogued concepts and 98 selected core concepts, but its saved
  corpus remains eight measures. WDI, QCL and RL older-year backfills remain pending.
- Production `PRAGMA quick_check` passed. Origin checks passed for Sources,
  IG listing/detail/CSV, blog and changelog; held TCL detail and CSV return 404.
  Live HTTPS Chrome checks passed Sources, search, a Mongolia government-expenditure
  history, chart range/style controls, held-history denial, the blog and changelog.
  Sources has no horizontal overflow at 390 px. The final wording is verified live.
- Validation: 675 Python tests passed locally, one skipped. Final hosted Python,
  JS-unit and vocabulary jobs passed in CI `37709928998`. Its browser job finished
  with 80 passed and the same seven missing-reference-fixture failures recorded
  before this release (four global-reference checks and three homepage-country checks). Independent
  Sol reviews covered the importers, merge integrity and final reuse gate; no blocking findings.
- **Storage limitation:** production had 1,110,593,536 bytes free
  after verification. The scheduled-refresh guard requires 8,261,409,177 bytes for
  the current corpus. Broad backfills and full maintenance still need more server
  headroom. No successful post-expansion scheduled refresh or exhaustive coverage is claimed.
- Recovery/import/audit reports are under
  `/home/benchmarkwatcher/releases/library-expansion-20261008`; local copies and
  four unmerged reuse-held staged datasets are retained in session asset
  `bffc8caa87924d2087e9292ac5ce4116` (about 111 MiB). Revisit retention after reuse
  and release review. The source checkout asset `0705a83f605041c4a9fb6c38dbeba6d3`
  is retained for review/recovery (about 15.4 MiB); older cleanup evidence is 116 KiB.
- Current cleanup removed about 1.50 GiB of verified inactive caches, plus
  774,692,864 allocated bytes of merged stage duplicates and root test fixtures.
  The last Mac snapshot had about 3.6 GB free and 7 GiB swap allocated. Free-space
  changes include concurrent activity and APFS behavior; they are not cleanup totals.
  Existing environments, datasets, source checkouts and conversation history are retained.

## Earlier public library release — verified 8 October 2026 (local time)

- Public source: `31858a5ffc20875f316e7c2728158f009737a92c`, following the
  library release `438ba99bbfba05c029d69d5bea9b5616ca76c90e`.
- Production source: `5a3179aba7991ae29b80ca30aada242b4e9dbe60` on the local
  `deploy/public-data-library-20261007` branch. Production keeps private deployment
  ancestry and operational files. **Do not fast-forward or reset this checkout to
  public main.** Fetch reviewed public commits and apply only their intended changes.
  The server's existing operational README and analytics edit in `base.html` remain.
- Runtime still uses the security-patched virtualenv under
  `/home/benchmarkwatcher/releases/security-deps-20261007/venv`; dependency checks pass.
  Public responses currently traverse Cloudflare and Caddy. The older topology
  notes below are historical, not evidence of the current edge configuration.
- Installed `data/public-library.sqlite3`: 5,319,299,072 bytes; SHA-256
  `a432526acdc268e884cd22a7cf6ce4d53fb12fbf4b5cf047d3cfb8330fd75050`.
  A read-locked compressed stream matched checksums; server SQLite quick_check and
  FTS checks passed. The five saved datasets contain 700,178 histories and
  11,813,386 observations. The temporary transfer path was promoted without a second
  allocated database copy. Production permissions are benchmarkwatcher, mode 0600.
- Recovery records remain in `/home/benchmarkwatcher/releases/public-library-20261007`;
  original code is retained at `deploy/before-public-library-20261007` (`35868f7`).
  Roll back only release source changes if needed; preserve accounts, `.env`, data,
  analytics and the security runtime. The new database can stay in place with older code.
- Only BenchmarkWatcher was restarted. The existing fetch timer remains active;
  `public-library-timeout-20261007.conf` sets its service timeout to 9,000 seconds
  while retaining its security interpreter override and memory limit.
- **Maintenance capacity gap:** about 1.65 GB free remains. The refresh guard needs
  7,451,959,705 free bytes for this corpus, so due imports will safely defer until
  roughly 6 GB more headroom is available. No successful scheduled refresh is claimed;
  the read-only status currently reports no dataset due.
- Verified live over HTTPS: blog/index/changelog/sitemap, library and source counts,
  broad population/search/indicator/deep-page queries, Mongolia wheat history and
  exact-value attributed CSV, Apple directory/detail, existing references/home,
  health and internal-API denial. Live chart range/style controls passed. The final
  navigation fix has no document overflow at 320/390 px; preview also passed 720 px.
  The final phone spacing correction preserves 44 px links; the first observation
  value ends at 842.34375 px in the live 320×844 viewport, fully within the screen.
- Checks: 321 Python tests passed before the final query fix; 78 affected tests passed
  afterward. Chart contract, vocabulary and diff checks passed. Independent Sol review
  passed the final query fix and responsive corrections. Final public CI run
  `37655900410` at `31858a5` passed Python, JS unit and vocabulary jobs. Browser CI
  finished with 80 passed and seven failed: the same missing-reference-fixture
  failures present before this release in run `37565426321` (four global-reference
  checks and three homepage-country-data checks). All release-induced navigation
  and first-value visibility regressions are resolved; full CI is not green.

- Local storage after cleanup: about 6.7 GB available (volume-wide, not attributed
  entirely to this task). The local 5.32 GB library remains the intended data deliverable.
  Retained release checkout and small transfer-checksum evidence: approximately
  10.75 MiB under
  `/private/tmp/codex-session-storage/21f836c7e78e9f1ce29706be/0705a83f605041c4a9fb6c38dbeba6d3`.
  Preserve the source checkout for review/recovery until explicitly retired.
  Approximately 116 KiB of cleanup/import evidence remains in the adjacent
  `bbf193b9b5fd4550a825050c2d5ed1a0` asset until review is complete.
  Session test fixtures and provider download archives have been removed.

## Historical production snapshot — verified September 20, 2026

**The site now runs on Hetzner. Namecheap provides domain registration and
BasicDNS only; Cloudflare is not in the live request path.** The provisioning
instructions below describe an older proposed topology, not the current host.
Do not rerun the whole-server provisioner or replace the shared Caddyfile.

- Host: `89.167.29.166` (`turgen-hel`). SSH:
  `ssh -i ~/.ssh/turgen -o BatchMode=yes root@89.167.29.166`.
- App: `/home/benchmarkwatcher/app`, owned by the dedicated non-login
  `benchmarkwatcher` account. Initial deployed commit: `d401aa4`.
- Runtime: `venv/bin/gunicorn -c gunicorn.conf.py run:app`, bound only to
  `127.0.0.1:8001`, under `benchmarkwatcher.service` with automatic restart
  and a 512 MB memory limit.
- Routing: the existing shared Caddy service proxies `benchmarkwatcher.online`
  to the app and redirects `www` to the apex. Caddy manages public TLS
  certificates directly. Preserve all sibling-site configuration.
- DNS: Namecheap BasicDNS A records for `@` and `www` both point to
  `89.167.29.166`. Nameservers and email-forwarding settings are unchanged.
- State: `.env`, `data/`, and `tmp/` live in the app directory. Keep `.env`
  private; preserve production data during code updates.
- Refresh: `benchmarkwatcher-fetch.timer`, daily at 06:30 UTC with up to
  ten minutes of jitter. The first fetch completed successfully. Fetch logs
  are private at `/home/benchmarkwatcher/fetch.log`; upstream errors can
  contain credentials, so do not print or publish raw logs.
- GitHub push-to-deploy is **not configured**. The existing workflow expects
  a different deployment user/path; pushing a commit does not update this host.

For an explicitly authorized update, check the server checkout is clean,
fetch and identify the release commit, then fast-forward as the app account:

```bash
runuser -u benchmarkwatcher -- git -C /home/benchmarkwatcher/app status --short
runuser -u benchmarkwatcher -- git -C /home/benchmarkwatcher/app pull --ff-only origin main
# Only if requirements.txt changed:
runuser -u benchmarkwatcher -- /home/benchmarkwatcher/app/venv/bin/pip install -r /home/benchmarkwatcher/app/requirements.txt
systemctl restart benchmarkwatcher
curl --fail --silent --show-error https://benchmarkwatcher.online/health
```

Recovery evidence: dashboard, health, list/detail APIs, commodity detail page,
and all ten dashboard JS/CSS assets returned 200 over public HTTPS. The list
contained 72 commodities; the internal API returned 403 without authentication.
The other four sites on the shared server remained available. No product-code
changes or unrelated local edits were deployed during recovery.

The outage was caused by DNS still pointing at Namecheap's expired Stellar
hosting (`198.54.116.96`), which returned a suspension redirect. The domain
registration itself remained active. The original shared proxy configuration
is saved at `/etc/caddy/Caddyfile.before-benchmarkwatcher-20260920` for reference;
roll back only this site's changes if sibling configuration has since changed.

## Historical provisioning plan

Move BenchmarkWatcher off Namecheap shared hosting (Passenger) onto a Hetzner
VPS running **gunicorn + systemd behind Caddy**, with **Cloudflare** in front for
DNS/CDN/SSL. This is the migration that actually fixes "the site isn't always
available" — see *Why this fixes the outages* at the bottom.

The same box hosts the rest of the fleet (the `sciencebo.uk` apps) — one €5
plan, not one per app. See *Adding sibling apps*.

```
            Cloudflare (DNS + CDN + WAF, orange-cloud)
                         │  Full (strict) TLS
                         ▼
   Hetzner VPS ──► Caddy :443 ──► /static/*  → served off disk
                         └──────► everything → gunicorn 127.0.0.1:8001
                                               (systemd: benchmarkwatcher.service)
   data/  ← daily systemd timer (fetch_daily_data.py)   tmp/flask_cache/ on disk
```

Repo artifacts this playbook uses: [`gunicorn.conf.py`](../gunicorn.conf.py),
[`deploy/`](../deploy), [`scripts/deploy_hetzner.sh`](../scripts/deploy_hetzner.sh),
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

> ⚠️ **The data is NOT in git.** `data/*.json` is gitignored ([.gitignore:41](../.gitignore))
> — a `git clone` gives you an **empty** `data/`. You must seed it once (Step 4)
> and let the fetch timer keep it fresh (Step 6). Skipping this = a site that
> boots fine but shows no commodities.

---

## Fast path — automated provisioning (recommended)

The manual Steps 0–7 below are collapsed into one idempotent provisioner
([`scripts/provision_hetzner.sh`](../scripts/provision_hetzner.sh)). Two ways to run it:

- **Cloud-init (zero SSH):** when creating the Hetzner server, paste
  [`deploy/cloud-init.yaml`](../deploy/cloud-init.yaml) into the *Cloud config* /
  user-data field. The box self-provisions on first boot; watch
  `/var/log/bw-provision.log`.
- **One command over SSH** (fresh Ubuntu 24.04 box):

  ```bash
  curl -fsSL https://raw.githubusercontent.com/alikatgh/benchmarkwatcher/main/scripts/provision_hetzner.sh | sudo bash
  ```

- **Create the box from the CLI too** (optional, needs the `hcloud` CLI + token):

  ```bash
  hcloud server create --name benchmarkwatcher --type cx22 --image ubuntu-24.04 \
    --ssh-key <your-key> --user-data-from-file deploy/cloud-init.yaml
  ```

Either path lands at: app running under systemd, Caddy installed and serving
`http://<IP>/health`, awaiting only your **`.env`**, **`data/`**, and the
**Cloudflare cert + DNS** — which the provisioner prints as NEXT STEPS. Jump to
[Step 3](#3-configure-env) (secrets), [Step 4](#4-seed-the-data-directory-the-gitignored-part)
(data), then [Step 7](#7-caddy--tls-behind-cloudflare)/[Step 8](#8-cloudflare-dns-cutover).

The manual walkthrough below is the fallback / reference for what the
provisioner automates.

---

## 0. Provision the box (one-time, ~5 min)

1. Hetzner Cloud Console → create a server: **CX22** (Intel, 2 vCPU / 4 GB) or
   **CAX11** (ARM, cheaper) — either is fine; ARM is fine for pure-Python Flask.
   Image: **Ubuntu 24.04**. Add your SSH key.
2. Note the public IPv4 — call it `<SERVER_IP>`.

```bash
ssh root@<SERVER_IP>

# Non-root deploy user + the runtime
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

apt update && apt install -y python3-venv python3-pip git curl

# Caddy (reverse proxy + TLS)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Firewall — only SSH + web. (Cloudflare reaches :443; keep :80 for redirects.)
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

> **Lock origin to Cloudflare (recommended, do after Step 7 works):** once
> traffic flows through Cloudflare, restrict :80/:443 to Cloudflare's IP ranges
> so nobody can hit the origin directly and bypass the WAF. Pull the ranges from
> `https://www.cloudflare.com/ips/` and replace the blanket allow-80/443 with
> per-range `ufw allow from <range> to any port 443`.

---

## 1. Get the code

```bash
sudo -iu deploy        # become the deploy user
git clone https://github.com/<owner>/benchmarkwatcher.git ~/benchmarkwatcher
cd ~/benchmarkwatcher
```

## 2. Virtualenv + dependencies

```bash
python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt    # now includes gunicorn
```

## 3. Configure `.env`

`.env` is gitignored — create it on the box (copy values from the current
Namecheap `.env`, or from `.env.example`):

```bash
cp .env.example .env
nano .env   # set FRED/EIA/USDA API keys, INTERNAL_API_KEY, SECRET_KEY, rate limits
```

Generate a stable `SECRET_KEY` (otherwise it's randomised per boot, logging
users out on every restart):

```bash
echo "SECRET_KEY=$(venv/bin/python -c 'import secrets; print(secrets.token_hex(32))')" >> .env
```

## 4. Seed the data directory (the gitignored part)

Pick whichever source you have access to. From your **local machine** (where a
populated `data/` already exists) is simplest:

```bash
# from your laptop, in the repo root:
rsync -avz --include='*.json' --exclude='*' data/ deploy@<SERVER_IP>:~/benchmarkwatcher/data/
```

Or pull straight from the **old Namecheap host** (cPanel SSH, port 21098):

```bash
rsync -avz -e 'ssh -p 21098' \
  alikvdct@server111.web-hosting.com:~/benchmarkwatcher/data/ \
  ~/benchmarkwatcher/data/
```

Or, if you have the API keys and would rather regenerate from scratch:

```bash
venv/bin/python scripts/fetch_daily_data.py
```

Sanity check: `ls ~/benchmarkwatcher/data/*.json | wc -l` should be ~70+.

## 5. Install the app service

```bash
exit   # back to root (or use sudo)
cp /home/deploy/benchmarkwatcher/deploy/benchmarkwatcher.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now benchmarkwatcher

# Let the deploy user restart it without a password (used by the deploy script)
cat >/etc/sudoers.d/benchmarkwatcher <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart benchmarkwatcher
EOF

# Verify the app answers locally (before any DNS/proxy):
curl -sI http://127.0.0.1:8001/health    # expect HTTP/1.1 200
journalctl -u benchmarkwatcher -n 30 --no-pager   # if not 200, the traceback is here
```

## 6. Install the daily data fetch timer

```bash
cp /home/deploy/benchmarkwatcher/deploy/benchmarkwatcher-fetch.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now benchmarkwatcher-fetch.timer
systemctl list-timers benchmarkwatcher-fetch   # confirm next run
systemctl start benchmarkwatcher-fetch.service  # optional: run once now
```

## 7. Caddy + TLS (behind Cloudflare)

**Issue a Cloudflare Origin certificate** (most reliable TLS when proxied):
Cloudflare dashboard → SSL/TLS → **Origin Server** → *Create Certificate*
(default: covers `benchmarkwatcher.online` + `*.benchmarkwatcher.online`, 15 yr).
Save the two PEM blocks onto the box:

```bash
mkdir -p /etc/caddy/cf-origin
nano /etc/caddy/cf-origin/benchmarkwatcher.crt   # paste the certificate
nano /etc/caddy/cf-origin/benchmarkwatcher.key   # paste the private key
chmod 600 /etc/caddy/cf-origin/benchmarkwatcher.key

cp /home/deploy/benchmarkwatcher/deploy/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

> Prefer Let's Encrypt? Delete the `tls` line in the Caddyfile, **grey-cloud**
> the DNS record (Step 8) for the first issuance so Caddy's ACME challenge
> reaches the box, then re-enable the orange cloud.

## 8. Cloudflare DNS cutover

In the Cloudflare dashboard for `benchmarkwatcher.online`:

1. **DNS → Records:** point the apex (and `www` if used) at the box:
   - `A  @   <SERVER_IP>  Proxied (orange cloud)`
   - `A  www <SERVER_IP>  Proxied`  (or a CNAME to `@`)
   - **Lower the TTL to ~2 min a few hours *before* cutover** so you can roll
     back fast.
2. **SSL/TLS → Overview → Full (strict)** (matches the Origin cert from Step 7).
3. **Caching:** static assets are already on a long `?v=<mtime>` cache-bust, so a
   default cache rule is safe. Optionally add a cache rule for `/static/*`
   (Edge TTL a month) to lean on Cloudflare's CDN.
4. If the domain still uses **Namecheap nameservers**, switch the domain to
   **Cloudflare's nameservers** (Cloudflare shows the two assigned ones) in the
   Namecheap dashboard → *Domain → Nameservers → Custom DNS*. Propagation is
   usually minutes to a couple of hours.

**Verify the cutover:**

```bash
curl -sI https://benchmarkwatcher.online/health | head -1   # HTTP/2 200
curl -s  https://benchmarkwatcher.online/health             # JSON ok
# Confirm Cloudflare is in front (expect a cf-ray / server: cloudflare header):
curl -sI https://benchmarkwatcher.online/ | grep -i 'cf-ray\|server'
```

## 9. Monitoring (so the next outage pages you, not lurks for months)

Point any uptime monitor (UptimeRobot free tier works) at
`https://benchmarkwatcher.online/health`, 1–5 min interval, alert on non-200.
This is the gap that let the last Namecheap outage run for months unnoticed.

---

## Rollback (if anything looks wrong post-cutover)

DNS-level, fastest: in Cloudflare, point the `A` records back at the **old
Namecheap host IP** (or restore Namecheap nameservers). Because you lowered TTL
in Step 8, this propagates in ~minutes. The old Namecheap app is untouched by
this migration, so it's a live fallback until you decommission it.

## Ongoing deploys

- **Manual / on the box:** `cd ~/benchmarkwatcher && ./scripts/deploy_hetzner.sh`
  (pulls, reinstalls deps only if `requirements.txt` changed, restarts,
  health-gates).
- **Automatic (push-to-deploy):** set the four `HETZNER_*` repo secrets, then
  every merge to `main` deploys itself (see
  [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)). Use a
  **dedicated deploy keypair**, not your personal key:

  ```bash
  # on your laptop: make a dedicated CI deploy key
  ssh-keygen -t ed25519 -f ~/.ssh/bw_deploy_ci -N "" -C "github-actions-deploy"

  # authorise its public half on the box (one time)
  ssh-copy-id -i ~/.ssh/bw_deploy_ci.pub deploy@<SERVER_IP>

  # store the secrets (run from the repo checkout)
  gh secret set HETZNER_HOST     --body "<SERVER_IP>"
  gh secret set HETZNER_USER     --body "deploy"
  gh secret set HETZNER_SSH_PORT --body "22"
  gh secret set HETZNER_SSH_KEY  < ~/.ssh/bw_deploy_ci   # the PRIVATE key
  ```

  Until these are set, the workflow runs green and no-ops (it guards on
  `HETZNER_HOST`), so it's safe to have merged already.

## Adding sibling apps (the rest of the €5 box)

Per app: clone it, give it its **own loopback port** (8002, 8003, …) and its own
`*.service`, then add a Caddy block (uncomment the template at the bottom of
[`deploy/Caddyfile`](../deploy/Caddyfile)) and `systemctl reload caddy`. Set
`MemoryMax=` on each service so one misbehaving app can't OOM-kill the others —
the per-app resource control Namecheap shared hosting never gave you.

**Suggested port map for the current fleet** (apps from
`docs/NAMECHEAP_DEPLOY.md`; confirm each unknown type on the old host with
`grep -o 'PassengerAppType \w*' ~/<app>/.htaccess`):

| App dir | Domain | Port | Type |
|---|---|---|---|
| `benchmarkwatcher` | benchmarkwatcher.online | 8001 | Flask/gunicorn ✓ (this guide) |
| `llms.sciencebo.uk` | llms.sciencebo.uk | 8002 | Node/Express |
| `api.sciencebo.uk` | api.sciencebo.uk | 8003 | confirm |
| `aulenor.sciencebo.uk` | aulenor.sciencebo.uk | 8004 | confirm |
| `bookmarks.sciencebo.uk` | bookmarks.sciencebo.uk | 8005 | confirm |
| `sciencebo.uk` | sciencebo.uk | 8006 | confirm |
| `formulas-backend` | (domain TBD) | 8007 | confirm |

Node apps don't use gunicorn — their service `ExecStart` runs the app's own
entry (`node …` / `npm start`); the Caddy block and `MemoryMax=` pattern are
identical. Each app keeps its own deploy script in its own repo — only the
shared `/etc/caddy/Caddyfile` and the per-app `*.service` live on the box.

---

## Why this fixes the outages (maps to the documented root causes)

| Namecheap failure (see DEPLOY_RECOVERY / NAMECHEAP_DEPLOY) | Fixed here by |
|---|---|
| Intermittent 503, "Reached max children" — static routed through the tiny worker pool | Caddy serves `/static/*` off disk; gunicorn only handles app routes |
| Host-500 for months — hand-managed Passenger venv lost a dependency | `requirements.txt` reinstalled into a clean venv on deploy; capped majors; health-gated |
| Prod months-stale — pushing to `main` didn't deploy | `deploy.yml` ships every merge to `main` |
| Outage unnoticed for months | `Restart=always` auto-recovers; uptime monitor on `/health` alerts |
| One account's resource caps shared across all apps | Your own box; per-service `MemoryMax`/CPU limits you control |

`FileSystemCache` (config.py) and `memory://` rate limiting keep working as-is on
a single always-on instance. The only multi-worker nuance: `memory://` limits
count per gunicorn worker (2 here), exactly as they did across Passenger workers
— set `RATELIMIT_STORAGE_URI=redis://…` if you ever need exact global limits.
