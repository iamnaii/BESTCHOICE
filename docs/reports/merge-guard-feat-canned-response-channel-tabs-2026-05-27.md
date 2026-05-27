# Pre-Merge Guard Report — `feat/canned-response-channel-tabs`

**Date**: 2026-05-27  
**Author**: Akenarin Kongdach  
**Branch**: `feat/canned-response-channel-tabs`  
**Base**: `origin/main`  
**Recommendation**: ✅ **APPROVE**

> ⚠️ **Merge dependency**: This branch is a commit-subset of `feat/canned-response-postback-routing`. If postback-routing is merged first, this branch becomes a no-op. Coordinate merge order or verify branch is still needed independently.

---

## Summary

```
 apps/web/src/pages/canned-response-admin/BubbleList.tsx         |  86 +++
 apps/web/src/pages/canned-response-admin/ChannelTabs.tsx        |  63 +++  (new file)
 apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx |  17 +++
 apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts | 100 +++  (new file)
 apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts      |  31 +++  (new file)
 5 files changed, 277 insertions(+), 20 deletions(-)
```

Pure frontend change. Adds per-channel filtering tabs to the canned-response template editor bubble list, and extracts the drag-and-drop reorder logic into a testable pure function.

---

## Changes

### `ChannelTabs.tsx` (new)
Tab bar component (`ChannelTabValue = Channel | 'ALL'`). Uses:
- `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `hover:bg-muted/70`, `hover:text-foreground` — all design tokens ✓
- `aria-pressed` on each button ✓
- `Globe` icon from `lucide-react` ✓
- Badge suppression logic: per-channel badge only shown when count differs from ALL count, avoiding duplicate numbers when all bubbles are universal.

### `BubbleList.tsx`
- New `channelFilter` prop filters `visibleBubbles` without hiding them from `allBubbles` (DnD drag, 5-bubble cap, count badge all operate on `allBubbles`).
- `onCountsChange` effect uses `setBubbleCounts` (a stable React state setter) as the callback — no infinite re-render risk ✓
- New bubble created via mutation correctly scopes `channels: [channelFilter]` when a specific channel tab is active.
- Drag reorder delegates to `reorderBubbles()` (pure function, tested separately).
- Uses `api.post()` from `@/lib/api` ✓
- Uses `invalidate()` after mutation ✓

### `bubble-reorder-logic.ts` (new)
Pure function: operates on **all** bubbles, not just the visible filtered subset. Correctly preserves hidden (cross-channel) bubble positions when dragging in a filtered view.

### `bubble-reorder-logic.test.ts` (new, 100 lines)
6 test cases covering: basic reorder, cross-channel position preservation, universal-bubble interleaving, identity (no-op), missing activeId, missing overId.

### `TemplateEditorPane.tsx`
- Wires `ChannelTabs` + `bubbleCounts` state + `BubbleList.channelFilter/onCountsChange`.
- `activeChannel` resets to `'ALL'` on template switch via `useEffect` on `template?.id` ✓

---

## Issue Scan

| Severity | Finding | Status |
|----------|---------|--------|
| Critical | Missing `@UseGuards` on new controllers | N/A — no backend changes |
| Critical | `Number()` on money fields | N/A |
| Critical | Missing `deletedAt: null` | N/A |
| Critical | Hardcoded secrets | None found |
| Warning | Raw `fetch()` — all API calls via `api.post()/api.get()` | ✓ Clean |
| Warning | `queryClient.invalidateQueries()` after mutations | ✓ Present (`invalidate()` helper) |
| Warning | Design tokens — no hardcoded hex/gray-* classes | ✓ All tokens |
| Warning | `useEffect` infinite loop risk (`onCountsChange`) | ✓ Stable setter, no loop |
| Info | `select` element in `QuickReplyEditor` uses native HTML (not shadcn/ui Select) | N/A — not in this branch |
| Info | `onCountsChange` in `useEffect` deps — correct, setter is stable | ✓ |

---

## Recommendation

**APPROVE** — well-structured frontend feature. Business logic extracted into a pure function with comprehensive tests. Design tokens, API patterns, and mutation invalidation are all correct. No backend changes.

**Action before merge**: Confirm whether `feat/canned-response-postback-routing` (which contains this branch's commits) should be merged instead. If postback-routing goes in first, this branch is redundant.
