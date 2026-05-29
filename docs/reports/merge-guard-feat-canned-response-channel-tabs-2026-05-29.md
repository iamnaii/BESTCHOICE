# Merge Guard Report — feat/canned-response-channel-tabs
**Date**: 2026-05-29  
**Branch**: `feat/canned-response-channel-tabs`  
**Author**: Akenarin Kongdach  
**Commits**: 2  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +56/-20 |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 (new) |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +20/-2 |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 (new) |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 (new) |

**5 files changed — 277 insertions, 20 deletions — frontend only, no API changes**

---

## What This Branch Does

Adds per-channel tab filtering to the canned response template editor. Operators can now switch between LINE Finance, Facebook, TikTok (and "All") tabs to view and create channel-scoped bubbles. New features:

- `ChannelTabs` component with smart badge suppression (badge hidden when count equals ALL, avoiding visual noise when all bubbles are universal)
- `BubbleList` receives `channelFilter` and `onCountsChange` props — filters visible bubbles while retaining the global 5-bubble cap across all channels
- `reorderBubbles()` extracted to a pure function — operates on the full bubble array so drag-and-drop preserves cross-channel ordering when filtered
- Channel tab auto-resets to `ALL` when switching between templates

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**I-1 — `allBubbles` reference stability in `useEffect` dependency**  
In `BubbleList.tsx`:
```tsx
const allBubbles = bubblesQ.data ?? [];
useEffect(() => {
  ...
}, [allBubbles, onCountsChange]);
```
When `bubblesQ.data` is `undefined`, `?? []` creates a new array reference on every render — this causes the effect to fire unnecessarily on each render while loading. `onCountsChange` is `setBubbleCounts` (stable React setter), so there is no infinite loop risk. The extra `onCountsChange()` calls are a no-op with the same counts. Minor — can be addressed with `useMemo` or by memoizing the `undefined` case, but not a correctness bug.

**I-2 — `reorderBubbles` is well-tested (8 cases)**  
Pure function with edge cases covered: cross-channel hidden-bubble preservation, identity drag, missing IDs, universal-plus-scoped coexistence. Good regression baseline for future channel additions.

**I-3 — Design token compliance confirmed**  
`ChannelTabs.tsx` uses `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `hover:bg-muted/70` — no hardcoded hex colors. Consistent with frontend rules.

---

## Security Check

| Check | Result |
|-------|--------|
| No raw `fetch()` | ✅ Uses `api.post()` / `api.get()` |
| `queryClient.invalidateQueries` after mutations | ✅ Present via `invalidate()` helper |
| No sensitive data in new components | ✅ Pure UI logic |
| No hardcoded strings breaking Thai UX | ✅ All user-facing text in Thai |

---

## Verdict

Clean, well-tested frontend feature. The minor `useEffect` reference issue (I-1) is a cosmetic performance nit, not a bug. Ready to merge.
