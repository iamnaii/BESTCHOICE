# ค่าปรับดิวพักงวดสุดท้าย (Reschedule Fee → Park at Last Installment) — Design (2026-08-16)

> คำสั่งเจ้าของ 2026-08-16 (screenshot TEST-20260809-004): "กรณีปรับดิวในงวดที่ 6/12 แบบ 6b
> ยอด 857.- ต้องตั้งพักในงวดสุดท้าย (งวด 12)" — ยืนยันแนวแก้ + forward-only ผ่าน Q&A แล้ว

## ปัญหา

CPA design (A.4 spec §6.6 + golden CSV `case-6a/6b-reschedule-*.csv` + `docs/reschedule-accounting-flow.html`)
กำหนดว่า **ค่าธรรมเนียมปรับดิว = เงินจ่ายล่วงหน้าของงวดสุดท้าย** — พักใน 21-1103
("เงินรับล่วงหน้างวด 12 (พักรอ)") จนงวดสุดท้ายถึงกำหนด แล้วค่อยล้าง (ลูกค้าจ่ายงวดสุดท้าย
เฉพาะส่วนที่เหลือ)

Rework collect-first (2026-07-02..09) เปลี่ยนเป็นถังรวม `Contract.advanceBalance` ซึ่ง 2A
accrual cron หัก **FIFO เข้างวดถัดไป** (`installment-accrual-2a.template.ts:202-284`) —
การเปลี่ยนปลายทางนี้มาจาก code review C1 (`InstallmentSchedule.amountDue` write-only)
**ไม่ใช่คำตัดสินเจ้าของ** · ผล: fee 857฿ ของ 6b งวด 6/12 ถูกหักเข้างวด 7/12

## คำตัดสินเจ้าของ (2026-08-16)

1. **ค่าปรับดิว (ทั้ง 6a และ 6b) พักถึงงวดสุดท้ายเท่านั้น** — กลับไปตาม CPA CSV
2. **เครดิตจากจ่ายเกินธรรมดา (D1) หักงวดถัดไปเหมือนเดิม** (คำตัดสิน 2026-06-25 คงอยู่)
3. **Forward-only** — สัญญาที่ fee ถูกหักเข้างวดถัดไปไปแล้ว ปล่อยตามนั้น ไม่ไล่แก้ย้อนหลัง

## Design

### ถังแยก (GL ไม่เปลี่ยน — 21-1103 เหมือนเดิม, แยกเฉพาะระดับ application)

- เพิ่ม `Contract.rescheduleAdvanceBalance Decimal @default(0) @db.Decimal(12, 2)`
  (@map `reschedule_advance_balance`) — ถังพักงวดสุดท้าย แยกจาก `advanceBalance` (ถัง FIFO เดิม)

### จุดเครดิต (เงินเข้าถังพัก)

- **6a**: `RescheduleCollectService` — เปลี่ยน `advanceBalance: { increment: fee }` เป็น
  `rescheduleAdvanceBalance: { increment: fee }` · JE เดิม (Dr เงิน / Cr 21-1103) ไม่เปลี่ยน
  แต่ description เปลี่ยนเป็น `'เงินรับล่วงหน้างวดสุดท้าย — ค่าธรรมเนียมปรับดิว (6a)'` ตาม CPA CSV
- **6b**: phase 1 จองผ่าน orchestrator ปกติ (D1 overage) — route ส่วน fee เข้าถังพักแทนถังรวม
  (วิธี implement เลือกได้: flag จาก controller ผ่าน orchestrator เมื่อ case=RESCHEDULE, หรือ
  phase 2 (`bundledPaid`) ย้าย `min(fee, advanceBalance)` จากถังรวม → ถังพักใน tx เดียว)
- AuditLog แยก action ใหม่ `RESCHEDULE_ADVANCE_PARKED` (หรือคง OVERPAY_ADVANCE_RECORDED +
  source เดิม แต่ระบุ bucket ใน newValue) — ให้ implementer เลือกที่สอดคล้อง pattern เดิม

### จุดหัก (เงินออกจากถังพัก) — เฉพาะ 3 ทาง

1. **2A accrual ของงวดสุดท้าย** (`inst.installmentNo === contract.totalMonths`):
   หลังหักถังรวมตามเดิม ให้หักถังพักเพิ่ม — JE shape เดิม (Dr 21-1103 / Cr 11-2103),
   description `'หักเงินพักปรับดิวเข้างวดสุดท้าย'` · งวดอื่น**ห้ามแตะถังพัก**
2. **จ่ายงวดสุดท้ายก่อน accrual** (wizard/orchestrator): netting + auto-consume รวมถังพัก
   เฉพาะเมื่อ installmentNo = งวดสุดท้าย (ทั้ง `computeNetReceiptDue` ฝั่ง FE และ
   orchestrator NORMAL-case consume)
3. **ปิดสัญญาก่อนกำหนด**: JP4 payoff quote + JP5 repossession ต้องนับถังพักเป็นเครดิตลูกค้า
   (เหมือน advanceBalance — ตรวจทุกจุดที่อ่าน `advanceBalance` แล้วรวมถังพักด้วย ยกเว้น
   จุดหักเข้างวดถัดไป)

### แสดงผล

- `PaymentHistorySheet` การ์ดเครดิต: แสดงแยก `เครดิต (21-1103)` = ถังรวม และเพิ่มบรรทัด/การ์ด
  `พักงวดสุดท้าย` เมื่อถังพัก > 0
- `AdvanceBalanceBanner` ใน wizard + response ของ contract APIs: ส่ง `rescheduleAdvanceBalance`
  เพิ่ม (additive — ไม่แตะ field เดิม)
- ใบเสร็จ RESCHEDULE_FEE (6a) ยัง attach กับงวดที่ปรับตามเดิม (เป็นเอกสารการเก็บเงิน) —
  ไม่เปลี่ยน

### Guards / edge cases

- 6b งวดสุดท้าย: ถูก reject อยู่แล้ว (controller) — คงเดิม
- 6a งวดสุดท้าย: fee พักแล้วถูกหักที่งวดเดียวกันตอน accrual/จ่าย — ถูกต้องโดยธรรมชาติ
- ปรับดิวซ้ำหลายรอบ: ถังพักสะสม (increment) — หักครั้งเดียวที่งวดสุดท้าย, cap ที่
  installmentTotal ตอน 2A (ส่วนเกิน — ถ้ามี — เหลือในถัง ให้ JP4/ปิดสัญญาเก็บกวาด)
- Void ใบเสร็จ 6a fee: `ReceiptVoidService` ต้อง decrement ถังพัก (ตรวจ path เดิมที่
  decrement advanceBalance ตอน void แล้ว mirror)

## Out of scope

- Backfill สัญญาเก่า (forward-only ตามคำตัดสิน) — สัญญาทดสอบใช้ test-data-pack ล้าง
- `RescheduleJP6Template` (dead code) — ไม่ revive ไม่ลบใน sprint นี้ (final review triage ได้)
- คำถาม fee เป็นรายได้ vs prepayment (explainer line 331) — ยังเป็น prepayment ตามเดิม

## Tests ขั้นต่ำ

- 6a + 6b → เครดิตเข้าถังพัก (ไม่ใช่ถังรวม); 2A งวดกลางไม่แตะถังพัก; 2A งวดสุดท้ายหักถังพัก
  (JE Dr 21-1103 / Cr 11-2103 + Payment stamp); overpay ธรรมดายัง FIFO งวดถัดไป (regression);
  payoff quote นับถังพัก; void 6a fee คืนถังพัก
