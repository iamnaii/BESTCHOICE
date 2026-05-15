# Asset UI Polish PR 2b — Implementation Plan

> All implementer + reviewer subagents use `model="opus"` per owner directive.

**Goal:** Ship final 9 items P9-P17 from accountant ImplementationReview v1.2 (Day 3).

**Architecture:** UI-only changes for P9/P11/P12/P14/P15/P16/P17. P10 is medium (group cards refactor). P13 is the largest (cross-cutting account-name join, backend + frontend).

**Spec:** [docs/superpowers/specs/2026-05-15-asset-ui-polish-pr2b-design.md](../specs/2026-05-15-asset-ui-polish-pr2b-design.md)

---

## File Structure (summary)

See spec §12 for full file list. Key files:
- `AssetEntryPage.tsx` (P9 sticky footer)
- `AssetSummaryReportPage.tsx` (P10 group cards — biggest UI refactor)
- `AssetRegisterPage.tsx` (P11+P12+P16)
- `AssetEntrySection2Cost.tsx` (P15 VAT/WHT styling)
- `AssetsListPage.tsx` (P14 breadcrumb)
- `AssetStatusBadge.tsx` (P16 colors)
- `DepreciationPage.tsx` (P17 reverse button)
- JE preview render sites (P13 chart_of_accounts join — multiple files)

---

## Task 1: Small UI polish bundle (P11 + P12 + P14 + P15)

These are all small CSS/JSX edits — bundle into one commit.

- [ ] **Step 1: P11 filter row baseline**

`apps/web/src/pages/assets/AssetRegisterPage.tsx` — find the filter row (date picker + dropdowns + search input). Wrap each control in `<div className="space-y-1">` with consistent label-input structure. Ensure parent grid uses `items-end` or set label height uniformly.

- [ ] **Step 2: P12 table header styling**

Same file — find the `<TableHead>` / `<thead>` element of the main register table. Add Tailwind classes for contrast: `bg-muted/60` + `font-semibold` + `border-b-2`. Match existing table patterns elsewhere in the codebase if a richer pattern exists.

- [ ] **Step 3: P14 breadcrumb**

`apps/web/src/pages/assets/AssetsListPage.tsx` — add Breadcrumb component above `<PageHeader>`. First check whether `<PageHeader>` already accepts a `breadcrumb` prop:

```bash
grep -n "breadcrumb" apps/web/src/components/ui/PageHeader.tsx
```

If yes, pass:
```tsx
<PageHeader
  breadcrumb={[
    { label: 'หน้าหลัก', href: '/' },
    { label: 'สินทรัพย์', href: '/assets' },
    { label: 'รายการเอกสารทั้งหมด' },
  ]}
  ...existing props
/>
```

If `PageHeader` doesn't accept a breadcrumb prop, render a standalone `<Breadcrumb>` component above PageHeader.

- [ ] **Step 4: P15 VAT/WHT subsection styling**

`apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx` — find the VAT toggle block and WHT toggle block. Wrap each:

```tsx
{/* VAT block */}
<div className="border-l-4 border-violet-500 bg-violet-50/30 dark:bg-violet-950/30 rounded-r-lg p-3 space-y-3">
  {/* existing VAT inputs */}
</div>

{/* WHT block */}
<div className="border-l-4 border-amber-500 bg-amber-50/30 dark:bg-amber-950/30 rounded-r-lg p-3 space-y-3">
  {/* existing WHT inputs */}
</div>
```

- [ ] **Step 5: Type check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/asset-ui-polish-pr2b && ./tools/check-types.sh web
```

```bash
git add -A && git commit -m "feat(assets): P11+P12+P14+P15 small UI polish (filter alignment, table header, breadcrumb, VAT/WHT styling)"
```

---

## Task 2: P9 Sticky Footer

`apps/web/src/pages/assets/AssetEntryPage.tsx` — convert the bottom button row to a sticky footer.

- [ ] **Step 1: Locate current button row**

```bash
grep -n "ยกเลิก\|บันทึกร่าง\|บันทึก.*POST" apps/web/src/pages/assets/AssetEntryPage.tsx
```

- [ ] **Step 2: Wrap in sticky container**

Replace the existing button row's parent `<div>` with:

```tsx
<div className="sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-t border-border">
  <div className="flex items-center justify-between gap-3 max-w-screen-lg mx-auto">
    <div className="flex items-center gap-2 text-xs">
      {/* Validation summary */}
      {errorKeys.length > 0 ? (
        <span className="inline-flex items-center gap-1 text-destructive">
          <AlertCircle className="size-3.5" />
          พบ {errorKeys.length} ข้อผิดพลาด
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <CheckCircle2 className="size-3.5" />
          ผ่านการตรวจสอบ
        </span>
      )}
      {calc?.isBalanced && (
        <span className="inline-flex items-center gap-1 text-emerald-600 ml-2">
          Σ Dr = Σ Cr ({formatNumberDecimal(calc.totalDr ?? 0)})
        </span>
      )}
    </div>
    <div className="flex items-center gap-2">
      {/* existing buttons: ยกเลิก / บันทึกร่าง / บันทึก & POST */}
    </div>
  </div>
