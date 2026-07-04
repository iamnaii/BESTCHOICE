# Merge Guard Report — fix/reschedule-qa-test-slip-contract

**Date**: 2026-07-04  
**Branch**: `fix/reschedule-qa-test-slip-contract`  
**Author**: akenarin.ak@gmail.com  
**Commits**: 3  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

19 files changed, 900 insertions(+), 56 deletions(-)

| Area | Files |
|------|-------|
| API (service/controller) | `users.controller.ts`, `payment-query.service.ts`, `receipt-void.service.ts` |
| API (tests) | `payments.pending-live-fee.spec.ts`, `receipts.service.spec.ts`, `users.service.spec.ts` |
| Web (components) | `ReceiptVoidDialog.tsx`, `PaymentFilters.tsx`, `PaymentTable.tsx`, `RecordPaymentWizard.tsx` |
| Web (page) | `PaymentsPage/index.tsx` |
| Web (tests) | `ReceiptVoidDialog.test.tsx`, `PaymentTable.paid-mode.test.tsx`, `RescheduleOverlay.test.tsx` |

Key features:
- New `GET /users/approvers` endpoint — lean {id, name, role} list for 4-eyes approval pickers
- "ชำระครบ" (Paid) tab in PaymentsPage — paid history view
- Receipt void SoD approval flow — ReceiptVoidDialog gets approver picker
- `invalidatePaymentQueries` helper consolidating cache invalidation

---

## Issues Found

### Critical — None

### Warning — None

### Info

- **`PaymentsPage/index.tsx` is growing** — `+153` lines added to what is already a large orchestration component. Not a blocker but worth monitoring; consider extracting the "paid tab" state to a hook if it continues to grow.
- **`GET /users/approvers` is ALL-roles** — The endpoint returns only `{id, name, role}` of active manager-role users (no PII), which is the right design for approval pickers. The comment in the controller explains the rationale clearly. Verified no PII fields are exposed.

---

## Security Checks

| Check | Result |
|-------|--------|
| New controller endpoints have `@Roles()` | ✅ Pass — `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` |
| `JwtAuthGuard` class-level on controllers | ✅ Pass — inherits from existing class guard |
| `Number()` on money fields | ✅ Pass — none found in production code |
| Missing `deletedAt: null` | ✅ Pass — all new queries include it |
| Raw `fetch()` in frontend | ✅ Pass — uses `api.get()` throughout |
| `invalidateQueries` after mutations | ✅ Pass — `invalidatePaymentQueries(queryClient)` called, plus receipt invalidates |
| Hardcoded secrets | ✅ Pass — none found |
| Thai validation messages on DTOs | ✅ Pass — no new DTOs added |
