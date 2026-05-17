# Merge Guard Report — test/a1-d1-1-1-5-normal-balance-drift

**Date**: 2026-05-17  
**Branch**: `test/a1-d1-1-1-5-normal-balance-drift`  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

7 files changed, 551 insertions(+), 7 deletions(-)

| File | Change |
|------|--------|
| `apps/api/src/modules/journal/account-role.service.ts` | Added `listWithCoa()`, `update()`, `getRequiredRoles()`, injected `AuditService` |
| `apps/api/src/modules/settings/dto/update-role-map.dto.ts` | New DTO with class-validator decorators |
| `apps/api/src/modules/settings/role-map-validation.service.spec.ts` | New 147-line unit test for validation rules |
| `apps/api/src/modules/settings/role-map-validation.service.ts` | New service (not shown in diff — new file) |
| `apps/api/src/modules/settings/settings.controller.ts` | Added `GET /role-map` and `PUT /role-map/:id` |
| `apps/api/src/modules/settings/settings.module.ts` | Imported `JournalModule`, added `RoleMapValidationService` |
| `docs/superpowers/tracking/D1-settings-implement.md` | Tracking doc update |

---

## Issues by Severity

### Critical — None

**Guards**: `SettingsController` retains class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER')`. New endpoints override role correctly:
- `GET /role-map` — `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` ✓
- `PUT /role-map/:id` — `@Roles('OWNER')` ✓

**Soft-delete**: `listWithCoa()` includes `where: { deletedAt: null }` on `chartOfAccount.findMany` ✓

**Money fields**: No financial amounts in this diff — role-map is metadata only ✓

**Secrets**: None ✓

### Warning — 1

**W1 — `AccountRoleService.update()` has an inline validation fallback**  
- When called without a `validator` argument, the service performs reduced inline checks (required-role lock + CoA presence only; skips priority-uniqueness check). This is documented as "for unit tests without a NestJS context." In production the controller always passes a `RoleMapValidationService` validator, so the gap is not exploitable — but the two code paths could diverge silently. Consider making the `validate` arg required (or throwing if absent in non-test builds) to prevent future drift.

### Info — 2

**I1 — `AuditService` now injected into `AccountRoleService`**  
Ensure `JournalModule` exports both `AccountRoleService` AND `AuditService` (or that `AuditService` is globally provided), otherwise `SettingsModule` DI will fail at runtime. The module file shows `imports: [JournalModule]` — verify `JournalModule` re-exports `AuditService`.

**I2 — Test file uses `eslint-disable @typescript-eslint/no-explicit-any` twice**  
Acceptable in test context for mock typing; no production `any` introduced.

---

## Recommendation: APPROVE

The security model is correct — new endpoints are guarded, roles are properly scoped, soft-delete filters are present. The optional-validator pattern (W1) is low risk given the controller always supplies the real validator. Verify the `AuditService` export chain (I1) before merge to avoid a runtime DI error.
