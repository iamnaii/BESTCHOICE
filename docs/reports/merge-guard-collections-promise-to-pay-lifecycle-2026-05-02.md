# Merge Guard Report — feat/collections-promise-to-pay-lifecycle

**Date**: 2026-05-02
**Branch**: `feat/collections-promise-to-pay-lifecycle`
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local
**Reviewed by**: Pre-Merge Guard Agent (automated)

---

## Summary

44 files changed — +7373 / -525 lines. This is the largest of the three branches reviewed.

This branch implements the Promise-to-Pay Lifecycle Redesign (v5 spec):
- `PromiseSlot` model — N-slot promise system replacing 2-slot legacy
- `PromiseService` — createPromise (Serializable tx, supersede chain, reschedule penalties)
- `MdmLockService` — autoLock / autoUnlock paths
- `promise-resolution.cron` (replaces `broken-promise.cron`)
- `no-promise-lock.cron` — MDM auto-lock on consecutive non-answers
- `PaymentService` hook — `checkPromiseAfterPayment` (non-blocking, detects kept cycle)
- `installment-allocator.util.ts` — FIFO allocation helper
- Frontend: `InstallmentPickerPopover`, `SupersedePromiseConfirmDialog`, refactored `ContactLogDialog`
- Backfill script: `apps/api/scripts/backfill-promise-slots.ts`

Key changed files:
- `overdue.service.ts` +189 lines
- `promise.service.ts` new (225 lines)
- `queue.service.ts` +66 lines
- `payments.service.ts` +143 lines
- `ContactLogDialog.tsx` +631 lines (was already large)
- `PromiseTab.tsx` +109 lines

---

## Issues by Severity

### Critical — None

- `OverdueController` class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` is intact.
- New `GET contracts/:id/cycle-deadline` and `GET contracts/:id/overdue-installments` endpoints
  both have `@Roles()` decorators. ✓
- No missing `deletedAt: null` — all new `payment.findMany` and `callLog.findMany` include it.
- No hardcoded secrets, no raw `$queryRaw`.
- No `fetch()` in new frontend components — `usePromiseSlots.ts` uses `api.get()`. ✓

### Warning — 3 issues

**W1 — `settlementAmount: primary.settlementAmount as never`**

File: `apps/api/src/modules/overdue/promise.service.ts` (lines ~145 and ~165)

```typescript
// CallLog.create
data: {
  ...
  settlementAmount: primary.settlementAmount as never,
}
// PromiseSlot.createMany
data: sortedSlots.map((s, idx) => ({
  ...
  settlementAmount: s.settlementAmount as never,
}))
```

`CreatePromiseSlotInput.settlementAmount` is typed `number | string`. Both `CallLog.settlementAmount`
and `PromiseSlot.settlementAmount` are `Decimal @db.Decimal(12,2)` in the schema. Using `as never`
silences the TypeScript error rather than properly converting the value.

At runtime Prisma's client accepts `number | string | Decimal` for Decimal fields, so this works.
But the type escape is fragile — a future refactor that changes the input type could silently pass
wrong data without a compile error.

**Fix**: replace with explicit conversion:
```typescript
settlementAmount: new Prisma.Decimal(primary.settlementAmount),
```

---

**W2 — `Decimal → Number → Decimal` round-trip in `computeFifoTargets`**

File: `apps/api/src/modules/overdue/overdue.service.ts`

```typescript
// Caller
: await this.computeFifoTargets(contractId, totalPromiseAmount.toNumber());

// Implementation
private async computeFifoTargets(contractId: string, targetAmount: number) {
  ...
  return allocateFifo(payments, new Decimal(targetAmount));
}
```

`totalPromiseAmount` is a `Prisma.Decimal`. Converting to `number` then back to `Decimal` introduces
a floating-point round-trip. For amounts up to ~1M THB (the realistic upper bound for a phone
contract) the precision loss is negligible, but it's an unnecessary pattern.

**Fix**: type `computeFifoTargets(contractId: string, targetAmount: Prisma.Decimal)` and pass it
directly to `allocateFifo`.

---

**W3 — `(p.amountDue as any).sub(p.amountPaid as any)` inside `computeFifoTargets`**

File: `apps/api/src/modules/overdue/overdue.service.ts`

```typescript
remainingAmount: (p.amountDue as any).sub(p.amountPaid as any),
```

Both `amountDue` and `amountPaid` are `Decimal` fields but typed as `unknown` by the Prisma select
narrowing. Using `as any` to call `.sub()` bypasses TypeScript. This works at runtime but is fragile.

**Fix**: import and use `Prisma.Decimal` explicitly:
```typescript
remainingAmount: new Prisma.Decimal(p.amountDue as Prisma.Decimal).sub(
  p.amountPaid as Prisma.Decimal,
),
```

---

### Info — 3 items

**I1 — `ContactLogDialog.tsx` now 631 changed lines (total size likely >800 lines)**

This component is accumulating complexity. Not a merge blocker, but should be split in a
follow-up sprint (e.g. extract `PromiseSlotEditor`, `CycleDeadlineBanner` as separate components).

**I2 — Dynamic imports in `computeFifoTargets`**

```typescript
const { Decimal } = await import('@prisma/client/runtime/library');
const { allocateFifo } = await import('./installment-allocator.util');
```

Dynamic `import()` inside a method called on every FIFO computation incurs module-resolution
overhead (though Node.js caches modules after first load). Consider static imports at the top of
the file.

**I3 — Backfill script `backfill-promise-slots.ts` has no dry-run mode**

The backfill script (`npm run backfill:promise-slots`) applies changes directly. A `--dry-run`
flag would let the team verify the migration count before committing it on production. Not a
blocker for the branch itself, but worth adding before running on prod data.

---

## Security Check

- No new controllers introduced that lack guards.
- `MdmLockService.autoLock` / `autoUnlock` create `MDM_AUTO_LOCK`/`MDM_AUTO_UNLOCK` audit log
  entries — good trail for SoD compliance.
- `PromiseService.createPromise` uses `Serializable` transaction isolation to prevent
  double-promise race conditions. ✓
- Frontend hooks use `queryClient.invalidateQueries()` after mutations. ✓

---

## Recommendation

**REVIEW** — Fix W1 (type-unsafe `as never` on Decimal money fields) before merge. W1 is the only
issue that could silently store incorrect financial data if input types change in the future.

W2 and W3 are precision/style issues that can be cleaned up in a follow-up without changing
observable behaviour.

No Critical blockers. The promise lifecycle logic (Serializable isolation, supersede chain,
cycle-deadline enforcement, grace day) is well-implemented.
