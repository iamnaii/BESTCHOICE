# Pre-Merge Guard Report — feat/a1-d1.3.2.4-reverse-permission

**Branch**: `feat/a1-d1.3.2.4-reverse-permission`
**Author**: Akenarin Kongdach
**Date reviewed**: 2026-05-17 (reviewed 2026-05-18)
**Changes**: 7 files changed, +197 / -3 lines

---

## File Changes Summary

| Area | File | Lines |
|------|------|-------|
| New guard | `reverse-permission.guard.ts` | +75 |
| Guard tests | `reverse-permission.guard.spec.ts` | +65 |
| Controller wiring | `expense-documents.controller.ts` | +16 |
| Module providers | `expense-documents.module.ts` | +3 |
| Service defense-in-depth | `expense-documents.service.ts` | +19 |
| Settings surface | `settings.service.ts` | +14 |
| Frontend flag | `useUiFlags.ts` | +8 |

---

## Security Checks

| Check | Result |
|-------|--------|
| Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` preserved on controller | ✅ Unchanged |
| `@Roles('OWNER', 'FINANCE_MANAGER')` retained as superset gate | ✅ Correct — guard narrows, not widens |
| `ReversePermissionGuard` registered as module provider | ✅ Present |
| `deletedAt: null` in SystemConfig query | ✅ Present |
| Service-level defense-in-depth mirrors guard | ✅ `resolveReversePermissionRoles` called in `voidDocument` |
| DB error falls back to safe default | ✅ `catch` block returns `OWNER+FM` set |
| Malformed config value falls back to safe default | ✅ Whitelist check: only known keys pass |
| No money/Decimal fields touched | ✅ N/A |
| Hardcoded secrets | ✅ None |

---

## Issues

### Critical
_None._

### Warning
_None._

### Info
_None._

---

## Notes

- Correctly follows the `PostPermissionGuard` (D1.3.2.3) pattern — shared `resolveReversePermissionRoles` helper keeps the guard and service in sync automatically.
- Test suite covers the four critical edge cases: default (no DB row), `OWNER_ONLY` narrowing, malformed config value, and DB error — all fall back correctly.
- `useUiFlags.ts` surface allows UI to hide the "Void" button for roles that will 403, avoiding confusing dead-end interactions.
- The `userRole?: string` optional param preserves backward compatibility for unit tests and system-internal calls that don't pass a role.

---

## Recommendation

**✅ APPROVE**

Clean implementation, correct security layering, well-tested. Safe to merge.
