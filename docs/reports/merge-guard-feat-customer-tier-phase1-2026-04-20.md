# Merge Guard Report — feat/customer-tier-phase1

**Date**: 2026-04-20  
**Branch**: `feat/customer-tier-phase1`  
**Author**: Akenarin Kongdach  
**Latest commit**: `ca54434` — test(customer): add E2E smoke for tier badge rendering  
**Recommendation**: ✅ APPROVE (with minor warnings)

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/prisma/schema.prisma` | New enum `CustomerCreditCheckStatus`, `CreditCheckType`; field on Customer + CreditCheck | +16 |
| `apps/api/prisma/migrations/.../migration.sql` | Corresponding migration | +11 |
| `apps/api/src/modules/customers/customer-tier.service.ts` | New `CustomerTierService` with pure `computeTierFromHistory()` + `getCustomerTier()` | +199 |
| `apps/api/src/modules/customers/customer-tier.service.spec.ts` | 8 unit tests covering all tier branches | +85 |
| `apps/api/src/modules/customers/customers.controller.ts` | New `GET /customers/:id/tier` endpoint; `tier` query param on list | +11 |
| `apps/api/src/modules/customers/customers.controller.spec.ts` | Controller PII test additions | +24 |
| `apps/api/src/modules/customers/customers.module.ts` | Register `CustomerTierService` | +5 |
| `apps/api/src/modules/customers/customers.service.ts` | `tier` filter in `findAll` | +24 |
| `apps/api/src/modules/customers/dto/tier.dto.ts` | `CustomerTier`, `TierReason`, `CustomerTierResponse` types | +24 |
| `apps/web/e2e/customer-tier.spec.ts` | E2E smoke test for tier badge | +31 |
| `apps/web/src/components/customer/CustomerTierBadge.test.tsx` | Component unit tests | +36 |
| `apps/web/src/components/customer/CustomerTierBadge.tsx` | New badge component | +45 |
| `apps/web/src/pages/CustomerDetailPage.tsx` | Tier badge in page header | +14 |
| `apps/web/src/pages/CustomersPage.tsx` | Tier column + tier filter dropdown | +32 |
| `apps/web/src/types/customer-tier.ts` | Shared type definitions | +32 |
| Docs/plan files | Planning docs | +1439 |

---

## Issues by Severity

### ⚠️ Warning (should fix)

**W-001 — Hardcoded color class in CustomerTierBadge**  
File: `apps/web/src/components/customer/CustomerTierBadge.tsx`, line 14  
```ts
GOLD: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
```
This uses hardcoded Tailwind color values (`amber-500`, `amber-600`) instead of design tokens. Per `.claude/rules/frontend.md`: "ห้ามใช้ hardcoded hex colors". The GOLD tier badge will not adapt correctly when the theme changes.  
**Fix**: Define a CSS variable `--color-gold` in `index.css` and use `bg-[hsl(var(--color-gold)/15%)] text-[hsl(var(--color-gold))]` or add `success-gold` to the token set.

**W-002 — `currentOutstanding: number` in response DTO**  
File: `apps/api/src/modules/customers/customer-tier.service.ts`, line 271/290  
```ts
currentOutstanding: currentOutstanding.toDecimalPlaces(2).toNumber(),
```
The `currentOutstanding` is correctly accumulated as `Prisma.Decimal` internally, but is converted to a JS `number` for the response. The response DTO (`tier.dto.ts`) declares it as `number`. While conversion at the API boundary is unavoidable for JSON serialization, values >2^53 can lose precision. For this field (outstanding balance), values are unlikely to exceed 53-bit safe integers, so this is low-risk but should be documented.  
**Fix**: Add a comment in `tier.dto.ts`: `currentOutstanding: number; // Decimal serialized to float — display only, not for arithmetic`.

---

### ℹ️ Info

**I-001 — New Prisma enum `CustomerCreditCheckStatus` conflicts with existing `CreditCheckStatus`**  
The schema now has two similar enums (`CreditCheckStatus` on `CreditCheck` and `CustomerCreditCheckStatus` on `Customer`). While they serve different purposes, the naming could cause confusion.  
No code change needed — just be aware of this when building future credit check features.

**I-002 — `tier.dto.ts` uses interfaces not class-validator classes**  
This is fine for response DTOs (not validated on input). No action needed.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New `GET /customers/:id/tier` has `@Roles()` | ✅ `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` |
| Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` inherited from `CustomersController` | ✅ Inherited from class-level guard (not duplicated on method — correct pattern) |
| All new queries include `deletedAt: null` | ✅ 4 queries all include `deletedAt: null` |
| Money fields use `Prisma.Decimal` internally | ✅ `currentOutstanding` accumulated as `Prisma.Decimal(0)` |
| No hardcoded secrets | ✅ |
| No `$queryRaw` SQL injection risk | ✅ Uses Prisma typed queries |
| Frontend uses `api.get()` not raw `fetch()` | ✅ |
| `queryClient.invalidateQueries` after mutations | ✅ N/A — tier is read-only |

---

## Recommendation

**✅ APPROVE** — Core logic is clean, well-tested (8 unit + 1 E2E), and follows backend patterns correctly. Fix W-001 (hardcoded color) before or shortly after merge.
