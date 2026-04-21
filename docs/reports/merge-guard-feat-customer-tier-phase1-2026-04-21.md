# Merge Guard Report — feat/customer-tier-phase1

**Date:** 2026-04-21  
**Branch:** `feat/customer-tier-phase1`  
**Author:** iamnaii (akenarin.ak@gmail.com)  
**Diff size:** 17 files changed, 2021 insertions(+), 7 deletions(-)  
**Recommendation:** ✅ APPROVE (with warnings)

---

## File Changes Summary

| Area | Files | Notes |
|------|-------|-------|
| Backend | `customer-tier.service.ts`, `customer-tier.service.spec.ts` | New pure-function tier engine + 8 unit tests |
| Backend | `customers.controller.ts`, `customers.controller.spec.ts` | New `GET /customers/:id/tier` endpoint + test |
| Frontend | `apps/web/src/pages/CustomersPage.tsx` | Tier badge display |
| Frontend | `apps/web/src/types/customer-tier.ts` | TypeScript types |
| Docs | `plans/2026-04-20-customer-tier-phase1.md` + design doc | Planning artifacts |

---

## Issues by Severity

### 🔴 Critical — None

No critical issues found. Guards are correctly inherited:
- `GET /customers/:id/tier` is added to the existing `CustomersController` which already has class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`.
- The new `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` on `getTier` is correct.
- All DB queries include `deletedAt: null`.
- No raw SQL, no hardcoded secrets.

### 🟡 Warning

**W-1: `Decimal.toNumber()` in service response (lines 271, 290 of `customer-tier.service.ts`)**

```typescript
// customer-tier.service.ts:271
currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber(),
```

`currentOutstanding` is accumulated using `Prisma.Decimal` arithmetic (correct), but is converted to `Number` before being included in the response DTO. For a display-only field this is lower risk, but the project convention is to avoid `Number()` conversions on money fields. Precision loss is bounded (toDecimalPlaces(2) is called first), so this is unlikely to cause user-visible bugs.

**Recommendation:** Change the `CustomerTierResponse` type to use `Decimal | number` or `string` for `currentOutstanding`, and return the Decimal directly, serialized via JSON (Prisma Decimal serializes as string automatically).

**W-2: `tier` query filter forwarded to `findAll()` but service implementation unverified**

`GET /customers?tier=GOLD` is accepted in the controller and forwarded to `customersService.findAll()`. The diff doesn't show the service implementation of this filter. Confirm the `CustomersService.findAll()` correctly uses `tier` as a filter, otherwise the query param silently does nothing.

### 🔵 Info

**I-1: Plan docs are very large (1132 + 307 lines)**

Planning markdown files added in the diff are not user-facing. Consider adding them to `.gitignore` or a `docs/plans/` directory that is excluded from code review noise.

**I-2: 8 unit tests cover key tier computation paths**

Tests correctly cover BLACKLIST (bad debt + repossession), RISKY (overdue >30 days), GOLD (2 closed + 100% on-time), GOOD (closed ≥1, ≥90%), GOOD (active + ≥3 on-time), and NEW cases.

---

## Verdict

**✅ APPROVE** — No blocking issues. W-1 and W-2 should be addressed in a follow-up but are not merge blockers. The core logic is well-tested, guards are correct, and data integrity rules are respected.
