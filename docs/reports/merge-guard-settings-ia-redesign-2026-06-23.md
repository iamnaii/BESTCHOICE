# Merge Guard Report — feat/settings-ia-redesign

**Date**: 2026-06-23  
**Branch**: `feat/settings-ia-redesign`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits ahead of main**: 20  
**Supersedes**: `feat/users-page-consolidation` (9 commits — fully contained in this branch)

---

## File Changes Summary

| Category | Files | +Lines | -Lines |
|----------|-------|--------|--------|
| New settings pages | 4 new files | +346 | — |
| New config modules | 2 new files | +160 | — |
| New tests | 7 new files | +216 | — |
| Modified App.tsx | 1 file | +11 | -3 |
| Deleted old SettingsPage files | 4 deleted | — | -245 |
| Docs only | 4 files | +1709 | — |

**Total**: 23 files, 2304 insertions, 245 deletions

---

## What This PR Does

- Replaces the hash-tab `/settings` hub (flat `Tabs` component) with a new panel-based layout: `/settings/:categoryId`
- Introduces a `settingsRegistry` (8 categories, 40+ items) as the single source of truth for what each role can see
- `SettingsIndexRedirect` handles old `#hash` deep-links (e.g. `/settings#vat` → `/settings/accounting#vat`)
- `SettingsLayout` renders a persistent left-nav (desktop) / select (mobile) + global search
- Expands `ProtectedRoute` for `/settings` from `['OWNER']` → `['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']` (intentional — FM/ACC have their own settings items)

---

## Issues Found

### Critical

None.

---

### Warning

**W1 — Raw `<input>` / `<select>` instead of shadcn/ui components**
- File: `apps/web/src/pages/settings/SettingsLayout.tsx` (lines ~759, ~784)
- The search input is a bare `<input>` element and the mobile category picker is a bare `<select>`, both violating the frontend rule: "ใช้ shadcn/ui components + Radix UI primitives"
- Should be `<Input>` from `@/components/ui/input` and `<Select>` from `@/components/ui/select`

**W2 — Missing `useDebounce` on search input**
- File: `apps/web/src/pages/settings/SettingsLayout.tsx` (line ~747)
- Frontend rule: "ใช้ `useDebounce` hook สำหรับ search inputs"
- `searchSettings()` is pure in-memory (no API call), so this is low-risk — but it deviates from the pattern and could cause issues if the registry grows large
- Fix: wrap `query` with `useDebounce` before passing to `searchSettings`

**W3 — `ProtectedRoute` role expansion is a behavioral change that widens access**
- File: `apps/web/src/App.tsx` line ~767
- Old: `roles={['OWNER']}` | New: `roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}`
- Impact: FM and ACCOUNTANT can now navigate directly to `/settings/:categoryId` URLs. The `CategoryPage` and `SettingsLayout` both call `visibleItems(cat, role)` which correctly filters — an FM who manually navigates to `/settings/access` (OWNER-only category) sees an empty page with 0 items (not a security leak)
- The backend API guards are unchanged — no new server-side access is granted
- Recommend: document this intentional change in CLAUDE.md or a comment in App.tsx

---

### Info

**I1 — Weak type cast in `CategoryPage.tsx` and `SettingsLayout.tsx`**
- `(user?.role ?? '') as SettingsRole` — if role is an unexpected string, TypeScript treats it as `SettingsRole` but `visibleItems` silently returns `[]`. Safe at runtime, but worth a runtime guard.

**I2 — Old `SettingsPage/index.tsx` deleted (with its old tests)**
- `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` (63 lines) is deleted
- Replaced by 7 new test files covering the new architecture — net test coverage is higher
- Confirm old `SettingsPage` default export is no longer imported anywhere else before merging

**I3 — Docs files are large**
- 4 doc/spec files add 1709 lines. These are design docs, not code — no review needed but they inflate the diff size

**I4 — `InternalControlTab.tsx` (from users-page-consolidation) still exists in SettingsPage**
- The new `settingsRegistry` also references `MakerCheckerToggle`, `ReversePermissionCard` etc. directly
- The old SettingsPage tab system no longer renders `InternalControlTab` via the hub (hub is deleted)
- But `InternalControlTab` is still in the registry as part of `CategoryPage` rendering — this is correct

---

## Role Access Matrix (new)

| Category | OWNER | FM | ACC |
|----------|-------|----|-----|
| company  | ✓ (company-info, contacts, entities, branches) | contacts only | contacts only |
| access   | ✓ all | — | — |
| accounting | ✓ all | peak-mapping, chart | peak-mapping, chart, peak-sync |
| finance  | ✓ all | payment-methods | — |
| products | ✓ all | — | — |
| comms    | ✓ all | sms only | — |
| ai       | ✓ all | — | — |
| system   | ✓ all | — | integrations |

No OWNER-only items are exposed to FM/ACCOUNTANT — the role gating at item level is correct.

---

## Recommendation

**REVIEW** — Two warnings (W1, W2) should be fixed before merge. No critical security or data issues.

**Merge order**: This branch is a superset of `feat/users-page-consolidation` — merge only this one, do not merge `users-page-consolidation` separately.

### Required fixes before merge

1. Replace bare `<input>` with `<Input>` from shadcn/ui in `SettingsLayout.tsx`
2. Replace bare `<select>` with shadcn/ui `<Select>` in `SettingsLayout.tsx`  
3. Add `useDebounce` on the `query` state in `SettingsLayout.tsx`
