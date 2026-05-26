# Pre-Merge Guard Report — 2026-05-26 (v5)

**Generated:** 2026-05-26  
**Branches reviewed:** 3  
**Author of all branches:** Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>

---

## Branch 1: `fix/letters-e2e-sales-assertion`

**Latest commit:** `8f3439b6` fix(letters): E2E SALES assertion was matching CANCELLED tab button  
**Date:** 2026-05-26 14:53:37 +0700  
**Diff:** 1 file changed, 8 insertions(+), 4 deletions(-)

### Changes Summary

| File | +/- |
|------|-----|
| `apps/web/e2e/letters-page.spec.ts` | +8 / -4 |

E2E test assertion for the SALES role on `/letters` was testing for absence of a button with text `ยกเลิก` — which also matches the "CANCELLED" status tab label, making the assertion ambiguous and brittle. The fix changes the test to assert on the page heading (`จัดการจดหมาย`) and the URL instead.

### Issues

_None found._

### Recommendation: ✅ APPROVE

Trivial, correct test fix. No production code changed.

---

## Branch 2: `feat/canned-response-channel-tabs`

**Latest commit:** `d7b6c4bf` fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs  
**Date:** 2026-05-25 13:08:03 +0700  
**Diff:** 5 files changed, 277 insertions(+), 20 deletions(-)

### Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +66 / -14 | Channel filter prop, per-tab count reporting |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 / 0 | New component — channel tab nav with badge counts |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 / -1 | Wires ChannelTabs into editor + resets tab on template switch |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 / 0 | Extracted pure reorder function (operates on ALL bubbles, not filtered) |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 / 0 | 7 unit tests covering universal + channel-scoped bubble reorder cases |

### Issues

#### Info — `(r: any)` in queryFn
`BubbleList.tsx` uses `(r: any) => r.data` in the queryFn. This pre-existed in the original code and was not introduced by this branch. No action needed.

### Positive Notes
- Uses `api.get()` / `api.post()` throughout — no raw fetch.
- `queryClient.invalidateQueries()` called correctly after all mutations.
- Semantic design tokens only (`bg-muted`, `text-muted-foreground`, `bg-primary`, `border-border`). No hardcoded hex or `text-gray-*`.
- Thai text uses `leading-snug` consistently.
- `toast.error()` from sonner for errors.
- New logic properly extracted to a unit-tested pure function (`reorderBubbles`).
- Drag-and-drop reorder correctly operates on `allBubbles` (not the filtered subset), preserving cross-channel sort order — the logic is sound and verified by tests.
- The 5-bubble cap correctly counts all bubbles across channels (not just visible).

### Recommendation: ✅ APPROVE

Clean frontend feature. All conventions followed. Well-tested extraction of the reorder logic.

---

## Branch 3: `feat/canned-response-postback-routing`

**Latest commit:** `57b23560` fix(canned-response): Phase 5 — review issues C1/C2/W4/W5/W6/W7  
**Date:** 2026-05-25 13:02:38 +0700  
**Diff:** 15 files changed, 701 insertions(+), 22 deletions(-)

### Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +8 / -1 | Import StaffChatModule via forwardRef |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +22 / 0 | Update test stubs for new injections |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +43 / -1 | Wire postback router for TEMPLATE: payloads |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | +12 / 0 | Update test stubs |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | +40 / -1 | Wire postback router for LINE_FINANCE channel |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | +38 / -5 | Wire postback router for LINE_SHOP channel |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | +6 / 0 | Import StaffChatModule via forwardRef |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | +5 / 0 | Add missing `user` mock stubs |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | +165 / 0 | New service test file |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | +156 / 0 | New service — routes TEMPLATE: postback payloads |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | +2 / -2 | Register + export QuickReplyPostbackRouterService |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | +1 / 0 | Pass allTemplates to TemplateEditorPane |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | +74 / -9 | Template picker dropdown for POSTBACK Quick Replies |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +6 / -2 | Pass allTemplates prop to QuickReplyEditor |

### Issues

#### Warning — Missing `deletedAt: null` in two `findUnique` calls

**File:** `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts`
```ts
const room = await this.prisma.chatRoom.findUnique({
  where: {
    lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE },
  },
  select: { id: true },
});
```

**File:** `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts`
```ts
const room = await this.prisma.chatRoom.findUnique({
  where: {
    lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_SHOP },
  },
  select: { id: true },
});
```

Per database rules, all queries must include `where: { deletedAt: null }`. While `lineUserId_channel` is a DB-level unique constraint (so only one row per user+channel exists), a soft-deleted room can still be returned by these queries — causing `postbackRouter.route()` to dispatch messages into a deleted room. The Facebook path in the same branch correctly uses `findFirst` with `deletedAt: null`, confirming the fix is known. Recommend adding `deletedAt: null` to both `findUnique` calls (note: `findFirst` is required to add extra filter conditions beyond the unique key).

**Suggested fix for both:**
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

#### Info — In-memory rate-limiter resets on app restart

`QuickReplyPostbackRouterService.recentSends` is a plain `Map<string, number[]>`. The per-room sliding window resets on every process restart and is not shared across pods in a multi-replica deployment. The code comments acknowledge this as acceptable for a defensive guard. No action required unless the service scales to multiple instances — in that case, consider Redis-backed rate limiting. Low risk for current single-instance setup.

#### Info — `onCountsChange` in useEffect dependency array

`BubbleList.tsx` lists `onCountsChange` as a `useEffect` dependency. If the parent renders a new function reference on each render, this triggers unnecessary recalculations. The parent (`TemplateEditorPane`) should memoize the callback with `useCallback`. This is a pre-existing pattern (not introduced in this branch) and the effect has no side effects beyond calling a prop, so it's not a bug — just a minor perf note.

### Positive Notes
- No hardcoded secrets or API keys.
- No `Number()` on financial fields.
- `forwardRef()` used correctly to break circular module dependencies.
- All three postback hook points (LINE_FINANCE, LINE_SHOP, FACEBOOK) wrap in try/catch and fall through to the existing action handler on failure — no regression risk.
- W7 loop guard (in-memory sliding window) is a good defense-in-depth measure.
- TIKTOK/WEB graceful degradation is correctly documented in code.
- New service has 165-line test file covering all route branches.
- Self-reference prevention in template picker (`t.id !== selfId`) avoids A→A loops.

### Recommendation: ⚠️ REVIEW

**Block on Warning:** Fix the two `findUnique` calls in `chatbot-finance.service.ts` and `line-oa-chatbot.controller.ts` to use `findFirst` with `deletedAt: null`. Everything else is clean.

---

## Summary

| Branch | Files | Critical | Warning | Info | Decision |
|--------|-------|----------|---------|------|----------|
| `fix/letters-e2e-sales-assertion` | 1 | 0 | 0 | 0 | ✅ APPROVE |
| `feat/canned-response-channel-tabs` | 5 | 0 | 0 | 1 | ✅ APPROVE |
| `feat/canned-response-postback-routing` | 15 | 0 | 1 | 2 | ⚠️ REVIEW |

**Action required before merging `feat/canned-response-postback-routing`:** Add `deletedAt: null` to the two `chatRoom.findUnique` calls in `chatbot-finance.service.ts` and `line-oa-chatbot.controller.ts`.
