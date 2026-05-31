# Merge Guard Report — fix/fb-webhook-integration-config

**Date:** 2026-05-31  
**Branch:** `fix/fb-webhook-integration-config`  
**Last commit:** 2026-05-28 — `fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig`  
**Recommendation:** ✅ **APPROVE**

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 lines — imports `IntegrationsModule` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25/−11 — migrates secret/token reads to IntegrationConfig |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 lines — new test suite for DB-backed verify token |

---

## Issue Analysis

### Critical (must fix before merge)
None found.

### Warning (should fix)
None found.

### Info
- **`appSecret = 'secret'`** in `fbConfigMock()` test helper: plaintext mock values are test-only constants — not real secrets. Confirmed safe.

---

## Detailed Findings

### Security improvement — fail-closed verify token guard

The old code: `if (mode === 'subscribe' && token === verifyToken)` — if `FB_VERIFY_TOKEN` env was unset, both `token` and `verifyToken` would be `undefined`, so `undefined === undefined` → `true` — webhook verification silently succeeded with no token configured.

The new code: `if (mode === 'subscribe' && verifyToken && token === verifyToken)` — the added `verifyToken &&` check means an unconfigured IntegrationConfig (empty string) now correctly returns 400. This is a genuine security improvement.

### Controller is intentionally public ✅
`FacebookWebhookController` carries the comment "This controller is intentionally public (no JwtAuthGuard)" — it is on the allowed public list in `security.md` (`paysolutions` / Facebook webhook pattern). `@SkipCsrf()` is correctly applied on the GET handler.

### Async signature propagation ✅
`verifySignature` becomes `async` and `handleWebhook` calls it with `await`. All call sites updated consistently.

### Tests ✅
New spec suite covers: token matches → 200+challenge, wrong token → 400, empty token → 400 (fail-closed). Good regression coverage for the new DB-backed path.

---

## Verdict

Clean, focused fix. Migrates Facebook app secret and verify token reads from env-only to DB (with env fallback), adds fail-closed guard, and ships full test coverage. No blocking issues.
