# Pre-Merge Guard Report — `feat/settings-ia-redesign` (base shell)
**Date**: 2026-06-23 (run 4)
**Branch**: `feat/settings-ia-redesign`
**Author**: akenarin.ak@gmail.com
**Commits ahead of main**: 11
**Review scope**: Frontend only — no backend/API/Prisma changes

---

## Summary

Registry-driven Settings Panel (P1 shell) — introduces `settings-registry.tsx`,
`settings-access.ts`, `SettingsLayout`, `CategoryPage`, `SettingsIndexRedirect`,
and replaces the old tab-based `SettingsPage` with a sidebar-panel layout.
Deletes `apps/web/src/pages/SettingsPage/index.tsx` and
`apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx`.

**18 files changed, +1744 / −280**

### Changed files
| File | Change |
|---|---|
| `apps/web/src/App.tsx` | Swaps `SettingsPage` import for `SettingsLayout` + `SettingsIndexRedirect`; adds `/settings/:categoryId` route; widens `ProtectedRoute` roles to include FM + ACC |
| `apps/web/src/config/settings-registry.tsx` | New — 8-category registry, 45 items, role-per-item |
| `apps/web/src/config/settings-access.ts` | New — helper fns: `visibleCategories`, `visibleItems`, `firstVisibleCategoryId`, `searchSettings` |
| `apps/web/src/pages/settings/SettingsLayout.tsx` | New — sidebar nav + search overlay + mobile `<select>` |
| `apps/web/src/pages/settings/CategoryPage.tsx` | New — renders inline components or external links per category |
| `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` | New — maps old hash tabs to new `/settings/:category` URLs |
| Old `SettingsPage/index.tsx`, `InternalControlTab.tsx`, their tests | Deleted |
| 6 new test files | `settings-registry.test.ts`, `settings-access.test.ts`, `SettingsLayout.test.tsx`, `CategoryPage.test.tsx`, `SettingsIndexRedirect.test.tsx`, `settings-routing.test.tsx` |
| 2 design docs | `docs/superpowers/specs/2026-06-23-settings-ia-redesign-*.md` |

---

## Critical Issues

_None._

No backend code touched. No money arithmetic. No database queries. No secrets.
No new API endpoints. `ProtectedRoute` roles are widened intentionally (registry
gates per-item anyway).

---

## Warning Issues

### W1 — `settings-registry.tsx`: eager imports of all inline components

```tsx
// settings-registry.tsx lines 5–19
import { CompanyTab } from '@/pages/SettingsPage/tabs/CompanyTab';
import { ContactsTab } from '@/pages/SettingsPage/tabs/ContactsTab';
import { VatTab } from '@/pages/SettingsPage/tabs/VatTab';
import { PeriodsTab } from '@/pages/SettingsPage/tabs/PeriodsTab';
import { AttachmentTab } from '@/pages/SettingsPage/tabs/AttachmentTab';
import { PeakMappingTab } from '@/pages/SettingsPage/tabs/PeakMappingTab';
import { OffsiteBackupTab } from '@/pages/SettingsPage/tabs/OffsiteBackupTab';
import { PdpaTab } from '@/pages/SettingsPage/tabs/PdpaTab';
import { MakerCheckerToggle } from '@/pages/SettingsPage/components/MakerCheckerToggle';
import { ReversePermissionCard } from '@/pages/SettingsPage/components/ReversePermissionCard';
import { ReverseReasonsManagementCard } from '@/pages/SettingsPage/components/ReverseReasonsManagementCard';
import { PettyCashCustodianCard } from '@/pages/SettingsPage/components/PettyCashCustodianCard';
import { TestModeToggle } from '@/pages/SettingsPage/components/TestModeToggle';
```

Every user who loads `/settings/company` also pulls in `PdpaTab`, `OffsiteBackupTab`,
`MakerCheckerToggle`, etc. — even though only one category is visible at a time.
These were previously lazy-loaded via the old tab mechanism.

**Impact**: +3 heavy components (`PeakMappingTab` uses XLSX-adjacent utils,
`OffsiteBackupTab` has its own fetch logic) now land in the initial settings chunk.
This was flagged in the run2 retrospective for `#1286`.

**Recommendation**: Convert each `component:` registry entry from a direct import
to a `React.lazy(() => import(...))` call. `ComponentType` in the registry type
should become `LazyExoticComponent<ComponentType>` or use `React.ComponentType`
with a `Suspense` wrapper in `CategoryPage`.

---

## Info

### I1 — Raw `<input>` and `<select>` instead of shadcn components

`SettingsLayout.tsx` uses a bare `<input>` for the search field and a bare `<select>`
for mobile category navigation, rather than shadcn `Input` and `Select`.
Intentional (lightweight, no extra imports) but breaks visual consistency with the
rest of the app. Follow-up or document as intentional.

### I2 — `typeof window !== 'undefined'` guard in SPA context

`SettingsIndexRedirect.tsx:30`:
```ts
const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
```
This guard is never false in Vite/Chromium (no SSR). Safe to simplify to
`window.location.hash.slice(1)`, but has no runtime impact.

### I3 — `ProtectedRoute` role widening on `/settings` is intentional but notable

`App.tsx` changes `/settings` from `roles={['OWNER']}` to
`roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}`. This is correct — the
registry gates each item by role — but represents a surface-level access widening.
The `#peak-mapping` and `#contacts` items were always accessible to FM/ACC via
the old tab; this change makes the `/settings` URL itself reachable for them.
No security regression; just worth documenting in the PR description.

### I4 — Old `SettingsPage.test.tsx` deleted without leaving a redirect note

The 8-test suite testing hash-based tab navigation is gone; its coverage is now
split across the 6 new test files. Coverage appears equivalent but the deletion
will surface in coverage diffs if anyone checks. No action needed.

---

## Newly Discovered Long-Running Branches

Two previously-unknown worktree branches appeared during `git fetch`:

| Branch | Last Commit | Commits Ahead | Status |
|---|---|---|---|
| `worktree-feat+sp7.1-dual-prisma-foundation` | 2026-05-19 | ~2571 | WIP, no recent activity |
| `worktree-feat-shop-sales-ai-phase-a` | 2026-05-20 | ~2609 | WIP, no recent activity |

These are long-running feature branches last touched ~35 days ago. Not ready for
merge review. Flagged here for awareness — recommend rebasing against `main`
before requesting review.

---

## Recommendation

**✅ APPROVE** (with W1 follow-up)

This is a clean frontend refactor with excellent test coverage (6 new test files,
>40 test cases). No backend changes, no security issues, no money arithmetic.

The sole warning (W1 — eager imports) degrades the settings page bundle size but
does not break functionality or introduce regressions. Given this branch is the
foundation that `p2a` and `p2b` built on — and those are already reviewed (run3,
APPROVED) — blocking here would be disruptive.

**Suggested merge order**: `feat/settings-ia-redesign` → `feat/settings-ia-redesign-p2a` → `feat/settings-ia-redesign-p2b`

**Follow-up ticket**: Convert registry `component:` fields to `React.lazy()` to restore
the per-category code-splitting that the old tab mechanism provided (see W1).
