# Merge-Guard Report — feat/canned-response-postback-routing

**Date**: 2026-05-27  
**Branch**: `feat/canned-response-postback-routing`  
**Author**: Akenarin Kongdach  
**Recommendation**: ⚠️ REVIEW (fix 2 warnings before merge)

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +8 / -1 | `forwardRef(StaffChatModule)` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +43 / -1 | Postback router hook |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +24 / -0 | Stub wiring |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | +37 / -1 | Postback router hook |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | +17 / -0 | Stub wiring |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | +6 / -0 | `forwardRef(StaffChatModule)` |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | +38 / -2 | Postback router hook |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts` | +40 / -2 | `staffId: string | null`, `getSystemUserId()` |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | +102 / -0 | System user tests |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | +156 / 0 | New service |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | +165 / 0 | New service tests |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | +2 / -1 | Register + export new service |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | +1 / -0 | Pass `allTemplates` prop |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | +72 / -11 | POSTBACK picker UI |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +7 / -1 | Pass `allTemplates` prop |

**15 files changed** — spans backend services, module wiring, and frontend UI.

---

## Issues

### Critical
_None._

### Warning

- **W1** — `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts:265` and `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts:328`  
  Both use `chatRoom.findUnique({ where: { lineUserId_channel: {...} } })` **without a `deletedAt: null` filter**. Prisma's `findUnique` on a composite unique key does not support an extra `where` clause, but `findFirst` with both the key equality and `deletedAt: null` would. As written, a soft-deleted `ChatRoom` row is still returned, causing `postbackRouter.route(room.id, payload)` to attempt a send, `sender.send()` to throw ("ChatRoom not found"), and the router to return `{ handled: true, error: '...' }` — **silently suppressing the postback** instead of falling through to the existing `action=check_balance` / intent-matcher pipeline. The Facebook path (`facebook-webhook.controller.ts:176`) correctly uses `findFirst` with `deletedAt: null`.  
  **Fix**: Replace `findUnique` with `findFirst` and add `deletedAt: null`:
  ```ts
  const room = await this.prisma.chatRoom.findFirst({
    where: {
      lineUserId: userId,
      channel: ChatChannel.LINE_FINANCE, // or LINE_SHOP
      deletedAt: null,
    },
    select: { id: true },
  });
  ```

- **W2** — `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx:84`  
  The POSTBACK template picker uses a native `<select>` element instead of the project-standard `shadcn/ui` `<Select>` component (frontend rule: "use shadcn/ui components + Radix UI primitives"). The native `<select>` visually diverges from the rest of the admin UI (no custom styling, no dark-mode theming, no keyboard focus ring consistent with shadcn). Replace with `<Select>` / `<SelectContent>` / `<SelectItem>` from `@/components/ui/select`.

### Info

- **I1** — `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts:527`  
  The system bot user is created with `password: 'NEVER_LOGIN_SYSTEM_USER'` stored literally (not bcrypt-hashed). Since the User model is `isActive: false`, the auth service rejects login before password comparison. The plaintext value is a sentinel, not a secret. Low risk, but if the auth service ever changes its active-check order this would expose a dummy unhashed credential. Consider using a bcrypt hash of a random UUID string as the placeholder instead (one-time cost at seed time).

- **I2** — `QuickReplyPostbackRouterService` uses an in-memory `Map<string, number[]>` for the W7 rate-limit sliding window. This resets on every pod restart and is not shared across horizontal replicas. Acceptable for a defensive loop guard as documented in the service JSDoc ("Counters are per-process and reset on app restart — fine for a defensive guard").

- **I3** — The `forwardRef()` circular dependency pattern is used in 3 modules (`ChatAdaptersModule`, `LineOaModule`, `ChatbotFinanceModule` all depending on `StaffChatModule` which indirectly depends on them via `ChatEngineModule`). This is the correct NestJS resolution strategy. No further action required; documented in comments.

---

## Analysis

### Security
No new authenticated endpoints are introduced. The existing webhook controllers (`FacebookWebhookController`, `LineOaChatbotController`) are **intentionally public** (no `JwtAuthGuard`) — these are already in the codebase. The changes only add logic inside existing public handler methods. No new public surfaces added.

The payload matching guard (`payload.startsWith('TEMPLATE:')`) is narrow and explicit. Unknown payloads fall through to the existing handler — non-breaking by design.

The W7 loop guard limits a single chat room to 5 postback-triggered sends per 10 seconds. The rate-limit check happens **before** the sender call, so a looping customer cannot drain the message pipeline.

### Money / Decimal
No financial calculations introduced. No `Number()` calls on money fields.

### Test Coverage
New service `QuickReplyPostbackRouterService` has 12 unit-test cases including rate-limit window expiry with fake timers. `CannedResponseSenderService` has 4 new cases covering the `staffId=null` / system-user upsert path. Both use `jest.fn()` mocks and avoid real DB calls.

---

## Verdict: ⚠️ REVIEW

Fix **W1** (missing `deletedAt: null` in 2 LINE postback handlers) and **W2** (native `<select>` → shadcn `Select`) before merging. W1 in particular causes soft-deleted rooms to silently absorb postbacks that should fall through to the bot's existing action handlers.
