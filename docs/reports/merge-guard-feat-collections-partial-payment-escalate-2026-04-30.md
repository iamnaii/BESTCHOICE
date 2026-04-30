# Merge Guard Report — feat/collections-partial-payment-escalate

**Date**: 2026-04-30  
**Branch**: `feat/collections-partial-payment-escalate`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last Commit**: 2026-04-28 12:02:37 +0700  
**Commit**: `fd574959` — Merge remote-tracking branch 'origin/reports/weekly-2026-04-27'  
**Recommendation**: ✅ **REVIEW** (no blockers, one Warning to consider)

---

## File Changes Summary

```
30 files changed, +3817 / -1936 lines
(Note: ~3800 lines are package-lock.json from dep bump — actual logic delta is small)

New files (TypeScript):
  apps/api/src/modules/overdue/dto/escalate.dto.ts
  apps/api/src/modules/overdue/dto/partial-payment-reschedule.dto.ts
  apps/web/src/pages/CollectionsPage/components/PartialPaymentRescheduleDialog.tsx
  apps/web/src/pages/CollectionsPage/hooks/useEscalate.ts
  apps/web/src/pages/CollectionsPage/hooks/usePartialPaymentReschedule.ts

Modified:
  apps/api/src/modules/overdue/overdue.service.ts   (main logic additions)
  apps/api/src/modules/overdue/overdue.controller.ts (2 new endpoints)
  package-lock.json / package.json                   (dep bump)
```

---

## Issues

### Critical — Must fix before merge

_None found._

### Warning — Should fix

**W1: Intermediate `.toNumber()` before re-wrapping as `Prisma.Decimal`**

- **File**: `apps/api/src/modules/overdue/overdue.service.ts` ~line 1194
- **Code**:
```typescript
const outstandingAfter = outstandingBefore.sub(paid).toNumber();  // → JS Number
// ...
callLog = await this.logContact(contractId, callerId, {
  ...
  settlementAmount: outstandingAfter,          // passed as JS number
  ...
});
```
- In `logContact()`, this is then safely re-wrapped: `new Prisma.Decimal(dto.settlementAmount)` before DB storage.
- **Risk**: Very low — the Decimal subtraction result is re-wrapped with `Prisma.Decimal()` before any write. For baht amounts with 2 decimal places, float precision loss is not reachable. However the intermediate conversion is unnecessary and violates the "no Float for money" rule.
- **Fix**: Pass `outstandingBefore.sub(paid)` (already a `Prisma.Decimal`) directly as `settlementAmount`, widening the `logContact` param type to accept `Prisma.Decimal | number | string`.

### Info

- **I1**: Two new endpoints `POST :contractId/partial-payment-reschedule` and `POST :contractId/escalate` both have correct `@Roles()` decorators.
- **I2**: New DTOs (`EscalateDto`, `PartialPaymentRescheduleDto`) use class-validator with Thai messages — clean.
- **I3**: All new Prisma queries include `deletedAt: null` in `where` clauses.
- **I4**: New React hooks `useEscalate` and `usePartialPaymentReschedule` use `api.post()` from `@/lib/api` — no raw `fetch()`.
- **I5**: No new controllers — existing `overdue.controller.ts` already has `@UseGuards(JwtAuthGuard, RolesGuard)`.
- **I6**: No hardcoded secrets, no `$queryRaw` vectors.
- **I7**: `settlementAmount` and `secondSettlementAmount` in DTO are typed `number | string`, which allows either client format. `@IsNumber()` validator enforces numeric value. Pattern matches existing DTO conventions.

---

## Checklist

| Check | Result |
|---|---|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ N/A (existing controller) |
| `@Roles()` on all new endpoints | ✅ Both new endpoints decorated |
| Money fields use `Prisma.Decimal` (not `Number`) | ⚠️ See W1 (re-wrapped before storage) |
| All queries have `deletedAt: null` | ✅ Clean |
| No hardcoded secrets or API keys | ✅ Clean |
| No unparameterized `$queryRaw` | ✅ Clean |
| New DTOs use class-validator with Thai messages | ✅ Clean |
| React components use `api.get()`/`api.post()` | ✅ Clean |
| `queryClient.invalidateQueries()` after mutations | ✅ (in hook files) |

---

## Recommendation

**✅ REVIEW** — The branch is functionally solid. W1 is a low-risk convention violation (data is re-wrapped with Prisma.Decimal before any DB write). Can merge after W1 is addressed or with explicit acknowledgement that the intermediate float is acceptable given the re-wrapping.
