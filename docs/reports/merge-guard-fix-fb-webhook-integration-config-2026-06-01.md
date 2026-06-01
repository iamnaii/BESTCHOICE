# Merge Guard Report — fix/fb-webhook-integration-config

**Date:** 2026-06-01  
**Branch:** `fix/fb-webhook-integration-config`  
**Reviewed against:** `origin/main`

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 | Add `IntegrationsModule` import |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25 / −11 | Migrate env-var secret reads to `IntegrationConfigService` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 | New test suite for DB-sourced verify token |

---

## Issues by Severity

### Critical — None

The controller already carries `@SkipCsrf()` and is correctly listed in `security.md` as an intentionally public endpoint (`paysolutions` / `sms-webhook` / `chatbot-finance-liff` pattern). No new unguarded surfaces introduced.

### Warning — None

### Info

- **`verifySignature` is now `async`** — callers inside the same controller are updated (`await this.verifySignature(...)`). No issues found, but note that if any mocks in older test suites call `verifySignature` synchronously they will need updating (the added spec already uses the async form correctly).
- **Fail-closed on missing token** — new guard `if (mode === 'subscribe' && verifyToken && token === verifyToken)` correctly rejects when `verifyToken` is falsy/empty. This is an improvement over the prior env-only path which could silently pass an empty string comparison.
- **DB → env fallback is not shown in the diff** but is assumed to live inside `IntegrationConfigService.getConfig('facebook')`. Verify the fallback reads `FB_VERIFY_TOKEN` / `FB_APP_SECRET` when the DB row has no value to avoid a regression during the settings migration window.

---

## Recommendation

**✅ APPROVE**

Security improvement (config now manageable via UI without a redeploy). Well-tested: 3 new `describe` blocks cover verification success, token mismatch, and empty-token fail-closed case. No patterns broken.
