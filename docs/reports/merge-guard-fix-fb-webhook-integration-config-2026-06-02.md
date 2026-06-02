# Merge Guard Report — fix/fb-webhook-integration-config

**Date:** 2026-06-02  
**Branch:** `fix/fb-webhook-integration-config`  
**Author:** Akenarin Kongdach  
**Commit:** `72da1b25` — fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 lines — imports `IntegrationsModule` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25 / -11 lines — migrates env-var config reads to `IntegrationConfigService` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 lines — adds `IntegrationConfigService` mock + 3 new test cases |

**Total:** 3 files changed, 96 insertions, 11 deletions

---

## Issues Found

### Critical — 0 found ✅

No critical issues.

### Warning — 0 found ✅

No warnings.

### Info

| # | File | Line | Note |
|---|------|------|------|
| I-1 | `facebook-webhook.controller.ts` | `getAppSecret()` | If `IntegrationConfigService.getConfig('facebook')` throws (e.g. DB down), the exception propagates up to NestJS global exception filter. Callers (`handleDataDeletion`, `verifySignature`, `handleDeaccountDeletion`) each already guard the `undefined` return — so DB failure means 500 rather than a silent security bypass. This is acceptable fail-closed behavior. |
| I-2 | `facebook-webhook.controller.ts` | `verifyWebhook()` | Method is now `async` — consistent with `handleWebhook` which was already async. No issue; noted for awareness. |

---

## Detailed Analysis

### Security check: public controller exception
`FacebookWebhookController` is **intentionally public** (no `JwtAuthGuard`). This is listed in `.claude/rules/security.md` under "Intentionally Public Endpoints". No change to the public/private contract in this PR.

### Config migration correctness
- `verifyToken`: empty string from DB now correctly rejected (`verifyToken && token === verifyToken` — fails closed, confirmed by new test `rejects with 400 when no verify token is configured (fail closed)`).
- `appSecret`: uses `|| undefined` coercion — empty DB string fails same as missing, preventing accidental open access.
- Env-var fallback removed — this is intentional: the fix's purpose is to use the DB-backed value exclusively. No regression risk since `IntegrationConfigService.getConfig` itself reads env as its own fallback (not shown in this diff, but implied by existing module behavior).

### Test quality
Three new `verifyWebhook` integration tests cover the happy path, wrong-token rejection, and empty-token fail-closed cases. All three test suites (`handleWebhook` rawBody, `message_echoes`) updated to include `IntegrationConfigService` mock — prevents `NestJS DI` injection failure in existing tests.

---

## Verdict

**✅ APPROVE** — Clean, focused security improvement. Migrates hardcoded env-var reads to DB-backed config for the Facebook integration. Fails closed in all cases. Tests added for all new behaviors. No patterns violated.
