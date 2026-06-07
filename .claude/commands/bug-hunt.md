# /bug-hunt [scope]

Launch parallel Sonnet agents to find bugs, crashes, and broken UX across the entire Circles app. Each agent focuses on a different area, reads the actual code, and reports concrete bugs with file paths and line numbers.

Every bug found gets logged to `docs/KNOWN_UI_DEBT.md` with a `BUG-` prefix so it can be fixed by `/fix-gap`, `/batch-fix`, or `/dan-refactor`.

## Arguments
- Optional: `[scope]` — limit to an area: `client`, `server`, `chat`, `payments`, `auth`, or a path like `components/media`. Default: full app.

---

## How to run

Launch ALL of the following agents in parallel using `model: "sonnet"`. Each agent gets one area. There are **15 agents** — launch every single one, do not skip any.

### Agent 1 — Routing & Navigation
Search for: broken routes, missing error boundaries, bad redirects, components that crash on missing params, `useParams`/`useSearchParams` without validation, links to nonexistent routes, Capacitor deep-link handling gaps.
- Read `client/src/main.jsx` for route definitions
- Read `client/src/pages/` — every page component
- Check every `navigate()` and `<Link>` call across `client/src/`
- Check `useSmartBack.js` and `useNavigationDirection.js` for edge cases

