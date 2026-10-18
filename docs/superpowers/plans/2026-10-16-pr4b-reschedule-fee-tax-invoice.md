# PR4ข — ใบเสร็จ 6a เป็นใบกำกับภาษี + ใบรับเงินส่วนเกินลิงก์ชำระ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ใบเสร็จค่าธรรมเนียมปรับดิว 6a (`RESCHEDULE_FEE`) พิมพ์เป็น "ใบเสร็จรับเงิน / ใบกำกับภาษี" ตามบัญชี (ภาษีรับรู้ ณ วันรับตั้งแต่ PR4) และเงินส่วนเกินจากลิงก์ชำระ Pay Solutions ได้ใบกำกับภาษีใบแยกของตัวเอง — ทั้งสองใบเก็บค่าที่พิมพ์ ณ ตอนออกใบ (รูป PR3) และอ่านค่าที่เก็บตอนพิมพ์.

**Architecture:** ขยายกลไก PR3 (ค่าที่เก็บบนแถว `Receipt` 7 ช่อง → `storedReceiptDocumentMoney`) ให้ครอบใบปรับดิว 6a และใบชนิดใหม่ `ADVANCE_SURPLUS` — ตัวเลขทุกสตางค์มาจาก metadata ของรายการบัญชีต้นทาง (`rescheduleFee`/`lateFeeCollected`/`advanceVatPark` ของ `reschedule-collect` · `surplus`/`advanceVatPark` ของ `paysolutions-surplus-advance`) ผ่าน helper บริสุทธิ์ใน `journal/receipt-tax-breakdown.ts`. ใบเก่า (ไม่มีค่าที่เก็บ) พิมพ์ตรรกะเดิมทุกตัวอักษร (forward-only — เจ้าของเคาะ ข). ยกเลิกใบ 6a ยังปฏิเสธ (ค) และใบส่วนเกินปฏิเสธเช่นกัน.

**Tech Stack:** NestJS + Prisma (receiptType เป็น String — ไม่มี migration) · jest unit specs (receipts/journal/paysolutions/payments) · vitest DB integration (`reschedule-collect-lifecycle.integration.spec.ts`) · React web labels.

**Spec:** mockup ที่เจ้าของเคาะ `https://claude.ai/artifact/FWZ6vrgaixKmP1buUdrUry` (กระดาน 2 ใบ 6a · กระดาน 3 ใบส่วนเกิน) + คำตอบฝ่ายบัญชี 16/10/2569 ข้อ 14 / 23.1 / 23.2 + เจ้าของ "ok ทั้งหมด" (ก ชื่อแถว · ข forward-only · ค ยกเลิก 6a ยังปฏิเสธ).

## Global Constraints

