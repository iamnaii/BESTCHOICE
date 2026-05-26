# Pre-Merge Guard Report — 2026-05-26

**Reviewed**: 3 most-recently-updated feature branches (as of 2026-05-25/26)
**Reviewer**: Pre-Merge Guard Agent
**Date**: 2026-05-26

---

## Branch 1: `feat/canned-response-channel-tabs`

**Last commit**: 2026-05-25
**Commits**: 2 (Phase 2b channel tabs)
**Files changed**: 5 files · +277 / -20 lines

### Summary
Adds per-channel tab filtering in the bubble template editor. A new `ChannelTabs` component filters `BubbleList` by active channel, with badge counts for each tab. The reorder logic is extracted into a pure `reorderBubbles()` function with 7 unit tests.

### Critical Issues
None.

### Warning Issues

**W1 — `onCountsChange` in `useEffect` dependency array without caller memoization** (`BubbleList.tsx`)

```tsx
useEffect(() => {
  if (!onCountsChange) return;
  // ...
  onCountsChange(counts);
}, [allBubbles, onCountsChange]);   // ← onCountsChange in deps
```

`onCountsChange` is `setBubbleCounts` (from `useState` in `TemplateEditorPane`) which is stable, so it won't cause infinite re-renders in the current caller. However, if this component is reused with an inline function (e.g. `onCountsChange={() => ...}`), each parent render will re-trigger the effect. Recommend wrapping with `useCallback` at the call site in `TemplateEditorPane` as a defensive measure, or documenting the stability requirement in the `Props` interface.

### Info Issues
- No backend changes in this branch — purely frontend UI additions.
- `bubble-reorder-logic.test.ts` has good coverage of the cross-channel drag edge case.

### Recommendation: ✅ APPROVE

---

## Branch 2: `feat/canned-response-postback-routing`

**Last commit**: 2026-05-25
**Commits**: 3 (Phase 5 postback routing)
**Files changed**: 15 files · +701 / -22 lines

### Summary
Wires a new `QuickReplyPostbackRouterService` into the Facebook and LINE OA webhook controllers so that `TEMPLATE:<id>` postback payloads dispatch the matching canned response without creating a fake TEXT message in the chat log. Includes a loop-guard (in-memory sliding window: 5 sends / 10 s per room) and graceful fall-through for unrecognised payloads.

### Critical Issues
None.

### Warning Issues

**W1 — Circular dependency via `forwardRef`** (`chat-adapters.module.ts:28`)

```ts
// Phase 5 — FacebookWebhookController injects QuickReplyPostbackRouterService.
forwardRef(() => StaffChatModule),
```

`ChatAdaptersModule` now imports `StaffChatModule` via `forwardRef`. If `StaffChatModule` already imports (directly or transitively) something from `ChatAdaptersModule` — e.g. `CannedResponseSenderService` calls a channel adapter — this circular dep will silently resolve at runtime but can produce subtle init-order bugs. Verify that `StaffChatModule` does NOT import `ChatAdaptersModule` back; if it does, the service that needs the adapter should be extracted into a shared module instead.

**W2 — In-memory rate-limit map not shared across instances** (`quick-reply-postback-router.service.ts:58`)

```ts
private readonly recentSends = new Map<string, number[]>();
```

The loop guard resets on every pod restart and is not shared between pod instances in multi-replica Cloud Run deployments. A room could exceed 5 sends/10 s if its requests land on different pods. Acceptable as a _best-effort_ guard, but should be documented as such (the existing comment partially covers this).

