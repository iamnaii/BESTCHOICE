# Pre-Merge Guard Report — `feat/canned-response-postback-routing`

**Date**: 2026-05-27  
**Author**: Akenarin Kongdach  
**Branch**: `feat/canned-response-postback-routing`  
**Base**: `origin/main`  
**Recommendation**: 🟡 **REVIEW** — 3 Warnings, fix before merge

---

## Summary

```
 apps/api/src/modules/chat-adapters/chat-adapters.module.ts            |  12 +-
 apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts|  22 +++
 apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts     |  43 +++++-
 apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts |  12 ++
 apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts      |  40 ++++-
 apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts            |  38 ++++-
 apps/api/src/modules/line-oa/line-oa.module.ts                        |   6 +
 apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts | 103 +++++
 apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts      |  40 ++++-
 apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts | 165 ++++++ (new)
 apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts      | 156 ++++++ (new)
 apps/api/src/modules/staff-chat/staff-chat.module.ts                  |   5 +-
 apps/web/src/pages/CannedResponseAdminPage.tsx                        |   1 +
 apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx         |  74 ++++++--
 apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx       |   6 +-
 15 files changed, 701 insertions(+), 22 deletions(-)
```

Full-stack feature: Quick Reply postback routing for canned responses. When a customer taps a `TEMPLATE:<id>` Quick Reply button in LINE/Facebook, the new `QuickReplyPostbackRouterService` dispatches the target canned response automatically. Includes rate-limit loop guard, system-bot user, channel-tabs (superset of `feat/canned-response-channel-tabs`), and a POSTBACK template picker UI.

---

## Architecture Overview

```
LINE/FB webhook → existing controller → QuickReplyPostbackRouterService.route(roomId, payload)
  → payload.startsWith('TEMPLATE:') ?
      CannedResponseSenderService.send(roomId, templateId, null) [staffId=null → getSystemUserId()]
    : { handled: false } → fall through to existing action switch
```

Three injection points (all in intentionally-public webhook controllers):
1. `FacebookWebhookController` — `ChatAdaptersModule` imports `forwardRef(StaffChatModule)`
2. `ChatbotFinanceService` — `ChatbotFinanceModule` imports `forwardRef(StaffChatModule)` (existing)
3. `LineOaChatbotController` — `LineOaModule` imports `forwardRef(StaffChatModule)`

---

## Critical Issues

None found.

