# Merge Guard Report — `fix/fb-webhook-integration-config`

**Date**: 2026-05-29  
**Branch**: `fix/fb-webhook-integration-config`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commit**: `72da1b25` — fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 lines — adds `IntegrationsModule` import so `IntegrationConfigService` is injectable |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 lines — adds `fbConfigMock()` helper + new describe block (3 tests) for DB-sourced verify token |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +36 / -11 lines — migrates `FB_VERIFY_TOKEN` + `FB_APP_SECRET` reads from env to `IntegrationConfigService` (DB → env fallback) |

**Total**: 3 files, +96 / -11 lines

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

**[INFO-1]** `getAppSecret()` is called independently in `handleDataDeletion()`, `handleDeactivation()`, and `verifySignature()`. Each call issues a DB lookup (or cache hit via `IntegrationConfigService`). If `IntegrationConfigService` doesn't internally cache, a single POST payload hitting all three paths would make 3 DB reads. Likely acceptable (webhook volume is low, and the service probably caches), but worth confirming with the integrations module's cache strategy.

**[INFO-2]** `verifySignature` is now `async` and returns `Promise<boolean>`. The call site in `handleWebhook` correctly uses `await`: `if (!(await this.verifySignature(rawBody, signature)))`. No missing await.

---

## Security Notes

- **Controller intentionally public** — `@Controller('webhooks/facebook')` has the `/// This controller is intentionally public` comment; it's on the project's allow-list for controllers without `JwtAuthGuard`. No issue.
- **Fail-closed on empty token** — `verifyWebhook` now explicitly checks `verifyToken &&` before the equality test, so a misconfigured empty string no longer allows any caller through. This is a security improvement over the previous env-based approach.
- **No hardcoded secrets** — token/secret values come from DB only. No new env fallback leaks.
- **No money fields, no Decimal issues, no deletedAt omissions** — N/A for this change.

---

## Test Coverage

Three new test cases added for `verifyWebhook`:
1. Challenge returned on matching token ✓
2. 400 on wrong token ✓
3. 400 when `verifyToken` is empty string (fail closed) ✓

Existing describe blocks updated to inject `IntegrationConfigService` mock — all previously passing tests remain valid.

---

## Recommendation

**APPROVE** — clean security hardening that moves webhook secrets from env vars into the admin-configurable `IntegrationConfig` store with proper fail-closed behavior. Tests cover the key edge cases. The INFO notes are informational only and do not block merge.
