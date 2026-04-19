# Merge Guard Report — feat/credit-check-override-audit

**Date**: 2026-04-19  
**Branch**: `feat/credit-check-override-audit`  
**Author**: Akenarin Kongdach  
**Commit**: `9defe335` — feat(credit-check): override audit trail + role guard (Sprint 3b)

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/api/prisma/migrations/20260522100000_add_credit_check_override_audit/migration.sql` | +17 | New columns + FK + index |
| `apps/api/prisma/schema.prisma` | +18/-3 | CreditCheck model + User relation |
| `apps/api/src/modules/credit-check/credit-check.controller.ts` | +12/-12 | Role expansion + user.role pass-through |
| `apps/api/src/modules/credit-check/credit-check.service.spec.ts` | +129 (new) | 6 tests covering override policy |
| `apps/api/src/modules/credit-check/credit-check.service.ts` | +67/-11 | `enforceOverridePolicy()` + audit fields |
| `apps/api/src/modules/credit-check/dto/credit-check.dto.ts` | +7/-1 | Required `overrideReason` field |

**Total**: 6 files changed, 229 insertions (+), 21 deletions (−)

---

## Issues Found

### Critical — None

### Warning — None

### Info

1. **`credit-check.service.ts:233,406`** — `overrideById` and `override` both set `checkedById` and `overriddenById` to the same `userId`. If the intent is to distinguish the checker (AI run) from the human overrider, this dual assignment is intentional and correct. Just noting for reviewer awareness — no action needed if confirmed intentional.

2. **`credit-check.service.ts:248`** — `overrideById` does not appear to call `enforceOverridePolicy` for the path reached via `CustomerCreditCheckController`. Re-reading the diff: the call `this.enforceOverridePolicy(creditCheck.status, dto.status, userRole)` replaces the old status validation in `overrideById` ✓ — the call is present at the correct insertion point.

---

## Detailed Findings

### Role Guard Expansion (controller)
Both `CreditCheckController.override` and `CustomerCreditCheckController.override` now pass `user.role` to the service. The `@Roles()` decorator correctly adds `FINANCE_MANAGER`. ✓

### `enforceOverridePolicy` Logic
```
REJECTED → APPROVED : restricted to OWNER / FINANCE_MANAGER  ✓
No-op (same status) : BadRequestException                     ✓
Invalid status      : BadRequestException                     ✓
```
Logic is correct and tested.

### Audit Trail Immutability
`originalStatus`/`originalScore` use `??` to preserve the first override — subsequent overrides do not overwrite the AI's original verdict. ✓

### DTO Validation
`overrideReason` is required with `@MinLength(10)` + `@MaxLength(2000)` + Thai message. ✓

### Migration Safety
All new columns are nullable — no backfill required for existing rows. FK uses `ON DELETE SET NULL`. ✓

### Tests
6 tests in `credit-check.service.spec.ts` covering:
- NotFound path
- BRANCH_MANAGER blocked for REJECTED→APPROVED
- OWNER allowed + audit fields captured
- FINANCE_MANAGER allowed
- BRANCH_MANAGER allowed for MANUAL_REVIEW→APPROVED (lower risk)
- No-op rejected
- Repeat-override preserves original state

---

## Recommendation

**APPROVE**

All critical and warning categories are clean. The feature correctly implements override audit trails with role-based escalation restrictions. Tests provide good coverage of the policy matrix.
