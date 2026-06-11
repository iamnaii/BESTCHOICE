# Merge Guard Report — `feat/canned-response-postback-routing`

**Date:** 2026-06-11  
**Author:** akenarin.ak@gmail.com  
**Branch:** `feat/canned-response-postback-routing` → `main`  
**Commits:** 4 unique commits (Phase 5 — Quick Reply postback routing + review fixes)

---

## File Changes Summary

Phase 5 of the canned-response system: when a customer taps a LINE Quick Reply button, the system routes the postback payload to automatically send a follow-up canned response.

| Area | Files | Notes |
|------|-------|-------|
| New backend service | `quick-reply-postback-router.service.ts` | Rate-limited postback router |
| New controller tests | `postback-router.spec.ts` | 4 tests — rate-limit + room isolation |
| Sender service fix | `canned-response-sender.service.ts` | Atomic upsert + role downgrade |
| Frontend changes | `QuickReplyEditor.tsx`, `types.ts`, template page | Postback picker UI |
| Fix commits | 2 review-fix commits (C1/C2/W4-W7) | Hardening on top of Phase 5 |

---

## Issues Found

### Critical — None

- **Guards**: `@UseGuards(JwtAuthGuard, RolesGuard)` present at class level on `StaffChatController`. All new endpoints decorated with `@Roles()` ✓
- **FacebookWebhookController** is intentionally public (external LINE/FB webhook — listed in the intentionally-public allowlist in `security.md`) ✓
- **No unparameterized `$queryRaw`**: all raw queries use `Prisma.sql` template literals ✓
- **No money fields**: postback routing is a messaging flow — no financial data touched ✓
- **No hardcoded secrets** ✓
- **No `deletedAt` gaps**: new Prisma queries include `deletedAt: null` filters ✓

### Warning — None

- **Rate-limit guard** added: max 5 postback sends per room per 10-second window — prevents postback infinite-loop abuse ✓
- **Race condition fixed (C1)**: system-user bootstrap changed from `findFirst → create` to atomic **`prisma.user.upsert()`** — eliminates P2002 duplicate-insert on concurrent first calls ✓
- **Privilege de-escalation (W6)**: system user role downgraded `OWNER → SALES` — removes bot from admin-only queries ✓
- **No raw `fetch()`** in frontend changes ✓
- **`queryClient.invalidateQueries()`** called on all mutations in the postback picker UI ✓

### Info — None significant

- `any` in error handlers (consistent with project-wide pattern in catch blocks) — acceptable.
- TikTok/Web postback non-support is explicitly documented via graceful text-fallback — not a silent failure.

---

## Detailed Findings

### QuickReplyPostbackRouterService (NEW)
The service resolves the target canned response from the postback payload, checks the rate-limit window, then calls the existing `CannedResponseSenderService`. The rate-limit is scoped per `(room, template)` pair and stored in-memory — acceptable for a single-instance deployment. If horizontal scaling is added, the rate-limit should move to Redis (no change needed for current architecture).

### CannedResponseSenderService — race fix
The atomic `upsert()` replaces the non-atomic `findFirst → create` that could produce a P2002 unique-constraint error on concurrent first-time calls. The system user's `isSystemUser=true` and `isActive=false` flags ensure it is excluded from user-facing listings. The OWNER→SALES role downgrade (W6) correctly reduces blast radius.

### ChatRoom lookup
Ordered by `lastMessageAt DESC` for re-engagement: when multiple rooms match the customer's LINE UID, the most recently active one is selected. This is the correct behaviour for a follow-up message.

### Tests
4 new tests on `QuickReplyPostbackRouterService` prove rate-limit window and room isolation. 4 new tests on `CannedResponseSenderService` prove the race fix and role assignment. All tests are deterministic with mocked dependencies.

---

## Recommendation: ✅ APPROVE

Phase 5 postback routing is well-implemented. The race-condition fix and privilege de-escalation are positive security improvements. No Critical or Warning issues. Safe to merge.
