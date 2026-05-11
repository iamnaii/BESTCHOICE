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

## DEFERRED to Phase A.5

| Item | Accounts | Notes |
|------|----------|-------|
| PPE + depreciation | 12-21XX, 53-16XX | Asset register + monthly depreciation cron |
| WHT | 21-31XX/32XX, 54-XXXX | Payroll + vendor withholding flows |
| Tax-disallowed expenses | 54-XXXX | Flag on expense type |
| PEAK code mapping | column in CSV | Export reconciliation |
| SHOP-side accounting | SHOP chart (separate) | Paired SHOP+FINANCE JEs (currently FINANCE-only) |
| 41-2101/02 HP Revenue | — | CSV omits: FINANCE income = interest, not principal |

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
- `42-1103` — ค่าปรับชำระล่าช้า (Late fee — auto-posted via `PaymentReceipt2BTemplate`; **blocked at V4 in this module to prevent duplicate entry**)
- `42-1104` — รายได้จากการหักค่าจ้าง (Payroll deduction — Pattern B deferred until payroll module exists)
- `42-1105` — กำไรจากการจำหน่ายสินทรัพย์ (Gain on disposal of assets — VAT 7%)

JE template: `OtherIncomeTemplate` at `apps/api/src/modules/other-income/templates/other-income.template.ts`
Doc numbering: `OI-YYYYMMDD-NNNN` (advisory-lock per-day sequence)
Lifecycle: DRAFT → POSTED → REVERSED (soft-delete via `deletedAt`)
WHT: per-item `whtPct` field; WHT payable posts to `21-3101`
