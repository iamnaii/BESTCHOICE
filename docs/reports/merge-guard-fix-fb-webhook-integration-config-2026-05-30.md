# Merge Guard Report — `fix/fb-webhook-integration-config`

**Date**: 2026-05-30  
**Branch**: `fix/fb-webhook-integration-config`  
**Author**: Akenarin Kongdach  
**Last commit**: `72da1b25` — fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig  

---

## Summary of Changes

| File | +/- |
|---|---|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +5 lines |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25 / -11 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 lines |

**What it does**: Migrates the Facebook webhook verify token and app secret from hardcoded environment variables (`FB_VERIFY_TOKEN`, `FB_APP_SECRET`) to `IntegrationConfigService` (reads from DB via Settings → Integrations, with env vars as fallback). Also makes `verifySignature` async and adds a proper "fail closed" guard when no verify token is configured.

---

## Issues Found

### Critical — None

- Controller is **intentionally public** (no JwtAuthGuard) — listed in `.claude/rules/security.md` as an approved exception. No regression here.
- No `Number()` on money fields — no financial values touched.
- No `deletedAt: null` queries — no database reads added.
- No hardcoded secrets — env vars were the old pattern; the new pattern reads from DB with env fallback.
- No SQL injection — no raw queries.
- `verifyWebhook` is **fail-closed**: the `verifyToken &&` guard ensures that an empty/missing configured token rejects all `subscribe` requests (400). The new test case (`'rejects with 400 when no verify token is configured (fail closed)'`) validates this explicitly. ✅

### Warning — None

- `getAppSecret()` is called on every POST payload (inside `verifySignature`). If `IntegrationConfigService.getConfig` does not cache results in memory, this is one extra DB read per webhook event. This is acceptable for a low-volume admin webhook, but worth noting if Facebook Messenger traffic ever becomes high-frequency.
- `IntegrationsModule` import into `ChatAdaptersModule` is correct; `forwardRef` is not needed since there's no circular dependency.

### Info — 1

- `verifyWebhook` was synchronous; it is now `async`. The `@Get()` route still returns `void` via `res.send()`, so NestJS handles the Promise return transparently. No issue, but reviewers should be aware the method signature changed.

---

## Verdict: ✅ APPROVE

The change is a clean security improvement: moving secrets out of static env vars into a DB-backed config makes runtime rotation possible without redeployment. The fail-closed logic is correct, three new test cases cover the verify-token flow, and the module wiring is minimal and correct.

No blocking issues. Safe to merge.
