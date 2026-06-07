# /lint-fix [scope]

## Purpose
Run code quality tools (linter + formatter) and auto-fix everything fixable.

## Steps

1. **Detect toolchain** from project files:
   - `biome.json` → `npx biome check --write .`
   - `eslint.config.*` / `.eslintrc*` → `npx eslint . --fix` (+ prettier if configured)
   - `.ruff.toml` / `pyproject.toml [tool.ruff]` → `ruff check --fix . && ruff format .`
   - `go.mod` → `gofmt -w . && go vet ./...`
   - `Makefile` with `lint` target → `make lint`

2. Run detected toolchain with auto-fix mode.

3. Report:
   ```
   Code Quality
   ────────────
   Tool:     [detected linter/formatter]
   Fixed:    X files
   Errors:   Y remaining
   Warnings: Z remaining
   ```

4. If errors remain after auto-fix: list each with `file:line — message`.

## Arguments
- Optional: `--check` — report only, do not write changes.

## Rules
- Do not modify linter/formatter config files.
- Formatting disagreements are auto-fixed; do not flag them as issues.
