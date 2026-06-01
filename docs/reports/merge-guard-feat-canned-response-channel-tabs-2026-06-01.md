# Merge Guard Report — feat/canned-response-channel-tabs

**Date:** 2026-06-01  
**Branch:** `feat/canned-response-channel-tabs`  
**Reviewed against:** `origin/main`

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +54 / −20 | Channel-filter logic + `onCountsChange` callback |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 | New component — tab bar with per-channel badge counts |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 / −1 | Wire `ChannelTabs` + `activeChannel` state |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 | Pure reorder helper, extracted for testability |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 | 8 unit tests covering filter-aware reorder edge cases |

---

## Issues by Severity

### Critical — None

No backend controller changes. Frontend-only feature operating on an existing `/staff-chat/canned-responses/:id/bubbles` endpoint.

### Warning — None

### Info

- **`useEffect` dependency on `onCountsChange`** — `BubbleList` passes `onCountsChange` as a `useEffect` dep. In `TemplateEditorPane`, this prop is `setBubbleCounts` — a React state setter, which is stable across renders. No infinite re-render risk. If a future consumer passes a new inline function on every render it would cause extra effects; worth a JSDoc comment if the component is reused outside its current context.

- **Design tokens** — `ChannelTabs.tsx` uses only semantic tokens (`bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `bg-background`, `border-border`, `hover:bg-muted/70`). No hardcoded hex or `gray-*` classes. ✅

- **`leading-snug` on Thai text** — confirmed present on all new Thai-text elements (`<p className="text-[11px] text-muted-foreground leading-snug">` etc.). ✅

- **Reorder logic with filtered view** — `reorderBubbles` intentionally operates on `allBubbles` (not filtered), with the dragged item landing at the global index of `overId`. This correctly preserves the relative order of hidden bubbles. The test suite covers the key edge case (LINE/FB interleaved with cross-channel drag). ✅

- **`canAdd` cap** — the 5-bubble cap is checked against `allBubbles.length`, not `visibleBubbles.length`, which is correct (LINE push limit applies to total, not per-channel). UI communicates this clearly: "ถึงขีดจำกัด 5 บับเบิ้ลแล้ว (รวมทุก channel)". ✅

- **`aria-pressed`** on tab buttons in `ChannelTabs.tsx` — correct a11y pattern for toggle buttons. ✅

---

## Recommendation

**✅ APPROVE**

Well-structured feature with extracted pure logic, 100-line test coverage for the non-trivial reorder-under-filter case, correct semantic token usage, and no security surface changes. Badge-badge suppression logic (per-channel badge hidden when equal to ALL count) is a nice UX polish that avoids noise when all bubbles are universal.
