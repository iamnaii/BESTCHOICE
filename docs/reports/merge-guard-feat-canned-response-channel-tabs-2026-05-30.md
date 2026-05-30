# Merge Guard Report — `feat/canned-response-channel-tabs`

**Date**: 2026-05-30  
**Branch**: `feat/canned-response-channel-tabs`  
**Author**: Akenarin Kongdach  
**Last commit**: `d7b6c4bf` — fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs  

---

## Summary of Changes

| File | +/- |
|---|---|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +54 / -20 |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 new |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 / -1 |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 new |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 new |

**What it does**: Adds per-channel filter tabs (LINE / Facebook / "ทุก channel") to the canned response template editor. Visible bubbles are filtered by channel; newly created bubbles are automatically scoped to the active channel. Drag-and-drop reorder logic is extracted into a pure, unit-tested function (`reorderBubbles`) so that reordering in a filtered view correctly preserves the sort order of hidden bubbles.

---

## Issues Found

### Critical — None

- Frontend-only change — no new API endpoints, no controller guards needed.
- No `Number()` on money fields — no financial values.
- No raw `fetch()` — all API calls go through `api.get()`/`api.post()` from `@/lib/api`. ✅
- `queryClient.invalidateQueries()` called correctly after all mutations (`invalidate()` helper). ✅
- No hardcoded hex colors — all classes use design tokens (`bg-primary`, `text-muted-foreground`, `bg-background`, etc.). ✅

### Warning — None

- `useEffect` in `BubbleList` depends on `[allBubbles, onCountsChange]`. The `onCountsChange` prop is `setBubbleCounts` (a React state setter), which is guaranteed stable across renders by React — no infinite loop risk. ✅
- The 5-bubble cap (`canAdd = allBubbles.length < 5`) correctly counts **total** bubbles across all channels, not just the filtered view. The UI label ("รวมทุก channel") makes this explicit to users. ✅
- `reorderBubbles` operates on `allBubbles` (not the filtered subset), so dragging in a filtered view preserves relative ordering of hidden bubbles. Identity is returned when IDs are not found or `fromIdx === toIdx`. ✅

### Info — 1

- `bubble-reorder-logic.test.ts` has 7 test cases covering: unfiltered reorder, cross-channel drag isolation (LINE drag doesn't move FB bubbles), FB bubble sandwiched between LINE bubbles, identity case, missing activeId, missing overId, and universal (channels=[]) bubbles. Coverage is thorough.
- `ChannelTabs` suppresses per-channel count badges when the count equals the ALL count — avoids spamming identical numbers when all bubbles are universal. The logic is simple and correct.
- `useEffect` in `TemplateEditorPane` resets `activeChannel` to `'ALL'` when `template?.id` changes — prevents stale tab state when switching between templates. ✅

---

## Verdict: ✅ APPROVE

Well-structured feature addition. Core logic is extracted and unit-tested (7 cases), design tokens are used throughout, API pattern is correct (no raw fetch, invalidateQueries after mutations), and edge cases (empty filter, 5-bubble cap, hidden-bubble reorder) are handled. No security, data, or performance concerns.

Safe to merge.
