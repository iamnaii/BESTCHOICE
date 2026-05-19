# SP2 — Accounting Reports Gap (Design Spec)

**Sub-project:** SP2 (of 6) — ดู roadmap: `2026-05-17-sidebar-redesign-roadmap.md`
**Status:** Design approved 2026-05-17
**ETA:** 4-6 PRs / 1-2 weeks (single PR per SP for owner-reviewability)
**Tracking:** PR #995 SP1 complete; SP2 = next PR

---

## 1. Problem Statement

SP1 ผูก placeholder routes 4 หน้า: `/finance/cash-flow`, `/finance/equity-statement`, `/finance/general-ledger`, `/accounting/intercompany` (เดิม partial) — SP2 ทำหน้าให้ครบตามมาตรฐาน **TFRS for NPAEs** + พอเชื่อมต่อบัญชีจริงได้

CSV requirement (BESTCHOICE FINANCE 5):
> งบการเงิน 4 งบ: งบดุล (มี), งบกำไรขาดทุน (มี), งบกระแสเงินสด (ขาด), งบแสดงการเปลี่ยนแปลงในส่วนของผู้ถือหุ้น (ขาด) + สมุดรายวัน/สมุดแยกประเภท + รายงานหนี้สูญ + ลูกหนี้ Inter-co

## 2. Goals / Non-Goals

**Goals (SP2 scope):**
- `/finance/cash-flow` — **Indirect method** (เริ่มจากกำไรสุทธิ + adjust working capital + Δ contra accounts) ผูกกับ Trial Balance
- `/finance/equity-statement` — Movement-by-period matrix 4 equity accounts (31-1101, 31-1102, 32-1101, 33-1101) + caveat "กำไรปีปัจจุบัน (ยังไม่ปิดบัญชี)" — derived current-year P&L line
- `/finance/general-ledger` — สมุดแยกประเภท per-account with date range + running balance + Excel export
- **Enhance `/accounting/intercompany`** — implement settlement JE (`intercompany.service.ts:88` TODO) + add aging detail tab + per-contract breakdown

**Non-Goals (deferred):**
- Year-end closing entries posting to 39-9999 → 33-1101 → 32-1101 (separate sprint)
- Real "หนี้สูญ" dedicated report — bad-debt provisioning already runs via cron, add link only
- PEAK Sync export reconciliation (Phase A.5)
- SHOP-chart support (still FINANCE-only)
- Direct-method Cash Flow (existing `/reports/cash-flow` kept for branch ops view)

## 3. Accounting Principles Applied

### 3.1 TFRS for NPAEs Compliance

- **Cash Flow Statement format**: ใช้ **Indirect Method** (NPAEs allows both; indirect ties to TB and is reconcilable)
  - Operating activities: NI ± non-cash (depreciation, bad-debt provision, unearned interest change) ± Δ working capital (AR, Inventory, AP, VAT)
  - Investing activities: PPE purchases/disposals (read from `FixedAsset` model)
  - Financing activities: capital injections (31-XX), dividends (32-XX) — likely zero until owner posts
- **Equity Statement format**: Matrix layout — rows = equity accounts, columns = [ยอดต้นงวด, +เพิ่ม, -ลด, ยอดปลายงวด]
  - "กำไรปีปัจจุบัน" line = derived from `getProfitLossFromJournal(yearStart, periodEnd)` with **explicit caveat**: "ค่าประมาณ — ยังไม่ปิดบัญชีจริงเข้า 33-1101"
- **General Ledger format** (per ป.รัษฎากร): วันที่ / เลขที่ JE / คำอธิบาย / Dr / Cr / คงเหลือ — ลำดับตามวันที่
  - Opening balance หัวรายงาน + running balance ทุกแถว + Closing balance ท้ายรายงาน

### 3.2 Account Mapping (per `.claude/rules/accounting.md`)

**Cash Flow indirect method aggregations:**

| Section | Component | Source |
|---|---|---|
| Operating start | NI | `getProfitLossFromJournal(start, end).netProfit` |
| + Non-cash | Depreciation | Sum of journal Dr lines for prefix `53-16` |
| + Non-cash | Bad-debt provision change | Δ balance of 11-2102 (Allowance) |
| + Non-cash | Unearned interest change | Δ balance of 11-2106 |
| ± Δ Working capital | AR change | Δ balance of 11-2101 + 11-2103 (Dr-normal) |
| ± Δ Working capital | Inventory change | Δ balance of 11-3XXX (Dr-normal) |
| ± Δ Working capital | AP change | Δ balance of 21-1101 + 21-1102 + 21-31XX (Cr-normal) |
| ± Δ Working capital | VAT payable change | Δ balance of 21-2101 + 21-2102 (Cr-normal) |
| Investing | PPE purchases | Sum from `FixedAsset` createdAt in period (purchasePrice) |
| Investing | PPE disposals | Sum from `FixedAsset` disposalDate in period (salePrice) |
| Financing | Capital changes | Δ balance of 31-XX (Cr-normal) |
| Financing | Dividends | Δ balance of 32-XX exclusive of NI close (Cr-normal) |

