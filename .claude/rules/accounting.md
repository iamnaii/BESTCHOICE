# Accounting Rules (TFRS for NPAEs — Full Accrual, Phase A.4)

## Standard
- TFRS for NPAEs (มาตรฐานรายงานทางการเงินสำหรับกิจการที่ไม่มีส่วนได้เสียสาธารณะ)
- **Full Accrual TFRS 15** — ดอกเบี้ยรับรู้ตามงวด ผ่าน 11-2106 Unearned Interest (Contra Asset)
- **Accrual VAT** — ตั้งภาษีวันเปิดสัญญา (11-2105/21-2102) ล้างทีละงวดเข้า 21-2101
- Single **FINANCE chart** (99 accounts) — SHOP-side deferred to A.5
- Source of truth: `docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md` + CSV at `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/`

## Phase A.0-A.3 Status
Phase A.0-A.3 is **wholly superseded**. All A.0-A.3 dead code was purged in T3.
Do NOT reference old A.0-A.3 JE templates, chart codes, or journal service methods.

---

## Chart of Accounts (99 accounts — FINANCE only)

Full list lives in `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv`.
Key codes referenced by JE templates:

### Assets (11-XXXX)
| Code | Name |
|------|------|
| 11-1101 | เงินสด — สุทธินีย์ คงเดช |
| 11-1102 | เงินสด — เอกนรินทร์ อาคะนาริน |
| 11-1103 | เงินสด — พนักงานบัญชี |
| 11-1201 | ธนาคาร KBank |
| 11-1202 | ธนาคาร SCB (ค่าใช้จ่าย) |
| 11-1203 | ธนาคาร SCB (ค่าเสื่อม) |
| 11-2101 | ลูกหนี้ผ่อนชำระ (HP Receivable Gross) |
| 11-2102 | ค่าเผื่อหนี้สงสัยจะสูญ (Allowance for Doubtful — Contra) |
| 11-2103 | ลูกหนี้ค้างชำระ (Accrued Receivable) |
| 11-2104 | ลูกหนี้-VAT ที่ออกแทน |
| 11-2105 | ลูกหนี้ภาษีขายรอเรียกเก็บ (VAT Receivable — Accrual) |
| 11-2106 | รายได้รอตัดบัญชี-ดอกเบี้ย (Unearned Interest — Contra Asset) |

### Liabilities (21-XXXX)
| Code | Name |
|------|------|
| 21-1101 | เจ้าหนี้-หน้าร้าน (ยอดจัด) |
| 21-1102 | เจ้าหนี้ค่าคอม-หน้าร้าน |
| 21-1103 | เงินรับล่วงหน้า (Advance from customer) |
| 21-2101 | ภาษีขาย ภ.พ.30 (VAT Output — settled) |
| 21-2102 | ภาษีขายรอเรียกเก็บ (VAT Deferred Output) |
| 21-2103 | VAT บังคับ-ลูกหนี้ค้าง 60 วัน |

### Revenue (41-XXXX / 42-XXXX)
| Code | Name |
|------|------|
| 41-1101 | รายได้ดอกเบี้ย (HP Interest — Accrual) |
| 41-1102 | รายได้จากการยึดสินค้า (Repossession Income) |

### Expenses (51-XXXX / 52-XXXX / 53-XXXX)
| Code | Name |
|------|------|
| 51-1101 | ค่าใช้จ่าย VAT ลูกหนี้ไม่ชำระ |
| 51-1102 | หนี้สูญ/ขาดทุนจากยึดเครื่อง |
| 51-1105 | VAT กลับรายการ |
| 52-1104 | ส่วนลดเศษสตางค์ (≤1฿ rounding tolerance) |
| 52-1106 | ส่วนลดดอกเบี้ย-ปิดยอด (Early payoff discount) |
| 53-1503 | กำไร/ขาดทุนจากการปัดเศษ |

---

## JE Templates

Templates live at `apps/api/src/modules/journal/cpa-templates/`.
All templates are verified against CPA CSV golden fixtures in `__tests__/fixtures/cpa-cases/`.

| Template Class | Trigger | Key Accounts |
|----------------|---------|-------------|
| `ContractActivation1ATemplate` | Contract activated | Dr 11-2101 / Cr 21-1101 + 21-1102 + 21-2102 + 11-2106 |
| `InstallmentAccrual2ATemplate` | Daily cron 00:01 BKK | Dr 11-2103 / Cr 41-1101 + Dr 11-2105 / Cr 21-2102 |
| `PaymentReceipt2BTemplate` | Payment received (single) | Dr cash / Cr 11-2101 + 11-2103 + 21-2101 cleared from 21-2102 |
| `PaymentReceipt2BSplitTemplate` | Partial payment | As above with pro-rata split |
| `EarlyPayoffJP4Template` | Early payoff | Includes Dr 52-1106 (discount) + reverse remaining 11-2106 |
| `RepossessionJP5Template` | Repossession | Loss branch: Dr 51-1102; Gain branch: Cr 41-1102 |
| `RescheduleJP6Template` | Reschedule (6a/6b variants) | Reclassify overdue to 21-1103 advance |
| `VendorClearanceTemplate` | Every case point 3 | Dr 21-1101 + 21-1102 / Cr 11-1201 (bank) |
| `Vat60dayMandatoryTemplate` | Daily cron 02:00 BKK | Mandatory VAT on 60-day overdue installments |
| `Vat60dayReversalTemplate` | Payment after 60-day flag | Reversal when overdue payment received |

