# Merge Guard Report — feat/canned-response-channel-tabs

**Date**: 2026-05-26
**Branch**: `feat/canned-response-channel-tabs`
**Author**: Akenarin Kongdach
**Recommendation**: ⚠️ REVIEW

---

## Summary

Adds channel-tab filtering to the canned-response admin UI. Operators can now switch between "ทุก channel", LINE, Facebook, etc. tabs to view/create bubbles scoped to a specific channel. The reorder logic is extracted into a pure function (`reorderBubbles`) with 100 unit tests.

**Files changed (5)**:
```
apps/web/src/pages/canned-response-admin/BubbleList.tsx           +75/-13
apps/web/src/pages/canned-response-admin/ChannelTabs.tsx          +63 (new)
apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx   +17/-3
apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts  +100 (new)
apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts  +31 (new)
```

All changes are frontend-only — no new API endpoints, no new backend controllers.

---

## Issues

### Critical
_None found._

---

### Warning

**W1 — `onCountsChange` in `useEffect` dependency array may cause infinite renders**

`apps/web/src/pages/canned-response-admin/BubbleList.tsx`
```tsx
useEffect(() => {
  if (!onCountsChange) return;
  // ... computes counts ...
  onCountsChange(counts);
}, [allBubbles, onCountsChange]);
```

`onCountsChange` is a callback prop passed from `TemplateEditorPane`:
```tsx
<BubbleList
  onCountsChange={setBubbleCounts}   // setBubbleCounts from useState
  ...
/>
```
`setBubbleCounts` from `useState` is stable (React guarantees its identity doesn't change), so this is safe in the current implementation. **However**, if a future caller passes an inline arrow function `onCountsChange={(c) => doSomething(c)}` without `useCallback`, the effect will fire on every render, causing an infinite loop. The pattern is fragile for a reusable component.

**Action**: Either wrap the `useEffect` logic in `useCallback` inside `BubbleList`, or document in the Props interface that `onCountsChange` must be a stable reference (useCallback or useState setter). A `// must be stable ref (useCallback or useState setter)` JSDoc comment on the prop is the minimal fix.

---

### Info

**I1 — 5-bubble cap applies to total bubbles, not per-channel**

```tsx
// Cap of 5 applies to TOTAL bubbles in the template (LINE push limit).
const canAdd = allBubbles.length < 5;
```
This is correct per LINE's push limit and the code comment makes the intent clear. Worth noting that the UI header now shows `(N/M แสดง · M/5 บับเบิ้ล)` which is informative — no issue.

**I2 — `reorderBubbles` preserves cross-channel ordering correctly**

The pure function operates on `allBubbles` (not the filtered subset) so drag-and-drop within a filtered tab doesn't displace hidden bubbles from other channels. 100 unit tests cover this. Implementation is clean.

**I3 — `aria-pressed` on channel tab buttons**

`ChannelTabs.tsx` uses `aria-pressed={active}` on the channel buttons, which is semantically correct for toggle buttons. No accessibility issue.

---

## Recommendation: ⚠️ REVIEW

One warning-level fragility with `onCountsChange` stability. Safe today (the only caller passes `setState` setter), but a documentation comment or `useCallback` guard should be added before merge to prevent future regressions.
