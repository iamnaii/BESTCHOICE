# Merge Guard Report: fix/reschedule-qa-test-slip-contract

**Date**: 2026-07-05  
**Branch**: `fix/reschedule-qa-test-slip-contract`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 3 (latest: 2026-07-04)  
**Diff**: 19 files changed, +900 / -56  

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/payments/payments.pending-live-fee.spec.ts` | +44 (new tests) |
| `apps/api/src/modules/payments/services/payment-query.service.ts` | +17 |
| `apps/api/src/modules/receipts/receipts.service.spec.ts` | +127 (new tests) |
| `apps/api/src/modules/receipts/services/receipt-void.service.ts` | +17 |
| `apps/api/src/modules/users/users.controller.ts` | +14 (new endpoint) |
| `apps/api/src/modules/users/users.service.spec.ts` | +50 (new tests) |
| `apps/api/src/modules/users/users.service.ts` | +19 (new method) |
| `apps/web/src/components/payment/ReceiptVoidDialog.tsx` | +122 (4-eyes approver) |
| `apps/web/src/components/payment/__tests__/ReceiptVoidDialog.test.tsx` | +147 (new tests) |
| `apps/web/src/pages/PaymentsPage/**` | +296 (paid-mode table, filters, index) |
| `apps/web/src/pages/PaymentsPage/components/PaymentTable.tsx` | +46 |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | +14 |

---

## Issues Found

### Critical
_None found._

### Warning

**W1 — Large files over 500 lines (4 files)**

| File | Lines |
|------|-------|
| `apps/web/src/pages/PaymentsPage/index.tsx` | 955 |
| `apps/web/src/pages/PaymentsPage/components/RecordPaymentWizard.tsx` | 1,656 |
| `apps/api/src/modules/payments/services/payment-query.service.ts` | 557 |
| `apps/api/src/modules/receipts/receipts.service.spec.ts` | 631 |

`RecordPaymentWizard.tsx` at 1,656 lines is a long-standing file, not introduced by this branch. `PaymentsPage/index.tsx` at 955 lines grew significantly in this PR (from ~800). No immediate blocking issue, but both files are candidates for future decomposition.

### Info

**I1 — New `GET /users/approvers` endpoint open to all roles**  
`users.controller.ts:57` — The new endpoint has `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` (effectively all authenticated roles). The response is intentionally PII-free (`{ id, name, role }`) and the comment in the code explains this design decision clearly. Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` is present. No security concern.

**I2 — `users.service.ts:findApprovers` — `findMany` on non-deleted users**  
The query correctly includes `deletedAt: null` and `isActive: true` plus email allow-list. Well-formed.

**I3 — `receipt-void.service.ts` approver validation**  
Server-side role check on `approvedById` is solid: validates active user, checks `deletedAt`, checks allowed roles. Good defence-in-depth.

**I4 — `ReceiptVoidDialog.tsx` — `invalidateQueries` present after mutation**  
`queryClient.invalidateQueries` correctly fires on `onSuccess` for `receipts`, `contract-receipts`, and `contract-payments`. No cache-invalidation gap.

---

## Recommendation: ✅ APPROVE

No critical or blocking issues. The branch adds a well-tested 4-eyes approver flow for receipt void, a PII-free approver lookup endpoint, and improved PaymentsPage behaviour for PAID rows. Guards, DTO validation, soft-delete filters, and cache invalidation are all correctly applied.
