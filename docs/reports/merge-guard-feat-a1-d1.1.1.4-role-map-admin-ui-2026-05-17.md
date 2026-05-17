# Merge Guard Report — feat/a1-d1.1.1.4-role-map-admin-ui

**Date**: 2026-05-17  
**Author**: akenarin.ak@gmail.com (iamnaii)  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/settings/role-map-admin.spec.ts` | New — 145-line unit test for `AccountRoleService` admin endpoints |
| `apps/web/src/App.tsx` | Route `/settings/account-roles` added, lazy-loaded, OWNER-only |
| `apps/web/src/config/menu.ts` | Menu item "บัญชีตาม Role" added under OWNER config |
| `apps/web/src/pages/AccountRolesPage.tsx` | New — 393-line OWNER-only admin UI for `account_role_map` |
| `docs/superpowers/tracking/D1-settings-implement.md` | Tracking doc update |

---

## Issues by Severity

### Critical — None

No new controllers added. Backend endpoints (`GET /settings/role-map`, `PUT /settings/role-map/:id`) already exist in `settings.controller.ts` with `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('OWNER')` at class level. Frontend route wrapped in `ProtectedRoute roles={['OWNER']}`.

### Warning — None

Frontend patterns are correct throughout:
- `useQuery` / `useMutation` from React Query ✓
- `api.get()` / `api.put()` from `@/lib/api` ✓
- `queryClient.invalidateQueries()` called in `onSuccess` ✓
- `toast.success()` / `toast.error()` from sonner ✓
- Semantic design tokens (`bg-muted`, `text-muted-foreground`, `border-border`) ✓
- `leading-snug` on all Thai text ✓
- DTO validation not applicable (frontend-only branch) ✓

### Info

1. **Multi-line docstring on `AccountRolesPage` export** (`AccountRolesPage.tsx:55–69`):  
   Multi-paragraph JSDoc block lists backend endpoint paths. Violates the one-line-max comment rule. Backend callers can discover endpoints from the API client; this is noise.

2. **Task-reference comments in `App.tsx`** (`App.tsx:118`, `App.tsx:892`):  
   `// D1.1.1.4 — Admin UI for account_role_map (OWNER-only)` references the task/issue. Comments referencing the current task rot as the codebase evolves; belongs in the PR description, not the source file.

3. **Redundant `status: 'ใช้งาน'` param** (`AccountRolesPage.tsx:222`):  
   `api.get('/chart-of-accounts', { params: { status: 'ใช้งาน' } })` — backend defaults to `status: 'ใช้งาน'` when no filter is passed, so the param is a no-op. Not wrong, just unnecessary.

---

## Summary

Clean frontend-only branch. All patterns correct. Three low-signal Info items (comment hygiene) that do not block merge.
