# Pre-Merge Guard Report

**Branch**: `feat/collections-partial-payment-escalate`
**Author**: Akenarin Kongdach
**Date**: 2026-04-27
**Commits ahead of main**: 1
**Files changed**: 24 (+1,558 / −82 lines)
**Recommendation**: ✅ **APPROVE** — no blocking issues; one minor warning

---

## File Changes Summary

| Area | Files |
|------|-------|
| API (DTOs) | `dto/escalate.dto.ts`, `dto/log-contact.dto.ts`, `dto/partial-payment-reschedule.dto.ts` |
| API (service/controller) | `overdue.service.ts`, `overdue.controller.ts`, `overdue.module.ts`, `queue.service.ts`, `config.util.ts` |
| Frontend | `CollectionsPage/index.tsx`, `ContactLogDialog.tsx`, `ContractCard.tsx`, `PartialPaymentRescheduleDialog.tsx`, `PromiseTab.tsx` |
| Frontend (hooks) | `useContactLog.ts`, `useEscalate.ts`, `usePartialPaymentReschedule.ts` |
| Tests | `overdue.service.spec.ts`, `queue.service.spec.ts`, `ContactLogDialog.test.tsx`, `ContractCard.test.tsx` |

---

## Issues

### Critical

None found. ✅

---

### Warning

#### W1 — `Number()` coercion for display-only front-end amount validation
**Files**: `apps/web/src/pages/CollectionsPage/components/PartialPaymentRescheduleDialog.tsx`

```ts
const amount1Num = Number(settlementAmount);   // form field string → number for UI bound-check
const amountPaidNum = Number(amountPaid);       // same
```

These values are used solely for UI validation (checking bounds, displaying formatted amounts). They are **not** written to the database — the API DTO receives the raw string values and the server side validates/parses them. The risk is negligible but for consistency with the codebase convention, prefer `parseFloat()` or `new Prisma.Decimal()` on the server and pass amounts as strings between client and API.

---

### Info

#### I1 — Proper Decimal usage on server
Conversions from DB Decimal fields to response values correctly use `new Prisma.Decimal(field).toNumber()`, not raw `Number(field)`. ✅

#### I2 — Query cache invalidation present
All mutations in `useEscalate.ts` and `usePartialPaymentReschedule.ts` call `queryClient.invalidateQueries()` for both `collections-queue` and `collections-kpi` keys after success. ✅

#### I3 — DTO validation complete
New DTOs (`EscalateDto`, `PartialPaymentRescheduleDto`) use Thai-language class-validator decorators on every field. ✅

#### I4 — `@Roles` on new controller methods
New endpoints for escalation and partial-payment-reschedule carry `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')`. ✅

#### I5 — `deletedAt: null` consistently applied
All new Prisma queries filter soft-deleted records. ✅
