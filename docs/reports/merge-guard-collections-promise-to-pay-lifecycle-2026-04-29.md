# Pre-Merge Guard Report
**Branch**: `feat/collections-promise-to-pay-lifecycle`
**Author**: Akenarin Kongdach
**Date**: 2026-04-29
**Commits ahead of main**: 33
**Files changed**: 44 (+7,373 / −525 lines)

---

## Summary of Changes

This is the largest of the three branches — implements the full Promise-to-Pay Lifecycle Redesign (v5) described in CLAUDE.md:

- **New models**: `PromiseSlot` (N-slot promises replacing 2-slot legacy), lifecycle fields on `CallLog` (`supersededAt`, `keptAt`, `canceledAt`, `cycleDeadline`, etc.)
- **`promise.service.ts`** — `findActivePromise`, `createPromise` (supersede + reschedule penalty), `calcCycleDeadline`
- **Crons replaced**: `broken-promise.cron.ts` deleted, replaced by `promise-resolution.cron.ts` (hourly, with grace period) and `no-promise-lock.cron.ts` (2× NO_ANSWER/UNREACHABLE → auto-MDM-lock)
- **`mdm-lock.service.ts`** — new `autoLock`/`autoUnlock` paths (idempotent, audit-logged)
- **`payments.service.ts`** — `checkPromiseAfterPayment` hook (non-blocking, post-payment promise resolution + auto-unlock)
- **Frontend**: `ContactLogDialog` redesigned with N-slot manager, supersede confirm dialog, FIFO installment picker, cycle deadline banner; `PromiseTab` updated with slot status chips
- **New endpoints**: `GET /overdue/contracts/:id/cycle-deadline`, `GET /overdue/contracts/:id/overdue-installments`
- **Backfill script**: `scripts/backfill-promise-slots.ts`

---

## Issues Found

### Critical
_None._

### Warning

**W-1 — `Number()` on Decimal fields in service response serialization (5 instances)**
- Files: `apps/api/src/modules/overdue/overdue.service.ts`, `promise.service.ts`
- Lines (diff): 1994, 2613, 1027, 1060, 1964
- Pattern examples:
  - `remainingAmount: Number(new Prisma.Decimal(p.amountDue).sub(p.amountPaid))` — Decimal arithmetic is correct, but result is converted to `number` for JSON response
  - `settlementAmount: Number(s.settlementAmount)` — converting `PromiseSlot.settlementAmount` (Decimal) for response DTO
  - `const slotAmount = slot.settlementAmount.toNumber()` — used in kept/broken detection comparison
- **Context**: All arithmetic is done using `Prisma.Decimal` before conversion. The `toNumber()` / `Number()` calls are at the JSON serialization boundary (response objects), not in ledger-affecting calculations. Monetary values with 2 decimal places are exactly representable as IEEE 754 doubles for amounts < ~9 trillion.
- **Risk**: Low — no ledger writes use these converted numbers. However it violates the codebase convention of "never use Number/Float for money fields" and could mask issues if amounts grow large or gain additional decimal places.
- **Recommendation**: Use `Prisma.Decimal.toFixed(2)` or return the raw `Prisma.Decimal` and let Prisma/JSON serialization handle it. Not blocking, but should be addressed.

**W-2 — `useContactLog` hook does not invalidate `contract-cycle-deadline` or `contract-overdue-installments` queries after a successful contact log**
- File: `apps/web/src/pages/CollectionsPage/hooks/useContactLog.ts`
- The hook invalidates `collections-queue` and `collections-kpi` on success, but **not** the new `['contract-cycle-deadline', id]` and `['contract-overdue-installments', id]` queries used by `cycleDeadlineQuery` / `installmentsQuery` inside `ContactLogDialog`.
- **Effect**: After logging a contact (which may create/supersede a promise), the cycle deadline banner and installment picker inside the still-open dialog will continue to show stale data until the dialog closes and reopens (which drops the queries from cache).
- **Severity**: Medium — in practice the dialog closes immediately after `onSuccess`, so the stale window is very short. But if the dialog is re-opened quickly (e.g. user dismisses and re-opens), stale promise summary is shown.
- **Recommendation**: Add `queryClient.invalidateQueries({ queryKey: ['contract-cycle-deadline'] })` and `queryClient.invalidateQueries({ queryKey: ['contract-overdue-installments'] })` in the `onSuccess` handler of `useContactLog`. Should fix before merge.

**W-3 — `settlementAmount: Number(dto.settlementAmount ?? 0)` when constructing legacy slots from DTO fields**
- File: `apps/api/src/modules/overdue/promise.service.ts` (diff lines 1820, 1828)
- When `dto.slots` is absent (legacy 2-field format), the code builds slot objects with `settlementAmount: Number(dto.settlementAmount ?? 0)`. This number is then wrapped in `new Prisma.Decimal(s.settlementAmount)` immediately after. So the value round-trips `Decimal → number → Decimal`. No precision loss in practice (2dp amounts), but violates convention.
- **Recommendation**: Use `new Prisma.Decimal(dto.settlementAmount ?? 0)` directly instead of `Number()`.

### Info

**I-1 — `getSystemUserId()` uses `user.findFirst({ isSystemUser: true })` without `deletedAt` filter**
- Files: `promise-resolution.cron.ts`, `no-promise-lock.cron.ts`
- The SYSTEM user is a seeded singleton; it should never be soft-deleted. The pattern is consistent with `MdmLockService.getSystemUserIdOrThrow()` already in main. Acceptable.

**I-2 — `(active as any)` casts in `getCycleDeadline` response builder**
- File: `apps/api/src/modules/overdue/overdue.service.ts`
- The active promise is fetched with a Prisma `include`, but typed as `any` for accessing `.slots`, `.rescheduleCount`, etc. These should be properly typed via a Prisma result type.
- Not a runtime risk but hurts type safety.

**I-3 — Large design/plan documents added to repo**
- Files: `docs/plans/2026-04-27-promise-to-pay-lifecycle.md` (2,955 lines), `docs/designs/2026-04-27-promise-to-pay-lifecycle-design.md` (437 lines), `docs/mockups/2026-04-27-p2p-contactlog-mockup.html` (496 lines)
- No code impact.

---

## Positive Highlights

- **`broken-promise.cron` fully replaced**: old 2-slot logic removed, new `promise-resolution.cron` handles N-slot resolution with 1-day grace period consistently.
- **Auto-MDM idempotent**: `autoLock`/`autoUnlock` check `deviceLocked` state before writing — no double-lock/double-unlock.
- **`checkPromiseAfterPayment` non-blocking**: wrapped in try/catch in `payments.service.ts` — payment does not fail if promise resolution fails.
- **`deletedAt: null` present** on all new production queries (confirmed except system user, which is intentional).
- **All new companyInfo queries have `deletedAt: null`** (confirmed).
- **Backfill script** included for migrating legacy 2-slot data.
- **E2E test coverage**: 2 new specs (`promise-lifecycle-happy.spec.ts`, `promise-supersede.spec.ts`).

---

## Recommendation

**⚠️ REVIEW — fix W-2 before merge, W-1/W-3 should be addressed**

W-2 (missing cache invalidation in `useContactLog`) is the most impactful: the cycle-deadline query will show stale data if the dialog is reopened shortly after a contact log. The fix is a 2-line addition to `useContactLog.ts`. W-1 and W-3 are convention violations (Number/Decimal boundary) with low runtime risk but should be corrected to stay consistent with the codebase rule. W-2 must be fixed; W-1/W-3 are strongly recommended before merge.
