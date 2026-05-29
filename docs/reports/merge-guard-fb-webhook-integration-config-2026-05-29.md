# Pre-Merge Guard Report — fix/fb-webhook-integration-config

**Date**: 2026-05-29  
**Branch**: `fix/fb-webhook-integration-config`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-28 — fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 lines — imports `IntegrationsModule` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25 / -14 — reads FB credentials from `IntegrationConfigService` (DB → env fallback) |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 lines — adds tests for verify-token DB routing |

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

- **`verifyWebhook` / `verifySignature` are now `async`** — correct, required since they `await integrationConfig.getConfig()`. All call sites are properly awaited (`handleWebhook` already uses `await this.verifySignature(...)`). No fire-and-forget risk.
- **Controller remains intentionally public** — `FacebookWebhookController` is in the security.md allow-list for controllers without `JwtAuthGuard`. The patch does not change that status.
- **No money fields touched** — no `Decimal`/`Number()` concern.
- **No Prisma queries added** — no missing `deletedAt: null` risk.
- **Test coverage added** — 3 new `describe` blocks covering token-match, token-mismatch, and empty-token (fail-closed) scenarios. Mocking pattern (`fbConfigMock`) is clean and consistent across test suites.

---

## Security Notes

The fix moves from `process.env.FB_VERIFY_TOKEN` / `process.env.FB_APP_SECRET` to a DB-backed `IntegrationConfigService` with env as fallback. This is the correct architectural direction — keeps secrets out of `.env` for multi-tenant LIFF/FB configs and centralises management in the Settings UI. The fail-closed path (`!verifyToken || token !== verifyToken → 400`) is preserved and verified by tests.

---

## Recommendation

**✅ APPROVE**

Clean, targeted fix. Security posture improved (DB config + env fallback instead of env-only). Full test coverage added. No regressions flagged.
