# Merge Guard Report — feat/collections-promise-to-pay-lifecycle

**Date**: 2026-05-04  
**Branch**: `feat/collections-promise-to-pay-lifecycle`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Base**: `origin/main`  
**Last commit**: 2026-04-28 10:59 +0700

---

## File Changes Summary

44 files changed — 7,373 insertions, 525 deletions.

| Area | Files |
|------|-------|
| New services | `promise.service.ts` (225 lines), new crons × 3 |
| Overdue service | `overdue.service.ts` (1,342 lines total), `overdue.controller.ts`, `overdue.module.ts` |
| MDM lock | `mdm-lock.service.ts` |
| Payments | `payments.service.ts`, `payments.module.ts` |
| Prisma | `schema.prisma` (new `PromiseSlot` model), 2 migrations |
| Frontend | `ContactLogDialog.tsx` (610 lines), `SupersedePromiseConfirmDialog.tsx`, `InstallmentPickerPopover.tsx`, `PromiseTab.tsx` |
| Frontend hooks | `useContactLog.ts`, `usePromiseSlots.ts` |
| Tests | 7 spec files + 2 E2E specs |
| Backfill script | `scripts/backfill-promise-slots.ts` |
| Docs | 2 design/plan docs + 1 mockup HTML |

---

## Issues

### Critical (must fix before merge)

**C-001 — `Number()` on `Decimal` money fields written to database (`overdue.service.ts`)**

`PromiseSlot.settlementAmount` is `Decimal @db.Decimal(12,2)` in the Prisma schema. The service writes `Number(...)` values directly to this column in two DB write paths:

```typescript
// overdue.service.ts line 964
settlementAmount: Number(dto.settlementAmount ?? 0),

// overdue.service.ts line 972
settlementAmount: Number(dto.secondSettlementAmount ?? 0),
```

Using JavaScript `Number` (IEEE 754 double) for financial amounts risks silent precision loss above 9 quadrillion — and more importantly violates the project rule that all money fields must use `Prisma.Decimal`. Fix:

```typescript
// Correct
settlementAmount: new Prisma.Decimal(dto.settlementAmount ?? 0),
settlementAmount: new Prisma.Decimal(dto.secondSettlementAmount ?? 0),
```

**C-002 — `Number()` on response-mapped `remainingAmount` and `settlementAmount`**

Even in read paths, passing `Decimal` through `Number()` before returning can silently lose cents for large amounts and sets a bad precedent:

```typescript
// overdue.service.ts line 1338
remainingAmount: Number(new Prisma.Decimal(p.amountDue as Prisma.Decimal).sub(p.amountPaid as Prisma.Decimal)),

// overdue.service.ts line 1308
settlementAmount: Number((active as any).settlementAmount ?? 0),
```

These feed the API response consumed by the frontend. If the frontend accumulates or compares these values, float drift can occur. Prefer returning `string` (`.toString()`) or keeping as `Prisma.Decimal` until the serialization boundary.

---

### Warning (should fix)

**W-001 — Unsafe `any` cast on financial object (`overdue.service.ts` line 1308)**

```typescript
settlementAmount: Number((active as any).settlementAmount ?? 0),
```

`(active as any)` bypasses TypeScript's type safety on a financial field. The type of `active` should be typed explicitly. At minimum, extract the cast to a variable with a proper type annotation so the compiler can verify the field exists and is `Decimal`.

**W-002 — `overdue.service.ts` is 1,342 lines**

This file is significantly over the 500-line guideline. The new `getCycleDeadline` and `getOverdueInstallments` logic could be extracted into `promise.service.ts` (already exists) or a dedicated query helper — this would also make the file easier to test in isolation.

**W-003 — `ContactLogDialog.tsx` is 610 lines**

The dialog grew to 610 lines with the N-slot manager, supersede confirm, and installment picker integration. Consider splitting into sub-components once the slot manager stabilises, but not blocking.

**W-004 — `@IsNumber` on legacy DTO fields for money**

Same as the partial-payment-escalate branch — `settlementAmount` and `secondSettlementAmount` in `log-contact.dto.ts` use `@IsNumber` and are typed as `number`. Consider `@IsDecimal`/`@IsNumberString` for precision-sensitive fields.

---

### Info

**I-001 — New endpoints have correct guards**

Both new GET endpoints on `@Controller('overdue')` (class has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`):
- `@Get('contracts/:id/cycle-deadline')` → `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')` ✓
- `@Get('contracts/:id/overdue-installments')` → `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')` ✓

**I-002 — Frontend hooks follow correct patterns**

`useContactLog` and related hooks:
- Use `api.patch` (not raw `fetch`) ✓
- Call `queryClient.invalidateQueries` on success ✓
- Use `toast.error` on failure ✓

`usePromiseSlots` is pure local state (`useState`) — no server calls, correct pattern ✓.

**I-003 — Crons have error handling**

`promise-resolution.cron.ts` and `no-promise-lock.cron.ts` — check if they have Sentry capture on failure (pattern established in v2 hardening). The `broken-promise.cron.ts` replacement should follow the same pattern.

**I-004 — Backfill script safety**

`scripts/backfill-promise-slots.ts` should be reviewed to confirm it:
- Does not run automatically on deploy.
- Has idempotency guard (won't double-create slots).
- Is invoked manually with explicit confirmation.

---

## Recommendation

**BLOCK** — Two Critical issues must be fixed before merge:

1. **C-001**: `Number(dto.settlementAmount)` written to `Decimal` DB column — replace with `new Prisma.Decimal(...)`.
2. **C-002**: `Number()` on Decimal in API response mapping — return as `.toString()` or `Prisma.Decimal`.

After fixing C-001 and C-002, also address W-001 (remove `any` cast) and re-run `./tools/check-types.sh all` to confirm zero TypeScript errors.
