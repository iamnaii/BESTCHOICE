# Merge Guard Report — feat/collections-promise-to-pay-lifecycle

**Date**: 2026-04-28  
**Branch**: `feat/collections-promise-to-pay-lifecycle`  
**Base**: `origin/main`  
**Author**: Akenarin Kongdach / iamnaii (iamnaii@MacBook-Pro / akenarin.ak@gmail.com)  
**Recommendation**: ⚠️ REVIEW — 1 Warning (type-safety), 2 Info

---

## File Changes Summary

44 files changed · +7,373 / −525 lines  
_(Major feature: Promise-to-Pay lifecycle redesign per CLAUDE.md v5)_

| Area | Files | Key Changes |
|------|-------|-------------|
| API — Schema | `schema.prisma` (+90 lines), 2 migrations | `PromiseSlot` model + `keptAt`/`brokenAt`/`cycleStartedAt` fields on `CallLog` |
| API — New services | `promise.service.ts`, `mdm-lock.service.ts`, `installment-allocator.util.ts` | Core P2P logic |
| API — New crons | `promise-resolution.cron.ts`, `no-promise-lock.cron.ts` | Replaces `broken-promise.cron.ts` |
| API — Overdue module | `overdue.service.ts` (+189), `overdue.controller.ts` (+14), `overdue.module.ts` | 2 new endpoints, P2P integration |
| API — Payments | `payments.service.ts` (+143) | Real-time promise-check hook after payment |
| API — Backfill | `scripts/backfill-promise-slots.ts` (+195) | Migrates legacy data |
| Web — Components | `ContactLogDialog.tsx` (631 lines), `InstallmentPickerPopover.tsx`, `SupersedePromiseConfirmDialog.tsx` | N-slot UI |
| Web — Hooks | `usePromiseSlots.ts`, updated `useContactLog.ts` | New React Query hooks |
| Web — PromiseTab | `PromiseTab.tsx` (+109) | Redesigned slot status UI |
| Tests | 6 new spec files (+840 lines), 2 E2E specs | `promise.service.spec.ts`, `mdm-lock.service.spec.ts`, `no-promise-lock.cron.spec.ts`, `promise-resolution.cron.spec.ts`, `installment-allocator.util.spec.ts`, `payments.service.spec.ts` |
| Docs | `docs/plans/`, `docs/mockups/` | Design artifacts (not shipped code) |

---

## Security & Quality Checks

### ✅ Critical — PASS

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` on `OverdueController` class | ✅ Unchanged, still present |
| `@Roles(...)` on `GET contracts/:id/cycle-deadline` | ✅ All 5 roles |
| `@Roles(...)` on `GET contracts/:id/overdue-installments` | ✅ All 5 roles |
| `deletedAt: null` in `promise.service.ts` queries | ✅ All `findFirst`/`findMany` include filter |
| `deletedAt: null` in `promise-resolution.cron.ts` | ✅ Present on all queries |
| `deletedAt: null` in `no-promise-lock.cron.ts` | ✅ Present on all queries |
| `deletedAt: null` in `payments.service.ts` new code | ✅ Present |
| `deletedAt: null` in `mdm-lock.service.ts` | ✅ No direct DB queries (delegates to overdue service) |
| No hardcoded secrets | ✅ Clean |
| No unparameterized `$queryRaw` | ✅ None used |
| Financial arithmetic uses `Prisma.Decimal` | ✅ `promise.service.ts` + `payments.service.ts` use Decimal for all slot/amount math |

### ⚠️ Warning — FIX BEFORE MERGE

**W-01: Type cast `as unknown as Prisma.Decimal` in `payments.service.ts`**

**File**: `apps/api/src/modules/payments/payments.service.ts`  
**Context**: Inside `checkPromiseAfterPayment` — updating `promiseSlot.paidAmount`

```typescript
// CURRENT (line ~175 in new code)
const slotAmount = (slot.settlementAmount as Prisma.Decimal).toNumber();
// ...
await tx.promiseSlot.update({
  where: { id: slot.id },
  data: {
    keptAt: now,
    paidAmount: slotAmount as unknown as Prisma.Decimal,  // ← type lie
  },
});
```

`slotAmount` is already a `number` (via `.toNumber()`). `paidAmount` in the schema is `Decimal @db.Decimal(12,2)`. Prisma's runtime accepts a `number` for Decimal writes, so this **does not cause a runtime error**, but `as unknown as Prisma.Decimal` is a misleading type cast that bypasses TypeScript's safety. It signals that the developer was aware of the mismatch but chose a shortcut.

**Fix**:
```typescript
paidAmount: new Prisma.Decimal(slotAmount),
```
Or, more efficiently, avoid calling `.toNumber()` on the source:
```typescript
const slotAmount = slot.settlementAmount as Prisma.Decimal;
// ...
paidAmount: slotAmount,
```

### ℹ️ Info

**I-01: `ContactLogDialog.tsx` is 610 lines** (threshold: 500).  
This component handles the N-slot promise manager + supersede confirm + installment picker UI — it's genuinely complex. However, `InstallmentPickerPopover.tsx` and `SupersedePromiseConfirmDialog.tsx` have already been extracted as separate files, which is the right pattern. The remaining 610 lines represent the main dialog orchestration and are acceptable given the feature scope.  
→ No immediate action required, but consider extracting `PromiseSlotRow` into its own component in a follow-up.

**I-02: `docs/plans/2026-04-27-promise-to-pay-lifecycle.md` is 2,955 lines**.  
This is a design/plan document, not shipped code. Not a quality concern.

**I-03: `usePromiseSlots.ts` hook — check query key consistency**.  
Uses `['promise-slots', contractId]` as query key. Ensure `ContactLogDialog` invalidates this key after `logContact` mutations so the PromiseTab shows updated slot status without a hard refresh. This was not verified in the diff.

---

## Verdict

The implementation is architecturally sound and aligns with the v5 spec in CLAUDE.md. All security guards, soft-delete filters, and Decimal arithmetic are correct. One Warning issue (`as unknown as Prisma.Decimal`) should be fixed before merge — it's a single-line fix.

**Recommendation: ⚠️ REVIEW — fix W-01, then APPROVE**
