# Pre-Merge Guard Report

**Branch**: `feat/sp5p2-warranty-check-unify`
**Author**: Akenarin Kongdach
**Date**: 2026-05-20
**Reviewed by**: Pre-Merge Guard Agent

---

## Summary

SP5 Phase 2 cleanup + new `WarrantyCheckPage`. Removes the now-superseded `CreateRepairTicketPage.tsx` (528 lines), replaces the `/defect-exchange` route with a redirect component, and adds the new `/insurance/warranty-check` unified lookup page. Also includes three E2E smoke-test spec files for the warranty check and wizard flows.

Depends on: `feat/sp5p2-wizard` (must be merged first — wizard routes and service methods are referenced).

## File Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/pages/insurance/CreateRepairTicketPage.tsx` | −528 | Deleted — superseded by wizard |
| `apps/web/src/pages/insurance/WarrantyCheckPage.tsx` | +172 | New lookup page |
| `apps/web/src/pages/insurance/WarrantyCheckPage.test.tsx` | +215 | Unit tests |
| `apps/web/e2e/insurance-warranty-check.spec.ts` | +225 | E2E smoke |
| `apps/web/e2e/insurance-wizard-exchange.spec.ts` | +174 | E2E smoke |
| `apps/web/e2e/insurance-wizard-repair.spec.ts` | +159 | E2E smoke |
| `apps/web/src/App.tsx` | +28/−28 | Route wiring + DefectExchangeRedirect |
| `apps/web/src/components/DefectExchangeRedirect.tsx` | +13 | Redirect stub |
| `apps/web/src/config/menu.ts` | +34/−34 | Menu re-wiring |
| `apps/web/src/pages/InsurancePage.tsx` | +16/−16 | CTA button added |
| `apps/web/src/pages/insurance/RepairTicketDetailPage.tsx` | +47/−47 | Minor updates |
| `.claude/rules/accounting.md` | +16/−16 | Docs update |

**Total**: 12 files, 1048 insertions, 579 deletions (frontend-only — no backend changes)

---

## Issues Found

### Critical
*None*

### Warning
*None*

### Info

**[Info-1] Dead code deleted**: `Number(estimatedCost)` that was flagged in a prior review has been properly removed with the deletion of `CreateRepairTicketPage.tsx`. Positive cleanup.

**[Info-2] Merge dependency**: This branch modifies routing for `/insurance/warranty-check` which calls `GET /repair-tickets/warranty-lookup` — an endpoint added in `feat/sp5p2-wizard`. Merging this branch before `feat/sp5p2-wizard` will cause a 404 on the lookup call. Merge order must be: wizard → unify.

---

## Verdict

**APPROVE** (after `feat/sp5p2-wizard` lands)

Frontend-only, no new security surface. `WarrantyCheckPage` correctly uses `useQuery` + `api.get()` with `enabled: !!submitted` guard, proper `QueryBoundary` wrapper, and role-gated CTAs. E2E specs include graceful skips for pre-merge servers. Safe to merge after the wizard branch.
