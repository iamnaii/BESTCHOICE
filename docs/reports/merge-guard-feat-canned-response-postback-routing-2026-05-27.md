# Merge Guard Report — `feat/canned-response-postback-routing`

**Date**: 2026-05-27  
**Branch**: `feat/canned-response-postback-routing`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Latest commit**: `57b23560` — fix(canned-response): Phase 5 — review issues C1/C2/W4/W5/W6/W7

---

## File Changes Summary

| File | Type | Change |
|------|------|--------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | Modified | +7 / -1 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | Modified | +22 / -0 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | Modified | +45 / -2 |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | Modified | +15 / -0 |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | Modified | +42 / -1 |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | Modified | +34 / -2 |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | Modified | +7 / -1 |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | Modified | +100 / -0 |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts` | Modified | +38 / -2 |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | **New** | +165 |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | **New** | +156 |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | Modified | +2 / -2 |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | Modified | +1 / -0 |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | Modified | +82 / -8 |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | Modified | +4 / -2 |

**Scope**: Backend services + webhook controllers + frontend editor. Phase 5 "Quick Reply postback routing" — canned-response POSTBACK buttons send a template as bot reply when customer taps them.

---

## Issue Analysis

### 🔴 Critical — None found

Checked for:
- ✅ **Controller guards**: The three modified controllers (`facebook-webhook.controller.ts`, `line-oa-chatbot.controller.ts`, `chatbot-finance.service.ts`) are all in the intentionally-public list (`paysolutions`, `sms-webhook`, `chatbot-finance-liff`) — no missing `@UseGuards` required.
- ✅ **New service** (`QuickReplyPostbackRouterService`) is a service provider, not a controller — no guard decorator needed.
- ✅ **No `Number()` on money/financial fields** — no financial data touched.
- ✅ **No hardcoded secrets or API keys** — `'NEVER_LOGIN_SYSTEM_USER'` is an intentionally-unusable placeholder password, matching the existing seed pattern (`'__NO_LOGIN__'` in `collections-foundation.seed.ts`). The system user has `isActive: false` and `bcrypt.compare()` on a non-bcrypt string returns `false`.
- ✅ **No unparameterized `$queryRaw`**.

### 🟡 Warning — 2 found

**W-1**: Missing `deletedAt: null` on `chatRoom.findUnique` — 2 locations  

The two LINE-channel postback handlers perform a `findUnique` using the `@@unique([lineUserId, channel])` composite key without filtering soft-deleted rooms:

```ts
// chatbot-finance.service.ts (LINE_FINANCE)
const room = await this.prisma.chatRoom.findUnique({
  where: {
    lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE },
  },
  select: { id: true },
  // ⚠️ Missing: NOT guarded against deletedAt ≠ null
});

// line-oa-chatbot.controller.ts (LINE_SHOP)
const room = await this.prisma.chatRoom.findUnique({
  where: {
    lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_SHOP },
  },
  select: { id: true },
  // ⚠️ Missing: NOT guarded against deletedAt ≠ null
});
```

**Impact**: The `@@unique([lineUserId, channel])` constraint means at most one row can exist per `(lineUserId, channel)` pair — so a soft-deleted room blocks creation of a new room for the same user-channel. In practice this means the only way a deleted room could be returned here is if the room was soft-deleted and a fresh room has not yet been recreated. The downstream `CannedResponseSenderService.send()` already does `where: { id: roomId, deletedAt: null }` and would throw a `NotFoundException`, so no incorrect data is sent. However it violates the project-wide soft-delete convention and could cause confusing error logs.

Note: the Facebook path correctly uses `findFirst` with `deletedAt: null` ✓ — the LINE paths should match.

**Suggested fix**:
```ts
// Both LINE handlers — add deletedAt filter:
const room = await this.prisma.chatRoom.findFirst({
  where: {
    lineUserId: userId,
    channel: ChatChannel.LINE_FINANCE, // or LINE_SHOP
    deletedAt: null,
  },
  select: { id: true },
});
```
Switch from `findUnique` (which cannot accept additional `where` clauses beyond the unique key) to `findFirst` with an explicit `deletedAt: null` guard — consistent with the FB path.

---

**W-2**: Native `<select>` element used instead of shadcn `Select` component  

File: `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx:75`

```tsx
<select
  value={parseTemplatePostback(qr.payload) ?? ''}
  onChange={(e) => { ... }}
  className="text-xs border border-border rounded px-2 py-1 bg-background flex-1"
>
```

The project's frontend rules mandate shadcn/ui + Radix UI primitives (no native form elements that have a styled alternative). The native `<select>` will break dark-mode styling on some OS/browser combinations and doesn't match the visual consistency of other dropdowns in the admin UI.

**Suggested fix**: Replace with shadcn `Select` + `SelectTrigger` + `SelectContent` + `SelectItem` (see `/components/ui/select.tsx`).

---

### 🔵 Info

**I-1**: In-memory rate limiter (`W7 loop guard`) in `QuickReplyPostbackRouterService`  
- 5 sends / 10 s sliding window per room is a reasonable defensive cap. Resets on app restart — documented and intentional. No issue.

**I-2**: `forwardRef` circular imports — 3 module-level `forwardRef(() => StaffChatModule)` additions  
- Correctly placed at the module level in `chat-adapters.module.ts`, `line-oa.module.ts`, and the existing `chatbot-finance.module.ts`. No constructor-level `@Inject(forwardRef(...))` needed (consistent with W4 comment in the service). No issue.

**I-3**: System user role discrepancy between new code (`SALES`) and existing seed (`OWNER`)  
- `canned-response-sender.service.ts` creates system user with `role: 'SALES'` but `collections-foundation.seed.ts` creates it with `role: 'OWNER'`. The `update: {}` no-op means the first one to run wins. On a clean DB the cron/seed order determines the role; on prod the seed ran first so the system user stays `OWNER`.  
- Not a merge blocker since `isActive: false` and `isSystemUser: true` already exclude this account from normal role-based flows. Worth aligning the roles across both upsert sites in a follow-up.

**I-4**: `staff-chat.module.ts` providers line is now 240+ chars  
- Single-line providers array is approaching maintenance boundary. Not a blocker, but grouping into a `const PROVIDERS = [...]` array would improve readability for a file this size.

**I-5**: Test coverage is thorough  
- `quick-reply-postback-router.service.spec.ts` covers: handled/unhandled payloads, sender errors, rate limit per-room, rate limit window expiry (fake timers), non-TEMPLATE payloads not counting toward rate limit (8 cases).  
- `canned-response-sender.service.spec.ts` covers: concurrent `null` staffId (upsert atomicity), upsert args, SALES role guard, staffId provided path (4 new cases).

---

## Summary Table

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 0 | — |
| 🟡 Warning | 2 | W-1: missing `deletedAt` on 2 `findUnique` calls; W-2: native `<select>` |
| 🔵 Info | 5 | Non-blocking observations |

---

## Recommendation

> **🔍 REVIEW — Fix 2 warnings before merge**

The core logic is sound (rate limiter, circular-module pattern, system-user upsert atomicity, test coverage). Two warnings should be fixed before merge:

1. **W-1 (higher priority)**: Add `deletedAt: null` filter (switch to `findFirst`) in the LINE_FINANCE and LINE_SHOP chatroom lookups — brings them in line with the FB path in the same PR and the project-wide soft-delete convention.
2. **W-2**: Replace native `<select>` with shadcn `Select` component in `QuickReplyEditor.tsx`.

Neither is a security issue, but W-1 violates an explicit project rule and W-2 breaks UI consistency. Both are small, targeted fixes.
