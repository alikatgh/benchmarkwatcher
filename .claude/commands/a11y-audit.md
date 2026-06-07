# /a11y-audit [scope]

## Purpose
Accessibility audit against WCAG 2.1 AA. Check keyboard navigation, screen reader support, ARIA patterns, color contrast, and touch targets.

**Every issue found gets logged to `docs/KNOWN_UI_DEBT.md` as A11Y-* issues so they can be fixed by `/fix-gap` or `/batch-fix`.**

## Arguments
- Optional: file path, component name, `forms`, `navigation`, `media`, or `all`. Defaults to `all`.

## Checks

### 1. Keyboard Navigation
Focus management in modals, tab order, skip links, custom components using `<button>` not `<div onClick>`, `:focus-visible` styles.

### 2. Screen Reader Support
Semantic HTML (`<nav>`, `<main>`, `<article>`), heading hierarchy, ARIA labels on interactive elements, `aria-live` for dynamic content, form labels, image alt text, icon button names.

### 3. Touch & Mobile
Touch targets ≥ 44x44px, spacing between targets, gesture alternatives, pinch/zoom not disabled.

### 4. Visual
Color contrast 4.5:1 ratio (both themes), color not sole indicator, `prefers-reduced-motion` respected, text readable at 200% zoom, dark mode contrast.

### 5. Forms
Error association via `aria-describedby`, destructive action confirmation, `aria-required`, `autocomplete` attributes, validation timing.

### 6. Dynamic Content
Loading states announced to screen readers, toasts use `role="alert"`, page title updates on navigation, infinite scroll accessible.

## Output Format

Print the audit, THEN log issues.

```
## Accessibility Audit (WCAG 2.1 AA)

### 🔴 Critical (blocks users)
| # | Criterion | Location | Issue | Fix |

### 🟡 Important (degrades experience)
| # | Criterion | Location | Issue | Fix |

### 🟢 Enhancement
| # | Criterion | Location | Issue | Fix |

### ✅ Already Good
[List correct a11y patterns]

### Summary
- WCAG 2.1 AA compliance: [estimated %]
```

## Post-Audit: Log Issues to KNOWN_UI_DEBT.md (MANDATORY)

After printing, WRITE every issue to `docs/KNOWN_UI_DEBT.md`.

### Severity mapping
- 🔴 Blocks users (no keyboard access, missing labels) → **P0**
- 🟡 Degrades experience (poor contrast, missing live regions) → **P1**
- 🟢 Enhancement (better semantics, skip links) → **P2**

### Issue ID format: `A11Y-001`, `A11Y-002`, etc.

### Each issue entry:
```markdown
### A11Y-XXX: [issue title]
- **Priority:** P0 / P1 / P2
- **File:** [relative path]:[line number]
- **WCAG Criterion:** [e.g., 4.1.2 Name, Role, Value]
- **What:** [1-2 sentence description]
- **Fix:** [concrete fix — which element to change, which ARIA to add]
- **Status:** open
- **Found:** [YYYY-MM-DD]
```

### After writing:
1. Print: `Logged X issues to KNOWN_UI_DEBT.md (A11Y-XXX through A11Y-YYY)`
2. Tell user: `Run /fix-gap A11Y-XXX for one at a time, or /batch-fix for all P0/P1.`

## Rules
- Read actual component code. Don't assume.
- Reference WCAG 2.1 criteria by number.
- Mobile-first: touch targets and VoiceOver/TalkBack matter most.
- Check `sr-only` utility usage.
- Check contrast in BOTH light and dark themes.
- Less ARIA is better ARIA — prefer semantic HTML.
- **Never skip the logging step.**
