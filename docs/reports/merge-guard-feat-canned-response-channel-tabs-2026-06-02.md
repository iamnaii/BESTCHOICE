# Merge Guard Report — feat/canned-response-channel-tabs

**Date:** 2026-06-02  
**Branch:** `feat/canned-response-channel-tabs`  
**Author:** Akenarin Kongdach  
**Commits:**  
- `d7b6c4bf` — fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs  
- `bc4603d3` — feat(canned-response): add per-channel tabs in template editor  
**Recommendation:** ✅ APPROVE

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +43 / -20 lines — channel filtering + count reporting |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 lines — new tab navigation component |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 / -3 lines — wires ChannelTabs into editor |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 lines — extracted pure reorder function |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 lines — unit tests for reorder logic |

**Total:** 5 files changed, 277 insertions, 20 deletions

---

## Issues Found

### Critical — 0 found ✅

No critical issues.

### Warning — 1 found

| # | Severity | File | Detail |
|---|----------|------|--------|
| W-1 | Warning | `BubbleList.tsx:95-106` | `useEffect` calls `onCountsChange(counts)` with `onCountsChange` in the dependency array. If the parent passes a non-memoized function (not wrapped in `useCallback`), this effect re-fires every render, potentially causing a render loop. The current caller (`TemplateEditorPane`) passes `setBubbleCounts` from `useState` — which is stable — so there is no active bug. However, if a future consumer passes an inline function, it will loop. **Fix suggestion:** wrap `onCountsChange` in `useCallback` at the call site, or note the stability requirement in a JSDoc comment. |

### Info

| # | File | Note |
|---|------|------|
| I-1 | `ChannelTabs.tsx` | Badge suppression logic (`count !== allCount`) is a smart UX touch but the invariant is subtle — when all bubbles are universal (channels=[]), every per-channel count equals ALL count, so badges are hidden. Future devs may not expect this. A short comment explaining the intent would help. |
| I-2 | `bubble-reorder-logic.ts` | Pure function with no side effects — ideal for unit testing. The algorithm (operates on all bubbles, not just visible) correctly preserves cross-channel sort stability. Test suite covers 7 cases including edge cases (missing IDs, universal bubbles). ✅ |
| I-3 | `BubbleList.tsx` | The count cap comment "Cap of 5 applies to TOTAL bubbles (LINE push limit)" is useful — clearly explains why `canAdd` uses `allBubbles.length`, not `visibleBubbles.length`. |

---

## Detailed Analysis

### Frontend patterns compliance
- **API calls:** Uses `api.get()`/`api.post()` from `@/lib/api` ✓
- **React Query:** `useQuery`/`useMutation` from `@tanstack/react-query` ✓  
- **Cache invalidation:** `qc.invalidateQueries()` called via `invalidate()` helper after all mutations ✓
- **Notifications:** `toast.error()` from `sonner` ✓
- **Design tokens:** `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `bg-background`, `border-border`, `hover:bg-muted/70` — no hardcoded colors ✓
- **Thai text:** `leading-snug` used consistently on Thai text elements ✓
- **Functional components:** Hooks only, no class components ✓

### Reorder logic correctness (W-2 review fix)
The original inline reorder operated on `visibleBubbles`, which could corrupt the sort order of hidden bubbles across channels. The fix correctly extracts `reorderBubbles(allBubbles, activeId, overId)` — the drag operates on the full list so hidden channel bubbles keep their relative positions. The unit test `preserves hidden bubbles position when reordering filtered (LINE drag with FB hidden)` specifically validates this case.

---

## Verdict

**✅ APPROVE** — Feature is well-structured with good test coverage. The one Warning (W-1) is not an active bug given stable `useState` callback at the call site, but is worth noting for future consumers. All React/design token conventions followed.
