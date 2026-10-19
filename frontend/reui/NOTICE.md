# ReUI source provenance

These free, copy-and-own Radix components and selected Nova styles come from
[Keenthemes ReUI](https://github.com/keenthemes/reui), pinned to
`067aa0dc7f8bbfec1cd76fc5ad31f842be5f569a` (2026-10-16). The MIT copyright and
permission notice is preserved in [LICENSE](LICENSE).

Upstream paths are `registry/bases/radix/ui/*.tsx` and
`registry/styles/style-nova.css`. Changes here resolve imports and Lucide icon
placeholders, expose themed portal containers, and remove dialog translation
utilities that collide with the existing Tailwind 3 bundle. `utils.ts`, islands,
and product-specific styles are BenchmarkWatcher integration code.

The ReUI build uses React 19 and a separate Tailwind 4 compiler. It omits global
preflight, scopes selectors to `.reui`, maps colors to the six existing product
themes, and emits same-origin production assets. It uses no remote runtime,
premium items, license key, external telemetry, or hosted service.

Run `npm run check:ui`, `npm run build:ui`, and `npm run test:ui` after edits.
The older Tailwind 3 `npm run build:css` remains a separate build.
