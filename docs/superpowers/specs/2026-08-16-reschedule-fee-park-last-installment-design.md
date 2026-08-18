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

### เพิ่มเติมหลัง whole-branch review (2026-08-17) — SUPERSEDES ข้อสมมติด้านบน

รอบ review + fix (`.superpowers/sdd/park-review-findings.md` + `park-fix-A..D`) ปิด 3 ประเด็น
ที่ร่างเดิมสมมติผิดหรือยังไม่ได้ตัดสิน:

1. **C-3 — JP4/JP5 ต้องมี relief leg ไม่ใช่ netting เปล่าๆ (ลงจริงแล้ว).** ร่างเดิม (จุดหัก 3)
   บอกแค่ "นับถังพักเป็นเครดิตลูกค้า" ซึ่ง**ไม่พอ**: quote ลดยอดที่ลูกค้าจ่าย แต่ JE คำนวณแยก
   ⇒ `Dr เงินสด` สูงกว่าเงินที่รับจริงเท่ากับยอดพัก + เหลือเครดิตผีบน 21-1103 ของสัญญาที่ปิดแล้ว.
   สิ่งที่ลงจริง: `Dr <cash> = totalCash − parkRelief` **+** `Dr 21-1103 = parkRelief`
   (เดบิตรวมเท่าเดิม ⇒ ขา Cr ทุกบรรทัดและ golden JP4/JP5 เดิมไม่ขยับ) พร้อม
   **decrement `Contract.rescheduleAdvanceBalance` ใน `$transaction` เดียวกับ JE** + AuditLog
   `RESCHEDULE_ADVANCE_CONSUMED`. `parkRelief` = `computePayoffQuote.rescheduleAdvanceApplied`
   = **ส่วนที่ยอดปิดดูดซับจริง ไม่ใช่ยอดถังทั้งก้อน** (ถังพักลด gross profit ⇒ ลดส่วนลด 52-1106
   ไปด้วย; เคส CPA พัก 354 ที่ส่วนลด 50% ดูดซับจริงแค่ 188.58) clamp เพิ่มอีกสองชั้น —
   JP4 `≤ totalCash` (เงินสดติดลบไม่ได้), JP5 `≤` ยอด GL 21-1103 จริงของสัญญา และ `execute()`
   คืนยอดที่โพสต์จริงให้ caller ใช้ decrement. preview ใช้ค่าเดียวกัน ⇒ preview === posted.
   คำถามที่ยัง**เปิด**: ถังพักควรลดฐานส่วนลดหรือไม่ (ถ้าเจ้าของ/CPA สั่งว่าไม่ควร →
   `rescheduleAdvanceApplied` = ยอดพักเต็ม แก้จุดเดียวใน `computePayoffQuote`).

2. **I-5 — residual ไม่มีใคร "เก็บกวาด" (แก้ข้อความ bullet "ปรับดิวซ้ำหลายรอบ" ด้านบน).**
   ข้อสมมติเดิม *"ส่วนเกิน … ให้ JP4/ปิดสัญญาเก็บกวาด"* **ผิด** — สัญญาที่เดินครบงวดตามปกติ
   ไม่เคยผ่าน JP4 เลย (`checkContractCompletion` แค่พลิกสถานะ ไม่อ่านยอดถังใดๆ) และแม้ผ่าน
   JP4/JP5 ก็ยังเหลือ residual ได้จาก clamp ในข้อ 1. สิ่งที่ลงจริง: **alarm อย่างเดียว
   ไม่ตั้ง JE** — `Sentry.captureMessage` level `warning` (`tags.subsystem = 'reschedule-park'`)
   \+ Todo MEDIUM หนึ่งใบ (tag `reschedule-park`, dedup กัน void → re-pay สร้างซ้ำ) ระบุเลขสัญญา
   + ยอดคงเหลือ. **จงใจไม่โพสต์ JE คืนเงิน/รับรู้รายได้อัตโนมัติ** เพราะ "คืนเงินลูกค้า vs
   รับรู้เป็นรายได้" เป็น **CPA-gated** (คลาสเดียวกับ opening-balance gap ใน interco spec §11)
   — ถ้า CPA เคาะเมื่อไร sweep JE ควรไปอยู่ทั้งใน completion path และคู่กับ relief leg ของ JP4.

