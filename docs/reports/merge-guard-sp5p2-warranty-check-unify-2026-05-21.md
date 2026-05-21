# Merge Guard Report — feat/sp5p2-warranty-check-unify

**Date**: 2026-05-21  
**Branch**: `feat/sp5p2-warranty-check-unify`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: 08e95d74 (2026-05-20 11:29 BKK)  
**Recommendation**: ✅ APPROVE

---

## Summary

Frontend-only PR (no backend changes). Delivers:
1. **`WarrantyCheckPage.tsx`** — new standalone lookup page at `/insurance/warranty-check` with 3 search modes (IMEI, customer, contract number)
2. **`DefectExchangeRedirect.tsx`** — replaces the old `/defect-exchange` route with a redirect to `/insurance/new?intent=exchange`
3. **`InsurancePage.tsx`** — adds a "เช็คประกัน" CTA button linking to the new page
4. **3 new E2E specs** + **1 new unit test** for the new page
5. **`.claude/rules/accounting.md`** — minor docs update

## Files Changed (12 files)

| File | Type | Change |
|------|------|--------|
| `apps/web/e2e/insurance-warranty-check.spec.ts` | Test | New — 6 smoke tests for WarrantyCheckPage |
| `apps/web/e2e/insurance-wizard-exchange.spec.ts` | Test | New — 3 smoke tests for exchange bypass wizard |
| `apps/web/e2e/insurance-wizard-repair.spec.ts` | Test | New — repair wizard smoke tests |
| `apps/web/src/App.tsx` | Routing | Remove `/defect-exchange` route (now redirects); add `/insurance/warranty-check` |
| `apps/web/src/components/DefectExchangeRedirect.tsx` | New | Redirect component from `/defect-exchange*` to `/insurance/new?intent=exchange` |
| `apps/web/src/config/menu.ts` | UI | Unify insurance sidebar entry point |
| `apps/web/src/pages/InsurancePage.tsx` | UI | Add warranty-check CTA button |
| `apps/web/src/pages/insurance/CreateRepairTicketPage.tsx` | Deleted | Superseded by wizard |
| `apps/web/src/pages/insurance/RepairTicketDetailPage.tsx` | Updated | Minor button label rename |
| `apps/web/src/pages/insurance/WarrantyCheckPage.test.tsx` | Test | Unit tests for 3 search modes + role-based CTA |
| `apps/web/src/pages/insurance/WarrantyCheckPage.tsx` | New | Main warranty check lookup page |
| `.claude/rules/accounting.md` | Docs | Minor update |

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**[INFO-1]** `WarrantyCheckPage.tsx:80` — Customer search mode placeholder text contains a dev note:
```
'Customer UUID (จาก /customers — รอ integrate autocomplete)'
```
This TODO note is embedded in production UI visible to end users in the input placeholder. Not harmful but slightly unprofessional. Should be simplified to `'รหัสลูกค้า'` or replaced with an autocomplete widget before GA release.

---

## Verification Points

- [x] New route `/insurance/warranty-check` properly gated with `ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}` — appropriate (all logged-in roles can check warranty status)
- [x] API call uses `api.get('/repair-tickets/warranty-lookup?...')` from `@/lib/api` — ✅ correct
- [x] Data fetching uses `useQuery` from `@tanstack/react-query` — ✅ correct
- [x] No raw `fetch()` or `axios` calls
- [x] No hardcoded hex colors; uses `text-muted-foreground`, `bg-muted/30`, `border-t` tokens
- [x] `Button variant="primary"` verified as a valid custom variant in `apps/web/src/components/ui/button.tsx`
- [x] `/defect-exchange` redirect uses `<Navigate>` + `useSearchParams` pattern (no lost query params)
- [x] `QueryBoundary` wraps the results section — consistent with codebase pattern
- [x] No `Number()` usage on financial fields (no money displayed on this page)
- [x] No Prisma schema changes

---

## Recommendation: ✅ APPROVE

Minor UX note on INFO-1 (placeholder text) can be addressed in follow-up. All security, data fetching, and routing patterns are correct.
