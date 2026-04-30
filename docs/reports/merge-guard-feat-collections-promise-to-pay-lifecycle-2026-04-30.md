# Merge Guard Report — feat/collections-promise-to-pay-lifecycle

**Date**: 2026-04-30  
**Branch**: `feat/collections-promise-to-pay-lifecycle`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last Commit**: 2026-04-28 10:59:01 +0700  
**Commit**: `04000e85` — fix(p2p): drop eslint-disable for unregistered react-hooks rule  
**Recommendation**: 🚫 **BLOCK** — 2 Critical issues must be resolved before merge

---

## File Changes Summary

```
44 files changed, +7373 / -525 lines

New files (TypeScript/TSX):
  apps/api/scripts/backfill-promise-slots.ts
  apps/api/src/modules/overdue/crons/no-promise-lock.cron.ts
  apps/api/src/modules/overdue/crons/no-promise-lock.cron.spec.ts
  apps/api/src/modules/overdue/crons/promise-resolution.cron.ts
  apps/api/src/modules/overdue/crons/promise-resolution.cron.spec.ts
  apps/api/src/modules/overdue/installment-allocator.util.ts
  apps/api/src/modules/overdue/installment-allocator.util.spec.ts
  apps/api/src/modules/overdue/promise.service.ts
  apps/api/src/modules/overdue/promise.service.spec.ts
  apps/web/e2e/promise-lifecycle-happy.spec.ts
  apps/web/e2e/promise-supersede.spec.ts
  apps/web/src/pages/CollectionsPage/components/InstallmentPickerPopover.tsx
  apps/web/src/pages/CollectionsPage/components/SupersedePromiseConfirmDialog.tsx
  apps/web/src/pages/CollectionsPage/hooks/usePromiseSlots.ts

Modified:
  apps/api/src/modules/overdue/overdue.service.ts  (major additions)
  apps/api/prisma/schema.prisma                    (PromiseSlot model + new fields)
  + migrations, seeds, existing page components
```

---

## Issues

### 🔴 Critical — Must fix before merge

**C1: `Number()` on money field written to DB — violates money field rule**

- **File**: `apps/api/src/modules/overdue/overdue.service.ts`
- **Lines**: ~964, ~972 (inside `logContact()` legacy-slot fallback path)

```typescript
// BAD — Number() on Decimal money field before DB write
const slotsInput = [
  ...(dto.settlementDate ? [{
    settlementDate: new Date(dto.settlementDate),
    settlementAmount: Number(dto.settlementAmount ?? 0),   // ← VIOLATION
  }] : []),
  ...(dto.secondSettlementDate ? [{
    settlementDate: new Date(dto.secondSettlementDate),
    settlementAmount: Number(dto.secondSettlementAmount ?? 0),  // ← VIOLATION
  }] : []),
];
```

`slotsInput` is passed directly to `PromiseService.createPromise()`, which writes `settlementAmount` to `PromiseSlot.settlementAmount` (`Decimal @db.Decimal(12, 2)`). Using `Number()` here converts the value to JS float before storage — violating the rule `ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน`.

**Fix**:
```typescript
settlementAmount: new Prisma.Decimal(dto.settlementAmount ?? 0),
settlementAmount: new Prisma.Decimal(dto.secondSettlementAmount ?? 0),
```
Also update the `slotsInput` intermediate type to `{ settlementDate: Date; settlementAmount: Prisma.Decimal; notes?: string }`.

---

**C2: `as never` type assertion on money field suppresses TypeScript protection**

- **File**: `apps/api/src/modules/overdue/promise.service.ts`
- **Lines**: ~167, ~187 (inside `createPromise()`)

```typescript
// BAD — 'as never' masks a type mismatch on a financial field
const newPromise = await tx.callLog.create({
  data: {
    ...
    settlementAmount: primary.settlementAmount as never,   // ← TYPE SUPPRESSION
    ...
  },
});

await tx.promiseSlot.createMany({
  data: slots.map((s) => ({
    ...
    settlementAmount: s.settlementAmount as never,  // ← TYPE SUPPRESSION
  })),
});
```

`as never` is used because `s.settlementAmount` is typed as `number` (from C1) but Prisma expects `Decimal`. This is a cascading symptom of C1. TypeScript was correctly flagging the mismatch; suppressing it with `as never` removes the safety net.

