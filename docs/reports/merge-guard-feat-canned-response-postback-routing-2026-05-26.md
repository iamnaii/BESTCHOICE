# Pre-Merge Guard Report

**Branch**: `feat/canned-response-postback-routing`  
**Author**: Akenarin Kongdach / iamnaii  
**Date**: 2026-05-26  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +7 / -1 | Add `forwardRef(StaffChatModule)` import |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +22 / 0 | Add postback-router + prisma stubs to existing tests |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +38 / -5 | Inject postback router; route `TEMPLATE:` postbacks |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | +12 / 0 | Add postback-router + chatRoom stubs |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | +36 / -1 | Inject postback router; route LINE_FINANCE postbacks |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | +34 / -4 | Inject postback router; route LINE_SHOP postbacks |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | +6 / 0 | Add `forwardRef(StaffChatModule)` import |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | +99 / 0 | Tests for system-user bootstrap path |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts` | +37 / -3 | `getSystemUserId()` + allow `staffId: null` |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | +99 / 0 | System-user upsert tests (race-safety, SALES role) |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | +165 / 0 | Router unit tests (payload parsing, rate limiting, errors) |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | +156 / 0 | New service — TEMPLATE: payload routing + W7 loop guard |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | +2 / -1 | Register + export `QuickReplyPostbackRouterService` |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | +1 / 0 | Pass `allTemplates` prop to `TemplateEditorPane` |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | +57 / -7 | Template-picker UI for POSTBACK quick replies |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +4 / -2 | Accept + forward `allTemplates` prop |

**Total**: 15 files, ~723 lines added / ~24 deleted.

---

## Issues by Severity

### Critical
_None._

---

### Warning

**W1 — Missing `deletedAt: null` on `chatRoom.findUnique` queries (2 locations)**

`chatbot-finance.service.ts` (~line 399) and `line-oa-chatbot.controller.ts` (~line 535) both call:
```typescript
await this.prisma.chatRoom.findUnique({
  where: { lineUserId_channel: { lineUserId: userId, channel: ... } },
  select: { id: true },
  // ← deletedAt: null missing
});
```
A soft-deleted chat room would still be returned and its id forwarded to the postback router. The router would then call `CannedResponseSenderService.send()`, which internally does `chatRoom.findFirst({ where: { id, deletedAt: null } })` and would return "room not found" — so no double-send. However, dispatching to a deleted room logs a misleading warning and wastes a DB round-trip. Per project database rules, every query must filter `deletedAt: null`.

**Fix**: Add `deletedAt: null` to the outer `where` clause, or use `findFirst` with the filter:
```typescript
const room = await this.prisma.chatRoom.findFirst({
  where: {
    lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE },
    deletedAt: null,
  },
  select: { id: true },
});
```
Note: `findFirst` with a unique-constraint field still hits the index — the filter is safe.

---

**W2 — Plaintext password placeholder inconsistency in `getSystemUserId()`**

`canned-response-sender.service.ts` creates the system bot user with:
```typescript
password: 'NEVER_LOGIN_SYSTEM_USER',
```
The existing `collections-foundation.seed.ts` uses `'__NO_LOGIN__'` for the same account. Since `upsert`'s `update: {}` means the service will never overwrite the seed's password, this only matters on fresh environments (no seed run) where the service wins the race and sets `'NEVER_LOGIN_SYSTEM_USER'`.

Both strings are intentionally non-bcrypt-hashed (isActive=false, no login path reachable). The inconsistency is low-risk but should be harmonised to one convention. Recommend aligning to `'__NO_LOGIN__'` (the existing convention) or using a fixed bcrypt hash of a random non-guessable string.

---

### Info

**I1 — In-memory rate limiter not shared across Cloud Run replicas**

`QuickReplyPostbackRouterService.isRateLimited()` stores per-room dispatch timestamps in a `Map<string, number[]>` on the service instance. Cloud Run can run multiple containers; each has its own map, so the effective per-room limit is `MAX_PER_WINDOW * replica_count`. For a defensive loop guard (W7) this is acceptable, but operators should be aware the limit is per-process rather than global. The code comment says "Reset on app restart is acceptable" — this is accurate for the intended use.

**I2 — `forwardRef()` in 3 module pairs**

`chat-adapters.module.ts`, `line-oa.module.ts`, and `chatbot-finance.module.ts` now all use `forwardRef(() => StaffChatModule)` to break circular dependencies introduced by injecting `QuickReplyPostbackRouterService`. This is the idiomatic NestJS solution and is safe, but adds cognitive load. If the dependency graph keeps growing this way, consider extracting `QuickReplyPostbackRouterService` into a separate lightweight `PostbackRoutingModule` with no upstream dependencies so callers don't need `forwardRef`.

**I3 — Role mismatch between seed and service for system bot user**

`collections-foundation.seed.ts` creates the system user with `role: 'OWNER'`. `getSystemUserId()` creates with `role: 'SALES'`. The `update: {}` no-op means whichever runs first wins. On production the seed runs first (OWNER), so the service never stamps SALES. On a fresh dev environment without the seed, the service creates a SALES user. The code comment acknowledges this, but it means the role is not deterministic across environments.

---

## Code Quality Observations

- `facebook-webhook.controller.ts` — new `chatRoom.findFirst` has `deletedAt: null` ✓ (only the LINE controllers are missing it)
- `QuickReplyPostbackRouterService.route()` wraps all `sender.send()` calls in try/catch and returns `{ handled: true, error: ... }` so failures surface as warnings, not unhandled exceptions ✓
- `CannedResponseSenderService.getSystemUserId()` uses `upsert` (not `findFirst` + `create`) to eliminate the P2002 race window ✓
- New service is properly registered in `StaffChatModule.providers` and exported for cross-module injection ✓
- Tests: 165 lines for `QuickReplyPostbackRouterService` (payload parsing, rate limit, error paths) + 99 lines for system-user bootstrap (race safety, role assertion) ✓
- No `Number()` on financial fields ✓
- No raw `fetch()` in frontend changes ✓
- `api.get()` / `api.post()` patterns consistent ✓

---

## Recommendation

**REVIEW** — Fix W1 (2 missing `deletedAt: null` in `findUnique` calls) before merging. W2 is low-risk but worth harmonising. I1–I3 are informational and do not block.

### Required fixes before merge
1. `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` — add `deletedAt: null` to `chatRoom.findUnique` query inside `handlePostback`.
2. `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` — add `deletedAt: null` to `chatRoom.findUnique` query inside `handlePostback`.