**Equity Statement accounts:**

| Code | Name | normalBalance |
|---|---|---|
| 31-1101 | หุ้นสามัญ | Cr |
| 31-1102 | ส่วนเกินมูลค่าหุ้น | Cr |
| 32-1101 | กำไร(ขาดทุน)สะสม | Cr |
| 33-1101 | กำไร(ขาดทุน)สุทธิประจำปี | Cr |

**General Ledger**: Any chartOfAccount.code; opening balance computed from POSTED entries before period start.

### 3.3 Inter-co Settlement JE (per existing JE templates pattern)

Currently `intercompany.service.ts:88` says TODO Phase A.5. Implement now per accounting.md `VendorClearanceTemplate` pattern:

**FINANCE pays SHOP for contract activation:**
```
Dr 21-1101 เจ้าหนี้-หน้าร้าน (ยอดจัด)        [principal]
Dr 21-1102 เจ้าหนี้ค่าคอม-หน้าร้าน           [commission]
   Cr 11-1201 ธนาคาร KBank                  [principal + commission]
```

Status flow: `PENDING → CONFIRMED → RECONCILED` (existing). Reconciliation = settlement JE posted.

## 4. API Design

### 4.1 New endpoints on `AccountingController` (prefix `/expenses`)

```
GET /expenses/ledger/cash-flow?periodStart&periodEnd&companyId?
  → { sections: { operating: {…}, investing: {…}, financing: {…} }, netChange, openingCash, closingCash, isReconciled }

GET /expenses/ledger/equity-statement?periodStart&periodEnd&companyId?
  → { rows: [{ accountCode, accountName, opening, increases: [{date, description, amount}], decreases: [...], closing }], currentYearProfit, totalOpening, totalClosing, caveat? }

GET /expenses/ledger/general-ledger?accountCode&periodStart&periodEnd&companyId?
  → { accountCode, accountName, normalBalance, opening, lines: [{entryDate, entryNumber, description, referenceType, referenceId, debit, credit, runningBalance}], closing, totalDr, totalCr }
```

All `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')`.

### 4.2 Enhance `/accounting/intercompany`

Implement `intercompany.service.ts:88` settlement:
- New private method `_postSettlementJE(tx, settlementDto)` → posts the Dr 21-1101/21-1102 / Cr 11-1201 JE via `JournalService.create`
- Wire into existing `settle()` method
- Update `InterCompanyTransaction.status` to `RECONCILED` + record `journalEntryId`

New endpoint:
```
GET /inter-company/aging?branchId?&companyId?
  → { buckets: [{ range: '0-30', count, totalAmount }, ...], details: [{txId, contractId, branchName, principal, commission, daysOutstanding, status, createdAt }] }
```

## 5. UI Design

### 5.1 New pages

**`CashFlowPage.tsx`** (modeled on `ProfitLossPage.tsx`):
- Filter row: Date range, company select, quick presets
- Summary cards: Net Operating / Net Investing / Net Financing / Net Change (4 cards)
- 3 collapsible sections with PLRow-style rendering
- "Method: Indirect" badge at top
- Excel export button (reuse pattern from inventory)

**`EquityStatementPage.tsx`**:
- Filter row: Date range, company select
- Matrix table: cols = [บัญชี, ยอดต้นงวด, +เพิ่ม, -ลด, ยอดปลายงวด]
- Footer row: Total
- Caveat banner: "ค่าประมาณกำไรปีปัจจุบัน — รอปิดบัญชีสิ้นปี"
- Drill-down on movements (click row → modal with detail movements)

**`GeneralLedgerPage.tsx`**:
- Filter row: **Account picker** (Combobox from `/chart-of-accounts/grouped`) + date range + company select
- Header card: Account code + name + opening balance
- Data table: วันที่ / เลขที่ / คำอธิบาย / Ref / Dr / Cr / คงเหลือ
- Click entryNumber → drill to `/journal-entries/:id` (existing detail page)
- Footer: Closing balance + total Dr + total Cr
- Excel export

### 5.2 Enhanced Intercompany page

Add new tab to `IntercompanySettlementPage.tsx`:
- **Tab: "การจ่ายเงินค้าง"** — aging table + per-contract list
- Reuse existing settlement form tab
- Status badges: PENDING (amber) / CONFIRMED (blue) / RECONCILED (green)
- Click "ชำระเงิน" button → triggers POST `/accounting/intercompany/settle` (existing) → JE posts → status updates

