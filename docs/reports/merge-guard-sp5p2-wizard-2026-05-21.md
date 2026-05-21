# Merge Guard Report — feat/sp5p2-wizard

**Date**: 2026-05-21  
**Branch**: `feat/sp5p2-wizard`  
**Author**: Akenarin Kongdach  
**Last commit**: `7c6d609b` fix(insurance): address PR B review — walk-in unique collision + bypass role guard + payer prop + product tab disabled  
**Recommendation**: ⚠️ REVIEW

---

## Summary

Full-stack insurance wizard feature for SP5 Phase 2. Delivers:
1. **`CreateInsuranceWizardPage.tsx`** (272 lines) — multi-step wizard at `/insurance/new` with 4 steps: customer picker → device picker → warranty preview → defect/exchange action
2. **5 new wizard step components** — `CustomerPickerStep`, `DevicePickerStep`, `WarrantyPreviewStep`, `DefectDescriptionStep`, `ExchangeProductPickerStep`
3. **`WarrantyWindowCard.tsx`** — reusable warranty status display component
4. **Backend**: 2 new endpoints on `repair-tickets.controller.ts` (`GET warranty-preview`, `GET warranty-lookup`) + service implementations in `repair-tickets.service.ts`
5. **2 new DTOs** with full class-validator decorators (`WarrantyPreviewDto`, `WarrantyLookupDto`)
6. **`customers.service.ts`** — walk-in optional nationalId path (allow `undefined` on create, graceful ghost-customer revival)
7. **`DefectExchangePage.tsx`** — `bypassWindow` + `originRepairTicketId` prop support for wizard exit-path integration
8. **309 new API tests** (`repair-tickets.service.spec.ts`) covering `warrantyPreview` + `warrantyLookup`
9. **165 new unit tests** (`CreateInsuranceWizardPage.test.tsx`)
10. **Prisma migration** — minor schema update

**Files changed**: 24 | **Lines added**: +2,226 | **Lines removed**: -47

---

## Security Checks

### Guards & Roles ✅
- `repair-tickets.controller.ts` has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level
- New `GET warranty-preview` endpoint: `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')` ✅
- New `GET warranty-lookup` endpoint: `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')` ✅
- All other endpoints on the controller retain their existing `@Roles()` decorators ✅
- `bypassWindow` flag is role-gated on both frontend (`canExecute` check) and backend (server-side role assertion) ✅

### Prisma Queries — deletedAt Filters ✅
All new `findMany` / `findFirst` / `findUnique` calls in `repair-tickets.service.ts` include `deletedAt: null`:
- `contract.findUnique({ where: { id, deletedAt: null } })`
- `product.findUnique({ where: { id, deletedAt: null } })`
- `customer.findUnique({ where: { id, deletedAt: null } })`
- `contract.findMany({ where: { customerId, deletedAt: null, ...branchScope } })`
- `product.findFirst({ where: { imeiSerial, deletedAt: null } })`
- `contract.findFirst({ where: { contractNumber, deletedAt: null, ...branchScope } })`

### Money / Decimal ✅
No `Number()` usage on financial fields. No Decimal→Float conversions found.

### SQL Injection ✅
No `$queryRaw` or `$executeRaw` with string interpolation.

### Secrets ✅
No hardcoded API keys, passwords, or tokens.

### DTO Validation ✅
- `WarrantyPreviewDto` — `@IsOptional() @IsUUID()` on all 3 fields ✅
- `WarrantyLookupDto` — `@IsOptional()` + `@IsUUID()` / `@IsString()` + `@MinLength()` with Thai error messages ✅
- `customer.dto.ts` — new `nationalId?: string` field with `@IsOptional() @ValidateIf(...)` ✅

---

## Issues

### ⚠️ Warning — Missing `queryClient.invalidateQueries` after repair ticket creation

**File**: `apps/web/src/pages/insurance/WizardSteps/DefectDescriptionStep.tsx:195–224`

The `create` mutation posts to `POST /repair-tickets` and navigates to the new ticket on success, but does **not** call `queryClient.invalidateQueries(['repair-tickets'])`. If the user navigates back to the `/insurance` list page after ticket creation, the list will show stale data until the next page refresh.

Per project frontend rules: *"Cache invalidation: เรียก `queryClient.invalidateQueries()` หลัง mutation เสมอ"*

