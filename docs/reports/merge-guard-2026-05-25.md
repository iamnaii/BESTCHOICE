# Pre-Merge Guard Report — 2026-05-25

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-05-25  
**Branches reviewed**: 3 (top 3 most recently updated non-guard branches)

---

## Branch 1: `feat/canned-response-channel-tabs`

**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Files changed**: 5 files changed, 277 insertions(+), 20 deletions(-)

### Files
| File | Change |
|------|--------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | Modified — channel filtering, count badges, reorder abstraction |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | New — channel tab UI component |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | Modified — wires ChannelTabs into editor |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | New — pure reorder helper extracted from BubbleList |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | New — 7 unit tests for reorder logic |

### Issues

**Critical**: None.

**Warning**: None.

**Info**:
- `onCountsChange` in `BubbleList.tsx`'s `useEffect` dependency array — if the parent passes an inline function reference (which `TemplateEditorPane` currently does via `setBubbleCounts`), the effect will re-run on every parent render. In practice `setBubbleCounts` is stable (React state setter), so no actual problem, but worth noting for future contributors. No change required.

### Checklist
- [x] No raw `fetch()` — uses `api.get()`/`api.post()`
- [x] Uses `useQuery`/`useMutation` for data fetching
- [x] `queryClient.invalidateQueries()` present after mutations
- [x] Uses design tokens only (no hardcoded hex/gray colors)
- [x] Thai UI text throughout
- [x] Lazy-loaded via `React.lazy()` (no new page — existing page, not applicable)
- [x] No money/financial fields (frontend-only feature, no Decimal concern)
- [x] Unit tests included for extracted logic

### Recommendation: ✅ APPROVE

---

## Branch 2: `feat/canned-response-postback-routing`

**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Files changed**: 15 files changed, 701 insertions(+), 22 deletions(-)

### Files
| File | Change |
|------|--------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | Modified — adds `StaffChatModule` via `forwardRef` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | **Modified — adds direct PrismaService injection** |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | Modified — adds mock providers for new deps |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | Modified — adds postback router hook |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | Modified — adds mock providers |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | **Modified — adds new direct Prisma call** |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | Modified — adds `StaffChatModule` via `forwardRef` |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts` | Modified — `staffId: string | null`, adds `getSystemUserId()` |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | Modified — system user bootstrap tests |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | New — Phase 5 postback router service |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | New — 10 unit tests incl. rate-limit window |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | Modified — registers + exports `QuickReplyPostbackRouterService` |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | Modified — passes `allTemplates` to editor pane |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | Modified — POSTBACK template picker UI |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | Modified — forwards `allTemplates` prop |

### Issues

#### 🔴 Critical (1)

**C1 — Direct PrismaService call in `FacebookWebhookController`**  
File: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts`

This PR injects `PrismaService` directly into `FacebookWebhookController` (constructor line ~128 in the diff) and calls `this.prisma.chatRoom.findFirst(...)` directly from the controller body. This violates the backend rule:

> **ห้ามเรียก PrismaService จาก controller โดยตรง — ต้องผ่าน service เสมอ**

The DB lookup (find chatRoom by `externalUserId + channel`) should be moved into `QuickReplyPostbackRouterService`. The controller should call only `postbackRouter.route(externalUserId, ChatChannel.FACEBOOK, payload)` and the router service resolves the roomId internally.

The same pattern is repeated in `LineOaChatbotController` (a `this.prisma.chatRoom.findUnique(...)` call was added) — technically `LineOaChatbotController` already had `PrismaService` injected, but this PR adds a new DB call that belongs in the service layer.

**Fix**: Move the `chatRoom.findFirst/findUnique` lookups into `QuickReplyPostbackRouterService.route()`, changing the signature to `route(externalUserId: string, channel: ChatChannel, payload: string)` (or an overload that accepts `roomId` directly when already known). Controllers then call `postbackRouter.route(senderId, ChatChannel.FACEBOOK, payload)`.

#### ⚠️ Warning (0)

None.

#### ℹ️ Info (2)

**I1 — In-memory rate limiter resets on restart**  
`QuickReplyPostbackRouterService.recentSends` is an in-process `Map`. This is explicitly documented in the service comment ("Reset on app restart is acceptable for a defensive guard") and is appropriate for a postback loop guard. No action required; noted for future horizontal scaling consideration.

**I2 — System user password placeholder**  
`canned-response-sender.service.ts` creates a system bot user with `password: 'NEVER_LOGIN_SYSTEM_USER'`. This is functionally correct (`isActive: false` prevents login), but a bcrypt hash of a random string would be more conventional. Low priority.

### Checklist
- [x] No missing `@UseGuards` — webhook controllers are in the intentionally-public allowlist
- [x] No missing `@Roles()` — same public-webhook exemption
- [x] No `Number()` on money fields
- [x] `deletedAt: null` present in new Prisma queries
- [x] No hardcoded secrets
- [ ] ❌ **Direct PrismaService call in controller** (`FacebookWebhookController`, `LineOaChatbotController` new call) — see C1
- [x] DTO validation — no new DTOs added
- [x] No raw `fetch()` on frontend
- [x] 10 new unit tests for `QuickReplyPostbackRouterService`
- [x] 4 new unit tests for system user bootstrap in `CannedResponseSenderService`

### Recommendation: 🟡 REVIEW — fix C1 before merge

The feature logic is sound (postback routing, loop guard, system user upsert idempotency, forwardRef circular import resolution). One architectural fix needed: DB lookups in controllers must move to the service layer.

---

## Branch 3: `feat/data-deletion-page`

**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Files changed**: 2 files changed, 125 insertions(+)

### Files
| File | Change |
|------|--------|
| `apps/web/src/App.tsx` | Modified — adds `/privacy/data-deletion` public route |
| `apps/web/src/pages/DataDeletionPage.tsx` | New — static PDPA data deletion instructions page |

### Context
Required by Meta (Facebook App) for PDPA/GDPR compliance: a "Data Deletion Instructions URL" must be registered in Facebook App Settings → Basic. The page is intentionally public (no auth required).

### Issues

**Critical**: None.

**Warning**: None.

**Info**:
- The contact email (`akenarin.ak@gmail.com`) and phone (`095-567-8887`) are hardcoded in the page body. This is intentional for PDPA compliance — these must be real, publicly accessible contact points. If contact info changes, this page will need a manual update.
- Date "24 พฤษภาคม 2569" is hardcoded — acceptable for a static compliance page.

### Checklist
- [x] Correctly uses `React.lazy()` + route in `App.tsx`
- [x] No auth guard on this public route (correct — PDPA page must be publicly accessible)
- [x] Uses only design tokens (bg-background, text-foreground, text-muted-foreground, text-primary, border-border)
- [x] No API calls, no data fetching
- [x] Thai + English bilingual (Meta requires English summary for international compliance review)

### Recommendation: ✅ APPROVE

---

## Summary

| Branch | Files | Recommendation |
|--------|-------|----------------|
| `feat/canned-response-channel-tabs` | 5 | ✅ APPROVE |
| `feat/canned-response-postback-routing` | 15 | 🟡 REVIEW (C1: Prisma in controller) |
| `feat/data-deletion-page` | 2 | ✅ APPROVE |
