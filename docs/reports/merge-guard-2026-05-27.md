# Merge Guard Report — 2026-05-27

**Agent**: Pre-Merge Guard  
**Reviewed at**: 2026-05-27 (Asia/Bangkok)  
**Branches reviewed**: 3 most-recently-updated unmerged branches (feat + fix)

---

## Summary

| Branch | Files Changed | Recommendation | Needs Rebase |
|--------|--------------|----------------|--------------|
| `fix/letters-e2e-sales-assertion` | 1 | ✅ APPROVE | Yes (11 commits behind main) |
| `feat/canned-response-channel-tabs` | 5 | ✅ APPROVE | Yes (16 commits behind main) |
| `feat/canned-response-postback-routing` | 15 | 🔶 REVIEW | Yes (16 commits behind main) |

---

## Branch 1 — `fix/letters-e2e-sales-assertion`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-26 14:53:37 +0700  
**Branched from**: `3672bc39` (2026-05-26 14:35 — `/letters` menu entry for SALES/ACCOUNTANT)  
**Main is ahead by**: 11 commits

### Change Summary

```
apps/web/e2e/letters-page.spec.ts  |  1 file, 8 ins, 4 del
```

Single E2E test fix. The old test asserted:
```ts
await expect(page.getByRole('button', { name: 'ยกเลิก', exact: true })).toHaveCount(0);
```
This was brittle — the "CANCELLED" status tab also renders a button/tab element with text "ยกเลิก", causing the assertion to match unintended elements. The fix replaces it with:
```ts
await expect(page.getByRole('heading', { name: 'จัดการจดหมาย' })).toBeVisible();
expect(page.url()).toContain('/letters');
```
The comment correctly notes that backend `@Roles` enforcement + `LetterTable` unit tests already cover the cancel-button visibility for SALES role.

### Issues Found

None.

### Recommendation: ✅ APPROVE

Code quality is excellent — the test rename and assertion swap are appropriate. The test now reliably covers what it claims: that SALES can reach `/letters` without a redirect.

**Action required before merge**: Rebase onto `origin/main` to incorporate the 11 subsequent letters-page commits. No conflicts expected (this branch only touches `letters-page.spec.ts`).

---

