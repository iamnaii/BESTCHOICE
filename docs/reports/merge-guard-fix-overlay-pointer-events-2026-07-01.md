# Pre-Merge Guard Report — fix/overlay-pointer-events

**Branch**: `fix/overlay-pointer-events`
**Author**: iamnaii (akenarin.ak@gmail.com)
**Date**: 2026-07-01
**Reviewer**: Pre-Merge Guard (automated)
**Last commit**: `82f84065` — 2026-06-27 10:13 +07

---

## Context

This is a stacked long-running branch. The unique commits not yet covered by any prior guard run form 4 logical groups (inbox fix K, chore/payment-wizard-followups, feat/payment-type-in-page-overlays, and the fix itself). Earlier layers (inbox batches 0–J, payment-reversal-phase4, shop-collect, late-fee-perday, ECL etc.) were reviewed in prior guard runs and are not re-audited here.

---

## File Changes Summary (unique new groups)

### Group A — Inbox fix K: WS auth hardening (3 commits, 2026-06-26)

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-engine/services/room-manager.service.ts` | +2 `deletedAt: null` filters on message preview query |
| `apps/api/src/modules/staff-chat/staff-chat.gateway.ts` | +32 lines — isActive DB check on WS connect + try/catch guard |

### Group B — chore/payment-wizard-followups (1 commit, 2026-06-26)

| File | Change |
|------|--------|
| `apps/api/src/modules/settings/services/settings-flags.service.ts` | +35 — `getWaiverReasons()` reads SystemConfig, falls back to 5 defaults |
| `apps/api/src/modules/settings/settings.controller.ts` | +12 — `GET /settings/waiver-reasons` endpoint |
| `apps/api/src/modules/settings/settings.service.spec.ts` | +46 — 4 unit tests |
| `apps/web/.../RecordPaymentWizard.tsx` | +21 — fetches waiver reasons, hides Draft button until query resolves |

### Group C — feat/payment-type-in-page-overlays (2 commits, 2026-06-26)

| File | Change |
|------|--------|
| `apps/web/.../RecordPaymentWizard.tsx` | +46/-4 — RESCHEDULE/REPO buttons open overlays; removes useNavigate |
| `apps/web/.../RepossessionOverlay.tsx` | +384 — full create form, P&L preview, createPortal pattern |
| `apps/web/.../RescheduleOverlay.tsx` | +288 — daysToShift/splitMode/fee estimate, createPortal pattern |
| `docs/plans/...` | +45 — implementation plan (docs only) |

**Review fix commit** (f4ae1ad9) corrects:
- C1: reschedule placeholder amount 1 → 0.01 (matching `@Min(0.01)` backend constraint)
- C2: `queryClient.invalidateQueries` changed from generic `['payments']` to correct keys `['pending-payments']`, `['pending-summary']`, `['daily-summary']`
- W: repossessedDate default + max use Asia/Bangkok (not UTC)
- W: P&L preview shows 2 decimal places

### Group D — fix/overlay-pointer-events (1 commit, 2026-06-27)

| File | Change |
|------|--------|
| `apps/web/src/components/contract/ContractEarlyPayoff.tsx` | +1 `pointer-events-auto` on overlay root div |
| `apps/web/.../RepossessionOverlay.tsx` | +1 `pointer-events-auto` on overlay root div |
| `apps/web/.../RescheduleOverlay.tsx` | +1 `pointer-events-auto` on overlay root div |

---

## Issues by Severity

### Critical — None

All checklist items pass:

- ✅ `GET /settings/waiver-reasons` is behind class-level `@UseGuards(JwtAuthGuard, RolesGuard, SettingsAccessGuard)` and has `@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')`. The `@AllowAnyAuthenticated()` decorator only bypasses `SettingsAccessGuard`'s dynamic-role check; JWT validation still runs.
- ✅ No new controller without guards.
- ✅ No `Number()` on backend money/financial DB fields. Frontend `Number()` calls are converting string form inputs (appraisalPrice, repairCost, marketValue) before sending to the API — this is standard and the backend DTO types match.
- ✅ Fee calculation in `RescheduleOverlay` uses `decimal.js` (`new Decimal(monthlyPayment).div(30).times(days).toDecimalPlaces(2, Decimal.ROUND_DOWN)`), matching the backend's `ROUND_DOWN` mode.
- ✅ Soft-deleted message fix correctly adds `deletedAt: null` filter on the room-list preview query.
- ✅ No hardcoded secrets or API keys.
- ✅ No raw `$queryRaw` calls.
- ✅ No missing `@Roles()` on new methods.

