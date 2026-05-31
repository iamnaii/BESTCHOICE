# Pre-Merge Guard Report — fix/fb-webhook-integration-config

**Reviewer**: Pre-Merge Guard (automated)
**Date**: 2026-05-31
**Branch**: `fix/fb-webhook-integration-config`
**Author**: Akenarin Kongdach

---

## File Changes Summary

| File | Change |
|------|--------|
| `chat-adapters.module.ts` | Imports `IntegrationsModule` so controller can inject `IntegrationConfigService` |
| `facebook-webhook.controller.ts` | Reads `appSecret` + `verifyToken` from `IntegrationConfigService` (DB → env fallback) |
| `facebook-webhook.controller.spec.ts` | Adds `IntegrationConfigService` mock; new `verifyWebhook` test suite (3 cases) |

**Net**: 3 files, +96 insertions, -11 deletions

---

## Critical Issues

None.

> `FacebookWebhookController` is intentionally public (no `JwtAuthGuard`) — it uses HMAC-SHA256 signature verification instead of JWT. The controller comment confirms this explicitly and the pattern matches the `paysolutions` webhook exception (external provider webhooks authenticate via signed payloads, not JWT). No new public surface is introduced by this diff.

No `Number()` on money fields (no financial arithmetic in this diff).

No new Prisma queries — no `deletedAt: null` exposure.

No hardcoded secrets — reads from `IntegrationConfigService` with env var fallback.

No unparameterized `$queryRaw`.

---

## Warning Issues

**W1 — Async DB lookup on every webhook verification request (low-risk, flag for awareness)**

`verifyWebhook` and `verifySignature` now call `integrationConfig.getConfig('facebook')` on every request. Since both endpoints are public, a high-volume attacker could drive extra DB reads. Mitigations already present:
- Global `ThrottlerGuard` (200 req/sec) limits blast radius.
- `IntegrationConfigService.getConfig` likely has in-memory or Redis caching (standard pattern in this codebase).
- Signature rejection happens fast on mismatch.

If `getConfig` does NOT cache, adding a short TTL cache (e.g., 60s) would be prudent. Recommend verifying `IntegrationConfigService` caching behaviour before merge to production.

---

## Info

- `verifyWebhook` correctly **fails closed** when `verifyToken` is empty/null — the guard `verifyToken && token === verifyToken` means an unconfigured token rejects all verification requests (returns 400). This is secure-by-default. ✓
- Three new test cases cover: (a) matching token → 200 + challenge, (b) wrong token → 400, (c) empty-config token → 400. Edge-case coverage is thorough. ✓
- `getAppSecret()` private helper centralises the DB-lookup-with-undefined-fallback pattern — clean separation. ✓

---

## Recommendation: **APPROVE**

The fix correctly migrates Facebook credentials from hard-coded env vars to the DB-backed `IntegrationConfig` settings (same pattern as LINE OA config), with env var fallback for backwards compatibility. All security properties are preserved; the only flag is a minor performance concern on `getConfig` caching that should be confirmed rather than fixed.