---

## Rounding Modes (CRITICAL — match CPA CSV golden values)

Wrong rounding = test failures. Use these modes exactly:

| Calculation | Mode | Example |
|-------------|------|---------|
| `grossExclVat / totalMonths` | `ROUND_DOWN` | 17000/12 = **1416.66** (NOT 1416.67) |
| `vatTotal / totalMonths` | `ROUND_HALF_UP` | 1190/12 = **99.17** |
| per-installment total | sum of above | 1416.66 + 99.17 = **1515.83** (NOT 1515.84) |

---

## Cash Account Dimension

Payment.depositAccountCode accepts one of 6 codes:
- 11-1101, 11-1102, 11-1103 (per-person cash)
- 11-1201, 11-1202, 11-1203 (bank accounts)

Pre-filled from `User.defaultCashAccountCode`. Validated via regex on input.
Cash account dimension is required on every Payment record.

---

## Tolerance Policy (<=1 THB)

Small discrepancies on payment receipt (overpay / underpay <=1 THB):

| Direction | Journal | Approval |
|-----------|---------|----------|
| Overpay | Cr 53-1503 (auto, no approval required) | None |
| Underpay | Dr 52-1104 | Requires `toleranceApproverId` — OWNER / ACCOUNTANT / BRANCH_MANAGER |

AuditLog: `action = TOLERANCE_APPROVED`, `entity = payment`.
UI: tolerance approval modal in `PaymentForm` — opens when delta <=1 THB on underpay.

---

## VAT 60-Day Rule

- Cron runs daily at 02:00 Asia/Bangkok
- Finds installments overdue 60+ days with no PAID payment in the period
- Posts `Vat60dayMandatoryTemplate` JE (Dr 11-2104 / Cr 21-2103)
- When overdue payment is subsequently received: `PaymentReceipt2BTemplate` auto-triggers `Vat60dayReversalTemplate`

---

## Reports

`apps/api/src/modules/accounting/accounting.service.ts`:

| Method | Description |
|--------|-------------|
| `getTrialBalance(asOfDate?)` | Running balance per account, grouped by 2-digit code prefix |
| `getProfitLossFromJournal(start, end)` | Revenue (41+42) minus Expenses (51+52+53+54). Excludes 55-XXXX |
| `getBalanceSheetFromJournal(asOfDate?)` | Assets (11+12) / Liabilities (21+22) / Equity (31+32+33). Contra assets (11-2102, 11-2106) sum as negatives |

---

## Wipe & Reseed (one-time prod migration from A.0-A.3)

Run as Cloud Run Job after merging Phase A.4 to production. Requires explicit owner approval.

### CRITICAL: Deploy order for Phase A.4 migration

The migration `20260801100000_phase_a4_cpa_chart_schema` adds NOT NULL columns (`name`, `normalBalance`, `type`) on `chart_of_accounts`. Running `prisma migrate deploy` on a non-empty `chart_of_accounts` table WILL FAIL.

**Mandatory sequence:**
1. Wipe first: run the CLI below (clears accounting tables including `chart_of_accounts`)
2. Then migrate: `npx prisma migrate deploy`
3. Reseed is automatic (wipe CLI reseeds 99 FINANCE CoA after truncate)

```bash
# Step 1: Wipe + reseed CoA
CONFIRM_WIPE=YES_I_AM_SURE npm --prefix apps/api run wipe:accounting

# Step 2: Apply migration (chart_of_accounts now empty — NOT NULL columns will succeed)
npx prisma migrate deploy
```

For fresh dev environments (`prisma migrate reset`): ordering is automatic — no manual wipe needed.

Truncates (in order): `journal_lines`, `journal_entries`, `payments`, `installment_schedules`, `contracts`, `chart_of_accounts`, then reseeds 99 FINANCE CoA from CPA CSV.

After wipe + migrate, verify:
1. `SELECT COUNT(*) FROM chart_of_accounts;` — expected 99
2. Smoke one contract end-to-end via UI
3. Run TB report and confirm it balances

CLI source: `apps/api/src/cli/wipe-accounting.cli.ts`

---

## VAT Policy

