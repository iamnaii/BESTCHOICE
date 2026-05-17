# SP3 — Tax Module Restructure (Design Spec)

**Sub-project:** SP3 (of 6) — ดู roadmap: `2026-05-17-sidebar-redesign-roadmap.md`
**Status:** Design approved 2026-05-17
**ETA:** 6-8 commits / 2-3 days

---

## 1. Problem Statement

ปัจจุบัน `/tax-reports` รวม 3 tabs (PP30/PND3/PND53) ใน 1 หน้า — owner ต้องการแยกตามฟอร์มกรมสรรพากร + เพิ่ม ภ.ง.ด.1 + e-Tax Invoice หน้า dedicated

**Current state (per research dump):**
- ภ.พ.30: backend ~80% done (`tax.service.ts:previewPP30`)
- ภ.ง.ด.1: 0% (ไม่มี endpoint)
- ภ.ง.ด.3/53: 10% (stub returning zeros)
- e-Tax Invoice: 0% (greenfield)

## 2. Goals / Non-Goals

**Goals (SP3 scope):**
- `/finance/vat` — ภ.พ.30 dedicated page (รับงานจาก /tax-reports tab) + RD XLSX export
- `/finance/wht` — tabbed page with 3 sub-tabs (ภ.ง.ด.1 / ภ.ง.ด.3 / ภ.ง.ด.53) + real aggregation from JournalLine
- `/finance/e-tax` — **Phase 1**: List Payment records with VAT, PDF receipt generation, monthly CSV export. **No XML/cert** (Phase 2).
- Sidebar updated to point to 3 new routes; `/tax-reports` redirects to `/finance/vat`

**Non-Goals:**
- Real e-Tax XML submission to RD (Phase 2)
- Digital signature / PKCS#7 cert (Phase 2)
- ภ.พ.36 (deferred)
- ปอ.50 (corporate income tax — separate from SP3)

## 3. Thai Tax Law Compliance

| Form | ป.รัษฎากร reference | Filing deadline |
|---|---|---|
| ภ.พ.30 (VAT) | ม.82/3, ม.83 | วันที่ 15 ของเดือนถัดไป |
| ภ.ง.ด.1 (PIT) | ม.50(1), ม.52/53 | วันที่ 7 ของเดือนถัดไป |
| ภ.ง.ด.3 (WHT บุคคล) | ม.3 เตรส, ม.50(3)(4) | วันที่ 7 ของเดือนถัดไป |
| ภ.ง.ด.53 (WHT นิติฯ) | ม.3 เตรส, ทป.4/2528 | วันที่ 7 ของเดือนถัดไป |
| e-Tax Invoice | ม.86/4 + ประกาศอธิบดี ฉ.48 (Phase 2) | ตามเงื่อนไข |

### WHT base = pre-VAT (V17 rule, accounting.md)
- `whtAmount = round2(amountBeforeVat × whtPercent / 100)` — NEVER include VAT in base

### WHT account routing (per .claude/rules/accounting.md)
- 21-3101 → ภ.ง.ด.1 (payroll PIT)
- 21-3102 → ภ.ง.ด.3 (individual)
- 21-3103 → ภ.ง.ด.53 (juristic)

## 4. API Changes

### `apps/api/src/modules/tax/tax.service.ts`

Implement real `previewPND1(companyId, year, month)`:
- Query `JournalLine` where accountCode='21-3101' + credit>0 + entry POSTED in period
- Join `referenceType='PAYROLL'` → `PayrollLine` → employee name + taxId + whtAmount
- Return: `{ items: [...], grossIncome, whtTotal, count, period }`

Implement real `previewPND3(...)`:
- Query JournalLine `accountCode='21-3102'` + credit>0
- Join referenceType='EXPENSE'|'SETTLEMENT' → ExpenseDocument/VendorSettlement → vendor name + taxId + whtAmount + incomeType
- Return: same shape as PND1 with vendor instead of employee

Implement real `previewPND53(...)`: same as PND3 but accountCode='21-3103'

Add `exportTaxFormXlsx(form: 'PP30' | 'PND1' | 'PND3' | 'PND53', companyId, year, month)`:
- Generate RD-format XLSX (one sheet per form, rows per beneficiary)
- Use existing exceljs dependency
- Return Buffer

### New e-Tax endpoints

`apps/api/src/modules/e-tax/e-tax.module.ts` (new module):
- `GET /e-tax/invoices?companyId&year&month` → list Payment records with VAT (period filter)
- `GET /e-tax/invoices/:paymentId/pdf` → PDF receipt with VAT detail
- `GET /e-tax/export-csv?companyId&year&month` → monthly CSV (paymentDate, invoiceNumber, customerName, taxId, amountBeforeVat, vatAmount, total)

### Endpoints summary

```
GET /tax/pp30-preview?companyId&year&month       (existing — keep)
GET /tax/pnd1-preview?companyId&year&month       (NEW)
GET /tax/pnd3-preview?companyId&year&month       (existing — REPLACE stub with real)
GET /tax/pnd53-preview?companyId&year&month      (existing — REPLACE stub with real)
GET /tax/export-xlsx?form&companyId&year&month   (NEW)
GET /e-tax/invoices?companyId&year&month         (NEW)
GET /e-tax/invoices/:paymentId/pdf               (NEW)
GET /e-tax/export-csv?companyId&year&month       (NEW)
```

