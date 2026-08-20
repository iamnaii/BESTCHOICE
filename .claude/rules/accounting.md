# Accounting Rules (TFRS for NPAEs — Full Accrual, Phase A.4)

## Standard
- TFRS for NPAEs (มาตรฐานรายงานทางการเงินสำหรับกิจการที่ไม่มีส่วนได้เสียสาธารณะ)
- **Full Accrual TFRS 15** — ดอกเบี้ยรับรู้ตามงวด ผ่าน 11-2106 Unearned Interest (Contra Asset)
- **Accrual VAT** — ตั้งภาษีวันเปิดสัญญา (11-2105/21-2102) ล้างทีละงวดเข้า 21-2101
- Single **FINANCE chart** (111 accounts ณ 2026-08-08 — ตัวเลขนี้เดินตาม CSV ไม่ใช่ค่าคงที่; เดิม 99 ตอน Phase A.4, 110 ก่อน 21-1107 เพิ่ม 2026-08-08) — SHOP-side deferred to A.5
- Source of truth: `docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md` + CSV at `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/`

## Phase A.0-A.3 Status
Phase A.0-A.3 is **wholly superseded**. All A.0-A.3 dead code was purged in T3.
Do NOT reference old A.0-A.3 JE templates, chart codes, or journal service methods.

---

## Chart of Accounts (111 accounts ณ 2026-08-08 — FINANCE only)

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
| 21-1107 | เจ้าหนี้เงินคืนลูกค้า-ยึดเครื่อง (ตั้ง ณ วันยึดเมื่อราคากลาง > ยอดปิด — JP5; ล้างเมื่อจ่ายคืนผ่าน RefundPayoutTemplate) (prod: ต้องรัน seed:coa หลัง deploy — บัญชีใหม่ไม่ได้ seed อัตโนมัติใน pipeline) |
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
| 51-1102 | หนี้สูญ/ขาดทุนจากยึดเครื่อง (also: write-off loss plug) |
| 51-1103 | ค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี) — ECL provision expense, contra to 11-2102 |
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
| `RepossessionJP5Template` | Repossession | Loss branch: Dr 51-1102; Gain branch: Cr 41-1102; optional `input.customerRefund` → Cr 21-1107 (เงินคืนส่วนต่างลูกค้า, คำสั่งเจ้าของ 2026-08-08 ข้อ 2) pushed BEFORE the loss/gain plug is computed — the plug absorbs it automatically (gain shrinks/loss grows by exactly the refund, no separate formula). Paid out later via `RefundPayoutTemplate` |
| `RefundPayoutTemplate` | Manual — `POST /repossessions/:id/refund-payment` | Dr 21-1107 / Cr depositAccountCode — clears the 21-1107 balance JP5 parked (mirrors `ShopCollectSettlementTemplate`'s outstanding/idempotency pattern, scoped to 21-1107 instead of 11-2107) |
| `RefundWaiveTemplate` | Manual — `POST /repossessions/:id/refund-waive` | Dr 21-1107 / Cr 41-1102 — ล้างยอด 21-1107 คงเหลือทั้งหมด (ไม่มี amount input) เข้ารายได้จากการยึดสินค้า เมื่อเจ้าของตัดสินใจ "ไม่คืนเงิน" ส่วนต่าง (คำสั่งเจ้าของ 2026-08-08 เพิ่มเติม) |
| `RescheduleJP6Template` | Reschedule (6a/6b variants) | Reclassify overdue to 21-1103 advance |
| `Vat60dayMandatoryTemplate` | Daily cron 02:00 BKK | Mandatory VAT on 60-day overdue installments |
| `Vat60dayReversalTemplate` | Payment after 60-day flag | Reversal when overdue payment received |

`VendorClearanceTemplate` (was: `Dr 21-1101 + 21-1102 / Cr 11-1201`) was **deleted** 2026-08-01 —
dead code, never had a production caller. Its intended trigger (clearing 21-1101/21-1102 on
payment to SHOP) is now handled by the Inter-Co Settlement Batch flow — see "Inter-Co Settlement
Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)" below.

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
3. Reseed is automatic (wipe CLI reseeds ผัง FINANCE ทั้งชุดจาก CSV หลัง truncate — จำนวนบัญชีอ่านจาก CSV, CLI พิมพ์ created/updated จริงออกมา)

```bash
# Step 1: Wipe + reseed CoA
CONFIRM_WIPE=YES_I_AM_SURE npm --prefix apps/api run wipe:accounting

# Step 2: Apply migration (chart_of_accounts now empty — NOT NULL columns will succeed)
npx prisma migrate deploy
```

For fresh dev environments (`prisma migrate reset`): ordering is automatic — no manual wipe needed.

Truncates (in order): `journal_lines`, `journal_entries`, `payments`, `installment_schedules`, `contracts`, `chart_of_accounts`, then reseeds ผัง FINANCE ทั้งชุดจาก CPA CSV (ปัจจุบัน 111 บัญชี (ณ 2026-08-08 หลังเพิ่ม 21-1107)).

After wipe + migrate, verify (P3-SP5 DEEP fix C4 — counts split by company):
1. `SELECT COUNT(*) FROM chart_of_accounts WHERE code NOT LIKE 'S%';` — expected 111 (ณ 2026-08-08 — เลขนี้เดินตาม finance-coa.csv เสมอ) (FINANCE — อย่าจำเป็นค่าคงที่ ให้นับจาก CSV)
2. `SELECT COUNT(*) FROM chart_of_accounts WHERE code LIKE 'S%';` — expected ~56 (SHOP, P3-SP5)
3. Smoke one contract end-to-end via UI
4. Run TB report (`scope=FINANCE`) and confirm it balances
5. Run TB report (`scope=SHOP`) and confirm it balances
6. Run TB report (`scope=ALL`) and confirm `isAllBalanced=true` (both halves balance independently)

CLI source: `apps/api/src/cli/wipe-accounting.cli.ts`

---

## VAT Policy

- **SHOP** not VAT-registered — no VAT on SHOP transactions
- **FINANCE** VAT-registered at 7%
- **Late fees** (ค่าปรับล่าช้า) — NOT subject to VAT (owner policy, legally correct: penalties excluded from VAT base)

  **Flat-bracket late-fee model (bracket-only, permanent):** late fee = `tier1Amount` for 1..(tier2MinDays-1) days overdue, `tier2Amount` (flat, does not accumulate per day) for >= tier2MinDays days overdue, driven by SystemConfig keys `late_fee_tier1_amount`, `late_fee_tier2_amount`, `late_fee_tier2_min_days` (defaults 50/100/3). CPA ยืนยันขั้นบันไดถาวร + ถอด PER_DAY ออกจากโค้ด 2026-08-01 (เดิม D2 2026-06-25 CPA-gated ไม่เคยเปิดใช้บน prod) — the per-day model (`min(daysOverdue × ratePerDay, maxAmount, capPct% × installmentGross)`) and its config-switchable `late_fee_mode` were removed entirely; BRACKET is the only formula in the system now. Single source of truth: `resolveLateFee` in `late-fee.util.ts`; the overdue cron reproduces the same flat-bracket CASE expression in SQL, guarded by an anti-drift test (`late-fee-bracket-sql.integration.spec.ts`).

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

## ค่าปรับดิวพักงวดสุดท้าย (Reschedule Fee Park — คำสั่งเจ้าของ 2026-08-16)

Spec: `docs/superpowers/specs/2026-08-16-reschedule-fee-park-last-installment-design.md`
Schema: `Contract.rescheduleAdvanceBalance Decimal @default(0) @db.Decimal(12, 2)`
(@map `reschedule_advance_balance`, migration `20260992000000_reschedule_advance_balance` —
additive `NOT NULL DEFAULT 0`, ไม่ rewrite ตาราง)

**GL ไม่เปลี่ยน — ยังเป็น 21-1103 เงินรับล่วงหน้าเหมือนเดิม.** `rescheduleAdvanceBalance`
เป็นถัง **ระดับ application เท่านั้น** ที่แยกเงินค่าธรรมเนียมปรับดิว (6a/6b) ออกจาก
`Contract.advanceBalance` (ถังรวม FIFO เดิม) ทั้งสองถังโพสต์ลง 21-1103 บัญชีเดียวกัน ต่างกันที่
**กติกาการหัก**: ถังรวมถูก 2A accrual หัก FIFO เข้างวดถัดไป ส่วนถังพัก **แตะได้เฉพาะงวดสุดท้าย**
ตาม CPA CSV (`case-6a/6b-reschedule-*.csv`) ที่กำหนดว่าค่าธรรมเนียมปรับดิว = เงินจ่ายล่วงหน้า
ของงวดสุดท้าย. เครดิตจากจ่ายเกินธรรมดา (D1) ยังหักงวดถัดไปเหมือนเดิม (คำตัดสิน 2026-06-25 คงอยู่).

### จุดเครดิต (เงินเข้าถังพัก)

| Flow | ที่ | หมายเหตุ |
|---|---|---|
| 6a (เก็บค่าธรรมเนียมแยกใบ) | `reschedule-collect.service.ts` — `rescheduleAdvanceBalance: { increment: fee }` | JE เดิม `Dr เงิน / Cr 21-1103` ไม่เปลี่ยน · description `'เงินรับล่วงหน้างวดสุดท้าย — ค่าธรรมเนียมปรับดิว (6a)'` (preview ใช้สตริงเดียวกัน byte-identical) |
| 6b (รวมกับค่างวด) | phase 1 เครดิตเข้าถังรวมตาม D1 ปกติ → phase 2 (`bundledPaid`) **sweep** `min(fee, advanceBalance)` ถังรวม → ถังพัก ใน tx เดียว | phase 1/2 เป็นคนละ transaction — sweep ที่ **สั้นกว่า fee** (รวมกรณี 0) ยิง Sentry warning `subsystem: 'reschedule-park'` (I-7) · idempotent ด้วย probe หา AuditLog `RESCHEDULE_ADVANCE_PARKED` ที่ผูก `(contract, paymentId)` ก่อน sweep (M-3) |

### จุดหัก (เงินออกจากถังพัก) — มีแค่ 3 ทาง

1. **2A accrual ของงวดสุดท้าย** (`inst.installmentNo === c.totalMonths`) —
   `InstallmentAccrual2ATemplate` หักถังรวมตามเดิมก่อน แล้วจึงหักถังพักด้วย JE แยกใบ
   `Dr 21-1103 / Cr 11-2103`, description `'หักเงินพักปรับดิวเข้างวดสุดท้าย'`,
   `metadata.flow = 'reschedule-park-consume'`, `reference = '<installmentScheduleId>:reschedule-park-consume'`.
   **งวดอื่นห้ามแตะถังพักเด็ดขาด.**
   Cap สองชั้น: `min(installmentTotal − genericConsumed, rowOutstanding)` โดย `rowOutstanding`
   ใช้สูตร FEE-FIRST ชุดเดียวกับ `feeNettedOutstanding` ใน `compute-cn-breakdown.ts`
   (งวดสุดท้ายที่จ่ายไปแล้วก่อน accrual → หักซ้ำไม่ได้, `11-2103` ติดลบไม่ได้ — I-3).
2. **จ่ายงวดสุดท้ายก่อน accrual** (wizard → `PaymentReceiptOrchestrator`) — auto-consume
   หักถังรวมก่อน เหลือเท่าไรจึงหักถังพัก, gate ด้วย `installmentNo === contract.totalMonths`
   ทั้ง 3 ชั้น (FE `computeNetReceiptDue` / preview / orchestrator) เป็น predicate เดียวกัน
   ป้องกัน preview ≠ posted. ขา `Dr 21-1103` ของใบเสร็จรวมสองถังเป็นบรรทัดเดียว แต่ JE ถูก stamp
   `metadata.genericConsume` / `metadata.parkConsume` (`JE_ADVANCE_SPLIT_META` ใน
   `receipt-void.service.ts`) เพื่อให้ **void แยกคืนถูกถัง** — JE ที่ไม่มี stamp (ก่อนฟีเจอร์นี้)
   คืนเข้าถังรวมทั้งก้อนโดยตั้งใจ เพราะถังพักเป็น forward-only จึงไม่มีทางมีเงินพักอยู่ในนั้น (I-2).
3. **ปิดสัญญาก่อนกำหนด — JP4 + JP5 พร้อม relief leg** (ดูหัวข้อถัดไป).

### JP4 / JP5 — relief leg `Dr 21-1103` (C-3, 2026-08-17)

`computePayoffQuote` นับถังพักเป็นเครดิตลูกค้า (รวมเข้า `advancePayment`) ทำให้ยอดที่ลูกค้าจ่าย
ลดลง — **ห้าม netting เฉยๆ โดยไม่ปลดหนี้ 21-1103** ไม่งั้น `Dr เงินสด` จะสูงกว่าเงินที่รับจริง
เท่ากับยอดพัก และเหลือเครดิตผีค้างบนสัญญาที่ปิดไปแล้ว. รูปแบบที่ลงจริง:

```
Dr <cash>    = totalCash − parkRelief
Dr 21-1103   = parkRelief          ← บรรทัดใหม่ (ไม่ออกเลยเมื่อ parkRelief = 0)
```

ยอดเดบิตรวมเท่าเดิม ⇒ **ทุกขา Cr เหมือนเดิมทุกไบต์ ⇒ golden JP4/JP5 เดิมไม่ขยับ**.

| เรื่อง | กติกา |
|---|---|
| `parkRelief` คือเท่าไร | **ไม่ใช่ยอดถังพักทั้งก้อน** — คือส่วนที่ยอดปิดดูดซับจริง: `rescheduleAdvanceApplied = payoffBeforeLateFees(ไม่มีพัก) − payoffBeforeLateFees(มีพัก)` clamp `[0, park]` (ฟิลด์ใหม่บน `computePayoffQuote`, optional + `?? 0` ⇒ golden เดิม 95 เคสไม่ขยับ) |
| ทำไมไม่ใช่ทั้งก้อน | ถังพักลด `remainingBalance` → ลด gross profit → **ลดส่วนลดดอกเบี้ย (52-1106)** ด้วย · เคส CPA prod: พัก 354 ที่ส่วนลด 50% ลดยอดลูกค้าจ่ายจริงแค่ **188.58** — ปลด 354 = สร้างบั๊กกลับด้าน (ขาเงินสดต่ำไป 165.42) · ส่วนที่เหลือค้างในคอลัมน์ = เคสของ alarm I-5 |
| Clamp | JP4: `parkRelief ≤ totalCash` (ขาเงินสดติดลบไม่ได้) · JP5: clamp ด้วยยอด GL 21-1103 จริงของสัญญานั้น (`glContractBalance`) แล้ว `execute()` คืนยอดที่โพสต์จริงให้ caller ใช้ decrement คอลัมน์ |
| JP5 วางบรรทัดตรงไหน | push `Dr 21-1103` **ก่อน** คำนวณ plug ขาดทุน/กำไร → plug ดูดซับเอง (pattern เดียวกับ `customerRefund`/21-1107 ไม่มีสูตรที่สอง) |
| Decrement คอลัมน์ | อยู่ใน `$transaction` เดียวกับ JE เสมอ + AuditLog (ดูตารางล่าง) · preview (`getEarlyPayoffQuote`, `previewCalculation`) ใช้ `parkRelief` ตัวเดียวกัน ⇒ preview === posted |
| Parity | `computePayoffQuote` ยังเป็นแหล่งเดียวของทั้งสองเส้นทาง — `payoff-parity-park.spec.ts` ปักว่า JP5 `closingAmount` === JP4 `totalPayoff` และ `parkRelief` ที่ทั้งสองใช้เป็นตัวเดียวกัน |

**ยังไม่ตัดสิน (CPA-gated):** ยอดพักที่เหลือหลัง JP4/JP5 (residual) ระบบ **ไม่ตั้ง JE คืนเงิน/
รับรู้รายได้ให้อัตโนมัติ** — ปล่อยค้างในคอลัมน์ + 21-1103 แล้วให้มนุษย์ตัดสิน. คำถาม
"ถังพักควรลดฐานส่วนลดหรือไม่" ก็ยังเปิดอยู่ (ถ้าเจ้าของ/CPA สั่งว่า **ไม่ควรลด**
`rescheduleAdvanceApplied` จะเท่ากับยอดพักเต็มโดยอัตโนมัติ แก้จุดเดียวใน `computePayoffQuote`).

### Residual ตอนปิดครบงวด — alarm อย่างเดียว ไม่ตั้ง JE (I-5)

สัญญาที่เดินครบงวดตามปกติ **ไม่เคยผ่าน JP4** จึงอาจปิดโดยยังมีเงินพักเหลือ (ปรับดิวหลายรอบ
ถังพักอาจเกิน 1 งวด แต่ 2A cap ที่ `installmentTotal`). `checkContractCompletion`
(`payment-helpers.ts`) จึงยิง `Sentry.captureMessage` level `warning`
(`tags.subsystem = 'reschedule-park'`) + สร้าง **Todo MEDIUM** หนึ่งใบ (tag `reschedule-park`,
`RESIDUAL_PARK_TODO_TAG`, ระบุเลขสัญญา + ยอด, dedup กัน void → re-pay สร้างซ้ำ) —
pattern เดียวกับ `credit-note-delivery.service.ts`. **ไม่มี JE อัตโนมัติ** เพราะ
"คืนเงินลูกค้า vs รับรู้เป็นรายได้" เป็นคำตัดสิน CPA (คลาสเดียวกับ opening-balance gap
ใน interco spec §11). helper นี้ห้าม throw — alarm ต้องไม่ roll back เงินที่ลูกค้าจ่ายมาแล้ว.

### Forward-only — ไม่มี backfill

สัญญาที่ค่าธรรมเนียมปรับดิวถูกหักเข้างวดถัดไปไปแล้ว **ปล่อยตามนั้น** (คำตัดสินเจ้าของ
2026-08-16). ไม่มีสคริปต์ backfill และไม่ต้องมี — คอลัมน์ default 0 ทำให้สัญญาเก่าทุกใบ
เดินเส้นทางเดิมทุกประการ. ผลข้างเคียงที่ตั้งใจ: JE ก่อนฟีเจอร์นี้ไม่มี `metadata.parkConsume`
stamp และ void ของมันคืนเข้าถังรวมทั้งก้อน — **ถูกต้องแล้ว ห้ามไป "แก้" ให้เดา split ย้อนหลัง**.

### AuditLog action strings (M-4)

`AuditLog.action` เป็น String ธรรมดา (ไม่มี Prisma enum) — action ใหม่ของรอบนี้:

| Action | Entity | เขียนที่ | `newValue.source` |
|---|---|---|---|
| `RESCHEDULE_ADVANCE_PARKED` | `contract` | `reschedule-collect.service.ts` (6a เครดิตเข้าถัง / 6b phase-2 sweep) | `RESCHEDULE_COLLECT_6A_FEE`, `RESCHEDULE_COLLECT_6B_FEE_SWEEP` |
| `RESCHEDULE_ADVANCE_CONSUMED` | `contract` | `payment-receipt-orchestrator.ts` (จ่ายงวดสุดท้าย), `contract-payment.service.ts` (JP4), `repossessions.service.ts` (JP5) | `RECORD_PAYMENT_LAST_INSTALLMENT_PARK_CONSUME`, `EARLY_PAYOFF_PARK_RELIEF`, `REPOSSESSION_PARK_RELIEF` |
| `RESCHEDULE_ADVANCE_UNPARKED` | `contract` | `receipt-void.service.ts` (void ใบเสร็จ 6b ที่เคยถูก sweep) | `RECEIPT_VOID_6B_FEE_UNPARK` |

**`RESCHEDULE_ADVANCE_UNPARKED` = คู่ตรงข้ามของ `PARKED` และเป็น "สถานะ" ของการ sweep (R-2).**
6b ย้ายเงินเข้าถังพักผ่านขา **Cr** ซึ่ง**ไม่มี stamp** (ตอน phase 1 โพสต์ `Cr 21-1103` เงินก้อนนั้น
ยังเป็นเครดิตธรรมดาจริงๆ — phase 2 คนละ tx ถึงค่อยกวาดเข้าถังพัก) ดังนั้น split-by-stamp ที่ใช้กับ
ขา **Dr** ใช้ไม่ได้: ถ้าไม่ทำอะไรเลย void จะดึงเครดิตออกจากถังรวมทั้งก้อน (**`advanceBalance`
ติดลบเท่าค่าธรรมเนียม**) แล้วปล่อยเงินก้อนเดียวกันค้างในถังพักโดยไม่มี GL หนุน. เนื่องจาก
**AuditLog เป็น immutable (DB trigger)** จึงแก้แถวเดิมไม่ได้ — ใช้วิธี "แถวไหนใหม่กว่าชนะ" แทน:

- `receipt-void.service.ts` อ่านคู่ (PARKED, UNPARKED) ของ `(contract, paymentId)` → ถ้า PARKED
  ใหม่กว่า แปลว่า sweep ยังมีผล → ดึงเงินคืนจาก**ถังพัก** ไม่ใช่ถังรวม แล้วเขียน UNPARKED
- `reschedule-collect.service.ts` probe ตัวเดิม (M-3 idempotency) **ต้องใช้ตรรกะเดียวกัน** —
  void ใช้ payment row เดิม ถ้า probe หาแค่ PARKED มันจะเจอแถวเก่าแล้วปฏิเสธการ park ซ้ำ
  ⇒ จ่ายรอบสองค่าธรรมเนียมจะไหลกลับไปเข้างวดถัดไป = **บั๊ก FIFO เดิมกลับมาแบบเงียบๆ**

**กฎเหล็กของ alarm เงินพักคงเหลือ (R-1):** `alarmResidualParkOnCompletion` รับเฉพาะ
`PrismaService` (root) — **ห้ามรับ tx client** และ **ห้าม await** จากเส้นทางการรับเงิน. เหตุผล:
Postgres ทำให้ transaction เป็นพิษทันทีที่มี statement พัง ⇒ `try/catch` เพียงอย่างเดียว
**ไม่พอ** (commit ไม่ผ่านอยู่ดี) — ตัว alarm ต้องไม่อยู่บน connection ของ tx เลย. ปัจจุบัน
type system บังคับให้แล้ว (ส่ง `TransactionClient` เข้าไป = compile error) — อย่าคลายเป็น
`Prisma.TransactionClient | PrismaService` เพื่อความสะดวก. ยิงจาก 2 จุด: `checkContractCompletion`
(เส้นทาง orchestrator) และ cron 2A ตอน accrue งวดสุดท้ายแล้วไม่เหลืองวดค้าง (เคสที่ orchestrator
ไม่เคยทำงาน — R-5).

`newValue` ทุกใบมี `beforeParkBalance` / `afterParkBalance` (2dp string) เสมอ ⇒ ไล่ยอดถังจาก
audit trail ได้ตรงๆ. 6b sweep เพิ่ม `before/afterGenericBalance` + `sweptAmount` ด้วย และ
**AuditLog แถวนี้เองคือ idempotency marker ของ sweep** (เขียนใน tx เดียวกับการย้ายเงิน
⇒ "มีแถว" กับ "ย้ายเงินแล้ว" ขัดกันไม่ได้ — ไม่ต้องเพิ่มคอลัมน์ marker).

