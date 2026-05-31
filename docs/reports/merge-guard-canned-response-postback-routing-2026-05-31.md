# Merge Guard Report — feat/canned-response-postback-routing

**Date:** 2026-05-31  
**Branch:** `feat/canned-response-postback-routing`  
**Last commit:** 2026-05-25 — `fix(canned-response): Phase 5 — review issues C1/C2/W4/W5/W6/W7`  
**Recommendation:** ⚠️ **REVIEW** — 2 Warning-level issues before merge

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +7/−1 — adds `forwardRef(() => StaffChatModule)` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +43/−3 — TEMPLATE postback routing + chatRoom lookup |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +8 lines — provider mocks for new deps |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | +38/−2 — TEMPLATE routing for LINE_FINANCE postbacks |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | +13 lines — mocks |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | +38/−2 — TEMPLATE routing for LINE_SHOP postbacks |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | +6/−1 — adds `forwardRef(() => StaffChatModule)` |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | New — 156 lines, rate-limited dispatch |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | New — 165 lines, thorough test suite |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | +103 lines — extended tests |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | +2 lines — registers and exports new service |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | +1 line — passes `allTemplates` prop |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | +74/−8 — POSTBACK template picker UI |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +6/−1 — wires `allTemplates` |

---

## Issue Analysis

### Critical (must fix before merge)
None found.

---

### Warning (should fix)

**W1 — `findUnique` without `deletedAt: null` in two new LINE chatRoom lookups**

Applies to:
- `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` (new code, line ~400)
- `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` (new code, line ~533)

Both use:
```ts
const room = await this.prisma.chatRoom.findUnique({
  where: { lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE } },
  select: { id: true },
});
```

`ChatRoom` has a `deletedAt DateTime?` field. A soft-deleted room still satisfies the composite unique key `lineUserId_channel`. This means a postback from a customer whose current room was soft-deleted will route canned-response sends into that defunct room.

**Fix:** Use `findFirst` instead of `findUnique` so `deletedAt: null` can be included:
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

Note: The Facebook path in `facebook-webhook.controller.ts` already does this correctly with `findFirst + deletedAt: null + orderBy lastMessageAt desc` — the LINE paths should match that pattern.

---

**W2 — `QuickReplyEditor.tsx` template picker uses native `<select>` instead of shadcn/ui `<Select>`**

File: `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx`

```tsx
<select
  value={...}
  onChange={...}
  className="text-xs border border-border rounded px-2 py-1 bg-background flex-1"
>
```

Per frontend rules, UI components should use shadcn/ui + Radix UI primitives. A native `<select>` doesn't inherit theme tokens reliably across browsers (border-radius, focus ring, dark mode). Use `<Select>` / `<SelectTrigger>` / `<SelectContent>` from `@/components/ui/select` instead.

---

### Info

- **`(r: any)` / `(e: any)`** in `QuickReplyEditor.tsx`: Pre-existing pattern across the codebase — not introduced here.
- **`QuickReplyPostbackRouterService.recentSends`** is in-memory — correctly documented as reset-on-restart, which is acceptable for a rate-limiting guard. No persistence needed.
- **Loop guard W7** (rate limit: 5 dispatches per 10 s per room): Well-designed and fully unit-tested with fake timers.

---

## Positive Highlights

- `facebook-webhook.controller.ts` new chatRoom query correctly includes `deletedAt: null` and `orderBy: { lastMessageAt: 'desc' }` (C2 fix for re-engagement scenario) ✅
- `forwardRef()` used correctly at module level to break circular imports — constructor-level `@Inject(forwardRef(...))` correctly omitted (comment explains why) ✅
- All new postback paths wrapped in `try/catch` with fall-through to existing routing — additive, non-breaking ✅
- `QuickReplyPostbackRouterService` returns `{ handled: false }` for unrecognized payloads, preserving all existing LINE menu / intent-matcher flows ✅
- 165-line test suite for the new router service: handles unknown payloads, rate limiting per-room, window expiry, non-TEMPLATE payloads not counted against limit ✅
- Self-reference guard in template picker (`t.id !== selfId`) prevents A→A postback loops from the UI ✅

---

## Verdict

Solid implementation of postback routing with proper rate limiting and fallthrough behavior. Two issues need attention before merge: W1 (missing soft-delete guard on LINE chatRoom lookups) is the more important one. W2 (native select vs. shadcn) is a polish issue but consistent with the codebase's UI standards.