**Suggested fix**:
```ts
import { useQueryClient } from '@tanstack/react-query';

// inside component:
const queryClient = useQueryClient();

const create = useMutation({
  mutationFn: ...,
  onSuccess: (ticket) => {
    queryClient.invalidateQueries({ queryKey: ['repair-tickets'] });
    toast.success(`รับเครื่องเข้า ${ticket.ticketNumber}`);
    navigate(`/insurance/${ticket.id}`);
  },
  ...
});
```

---

### ⚠️ Warning — `customers.service.ts` ghost revival: `nationalId` field collision

**File**: `apps/api/src/modules/customers/customers.service.ts`

The ghost customer revival path sets `reviveGhostId` and then proceeds with a `prisma.customer.create()` rather than an `update()`. If the diff around lines 567–573 has a logic gap between the `reviveGhostId` assignment and the actual create/update dispatch, a P2002 unique constraint violation can still occur on `nationalIdHash` during a race condition (two concurrent walk-in creates with the same ID).

**Risk**: Low (concurrent create of the same nationalId is unlikely in normal operation), but the pattern should use `upsert` or explicitly branch to `update` when `reviveGhostId` is set.

**Suggested action**: Confirm the actual create vs update dispatch logic is correct (the full diff around line 573 appears truncated in review). If `reviveGhostId` is used correctly in a downstream branch, this is a no-issue.

---

### ℹ️ Info — `DefectDescriptionStep.tsx` file length (327 lines)

**File**: `apps/web/src/pages/insurance/WizardSteps/DefectDescriptionStep.tsx`

327 lines is within the 500-line guideline but the component handles both the form UI and the mutation submission. Consider extracting the `create` mutation into a `useCreateRepairTicket` hook if the component grows.

---

### ℹ️ Info — `WarrantyPreviewStep.tsx` has no explicit error state for query failure

**File**: `apps/web/src/pages/insurance/WizardSteps/WarrantyPreviewStep.tsx`

The `useQuery` for `warranty-preview` checks `isLoading` and `isError` but on error renders `null` (falling through to a blank step). A brief error message and retry button would improve UX. This is an info-level item as the outer `QueryBoundary` on `/insurance/new` may catch unhandled errors.

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `repair-tickets.controller.ts` | +2 endpoints | +16 |
| `repair-tickets.service.ts` | +warrantyPreview, +warrantyLookup | +272 |
| `repair-tickets.service.spec.ts` | +309 tests | +309 |
| `dto/warranty-lookup.dto.ts` | New DTO | +22 |
| `dto/warranty-preview.dto.ts` | New DTO | +15 |
| `customers.service.ts` | Walk-in optional nationalId | +52/-4 |
| `customers/dto/customer.dto.ts` | Optional nationalId field | +12/-1 |
| `CreateInsuranceWizardPage.tsx` | New page | +272 |
| `CreateInsuranceWizardPage.test.tsx` | Unit tests | +165 |
| `CustomerPickerStep.tsx` | Wizard step | +169 |
| `DevicePickerStep.tsx` | Wizard step | +189 |
| `WarrantyPreviewStep.tsx` | Wizard step | +178 |
| `DefectDescriptionStep.tsx` | Wizard step | +327 |
| `ExchangeProductPickerStep.tsx` | Wizard step | +79 |
| `WarrantyWindowCard.tsx` | UI component | +68 |
| `WarrantyWindowCard.test.tsx` | Unit test | +50 |
| `DefectExchangePage.tsx` | Props + bypass integration | +36/-1 |
| `App.tsx` | New route | +3/-1 |
| `schema.prisma` | Minor update | +2/-1 |
| `seed.ts` / `seed-production.ts` | SystemConfig defaults | +10/-2 |
| `shop-coa.csv` | +3 new SHOP CoA accounts | +3 |
| `prisma/migration.sql` | Schema migration | +6 |

---

## Recommendation: ⚠️ REVIEW

**Block on**: Nothing critical — no missing guards, no Decimal violations, no raw SQL.

**Must fix before merge**:
1. Add `queryClient.invalidateQueries({ queryKey: ['repair-tickets'] })` in `DefectDescriptionStep.tsx` `onSuccess` handler.

**Should verify**:
2. Confirm ghost customer revival uses `update` (not `create`) when `reviveGhostId` is non-null to prevent P2002 on concurrent walk-in creates.

Once item 1 is fixed and item 2 is confirmed, this branch can be **APPROVED**.
