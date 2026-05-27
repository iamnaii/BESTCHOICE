# Merge Guard Report — feat/canned-response-postback-routing

**Date**: 2026-05-27  
**Branch**: `feat/canned-response-postback-routing`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Against**: `origin/main`

---

## File Changes Summary

| File | +Lines | -Lines | Notes |
|------|--------|--------|-------|
| `chat-adapters/chat-adapters.module.ts` | +12 | -1 | `forwardRef(() => StaffChatModule)` added |
| `facebook-webhook.controller.spec.ts` | +22 | 0 | Adds postbackRouter + prisma stubs to test suites |
| `facebook-webhook.controller.ts` | +43 | 0 | Postback routing hook added before legacy path |
| `chatbot-finance.service.spec.ts` | +12 | 0 | Stub for QuickReplyPostbackRouterService |
| `chatbot-finance.service.ts` | +40 | 0 | postbackRouter injected, route() called in handlePostback |
| `line-oa-chatbot.controller.ts` | +38 | 0 | postbackRouter injected, route() called before action switch |
| `line-oa.module.ts` | +6 | 0 | `forwardRef(() => StaffChatModule)` added |
| `canned-response-sender.service.spec.ts` | +103 | 0 | System-user bootstrap tests (C1, W6) |
| `canned-response-sender.service.ts` | +40 | 0 | `getSystemUserId()` + `staffId: string | null` |
| `quick-reply-postback-router.service.spec.ts` | +165 | 0 | **New file** — full unit test suite |
| `quick-reply-postback-router.service.ts` | +156 | 0 | **New file** — TEMPLATE: payload router with W7 rate-limit |
| `staff-chat.module.ts` | +5 | -1 | Exports QuickReplyPostbackRouterService |
| `CannedResponseAdminPage.tsx` | +1 | 0 | Minor UI tweak |
| `QuickReplyEditor.tsx` | +74 | -10 | POSTBACK button type + TEMPLATE: payload field |
| `TemplateEditorPane.tsx` | +6 | -1 | Minor pane update |

**15 files changed, 701 insertions(+), 22 deletions(-)**

---

## Issues Found

### 🟡 Warning

#### W1 — `chatRoom.findUnique` without `deletedAt: null` check

**Files**:  
- `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` (new postback block)  
- `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` (new postback block)

```ts
// Both use this pattern — by unique composite key, no deletedAt guard:
const room = await this.prisma.chatRoom.findUnique({
  where: { lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE } },
  select: { id: true },
});
```

**Risk**: If a `ChatRoom` row is soft-deleted (`deletedAt != null`), a customer postback could still trigger `postbackRouter.route()`. The downstream `CannedResponseSenderService.send()` **does** check `deletedAt: null` on the room, so the eventual send will fail gracefully — but the router call is wasted and the audit trail appears confused.

**Mitigating factor**: The `CannedResponseSenderService` room guard (`where: { id: roomId, deletedAt: null }`) catches it before any message is sent, so there is no data integrity risk — only a silent no-op.

**Recommendation**: Add `deletedAt: null` to both `findUnique` calls for defense-in-depth, or add a comment explaining the downstream guard covers this.

---

#### W2 — System user password stored as plaintext placeholder

**File**: `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts`

```ts
create: {
  email: 'system@bestchoice.internal',
  password: 'NEVER_LOGIN_SYSTEM_USER',  // ← plain string, not bcrypt hash
  ...
  isActive: false,
```

**Risk**: Auth service uses `bcrypt.compare(loginDto.password, user.password)`. For the system user, `isActive: false` correctly blocks login before bcrypt is ever called (confirmed in `auth.service.ts`: `if (!user.isActive) throw UnauthorizedException`). The plaintext string will never match a bcrypt hash, adding a second layer of protection. However storing an unrecognisable non-hash string violates the "all password fields are bcrypt hashes" convention assumed by password reset flows and security audits.

**Recommendation**: Hash `'NEVER_LOGIN_SYSTEM_USER'` with bcrypt during creation to be consistent with all other User rows. `isActive: false` remains the primary guard.

---

### 🔵 Info

#### I1 — Loop guard (`W7`) is in-process memory only

**File**: `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts`

Rate-limit counters reset on app restart and are per-process, so multi-instance deployments (Cloud Run scales horizontally) have independent windows. For Cloud Run with min-instances ≥ 2 the effective limit is `MAX_PER_WINDOW × num_instances`. This is already acknowledged in the service comment. Acceptable for a defensive guard, but worth tracking if postback volume grows.

#### I2 — No unit tests for the `line-oa-chatbot.controller.ts` postback router path

The new postback routing block in `LineOaChatbotController.handlePostback` is not covered by a new spec (only `facebook-webhook` and `chatbot-finance` have updated tests). The existing LINE OA tests do not exercise the new code path. Consider adding at least a smoke test.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers have guards | ✅ All modified controllers (`FacebookWebhookController`, `LineOaChatbotController`) are in the **intentionally public** list (webhook endpoints with custom token/signature guards) |
| `Number()` on money fields | ✅ No money arithmetic in this branch |
| `deletedAt: null` on new queries | ⚠️ Missing on 2 `findUnique` calls (W1 above — mitigated by downstream guard) |
| Hardcoded secrets | ✅ None |
| SQL injection / raw queries | ✅ None |
| DTO validation | ✅ No new DTOs introduced |

---

## Recommendation

### ✅ APPROVE (with minor follow-ups)

No critical issues. The feature is well-tested, has a W7 rate-limit guard against Quick Reply loops, and uses `forwardRef` correctly to break circular module imports. The postback routing falls through gracefully for any unrecognised payload — existing LINE menu actions (`check_balance`, `check_installments`, `pay`) are unaffected.

**Follow-ups before or after merge:**
1. (W1) Add `deletedAt: null` to `findUnique` in chatbot-finance and line-oa postback blocks.
2. (W2) Consider hashing the system user's placeholder password with bcrypt for convention consistency.
3. (I2) Add a test for the LINE OA chatbot postback routing path.
