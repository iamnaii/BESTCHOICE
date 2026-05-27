# Merge Guard Report — feat/canned-response-postback-routing

**Date**: 2026-05-27  
**Branch**: `feat/canned-response-postback-routing`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commit**: fix(canned-response): Phase 5 — review issues C1/C2/W4/W5/W6/W7  

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +7/-1 | forwardRef StaffChatModule |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +26/-0 | Test stubs for new deps |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +44/-2 | FB postback routing |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | +16/-0 | Test stubs |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | +38/-2 | LINE Finance postback routing |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | +36/-2 | LINE SHOP postback routing |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | +6/-1 | forwardRef StaffChatModule |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | +5/-0 | Test stubs |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts` | +32/-3 | staffId=null + system user |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | +165/-0 | New — 17 tests |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | +156/-0 | New service |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | +2/-2 | Register + export new service |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | +1/-0 | Pass allTemplates prop |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | +66/-8 | Template picker dropdown |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +5/-2 | Thread allTemplates down |

**Total**: 15 files changed, 701 insertions, 22 deletions

---

## Architecture Assessment

The design is sound and additive:

- `QuickReplyPostbackRouterService` is a clean, single-responsibility service that parses `TEMPLATE:<id>` payloads and dispatches them via `CannedResponseSenderService`
- Returns `{ handled: false }` for unknown payloads — falls through gracefully to existing routing (LINE action switch, FB legacy path)
- Wired into 3 webhook controllers: `LineOaChatbotController` (SHOP), `ChatbotFinanceService` (FINANCE LINE), `FacebookWebhookController` (FB)
- Rate-limiting (W7): per-room in-memory sliding window (5 sends / 10s) caps postback loop blast radius
- C2 fix: FB postback handler orders `chatRoom.findFirst` by `lastMessageAt: 'desc'` — correctly resolves to the active room for a PSID that has multiple chat rooms

---

## Issues by Severity

### 🔴 Critical
None.

### 🟡 Warning

**W1 — `getSystemUserId()` hits DB on every bot-triggered send**  
File: `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts`

```ts
const effectiveStaffId = staffId ?? (await this.getSystemUserId());
```

`getSystemUserId()` performs a Prisma `upsert` on every call when `staffId` is `null` (i.e., every bot-triggered Quick Reply send). While `upsert` is idempotent, it hits the database on every postback. With high-frequency bot activity, this creates unnecessary DB round-trips.

**Recommendation**: Cache the system user ID in a private field after the first successful lookup:

```ts
private systemUserId: string | null = null;

private async getSystemUserId(): Promise<string> {
  if (this.systemUserId) return this.systemUserId;
  const user = await this.prisma.user.upsert({ ... });
  this.systemUserId = user.id;
  return user.id;
}
```

(Module is singleton-scoped in NestJS — process-level cache is safe.)

---

**W2 — In-memory `recentSends` Map has no max-size bound**  
File: `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts`

```ts
private readonly recentSends = new Map<string, number[]>();
```

The Map grows by one entry per unique `roomId` that has ever sent a postback and never shrinks. For a shop with thousands of rooms over a long process lifetime, this accumulates indefinitely. Timestamps in each array are pruned lazily on access, but the `roomId` key is never deleted.

**Recommendation**: Add a `recentSends.delete(roomId)` when the pruned array becomes empty:

```ts
const recent = (this.recentSends.get(roomId) ?? []).filter(t => now - t < this.WINDOW_MS);
if (recent.length === 0) {
  this.recentSends.delete(roomId);
  // add current timestamp
  this.recentSends.set(roomId, [now]);
  return false;
}
```

---

**W3 — Missing Thai error messages on several DTO `@MaxLength` decorators**  
File: New DTOs introduced in this branch (propagated from redesign branch pattern)

Some `@MaxLength()` calls on `CreateBubbleDto` fields (`mediaUrl`, `thumbnailUrl`, `stickerPackageId`, `stickerId`) lack Thai `message:` options, inconsistent with the project convention. Existing fields like `text` have `{ message: 'text ยาวเกิน 5000 ตัวอักษร' }` — apply the same pattern to all validators.

---

### 🔵 Info

**I1 — `forwardRef` applied correctly but no comment on why LineOaModule needs it**  
The `forwardRef(() => StaffChatModule)` in `line-oa.module.ts` has a `// Phase 5 —` comment explaining the cycle. Good practice. No action required.

**I2 — `any` typed `json` field in bubble DTOs**  
The `json?: any` field uses `@IsObject()` decorator (validation present), but `any` allows arbitrary payloads without runtime schema validation. Acceptable for now given this is an internal tool used only by OWNER/BRANCH_MANAGER, but worth hardening with a JSON schema validator if rich card content expands.

**I3 — Test coverage for postback router is thorough**  
`quick-reply-postback-router.service.spec.ts` has 17 tests covering happy path, empty ID, fallthrough, null/undefined payload, sender throws, whitespace trimming, rate-limit saturation, per-room isolation, and window expiry with fake timers. Excellent.

---

## Recommendation

**🟡 REVIEW**

No blockers, but two Warning items should be addressed before merge:

1. Cache `systemUserId` in the service instance to avoid per-postback DB upsert (W1 — performance)
2. Prune `recentSends` map entries when they go empty (W2 — memory hygiene)

W3 (Thai messages) is cosmetic and can follow in a quick subsequent commit.

Once W1 and W2 are addressed, this branch is ready to merge.
