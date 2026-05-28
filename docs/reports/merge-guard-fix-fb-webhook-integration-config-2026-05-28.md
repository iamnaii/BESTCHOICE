# Merge Guard Report — fix/fb-webhook-integration-config

**Date**: 2026-05-28
**Branch**: `fix/fb-webhook-integration-config`
**Author**: Akenarin Kongdach
**Last commit**: `72da1b25` — fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 lines — imports `IntegrationsModule` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 lines — new test suite for verify token from IntegrationConfig |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25/-11 lines — read app secret + verify token from DB (env fallback) |

**3 files changed, 96 insertions(+), 11 deletions(-)**

---

## Issues by Severity

### Critical — none found

- Controller is correctly marked as intentionally public (no `JwtAuthGuard`) — this is a Facebook webhook receiver, consistent with the `paysolutions` and `sms-webhook` patterns.
- No hardcoded secrets; env fallback reads from `configService.get()` which is existing behaviour.
- No `Number()` on financial fields; no Prisma queries changed.
- No unparameterized `$queryRaw`.

### Warning — none found

- `verifyWebhook` signature was changed from `void` to `async void` — the `@Get()` handler correctly returns `Promise<void>`. NestJS handles async void routes correctly.
- "Fail closed" logic is correct: an empty/null `verifyToken` in DB causes the `verifyToken && token === verifyToken` check to short-circuit, rejecting the request with 403. This was explicitly tested.
- When `IntegrationConfigService.getConfig` throws (e.g. DB unavailable), the controller will propagate the exception as HTTP 500 rather than silently accepting the webhook — this is the safer outcome.

### Info

- The security rules list at `.claude/rules/security.md` under "Intentionally Public Endpoints" does not mention `chat-adapters/facebook-webhook`. This is a **pre-existing omission** in the documentation (the controller's own JSDoc already states it's intentionally public). Worth a docs-only PR to add `facebook-webhook` to the allow-list in the security rules.
- `IntegrationsModule` is added to `ChatAdaptersModule` imports. Module comments explain the dependency clearly.

---

## Security Analysis

The change migrates `FB_VERIFY_TOKEN` and `FB_APP_SECRET` from hard-wired env-variable-only reads to `IntegrationConfigService.getConfig('facebook')` (which itself falls back to the env vars if DB config is absent). This is a strictly better design — operators can now rotate credentials through the admin UI without a redeploy.

Three critical edge cases are covered by the new tests:
1. Token matches → challenge returned with 200 ✓
2. Token does not match → 400 ✓
3. Empty/unconfigured verify token → 400 (fail closed) ✓

---

## Test Coverage

68 new lines in the spec file covering:
- Verify token sourced from `IntegrationConfigService` (not env)
- Correct challenge echo on match
- Rejection on mismatch
- Rejection when token is empty (fail-closed guarantee)

All existing tests retain their `fbConfigMock()` injection to compile correctly.
