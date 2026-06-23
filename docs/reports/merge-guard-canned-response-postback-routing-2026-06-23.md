# Merge Guard Report — feat/canned-response-postback-routing

**Date**: 2026-06-23  
**Branch**: `feat/canned-response-postback-routing`  
**Author**: Akenarin Kongdach  
**Base commit**: `b8e00b0d` (feat: Message Template Picker + Admin Redesign)  
**Unique commits**: 3

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | **New** — routes TEMPLATE:<id> postback payloads |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | **New** — unit tests |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts` | Modified — adds `getSystemUserId()` for bot-initiated sends |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | Modified — tests for system user path |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | Modified — wires postback router before action switch |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | Modified — wires postback router + adds PrismaService |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | Modified — wires postback router for LINE_FINANCE |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | Modified — exports QuickReplyPostbackRouterService |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | Modified — imports StaffChatModule |
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | Modified — imports StaffChatModule |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | Modified — passes `allTemplates` prop |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | Modified — adds postback type option + payload field |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | Modified — minor adjustment |

---

## Critical Issues

None.

---

## Warnings

### W-1: `PrismaService` injected directly into `FacebookWebhookController`
**File**: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts`  
**Line**: ~48 (constructor), ~199 (`this.prisma.chatRoom.findFirst(...)`)

Backend rules state: _"ห้ามเรียก PrismaService จาก controller โดยตรง — ต้องผ่าน service เสมอ"_.

`FacebookWebhookController` previously had zero direct Prisma access. This PR adds `PrismaService` to the constructor and calls `this.prisma.chatRoom.findFirst()` inline. This should move into a service method (e.g. `ChatRoomService.findByExternalUser(senderId, ChatChannel.FACEBOOK)`).

**Context**: `LineOaChatbotController` already had 8 pre-existing `this.prisma.*` calls before this branch, so there is a pre-existing violation in the LINE controller. That violation should not be used as justification for adding a new one in Facebook. Fix the new instance; the pre-existing ones are tracked debt.

**Mitigation**: The query is simple and correct (`deletedAt: null` filter present, `orderBy: lastMessageAt desc` for correct room resolution). Risk is low.

**Recommendation**: Move the room lookup into `ChatRoomService` or the existing `QuickReplyPostbackRouterService`. The router service could accept `(externalUserId, channel)` instead of `roomId` to avoid the controller needing prisma access.

---

### W-2: Hardcoded placeholder password in `CannedResponseSenderService`
**File**: `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts`  
**Code**: `password: 'NEVER_LOGIN_SYSTEM_USER'`

This is a system-user bootstrap, not a real credential. The user is `isActive: false, isSystemUser: true`. However, a hardcoded string in a `create` call will be flagged by static secret scanners. 

**Recommendation**: Replace with `crypto.randomBytes(32).toString('hex')` or pull from an environment variable `SYSTEM_BOT_SEED_PASSWORD` so the seed is deterministic in dev but random in prod. The `upsert` `update: {}` means this only runs once on first-ever deploy, so it won't override an existing value.

---

## Info

### I-1: In-memory rate limiter for loop guard (W7)
`QuickReplyPostbackRouterService` uses an in-memory `Map<roomId, number[]>` for the loop guard. This resets on app restart and is NOT distributed across Cloud Run instances. Under auto-scaling with ≥2 instances, the 5-sends-per-10s limit applies per-instance, not per-room globally. Documented in the service as "acceptable for a defensive guard" — this is a reasonable trade-off for a soft rate limit, but worth noting for future scale.

### I-2: Correct fallthrough design
The router correctly returns `{ handled: false }` for any non-`TEMPLATE:` payload, preserving the existing action switch (`check_balance`, `check_installments`, `pay`) without change. The try/catch fallthrough in both LINE and Facebook controllers means a router failure never breaks the existing functionality. Pattern is sound.

### I-3: `any` response type in QuickReplyEditor
`api.get(...).then((r: any) => r.data)` — consistent with existing codebase conventions.

### I-4: Public controllers correctly documented
- `line-oa-chatbot.controller.ts` — intentionally public (LINE webhook, uses `LineWebhookGuard`) ✓
- `facebook-webhook.controller.ts` — intentionally public (documented at line 40) ✓  
- Neither is in the "must have JwtAuthGuard" category per `security.md`

---

## Quality Observations

- **Guards**: Both webhook controllers are intentionally public and documented as such ✓
- **Rate limiting**: In-memory loop guard (W7) is proportionate to the risk ✓
- **Audit trail**: No new audit log actions needed for postback routing (it uses CannedResponseSenderService which already has send tracking) ✓
- **Frontend**: `QuickReplyEditor` uses `useQuery`/`useMutation` with correct `invalidateQueries` on all mutations ✓
- **Soft delete**: `chatRoom.findFirst({ deletedAt: null })` — correct filter applied ✓
- **Money fields**: No financial calculations in this PR ✓

---

## Recommendation

**REVIEW** — Address W-1 (move room lookup to service) and W-2 (unhardcode placeholder password) before merge. These are low-risk warnings but W-1 adds a new Prisma-in-controller pattern that should not become precedent. W-2 may trip secret scanners in CI.
