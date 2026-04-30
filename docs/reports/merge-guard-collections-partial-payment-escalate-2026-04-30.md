# Merge Guard Report — feat/collections-partial-payment-escalate

**Date**: 2026-04-30  
**Branch**: `feat/collections-partial-payment-escalate`  
**Last commit**: `fd574959` (2026-04-28 12:02 +0700)  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

30 files changed, 3817 insertions(+), 1936 deletions(-)

| Area | Key Files |
|------|-----------|
| API — Overdue | `overdue.service.ts` (+369 lines), `overdue.controller.ts` (+28 lines) |
| API — New DTOs | `partial-payment-reschedule.dto.ts` (new, 59 lines), `escalate.dto.ts` (new, 14 lines) |
| API — Queue | `queue.service.ts` (+48 lines) |
| API — Prisma | New migration (6 lines), `schema.prisma` (+4 fields) |
| Frontend | `PartialPaymentRescheduleDialog.tsx` (new, 320 lines), `ContactLogDialog.tsx` (+417 lines) |
| Frontend — Hooks | `useEscalate.ts` (new), `usePartialPaymentReschedule.ts` (new) |
| Tests | `overdue.service.spec.ts` (+39), `queue.service.spec.ts` (+2), `ContactLogDialog.test.tsx` (+121) |
| Docs | `weekly-progress-2026-04-27.md` (+205 lines) |
| Package lock | Large diff (~3,810 lines) — npm dependency updates |

---

## Issues Found

### ℹ️ Info (2)

#### I1 — `Number()` in UI display/validation (frontend-only, non-DB)

**Files**: `ContactLogDialog.tsx`, `PartialPaymentRescheduleDialog.tsx`

```typescript
const amount1Num = Number(settlementAmount);   // ContactLogDialog — for UI validation logic
const amountPaidNum = Number(amountPaid);       // PartialPaymentRescheduleDialog — for display
```

These are used for UI boundary checks (comparison operators) and format display — not written to the database. The DB writes correctly use `new Prisma.Decimal(dto.settlementAmount)` in the service layer. No precision risk for the amounts in scope, but could be typed more precisely as `parseFloat()` with explicit bounds.

#### I2 — `ContactLogDialog.tsx` is growing large

After changes the component is ~417 lines of additions on top of an already large file. No immediate action needed but worth tracking for a future split into sub-components.

---

## Security Checklist

| Check | Status |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ Endpoints added to existing guarded controller |
| All new controller methods have `@Roles()` | ✅ `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')` on both new endpoints |
| No `Number()` on DB-bound money fields | ✅ Service uses `new Prisma.Decimal(dto.settlementAmount)` |
| `deletedAt: null` in all new queries | ✅ Present in all new `findFirst`/`findMany` calls |
| No hardcoded secrets / API keys | ✅ Clean |
| No unparameterized `$queryRaw` | ✅ Clean |
| No raw `fetch()` in frontend | ✅ Uses `api.post()` from `@/lib/api` |
| `queryClient.invalidateQueries()` after mutations | ✅ Present in both `useEscalate` and `usePartialPaymentReschedule` |
| DTO validation decorators present | ✅ `@IsNumber`, `@IsString`, `@IsOptional`, `@IsDateString`, `@Min` on all fields |
| Thai validation messages | ✅ Present on all DTO fields |

---

## Recommendation: ✅ APPROVE

Clean, well-structured feature. New endpoints properly guarded and decorated. DB writes use `Prisma.Decimal` correctly. Frontend mutations invalidate the right query keys. DTOs are fully validated with Thai messages. Tests cover the happy path and key edge cases.

Safe to merge.
