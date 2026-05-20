# Pre-Merge Guard Report

**Branch**: `feat/sp5p2-wizard`
**Author**: Akenarin Kongdach
**Date**: 2026-05-20
**Reviewed by**: Pre-Merge Guard Agent

---

## Summary

SP5 Phase 2 — Insurance/Repair unified wizard. Introduces `CreateInsuranceWizardPage` (4-step: Customer → Device → Warranty Preview → Confirm/Repair Details), five step components, two new read-only backend endpoints (`warranty-preview`, `warranty-lookup`), and corrects seed data CoA codes from legacy FINANCE codes to the correct SHOP `S51-1105` / `S42-1101` codes. Also includes unit tests for the new service methods.

## File Changes

| File | +/− | Notes |
|------|-----|-------|
| `apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx` | +272 | Main wizard orchestrator |
| `apps/web/src/pages/insurance/WizardSteps/DefectDescriptionStep.tsx` | +327 | Step 4 form |
| `apps/web/src/pages/insurance/WizardSteps/CustomerPickerStep.tsx` | +169 | Step 1 |
| `apps/web/src/pages/insurance/WizardSteps/DevicePickerStep.tsx` | +189 | Step 2 |
| `apps/web/src/pages/insurance/WizardSteps/WarrantyPreviewStep.tsx` | +178 | Step 3 |
| `apps/web/src/pages/insurance/WizardSteps/ExchangeProductPickerStep.tsx` | +79 | Step 4 (exchange path) |
| `apps/web/src/pages/insurance/components/WarrantyWindowCard.tsx` | +68 | Shared badge component |
| `apps/web/src/pages/insurance/components/WarrantyWindowCard.test.tsx` | +50 | Component unit tests |
| `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` | +272 | warrantyPreview + warrantyLookup |
| `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts` | +16 | 2 new GET endpoints |
| `apps/api/src/modules/repair-tickets/dto/warranty-preview.dto.ts` | +15 | New DTO |
| `apps/api/src/modules/repair-tickets/dto/warranty-lookup.dto.ts` | +22 | New DTO |
| `apps/api/src/modules/customers/customers.service.ts` | +52/−52 | Walk-in unique collision fix |
| `apps/api/src/modules/customers/dto/customer.dto.ts` | +12/−12 | DTO updates |
| `apps/api/prisma/seed.ts` + `seed-production.ts` | +6/−6 | CoA code correction |
| `apps/web/src/pages/DefectExchangePage.tsx` | +36/−36 | Adapted for wizard embedding |

**Total**: 24 files, 2226 insertions, 47 deletions

---

## Issues Found

### Critical
*None*

### Warning

**[W-1] Missing `queryClient.invalidateQueries` after ticket creation**

`DefectDescriptionStep.tsx` mutation `onSuccess` only navigates to the detail page:

```ts
onSuccess: (ticket) => {
  toast.success(`รับเครื่องเข้า ${ticket.ticketNumber}`);
  navigate(`/insurance/${ticket.id}`);
},
```

No `queryClient.invalidateQueries(['repair-tickets'])` call. If a user opens a new wizard tab while staying on the list page in another session, or navigates Back→Forward after ticket creation, the `/insurance` list will show stale (pre-creation) data until page refresh.

**Recommended fix**: Add `queryClient.invalidateQueries({ queryKey: ['repair-tickets'] })` inside `onSuccess` before the navigate call.

### Info

**[I-1] `repair-tickets.service.ts` is 963 lines**

After this PR the service file is 963 lines — above the 500-line "consider splitting" threshold. `warrantyPreview` and `warrantyLookup` are read-only lookup methods that could be extracted to a `WarrantyQueryService` in a future refactor. Not a blocker for this PR.

**[I-2] Seed CoA code correction (positive)**

`REPAIR_EXPENSE_ACCOUNT_CODE` corrected from `53-1306` (old FINANCE code) to `S51-1105` (correct SHOP code), and `REPAIR_INCOME_ACCOUNT_CODE` from `42-1106` to `S42-1101`. This matches the accounting rules in `accounting.md` and should also be applied to any existing production SystemConfig rows via a data migration script or the settings UI.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level | ✅ Present |
| `@Roles()` on `warranty-preview` GET | ✅ `OWNER, BRANCH_MANAGER, SALES` |
| `@Roles()` on `warranty-lookup` GET | ✅ `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES, ACCOUNTANT` |
| `deletedAt: null` in new Prisma queries | ✅ All new queries include this filter |
| `Prisma.Decimal` for `estimatedCost` in service | ✅ `new Prisma.Decimal(dto.estimatedCost)` |
| No raw `fetch()` in frontend | ✅ All API calls use `api.get()` / `api.post()` |
| No hardcoded secrets | ✅ Clean |
| No SQL injection (`$queryRaw`) | ✅ None |
| Thai validation messages on new DTOs | ✅ `'imei ต้องเป็น string'`, `'contractNumber ต้องมีอย่างน้อย 3 ตัวอักษร'` |
| No hardcoded hex colors / `bg-gray-*` | ✅ Clean (semantic tokens used) |

---

## Verdict

**REVIEW**

One warning ([W-1]) — missing cache invalidation after wizard ticket creation will cause stale list data. Easy single-line fix. All security controls are in place; no critical issues. Recommend fixing W-1 before merge.