3. **I-6 — เปลี่ยนเครื่อง (device swap) ถูกบล็อกยาว รอเจ้าของตัดสิน.** `ContractExchangeService`
   ทั้ง preview warn และ finalize guard นับถังพักเป็น "เงินรับล่วงหน้า/เครดิตค้าง" แล้วโยน
   `'มีเงินรับล่วงหน้า/เครดิตค้างบนสัญญาเดิม — ใช้หรือคืนเงินก่อนเปลี่ยนเครื่อง'`. ทิศทาง (block)
   ถูกและสอดคล้อง `advanceBalance`/`creditBalance` แต่**ผลต่างกันมาก**: `advanceBalance`
   ถูก 2A accrual ล้างเองในเดือนถัดไป ส่วนถังพักอยู่ยาวตั้งแต่วันปรับดิวจนถึงงวดสุดท้าย และ
   **ไม่มี path ให้พนักงาน "ใช้หรือคืนเงิน" กลางสัญญาเลย** ⇒ สัญญาที่ปรับดิว (ซึ่งเป็นเรื่องปกติ)
   เปลี่ยนเครื่องไม่ได้ตลอดอายุที่เหลือ. **สถานะ: คงพฤติกรรมเดิมไว้ก่อน (block) โดยตั้งใจ** —
   มีคอมเมนต์กำกับไว้ที่ guard แล้ว. **เจ้าของต้องเลือก 1 ใน 3**: (ก) ยกถังพักไปสัญญาใหม่
   (ต้องมี JE โอน + ย้ายคอลัมน์ตอน finalize) · (ข) หักกลบเข้าราคารับซื้อ (buyback — กระทบ
   เลข A.3 / 11-2107) · (ค) เปิด path เคลียร์ถัง (คืนเงิน/รับรู้รายได้) ให้พนักงานรันก่อนสลับเครื่อง
   — ซึ่งเป็นคำถาม refund-vs-income ชุดเดียวกับข้อ 2.

## คำตัดสินเพิ่มเติมหลังรีวิว (2026-08-17..18) — supersede สมมติฐานเดิมบางข้อ

1. **JP4/JP5 ต้องมีขา relief จริง ไม่ใช่ netting เฉยๆ** — quote หักถังพักออกจากยอดที่ลูกค้าจ่าย
   จึงต้องลง `Dr 21-1103` เท่ายอดที่ยอดปิดดูดซับจริง + decrement คอลัมน์ใน tx เดียวกัน
   (ไม่งั้น `Dr เงินสด` > เงินรับจริง). ยอดเดบิตรวมไม่เปลี่ยน ⇒ ทุกขา Cr และ golden เดิมคงเดิมทุกไบต์.
   JP4 clamp ด้วยยอด GL 21-1103 จริงเหมือน JP5 (ไม่ใช่ clamp ด้วยคอลัมน์อย่างเดียว).
2. **เศษเงินพักตอนสัญญาจบปกติ = alarm อย่างเดียว ไม่ตั้ง JE** (ข้อ "JP4/ปิดสัญญาเก็บกวาด"
   ในหัวข้อ Guards ด้านบน **ใช้ไม่ได้** — สัญญาที่เดินครบงวดไม่เคยผ่าน JP4). ยิง Sentry +
   Todo MEDIUM ทั้งจากเส้นทาง orchestrator และจาก cron 2A ตอนงวดสุดท้ายถูกตัดด้วยเงินพัก.
   ตัว alarm **ห้ามอยู่ใน money tx** (Postgres tx เป็นพิษทันทีที่มี statement พัง ⇒ try/catch
   ไม่พอ) — รันบน root client แบบไม่ await.
3. **ยังไม่ flip สัญญาเป็น COMPLETED จาก cron 2A** — จะไปปล่อยกรรมสิทธิ์สินค้า + เปลี่ยน tier
   ไฟล์อัดเสียงด้วย ซึ่งเป็นการเปลี่ยน lifecycle ที่เกินขอบเขตรอบนี้. **ช่องว่างนี้กว้างกว่าถังพัก**:
   งวดที่ถูกปิดด้วย `advanceBalance` ธรรมดาตอน accrual ก็ไม่ flip เหมือนกัน (มีมาก่อนฟีเจอร์นี้)
   — follow-up แยก.