- ไม่มีสูตรภาษีที่สอง: VAT ของเงินรับล่วงหน้า = `advanceVatOf` (HALF_UP × 7/107) — ค่าบนใบ = ค่า stamp `advanceVatPark` ของรายการบัญชี ไม่คำนวณใหม่.
- Invariant ของค่าที่เก็บ: `amountBeforeVat + vatAmount + roundingAmount + lateFeeAmount = amount` (parseReceiptTax บังคับอยู่แล้ว).
- ใบที่ไม่มีค่าที่เก็บ (ออกก่อน deploy) ต้องพิมพ์เหมือนเดิมทุกตัวอักษร — ห้ามแก้ `legacyReceiptDocumentMoney`.
- ไม่แตะใบรับชำระค่างวด (INSTALLMENT) · ไม่แตะรายการบัญชี (PR4 ลงถูกแล้ว) · ไม่มี backfill.
- ห้ามรัน `apps/api run lint` (มี --fix) — ใช้ `npx eslint --no-fix`. absolute path ทุกคำสั่ง.
- เวอร์ชันเว็บ 26.10.33 (ต่อจาก #1702 = 26.10.32). merge origin/main ก่อนเปิด PR.

## Review Focus

1. ใบปรับดิว variant `6b` ที่ออกใบ RESCHEDULE_FEE (ไม่ bundled) — ไม่มี `advanceVatPark` ⇒ ต้องไม่เก็บค่า (พิมพ์แบบเดิม ไม่ใช่ใบกำกับภาษี) — Task 1/2 เทส "6b → null".
2. ยอดใบไม่เท่า `rescheduleFee + lateFeeCollected` (ข้อมูลเพี้ยน) ⇒ ไม่เก็บค่า + log เตือน ไม่ล้ม — Task 1 เทส.
3. ส่วนเกินลิงก์ชำระที่ภาษีปัดเป็น 0 (surplus < 0.08) ⇒ เก็บค่าได้ (vat 0.00) และใบพิมพ์ "ใบเสร็จรับเงิน" (ไม่มีคำว่าใบกำกับภาษี เพราะ vatPart = 0) — Task 1 เทส.
4. webhook ส่งซ้ำ / ใบส่วนเกินออกไม่สำเร็จ — ไม่ทำให้ webhook ล้ม · `generateReceipt` คืนใบเดิมเมื่อรายการมีใบแล้ว (unique `receipts_source_journal_entry_key`) — Task 8 เทส.
5. snapshot ยอดคงเหลือของใบเก่า (ไม่มี `documentUnappliedFunds`) ต้องอ่านได้เหมือนเดิม (ช่องใหม่ = null) — Task 4 เทส.

---

### Task 1: helper บริสุทธิ์ — ค่าที่ใบ 6a และใบส่วนเกินต้องพิมพ์

**Files:**
- Modify: `apps/api/src/modules/journal/receipt-tax-breakdown.ts`
- Test: `apps/api/src/modules/journal/receipt-tax-breakdown.spec.ts`

**Interfaces:**
- Produces: `rescheduleFeeReceiptTax(meta: Record<string, unknown>, amount: Decimal): ReceiptTaxBreakdown | null` — null เมื่อ `meta.variant !== '6a'` · `rescheduleFee` ไม่ใช่เงิน · ไม่มี `advanceVatPark` · หรือ `amount ≠ rescheduleFee + lateFeeCollected`
- Produces: `advanceSurplusReceiptTax(meta, amount): ReceiptTaxBreakdown | null` — null เมื่อ `surplus` ไม่ใช่เงิน · `amount ≠ surplus` · `advanceVatPark` ไม่ใช่เงิน (ไม่มี = 0.00 เฉพาะเมื่อ `advanceVatOf(surplus)` = 0)

- [ ] **Step 1: เขียนเทสแดง** ใน spec (describe ใหม่ `PR4ข — ใบปรับดิว 6a / ใบส่วนเกินลิงก์ชำระ`):
  - 6a 1,516.00 + ค่าปรับ 50 → `{amount '1566.00', amountBeforeVat '1416.82', vatAmount '99.18', roundingAmount '0.00', lateFeeAmount '50.00', lateFeeWaivedAmount '0.00', advanceAmount '1516.00', advanceVatAmount '99.18'}`
  - 6a ไม่มีค่าปรับ 1,044.00 (vat 68.30) → amountBeforeVat '975.70'
  - variant 6b → null · ไม่มี advanceVatPark → null · amount 1,500 ≠ 1,566 → null
  - surplus 500 (vat 32.71) → `{amount '500.00', amountBeforeVat '467.29', vatAmount '32.71', advanceAmount '500.00', advanceVatAmount '32.71', อื่น ๆ '0.00'}` · surplus 0.05 ไม่มี stamp → vat '0.00' ใช้ได้ · amount ≠ surplus → null
- [ ] **Step 2: รัน** `cd /abs/apps/api && npm test -- --runInBand src/modules/journal/receipt-tax-breakdown.spec.ts` — Expected: FAIL `rescheduleFeeReceiptTax is not a function`
- [ ] **Step 3: implement** สองฟังก์ชัน (ใช้ `Decimal`, `money()`, `RECEIPT_TAX_VERSION`; อ่าน meta ผ่าน `moneyOf(v): Decimal | null` ที่รับ string/number รูปเงิน)
- [ ] **Step 4: รันซ้ำ** — Expected: PASS ทั้งไฟล์
- [ ] **Step 5: commit** `feat(receipts): helper ค่าที่ใบปรับดิว 6a / ใบส่วนเกินลิงก์ชำระต้องพิมพ์ (PR4ข)`

### Task 2: เก็บค่า ณ ตอนออกใบ — RESCHEDULE_FEE (6a) และชนิดใหม่ ADVANCE_SURPLUS

**Files:**
- Modify: `apps/api/src/modules/receipts/receipt-types.constants.ts` (+ `ADVANCE_SURPLUS_RECEIPT_TYPE = 'ADVANCE_SURPLUS'`, `DOCUMENT_BALANCE_RECEIPT_TYPES = [...INSTALLMENT_MONEY_RECEIPT_TYPES, 'RESCHEDULE_FEE', 'ADVANCE_SURPLUS']`)
- Modify: `apps/api/src/modules/receipts/services/receipt-issuance.service.ts`
- Test: `apps/api/src/modules/receipts/services/receipt-issuance.tax-breakdown.spec.ts`

**Interfaces:**
- Consumes: Task 1 helpers
- Produces: `generateReceipt(..., 'ADVANCE_SURPLUS', amount, null, 'ONLINE_GATEWAY', ref, userId, paidAt, surplusEntryNo)` ยอมรับรายการ tag `paysolutions-surplus-advance` ที่ไม่มี `paymentId`

- [ ] **Step 1: เทสแดง** 4 เคส: (ก) RESCHEDULE_FEE + รายการ tag `reschedule-collect` metadata 6a ครบ → `tx.receipt.create` ได้ 7 คอลัมน์ตาม Task 1 (ข) 6b → ไม่มีคอลัมน์ (ค) ADVANCE_SURPLUS + tag `paysolutions-surplus-advance` ไม่มี paymentId + paymentId null → ผ่านและได้คอลัมน์ 467.29/32.71 (ง) ADVANCE_SURPLUS กับรายการ tag `receipt` → BadRequest 'ไม่พบรายการบัญชีรับชำระที่ตรงกับใบเสร็จ'
- [ ] **Step 2: รัน** spec — Expected: FAIL (ก) คอลัมน์ว่าง · (ค) BadRequest (paymentId mismatch)
- [ ] **Step 3: implement** — `acceptedTag` ตามชนิด · เทียบ `(meta.paymentId ?? null) !== (paymentId ?? null)` · `tax =` helper ตามชนิด (INSTALLMENT เดิม) · `remainingBalance: DOCUMENT_BALANCE_RECEIPT_TYPES.includes(type) ? null : …` · log warn เมื่อ helper คืน null
- [ ] **Step 4: รัน** spec + `receipt-issuance.paid-date.spec.ts` + `receipts.service.spec.ts` — Expected: PASS
- [ ] **Step 5: commit**

### Task 3: ตัวเลขบนเอกสารจากค่าที่เก็บ — ใบปรับดิวเป็นใบกำกับภาษี · ใบที่มีแต่เงินรับล่วงหน้า

**Files:**
- Modify: `apps/api/src/modules/receipts/services/receipt-document-money.ts` (เฉพาะ `storedReceiptDocumentMoney`)
- Test: `apps/api/src/modules/receipts/services/receipt-document-money.spec.ts`

- [ ] **Step 1: เทสแดง**: stored RESCHEDULE_FEE (คอลัมน์ Task 1 + allocations RESCHEDULE_ADVANCE งวด 12) → `vatBearing true · advanceOnly true · displayedInstallmentNo 12 · advanceRows[0] {kind 'RESCHEDULE', installmentNo 12, amount 1516, vat 99.18, beforeVat 1416.82} · feePortion 50 · exclVat 1416.82 · vatPart 99.18 · installmentPortion 0` · stored ADVANCE_SURPLUS (installmentNo null, ไม่มี allocations) → `advanceRows[0].kind 'GENERIC'` 500/32.71/467.29 · advanceOnly true · displayedInstallmentNo null · legacy RESCHEDULE_FEE (ไม่มีค่าที่เก็บ) → `vatBearing false` เหมือนเดิม
- [ ] **Step 2: รัน** — Expected: FAIL vatBearing false / advanceOnly false
- [ ] **Step 3: implement** `vatBearing: receiptType !== 'DOWN_PAYMENT'` · `advanceOnly = installmentPortion.isZero() && advance.gt(0)` · `displayedInstallmentNo = advanceOnly ? (rescheduleTarget ?? view.installmentNo) : view.installmentNo`
- [ ] **Step 4: รัน** spec ทั้งไฟล์ — Expected: PASS (เคสเดิม 6b/หักเงินรับล่วงหน้า ไม่ขยับ)
- [ ] **Step 5: commit**

### Task 4: ยอดคงเหลือ ณ วันออกใบ — รู้จักรายการส่วนเกินลิงก์ชำระ + เงินรับล่วงหน้าค้าง

**Files:**
- Modify: `apps/api/src/modules/receipts/services/receipt-document-balance.ts`
- Test: `apps/api/src/modules/receipts/services/receipt-document-balance.spec.ts`

**Interfaces:**
- Produces: `ReceiptDocumentBalance.documentUnappliedFunds: string | null` (21-1103 + 21-5101 สุทธิ ณ วันออกใบ) — persist ใน snapshot v1 (ช่องเพิ่ม · snapshot เก่าอ่านเป็น null)

- [ ] **Step 1: เทสแดง**: (ก) contract มีรายการ `paysolutions-surplus-advance` Cr 21-1103 500 ก่อนใบค่างวด → ยอดคงเหลือ = หนี้ − 500 (เดิมคืน unknown เพราะ tag ไม่รู้จัก) + `documentUnappliedFunds '500.00'` (ข) ใบ ADVANCE_SURPLUS (paymentId null · sourceJournalEntryId = รายการส่วนเกิน) → คำนวณได้ (ค) snapshot เก่าไม่มีช่อง → `documentUnappliedFunds null` · snapshot ที่มีช่อง → อ่านได้ · ช่องรูปผิด → unknown
- [ ] **Step 2: รัน** — Expected: FAIL
- [ ] **Step 3: implement** — `sourceTypes` ใช้ `DOCUMENT_BALANCE_RECEIPT_TYPES` · `collectionTags` + `paysolutions-surplus-advance` · `cash(meta)` คืน `surplus` สำหรับ tag นั้น · eligible: ชนิด ADVANCE_SURPLUS จับคู่ด้วย `sourceJournalEntryId === entry.id` + tag · `(meta.paymentId ?? null) === (row.paymentId ?? null)` · คืน `documentUnappliedFunds: unapplied.toFixed(2)` · `readSnapshot` อ่านช่องใหม่แบบ optional (string รูปเงิน → ค่า · ไม่มี → null · รูปผิด → unknown)
- [ ] **Step 4: รัน** spec — Expected: PASS ทั้งไฟล์
- [ ] **Step 5: commit**

### Task 5: บริบทของใบสำหรับ PDF — เลื่อนนัด (6a) · ลิงก์ชำระ (ส่วนเกิน)

**Files:**
- Modify: `apps/api/src/modules/receipts/services/receipt-query.service.ts` (`getReceipt`)
- Test: `apps/api/src/modules/receipts/services/receipt-query.service.pr4b-context.spec.ts` (ใหม่ · mock prisma แบบ `receipt-query.service.cn-advance-target.spec.ts`)

**Interfaces:**
- Produces บน view ของ `getReceipt`: `rescheduleContext: { installmentNo, daysToShift, newDueDate: string | null } | null` (RESCHEDULE_FEE จาก metadata ของ `sourceJournalEntryId`) · `surplusContext: { refno, paidAmount, appliedAmount, installmentNos: number[], nextInstallmentNo: number | null, siblingReceiptNumbers: string[] } | null` (ADVANCE_SURPLUS — sibling = ใบ INSTALLMENT ของสัญญาเดียวกัน transactionRef เดียวกัน ไม่ถูกยกเลิก)

- [ ] **Step 1: เทสแดง** 3 เคส (6a มี newDueDate · 6a รายการเก่าไม่มี newDueDate → null · ส่วนเกินมี sibling 1 ใบ)
- [ ] **Step 2: รัน** — Expected: FAIL (ฟิลด์ undefined)
- [ ] **Step 3: implement** — โหลด `journalEntry.findUnique({ where: { id: receipt.sourceJournalEntryId }, select: { metadata } })` เฉพาะสองชนิด · sibling ผ่าน `receipt.findMany`
- [ ] **Step 4: รัน** — PASS · commit

### Task 6: PDF — หัวเอกสาร แถว กล่องเตือน สถานะ (ตาม mockup กระดาน 2 และ 3)

**Files:**
- Modify: `apps/api/src/modules/receipts/services/receipt-pdf.service.ts`
- Test: `apps/api/src/modules/receipts/services/receipt-pdf.service.spec.ts`

- [ ] **Step 1: เทสแดง** (ใช้ harness capturedHtml เดิม):
  - ใบ 6a ที่เก็บค่า (RESCHEDULE_FEE + 7 คอลัมน์ + allocations งวด 12 + rescheduleContext) → HTML มี `ใบเสร็จรับเงิน / ใบกำกับภาษี` · แถว `เงินรับล่วงหน้างวดที่ 12/12 — ปรับดิว` + meta `ค่าธรรมเนียมเลื่อนนัดชำระ (ปรับดิว) · พักไว้หักค่างวดสุดท้าย` · `1,416.82` · `99.18` · แถวค่าปรับ 50.00 ยกเว้น · กล่อง `เงินรับล่วงหน้า 1,516.00 บาท` + `โดยไม่คิดภาษีซ้ำ` · สรุป `มูลค่าสินค้า/บริการก่อนภาษี` 1,416.82 · `ค่าปรับ (ยกเว้นภาษี)` 50.00 · รวม 1,566.00 · บรรทัด `เลื่อนนัดชำระ` `งวดที่ 4 เลื่อน 30 วัน (ครบกำหนดใหม่ 12/11/2569)` · สถานะ `เงินรับล่วงหน้าค้าง` `1,516.00 บาท (พักหักงวดที่ 12)`
  - ใบ 6a เก่า (ไม่มีค่า) → ไม่มี `ใบกำกับภาษี` · ไม่มีกล่องเตือน (byte-identical กับเทสเดิม 1144)
  - ใบ ADVANCE_SURPLUS → หัวใบกำกับภาษี · แถว `เงินรับล่วงหน้าในสัญญา` + meta `ชำระเกินผ่านลิงก์ชำระ (Pay Solutions) · หักเข้างวดถัดไปอัตโนมัติ` · 467.29 / 32.71 / 500.00 · บรรทัด `ชำระผ่านลิงก์` `งวดที่ 5 (ใบ RT-202610-00033) · ยอดโอน 2,015.83 · เข้างวด 1,515.83 · ส่วนเกิน 500.00` · กล่อง `เงินส่วนเกิน 500.00 บาท` + `(งวดที่ 6)` + `ไม่ต้องติดต่อร้านเพื่อขอคืน` · ผู้ออก `ระบบ (ลิงก์ชำระ)` · สถานะ `เงินรับล่วงหน้าค้าง` `500.00 บาท (หักงวดถัดไป)`
- [ ] **Step 2: รัน** — Expected: FAIL
- [ ] **Step 3: implement** — `advanceRowHtml(row, receiptType)` meta ตามชนิด · บรรทัดรายละเอียดสัญญาจาก context · `.adv-notice` (สไตล์เดียวกับ `.cn-notice`) · `itemLabels.ADVANCE_SURPLUS = 'เงินรับล่วงหน้าในสัญญา — ส่วนเกินจากลิงก์ชำระ'` (fallback ใบที่ไม่มีค่า) · สถานะ: `documentUnappliedFunds > 0` + ชนิดสองชนิดนี้ → แถว `เงินรับล่วงหน้าค้าง` · ผู้ออก ADVANCE_SURPLUS = `ระบบ (ลิงก์ชำระ)` · `documentBalanceApplies` ใช้ `DOCUMENT_BALANCE_RECEIPT_TYPES`
  - กล่อง 6a: `เงินรับล่วงหน้า {adv} บาท พักไว้หักค่างวดสุดท้าย (งวดที่ {N}) — ภาษีมูลค่าเพิ่มรับรู้ ณ วันรับเงินนี้แล้ว ใบรับชำระงวดสุดท้ายจะแสดงแถว "หักเงินรับล่วงหน้า" โดยไม่คิดภาษีซ้ำ` (ตัดวลี "ยอดค่างวดคงเหลือไม่เปลี่ยน" ของ mockup — ค่างวดคงเหลือ ณ วันออกใบหักเงินรับล่วงหน้าแล้วตามกติกา PR3; บันทึกไว้ใน PR body)
  - กล่องส่วนเกิน: `เงินส่วนเกิน {X} บาท จากการชำระผ่านลิงก์ เก็บไว้เป็นเงินรับล่วงหน้าของสัญญา และจะหักเข้างวดถัดไป{ (งวดที่ N)} ให้อัตโนมัติ ใบรับชำระงวดนั้นจะแสดงแถว "หักเงินรับล่วงหน้า" โดยไม่คิดภาษีซ้ำ · ไม่ต้องติดต่อร้านเพื่อขอคืน`
- [ ] **Step 4: รัน** spec ทั้งไฟล์ — PASS · commit

### Task 7: ปรับดิว — stamp วันครบกำหนดใหม่ลงรายการบัญชี

**Files:**
- Modify: `apps/api/src/modules/payments/services/reschedule-collect.service.ts` (metadata ของ JE `reschedule-collect` + `newDueDate: addBkkDays(payment.dueDate, input.daysToShift).toISOString()`)
- Test: `apps/api/src/modules/payments/services/reschedule-collect.service.spec.ts`

- [ ] **Step 1: เทสแดง** — `createAndPost` metadata มี `newDueDate` (ISO ของ dueDate + daysToShift)
- [ ] **Step 2: รัน** — FAIL · **Step 3** implement · **Step 4** รัน spec ทั้งไฟล์ PASS · commit

### Task 8: webhook — ใบรับเงินส่วนเกินหลัง commit

**Files:**
- Modify: `apps/api/src/modules/paysolutions/services/paysolutions-webhook.service.ts`
- Test: `apps/api/src/modules/paysolutions/paysolutions.callback-money.spec.ts`

- [ ] **Step 1: เทสแดง** (เคส overpay 2500/[1000,1000]): metadata ของ surplus JE มี `paidAmount '2500'`, `appliedAmount '2000'`, `installmentNos [1,2]`, `nextInstallmentNo null` · หลัง commit `receipts.generateReceipt` ถูกเรียกครั้งที่ 3 ด้วย `(contractId, null, 'ADVANCE_SURPLUS', 500, null, 'ONLINE_GATEWAY', ref, systemUserId, paidAt, 'JE-S-001')` · ถ้าเรียกแล้ว reject → webhook ยัง resolve + `reportReceiptIssueFailure` path `paysolutions-webhook-surplus`
- [ ] **Step 2: รัน** — FAIL · **Step 3** implement (`surplusEntryNo` ใน tx result · `nextInstallmentNo` = งวดแรกที่ยังไม่ PAID หลังจัดสรร) · **Step 4** PASS · commit

### Task 9: ยกเลิก · LINE · เว็บ

**Files:**
- Modify: `apps/api/src/modules/receipts/services/receipt-void.service.ts` (ปฏิเสธ ADVANCE_SURPLUS: `ใบเสร็จเงินรับล่วงหน้าจากลิงก์ชำระยังไม่รองรับการยกเลิก — เงินนี้จะถูกหักเข้างวดถัดไปอัตโนมัติ`)
- Modify: `apps/api/src/modules/line-oa/flex-messages/receipt.flex.ts` (`RESCHEDULE_FEE: 'ใบเสร็จค่าธรรมเนียมปรับดิว'`, `ADVANCE_SURPLUS: 'ใบเสร็จเงินรับล่วงหน้า'`)
- Modify web: `components/payment/MobileReceipt.tsx` (label) · `paymentHistoryDerivations.ts` (`ADVANCE_SURPLUS → {label 'เงินรับล่วงหน้า', tone 'info'}`) · `PaymentHistorySheet.tsx` UNVOIDABLE · `computeReceiptFeeDisplay.ts` EXCLUDED
- Tests: `receipts.service.spec.ts` (refuse case) · web `paymentHistoryDerivations.test.ts` (label)

- [ ] เทสแดง → implement → PASS → commit

### Task 10: integration · เอกสาร · เวอร์ชัน

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/reschedule-collect-lifecycle.integration.spec.ts` (ใบ 6a ที่ออกจริงมี `amountBeforeVat/vatAmount/advanceAmount/advanceVatAmount/lateFeeAmount` ตรง JE)
- Modify: `.claude/rules/accounting.md` หัวข้อ "ใบกำกับภาษีตามบัญชี" (ใบปรับดิวเก็บค่าแล้ว · ใบ ADVANCE_SURPLUS · ที่ยังเปิดอยู่: ตัดข้อ 6a/ส่วนเกิน) + หัวข้อ PR4 แถว "เอกสาร (ต9)" + ถ6
- Modify: `apps/web/package.json` → 26.10.33

- [ ] รัน integration (vitest DB) · type-check · eslint --no-fix · commit
