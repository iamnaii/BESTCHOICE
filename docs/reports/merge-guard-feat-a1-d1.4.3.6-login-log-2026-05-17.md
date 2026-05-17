# Merge Guard Report — `feat/a1-d1.4.3.6-login-log`

**Date**: 2026-05-17  
**Branch**: `feat/a1-d1.4.3.6-login-log`  
**Author**: Akenarin Kongdach  
**Commit**: feat(a1): D1.4.3.6 — login_log_enabled toggle

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/auth/login-audit.service.ts` | Added `isLoginLogEnabled()` private method; gates `loginAuditLog.create` INSERT |
| `apps/api/src/modules/auth/login-audit.service.spec.ts` | 4 new test cases covering the toggle (disabled / security-independent / explicit-on / default-on) |
| `apps/api/src/modules/settings/settings.service.ts` | Added `loginLogEnabled: boolean` to `getUiFlags()` return type |
| `apps/api/src/modules/settings/settings.service.spec.ts` | 2 new tests: default `true` when row absent; `false` when OWNER disables |
| `apps/web/src/hooks/useUiFlags.ts` | Added `loginLogEnabled: boolean` to `UiFlags` interface + default `true` |

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

**[INFO-1]** `login-audit.service.ts` is well-commented but the JSDoc block (lines ~31–45) is longer than the project standard ("one short line max, no multi-paragraph docstrings"). This is not a bug; informational only.

**[INFO-2]** The `isLoginLogEnabled()` method makes a DB round-trip on every login attempt. On high-frequency auth paths this adds one SELECT per login. Acceptable for now (ThrottlerGuard caps at 200 req/sec), but worth caching if this module grows more config flags.

---

## Security Notes

- **Fail-safe default**: when the DB throws inside `isLoginLogEnabled()`, the method catches and returns `true` — the audit trail stays enabled. Correct.
- **Known-device tracking + new-device LINE alerts continue regardless** of the toggle. Account lockout in `AuthService` (`User.failedLoginAttempts` / `lockedUntil`) is unaffected. Security controls are not weakened by disabling the toggle.
- `deletedAt: null` is correctly applied in the SystemConfig query.

---

## Recommendation: ✅ APPROVE

All critical and warning categories are clean. The toggle is secure (fail-safe default), well-tested, and correctly scoped to only skip the audit-row INSERT while leaving security alerting intact.
