# Pre-Merge Guard Report

**Branch**: `feat/collections-partial-payment-escalate`
**Author**: Akenarin Kongdach
**Date**: 2026-04-29
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

30 files changed — 3,817 insertions, 1,936 deletions
(~1,936 deletions are primarily `package-lock.json` churn)

| Category | Files |
|---|---|
| New DTOs | `escalate.dto.ts` (+14), `partial-payment-reschedule.dto.ts` (+59) |
| Backend | `overdue.controller.ts` (+28), `overdue.service.ts` (+369), `overdue.module.ts` (+3), `queue.service.ts` (+48), `config.util.ts` (+7) |
| Migration | 1 new migration (+6 lines) |
| Frontend | `ContactLogDialog.tsx` (+417), `PartialPaymentRescheduleDialog.tsx` (+320), `ContractCard.tsx` (+60), hooks: `useEscalate.ts` (+39), `usePartialPaymentReschedule.ts` (+46), `useContactLog.ts` (+3) |
| Tests | `overdue.service.spec.ts` (+39), `ContactLogDialog.test.tsx` (+121), `queue.service.spec.ts` (+2) |
| Docs | `weekly-progress-2026-04-27.md` (+205) |
| Lock file | `package-lock.json` (large churn — dependency update) |

---

## Issues

### Warning

**W-1 — Large files**

| File | Lines |
|---|---|
| `overdue.service.ts` | 1,516 |
| `queue.service.spec.ts` | 1,142 |
| `overdue.controller.ts` | 702 |
| `ContactLogDialog.tsx` | 722 |
| `queue.service.ts` | 849 |

`overdue.service.ts` at 1,516 lines is the most significant concern. The new partial-payment and escalation flows add ~369 lines. Long-term, consider extracting into `escalation.service.ts` or `collections-workflow.service.ts`.

---

## Security Checklist

| Check | Result |
|---|---|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on controller | ✅ Class-level guard present on `overdue.controller.ts` |
| `@Roles()` on new endpoints | ✅ `@Post(':contractId/partial-payment-reschedule')` — `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')` |
| `@Roles()` on new endpoints | ✅ `@Post(':contractId/escalate')` — `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')` |
| Missing `deletedAt: null` in queries | ✅ All new queries include filter |
| `$queryRaw` without parameterization | ✅ None found |
| Hardcoded secrets/API keys | ✅ None found |
| Frontend uses `api.post()` not raw `fetch()` | ✅ `useEscalate.ts` and `usePartialPaymentReschedule.ts` both use `api.post()` |
| `queryClient.invalidateQueries()` after mutations | ✅ Both new hooks invalidate `collections-queue`, `collections-kpi`, and `contract-call-log-latest` |
| DTO validation decorators | ✅ Thai-language error messages present on `settlementAmount`, `secondSettlementAmount`, `amountPaid` |
| `Prisma.Decimal` for money | ✅ `.toNumber()` conversions are for response serialization only; DB writes use Decimal |

---

## Recommendation: APPROVE

Both new endpoints (`/partial-payment-reschedule` and `/escalate`) are properly guarded, have Thai validation messages, and follow the established collections patterns. Frontend hooks use `api.post()` with correct cache invalidation. No critical issues found.

W-1 (large `overdue.service.ts`) is a pre-existing concern that should be tracked separately — the additions in this branch are well-scoped.
