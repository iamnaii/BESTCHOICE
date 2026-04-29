# Pre-Merge Guard Report

**Branch**: `feat/collections-promise-to-pay-lifecycle`
**Author**: Akenarin Kongdach
**Date**: 2026-04-29
**Recommendation**: 🔴 BLOCK

---

## File Changes Summary

44 files changed — 7,373 insertions, 525 deletions

| Category | Files |
|---|---|
| Schema | `schema.prisma` (+90), 2 new migrations (+65 lines) |
| New services | `promise.service.ts` (+225), `mdm-lock.service.ts` (+81), `installment-allocator.util.ts` (+24) |
| New crons | `promise-resolution.cron.ts` (+231), `no-promise-lock.cron.ts` (+136), removes `broken-promise.cron.ts` (-121) |
| Modified services | `overdue.service.ts` (+189), `payments.service.ts` (+143), `queue.service.ts` (+66) |
| Controller | `overdue.controller.ts` (+14) — 2 new endpoints |
| Backfill | `backfill-promise-slots.ts` (+195) |
| Frontend | `ContactLogDialog.tsx`, `hooks/usePromiseSlots.ts`, `hooks/useContactLog.ts`, `types.ts` |
| Tests | `promise.service.spec.ts` (+253), `mdm-lock.service.spec.ts` (+159), `promise-resolution.cron.spec.ts` (+175), `no-promise-lock.cron.spec.ts` (+70), `installment-allocator.util.spec.ts` (+33) |
| E2E | `promise-lifecycle-happy.spec.ts`, `promise-supersede.spec.ts` |

---

## Issues

### Critical

**C-1 — `Number()` on Decimal money field written to DB (violates v4 hardening rule)**
`apps/api/src/modules/overdue/promise.service.ts`

The `createPromise` method builds slot inputs with `Number()` before passing them to Prisma:
```ts
// In overdue.service.ts (createPromise call site):
slotsInput = [
  ...(dto.settlementDate ? [{ settlementDate: ..., settlementAmount: Number(dto.settlementAmount ?? 0) }] : []),
  ...(dto.secondSettlementDate ? [{ settlementDate: ..., settlementAmount: Number(dto.secondSettlementAmount ?? 0) }] : []),
];
```

These values are then written to DB via `as never` type cast:
```ts
// promise.service.ts line ~150:
await tx.callLog.create({
  data: {
    ...
    settlementAmount: primary.settlementAmount as never,  // ← Number bypasses Decimal type
  }
});

await tx.promiseSlot.createMany({
  data: sortedSlots.map((s, idx) => ({
    ...
    settlementAmount: s.settlementAmount as never,  // ← same issue
  })),
});
```

`CallLog.settlementAmount` and `PromiseSlot.settlementAmount` are Decimal fields in the schema. The `as never` cast is used to bypass TypeScript's type checking, which means precision guarantees from `Prisma.Decimal` are silently dropped.

**Fix**: Change `CreatePromiseSlotInput.settlementAmount` from `number | string` to `Prisma.Decimal`, and update call sites to use `new Prisma.Decimal(dto.settlementAmount)`. Remove all `as never` casts from Prisma writes.

**C-2 — `as never` / `as unknown as never` type casts on Decimal DB writes**
`apps/api/src/modules/overdue/promise.service.ts`

```ts
data: { keptAt: now, paidAmount: slotAmount as unknown as never },    // line ~170
data: { brokenAt: now, lockedAt: now, paidAmount: paid as unknown as never },  // line ~180
```

`slotAmount` is obtained via `.toNumber()` (`const slotAmount = slot.settlementAmount.toNumber()`), and `paid` from `_sum.amountPaid?.toNumber()`. These JS numbers are then cast `as unknown as never` to write into what are likely Decimal DB columns. This circumvents all type safety.

**Fix**: Preserve as `Prisma.Decimal` throughout — use `slot.settlementAmount` directly (it is already Decimal from the DB read) and `sum._sum.amountPaid` (also Decimal from `_sum` aggregate).

---

### Warning

**W-1 — Multiple `as any` casts on Decimal fields in non-test code**
`apps/api/src/modules/overdue/overdue.service.ts`

```ts
remainingAmount: (p.amountDue as any).sub(p.amountPaid as any),
const deadline = (active as any)?.cycleDeadline ? (active as any).cycleDeadline : ...
const activeSlots: Array<...> = (active as any)?.slots ?? [];
id: (active as any).id,
settlementAmount: Number((active as any).settlementAmount ?? 0),  // ← also C-1 pattern
```

The `(p.amountDue as any).sub(...)` suggest Prisma's Decimal type is being cast away for the arithmetic operation, which may silently fail if the value is `null` or a plain number. Proper typing with `Prisma.Decimal` would catch these at compile time.

**W-2 — Large files**

| File | Lines |
|---|---|
| `overdue.service.ts` | 1,342 |
| `payments.service.ts` | 1,212 |
| `queue.service.spec.ts` | 1,142 |
| `overdue.controller.ts` | 688 |
| `ContactLogDialog.tsx` | 610 |

`overdue.service.ts` grew by 189 lines in this branch (pre-existing large file). `ContactLogDialog.tsx` at 610 lines is the largest new frontend file.

---

### Info

**I-1 — `as any` casts in test files**
`promise.service.spec.ts`, `overdue.service.spec.ts` — `(promiseService as any).findActivePromise.mockResolvedValue(...)` and `const txMock: any = {...}` are standard Jest mocking patterns. No concern.

**I-2 — New endpoints use correct guards**
`GET /overdue/contracts/:id/cycle-deadline` and `GET /overdue/contracts/:id/overdue-installments` — both have `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')` and inherit class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`. ✅

**I-3 — Frontend API calls correct**
`usePromiseSlots.ts` uses `api.get()` only. No raw `fetch()` found. ✅

---

## Security Checklist

| Check | Result |
|---|---|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on controller | ✅ Class-level guard present |
| `@Roles()` on new endpoints | ✅ Both new GET endpoints have role decorators |
| Missing `deletedAt: null` in queries | ✅ All new queries include filter |
| `$queryRaw` without parameterization | ✅ None found |
| Hardcoded secrets/API keys | ✅ None found |
| `Prisma.Decimal` for money fields written to DB | 🔴 C-1, C-2: `as never` bypasses Decimal typing on `CallLog.settlementAmount`, `PromiseSlot.settlementAmount`, `PromiseSlot.paidAmount` |
| Frontend `api.get()` / `api.post()` only | ✅ No raw `fetch()` |

---

## Recommendation: BLOCK

**Two Critical issues must be fixed before merge:**

1. **C-1**: Replace `Number(dto.settlementAmount)` with `new Prisma.Decimal(dto.settlementAmount)` in `overdue.service.ts` and update `CreatePromiseSlotInput` to `settlementAmount: Prisma.Decimal`. Remove `as never` from the two `callLog.create` / `promiseSlot.createMany` Prisma writes in `promise.service.ts`.

2. **C-2**: In `promise.service.ts`, replace `.toNumber()` before DB writes with the raw Decimal values:
   - `const slotAmount = slot.settlementAmount` (already `Prisma.Decimal` — do not call `.toNumber()`)
   - `const paid = sum._sum.amountPaid ?? new Prisma.Decimal(0)` (already `Prisma.Decimal | null`)
   - Remove `as unknown as never` casts

These issues follow the v4 hardening pattern (53 `Number()` → `Prisma.Decimal` fixes). The rest of the branch is well-structured with comprehensive tests, proper guard configuration, and correct frontend patterns.