การ **void ใบเสร็จ** ไม่มี action string ใหม่ — ใช้ `RECEIPT_VOID` เดิม แต่เพิ่มฟิลด์
`newValue.rescheduleAdvanceRestored` (null เมื่อไม่มีเงินพักถูกคืน) คู่กับ
`advanceBalanceRestored` ที่มีอยู่แล้ว.

**หมายเหตุสำหรับคนเขียน flow ใหม่:** JE ที่ปลด 21-1103 ด้วย `metadata.tag = '2B'` **ต้อง**
ลงทะเบียนใน `ALWAYS_INCLUDED_2B_FLOWS` (`apps/api/src/modules/journal/reconstruct-prior.ts`)
ไม่งั้น `reconstructPriorCleared` จะมองไม่เห็นตอนที่มันปลดเต็มจำนวนงวด แล้วใบเสร็จถัดไปจะ
เครดิต `11-2103` ซ้ำเป็นสองเท่า (C-1 — เคส headline ของถังพักคือปลดเต็มงวดพอดี).

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

## Payroll — แยกฝั่ง SHOP/FINANCE (คำสั่งเจ้าของ 2026-08-06)

Spec: `docs/superpowers/specs/2026-08-06-payroll-shop-side-design.md` ·
Runbook: `docs/accounting/payroll-shop-rollout-2026-08.md` ·
E2E: `apps/api/src/modules/expense-documents/__tests__/payroll-shop-flow.integration.spec.ts`

- ใบเงินเดือน 1 ใบสังกัดฝั่งเดียวผ่าน `PayrollDetail.entityScope`:
  **SHOP** (default — พนักงานสาขา) | **FINANCE** (ส่วนกลาง). UI มี toggle "กลุ่มพนักงาน".
- `PayrollTemplate` resolve บัญชีผ่าน AccountRoleMap ตาม scope:
  | | SHOP | FINANCE |
  |---|---|---|
  | เงินเดือน (Dr) | `shop_payroll_expense` → S52-1201 | `payroll_expense` → 53-1101 |
  | ปกส.นายจ้าง (Dr) | `shop_payroll_sso_expense` → S52-1205 | `payroll_sso_expense` → 53-1102 |
  | ภ.ง.ด.1 ค้างจ่าย (Cr) | `shop_wht_payroll` → S21-3101 | `wht_payroll` → 21-3101 |
  | ปกส.ค้างนำส่ง (Cr×2) | S21-3105 / S21-3106 | 21-3105 / 21-3106 |
  | เงินสด/ธนาคาร (Cr) | S11-1101..1103 / S11-1201..1202 | 11-1101..1103 / 11-1201..1203 |
  `companyId` = ฝั่งของเอกสาร (แก้บั๊ก B2 เดิม: FINANCE codes + SHOP companyId →
  เงินเดือนหายจาก TB/P&L ทั้งสอง scope). Period guard ตรวจ AccountingPeriod ของฝั่งนั้น.
- **Custom income whitelist ต่อ scope** (V17): FINANCE `custom_income_accounts_whitelist`
  default `["53-1103","53-1104"]` (แก้ B1 — OT = 53-1103 ค่าล่วงเวลา ไม่ใช่ 53-1105
  ค่าอบรม); SHOP `custom_income_accounts_whitelist_shop` default `["S52-1202","S52-1204"]`.
  UI ดึงจาก `GET /expense-documents/payroll/meta?scope=` — เลิก hardcode.
- **V19**: รหัสรายการหักต้องมีจริงใน CoA + prefix ตรงฝั่ง (S สำหรับ SHOP).
- **กันซ้ำ**: (สาขา + งวด + ฝั่ง) ซ้ำ → reject โดย advisory lock ใน tx (ใบ VOID ไม่นับ);
  พนักงาน (userId) ซ้ำแถวในใบเดียว → reject + DB unique `(payroll_id, user_id)`.
- **สิทธิ**: อนุมัติก่อนจ่ายผ่าน `approval_enabled` + `approval_required_doc_types`
  (default `['PAYROLL']`) + `approvers_list`; ฟอร์มเปลี่ยนปุ่มเป็น "บันทึก & ส่งขออนุมัติ".
  เห็นเงินเดือนข้ามสาขา: เฉพาะ CROSS_BRANCH_ROLES — `GET /expense-documents/:id`
  บังคับ branch scope แล้ว (BM เห็นเฉพาะสาขาตัวเอง).
- **ภ.ง.ด.1** (`previewPayrollWHT` เขียนใหม่ 2026-08-06): อ่านจากเอกสาร PAYROLL ที่
  POSTED โดยตรง (ไม่ใช่เดิน JE 21-3101) → พนักงานภาษี 0 ปรากฏครบ, ใบ VOID หลุดออก
  อัตโนมัติ, gross = ฐาน + Σ customIncome(isTaxable). `finance-tax` WHT_PND1_ACCOUNTS
  รวม `S21-3101` (นิติบุคคลเดียว ยื่นรวม). หน้าจอ `/finance/wht-report` ต่อ route แล้ว.
- **Wipe**: `npm --prefix apps/api run wipe:payroll` (DRY_RUN + guards ชุดเดียวกับ
  wipe-accounting) — ล้างใบเงินเดือนเก่าที่ลงผิดผังทั้งหมดตามคำสั่งเจ้าของ.
- **รอบ 2-3 (2026-08-06 "ทำเลยสิ") — เสร็จแล้ว**
  (spec: `docs/superpowers/specs/2026-08-06-payroll-round2-3-design.md`):
  - **นำส่ง per-book (D1)**: `PayrollRemittanceTemplate` — SSO `Dr <sso_employee>
    + Dr <sso_employer> / Cr <cash ฝั่งนั้น>`, PND1 `Dr <wht_payroll> / Cr <cash>`;
    ยอด = Σ PayrollLine ของใบ POSTED ในงวด+ฝั่ง (ตรงแบบยื่น), guard GL คุ้มยอด +
    idempotency `sso-remit:<scope>:<period>` / `pnd1-remit:...` + period-open ที่วันจ่าย.
    จ่ายรวมฝั่งเดียว = ต้องมีบัญชี interco ฝั่ง SHOP → **รอ CPA** (คำถามเดียวกับ
    interco spec §11) — ห้ามเดา JE. Endpoints `POST /tax/payroll-remit/{sso,pnd1}`
    (OWNER/FM), UI ปุ่มนำส่งบน `/finance/sso-report`.
  - **สปส.1-10**: `GET /tax/sso-1-10-preview` + XLSX `form=SSO110` + หน้า
    `/finance/sso-report` (เฉพาะแถว ssoEmployee > 0, นายจ้าง = ลูกจ้างตามกฎหมาย).
  - **ภ.ง.ด.1ก + 50 ทวิ**: `GET /tax/pnd1-annual-preview?year` (group ต่อคนทั้งปี,
    gross รวมรายได้พิเศษที่เสียภาษี, + `annualWageTotal` อ้างอิง กท.20ก) + XLSX
    `form=PND1A` + หน้า `/finance/wht-annual` พิมพ์ใบ 50 ทวิ ต่อคน (ผู้จ่าย =
    FINANCE CompanyInfo — นิติบุคคลจดทะเบียนเดียว).
  - **แก้ไขร่าง (R3-2)**: `PATCH /expense-documents/:id/payroll` — DRAFT เท่านั้น,
    validator ชุดเดียวกับ create (`preparePayrollInput` shared), dup-งวด guard
    ยกเว้นตัวเอง, ลบ+สร้าง PayrollDetail ใหม่ (pattern interco updateBatch).
  - **คัดลอกงวดก่อน (R3-1)**: ปุ่มในฟอร์ม — client ดึงใบล่าสุดของสาขา (findOne)
    มาเติมทั้ง scope+lines; server re-validate ทุกอย่างตอนบันทึกตามปกติ.
  - **ไฟล์โอนธนาคาร (R3-3)**: `GET /expense-documents/:id/bank-transfer.csv`
    (จาก `EmployeeProfile.bankName/bankAccountNo`; แถวไม่มีข้อมูล → ข้าม +
    `X-Skipped-Lines`).
  - **WHT แนะนำ (R3-4)**: `apps/web/src/utils/pit-withholding.ts` — ขั้นบันได ม.48
    + ลดหย่อนมาตรฐาน (ส่วนตัว 60k, ค่าใช้จ่าย 50%≤100k, ปกส.จริง) — **advisory
    เท่านั้น** แสดงใต้ช่อง WHT กดใช้ได้ ไม่ block.
  - **CI**: เพิ่ม step `Test Web` (เทสต์ web ไม่เคยรันใน pipeline ใดมาก่อน).
- **คำตัดสินเจ้าของ 2026-08-06 (ปิดประเด็น — อย่าเสนอซ้ำ)**:
  - ส่งสลิปให้พนักงานทาง LINE/email — **ไม่ทำ** (เจ้าของ: "ไม่ต้องส่ง"; พิมพ์สลิป
    กระดาษจาก PaymentVoucherPage ตามเดิม)
  - PDPA retention `payroll_lines` — **ไม่ลบทิ้ง** (เจ้าของ: เก็บถาวร; สอดคล้อง
    พ.ร.บ.การบัญชี เก็บเอกสาร ≥5 ปี — ไม่ต้องสร้าง retention cron)
- **ยังค้างจริง**: กท.20ก แบบฟอร์มเต็ม (มี annualWageTotal อ้างอิงแล้ว),
  จ่ายนำส่งรวมฝั่งเดียว (รอ CPA — บัญชี interco ฝั่ง SHOP, interco spec §11).

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

## ใบลดหนี้ตอน void ใบเสร็จ — หนึ่งใบต่อหนึ่งใบเสร็จ (2026-08-18)

ใบเสร็จค่างวดของ FINANCE พิมพ์หัวเอกสารว่า **"ใบเสร็จรับเงิน / ใบกำกับภาษี"** เมื่อมี VAT
(`receipt-pdf.service.ts`) ⇒ การยกเลิกมันต้องมี **ใบลดหนี้ตาม ม.86/10** คู่เสมอ.

`ReceiptVoidService.voidReceipt` ยกเลิก **ทั้งงวด** (un-pay semantics 2026-07-08): ใบที่ผู้ใช้กด
+ ใบพี่น้องทุกใบที่ผูก `paymentId` เดียวกัน (`INSTALLMENT_MONEY_RECEIPT_TYPES`). ก่อน 2026-08-18
มันออกใบลดหนี้ให้ **เฉพาะใบที่กด** — งวดที่แบ่งจ่าย 1,771 + 2,000 จึงยกเลิกเงิน 3,771 โดยมี
ใบลดหนี้แค่ 2,000 (พบบน prod สัญญา TEST-20260809-004 งวด 4). **ฝั่ง GL ไม่เคยมีรู** —
`originalEntries` เป็น `findMany` ที่กลับรายการ JE ทุกใบที่ผูก `metadata.paymentId` อยู่แล้ว —
ช่องว่างอยู่ที่ **เอกสาร** ล้วน ๆ.

ตอนนี้ลูปเดียวกับที่ void ใบพี่น้องสร้าง `Receipt{ receiptType: 'CREDIT_NOTE',
amount: <ยอดของใบนั้น>, voidedReceiptId: <ใบนั้น> }` ให้ทุกใบ, เลขที่ผ่าน
`ReceiptNumberService` ตัวเดิม (advisory lock เดียวกัน). AuditLog `RECEIPT_VOID` เพิ่มฟิลด์
`newValue.siblingCreditNoteNumbers: string[]`. **Invariant: Σ ยอดใบลดหนี้ = Σ ยอดใบเสร็จที่ถูก
ยกเลิกในรอบนั้นเสมอ** — เทสต์ปักไว้ที่ `receipt-void.sibling-credit-note.spec.ts`.

> Forward-only: ใบเสร็จที่ถูก void **ก่อน** 2026-08-18 และไม่มีใบลดหนี้คู่ ไม่มีสคริปต์ backfill
> (ออกใบลดหนี้ย้อนหลังคือการออกเอกสารภาษีใหม่ ต้องให้ CPA เคาะ). เคสที่รู้ตัวแล้ว 1 เคส:
> TEST-20260809-004 งวด 4 ขาดใบลดหนี้ของ RT-202608-00006 (1,771฿) — เป็นสัญญาทดสอบ.

## สรุปรายวัน = เงินสดที่รับจริง (receipt-based, 2026-08-18)

`GET /payments/daily-summary` อ่านจาก **`Receipt`** ไม่ใช่ `Payment` — หนึ่งแถว = หนึ่งใบเสร็จ,
ยอด = `Receipt.amount` (เงินที่รับจริง). เดิมอ่าน `Payment.amountPaid` ซึ่งคือ **ยอดที่ตัดหนี้งวด
ได้** คนละตัวกับเงินสดทุกครั้งที่มีเครดิต 21-1103 เข้ามาเกี่ยว: จ่าย 3,800 บนงวด 3,671 + ค่าปรับ
100 → `amountPaid = 3,771` ส่วนเกิน 29 เข้า advance; งวดถัดไปจ่ายสด 3,742 แล้วดูดเครดิต 29
→ `amountPaid = 3,771` อีก. ทั้งวันยอดรวมบังเอิญตรง แต่ทุกแถวผิด.

ผลพลอยได้ที่หายไปพร้อมกัน (ไม่ต้องเขียนโค้ดเพิ่ม — เปลี่ยนแหล่งข้อมูลแล้วหายเอง):

| อาการเดิม | สาเหตุ |
|---|---|
| จ่ายบางส่วนไม่โผล่ในวันที่รับเงิน แล้วไปโผล่ก้อนเดียวในวันปิดงวด | `Payment.paidDate` เซ็ตเฉพาะตอน `isPaidInFull` |
| งวดเดียวหลายใบเสร็จยุบเป็นแถวเดียว ⇒ "จำนวนรายการ" ต่ำกว่าจริง | หนึ่งแถว = หนึ่ง `Payment` |
| เงินดาวน์ / ปิดยอด / ค่าปรับดิว ไม่ปรากฏเลย | ไม่มี `Payment.paidDate` ของตัวเอง |
| การ์ด "แยกตามวิธี" ไม่ตรงกับ "ยอดรวม" เมื่อวันนั้นเกิน 50 รายการ | byMethod บวกจาก **หน้าปัจจุบัน**, ยอดรวมมาจาก aggregate ⇒ ตอนนี้ใช้ `groupBy` ทั้งวัน |

ขอบเขต: ไม่รวมใบที่ `isVoided` และไม่รวม `CREDIT_NOTE` (ใบลดหนี้ถือยอด **บวก** ของใบเดิม
นับเข้าไปจะกลายเป็นคูณสอง ไม่ใช่หักล้าง) — นิยามเดียวกับ `computeCumulativePaid` ที่การ์ด
"ยอดชำระสะสม" ในหน้าประวัติใช้อยู่แล้ว ⇒ สองหน้าตรงกันโดยโครงสร้าง. **การ void จึงแก้ย้อนวัน
ที่ผิด** ซึ่งเป็นสิ่งที่ต้องการ และเป็นจริงอยู่แล้วไม่ว่าจะทำแบบไหน เพราะใบเสร็จที่ออกใหม่ถูกลง
วันที่รับเงินจริง (D4) ไม่ใช่วันที่คีย์.

`totalLateFees` = Σ ค่าปรับ **สุทธิ** (gross − waived) ของงวดที่ **แตกต่างกัน** ที่มีใบเสร็จในวันนั้น
— ค่าปรับอยู่ระดับงวด ไม่ใช่ระดับใบเสร็จ จึงนับครั้งเดียวแม้งวดนั้นจะแบ่งจ่ายสองใบ. Index รองรับ:
`receipts(paid_date, is_voided)` (migration `20260993000000_receipt_paid_date_index`).

## ห้ามข้ามงวด — บันทึกชำระตามลำดับงวดเท่านั้น (คำสั่งเจ้าของ 2026-08-19)

กติกา: **บันทึกรับชำระได้เฉพาะงวดค้างที่เก่าที่สุดของสัญญา** ("earliest unpaid") —
ไม่ใช่ "งวดที่จ่ายล่าสุด + 1" ซึ่งต่างกันตอน void: void งวด 2 ขณะ 3-6 จ่ายแล้ว ⇒
งวด 2 กลับเป็น earliest unpaid และจ่ายซ้ำได้ (flow "void → เปิด wizard งวดเดิม" พึ่งข้อนี้).

Single source of truth: `assertSequentialInstallment` ใน
`apps/api/src/modules/payments/services/installment-sequence.util.ts`
(unpaid = `PENDING/OVERDUE/PARTIALLY_PAID` — งวดก่อนหน้าที่ PARTIALLY_PAID ต้องปิดก่อน).

| จุดบังคับ | ที่ | หมายเหตุ |
|---|---|---|
| บันทึกชำระ (ทุกเส้นทาง) | `PaymentReceiptOrchestrator.recordPayment` — ในตัว serializable tx | ครอบ wizard / batch / draft-post / CSV import (ไฟล์ที่เรียงงวดมาแล้วผ่านปกติ แถวที่ข้ามงวด fail รายแถวพร้อมข้อความไทย) |
| ส่ง QR | `POST /payments/:id/partial-qr` (`assertSequentialByPaymentId`) | กันตั้งแต่ตอนส่ง เพราะ… |
| **Webhook PaySolutions** | **BYPASS** (`enforceSequence=false`) | เงินถูกตัดที่ gateway แล้ว — ปฏิเสธการบันทึก = เงินจริงค้างเติ่ง (handler ตอบ 200 ไม่ retry) จึงบังคับที่ตอนส่ง QR แทน |
| UI คิวรอชำระ | `getPendingPayments` ส่ง `hasEarlierUnpaid` ต่อแถว (คำนวณจาก DB ทั้งสัญญา ไม่ใช่แค่หน้าที่เห็น — งวดค้างอาจอยู่นอก filter ช่วงวันที่) | ปุ่มรับชำระ + checkbox batch ถูก disable พร้อม tooltip |

เส้นทางที่ **ไม่**เข้าข่ายโดยธรรมชาติ: `autoAllocatePayment` / `applyCreditBalance` (FIFO อยู่แล้ว),
early payoff (JP4 — ปิดทุกงวด), reschedule (เลื่อนดิว ไม่ใช่บันทึกชำระ; 6b bundled จ่ายผ่าน
orchestrator จึงโดน guard ตามปกติ). Tests: `installment-sequence.util.spec.ts`,
`pending-sequence-flag.spec.ts`, `PaymentTable.sequence.test.tsx`.

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

