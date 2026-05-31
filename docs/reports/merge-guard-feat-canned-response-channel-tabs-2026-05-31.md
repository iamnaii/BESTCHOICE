# Merge Guard Report — feat/canned-response-channel-tabs
**Date**: 2026-05-31  
**Branch**: `feat/canned-response-channel-tabs`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits**:
- `fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs`
- `feat(canned-response): add per-channel tabs in template editor`

---

## File Changes Summary
| File | +/- |
|------|-----|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +57 / -17 |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 (new) |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 / -3 |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 (new) |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 (new) |
| **Total** | **268 ins, 20 del — 5 files** |

---

## Issues

### Critical
_None found._

### Warning

**W1 — `onCountsChange` in `useEffect` dependency array (low-risk, worth noting)**

`BubbleList.tsx`:
```ts
useEffect(() => {
  if (!onCountsChange) return;
  // … compute counts …
  onCountsChange(counts);
}, [allBubbles, onCountsChange]);
```
If a future consumer passes an unstable lambda (not wrapped in `useCallback`) as `onCountsChange`, this will cause an infinite re-render loop. The current consumer (`TemplateEditorPane`) passes `setBubbleCounts` — a React state-setter which is guaranteed stable — so there is **no bug today**. However, the prop's API has no `useCallback` requirement communicated to callers.

Suggested mitigation (in follow-up): either add a JSDoc note on the prop type, or stabilise internally with `useRef(onCountsChange)`.

### Info

- **I1** — `bubble-reorder-logic.ts` is a 31-line pure function correctly extracted for testability. 7 unit tests cover: basic reorder, mixed-channel drag with hidden bubbles, identity case, missing IDs, and universal (channels=[]) bubbles. All edge cases hit.
- **I2** — `ChannelTabs.tsx` correctly uses semantic tokens only (`bg-primary`, `text-muted-foreground`, `bg-muted`, etc.). No hardcoded hex or `gray-*` classes.
- **I3** — Thai text in new JSX uses `leading-snug` consistently ✓
- **I4** — Badge suppression logic (hide badge when per-channel count equals ALL count) is non-obvious but explained by a comment in `ChannelTabs.tsx`.

---

## Analysis

### Design correctness
The filtering approach is correct:
```ts
const visibleBubbles =
  channelFilter === 'ALL'
    ? allBubbles
    : allBubbles.filter(
        (b) => (b.channels ?? []).length === 0 || (b.channels ?? []).includes(channelFilter),
      );
```
Bubbles with `channels = []` are "universal" and appear in every tab — consistent with the stated intent that empty channels means "all channels". ✓

### Reorder correctness
The drag-and-drop reorder now operates on `allBubbles` (not the filtered subset). This correctly preserves the global `sortOrder` sequence when dragging in a per-channel filtered view — hidden bubbles keep their positions while only the visible group's order changes. The unit tests for this path are thorough.

### The 5-bubble cap
`canAdd = allBubbles.length < 5` correctly applies the cap to the **total** bubble count, not the filtered view. A note in the UI clarifies this: `"ถึงขีดจำกัด 5 บับเบิ้ลแล้ว (รวมทุก channel)"`. ✓

### Tab reset on template switch
```ts
useEffect(() => {
  setActiveChannel('ALL');
}, [template?.id]);
```
Prevents stale channel filter when the user selects a different template in the sidebar. ✓

### API usage
- `api.post(...)` from `@/lib/api` ✓
- `useQuery`/`useMutation` from React Query ✓
- `queryClient.invalidateQueries()` called via `invalidate()` after all mutations ✓
- `toast.error()` from `sonner` ✓

---

## Recommendation: ✅ APPROVE

No critical or blocking issues. W1 is a low-risk future-consumer hazard — acceptable for merge. Consider a JSDoc note on the prop in a follow-up.
