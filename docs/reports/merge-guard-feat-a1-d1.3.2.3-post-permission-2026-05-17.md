# Pre-Merge Guard Report — feat/a1-d1.3.2.3-post-permission

**Date:** 2026-05-17  
**Branch:** `feat/a1-d1.3.2.3-post-permission`  
**Author:** Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Commits:** 1 (`d1ce6bc5` — 2026-05-17 20:33:29 +0700)

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/expense-documents/post-permission.guard.ts` | +85 new |
| `apps/api/src/modules/expense-documents/__tests__/post-permission.guard.spec.ts` | +75 new |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | +22/-3 |
| `apps/api/src/modules/expense-documents/expense-documents.service.ts` | +12/-1 |
| `apps/api/src/modules/expense-documents/expense-documents.module.ts` | +3/-0 |
| `apps/api/src/modules/settings/settings.service.ts` | +28/-0 |
| `apps/web/src/hooks/useUiFlags.ts` | +13/-0 |
| **Total** | **+236 / -4** |

**What this branch does (D1.3.2.3):**
- Adds `PostPermissionGuard` — a dynamic NestJS guard that reads `SystemConfig.post_permission` at request time to decide which roles may call `POST /expense-documents/:id/post`
- Supported values: `OWNER+FINANCE_MANAGER+ACCOUNTANT` (default, preserves current behavior) / `OWNER+FINANCE_MANAGER` / `OWNER_ONLY` / `OWNER+ALL_NON_SALES`
- Adds service-layer defense-in-depth: `resolvePostPermissionRoles()` is called inside `post()` when `userRole` is provided
- Exposes `postPermission` flag through `GET /settings/ui-flags` and `useUiFlags` hook so the frontend can hide the "Post" button for unauthorized roles
- 75-line test suite with 4 cases covering default, narrowing, widening, and SALES exclusion

---

## Issues

### Warning — Double DB Query on Every Post Operation

**Files:** `expense-documents.controller.ts` + `expense-documents.service.ts`

The guard (`PostPermissionGuard.canActivate`) and the service (`post()`) each call `resolvePostPermissionRoles(this.prisma)` independently — 2 queries to `systemConfig` per request on the hot path:

```ts
// Guard (request layer) — query #1
async canActivate(context) {
  const allowed = await this.getAllowedRoles(); // → resolvePostPermissionRoles(prisma)
  ...
}

// Service (domain layer, defense-in-depth) — query #2
async post(id, _userId, userRole?) {
  if (userRole !== undefined) {
    const allowed = await resolvePostPermissionRoles(this.prisma); // second query
    ...
  }
}
```

`SystemConfig` is a small table and the guard runs before the main `$transaction`, so latency impact is minimal. However, if throughput matters, a short-TTL in-process cache (e.g., 30s `Map<string, Promise>`) on `resolvePostPermissionRoles` would halve the overhead without sacrificing correctness.

Not a blocker — the double-query pattern is the same as the already-reviewed `SettingsAccessGuard`, so it's consistent.

### Info — BRANCH_MANAGER Added to @Roles Superset

**File:** `expense-documents.controller.ts` line 183

```ts
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT')
@UseGuards(PostPermissionGuard)
post(...)
```

`BRANCH_MANAGER` is new in the `@Roles` list (previously `OWNER`, `FINANCE_MANAGER`, `ACCOUNTANT`). This is intentional — required so `RolesGuard` passes BRANCH_MANAGER through when `post_permission = 'OWNER+ALL_NON_SALES'` is active. The `PostPermissionGuard` then rejects BRANCH_MANAGER under the default config. The comment on the controller method explains this. Behavior is correct.

---

## Recommendation: **APPROVE**

Guard implementation is secure, follows the `PostPermissionGuard` → `SettingsAccessGuard` pattern established in PR #884, has clean test coverage, and Thai error messages throughout. The double DB query is a known pattern in this codebase and not a merge blocker.
