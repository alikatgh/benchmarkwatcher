# /session-start

## Purpose
Orient for a new work session. Load context, report current state, confirm goal.

## Steps

1. Read `SESSION_STATE.md` if it exists. Otherwise read `README.md` for project orientation.
2. Read `testing/JOURNAL.md` (last 3 entries) if it exists, otherwise recent `git log --oneline -10`.
3. Report current status:
   - What was last worked on
   - Open issues from `docs/KNOWN_UI_DEBT.md` (count by priority)
   - Uncommitted changes (`git status`)
4. Show available skills grouped by workflow:
   ```
   Available skills:
     Quality:    /run-tests  /lint-fix
     Audit/Fix:  /audit-ui  /security-scan  /fix-gap [id]  /batch-fix
     Code:       /dan-review [file]  /dan-refactor [file]  /dan-think [question]
     Design:     /design-screen  /implement-screen  /critique-screen  /ralph-redesign
     Infra:      /env-check  /deploy-check
     Session:    /next  /session-end
   ```
5. Ask: "What's the goal for this session?"

## Output
Brief status (5–8 lines), skill overview, then one question about the session goal.
