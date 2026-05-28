# Merge Guard Report — feat/canned-response-channel-tabs

**Date**: 2026-05-28
**Branch**: `feat/canned-response-channel-tabs`
**Author**: Akenarin Kongdach
**Last commit**: `d7b6c4bf` — fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +54/-16 — channel filter prop + badge count reporting |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 new file — tab UI component |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17/-3 — wires ChannelTabs + state |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 new file — pure reorder utility |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 new file — 7 unit tests |

**5 files changed, 277 insertions(+), 20 deletions(-)**

---

## Issues by Severity

### Critical — none found

- No backend changes; no missing guards, no missing `deletedAt` filters.
- No `Number()` on financial fields.
- No raw `fetch()` calls — all API calls go through `api.post()` / `api.get()` from `@/lib/api` ✓
- No hardcoded hex colors — uses `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `bg-background`, `border-border` ✓

### Warning — none found

- `queryClient.invalidateQueries()` is called via the `invalidate()` helper after every mutation ✓
- `toast.error()` from `sonner` used for error feedback ✓
- `useEffect` in `BubbleList` lists `allBubbles` and `onCountsChange` as dependencies. `onCountsChange` is `setBubbleCounts` from `useState` in the parent — a stable reference — so no infinite re-render risk.
- The 5-bubble cap is correctly applied to `allBubbles.length` (total across all channels), not `visibleBubbles.length`. The UI copy clarifies this: "ถึงขีดจำกัด 5 บับเบิ้ลแล้ว (รวมทุก channel)" ✓

### Info

- `ChannelTabs.tsx` is 63 lines — well within the 500-line guideline.
- `bubble-reorder-logic.ts` is a pure function (31 lines) extracted out of `BubbleList` — good for testability.
- `bubble-reorder-logic.test.ts` provides 7 unit tests including the non-trivial cross-channel drag edge case (LINE bubble dragged while FB bubbles are hidden).
- `leading-snug` used consistently on Thai text ✓

---

## Logic Correctness Check

### Channel filter logic (BubbleList.tsx)

```ts
const visibleBubbles =
  channelFilter === 'ALL'
    ? allBubbles
    : allBubbles.filter(
        (b) => (b.channels ?? []).length === 0 || (b.channels ?? []).includes(channelFilter),
      );
```

Correct: universal bubbles (`channels === []`) are visible in every channel tab. Channel-scoped bubbles only appear in their specific tab or ALL.

### Reorder logic (bubble-reorder-logic.ts)

The drag-and-drop reorder operates on `allBubbles` (not the filtered subset). This is the correct approach — it preserves the relative ordering of hidden bubbles while moving the dragged item to the correct global position. Unit tests cover:
- Basic reorder ✓
- Cross-channel (LINE dragged, FB hidden) — hidden bubbles stay in place ✓
- Identity (no-op when from === to) ✓
- Missing id fallback (no-op) ✓
- Universal + channel-scoped coexistence ✓

### Channel-scoped new bubble creation

When a specific channel tab is active, `createMut` passes `channels: [channelFilter]` in the POST body. When ALL tab is active, `channels: []` (universal). This matches the expected server-side semantics.

### queryKey includes presetContractId concern

N/A for this branch — this fix is in `hotfix/defect-exchange-preset-contract-visibility`.

---

## Test Coverage

100 lines of unit tests in `bubble-reorder-logic.test.ts` covering 7 distinct scenarios. No E2E tests added, but the pure-function extraction makes the critical reorder logic fully testable without a browser.
