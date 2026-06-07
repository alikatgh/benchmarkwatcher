# CRITICAL OPERATIONAL RULES

## 1. Delete Audit Protocol
**BEFORE running `rm` or deleting ANY file, you MUST:**
1. Check `git status` — is the file tracked or has uncommitted changes?
2. Check content — `head -n 5 <filename>`.
3. Temp file (log, cache, .pyc)? → **SAFE to delete.**
   Source code (.py, .js, .md) that implies work? → **STOP.** Ask for confirmation.
   Empty file (0 bytes)? → **SAFE to delete.**
4. If less than 100% sure: **DO NOT DELETE. Ask.**

## 2. Terminal Command Restrictions
- **FORBIDDEN:** `rm -rf /`, `rm -rf ~`, `rm -rf .`
- **REQUIRES APPROVAL:** `git reset --hard`, `git clean`, `git push --force`
- **ALLOWED:** `npm install`, `pip install`, `ls`, `cat`, `grep`, `find`, `git status`, `git diff`

## 3. Development Behavior
- **PLAN FIRST:** If a task involves editing more than 3 files, propose a plan first.
- **NO HALLUCINATIONS:** Do not invent file paths. Check `ls` if unsure a file exists.
- **TESTS:** Do not delete failing tests. Fix them.

## 4. Emergency Brake
- If you catch yourself about to do something destructive without an audit, STOP.
- Ask: "⚠️ [DESTRUCTIVE ACTION] I want to delete <file>. Audit shows it contains <content>. Proceed? (y/n)"

## 5. Audit Tool Budget — Non-Negotiable

**One session burned 600k tokens running `code-review --effort max` on an already-audited branch and found 2 cosmetic non-bugs. This rule exists so that never happens again.**

**The ladder — cheapest first, stop when satisfied:**

| Tool | Approx tokens | When to use |
|------|---------------|-------------|
| `code-strength` on 3–5 files | 30–60k | First pass, always |
| `code-review --effort low` | ~80k | When code-strength found real bugs |
| `code-review --effort medium` | ~150k | Explicit user request only |
| `code-review --effort max` | 400–600k | FORBIDDEN after code-strength ran |

**Hard stops — check before running any audit:**

1. Was `code-strength` already run this session on these files? → **stop. You are done.**
2. Tests pass + lint clean + code-strength ran? → **the branch is ready. Say so.**
3. `code-review --effort max` is **FORBIDDEN** on any already-audited branch. No exceptions.
4. If the user explicitly requests `--effort max`: warn of the token cost (~500k) and require confirmation.

**When the branch is clean: say "ready to merge." Do not invent more work.**

## Available Skills (25 slash commands)

Run any skill by typing `/skill-name` in Claude Code.

### Session Management
| Skill | Purpose |
|-------|---------|
| `/session-start` | Load context, report state, ask for session goal |
| `/session-end` | Save SESSION_STATE + JOURNAL, suggest commit |
| `/next` | One recommended next action based on project state |

### Audit & Fix
| Skill | Purpose |
|-------|---------|
| `/audit-ui` | Full UI audit → SCREEN_INVENTORY + KNOWN_UI_DEBT |
| `/security-scan [client\|server]` | OWASP Top 10 audit → logs SEC-* issues |
| `/env-check` | Missing vars, hardcoded secrets, client/server alignment → ENV-* |
| `/api-audit` | Route auth, validation, rate limiting, consistency → API-* |
| `/api-contract` | Validate frontend API calls match backend routes |
| `/fix-gap [id]` | Fix one tracked issue from KNOWN_UI_DEBT.md |
| `/batch-fix` | Fix all P0/P1 issues in one pass with quality gate |

### Code Review & Refactor (React / TypeScript)
| Skill | Purpose |
|-------|---------|
| `/dan-review [file]` | Code review via Dan Abramov's 10 mental models → DAN-* |
| `/dan-refactor [file]` | Structural refactor — fix cascades, derive state, clean flow |
| `/dan-verify [file]` | Post-refactor verification — behavior preserved, deps intact |
| `/dan-think [question]` | Architecture reasoning — state placement, context vs props |

### Quality
| Skill | Purpose |
|-------|---------|
| `/run-tests [scope]` | Run test suite (vitest/jest/pytest/go test — auto-detected) |
| `/lint-fix [scope]` | Auto-fix linter + formatter (biome/eslint/ruff — auto-detected) |
| `/perf-audit` | Bundle size, re-render hotspots, data fetching |
| `/a11y-audit` | WCAG 2.1 AA — keyboard, screen readers, contrast, ARIA |

### Bug Hunting
| Skill | Purpose |
|-------|---------|
| `/bug-sweep [path]` | Deep React bug scan — leaks, stale closures, race conditions |
| `/bug-hunt [scope]` | Parallel agent bug hunt across the full codebase |

### Design Workflow
| Skill | Purpose |
|-------|---------|
| `/design-screen [name]` | Write screen spec to `docs/screens/` |
| `/implement-screen [name]` | Implement from spec |
| `/critique-screen [name]` | Visual + UX assessment → artifacts/reviews/ |
| `/ralph-redesign` | Bounded screenshot-loop redesign (max 5 iterations) |

### Deployment
| Skill | Purpose |
|-------|---------|
| `/deploy-check` | CI status + live URL health check (read-only) |

---

## Fan-out economics — a worked example (build the instinct)

Before you fan out N agents / a Workflow, pattern-match against this real case.

EXAMPLE — same task (reskin 17 files: swap CSS classes, keep the copy), two ways:

  ✗ WHAT WE DID — one agent per file:
      parallel(pages.map(p => agent("reskin page " + p)))      # 17 agents
    Each agent re-read its 400–1000-line template AND the SAME shared CSS engine
    AND re-derived the SAME class mapping, then self-verified.
    → ~1.3M tokens (~$6.50), ~76k/agent  (estimated 250–400k — 3–5× off).

  ✓ SAME RESULT, a fraction of the cost:
    1. CASCADE FIRST — one edit to the shared engine + global stylesheet restyled
       ALL 17 pages at once (~80% of the win, tens of k tokens): a shared rule
       cascades to every consumer for free.
    2. RESIDUE (mechanical class swaps) — a sed/codemod pass (≈free), OR ONE agent
       given the mapping + file list doing all 17 in a single context (engine read
       ONCE, not 17×).

THE TELL: the per-item work was MECHANICAL + UNIFORM and every agent re-paid for
the SAME shared context. That shape — uniform transform + shared context re-read
N times — means a fleet is the wrong tool. Fan-out is for items that each need
INDEPENDENT reasoning (e.g. "find the bug in THIS subsystem"), not stamping one
transform across N files.

THE CHECK before any fan-out over N items:
1. Exhausted the shared/cascade layer first? (one rule beats N agents.)
2. Each item mechanical/uniform? → batch / script / cheaper model, not N top agents.
3. Estimate `(avg file + shared-context + verify) × N` (~75k/file). Compute & SHOW it.
4. Keep the cheap central verify (compile / lint / grep); generation is the overpriced half.

Rule of thumb: mechanical + uniform + shared-context-heavy → cascade or one batched
pass, NEVER one-agent-per-item. Full version: `~/.claude/CLAUDE.md` §4c.
