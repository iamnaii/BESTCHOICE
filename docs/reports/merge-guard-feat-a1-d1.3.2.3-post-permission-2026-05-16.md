# Pre-Merge Guard Report — feat/a1-d1.3.2.3-post-permission

**Date**: 2026-05-16  
**Branch**: `feat/a1-d1.3.2.3-post-permission`  
**Author**: Akenarin Kongdach  
**Commit**: `74965c47` — feat(a1): D1.3.2.3 — post_permission dynamic guard (Q4-gated)  
**Base**: `origin/main`

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/src/modules/expense-documents/post-permission.guard.ts` | New | +71 |
| `apps/api/src/modules/expense-documents/__tests__/post-permission.guard.spec.ts` | New | +75 |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | Modified | +12, -1 |
| `apps/api/src/modules/expense-documents/expense-documents.module.ts` | Modified | +3 |
| `apps/api/src/modules/settings/settings.service.ts` | Modified | +20 |
| `apps/web/src/hooks/useUiFlags.ts` | Modified | +10 |

**Total**: 6 files, 192 insertions, 1 deletion

---

## Issue Analysis

### Critical Issues — NONE

- **Guards**: Class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` is unchanged. Method-level `@UseGuards(PostPermissionGuard)` on `post()` is additive.
- **Soft delete**: `post-permission.guard.ts` Prisma query includes `deletedAt: null`.
- No `Number()` on financial fields. No money fields involved.
- No hardcoded secrets. No raw SQL.

### Warning Issues

#### ⚠️ W1 — `@Roles` widened to include `BRANCH_MANAGER`

**File**: `apps/api/src/modules/expense-documents/expense-documents.controller.ts`  
**Before**: `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')`  
**After**: `@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT')`

**Context**: This widening is intentional — required to make the `OWNER+ALL_NON_SALES` bundle functional when the owner configures it via SystemConfig. The `PostPermissionGuard` then narrows back to the configured set per request. At default config (`OWNER+FINANCE_MANAGER+ACCOUNTANT`), a `BRANCH_MANAGER` user passes `RolesGuard` but is rejected by `PostPermissionGuard`, preserving current behavior.

**Risk**: If `PostPermissionGuard` were somehow bypassed (e.g., test environment, guard mis-registration), `BRANCH_MANAGER` would have unintended access to `POST /expense-documents/:id/post`. This widens the `@Roles` fence from its original intent.

**Mitigation**: `PostPermissionGuard` is registered in the module providers and applied consistently. The two-stage pattern is sound. Recommend verifying via integration test that `BRANCH_MANAGER` is blocked at default config.

**Severity**: Warning — architectural trade-off, not an exploitable bug in current setup.

### Info

- Four bundle options (`OWNER+FINANCE_MANAGER+ACCOUNTANT`, `OWNER+FINANCE_MANAGER`, `OWNER_ONLY`, `OWNER+ALL_NON_SALES`) are whitelisted. Any unrecognized SystemConfig value falls back to the default — no privilege escalation through misconfiguration.
- `ROLE_SETS` is module-level constant — no per-request allocation.
- ForbiddenException messages in Thai: `'ไม่พบข้อมูลผู้ใช้'` and `'ไม่มีสิทธิ์โพสต์เอกสาร'`.
- 5 unit tests: default (3-role), narrowed to FM, OWNER_ONLY, OWNER+ALL_NON_SALES, and DB error fallback. Full branch coverage.
- `postPermission` propagated to `useUiFlags` for UI "Post" button visibility. Defense-in-depth: server guard is independent.

---

## Notes

- The `@Roles` widening is the only notable architectural choice. It is well-documented in the inline comment (`D1.3.2.3`). The risk is theoretical given proper guard registration.
- Pattern mirrors `ReversePermissionGuard` (D1.3.2.4) consistently.

---

## Recommendation: ✅ APPROVE (with advisory)

No critical issues. The single warning (W1) is a documented architectural trade-off inherent in the dynamic guard pattern — not a security gap in current configuration. Ensure an integration-level smoke test confirms `BRANCH_MANAGER` is blocked at default config before deploying to production.
