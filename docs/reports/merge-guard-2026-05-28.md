# Pre-Merge Guard Report — 2026-05-28

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-05-28  
**Branches reviewed**: 3 (top 3 most recently committed feat/fix branches not yet in main)

---

## Summary

| Branch | Files Δ | Recommendation |
|--------|---------|----------------|
| `fix/fb-webhook-integration-config` | +3 files, +96/−11 | ✅ APPROVE |
| `fix/letters-e2e-sales-assertion` | +1 file, +8/−4 | ✅ APPROVE |
| `feat/canned-response-channel-tabs` | +5 files, +277/−20 | ✅ APPROVE (1 Info) |

No Critical or Warning issues found across all three branches.

---

## Branch 1: `fix/fb-webhook-integration-config`

**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits**: 2  
**Files changed**:
- `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` (+3 lines)
- `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` (+25/−11)
- `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` (+68 lines)

### What it does
Migrates Facebook webhook verify token + app secret from environment variables (`FB_VERIFY_TOKEN`, `FB_APP_SECRET`) to `IntegrationConfigService` (DB → env fallback). Adds `IntegrationsModule` import to `ChatAdaptersModule`. Adds new test suite covering the verify-token flow from DB config.

### Critical
None.

### Warning
None.

### Info

- **I1 — Repeated `getAppSecret()` async calls**: `verifySignature()`, `handleDataDeletion()`, and `handleDeepLinkScan()` each call `getAppSecret()` independently. A single request to `POST /facebook/webhook` will incur up to 2 DB lookups (one in `verifySignature`, one if the deep-link scan path is hit). Not incorrect, but worth caching within the request lifecycle via a local `const appSecret = await this.getAppSecret()` at the top of `handleWebhook`. No action required before merge; note for follow-up.

### Security
- Controller is intentionally public (no `JwtAuthGuard`) — pre-existing design, confirmed present on `main`. Listed as allowed because it receives unsigned Facebook webhooks. HMAC-SHA256 signature verification is the auth mechanism.
- New code correctly **fails closed** when verify token is empty string (`verifyToken || undefined` → rejects with 400). ✓
- No hardcoded secrets. ✓

### Verdict: ✅ APPROVE

---

## Branch 2: `fix/letters-e2e-sales-assertion`

**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits**: 1 unique delta vs main  
**Files changed**:
- `apps/web/e2e/letters-page.spec.ts` (+8/−4)

### What it does
Fixes a brittle E2E assertion. The old test checked that `button[name="ยกเลิก"]` had count 0 for the SALES role, but the "CANCELLED" status tab also renders a button with that label — causing false failures. The new assertion verifies the page heading is visible and URL contains `/letters`, which is the meaningful invariant (SALES can access the page, backend role guard handles cancel authorization).

### Critical
None.

### Warning
None.

### Info
None. The new assertion is more robust. The comment in the test correctly points to the backend `@Roles` guard + unit test as the real cancel-button protection mechanism.

### Verdict: ✅ APPROVE

---

## Branch 3: `feat/canned-response-channel-tabs`

**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits**: 4 unique delta vs main  
**Files changed**:
- `apps/web/src/pages/canned-response-admin/BubbleList.tsx` (+60/−16) — channel filtering + count reporting
- `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` (+63 lines, new file)
- `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` (+17/−3) — wires tabs + BubbleList
- `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` (+31 lines, new file)
- `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` (+100 lines, new file)

### What it does
Adds per-channel tab filtering to the canned response template editor. Each tab (ALL / LINE_FINANCE / FACEBOOK / etc.) shows only bubbles visible to that channel. Creating a bubble while a channel tab is active scopes the new bubble to that channel. Drag-to-reorder works correctly across the full `allBubbles` array so hidden bubbles retain their positions. Tab badges show per-channel bubble counts, suppressed when all bubbles are universal (to avoid redundant numbers).

### Critical
None.

### Warning
None.

### Info

- **I1 — `useEffect` dependency on `onCountsChange`**: `BubbleList` has `useEffect([allBubbles, onCountsChange], ...)`. The parent passes `setBubbleCounts` (a `useState` setter, always stable), so no loop risk today. If a future caller passes an unstable inline function it would loop. Consider wrapping `onCountsChange` call in `useCallback` in `TemplateEditorPane`, or using `useRef` inside `BubbleList` to hold the latest callback without adding it to the dep array. Low risk — no action required before merge.

### Design / Code Quality
- `reorderBubbles` is correctly extracted as a pure function and unit-tested with 7 cases including the cross-channel drag scenario (LINE drag with hidden FB bubble). ✓
- The 5-bubble cap is correctly applied to `allBubbles.length` (not `visibleBubbles.length`), preserving the LINE push limit. ✓
- Design tokens: `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `bg-background` — no hardcoded hex or `gray-*` classes. ✓
- `leading-snug` used on Thai text. ✓
- `aria-pressed` correctly set on tab buttons. ✓
- `api.post()` / `useQuery` / `useMutation` / `queryClient.invalidateQueries()` all follow frontend rules. ✓

### Verdict: ✅ APPROVE

---

## Checklist

| Check | fb-webhook-config | letters-e2e | canned-tabs |
|-------|:-:|:-:|:-:|
| No missing `@UseGuards` on new controllers | n/a | n/a | n/a |
| No `Number()` on money fields | ✅ | ✅ | ✅ |
| No missing `deletedAt: null` in new queries | ✅ | ✅ | ✅ |
| No hardcoded secrets | ✅ | ✅ | ✅ |
| No SQL injection | ✅ | ✅ | ✅ |
| DTO validation decorators | n/a | n/a | n/a |
| React Query used for data fetching | n/a | n/a | ✅ |
| `api.get()/post()` used (no raw fetch) | n/a | n/a | ✅ |
| `invalidateQueries()` after mutations | n/a | n/a | ✅ |
| No hardcoded CSS colors | n/a | n/a | ✅ |
| Thai validation messages | n/a | n/a | n/a |
