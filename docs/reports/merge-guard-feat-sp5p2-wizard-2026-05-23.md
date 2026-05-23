# Merge Guard Report — `feat/sp5p2-wizard`

**Date:** 2026-05-23  
**Branch:** `feat/sp5p2-wizard`  
**Author:** Akenarin Kongdach  
**Commits:** 5  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts` | +16 / 0 |
| `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` | +272 / 0 |
| `apps/api/src/modules/repair-tickets/dto/warranty-lookup.dto.ts` | +22 (new) |
| `apps/api/src/modules/repair-tickets/dto/warranty-preview.dto.ts` | +15 (new) |
| `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts` | +309 (new) |
| `apps/api/src/modules/settings/__tests__/repair-config-defaults.spec.ts` | +18 / -18 |
| `apps/api/src/modules/customers/customers.service.ts` | +52 / -8 |
| `apps/api/src/modules/customers/dto/customer.dto.ts` | +12 / -1 |
| `apps/api/prisma/schema.prisma` | +2 / -1 |
| `apps/api/prisma/seed.ts` / `seed-production.ts` | minor |
| `apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx` | +272 (new) |
| `apps/web/src/pages/insurance/WizardSteps/CustomerPickerStep.tsx` | +169 (new) |
| `apps/web/src/pages/insurance/WizardSteps/DevicePickerStep.tsx` | +189 (new) |
| `apps/web/src/pages/insurance/WizardSteps/DefectDescriptionStep.tsx` | +327 (new) |
| `apps/web/src/pages/insurance/WizardSteps/WarrantyPreviewStep.tsx` | +178 (new) |
| `apps/web/src/pages/insurance/WizardSteps/ExchangeProductPickerStep.tsx` | +79 (new) |
| `apps/web/src/pages/insurance/components/WarrantyWindowCard.tsx` | +68 (new) |
| `apps/web/src/pages/insurance/CreateInsuranceWizardPage.test.tsx` | +165 (new) |
| `apps/web/src/pages/insurance/components/WarrantyWindowCard.test.tsx` | +50 (new) |
| `apps/web/src/pages/DefectExchangePage.tsx` | +36 / 0 |
| `apps/web/src/App.tsx` | +3 / -1 |
| `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/shop-coa.csv` | +3 |

**Total:** ~2,226 insertions, ~47 deletions across 24 files.

---

## What This Branch Does

Implements the **SP5 Phase 2 Insurance Wizard** (`/insurance/new`): a 4-step multi-page form that routes staff through warranty detection, device selection, defect description, and either a repair or exchange flow — automatically branching based on warranty status.

**New backend endpoints** on `repair-tickets.controller.ts`:
- `GET repair-tickets/warranty-preview` — Computes warranty window (7-day defect / shop warranty / manufacturer / out-of-warranty / walk-in) from contract + product data.
- `GET repair-tickets/warranty-lookup` — Resolves customer devices by `customerId`, `imei`, or `contractNumber` for the wizard's device picker.

**Frontend wizard** (`/insurance/new`):
- Step 1 `CustomerPickerStep` — search by name/phone
- Step 2 `DevicePickerStep` — device list with `forExchange` flag
- Step 3 `WarrantyPreviewStep` — displays warranty window + default flow (repair/exchange)
- Step 4 branches: `DefectDescriptionStep` (repair) or `ExchangeProductPickerStep` (exchange)

`DefectExchangePage` extended with `bypassWindow` prop + URL param for wizard-originating exchanges.

---

## Issues by Severity

### Critical
_None._

### Warning

- **`@Req() req: any` on two new controller endpoints** (`warrantyPreview`, `warrantyLookup`).  
  Both use `req.user` which is typed as `ReqUser` elsewhere in the codebase (e.g. `@Req() req: { user: ReqUser }`).  
  Using `any` loses type safety; a typo on `req.user.branchId` would compile silently.  
  **Affected lines:** `repair-tickets.controller.ts` — `warrantyPreview` and `warrantyLookup` methods.  
  **Fix:** Change `@Req() req: any` → `@Req() req: { user: ReqUser }` (matching the pattern in other controller methods).  
  Low risk in practice since `user` is guaranteed by `JwtAuthGuard`, but still a coding-standards violation.

### Info

- **`bypassWindowCheck` URL parameter on `DefectExchangePage`** — A `?bypassWindow=true` query param from a low-privilege URL would be silently gated by `canExecute = role === 'OWNER' || 'BRANCH_MANAGER'` on the frontend AND by an explicit role check in `defect-exchange.service.ts:151`. Defense in depth is present. No action required.
- **`DefectDescriptionStep.tsx` is 327 lines** — above the typical "consider splitting" threshold but within the 500-line hard limit. Acceptable as a complex wizard step.
- New `shop-coa.csv` adds 3 rows — confirm `S42-1101` `รายได้บริการซ่อม` is consistent with SP5 Phase 2 accounting spec (REPAIR_INCOME_ACCOUNT_CODE = `S42-1101`). ✓ matches `.claude/rules/accounting.md`.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controller has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level | ✅ Present |
| New endpoints have `@Roles(...)` | ✅ Both endpoints decorated |
| `warrantyPreview` roles: OWNER, BRANCH_MANAGER, SALES | ✅ Appropriate |
| `warrantyLookup` roles: all 5 roles | ✅ Appropriate for read-only lookup |
| No `Number()` on DB-stored financial fields | ✅ No financial arithmetic in new code |
| No raw `fetch()` or `axios` in new React components | ✅ All queries use `useQuery` + `api.get()` |
| No hardcoded secrets | ✅ None found |
| No unparameterized `$queryRaw` | ✅ None found |
| All new Prisma queries include `deletedAt: null` | ✅ Confirmed |
| Thai validation messages on new DTOs | ✅ Present on WarrantyLookupDto |

---

## Notes

Test coverage is substantial: `+309` spec lines covering warranty window edge cases, device lookup by 3 key types, SALES role branch scoping, and wizard bypass behavior. This is well-tested code.
