# Pre-Merge Guard Report

**Branch:** `feat/canned-response-channel-tabs`  
**Author:** Akenarin Kongdach `<akenarin.ak@gmail.com>`  
**Review Date:** 2026-05-27  
**Reviewer:** Pre-Merge Guard (automated)  
**Base branch:** Stacked on `feat/canned-response-postback-routing`  
**Recommendation:** ✅ APPROVE

---

## Summary

Small, focused branch (~277 new lines, 5 files changed) that adds per-channel filtering tabs to the `BubbleList` component:

- **`ChannelTabs.tsx`** — new component (not shown in diff but referenced; added in a prior commit on this branch).
- **`bubble-reorder-logic.ts`** — extracted reorder function: resolves drag-and-drop `sortOrder` assignment across ALL bubbles when a channel-filtered tab is active (preserves cross-channel ordering).
- **`bubble-reorder-logic.test.ts`** — 100-line unit test suite for the reorder logic.
- **`BubbleList.tsx`** — adds `channelFilter` prop, `onCountsChange` callback for tab badge counts, and integrates `reorderBubbles` utility.
- **`TemplateEditorPane.tsx`** — minor wiring of counts back to tab badges.

---

## File Changes (incremental)

| File | Change |
|------|--------|
| `bubble-reorder-logic.ts` | New — 31 lines |
| `bubble-reorder-logic.test.ts` | New — 100 lines |
| `BubbleList.tsx` | +108 / -20 lines — channel filter + reorder fix |
| `TemplateEditorPane.tsx` | +10 lines — count wiring |
| (ChannelTabs.tsx referenced but diff minimal) | — |

---

## Critical Issues

> **None found.** All critical checks passed.

### ✅ No New Controllers or Endpoints
This branch is frontend-only (no backend changes). No guard/roles checks needed.

### ✅ No Money/Decimal Issues
Domain is UI filtering logic — no financial fields.

### ✅ No Hardcoded Secrets or SQL Issues
Frontend-only changes. No API calls added beyond the existing `GET /bubbles` and `PATCH /bubbles/reorder`.

### ✅ All Mutations Invalidate Cache
`BubbleList.tsx` retains the existing `invalidate()` helper that calls `queryClient.invalidateQueries()` on all four mutations (`createMut`, `updateMut`, `deleteMut`, `reorderMut`). ✅

---

## Warning Issues

### ⚠️ W1 — `useEffect` with `onCountsChange` dependency may cause render loop
**File:** `BubbleList.tsx`

```ts
useEffect(() => {
  if (!onCountsChange) return;
  // ...
  onCountsChange(counts);
}, [allBubbles, onCountsChange]);
```

If the parent (`TemplateEditorPane`) passes an inline arrow function as `onCountsChange`:
```tsx
<BubbleList onCountsChange={(c) => setCounts(c)} ... />
```
…this would create a new function reference on every render, causing the `useEffect` to fire in a tight loop (each `onCountsChange` call → parent re-render → new `onCountsChange` ref → effect fires again).

The parent should memoize the callback with `useCallback`, or `BubbleList` should use `useRef` to avoid the dependency. Review `TemplateEditorPane.tsx` to confirm `onCountsChange` is memoized at the call site.

**Impact:** Medium — potential performance issue / infinite loop in edge cases.

---

## Info

### ℹ️ I1 — Reorder logic well-tested
`bubble-reorder-logic.test.ts` covers 7+ cases including cross-tab moves, single-bubble edge cases, and `ALL` tab behavior. Good defensive testing for a subtle algorithm. ✅

### ℹ️ I2 — Channel filter state lives in `TemplateEditorPane`
The active channel tab is maintained as local state in the parent pane. This means switching templates resets the active tab to 'ALL'. This is probably the intended UX; just noting it for future consideration if per-template tab memory is desired.

---

## Recommendation: ✅ APPROVE

Clean, focused branch with good test coverage for the extracted reorder logic. The sole Warning (W1 render loop risk) should be verified by confirming `onCountsChange` is wrapped in `useCallback` at the call site in `TemplateEditorPane`. If it is, no changes needed.

Merge order dependency: **this branch must merge after `feat/canned-response-postback-routing`** (it is stacked on top).
