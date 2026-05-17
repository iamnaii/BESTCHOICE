# Merge Guard Report — feat/a1-d1.1.1.6-role-map-audit

**Date**: 2026-05-17  
**Author**: akenarin.ak@gmail.com (iamnaii)  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/journal/account-role.service.ts` | `create()` method added (+78 lines); `update()` gains split audit action `ROLE_MAP_DEACTIVATED` |
| `apps/api/src/modules/settings/role-map-audit.spec.ts` | New — 119-line unit tests for audit events |
| `docs/superpowers/tracking/D1-settings-implement.md` | Tracking doc update |

---

## Issues by Severity

### Critical — None

No new controller endpoints. No new guards needed. No `Number()` on financial fields. No unparameterized raw SQL. No hardcoded secrets.

### Warning

**W1 — `AccountRoleMap` model missing `deletedAt`** (schema.prisma)  
The model does not have a `deletedAt DateTime?` field:
```
model AccountRoleMap {
  id          String   @id @default(uuid())
  role        String
  accountCode String
  ...
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  // ← no deletedAt
}
```
Database rules require all models to have `deletedAt` unless they are in the documented exception list (immutable audit logs, one-time tokens, idempotency records, append-only event logs). `AccountRoleMap` is a mutable configuration table and does not qualify for any exception. Without soft-delete, removing a stale role mapping is a hard-delete with no recovery path.

Note: the model was likely introduced in a prior branch (D1.1.1.2/D1.1.1.3), not this one — but the `create()` method added here makes the gap more visible.

**W2 — `create()` is dead code (no endpoint yet)**  
The docstring notes it's "for future POST endpoint or bulk-import flows; not exposed via PUT." There is no controller endpoint wired to it. Dead service methods accumulate stale assumptions and miss being exercised during integration tests. Either expose it now or add a `// TODO:` marker linking to the planned endpoint ticket so it isn't forgotten.

### Info

1. **Multi-line docstrings on `create()`** (`account-role.service.ts:196–208`): Violates one-line-max comment rule.
2. **Multi-line docstring on test file** (`role-map-audit.spec.ts:1–17`): Same issue.
3. **`ROLE_MAP_DEACTIVATED` is a plain string** — not a Prisma enum value. This is consistent with the codebase pattern (`JV_OVERRIDDEN` etc. are plain strings), not an issue; just documenting for reviewers.

---

## Recommendation Detail

Block on **W1** if the team policy is "no exceptions outside the documented list." If the team decides `AccountRoleMap` is intentionally non-soft-deletable (e.g., hard-deleting a mapping is acceptable), add a `/// Intentionally no deletedAt — role mappings are hard-deleted` doc comment on the model to silence future reviewers.

W2 is a should-fix before the `create()` endpoint is merged.