4. **ตัดหนี้สูญ (bad-debt write-off) + เงินพักคงเหลือ = CPA-gated ยังไม่ทำ.**
   `bad-debt-writeoff.template.ts` ไม่มีการอ้างถึง 21-1103 เลย ⇒ สัญญา `CLOSED_BAD_DEBT`
   ทิ้งทั้งคอลัมน์และยอด GL ค้างไว้. **จงใจไม่ลอกแบบ JP4/JP5 มาใส่** เพราะไม่ใช่การลอกเชิงกลไก:
   คำถามคือเงินที่ลูกค้าจ่ายล่วงหน้าไว้ **หักกลบกับหนี้ที่ถูกตัดสูญได้หรือไม่** (set-off) หรือยังเป็น
   หนี้สินที่ต้องคืนลูกค้าแม้จะตัดหนี้ไปแล้ว — เป็นคำตัดสินทางบัญชี/กฎหมาย ไม่ใช่ของโค้ด
   (คลาสเดียวกับ opening-balance gap ใน interco spec §11). ห้ามเดา JE.
5. **จ่ายด้วยเครดิตที่คลุมยอดงวดทั้งงวด (เงินสด 0 บาท) ยังบันทึกใบเสร็จไม่ได้** — server กัน
   ยอด 0 ไว้ 2 ชั้น (`@Min(0.01)` + ด่านใน orchestrator) และ **ไม่ปลดออก** เพราะคุ้มครองทุก
   เส้นทางชำระ. หน้าจอเปลี่ยนเป็นบอกตรงๆ ว่าเครดิตจะถูกตัดอัตโนมัติตอน accrual แทนการปล่อยให้
   กดแล้วเด้ง 400. (กรณีนี้มีมาก่อนถังพัก — `advanceBalance` ที่คลุมเต็มงวดก็เจอเหมือนกัน.)
6. **ถังพักควรลดฐานส่วนลดดอกเบี้ยหรือไม่ = คำถาม CPA ที่ยังเปิดอยู่** — ปัจจุบันลด (เพราะลด
   `remainingBalance` → ลด gross profit) ทำให้ยอดที่ลูกค้าประหยัดได้จริงน้อยกว่ายอดพักเต็ม
   (เคสตัวอย่าง: พัก 354 ที่ส่วนลด 50% ลดยอดจ่ายจริง 188.58). ถ้า CPA สั่งว่า "ไม่ควรลด"
   แก้จุดเดียวใน `computePayoffQuote` แล้ว `rescheduleAdvanceApplied` จะเท่ายอดพักเต็มเอง.

## Out of scope

- Backfill สัญญาเก่า (forward-only ตามคำตัดสิน) — สัญญาทดสอบใช้ test-data-pack ล้าง
  · **ยืนยัน 2026-08-17**: ไม่มีสคริปต์ backfill ในสาขานี้ และไม่ต้องมี (คอลัมน์ default 0
  ⇒ สัญญาเก่าเดินเส้นทางเดิมทุกประการ). ผลข้างเคียงที่ตั้งใจ: JE ก่อนฟีเจอร์นี้ไม่มี stamp
  `metadata.parkConsume` และ void ของมันคืนเข้าถังรวมทั้งก้อน — **ถูกต้องแล้ว ห้ามแก้ให้เดา split**
- `RescheduleJP6Template` (dead code) — ไม่ revive ไม่ลบใน sprint นี้ (final review triage ได้)
- คำถาม fee เป็นรายได้ vs prepayment (explainer line 331) — ยังเป็น prepayment ตามเดิม
- **(เพิ่ม 2026-08-17)** การจัดการ residual ของถังพัก (คืนเงินลูกค้า vs รับรู้เป็นรายได้)
  — **CPA-gated**, สาขานี้แค่ alarm + Todo ไม่ตั้ง JE (ดู Guards ข้อ 2)
- **(เพิ่ม 2026-08-17)** ทางออกของ device-swap block — **รอคำตัดสินเจ้าของ** 1 ใน 3 ทาง
  (ยกถังไปสัญญาใหม่ / หักกลบ buyback / เปิด path เคลียร์ถัง) ดู Guards ข้อ 3
- **(เพิ่ม 2026-08-17)** ถังพักควรลดฐานคำนวณส่วนลดดอกเบี้ย (52-1106) หรือไม่ — **รอเจ้าของ/CPA**
  (ดู Guards ข้อ 1); โค้ดปัจจุบันปลดเฉพาะส่วนที่ยอดปิดดูดซับจริง

## Tests ขั้นต่ำ

- 6a + 6b → เครดิตเข้าถังพัก (ไม่ใช่ถังรวม); 2A งวดกลางไม่แตะถังพัก; 2A งวดสุดท้ายหักถังพัก
  (JE Dr 21-1103 / Cr 11-2103 + Payment stamp); overpay ธรรมดายัง FIFO งวดถัดไป (regression);
  payoff quote นับถังพัก; void 6a fee คืนถังพัก