- **Public controllers** (`FacebookWebhookController`, `LineOaChatbotController`, `ChatbotFinanceService` webhook handlers) are intentionally public — they are webhook receivers verified by LINE signature / FB HMAC, not by JWT. All are in the intentionally-public list or are existing public patterns.
- **No `@UseGuards` needed** on new `QuickReplyPostbackRouterService` (it's a service, not a controller).
- **No `Number()` on money fields** — no financial calculations.
- **No hardcoded secrets**.
- **No SQL injection** — only parameterized Prisma queries.

---

## Warnings (Fix Before Merge)

### W1 — `chatRoom.findUnique` missing `deletedAt: null` (2 locations) ⚠️

**File**: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts`
**File**: `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts`

Both use `prisma.chatRoom.findUnique({ where: { lineUserId_channel: { ... } } })` without filtering `deletedAt: null`. While the `@@unique([lineUserId, channel])` constraint makes it practically impossible to have two active rooms for the same user+channel, a soft-deleted room would still be returned by `findUnique`.

The Facebook counterpart correctly uses `findFirst` with `deletedAt: null`:
```ts
// ✓ facebook-webhook.controller.ts — correct
const room = await this.prisma.chatRoom.findFirst({
  where: { externalUserId: senderId, channel: ChatChannel.FACEBOOK, deletedAt: null },
  orderBy: { lastMessageAt: 'desc' },
  select: { id: true },
});
```

**Fix**: Change `findUnique` → `findFirst` and add `deletedAt: null` in both LINE locations:
```ts
const room = await this.prisma.chatRoom.findFirst({
  where: {
    lineUserId: userId,
    channel: ChatChannel.LINE_FINANCE, // or LINE_SHOP
    deletedAt: null,
  },
  orderBy: { lastMessageAt: 'desc' },
  select: { id: true },
});
```
This also makes the LINE path consistent with the FB path (same defensive pattern).

---

### W2 — System user password stored as plaintext ⚠️

**File**: `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts`

`getSystemUserId()` calls `prisma.user.upsert` directly with:
```ts
password: 'NEVER_LOGIN_SYSTEM_USER',
```

This bypasses the bcrypt hashing done in `users.service.ts` (`bcrypt.hash(dto.password, 10)`). The `isActive: false` flag prevents login, and `bcrypt.compare()` would return false for any input against a plaintext stored value — so the user effectively cannot authenticate. However:
- The plaintext string is readable in the database if compromised.
- Inconsistency with all other users whose passwords are bcrypt-hashed at cost 10.

**Fix**: Hash the placeholder at bootstrap time:
```ts
import * as bcrypt from 'bcrypt';
// ...
const SYSTEM_USER_PW_HASH = bcrypt.hashSync('!system-bot-no-login!', 10);
// then in upsert:
password: SYSTEM_USER_PW_HASH,
```
Or simpler — use a random UUID that is discarded (equally unusable, avoids the recognizable string):
```ts
password: await bcrypt.hash(randomUUID(), 10),
```
Since `update: {}` is a no-op, the first `create` call sets the hash once and subsequent upserts leave it unchanged.

---

### W3 — Native `<select>` instead of shadcn/ui `Select` ⚠️

**File**: `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx`

The POSTBACK template picker uses a native HTML `<select>`:
```tsx
<select
  value={parseTemplatePostback(qr.payload) ?? ''}
  onChange={(e) => onChange({ payload: `${POSTBACK_TEMPLATE_PREFIX}${e.target.value}` })}
  className="text-xs border border-border rounded px-2 py-1 bg-background flex-1"
>
```

The project rule (`frontend.md`) requires shadcn/ui components. Native `<select>` styling is inconsistent across OSes and doesn't match the design system (no Radix Select dropdown animation, no custom option rendering).

**Fix**: Replace with shadcn/ui `Select` + `SelectContent` / `SelectItem`. This also enables `<optgroup>` equivalent via `SelectGroup` + `SelectLabel`.

---

## Info

| # | Finding |
|---|---------|
| I1 | `QuickReplyPostbackRouterService` uses an in-memory `Map<string, number[]>` for the W7 loop guard. Resets on process restart — acceptable for defensive rate limiting, but in a multi-instance Cloud Run deployment, the per-room counter is not shared across instances. This is noted in the code comments and is intentional. |
| I2 | `forwardRef(() => StaffChatModule)` added to 3 modules to break circular dependency. This is the standard NestJS pattern for circular deps and is safe. |
| I3 | `CannedResponseSenderService.send()` signature changed from `staffId: string` to `staffId: string | null`. No other callers outside this branch; existing test is updated. |
| I4 | The `handlePostback` method in `line-oa-chatbot.controller.ts` calls `findUnique` with `lineUserId: userId` where `userId = event.source.userId`. LINE postback events always provide `userId` for user-type sources, but the TypeScript type is `string | undefined`. No explicit guard before `findUnique`. Should add `if (!userId) return;` guard for type safety (low runtime risk since LINE guarantees userId on postbacks). |

---

## Issue Scan — Pattern Checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard)` on new controllers | N/A — only webhook controllers (intentionally public) |
| `@Roles()` on new controller methods | N/A |
| `Number()` on Decimal fields | None found |
| `deletedAt: null` on new queries | ❌ Missing in 2 `findUnique` calls (W1) |
| Raw `fetch()` in React | ✓ Uses `api.get()`/`api.post()` |
| `queryClient.invalidateQueries()` after mutations | ✓ Present |
| Hardcoded hex/gray-* colors | ✓ Clean (design tokens used) |
| `any` type usage | None in new code |
| Hardcoded secrets | None |
| SQL injection (`$queryRaw`) | None |

---

## Test Coverage

New tests added:
- `quick-reply-postback-router.service.spec.ts` — 165 lines, 11 test cases covering TEMPLATE routing, rate-limiting, error handling, `handled: false` fallthrough.
- `canned-response-sender.service.spec.ts` additions — 4 tests for `getSystemUserId()` (race-safe upsert, correct role/flags, real-staff bypass).
- `facebook-webhook.controller.spec.ts` — updated existing 3 test modules with postbackRouter + prisma stubs.
- `chatbot-finance.service.spec.ts` — updated DI with chatRoom + postbackRouter stubs.

---

## Recommendation

**REVIEW** — three warnings should be addressed before merging:

1. **W1** (missing `deletedAt: null`) — straightforward 2-line fix: `findUnique` → `findFirst` + add `deletedAt: null` in LINE channel handlers.
2. **W2** (plaintext system password) — one-line fix: hash with `bcrypt.hashSync` or random UUID.
3. **W3** (native `<select>`) — medium effort: replace with shadcn/ui `Select` component.

W1 and W2 are the higher-priority fixes. W3 is a design-system consistency issue and can be addressed in a follow-up if timeline is tight.
