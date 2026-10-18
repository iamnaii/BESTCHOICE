# ใบปิดยอดก่อนกำหนดเป็นใบกำกับภาษีตามบัญชี (ฝ่ายบัญชี 16.1/16.2 + 18.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ใบเสร็จ `EARLY_PAYOFF` พิมพ์มูลค่า/ภาษี "ตามรายการบัญชี" (ภาษี = ภาษีขายของทุกงวดที่ใบนี้ปิด ไม่ใช่ถอด 7/107 จากเงินที่รับ) · ส่วนลดดอกเบี้ยปิดยอดเป็นแถวแยกที่ไม่ลดฐานภาษี · เงินพักค่าปรับดิว/เงินรับล่วงหน้าที่ยอดปิดหักเป็นแถวติดลบพร้อมภาษีที่ออกใบกำกับไปแล้ว (ข้อ 13–14) · บรรทัดอธิบาย 18.1 (ลดเฉพาะงวดที่ยังไม่ถึงกำหนด).

**Architecture:** ขยายกลไก PR3/PR4ข — ตอนลง JP4 (`earlyPayoff`) คำนวณ `receiptTax` ของใบปิดยอดจากตัวเลขของรายการ (`buildEarlyPayoffJE`) + ภาษีคงเหลือของแต่ละงวดตามกติกา PR3 (`remainingAccrualPortion(basis, documentedSoFar(...))` — ใบที่ทำให้ครบรับส่วนที่เหลือ) แล้วประทับลง `metadata.receiptTax` ของรายการ JP4 · `generateReceipt('EARLY_PAYOFF', …, entryNumber)` ผูกรายการและคัดลอกค่าลงแถว `Receipt` (7 ช่องเดิม + ช่องใหม่ `discountAmount`) · PDF อ่านค่าที่เก็บผ่าน `storedReceiptDocumentMoney` + บริบทจาก metadata (`payoffContext`).

**Tech Stack:** NestJS + Prisma (migration เพิ่ม `receipts.discount_amount`) · jest unit (journal/receipts/contracts) · vitest DB (`contracts/*.integration.spec.ts` — glob CONTRACTS_FILES มีอยู่แล้ว).

**Spec:** mockup เจ้าของเคาะ 18/10/2569 `https://claude.ai/artifact/7WWhgoL9ovNxPHji7m6tGf` (กระดาน 1 ใบ 16.1 · กระดาน 2 ใบ 16.2 มีเงินพัก · กระดาน 3 ใบ + 18.1 ค้าง 4 จาก 8 งวด) + โน้ตบนแคนวาส (กติกาที่เสนอ) · คำตอบฝ่ายบัญชี 16/10/2569 ข้อ 16.1/16.2 "ok" · เจ้าของตอบ "ok" 2 คำถาม (มีบรรทัดอธิบาย 18.1 บนใบ · ชื่อแถว "ส่วนลดดอกเบี้ยปิดยอด").

## Global Constraints

