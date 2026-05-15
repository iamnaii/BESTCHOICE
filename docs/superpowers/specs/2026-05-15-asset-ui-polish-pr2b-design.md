# Asset Module — PR 2b Design: P9-P17 (Day 3 polish + chart-of-accounts join)

**Date:** 2026-05-15
**Branch:** `feat/asset-ui-polish-pr2b` (off PR #846 `feat/asset-ui-polish-pr2a`)
**Scope:** Last 9 items P9-P17 from accountant's ImplementationReview v1.2 Day 3
**Effort:** ~7-8 hours (accountant estimated 4.5hr but P10 + P13 are larger than estimated)

---

## 1. Context

PR #845 shipped P1+P2. PR #846 shipped P3-P8. This PR ships **P9-P17** — completing the 17-item accountant backlog.

Owner directive remains: **"ทำตาม PDF เท่านั้น"** + use Opus for all subagent dispatches.

---

## 2. Scope per PDF §8 (Action Plan rows 9-17)

| # | Page | Change | ETA |
|---|------|--------|-----|
| **P9** | AssetEntryPage (whole form) | Sticky Footer with validation status + buttons (ยกเลิก / บันทึกร่าง / บันทึก & POST) | 1hr |
| **P10** | AssetSummaryReportPage | flat table → Group Cards per category + Grand Total footer | 2hr |
| **P11** | AssetRegisterPage | Align "ณ วันที่" date picker baseline with adjacent filter dropdowns | 15min |
| **P12** | AssetRegisterPage | `<thead>` background gradient + bolder font for contrast vs body rows | 15min |
| **P13** | Cross-cutting (JE preview + Reports + Schedule) | Account codes must render with account name from chart_of_accounts (join, no hardcode) | 1hr |
| **P14** | AssetsListPage | Breadcrumb "หน้าหลัก › assets › รายการเอกสารทั้งหมด" | 30min |
| **P15** | AssetEntrySection2Cost | VAT subsection violet border-left · WHT subsection amber border-left | 30min |
| **P16** | AssetRegisterPage | (a) PDF Export button + (b) Status Badge colors (POSTED green / DISPOSED purple / WRITE-OFF red / FULLY DEPR gray) | 1hr |
| **P17** | DepreciationPage | Reverse button in history table action column | 1hr |

**Total: 7.5 hours**

### P13 — Chart of Accounts join (architectural)

PDF page 11+13 (P13):
> รหัสบัญชี ต้องแสดงชื่อบัญชีต่อท้ายทุกที่ (เช่น "53-1601 [ชื่อบัญชี]") ดึงจาก ผังบัญชี (Chart of Accounts) ห้าม hardcode — Backend join journal_entry_line × chart_of_accounts บน account_code

**Approach:**
1. Verify whether existing `JournalEntryLine` queries already include `chartOfAccount` relation; if not, add the include in relevant services
2. Frontend rendering layer: change every place that shows just `accountCode` to also show `accountName` (from joined data)
3. No hardcoded account name maps in TS/React — must come from DB

**Out of scope:**
- Renaming any existing `accountCode` field
- Adding account name to API responses that don't currently include it (only modify places where we already have the data via existing relations)
- Backfilling missing chart_of_accounts seed data — assume the seed is correct

If the API doesn't already return account names, add the include + adjust the response DTO. This may touch journal-related endpoints.

---

## 3. P9 — Sticky Footer

`AssetEntryPage.tsx` currently has buttons inline at the bottom. Move to a `<div className="sticky bottom-0 ...">` that always shows:
- Validation summary chip (passes V1-V15 / "x errors")
- Σ Dr = Σ Cr indicator (from JE preview)
- 3 buttons: ยกเลิก / บันทึกร่าง / บันทึก & POST (with appropriate disabled states)

---

## 4. P10 — Group Cards (Summary Report)

Current `AssetSummaryReportPage.tsx` `category` tab renders a flat table. Target per PDF page 10:

```
┌─ EQUIPMENT (อุปกรณ์สำนักงาน) ─── ราคาทุน 50,000 · ค่าเสื่อมสะสม 10,000 · NBV 40,000 ┐
│ [items table 1...n]                                                                  │
│ subtotal row: ราคาทุน / Acc.Depr / NBV                                                │
└──────────────────────────────────────────────────────────────────────────────────────┘
┌─ IMPROVEMENT (ปรับปรุงสำนักงาน) ─── ราคาทุน X · Acc.Depr Y · NBV Z ┐
│ ...                                                                  │
└──────────────────────────────────────────────────────────────────────┘

Grand Total: ราคาทุนรวม · ค่าเสื่อมสะสมรวม · มูลค่าตามบัญชีสุทธิ (NBV) รวม
```

Each Group Card has:
- Header: category icon + Thai name + 3 totals
- Body: items table (existing columns)
- Footer: subtotal row

Grand Total: footer below all cards aggregating across categories.

---

## 5. P11 — Filter row baseline alignment

`AssetRegisterPage.tsx` filter row currently has label-above-input pattern. The "ณ วันที่" date picker has its label rendered slightly different from dropdown labels causing baseline drift.

Fix: wrap each filter control in a consistent `<div className="space-y-1">` with label first then input. Use `items-end` on the parent grid OR uniform label height.

---

## 6. P12 — Table header styling

`AssetRegisterPage.tsx` `<thead>` currently has minimal styling. Add:
- Background gradient (e.g. `bg-gradient-to-b from-muted/80 to-muted/40` or `bg-muted/60`)
- `font-semibold` or `font-bold` for column headers
- Optional: border-bottom-2 for contrast

Match patterns from other tables in the codebase if any exist.

---

## 7. P13 — Account name from chart_of_accounts join

Files affected:
- Backend: any service that returns JournalEntryLine with accountCode but no accountName — add `chartOfAccount` include
- Frontend: render `${accountCode} ${accountName}` everywhere we currently show `accountCode` alone
- Specifically check:
  - JE preview in AssetEntrySection4Journal
  - JE preview in Depreciation/Disposal pages
  - Journal listing in AssetJournalPage (already-fetched data — verify shape)
  - any schedule/report tables

Concrete steps:
1. Grep `accountCode` in frontend asset/depreciation pages
2. For each render site, check if `accountName` is available in the same record; if not, identify the API endpoint returning the data and amend service to include `chartOfAccount.name`
3. Update render to show `<code>{code}</code> <span>{name}</span>` (or similar)

---

## 8. P14 — Breadcrumb on List page

Add a Breadcrumb component above the AssetsListPage `PageHeader`:

```tsx
<Breadcrumb items={[
  { label: 'หน้าหลัก', href: '/' },
  { label: 'สินทรัพย์', href: '/assets' },
  { label: 'รายการเอกสารทั้งหมด' },
]} />
```

Reuse existing Breadcrumb component if available (search `apps/web/src/components/` for it).

---

## 9. P15 — VAT/WHT subsection styling

`AssetEntrySection2Cost.tsx` has VAT toggle + WHT toggle sections. Currently renders as plain rows. Target:
- VAT block: `border-l-4 border-violet-500` + `bg-violet-50/30 dark:bg-violet-950/30`
- WHT block: `border-l-4 border-amber-500` + `bg-amber-50/30 dark:bg-amber-950/30`
- Padding + rounded corners for visual grouping

Use semantic color tokens if they exist; otherwise direct Tailwind classes are acceptable (per existing patterns in the codebase).

---

## 10. P16 — PDF Export + Status Badge colors

### P16(a) — PDF Export button

Register page already has CSV + Excel export. Add a "พิมพ์ PDF" button. Approach:
- Use existing `window.print()` with `@media print` styles, OR
- Generate PDF client-side using jsPDF/pdfmake (if already in package.json)

Simplest implementation: `window.print()` with print-friendly stylesheet. Test it works for the register table.

### P16(b) — Status Badge colors

Currently `AssetStatusBadge.tsx` may use uniform colors. Per PDF:
- POSTED → green
- DISPOSED → purple
- WRITE-OFF → red
- FULLY DEPR → gray

Verify current colors, adjust as needed. Use Tailwind semantic tokens (e.g. `bg-emerald-500/15 text-emerald-700`) or shadcn Badge variants.

---

## 11. P17 — Reverse button in depreciation history

`DepreciationPage.tsx` shows a history table of monthly depreciation runs. Add a "Reverse" button in the action column for each POSTED run. Wire to existing reversal endpoint if available.

---

## 12. Files to change

| File | Items |
|------|-------|
| `apps/web/src/pages/assets/AssetEntryPage.tsx` | P9 sticky footer |
| `apps/web/src/pages/assets/components/AssetEntrySection2Cost.tsx` | P15 VAT/WHT styling |
| `apps/web/src/pages/assets/AssetsListPage.tsx` | P14 breadcrumb |
| `apps/web/src/pages/assets/AssetRegisterPage.tsx` | P11, P12, P16(a), P16(b) |
| `apps/web/src/pages/assets/AssetSummaryReportPage.tsx` | P10 group cards |
| `apps/web/src/pages/assets/components/AssetStatusBadge.tsx` | P16(b) |
| `apps/web/src/pages/depreciation/DepreciationPage.tsx` | P17 reverse |
| `apps/web/src/pages/depreciation/components/*.tsx` | P13 account name |
| Possibly: `apps/api/src/modules/journal/*.ts` or `apps/api/src/modules/depreciation/*.ts` | P13 include chartOfAccount |

---

## 13. Out of Scope

- E2E tests (PDF doesn't request)
- I2 from PR #846 review (existing-data backfill SQL for permissionConfig) — separate manual SQL script
- Pagination UI in Asset audit log (deferred from PR #845 I4)

---

## 14. References

- PDF: `ImplementationReview_v1.2.pdf` §8 (Action Plan rows 9-17) + earlier sections per page
- Prior PRs: #845 (P1+P2), #846 (P3-P8)
- Owner directive (durable): "ทำตาม PDF เท่านั้น"
- Subagent model: Opus (per `feedback_use_opus_for_all_subagents.md`)
