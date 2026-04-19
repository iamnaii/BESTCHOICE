# Merge Guard Report — feat/pii-encryption-phase1-foundation

**Date**: 2026-04-19  
**Branch**: `feat/pii-encryption-phase1-foundation`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commits**: 3

## File Changes Summary

| File | Change |
|------|--------|
| `.env.example` | +11 lines — adds PII_ENCRYPTION_KEY + PII_HASH_SALT docs |
| `apps/api/src/app.module.ts` | +2 lines — registers PiiModule globally |
| `apps/api/src/modules/pii/pii-audit.service.ts` | NEW — 35 lines |
| `apps/api/src/modules/pii/pii-audit.service.spec.ts` | NEW — spec |
| `apps/api/src/modules/pii/pii.module.ts` | NEW — global @Global() module |
| `apps/api/src/utils/env-validation.ts` | +30 lines — prod validation for PII keys |
| `apps/api/src/utils/env-validation.spec.ts` | NEW — spec |
| `apps/api/src/utils/pii.util.ts` | NEW — hash + mask utilities |
| `apps/api/src/utils/pii.util.spec.ts` | NEW — spec |

## Issues by Severity

### Critical — None

- `PiiModule` is `@Global()` with `PiiAuditService` exported → DI resolves everywhere without per-module imports ✓
- No controllers added → no missing guard checks apply ✓
- No money fields touched ✓
- No hardcoded secrets — keys loaded via `process.env` only ✓

### Warning — None

### Info

1. **`pii.util.ts` — maskNationalId shows 5 prefix + 1 suffix only**  
   `"1234567890123"` → `"12345-XXXXX-XX-3"` — shows 6 digits total out of 13.  
   Acceptable for display but ensure UX guidance aligns with PDPA masking policy decisions.

2. **`env-validation.ts` validates PII keys only in `production` NODE_ENV**  
   Staging/UAT environments with `NODE_ENV=staging` will not enforce key presence.  
   Consider adding staging to the check, or ensure `.env` for staging explicitly sets both keys.

3. **`PiiAuditService.logDecryption` — audit failure is silent-swallow**  
   Errors are logged via `Logger.error` but not surfaced to Sentry.  
   Not a blocker, but a missed signal — consider adding `Sentry.captureException` inside the catch block (consistent with pattern on other crons in v3).

## Recommendation: ✅ APPROVE

Foundation phase is clean. No security regressions. New module correctly uses `@Global()`. Env validation enforces key format at startup in production.
