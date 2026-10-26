# ReUI web UI adoption

The web app uses selected free ReUI components in React islands, with Flask
routes and existing data controllers retained. Native apps, D3 charts, numerical
tables, workbook calculations, and source diagrams keep their current renderers.
This is selective adoption, not a claim that every control is a React component.

Source revision and license: [frontend/reui/NOTICE.md](../frontend/reui/NOTICE.md).
ReUI's current installation documentation requires React 19 and Tailwind 4;
the separate scoped build protects the app's existing Tailwind 3 styles.

| Family / consumers | Component and integration | Verification contract |
| --- | --- | --- |
| Shared global search, all web routes | ReUI Command, Dialog, InputGroup, Button, Badge, Empty | Catalog and private-note search; keyboard selection; loading, error/retry, empty state; detail handoff; opener focus; real links and modifier clicks |
| Shared display settings | ReUI Dialog, ToggleGroup/Toggle, Separator, Button | Six themes, three historical-change palettes, browser persistence, focus trap/return, responsive previews |
| Table category/frequency/availability/direction/watch filters | ReUI Select; original fields remain controller inputs | Filter result counts, saved views, native mobile sheet, Escape and option selection |
| Saved-view picker and row density | ReUI Select | Existing view IDs, selection, option mutation, density and persistence |
| Library, company data, references, source catalog GET filters | ReUI Select; Popover/Command for lists over 12 options | Original field names, GET submission, server validation, selected values after navigation |
| Library and reference history range/chart type | ReUI Select | Existing `change` handlers, chart values, units, source flags and exact-value readouts |
| Table rows, sorting/property editor, selection, chips, saved-view dialog and exports | Existing controllers retained | These own mutable/reparented DOM and saved-work contracts. Replacing them requires a separate complete controller boundary |
| Company discovery, reports, authentication and AI consent | Existing forms/controllers retained | Async request ordering, CSRF, authentication, calculations and explicit provider consent remain in their established workflows |
| Sidebar, quick visuals, chart settings and detail drawer | Existing product components retained | Navigation/history, D3 rendering, resizing, export and focus lifecycle remain owned by existing controllers |

`frontend/reui/native-select.tsx` enhances only the explicit stable selector
allowlist. It keeps the original named select for submission and controller
events, excludes ReUI's own hidden fields, synchronizes mutations and table
state events, and disposes roots when their source field is removed. Portals
stay in the closest open native dialog when needed for top-layer access.

The original search/settings and native selects remain a fallback if the new
bundle does not load. No server or provider behavior changes. Static assets are
checked in for the existing Flask release workflow; deployment needs both
`app/static/css/reui.css` and `app/static/js/components/reui.js`.

Verification commands:

```sh
npm run check:ui
npm run build:ui
PLAYWRIGHT_CHANNEL=chrome npm run test:ui
npm run check:vocab
npm test -- --runInBand
```

Browser checks use synthetic local data and simulated providers. Responsive web
checks do not establish behavior in the native mobile apps. This source change
does not itself publish or deploy the application.

Verified locally on 2026-10-19: all 11 ReUI browser workflows passed, including
both dialogs' WCAG checks in all six themes, 320/390/1440px layouts, mobile
Escape/Back cleanup, duplicate saved-view names, modified links, GET forms and
bundle-unavailable fallback. All 49 existing Jest suites (463 tests) passed;
the three affected settings suites (17 tests) passed again after the radio
semantics fix. A deterministic theme-change regression and the six-theme
accessibility checks passed five repetitions after removing reduced-motion color
interpolation. Type checks, production build reproducibility, vocabulary and the
production dependency audit passed. History chart selection was checked against
the synthetic library with the readout preserved and no page errors.

Independent review findings about duplicate labels and single-child composition
were fixed and rechecked. CI rebuilds the assets and runs these workflows alongside the existing suites.
Changed integration scripts use versioned URLs so returning browsers receive
the matching search and settings controllers.

Review images use explicitly synthetic observations:
[desktop search](readme-media/reui/search-desktop.png) ·
[mobile settings](readme-media/reui/settings-mobile.png).
