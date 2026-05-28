# Merge Guard Report — fix/fb-webhook-integration-config

**Date**: 2026-05-28  
**Branch**: `fix/fb-webhook-integration-config`  
**Author**: Akenarin Kongdach  
**Commits**: 1 (`72da1b25 fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig`)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 — added `IntegrationsModule` import |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 — 3 new `verifyWebhook` test cases |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +36 / -11 — DB-backed config lookup |

**Total**: 3 files changed, 96 insertions, 11 deletions

---

## What this branch does

Moves `FB_VERIFY_TOKEN` and `FB_APP_SECRET` from env-only to `IntegrationConfigService`
(Settings → Integrations UI), with env vars kept as fallback. This makes the Facebook
webhook verify token and HMAC secret configurable at runtime without a redeploy.

Key changes:
- `verifyWebhook()` → async, reads `integrationConfig.getConfig('facebook')` with fail-closed
  guard: empty `verifyToken` → 400 (not 200)
- `verifySignature()` → async, same DB lookup for `appSecret`
- `handleDataDeletion()` + `handleUserDerecognition()` use `getAppSecret()` private helper
- 3 new unit tests: challenge OK, token mismatch, empty config (fail-closed)

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**[I-1] `facebook-webhook` controller not listed in `security.md` intentionally-public allowlist**  
File: `.claude/rules/security.md`  
Severity: Info  
The security rule states: "ถ้าพบ controller ที่ไม่มี guard ที่ไม่อยู่ในรายการนี้ → ถือว่าเป็น security bug".
`FacebookWebhookController` has no `@UseGuards(JwtAuthGuard)` and is not in the allowlist — however
the controller was already public *before* this PR and has an explicit code comment: _"This controller
is intentionally public (no JwtAuthGuard) — it receives callbacks from Facebook"_. The fix does not
change the public status; it just upgrades config sourcing.

**Action**: Update `security.md` allowlist to include `facebook-webhook` so the rule is internally
consistent. No code change required.

---

## Security Notes

- Fail-closed pattern is correct: empty `verifyToken` → 400 (not a pass-through).
- `getAppSecret()` returns `undefined` when unset — downstream callers all guard on `!appSecret`.
- No secrets hardcoded; the change removes the env-only dependency, which is strictly an improvement.
- `IntegrationsModule` import added to `ChatAdaptersModule` — the DI graph is correctly updated.

---

## Recommendation

**✅ APPROVE**

The change is a security improvement (runtime-configurable secrets vs. redeploy-required env vars)
with full test coverage for the new path. One minor documentation gap exists in `security.md` — worth
fixing in a follow-up chore but does not block merge.
