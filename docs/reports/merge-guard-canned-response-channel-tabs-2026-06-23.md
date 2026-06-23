# Merge Guard Report — feat/canned-response-channel-tabs

**Date**: 2026-06-23  
**Branch**: `feat/canned-response-channel-tabs`  
**Author**: Akenarin Kongdach  
**Base commit**: `b8e00b0d` (feat: Message Template Picker + Admin Redesign)  
**Unique commits**: 2

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | Modified — adds `channelFilter` + `onCountsChange` props |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | **New** — per-channel tab bar with badge counts |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | Modified — wires ChannelTabs + bubbleCounts state |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | **New** — pure reorder helper |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | **New** — unit tests for reorder logic |

---

## Critical Issues

None.

---

## Warnings

None.

---

## Info

### I-1: `useEffect` resets channel tab on template switch
`TemplateEditorPane.tsx` uses a `useEffect` to reset `activeChannel` to `'ALL'` when `template?.id` changes. This is a minor pattern note — the effect is correct and not harmful, but could have been done via a `key={template?.id}` on a child component. No action required.

### I-2: `any` type in `bubblesQ` queryFn
`BubbleList.tsx` uses `.then((r: any) => r.data)` in the `queryFn`. This is consistent with existing patterns in the codebase but is loose typing. No action required.

### I-3: New pure-logic file with tests ✓
`bubble-reorder-logic.ts` is a pure function extracted from the drag-drop handler — correctly tested in `bubble-reorder-logic.test.ts`. The logic handles the `allBubbles` (unfiltered) → stable reorder correctly when a channel filter is active.

---

## Quality Observations

- **Design tokens**: `ChannelTabs.tsx` correctly uses `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `border-border`, `hover:bg-muted/70` — no hardcoded hex colors or `text-gray-*` violations.
- **Thai text**: `leading-snug` applied on all Thai text buttons ✓
- **Semantic markup**: Uses `type="button"` + `aria-pressed` on channel tab buttons ✓
- **Cache invalidation**: `BubbleList` correctly calls `invalidateQueries` on all 3 affected query keys after mutations ✓
- **API client**: All data fetching uses `api.get()` / `api.post()` from `@/lib/api`, no raw `fetch()` ✓
- **React Query**: `useQuery` / `useMutation` pattern throughout ✓

---

## Recommendation

**APPROVE**

Clean, focused frontend change. No security issues, no pattern violations. The new `ChannelTabs` component is well-structured and the `reorderBubbles` pure helper with tests is a good separation. Ready to merge.
