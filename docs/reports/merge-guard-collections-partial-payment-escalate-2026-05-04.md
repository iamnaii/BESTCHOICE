# Merge Guard Report — feat/collections-partial-payment-escalate

**Date**: 2026-05-04  
**Branch**: `feat/collections-partial-payment-escalate`  
**Author**: Akenarin Kongdach, Claude (Anthropic), iamnaii  
**Base**: `origin/main`  
**Last commit**: 2026-04-28 12:02 +0700

---

## File Changes Summary

30 files changed — 3,817 insertions, 1,936 deletions.  
⚠️ The bulk of the diff (~3,810 changed lines in `package-lock.json`) is from dependency changes — see W-001.

| Area | Files |
|------|-------|
| New DTOs | `escalate.dto.ts`, `partial-payment-reschedule.dto.ts` |
| Overdue service | `overdue.service.ts`, `overdue.controller.ts`, `overdue.module.ts` |
| Queue service | `queue.service.ts` |
| Frontend | `ContactLogDialog.tsx`, `ContractCard.tsx`, `PromiseTab.tsx`, `PartialPaymentRescheduleDialog.tsx` |
| Frontend hooks | `useContactLog.ts`, `useEscalate.ts`, `usePartialPaymentReschedule.ts` |
| Tests | `overdue.service.spec.ts`, `queue.service.spec.ts`, `ContactLogDialog.test.tsx`, `ContractCard.test.tsx` |
| Deps | `package.json` × 3, `package-lock.json` |

---

## Issues

### Critical (must fix before merge)

**None found.**

---

### Warning (should fix)

**W-001 — Large `package-lock.json` changes (3,810 lines)**

`apps/api/package.json`, `apps/web/package.json`, and `apps/web-shop/package.json` all changed alongside a massive `package-lock.json` diff. This is unusual for a feature branch. Verify:
- These dependency bumps were intentional and tested.
- No unexpected major-version upgrades were introduced.
- `npm audit` passes with no new high/critical CVEs.

**W-002 — `@IsNumber` decorator on `settlementAmount` DTO fields**

```typescript
// log-contact.dto.ts
@IsNumber({ maxDecimalPlaces: 2 }, { message: 'settlementAmount ต้องเป็นตัวเลข' })
settlementAmount?: number;
```

Backend receives `settlementAmount` as `number` (JS float) and stores it in `CallLog.settlementAmount @db.Decimal(12,2)`. Prisma accepts the number, but for precision-critical fields consider `@IsDecimal` or receiving as a string and constructing `Prisma.Decimal` — consistent with other money DTOs in the codebase.

---

### Info

**I-001 — New endpoints have correct guards**

Both new endpoints are on the existing `@Controller('overdue')` which has class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`. Method-level `@Roles` decorators are present:
- `@Post(':contractId/partial-payment-reschedule')` → `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')` ✓  
- `@Post(':contractId/escalate')` → `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')` ✓

**I-002 — Frontend mutation hooks correct pattern**

`useContactLog`, `useEscalate`, and `usePartialPaymentReschedule` all:
- Use `api.patch`/`api.post` (not raw `fetch`) ✓
- Call `queryClient.invalidateQueries` on `onSuccess` ✓
- Use `toast.error(getErrorMessage(err))` on `onError` ✓

**I-003 — `deletedAt: null` present on new queries**

Both new `contract.findFirst` calls in the service include `where: { id: contractId, deletedAt: null }` ✓.

---

## Recommendation

**REVIEW** — Functionally clean, but the `package-lock.json` churn warrants a dependency audit before merging to main. Confirm the dep bumps are deliberate, then **APPROVE**.
