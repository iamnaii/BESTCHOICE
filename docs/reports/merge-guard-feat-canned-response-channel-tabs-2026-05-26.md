# Pre-Merge Guard Report

**Branch:** `feat/canned-response-channel-tabs`
**Author:** Akenarin Kongdach
**Date:** 2026-05-26
**Recommendation:** ⚠️ REVIEW (1 warning)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +86/-20 |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 (new) |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17/-4 |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 (new) |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 (new) |

**Total:** 5 files, ~277 net additions (frontend only)

---

## Overview

Adds per-channel tab filtering to the canned-response bubble editor. A `ChannelTabs` strip (LINE Finance / LINE Shop / Facebook / All) sits above the bubble list and filters which bubbles are shown. New bubbles created while a channel tab is active are automatically scoped to that channel. The drag-and-drop reorder logic is extracted into a pure function (`reorderBubbles`) that operates on the full bubble array to avoid displacing hidden bubbles when reordering a filtered view.

---

## Issues Found

### Critical
_None_

### Warning

**W1 — `onCountsChange` in `useEffect` dependency array (unstable reference risk)**
`apps/web/src/pages/canned-response-admin/BubbleList.tsx` (~L87-L96):

```tsx
useEffect(() => {
  if (!onCountsChange) return;
  // ...
  onCountsChange(counts);
}, [allBubbles, onCountsChange]);
```

`onCountsChange` is a function prop passed from `TemplateEditorPane`. The current implementation passes `setBubbleCounts` directly (a stable reference from `useState`), so in practice there's no issue today. However, if any future caller passes an inline arrow function (e.g. `onCountsChange={(c) => doSomething(c)}`), the effect will fire on every render because the function reference changes on every render cycle.

Recommended fix — wrap the callback in `useCallback` at the call site, or gate with a ref:

```tsx
// In TemplateEditorPane:
const handleCountsChange = useCallback((counts: Partial<Record<ChannelTabValue, number>>) => {
  setBubbleCounts(counts);
}, []); // stable reference

// or suppress the lint rule at the call site with a ref pattern inside BubbleList if preferred
```

Low-impact (only affects render performance, not correctness), but worth tightening before this pattern spreads to other consumers.

### Info

- `bubble-reorder-logic.ts` is 31 lines, pure function, zero side effects — well-scoped extract. 100-line test file covers edge cases (filtered drag, universal bubbles, hidden FB bubbles, identity reorder). Good.
- `ChannelTabs` uses `aria-pressed` on channel filter buttons — accessible.
- All design tokens used correctly: `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `border-border`, `bg-background`. No hardcoded hex. ✓
- `leading-snug` applied to Thai text elements. ✓
- `useQuery` / `useMutation` / `queryClient.invalidateQueries()` patterns followed correctly. ✓
- No raw `fetch()` — all API calls go through `api.post()` from `@/lib/api`. ✓

---

## Security Checklist

| Check | Result |
|-------|--------|
| New controllers have `@UseGuards` | N/A — frontend-only changes |
| Money fields use `Prisma.Decimal` | N/A — no financial calculations |
| Queries include `deletedAt: null` | N/A — frontend-only changes |
| No hardcoded secrets | ✅ |
| No raw `fetch()` | ✅ |
| React Query cache invalidated after mutations | ✅ |
