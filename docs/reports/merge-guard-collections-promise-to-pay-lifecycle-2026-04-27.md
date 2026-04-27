# Pre-Merge Guard Report

**Branch**: `feat/collections-promise-to-pay-lifecycle`
**Author**: Akenarin Kongdach
**Date**: 2026-04-27
**Commits ahead of main**: 30
**Files changed**: 41 (+7,163 / −514 lines)
**Recommendation**: ⛔ **BLOCK** — 2 Critical issues must be fixed before merge

---

## File Changes Summary

| Area | Files |
|------|-------|
| API (overdue module) | `overdue.service.ts`, `overdue.module.ts`, `overdue.controller.ts`, `promise.service.ts`, `queue.service.ts`, `mdm-lock.service.ts`, `dto/log-contact.dto.ts`, `installment-allocator.util.ts` |
| API (new crons) | `crons/no-promise-lock.cron.ts`, `crons/promise-resolution.cron.ts` (replacing `broken-promise.cron.ts`) |
| API (migrations) | New `PromiseSlot` model + `CallLog` lifecycle fields |
| Frontend | `CollectionsPage` — `ContactLogDialog.tsx`, `SupersedePromiseConfirmDialog.tsx`, `InstallmentPickerPopover.tsx`, `PromiseTab.tsx`, `useContactLog.ts`, `usePromiseSlots.ts` |
| Tests | `no-promise-lock.cron.spec.ts`, `promise-resolution.cron.spec.ts`, E2E: `promise-lifecycle-happy.spec.ts`, `promise-supersede.spec.ts` |
| Docs/Scripts | `backfill-promise-slots.ts`, plan + design docs |

---

## Issues

### Critical

#### C1 — `Number()` on Decimal money field in DB write path
**File**: `apps/api/src/modules/overdue/overdue.service.ts`

The legacy-compat fallback path uses `Number()` to coerce DTO money values before passing them to `prisma.promiseSlot.createMany()`. The schema field is `settlementAmount Decimal @db.Decimal(12, 2)` — writing a JS float risks silent precision loss (e.g. THB 12,345.67 → 12345.670000000001).

```ts
// BAD — lines ~55 and ~63 in the diff:
settlementAmount: Number(dto.settlementAmount ?? 0),
settlementAmount: Number(dto.secondSettlementAmount ?? 0),
```

**Fix**: Use `new Prisma.Decimal(dto.settlementAmount ?? 0)` in both slots.

#### C2 — `Number()` on Decimal money field in DB write path (active-promise copy)
**File**: `apps/api/src/modules/overdue/overdue.service.ts`

Same pattern when copying `settlementAmount` from an existing active promise into the cycle-deadline response object AND into DB update payloads:

```ts
// BAD — line ~189:
settlementAmount: Number((active as any).settlementAmount ?? 0),
```

If this value flows back into a DB write (e.g. cycle-deadline copy), it must stay `Prisma.Decimal`. If it is response-only, coerce correctly with `.toNumber()` (acceptable for serialization, document the intent).

**Fix**: Determine whether this field is ever written back to DB. If yes, keep as `Prisma.Decimal`. If response-only, add a comment and use `.toNumber()` explicitly.

---

### Warning

#### W1 — `Number()` for arithmetic on money in response mapper
**File**: `apps/api/src/modules/overdue/overdue.service.ts`

```ts
// line ~219:
remainingAmount: Number(new Prisma.Decimal(p.amountDue as Prisma.Decimal).sub(p.amountPaid as Prisma.Decimal)),
```

`Prisma.Decimal` arithmetic is correct here, but the final `Number()` conversion loses Decimal precision in the API response. Prefer `.toNumber()` (semantically equivalent but shows intent) and document that this is display-only.

#### W2 — Frontend slot payload uses `number` type for settlement amounts
**File**: `apps/web/src/pages/CollectionsPage/hooks/useContactLog.ts`

The `LogContactPayload.slots` interface declares `settlementAmount: number`. This means JS floating-point is used for amounts that flow from the form to the API. For amounts < 10M THB the precision risk is low in practice, but it's inconsistent with the Decimal-everywhere rule.

Consider `settlementAmount: string` (sending as string and parsing on the server with `new Prisma.Decimal()`).

#### W3 — Frontend money aggregation uses `Number()`
**File**: `apps/web/src/pages/CollectionsPage/tabs/PromiseTab.tsx`

```ts
(acc, s) => acc + (Number(s.settlementAmount) || 0)
```

UI display only — no DB write — but adds up floats. Acceptable for display; document with a comment.

---

### Info

#### I1 — New crons properly guarded by Sentry + error isolation
`NoPromiseLockCron` and `PromiseResolutionCron` both wrap their full execution in try/catch with `Sentry.captureException`, matching the project cron pattern. ✅

#### I2 — DB queries consistently include `deletedAt: null`
All new Prisma queries in the diff include `deletedAt: null` where applicable. ✅

#### I3 — New controller endpoints have `@Roles` decorators
`getCycleDeadline` and `getOverdueInstallments` both carry `@Roles(...)`. Class-level `@UseGuards` is inherited from the existing controller. ✅

#### I4 — Backfill script
`apps/api/scripts/backfill-promise-slots.ts` uses `any[]` type in slots array. Fine for a one-off migration script, but make sure it is never imported from production code.

#### I5 — Large plan doc
`docs/plans/2026-04-27-promise-to-pay-lifecycle.md` is 2,955 lines — largest file in the diff. Not a code issue but confirms this is a design-heavy feature; ensure the API spec in the doc matches the final implementation before merge.

---

## Fix Checklist

- [ ] **C1**: Replace `Number(dto.settlementAmount ?? 0)` → `new Prisma.Decimal(dto.settlementAmount ?? 0)` (both slots in legacy-compat path)
- [ ] **C2**: Audit whether `settlementAmount: Number((active as any).settlementAmount ?? 0)` flows into a DB write; if yes convert to Decimal; if response-only add a comment
- [ ] **W1**: Change `Number(new Prisma.Decimal(...).sub(...))` → `.toNumber()` with a comment
- [ ] **W2**: Consider changing `slots[].settlementAmount` to `string` in the payload interface
- [ ] **W3**: Add display-only comment to frontend float aggregation
