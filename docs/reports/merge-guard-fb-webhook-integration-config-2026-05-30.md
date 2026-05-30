# Pre-Merge Guard Report

**Branch**: `fix/fb-webhook-integration-config`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Date**: 2026-05-30  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

3 files changed, 96 insertions(+), 11 deletions(-)

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | Import `IntegrationsModule` for DB config access |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | Move FB app secret + verify token from env vars to `IntegrationConfig` (DB → env fallback) |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | Add 3 new test cases for `verifyWebhook` using `IntegrationConfig` mock |

---

## Issues by Severity

### Critical
None.

- Controller remains intentionally public (no `JwtAuthGuard`) — listed in the documented public-endpoint allow-list.
- No money fields touched. No `Number()` on financial values.
- No hardcoded secrets. Secrets resolved from DB with env fallback.
- No unparameterized `$queryRaw`.

### Warning

**W1 — No error handling if `IntegrationConfig.getConfig` throws**  
`verifyWebhook` and `verifySignature` call `getConfig('facebook')` without a `try/catch`. If the database is unavailable during a Facebook webhook event, the controller will return HTTP 500. Facebook's webhook delivery will retry on non-2xx responses, so correctness is preserved, but monitoring will see elevated error rates during DB outages. Risk is low given the `@SkipCsrf()` public endpoint context.

**W2 — Two DB calls per POST webhook event**  
`handleWebhook` → `verifySignature` → `getAppSecret` → `getConfig` is one call. `handleDataDeletion` and `handleDeauthorize` each also call `getAppSecret`. If `IntegrationConfigService.getConfig` does not cache at the service level, a single POST webhook event makes 1 DB lookup. This is acceptable but worth verifying that `IntegrationConfigService` has request-scoped or TTL-based caching.

### Info

**I1 — Tests properly cover fail-closed behavior**  
New test suite `verifyWebhook — verify token from IntegrationConfig` covers: token match → 200, token mismatch → 400, empty `verifyToken` → 400 (fail closed). Good coverage of the security-critical path.

**I2 — `verifyWebhook` return type changed from `void` to `Promise<void>`**  
The GET handler is now `async`. NestJS handles `Promise<void>` on `@Get` handlers correctly; no behavioral regression.

---

## Recommendation

**APPROVE**

Clean security improvement. Facebook credentials move from static env vars to operator-configurable `IntegrationConfig` with env fallback, enabling production token rotation without redeployment. The Warning items are non-blocking observations, not defects.