## Branch 2 — `feat/canned-response-channel-tabs`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-25 13:08:03 +0700  
**Branched from**: `b8e00b0d` (2026-05-25 10:18 — Message Template Picker + Admin Redesign PR #1095)  
**Main is ahead by**: 16 commits

### Change Summary

```
apps/web/src/pages/canned-response-admin/BubbleList.tsx          | +86 -20
apps/web/src/pages/canned-response-admin/ChannelTabs.tsx          | +63  (new)
apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx   | +17  -0
apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts  | +31  (new)
apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts | +100 (new)
```

**Frontend-only — no backend changes.**

Adds per-channel tab filtering to the canned-response template editor:
- `ChannelTabs.tsx` — tab strip (ALL / LINE_FINANCE / LINE_SHOP / FACEBOOK / …) with count badges
- `BubbleList.tsx` — filters visible bubbles by active channel; scopes newly-created bubbles to active channel; reports counts to parent via `onCountsChange`
- `bubble-reorder-logic.ts` — pure function extracted from `BubbleList.handleDragEnd`; operates on full `allBubbles` array to preserve cross-channel ordering when tab is filtered
- `bubble-reorder-logic.test.ts` — 7 test cases covering: all-visible reorder, hidden-channel preservation, FB-hidden while LINE drags, identity, missing-id no-ops, universal bubble coexistence

### Security Checks

| Check | Status |
|-------|--------|
| No new backend controller | ✅ |
| Uses `api.post()` / `useQuery` (no raw `fetch`) | ✅ |
| Uses `toast.error` from sonner | ✅ |
| `queryClient.invalidateQueries()` after mutations | ✅ |
| No hardcoded hex colors (`bg-muted`, `text-muted-foreground`, tokens only) | ✅ |
| `leading-snug` on Thai text | ✅ |
| No class components | ✅ |

### Issues Found

**Info** — `onCountsChange` stability  
`TemplateEditorPane` passes `setBubbleCounts` (a React `useState` setter) directly as `onCountsChange` to `BubbleList`. React guarantees `useState` setters are stable references, so the `useEffect([allBubbles, onCountsChange])` in `BubbleList` will not trigger spurious re-renders. ✅ No action required — noted for clarity.

**Info** — `bubble-reorder-logic.test.ts` co-located with production code  
Test file sits at `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts`. The codebase uses `e2e/` for E2E and component tests under `__tests__/` subdirectories in some pages. This is consistent with Vitest's default discovery and not a bug — style note only.

### Recommendation: ✅ APPROVE

Clean, well-structured feature. Pure function extraction with unit tests is excellent practice. Follows all frontend patterns. The reorder logic correctly handles the edge case of operating on `allBubbles` rather than the filtered view.

**Action required before merge**: Rebase onto `origin/main`. Main now has the postback routing (Phase 5) and LettersPage redesign. Expect conflicts in `TemplateEditorPane.tsx` (main has `QuickReplyEditor allTemplates` prop added) — merge trivially by keeping both sets of changes.

---

## Branch 3 — `feat/canned-response-postback-routing`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-25 13:02:38 +0700  
**Branched from**: `b8e00b0d` (2026-05-25 10:18 — Message Template Picker + Admin Redesign PR #1095)  
**Main is ahead by**: 16 commits

### Change Summary

```
apps/api/src/modules/chat-adapters/chat-adapters.module.ts         | +12  -1
apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec | +22
apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts   | +43  -0
apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec | +12
apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts   | +40
apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts          | +38
apps/api/src/modules/line-oa/line-oa.module.ts                      | +6
apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec | +103
apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts   | +40
apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec | +165 (new)
apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts   | +156 (new)
apps/api/src/modules/staff-chat/staff-chat.module.ts                | +5
apps/web/src/pages/CannedResponseAdminPage.tsx                      | +1
apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx        | +74
apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx      | +6
```

**⚠️ Note on main overlap**: As of 2026-05-27, `origin/main` already contains `quick-reply-postback-router.service.ts`, the `line-oa-chatbot.controller.ts` postback changes, and the `chatbot-finance.service.ts` postback changes via separate commit path. This branch needs a rebase; the merge will require careful conflict resolution to avoid double-applying or regressing those files. Confirm with `git diff origin/main...origin/feat/canned-response-postback-routing` after rebase to verify the delta is minimal.

### Feature Overview

Adds **Phase 5 Quick Reply postback routing** — when a customer taps a Quick Reply button whose payload is `TEMPLATE:<id>`, the backend automatically sends the linked canned-response template back to the customer (bot-driven reply), without requiring a staff member.

New service `QuickReplyPostbackRouterService`:
- Pattern-matches `TEMPLATE:<id>` payloads before existing intent/action handlers
- Returns `{ handled: false }` for unrecognised payloads → falls through to existing flows (zero regression risk)
- W7 loop guard: in-memory sliding window (5 dispatches / 10s per room) prevents A→B→A template chain loops

`CannedResponseSenderService.send()` now accepts `staffId: string | null`. When null, uses `getSystemUserId()` (upsert pattern for idempotent system-bot bootstrap).

### Security Checks

| Check | Status |
|-------|--------|
| Webhook controllers are in intentionally-public allowlist | ✅ (`chatbot-finance-liff`, `sms-webhook`, `facebook-webhook` are pre-approved) |
| No new JWT-guarded endpoints added without `@Roles` | ✅ (no new `@Controller` routes, only service-layer injection) |
| No `Number()` on financial fields | ✅ |
| `deletedAt: null` in `chatRoom.findFirst` (Facebook webhook) | ✅ |
| No hardcoded API secrets (system user email intentional placeholder) | ✅ |
| No raw `fetch()` in frontend | ✅ |
| `queryClient.invalidateQueries()` after mutations | ✅ |

### Issues Found

---

#### ⚠️ Warning — W1: Missing `userId` null guard in `LineOaChatbotController.handlePostback()`

**File**: `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts`  
**Location**: new `try` block inside `handlePostback()`

```ts
const userId = event.source.userId;  // can be undefined for group/room events
const data = event.postback.data;

try {
  const room = await this.prisma.chatRoom.findUnique({
    where: {
      lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_SHOP },
    },  // ← userId passed as-is; if undefined, Prisma query may fail or match wrong row
```

`event.source.userId` is `string | undefined` for LINE postback events originating from group chats or room events. Passing `undefined` to `lineUserId_channel` composite unique key will either throw a Prisma validation error or silently match no room (behavior depends on Prisma version).

**Contrast**: `chatbot-finance.service.ts` correctly guards with `if (userId) { ... }` before the `findUnique` call.  

**Fix**: Add `if (!userId) return;` before the try block (matching the pattern used in the finance service).

---

#### ⚠️ Warning — W2: `findUnique` without `deletedAt: null` for ChatRoom lookups

**Files**:
- `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts`
- `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts`

Both new lookups use `chatRoom.findUnique({ where: { lineUserId_channel: ... } })` without filtering `deletedAt: null`. Prisma's `findUnique` doesn't support additional where clauses beyond the unique key, so a soft-deleted room with the same `lineUserId_channel` composite key would still be found.

**Risk**: If a chat room is soft-deleted (e.g. room reset, customer account migration) and a new room is created for the same user, there will be a Prisma unique constraint violation on the composite key — meaning in practice there can only be one active room per `(lineUserId, channel)`. This limits the impact. However, if the soft-delete policy ever changes to allow re-creation under the same key, this becomes a bug.

**Fix**: Switch from `findUnique` to `findFirst` with explicit `deletedAt: null`:
```ts
const room = await this.prisma.chatRoom.findFirst({
  where: {
    lineUserId: userId,
    channel: ChatChannel.LINE_FINANCE,
    deletedAt: null,
  },
  select: { id: true },
});
```

---

#### ℹ️ Info — I1: System user email as inline constant

`CannedResponseSenderService.getSystemUserId()` hardcodes `'system@bestchoice.internal'`. This is clearly intentional and well-documented (comment explains the upsert pattern, stable identity, SALES role choice). For future maintainability, consider extracting to a named constant:
```ts
const SYSTEM_BOT_EMAIL = 'system@bestchoice.internal' as const;
```
Not a blocker.

---

#### ℹ️ Info — I2: `staff-chat.module.ts` provider array is very long (single line)

Both `providers` and `exports` arrays in `StaffChatModule` are now 200+ character single lines. Minor readability concern — no functional impact. Consider multi-line formatting to match the style of other module files.

---

#### ℹ️ Info — I3: Two additional `forwardRef()` circular dependencies introduced

`chat-adapters.module.ts` and `line-oa.module.ts` each now add `forwardRef(() => StaffChatModule)`. The existing codebase already uses `forwardRef` in several places, so this is an established pattern here. Document in a comment why the cycle exists (both modules now mutually need each other via the postback router).

---

### Recommendation: 🔶 REVIEW

The architecture is sound and the fall-through design (return `{ handled: false }` for unrecognised payloads) correctly prevents any regression to existing webhook flows. The loop guard (W7 in-process sliding window) is a good defensive measure.

**Must fix before merge**:
- W1: Add `if (!userId) return;` guard in `LineOaChatbotController.handlePostback()` (5-minute fix)

**Should fix before merge**:
- W2: Switch the two `findUnique` ChatRoom lookups to `findFirst` with `deletedAt: null`

**Action required**: Rebase onto `origin/main` first — main already contains overlapping files. After rebase, re-verify the 3-dot diff to confirm only W1/W2 fixes and the `QuickReplyEditor` POSTBACK template-picker UI remain as the net delta.

---

## Rebase Status Summary

All three branches were created from `b8e00b0d` (PR #1095, 2026-05-25 10:18) or later. Since then, `main` has received 16 commits including the full LettersPage redesign (Puppeteer PDF, dispatch dialog, bulk actions, etc.) and additional canned-response postback routing work.

**Before merging any of these branches, the author should**:
1. `git fetch origin`
2. `git rebase origin/main`
3. Resolve any conflicts (mostly in `letters-page.spec.ts` and `TemplateEditorPane.tsx`)
4. Re-run `./tools/check-types.sh all` to confirm 0 TypeScript errors
5. Re-run `./tools/run-tests.sh` (E2E suite)

---

*Generated by Pre-Merge Guard agent — 2026-05-27*
