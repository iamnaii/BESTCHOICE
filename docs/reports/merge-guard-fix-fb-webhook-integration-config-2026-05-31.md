# Merge Guard Report — fix/fb-webhook-integration-config
**Date**: 2026-05-31  
**Branch**: `fix/fb-webhook-integration-config`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Latest commit**: `fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig`

---

## File Changes Summary
| File | +/- |
|------|-----|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25 / -11 |
| **Total** | **96 ins, 11 del — 3 files** |

---

## Issues

### Critical
_None found._

### Warning
_None found._

### Info
- `verifyWebhook` changed from sync `void` to `async Promise<void>`. NestJS handles async controller methods correctly — no issue.
- `handleWebhook` now calls `await this.verifySignature(...)` — consistent with the async change.
- Tests added cover: challenge success path, token mismatch (400), empty token (fail-closed). Coverage is solid.

---

## Analysis

`FacebookWebhookController` is correctly listed as **intentionally public** in `security.md` — it receives inbound FB Messenger events and the GET verification handshake. No `JwtAuthGuard` needed and none expected.

The change migrates `verifyToken` and `appSecret` lookups from `ConfigService` (env vars only) to `IntegrationConfigService` (DB, which already powers the Settings → Integrations UI). The env-fallback path is removed in favour of the DB-backed value, which is correct because operators set these values via the admin UI, not `.env` at runtime.

Fail-closed behaviour is preserved:
```ts
if (mode === 'subscribe' && verifyToken && token === verifyToken) { … }
// ^^ verifyToken falsy → always rejects
```

`IntegrationsModule` correctly added to `ChatAdaptersModule` imports. No circular-dep risk.

---

## Recommendation: ✅ APPROVE

Safe to merge. Focused fix, good tests, no security regression.
