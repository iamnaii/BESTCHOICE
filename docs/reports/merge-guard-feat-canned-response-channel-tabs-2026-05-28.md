# Merge Guard Report — feat/canned-response-channel-tabs

**Date**: 2026-05-28  
**Branch**: `feat/canned-response-channel-tabs`  
**Author**: Akenarin Kongdach  
**Commits**: 2
- `d7b6c4bf fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs`
- `bc4603d3 feat(canned-response): add per-channel tabs in template editor`

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +62 / -17 — channel filtering + count reporting |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 (new) — channel tab component |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 / -3 — wire up channel tabs |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 (new) — extracted reorder logic |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 (new) — 7 unit tests |

**Total**: 5 files changed, 277 insertions, 20 deletions

---

## What this branch does

Adds per-channel filtering tabs to the canned-response template editor. Users can view and
create bubbles scoped to a specific channel (LINE, Facebook, etc.) rather than seeing all
bubbles mixed together. Key behaviour:

- Channel tabs show badge counts; badge suppressed when all bubbles are universal (channels=[])
  to avoid redundant numbers across every tab
- New bubbles created under a filtered tab are auto-scoped to that channel
- Drag-and-drop reorder operates on the **full** bubble array (not just visible), preserving
  cross-channel sortOrder — extracted into `reorderBubbles()` pure function with 7 unit tests
- Tab resets to `ALL` when switching templates
- 5-bubble cap applies to total count, not per-channel

---

## Issues Found

### Critical
_None_

### Warning
_None_

### Info

**[I-1] `any` type in existing `queryFn` — not introduced by this PR**  
File: `apps/web/src/pages/canned-response-admin/BubbleList.tsx:80`  
```ts
queryFn: () => api.get(`...`).then((r: any) => r.data),
```
Pre-existing pattern in the file; this PR does not worsen it. Consider adding a typed response
interface in a follow-up (`CannedResponseBubble[]`), but not a blocker.

---

## Code Quality Observations

**Positives:**
- `reorderBubbles()` is correctly extracted as a pure function — easily testable, no side effects
- Test coverage is thorough: 7 cases including cross-channel hidden-bubble preservation,
  identity/no-op, and missing-id guards
- `onCountsChange` receives the stable `setBubbleCounts` setter from `useState` — no infinite
  loop risk from `useEffect([allBubbles, onCountsChange])`
- Design tokens used throughout (`bg-primary`, `text-muted-foreground`, `border-border`) — no
  hardcoded hex colors
- `api.post()` from `@/lib/api` used correctly; `toast.error()` from `sonner` used correctly
- `queryClient.invalidateQueries()` called in `invalidate()` after all mutations
- `leading-snug` applied on Thai text in new UI strings

---

## Recommendation

**✅ APPROVE**

Well-structured feature with proper test coverage, correct React patterns, and no regressions in
existing behaviour. The reorder-logic extraction is a good design decision that makes the
cross-channel ordering invariant explicit and verifiable. Minor `any` type is pre-existing.
