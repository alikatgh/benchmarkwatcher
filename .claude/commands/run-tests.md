# /run-tests [scope]

## Purpose
Run the project test suite and report results clearly.

## Steps

1. **Detect test runner** from project files:
   - `package.json` → check `scripts.test`; vitest → `npx vitest run`, jest → `npx jest`
   - `pyproject.toml` / `setup.py` / `requirements.txt` → `python -m pytest -v`
   - `go.mod` → `go test ./...`
   - `Makefile` with `test` target → `make test`
   - Multiple runners (monorepo) → run each in sequence

2. Run detected suite(s). Capture all output.

3. Report:
   ```
   Test Results
   ────────────
   Runner:   [detected runner]
   Passed:   X
   Failed:   Y
   Skipped:  Z
   Duration: Xs
   ```

4. If tests failed: show the full failure output for each failing test.

## Arguments
- Optional: `client`, `server`, `all`, or a path/glob — Claude adapts.
- Optional: `--coverage` — include coverage report where supported.

## Rules
- Do not modify test files.
- Do not retry failing tests. Report failures and stop.
- If `node_modules` / venv is missing, run installer first and note it.