Roles: OWNER, FINANCE_MANAGER, ACCOUNTANT (all).

## 5. Frontend

### New pages

**`VatReportPage.tsx`** (`/finance/vat`):
- Filter: company + year + month
- Header: ภ.พ.30 + RD reference (ม.82/3, ม.83)
- Summary cards: Output VAT / Input VAT / Net Payable / Filing Deadline
- Sections: Sales (output VAT by rate 0%/7%/exempt), Purchases (input VAT), 60-day mandatory section
- Export XLSX button (RD format)
- "Generate Report" button → POST /tax/generate (existing)

**`WhtReportPage.tsx`** (`/finance/wht`):
- Filter: company + year + month
- 3 tabs (Tabs component): ภ.ง.ด.1 / ภ.ง.ด.3 / ภ.ง.ด.53
- Per-tab: summary card (count + total WHT) + table of beneficiaries
- Export XLSX per tab
- "Generate Report" per tab

**`ETaxInvoicePage.tsx`** (`/finance/e-tax`):
- Filter: company + year + month
- List of payments with VAT (paginated)
- Per-row: invoice number, customer, taxId, total + VAT amount, "Download PDF" button
- Export CSV button (monthly)
- Banner: "e-Tax XML submission to RD = Phase 2 (PDF + CSV first)"

### Route changes (App.tsx)

```tsx
// REMOVE existing /tax-reports route element + placeholder routes:
// /finance/vat, /finance/wht, /finance/e-tax

// ADD lazy imports:
const VatReportPage = lazy(() => import('@/pages/VatReportPage').then((m) => ({ default: m.VatReportPage })));
const WhtReportPage = lazy(() => import('@/pages/WhtReportPage').then((m) => ({ default: m.WhtReportPage })));
const ETaxInvoicePage = lazy(() => import('@/pages/ETaxInvoicePage').then((m) => ({ default: m.ETaxInvoicePage })));

// ADD routes (under ProtectedRoute roles=OWNER/FINANCE_MANAGER/ACCOUNTANT):
<Route path="/finance/vat" element={<VatReportPage />} />
<Route path="/finance/wht" element={<WhtReportPage />} />
<Route path="/finance/e-tax" element={<ETaxInvoicePage />} />
<Route path="/tax-reports" element={<Navigate to="/finance/vat" replace />} />
```

### Sidebar update (menu.ts)

Replace placeholder entries with real (already in SP2 menu integration):
- ภาษี section already has 3 items pointing to placeholders → these now hit real pages
- Add "ภ.ง.ด.1" sub-item to WHT (currently just shows "ภ.ง.ด. 1/3/53" combined label)

## 6. Test Plan

### API
- `tax.service.spec.ts`: add 6 tests for PND1/3/53 real (empty period / with entries / per-form aggregation correctness)
- `tax.service.spec.ts`: add 2 tests for XLSX export (generates buffer + matches expected columns)
- `e-tax.service.spec.ts` (new): 4 tests (list invoices, PDF generation success, CSV export, period filter)

### Frontend
- `VatReportPage.test.tsx`: summary cards render, sections collapse
- `WhtReportPage.test.tsx`: 3 tabs swap correctly
- `ETaxInvoicePage.test.tsx`: list rendering, download button per row

### Playwright
- `sp3-tax-reports.spec.ts`: 4 cases (3 pages + role-block SALES)

## 7. Schema Changes

**None.** All work uses existing JournalLine + Payment + PayrollLine + ExpenseDocument models.

## 8. Migration / Backward Compat

- `/tax-reports` URL preserved via `<Navigate to="/finance/vat" replace />`
- Existing `TaxReport` records still readable via `/tax/:id`
- No data migration

## 9. PR Breakdown

Single PR per SP1/SP2 pattern. Commits:
1. Backend: PND1 real impl + service tests
2. Backend: PND3/53 real impl (replace stubs) + service tests
3. Backend: XLSX export + RD format mapping
4. Backend: e-Tax module (list + PDF + CSV)
5. Frontend: VatReportPage
6. Frontend: WhtReportPage (tabbed)
7. Frontend: ETaxInvoicePage
8. Routes + sidebar update + redirect
9. E2E + final polish

## 10. Acceptance Criteria

- [ ] `/finance/vat`, `/finance/wht`, `/finance/e-tax` render for OWNER/FM/ACC
- [ ] ภ.พ.30 export XLSX matches RD format columns
- [ ] ภ.ง.ด.1 shows real PayrollLine data (not stub zeros)
- [ ] ภ.ง.ด.3 + 53 show real ExpenseDocument data (not stub zeros)
- [ ] e-Tax page shows Payment records with VAT, PDF generation works
- [ ] `/tax-reports` redirects to `/finance/vat`
- [ ] Sidebar shows 3 separate items under "ภาษี" section
- [ ] All Roles guards present + match endpoint roles
- [ ] No emoji, design tokens only, leading-snug Thai text
- [ ] TypeScript 0 errors, vitest pass, Playwright pass (syntax verify)

## 11. Out of Scope (Phase 2)

- e-Tax Invoice XML submission to RD (ขมธอ.21-2562)
- Digital signature / PKCS#7 cert
- Bulk upload workflow to RD
- ภ.พ.36 (foreign service VAT)
- Year-end ปอ.50 corporate income tax (separate concern)
