# Merge Guard Report — feat/collections-promise-to-pay-lifecycle

**Date**: 2026-04-30  
**Branch**: `feat/collections-promise-to-pay-lifecycle`  
**Last commit**: `04000e85` (2026-04-28 10:59 +0700)  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

44 files changed, 7373 insertions(+), 525 deletions(-)

| Area | Key Files |
|------|-----------|
| Prisma Schema | `schema.prisma` (+90 lines: PromiseSlot model, CallLog lifecycle fields) |
| Migrations | 2 SQL migrations (6 lines + 59 lines) |
| API — New Services | `promise.service.ts` (new, 225 lines), `mdm-lock.service.ts` (new, 81 lines) |
| API — New Crons | `promise-resolution.cron.ts` (new, 231 lines), `no-promise-lock.cron.ts` (new, 136 lines) |
| API — Removed | `broken-promise.cron.ts` (deleted, -121 lines) |
| API — Overdue | `overdue.service.ts` (+189 lines), `overdue.controller.ts` (+14 lines) |
| API — Payments | `payments.service.ts` (+143 lines) |
| Frontend | `ContactLogDialog.tsx` (major refactor, +631 lines net) |
| Frontend — New | `InstallmentPickerPopover.tsx` (new, 117 lines), `SupersedePromiseConfirmDialog.tsx` (new, 76 lines) |
| Frontend — Hooks | `usePromiseSlots.ts` (new), `useContactLog.ts` (+10 lines) |
| Frontend — Tabs | `PromiseTab.tsx` (+109 lines) |
| Tests | 8 new spec files, ~800 new test lines |
| E2E | 2 new Playwright specs (`promise-lifecycle-happy.spec.ts`, `promise-supersede.spec.ts`) |
| Backfill | `apps/api/scripts/backfill-promise-slots.ts` (new, 195 lines) |
| Docs | Plan + design docs (~3,400 lines) |

---

## Issues Found

### ⚠️ Warning (2)

#### W1 — `Number()` on Decimal money in production service code (`overdue.service.ts`)

**File**: `apps/api/src/modules/overdue/overdue.service.ts` (lines 964, 972, 1308)

Three instances where `Number()` is applied to money values that feed into a `PromiseSlot.settlementAmount` (`Decimal @db.Decimal(12,2)`) write:

```typescript
// Lines 964, 972 — slot construction before createPromise() call
settlementAmount: Number(dto.settlementAmount ?? 0),
settlementAmount: Number(dto.secondSettlementAmount ?? 0),

// Line 1308 — API response read (getCycleDeadline)
settlementAmount: Number((active as any).settlementAmount ?? 0),
```

For lines 964/972: the slot input is passed to `this.promiseService.createPromise()`, which calls `new Prisma.Decimal(s.settlementAmount)` before the actual DB write — so the float precision risk is mitigated there. However, `Number()` of a DTO value that is typed as `number` from `@IsNumber()` is redundant and misleading; prefer `new Prisma.Decimal(dto.settlementAmount ?? 0)` at the earliest point.

For line 1308: this is a read-only API response shape, not a DB write, but it drops Decimal precision for the caller.

**Fix**: Replace the three `Number(...)` calls with `new Prisma.Decimal(...).toNumber()` (for responses) or pass the raw value directly (for DB-bound slots, let `createPromise` handle the Decimal conversion).

#### W2 — `any` type in production cron code

**File**: `apps/api/src/modules/overdue/crons/promise-resolution.cron.ts`

```typescript
private async resolvePromise(p: any, now: Date, cutoff: Date, systemUserId: string): Promise<void>
```

The parameter `p` is typed as `any` in a production cron method, bypassing type safety. This method processes real `PromiseSlot`/`CallLog` data from the DB. A narrow type (the shape returned by the Prisma `include`) should be used instead.

---

### ℹ️ Info (3)

#### I1 — `ContactLogDialog.tsx` exceeds 600 net added lines

The component grows to 631+ lines of additions making it one of the largest frontend files. The N-slot manager, cycle deadline banner, supersede confirm, and installment picker could be further decomposed. No functional issue but raises maintainability concern.

#### I2 — `any` types in test files

Multiple test files (`no-promise-lock.cron.spec.ts`, `mdm-lock.service.spec.ts`, etc.) use `let prisma: any` and `const tx: any` for mock setup. Acceptable in test isolation but worth typing against `DeepMockProxy<PrismaService>` for consistency with other spec files in the codebase.

#### I3 — Large PR size

44 files, 7,373 insertions is the largest branch under review. Recommend verifying all test suites pass locally before merge (`./tools/check-types.sh all` + `npx playwright test`).

---

## Security Checklist

| Check | Status |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ New endpoints on existing guarded `OverdueController` |
| All new controller methods have `@Roles()` | ✅ `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')` on both new GET endpoints |
| No `Number()` on DB-bound money fields | ⚠️ See W1 — 3 instances in `overdue.service.ts` |
| `deletedAt: null` in all new queries | ✅ Present in `promise.service.ts`, `no-promise-lock.cron.ts`, `promise-resolution.cron.ts` |
| No hardcoded secrets / API keys | ✅ Clean |
| No unparameterized `$queryRaw` | ✅ Clean |
| No raw `fetch()` in frontend | ✅ Uses `api.get()`/`api.post()` from `@/lib/api` |
| `queryClient.invalidateQueries()` after mutations | ✅ Present in `useContactLog.ts` and `usePromiseSlots.ts` |
| DTO validation decorators present | ✅ `@IsNumber`, `@IsArray`, `@IsOptional`, `@IsDateString` on all new DTO fields |
| Thai validation messages | ✅ Present on DTO fields |
| Idempotent crons | ✅ `no-promise-lock.cron` filters `deviceLocked: false`; `promise-resolution.cron` filters by terminal state |

---

## Recommendation: ⚠️ REVIEW

This is a significant and well-designed feature — the Promise-to-Pay Lifecycle Redesign described in the CLAUDE.md v5 hardening spec. The core new services (`promise.service.ts`, `mdm-lock.service.ts`, both crons) are clean with proper `deletedAt: null` filters and good test coverage.

**Block conditions**:
1. **W1**: Fix the 3 `Number()` calls in `overdue.service.ts` (lines 964, 972, 1308). The risk to live data is low since `createPromise` wraps them in `Prisma.Decimal`, but the pattern contradicts the v4 Decimal precision policy.
2. **W2**: Type the `resolvePromise(p: any, ...)` parameter in `promise-resolution.cron.ts` with an explicit interface.

Both fixes are small. After those two changes, this branch is ready to merge.
