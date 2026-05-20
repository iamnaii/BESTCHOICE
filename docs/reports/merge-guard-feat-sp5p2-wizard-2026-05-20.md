# Merge Guard Report — feat/sp5p2-wizard

**Date**: 2026-05-20  
**Branch**: `feat/sp5p2-wizard`  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| Category | Count |
|---|---|
| Files changed | 24 |
| Insertions | +2,226 |
| Deletions | −47 |

Key files:
- `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts` — **new** controller (10 routes)
- `apps/api/src/modules/repair-tickets/dto/warranty-lookup.dto.ts` — **new** DTO
- `apps/api/src/modules/repair-tickets/dto/warranty-preview.dto.ts` — **new** DTO
- `apps/web/src/pages/insurance/CreateRepairTicketPage.tsx` — **new** (327 lines)
- `apps/web/src/pages/insurance/WizardSteps/ExchangeProductPickerStep.tsx` — **new** (79 lines)
- `apps/web/src/pages/insurance/WizardSteps/WarrantyPreviewStep.tsx` — **new** (178 lines)
- `apps/web/src/pages/insurance/components/WarrantyWindowCard.tsx` — **new** (68 lines)
- `apps/web/src/pages/insurance/components/WarrantyWindowCard.test.tsx` — **new** (50 lines)
- `apps/api/prisma/seed.ts` — CoA code correction (`53-1306` → `S51-1105`, `42-1106` → `S42-1101`)

---

## Issues Found

### Critical
_None found._

### Warning

**WARN-1**: `any` types in `repair-tickets.service.ts` (5 occurrences in `warrantyLookup` method)

```ts
// apps/api/src/modules/repair-tickets/repair-tickets.service.ts
let contracts: any[] = [];
let customer: any = null;
contracts = product.contracts.map((c: any) => ({ ...c, product }));
.map((c: any) => {
.filter((d: any) => d.product !== null);
```

These are in the `warrantyLookup` method which assembles a polymorphic result set (customer contracts + walk-in product lookup). The `any` prevents TypeScript from catching mapping mistakes on the returned shape. Should be typed with inline interfaces or Prisma's generated types + `Prisma.ContractGetPayload<...>`.

**WARN-2**: `CreateRepairTicketPage.tsx` `useMutation` does not call `queryClient.invalidateQueries()` on success

```ts
const create = useMutation({
  onSuccess: (ticket: { id: string; ticketNumber: string }) => {
    navigate(`/insurance/${ticket.id}`);
  },
  ...
});
```

After creating a ticket the page navigates to the detail page, so the repair-ticket list will not show the new entry if the user returns via Back. The query will refetch on mount but the stale-while-revalidate window means the list could momentarily show outdated data. Low severity because the navigation makes an immediate stale-list read unlikely, but inconsistent with the project pattern.

### Info

**INFO-1**: Seed CoA code correction (`53-1306` → `S51-1105`, `42-1106` → `S42-1101`) in both `seed.ts` and `seed-production.ts`. Aligns with accounting.md documentation (SHOP CoA prefix convention). Verify these accounts exist in the SHOP CoA CSV fixture (`shop-coa.csv`) before deploying to production.

---

## Security Checks

| Check | Result |
|---|---|
| New controllers with missing `@UseGuards` | ✅ `repair-tickets.controller.ts` has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level |
| Missing `@Roles()` on controller methods | ✅ All 10 routes have `@Roles(...)` decorators |
| `Number()` on money/Decimal fields | ✅ None |
| `findMany`/`findFirst` missing `deletedAt: null` | ✅ All production queries include `deletedAt: null` (test mocks correctly excluded) |
| Hardcoded secrets / API keys | ✅ None |
| Raw `fetch()` in React components | ✅ None — wizard uses `api.post()` correctly |
| Unparameterized `$queryRaw` | ✅ None |
| New DTO Thai validation messages | ✅ Present on `warranty-lookup.dto.ts` and `warranty-preview.dto.ts` |

---

## Pattern Compliance

- Controller guard pattern correct: class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`, per-method `@Roles()`
- DTOs have Thai validation messages (`'customerId ต้องเป็น UUID'`, etc.)
- `findUnique`/`findMany` in service include `deletedAt: null` guards
- React wizard components use `useQuery` + `api.get()` / `api.post()` (no raw `fetch()`)
- New `WarrantyWindowCard.tsx` (68 lines) has accompanying unit tests

---

## Recommendation

**⚠️ REVIEW**

Branch is functionally solid and security controls are in place. Two warnings should be addressed before merge:

1. **WARN-1** (type safety): Replace 5× `any` in `warrantyLookup` with proper Prisma payload types or a local interface. This is a compile-time safety issue, not a runtime bug, but it weakens the type coverage in a new module.

2. **WARN-2** (cache invalidation): Add `queryClient.invalidateQueries({ queryKey: ['repair-tickets'] })` in the `onSuccess` callback of `CreateRepairTicketPage.tsx` to keep the list cache consistent on back-navigation.

Both are quick fixes. WARN-1 in particular is worth addressing to maintain the zero-`any` standard established in the backend rules.
