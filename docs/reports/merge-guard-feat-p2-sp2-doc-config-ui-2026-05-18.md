# Merge Guard Report — feat/p2-sp2-doc-config-ui

**Date**: 2026-05-18  
**Branch**: `feat/p2-sp2-doc-config-ui`  
**Author**: Akenarin Kongdach  
**Recommendation**: ✅ **APPROVE**

---

## File Changes Summary

| File | Lines Changed | Notes |
|------|--------------|-------|
| `apps/api/src/modules/settings/settings.controller.ts` | +30 | New `GET /settings/doc-config/preview` endpoint |
| `apps/api/src/modules/settings/settings.service.ts` | +214 | `previewNumber()` + new config keys for doc format |
| `apps/api/src/modules/settings/settings.service.spec.ts` | +39 | Unit tests for previewNumber |
| `apps/web/src/pages/DocumentConfigPage.tsx` | +379 | Full settings page (379 lines) |
| `apps/web/src/pages/DocumentConfigPage.test.tsx` | +151 | Component tests |
| `apps/web/e2e/document-config.spec.ts` | +30 | E2E smoke test |
| `apps/web/src/App.tsx` | +2 | Route wiring |
| `apps/web/src/config/menu.ts` | ±10 | Menu entry |

---

## Issues

No Critical or Warning issues found.

### 🔵 Info

#### I1 — `resetCycle` normalisation in controller vs DTO

**File**: `apps/api/src/modules/settings/settings.controller.ts`

The controller normalises `resetCycle` to lowercase via inline code before passing to the service. This is a reasonable approach, but a `@Transform(() => value.toLowerCase())` decorator on a DTO class-property would be more consistent with the project's class-validator pattern and would also enforce validation via `@IsIn(['daily', 'monthly', 'yearly'])`.  
Not a blocker — the current approach works and the `previewNumber` service validates the cycle value internally.

---

## What's Good ✅

- New endpoint `GET /settings/doc-config/preview` has `@Roles('OWNER')` ✅
- `SettingsController` class already has `@UseGuards(JwtAuthGuard, RolesGuard, SettingsAccessGuard)` ✅
- Frontend `DocumentConfigPage` uses `api.get()` and `api.patch()` — no raw `fetch()` ✅
- `queryClient.invalidateQueries({ queryKey: ['settings'] })` called after save mutation ✅
- No money/financial fields touched — no Decimal concerns ✅
- No hardcoded secrets ✅
- `DocumentConfigPage.tsx` is 379 lines — within acceptable size ✅