### Warning — 1

**W1 — `(client as any).role` / `(client as any).userName` in WS gateway**
- File: `apps/api/src/modules/staff-chat/staff-chat.gateway.ts`
- The `client.role` and `client.userName` are set via `(client as any)` casts instead of a typed socket extension. This is pre-existing in the gateway (not introduced by this branch) and the values are used defensively — but if the type is widened in future it could silently break.
- Not a blocker; the security check itself (isActive + fail-closed on DB error) is correct.

### Info — 2

**I1 — `queryClient.invalidateQueries(['repossessions'])` after overlay submit**
- The repossession overlay also invalidates `['repossessions']`, which is the repossessions list page key. Correct if the user opens the overlay from a page that shows the repossession list, but the primary calling context is the Payments queue page. Low impact; list will self-refresh on next focus anyway.

**I2 — RepossessionOverlay role-gating is frontend-only copy**
- The overlay shows a notice for non-OWNER users ("บทบาทของคุณไม่มีสิทธิ์ยึดเครื่อง") and disables submit. This relies on the frontend role check. The backend `POST /repossessions` correctly guards with `@Roles('OWNER')` so the server is the real gate — the frontend notice is just UX. Fine.

---

## Positive Notes

- **Inbox fix K (WS auth)** is a genuine security improvement: the WebSocket gateway previously only validated the JWT signature at connect time, trusting that a valid token implied an active user. The new check mirrors the REST `JwtStrategy` by querying `user.isActive` after token decode, and disconnects deactivated users even if their token hasn't expired. The `try/catch` wrapper ensures a DB blip fails closed (disconnect), not open (allow).
- **Waiver reasons endpoint** correctly uses `@AllowAnyAuthenticated()` (settings access bypass) while keeping `JwtAuthGuard` + `RolesGuard` intact. The fallback-to-defaults logic is defensive and well-tested (4 unit tests).
- **Pointer-events fix** is minimal and correct: Radix Dialog in modal mode activates `react-remove-scroll`, which sets `pointer-events: none` on everything outside `DialogContent`. Portaled overlays rendered at `document.body` are outside that boundary, so adding `pointer-events-auto` to the overlay root is the right fix.
- **`deletedAt: null`** was missing from the `latestMessage` subquery in room-list — now correctly excluded.

---

## Summary

| Group | Files | Net lines | Issues |
|-------|-------|-----------|--------|
| A — WS auth hardening | 2 backend | +34 | None (security improvement) |
| B — Waiver reasons config | 4 (3 api + 1 web) | +114 | None |
| C — In-page overlays | 4 web | +715 / -4 | None (post-review-fix) |
| D — Pointer-events fix | 3 web | +3 / -3 | None |

---

## Recommendation: APPROVE

No critical or blocking issues. The branch is clean across all four change groups. The WS auth hardening is a security improvement; the overlay work follows established frontend patterns; the pointer-events fix is minimal and correct.

Merge order suggestion (since these are stacked and main likely needs them in dependency order):
1. Merge `chore/payment-wizard-followups` → main
2. Merge `feat/payment-type-in-page-overlays` → main
3. Merge `fix/overlay-pointer-events` → main (or squash the top 4 commits into a single PR)
