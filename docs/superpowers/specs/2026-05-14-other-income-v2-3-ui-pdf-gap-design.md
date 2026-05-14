# Other Income v2.3 — UI PDF Gap Fixes

**Date:** 2026-05-14
**Module:** `apps/web/src/pages/other-income/`
**Source report:** `Other-Income-UI-Comparison-Report.pdf` (Production v2.1 vs Target Prototype, 14 พ.ค. 2569)

## Context

External UI comparison report identified 10 gaps. Audit of current codebase (post PR #827 v2.2) reveals 7 already shipped. Only 3 remain:

| # | Item | Status | Effort |
|---|---|---|---|
| 4 | Date Range Quick Chips on List Page | Missing | 1d |
| 5 | State Machine Bar + "ต้องอนุมัติ" badge | Partial | 0.5d |
| 6 | Internal Control Action Bar (purple frame) | Missing | 1d |

Items #5 and #6 are tightly coupled — both modify the bottom action bar on the Entry/View pages. Treat as one refactor.

## Goal

Close the remaining 3 UI gaps so the live module visually matches the accountant's target prototype. No backend changes — pure presentation layer.

## Non-goals

- Backend API changes (data shapes already support what we need)
- Mobile-only redesign (responsive only)
- Adding new states beyond DRAFT/READY/POSTED/REVERSED
- Changing the Maker-Checker policy (toggle behavior unchanged)

## Design

### 1. Date Range Quick Chips

**Location:** [`OtherIncomeListPage.tsx`](../../apps/web/src/pages/other-income/OtherIncomeListPage.tsx) — above the existing 2 date inputs at lines 282–295.

**Component:** New file `apps/web/src/pages/other-income/components/DateRangeChips.tsx`. Keep it private to the Other Income module for now; promote to shared if Expense/Asset modules ask for the same.

**UX:**

```
[ ทั้งหมด ] [ เดือนนี้ ] [ เดือนที่แล้ว ] [ ช่วงวันที่... ]      📅 พฤษภาคม 2569 (01/05 - 31/05)
```

| Chip | startDate | endDate | URL params |
|---|---|---|---|
| ทั้งหมด | (empty) | (empty) | none |
| เดือนนี้ (default) | 1st of current month BKK | today BKK | `?startDate=YYYY-MM-01&endDate=YYYY-MM-DD` |
| เดือนที่แล้ว | 1st of last month BKK | last day of last month BKK | same |
| ช่วงวันที่... | manual | manual | reveal existing 2 date inputs |

**Default change:** On first load with no URL params, select "เดือนนี้" (was "ทั้งหมด"). Existing URL params take priority (user can still deep-link to all-time).

**Right-side label:** Auto-derived summary string based on current `(startDate, endDate)`:

- Both empty → `"ทั้งหมด"`
- Single calendar month → `"พฤษภาคม 2569"`
- Single month partial → `"พฤษภาคม 2569 (01/05 - 14/05)"`
- Cross-month → `"1 เม.ย. - 14 พ.ค. 2569"`

**State management:** Drive from existing `startDate`/`endDate` `useState` in `OtherIncomeListPage`. Chips infer their active state by comparing to "today" each render — no extra state needed.

**Cleanup:** Remove the standalone "🧹 ล้าง" button at line 296 — the "ทั้งหมด" chip replaces it. The 2 date inputs remain visible only when "ช่วงวันที่..." chip is active (or when URL deep-link doesn't match a preset).

**Accessibility:** Chips are `<button role="radio">` inside a `<div role="radiogroup" aria-label="ช่วงวันที่">`.

### 2. Internal Control Bar (#5 + #6 combined)

**Component:** New file `apps/web/src/pages/other-income/components/InternalControlBar.tsx`.

**Used by:**
- [`OtherIncomeEntryPage.tsx`](../../apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx) — DRAFT/READY states (replaces existing sticky bar at lines 1131–1208)
- [`OtherIncomeViewPage.tsx`](../../apps/web/src/pages/other-income/OtherIncomeViewPage.tsx) — POSTED/REVERSED states (sticky bottom)

#### Visual structure (3 rows inside a purple-frame card)

```
┌─────────────────────────────────────────────────────────────────────┐
│  🔐 ควบคุมภายใน                                                       │
│  [👤 ผู้บันทึก: เอกนรินทร์]  [✓ ผู้อนุมัติ: เอกนรินทร์]  [⚠ ต้องอนุมัติ]    │  Row 1: pills
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│  ● DRAFT  ─ ─ ─  ○ READY  ─ ─ ─  ○ POSTED  ─ ─ ─  ○ REVERSED         │  Row 2: state machine
├─────────────────────────────────────────────────────────────────────┤
│              [← ยกเลิก]  [💾 บันทึกร่าง]  [✓ บันทึก & POST]            │  Row 3: actions
└─────────────────────────────────────────────────────────────────────┘
```

**Frame style:** `border-2 border-purple-500/30 bg-purple-500/[0.03] rounded-xl shadow-lg`. Use Tailwind-via-design-tokens-extension; the project does NOT use raw `bg-purple-500` elsewhere, so add `--accent-purple` token to `index.css`:

```css
--accent-purple: 280 60% 55%;
--accent-purple-foreground: 280 80% 95%;
```

Use as `border-[hsl(var(--accent-purple)/0.3)]` etc. This satisfies the "no hardcoded hex" rule in `.claude/rules/frontend.md`.

**Row 1 — Pills:**

| Pill | Visible when | Style |
|---|---|---|
| 👤 ผู้บันทึก: {name} | always | `bg-info/10 text-info` |
| ✓ ผู้อนุมัติ: {name} | always | `bg-success/10 text-success` |
| ⚠ ต้องอนุมัติ | `makerCheckerEnabled && status ∈ {DRAFT, READY}` | `bg-amber-500/15 text-amber-600` w/ tooltip |

Tooltip on "ต้องอนุมัติ": *"เอกสารนี้ต้องผ่านการอนุมัติก่อนลงบัญชี"*

**Row 2 — State Machine Bar:**

- Default 4 dots: `DRAFT → READY → POSTED → REVERSED`
- When `!makerCheckerEnabled`: collapse to 3 dots `DRAFT → POSTED → REVERSED`
- Active dot: `w-3 h-3 rounded-full bg-primary ring-4 ring-primary/20`, label below in `text-primary font-medium`
- Past dots: `bg-muted-foreground` solid, label `text-muted-foreground`
- Future dots: `border-2 border-border bg-background`, label `text-muted-foreground/60`
- Connector lines: `border-t-2 border-dashed border-border`
- Dots resolve their visual state purely from current `status` vs their position: dots before current = past (solid muted), the matching one = active (primary), dots after = future (outline). REVERSED is always rendered as the last dot — it appears as "future" when status is DRAFT/READY/POSTED and "active" only when status === REVERSED.

**Row 3 — State-aware buttons:**

| Status | Maker-Checker | Buttons (left → right) | onClick |
|---|---|---|---|
| DRAFT | OFF | `← ยกเลิก`, `💾 บันทึกร่าง`, `✓ บันทึก & POST` | onCancel, onSaveDraft, onPost |
| DRAFT | ON | `← ยกเลิก`, `💾 บันทึกร่าง`, `📤 ส่งให้อนุมัติ` | onCancel, onSaveDraft, onSubmitForApproval |
| READY | ON, viewer is approver | `← กลับ`, `❌ ปฏิเสธ`, `✓ อนุมัติ & POST` | onCancel, onReject, onApprove |
| READY | ON, viewer is maker | `← กลับ`, (read-only banner: "รออนุมัติ") | onCancel only |
| POSTED | any | `← ปิด`, `↩ กลับรายการ` | onCancel, onReverse |
| REVERSED | any | `← ปิด` | onCancel |

Buttons follow existing shadcn/ui `Button` variants: `variant="ghost"` for cancel, `variant="outline"` for save-draft, `variant="default"` for primary action, `variant="destructive"` for reject/reverse.

#### Component API

```ts
interface InternalControlBarProps {
  status: 'DRAFT' | 'READY' | 'POSTED' | 'REVERSED';
  recorder: { name: string };
  approver: { name: string };
  makerCheckerEnabled: boolean;
  isViewerApprover?: boolean;  // for READY → which buttons to show
  isLoading?: boolean;

  onCancel: () => void;
  onSaveDraft?: () => void;
  onPost?: () => void;
  onSubmitForApproval?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onReverse?: () => void;
}
```

Caller passes only the handlers relevant to its page — the component picks the right ones based on `status` + `makerCheckerEnabled`.

#### Removals

- **Section 7 card** in `OtherIncomeEntryPage.tsx` (lines 972–1000) — entire `<section>` block. The "ระบบกำหนดอัตโนมัติตาม user" hint becomes a `title` attribute on the ผู้บันทึก pill instead.
- **Existing sticky bar** in `OtherIncomeEntryPage.tsx` (lines 1131–1208) — replaced wholesale by `<InternalControlBar />`.
- **View page action bar** in `OtherIncomeViewPage.tsx` — wire through `<InternalControlBar />`. The right-side sticky sidebar (line 563) stays — it's a different surface (summary), not the action bar.

#### Responsive behavior

- ≥768px (desktop): 3 stacked rows as shown above
- <768px (mobile):
  - Row 1: pills wrap to 2 lines if needed (no scroll)
  - Row 2: state machine collapses to `"สถานะ: ● DRAFT"` text only (no dots)
  - Row 3: buttons remain horizontal — they're max 3, all fit on phone widths

### 3. Spec for sequencing

Build in this order — each is independently shippable:

1. **DateRangeChips component** + wire to list page (smallest, no shared deps)
2. **InternalControlBar component** standalone with Storybook-style mock page or test renders (no integration yet)
3. **Wire InternalControlBar into Entry Page** — remove Section 7, remove old sticky bar
4. **Wire InternalControlBar into View Page** — POSTED/REVERSED states

Steps 1 and 2 can run in parallel. Steps 3 and 4 depend on step 2.

## Testing

**Unit tests:**

- `DateRangeChips.test.tsx`: each chip click produces the correct `(startDate, endDate)` tuple. Label formatter handles single-month, partial-month, cross-month cases.
- `InternalControlBar.test.tsx`: for each `(status, makerCheckerEnabled, isViewerApprover)` triple, the correct buttons render and the correct handlers fire.

**Manual smoke (post-merge):**

- Visit `/other-income` → verify "เดือนนี้" is selected by default, list filters correctly
- Click each chip → URL params update, list refetches
- Visit `/other-income/new` → confirm Section 7 card is gone, sticky bottom bar shows pills + state machine + 3 buttons in purple frame
- Toggle Maker-Checker ON in Settings → reload entry page → "ต้องอนุมัติ" badge appears, "บันทึก & POST" button text changes to "ส่งให้อนุมัติ"
- Visit any POSTED doc → bar shows `← ปิด` + `↩ กลับรายการ`, state machine dot on POSTED

**Regression risk:**

- Existing `OtherIncomeEntryPage` users-may-have-bookmarked-draft flow: ensure cancel/save-draft handlers still resolve the same way.
- Maker-Checker toggle: state-machine should immediately re-render when toggle flips (it does — `makerCheckerEnabled` is a React-Query value that bubbles re-renders).

## Out of scope

- Storybook setup (not used in this project)
- Animated state machine transitions (CSS transitions only, no motion library)
- Audit log entries (status changes already audited at the API layer)
- Notifications/emails when entering READY state (separate feature)
