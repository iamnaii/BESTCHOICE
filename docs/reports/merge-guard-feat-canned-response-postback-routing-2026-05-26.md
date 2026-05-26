# Pre-Merge Guard Report

**Branch:** `feat/canned-response-postback-routing`
**Author:** Akenarin Kongdach
**Date:** 2026-05-26
**Recommendation:** ⚠️ REVIEW (2 warnings)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +12/-1 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +22 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +43/-1 |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | +12 |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | +40/-1 |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | +38/-4 |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | +6 |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | +103 |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts` | +40/-1 |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | +165 (new) |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | +156 (new) |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | +5/-1 |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | +1 |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | +74/-9 |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +6/-1 |

**Total:** 15 files, ~701 net additions

---

## Overview

Adds `QuickReplyPostbackRouterService` — a new service that intercepts `TEMPLATE:<id>` postback payloads from LINE Finance, LINE Shop, and Facebook Messenger webhook handlers. When a customer taps a Quick Reply button whose payload matches this format, the service dispatches the referenced canned-response template back into the chat without requiring staff action. Falls through to existing routing for any unrecognised payload.

Also:
- `CannedResponseSenderService.send()` now accepts `staffId: string | null` (system-bot path)
- System bot user is bootstrapped via idempotent `upsert` (safe under concurrent first-run)
- W7 loop guard: in-memory sliding window caps Quick Reply chain dispatches at 5 per 10 s per room
- Frontend `QuickReplyEditor` adds a template-picker dropdown for `POSTBACK` type quick replies

---

## Issues Found

### Critical
_None_

### Warning

**W1 — `chatRoom.findUnique` missing `deletedAt: null` filter**
`apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` (handlePostback, ~L397) and
`apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` (~L540):

```ts
// current
const room = await this.prisma.chatRoom.findUnique({
  where: { lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE } },
  select: { id: true },
});
```

`findUnique` on a unique composite key cannot add an extra `deletedAt: null` condition. If a ChatRoom is soft-deleted but the `lineUserId_channel` row still exists, the postback router will dispatch to a deleted room. The downstream `CannedResponseSenderService.send()` does guard with `deletedAt: null` in its `chatRoom.findFirst`, so the worst case is a silent no-op (template not sent), but the intent is clearer — and more correct — with `findFirst`:

```ts
// recommended fix
const room = await this.prisma.chatRoom.findFirst({
  where: {
    lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE },
    deletedAt: null,
  },
  select: { id: true },
});
```

Same fix needed in both files (`LINE_FINANCE` in `chatbot-finance.service.ts`, `LINE_SHOP` in `line-oa-chatbot.controller.ts`).

**W2 — System user password literal `'NEVER_LOGIN_SYSTEM_USER'`**
`apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts` (getSystemUserId):

The password placeholder is intentionally non-functional (`isActive: false` blocks login), but it is a plaintext string — not hashed. Depending on how the `auth` module's `validateUser` works, a non-hashed value typically fails `bcrypt.compare()` anyway, but it's worth confirming that no code path can authenticate with this user. Low risk given `isActive: false`, but consider storing a hashed value or an empty/null-safe sentinel to be consistent with the rest of the user table.

### Info

- `forwardRef(() => StaffChatModule)` added to three modules (`chat-adapters.module`, `line-oa.module`, `chatbot-finance.module`). Necessary to break the circular import graph; the existing `chatbot-finance` ↔ `staff-chat` cycle was already present. No change recommended, but worth noting for future architectural cleanup (SP7 module split would resolve it naturally).
- `QuickReplyPostbackRouterService` in-memory rate-limit (`recentSends: Map`) is per-process. In a multi-replica Cloud Run setup, the limit is per replica, not global. Each replica enforces its own 5/10 s window. This is acceptable as a best-effort loop guard (documented in comments), but it means a high-QPS attack could exceed 5 total across replicas. Low-risk given this is a chat postback path.
- 165 new tests in `quick-reply-postback-router.service.spec.ts` and 103 in `canned-response-sender.service.spec.ts` — good coverage of the new paths including concurrency (C1), rate limiting (W7), and system-user bootstrap.

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards` | N/A — all new code is in webhook handlers (intentionally public) + internal services |
| Money fields use `Prisma.Decimal` | N/A — no financial calculations in this diff |
| Queries include `deletedAt: null` | ⚠️ Two `findUnique` without soft-delete guard (W1) |
| No hardcoded secrets | ✅ (`NEVER_LOGIN_SYSTEM_USER` is not a real credential; noted in W2) |
| `@Roles()` on controller methods | N/A — webhook paths are public by design |
| No SQL injection | ✅ |
