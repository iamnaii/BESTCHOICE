# Merge Guard Report — feat/sp5p2-warranty-check-unify

**Date**: 2026-05-20  
**Branch**: `feat/sp5p2-warranty-check-unify`  
**Author**: iamnaii (Akenarin Kongdach) `<akenarin.ak@gmail.com>`  
**Commits**: 10  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

```
12 files changed, 1048 insertions(+), 579 deletions(-)
```

| File | Change | Purpose |
|------|--------|---------|
| `apps/web/src/pages/insurance/WarrantyCheckPage.tsx` | +172 (new) | Unified warranty lookup page (by IMEI/customer/contract) |
| `apps/web/src/pages/insurance/WarrantyCheckPage.test.tsx` | +215 (new) | Unit tests for WarrantyCheckPage |
| `apps/web/e2e/insurance-warranty-check.spec.ts` | +225 (new) | E2E tests for warranty check flow |
| `apps/web/e2e/insurance-wizard-exchange.spec.ts` | +174 (new) | E2E tests for exchange wizard |
| `apps/web/e2e/insurance-wizard-repair.spec.ts` | +159 (new) | E2E tests for repair wizard |
| `apps/web/src/pages/insurance/CreateRepairTicketPage.tsx` | -528 (removed) | Superseded by unified wizard |
| `apps/web/src/components/DefectExchangeRedirect.tsx` | +13 (new) | URL redirect shim: `/defect-exchange` → `/insurance/new?intent=exchange` |
| `apps/web/src/App.tsx` | routing changes | Remove old routes, add new routes |
| `apps/web/src/config/menu.ts` | menu update | Add "ตรวจสอบการรับประกัน" menu item |
| `apps/web/src/pages/insurance/RepairTicketDetailPage.tsx` | +47 | Updates |
| `apps/web/src/pages/InsurancePage.tsx` | +16 | Updates |
| `.claude/rules/accounting.md` | +16 | Docs update |

---

## Issues by Severity

### ⚠️ Warning

#### W1 — FINANCE_MANAGER role regression at `/defect-exchange` redirect

**This is the most significant issue in this branch.**

The `/defect-exchange` route was previously guarded with:
```tsx
// BEFORE (in App.tsx)
<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']}>
  <DefectExchangePage />
</ProtectedRoute>
```

After this branch, it becomes an unprotected redirect:
```tsx
// AFTER (in App.tsx)
<Route path="/defect-exchange" element={<DefectExchangeRedirect />} />
```

The redirect destination `/insurance/new` only allows:
```tsx
<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}>
  <CreateInsuranceWizardPage />
</ProtectedRoute>
```

**`FINANCE_MANAGER` is missing from the target route.** Any FINANCE_MANAGER user who follows an old `/defect-exchange` link or has it bookmarked will be redirected to `/insurance/new` and blocked with a 403/redirect-to-home instead of accessing the feature.

**Action required**: Confirm with the team whether FINANCE_MANAGER should be able to access defect exchanges via the new wizard. If yes, add `'FINANCE_MANAGER'` to `/insurance/new` ProtectedRoute roles.

#### W2 — `/defect-exchange` redirect has no auth check

`DefectExchangeRedirect` is rendered without `ProtectedRoute`:
```tsx
<Route path="/defect-exchange" element={<DefectExchangeRedirect />} />
```

An unauthenticated user hitting `/defect-exchange` will be silently redirected to `/insurance/new` (which then correctly redirects to `/login`). The current behavior is safe because `/insurance/new` enforces auth, but the lack of explicit auth on the redirect shim is a minor deviation from the codebase's explicit `ProtectedRoute` convention.

**Fix (optional)**: Wrap `DefectExchangeRedirect` in a ProtectedRoute — though this is low priority since auth is enforced at the destination.

---

### ℹ️ Info

#### I1 — E2E test coverage added (positive)

3 new E2E specs (`insurance-warranty-check.spec.ts`, `insurance-wizard-exchange.spec.ts`, `insurance-wizard-repair.spec.ts`) and 1 unit test file (`WarrantyCheckPage.test.tsx`) add solid test coverage for the unified flow.

#### I2 — `WarrantyCheckPage.tsx` uses correct patterns

- `useQuery` from `@tanstack/react-query` ✅
- `api.get()` from `@/lib/api` ✅
- `QueryBoundary` wrapper for error/retry UI ✅
- No raw `fetch()` ✅
- Proper TypeScript interfaces defined ✅

---

## Security Checklist

| Check | Result |
|-------|--------|
| New route `/insurance/warranty-check` has ProtectedRoute | ✅ Pass |
| `WarrantyCheckPage` uses `api.get()` not raw `fetch()` | ✅ Pass |
| No new backend controllers in this branch | ✅ N/A |
| No `Number()` on Prisma Decimal money fields | ✅ Pass |
| No hardcoded secrets | ✅ Pass |
| `FINANCE_MANAGER` role gap at `/defect-exchange` → `/insurance/new` | ⚠️ Warning W1 |

---

## Recommendation: ⚠️ REVIEW

**Confirm before merge**:
- W1: Verify with team whether FINANCE_MANAGER should access the defect-exchange wizard. If yes, add the role to `/insurance/new` ProtectedRoute. If access was intentionally removed, document the decision.

**Nice-to-have**:
- W2: Optionally wrap `DefectExchangeRedirect` in a ProtectedRoute for consistency.