## 6. Frontend Routes (update from SP1 placeholders)

In `App.tsx`, replace placeholder routes:
```tsx
// REMOVE these placeholderRoute calls:
{placeholderRoute('/finance/cash-flow', ...)}
{placeholderRoute('/finance/equity-statement', ...)}
{placeholderRoute('/finance/general-ledger', ...)}

// REPLACE with real lazy routes:
<Route path="/finance/cash-flow" element={<CashFlowPage />} />
<Route path="/finance/equity-statement" element={<EquityStatementPage />} />
<Route path="/finance/general-ledger" element={<GeneralLedgerPage />} />
```

Inside the existing protected route block with role guards (OWNER, FINANCE_MANAGER, ACCOUNTANT).

## 7. Test Plan

### 7.1 API Vitest (`apps/api/src/modules/accounting/`)

`accounting.service.spec.ts` — add `getCashFlowFromJournal`, `getEquityStatementFromJournal`, `getGeneralLedger` describe blocks:
- Empty journal → all zeros
- Single contract activation → expected operating CF (cash in for sales, etc.)
- Asset purchase → investing outflow
- Open + closing balance correctly computed for GL
- Account not in CoA → error
- Period boundary (entries on start/end dates) included

`intercompany.service.spec.ts` — add test for settlement JE posting:
- Settle PENDING txn → status RECONCILED + JE created with right account codes
- Idempotent (re-settle same txn rejected)
- Aging buckets correctly compute days

### 7.2 Web Vitest

- `CashFlowPage.test.tsx` — renders 3 sections + summary cards
- `EquityStatementPage.test.tsx` — matrix layout + caveat banner shown
- `GeneralLedgerPage.test.tsx` — running balance calculation + empty state

### 7.3 Playwright E2E

Add to `apps/web/e2e/`:
- `accounting-sp2-reports.spec.ts`:
  - Login as ACCOUNTANT → navigate to each new page → renders without crash
  - General Ledger: pick account → filter date range → see entries
  - Intercompany: click settle → confirmation → status updates

## 8. Schema Changes

**None.** All work uses existing `JournalEntry`, `JournalLine`, `ChartOfAccount`, `FixedAsset`, `InterCompanyTransaction` models.

If `InterCompanyTransaction.journalEntryId` doesn't exist, add nullable field via migration:
```sql
ALTER TABLE inter_company_transactions ADD COLUMN journal_entry_id UUID NULL;
ALTER TABLE inter_company_transactions ADD CONSTRAINT fk_ic_je 
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL;
```

(Will verify during implementation — may already exist.)

## 9. Risk & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cash Flow numbers don't reconcile (sum ≠ Δcash) | HIGH | Add `isReconciled` assertion + show drift in UI; test with golden fixture |
| Equity Statement misleading without closing entries | MEDIUM | Show prominent caveat banner; document in spec |
| GL queries slow for accounts with 10k+ entries | MEDIUM | Existing `[accountCode]` index covers; add limit + pagination if needed |
| Inter-co settlement creates duplicate JE | HIGH | Use existing JE `referenceType+referenceId` unique constraint pattern |
| Frontend pages copy too much from ProfitLossPage (DRY) | LOW | Acceptable for SP2 — extract shared report layout in SP3 if needed |

## 10. PR Breakdown

Single PR (per SP1 pattern). Commits structured as:
1. Backend: Cash Flow indirect method service + endpoint + tests
2. Backend: Equity Statement service + endpoint + tests
3. Backend: General Ledger service + endpoint + tests
4. Backend: Inter-co settlement JE + aging endpoint + tests
5. Frontend: CashFlowPage + route swap
6. Frontend: EquityStatementPage + route swap
7. Frontend: GeneralLedgerPage + route swap
8. Frontend: IntercompanySettlementPage aging tab
9. E2E + final polish

## 11. Acceptance Criteria

- [ ] Cash Flow Indirect renders for OWNER/FM/ACC; sum reconciles ±1 THB
- [ ] Equity Statement matrix with caveat banner
- [ ] General Ledger per-account with running balance
- [ ] Inter-co settlement actually posts JE (not TODO)
- [ ] Inter-co aging report shows 0-30/31-60/61-90/90+ buckets
- [ ] Frontend routes swap from ComingSoonPage to real page
- [ ] All ROLES properly guarded
- [ ] Vitest pass: +6 API tests minimum + 3 web tests
- [ ] Playwright: 1 spec covering 3 new pages
- [ ] TypeScript 0 errors
- [ ] No emoji in code
- [ ] Lint 0 errors
