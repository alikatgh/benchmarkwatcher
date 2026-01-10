# BenchmarkWatcher UI Vocabulary Rules

> This document is for **contributors and maintainers**, not end users.
> It defines the semantic boundaries that must be preserved in all UI text.

## Allowed Terms

Use these terms freely in UI labels, tooltips, and descriptions:

| Category | Allowed Terms |
|----------|---------------|
| **Data description** | observation, displayed data, recorded value |
| **Change metrics** | change (absolute / percent), difference |
| **Time references** | recent, extended, full history, as of [date] |
| **Direction** | direction, movement, up/down indicator |
| **Ranges** | observation span, data window |

## Explicitly Forbidden Terms

**Never use these in UI text:**

| Forbidden | Why |
|-----------|-----|
| return | Implies investment performance |
| performance | Implies analytical assessment |
| trend | Implies predictive pattern |
| signal | Implies trading advice |
| forecast / prediction | Implies future knowledge |
| outperform / underperform | Implies relative investment merit |
| buy / sell / trade | Implies investment recommendation |
| recommend / suggest | Implies advisory role |
| profit / loss | Implies investment outcome |
| invest / investment | Implies advisory purpose |

## Rationale

BenchmarkWatcher is a **reference display tool**, not an analytical or advisory product.

The UI must:
- Present historical observations without editorial interpretation
- Avoid language that could be construed as investment advice
- Maintain alignment with the legal disclaimer

## Enforcement

- Automated tests in `tests/e2e/disclaimer-safety.spec.ts` scan for forbidden terms
- All PRs should be reviewed against this vocabulary
- When in doubt, use more neutral language

## Examples

### ✓ Correct
- "Price changed by +2.5% over recent observations"
- "Displayed as of 2026-01-10"
- "Direction: upward movement"

### ✗ Incorrect
- "Strong upward trend indicates..."
- "Outperforming competitors..."
- "Consider buying when..."

---

*Last updated: 2026-01-10*
