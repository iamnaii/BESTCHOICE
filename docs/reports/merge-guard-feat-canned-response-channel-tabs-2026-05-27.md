# Merge-Guard Report — feat/canned-response-channel-tabs

**Date**: 2026-05-27  
**Branch**: `feat/canned-response-channel-tabs`  
**Author**: Akenarin Kongdach  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +54 / -20 | Filter + count logic |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 / 0 | New component |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 / 0 | Wire tabs into editor |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 / 0 | Pure reorder helper |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 / 0 | Unit tests (7 cases) |

**5 files changed** — frontend only, no API or schema changes.

---

## Issues

### Critical
_None._

### Warning

- **W1** — `apps/web/src/pages/canned-response-admin/BubbleList.tsx:87`  
  `onCountsChange` is in the `useEffect` dependency array. If a parent passes an unstable function reference (inline arrow), this would re-fire every render and potentially flood the parent with state updates. Currently safe because `TemplateEditorPane` passes `setBubbleCounts` (stable `useState` setter), but it is a latent footgun. Consider wrapping with `useCallback` in `TemplateEditorPane`, or adding an `eslint-disable` comment acknowledging the dependency.

### Info

- **I1** — `bubble-reorder-logic.test.ts` co-located in `src/pages/` rather than a `__tests__/` directory. Acceptable given the file is a pure logic module test with no DOM or React dependencies — Vitest handles it. Consistent with other co-located test files in this project.

- **I2** — `ChannelTabs.tsx` uses a `<button type="button">` with `aria-pressed` for tabs. Standard accessible pattern; uses design tokens throughout (`bg-primary`, `text-muted-foreground`, `bg-muted`). No issues.

---

## Analysis

### Security
No new API endpoints, guards, or auth changes. Data fetching uses `api.get()` via React Query (`useQuery`). Mutations use `onSuccess: () => invalidate()` for cache consistency. No raw `fetch()` calls. No hardcoded colors or secrets.

### Design Token Compliance
All color references use semantic tokens: `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `border-border`, `bg-background`, `hover:bg-muted/70`. No hardcoded hex/gray-* classes.

### Logic Correctness
The `reorderBubbles` helper correctly operates on `allBubbles` (not filtered) so cross-channel sort-order is preserved when dragging in a filtered view. The 7 unit-test cases cover the universal-bubble, cross-channel, identity, and not-found edge cases.

The bubble count cap of 5 is correctly evaluated against `allBubbles.length` (LINE limit applies to the full template, not per-channel subset).

---

## Verdict: ✅ APPROVE
