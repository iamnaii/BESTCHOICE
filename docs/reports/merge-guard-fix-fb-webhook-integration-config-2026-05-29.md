# Merge Guard Report — fix/fb-webhook-integration-config
**Date**: 2026-05-29  
**Branch**: `fix/fb-webhook-integration-config`  
**Author**: Akenarin Kongdach  
**Commits**: 1  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +4 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25/-11 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 |

**3 files changed — 97 insertions, 11 deletions**

---

## What This Branch Does

Migrates Facebook webhook credential resolution from hard-coded env vars (`FB_VERIFY_TOKEN`, `FB_APP_SECRET`) to `IntegrationConfigService` (DB-backed, UI-configurable via Settings → Integrations), with the original env vars retained as fallback. Affects:

- `verifyWebhook` GET — now reads verify token from IntegrationConfig
- `verifySignature` — now async, reads app secret from IntegrationConfig
- `handleDataDeletion` — same app-secret migration
- `handleProfileDeletion` — same app-secret migration

Controller retains `@SkipCsrf()` and **no JwtAuthGuard** — correct, per `security.md` "Intentionally Public Endpoints" list.

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**I-1 — DB lookup on hot webhook path**  
`verifySignature` is called on every inbound POST payload. It now does an async DB read (`integrationConfig.getConfig('facebook')`) on each request. Under normal Messenger traffic this is fine (IntegrationConfig likely caches internally), but if the config table lacks an index on `(integration_key)` the call could slow under burst traffic. Confirm `IntegrationConfig` lookup is indexed or cached.

**I-2 — Fail-closed when token is empty string (confirmed correct)**  
The guard `if (mode === 'subscribe' && verifyToken && token === verifyToken)` correctly rejects when `verifyToken` is falsy. Test suite confirms `400` on empty token. No concern.

**I-3 — 3 new tests cover the token-from-DB path**  
`verifyWebhook` branch now has dedicated tests: match → 200, mismatch → 400, empty → 400. Good coverage.

---

## Verdict

Clean, targeted fix. Improves operational flexibility (rotate token via UI without redeploy). No security regressions introduced.