</div>
```

(Adapt variable names like `errorKeys` and `calc` to match what's actually in scope at the bottom of the component. Verify with grep.)

- [ ] **Step 3: Type check + commit**

```bash
git add apps/web/src/pages/assets/AssetEntryPage.tsx && git commit -m "feat(assets): P9 sticky footer with validation status + action buttons"
```

---

## Task 3: P17 Reverse button in depreciation history

`apps/web/src/pages/depreciation/DepreciationPage.tsx`

- [ ] **Step 1: Locate history table action column**

```bash
grep -n "history\|action\|ประวัติ" apps/web/src/pages/depreciation/DepreciationPage.tsx
```

- [ ] **Step 2: Check for existing reverse mutation**

```bash
grep -rn "reverse\|gainsay\|cancel" apps/web/src/pages/depreciation/
```

If a reverse mutation hook exists, reuse it. If not, identify the API endpoint by checking apps/api/src/modules/depreciation for a POST `:id/reverse` or similar.

- [ ] **Step 3: Add Reverse button**

For each row in the history table, conditionally render:

```tsx
{row.status === 'POSTED' && (
  <Button variant="ghost" size="sm" onClick={() => openReverseDialog(row.id)}>
    <RotateCcw className="size-3.5 mr-1" /> กลับรายการ
  </Button>
)}
```

Add a confirm dialog before performing the reverse. Reuse existing `ConfirmDialog` pattern from the codebase.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(depreciation): P17 reverse button in monthly run history table"
```

---

## Task 4: P16 PDF Export + Status Badge colors

### Part A — PDF Export

`apps/web/src/pages/assets/AssetRegisterPage.tsx`

- [ ] **Step 1: Locate existing export buttons (CSV + Excel)**

```bash
grep -n "Export\|CSV\|Excel" apps/web/src/pages/assets/AssetRegisterPage.tsx
```

- [ ] **Step 2: Add PDF print button**

Simplest approach — `window.print()` with print-friendly CSS:

```tsx
<Button variant="outline" size="sm" onClick={() => window.print()}>
  <FileText className="size-4 mr-1" /> พิมพ์ PDF
</Button>
```

Then add a print stylesheet section at the top of the file or in a sibling `.css` to ensure the register table prints cleanly:

```tsx
<style media="print">{`
  .no-print { display: none !important; }
  /* hide sidebar / filters / actions when printing */
`}</style>
```

Or check if `apps/web/src/index.css` already has print-friendly classes.

### Part B — Status Badge colors

`apps/web/src/pages/assets/components/AssetStatusBadge.tsx`

- [ ] **Step 3: Update color map**

```tsx
const STATUS_VARIANT = {
  DRAFT:       'bg-muted text-muted-foreground',
  POSTED:      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  REVERSED:    'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  DISPOSED:    'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  WRITTEN_OFF: 'bg-red-500/15 text-red-700 dark:text-red-400',
  FULLY_DEPR:  'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400',
};
```

(Verify the existing status enum values and adapt — `FULLY_DEPR` may not be a real persisted status; could be a derived UI-only status. Check before adding.)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(assets): P16 PDF print button + status badge color coding"
```

---

## Task 5: P10 Group Cards Summary Report

`apps/web/src/pages/assets/AssetSummaryReportPage.tsx` — refactor `category` tab from flat table to group cards.

- [ ] **Step 1: Inspect current category-tab structure**

```bash
sed -n '100,150p' apps/web/src/pages/assets/AssetSummaryReportPage.tsx
```

- [ ] **Step 2: Group data by category client-side**

The API returns a flat list. Group in a `useMemo`:

```tsx
const grouped = useMemo(() => {
  const map = new Map<AssetCategory, SummaryRow[]>();
  for (const row of rows ?? []) {
    if (!map.has(row.category)) map.set(row.category, []);
    map.get(row.category)!.push(row);
  }
  return Array.from(map.entries());
}, [rows]);
```

- [ ] **Step 3: Render group cards**

For each category, render a `<Card>` with:
- `<CardHeader>` showing category icon + Thai name + 3 totals (sum within group)
- `<CardContent>` with the existing table for items in this category + subtotal row

After all groups, render a Grand Total footer card.

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh web && git add -A && git commit -m "feat(assets): P10 group cards summary report with grand total"
```

