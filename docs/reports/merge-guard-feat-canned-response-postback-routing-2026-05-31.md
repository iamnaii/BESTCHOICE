# Pre-Merge Guard Report — feat/canned-response-postback-routing

**Date**: 2026-05-31  
**Branch**: `feat/canned-response-postback-routing`  
**Author**: Akenarin Kongdach  
**Recommendation**: ⚠️ REVIEW (1 Warning)

---

## File Changes Summary

| File | Change |
|------|--------|
| `chat-adapters/chat-adapters.module.ts` | +8 — StaffChatModule forwardRef import |
| `chat-adapters/facebook-webhook.controller.spec.ts` | +22 — new postback-routing tests |
| `chat-adapters/facebook-webhook.controller.ts` | +43 — POSTBACK routing in FB handler |
| `line-oa/services/chatbot-finance.service.spec.ts` | +12 — tests for LINE Finance postback |
| `line-oa/services/chatbot-finance.service.ts` | +40 — LINE Finance postback dispatch |
| `line-oa/line-oa-chatbot.controller.ts` | +38 — LINE Shop postback routing |
| `line-oa/line-oa.module.ts` | +6 — StaffChatModule import |
| `staff-chat/services/canned-response-sender.service.spec.ts` | +103 — sender service tests |
| `staff-chat/services/canned-response-sender.service.ts` | +40 — system-user upsert + send |
| `staff-chat/services/quick-reply-postback-router.service.spec.ts` | +165 — router tests |
| `staff-chat/services/quick-reply-postback-router.service.ts` | +156 — new postback router service |
| `staff-chat/staff-chat.module.ts` | +5 — exports QuickReplyPostbackRouterService |
| `web/src/pages/CannedResponseAdminPage.tsx` | +1 — minor UI fix |
| `canned-response-admin/QuickReplyEditor.tsx` | +74 — POSTBACK template picker UI |
| `canned-response-admin/TemplateEditorPane.tsx` | +6 — editor integration |

**Total**: 15 files, 701 insertions, 22 deletions

---

## Issues Found

### Critical
None.

### Warning

**W1 — `findUnique` without `deletedAt: null` on chat room lookup**  
Files: `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` (2 instances)

```ts
// Current (problematic):
const room = await this.prisma.chatRoom.findUnique({
  where: {
    lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE },
  },
  select: { id: true },
});
```

Prisma's `findUnique` only accepts unique-key fields in `where`; you cannot add `deletedAt: null` directly. A soft-deleted chat room would still be found and receive postback routing events. Fix: convert to `findFirst` with an explicit `deletedAt: null` guard:

```ts
const room = await this.prisma.chatRoom.findFirst({
  where: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE, deletedAt: null },
  orderBy: { createdAt: 'desc' },
  select: { id: true },
});
```

Risk is low (chat routing, not financial data), but follows the project rule "ทุก query ต้องมี `where: { deletedAt: null }` เสมอ".

### Info

**I1 — Plaintext system-user password placeholder**  
`apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts`

```ts
create: {
  email: 'system@bestchoice.internal',
  password: 'NEVER_LOGIN_SYSTEM_USER',  // ← plaintext
  isActive: false,
  isSystemUser: true,
}
```

The user is locked (`isActive: false`, `isSystemUser: true`) so login is blocked, but this string would be stored unencoded in the DB if the auth layer doesn't hash it on upsert. Confirm that `UserService` or the auth guard hashes `password` at creation. If not, use a bcrypt hash of a random UUID instead. Low priority since `isActive: false` prevents actual login.

**I2 — System user created lazily at runtime**  
System bot is upserted on the first postback event rather than during seed. A race condition is theoretically possible on first concurrent postback (Prisma upsert is atomic at DB level, so this is safe in practice, and tests confirm it). Consider moving to the dev seed for cleanliness.

---

## Guards & Patterns Check

| Check | Result |
|-------|--------|
| `StaffChatController @UseGuards` | ✅ Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` |
| New endpoints have `@Roles()` | ✅ All new routes decorated |
| No `Number()` on financial fields | ✅ No financial data in this module |
| No raw `fetch()` in frontend | ✅ Uses `api.get()/api.post()` |
| `invalidateQueries` after mutations | ✅ Present in QuickReplyEditor |
| No hardcoded secrets | ✅ No env vars, tokens, or keys |
| `deletedAt: null` on queries | ⚠️ Missing on 2 `findUnique` calls (W1) |
