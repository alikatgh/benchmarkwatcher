# /go [task description]

## Purpose
Smart agent dispatcher. Reads your task, picks the best agent/skill, shows
token cost + dollar estimates as clickable buttons, and waits for your
confirmation before doing anything.

A PreToolUse hook in settings.json enforces this — any Agent launch attempted
WITHOUT a /go approval ticket is automatically blocked.

---

## Steps

1. Read the task description (or ask "What do you want to do?" if none given).
2. Classify the intent using the routing table below.
3. Pick the best agent + up to 3 alternatives.
4. **Call `AskUserQuestion`** with the options (format below).
5. Wait for the user's selection.
6. **Write the approval ticket** so the hook lets the agent through:
   ```bash
   touch /tmp/.claude_go_approved
   ```
   Run this via Bash immediately after the user clicks — before launching.
7. Launch exactly what they picked.
   - If they pick "No agent / manual": explain what to do themselves, stop.
   - If they pick "Other": ask a clarifying question, then re-route.

---

## AskUserQuestion format

```
question:    "[one-line restatement of the task] — which approach?"
header:      "Agent"
multiSelect: false

options:
  1. label:       "[Best agent/skill] (Recommended)"
     description: "~[X]k tokens ≈ $[Y] — [why it fits this exact task]"

  2. label:       "[Cheaper / faster alternative]"
     description: "~[X]k tokens ≈ $[Y] — [trade-off]"

  3. label:       "[Different approach]"
     description: "~[X]k tokens ≈ $[Y] — [trade-off]"

  4. label:       "No agent / manual"
     description: "~0 tokens, $0 — I'll explain what to do yourself"
```

Always put the recommended option first. Never exceed 4 options.

---

## Routing table

| Intent signal | Best agent/skill | Tokens | ≈ $ |
|--------------|-----------------|--------|-----|
| "find", "where is", "search", "which file" | `Explore` agent | 5–15k | ~$0.05 |
| "plan", "design architecture", "what approach" | `Plan` agent | 10–25k | ~$0.10 |
| "review this file", single component | `/dan-review [file]` | 15–30k | ~$0.12 |
| specific bug, error, failing test, stack trace | `bug-fixer` agent | 20–50k | ~$0.18 |
| "security", "is this safe", auth/XSS/injection | `/security-scan` | 25–50k | ~$0.20 |
| PR diff, "review the changes", 3–5 files | `code-strength` | 30–60k | ~$0.23 |
| "audit the UI", screens, mobile layout | `/audit-ui` | 30–60k | ~$0.23 |
| "fix tracked issues", P0/P1 in KNOWN_UI_DEBT | `/batch-fix` | 50–200k | ~$0.60 |
| "find all bugs", memory leaks, race conditions | `/bug-sweep` | 40–80k | ~$0.30 |
| "review the PR", large diff, many files | `code-review --effort low` | ~80k | ~$0.40 |
| "performance", bundle size, slow renders | `/perf-audit` | 20–40k | ~$0.15 |
| "accessibility", WCAG, screen readers | `/a11y-audit` | 15–30k | ~$0.12 |
| "design a screen", write spec | `/design-screen` | 20–40k | ~$0.15 |
| "implement from spec", build the screen | `/implement-screen` | 30–80k | ~$0.28 |
| "full bug hunt", whole codebase, parallel | `/bug-hunt` | 100–300k | ~$1.00 |
| "full redesign", multiple screens | `/ralph-redesign` | 80–200k | ~$0.70 |

---

## Dollar cost formula
*Claude Sonnet ~$5 per 1M tokens blended average.*

| Tokens | ≈ Cost |
|--------|--------|
| 10k | $0.05 |
| 30k | $0.15 |
| 60k | $0.30 |
| 100k | $0.50 |
| 200k | $1.00 |
| 500k | $2.50 ⛔ |

---

## Ticket mechanism (how the hook knows /go approved this)

After the user clicks their choice, before launching:
```bash
touch /tmp/.claude_go_approved
```
The `agent-gate.sh` hook checks for this file. If it exists and is < 120s old,
the agent call is allowed and the ticket is deleted. If no ticket exists, the
agent is blocked with a message directing back to /go.

`Explore` is always allowed (free) — no ticket needed.

---

## Rules

- **Always use AskUserQuestion. Never launch an agent without showing options first.**
- **Always write the ticket before launching.** Forgetting it = the hook blocks the call.
- Never list `code-review --effort max` as recommended or alternative. If user
  explicitly asks for it, show it as option 4 with: `"~500k tokens ≈ $2.50 ⛔ — forbidden if code-strength already ran"`
- If trivially free (single grep, read one file): skip the router, just do it.
- If task is ambiguous: use AskUserQuestion to ask ONE clarifying question first.