---

## Task 6: P13 Chart of Accounts join (cross-cutting)

This is the largest task. Render account codes WITH names everywhere.

- [ ] **Step 1: Enumerate render sites for accountCode**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/asset-ui-polish-pr2b && grep -rn "accountCode" apps/web/src/pages/assets apps/web/src/pages/depreciation | head -30
```

Identify each site. For each, check if the data shape already includes `accountName` (via API include) or not.

- [ ] **Step 2: For sites where accountName is already available, render it**

Change e.g.:
```tsx
<span className="font-mono">{line.accountCode}</span>
```

to:
```tsx
<span className="font-mono">{line.accountCode}</span>
<span className="text-muted-foreground ml-1">{line.accountName ?? ''}</span>
```

- [ ] **Step 3: For sites where accountName is NOT available, identify the API + add the join**

Search for endpoints that return JournalEntryLine without `chartOfAccount` include:

```bash
grep -rn "findMany\|findUnique\|findFirst" apps/api/src/modules/journal apps/api/src/modules/depreciation 2>/dev/null | grep -i "journalEntryLine\|JournalEntryLine" | head -10
```

For each query missing the `chartOfAccount` include, add:

```ts
include: {
  chartOfAccount: {
    select: { code: true, name: true },
  },
}
```

Then update the response DTO type to include `chartOfAccount: { code: string; name: string } | null` on the line.

- [ ] **Step 4: For frontend rendering, prefer the joined data**

Use `line.chartOfAccount?.name ?? line.accountName ?? ''` to gracefully degrade if old data lacks the join.

- [ ] **Step 5: Anti-regression test**

Add a small jest test asserting that the API endpoint for `/depreciation/preview` or `/assets/:id/journal-preview` (whichever exists) includes account names:

```ts
it('JE preview includes account name from chart_of_accounts', async () => {
  const result = await controller.preview(...);
  expect(result.lines[0].chartOfAccount?.name).toBeDefined();
});
```

(Adapt the controller / method names to what exists. If the endpoint doesn't exist as such, find the closest equivalent.)

- [ ] **Step 6: Type check + commit**

```bash
./tools/check-types.sh all && git add -A && git commit -m "feat(assets): P13 chart_of_accounts join — render account names everywhere, no hardcode"
```

---

## Task 7: Final integration

- [ ] **Step 1: Type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/.claude/worktrees/asset-ui-polish-pr2b && ./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 2: All tests**

```bash
cd apps/web && npx vitest run src/pages/assets/__tests__/ src/pages/depreciation/__tests__/
cd ../api && npx jest src/modules/asset/__tests__/ src/modules/depreciation/__tests__/ 2>&1 | tail -10
```

Expected: existing pass (~22 from PR #846), new tests added by P13 Task 6 also pass.

- [ ] **Step 3: NBV terminology re-grep**

```bash
grep -rn "'NBV'\|\"NBV\"\|>NBV<" apps/web/src 2>/dev/null | grep -v "//\|netBookValue\|\bnbv\b"
```

Expected: 0 (carried from PR #846).

- [ ] **Step 4: Manual UAT checklist (post-deploy)**

For each role (OWNER / FINANCE_MANAGER / ACCOUNTANT):
- [ ] `/assets/new` → Section 2 → VAT block has violet border + WHT block has amber border (P15)
- [ ] `/assets/new` → bottom of form → sticky footer with validation chip + 3 buttons (P9)
- [ ] `/assets` → top of page → Breadcrumb (P14)
- [ ] `/assets/register` → filter row aligned (P11), thead styled (P12), PDF button works (P16a), status badges colored (P16b)
- [ ] `/assets/summary-report` → category tab shows group cards + grand total (P10)
- [ ] `/depreciation` → history table has Reverse button on POSTED rows (P17)
- [ ] `/assets/new` → Section 4 JE preview → each row shows "53-1601 ค่าเสื่อมราคา-อุปกรณ์" (code + name) (P13)
- [ ] `/depreciation` Preview JV → same code + name format (P13)

- [ ] **Step 5: No additional commit. Branch ready for PR.**
