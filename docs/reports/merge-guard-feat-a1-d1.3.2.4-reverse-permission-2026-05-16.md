# Pre-Merge Guard Report — feat/a1-d1.3.2.4-reverse-permission

**Date**: 2026-05-16  
**Branch**: `feat/a1-d1.3.2.4-reverse-permission`  
**Author**: Akenarin Kongdach  
**Commit**: `234a8924` — feat(a1): D1.3.2.4 — reverse_permission dynamic guard (Q4-gated)  
**Base**: `origin/main`

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/src/modules/expense-documents/reverse-permission.guard.ts` | New | +61 |
| `apps/api/src/modules/expense-documents/__tests__/reverse-permission.guard.spec.ts` | New | +65 |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | Modified | +10 |
| `apps/api/src/modules/expense-documents/expense-documents.module.ts` | Modified | +3 |
| `apps/api/src/modules/settings/settings.service.ts` | Modified | +10 |
| `apps/web/src/hooks/useUiFlags.ts` | Modified | +4 |

**Total**: 6 files, 153 insertions

---

## Issue Analysis

### Critical Issues — NONE

- **Guards**: `ExpenseDocumentsController` already has class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`. The added `@UseGuards(ReversePermissionGuard)` at method level on `void()` is additive (runs after class-level guards). No guard gap.
- **Roles**: `@Roles('OWNER', 'FINANCE_MANAGER')` on `void()` is unchanged — the static decorator is preserved and serves as the outer fence before `ReversePermissionGuard` narrows.
- **Soft delete**: `reverse-permission.guard.ts` Prisma query includes `deletedAt: null`.
- No `Number()` on financial fields. No money fields involved.
- No hardcoded secrets. No raw SQL.

### Warning Issues — NONE

- No new DTOs.
- Error handling: `getAllowedRoles()` catches DB errors and falls back to the default `OWNER+FINANCE_MANAGER` set — preserving current behavior on failure.
- No new React components. `useUiFlags.ts` is purely additive.
- No mutations.

### Info

- The two-stage guard pattern (RolesGuard as outer fence → ReversePermissionGuard as narrowing gate) is consistent with `PostPermissionGuard` (D1.3.2.3) established in the preceding branch. Pattern is well-established.
- `ROLE_SETS` is a module-level constant (frozen sets) — no per-request allocation. Efficient.
- ForbiddenException messages are in Thai: `'ไม่พบข้อมูลผู้ใช้'` and `'ไม่มีสิทธิ์กลับรายการเอกสาร'`.

---

## Notes

- Allowed value set is intentionally narrow (`OWNER+FINANCE_MANAGER` / `OWNER_ONLY`). Malformed values fall back to default — no privilege escalation possible through misconfiguration.
- 4 unit tests: default behavior, OWNER_ONLY narrowing, malformed value fallback, DB error fallback. Covers all branches.
- `reversePermission` flag propagated to `useUiFlags` for UI button visibility control; server enforcement is independent via the guard (defense-in-depth).

---

## Recommendation: ✅ APPROVE

No critical or warning issues. Clean dynamic guard with proper fallback, correct guard ordering, and complete test coverage. Safe to merge.