- **SHOP** not VAT-registered — no VAT on SHOP transactions
- **FINANCE** VAT-registered at 7%
- **Late fees** (ค่าปรับล่าช้า) — NOT subject to VAT (owner policy, legally correct: penalties excluded from VAT base)
- No WHT on customer transactions (deferred to A.5 for vendor/payroll flows)

### VAT input account routing (P0-1 — Fix Report v1.0)

Two accounts look similar; **use them differently**:

| Account | When to use | Claimable on ภ.พ.30? |
|---|---|---|
| **11-4101** ภาษีซื้อ | Routine purchase VAT — invoiced from a registered vendor | ✅ Yes (Input Tax Credit) |
| **11-2104** ลูกหนี้-VAT ที่ออกแทน | ม.83/6 cases only — VAT paid on behalf of an overseas service provider | ❌ No (different statute) |

Expense module JE templates (`expense-accrual`, `expense-same-day`, `credit-note`) **all** book purchase VAT to **11-4101**. Booking to 11-2104 silently inflates the "ลูกหนี้" line on the balance sheet AND blocks the VAT refund. Anti-regression test exists in each template spec.

### Asset VAT — 11-4102 deferred → 11-4101 transfer flow

Assets can be POSTed before the supplier tax invoice physically arrives (TFRS accrual). For that case the asset entry form lets the user pick `vatAccount = '11-4102' ภาษีซื้อรอเรียกเก็บ` — the purchase JE then books the VAT to 11-4102 instead of 11-4101. Because 11-4102 is NOT claimable on ภ.พ.30, this VAT is parked until the invoice arrives.

When the invoice physically arrives, the user clicks "ใบกำกับมาถึงแล้ว" on `AssetDetailPage`. `AssetService.markInvoiceReceived` runs `AssetInvoiceReceivedTemplate`:

```
Dr 11-4101 ภาษีซื้อ          [vatAmount]
   Cr 11-4102 ภาษีซื้อรอเรียกเก็บ [vatAmount]
```