### Info Issues
- `FacebookWebhookController` and `LineOaChatbotController` are intentionally public (webhook receivers). No JWT guard is needed — correct by design per `security.md`.
- Postback router correctly handles TikTok/WEB degradation (those channels deliver taps as plain TEXT — documented in the service's JSDoc).
- `PrismaService` is injected directly into `FacebookWebhookController` to look up the chat room. Inconsistent with the project's "controller → service → Prisma" layering rule. Not a security issue, but violates `backend.md` — consider moving the room lookup into a service method.

### Recommendation: ✅ APPROVE (address W1 before multi-instance scale-out)

---

## Branch 3: `feat/canned-response-admin-redesign`

**Last commit**: 2026-05-25
**Commits**: 8 (major UI redesign + new backend services)
**Files changed**: 59 files · +8,203 / -661 lines

### Summary
Major redesign of the canned response admin page. Adds full Bubble CRUD, Quick Reply CRUD, template reorder, category management (rename/delete/duplicate), template duplicate, multi-bubble send (`CannedResponseSenderService`), variable expansion (`CannedResponseVariableService`), and a preview endpoint. Fixes existing `Number(payment.amountDue)` → `formatDecimalThai()` (Decimal precision fix).

### Critical Issues
None.

### Warning Issues

**W1 — Non-atomic duplicate operations** (`CannedResponseAdminPage.tsx` — `duplicateTemplateMutation` and `duplicateCategoryMutation`)

Both mutations execute multi-step sequential API calls client-side (create template → fetch source bubbles/QRs → POST each bubble/QR one by one). If the loop fails mid-way, the new template exists in the DB but is missing some bubbles or quick replies — a partially-duplicated template that the user cannot see or clean up easily (no undo).

```ts
// Example failure path: template created, 2/5 bubbles copied, then network error
const newTpl = await api.post('/staff-chat/canned-responses', ...);   // succeeds
for (const b of srcBubbles) {
  await api.post(`.../bubbles`, ...);   // fails on bubble 3 → orphan
}
```

Recommend adding a backend `POST /staff-chat/canned-responses/:id/duplicate` endpoint that performs the full deep-copy atomically (in a `$transaction`). This is a UI correctness issue, not a security one, but impacts data integrity.

**W2 — Several `@IsString()` / `@MaxLength()` validators in `UpdateBubbleDto` lack Thai error messages**

`CreateBubbleDto` has Thai messages on key fields (`type ไม่ถูกต้อง`, `text ยาวเกิน 5000 ตัวอักษร`) but `UpdateBubbleDto` and most optional fields across both DTOs omit custom messages entirely. Per project convention (`backend.md`), validation error messages should be in Thai. Low priority for internal admin endpoints but inconsistent.

Affected fields (sample): `mediaUrl`, `thumbnailUrl`, `stickerPackageId`, `stickerId`, `address`, `locationTitle` — all missing `{ message: '...' }`.

**W3 — Direct Prisma call in `FacebookWebhookController`** (also in postback-routing branch, same root cause)

See `feat/canned-response-postback-routing` W3 above.

### Info Issues

- `Number(payment.amountDue)` was correctly **removed** in `CannedResponseVariableService` and replaced with `this.formatDecimalThai()` — this is a fix, not a regression. ✅
- All 13 new endpoint methods on `StaffChatController` have `@Roles()` and inherit the class-level `@UseGuards(JwtAuthGuard, RolesGuard)`. ✅
- `deletedAt: null` guards are present in all new service queries. ✅
- `api.get()` / `api.post()` / `api.patch()` / `api.delete()` used throughout — no raw `fetch()`. ✅
- `queryClient.invalidateQueries()` called in all mutation `onSuccess` handlers except `sendDirectMut` (correct — sending a message doesn't need a list refresh). ✅
- Large file alert: `CannedResponseAdminPage.tsx` likely exceeds 500 lines after this PR. Consider splitting into sub-components when next touching this file.
- `CannedResponseAdminPage.test.tsx` added with probe substitution test — good coverage for the variable expansion path.

### Recommendation: ⚠️ REVIEW — merge after W1 (duplicate atomicity) is addressed or accepted by owner as a known limitation

---

## Summary Table

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `feat/canned-response-channel-tabs` | 0 | 1 | 1 | ✅ APPROVE |
| `feat/canned-response-postback-routing` | 0 | 2 | 2 | ✅ APPROVE (note W1 before scale-out) |
| `feat/canned-response-admin-redesign` | 0 | 3 | 5 | ⚠️ REVIEW (W1 data integrity) |

**No branch has Critical blockers.** The admin redesign W1 (non-atomic duplicate) is the most impactful finding and warrants a discussion before merge — the feature is functional but can leave partial data on network errors during duplication.
