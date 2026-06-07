# /session-end

## Purpose
Close the session cleanly. Save state before context is lost.

## Steps

1. **Pre-close checks** (suggest if not already done this session):
   - Code was modified? → suggest lint + tests.
   - New dependencies added? → suggest lock file commit.

2. **Update `SESSION_STATE.md`** (create if missing):
   - What was completed this session
   - Any new open issues discovered
   - Next recommended action

3. **Append to `testing/JOURNAL.md`** (create `testing/` dir and file if missing):
   ```
   ## Entry NNN — [short title]
   **Date:** YYYY-MM-DD
   **What happened:** [what was done]
   **Key finding:** [what was learned]
   **Decision made:** [any concrete change or conclusion]
   **Why this matters for future sessions:** [only if non-obvious]
   ```

4. Suggest commit if uncommitted changes exist.

5. Confirm: "Session state saved. Safe to close."