### Agent 2 — Auth & Session
Search for: token storage vulnerabilities, stale auth state after expiry, missing 401 handling, auth context leaks between accounts, sign-up/login flows that fail silently, password reset race conditions, Apple/Google OAuth callback edge cases.
- Read `client/src/context/AuthContext.jsx` fully
- Read `client/src/pages/Login.jsx`, `Signup.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `AuthCallback.jsx`
- Read `client/src/hooks/useLogin.js`, `useSignup.js`
- Read `server/middleware/auth.js`
- Read `server/controllers/authController.js`
- Read `server/routes/authRoutes.js`

### Agent 3 — Socket.IO & Real-Time
Search for: listener leaks (socket.on without socket.off), reconnection gaps, missed events after disconnect, duplicate listeners on re-mount, events firing on unmounted components, chat message ordering bugs, presence state going stale.
- Read `client/src/context/SocketContext.jsx` fully
- Read `client/src/hooks/useSocketNotifications.js`, `usePresence.js`
- Read `client/src/components/chat/` — every file
- Read `client/src/components/presence/` — every file
- Read `server/server.js` for Socket.IO setup
- Grep for `socket.on(`, `socket.off(`, `socket.emit(` across all client source

### Agent 4 — Chat System
Search for: message send failures with no retry, optimistic updates that never roll back, scroll position bugs, media messages that fail silently, read receipts race conditions, conversation list showing stale data, chat context memory leaks.
- Read `client/src/context/ChatContext.jsx` fully
- Read ALL files in `client/src/components/chat/`
- Read `server/controllers/chatController.js`
- Read `server/controllers/circleChatController.js`
- Read `server/models/ChatMessage.js`, `Conversation.js`, `CircleMessage.js`

### Agent 5 — Payments & Subscriptions
Search for: purchase flows that can double-charge, webhook handlers missing signature verification, subscription status not refreshed after purchase, pro-gated features accessible without check, Apple IAP receipt validation gaps, Google Play RTDN handling issues, billing state desync between client and server.
- Read `client/src/services/billingService.js` fully
- Read `server/controllers/subscriptionController.js`, `premiumController.js`
- Read `server/controllers/appleStoreController.js`, `googlePlayController.js`, `googlePlayRtdn.js`
- Read `server/models/Subscription.js`, `Purchase.js`
- Read `server/routes/subscriptionRoutes.js`, `appleStoreRoutes.js`, `googlePlayRoutes.js`, `premiumRoutes.js`
- Grep all client source for `isPro`, `isPremium`, `subscription`, `purchase`

### Agent 6 — Media Upload & Albums
Search for: uploads that hang with no timeout, blob URLs never revoked (memory leak), image preview cleanup missing on unmount, failed uploads with no error state, album operations that corrupt data on concurrent edits, missing file size/type validation.
- Read `client/src/hooks/useMediaUpload.js` fully
- Read ALL files in `client/src/components/MediaUpload/`
- Read ALL files in `client/src/components/media/`
- Read ALL files in `client/src/components/albums/`
- Read `server/controllers/uploadController.js`, `albumController.js`
- Grep for `createObjectURL`, `revokeObjectURL`, `FileReader`, `FormData` across client

### Agent 7 — MongoDB & Data Layer
Search for: missing indexes on queried fields, N+1 query patterns, unvalidated user input written to DB, missing `lean()` on read queries, population depth bombs, schema mismatches, race conditions on concurrent writes, TTL indexes missing on expiring data.
- Read ALL files in `server/models/`
- Read ALL files in `server/controllers/`
- Check every `.find()`, `.findOne()`, `.aggregate()` for missing indexes
- Check every write operation for input validation
- Run `cd ../circles && node -e "const m = require('mongoose'); Object.keys(m.models).forEach(k => console.log(k, JSON.stringify(m.models[k].schema.indexes())))"` if possible

### Agent 8 — Circles & Social Graph
Search for: circle membership checks that can be bypassed, invitation flows that break on edge cases, family tree data integrity issues, connection request race conditions, graph data going stale, circle settings not propagating to all members.
- Read `client/src/components/circles/` — every file
- Read `client/src/components/NetworkGraph/` — every file
- Read `client/src/components/FamilyTree/` — every file
- Read `client/src/hooks/useCircleSettings.js`, `useCircleStreak.js`, `useNetworkData.js`, `useTreeData.js`
- Read `server/controllers/circleController.js`, `connectionController.js`, `familyController.js`, `graphController.js`, `invitationController.js`

### Agent 9 — Dashboard & Memory System
Search for: dashboard data fetch races, memory creation failures with no feedback, memory view crash on missing data, stale dashboard after background changes, thoughts/chains with broken CRUD flows.
- Read `client/src/pages/Dashboard.jsx` fully
- Read `client/src/hooks/useDashboardData.js`, `useDashboardUI.jsx`
- Read `client/src/pages/MemoryView.jsx`, `ThoughtsPage.jsx`, `ThoughtDetailPage.jsx`
- Read ALL files in `client/src/components/memory/`
- Read ALL files in `client/src/components/thoughts/`
- Read ALL files in `client/src/components/chains/`
- Read `server/controllers/memoryController.js`, `thoughtsController.js`, `chainController.js`

### Agent 10 — Context Providers & State
Search for: provider value instability (inline objects causing re-render tsunamis), context state that grows unbounded, missing context cleanup, stale context after account switch, onboarding state machine with impossible states or dead ends.
- Read ALL files in `client/src/context/`
- Read ALL files in `client/src/components/providers/`
- Read `client/src/store/` — every file
- Read `client/src/hooks/useUserDerivedState.js`
- Grep for `<.*Provider value={{` across all client source (inline object = instability signal)

### Agent 11 — Hooks & Shared Logic
Search for: effects without cleanup, async effects without abort/unmount guards, stale closures in callbacks, derived state stored as separate state, missing dependency array entries, hooks that violate rules-of-hooks conditionally.
- Read ALL files in `client/src/hooks/`
- For each hook: trace what it subscribes to, whether it cleans up, whether async calls guard against unmount
- Pay special attention to `useSafeEffect.js` — if it exists, check all hooks use it correctly
- Check `useApiQuery.js`, `useAsyncRequest.js` for error handling completeness

### Agent 12 — UI Components & Forms
Search for: form submissions without double-submit guards, modals that don't clean up on close, skeleton states that never resolve, missing loading/error/empty states, focus trap issues, scroll restoration bugs.
- Read ALL files in `client/src/components/ui/`
- Read ALL files in `client/src/components/forms/`
- Read ALL files in `client/src/components/modals/`
- Read ALL files in `client/src/components/skeletons/`
- Read `client/src/components/layout/` — every file
- Read `client/src/hooks/useFocusTrap.js`, `useScrollRestoration.js`, `useEscapeKey.js`

### Agent 13 — Capacitor & Platform
Search for: web-only APIs used without platform guards, `window.location` mutations that break native history, missing keyboard/safe-area handling, push notification registration failures, deep link routing gaps, native share without feature detection, haptics called on web.
- Read `client/src/config/` or `client/src/config.js` for platform detection
- Read `server/middleware/platformDetection.js`
- Grep all client source for `window.location`, `navigator.share`, `Capacitor`, `Plugins`
- Grep for `Keyboard`, `PushNotifications`, `Haptics`, `Share`, `Browser` from Capacitor
- Check `CirclesNative/` config if present

### Agent 14 — Security & Server Hardening
Search for: missing auth middleware on protected routes, CSRF gaps, rate limiter bypasses, XSS via `dangerouslySetInnerHTML` or unsanitized user content, injection via unsanitized query params in Mongo queries, secrets in client bundle, PII in console logs, abuse detection gaps.
- Read `server/middleware/auth.js`, `csrf.js`, `rateLimiter.js`, `abuseDetection.js`
- Read `server/server.js` for CORS, helmet, middleware chain
- Check every route file for auth middleware presence
- Grep client for `dangerouslySetInnerHTML`, `eval(`, `innerHTML`
- Grep client for `localStorage.setItem` — check what's stored
- Grep server for `console.log` that might leak PII
- Read `server/config/` for secrets management

### Agent 15 — Notifications, Onboarding & Settings
Search for: notification handlers that crash on malformed payloads, onboarding flow that can be skipped leaving incomplete state, settings changes that don't propagate, contact sync issues, feedback submission failures, admin moderation edge cases.
- Read ALL files in `client/src/components/notifications/`
- Read ALL files in `client/src/components/onboarding/`
- Read ALL files in `client/src/components/settings/`
- Read ALL files in `client/src/components/contacts/`
- Read `client/src/context/OnboardingContext.jsx`
- Read `client/src/pages/ContactsPage.jsx`, `ContactSupport.jsx`, `UserProfile.jsx`
- Read `server/controllers/notificationController.js`, `contactController.js`, `feedbackController.js`

---

## Output format

After all agents complete, compile a single prioritized bug report:

### Critical (crashes, data loss, payment/auth broken)
### High (broken features, memory leaks, race conditions)
### Medium (stale data, edge cases, missing states)
### Low (latent risks, cleanup)

Each bug must include:
- **File**: path and line number
- **Bug**: what's wrong
- **Trigger**: exact reproduction steps
- **Fix**: concrete suggestion with code

Do NOT report style preferences, subjective opinions, or things ESLint catches.

### Logging
Write every finding to `docs/KNOWN_UI_DEBT.md` with `BUG-` prefix (increment from last BUG-* in file).
Save full report to `artifacts/bug-hunt/[YYYY-MM-DD].md`.

### Cross-reference
- Skip issues already in `docs/KNOWN_UI_DEBT.md`
- Skip code being actively refactored (check `git log --oneline -20`)
- 3+ findings in one file → recommend `/dan-refactor`
- Systemic pattern across 5+ files → report once with file list
