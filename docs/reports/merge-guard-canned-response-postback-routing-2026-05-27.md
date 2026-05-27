# Pre-Merge Guard Report

**Branch:** `feat/canned-response-postback-routing`  
**Author:** Akenarin Kongdach `<akenarin.ak@gmail.com>`  
**Review Date:** 2026-05-27  
**Reviewer:** Pre-Merge Guard (automated)  
**Base branch:** Stacked on `feat/canned-response-admin-redesign`  
**Recommendation:** ✅ APPROVE

---

## Summary

Incremental branch stacked on `feat/canned-response-admin-redesign`. Unique additions (~700 new lines across 15 files):

- **`QuickReplyPostbackRouterService`** — parses `TEMPLATE:<id>` postback payloads and dispatches the canned-response template via `CannedResponseSenderService`. Includes a per-room sliding-window rate limiter (W7: `MAX_PER_WINDOW=5` per `WINDOW_MS=10 000 ms`) to prevent runaway QR loops.
- **Facebook webhook integration** — `FacebookWebhookController` now injects `QuickReplyPostbackRouterService` and intercepts matching postbacks _before_ they hit `routeInbound()`. Falls through cleanly for unrecognised payloads (graceful degradation).
- **`forwardRef(() => StaffChatModule)`** in `ChatAdaptersModule` to break circular dependency.
- **QuickReplyEditor postback picker** (`TemplatePickerModal`) — allows selecting a canned-response template as the postback target in the UI.
- Seed data expansion: 20+ Thai phone plan templates with category tagging.
- Backfill CLI: `migrate-canned-response-content-to-bubbles.cli.ts`.

---

## File Changes (incremental)

| File | Change |
|------|--------|
| `quick-reply-postback-router.service.ts` | New service — ~115 lines |
| `quick-reply-postback-router.service.spec.ts` | New tests — ~100 lines |
| `facebook-webhook.controller.ts` | +43 lines — postback routing |
| `facebook-webhook.controller.spec.ts` | +30 lines — mock updates |
| `chat-adapters.module.ts` | +8 lines — forwardRef |
| `QuickReplyEditor.tsx` | +74 lines — template picker |
| `TemplateEditorPane.tsx` | Minor — +6 lines |
| `apps/api/prisma/seed.ts` | +~160 lines — expanded seed |
| `apps/api/src/cli/migrate-*.cli.ts` | New — 56 lines |

---

## Critical Issues

> **None found.** All critical checks passed.

### ✅ Auth/Guard Coverage
- `FacebookWebhookController` is **intentionally public** (no `JwtAuthGuard`) — it is on the documented allow-list in `security.md`. The new postback-routing code runs inside the existing controller method body; it adds no new public surface area.
- No new controllers added in this branch.

### ✅ Soft-Delete Filters
- `chatRoom.findFirst({ where: { ..., deletedAt: null } })` — ✅
- `QuickReplyPostbackRouterService` delegates to `CannedResponseSenderService` which already applies `deletedAt: null` on all its queries (reviewed in admin-redesign report).

### ✅ No Money/Decimal Issues
- Domain is chat message routing — no financial fields.

### ✅ No Hardcoded Secrets
- Phone prices in seed data are business content, not credentials. ✅

### ✅ No SQL Injection
- No `$queryRaw` in new code.

---

## Warning Issues

### ⚠️ W1 — `forwardRef` circular dependency signals architecture concern
**Files:** `chat-adapters.module.ts` → `StaffChatModule`

```ts
forwardRef(() => StaffChatModule),
```

`forwardRef` is the right NestJS tool here, but circular module dependencies between `ChatAdaptersModule` and `StaffChatModule` indicate that the `QuickReplyPostbackRouterService` may belong in a more neutral shared module (e.g., `ChatEngineModule` or a new `PostbackModule`) rather than in `StaffChatModule`. This is a design note for Phase 6+ — the current solution works correctly.

**Impact:** Low. Works in production; harder to test in isolation.

---

### ⚠️ W2 — Rate limiter is in-process only (resets on pod restart)
**File:** `quick-reply-postback-router.service.ts`

```ts
private readonly recentSends = new Map<string, number[]>();
```

The `MAX_PER_WINDOW` sliding window is per-process. In a multi-replica deployment (Cloud Run can run multiple instances), a customer could trigger up to `N_replicas × MAX_PER_WINDOW = 5 × N` dispatches in the window by spreading taps across replicas. The JSDoc acknowledges this: _"Counters are per-process and reset on app restart — fine for a defensive guard."_ Acceptable for current scale; revisit if replica count grows.

**Impact:** Low. Defensive guard, not a hard security boundary.

---

### ⚠️ W3 — Seed phone prices drift risk
`apps/api/prisma/seed.ts` hardcodes Thai baht prices for specific phone models (iPhone 15/16 Pro, S25 Ultra, iPad Air M3). These prices will become stale. Should be moved to a YAML/JSON seed fixture file for easier maintenance.

**Impact:** Developer experience only; no correctness or security risk.

---

## Info

### ℹ️ I1 — Channel coverage note
Only LINE_FINANCE, LINE_SHOP, and FACEBOOK fire server-side postback events. TikTok and web channels degrade gracefully to plain TEXT messages (documented in service JSDoc). No action needed; just surfacing for awareness.

### ℹ️ I2 — `TemplatePickerModal` uses `useQuery` without error boundary
`QuickReplyEditor.tsx` renders a template-picker modal that fetches `GET /staff-chat/canned-responses`. If the fetch fails, the modal may show an empty list silently. A `QueryBoundary` or explicit error state would improve resilience.

---

## Recommendation: ✅ APPROVE

Incremental, well-scoped addition. The postback router is properly guarded against loops (W7 rate limit), falls through cleanly for unrecognised payloads, and adds no new unguarded controller surface area. No critical issues found. Warnings are design/scale notes, not blockers.

Merge order dependency: **this branch must merge after `feat/canned-response-admin-redesign`** (it is stacked on top).
