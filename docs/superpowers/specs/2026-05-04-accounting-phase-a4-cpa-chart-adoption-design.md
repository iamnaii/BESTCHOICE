# Phase A.4 — CPA Chart Adoption (Full Accrual TFRS)

**Date:** 2026-05-04
**Author:** owner + Claude
**Status:** Design (approved)
**Supersedes:** Phase A.0–A.3 (PR #722–#727) — wholesale rewrite

## 1. Purpose

CPA ส่งผังบัญชี FINANCE ใหม่ 109 บัญชี + JE templates 6 เคสที่ละเอียดและถูกต้องตาม TFRS for NPAEs มากกว่าระบบปัจจุบัน. Phase A.4 ยึด CSV ทั้งชุดเป็น source of truth + rewrite ระบบบัญชีทั้งหมดให้ตรง 100% ก่อน go-live ขายผ่อน.

**Non-goals:** PPE/ค่าเสื่อม, WHT, รายจ่ายต้องห้าม, PEAK code mapping (defer ไป A.5+).

## 2. Source-of-Truth CSVs

`/Users/iamnaii/Desktop/ฝังบัญชี/`:
- `ผังบัญชี (FINANCE)-ตาราง 1.csv` — 109 accounts
- `ภาพรวม-ตาราง 1.csv` — accounting principles + flow summary
- `กรณี1-จ่ายเกิน-ตาราง 1.csv` — overpay (≤1฿ → 53-1503)
- `กรณี2-จ่ายขาด-ตาราง 1.csv` — underpay (≤1฿ → 52-1104)
- `กรณี3-แบ่งชำระ-ตาราง 1.csv` — split payment (multi 2B)
- `กรณี4-ปิดยอด-ตาราง 1.csv` — early payoff (52-1106 discount)
- `กรณี5-คืนเครื่อง-ตาราง 1.csv` — repossession (51-1102 loss)
- `กรณี6-ปรับดิว (แบ่งจ่าย 2 รอบ)-ตาราง 1.csv` — reschedule split-pay
- `กรณี6-ปรับดิว (ไม่แบ่งจ่าย)-ตาราง 1.csv` — reschedule bundled-pay

ก่อนเริ่ม implementation: copy ทั้งหมดเข้า repo ที่ `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/` เพื่อให้ tests reference ได้ + version control.

## 3. Scope

| # | Feature | สถานะ |
|---|---------|------|
| A | CoA re-seed 109 บัญชี + rewrite JE templates ตาม 6 เคส | in-scope |
| B | Interest Accrual (TFRS 15) ผ่าน `11-2106` Contra Asset | in-scope |
| C | VAT Accrual (`11-2105/21-2102` Dr/Cr วันเปิด → ล้างทีละงวด → `21-2101`) | in-scope |
| D | Cash dimension — 3 บัญชีผู้ถือเงิน (`11-1101/02/03`) | in-scope |
| E | Vendor split (`21-1101 ยอดจัด` + `21-1102 ค่าคอม`) | in-scope |
| F | Tolerance (`52-1104` ขาด, `53-1503` เกิน) ≤1฿ | in-scope |
| G | ส่วนลดดอกเบี้ยปิดยอด (`52-1106`) | in-scope |
| H | เคสปรับดิว — calc + UPDATE schedule + JE `21-1103` (2 flavor) | in-scope |
| I | VAT บังคับ 60 วัน (`21-2103 + 51-1101 + 51-1105` cron + reversal) | in-scope |
| J | PPE + ค่าเสื่อม (`12-21XX + 53-16XX`) | **DEFERRED → A.5** |
| K | WHT (`21-31XX/32XX + 54-XXXX`) | **DEFERRED → A.5** |
| L | รายจ่ายต้องห้าม (`54-XXXX`) | **DEFERRED → A.5** |
| M | PEAK code mapping | **DEFERRED → integration phase** |

## 4. Migration Strategy — Wipe & Reseed (Option W+b)

**Owner ยืนยัน:** ระบบบัญชียังไม่ได้ใช้จริง (production state ตาม audit 2026-04-29 = 1 JE + 36 orphan payments ทั้งหมดเป็น dev/test).

**Action — destructive (one-time, requires explicit owner approval):**
```sql
TRUNCATE
  journal_lines,
  journal_entries,
  chart_of_accounts,
  payments,
  installment_schedules,
  contracts,
  inter_company_transactions
RESTART IDENTITY CASCADE;
```

**ทำหลัง:** PR merge + deploy succeeds + owner click "wipe" button (manual one-shot Cloud Run Job).

**Side effects:**
- Test data ทั้งหมดของ QA หาย → ทีม QA สร้างใหม่หลัง wipe
- A.1b paired-JE / A.2 unearnedInterest / A.3 IC settlement records หาย
- ภาพ Phase A.0-A.3 history ใน git history เก็บไว้สำหรับ archaeology

## 5. Architecture

### 5.1 Files to delete

- `apps/api/src/modules/journal/journal-auto.service.ts` — full rewrite (1548 → ~800 lines)
- `apps/api/src/modules/accounting/inter-company-settlement.*` (A.3) — wholesale delete
- `apps/web/src/pages/InterCompanySettlementPage.tsx` (A.3) — delete
- SHOP-side seed: `docs/references/owner-chart-of-accounts.csv` references in seed code
- Schema fields: `Contract.unearnedInterest`, `Contract.unearnedCommission`, `Contract.vatPending` (A.2 — replace with new `11-2106` line balance)
- Account codes from seed: `21-2201, 21-2202, 21-2204, 42-2105, 53-1801, 11-2105 (old meaning), 11-3104, 11-3105, 41-2101, 41-2102, 51-2101, 51-2102, 53-1701 (old meaning)`

### 5.2 Files to keep (generic infra)

- `journal-auto.service.ts::generateEntryNumber` — advisory lock pattern (A.1c)
- `journal-auto.service.ts::createAndPost` — balanced-check + Sentry forward (A.0)
- `accounting.service.ts` — Trial Balance, P&L, BS endpoints (re-map account codes)
- `bad-debt.service.ts` — generic provision logic (swap codes)
- `monthly-close.service.ts` — period close (swap codes)
- `bank-reconciliation.service.ts` — generic
- Audit log conventions

### 5.3 New files

- `apps/api/prisma/seed-coa-finance.ts` — 109-account seed from CSV
- `apps/api/src/modules/journal/cpa-templates/` — one file per JE template:
  - `contract-activation-1a.template.ts`
  - `installment-accrual-2a.template.ts` (cron-triggered daily, picks due-today installments)
  - `payment-receipt-2b.template.ts` (cases 1, 2, 3, 6)
  - `early-payoff-jp4.template.ts` (case 4)
  - `repossession-jp5.template.ts` (case 5)
  - `reschedule-fee-jp6.template.ts` (case 6 — JE for 21-1103 advance receipt)
  - `vat-60day-mandatory.template.ts` (feature I)
  - `vat-60day-reversal.template.ts` (feature I)
  - `vendor-payable-clearance.template.ts` (point 3 of every case — 21-1101/02 → cash)
- `apps/api/src/modules/installments/reschedule.service.ts` — calc engine `ค่างวด÷30×วัน` + UPDATE schedule + reset `consecutive_missed`
- `apps/api/src/modules/journal/__tests__/cpa-cases.spec.ts` — golden-file e2e
- `apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts` — CSV parser

### 5.4 Schema changes

```prisma
model ChartOfAccount {
  // existing
  category        String?      // กลุ่ม: เงินสด, ลูกหนี้, VAT, ฯลฯ (CSV col "หมวดหมู่")
  vatApplicable   Boolean      @default(false)  // CSV col "ใช้กับ VAT"
  normalBalance   String       // "Dr" | "Cr" | "Dr/Cr" (CSV col "ยอดปกติ")
  notes           String?      // CSV col "หมายเหตุ"
  // remove `companyId` scoping (single FINANCE chart now)
}

model Payment {
  // new
  depositAccountCode  String   // FK → ChartOfAccount.code (11-1101/02/03/1201/1202/1203)
  toleranceLineId     String?  // points to JournalLine 52-1104 / 53-1503 if applied
}

model User {
  // new
  defaultCashAccountCode  String?  // pre-fill Payment.depositAccountCode dropdown
}

model Contract {
  // remove (A.2 fields):
  unearnedInterest    Decimal?  @db.Decimal(12, 2)
  unearnedCommission  Decimal?  @db.Decimal(12, 2)
  vatPending          Decimal?  @db.Decimal(12, 2)

  // ตัวเลขปัจจุบัน derive จาก JournalLine balance:
  // - 11-2101 Gross outstanding
  // - 11-2106 deferred interest remaining
  // - 11-2105 VAT receivable remaining
  // - 21-2102 VAT pending remaining
}

model InstallmentSchedule {
  // new
  rescheduledFromDate DateTime?  // original due_date before ปรับดิว
  rescheduleCount     Int        @default(0)
}
```

### 5.5 Account-Code Conventions (selected — full list = CSV)

| Code | Name | Type | Used in |
|------|------|------|---------|
| 11-1101/02/03 | เงินสด (3 ผู้ถือ) | Asset Dr | 2B, 3 |
| 11-1201/02/03 | ธนาคาร (KBank, SCB×2) | Asset Dr | 2B, 3 |
| 11-2101 | ลูกหนี้ผ่อนชำระ Gross | Asset Dr | 1A, 2A |
| 11-2103 | ลูกหนี้ค้างชำระ (Accrual) | Asset Dr | 2A, 2B |
| 11-2104 | ลูกหนี้-VAT ที่ออกแทน | Asset Dr | feature I |
| 11-2105 | ลูกหนี้ภาษีขายรอเรียกเก็บ | Asset Dr | 1A, 2A |
| 11-2106 | รายได้รอตัดบัญชี-ดอกเบี้ย | **Contra Asset Cr** | 1A, 2A, 4 |
| 21-1101 | เจ้าหนี้-หน้าร้าน (ยอดจัด) | Liability Cr | 1A, 3 |
| 21-1102 | เจ้าหนี้ค่าคอม-หน้าร้าน | Liability Cr | 1A, 3 |
| 21-1103 | เงินรับล่วงหน้า-ชำระก่อนครบกำหนด | Liability Cr | 6 |
| 21-2101 | ภาษีขาย ภ.พ.30 | Liability Cr | 2A |
| 21-2102 | ภาษีขายรอเรียกเก็บ | Liability Cr | 1A, 2A |
| 21-2103 | VAT บังคับ-ลูกหนี้ค้าง 60 วัน | Liability Cr | feature I |
| 41-1101 | รายได้ดอกเบี้ย (Accrual) | Revenue Cr | 2A, 4 |
| 41-1102 | รายได้จากการยึดสินค้า | Revenue Cr | 5 (gain case) |
| 51-1101 | ค่าใช้จ่าย VAT ลูกหนี้ไม่ชำระ | Expense Dr | feature I |
| 51-1102 | หนี้สูญ/ขาดทุนจากยึดเครื่อง | Expense Dr | 5 (loss) |
| 51-1105 | VAT กลับรายการ-ลูกหนี้ชำระ | Contra-Expense Cr | feature I reversal |
| 52-1104 | ส่วนลดไม่จ่ายเศษสตางค์ | Expense Dr | case 2 |
| 52-1106 | ส่วนลดดอกเบี้ย-ปิดยอด | Expense Dr | case 4 |
| 53-1503 | กำไร(ขาดทุน)จากการปัดเศษ | Expense Dr/Cr | case 1 |

## 6. JE Templates (per case)

ทุก template ต้องผ่าน `createAndPost(tx, lines, metadata)` ที่ enforce:
- Σ Dr === Σ Cr (else throw + Sentry)
- ทุก account code มีอยู่ใน `chart_of_accounts`
- entry_no ผ่าน advisory lock (no race)

### 6.1 1A — Contract Activation (วันเปิดสัญญา, one-time)

**Trigger:** `ContractService.activate(contractId)`

```
Dr 11-2101 ลูกหนี้ Gross         (financedAmount + commission + interest)  excl VAT
Dr 11-2105 ลูกหนี้ภาษีขายรอฯ      (vatTotal)
  Cr 21-1101 เจ้าหนี้-หน้าร้าน    (financedAmount)
  Cr 21-1102 เจ้าหนี้ค่าคอม       (commission)
  Cr 11-2106 รายได้รอตัดบัญชี      (interest)         ← Contra Asset
  Cr 21-2102 ภาษีขายรอเรียกเก็บ    (vatTotal)
```

**Source numbers** (CSV example): financedAmount=10,000 | commission=1,000 | interest=6,000 | vatTotal=1,190

### 6.2 2A — Installment Accrual (ทุกงวด ทุก due_date — cron daily)

**Trigger:** `cron @ 00:01 daily` → find `installment_schedules WHERE due_date = today AND accrual_je_id IS NULL`

```
Dr 11-2103 ลูกหนี้ค้างชำระ           (installmentTotal incl VAT)
Dr 21-2102 ล้างภาษีขายรอเรียกเก็บ    (vatPerInstallment)
Dr 11-2106 รายได้รอตัดบัญชี          (interestPerInstallment)
  Cr 11-2101 ลูกหนี้ Gross (ลด)     (principal + commission + interest per installment)
  Cr 11-2105 ลูกหนี้ภาษีขายรอฯ      (vatPerInstallment)
  Cr 41-1101 รายได้ดอกเบี้ย          (interestPerInstallment)  ← recognize
  Cr 21-2101 ภาษีขาย ภ.พ.30          (vatPerInstallment)
```

**Per-installment values** (CSV /12): 1416.66 / 99.17 / 500.00 / 99.17 / 99.17

### 6.3 2B — Payment Receipt (cases 1, 2, 3)

**Trigger:** `PaymentService.create({ contractId, amount, depositAccountCode })`

**Case 1 — Overpay (≤1฿):**
```
Dr 11-1101 (depositAccountCode)   (amountReceived)
  Cr 11-2103 ลูกหนี้ค้างชำระ        (installmentTotal)
  Cr 53-1503 กำไรปัดเศษ            (overpay)
```

**Case 2 — Underpay (≤1฿):**
```
Dr 11-1101 (depositAccountCode)   (amountReceived)
Dr 52-1104 ส่วนลดเศษสตางค์         (underpay)         ← requires approver flag
  Cr 11-2103 ลูกหนี้ค้างชำระ        (installmentTotal)
```

**Case 3 — Split Payment (multi 2B per installment):**
```
Each partial payment:
Dr 11-1101 (depositAccountCode)   (partialAmount)
  Cr 11-2103 ลูกหนี้ค้างชำระ        (partialAmount)
```
Last payment closes the gap. Tolerance applies only on final partial.

### 6.4 4 — Early Payoff (ปิดยอด with discount)

**Trigger:** `EarlyPayoffService.execute({ contractId, settlementAmount, interestDiscountPercent })`

```
Dr 11-1101 (depositAccountCode)         (settlementAmount)
Dr 11-2106 รายได้รอตัดบัญชี              (remainingDeferredInterest)
Dr 21-2102 ภาษีขายรอเรียกเก็บ            (remainingDeferredVat)
Dr 52-1106 ส่วนลดดอกเบี้ย-ปิดยอด         (discountAmount)
  Cr 11-2101 ลูกหนี้ Gross               (remainingGross)
  Cr 11-2105 ลูกหนี้ภาษีขายรอฯ          (remainingDeferredVat)
  Cr 41-1101 รายได้ดอกเบี้ย              (remainingDeferredInterest − discount)
  Cr 21-2101 ภาษีขาย ภ.พ.30              (remainingDeferredVat)
```

### 6.5 5 — Repossession (คืนเครื่อง)

**Trigger:** `RepossessionService.confirm({ contractId, repossessionValue })`

```
Dr 11-1101 (depositAccountCode)         (repossessionValue)
Dr 11-2106 รายได้รอตัดบัญชี              (remainingDeferredInterest)
Dr 21-2102 ภาษีขายรอเรียกเก็บ            (remainingDeferredVat)
Dr 51-1102 ขาดทุนจากยึดเครื่อง           (lossAmount = remainingTotal − repossessionValue)
  Cr 11-2101 ลูกหนี้ Gross               (remainingGross)
  Cr 11-2105 ลูกหนี้ภาษีขายรอฯ          (remainingDeferredVat)
  Cr 21-2101 ภาษีขาย ภ.พ.30              (remainingDeferredVat)
  Cr 41-1101 รายได้ดอกเบี้ย              (remainingDeferredInterest)
```

If `repossessionValue > remainingTotal` → swap `Dr 51-1102` for `Cr 41-1102 รายได้ยึดสินค้า`.

### 6.6 6 — Reschedule (ปรับดิว) — 2 flavors

**Step 1 (no JE):** UPDATE schedule
- `installment_schedules.due_date += daysToShift` for installments ≥ requestedInstallment
- `installment_schedules.amount_due` of last installment -= rescheduleFee
- `contracts.consecutive_missed = 0`

**Step 2 (2A normal):** Run normal accrual on overdue installment at original due_date

**Step 3 — variant 6a (split-pay):**
```
Payment 1 (partial fee, e.g., 02/05 — 808.44):
Dr 11-1101 (depositAccountCode)     808.44
  Cr 21-1103 เงินรับล่วงหน้า          808.44

Payment 2 (full installment, e.g., 16/05 — 1,515.83):
Dr 11-1101 (depositAccountCode)   1,515.83
  Cr 11-2103 ลูกหนี้ค้างชำระ         1,515.83
```

**Step 3 — variant 6b (bundled):**
```
Single payment (02/05 — 2,324.27):
Dr 11-1101 (depositAccountCode)   2,324.27
  Cr 11-2103 ลูกหนี้ค้างชำระ         1,515.83
  Cr 21-1103 เงินรับล่วงหน้า          808.44
```

**Step 4 (last installment, e.g., งวด 12 16/12):** Both flavors converge
```
2A: normal accrual at full installment amount
2B:
Dr 21-1103 เงินรับล่วงหน้า (ล้าง)    808.44
Dr 11-1101 (depositAccountCode)     707.39
  Cr 11-2103 ลูกหนี้ค้างชำระ         1,515.83
```

**Reschedule fee formula:** `rescheduleFee = installmentAmount ÷ 30 × daysToShift` (rounded to 2 decimals)

### 6.7 Vendor Payable Clearance (point 3 ของทุกเคส — เครดิตเทอม)

**Trigger:** `VendorPayoutService.execute({ contractId })` (manual or cron — TBD; currently manual = 15 days after activation per CSV)

```
Dr 21-1101 เจ้าหนี้-หน้าร้าน           (financedAmount)
Dr 21-1102 เจ้าหนี้ค่าคอม              (commission)
  Cr 11-1101 (depositAccountCode)     (financedAmount + commission)
```

### 6.8 VAT 60-Day Mandatory (Feature I)

**Trigger:** `cron @ 02:00 daily` → find installments where `due_date ≤ today − 60 days AND status = OVERDUE AND vat_60day_je_id IS NULL`

```
Dr 51-1101 ค่าใช้จ่าย VAT ลูกหนี้ไม่ชำระ   (vatPerInstallment)
Dr 11-2104 ลูกหนี้-VAT ที่ออกแทน          (vatPerInstallment)
  Cr 21-2103 VAT บังคับ-ลูกหนี้ค้าง 60 วัน  (vatPerInstallment) ×2
```

(This is double-entry × 2: P&L recognition + receivable creation)

**Reversal trigger:** Customer eventually pays the overdue installment → `PaymentService` detects `vat_60day_je_id NOT NULL` → run reversal:

```
Dr 21-2103 (reverse)                     (vatPerInstallment)
Dr 21-2103 (reverse)                     (vatPerInstallment)
  Cr 51-1105 VAT กลับรายการ-ลูกหนี้ชำระ   (vatPerInstallment)
  Cr 11-2104 ลูกหนี้-VAT ที่ออกแทน        (vatPerInstallment)
```

## 7. Testing Strategy — Golden File E2E

`apps/api/src/modules/journal/__tests__/cpa-cases.spec.ts` runs all 7 CSV cases:

```typescript
describe.each([
  ['case-1-overpay', { contract: STANDARD_17K_12M, payment: 1516.00 }],
  ['case-2-underpay', { contract: STANDARD_17K_12M, payment: 1515.00 }],
  ['case-3-split-payment', { contract: STANDARD_17K_12M, payments: [800, 715.83] }],
  ['case-4-early-payoff', { contract: STANDARD_17K_12M, paidInstallments: 6, settlement: 7594.98 }],
  ['case-5-repossession', { contract: STANDARD_17K_12M, paidInstallments: 4, repoValue: 7000 }],
  ['case-6a-reschedule-split', { contract: STANDARD_17K_12M, partialFee: 808.44, fullPayDate: '16/05' }],
  ['case-6b-reschedule-bundled', { contract: STANDARD_17K_12M, bundledAmount: 2324.27 }],
])('CPA %s', (caseName, params) => {
  it('JE matches CSV golden output', async () => {
    const expected = await loadCsvFixture(`fixtures/cpa-cases/${caseName}.csv`);
    const contract = await seedContract(params.contract);

    // execute the case scenario
    await executeScenario(contract, params);

    // collect all generated JEs
    const actual = await formatJEsAsCsvRows(contract.id);

    // diff with tolerance 0.01 on Decimal
    expect(actual).toMatchGoldenJE(expected);
  });
});
```

**STANDARD_17K_12M fixture:**
- principal: 10,000 | commission: 1,000 | interest: 6,000 | VAT: 1,190
- Total Gross: 17,000 | Total cust pays: 18,190 over 12 installments | per inst: 1,515.83

**Diff helper** uses `Decimal` comparison with tolerance 0.01, reports mismatched lines with account code highlighted.

## 8. Sequencing — Suggested Implementation Order

(Detailed plan ออกใน writing-plans skill ต่อไป — นี่คือ rough order)

1. **Foundation:** schema migration + CoA seed + delete A.0–A.3 dead code
2. **Templates first — testable in isolation:** 1A, 2A, 2B (cases 1, 2)
3. **Cron infra:** 2A daily accrual + 60-day VAT cron
4. **Complex cases:** Case 3 (split), 4 (early payoff), 5 (repo)
5. **Reschedule:** schedule UPDATE service + 6a/6b JE
6. **Vendor payable clearance:** point 3 of every case
7. **Cash dimension:** add `User.defaultCashAccountCode` + Payment dropdown UI
8. **Tolerance approval:** UI flag + audit log on `52-1104` lines
9. **Update accounting reports:** trial balance, P&L, BS endpoints + UI tables
10. **Wipe & reseed prod** + manual smoke test 6 cases via UI
11. **Update `.claude/rules/accounting.md`** to reflect new model

## 9. Backward Compatibility

**None.** Breaking change announced in commit message + memory note. All Phase A.0–A.3 references in `MEMORY.md` get superseded notes pointing to this design.

`accounting.md` rewrite from scratch, ไม่เก็บ history (CSV ใหม่ contradicts ของเดิม too much; preserving both confuses future readers).

## 10. Open Questions / Risks

1. **Vendor payout timing** — CSV ตัวอย่างแสดง 15 วันหลัง activate. ปัจจุบันยังไม่มี cron. ตอนนี้ assume **manual trigger** (UI button). Re-visit ถ้า CPA spec มี automation rule.
2. **PaySolutions webhook** — เข้ามาเป็น `Payment.create` → ใช้ `depositAccountCode` ของ "บัญชีระบบ PaySolutions" (= 11-1202 SCB ค่าใช้จ่าย? ต้องถาม owner). Default ตอนนี้: `11-1202`.
3. **Tolerance approval flow** — ใครอนุมัติ `52-1104`? ตอนนี้ design = `roles: ['OWNER', 'ACCOUNTANT']` + audit log. Re-visit ถ้า owner อยาก SALES อนุมัติเองถึง limit.
4. **Multi-branch** — CSV เป็น single-entity FINANCE. Branch dimension ยังต้องคงไว้ (จาก SHOP) แต่ FINANCE JE ไม่ scope by branch. จะ enforce ที่ schema level ว่า FINANCE JE → `branchId = null` OK ไหม?

## 11. Acceptance Criteria

- [ ] CSV 109 บัญชี seeded ใน `chart_of_accounts` ตรงทุกแถว (code, name, type, normalBalance, vatApplicable, category)
- [ ] 7 CPA case golden tests pass
- [ ] All Phase A.0–A.3 dead code removed (grep confirms zero references to deleted symbols)
- [ ] Trial Balance endpoint returns balanced totals หลัง run 7 cases
- [ ] P&L endpoint แสดงรายได้ดอกเบี้ยรับรู้ตาม Accrual ไม่ใช่ upfront
- [ ] BS endpoint แสดง `11-2106` เป็น Contra Asset (negative under Asset section)
- [ ] Wipe script tested in dev → reseed runs cleanly
- [ ] `accounting.md` rewritten + reviewed