- ไม่มีสูตรภาษีที่สอง: ภาษีของแถวค่างวด = Σ ภาษีคงเหลือของแต่ละงวดตาม `remainingAccrualPortion(basis, documentedSoFar(basis, priorClearings))` (กติกา PR3 — ใบที่ทำให้ครบรับส่วนที่เหลือ · งวดสุดท้ายรับเศษ) · ภาษีของแถวหักเงินรับล่วงหน้า = `advanceVatReversal` ของรายการ JP4 (ขากลับที่ลงจริง).
- Invariant ใหม่ของค่าที่เก็บ: `amountBeforeVat + vatAmount + roundingAmount + lateFeeAmount − discountAmount = amount` (`discountAmount` ไม่มี = 0 — ใบเดิมทุกใบยังผ่าน).
- ใบที่ไม่มีค่าที่เก็บ (ออกก่อน deploy) พิมพ์เหมือนเดิมทุกตัวอักษร — ห้ามแก้ `legacyReceiptDocumentMoney` · เทสเดิม "ใบปิดยอด (ไม่เก็บค่า) → 16,205.57 / 1,134.39" ต้องยังผ่าน.
- รายการบัญชี JP4 ไม่เปลี่ยนบรรทัด (preview === posted) — เพิ่มเฉพาะ metadata.
- `excessIncome > 0` (18.2 — เงินรับเกินยอดปิด) = ไม่เก็บค่า (ใบพิมพ์แบบเดิม) + Sentry warning · เครดิต 21-5101 ที่หัก (`creditRelief`) = แถวหักไม่มีภาษี (ยังไม่มีคำตัดสิน — จดใน accounting.md).
- ห้าม `prisma format` · ห้าม `apps/api run lint` (--fix) → `npx eslint --no-fix` · absolute path ทุกคำสั่ง · zsh.
- เวอร์ชันเว็บ 26.10.40 (ต่อจาก #1713 = 26.10.39) · สาขา `feat/payoff-receipt-16` แตกจาก `feat/payoff-discount-not-due` (= origin/main + #1713) — rebase/merge origin/main หลัง #1713 merge ก่อนเปิด PR.
- PDF ต้องพอหน้าเดียว (CI "PDF documents" ตรวจ page box/blank pages) — แถว/บรรทัดเพิ่มสั้น.

## Review Focus

1. งวดที่มีใบรับบางส่วนก่อนปิดยอด (PARTIALLY_PAID) — ภาษีของงวดนั้นบนใบปิดยอด = ภาษีของงวด − ที่ใบบางส่วนแสดงแล้ว (Task 4 เทส `priorClearings`).
2. ตารางงวดไม่ตรงบัญชี (Σ ส่วนที่เหลือของงวด ≠ ลูกหนี้ตามบัญชี) — ใบยังออก (ฐาน = บัญชี − ภาษีตามงวด) + Sentry `early-payoff-receipt-schedule-vs-ledger` (Task 4).
3. ใบปิดยอดที่ออกก่อน deploy (null ทุกช่อง) → PDF ตรรกะเดิม (Task 2/5 เทสเดิม).
4. ปิดยอดที่มีเงินรับเกิน (18.2) → ไม่เก็บค่า ไม่ล้ม (Task 1 เทส null · Task 4 warning).
5. `generateReceipt` ล้ม (เช่น เลขที่รายการไม่ตรง) → ปิดยอดสำเร็จแล้วตามเดิม (log) — Task 4 ไม่เปลี่ยนพฤติกรรม catch.

---

### Task 1: `earlyPayoffReceiptTax` + ช่อง `discountAmount` ใน breakdown (pure)

**Files:**
- Modify: `apps/api/src/modules/journal/receipt-tax-breakdown.ts`
- Test: `apps/api/src/modules/journal/receipt-tax-breakdown.payoff.spec.ts` (ใหม่)

**Interfaces:**
- Produces: `ReceiptTaxBreakdown.discountAmount?: string` · `parseReceiptTax` รับ/ตรวจ discountAmount (optional · invariant ลบส่วนลด) · `receiptTaxColumns(b)` คืน `discountAmount: Decimal` (0 เมื่อไม่มี) · `earlyPayoffReceiptTax(input: EarlyPayoffReceiptTaxInput): ReceiptTaxBreakdown | null` โดย
  ```ts
  export interface EarlyPayoffReceiptTaxInput {
    amount: Decimal;            // เงินที่รับ (cashReceived = quote.totalPayoff)
    receivableCleared: Decimal; // 11-2101 + 11-2103 + 11-2105 ที่ล้าง
    installmentVat: Decimal;    // Σ ภาษีคงเหลือของงวดที่ปิด (Task 4 คำนวณ)
    lateFees: Decimal;          // Cr 42-1103 (netted)
    discount: Decimal;          // Dr 52-1106
    parkRelief: Decimal; advanceRelief: Decimal; creditRelief: Decimal;
    advanceVatReversal: Decimal; // Dr 21-2101 / Cr 21-2102 (ภาษีที่ออกใบกำกับไปแล้วของเงินที่หัก)
    roundingGain: Decimal;      // Cr 53-1503
    excessIncome: Decimal;      // > 0 → null
  }
  ```
  แถว: `advanceAmount = −(park + advance + credit)` · `advanceVatAmount = −advanceVatReversal` · `amountBeforeVat = (receivableCleared − installmentVat) + (advanceAmount − advanceVatAmount)` · `vatAmount = installmentVat + advanceVatAmount` · `roundingAmount = roundingGain` · `lateFeeAmount = lateFees` · `lateFeeWaivedAmount = 0` · `discountAmount = discount` · null เมื่อ excess > 0 / ค่าติดลบ / identity ≠ amount.

- [ ] **Step 1: เทสแดง** — กรณี 16.1 (amount 15,189.98 · receivable 18,190 · vat 1,190 · discount 3,000.02 → before 17,000.00 · vat 1,190.00 · discount 3,000.02) · 16.2 (amount 14,318.16 · park 1,044 · reversal 68.30 · discount 2,827.84 → before 16,024.30 · vat 1,121.70 · advance −1,044.00 / −68.30) · กระดาน 3 (amount 11,126.65 · receivable 12,126.68 · vat 793.32 · discount 1,000.03 → before 11,333.36) · ค่าปรับ 100 + ปัดเศษ 0.33 เข้า lateFeeAmount/roundingAmount · excess 5.00 → null · identity ไม่ตรง → null · `parseReceiptTax` v1 เดิมไม่มี discountAmount → ผ่านเหมือนเดิม · มี discountAmount → invariant ลบส่วนลด · `receiptTaxColumns` คืน discountAmount.
- [ ] **Step 2: รัน** `cd /Users/iamnaii/Desktop/App/BESTCHOICE-defect-exchange/apps/api && npx jest src/modules/journal/receipt-tax-breakdown.payoff.spec.ts` — Expected: FAIL (`earlyPayoffReceiptTax is not a function` / TS error).
- [ ] **Step 3: implement** ใน receipt-tax-breakdown.ts (MONEY_FIELDS เดิม + optional `discountAmount` ใน parse · columns · builder).
- [ ] **Step 4: รันเทสไฟล์ใหม่ + เทสเดิม** `npx jest src/modules/journal/receipt-tax-breakdown src/modules/receipts/services/receipt-issuance.tax-breakdown.spec.ts` — Expected: PASS ทั้งหมด.
- [ ] **Step 5: commit** `feat(receipts): earlyPayoffReceiptTax + discountAmount in receipt tax breakdown (16.1/16.2)`.

### Task 2: คอลัมน์ `Receipt.discountAmount` + migration + `storedReceiptDocumentMoney`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model Receipt หลัง `advanceVatAmount`), `apps/api/src/modules/receipts/services/receipt-document-money.ts`
- Create: `apps/api/prisma/migrations/20261029000000_receipt_payoff_discount/migration.sql`
- Test: `apps/api/src/modules/receipts/services/receipt-document-money.spec.ts` (เพิ่ม describe)

**Interfaces:**
- Produces: `ReceiptMoneyView.discountAmount?: DecimalLike` · `ReceiptDocumentMoney.discount: Money` (0 เมื่อไม่มี) · stored: `installmentPortion = amount − fee − rounding − advance + discount` · `documentMoneyColumns` คืน `discountAmount` · legacy: `discount = 0`.

- [ ] **Step 1: เทสแดง** — stored EARLY_PAYOFF 16.1 → `installmentPortion 18,190.00 · installmentExclVat 17,000.00 · installmentVat 1,190.00 · discount 3,000.02 · exclVat 17,000.00 · vatPart 1,190.00 · advanceRows []` · 16.2 → `installmentPortion 18,190.00 · installmentVat 1,190.00 · advanceRows [['DEDUCTION','-1044.00','-68.30']] · exclVat 16,024.30 · vatPart 1,121.70 · discount 2,827.84` · legacy payoff เดิม `discount 0.00` · `documentMoneyColumns(stored).discountAmount = 3000.02`.
- [ ] **Step 2: รัน** `npx jest src/modules/receipts/services/receipt-document-money.spec.ts` — Expected: FAIL (discount undefined).
- [ ] **Step 3: implement** schema (ห้าม prisma format — แทรกบรรทัดด้วยมือ) · migration SQL `ALTER TABLE "receipts" ADD COLUMN "discount_amount" DECIMAL(12,2);` · `npx prisma generate` (apps/api) · document-money.
- [ ] **Step 4: รัน** เทสไฟล์เดิมทั้งไฟล์ + `npx tsc --noEmit -p tsconfig.json` — Expected: PASS · 0 error.
- [ ] **Step 5: commit** `feat(receipts): Receipt.discountAmount column + stored document money with payoff discount row`.

### Task 3: issuance ผูกรายการ JP4 + เก็บค่า

**Files:**
- Modify: `apps/api/src/modules/receipts/services/receipt-issuance.service.ts`
- Test: `apps/api/src/modules/receipts/services/receipt-issuance.tax-breakdown.spec.ts`

**Interfaces:**
- Consumes: `parseReceiptTax` / `receiptTaxColumns` (Task 1).
- Produces: `generateReceipt(contractId, null, 'EARLY_PAYOFF', amount, null, method, ref, userId, paidDate, jp4EntryNumber)` — acceptedTag = `meta.tag === 'JP4' && meta.flow === 'early-payoff'` · อ่าน `meta.receiptTax` (amount ต้องเท่า) → เก็บ 8 ช่อง · ไม่มี stamp = ผูกรายการแต่ไม่เก็บค่า (warn — ใบพิมพ์แบบเดิม).

- [ ] **Step 1: เทสแดง** — แก้เทส "ใบปิดยอดผูกรายการ JP4 ยังไม่ได้ → ปฏิเสธ" เป็น "ผูกรายการ JP4 + เก็บค่ารวม discountAmount" (source meta `{tag:'JP4', flow:'early-payoff', contractId:'c1', receiptTax:{…16.1…}}` → `created[0].discountAmount = 3000.02 · amountBeforeVat 17000 · vatAmount 1190 · sourceJournalEntryId 'je-jp4'`) · เพิ่ม "JP4 ไม่มี receiptTax → ผูกรายการ ช่องว่าง + warn" · "amount ไม่ตรง stamp → ไม่เก็บค่า" · เทสเดิม "ผู้เรียกไม่ส่งเลขที่รายการ → ไม่ผูก ไม่เก็บ" คงไว้.
- [ ] **Step 2: รัน** — Expected: FAIL ("ไม่พบรายการบัญชีรับชำระที่ตรงกับใบเสร็จ").
- [ ] **Step 3: implement** (acceptedTag สำหรับ EARLY_PAYOFF · สาขาอ่าน stamp ให้รวม EARLY_PAYOFF · `receiptTaxMissing` เมื่อ JP4 ไม่มี stamp).
- [ ] **Step 4: รันเทสไฟล์** — Expected: PASS.
- [ ] **Step 5: commit** `feat(receipts): EARLY_PAYOFF receipt links its JP4 entry and stores the tax columns`.

### Task 4: ประทับ `receiptTax` บน JP4 + ส่งเลขที่รายการให้ generateReceipt

**Files:**
- Create: `apps/api/src/modules/journal/early-payoff-receipt-vat.ts` — `remainingInstallmentVat(client, contract: Accrual2AContractFields & {id}, installmentNos: number[]): Promise<{ vat: Decimal; total: Decimal; perInstallment: Array<{installmentNo, vat, total}> }>` = ต่องวด: `basis = computeInstallmentBreakdown(accrual2AInputOf(c, no))` · `priorClearings` จาก `reconstructPriorCleared(client, schedId, basis.installmentTotal)` (ไม่มีแถวตารางงวด = ไม่มีรายการก่อน) · `rest = remainingAccrualPortion(basis, documentedSoFar(basis, priorClearings))`.
- Modify: `apps/api/src/modules/contracts/contract-payment.service.ts` (ใน tx หลัง `epJe` · `jeMetadata` + `receiptTax` + `notDueMonths/dueMonths/firstUnpaidInstallmentNo/lastUnpaidInstallmentNo` · จับผล `createAndPost` → `jp4EntryNumber` · ส่งเป็นอาร์กิวเมนต์ที่ 10 ของ `generateReceipt`).
- Test: `apps/api/src/modules/journal/early-payoff-receipt-vat.spec.ts` (ใหม่ · mock client) · `apps/api/src/modules/contracts/contract-payment.service.early-payoff-exec.spec.ts` (เพิ่ม it)

**Interfaces:**
- Consumes: `earlyPayoffReceiptTax` (Task 1) · `EarlyPayoffJe` (`receivableCleared · lateFees · discount · parkRelief · advanceRelief · creditRelief · advanceVatReversal · roundingGain · excessIncome · cashReceived`) · quote (`notDueMonths · dueMonths`).
- Produces: metadata JP4: `receiptTax` (ReceiptTaxBreakdown) · `notDueMonths` · `dueMonths` · `firstUnpaidInstallmentNo` · `lastUnpaidInstallmentNo` · deferred warnings `early-payoff-receipt-schedule-vs-ledger` (Σ total ≠ receivableCleared) · `early-payoff-receipt-tax-unavailable` (builder คืน null / assembly โยน).

- [ ] **Step 1: เทสแดง (helper)** — สัญญา 17,000/12: 12 งวดไม่มีรายการก่อน → vat 1,190.00 total 18,190.00 (งวด 12 = 99.13) · งวด 5–12 → 793.32 / 12,126.68 · งวด 7 มีใบบางส่วน 500 (priorClearings [500]) → ภาษีงวด 7 = 99.17 − HALF_UP(500×7/107)=32.71 → 66.46 · ไม่มีแถวตารางงวด → ไม่เรียก reconstruct (vat เต็ม).
- [ ] **Step 2: รัน** `npx jest src/modules/journal/early-payoff-receipt-vat.spec.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: implement helper** · **Step 4: รัน** — Expected: PASS.
- [ ] **Step 5: เทสแดง (exec spec)** — `metadata.receiptTax.amount === '11106.00'`-ish ตาม fixture (amount = quote.totalPayoff · discountAmount = 52-1106 ของ JE) · `generateReceipt.mock.calls[0][9] === 'JE-EP-0001'` · fixture ต้องมี `tx.installmentSchedule.findMany` คืน id/installmentNo (mockSchedules เดิม) และ `tx.journalEntry.findMany` [] (มีแล้ว).
- [ ] **Step 6: รัน** `npx jest src/modules/contracts/contract-payment.service.early-payoff-exec.spec.ts` — Expected: FAIL (receiptTax undefined · calls[0][9] undefined).
- [ ] **Step 7: implement ใน service** (try/catch รอบ assembly → warning + ไม่ประทับ · ห้ามล้มการปิดยอด).
- [ ] **Step 8: รัน** exec spec + 6 early-payoff specs อื่น + `shop-collect-payoff.integration.spec` (vitest DB — ต้อง source test-env.sh) — Expected: PASS · integration: JP4 metadata.receiptTax ครบ invariant.
- [ ] **Step 9: commit** `feat(payoff): stamp receiptTax on JP4 and link the EARLY_PAYOFF receipt to it`.

### Task 5: บริบท + PDF ของใบปิดยอด

**Files:**
- Modify: `apps/api/src/modules/receipts/services/receipt-query.service.ts` (`loadDocumentContext` → `payoffContext`), `apps/api/src/modules/receipts/services/receipt-pdf.service.ts`
- Test: `apps/api/src/modules/receipts/services/receipt-pdf.service.spec.ts` (describe ใหม่) · `receipt-query.service` มี spec? (ตรวจ) — อย่างน้อย unit ของ PDF ผ่าน mock getReceipt ที่มี `payoffContext`

**Interfaces:**
- Produces: `payoffContext: { unpaidInstallments: number; firstNo: number|null; lastNo: number|null; receivableCleared: string|null; dueMonths: number; notDueMonths: number; discountPct: number|null; parkRelief: string|null; advanceRelief: string|null; creditRelief: string|null; advanceVatReversal: string|null; parkReceiptNumber: string|null } | null` (EARLY_PAYOFF ที่ผูกรายการเท่านั้น · parkReceiptNumber = ใบ RESCHEDULE_FEE ล่าสุดของสัญญาที่ไม่ถูกยกเลิก เมื่อ parkRelief > 0).
- PDF (เฉพาะ EARLY_PAYOFF ที่เก็บค่า = `hasStoredReceiptTax`): แถวหลัก "ค่างวดคงเหลือ N งวด (งวดที่ a–b) — ปิดยอดสัญญา" + meta "ตามรายการบัญชี · ลูกหนี้คงเหลือ X" (+ " · งวดที่ถึงกำหนดแล้ว a–k · ยังไม่ถึงกำหนด k+1–b" เมื่อ dueMonths > 0) · แถว DEDUCTION ป้ายตามองค์ประกอบ (เงินพักค่าปรับดิว / เงินรับล่วงหน้าที่ชำระไว้ก่อน / เครดิตคงเหลือ) + meta "ออกใบกำกับภาษีแล้วตอนรับเงิน (ใบ RC-…) — ภาษี X หักออกจากใบนี้ (ข้อ 13–14)" · แถว "ส่วนลดดอกเบี้ยปิดยอด (ไม่ลดฐานภาษี)" + meta 18.1 (`ส่วนลด P% ของดอกเบี้ยเฉพาะงวดที่ยังไม่ถึงกำหนด N งวด (งวด x–y) · งวดที่ถึงกำหนดแล้ว M งวดชำระเต็มจำนวน` / `ส่วนลด P% ของดอกเบี้ยงวดที่ยังไม่ถึงกำหนด · ฐานภาษีคงเดิม`) ช่องก่อนภาษี/ภาษี "–" ยอด −X · สรุป: เพิ่มบรรทัด "ส่วนลดดอกเบี้ยปิดยอด −X" ก่อนยอดรวม · กล่อง `.cn-notice` ใต้คู่สัญญา: ภาษีของใบ (+ ประโยคหักภาษีเงินพักเมื่อมี) · "สัญญาเช่าซื้อสิ้นสุด กรรมสิทธิ์เครื่องโอนให้ลูกค้าเมื่อชำระครบตามใบนี้ · ยกเลิกใบนี้ไม่ได้ (ปิดยอดแล้ว)".

- [ ] **Step 1: เทสแดง (PDF)** — stored 16.1 (+payoffContext 12 งวด 1–12 · dueMonths 0 · pct 50) → HTML มี "ค่างวดคงเหลือ 12 งวด (งวดที่ 1–12)" · "ส่วนลดดอกเบี้ยปิดยอด (ไม่ลดฐานภาษี)" · "−3,000.02" · "17,000.00" · "1,190.00" · "15,189.98" · "ฐานภาษีคงเดิม" · "ยกเลิกใบนี้ไม่ได้" · ไม่มี "ส่วนลด 50% ของดอกเบี้ยเฉพาะงวด" · stored 16.2 → "หักเงินพักค่าปรับดิวที่จ่ายไว้ล่วงหน้า" · "−1,044.00" · "−68.30" · "16,024.30" · "1,121.70" · "RC-20260915-0012" · stored กระดาน 3 (dueMonths 4 · notDue 4 · งวด 5–12) → "เฉพาะงวดที่ยังไม่ถึงกำหนด 4 งวด (งวด 9–12)" · "งวดที่ถึงกำหนดแล้ว 4 งวดชำระเต็มจำนวน" · legacy payoff เทสเดิมยังผ่าน.
- [ ] **Step 2: รัน** `npx jest src/modules/receipts/services/receipt-pdf.service.spec.ts` — Expected: FAIL.
- [ ] **Step 3: implement** query context + PDF. ตรวจ `npm run docs:check` script ว่ามีฉาก EARLY_PAYOFF ไหม (grep ใน tools/docs-qa) — ถ้ามี ให้ฉากนั้นได้ค่าที่เก็บ (ผ่าน flow จริง) ไม่ต้องแก้.
- [ ] **Step 4: รัน** PDF spec + query spec (ถ้ามี) + `tsc --noEmit` — Expected: PASS.
- [ ] **Step 5: commit** `feat(receipts): early payoff receipt prints by-ledger rows, discount row and 18.1 note`.

### Task 6: integration (vitest DB) ปิดยอด → ใบเสร็จเก็บค่า

**Files:**
- Create: `apps/api/src/modules/contracts/early-payoff-receipt.integration.spec.ts` (แบบ `shop-collect-payoff.integration.spec.ts` · seedStandard17k12m · ใช้ `ReceiptIssuanceService` จริง: `new ReceiptIssuanceService(prisma, undefined, new ReceiptNumberService(prisma))` ห่อเป็น `{ generateReceipt }` ให้ ContractPaymentService)

- [ ] **Step 1: เทสแดง** — ปิดยอด 12 งวดไม่มีจ่าย (FINANCE-DIRECT) → แถว `receipts` type EARLY_PAYOFF: `sourceJournalEntryId` = JP4 · `amountBeforeVat 17000.00 · vatAmount 1190.00 · discountAmount = 52-1106 ของ JE · amount = totalPayoff` · invariant · JP4 `metadata.receiptTax.amount === amount` · `metadata.dueMonths === 0`.
- [ ] **Step 2: รัน** (`source ~/Documents/BESTCHOICE-docs/pr4-advance-vat/test-env.sh && npx vitest run --root <apps/api> --no-file-parallelism <file>`) — Expected: FAIL ก่อน Task 4/3? (Task นี้ทำหลัง 3–5 ⇒ คาด PASS ทันที — ถ้าผ่านทันที ให้ยืนยันโดย assert ค่าที่ผิดก่อน 1 ครั้ง (เช่น vatAmount 0) ดูว่าแดงจริง แล้วแก้กลับ).
- [ ] **Step 3: commit** `test(contracts): early payoff receipt stores by-ledger tax columns (integration)`.

### Task 7: เอกสาร + เวอร์ชัน + PR

**Files:**
- Modify: `.claude/rules/accounting.md` (JP4 แถว "ใบเสร็จ" · หัวข้อ PR3 bullet ใบปิดยอด · PR4ข "ไม่เปลี่ยน" · ตารางใหม่ "ใบปิดยอด (16.1/16.2 · 2026-10-18)") · `apps/web/package.json` version 26.10.40
- [ ] **Step 1:** เขียนเอกสาร (ที่มาของค่า · ข้อเปิด: creditRelief ไม่มีภาษี · excess ไม่เก็บค่า · ไม่มี backfill)
- [ ] **Step 2:** `npx eslint --no-fix` ไฟล์ที่แตะ · `tsc --noEmit` api · jest ชุด journal/receipts/contracts · vitest DB contracts
- [ ] **Step 3:** commit `docs(accounting): early payoff receipt by ledger (16.1/16.2) + web 26.10.40` → ผู้ตรวจอิสระ (Agent fable) → fix pass → push → PR.
