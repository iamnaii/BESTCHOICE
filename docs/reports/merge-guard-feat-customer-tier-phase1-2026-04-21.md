# Merge Guard Report — feat/customer-tier-phase1
**Date**: 2026-04-21  
**Branch**: `feat/customer-tier-phase1`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Recommendation**: ✅ **APPROVE**

---

## File Changes Summary

17 files changed, 2021 insertions(+), 7 deletions(-)

| Area | Files |
|------|-------|
| Backend (new) | `customer-tier.service.ts`, `dto/tier.dto.ts`, `customer-tier.service.spec.ts` |
| Frontend (new) | `CustomerTierBadge.tsx`, `types/customer-tier.ts`, `CustomerTierBadge.test.tsx` |
| Frontend (modified) | `CustomersPage.tsx` (tier column + filter), customer detail page (tier badge) |
| E2E | `customer-tier.spec.ts` |
| Planning docs | `2026-04-20-customer-tier-phase1.md` (1132 lines), `customer-intake-credit-check-redesign-design.md` (307 lines) |

---

## Feature Overview

Adds a 5-tier customer rating system (GOLD / GOOD / NEW / RISKY / BLACKLIST) computed from contract and payment history. New `GET /customers/:id/tier` endpoint, `CustomerTierBadge` component, tier column in customers list, and tier filter.

---

## Issues by Severity

### Critical
None found.

### Warning
None found.

### Info

**[INFO-1] Decimal→Number conversion at response boundary**  
File: `apps/api/src/modules/customers/customer-tier.service.ts`  
`currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber()`  
The internal calculation uses `Prisma.Decimal` throughout (correct). The `.toNumber()` call is at the JSON serialization boundary only — no further arithmetic performed on the result. This is acceptable, but worth noting as a deliberate deviation from the "no Number() on money" rule applied at a safe boundary.

**[INFO-2] Amber named color in badge**  
File: `apps/web/src/components/customer/CustomerTierBadge.tsx`  
`GOLD: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'`  
Uses Tailwind named color `amber-*` instead of a CSS variable token. The rules prohibit hardcoded hex colors and `gray-*` classes; amber is a deliberate semantic choice for GOLD tier visual distinction and not a gray alias. Acceptable in this context.

**[INFO-3] Planning documents committed to main codebase**  
Two large markdown planning documents (1132 + 307 lines) are included in the branch commit. These are in `apps/api/prisma/plans/` and will persist in the repo. Not a code quality issue, but consider whether they belong in the repo or in a wiki/Notion.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new endpoints | ✅ Inherited from CustomersController class-level guard |
| `@Roles(...)` on new method | ✅ `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` |
| `deletedAt: null` in queries | ✅ All 3 Prisma queries include soft-delete filter |
| `Number()` on money fields | ✅ Decimal used internally; `.toNumber()` only at JSON boundary |
| Hardcoded secrets | ✅ None |
| SQL injection via `$queryRaw` | ✅ Not used |
| Missing DTO validation | ✅ No new DTOs requiring input validation (response DTO only) |

---

## Summary

Clean, well-structured feature addition. Tier computation is pure (no side effects), DB queries follow soft-delete conventions, and the security boundary inherits correctly from the existing customers controller. The 1132-line planning doc commit is the only noteworthy point.
