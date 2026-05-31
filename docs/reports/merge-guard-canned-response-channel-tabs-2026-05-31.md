# Merge Guard Report — feat/canned-response-channel-tabs

**Date:** 2026-05-31  
**Branch:** `feat/canned-response-channel-tabs`  
**Last commit:** 2026-05-25 — `fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs`  
**Recommendation:** ✅ **APPROVE**

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +66/−20 — channel filter prop + count reporting |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | New file — tab UI component (63 lines) |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17/−1 — wires ChannelTabs into editor pane |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | New file — pure reorder helper (31 lines) |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | New file — 9 unit tests for reorder logic |

All changes are frontend-only. No backend, no Prisma schema, no DTOs.

---

## Issue Analysis

### Critical (must fix before merge)
None found.

### Warning (should fix)
None found.

### Info

- **`(r: any)` in queryFn** (`BubbleList.tsx:41`) and **`(e: any)` in onError** (`BubbleList.tsx:82`): Pre-existing pattern used throughout the codebase for api.get responses and mutation error handlers. Not introduced by this branch.

---

## Detailed Findings

### Frontend patterns ✅
- Uses `api.get()` / `api.post()` from `@/lib/api` — no raw `fetch()`.
- `useMutation` / `useQuery` from `@tanstack/react-query` only.
- `queryClient.invalidateQueries()` called correctly after createMut and updateMut successes.
- `toast.error()` from sonner for error feedback.

### Design tokens ✅
- `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `border-border`, `hover:bg-muted/70`, `bg-background` — all semantic tokens, no hardcoded hex colors.
- `leading-snug` used on all Thai text nodes.

### Reorder logic extraction ✅
`reorderBubbles()` is correctly extracted to `bubble-reorder-logic.ts` as a pure function and tested in isolation. The critical insight — that drag-and-drop should operate on `allBubbles` (not `visibleBubbles`) to preserve cross-channel `sortOrder` — is well-implemented and covered by 6 regression tests including the mixed-channel scenario.

### Channel count badge logic ✅
The badge suppression heuristic (hide per-channel badge when `count === allCount`, indicating all bubbles are universal) is correct: it avoids showing identical counts on every tab when there's no per-channel segmentation.

### 5-bubble cap scoping ✅
`canAdd` is correctly gated on `allBubbles.length < 5`, not `visibleBubbles.length < 5` — the LINE push limit applies to the total, not per-channel.

---

## Verdict

Well-structured feature addition. Logic is properly isolated and unit-tested. All frontend rules followed.
