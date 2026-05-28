# Pre-Merge Guard Report — 2026-05-28

**Reviewed by:** Pre-Merge Guard agent  
**Date:** 2026-05-28  
**Branches reviewed:** 3 (most recently active feat/fix branches not yet guard-reviewed)

---

## Summary Table

| Branch | Files Changed | Critical | Warning | Info | Recommendation |
|--------|--------------|----------|---------|------|----------------|
| `fix/letters-e2e-sales-assertion` | 1 | 0 | 0 | 0 | ✅ APPROVE |
| `feat/canned-response-channel-tabs` | 5 | 0 | 1 | 1 | ⚠️ REVIEW |
| `feat/data-deletion-page` | 2 | 0 | 0 | 1 | ✅ APPROVE |

---

## Branch 1: `fix/letters-e2e-sales-assertion`

**Author:** Akenarin Kongdach  
**Commit:** `8f3439b` — `fix(letters): E2E SALES assertion was matching CANCELLED tab button`  
**Last updated:** 2026-05-26

### File Changes
```
apps/web/e2e/letters-page.spec.ts | 12 ++++++++----
1 file changed, 8 insertions(+), 4 deletions(-)
```

### What changed
The E2E test for the `/letters` page (SALES role) was previously asserting that the "ยกเลิก" cancel button doesn't appear. That assertion was a false-positive failure because the "CANCELLED" status tab also renders a button with the text "ยกเลิก", causing `getByRole('button', { name: 'ยกเลิก' })` to match the tab label, not the per-row cancel button.

The fix renames the test to match its actual intent ("SALES can access /letters without redirect") and replaces the brittle button-count assertion with a heading visibility check and a URL assertion. The underlying security guarantee (SALES cannot cancel letters) is correctly noted as being enforced by the API `@Roles` guard + unit tests.

### Issues Found

*None.*

### Recommendation: ✅ APPROVE

Pure test correctness fix. No security, financial, or data integrity concerns. The fix removes a flawed assertion without weakening actual test coverage (API role enforcement is tested separately).

---

## Branch 2: `feat/canned-response-channel-tabs`

**Author:** Akenarin Kongdach  
**Commits:** 2 commits (feature + review followups)  
**Last updated:** 2026-05-25

### File Changes
```
apps/web/src/pages/canned-response-admin/BubbleList.tsx          | 86 ++++++++++++++----
apps/web/src/pages/canned-response-admin/ChannelTabs.tsx          | 63 ++++++++++++++ (new)
apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx   | 17 +++-
apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts  | 31 +++++++ (new)
apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts | 100 ++++++++++++++ (new)
5 files changed, 277 insertions(+), 20 deletions(-)
```

### What changed
Adds per-channel filtering tabs (LINE_FINANCE, FACEBOOK, TikTok, etc.) to the canned-response template editor. When a specific channel tab is active:
- Only bubbles assigned to that channel are shown
- New bubbles created under the tab are automatically scoped to that channel
- Drag-and-drop reorder operates on the **full** bubble array (not just the visible subset), preserving cross-channel ordering
- Tab badges show per-channel bubble counts

The drag-and-drop reorder logic was extracted into a pure function `reorderBubbles()` with 7 unit tests covering cross-channel reordering edge cases.

### Issues Found

#### ⚠️ Warning — Unstable `allBubbles` reference in `useEffect` dep array

**File:** `BubbleList.tsx` (line ~80)  
**Code:**
```tsx
const allBubbles = bubblesQ.data ?? [];   // new [] reference every render when loading

useEffect(() => {
  if (!onCountsChange) return;
  // ...
  onCountsChange(counts);
}, [allBubbles, onCountsChange]);           // allBubbles is unstable during loading
```

When `bubblesQ.data` is `undefined` (initial loading state), `bubblesQ.data ?? []` produces a new empty array reference on every render. Since `useEffect` uses referential equality for dependency comparison, this causes the effect to fire on every render during the loading phase — triggering `onCountsChange(counts)` (which calls `setBubbleCounts`) on every render, which triggers another render, creating a rapid cascade.

**Fix:**
```tsx
const rawBubbles = bubblesQ.data;
const allBubbles = rawBubbles ?? [];

useEffect(() => {
  if (!onCountsChange || !rawBubbles) return;  // only fire after data resolves
  // ...
}, [rawBubbles, onCountsChange]);
```
Or alternatively: `useMemo(() => bubblesQ.data ?? [], [bubblesQ.data])`.

