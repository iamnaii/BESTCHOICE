# Pre-Merge Guard Report

**Branch**: `feat/canned-response-channel-tabs`  
**Author**: Akenarin Kongdach / iamnaii  
**Date**: 2026-05-26  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +54 / -20 | Per-channel bubble filtering + count reporting |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 / 0 | New tab strip component |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +14 / -3 | Wire ChannelTabs into editor pane |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 / 0 | Pure reorder helper (extracted for testability) |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 / 0 | 7 unit tests for reorder edge cases |

**Total**: 5 files, 277 lines changed. All frontend only.

---

## Issues by Severity

### Critical
_None._

### Warning
_None._

### Info

- **`useEffect` dependency correctness** — `BubbleList.tsx` passes `onCountsChange` in the `useEffect` dep array. The parent (`TemplateEditorPane`) supplies this as `setBubbleCounts`, a stable `useState` setter. No infinite-loop risk, but if a caller ever passes an unstable arrow function, the effect would re-run on every render. Low risk given current usage; would be worth a `useCallback` wrapper at the call-site if the component is ever reused more broadly.

- **Channel tab reset on template switch** — `TemplateEditorPane` resets `activeChannel` to `'ALL'` via `useEffect([template?.id])`. This is correct behavior and the comment explains it clearly.

- **Bubble count cap semantics** — The 5-bubble cap now applies to `allBubbles.length` (total across channels) rather than `visibleBubbles.length`. The UI text correctly reflects this ("ถึงขีดจำกัด 5 บับเบิ้ล (รวมทุก channel)"). Consistent with LINE Flex Message limits.

---

## Code Quality Observations

- `api.get()` / `api.post()` used consistently (no raw `fetch()`). ✓
- `useMutation` with `onSuccess: () => invalidate()` calls `invalidateQueries` correctly. ✓
- Color tokens only — no hardcoded hex or `bg-gray-*` / `text-gray-*`. ✓
- Thai validation messages preserved. ✓
- `leading-snug` used on all Thai text nodes. ✓
- `bubble-reorder-logic.ts` is pure and unit-tested with 7 scenarios covering filtered drag, hidden-bubble preservation, and edge cases (missing ids, universal bubbles). ✓

---

## Recommendation

**APPROVE** — Clean frontend feature. Good test coverage for the non-trivial reorder logic. No security, money, or guard issues. No blockers.
