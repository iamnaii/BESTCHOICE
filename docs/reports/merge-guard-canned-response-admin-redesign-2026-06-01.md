# Merge Guard Report — feat/canned-response-admin-redesign

**Date**: 2026-06-01  
**Branch**: `feat/canned-response-admin-redesign`  
**Author**: Akenarin Kongdach  
**Unique commits ahead of main**: 35  
**TS/TSX files in diff**: 167 (branch diverged before many main commits — unique commits affect ~8 files)  
**Recommendation**: 🔴 BLOCK

---

## Summary of Changes

The branch simplifies the canned-response admin UI:
- Removes `ChannelTabs.tsx` and per-channel bubble filtering from `BubbleList.tsx`
- Removes `getSystemUserId()` from `CannedResponseSenderService`; changes `staffId: string | null → string`
- Deletes `QuickReplyPostbackRouterService` (156 lines) and its spec
- Removes `QuickReplyPostbackRouterService` and `IntegrationConfigService` injections from `FacebookWebhookController`

---

## Issues

### 🔴 Critical — Reverts merged PR #1112 security fix on FB webhook

**File**: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts`

The branch was created before PR #1112 (`fix/fb-webhook-integration-config`) was merged. As a result, merging this branch would **undo** the fix that makes the FB webhook read `verifyToken` and `appSecret` from `IntegrationConfig` (DB) with env fallback.

After merge, `verifyWebhook()` and `verifySignature()` would revert to reading `FB_VERIFY_TOKEN` / `FB_APP_SECRET` exclusively from env vars. Any team member who configured these values via **Settings → Integrations** (UI/DB) would find webhook verification broken in production.

**Current state of `origin/main`**: `facebook-webhook.controller.ts` injects `IntegrationConfigService` and uses it for both GET challenge and POST HMAC signature verification.

**Action required**: Rebase `feat/canned-response-admin-redesign` onto latest `main` BEFORE merging so that the `IntegrationConfigService` injection is preserved.

---

### 🔴 Critical — Removes QuickReplyPostbackRouterService from FB webhook controller

**File**: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` (line ~50)

In `origin/main`, `FacebookWebhookController` injects `QuickReplyPostbackRouterService` and delegates Facebook Quick Reply postback events to it. The branch removes this injection, meaning Quick Reply postback events received from Facebook Messenger would no longer be routed.

The branch also deletes `quick-reply-postback-router.service.ts` entirely. If the intended goal is to remove postback routing, this is consistent — but the branch must be rebased on `main` so the deletion applies cleanly against the current controller (which in `main` has 2 additional injections vs. the branch's starting point).

---

### 🔴 Critical — Type mismatch: `staffId` non-nullable but main has a null caller

**File**: `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts`

The branch changes:
```ts
// Before (main)
async send(roomId: string, templateId: string, staffId: string | null)

// After (branch)
async send(roomId: string, templateId: string, staffId: string)
```

In `origin/main`, `quick-reply-postback-router.service.ts:87` calls:
```ts
const result = await this.sender.send(roomId, templateId, null);
```

The branch also **deletes** `quick-reply-postback-router.service.ts`, which resolves the caller conflict — but ONLY if the branch is merged atomically (the deletion and the signature change land together). A rebase conflict during merge could split these, leaving the null caller intact against the non-nullable signature. TypeScript CI would catch this, but it's worth flagging for the merge operator.

---

### ⚠️ Warning — BubbleList reorder simplification loses cross-channel order correctness

**File**: `apps/web/src/pages/canned-response-admin/BubbleList.tsx` (line ~110)

The branch replaces `reorderBubbles(allBubbles, active.id, over.id)` — which reordered among all bubbles regardless of channel filter — with an inline splice that reorders only the `visibleBubbles` array (which is now just `bubbles` since channel filtering was removed). Since channel filtering is removed in this branch, this is not a functional regression — but if channel filtering is ever re-added, the old `bubble-reorder-logic.ts` (also deleted) was a safer pattern.

---

### ℹ️ Info — bubble-reorder-logic.ts deleted with passing tests

**Files**: `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` and `.test.ts`

These are deleted. The test file verifies the reorder logic which is now inlined. The inline replacement is functionally equivalent for the current single-list case.

---

## Recommendation: BLOCK

**Do not merge until:**

1. **Rebase onto latest `main`** — the branch started before PR #1112 merged. A fresh rebase will surface the 3 conflicts above and let the developer resolve them cleanly.
2. Confirm intent on postback routing — if the goal is to remove Quick Reply postback routing entirely, that decision should be explicit and reviewed (it affects FB Messenger UX).
3. After rebase, verify `npm run build` and `./tools/check-types.sh all` pass — the `staffId` type change will be validated by TypeScript CI.