> **⚠️ WIRING STATUS — DEFERRED (verified 2026-06-11).** The templates below are SCAFFOLDED
> (code + golden specs + module registration) but **only `ShopExchangeReturnTemplate` is wired
> to a production caller** (`contract-exchange.service.ts:396`). The other templates
> (`ShopCashSaleTemplate`, `ShopDownPaymentTemplate`, `ShopDownPaymentReversalTemplate`,
> `ShopInventoryTransferTemplate`, `ShopTradeInTemplate`, `ShopExpenseTemplate`) have **ZERO
> production callers** — contract activation / trade-in accept / cash sale do NOT post SHOP
> JEs. Consequence: the SHOP Trial Balance + P&L at `/shop/accounting` are **near-empty** even
> though SHOP is actively selling (real numbers live in the `Sale` table / Dashboard). The
> "Trigger" column below is the **intended** trigger, not a live one. Wiring is gated on an
> owner scope decision (Phase A.5 brief §4: should contract activation post SHOP+FINANCE
> atomically?). Do NOT treat the SHOP reports as authoritative for tax/audit until these are
> wired. Tracking: `docs/ceo-review/deep-audit-2026-06-11-findings.md` (F3).
>
> **Stale note (2026-08-01):** this box predates two events documented elsewhere in this file.
> (1) `ShopInventoryTransferTemplate` DID gain a production caller on 2026-06-23
> (`contract-workflow.service.ts`, commit `bbcfa7a3`, PR #1280) — see "Installment lifecycle
> 3-event flow" below; this box's "ZERO production callers" claim no longer holds for that one
> template specifically. (2) `ShopFinanceReceiptTemplate` — listed here as unwired as of
> 2026-06-11 — was **deleted outright** on 2026-08-01 (Inter-Co Settlement Batch, C2); it is
> removed from the list above rather than left as a dangling reference to a class that no
> longer exists. See "Inter-Co Settlement Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)" below.

All live at `apps/api/src/modules/journal/cpa-templates/`. Each is idempotent via `metadata.flow + metadata.idempotencyKey` (DB-level partial unique index since P3-SP5 DEEP fix W8 — `journal_entries_idempotency_idx`).

`CompanyResolverService` (`apps/api/src/modules/journal/company-resolver.service.ts`) is the single source of truth for `companyCode → companyId` lookup. Templates inject it instead of caching per-instance state — eliminates stale-id bugs across test seed cycles (P3-SP5 DEEP fix W3).

| Template | Trigger | Companies | Notes |
|---|---|---|---|
| `ShopCashSaleTemplate` | Sale w/ method=CASH | SHOP only | Dr cash / Cr revenue + Dr COGS / Cr inventory. No FINANCE involvement. |
| `ShopDownPaymentTemplate` | Customer pays down at contract creation | SHOP only | Dr cash / Cr S21-2001 (down payable). Cleared by `ShopInventoryTransferTemplate` at activation (NOT by settlement — that's the C1 bug fixed). |
| `ShopDownPaymentReversalTemplate` (W2) | Contract canceled BEFORE activation | SHOP only | Dr S21-2001 / Cr cash. Stamps `metadata.reversedByIdempotencyKey` onto the original down JE. |
| `ShopInventoryTransferTemplate` | Contract activated (ownership SHOP→FINANCE) | SHOP only* | Posts TWO JEs in one `$transaction` sharing `metadata.batchId`: (A) Dr S50-XXXX / Cr S11-200X (COGS); (B) Dr S11-3001 + Dr S11-3002 + Dr S21-2001 / Cr S41-XXXX + Cr S41-1201 (revenue + receivables + down clearance). ASSERTS `financedAmount + downAmount === salePrice`. |
| ~~`ShopFinanceReceiptTemplate`~~ | ~~FINANCE wires `financedAmount + commission` to SHOP~~ | — | **DELETED 2026-08-01** (Inter-Co Settlement Batch, C2) — superseded by `IntercoSettlementService.approveBatch`'s `buildShopLines`, which posts the SAME clearing leg (`Dr <shopBankCode> / Cr S11-3001 + Cr S11-3002`) directly via `PairedJournalService`/`JournalAutoService`, batched across many contracts per wire instead of one template call per contract. See "Inter-Co Settlement Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)" below. |
| `ShopTradeInTemplate` (W4) | Trade-in ACCEPTED | SHOP only | Dr `inventoryAccountCode` (default S11-2002 sellable used; optional override to S11-2004 pending evaluation) / Cr cash. |
| `ShopExpenseTemplate` | Branch expense recorded (rent/salary/utilities/etc) | SHOP only | CASH mode (Dr expense / Cr bank) or ACCRUAL mode (Dr expense / Cr S21-1103 payable). |

*`ShopInventoryTransferTemplate` is SHOP-only by design — `ContractActivation1ATemplate` posts the FINANCE side. Phase 3 SP7 will reroute through `PairedJournalService` once SHOP and FINANCE split into separate legal companies.

### Installment lifecycle 3-event flow (P3-SP5 DEEP fix C1+C2)

The complete SHOP-side bookkeeping for one installment contract:

```
Event 1 — Customer pays down (at contract creation):
  ShopDownPaymentTemplate
    Dr  S11-1101 / S11-1201 (cash/bank)   [downAmount]
       Cr S21-2001 (down-payment payable)  [downAmount]

Event 2 — Contract activation = ownership transfer SHOP → FINANCE:
  ShopInventoryTransferTemplate  (2 JEs in one $tx, shared batchId)
    JE A (COGS):
      Dr  S50-1101/02/03 (COGS)          [costPrice]
         Cr S11-2001/02/03 (inventory)    [costPrice]
    JE B (revenue + receivable + down clearance):
      Dr  S11-3001 (FINANCE rec - financed) [financedAmount]
      Dr  S11-3002 (FINANCE rec - commission) [commission]
      Dr  S21-2001 (clear down-payable)     [downAmount]
         Cr S41-1101/02/03 (revenue)       [salePrice]
         Cr S41-1201 (commission income)   [commission]
    INVARIANT: financedAmount + downAmount === salePrice

Event 3 — FINANCE wires payment to SHOP (may be days later, may be batched):
  [RETIRED 2026-08-01 — was ShopFinanceReceiptTemplate, one contract at a time.
   Now: IntercoSettlementService.approveBatch, one JE per BATCH of contracts —
   see "Inter-Co Settlement Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)" below]
    Dr  <shopBankCode> (bank, default S11-1201)   [Σ financedGl + commissionGl over the batch]
       Cr S11-3001 (clear receivable, per contract) [financedGl]
       Cr S11-3002 (clear commission rec, per contract, skips zero) [commissionGl]
```

Cancellation paths:

```
Cancel BEFORE activation (Event 2 hasn't happened):
  ShopDownPaymentReversalTemplate
    Dr  S21-2001                          [downAmount]
       Cr S11-1101/1201 (refund cash)     [downAmount]

Cancel AFTER activation:
  use existing RepossessionJP5Template (FINANCE side) +
  future SHOP repossession-reversal template (deferred to P3-SP7).
```

### Reports — multi-scope balance check (P3-SP5 DEEP fix C5)

`getTrialBalance(asOfDate, scope)` and `getProfitLossFromJournal(start, end, companyId, scope)` now return per-scope subtotals always:

```ts
tb.perScope.shop    = { drTotal, crTotal, isBalanced }
tb.perScope.finance = { drTotal, crTotal, isBalanced }
tb.isAllBalanced    = scope==='ALL' ? (shop.isBalanced && finance.isBalanced) : <single>
```

`isAllBalanced` is STRICTER than the legacy combined `isBalanced` — for `scope='ALL'` it requires BOTH halves to balance independently, not just `grandDrTotal === grandCrTotal` (which can be coincidentally equal when the SHOP unbalance is equal-and-opposite to the FINANCE unbalance).

`getProfitLossFromJournal` likewise exposes `perScope.{shop,finance}.{revenueTotal, expenseTotal, netIncome}`.

W7 defense-in-depth: when `scope !== 'ALL'`, queries also filter by `journalEntry.companyId` (resolved via `CompanyResolverService`) — so even a misposted JE (S-code line under FINANCE companyId or vice versa) won't leak into the wrong report.

### Monthly close snapshot (P3-SP5 DEEP fix W1)

`MonthlyCloseService.generateReportSnapshots()` now calls `getTrialBalance(asOfDate, 'ALL')` so both FINANCE and SHOP rows make it into the closed-period snapshot. Without the explicit scope the SHOP half was silently dropped (default scope = FINANCE).

### Reports — endpoints

Two endpoints in `accounting.controller.ts`:

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/expenses/ledger/shop/trial-balance` | OWNER, FM, ACC | SHOP-scoped Trial Balance (filters `code.startsWith('S')` + companyId) |
| GET | `/expenses/ledger/shop/profit-loss` | OWNER, FM, ACC | SHOP-scoped P&L (Revenue=S41+S42, Expenses=S50+S51+S52+S53) |

W5 policy decision: BRANCH_MANAGER is INTENTIONALLY excluded from these endpoints — they aggregate across ALL SHOP branches into one report, and BM is NOT in `CROSS_BRANCH_ROLES` (see `apps/api/src/modules/auth/branch-access.util.ts`). Widening @Roles to include BM would 403 at BranchGuard anyway. A future per-branch SHOP P&L (with `?branchId=` filter) can re-add BM.

The existing `/expenses/ledger/trial-balance` and `/expenses/ledger/profit-loss` accept `scope=FINANCE|SHOP|ALL` (defaults to `FINANCE` for backward compat). The shop-specific paths are syntactic sugar for `?scope=SHOP`.

`AccountingService.codePrefix(code)` extracts the section prefix correctly for both FINANCE (`11-1101` → `11`) and SHOP (`S11-1101` → `S11`). `SECTION_MAP` includes both sets of prefixes with SHOP entries suffixed " (SHOP)" so a combined view (scope=ALL) makes the partition obvious.

### Frontend

`/shop/accounting` — `apps/web/src/pages/ShopAccountingPage.tsx`. Two tabs (Trial Balance + P&L) with date pickers. Wired into OWNER / FINANCE_MANAGER / ACCOUNTANT menu configs under the SHOP zone with consistent label "บัญชีหน้าร้าน (SHOP)" + Store icon (W6 standardisation). BRANCH_MANAGER does NOT see this menu (W5 policy — would 403 at the API).

### Out of scope for P3-SP5 (deferred to P3-SP7)

- Multi-entity legal split (`from_company_id`/`to_company_id` on JEs become FK to separate companies)
- SHOP-side VAT reports (SHOP not VAT-registered)
- SHOP-side payroll/SSO (handled at FINANCE level for now)
- Historical migration of past SHOP transactions (forward-only)
- SHOP-side balance sheet (Trial Balance + P&L only in SP5)

---

## Inter-Co Settlement Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)

Replaces the old per-transaction `intercompany.settle` line and the never-UI-wired
`shop-finance-settlement` module with a **batch** ("รอบจ่าย") document: FINANCE pays SHOP
the accumulated ยอดจัด (21-1101) + ค่าคอม (21-1102) for one or many contracts in ONE wire,
and both sides post atomically on approval.

Spec: `docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md`
Module: `apps/api/src/modules/interco-settlement/` (`interco-pending.service.ts`,
`interco-batch-number.service.ts`, `interco-settlement.service.ts`,
`interco-settlement.controller.ts`, `interco-settlement.module.ts`)

### Model

`InterCoSettlementBatch` (table `inter_co_settlement_batches`) + `InterCoSettlementItem`
(`inter_co_settlement_items`, one row per contract in the batch —
`@@unique([batchId, contractId])`, `onDelete: Restrict` both FKs — it's financial
evidence, never allowed to dangle). Enum `InterCoBatchStatus { DRAFT PENDING_APPROVAL
POSTED REVERSED CANCELLED }`.

Doc number: `IC-YYYYMMDD-NNNN` — `IntercoBatchNumberService.next()`, same BKK-day
advisory-lock pattern as `RepairTicketDocNumberService` (max-via-`findFirst`-desc, not
`count()`, because a soft-deleted batch still occupies its number via the unique
constraint).

**Phase 2 additive columns (หักกลบ — workbook 2026-08-19):**
`InterCoSettlementItem.itemType` (enum `InterCoItemType { SETTLEMENT RECALL }`, default
`SETTLEMENT`) + `swapCreditAmount` / `recallAmount` (both `Decimal @default(0)`);
`InterCoSettlementBatch.totalDeduction` (`@default(0)`) + `netTransferAmount` /
`shopNetAmount` — the latter two are **nullable**: `null` = batch approved before Phase 2
= จ่ายเต็ม (every reader falls back `?? totalAmount` / `?? shopPostedAmount`, identical
because those batches' deduction is definitionally 0). `@@unique([batchId, contractId])`
เดิมคงไว้ — สัญญาเดียวกันอยู่ทั้งรายการจ่ายและรายการเรียกคืนในรอบเดียวกันไม่ได้
(`buildSnapshot` reject พร้อมข้อความไทยก่อนชน DB constraint).

### Lifecycle

```
DRAFT --submit--> PENDING_APPROVAL --approve--> POSTED --reverse--> REVERSED
  ^                      |  |
  +------withdraw--------+  +--cancel--> CANCELLED
  |
  +--cancel--> CANCELLED
```

- `createBatch` / `updateBatch` (maker-only, DRAFT-only — `updateBatch` hard-deletes
  and recreates the item rows, safe pre-DRAFT since no JE references them yet):
  re-snapshots the 4 GL amounts per contract from
  `IntercoPendingService.getPendingContracts()` — **never** from
  `Contract.financedAmount`/`storeCommission` (spec F4 — those fields can legitimately
  diverge from the ledger, e.g. `storeCommission = null` while the 1A JE already booked
  a 10% fallback commission on 21-1102). Any requested contractId not currently in the
  pending queue (never activated / soft-deleted / already settled in another open batch)
  throws `BadRequestException` naming the contract number. Phase 2: `CreateBatchDto` also
  accepts optional `recallContractIds` — snapshotted from
  `IntercoPendingService.getPendingRecalls()` into `RECALL` item rows (ดูหัวข้อ
  "หักกลบเครดิตเปลี่ยนเครื่อง + เรียกคืน" ด้านล่าง).
- `submitBatch`: DRAFT → PENDING_APPROVAL, maker-only; re-checks none of the batch's
  contracts got grabbed by another `PENDING_APPROVAL`/`POSTED` batch since the snapshot
  (closes the race window between two makers). Phase 2: clash check เป็น **type-aware**
  (RECALL rows clash เฉพาะกับ RECALL items — ดูหัวข้อหักกลบ).
- `withdrawBatch`: PENDING_APPROVAL → DRAFT, maker-only.
- `cancelBatch`: DRAFT/PENDING_APPROVAL → CANCELLED — role-gated at the controller
  (`ACCOUNTANT`, `FINANCE_MANAGER`), not maker-restricted in the service itself.
- `uploadSlip`: attaches proof-of-transfer to `slipFileKey` (S3 upload + magic-byte
  re-check on top of the controller's `FileTypeValidator`; PDF/JPEG/PNG/WEBP, ≤5MB) —
  maker-only, DRAFT/PENDING_APPROVAL only, optional (a backfilled historical round may
  have no surviving slip).
- `approveBatch` / `reverseBatch`: role-gated at the controller
  (`OWNER`, `FINANCE_MANAGER`) — **no maker-restriction and no maker≠approver rule by
  default** since 2026-08-03. See "Approve — atomic paired JE" step 1b for the opt-in
  `interco_maker_checker_enabled` flag.

### Pending lens (คิวรอจ่าย) — `IntercoPendingService`

Per-contract "payableOrigin", GL-only (`interco-pending.service.ts`):

```
financedGl_i    = Σ(Cr−Dr) of 21-1101 from POSTED JEs where metadata.contractId = i
commissionGl_i  = Σ(Cr−Dr) of 21-1102 from POSTED JEs where metadata.contractId = i
shopFinancedGl_i / shopCommissionGl_i = same on SHOP S11-3001 / S11-3002, sign flipped (Dr−Cr)
legacyNoShop_i  = (shopFinancedGl_i == 0) AND (shopCommissionGl_i == 0)
```

Computed via raw `$queryRaw` (`GROUP BY je.metadata->>'contractId' HAVING SUM(credit-debit)
> 0`) — Prisma cannot `GROUP BY` a JSON path. **Settlement-batch JEs never enter this
lens by construction**: they stamp `metadata.items[]` (many contracts per JE), not a
single `metadata.contractId`, so there's no metadata-filter special-casing needed to keep
them out.

**สัญญาเปลี่ยนเครื่อง (PRICED device swap) ปรากฏในคิวนี้ตั้งแต่ 2026-08-03** — ก่อนหน้านั้น
A.3 ล้าง 21-1101/21-1102 ทันทีตอน finalize (D5) เลนส์ FINANCE (`HAVING SUM(credit-debit)
> 0`) จึงไม่มีวันเห็นสัญญาเหล่านั้นเลย. ตอนนี้เจ้าหนี้ทั้งสองบัญชีค้างไว้ตามปกติ สัญญาเปลี่ยนเครื่อง
จึงจ่ายผ่านรอบจ่ายเดียวกับการขายปกติทุกประการ (`legacyNoShop = false` เพราะ F2 SHOP leg
ตั้ง S11-3001/S11-3002 ไว้ให้ SHOP half ของรอบจ่ายล้าง). พิสูจน์ที่
`exchange-priced-flow.integration.spec.ts` Case 2A (assertion ตรงข้ามกับของเดิมทุกประการ).

**Phase 2 typed lenses (หักกลบ)** — `PendingContract` gains 3 fields:
`swapCreditGl` (Σ Dr−Cr of 11-2107 filtered to type `SWAP_CREDIT` — explicit
`metadata.shopReceivableType` stamp OR legacy `metadata.flow =
'exchange-buyback-receivable-11-2107'`), `shopBuybackPayableGl` (Σ Cr−Dr of S21-3001,
keyed by `metadata.newContractId` — the A.4 stamp), and `swapCreditEligible` (ดู
eligibility rule ในหัวข้อหักกลบด้านล่าง). `getPendingRecalls()` is a separate queue of
`RecallCandidate { recallGl, shopRecallGl }` rows — contracts with 11-2107
`PAYOUT_RECALL` ค้าง **สุทธิ** > 0 (Flow C-2; producer = C-2 redirect, live ตั้งแต่ Phase 3
2026-08-20 — ดูหัวข้อ "ยกเลิกสัญญา (Flow C — Phase 3)"). **สูตร NET (Phase 3 Task 4 — ปิด
carry b)**: `recallGl = typed PAYOUT_RECALL gross − Σ(swapCreditAmount + recallAmount)
ของ item ทุกประเภทใน batch POSTED ของสัญญานั้น` (`shopRecallGl` สูตรเดียวกันฝั่ง SHOP;
net ≤ 0.01 → หลุดคิว). เดิม (Phase 2) เขียนเป็น gross — ผิดสำหรับเคสยกเลิก swap ที่เคยถูก
หักเครดิตในรอบเก่า: redirect gross 11,000 แต่เงินที่ FINANCE โอนจริง 3,000 — เสนอ gross
จะหักซ้ำ 8,000 (11-2107 ติดลบ). `GET /interco-settlement/pending` now returns
`{ pending, recalls, reconcile }`. `SHOP_COLLECT` deliberately never enters either lens
(ล้างผ่าน `settleShopCollect` ตามเดิม — เงินลูกค้า ไม่ใช่เงินระหว่างกิจการ).

**Settled gate**: a contract leaves the pending queue the instant it has an
`InterCoSettlementItem` row inside a batch with status `PENDING_APPROVAL` or `POSTED`.
`REVERSED`/`CANCELLED` items do **not** count — reversing a batch puts every one of its
contracts straight back into the queue without touching the GL lens at all. **The recall
queue's gate filters `itemType: 'RECALL'` only** — a C-2 contract BY DEFINITION carries a
permanent SETTLEMENT item in some old POSTED batch; an any-type gate would make the
recall queue structurally empty forever.

`activatedAt` shown on the pending list = `MIN(je.posted_at)` of the JEs counted in the
lens — `Contract` has no reliable "date activated" field (`createdAt` is draft-creation
time, `updatedAt` moves on any unrelated edit).

`getReconcileTotals()` — account-level sanity check, shown alongside the queue:
`pendingTotal` (Σ over the queue) vs `glFinanceTotal` (whole-account 21-1101+21-1102
balance, no metadata filter) vs `glShopTotal` (S11-3001+S11-3002, no metadata filter). A
nonzero `drift` (`pendingTotal − glFinanceTotal`) means a stray JE exists without
`metadata.contractId` — almost certainly the old `inter-company-settlement` flow; the
pre-flight check (below) confirms this is 0 in prod before go-live. Phase 2 adds 3 typed
whole-account totals: `glSwapCreditTotal` (11-2107 typed SWAP_CREDIT), `glRecallTotal`
(11-2107 typed PAYOUT_RECALL), `glShopBuybackTotal` (S21-3001, no type filter). หมายเหตุ
ตาม gross-lens ruling: สองตัวแรกเป็น typed **gross สะสม** — ขา Cr 11-2107 ของ batch JE
ไม่ stamp type/contractId จึงไม่เคยลดตัวเลขนี้ — ส่วน `glShopBuybackTotal` เป็นยอดคงเหลือ
จริงของบัญชี (ขา Dr S21-3001 ของ batch ลดจริง) ⇒ สามตัวนี้**เลิก tie กันตั้งแต่รอบแรกที่มี
การหัก โดยตั้งใจ**; Σ สองประเภท = ยอด S21-3001 เฉพาะช่วงก่อนรอบหักแรกเท่านั้น.

### Approve — atomic paired JE (`approveBatch`, one `$transaction`)

Exact order as implemented in `interco-settlement.service.ts`:

1. **Load + status** — batch must be `PENDING_APPROVAL`.
1b. **Maker–checker (opt-in, DEFAULT OFF — คำสั่งเจ้าของ 2026-08-03)** — the hard
   "approver ≠ maker" rule was **retired**. Approval is now governed by **role
   assignment** alone: `@Roles('OWNER','FINANCE_MANAGER')` on
   `POST /interco-settlement/batches/:id/approve`. The SAME person may create a batch
   and approve it, provided they hold an approver role (กิจการเล็ก — เจ้าของสั่งให้คุม
   ด้วยการกำหนดสิทธิแทน). Strict segregation of duties is re-enablable **without a code
   change**: set SystemConfig **`interco_maker_checker_enabled` = `'true'`** and
   `approveBatch` restores `throw new ForbiddenException('ผู้อนุมัติต้องไม่ใช่ผู้สร้างรอบ')`
   when `batch.makerId === userId`. The key is **NOT seeded** anywhere — a missing row,
   or any value other than the exact string `'true'` (including `'false'`), means OFF.
   Read via `tx.systemConfig.findUnique({ where: { key: 'interco_maker_checker_enabled' } })`
   **inside the approve `$transaction`** so one value governs the whole approval — the
   same config-read shape as `OTHER_INCOME_MAKER_CHECKER_ENABLED`
   (`other-income-config.service.ts`) and `jp5_require_terminated_status`
   (`repossessions.service.ts`). No toggle endpoint / UI exists for this key yet —
   flip it with a SystemConfig row.
   **Audit trail is unchanged either way**: `makerId` and `approverId` are both still
   persisted on the batch row, and the `INTERCO_BATCH_APPROVED` AuditLog still records
   the acting `userId` — even when maker and approver are the same human.
2. **Double-batch re-check** — re-runs the "another open batch already grabbed this
   contract" query inside the tx (same query `submitBatch` ran, closes the remaining
   race window right up to the moment of posting). Phase 2: **type-aware** — SETTLEMENT
   rows keep the any-type clash (double-pay guard), RECALL rows clash only with other
   RECALL items (ดูหัวข้อหักกลบ — เหตุผลเชิงโครงสร้าง).
3. **Drift guard** — per item, reads the LIVE GL via `glContractBalance(tx, contractId,
   accountCode, side)` on all 4 lens accounts (`21-1101` cr, `21-1102` cr, `S11-3001` dr,
   `S11-3002` dr) and compares against the item's snapshot, tolerance `±0.01`. This
   deliberately does NOT reuse `IntercoPendingService.getPendingContracts()` — that
   service's own "settled" exclusion would hide this very batch's own
   `PENDING_APPROVAL` items from itself. Any drift → rejects the WHOLE batch, naming
   every drifted contract number, telling the maker to cancel and recreate (no partial
   approve). Phase 2 extends this with typed 11-2107/S21-3001 checks — a **two-branch**
   design (ดูหัวข้อหักกลบ): RECALL rows check both books' typed PAYOUT_RECALL balances
   against `recallAmount` instead of the 4 lens accounts.
4. **Period guard, both companies independently** —
   `validatePeriodOpen(tx, postedAt, financeCompanyId)` AND
   `validatePeriodOpen(tx, postedAt, shopCompanyId)` (SHOP has its own
   `AccountingPeriod` rows). `postedAt = postedAtOverride ?? batch.transferDate` (D4 —
   `ApproveBatchDto.postedAt` is the backdate override).
5. **Post JE(s)**:
   - If `buildShopLines` returns ≥1 line (i.e. ≥1 SETTLEMENT item with
     `legacyNoShop = false` **or** ≥1 deduction row — swap credit / recall) →
     `PairedJournalService.postPaired({ shop, finance, batchRef: batch.id }, tx)` —
     both halves in one transaction, balance-checked before either side posts.
   - If the SHOP half is empty (every item `legacyNoShop` and no deduction rows) →
     approve skips `postPaired` entirely and posts FINANCE alone via
     `JournalAutoService.createAndPost` — `shopJournalEntryId` stays `null`.
   - A concurrent double-approve losing the DB idempotency-index race gets a Thai
     `ConflictException` (409), not a raw 500 — the whole tx rolls back.
6. **Mark `InterCompanyTransaction`** rows whose `contractId` is in this batch →
   `RECONCILED` (best-effort `updateMany`, no-op if none exist — does not block posting).
7. **Batch → `POSTED`** + `financeJournalEntryId`/`shopJournalEntryId`/`approverId`/
   `postedAt` set + `AuditLog { action: 'INTERCO_BATCH_APPROVED', entity:
   'interco_settlement_batch' }`.
8. **AFTER the tx commits** — fire-and-forget `alarmNettingResiduals(batchId)` (spec
   §4.7): alarm-only, never awaited/thrown on the money path, root prisma only
   (doctrine R-1 — same rule as `alarmResidualParkOnCompletion`). ดูหัวข้อหักกลบ.

### JE structure (both halves — `buildFinanceLines`/`buildShopLines`, รูปหักกลบ Phase 2)

FINANCE half (always posted):
```
Dr 21-1101  financedGl      (ONE line PER SETTLEMENT contract, description "ล้างเจ้าหนี้ยอดจัด {contractNumber}")
Dr 21-1102  commissionGl    (one line per contract WITH commissionGl > 0 — zero-commission contracts skip this line)
   Cr 11-2107  swapCreditAmount|recallAmount   (one line PER deduction row — description ระบุประเภท:
                                                "หักเครดิตเปลี่ยนเครื่อง {no}" / "หักเรียกคืนจากยกเลิก {no}")
   Cr <financeBankCode>  netTransferAmount     (default '11-1201'; line SKIPPED when 0 —
                                                รอบที่หักจนเงินโอนจริงเป็นศูนย์ต้องไม่มีบรรทัดธนาคาร)
```

SHOP half (settlement legs over items with `legacyNoShop = false`; deduction legs over
every deduction row; the WHOLE half is omitted only when BOTH sets are empty):
```
Dr <shopBankCode>  shopNetAmount            (default 'S11-1201' = ShopAccountResolver.SHOP_RECEIVING_BANK; skipped when 0)
Dr S21-3001  swapCreditAmount|recallAmount  (one line per deduction row — "ล้างเจ้าหนี้ FINANCE-ค่าเครื่องรับคืน {no}" /
                                             "ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก {no}")
   Cr S11-3001  shopFinancedGl      (one line per non-legacy SETTLEMENT contract)
   Cr S11-3002  shopCommissionGl    (skips zero, same as the FINANCE half)
```

RECALL rows contribute ONLY the `Cr 11-2107` / `Dr S21-3001` legs — never a zero-amount
`Dr 21-1101` line. Pre-Phase 2 batches (`netTransferAmount`/`shopNetAmount` = `null`)
fall back to `totalAmount`/`shopPostedAmount` — identical lines to the old shape.

**ตัวอย่าง (golden ใน `interco-netting.integration.spec.ts` — 2 สัญญาปกติ/สวอป เจ้าหนี้
11,000 ต่อสัญญา (10,000 + 1,000), เครดิตสวอป 8,000 + เรียกคืน 11,000):**
`totalAmount = 22,000` / `totalDeduction = 19,000` / `netTransferAmount = shopNetAmount
= 3,000` → FINANCE: `Cr 11-2107 = 19,000` + `Cr 11-1201 = 3,000`; SHOP: `Dr S21-3001 =
19,000` + `Dr S11-1201 = 3,000`. หลัง approve บัญชี 11-2107 ทั้งบัญชีลดลง 19,000 จริง.

**Metadata on BOTH JEs** (confirmed straight from `interco-settlement.service.ts` —
these are the ACTUAL keys, do not assume the plan's shorthand `batchId` key name):

```ts
{
  flow: 'interco-settlement-batch',
  idempotencyKey: `interco:${batch.id}:FINANCE` /* or */ `interco:${batch.id}:SHOP`,
  settlementBatchId: batch.id,       // NOT "batchId" — that name is PairedJournalService's
                                      // own batchRef param, distinct from this metadata key
  batchNumber: batch.batchNumber,     // e.g. "IC-20260801-0001"
  transferDate: batch.transferDate.toISOString(),
  netTransferAmount: '<2dp string>',  // = totalAmount for pre-Phase 2 fallback
  items: [{ contractId, type: 'SETTLEMENT'|'RECALL', financed: '<2dp string>',
            commission: '<2dp string>', swapCredit: '<2dp string>',
            recall: '<2dp string>' }, ...],
}
```

**Deliberately NO top-level `contractId`/`shopReceivableType`** on batch JEs — the
architecture ruling (ดูหัวข้อหักกลบ) keeps them out of every per-contract lens.

Idempotency: the usual partial unique index `journal_entries_idempotency_idx` covers
`flow + idempotencyKey` — re-approving an already-POSTED batch is blocked at the status
guard (step 1) long before idempotency would even matter.

### หักกลบเครดิตเปลี่ยนเครื่อง + เรียกคืน (Phase 2 — workbook 2026-08-19)

Spec: `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md`
§4. เปลี่ยนรอบจ่ายจาก "เงิน 2 ขา" (FINANCE จ่ายเต็ม → SHOP โอนราคารับซื้อกลับผ่าน
shop-collect) เป็น **หักกลบเหลือโอนสุทธิขาเดียว**: เครดิตราคารับซื้อ (11-2107
`SWAP_CREDIT` ↔ S21-3001) และยอดเรียกคืนจากยกเลิก C-2 (11-2107 `PAYOUT_RECALL` ↔
S21-3001) ถูกหักออกจากเงินโอนของรอบ. Typed-balance helpers 4 ตัวอยู่ที่
`interco-typed-balance.ts` (`swapCreditFinanceBalance` / `swapCreditShopBalance` — ฝั่ง
SHOP key ด้วย `metadata.newContractId` ตาม A.4 stamp / `recallFinanceBalance` /
`recallShopBalance` — key ด้วย `metadata.contractId`) — **SQL twins** ของเลนส์ใน
`IntercoPendingService` และต้องสอดคล้อง `classifyShopReceivable`: แก้ที่ไหนต้องแก้ทั้งคู่.

**สถาปัตยกรรม "เลนส์ typed = GROSS + settled ผ่าน item gate"** (คำตัดสินระหว่าง implement
— บันทึกใน plan Task 5): batch JE **ไม่ stamp** top-level `contractId` /
`shopReceivableType` (กันรั่วเข้า payable lens — คุณสมบัติเดิมตั้งแต่ C2) ⇒ ขา
`Cr 11-2107`/`Dr S21-3001` ของ batch **ไม่ลด typed balance ต่อสัญญา** — typed lens อ่านได้
เฉพาะขาตั้งหนี้ (gross) โดยตั้งใจ. "หักแล้วหรือยัง" อยู่ที่ `InterCoSettlementItem`
(settled gate) ไม่ใช่ GL metadata. ผลตามมา: residual ที่แท้จริงของสัญญา = typed gross −
Σ deduction ของสัญญานั้นใน batch สถานะ `POSTED` ทั้งหมด (ไม่ใช่ "typed balance ต้องเป็น 0
หลัง approve" — ค่านั้นไม่มีวันเป็น 0 ใต้สถาปัตยกรรมนี้).

**Eligibility rule** (`swapCreditEligible` ใน pending lens): หักได้เมื่อ **สองสมุดมียอด
ทั้งคู่และเท่ากัน ±0.01** (`swapCreditGl > 0 && shopBuybackPayableGl > 0 && |diff| ≤
0.01`). **Legacy swap** (finalize ก่อน Phase 1 — มี 11-2107 แต่ไม่มี S21-3001, spec §11.4)
จึง `eligible = false` โดยโครงสร้าง → เข้ารอบจ่ายได้ตามปกติแต่**ไม่มีบรรทัดหัก** (จ่ายเต็ม)
— เครดิต 11-2107 ของมันค้างไว้ล้างผ่าน shop-collect ตามเดิม. ห้ามหักฝั่งเดียว: ฝั่ง SHOP
ไม่มี S21-3001 ให้ Dr → ใบ SHOP ไม่ balance.

**Guards ตอน snapshot (`buildSnapshot` — createBatch/updateBatch, จับตอน submit/approve
อีกทีผ่าน re-check/drift):**
- สองสมุดมียอดทั้งคู่แต่ไม่เท่ากัน (`swapCreditGl > 0 && shopBuybackPayableGl > 0 &&
  !eligible`) → reject "ยอดเครดิตเปลี่ยนเครื่องสองสมุดไม่ตรงกัน" — GL ผิดปกติ
  ห้ามเดาหักข้างใดข้างหนึ่ง (legacy swap ที่ SHOP = 0 ไม่เข้าเงื่อนไขนี้).
- **Workbook IF guard ("คงสูตร IF ห้ามลบ")**: `swapCreditAmount ≥ payable ของสัญญานั้น`
  → reject (ราคารับซื้อต้องน้อยกว่าเจ้าหนี้ — นโยบายธุรกิจบอกว่าไม่เกิด).
- **ยอดสุทธิ ≥ 0 ทั้งสองสมุด**: `netTransferAmount < 0 || shopNetAmount < 0` → reject
  พร้อมแนะให้เลือกสัญญาเพิ่มหรือเรียกเงินสดคืนผ่านช่องทางรับโอนจากหน้าร้านแทน.
- ยอดเรียกคืนสองสมุดไม่ตรงกัน (`|recallGl − shopRecallGl| > 0.01`) → reject.
- W1 ขยาย: GL component ติดลบตัวใดตัวหนึ่งใน 6 บัญชีเลนส์ (เดิม 4 + 11-2107/S21-3001)
  → Sentry warning (`subsystem: 'interco-settlement'`) + reject.

**RECALL rows** (Flow C-2): เลือกผ่าน `CreateBatchDto.recallContractIds` → validate กับ
`getPendingRecalls()`; แถวมี GL snapshot ทั้ง 4 = 0, `legacyNoShop = false`, มีเฉพาะ
`recallAmount` (= ยอด **net** จากคิว — สูตร Phase 3 Task 4 ด้านบน). **Producer ของ JE
`PAYOUT_RECALL` live แล้ว (Phase 3 2026-08-20)** — C-2 redirect ตอนยกเลิกสัญญาหลังตัดจ่าย
(ดูหัวข้อ "ยกเลิกสัญญา (Flow C — Phase 3)"). ล้างได้ 2 ทาง: หักกลบรอบจ่าย (ทางนี้) หรือรับ
เงินสดคืนผ่าน `POST /interco-settlement/recalls/:contractId/settle-cash` (Phase 3 Task 6 —
reuse `ShopCollectSettlementTemplate` + `typeStamp: 'PAYOUT_RECALL'` + SHOP leg).

**Type-aware clash checks** (submit + approve step 2): แถว SETTLEMENT clash กับ item
ทุกประเภทใน batch เปิดอื่น (กันจ่ายซ้ำ — พฤติกรรมเดิม); แถว RECALL clash **เฉพาะกับ RECALL
item** — จำเป็นเชิงโครงสร้าง: สัญญา C-2 โดยนิยามมี SETTLEMENT item ถาวรใน batch POSTED
เก่า (รอบที่เคยจ่ายมัน) — ถ้า clash any-type รอบที่มีแถว recall จะ submit/approve ไม่ได้
ตลอดกาล. Mirror นิยามเดียวกับ settled gate ของ `getPendingRecalls`.

**Drift guard สองชั้น (approve step 3, แถว SETTLEMENT):**
- **(ก)** `swapCreditAmount > 0` → live typed balance **ทั้งสองสมุด** ต้องเท่ากับ snapshot
  ±0.01 — ไม่ตรง = drift.
- **(ข)** snapshot = 0 แต่ live มีเครดิต **nettable ทั้งสองสมุด** (`scFin > 0.01 && scShop
  > 0.01`) → drift — เครดิตที่หักได้จริงงอกหลัง snapshot; จ่าย gross ทั้งที่มีเครดิต
  nettable จะทำให้เครดิตนั้นไม่มีเจ้าหนี้เหลือให้หักตลอดกาล. **เงื่อนไข "สองสมุด" สำคัญ**:
  เครดิตสมุดเดียว (`scFin > 0, scShop = 0` — legacy swap §11.4) จงใจ**ไม่ใช่ drift**
  เพราะมันหักไม่ได้โดยโครงสร้างอยู่แล้ว — ถ้านับเป็น drift รอบที่มี legacy swap จะอนุมัติ
  ไม่ได้ตลอดกาล (cancel → สร้างใหม่ก็ snapshot 0 เท่าเดิม = deadlock).
- แถว RECALL (สูตร NET — Phase 3 Task 4, ปิด carry b): เทียบ live typed `PAYOUT_RECALL`
  ทั้งสองสมุด **หักด้วย Σ deduction ที่ batch POSTED อื่นเคยหักไปแล้ว (ทุก itemType)** กับ
  `recallAmount` ±0.01 — snapshot จาก `getPendingRecalls` เป็น net อยู่แล้ว live จึงต้อง
  เทียบสูตรเดียวกัน (เทียบ gross ตรงๆ จะ reject รอบ recall ที่ถูกต้องตลอดกาลสำหรับ swap
  ที่เคยถูกหักเครดิตในรอบเก่า).

**Residual alarm (spec §4.7)** — `alarmNettingResiduals(batchId)`: fire-and-forget
**หลัง tx commit** จาก `approveBatch` (root prisma เท่านั้น, doctrine R-1 — ห้าม
throw/await บนเส้นทางเงิน). ต่อ item ที่มี deduction > 0 — **สูตร COMBINED ต่อสัญญา
(Phase 3 Task 4 — ปิด carry b)**: `typed gross = SWAP_CREDIT + PAYOUT_RECALL รวมสองประเภท
ต่อสมุด (แยกสมุด)`, `residual = typed gross − Σ deduction ทุก itemType ของสัญญานั้นใน
batch POSTED ทั้งหมด`; `|residual| > 0.01` → `Sentry.captureMessage` warning
`subsystem: 'interco-netting'` (extra: typedFinanceGross/typedShopGross/postedDeduction/
financeResidual/shopResidual). เหตุที่ต้องรวมประเภท: สัญญา swap ที่ถูกยกเลิกภายหลัง (C-2)
มีประวัติข้ามประเภทบนสัญญาเดียว — SWAP_CREDIT ถูก mirror ตอน cancel จน typed เหลือ 0 ขณะที่
deduction 8,000 ยังค้างถาวรใน item table ส่วน PAYOUT_RECALL ถือ gross 11,000 ของ redirect;
เทียบทีละประเภทตาม itemType ของแถว (สูตร Phase 2 เดิม) จะ false-alarm ทันที — invariant
"= 0" ถือจริงที่**ระดับสัญญา** ไม่ใช่ระดับประเภท. ค่าปกติ = 0 พอดี; > 0 = เครดิตงอกหลัง
snapshot/หักไม่ครบ; < 0 = หักซ้ำ.

**Reverse**: mirror สองใบตามเดิม (ไม่ต้องแก้อะไรเพิ่ม) — ขา mirror `Dr 11-2107 /
Cr S21-3001` ทำให้เครดิตกลับมาค้าง และสัญญา/แถว recall กลับเข้าคิวเองโดยนิยาม settled
gate (item หลุดจาก `POSTED`).

**CI**: `deploy-gcp.yml` vitest step ครอบอยู่แล้วโดยไม่ต้องแก้ — `INTERCO_FILES=$(ls
src/modules/interco-settlement/__tests__/*.integration.spec.ts)` glob จับ
`interco-netting.integration.spec.ts` อัตโนมัติ และ step รันด้วย `--no-file-parallelism`
อยู่แล้ว (integration specs แชร์ DB เดียวกัน).

**รอ Phase 4 (carry — บันทึกไว้ อย่าลืม; (a)/(b) ปิดโดย Phase 3 2026-08-20):**
- ~~(a) C-2 producer ต้องตั้ง `PAYOUT_RECALL` เฉพาะเมื่อ batch ที่จ่ายสัญญานั้น POSTED
  จริง~~ — **ปิดแล้ว (Phase 3 Task 3/5)**: ตัว detection ของ C-2 เองคือ "มี
  `InterCoSettlementItem` type SETTLEMENT ใน batch **POSTED**" (`settledPayoutByContract`)
  — recall เกิดเฉพาะเมื่อจ่ายจริงแล้วโดยนิยาม; batch DRAFT/PENDING_APPROVAL ถูก guard
  ให้ถอนก่อนยกเลิก.
- ~~(b) residual alarm ควรแยก `postedDeduction` ตาม `itemType` กัน false warning~~ —
  **ปิดแล้ว (Phase 3 Task 4) ด้วยทิศตรงข้าม**: invariant ถือจริงที่ระดับสัญญา ไม่ใช่ระดับ
  ประเภท — alarm รวม typed สองประเภทต่อสมุดก่อนหัก Σ POSTED deductions (ดู "Residual
  alarm" ด้านบน) และ recall lens/drift เปลี่ยนเป็นสูตร net.
- (c) เครดิต A.3-only ที่งอก**หลัง** approve (drift guard จับได้เฉพาะก่อน approve) —
  จุด hook คือ reconcile cron รายเดือน (Phase 4 — `interco-reconcile.cron`).
- (d) **TOCTOU settle-cash vs approveBatch** (Phase 3 Task 6 review): `settleRecallCash`
  เป็น Serializable แต่ `approveBatch` เป็น default isolation — หน้าต่างแคบที่รอบ recall
  ถูก approve พร้อมกับการรับเงินสดคืนบนสัญญาเดียวกันยังพึ่ง guard "RECALL item ใน batch
  เปิด" + drift guard ฝั่ง approve เป็นหลัก ไม่ใช่ SSI ร่วมกัน — ตาข่ายสุดท้าย = reconcile
  cron (Phase 4).
- (e) **คิว recall กรอง net ฝั่ง FINANCE เท่านั้น** (`recallGl.lte(0.01) → continue`) —
  shop-net mismatch ที่เกิดหลัง snapshot เงียบจนถึง residual alarm / guard สองสมุดตอนใช้
  ยอดจริง — ขอบเขต reconcile cron (Phase 4).

### `legacyNoShop` policy (F1/F2)

A contract is `legacyNoShop = true` when its SHOP-side GL (S11-3001 + S11-3002) is
exactly 0 for that contract. These contracts settle FINANCE-only: no SHOP JE line is
generated for them at all, and if EVERY item in a batch is `legacyNoShop`, the SHOP half
is skipped entirely (`shopJournalEntryId` stays `null`).

**นิยามแคบลง 2026-08-03** — สัญญาจาก **contract-exchange (device swap) ไม่ใช่กรณี
`legacyNoShop` อีกต่อไป** (ข้อความเดิมของหัวข้อนี้ที่นับ device swap รวมอยู่ด้วย **ยกเลิก**):
ตั้งแต่ 2026-08-01 (F2) มันโพสต์ SHOP leg แล้ว และตั้งแต่ 2026-08-03 (คำสั่งเจ้าของ ยกเลิก D5)
มันปล่อยให้ทั้งสองฝั่งค้างไว้ จึงเข้าคิวจ่ายเป็นแถวปกติที่ `legacyNoShop = false`.
`legacyNoShop = true` เหลือความหมายเดียวคือ **สัญญาที่ activate ก่อน 2026-06-23**
(commit `bbcfa7a3`, PR #1280 — ก่อน SHOP-side receivable ถูกต่อเข้า
`contract-workflow.service.ts`).

`batch.shopPostedAmount` only sums the non-legacy items, so it can be strictly less than
`batch.totalAmount` — the gap is real money FINANCE wired to SHOP with no SHOP-side
receivable on record to clear it against. **Phase 2 note: `shopPostedAmount` keeps its
original meaning — ยอดลูกหนี้ฝั่ง SHOP ที่ถูกล้าง (Σ Cr S11-3001 + S11-3002) — it is NO
LONGER the cash figure once a batch has deductions; เงินรับจริงฝั่ง SHOP =
`shopNetAmount` (= shopPostedAmount − totalDeduction).** Likewise `totalAmount` is still
Σ เจ้าหนี้ (gross), never the wire amount — that's `netTransferAmount`. **The system deliberately does not guess a JE
for that gap.** It is an open opening-balance question pending CPA ruling (spec §11):
should the SHOP books get a retroactive opening balance for the May–22 Jun 2026 window
(pre-SHOP-books era)? Do not invent a JE to close this gap without that ruling. (The
sibling question "should device-swap contracts get a SHOP leg wired at all?" is **ANSWERED
— yes**, F2 2026-08-01; those contracts are no longer part of this gap.)

### Reverse (`reverseBatch`, POSTED → REVERSED)

`OWNER`/`FINANCE_MANAGER` only, `reason` required (≥10 characters, Thai error message on
violation). Mirror-reverses **both** JEs in one `$transaction`: for every line, swaps
Dr/Cr, keeps the same `companyId`, and posts via `JournalAutoService.createAndPost` with
`metadata.tag: 'REVERSAL'`, `metadata.flow: 'interco-settlement-batch-reverse'`,
`metadata.idempotencyKey: interco-reverse:<originalJeId>`, `metadata.reversesEntryId:
<originalJeId>` (the same reversal shape used elsewhere in the codebase, e.g.
`ExchangeCancelReversalTemplate`). The original JEs are NOT soft-deleted or unposted —
they're stamped `metadata.reversed = true` + `metadata.reversedByEntryNumber` and stay
`POSTED` for audit trail; the two mirror JEs sit beside them. Batch → `REVERSED` +
`reverseReason` persisted. Because the pending engine's "settled" gate only excludes
`PENDING_APPROVAL`/`POSTED` items, reversing a batch instantly returns every one of its
contracts to the pending queue — no GL-lens code path change needed, it falls out of the
gate definition automatically.

### D4 — backdated / closed-period rounds

`ApproveBatchDto.postedAt` (optional ISO date string) lets the checker pin the posted
JE's date to a day inside an already-open accounting period, independent of
`batch.transferDate` (the real wire date, recorded once at `createBatch` time and always
echoed into the JE description via `formatBkkDate(batch.transferDate)` regardless of
which `postedAt` is chosen). If the period guard rejects either company's period,
`guardPeriodOpen` re-wraps the underlying `BadRequestException` to name WHICH company
(FINANCE or SHOP) has the closed period, and tells the maker their two options: pick a
`postedAt` in a month that's still open, or ask an OWNER to reopen the period through the
existing `PERIOD_REOPENED` flow (`.claude/rules/accounting.md` → "Reopen Period
workflow" above).

### Retirements

| Old thing | Status | Superseded by |
|---|---|---|
| `POST /accounting/intercompany/settle` (+ `settleWithJournal`) | Route kept, now returns `HttpStatus.GONE` (410) with a Thai message pointing at `/interco-settlement` — deliberately not deleted outright, so a stale script/client still calling it gets an actionable error instead of a silent 404 | `POST /interco-settlement/batches/:id/approve` |
| `apps/api/src/modules/shop-finance-settlement/` (whole module — never had a UI) | **Deleted** | `IntercoSettlementService.approveBatch`'s SHOP half (`buildShopLines`) |
| `ShopFinanceReceiptTemplate` | **Deleted** — zero remaining references anywhere under `apps/api/src`, including `journal.module.ts` (confirmed by grep) | SHOP JE lines built inline in `approveBatch` and posted via `PairedJournalService`/`JournalAutoService` directly — no template class for this leg anymore |
| `VendorClearanceTemplate` | **Deleted** — dead code, never had a production caller; removed from `journal.module.ts` | `buildFinanceLines` inline in `approveBatch` |
| `IntercompanyService.getOutstandingBalance()` | Formula corrected (was: FINANCE from `21-1102` only — missed `21-1101`, the bulk of the payable — plus SHOP from `11-2105`, a dead Phase A.3 placeholder account nothing ever posts to) | New: FINANCE = Σ(Cr−Dr) `21-1101`+`21-1102` (companyId FINANCE); SHOP = Σ(Dr−Cr) `S11-3001`+`S11-3002` (companyId SHOP); response includes `driftNote: 'ส่วนต่าง = สัญญาก่อน 2026-06-23/เปลี่ยนเครื่อง (สมุด SHOP ยังไม่ตั้งลูกหนี้)'` so a nonzero drift reads as expected-legacy rather than a bug |
| `InterCompanyTransaction` model | **Kept** (read-only history) — `approveBatch` step 6 marks matching rows `RECONCILED` best-effort; not retired this sprint |

### Pre-flight (prod, before enabling)

See `docs/accounting/interco-preflight-2026-08.sql` for the 3 read-only queries (old-flow
JE count, FINANCE/SHOP payable backlog split by pre/post 2026-06-23, GL S11-3001/S11-3002
vs FINANCE cross-check) — run via cloud-sql-proxy per the usual runbook before creating
the first live batch.

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

Key accounts (from FINANCE chart — 111 บัญชี ณ 2026-08-08):
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

### Settings UI consolidation (P1–P6, 2026-06)

`/settings` is a registry-driven panel, OWNER/FM/ACC with per-item role filtering from `apps/web/src/config/settings-registry.tsx` (9 categories: company / access / accounting / finance / products / comms / ai / integrations / system). Routes: `/settings` → first visible category; `/settings/:categoryId` (panel) → `SettingsCategoryRoute` (index) + `SettingsItemRoute` (`:itemId`). Inline items render as sections (with hash anchor + scroll-to-section); route items render full pages inside the panel; pages with their own tabs (document-config, rich-menu) + operational pages (users / branches / promotions / contract-templates / audit-logs / pdpa) stay external. Old hash tabs (`#vat`, `#users`, etc.) and old `/settings/<name>` paths redirect to the new `/settings/<cat>/<item>` URLs. Settings are also indexed into the global CommandPalette. Helpers: `visibleCategories` / `visibleItems` / `searchSettings` / `findItem` in `settings-access.ts`.

**เชื่อมต่อ (integrations: hub + MDM) split out of the system category into its own category on 2026-06-24; system is now OWNER-only.** Old `/settings/system/integrations` and `/settings/system/mdm` redirect to `/settings/integrations/hub` and `/settings/integrations/mdm` respectively. ACCOUNTANT can see the `integrations` category (hub item has ACCOUNTANT role) but no longer sees `system` (all remaining system items are OWNER-only).

**Navigation is sidebar-driven (P5):** the gear/"ตั้งค่ากลาง" zone sidebar lists the 9 registry categories (`buildSettingsZoneSections` in `menu.ts` → `getSidebarForRole(role,'settings')`); the panel itself has NO desktop left sub-nav (just `SettingsLayout` header + search + `<Outlet/>`); mobile keeps a `<select>` category dropdown. One nav set, no menu-in-menu.

**รายชื่อผู้ติดต่อ (contacts) is standalone (P6):** removed from the `company` category and surfaced as the FIRST item inside the gear-zone "ตั้งค่าระบบ" submenu (a single section via `buildSettingsZoneSections`, above the registry categories — relabelled from the earlier "สมุดผู้ติดต่อ"/separate "ข้อมูลหลัก" group on 2026-06-24) → the existing `/contacts` page (`ContactsPage` → `ContactsTab`; guarded OWNER/FM/ACC). Old `/settings#contacts` redirects to `/contacts`. Because contacts was the only ALL-role item under `company`, that category is now effectively OWNER-only (`company.roles: ['OWNER']`) and no longer appears in FM/ACC's panel — they reach contacts via the settings submenu + CommandPalette ("รายชื่อผู้ติดต่อ"). The user-facing term is "รายชื่อผู้ติดต่อ" across menu/palette/page/contact-picker; code/comments still use "party master".

---

## REPAIR_SERVICE (SP5 Phase 2)

Auto-created on RepairTicket close (`returnToCustomer()`) depending on who pays the repair cost.

### Payer routing

| Payer | Document Created | Account | Notes |
|-------|-----------------|---------|-------|
| `SHOP` | `ExpenseDocument` (DRAFT) | `S51-1105` ค่าซ่อมอุปกรณ์ลูกค้า (SHOP CoA) | Dr. SystemConfig key: `REPAIR_EXPENSE_ACCOUNT_CODE` |
| `CUSTOMER` | `OtherIncome` (DRAFT) | `S42-1101` รายได้บริการซ่อม (SHOP CoA, new S42 service-revenue group) | Cr. SystemConfig key: `REPAIR_INCOME_ACCOUNT_CODE` |
| `SUPPLIER_CLAIM` | No accounting document | n/a | Physical supplier claim — no JE |

### Key design points
- Vendor = `repairSupplierId` from the repair ticket (must be a Supplier with `isRepairCenter = true`).
- Both documents are created as **DRAFT** — accountant reviews and posts manually. No auto-post on ticket close.
- The document creation is **atomic** via Prisma `$transaction` alongside the status transition. If document creation fails, the ticket status does NOT advance.
- `metadata.repairTicketId` is stamped on the created document for traceability (visible in audit log + document detail page).
- Document number: `EX-YYYYMMDD-NNNN` (expense) or `OI-YYYYMMDD-NNNN` (other income) — same convention as all other modules.

### SystemConfig keys
| Key | Default | Type |
|-----|---------|------|
| `REPAIR_EXPENSE_ACCOUNT_CODE` | `S51-1105` | SHOP CoA code (ค่าซ่อมอุปกรณ์ลูกค้า) |
| `REPAIR_INCOME_ACCOUNT_CODE` | `S42-1101` | SHOP CoA code (รายได้บริการซ่อม — new S42 service-revenue group) |

Owner sign-off on codes: 2026-05-20 (S51-1105 + S42-1101 + new S42 service-revenue group).

### Source
`apps/api/src/modules/repair-tickets/repair-tickets.service.ts` → `returnToCustomer()` for the atomic cross-module flow.

### Repair Ticket document number
| Module | Prefix | Example |
|--------|--------|---------|
| Repair Ticket | `RT` | `RT-20260519-0001` (per-day BKK sequence) |

`RepairTicketDocNumberService` uses the same advisory-lock BKK-day-bounds pattern as `DocNumberService`.

---

## Year-End Closing (P3-SP1, + Step 4 C3 2026-08-01)

Runs once at the end of each fiscal year (typically Jan-March of the following
year, after all 12 monthly periods are CLOSED). Closes revenue + expense
accounts into Income Summary (39-9999), transfers net income/loss to Retained
Earnings — current year (33-1101 — กำไร(ขาดทุน)สุทธิประจำปี), then sweeps
33-1101 into Retained Earnings — accumulated (32-1101 — กำไร(ขาดทุน)สะสม).

**Step 4 เพิ่มตามคำสั่ง CPA CSV (owner อนุมัติ 2026-08-01)** — `finance-coa.csv`
rows 80/82 instruct: 33-1101 "กำไรปีปัจจุบัน — ปิดเข้า 32-1101 สิ้นปี", 32-1101
"ยกยอดจากปีก่อน ปิดบัญชีเข้านี้สิ้นปี". ก่อนหน้านี้ 33-1101 ไม่เคยถูกปิดเข้า
32-1101 จริง — Step 4 ทำให้ตรงตามผังบัญชี CPA ก่อนปิดปี 2026 จริง.

Template: `apps/api/src/modules/journal/cpa-templates/year-end-closing.template.ts`
Service: `apps/api/src/modules/accounting/closing.service.ts`
Page: `apps/web/src/pages/YearEndClosingPage.tsx` → route `/finance/year-end-closing`

### 4-step JE flow

All entries share `metadata.batchId` (uuid) for traceability:

```
Step 1 — Close revenue (per non-zero 41/42-XXXX account):
  Dr 41-XXXX  [net Cr balance for the year]
  Dr 42-XXXX  ...
    Cr 39-9999 Income Summary  [revenueTotal]

Step 2 — Close expenses (per non-zero 51/52/53/54-XXXX account):
  Dr 39-9999 Income Summary  [expenseTotal]
    Cr 51-XXXX  [net Dr balance]
    Cr 52-XXXX  ...

Step 3 — Transfer net to retained earnings, current year (skipped if net = 0):
  If profit:  Dr 39-9999 / Cr 33-1101  [netIncome]
  If loss:    Dr 33-1101 / Cr 39-9999  [|netLoss|]

Step 4 — Sweep 33-1101 into 32-1101, accumulated (skipped if the LIVE
33-1101 GL balance is effectively 0 after Step 3):
  If Cr balance (กำไร):    Dr 33-1101 / Cr 32-1101  [balance]
  If Dr balance (ขาดทุน):  Dr 32-1101 / Cr 33-1101  [|balance|]
```

Step 4 reads the **live GL balance of 33-1101** (query runs AFTER Step 3 posts,
inside the same `$transaction` — Postgres sees a transaction's own earlier
uncommitted writes) rather than passing `netIncome` straight through. This
means any PRIOR-YEAR residue already sitting in 33-1101 (e.g. a year closed
before Step 4 existed, or a manual correcting JE) sweeps into 32-1101 too —
not only the current year's net. A direct consequence: Step 4 can fire even
when Step 3 is skipped (net = 0 this year, but residue > 0 from before), and
Step 4 can skip even when Step 3 fires (rare: this year's net exactly offsets
a negative residue).

Entry-date for all JEs = `Dec 31 23:59:59.999 BKK` of the closed year (keeps
the closing entries inside the year window).

### Guards

- **Year window**: 2020-2030, must be strictly `< current year` (cannot close
  future or in-progress year)
- **Monthly periods**: all 12 months for FINANCE company must be in
  `CLOSED` or `SYNCED` status — otherwise `BadRequestException` with the
  list of open months
- **Idempotency**: a year can only be closed once. `ConflictException` on
  re-attempt unless prior batch was reversed first (then re-close allowed)
- **Tx atomicity**: all JEs (1-4) created in a single `$transaction` —
  partial failure rolls all of them back

### Reversal escape hatch (OWNER only)

```
POST /accounting/year-end-closing/reverse
Body: { year, reason }  // reason min 10 chars
```

Enumerates every JournalEntry with `metadata.flow = 'year-end-closing'` +
`metadata.year = year` (NOT a hardcoded step count/id list) and mirror-flips
each one (Dr/Cr swapped), dated today (NOT the original Dec 31) — so Step 4
is picked up and reversed automatically alongside Steps 1-3, with zero
changes needed in the reversal path when Step 4 was added. Original entries
keep their POSTED status — reversal sits beside them with
`metadata.flow = 'year-end-closing-reverse'` + back-ref via
`reversesEntryId`. Originals are marked `metadata.reversedByBatchId` so the
idempotency guard no longer blocks a re-close.

AuditLog actions:
- `YEAR_END_CLOSED` — entity=accounting_period, entityId=batchId, newValue includes year + netIncome + JE ids (step1-4)
- `YEAR_END_CLOSING_REVERSED` — entity=accounting_period, entityId=originalBatchId

### Reports impact

After year-end closing posts:
- `getProfitLossFromJournal(Jan-Dec)` for the closed year returns ~0 for
  Revenue and Expense (they've been zeroed out), and `netIncome ≈ 0`
- `getTrialBalance(asOfDate >= Dec 31)` shows 33-1101 back to **0.00** (swept
  by Step 4) and 32-1101 increased by the swept amount (current year's net,
  plus any prior residue), Income Summary (39-9999) back to 0
- `getBalanceSheetFromJournal(asOfDate >= Dec 31)` — equity section reflects
  the year's profit moved all the way to accumulated retained earnings
  (32-1101), not just parked in the current-year 33-1101 bucket

`getEquityStatementFromJournal` (`apps/api/src/modules/accounting/general-ledger-report.service.ts:905`)
returns a `caveat` string — "ค่าประมาณกำไรปีปัจจุบัน — ยังไม่ปิดบัญชีจริงเข้า
33-1101 / 32-1101 (รอปิดบัญชีสิ้นปี)" — alongside its `currentYearProfit`
number. That NUMBER genuinely goes to ~0 for a year that has been closed via
this flow (its `getProfitLossFromJournal(yearStart, periodEnd)` sub-call sees
Steps 1-2's zeroed-out revenue/expense). The caveat TEXT itself, however, is
**static** — the method has no branch that checks whether the year is
actually closed, so the label is always returned verbatim regardless of
closure status. Don't read "the caveat disappears after closing" as fact:
only the accompanying number changes; the explanatory string does not. (Not
in scope here to add that conditional — flagging it as a known, pre-existing
gap only.)

`/accounting/periods` redirects to `/settings#periods` via `window.location.replace` (preserves hash; react-router `<Navigate>` cannot set hash fragments).

---

## Equity Module — ธุรกรรมส่วนของผู้ถือหุ้น (2026-08-10)

Spec: `docs/superpowers/specs/2026-08-10-equity-module-design.md` · Plan: `docs/superpowers/plans/2026-08-10-equity-module.md`
Module: `apps/api/src/modules/equity/` · หน้า: `/finance/equity`, `/finance/dividend-register`

- 7 ประเภท: CAP_INIT (ครั้งเดียว, ชำระขั้นต่ำ 25% ม.1110, ค้างชำระเข้า **11-1310**), CAP_INC (31-1102 premium),
  CAP_DEC, DRAW (22-1102 Contra), DIV_DEC (Dr 32-1101 / Cr 21-4104 — TAS 10), DIV_PAY (WHT 10% → **21-3104**,
  เฉพาะบุคคลธรรมดา/นิติต่างชาติ; นิติไทย 0 ตาม ม.65 ทวิ(10)), PRIOR_ADJ (คู่ 32-1101 เท่านั้น — TAS 8)
- YE_CLOSE ของ prototype ถูกตัด — ใช้ `/finance/year-end-closing` เดิม
- JE: builder เดียว `equity-journal.builder.ts` → `JournalAutoService.createAndPost` ·
  `metadata.flow='equity'`, `idempotencyKey='equity:<docId>'` · reverse = mirror ตาม pattern interco
- Workflow: DRAFT→READY→POSTED→REVERSED · maker-checker opt-in ผ่าน SystemConfig
  **`EQUITY_MAKER_CHECKER_ENABLED`** (ไม่ seed — missing = OFF; เปิดแล้ว approver ≠ maker; อ่าน config
  แบบ fail-closed — DB error = โยน ไม่ใช่ปิดด่านเงียบ ต่างจาก other-income ที่กลืน error) ·
  CAP_INIT โพสต์ใต้ pg advisory lock กันตั้งทุน 2 ใบพร้อมกัน
- GL guards ตอนโพสต์: `V_DIV_PAY_LE_PAYABLE` (Σจ่าย ≤ ยอด 21-4104), `V_CAP_DEC_LE_CAPITAL` (Σลด ≤ 31-1101) —
  block · `DIV_VS_RE` (ประกาศ > 32-1101) — **warning ไม่ block** (ปันผลระหว่างกาลทำได้)
- ภ.ง.ด.2: `GET /tax/pnd2-preview` + `export-xlsx?form=PND2` — อ่านจากเอกสาร DIV_PAY POSTED (ไม่เดิน GL)
  — เฉพาะผู้รับบุคคลธรรมดา (ม.50(2)); นิติไทย exempt, นิติต่างชาติ = ภ.ง.ด.54 (deferred)
- งบ Equity เดิมเพิ่ม `capitalStatus` (authorized/paidUp/unpaid/premium) + caveat เป็น conditional ตามสถานะปิดปี
- AuditLog: `EQUITY_CREATED/UPDATED/DELETED/SUBMITTED/WITHDRAWN/POSTED/REVERSED` (entity `equity_document`)
- **Prod rollout**: (1) รัน `seed:coa` หลัง deploy (บัญชีใหม่ 11-1310) (2) สร้างทะเบียนผู้ถือหุ้นตาม บอจ.5
  (3) **CAP_INIT backfill = CPA-gated** — ยอดยกมาทั้งชุด (ทุน+เงินสด+กำไรสะสม) ต้องให้ CPA เคาะก่อน
  ห้ามโพสต์ขา Dr ธนาคารเงียบๆ (opening-balance gap เดียวกับ interco spec §11)
- Deferred: Capital Call (รับชำระค่าหุ้นค้างภายหลัง — Dr เงิน / Cr 11-1310), แบบยื่น ภ.ง.ด.2 ทางการ,
  การเคลียร์ 22-1102 (DRAW) — ต้องทำ JV/PRIOR_ADJ มือไปก่อน, ภ.ง.ด.54

---

## Bad Debt Provision — ECL v4 (Per-Installment Aging, 2026-07-26 redesign)

TFRS for NPAEs Ch.13 aging-based Expected Credit Loss, 6 buckets (B0 implicit + B1-B5) — same buckets/rates as the earlier v3, but the BASE changed: v3 keyed a contract's ENTIRE provision off a single bucket (the oldest overdue installment); **v4 ages every outstanding installment independently** off its own `Payment.dueDate`, gives each its own bucket/rate, and sums the per-installment provisions into the contract total. A contract carrying installments overdue 90/60/30 days now provisions `757.92 + 227.37 + 30.32 = 1,015.61` (each installment at its OWN bucket's rate), not the whole outstanding balance provisioned at a single rate (e.g. the 90-day rate applied to all three installments' combined outstanding).

Source: `apps/api/src/modules/accounting/bad-debt.service.ts` + `bad-debt-provision.cron.ts` + `apps/api/src/modules/journal/compute-cn-breakdown.ts` (`computeInstallmentOutstanding` engine, shared with the CN pro-rate util) + `apps/api/src/modules/journal/gl-contract-balance.ts` (shared GL-balance helper) + `apps/api/src/modules/journal/cpa-templates/{bad-debt-provision,bad-debt-writeoff,ecl-stage-reverse,repossession-jp5}.template.ts`.

Spec: `docs/superpowers/specs/2026-07-26-ecl-per-installment-design.md`. Plan: `docs/superpowers/plans/2026-07-26-ecl-per-installment.md`.

### Buckets & rates (unchanged from v3)

| Bucket | Days overdue | Rate | Contract status | Notes |
|---|---|---|---|---|
| B0 | 0 (ปกติ) | 0% | ACTIVE | Implicit — no provision row created |
| B1 | 1-30 | 2% | ACTIVE | |
| B2 | 31-60 | 15% | ACTIVE | 60d alert trigger |
| B3 | 61-90 | 50% | ควร TERMINATED | Manual — not enforced by code |
| B4 | 91-180 | 75% | TERMINATED | |
| B5 | 180+ | 100% | TERMINATED (NPL) | |

Rates configurable via SystemConfig **`bad_debt_provision_rates`** (JSON `{bucket: rate}`) — code defaults above apply if the row is missing OR the JSON fails to parse (corrupt JSON → Sentry alarm + safe fallback to defaults; never silently posts on a stale/zero basis). Buckets now apply PER INSTALLMENT rather than per contract (see Method below), but the rate table itself is unchanged.

### Method — per-installment engine

- **Engine**: `computeInstallmentOutstanding(client, contract, { selection, asOf, preloaded })` in `compute-cn-breakdown.ts` — single source of truth for "how much is still owed on installment `i`, and how old is it", feeding BOTH ECL (`selection: 'DUE'`) and the CN pro-rate util (`selection: 'ACCRUED'`, via `computeCnBreakdown`). Two deliberately different universes:
  - **DUE** (ECL): iterates `Payment` rows directly — `status != 'PAID' AND dueDate < asOf`. Does NOT require accrual to have run (resilience: the ECL base must not go blind just because the 2A cron missed a day).
  - **ACCRUED** (CN, unchanged definition): iterates `InstallmentSchedule` rows with `accrualJournalEntryId != null`; unpaid = no `Payment` row with `status = 'PAID'`.
- **Exhaustive DUE status allow-list** — `DUE_STATUS_MAP` in `compute-cn-breakdown.ts` is typed `satisfies Record<PaymentStatus, boolean>` (PENDING/PARTIALLY_PAID/OVERDUE = `true`, PAID = `false`). This is NOT `status !== 'PAID'` — a 5th `PaymentStatus` value added later (e.g. CANCELLED/REFUNDED) fails compilation instead of silently flowing into the ECL base as "still due", forcing a deliberate yes/no decision at the call site.
- **Fee-netted outstanding** — both DUE and ACCRUED share the exact same `feeNettedOutstanding` formula (FEE-FIRST, PR #1313 convention) — never re-derived independently:
  ```
  netFee       = lateFeeWaived ? 0 : lateFee
  feeCollected = min(amountPaid, netFee)
  baseCash     = amountPaid − feeCollected
  outstanding  = clamp(amountDue − baseCash, 0, installmentTotal)
  ```
- **Per-row rounding, then sum** — each installment's provision = `outstanding × rate(bucket)`, rounded `ROUND_HALF_UP` to 2dp, THEN summed across installments (never round-after-sum). `computePerInstallmentProvision` in `bad-debt.service.ts` is the ONE shared aggregator used by BOTH `calculateProvisions` (daily cron) and `reverseStageOnPayment` (real-time payment hook) — the two can never independently drift on what "the current provision for this contract" means.
- **daysOverdue** = `floor((asOf − Payment.dueDate) / 1 day)` per installment (DUE selection); informational-only for ACCRUED (CN never reads it).
- **Persisted row shape** (`BadDebtProvision`): `agingBucket` = bucket of the OLDEST outstanding installment — display/sort convention only, does NOT mean the whole balance provisions at that rate. `bucketBreakdown Json?` (new column, migration `20260982000000_add_bucket_breakdown_to_bad_debt_provisions`) persists the TRUE per-bucket split: `{ "<bucket>": { count, base, provision } }` (count = installment count in that bucket, base/provision as 2dp strings). `provisionRate` persisted = blended (`provision / base`, 4dp) for backward-compat with any UI/report expecting one rate per contract.

### Streak floor — DORMANT by default (semantics CHANGED 2026-07-26)

**Breaking change from v3**: SystemConfig `consecutive_missed_bucket_map` missing, empty (`{}`), or corrupt JSON now means **NO floor at all**. This is a deliberate reversal of the old v3 behavior, where any of those cases silently fell back to a code-default map (`DEFAULT_STREAK_BUCKET_MAP`) — that fallback has been REMOVED from the code entirely. Only an EXPLICIT, non-empty SystemConfig row activates the floor.

- Missing row → no floor. The `ConsecutiveMissedService.getStreaks` query is skipped entirely (not just ignored — never called).
- `{}` (empty object, after JSON.parse) → no floor.
- Corrupt JSON → `Sentry.captureException` + no floor (v3 behavior was: Sentry + fall back to code defaults; v4 is: Sentry + apply literally nothing).
- Explicit non-empty row, e.g. `{"2": "31-60", "3": "61-90"}` → for a contract with N consecutive missed/overdue installments (`ConsecutiveMissedService.getStreaks` — max run of `PENDING/OVERDUE/PARTIALLY_PAID` with `dueDate < now`), floor bucket = the entry whose threshold is the LARGEST `<= N`. ONE floor bucket per contract (streak is a contract-level metric) is compared against EACH installment's own aging bucket independently — `effectiveBucket` picks whichever of (aging, floor) carries the HIGHER provision rate; the floor can only escalate a row, never downgrade it.

If the CPA later reinstates the floor as the operational default, that is a 1-row SystemConfig `INSERT` — no code change required.

### Daily cron (00:30 BKK) — GL-delta, self-healing (mechanics UNCHANGED by the per-installment redesign)

`BadDebtProvisionCron` — `@Cron('30 0 * * *', { timeZone: 'Asia/Bangkok' })`, fires after the 00:01 2A accrual cron. System-wide single run (not per-branch/company).

- For each in-scope contract, computes the TARGET provision (now via the per-installment engine — see Method above), compares it against the contract's actual **11-2102** GL balance (not the `BadDebtProvision` DB rows), and posts only the **delta** via `BadDebtProvisionTemplate`:
  - delta > 0 (increase) → `Dr 51-1103 / Cr 11-2102`
  - delta < 0 (release) → `Dr 11-2102 / Cr 51-1103`
  - `|delta| < 0.005` → skipped, no JE
- Idempotent per `(flow='provision', contractId, runDate)` where `runDate` = today's Asia/Bangkok date (`YYYY-MM-DD`) — re-running the same BKK day is a no-op; a new BKK day always re-evaluates and can post again.
- **Self-healing**: because the delta compares to the LIVE GL balance rather than DB state, a prior day's JE failure (caught per-contract, Sentry-alarmed, does not abort the batch) is automatically absorbed into the next day's delta — no manual backfill needed.
- `BadDebtProvision` row maintenance (REVERSE stale ACTIVE rows + createMany fresh ones) happens in one `$transaction` up front, decoupled from the JE-posting loop.

### ECL base

The universe differs by contract status (C1 final-review fix, 2026-07-26 — see "TERMINATED contracts" below for the history):

- **ACTIVE/OVERDUE/DEFAULT** — `Σ outstanding` (fee-netted, per `feeNettedOutstanding` above) over each in-scope contract's **DUE** installments (Payment-row-driven, does NOT require accrual to have run). This is a **resilient SUPERSET** of GL **11-2103**, not an exact tie — it deliberately stays visible even when the 2A accrual cron lags a day, so it can include installments 11-2103 hasn't booked yet.
- **TERMINATED** — `Σ outstanding` over only the **ACCRUED** installments (`InstallmentSchedule.accrualJournalEntryId != null`, unpaid). This DOES tie literally to GL 11-2103, because the 2A cron stops firing post-termination and admitting an un-accrued installment into the base would provision against interest/VAT that was never recognized (spec §2.2 "deferred ไม่ตั้งสำรอง").

**Late fee is excluded from the base** either way — it isn't a GL asset (only recognized as `42-1103` income when actually collected), so folding it in would overstate exposure.

Stage-reverse on payment (`BadDebtService.reverseStageOnPayment`, invoked from the payment-receipt flow) applies the same DUE/ACCRUED split per contract status, and only considers installments with `dueDate < now` — future-dated installments never enter the aging/base recompute, so pre-paying ahead of schedule can't manufacture a stage-drop.

### TERMINATED contracts — ACCRUED-gated (C1 final-review fix, 2026-07-26)

v3 gave TERMINATED contracts a special "carrying amount" base (`11-2103 + 11-2101 − 11-2106` GL balances), because the 2A accrual cron stops firing once a contract is TERMINATED. The initial per-installment redesign (same day) retired that override and UNIFIED TERMINATED with ACTIVE — both used plain **DUE** selection. **A same-day final-review caught that this reintroduced the exact problem the carrying-amount base existed to prevent**: DUE is Payment-row-driven and does not require accrual, so a TERMINATED contract's un-accrued future installments (2A never runs again post-termination) would cross `dueDate < now` and get provisioned against interest that was never recognized. **Fix**: `calculateProvisions` and `reverseStageOnPayment` both branch on `contract.status` — TERMINATED calls the engine with `selection: 'ACCRUED'` (only installments 2A already accrued, unpaid); ACTIVE/OVERDUE/DEFAULT keep `selection: 'DUE'`. `terminatedCarryingAmount()` is still gone — this is NOT a revival of the old carrying-amount formula, just a narrower installment universe feeding the SAME per-installment bucket/rate math (`computePerInstallmentProvision`) ACTIVE contracts use.

- TERMINATED contracts stay IN SCOPE for the daily recalc (escalate while awaiting repossession/write-off) — only `CLOSED_BAD_DEBT` (already written off) drops out. Unchanged from v3.
- `reverseStageOnPayment` mirrors the same status branch — ACTIVE/OVERDUE/DEFAULT compute `target` off DUE rows, TERMINATED off ACCRUED rows; either way it releases `min(existing.provisionAmount − target, GL 11-2102)`.
- The golden below (2,122.16) is unaffected — all 3 installments in that fixture went through a real 2A run before being aged, so ACCRUED and DUE selections coincide for that specific case. `bad-debt.service.spec.ts` adds the divergence proof: a TERMINATED contract with 3 accrued + 2 past-due-but-never-accrued installments provisions ONLY the 3 accrued (2,122.16), not all 5.
- **The old v3 carrying-amount goldens no longer apply and must not be cited**: the carrying-amount golden (base `12,797.51` → provision `9,598.13`) described a base formula that has been deleted from the code. `ecl-terminated-base.spec.ts` asserts the ACCRUED-gated per-installment golden instead — see the goldens table below (**2,122.16**).

### Golden fixtures — 17,000฿ / 12-month contract (installmentTotal 1,515.83, vatPerInst 99.17)

Per-installment aging only (no floor — `consecutive_missed_bucket_map` absent):

| Scenario | Per-installment math (ROUND_HALF_UP each, then sum) | Provision |
|---|---|---|
| Single 30d installment (1-30, 2%) | 1,515.83 × 0.02 = 30.3166 → HALF_UP | **30.32** |
| {60d, 30d} (31-60 15% + 1-30 2%) | 227.3745 + 30.3166 → 227.37 + 30.32 | **257.69** |
| {90d, 60d, 30d} (61-90 50% + 31-60 15% + 1-30 2%) | 757.915 + 227.3745 + 30.3166 → 757.92 + 227.37 + 30.32 | **1,015.61** |
| {120d, 90d, 60d, 30d} (91-180 75% + 61-90 50% + 31-60 15% + 1-30 2%) | 1,136.8725 + 757.915 + 227.3745 + 30.3166 | **2,152.48** |
| Partial payment: due 1,515.83, paid 1,000 (no fee), 40d overdue (31-60, 15%) | outstanding = 1,515.83 − 1,000 = 515.83 → 515.83 × 0.15 = 77.3745 | **77.37** |
| TERMINATED, 3 installments at 100d/70d/40d (91-180 75% + 61-90 50% + 31-60 15%) | 1,136.8725 + 757.915 + 227.3745 | **2,122.16** (`ecl-terminated-base.spec.ts`, `agingBucket` display = `91-180`, `outstandingAmount` = 4,547.49) |

Floor-enabled (`consecutive_missed_bucket_map = {"2": "31-60"}`, streak = 2 consecutive missed installments):

| Scenario | Without floor | With floor | Why |
|---|---|---|---|
| {60d, 30d}, streak 2 | 257.69 | **454.74** | BOTH installments floored to 31-60 (15%): 2 × HALF_UP(1,515.83 × 0.15) = 2 × 227.37 = 454.74. The 30d installment's own aging bucket (1-30, 2%) loses to the floor (31-60, 15%) per-installment — higher rate wins. |

CN (ใบลดหนี้) goldens are UNCHANGED by this redesign — the ACCRUED selection was already shaped this way before 2026-07-26 (it just now runs through the shared `computeInstallmentOutstanding` engine instead of its own copy of the logic). See "เอกสารใบลดหนี้" below for those numbers.

**By design, ECL's `outstandingAmount` and a CN's `totalOutstanding` can differ on the SAME contract at the SAME moment** — ECL for an ACTIVE/OVERDUE/DEFAULT contract uses DUE (Payment-row-driven, includes un-accrued past-due installments), while a CN only ever fires from JP5/write-off (both ACCRUED-only, and only ever on a TERMINATED-adjacent contract). An ACTIVE contract with a past-due-but-never-accrued installment shows it in ECL's DUE base right away, but that installment would not appear in a CN computed at that same instant (there is no CN yet — CN only issues at repossession/write-off time). Do not expect the two figures to reconcile 1:1 outside the "TERMINATED, fully-accrued" case where DUE and ACCRUED happen to coincide.

### Write-off & JP5 — GL-based clearing legs + consume-then-release residual (2026-07-26)

v3's `RepossessionJP5Template`/`BadDebtWriteOffTemplate` derived their clearing legs (`Cr 11-2103`, `Cr 11-2101`, etc.) by RE-DERIVING `installmentTotal × count` — count-based math. If a real partial 2B receipt had already reduced 11-2103 for an accrued installment, the count-based leg OVER-CREDITED it (clearing the full `installmentTotal` regardless of what cash was actually collected), leaving a stale nonzero balance on 11-2103 forever. **This was an open backlog item and is now CLOSED.**

**GL-based legs** — shared helper `apps/api/src/modules/journal/gl-contract-balance.ts` (`glContractBalance(client, contractId, accountCode, side)`, extracted 2026-07-26 from 3 previously-independent copies of the same query in `BadDebtWriteOffTemplate`, `RepossessionJP5Template`, and `BadDebtService`'s ECL delta cron): every clearing leg now reads the ACTUAL live GL balance for that contract/account instead of re-deriving from installment count. Loss/gain is whatever is left to balance the JE (`ΣCr(GL-based lines) − ΣDr(GL-based lines)`) — not a separately re-derived formula.

**Consume-then-release residual** (symmetric between JP5 and write-off):
```
provisionBalance = GL balance of 11-2102 for this contract
consume = min(loss, provisionBalance)          → Dr 11-2102 (when loss > 0)
release = provisionBalance − consume           → Dr 11-2102 / Cr 51-1103 (when > 0)
```
Once a contract is repossessed or written off there is no more receivable to provide against, so **11-2102 for that contract always lands on exactly 0** after the JE — via consume alone (provision <= loss), release alone (gain / exact-wash, consume = 0), or both (provision > loss), ASSUMING the pre-JE `11-2102` balance was itself non-negative. `metadata.releasedProvision` (string, `"0.00"` when nothing was released) is stamped on every JP5/write-off JE for audit traceability.

**Caveat (M1 final-review fix, 2026-07-26)**: a NEGATIVE pre-JE `11-2102` balance (Dr > Cr — e.g. a past mis-posted JE) is a GL anomaly, and neither template auto-heals it. `RepossessionJP5Template`/`BadDebtWriteOffTemplate` both clamp what they REPORT (`releasedProvision` never goes negative in `metadata` — `Decimal.max(0, ...)` on JP5's return value; write-off's `provisionConsumed`/`releasedProvision` already clamp via their existing `provisionBalance.gt(0)` guards) and fire `Sentry.captureMessage` (`subsystem: 'bad-debt'`, level `warning`) on `provisionBalance.lt(0)` so the anomaly surfaces for manual investigation instead of silently zeroing itself out. Neither template attempts to correct the underlying negative balance — that requires a human-reviewed correcting JE.

**JP5 partial-over-credit backlog: CLOSED.** Earlier documentation here warned that "the receivable-clearing legs are still count-based, only the CN VAT line is pro-rated" — that caveat NO LONGER APPLIES and must not be repeated. `bal2103 = glContractBalance(client, contractId, '11-2103', 'dr')` (and every other clearing leg) reads the live post-receipt balance. Proven by `jp5-vat-split.spec.ts` ("Cr 11-2103 = GL net after a REAL partial 2B receipt — closes the backlog over-credit (11-2103 = 0 after JP5)"): GL 11-2103 for the contract is asserted `0.00` after JP5 posts, even with a real partial 2B receipt in the mix beforehand.

**JP5 golden — Scenario A** (composed full-flow, `jp5-vat-split.spec.ts`): 1A + 2A×4 (installments 1-4 accrued) + 2B×3 (installments 1-3 REALLY paid in full via posted receipts) + a pre-existing 30.32 provision (B1 on installment #4) + JP5 @ repossessionValue 5,000.00 —

```
Dr  11-1101 (cash)          5,000.00
Dr  21-2101 (CN VAT)           99.17   ← installment #4, only accrued+unpaid, fully outstanding
Dr  11-2106                 4,000.00   ← GL: 6,000 − 4×500
Dr  21-2102                   793.32   ← GL: 1,190 − 4×99.17
Dr  11-2102 (consume)          30.32   ← min(loss 8,543.34, provisionBalance 30.32)
Dr  51-1102 (loss plug)      8,513.02  ← remainingLoss = 8,543.34 − 30.32
   Cr 11-2103                1,515.83  ← GL after 3 real receipts (4×1,515.83 − 3×1,515.83)
   Cr 11-2101               11,333.36  ← GL: 17,000 − 4×1,416.66
   Cr 11-2105                  793.32  ← GL: 1,190 − 4×99.17
   Cr 21-2101 (deferred due)    793.32  ← mirrors 21-2102
   Cr 41-1101                4,000.00  ← mirrors 11-2106
ΣDr = ΣCr = 18,435.83 — metadata.releasedProvision = "0.00" (provision fully consumed)
```

**Write-off release-residual golden** (`bad-debt-writeoff.template.spec.ts`, all-deferred 1A-only contract, provision seeded 20,000.00 > loss 18,190.00): `provisionConsumed = 18,190.00` (Dr 11-2102), `releasedProvision = 1,810.00` (Dr 11-2102 / Cr 51-1103), NO `51-1102` loss line at all (fully absorbed) — GL 11-2102 nets to exactly `0.00` after the JE.

**JP5 gain-branch golden** (`jp5-vat-split.spec.ts`, no accrual, repossessionValue 20,000 vs remaining total 18,190.00, provision seeded 2,000.00): consume = 0 (no loss to consume against), release = the FULL 2,000.00 provision (`Dr 11-2102` / `Cr 51-1103`), gain `Cr 41-1102` = 1,810.00 recognized independently and unaffected by the release.

**Write-off, mixed accrued/deferred** (`bad-debt-writeoff.template.spec.ts`, unaffected by the release addition since provision < loss here): 3 accrued+unpaid installments → CN VAT (Dr 21-2101) = `99.17 × 3 = 297.51`; loss plug (Dr 51-1102) = **17,892.49**.

### Reports — `getProvisionSummary` + `calculateProvisions` (Task 7, 2026-07-26)

Both response shapes' `byBucket` are now aggregated from the TRUE per-installment split, not a whole-contract dump onto the oldest bucket:

- `calculateProvisions(...).byBucket` — built by summing each in-scope contract's `bucketAgg` (the same per-bucket aggregation `computePerInstallmentProvision` already computes) into the response, instead of adding the contract's whole `provisionAmount` under its single `contractBucket`. A `{90,60,30}` contract now shows `757.92` on `'61-90'`, `227.37` on `'31-60'`, `30.32` on `'1-30'` — not `1,015.61` dumped entirely onto `'61-90'`. **`count` per bucket is a count of INSTALLMENTS, not contracts** — that same `{90,60,30}` contract contributes `count:1` to EACH of `'61-90'`/`'31-60'`/`'1-30'`, not `count:3` piled onto one bucket.
- `getProvisionSummary().byBucket` — sums each ACTIVE row's persisted `bucketBreakdown` (see Method above) across contracts. Rows persisted BEFORE the per-installment migration carry no `bucketBreakdown` (`null`) — those fall back to the OLD whole-row attribution (their entire outstanding/provision keyed under their single `agingBucket`) so legacy data still reports sensibly instead of silently vanishing from the summary. **This means a legacy row's `count` contribution is a CONTRACT count (1), not an installment count** — until that contract is recalculated (gets a fresh `bucketBreakdown` on its next `calculateProvisions` run) or its provision is REVERSED, `byBucket.count` from this endpoint is a mix of true installment-counts (post-migration rows) and contract-counts (legacy rows); do not treat it as a pure installment tally until all legacy rows have aged out. `rate` per bucket is derived from the aggregated data (`provision / outstanding`) rather than re-read from the live rates config, since a bucket's aggregate reflects whatever rate was actually in effect when each contributing row was calculated. `details[]` keeps its existing shape and additionally passes through each row's `bucketBreakdown` (`null` for legacy rows).
- **Dry-run CLI** (`ecl-dry-run.cli.ts`) prints a per-bucket count/amount table sourced from the now-truthful `byBucket` (previously it dumped the raw, misleading-for-multi-bucket JSON).

### Enforcement gates (Phase 2, owner sign-off 2026-07-24)

| SystemConfig key | Value | Effect | Legal basis |
|---|---|---|---|
| `letter_auto_generate_enabled` | `'true'` | `LetterAutoGenerateCron` (09:15 BKK) actually fires RETURN_DEVICE_45D / CONTRACT_TERMINATION_60D letters. Was seeded `'false'` pending legal review — review now passed. | — |
| `jp5_require_terminated_status` | `'true'` | `RepossessionsService` (JP5) rejects a repossession unless `contract.status === 'TERMINATED'` | ปพพ. มาตรา 386 — เจ้าหนี้ต้องบอกเลิกสัญญาก่อนจึงจะใช้สิทธิยึดทรัพย์คืนได้ |

Fresh dev seed (`collections-foundation.seed.ts`) now seeds both `'true'`. **Existing environments** (already carrying a `letter_auto_generate_enabled` row) do NOT get flipped by re-seeding — the seeder's upsert only touches `label` on the UPDATE branch by design, so it never clobbers an operator's runtime value. Flip existing envs via the confirmation-gated manual SQL: `apps/api/prisma/migrations-manual/2026-07-23-enable-letter-auto-generate-and-jp5-strict.sql`. **Must run via `psql -f`** — the `\prompt` confirmation gate is silently skipped by GUI clients (DBeaver/pgAdmin "execute file").

### Dry-run CLI

```bash
DATABASE_URL=... npm --prefix apps/api run ecl:dry-run
```

`apps/api/src/cli/ecl-dry-run.cli.ts` — read-only: calls `calculateProvisions(systemUserId, undefined, dryRun=true)`, which skips BOTH the `BadDebtProvision` row writes AND JE posting. Reports per-contract delta vs the current `11-2102` GL balance (`prevGl`, `target`, `delta`), the (now truthful, per-installment) bucket totals, and aggregate increase/release. Point `DATABASE_URL` at a prod-copy via cloud-sql-proxy and run this before a prod rollout to sanity-check the blast radius.

### CI coverage (2026-07-26)

`.github/workflows/deploy-gcp.yml`'s vitest step now explicitly globs `src/modules/journal/cpa-templates/__tests__/*.spec.ts`. `jp5-vat-split.spec.ts` (the JP5 GL-based-legs golden suite above, ~960 lines) previously matched no glob in CI and had NEVER actually run there — a regression in it would not have been caught before merge. Any new spec placed directly under `cpa-templates/__tests__/` is now covered by construction; if a NEW subdirectory nesting level is ever introduced there, verify it is covered by an explicit glob too — do not assume `*.spec.ts` recurses into subdirectories on its own.

### เอกสารใบลดหนี้ (CN document — Phase 3)

Auto-issues the ม.82/5 ใบลดหนี้ (Credit Note) receipt that documents the VAT reversal already booked by JP5/write-off — closes the loop from "JE says CN VAT was reversed" to "customer actually received a CN document".

**Trigger.** `RepossessionsService.create` (JP5) and `BadDebtService.writeOffBadDebt` both call `CreditNoteDocumentService.issueForContract` **inside the same `$transaction`** that posted the source JE, so a CN-issuance failure rolls back the JE too (atomic). It does NOT gate on a `metadata.creditNoteIssued` flag read off the JE (no such read exists in the service) — instead it independently RE-DERIVES the accrued-unpaid set + pro-rated amounts via `computeCnBreakdown` (same util `RepossessionJP5Template`/`BadDebtWriteOffTemplate` use to stamp `metadata.creditNoteVatAmount` — see "Pro-rate ruling" below); zero accrued-unpaid → `SKIPPED_NO_ACCRUED`, no CN issued. It ASSERTS its own recomputed `totalCnVat` equals the JE's stamped `metadata.creditNoteVatAmount` for EVERY case (clean or partial), throwing (and rolling back the whole tx) on any mismatch — equivalent protection to trusting a boolean flag, but self-verifying against the source JE instead. LINE delivery (`CreditNoteDeliveryService.deliver`) is deliberately NOT called from inside that tx — both callers fire it fire-and-forget **after** the tx commits (`void this.cnDeliveryService.deliver(receiptId).catch(Sentry.captureException)`), so a rollback can never hand the customer a link to a receipt that turned out not to exist.

**Pro-rate — HELD gate retired (CPA ruling 2026-07-26).** `CreditNoteDocumentService.issueForContract` auto-issues a `Receipt` with `receiptType='CREDIT_NOTE'` for EVERY accrued-unpaid case, clean or partial — no dirty gate, no Todo, no held state. Amount/VAT/before-VAT come straight from `computeCnBreakdown(tx, contract)`: `amount=totalOutstanding`, `vatAmount=totalCnVat`, `amountBeforeVat=totalBeforeVat` (per-installment pro-rate formula documented in `compute-cn-breakdown.ts` — see the "Bad Debt Provision — ECL v4" section above for the shared util's CPA golden fixtures). `itemDescription` is `ใบลดหนี้ยกเลิกงวดค้าง {count} งวด — เลิกสัญญา (ม.82/5)`, with `(ลดตามสัดส่วนยอดค้างจริง)` appended whenever at least one accrued-unpaid installment's outstanding balance is less than a full installment (i.e. was pro-rated). Number `RT-YYYYMM-NNNNN` (same per-month advisory-lock sequencer as ordinary receipts — `ReceiptNumberService`). This SUPERSEDES the 2026-07-24 dirty gate: no more `HELD_PARTIAL_PAID` outcome, no more Todo tag `credit-note-review`, no more `CN_HELD_PARTIAL_PAID` audit action for new cases.

**JP5 clearing legs residual — CLOSED 2026-07-26 (superseded; see "Bad Debt Provision — ECL v4" → "Write-off & JP5" above).** This section previously warned (I3, final-review 2026-07-26) that `RepossessionJP5Template`'s `Cr 11-2103` clearing leg was still COUNT-based (`installmentTotal × accruedCount`) even after the CN VAT line was pro-rated — meaning a partially-paid accrued installment would OVER-credit `11-2103` and OVERSTATE the `51-1102` loss. **That gap was closed the same day** by the ECL-per-installment redesign's Task 5: every clearing leg (`11-2103`, `11-2101`, `11-2105`, `21-2102`/`21-2101`, `11-2106`/`41-1101`) now reads the live GL balance via the shared `glContractBalance` helper instead of re-deriving from installment count. `jp5-vat-split.spec.ts` proves GL `11-2103` nets to exactly `0.00` after JP5 even with a real partial 2B receipt in the mix. Do not resurrect the old "only the CN VAT line is pro-rated" caveat — it no longer describes the code.

**Monthly-close / ภ.พ.30 checklist — historical note (superseded 2026-07-26).** Before the CPA pro-rate ruling, a `HELD_PARTIAL_PAID` outcome meant the JP5/write-off JE had already reversed the ม.82/5 VAT in the ledger with no physical CN document yet, and every open Todo tagged `credit-note-review` was a period-close blocker (filing ภ.พ.30 without the mandated CN in hand is a ม.86/10 exposure). New repossessions/write-offs no longer produce this state — `CreditNoteDocumentService` auto-issues a pro-rated CN for every case (see above).

**Manual CN-issue endpoint — honesty about which legacy Todos it actually clears (I2, final-review 2026-07-26).** The manual endpoint (`POST /receipts/credit-note/issue`, `CreditNoteIssueService.issueManually` — CN pro-rate plan Task 5) reuses `CreditNoteDocumentService.issueForContract`'s own drift guard: it recomputes the CN breakdown via `computeCnBreakdown` and ASSERTS the result equals the JE's stamped `metadata.creditNoteVatAmount`, throwing `CnVatMismatchError` → mapped to `422 UnprocessableEntityException` on any mismatch (`mapIssueError` in `credit-note-issue.service.ts`). This means:
  - **JE posted AFTER the pro-rate util shipped** (`metadata.creditNoteVatAmount` already computed via `computeCnBreakdown`) → the endpoint works exactly as intended: issues the missing Receipt for a JE whose document-issuance step failed or was skipped.
  - **JE posted BEFORE the pro-rate util shipped, or a legacy full-amount JE from the pre-2026-07-24 dirty-gate era** → its `metadata.creditNoteVatAmount` is FROZEN at whatever the old (non-pro-rated or pre-existing) formula produced. `computeCnBreakdown`'s recompute will essentially never match that frozen value for a partially-paid installment, so calling the manual endpoint on one of these JEs throws the SAME `422` every single time — it does **not** self-resolve, and there is no retry that fixes it. Do not tell an accountant "just call the endpoint again" for these — it is a dead end until the JE itself is corrected.
  - **The only fix for the legacy-JE case**: an OWNER/CPA-approved ops SQL that updates the frozen JE metadata to match what `computeCnBreakdown` would compute today, e.g. `UPDATE journal_entries SET metadata = jsonb_set(metadata, '{creditNoteVatAmount}', '"<recomputed-value>"') WHERE entry_number = '<JE-...>';` — run this ONLY after a CPA has reviewed and approved the recomputed figure (this changes what ภ.พ.30-relevant amount the ledger claims was reversed), then re-run the manual endpoint, which will now pass the drift-guard cross-check. There is no automated backfill for this — it is a one-JE-at-a-time, human-reviewed operation.
  - **Current status (2026-07-26): zero legacy/frozen-metadata cases exist in prod** — the pro-rate util shipped before any real JE accumulated drifted metadata, so this is a documented dead-end path for future-proofing, not an active backlog item.

**Fields (Receipt model, migration `20260981000000_add_credit_note_source_fields`).**

| Field | Notes |
|---|---|
| `cnSource` | `'REPOSSESSION' \| 'WRITE_OFF'` (null = ordinary receipt or legacy void-CN). Partial unique index `(contract_id, cn_source) WHERE cn_source IS NOT NULL AND deleted_at IS NULL` — one auto-CN per contract per source. |
| `sourceJournalEntryId` | FK-by-value to the JE that triggered this CN (JP5 or write-off entry). |
| `publicToken` | `crypto.randomBytes(32).toString('base64url')` (256-bit), unique. `publicTokenExpiresAt` = issuance + 30 days. |

**Public endpoint.** `GET /receipts/public/:token/pdf` (`ReceiptsPublicController`) — a separate controller with **no class-level guards** (not `@Public()` on `ReceiptsController`, because that controller's `BranchGuard` reads `request.user` unconditionally and has no bypass). Access is entirely token-based: unknown token, expired token, soft-deleted receipt, and non-CN receipt all collapse to the **same** `404 ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว` so the response never confirms whether a token ever existed. Throttled 10/min per IP (`@Throttle`). This route is **intentionally NOT behind `ExportEnabledGuard`** — unlike the staff-facing `GET /receipts/:id/pdf` (which the OWNER can disable via `export_enabled` SystemConfig), this link is the customer's own legally-mandated tax document, not a staff bulk-export path; final call is pending owner sign-off during PR review. Already listed as an intentionally-public entry in `.claude/rules/security.md`.

**LINE delivery.** `CreditNoteDeliveryService.deliver` pushes a Flex card via `LineFinanceClientService` (same LINE FINANCE channel as payment flows) with a "ดูเอกสาร" button linking to `${baseUrl}/cn/:token` — `baseUrl` reuses `PAYMENT_LINK_BASE_URL`/`FRONTEND_URL` (no new env var). `${baseUrl}/cn/:token` is a public frontend route (`CreditNoteViewPage`, declared outside `ProtectedRoute`/`MainLayout`, fetches via `liffApi`) that streams the PDF inline. **PDPA: no consent gate** — a CN is a legally-mandated tax document (legitimate interest/legal obligation basis), unlike the discretionary payment-receipt Flex which does gate on `pdpaService.hasActiveConsent()`. **No auto-retry in v1** — a failed push writes a `NotificationLog` FAILED row + a MEDIUM-priority Todo (tag `credit-note`) for manual follow-up (e.g. attach to the EMS termination letter); a "ส่งซ้ำ" resend button exists in the UI (`ReceiptsTab`/`RepossessionsPage`) instead of automatic backoff. Delivery attempts log to `NotificationLog` with `category = 'CREDIT_NOTE'`. AuditLog action strings: `CN_ISSUED`, `CN_SENT`, `CN_SEND_FAILED` (all `entity` = `receipt`). `CN_HELD_PARTIAL_PAID` (`entity` = `contract`) was RETIRED 2026-07-26 along with the dirty gate — historical only, may still appear on audit rows predating the pro-rate ruling.

**Follow-ups pending (documented, not yet done — committed, NOT optional):**
- ~~Pro-rate CN for the `PARTIALLY_PAID`/HELD case~~ — DONE 2026-07-26 (CPA ruling): `computeCnBreakdown` pro-rates every accrued-unpaid installment's CN VAT to its outstanding balance; `CreditNoteDocumentService` auto-issues for every case, no more HELD state (see "Pro-rate — HELD gate retired" above). ~~The manual CN-issue endpoint~~ (CN pro-rate plan Task 5) — DONE (`POST /receipts/credit-note/issue`, `CreditNoteIssueService`); see "Manual CN-issue endpoint — honesty about which legacy Todos it actually clears" above for what it can and cannot fix.
- `computeCnBreakdown`'s outstanding formula nets out `Payment.amountPaid`'s FEE-FIRST late-fee component before comparing against `amountDue` (see `compute-cn-breakdown.ts` jsdoc) — otherwise a fee-heavy partial payment understated `outstanding`/`cnVat`. ~~`RepossessionJP5Template`'s `Cr 11-2103` clearing leg and loss/gain plug remain count-based~~ — DONE 2026-07-26 (ECL-per-installment Task 5): both now read the live GL balance via `glContractBalance`, closing the over-credit gap. See "JP5 clearing legs residual — CLOSED" above.
- The public token appears in the React Query `queryKey` (`['cn-view', token]`) and in the client-side download filename (`ใบลดหนี้-${token}.pdf`) on `CreditNoteViewPage` — same pre-existing pattern as other public-token pages (e.g. `/pay/:token`); not newly introduced here, but not yet remediated either.
- No backfill for CNs on JEs posted before this phase shipped — forward-only. A backfill CLI would be a separate, explicit task if the owner wants historical coverage.

---

## Device Swap — Priced Exchange (2026-07-29)

Spec: `docs/superpowers/specs/2026-07-29-device-swap-priced-exchange-design.md` (D1-D5 owner decisions)

- MEMO mode (รุ่นเดิม+ราคาเดิม): ไม่มี JE — เปลี่ยน `contract.productId` บนสัญญาเดิม (TFRS 9 modification, workbook Case 1). SP2 same-price + `case-8-same-price.csv` golden ถูก retire
- PRICED mode: A.1 (1A สัญญาใหม่) → **A.1b SHOP-leg** (`ShopInventoryTransferTemplate`, ดูหัวข้อถัดไป) → A.2 (derecognize ผ่าน 21-1106, VAT due ทันที ม.78/1 ไม่ออก CN) → **A.3 (ตั้งลูกหนี้-หน้าร้าน 11-2107 ล้างบัญชีพัก 21-1106 — ไม่มีขาเงินสด, ไม่แตะ 21-1101/21-1102 — คำสั่งเจ้าของ 2026-08-03 ยกเลิก D5 สำหรับเส้นทางนี้; เดิม "ตัดเจ้าหนี้ + ขาเงินสดโอนเพิ่ม/คืนลูกค้า D5 post ทันที")** → A.4 (SHOP ซื้อคืนที่ราคารับซื้อ — `Dr S11-2002 [buyback] / Cr S21-3001` ตั้งแต่ 2026-08-19, เดิม costPrice/Cr S50-1102) → A.5 (ECL reversal Dr 11-2102 / Cr 51-1103 — **CPA ruling 2026-08-01 (คำตอบข้อ A2.2 = ข): มาตรฐานเดียวทุกเส้นทาง**, was Cr 42-1106 per D2 — **บัญชี 42-1106 ถูกลบออกจากผังบัญชีแล้ว 2026-08-03**; same account `EclStageReverseTemplate`/JP5/write-off already use — no more asymmetry)
- **Workbook 2026-08-19 Phase 1** (spec `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md`):
  (1) **A.2 = วิธีสุทธิ** — ไม่ตั้ง Cr 41-1101 จาก unearned อีกต่อไป; loss/gain = ราคารับซื้อ
  เทียบมูลค่าตามบัญชีสุทธิรวม VAT (ตัวเลข workbook: loss 126.64; fixture integration: 126.68 —
  เดิม 4,126.68). `metadata.method = 'NET'` (แถวเก่าไม่มี key = gross, forward-only).
  `expectedPl` ใน preview (`contract-exchange.service.ts`) ใช้สูตรสุทธิตัวเดียวกัน (preview === posted).
  (2) **A.4 = ซื้อคืนที่ราคารับซื้อ** — `Dr S11-2002 [buyback] / Cr S21-3001` + caller set
  `product.costPrice = buyback` และ snapshot `ContractExchangeRequest.previousCostPrice`
  (cancel restore กลับ). S21-3001 คือขาคู่ฝั่ง SHOP ของ 11-2107 SWAP_CREDIT — รอหักกลบใน
  รอบจ่าย INTER-CO (Phase 2). A.4 (`ShopExchangeReturnTemplate`) stamp
  `metadata.newContractId` (Phase 2 Task 1) — key ของเลนส์หักกลบ (`swapCreditShopBalance`
  query S21-3001 ด้วย path นี้ตรงๆ ไม่ join ผ่าน request row) และ cancel mirror
  (`exchange-cancel-reversal.template.ts`) copy key นี้ต่อ ให้เลนส์เห็นขากลับรายการด้วย.
  Prod ต้องรัน `seed:coa` หลัง deploy (บัญชีใหม่ S21-3001).
  (3) **11-2107/S21-3001 reference types** — `metadata.shopReceivableType`
  (`SWAP_CREDIT` | `PAYOUT_RECALL` | `SHOP_COLLECT`) stamp ทุก JE ใหม่; แถวเก่า classify
  ตอนอ่านผ่าน `classifyShopReceivable()` (`apps/api/src/modules/journal/shop-receivable-type.util.ts`).
  จุดกำเนิด `SHOP_COLLECT` มี 2 ทาง (ตรงตาราง spec §2): JP4 ปิดยอดหน้าร้านรับแทน และ
  JP5 ยึดเครื่องหน้าร้านรับแทน (`repossession-jp5.template.ts` — ค้นพบระหว่าง implement,
  stamp แล้ว). ส่วนใบ settle (`shop-collect-settlement.template.ts` — Dr cash / Cr 11-2107)
  เป็น**จุดล้าง** ไม่ใช่จุดกำเนิด แต่ stamp `SHOP_COLLECT` ด้วย เพื่อให้ classify ครบทั้งสองขา.
- Approval: AUTO (≥NCV + ≥basePrice×0.85) / REVIEW (BM) / ESCALATE (<70% NCV — OWNER) — `exchange-tier.util.ts`
- Guards ก่อน finalize: GL 11-2103 = 0, ไม่มี advance/credit ค้าง
- Cancellation: ยกเลิกได้ทุกเมื่อถ้าสัญญาใหม่ยังไม่มีการชำระ (owner ยกเลิก windows/ค่าปรับ 2026-07-31) — mirror-reverse ทุก JE รวม A.5 + A.1b SHOP-leg (สวีปตาม `metadata.contractId` ไม่ hardcode บัญชี — สวีปจับ SHOP JE ได้เองแม้ไม่มี id เก็บบน request row); 2A cron backfill เอง; **42-1107 ถูกลบออกจากผังบัญชีแล้ว 2026-08-03 (คำสั่ง CPA/owner) — ไม่มีบัญชีรองรับค่าปรับยกเลิกอีกต่อไป**. **Phase 3 (2026-08-20): ยกเลิกหลังสัญญาใหม่ถูกตัดจ่ายรอบจ่าย INTER-CO POSTED แล้ว "ทำได้"** — ไม่ใช่ mirror ตรง (จะทำเจ้าหนี้ติดลบ) แต่ redirect ขาเจ้าหนี้/ลูกหนี้รอบจ่ายเป็นลูกหนี้เรียกคืน `PAYOUT_RECALL` + `cancelWindow: 'AFTER_PAYOUT'` — ดูหัวข้อ "ยกเลิกสัญญา (Flow C — Phase 3)" ด้านล่าง
- **42-1106 + 42-1107 = ลบออกจากผังบัญชีแล้ว (2026-08-03, คำสั่ง CPA/owner)** — ทั้งคู่เปิดไว้แต่ไม่เคยมี `journal_lines` แม้แถวเดียว: 42-1106 ("รายได้จากการโอนกลับค่าเผื่อฯ", rename จาก orphan "รายได้บริการซ่อม" — runtime repair ใช้ S42-1101) ถูกแทนที่ด้วย Cr 51-1103 มาตรฐานเดียวทุกเส้นทาง; 42-1107 ("รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง") หมดความหมายเมื่อ owner ยกเลิกกติกาค่าปรับ swap ทั้งชุด 2026-07-31. ถอดออกจาก `finance-coa.csv` แล้ว (ผัง FINANCE เหลือ **110** บัญชี) + `exchange-coa.spec.ts` พลิกเป็น assert ว่า **ไม่มี** ทั้งสองรหัส กันเพิ่มกลับเงียบๆ. Prod: `docs/accounting/remove-42-1106-42-1107-2026-08.sql` (soft delete + guard "ถ้ามี journal_lines แม้แถวเดียว → ROLLBACK")
- Integration E2E (DB จริง): `apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts` — Case 2A (21-1106 net 0, Cr 11-2101 = GL-true 11,333.36 ไม่ใช่สูตรคูณ 11,333.28, loss plug 126.68 (วิธีสุทธิ 2026-08-19; เดิม 4,126.68 ตอน A.2 gross); A.3 = 2 บรรทัดพอดี Dr 11-2107 8,000 / Cr 21-1106 8,000 ไม่มีขาเงินสด; ค้างรอรอบจ่าย: 21-1101 15,000 / 21-1102 1,500 / S11-3001 15,000 / S11-3002 1,500, S11-1201 + เงินสด FINANCE = 0.00 ไม่ถูกแตะ; + F2 SHOP legs: S41-1101/S41-1201/S50-1101↔S11-2001 booked; อยู่ในคิวจ่าย INTER-CO ด้วย `legacyNoShop = false`), ECL 30.32 → 51-1103, cancel วันที่ 15 (reversalJeIds 6: A.1+A.2+A.3+A.4+2 SHOP legs) + วันที่ 45 (reversalJeIds 8: + 2 swept 2A accruals — ทั้งคู่ SUCCEED เหมือนกัน, ไม่มี window/penalty JE อีกต่อไป, owner ยกเลิก 2026-07-31 + mirror-reverse net 0 ทุกบัญชีรวม SHOP + 2A backfill), MEMO (JE count คงเดิม). CI: glob `src/modules/contract-exchange/__tests__/*.integration.spec.ts` ใน deploy-gcp.yml vitest step (jest มองไม่เห็นไฟล์ `*.integration.spec.ts` ตาม testPathIgnorePatterns)

### SHOP-leg wiring บนสัญญาใหม่ (F2, CPA ตอบข้อ 3 = ใช่, 2026-08-01)

ก่อนหน้านี้ exchange PRICED contracts post FINANCE templates เท่านั้น (A.1-A.3 + A.5) — ไม่มี SHOP-side revenue/COGS/receivable สำหรับสัญญาใหม่เลย (ต่างจาก activation ปกติที่ `ContractWorkflowService.activate` ต่อ `ShopInventoryTransferTemplate` เสมอ). F2 ต่อ `ShopInventoryTransferTemplate.execute` เข้า `ContractExchangeService.finalizeAfterActivation` (หลัง A.1, ก่อน A.2) — **เหมือน activation ปกติทุกประการ**:

```
JE A (COGS):    Dr S50-XXXX / Cr S11-200X          [costPrice ของเครื่องใหม่]
JE B (revenue): Dr S11-3001 [financedAmount] + Dr S11-3002 [commission]
                  Cr S41-XXXX [salePrice] + Cr S41-1201 [commission]
```

- **Invariant ตรวจแล้ว (JE B)**: `downPayment` บนสัญญาใหม่ = 0 เสมอ (hardcode ใน `approvePriced` ทั้ง snapshot branch และ legacy fallback branch) — นี่คือ invariant เดียวที่ hold ทุก branch จริงๆ. `financedAmount` **ไม่การันตี**เท่ากับ `sellingPrice` เสมอไป: snapshot branch (`usedSnapshot=true`) ตั้งทั้งสองค่าเท่ากันจาก `newPrice` เดียวกัน แต่ legacy fallback branch (`usedSnapshot=false`) clone `financedAmount: old.financedAmount` และ `sellingPrice: old.sellingPrice` เป็น**คนละค่าอิสระกัน**จากสัญญาเดิม — ถ้าสัญญาเดิมเคยมีดาวน์ (`old.downPayment > 0`) แล้ว `old.sellingPrice = old.financedAmount + old.downPayment > old.financedAmount` ไม่เท่ากัน. ด้วยเหตุนี้ `salePrice` ที่ส่งเข้า `ShopInventoryTransferTemplate` จึง**reconstruct เป็น `down(0)+financedAmount` เสมอ ไม่เคยอ่าน `contract.sellingPrice`** — invariant ของ template (`down+financed===salePrice`) จึง hold โดยโครงสร้าง (`salePrice` ก็คือ `down+financed` ตรงๆ ไม่ใช่ค่าที่ต้องมาเท่ากันโดยบังเอิญ) ทั้งสอง branch โดยไม่ต้องพึ่ง `financedAmount===sellingPrice`
- **idempotencyKey**: `shop-inventory-transfer:<newContractId>` (รูปแบบเดียวกับ `ContractWorkflowService.activate`, กันโพสต์ซ้ำข้ามเส้นทาง)
- **Fields บน `ExchangeContractForFinalize`**: เพิ่ม `contractNumber`/`downPayment`/`productCategory`/`productCostPrice` — มาจาก pre-tx `findOne(id)` snapshot เดียวกับที่ activation ปกติใช้ (ไม่ query DB ซ้ำใน tx) — race characteristics เหมือนเส้นทางปกติทุกประการ
- **S11-3001/S11-3002 ค้างไว้ ไปล้างที่รอบจ่าย INTER-CO** (คำสั่งเจ้าของ 2026-08-03) — ดูหัวข้อ "A.3 = ตั้งลูกหนี้ 11-2107 …" ด้านล่าง. JE C (`ExchangeShopInstantSettlementTemplate`, idempotencyKey `exchange-shop-receipt:<newContractId>`, มีอายุ 2026-08-02 → 2026-08-03) ที่เคยล้างสองบัญชีนี้ทันที **ถูกลบทิ้งทั้งไฟล์แล้ว** พร้อมกับ D5
- **Coverage**: `apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts` (booking values ของ JE A/JE B, ยอดค้างหลัง finalize, การปรากฏในคิวจ่าย, cancel-sweep 2 SHOP JEs, net-zero ทุกบัญชีหลัง cancel รวม 11-2107)
- **Scope ไม่ครอบคลุม**: MEMO mode ยังไม่มี SHOP JE (unrelated — เป็น TFRS 9 modification ไม่มีรายได้ใหม่ ดู §12 ข้อ 4 ของ device-swap spec ซึ่งยังเปิดอยู่ ไม่เกี่ยวกับ F2)

### A.3 = ตั้งลูกหนี้ 11-2107 + เจ้าหนี้เข้าคิวจ่ายปกติ (คำสั่งเจ้าของ 2026-08-03 — SUPERSEDES D5)

**D5 ("สมมติฐานโอนวันเดียวกัน") ถูกยกเลิกสำหรับเส้นทางเปลี่ยนเครื่อง** — วันเปลี่ยนเครื่อง
**ไม่มีการเคลื่อนไหวเงินสดใดๆ** ทั้งฝั่ง FINANCE และ SHOP.

**A.3 รูปแบบใหม่** (`ExchangeBuybackReceivable11_2107Template`,
ไฟล์ `apps/api/src/modules/journal/cpa-templates/exchange-buyback-receivable-11-2107.template.ts` —
เปลี่ยนชื่อจาก `ExchangeClearVendor21_1106Template` เพราะไม่แตะบัญชีเจ้าหนี้อีกแล้ว):

```
Dr 11-2107 ลูกหนี้-หน้าร้าน              [buyback]
   Cr 21-1106 บัญชีพักเครดิตเปลี่ยนเครื่อง  [buyback]
```

ทิศทางเดียวเสมอ 2 บรรทัด ไม่มีการแตกกรณี (เดิมแตก 3 ทางตามส่วนต่าง buyback vs vendorSum)
และ balanced โดยโครงสร้าง. `metadata.flow = 'exchange-buyback-receivable-11-2107'`,
`idempotencyKey = newContractId`, `metadata.contractId = newContractId` (ให้ cancel sweep จับได้).

**เดิม (D5, 2026-07-29 → 2026-08-03):**
`Dr 21-1101 [ยอดจัดสัญญาใหม่] + Dr 21-1102 [ค่าคอม] + ขาเงินสดโอนเพิ่ม/คืนลูกค้า / Cr 21-1106 [buyback]`
— คือหักกลบเจ้าหนี้หน้าร้านของสัญญาใหม่กับเครดิตราคารับซื้อ แล้วจ่ายส่วนต่างเป็นเงินสดทันที.

**เหตุผลของรูปแบบใหม่ (เจ้าของ):**
1. ราคารับซื้อ = เงินที่ SHOP ติด FINANCE → เป็น **ลูกหนี้ฝั่ง FINANCE** บัญชี **11-2107
   ลูกหนี้-หน้าร้าน** (บัญชีเดิมที่มีอยู่แล้ว ใช้ร่วมกับเส้นทาง shop-collect — ล้างเมื่อหน้าร้าน
   โอนเงินเข้า FINANCE ด้วย `Dr <cash> / Cr 11-2107` ผ่าน
   `ContractPaymentService.settleShopCollect`). **ไม่มีการเปิดบัญชีใหม่.**
2. เจ้าหนี้ยอดจัด/ค่าคอมของสัญญาใหม่ (21-1101 / 21-1102 ที่ A.1 ตั้งไว้) **ค้างไว้ตามปกติ**
   → "จ่ายหน้าร้านเหมือนขายปกติ" ผ่านรอบจ่าย INTER-CO.

**`ExchangeShopInstantSettlementTemplate` ถูกลบทิ้งทั้งไฟล์** (มีอายุ 2026-08-02 → 2026-08-03,
ไม่เคยขึ้น production เป็นรอบจ่ายจริง): เมื่อ FINANCE ไม่รับเงินทันทีแล้ว SHOP ก็ต้องไม่รับทันที
เช่นกัน — S11-3001/S11-3002 **ค้างไว้** และไปล้างที่รอบจ่ายเดียวกัน. `ShopInventoryTransferTemplate`
(A.1b, การจองรายได้/COGS/ลูกหนี้ฝั่ง SHOP) **คงไว้ไม่เปลี่ยนแปลง**.

**GL หลัง finalize (สัญญาใหม่, ตัวอย่าง Case 2A ในสเปคทดสอบ — financed 15,000 / คอม 1,500 /
buyback 8,000):**

| บัญชี | ยอดคงค้างหลัง finalize |
|---|---|
| 21-1101 (Cr) | 15,000.00 — **ค้าง** รอรอบจ่าย |
| 21-1102 (Cr) | 1,500.00 — **ค้าง** รอรอบจ่าย |
| 11-2107 (Dr) | 8,000.00 — ลูกหนี้หน้าร้าน (ราคารับซื้อ) |
| S11-3001 (Dr) | 15,000.00 — **ค้าง** รอรอบจ่าย |
| S11-3002 (Dr) | 1,500.00 — **ค้าง** รอรอบจ่าย |
| S11-1201 | 0.00 — **ไม่ถูกแตะเลย** |
| เงินสด/ธนาคาร FINANCE (11-11xx/11-12xx) | 0.00 — **ไม่ถูกแตะเลย** |

**ASYMMETRY ที่รู้ตัวและตั้งใจ (สำหรับ CPA):** ผัง SHOP **ไม่มีบัญชี "เจ้าหนี้ FINANCE"**
ดังนั้นสมุด SHOP **ไม่มีขาคู่ของ 11-2107** — SHOP ไม่ได้บันทึกว่าตัวเองติดหนี้ FINANCE
เท่าราคารับซื้อ. นี่เป็นพฤติกรรมเดียวกับเส้นทาง shop-collect ที่มีอยู่เดิม (11-2107 เป็น
FINANCE-side-only มาตลอด) — **ไม่ได้ประดิษฐ์บัญชีใหม่ และไม่ได้เดา JE ปิดช่องนี้**.
รอ CPA ตัดสินว่าจะเปิดบัญชีเจ้าหนี้ฝั่ง SHOP (คู่กับ S11-3001/S11-3002 ที่เป็นลูกหนี้) หรือไม่
— เป็นคำถามเดียวกับ opening-balance gap ใน interco spec §11.

**Cancel:** mirror-reverse ตามเดิมทุกประการ (สวีปด้วย `metadata.contractId`) — A.3 ใบใหม่ถูก
กลับรายการเหมือนกัน ทำให้ 11-2107 net = 0. จำนวน `reversalJeIds` **ลดลง 1 ใบ**
(instant-settlement หายไป): cancel วันที่ 15 = **6** ใบ (เดิม 7), cancel วันที่ 45 = **8** ใบ
(เดิม 9 — รวม 2A accrual ที่ถูกสวีป 2 ใบ). ทั้งหมดนี้คือเคส **ยังไม่ถูกตัดจ่ายรอบจ่าย**
(C-1 ของ exchange) — ถ้าสัญญาใหม่อยู่ใน batch POSTED แล้ว เส้นทาง cancel เดียวกันสลับเป็น
**C-2 semantics** (redirect แทน mirror ตรงบน 4 บัญชีรอบจ่าย, `cancelWindow: 'AFTER_PAYOUT'`)
— ดูหัวข้อ "ยกเลิกสัญญา (Flow C — Phase 3)".

**`depositAccountCode`:** ไม่บังคับอีกต่อไปบนคำขอ PRICED และ **ไม่มีผลต่อ JE ใดๆ** —
เหตุผลเดิมที่บังคับคือขาเงินสดของ A.3 (ถอด 2026-08-03) + penalty JE ตอน cancel
(ยกเลิกไปแล้ว 2026-07-31). คอลัมน์ `ContractExchangeRequest.depositAccountCode`
และฟิลด์ใน DTO **ยังคงอยู่** (ข้อมูลย้อนหลัง + API back-compat) แต่ไม่มีผู้อ่านในเส้นทางนี้แล้ว;
ช่องเลือกบัญชีบนหน้าจอส่งคำขอถูกถอดออก. `CASH_ACCOUNT_CODES` ที่ DTO import ถูกชี้กลับไปที่
`constants/cash-account.constants.ts` (แหล่งกลางที่ DTO อื่นอีก 6 ตัวใช้อยู่แล้ว) แทน template ที่ถูกลบ.

---

## ยกเลิกสัญญา (Flow C — Phase 3, workbook 2026-08-19)

Spec: `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md` §5-6 ·
Plan: `docs/superpowers/plans/2026-08-20-device-swap-workbook-phase3.md` ·
Integration: `apps/api/src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts` +
Task 5 golden ใน `exchange-priced-flow.integration.spec.ts` + Task 4/6 ใน
`interco-netting.integration.spec.ts`

**กติกา D3 (คำตัดสินเจ้าของ 2026-08-19 — ปิดประเด็น อย่าเสนอซ้ำ):** ยกเลิกสัญญาได้เฉพาะ
**ก่อนชำระงวดแรก** — เคยจ่ายแล้วต้อง void ใบเสร็จทั้งหมดก่อน (ใบลดหนี้ ม.86/10 ออกอัตโนมัติ
จาก receipt-void); สัญญาที่เดินไปแล้วใช้เส้นทางยึดเครื่อง (JP5) ตามเดิม. สองเคส:

| เคส | เงื่อนไข | พฤติกรรม |
|---|---|---|
| **C-1** | ยังไม่ถูกตัดจ่ายรอบจ่าย INTER-CO | sweep mirror-reverse ตรงทุกใบ — ทุกบัญชี net 0 ต่อสัญญา, สัญญาหลุดคิวจ่ายเองโดยนิยามเลนส์ (`HAVING SUM > 0` ไม่เจอ) |
| **C-2** | มี `InterCoSettlementItem` type `SETTLEMENT` ใน batch **POSTED** (detect ผ่าน `settledPayoutByContract` — ไม่อ่าน field บนสัญญา) | sweep เหมือน C-1 แต่ **redirect** ขาเจ้าหนี้/ลูกหนี้รอบจ่าย (batch ล้างไปแล้ว mirror ตรงจะติดลบ) เป็นลูกหนี้เรียกคืน `PAYOUT_RECALL` |

### สถาปัตยกรรม — sweep engine generalize (Task 1)

`ExchangeCancelReversalTemplate.reverse` (`exchange-cancel-reversal.template.ts`) ได้
options ใหม่ทั้งชุด: `excludeFlows` / `redirects: Record<account, {to, description}>` /
`redirectStamp` (stamp **เฉพาะ JE ที่มี redirect leg** — วาง spread ท้ายสุดให้ชนะค่า copy
จาก JE เดิม) / `flowLabel` / `descriptionPrefix` และคืน `redirectedTotals` (Σ Dr−Cr ของ
mirror legs ที่ถูก redirect เข้าแต่ละบัญชีปลายทาง — caller ใช้ cross-check). **Caller
exchange เดิมที่ส่งแค่ `{ jeIds, newContractId }` ได้พฤติกรรมเดิม byte-identical**
(flow `'exchange-cancel'`, idempotencyKey `cancel:<jeId>`, prefix `'[ยกเลิกเปลี่ยนเครื่อง]'`).
ห้ามเขียน sweep ตัวที่สอง — generic cancellation (`ContractCancellationTemplate`) delegate
เข้า engine ตัวนี้ด้วย `flowLabel: 'contract-cancellation'` + prefix `'[ยกเลิกสัญญา]'`.

### C-1 — `ContractCancellationTemplate` + `ContractCancellationService` (Task 2)

ยกเครื่องจาก mirror-1A-ใบเดียว (P4-SP4) → sweep ทุก JE ที่ stamp `metadata.contractId`
(1A + SHOP legs + 2A accruals + ฯลฯ). **JE refund เดิม (Dr 52-1106 / Cr 11-1201) ถูกลบ** —
`refundAmount > 0` โดน reject (field คงไว้ที่ DTO เพื่อ back-compat).

**`C1_EXCLUDED_FLOWS` — flows ที่ sweep ห้าม mirror (แชร์ constant เดียวกับ tripwire):**

| Flow | เหตุผล |
|---|---|
| `provision` | ECL รายวัน — mirror + release พร้อมกัน = double-debit 11-2102 ติดลบ (release แยกใบเดียวแทน — ดูล่าง) |
| `stage-reverse` | ขา release ของ ECL — คู่กับ provision ต้อง exclude ทั้งคู่ |
| `shop-collect-settlement` | **เงินสดจริง** (Dr cash / Cr 11-2107) — service guard บังคับ settle ให้ครบก่อนยกเลิกอยู่แล้ว |
| `shop-down-payment` | **เงินสดจริง** (Dr SHOP cash / Cr S21-2001) — mirror = fabricate การคืนเงินที่ยังไม่เกิด (ดู S21-2001 semantics ล่าง) |
| `reschedule-collect` | **เงินสดจริง** (6a fee เข้าตู้จริง) — park guard บังคับเคลียร์ก่อนยกเลิก |

**Positive cash tripwire** (นอกเหนือ deny-list): สแกน sweep candidates ชุดเดียวกับที่ engine
จะ mirror (เงื่อนไข skip เดียวกัน) — บรรทัดใดแตะบัญชีเงินสด/ธนาคาร (prefix `11-11` / `11-12` /
`S11-11` / `S11-12`) → `BadRequestException` ระบุ `entryNumber` — JE เงินสดที่ deny-list
ไม่รู้จักต้องดังไม่ใช่ถูก mirror เงียบ.

**ECL**: release **ใบเดียวจาก live GL** (pattern JP4 C1) — `glContractBalance(tx, id,
'11-2102', 'cr')` > 0 → `EclStageReverseTemplate` (`Dr 11-2102 / Cr 51-1103`) + flip
`BadDebtProvision` ACTIVE → REVERSED.

**Guards ใน `approveCancellation` (ทั้งหมดใน `$transaction` เดียว, ก่อน JE ใบแรก):**
1. Re-read contract **ใน tx** — ต้อง `ACTIVE` (กัน race กับ JP5/termination หลัง pre-tx read)
2. ไม่มี `Payment` ที่ `PAID` หรือ `amountPaid > 0` — เคยจ่ายต้อง void ก่อน (D3)
3. ไม่มี item ใน batch `DRAFT`/`PENDING_APPROVAL` — ถอน/ยกเลิกรอบก่อน (ระบุ batchNumber)
4. `refundAmount > 0` → reject (deprecated)
5. **Park 3 ถัง** (`advanceBalance + creditBalance + rescheduleAdvanceBalance > 0`) → reject
   — เงินพวกนี้เข้ามาเป็นเงินสดจริง (เช่น 6a fee ไม่ set `amountPaid` — หลุด guard ข้อ 2)
6. `shopCollectTypedBalance(tx, id)` ≠ 0 (typed lens ใหม่ใน `interco-typed-balance.ts` —
   explicit stamp ชนะ flow fallback, จำเป็นเพราะใบ settle เส้นทาง recall-cash ใช้ flow
   `'shop-collect-settlement'` เดิมแต่ stamp `PAYOUT_RECALL`) → reject

**Restore (ใน tx เดียวกัน):** product → `IN_STOCK` + `ownedByCompanyId` = SHOP;
soft-delete `Payment` + `InstallmentSchedule` ทุกแถว (cron/คิวเลิกเห็นสัญญา);
cancellation → APPROVED + `reversalJournalEntryId`; contract → `CANCELED`.

**S21-2001 semantics (ตั้งใจ — ไม่ใช่บั๊ก):** หลังยกเลิกสัญญาที่มีเงินดาวน์ S21-2001 ค้าง
**Cr downAmount** — sweep mirror JE B ของ activation (ที่เคย `Dr S21-2001` ล้างดาวน์) คืน
เจ้าหนี้เงินดาวน์กลับมา แต่ใบรับเงินดาวน์ (`shop-down-payment` — เงินสดจริง) ถูก exclude ⇒
ยอดค้างคือ **เจ้าหนี้รอคืนเงินลูกค้า** — การจ่ายคืนจริงเป็นขั้นตอนฝั่ง SHOP แยกต่างหาก
(`ShopDownPaymentReversalTemplate` เคสยังไม่ activate; JV มือเคสหลัง activate จนกว่าจะมี UI).

**Idempotency (DB-backed):** probe `ContractCancellation.reversalJournalEntryId` (persist
ใน tx เดียวกับ JEs) — ครอบทั้ง JE legacy P4-SP4 และ sweep ใหม่ (metadata probe เดิมมองไม่เห็น
sweep output เพราะ per-JE key ไม่มี cancellationId). ชั้นสอง: engine stamp `reversed:true`
ต่อใบ + DB idempotency index.

### C-2 — redirect + cross-check (Task 3, fold Task 4)

**Redirect map (`C2_REDIRECTS` — exported จาก `contract-cancellation.template.ts`,
ห้ามมีสำเนาที่สอง — exchange path import ชุดเดียวกัน):**

| บัญชีต้นทาง (mirror leg) | ปลายทาง | ความหมาย |
|---|---|---|
| 21-1101 (Dr mirror) | **11-2107** | ตั้งลูกหนี้เรียกคืน-หน้าร้าน (ยอดจัดที่ตัดจ่ายแล้ว) |
| 21-1102 (Dr mirror) | **11-2107** | ตั้งลูกหนี้เรียกคืน-หน้าร้าน (ค่าคอมที่ตัดจ่ายแล้ว) |
| S11-3001 (Cr mirror) | **S21-3001** | ตั้งเจ้าหนี้ FINANCE-เรียกคืน (ยอดจัด) |
| S11-3002 (Cr mirror) | **S21-3001** | ตั้งเจ้าหนี้ FINANCE-เรียกคืน (ค่าคอม) |

JE ที่มี redirect leg ถูก stamp `shopReceivableType: 'PAYOUT_RECALL'` (`C2_REDIRECT_STAMP`
— ระดับ JE, ชนะค่า copy จากใบเดิม). ยอด redirect = **gross ตาม GL ของใบที่ mirror** —
"หักไปแล้วเท่าไร" อ่านจาก item table ไม่ใช่ GL (สถาปัตยกรรม "เลนส์ gross + item gate").

**Cross-check หลัง sweep (ปิด carry (a) + กัน hand-JV, ใน tx — throw = rollback ทั้งชุด):**
`redirectedTotals['11-2107']` ต้อง = `settledTotal` (Σ financedGl+commissionGl ของ item
SETTLEMENT ใน batch POSTED) ±0.01 **และ** `redirectedTotals['S21-3001'].neg()` ต้อง =
`settledShopTotal` แยกสมุด — hand-JV ที่แตะเฉพาะสมุดเดียวผ่านเช็คสมุดเดียวได้ จึงต้องเช็ค
ทั้งคู่ (สัญญา `legacyNoShop` snapshot ฝั่ง SHOP = 0 → expected 0 = 0 ✓ โดยโครงสร้าง).

**Defensive check (C-2 เท่านั้น):** JE candidate ใดมีทั้งบรรทัดบน redirect source
(21-1101/21-1102/S11-3001/S11-3002) และบรรทัดบัญชี typed (`TYPED_LENS_ACCOUNTS` =
11-2107/S21-3001) หรือ `shopReceivableType` stamp เดิมในใบเดียวกัน → reject — redirect
stamp ทั้งใบจะทับความหมาย typed เดิม (เลนส์ Phase 2 อ่าน type ระดับ JE); producer จริง
ไม่มีทางสร้างใบแบบนี้ = hand-JV ผิดปกติ.

### เลขทองของเฟส — ยกเลิก swap หลังหักเครดิต 8,000 → เรียกคืนสุทธิ 3,000

สัญญาใหม่ของ swap: เจ้าหนี้ 11,000 (financed 10,000 + คอม 1,000), เครดิตสวอป 8,000 →
รอบจ่ายหัก 8,000 โอนจริง **3,000**. ยกเลิกหลัง batch POSTED:

- redirect เข้า 11-2107 = **11,000 gross** (= settledTotal — เจ้าหนี้ที่ batch ล้างไป)
  ⇒ typed `PAYOUT_RECALL` ทั้งสองสมุด = 11,000; typed `SWAP_CREDIT` net 0 (A.3/A.4 + mirror)
- delta ระดับบัญชีข้าม cancel: 11-2107 = **+3,000** (mirror A.3 −8,000 + redirect +11,000),
  S21-3001 = −3,000 (mirror A.4 +8,000 + redirect −11,000); 21-1101/21-1102/S11-3001/
  S11-3002 **ขยับ 0** (redirect ไม่ mirror ตรง — ไม่ติดลบ)
- คิวเรียกคืน (สูตร net Task 4): `recallGl = 11,000 − Σ POSTED deductions 8,000 = 3,000`
  = `shopRecallGl` — เลขเดียวสอดคล้องทุกชั้น: queue = drift RECALL = residual (0 หลังหัก) =
  audit `recallAmount` = เพดาน cash settle (settle เต็ม 3,000 แล้วหลุดคิว)

Golden ผ่าน production chain จริง (ไม่ synthetic): Task 5 spec ใน
`exchange-priced-flow.integration.spec.ts` — create→submit→approve batch จริง → cancel จริง.
Assertion ระดับบัญชีเป็น **delta** (batch JE ไม่ stamp `contractId` — per-contract lens
มองไม่เห็นขาหักโดยสถาปัตยกรรม).

### สูตร net ของ recall (ปิด carry (b) — แก้ Phase 2 ที่เขียนเป็น gross)

`getPendingRecalls` / drift guard แถว RECALL / `alarmNettingResiduals` ทั้งสามจุดเปลี่ยนจาก
gross → **net of Σ POSTED deductions (ทุก itemType)** — รายละเอียด+เหตุผลอยู่ในหัวข้อ
"หักกลบเครดิตเปลี่ยนเครื่อง + เรียกคืน (Phase 2)" (อัปเดตแล้ว 2026-08-20). สาเหตุที่ต้องแก้:
เคสยกเลิก swap ข้างบน — gross จะเสนอ 11,000 ให้หักซ้ำทั้งที่เงินจริงที่ต้องเรียกคืนคือ 3,000.

### เส้นทางรับเงินสดคืน (Task 6) — `POST /interco-settlement/recalls/:contractId/settle-cash`

Roles: `OWNER`/`FINANCE_MANAGER` (JE สองสมุดโพสต์ทันที ไม่มีชั้นเอกสาร/maker-checker —
gate ระดับ checker เหมือน approve/reverse). DTO: `amount` + `financeDepositAccountCode`
(FINANCE 6 บัญชี) + `shopPayoutAccountCode` (optional, default `S11-1201`) + `requestId`
(UUID ต่อการเปิด dialog). สองใบใน **Serializable `$transaction` เดียว**:

```
FINANCE — reuse ShopCollectSettlementTemplate + typeStamp: 'PAYOUT_RECALL'
  Dr <financeDepositAccountCode> / Cr 11-2107     (stamp shopReceivableType: 'PAYOUT_RECALL'
                                                   + metadata.contractId ⇒ typed recall lens
                                                   หักตรงประเภทต่อสัญญา — ต่างจากขา batch)
SHOP — journalAuto.createAndPost ตรง (flow 'interco-recall-cash-shop')
  Dr S21-3001 / Cr <shopPayoutAccountCode>        (stamp PAYOUT_RECALL เช่นกัน)
```

Guards ตามลำดับ: (0) idempotency `requestId` ก่อนทุกด่าน — retry หลัง settle เต็มจำนวน
ต้องคืนผลเดิมไม่ใช่ reject; ยอดไม่ตรงกับใบเดิม → 409; requestId เคยใช้กับ shop-collect
คนละเส้นทาง → 409 (กันใบขาเดียว); (1) มี RECALL item ใน batch `DRAFT`/`PENDING_APPROVAL`
→ reject ระบุรอบ (กันเงินก้อนเดียวถูกรับสด+หักในรอบพร้อมกัน); (2) สัญญาต้องอยู่ในคิว
`getPendingRecalls` (ยอด **net**); (3) สองสมุดตรงกัน ±0.01 (`recallGl` vs `shopRecallGl`
— ห้ามโพสต์ข้างเดียว); (4) `amount ≤ recallGl net + 0.01`. Race: SSI abort (P2034) และ
DB unique (P2002) แปลเป็น 409 ไทยทั้งคู่ — ไม่ใช่ raw 500. `typeStamp` default
`'SHOP_COLLECT'` บน template ⇒ caller เดิม (JP4 shop-collect settle) byte-identical.

### exchange-cancel C-2 (Task 5 — spec §5.5)

`ExchangeCancelService.cancel` ได้ branch เดียวกัน: guard batch เปิด + detect ผ่าน
`settledPayoutByContract(tx, [newContractId])` (helper เดียวกับ generic — export จาก
`contract-cancellation.service.ts`) + defensive check + redirect (`C2_REDIRECTS`/
`C2_REDIRECT_STAMP` import จาก generic template — ห้ามสำเนา) + cross-check สองสมุด +
`cancelWindow: 'AFTER_PAYOUT'` (C-1 ของ exchange ยังเป็น `'FREE'`). **FINALIZED-path audit
ย้ายไปหลัง tx commit** (doctrine R-1 — `AuditService.log` เปิด root-tx ซ้อน = P2028 pool
starvation + phantom audit row บน rollback; MEMO/PRE_FINALIZE audits ไม่แตะ).

### UI (Task 7)

- `ContractCancellationPage` (`/finance/contract-cancellation`): badge C-1/C-2 ต่อแถวจาก
  `listPendingCancellations` (`settledInBatch` + `recallAmount` **net** — สูตรเดียวกับ
  approve ผ่าน `settledPayoutByContract`, ห้าม duplicate) + confirm dialog แยกข้อความตามเคส
- `RecallCashDialog` (หน้า interco, `PendingTab` รายการเรียกคืน): default amount = net,
  `requestId` UUID สร้างใหม่ต่อการเปิด dialog (ปิด-เปิดใหม่ = คำขอใหม่)

### AuditLog actions (Phase 3 — String ธรรมดา ไม่มี Prisma enum)

| Action | Entity | เขียนที่ | newValue ที่สำคัญ |
|---|---|---|---|
| `CONTRACT_CANCELED` | `contract` | `approveCancellation` (C-1) | reversalEntryNumber/Count/JeIds |
| `CONTRACT_CANCELED_AFTER_PAYOUT` | `contract` | `approveCancellation` (C-2) | + `settledTotal` (**gross** — ตรวจย้อน redirect), `recallAmount` (**net** = settled − deductions), `batchNumbers` |
| `EXCHANGE_CANCELED` | `contract_exchange_request` | `ExchangeCancelService` (action เดิม — C-2 เพิ่ม field) | `window: 'AFTER_PAYOUT'` + `recallAmount` (net) + `batchNumbers` เมื่อ C-2 |
| `INTERCO_RECALL_CASH_SETTLED` | `contract` | `settleRecallCash` | amount, financeEntryNo/shopEntryNo, requestId, `recallNetBefore` |
| `CANCELLATION_REJECTED` | `contract` | `rejectCancellation` (เดิม — ไม่เปลี่ยน) | reason |

**นิยาม `recallAmount` = net เสมอ** (settledTotal − settledDeductions) ทุกจุดที่โผล่:
audit ทั้งสอง action, `listPendingCancellations`, คิว recall — ตัวเลขเดียวกับเงินสดที่
FINANCE โอนจริงในรอบที่ตัดจ่าย.

### CI

`deploy-gcp.yml` vitest step เพิ่ม glob `src/modules/contracts/__tests__/*.integration.spec.ts`
(2026-08-20) — ไฟล์ `contract-cancellation.integration.spec.ts` อยู่ใต้ `__tests__/` ซึ่ง glob
เดิม `src/modules/contracts/*.integration.spec.ts` ไม่ครอบ (บทเรียน jp5-vat-split: glob
ไม่ recurse เอง — spec ใหม่ใน subdirectory ใหม่ต้องตรวจ glob ทุกครั้ง).

### Carry → Phase 4

carry (a)/(b) ของ Phase 2 **ปิดแล้ว** (detection = POSTED item; สูตร net/combined). ที่เหลือ
— (c) เครดิต A.3-only งอกหลัง approve, (d) TOCTOU settle-cash vs approveBatch, (e) คิว
recall กรอง net ฝั่ง FINANCE เท่านั้น — รวมรายการอยู่ที่หัวข้อ "รอ Phase 4 (carry)" ใน
Inter-Co section ด้านบน; จุด hook ทั้งหมด = `interco-reconcile.cron` (Phase 4).
