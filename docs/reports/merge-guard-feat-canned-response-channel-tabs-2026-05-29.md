# Merge Guard Report — `feat/canned-response-channel-tabs`

**Date**: 2026-05-29  
**Branch**: `feat/canned-response-channel-tabs`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits**:
- `bc4603d3` — feat(canned-response): add per-channel tabs in template editor
- `d7b6c4bf` — fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +34 / -20 lines — channel filter prop, count reporting via useEffect, new bubble auto-scoped to active channel |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 lines (new) — tab UI component with badge counts |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 / -3 lines — wires `activeChannel` state + `ChannelTabs` into editor |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 lines (new) — 7 unit test cases for reorder logic |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 lines (new) — pure `reorderBubbles()` function |

**Total**: 5 files, +245 / -23 lines (frontend-only, no backend changes)

---

## Issues Found

### Critical
_None._

### Warning
_None._

### Info

**[INFO-1]** `BubbleList.tsx` passes `onCountsChange` in the `useEffect` dependency array. If a parent ever supplies an inline function (not a stable `setState` setter), this would loop on every render. In the current sole call site (`TemplateEditorPane.tsx`), `setBubbleCounts` is a stable React state setter — no loop risk. Document the expectation on the prop or use `useCallback` at the call site if this component is reused with inline handlers.

**[INFO-2]** `ChannelTabs.tsx` badge suppression logic (only shows per-channel count when it differs from ALL count) is well-considered for avoiding visual noise when all bubbles are universal. The comment explains the intent clearly.

**[INFO-3]** `reorderBubbles()` correctly operates on `allBubbles` rather than the filtered subset, preserving cross-channel `sortOrder` integrity when dragging in a filtered tab. The 7 unit tests in `bubble-reorder-logic.test.ts` cover the key edge cases: no-filter drag, filtered drag with hidden bubbles, identity (fromIdx === toIdx), missing IDs, and universal bubbles mixed with channel-scoped ones.

---

## Frontend Pattern Checks

| Check | Result |
|-------|--------|
| Data fetching via `useQuery`/`useMutation` | ✓ |
| API calls via `api.get()`/`api.post()` from `@/lib/api` | ✓ |
| `queryClient.invalidateQueries()` after mutations | ✓ (via `invalidate()` helper) |
| `toast.success()`/`toast.error()` from sonner | ✓ |
| Semantic tokens only (no hardcoded hex, no `bg-gray-*`) | ✓ (`bg-primary`, `text-muted-foreground`, `bg-muted`, `border-border`) |
| `leading-snug` on Thai text | ✓ |
| shadcn/ui + Radix UI + lucide-react only | ✓ (Globe icon from lucide-react) |
| Functional components + hooks only | ✓ |
| No raw `fetch()` calls | ✓ |

---

## Security Notes

- Frontend-only change — no new API endpoints, no backend guards affected.
- No sensitive data handling introduced.
- New `ChannelTabs` uses native `<button>` with `type="button"` (no unintended form submission) and `aria-pressed` (correct a11y pattern).

---

## Recommendation

**APPROVE** — well-structured feature with pure logic extracted for unit testing, correct use of all frontend patterns, and thoughtful UX details (badge suppression, filter label explanation, bubble cap applied to total not filtered count). INFO notes are non-blocking.
