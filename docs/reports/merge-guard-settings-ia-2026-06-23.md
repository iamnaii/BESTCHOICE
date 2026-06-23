# Pre-Merge Guard Report — Settings IA Redesign Batch
**Date**: 2026-06-23  
**Branches reviewed**: 3 (all already squash-merged to main via PR #1284, #1286, #1287)  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Scope**: Frontend only — no backend/API changes in any branch

---

## Status: POST-MERGE RETROSPECTIVE

All three branches were squash-merged into `main` today before this guard run.
`git branch -r --no-merged origin/main` still lists them because squash merges don't
create merge commits in the branch history. The review below reflects the quality of
what was shipped.

---

## Branch 1: `feat/users-page-consolidation` → PR #1284

**Changes**: 10 files, +661 / -66  
**Nature**: Refactor — folds UsersTab content into InternalControlTab, adds `#users→internal-control` alias

### Critical
_None_

### Warning
_None_

### Info
- `UsersTab.tsx` deleted entirely — backward-compat handled via `TAB_ALIASES` in SettingsPage logic
- `PettyCashCustodianCard.tsx` doc-comment updated to reflect new tab location (minor)
- E2E spec updated to replace `'users'` with `'internal-control'` in `TAB_IDS`

### Recommendation: ✅ APPROVE (already merged)

No security issues. Clean, well-tested consolidation. Test coverage added for alias redirect and FM fallback.

---

## Branch 2: `feat/settings-ia-redesign` → PR #1286

**Changes**: 18 files, +1744 / -280  
**Nature**: Major IA redesign — introduces 8-category settings registry, panel layout (sidebar nav + search), category/index redirect

### Critical
_None_

### Warning

**W1 — Route roles widened at ProtectedRoute level**
```tsx
// Before (App.tsx)
<ProtectedRoute roles={['OWNER']}>

// After
<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
```
Intentional — old `SettingsPage/index.tsx` already had `ALLOWED_ROLES = ['OWNER', 'FM', 'ACC']` enforced internally, so the new route guard correctly mirrors that existing policy. The settings registry itself further filters visibility per role (FM/ACC only see categories with items they're allowed to access). **No actual expansion of access.**

### Info

- `settings-registry.tsx` eagerly imports all inline tab components (CompanyTab, VatTab, etc.) — these were already co-loaded with the old SettingsPage, so no regression here
- `SettingsIndexRedirect` uses `window.location.hash` — acceptable in SPA context, no SSR
- Tests added for registry integrity (8 categories, no duplicate ids, item roles ⊆ category roles)

### Recommendation: ✅ APPROVE (already merged)

---

## Branch 3: `feat/settings-ia-redesign-p2a` → PR #1287

**Changes**: 14 files, +570 / -39  
**Nature**: Adds React Router `Outlet` nesting + migrates `finance` category items from external links to in-panel sub-routes. Old URL redirects added.

### Critical
_None_

### Warning

**W2 — Eager imports of heavy page components in `settings-registry.tsx`** ⚠️

```tsx
// apps/web/src/config/settings-registry.tsx (NOW IN MAIN)
import InterestConfigPage from '@/pages/InterestConfigPage';      // 621 lines
import GfinConfigPage from '@/pages/GfinConfigPage';              // ~946 lines (5 files)
import PaymentMethodSettingsPage from '@/pages/PaymentMethodSettingsPage';  // 397 lines
```

These three pages were previously lazy-loaded as separate chunks via `App.tsx`:
```tsx
// OLD App.tsx (before P2a)
const InterestConfigPage = lazy(() => import('@/pages/InterestConfigPage'));
const GfinConfigPage = lazy(() => import('@/pages/GfinConfigPage'));
const PaymentMethodSettingsPage = lazy(() => import('@/pages/PaymentMethodSettingsPage'));
```

After P2a they are eagerly imported into `settings-registry.tsx`, which is in turn imported by `SettingsLayout` (still lazy). The net effect: all three pages are **bundled into the `SettingsLayout` chunk** and loaded together whenever ANY settings category is visited — even if the user goes to `บริษัท & สาขา` and never touches ดอกเบี้ย/GFIN/ช่องทางชำระ.

**Estimated bundle size regression**: InterestConfigPage alone is 621 lines with complex form logic; GfinConfigPage has 946 lines across 5 files. Combined gzip impact likely 20–60 KB added to the settings chunk.

**Historical context**: v3 hardening (PR #438) specifically split exceljs/jspdf/recharts to save ~525 KB gzip on initial bundle. This change partially reverses that philosophy for the settings panel.

**Recommended follow-up** (not a blocker — pages are only loaded when /settings/* is visited):
- Convert the 3 `kind: 'route'` items in the finance category to use `React.lazy()` in the registry:
  ```tsx
  // Instead of:
  import InterestConfigPage from '@/pages/InterestConfigPage';
  // Use:
  component: lazy(() => import('@/pages/InterestConfigPage')),
  ```
- This keeps them in the settings panel routing while restoring per-page chunk splitting.

### Info

- `SettingsItemRoute` correctly role-checks before rendering (`found.item.roles.includes(role)`) — no auth bypass risk
- Old URL redirects added: `/settings/interest-config → /settings/finance/interest`, etc. — backward compat preserved
- `CategoryPage` correctly builds `to` path for `kind: 'route'` items: `/settings/${categoryId}/${item.id}`
- Test suite covers migration (old URL → new URL), role guard (FM blocked from OWNER-only items), and unknown item fallback

### Recommendation: ⚠️ REVIEW (already merged — file follow-up issue)

Code is correct and secure. The bundle regression (W2) is a performance concern, not a correctness or security bug. Create a follow-up ticket to convert `kind: 'route'` components to `React.lazy()` in `settings-registry.tsx`.

---

## Summary

| Branch | PR | Files | Critical | Warnings | Recommendation |
|--------|-----|-------|----------|----------|----------------|
| users-page-consolidation | #1284 | 10 | 0 | 0 | ✅ APPROVE |
| settings-ia-redesign | #1286 | 18 | 0 | 1 (non-issue) | ✅ APPROVE |
| settings-ia-redesign-p2a | #1287 | 14 | 0 | 1 (bundle) | ⚠️ REVIEW |

**All changes already in `main`.** No rollback warranted. Only action item is a follow-up PR to restore lazy-loading for the 3 finance sub-pages in `settings-registry.tsx`.

---

_Generated by Pre-Merge Guard — 2026-06-23_