**Severity:** Warning — causes excessive renders/state updates during loading but does not produce incorrect data or security issues. In practice the loading phase is brief and `setState` is batched by React 18, so it may not be visually apparent.

---

#### ℹ️ Info — `useEffect` missing stable empty-array guard

**File:** `BubbleList.tsx`  
In the `onCountsChange` effect, if called before data has loaded, it reports `counts = { ALL: 0, LINE_FINANCE: 0, ... }`. This is functionally harmless but mildly misleading — tab badges would briefly show 0 on every channel during load. Addressed by the same fix above (guard with `if (!rawBubbles) return`).

### Architecture Notes (positive)
- ✅ Uses `api.get()` / `api.post()` correctly — no raw fetch
- ✅ `queryClient.invalidateQueries()` called after all mutations
- ✅ Pure function `reorderBubbles` extracted and unit-tested (7 cases)
- ✅ All Tailwind tokens semantic — no hardcoded hex colors
- ✅ `leading-snug` used consistently on Thai text
- ✅ `button` elements have `type="button"` — no accidental form submits
- ✅ `aria-pressed` used correctly on tab buttons
- ✅ 5-bubble cap correctly checked against `allBubbles.length` (total), not filtered count

### Recommendation: ⚠️ REVIEW

One Warning to address before merge. The fix is a one-liner (`useMemo` or guard). No Critical issues.

---

## Branch 3: `feat/data-deletion-page`

**Author:** Akenarin Kongdach  
**Commit:** `1e38eee` — `feat(privacy): add public /privacy/data-deletion instructions page`  
**Last updated:** 2026-05-24

### File Changes
```
apps/web/src/App.tsx                    |   2 +
apps/web/src/pages/DataDeletionPage.tsx | 123 +++++++++++++++++++++++++++++++++
2 files changed, 125 insertions(+)
```

### What changed
Adds a public static page at `/privacy/data-deletion` serving as the "Data Deletion Instructions URL" required by Meta's Facebook App settings for PDPA/GDPR compliance. The page:
- Explains how users can request data deletion (email, LINE OA, phone)
- Lists identity verification requirements
- States the 30-day processing SLA
- Documents legal exceptions (active installment contracts, tax document retention)
- Includes a Thai-language primary section + English summary for Meta's reviewers

The route is intentionally public (no `ProtectedRoute` wrapper), matching the existing `/privacy` route pattern.

### Issues Found

#### ℹ️ Info — Date string will require manual maintenance

**File:** `DataDeletionPage.tsx` line 20  
```tsx
<p className="mt-1 text-sm text-muted-foreground">
  ปรับปรุงล่าสุด: 24 พฤษภาคม 2569
</p>
```
The "last updated" date is hardcoded. When the policy content changes, this requires a manual code update. Consider extracting to a constant at the top of the file.  
**Severity:** Info — no functional impact.

### Architecture Notes (positive)
- ✅ Correctly public (no auth guard) — matching requirement for Meta's URL
- ✅ Correctly lazy-loaded: `const DataDeletionPage = lazy(() => import('@/pages/DataDeletionPage'))`
- ✅ Uses semantic design tokens throughout (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`)
- ✅ `leading-snug` used consistently on all Thai text blocks
- ✅ No API calls — purely static, no backend risk surface
- ✅ No hardcoded secrets — contact info (email, phone, LINE OA handle) is intentionally public business contact information
- ✅ `mailto:` subject pre-filled with Thai PDPA phrase — good UX detail
- ✅ Date uses correct Buddhist Era year (BE 2569 = CE 2026)

### Recommendation: ✅ APPROVE

Clean, minimal static page. No security, financial, or data integrity concerns. The only note is the hardcoded date constant, which is Info-level.

---

## Critical Issues Requiring Immediate Action

**None.** No controller-level guard failures, no `Number()` on financial fields, no missing `deletedAt: null` filters, no hardcoded secrets, and no SQL injection patterns were found across all three branches.

---

## Action Items Before Merge

| Branch | Action | Assignee |
|--------|--------|---------|
| `feat/canned-response-channel-tabs` | Fix `allBubbles` reference instability in `useEffect` — use `useMemo` or guard with `rawBubbles` | Author |

---

*Report generated by Pre-Merge Guard agent — BESTCHOICE monorepo*
