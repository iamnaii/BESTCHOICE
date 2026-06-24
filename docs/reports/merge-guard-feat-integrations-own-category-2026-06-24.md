# Merge Guard Report — feat/integrations-own-category

**Date**: 2026-06-24  
**Branch**: `feat/integrations-own-category`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 1 (`915dc465`)  
**Committed**: ~14 hours ago  
**Scope**: Frontend-only (0 API files changed)

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `.claude/rules/accounting.md` | +4/-2 | Doc update (settings nav reference) |
| `apps/web/src/App.tsx` | +5/-4 | Redirect chain update |
| `apps/web/src/config/__tests__/settings-access.test.ts` | +9/-2 | Tests: 8→9 categories |
| `apps/web/src/config/__tests__/settings-registry.test.ts` | +3/-3 | Tests: 8→9 categories |
| `apps/web/src/config/menu.test.ts` | +3/-2 | Test: update path assertion |
| `apps/web/src/config/menu.ts` | +1/-1 | Update sidebar link path |
| `apps/web/src/config/settings-registry.tsx` | +8/-5 | Split integrations into own category |
| `apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx` | +1/-1 | Test description update |
| `apps/web/src/pages/settings/__tests__/company-access-system-migration.test.tsx` | +18/-9 | Redirect chain tests updated |

**Total**: 9 files, +59/-30 lines

---

## What the Branch Does

Splits the `เชื่อมต่อ` (integrations) group out of the `system` settings category into its own top-level category `integrations`. The `system` category becomes OWNER-only (previously OWNER + ACCOUNTANT). The new `integrations` category inherits OWNER + ACCOUNTANT roles for the `hub` item; `mdm` remains OWNER-only.

Redirect chain:
- `/settings/integrations` (bare) → now resolves via `:categoryId` dynamic route to `CategoryPage('integrations')` — old explicit redirect removed, correctly handled by the router
- `/settings/system/integrations` → `/settings/integrations/hub` (new redirect)
- `/settings/system/mdm` → `/settings/integrations/mdm` (new redirect)
- `/settings/mdm-test` → `/settings/integrations/mdm` (unchanged target, updated path)

---

## Security Checks

| Check | Result |
|-------|--------|
| JwtAuthGuard on new controllers | N/A — frontend only |
| Number() on money fields | None found |
| deletedAt: null in queries | N/A — frontend only |
| Hardcoded secrets/API keys | None found |
| Raw `fetch()` instead of `api.*()` | None found |
| Hardcoded hex colors | None found |
| `bg-gray-*` / `text-gray-*` forbidden classes | None found |
| `leading-none` on Thai text | None found |
| Explicit `any` types | None found |
| Missing `queryClient.invalidateQueries()` | N/A — no mutations added |

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**I-1**: The old explicit redirect `<Route path="/settings/integrations" element={<Navigate to="/settings/system/integrations" replace />} />` was removed from `App.tsx`. The path `/settings/integrations` now falls through to the `:categoryId` dynamic route, rendering `CategoryPage('integrations')`. This is the intended behavior — the test `old /settings/integrations → renders CategoryPage(integrations)` confirms it. **No action needed**, but any external deep-links or bookmarks to the old redirect target (`/settings/system/integrations`) will double-hop via the new `/settings/system/integrations → /settings/integrations/hub` redirect.

---

## Recommendation

**APPROVE**

Pure navigation restructuring with no backend changes. Redirect chains are correctly wired and tested. Role logic (`ACCOUNTANT` can see `integrations` but not `system`) is consistent with the rule that `system` is now OWNER-only. All security checks pass.