Guards:
- Asset must be POSTED + `hasVat` + `vatAccount === '11-4102'` + `!invoiceReceivedAt`
- V15 period guard uses TODAY (transfer posts to current period — purchaseDate may be in a closed period and that's fine)
- Idempotent via `metadata.flow = 'asset-invoice-received' + assetId` (mirrors asset-purchase pattern) + unique constraint on `FixedAsset.invoiceTransferJournalEntryId`
- After success: `asset.vatAccount` flips to `'11-4101'`, `invoiceReceivedAt/ById/JournalEntryId` populated, AuditLog `INVOICE_RECEIVED` written in same `$transaction`

Template: `apps/api/src/modules/journal/cpa-templates/asset-invoice-received.template.ts`
Endpoint: `POST /assets/:id/invoice-received` (Roles: OWNER, FINANCE_MANAGER, ACCOUNTANT)
Schema: 3 nullable fields on `FixedAsset` (migration `20260926000000_asset_invoice_received`).

---

## V15 — ACCRUAL ห้ามมี WHT (ม.50 ป.รัษฎากร)

`ExpenseDocumentsService.post()` rejects the transition `DRAFT → ACCRUAL` whenever `withholdingTax > 0`. ป.รัษฎากร ม.50 says WHT arises "ขณะที่จ่ายเงินได้" — at payment, not at accrual. Booking WHT on the accrual leg would misfile the ภงด.3/53 period and incur เบี้ยปรับ. The settlement step (VENDOR_SETTLEMENT) is where WHT lands.

---

## V17 — WHT base = `amountBeforeVat` (ป.รัษฎากร)

WHT is computed on the **ฐานเงินได้สุทธิ** — the pre-VAT amount, never including VAT. Per `LineAggregatorService.computeLine`:

```ts
whtAmount = round2(amountBeforeVat × whtPercent / 100)
```

NEVER `totalAmount × whtPercent` (would double-tax the VAT). This applies uniformly across expense, other-income, and asset modules. Convention is enforced through service code, not a runtime guard — code-review must catch any drift.

Reference: ป.รัษฎากร — WHT is calculated on the net taxable income, excluding VAT.

---

## SSO accounts (P0-3 — Fix Report v1.0)

Payroll JE splits employee deduction + employer contribution into dedicated payables instead of lumping into 21-1104 ("เจ้าหนี้ค่าใช้จ่ายกิจการ"). This keeps the Trial Balance for 21-1104 = real AP and makes สปส.1-10 filing trivial.

| Account | Side | Used for |
|---|---|---|
| **21-3105** | Cr | เงินสมทบประกันสังคม-พนักงานค้างนำส่ง (5% deduction from employee) |
| **21-3106** | Cr | เงินสมทบประกันสังคม-นายจ้างค้างนำส่ง (5% employer match, capped 750/person) |
| **53-1102** | Dr | เงินสมทบประกันสังคม (นายจ้าง) — the employer-side expense |

Thai SSO law mandates identical 5% contributions from both sides (cap 750/person/month), so `payroll.template.ts` reuses the per-line `ssoEmployee` value for the employer side. If rates ever diverge, add an `ssoEmployer` column to `PayrollLine`.

Legacy data migration (one-time): `apps/api/prisma/migrations-manual/2026-05-11-reclassify-sso-21-1104-to-21-3105.sql` — idempotent reclassification of historical Cr 21-1104 PAYROLL lines into 21-3105.

---

## Document number convention (P2-3 — Fix Report v1.0)

All accounting modules use the same convention:

```
<TYPE>-YYYYMMDD-NNNN
```

| Module | Prefix | Example |
|---|---|---|
| Expense | `EX` | `EX-20260511-0001` |
| Credit Note | `CN` | `CN-20260511-0001` |
| Payroll | `PR` | `PR-20260511-0001` |
| Vendor Settlement | `SE` | `SE-20260511-0001` |
| Other Income | `OI` | `OI-20260511-0001[-R]` [^1] |
| Receipt (Other Income) | `RT` | `RT-202605-00001` (per-month seq) |

[^1]: `-R` suffix is appended automatically to OtherIncome reversal documents
      created via `POST /other-income/:id/reverse`. The original POSTED doc keeps
      its base number; the reversing doc is `<original>-R`. See W15 fix.

YYYYMMDD is **Asia/Bangkok local date** (so a doc created at 00:30 BKK = 17:30 UTC the previous day still numbers under today's date). The 4-digit sequence (`NNNN`) resets at BKK midnight per `<TYPE, day>` pair via an advisory lock — see `DocNumberService.next()` and `OtherIncomeService` / `DocNumberService.getBkkDayBounds()`.

Don't introduce alternative formats (`EX-2605110001`, `EX_2026-05-11_0001`, etc.) — keep one convention for grep-ability + downstream report parsing.

---

## Per-line WHT routing (P2-4 — Fix Report v1.0)

`ExpenseLine.whtFormType` is **optional** and overrides the document-level `whtFormType` for that line's WHT amount. Lets a single EX document mix individual + juristic vendors:

- Line.whtFormType = `'PND3'` → that line's WHT routes to **21-3102** (ภ.ง.ด. 3 ค้างจ่าย)
- Line.whtFormType = `'PND53'` → routes to **21-3103** (ภ.ง.ด. 53 ค้างจ่าย)
- Line.whtFormType = `null` → falls back to doc.whtFormType, defaults `'PND3'`

`expense-same-day.template.ts` aggregates WHT by form type and posts up to 2 Cr lines when needed. Legacy docs (line-level `whtFormType` all null) keep the original single-Cr-line behavior — backwards compatible.

VendorSettlement intentionally does NOT support per-line routing — by the model definition, a single SE doc clears one vendor only, so one form type applies to the whole settlement.

---

## DEFERRED to Phase A.5

| Item | Accounts | Notes |
|------|----------|-------|
| PPE + depreciation | 12-21XX, 53-16XX | Asset register + monthly depreciation cron |
| WHT | 21-31XX/32XX, 54-XXXX | Payroll + vendor withholding flows |
| Tax-disallowed expenses | 54-XXXX | Flag on expense type |
| 41-2101/02 HP Revenue | — | CSV omits: FINANCE income = interest, not principal |

> "SHOP-side accounting" graduated to Phase 3 SP5 — see "SHOP Accounting (Phase 3 SP5)" section below.

> "PEAK code mapping" graduated to Phase 3 SP3 — see "PEAK Code Mapping" section below.
> "SHOP-side accounting" graduated to Phase 3 SP5 — see "SHOP Accounting (Phase 3 SP5)" section below.

---

## SHOP Accounting (Phase 3 SP5)

BESTCHOICE runs as 1 legal entity but 2 business halves: SHOP (retail, not VAT-registered) and FINANCE (installment financing, VAT-registered at 7%). All Phase A.0-A.4 templates were FINANCE-only. P3-SP5 adds the SHOP-side chart + templates so SHOP can produce its own Trial Balance + P&L.

### Chart prefix convention

SHOP accounts live in the same `chart_of_accounts` table as FINANCE accounts but use a leading `S`:

| Group | FINANCE | SHOP |
|---|---|---|
| Cash | 11-1101..1103 | S11-1101..1103 |
| Bank | 11-1201..1203 | S11-1201..1202 |
| Inventory | 11-3101 (repo) | S11-2001 (new mobile), S11-2002 (used), S11-2003 (accessory), S11-2004 (pending eval) |
| Inter-co receivable | n/a | S11-3001 (FINANCE owes ยอดจัด), S11-3002 (FINANCE owes commission), S11-3003 (FINANCE ตีคืน) |
| AP | 21-1101..1104 | S21-1101 (supplier mobile), S21-1102 (supplier accessory), S21-1103 (สาขาค่าใช้จ่ายค้าง) |
| Customer down-payment | n/a | S21-2001 (down-payment payable), S21-2002 (deposit) |
| Equity | 31-1101, 32-1101, 33-1101 | S31-1101, S32-1101, S33-1101 |
| Revenue | 41-1101..1102 | S41-1101 (new mobile), S41-1102 (used), S41-1103 (accessory), S41-1201 (commission from FINANCE), S41-1202 (manufacturer promo) |
| COGS | n/a (FINANCE = interest income only) | S50-1101..1103, S50-1201 (used-buy-in) |
| OpEx | 51-XXXX..53-XXXX | S51-1101..1104 (selling), S52-1101..1301 (admin), S53-1101..1103 (other) |

The full list lives in `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/shop-coa.csv` (~50 accounts). Seeded by `apps/api/prisma/seed-coa-shop.ts`.

The unique constraint on `chart_of_accounts.code` is safe because the `S` prefix guarantees no overlap with FINANCE codes. When Phase 3 SP7 splits the entities into separate legal companies + separate DBs, the SHOP DB can drop the `S` prefix internally — until then it is the partition key.

### CSV loader regex

`apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts` accepts `^S?\d{2}-\d{4}$` so both FINANCE and SHOP CoA CSVs parse with the same loader.

### Seeders

- `seedShopCoa(prisma)` — idempotent upsert (matches `seedFinanceCoa` shape; preserves owner-set `peakCode` values)
- Called from:
  - `apps/api/prisma/seed.ts` (dev reset)
  - `apps/api/prisma/seed-production.ts` (prod fresh seed)
  - `apps/api/src/cli/seed-coa.cli.ts` (`npm run seed:coa` — non-destructive upsert)
  - `apps/api/src/cli/wipe-accounting.cli.ts` (`npm run wipe:accounting` — destructive Phase A.4 helper)

### PairedJournalService

`apps/api/src/modules/journal/paired-journal.service.ts` posts BOTH SHOP and FINANCE JEs atomically in one `$transaction`, stamping the SAME `metadata.batchId` on both so audit reports can pair them. Each half is balance-checked up front; an unbalanced half throws BEFORE either side is posted.

```ts
await pairedJournal.postPaired({
  shop:    { companyCode: 'SHOP',    description: '...', lines: [...] },
  finance: { companyCode: 'FINANCE', description: '...', lines: [...] },
  batchRef: contractId,
});
```

Currently only inventory transfer uses paired wrapping; the existing FINANCE templates (e.g. `ContractActivation1ATemplate`) already book the FINANCE side of contract activation so most SHOP templates ship as SHOP-only single-side JEs.

### SHOP JE templates

All live at `apps/api/src/modules/journal/cpa-templates/`. Each is idempotent via `metadata.flow + metadata.idempotencyKey`.

| Template | Trigger | Companies | Notes |
|---|---|---|---|
| `ShopCashSaleTemplate` | Sale w/ method=CASH | SHOP only | Dr cash / Cr revenue + Dr COGS / Cr inventory. No FINANCE involvement. |
| `ShopDownPaymentTemplate` | Customer pays down at contract creation | SHOP only | Dr cash / Cr S21-2001 (down payable). Cleared later by ShopFinanceReceipt. |
| `ShopFinanceReceiptTemplate` | FINANCE wires `financedAmount + commission` to SHOP | SHOP only | Clears S21-2001 (down), books revenue+commission income, recognises receivable clearance from FINANCE. FINANCE side handled by existing VendorClearanceTemplate. |
| `ShopTradeInTemplate` | Trade-in ACCEPTED | SHOP only | Dr S11-2002 (used inventory) / Cr cash. |
| `ShopExpenseTemplate` | Branch expense recorded (rent/salary/utilities/etc) | SHOP only | CASH mode (Dr expense / Cr bank) or ACCRUAL mode (Dr expense / Cr S21-1103 payable). |
| `ShopInventoryTransferTemplate` | Contract activated (ownership SHOP→FINANCE) | SHOP only* | Dr S11-3001 (FINANCE receivable) / Cr S11-200X (inventory). FINANCE side already booked by ContractActivation1ATemplate's Cr 21-1101 line. |

*`ShopInventoryTransferTemplate` is SHOP-only by design — Phase 3 SP7 will rewrite it through `PairedJournalService` once SHOP and FINANCE truly split.

### Reports

Two endpoints in `accounting.controller.ts`:

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/expenses/ledger/shop/trial-balance` | OWNER, BM, FM, ACC | SHOP-scoped Trial Balance (filters `code.startsWith('S')`) |
| GET | `/expenses/ledger/shop/profit-loss` | OWNER, BM, FM, ACC | SHOP-scoped P&L (Revenue=S41+S42, Expenses=S50+S51+S52+S53) |

The existing `/expenses/ledger/trial-balance` and `/expenses/ledger/profit-loss` now accept a `scope=FINANCE|SHOP|ALL` query (defaults to `FINANCE` for backward compat). The shop-specific paths are syntactic sugar for `?scope=SHOP`.

`AccountingService.codePrefix(code)` extracts the section prefix correctly for both FINANCE (`11-1101` → `11`) and SHOP (`S11-1101` → `S11`). `SECTION_MAP` includes both sets of prefixes with SHOP entries suffixed " (SHOP)" so a combined view (scope=ALL) makes the partition obvious.

### Frontend

`/shop/accounting` — `apps/web/src/pages/ShopAccountingPage.tsx`. Two tabs (Trial Balance + P&L) with date pickers. Wired into `OWNER`, `BRANCH_MANAGER`, `FINANCE_MANAGER`, `ACCOUNTANT` menu configs under the SHOP zone.

### Out of scope for P3-SP5 (deferred to P3-SP7)

- Multi-entity legal split (`from_company_id`/`to_company_id` on JEs become FK to separate companies)
- SHOP-side VAT reports (SHOP not VAT-registered)
- SHOP-side payroll/SSO (handled at FINANCE level for now)
- Historical migration of past SHOP transactions (forward-only)
- SHOP-side balance sheet (Trial Balance + P&L only in SP5)

---

## PEAK Code Mapping (Phase 3 SP3)

The owner uses **PEAK** (peakaccount.com) as the CPA's external bookkeeping system. Phase 3 SP3 wires a per-account PEAK code so the journal can be exported in PEAK's chart and uploaded for tax/audit handoff. Internal codes stay unchanged — PEAK is a parallel external chart.

### Schema

`ChartOfAccount.peakCode String?` (column `peak_code`, max 20 chars, partial index for non-null values). Migration `20260946000000_add_peak_code_to_chart_of_accounts` is idempotent (uses `IF NOT EXISTS`).

CSV fixture `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv` already has column 9 "เลขบัญชีในพึค" reserved — the CSV loader at `apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts` now reads it as `peakCode`. Values remain EMPTY in the CSV; owner fills them via UI. The seeder (`apps/api/prisma/seed-coa-finance.ts`) only writes `peakCode` when the CSV cell is non-empty, so re-seeding never overwrites owner-set values.

### Settings UI

`/settings#peak-mapping` (OWNER only — non-OWNER blocked by the global SettingsPage guard). Tab provides:

- Editable table: `รหัสบัญชี | ชื่อบัญชี | รหัส PEAK` (in-row input, max 20 chars).
- Search by code/name/peakCode.
- Bulk import: paste `internal_code,peak_code` lines (header row auto-skipped).
- "ดาวน์โหลด CSV" → calls `GET /chart-of-accounts/peak-mapping/csv`.
- "บันทึก" enables only when there are unsaved changes; clears dirty map on success.

ACC role cannot reach the tab (settings page is OWNER-only) but the API endpoint accepts ACC for parity with the future role expansion — see `peak-mapping.dto.ts`.

### Endpoints

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/chart-of-accounts/peak-mapping` | OWNER, FM, ACC | Returns `{ id, code, name, type, peakCode }` for active accounts |
| PUT | `/chart-of-accounts/peak-mapping` | OWNER, ACC | Bulk update; rejects empty-string (must be null or trimmed); writes `PEAK_MAPPING_UPDATED` audit log with diff |
| GET | `/chart-of-accounts/peak-mapping/csv` | OWNER, FM, ACC | `text/csv; charset=utf-8` + UTF-8 BOM; filename `peak-mapping-YYYYMMDD.csv` (BKK) |
| GET | `/expenses/journal/export-peak?startDate&endDate` | OWNER, FM, ACC | CSV of POSTED journal lines tagged with mapped PEAK code |

### Export semantics

`/expenses/journal/export-peak` returns CSV columns: `entryDate, entryNumber, peakCode, accountCode, accountName, debit, credit, description, reference`. Money values are emitted as `Prisma.Decimal.toString()` to preserve precision (never `Number()`).

Guards:
- Date range capped at 186 days (~6 months). Longer ranges → `BadRequestException`.
- Lines whose account has no PEAK mapping are SKIPPED. The skipped count returns via header `X-Skipped-Lines` (and total rows via `X-Row-Count`). Both headers are CORS-exposed via `Access-Control-Expose-Headers`.

Frontend `/finance/peak-export` (OWNER, FM, ACC) wraps the call with a date-range picker and surfaces the skipped count as a warning banner with a deep link back to the mapping settings.

### Audit

`PEAK_MAPPING_UPDATED` audit log entry (action string, no Prisma enum). `entity = 'chart_of_account'`, `entityId` = comma-joined account codes, `newValue.changes` = array of `{ code, before, after }`.

---

## Wipe CLI (Phase A.4 migration helper)

`apps/api/src/cli/wipe-accounting.cli.ts` truncates all accounting data and reseeds the FINANCE chart.
**DESTRUCTIVE — requires all 3 env vars:**

```bash
# Dev / staging
CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run wipe:accounting

# Production (requires additional ALLOW_PROD_WIPE)
CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_prod ALLOW_PROD_WIPE=YES_I_AM_SURE npm --prefix apps/api run wipe:accounting
```

Guards (C7 hardening PR #741):
1. `CONFIRM_WIPE=YES_I_AM_SURE` — basic consent
2. `NODE_ENV=production` → also requires `ALLOW_PROD_WIPE=YES_I_AM_SURE`
3. `EXPECTED_DB_NAME` must match `current_database()` — prevents wrong-DB runs
4. 5-second Ctrl+C cooldown printed to stderr before any TRUNCATE

---

## Other Income Module (42-XXXX entries)

FINANCE-side other income (interest on deposits, penalty income, miscellaneous revenue).
Module: `apps/api/src/modules/other-income/`
Frontend pages: `apps/web/src/pages/other-income/`
Routes: `/other-income`, `/other-income/new`, `/other-income/:id`, `/other-income/:id/receipt`, `/other-income/daily-sheet`

Key accounts (from FINANCE 99-account chart):
- `42-1102` — ดอกเบี้ยเงินฝาก (Bank interest income — exempt from VAT, subject to 15% WHT)
- `42-1103` — ค่าปรับชำระล่าช้า (Late fee — usually auto-posted via `PaymentReceipt2BTemplate` together with installment payment. Also bookable here for "late-fee-only" scenarios where customer pays just the penalty without settling the installment. **Watch for duplicate-entry risk**: if booked here, do NOT also pass `lateFee` on the next installment Payment for the same month, or 42-1103 will be credited twice.)
- `42-1104` — รายได้จากการหักค่าจ้าง (Payroll deduction — Pattern B deferred until payroll module exists)
- `42-1105` — กำไรจากการจำหน่ายสินทรัพย์ (Gain on disposal of assets — VAT 7%)

JE template: `OtherIncomeTemplate` at `apps/api/src/modules/other-income/templates/other-income.template.ts`
Doc numbering: `OI-YYYYMMDD-NNNN` (advisory-lock per-day sequence)
Lifecycle: DRAFT → POSTED → REVERSED (soft-delete via `deletedAt`)
WHT: per-item `whtPct` field; WHT payable posts to `21-3101`

### Override JV (manual JE edit before POST)

`POST /other-income/:id/post` accepts optional `{ override: true, overrideLines: [...] }`. When provided:
- Server validates V1 (Dr=Cr ±0.01), V2 (≥2 lines), V5 (Dr XOR Cr per line) via `JournalOverrideService`
- Sets `OtherIncome.isOverridden = true`
- Writes `AuditLog { action: 'JV_OVERRIDDEN', oldValue: { jvLines: <auto> }, newValue: { jvLines: <override>, diffSummary: <Thai> } }`
- UI shows ✏ marker in list pages for these documents

Audit `JV_OVERRIDDEN` action string — no Prisma enum (AuditLog.action is plain String).

### Maker-Checker toggle (Other Income)

`PUT /other-income/maker-checker` (OWNER only) toggles `OTHER_INCOME_MAKER_CHECKER_ENABLED`. Emits `CONFIG_CHANGED` audit string. When turning OFF, UI shows count of READY docs from `GET /other-income/maker-checker/pending-ready-count` for awareness — they auto-approve on next post.

### Reopen Period workflow

`POST /expenses/periods/reopen` (OWNER only) accepts `ReopenPeriodDto { companyId, year, month, reasonType, reason, taxFiled, boardResolutionId? }`:
- `reasonType`: enum (WRONG_ENTRY / MISSED_RECORD / AUDITOR_REQUEST / OTHER)
- `reason`: free text, min 10 chars
- `taxFiled`: true if ภ.พ.30 has been submitted (UI banner adds warning when true)

Persists `reopenReason` (format `${reasonType}: ${reason}`) + `taxFiled` on `AccountingPeriod`. Emits `PERIOD_REOPENED` audit. `closePeriod()` emits `PERIOD_CLOSED`. Race-safe via CAS — `updateMany` with `status: 'CLOSED'` filter inside `$transaction` prevents concurrent reopen.

`GET /expenses/periods/reopened` lists currently-reopened periods (status=OPEN AND reopenedAt set) for the `ReopenedPeriodBanner` shown on OtherIncomeListPage + ExpensesPage.

### Settings UI consolidation

`/settings` is the 5-tab hub for system-wide configuration (OWNER only — non-OWNER redirected to `/`):
- `#company` — CompanyInfo (name, address, tax ID, signer)
- `#vat` — `VAT_RATE` + `VAT_PRICE_TYPE_DEFAULT` (exclusive/inclusive)
- `#periods` — AccountingPeriod table (close/reopen actions, ReopenPeriodModal)
- `#attachment` — `ATTACHMENT_REQUIRED_ABOVE_AMOUNT` + `ATTACHMENT_ALLOWED_TYPES`
- `#users` — MakerCheckerToggle + link to `/users`

URL hash sync: `/settings#vat` (etc.) is bookmarkable; back/forward respects `hashchange`.

Operational settings live at dedicated routes (also OWNER-only):
- `/settings/stickers` — StickerSettings
- `/settings/collections` — CollectionsConfigCard
- `/settings/general` — Banking, penalty, PDPA, payment_link (GeneralSettings pre+post)

---

## Year-End Closing (P3-SP1)

Runs once at the end of each fiscal year (typically Jan-March of the following
year, after all 12 monthly periods are CLOSED). Closes revenue + expense
accounts into Income Summary (39-9999), then transfers net income/loss to
Retained Earnings (33-1101 — กำไร(ขาดทุน)สุทธิประจำปี).

Template: `apps/api/src/modules/journal/cpa-templates/year-end-closing.template.ts`
Service: `apps/api/src/modules/accounting/closing.service.ts`
Page: `apps/web/src/pages/YearEndClosingPage.tsx` → route `/finance/year-end-closing`

### 3-step JE flow

All 3 entries share `metadata.batchId` (uuid) for traceability:

```
Step 1 — Close revenue (per non-zero 41/42-XXXX account):
  Dr 41-XXXX  [net Cr balance for the year]
  Dr 42-XXXX  ...
    Cr 39-9999 Income Summary  [revenueTotal]

Step 2 — Close expenses (per non-zero 51/52/53/54-XXXX account):
  Dr 39-9999 Income Summary  [expenseTotal]
    Cr 51-XXXX  [net Dr balance]
    Cr 52-XXXX  ...

Step 3 — Transfer net to retained earnings (skipped if net = 0):
  If profit:  Dr 39-9999 / Cr 33-1101  [netIncome]
  If loss:    Dr 33-1101 / Cr 39-9999  [|netLoss|]
```

Entry-date for all 3 JEs = `Dec 31 23:59:59.999 BKK` of the closed year (keeps
the closing entries inside the year window).

### Guards

- **Year window**: 2020-2030, must be strictly `< current year` (cannot close
  future or in-progress year)
- **Monthly periods**: all 12 months for FINANCE company must be in
  `CLOSED` or `SYNCED` status — otherwise `BadRequestException` with the
  list of open months
- **Idempotency**: a year can only be closed once. `ConflictException` on
  re-attempt unless prior batch was reversed first (then re-close allowed)
- **Tx atomicity**: 3 JEs created in a single `$transaction` — partial
  failure rolls all 3 back

### Reversal escape hatch (OWNER only)

```
POST /accounting/year-end-closing/reverse
Body: { year, reason }  // reason min 10 chars
```

Creates 3 mirror-flipped JEs (Dr/Cr swapped), dated today (NOT the original
Dec 31). Original entries keep their POSTED status — reversal sits beside
them with `metadata.flow = 'year-end-closing-reverse'` + back-ref via
`reversesEntryId`. Originals are marked `metadata.reversedByBatchId` so the
idempotency guard no longer blocks a re-close.

AuditLog actions:
- `YEAR_END_CLOSED` — entity=accounting_period, entityId=batchId, newValue includes year + netIncome + 3 JE ids
- `YEAR_END_CLOSING_REVERSED` — entity=accounting_period, entityId=originalBatchId

### Reports impact

After year-end closing posts:
- `getProfitLossFromJournal(Jan-Dec)` for the closed year returns ~0 for
  Revenue and Expense (they've been zeroed out), and `netIncome ≈ 0`
- `getTrialBalance(asOfDate >= Dec 31)` shows 33-1101 increased by net income,
  Income Summary (39-9999) back to 0
- `getBalanceSheetFromJournal(asOfDate >= Dec 31)` — equity section reflects
  the year's profit moved to retained earnings (no longer "implicit" derived
  from P&L)

The "ค่าประมาณกำไรปีปัจจุบัน — ยังไม่ปิดบัญชีจริงเข้า 33-1101" caveat on the
balance-sheet equity matrix (accounting.service.ts:1564) disappears for years
that have been closed via this flow.

`/accounting/periods` redirects to `/settings#periods` via `window.location.replace` (preserves hash; react-router `<Navigate>` cannot set hash fragments).
