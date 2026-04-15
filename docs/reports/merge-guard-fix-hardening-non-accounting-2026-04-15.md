# Merge Guard Report — fix/hardening-non-accounting

**Date**: 2026-04-15  
**Branch**: `fix/hardening-non-accounting`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main` (7750d1b8)  
**Recommendation**: ✅ APPROVE (with caveats — see notes)

---

## Context

Main was force-pushed, rewriting history. The content of both unique commits in this branch
(`17c1c9f9` and `16a18376`) is **already reflected in `origin/main`** via the rewritten history.
The branch can be safely closed without merging. This report reviews the quality of those
changes as they exist in main.

---

## File Changes Summary

**Unique commits** (2):
- `17c1c9f9` — fix: hardening — security, DTOs, FINANCE_MANAGER, SMS retry, Dashboard MoM
- `16a18376` — feat(chat): complete Phase 2 — WS events, file upload, read receipts, KB suggestions

**Key files changed**:
- `chatbot-finance-liff.controller.ts` — LiffTokenGuard upgrade (security fix)
- `line-finance-webhook.guard.ts` — reject missing rawBody in production
- `line-oa/dto/evidence.dto.ts` — new DTOs with class-validator
- `dashboard.service.ts` — MoM KPI metrics
- `chat-engine/services/session-manager.service.ts` — markMessagesRead method
- Multiple controllers — FINANCE_MANAGER role added to 19 endpoints

---

## Issues

### ⚠️ Warning (2)

**W-001** — `apps/api/src/modules/chat-engine/services/session-manager.service.ts`  
`markMessagesRead()` calls `prisma.chatMessage.updateMany({ where: { sessionId, role: CUSTOMER, readAt: null } })` without `deletedAt: null`. The `ChatMessage` model has a `deletedAt` field. Soft-deleted messages would be incorrectly marked as read.

```typescript
// Missing: deletedAt: null
await this.prisma.chatMessage.updateMany({
  where: {
    sessionId,
    role: MessageRole.CUSTOMER,
    readAt: null,
    // deletedAt: null  ← should add
  },
  data: { readAt },
});
```

**W-002** — `apps/api/src/modules/chatbot-finance/services/` (SMS retry in 17c1c9f9)  
`notificationLog.updateMany({ where: { status: 'RETRY_PENDING', nextRetryAt: null } })` missing `deletedAt: null`. The `NotificationLog` model has `deletedAt DateTime?`. Soft-deleted records could be accidentally force-failed.

---

### ℹ️ Info (2)

**I-001** — `apps/api/src/modules/line-oa/dto/evidence.dto.ts`  
`ApproveEvidenceDto.amount` uses `@IsNumber()` and the value flows into `Math.abs(body.amount - expectedAmount)` (arithmetic with potentially Decimal values) and `prisma.paymentEvidence.update({ data: { amount: body.amount } })`. While Prisma auto-converts JS numbers to Decimal, the coding standards require `new Prisma.Decimal(body.amount)` for money fields. Consider wrapping in service layer.

**I-002** — Branch is already in main via force-push. All the security improvements (LiffTokenGuard on LIFF controller, rawBody check in webhook guard, FINANCE_MANAGER role additions) are already deployed. Branch should be deleted.

---

## Positive Findings

- All new endpoints have `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles()` decorators
- `LiffTokenGuard` properly verifies LINE ID server-side — significant security improvement
- New DTOs (`SlipUploadBodyDto`, `ApproveEvidenceDto`, `BatchApproveEvidenceDto`, `BatchRejectEvidenceDto`, `LiffNotificationPreferencesDto`) all have Thai validation messages
- File upload in staff-chat uses `ParseFilePipe` with `MaxFileSizeValidator` + `FileTypeValidator` — safe
- Frontend uses `api.get()/api.post()` from `@/lib/api` and calls `queryClient.invalidateQueries()` after mutations
- No hardcoded secrets or API keys found
- No raw `$queryRaw` usage

---

## Recommendation: ✅ APPROVE / CLOSE BRANCH

Content is already in main. The 2 warnings above exist in the code that's in main and should
be fixed there, not on this branch. This branch should be **deleted** (not merged).