**Fix**: Resolve C1 first (change intermediates to `Prisma.Decimal`). The `as never` casts will become unnecessary and can be removed.

---

### ⚠️ Warning — Should fix

**W1: `.toNumber()` on active promise `settlementAmount` in response object**

- **File**: `apps/api/src/modules/overdue/overdue.service.ts` ~line 1308
- **Code**: `settlementAmount: Number((active as any).settlementAmount ?? 0)`
- **Context**: API response body for `GET /overdue/contracts/:id/cycle-deadline` — not a DB write.
- **Risk**: Response truncation in theoretical edge case. `(active as any)` also suppresses TypeScript.
- **Fix**: Remove the `as any`, properly type `active`, return `active.settlementAmount.toString()` (serializable Decimal → string is the safe pattern for JSON responses).

**W2: `remainingAmount` in installment list response uses float arithmetic**

- **File**: `apps/api/src/modules/overdue/overdue.service.ts` ~line 1338
- **Code**: `remainingAmount: Number(new Prisma.Decimal(p.amountDue as Prisma.Decimal).sub(p.amountPaid as Prisma.Decimal))`
- **Context**: API response only — not stored to DB.
- **Fix**: Return as string (`...sub(...).toString()`) or keep as Decimal and let JSON serializer handle it.

**W3: System user `findFirst` without `deletedAt: null`**

- **Files**: `no-promise-lock.cron.ts`, `promise-resolution.cron.ts`
- **Code**: `findFirst({ where: { isSystemUser: true } })`
- **Risk**: Negligible — system user is never soft-deleted by design. The pattern matches `MdmLockService.getSystemUserIdOrThrow()` in main branch.
- **Fix**: Not required. Document with a comment for clarity.

---

### ℹ️ Info

- **I1**: New cron jobs (`no-promise-lock.cron.ts`, `promise-resolution.cron.ts`) — no guards needed (cron, not HTTP). Both have proper Sentry error capture.
- **I2**: `PromiseSlot` model correctly uses `Decimal @db.Decimal(12, 2)` for `settlementAmount` and `paidAmount`.
- **I3**: All non-system `findMany`/`findFirst` in cron files include `deletedAt: null`.
- **I4**: New React components (`InstallmentPickerPopover`, `SupersedePromiseConfirmDialog`) use `api.post()` — no raw `fetch()`.
- **I5**: No new controllers without guards.
- **I6**: No hardcoded secrets, no `$queryRaw` injection vectors.
- **I7**: Backfill script uses per-row transactions — crash-safe design documented in file header.
- **I8**: `backfill-promise-slots.ts` contains a safety note: "DO NOT commit DATABASE_URL" — good hygiene.

---

## Checklist

| Check | Result |
|---|---|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ N/A (no new controllers) |
| `@Roles()` on all new endpoints | ✅ N/A |
| Money fields use `Prisma.Decimal` (not `Number`) | 🔴 **FAIL** — C1, C2 |
| All queries have `deletedAt: null` | ✅ Clean (W3 is a known-safe exception) |
| No hardcoded secrets or API keys | ✅ Clean |
| No unparameterized `$queryRaw` | ✅ Clean |
| New DTOs use class-validator with Thai messages | ✅ Clean |
| React components use `api.get()`/`api.post()` | ✅ Clean |
| `queryClient.invalidateQueries()` after mutations | ✅ (in hooks) |
| No `as never` / `as any` suppressing type errors | 🔴 **FAIL** — C2, W1 |

---

## Required Fixes Before Merge

1. **C1** — In `overdue.service.ts` legacy-slot fallback (~line 964–972): replace `Number(dto.settlementAmount ?? 0)` and `Number(dto.secondSettlementAmount ?? 0)` with `new Prisma.Decimal(...)`.

2. **C2** — In `promise.service.ts` `createPromise()`: remove `as never` casts on `settlementAmount`. These will resolve automatically once C1 changes the slot intermediate type to `Prisma.Decimal`.

3. **W1** — In `overdue.service.ts` `getCycleDeadline()` response (~line 1308): remove `as any` and return `settlementAmount` as string (`.toString()`).

---

## Recommendation

🚫 **BLOCK** — C1 and C2 are direct violations of the project's money-field rule (`ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน`). While actual precision loss is unlikely at Thai baht scales (≤8 significant digits), the `as never` suppression of TypeScript protection is a code-quality regression that must not merge. Fixes are localized to ~4 lines in two files.
