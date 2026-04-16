# Merge Guard Report — fix/hardening-non-accounting

**Date:** 2026-04-16  
**Branch:** `fix/hardening-non-accounting`  
**Author:** Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last commit:** 2026-04-14  
**Recommendation:** ⚠️ REVIEW — 1 warning must be assessed before merge

---

## File Changes Summary

This branch includes all commits from `feat/chatbot-production-ready` (already reviewed — APPROVE) plus 2 additional commits:

| Commit | Description |
|--------|-------------|
| `17c1c9f9` | fix: hardening — security, DTOs, FINANCE_MANAGER, SMS retry, Dashboard MoM |
| `16a18376` | feat(chat): complete Phase 2 — WS events, file upload, read receipts, KB suggestions |

Key files added/modified (unique to this branch):
| File | Change |
|------|--------|
| `apps/api/src/modules/chatbot-finance/chatbot-finance-liff.controller.ts` | LiffTokenGuard added — P0 security fix |
| `apps/api/src/modules/chatbot-finance/guards/line-finance-webhook.guard.ts` | Reject webhook without rawBody in prod |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` | +`POST /rooms/:id/upload` (file upload) |
| `apps/api/src/modules/chat-engine/services/session-manager.service.ts` | +`markMessagesRead()` |
| `apps/api/src/modules/chat-engine/services/assignment.service.ts` | WS events on assign/transfer |
| `apps/api/src/modules/chat-engine/services/handoff-manager.service.ts` | WS events on handoff |
| `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` | +3 KB suggestion routes |
| `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` | +KB Suggestions tab with approve/reject |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | +MoM KPIs (contractsMoM, overdueMoM, stockMoM) |

---

## Issues by Severity

### Critical (0)
No critical issues found.

### Warning (1)

**[WARN-1] File upload endpoint lacks room-ownership (IDOR) check**  
- File: `apps/api/src/modules/staff-chat/staff-chat.controller.ts:298-343`
- Endpoint: `POST /rooms/:id/upload`
- Issue: The endpoint accepts any authenticated staff member uploading a file to any `roomId`. There is no check that the room belongs to the caller's branch before the S3 upload occurs. A SALES user at Branch A could upload to a chat room from Branch B.
- Secondary issue: The S3 upload (`storageService.upload`) runs **before** `roomManager.saveMessage()`. If an invalid `roomId` is provided, the S3 object is created orphaned even though the DB message creation fails via FK constraint.
- Suggested fix:
  ```typescript
  // Before storageService.upload — add:
  const room = await this.prisma.chatRoom.findFirst({
    where: { id: roomId, deletedAt: null },
  });
  if (!room) throw new NotFoundException('ไม่พบห้องแชท');
  // For branch-restricted roles (SALES, BRANCH_MANAGER), also verify branch match
  ```
- Severity: Warning (not Critical because endpoint is behind `JwtAuthGuard + RolesGuard`, limiting blast radius to authenticated internal staff only)

### Info (3)

**[INFO-1]** `ChatbotFinanceKnowledgePage.tsx` is 611 lines — exceeds 500-line soft threshold (same as in chatbot-production-ready branch review).

**[INFO-2]** `dashboard.service.ts` is 989 lines after MoM additions — well above 500-line threshold.  
- File: `apps/api/src/modules/dashboard/dashboard.service.ts`
- The MoM code adds 6 new `count()` queries; file would benefit from extracting KPI helpers to a separate service, but not blocking for this PR.

**[INFO-3]** `markMessagesRead()` in `session-manager.service.ts` lacks `deletedAt: null` in `updateMany` where clause.  
- File: `apps/api/src/modules/chat-engine/services/session-manager.service.ts`  
- Query updates messages without checking `deletedAt`:
  ```typescript
  where: { sessionId, role: MessageRole.CUSTOMER, readAt: null },
  ```
- Low risk since `updateMany` on soft-deleted rows just sets `readAt` — no data loss. Not blocking.

---

## Security Review

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ All new endpoints inherit class-level guards |
| New methods have `@Roles(...)` | ✅ All 4 new KB suggestion endpoints have `@Roles('OWNER', 'FINANCE_MANAGER')` |
| LiffTokenGuard added to LIFF controller | ✅ P0 fix — lineUserId now verified server-side via LINE API |
| Webhook guard rejecting missing rawBody in prod | ✅ Properly hardened |
| No `Number()` on money fields | ✅ No financial arithmetic in new code |
| No missing `deletedAt: null` filters in `findMany` | ✅ All new `findMany` queries include filter |
| No hardcoded secrets | ✅ Clean |
| No raw `$queryRaw` | ✅ None |
| No raw `fetch()` in React components | ✅ All UI calls use `api.get()`/`api.patch()` |
| `queryClient.invalidateQueries()` after mutations | ✅ All 3 new mutations invalidate correctly |
| File upload room-ownership check | ⚠️ Missing — see WARN-1 |
| DTO validation with Thai error messages | ✅ `SlipUploadBodyDto`, `LiffNotificationPreferencesDto`, etc. all have Thai messages |

---

## Positive Changes (this branch adds security value)

- **P0 fix**: `LiffTokenGuard` now verifies `lineUserId` server-side — previously the client body was trusted directly
- **LINE webhook guard**: production mode now rejects requests missing `rawBody` — prevents spoofed webhook delivery
- **slip-upload**: changed from returning `{ error }` to throwing `BadRequestException` — proper error propagation
- **SMS retry**: orphaned `RETRY_PENDING` records force-failed after 24h — prevents infinite retry queue buildup
- **19 endpoints** receive `FINANCE_MANAGER` role — unblocks Finance Manager from read-only operations they needed

---

## Action Required Before Merge

Fix **WARN-1** (file upload IDOR): add a room existence check and move the S3 upload to after DB validation, or at minimum verify room ownership before uploading. This is a low-effort fix (~10 lines) that closes a branch isolation gap.

After fix, recommendation changes to **APPROVE**.
