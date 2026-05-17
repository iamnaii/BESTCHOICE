# Pre-Merge Guard Report — feat/a1-d1.3.2.4-reverse-permission

**Date:** 2026-05-17  
**Branch:** `feat/a1-d1.3.2.4-reverse-permission`  
**Author:** Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Commits:** 1 (`8a98ad87` — 2026-05-17 20:37:16 +0700)

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/expense-documents/reverse-permission.guard.ts` | +75 new |
| `apps/api/src/modules/expense-documents/__tests__/reverse-permission.guard.spec.ts` | +65 new |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | +22/-3 |
| `apps/api/src/modules/expense-documents/expense-documents.service.ts` | +19/-4 |
| `apps/api/src/modules/expense-documents/expense-documents.module.ts` | +3/-0 |
| `apps/api/src/modules/settings/settings.service.ts` | +14/-0 |
| `apps/web/src/hooks/useUiFlags.ts` | +8/-0 |
| **Total** | **+197 / -3** |

**What this branch does (D1.3.2.4):**
- Adds `ReversePermissionGuard` — a dynamic NestJS guard that reads `SystemConfig.reverse_permission` at request time to gate `POST /expense-documents/:id/void`
- Supported values: `OWNER+FINANCE_MANAGER` (default, matches existing `@Roles` decorator) / `OWNER_ONLY`
- Defense-in-depth: `resolveReversePermissionRoles()` is also called inside `voidDocument()` when `userRole` is provided
- Exposes `reversePermission` flag through `GET /settings/ui-flags` and `useUiFlags` hook
- 65-line test suite with 4 cases covering default, OWNER_ONLY narrowing, malformed value fallback, and DB error fallback

---

## Issues

### Warning — Double DB Query on Every Void Operation

**Files:** `expense-documents.controller.ts` + `expense-documents.service.ts`

Same pattern as `feat/a1-d1.3.2.3-post-permission`: `ReversePermissionGuard.canActivate` and `voidDocument()` each call `resolveReversePermissionRoles(this.prisma)` — 2 queries to `systemConfig` per void request. Not a blocker (consistent with existing guards, low latency impact), but worth addressing with a shared short-TTL cache if post-permission gets the same treatment.

### Info — Narrower Value Set Than Post-Permission Guard

`ReversePermissionGuard` exposes 2 whitelisted values (`OWNER+FINANCE_MANAGER`, `OWNER_ONLY`) while `PostPermissionGuard` exposes 4. The asymmetry is intentional — reversing a posted accounting document is a more consequential action than posting. The guard's JSDoc explains this. No action required; noted for completeness.

---

## Recommendation: **APPROVE**

This is a textbook mirror of `PostPermissionGuard` (D1.3.2.3). Correct guard placement (`@UseGuards(ReversePermissionGuard)` added after `@Roles('OWNER', 'FINANCE_MANAGER')` on the `void` method), DB error fallback to default, Thai error messages, existing `deletedAt: null` filter on `systemConfig` query. No critical issues found.
