# สรุปเงินหน้าร้านรายวัน + ช่องรับเงินจ่ายผสม (shop tenders)

วันที่: 2026-09-20 · สถานะ: เจ้าของเคาะแล้ว ("ok ลุย") · Mockup: https://claude.ai/artifact/CnXmYLkTPD5WC2mxVDqY6S (กระดาน 1–6)
Branch: `feat/shop-tenders-daily-cash` ต่อยอดจาก `feat/installment-freebies-pos-cleanup` (`0ef1fc390`)

## เป้าหมาย

เจ้าของต้องการป้องกันพนักงานโกง: ทุกวันต้องรู้ว่าหน้าร้านรับเงินเท่าไร แบบไหน (เงินสด/โอน/QR) ใครเป็นผู้รับ และจ่ายเงินออกเท่าไร
เพื่อเทียบ "เงินสดที่ต้องมีในลิ้นชัก" กับเงินจริง และเทียบรายการโอนกับสเตทเมนต์ทีละรายการ

## คำตัดสินของเจ้าของ (2026-09-20)

1. ขอบเขต = เงินเข้าทุกช่องทางของหน้าร้าน + เงินออกจากหน้าร้าน (ไม่รวมค่างวดที่จ่ายให้ FINANCE)
2. ทำรายงานก่อน · "นับเงินปิดวัน" เป็นรอบถัดไป (ไม่อยู่ในสเปกนี้)
3. สิทธิ์ดู: OWNER / FINANCE_MANAGER / ACCOUNTANT ทุกสาขา · BRANCH_MANAGER สาขาตัวเอง · SALES เฉพาะรายการที่ตัวเองรับ/จ่าย
4. เลือกโอนหรือ QR = บังคับกรอกเลขอ้างอิง (ยังไม่ทำแนบรูปสลิป)
5. ลูกค้าจ่ายผสมในบิลเดียว "มีบ่อย ต้องรองรับ"
6. กติกาที่เสนอและเจ้าของรับ: สูงสุด 4 บรรทัดต่อบิล · เลขอ้างอิงอย่างน้อย 6 ตัว · เลขอ้างอิงซ้ำไม่บล็อกแต่ขึ้นป้ายแดงในรายงาน · คืนเงินตามวิธีที่รับมา

## แบบข้อมูล

ตารางใหม่ `shop_tenders` (Prisma `ShopTender`) — สมุดรายการเงินเข้า/ออกของหน้าร้าน แถวไม่ถูกแก้และไม่ถูกลบ (การคืนเงิน = แถว OUT ใหม่)

| คอลัมน์ | ความหมาย |
|---|---|
| `direction` | `IN` / `OUT` |
| `kind` | `CASH_SALE` · `EXTERNAL_FINANCE_DOWN` · `CONTRACT_DOWN` · `BOOKING_DEPOSIT` · `TRADE_IN_PAYOUT` · `SALE_VOID_REFUND` · `CONTRACT_DOWN_REFUND` · `BOOKING_DEPOSIT_REFUND` |
| `branchId` | สาขาของเอกสาร |
| `method` | `CASH` / `BANK_TRANSFER` / `QR_EWALLET` (enum `PaymentMethod` เดิม) |
| `amount` | บวกเสมอ Decimal(12,2) |
| `reference` | เลขอ้างอิง (บังคับเมื่อ IN และไม่ใช่เงินสด) |
| `actorId` | ผู้รับ/ผู้จ่าย = ผู้ใช้ที่ล็อกอินและกดทำรายการ (ไม่ใช่ `salespersonId` ที่เลือกได้) |
| `occurredAt` | เวลาที่รับ/จ่ายจริง |
| `seq`, `seqTotal` | ลำดับในบิล (จ่ายผสม 1 จาก 2) |
| `saleId` / `contractId` / `bookingId` / `tradeInId` | เอกสารต้นทาง (nullable, มี relation) |
| `reversesTenderId` | แถว OUT ที่คืนเงินของแถว IN ใด |

Index: `(branchId, occurredAt)`, `(actorId, occurredAt)`, `(reference)`, และต่อ FK เอกสาร
Migration additive เท่านั้น ไม่ backfill (prod มีสัญญา 8 · ใบขาย 3 · ใบจอง 2 เป็นข้อมูลช่วงทดสอบ) — รายงานเริ่มนับจากวันขึ้นระบบ

คอลัมน์เดิมคงไว้เพื่อไม่ให้ผู้อ่านเดิมพัง: `Sale.paymentMethod` / `Contract.downPaymentMethod` / `Booking.depositMethod` = วิธีของบรรทัดแรก (primary) ·
`Contract.downPaymentReference` = เลขอ้างอิงของบรรทัดแรกที่ไม่ใช่เงินสด (ถ้ามี)

## กติกา tender (ที่เดียว: `shop-tender.util.ts` → `normalizeTenders(input, due)`)

- 1–4 บรรทัด · `amount > 0` ทศนิยมไม่เกิน 2 · ผลรวม = ยอดที่ต้องรับพอดี (Decimal) · ยอดที่ต้องรับ = 0 ⇒ ต้องไม่มีบรรทัด
- `method` ∈ CASH / BANK_TRANSFER / QR_EWALLET
- ไม่ใช่เงินสด ⇒ `reference` trim แล้วยาว 6–128 · เงินสด ⇒ ทิ้ง reference
- ข้อความ error ภาษาไทย บอกสิ่งที่ต้องทำ ("กรอกเลขอ้างอิงจากสลิปก่อนบันทึก (อย่างน้อย 6 ตัว)")
- Backward compat: DTO รับ `tenders?`; ถ้าไม่ส่ง ระบบสร้าง 1 บรรทัดจากฟิลด์เดิม (`paymentMethod` / `downPaymentMethod`+`downPaymentReference` / `depositMethod`) แล้วผ่านกติกาเดียวกัน ⇒ โอน/QR แบบเดิมที่ไม่มีเลขอ้างอิงถูกปฏิเสธ

ยอดที่ต้องรับของแต่ละจุด
| จุด | kind | ยอดที่ต้องรับ |
|---|---|---|
| POS ขายเงินสด | `CASH_SALE` | `netAmount − เครดิตเทิร์น(base)` (= `cashDue` เดิม) |
| POS ไฟแนนซ์นอก | `EXTERNAL_FINANCE_DOWN` | `downPayment` |
| ทำสัญญา | `CONTRACT_DOWN` | `quote.cashDownPayment` |
| ใบจอง รับมัดจำ | `BOOKING_DEPOSIT` | `depositAmount` |
| ใบจอง แปลงเป็นใบขาย | `CASH_SALE` | `totalAmount − depositAmount` (จ่ายครบแล้ว = ไม่มีบรรทัด) |
| POS ผ่อนในเครือ (เส้นทางเก่า `createInstallmentSale`) | `CONTRACT_DOWN` | `cashDown` — ใช้ fallback บรรทัดเดียว |

ใบขายจากออเดอร์ออนไลน์ (`ONLINE_GATEWAY`) ไม่เขียน tender — เงินไม่ผ่านมือพนักงานหน้าร้าน

## การลงบัญชีของบิลจ่ายผสม

ไม่แตะ template รับเงินเดิม: JE เดิมลงเต็มยอดเข้าบัญชีของ primary (`resolveInflowCashAccount(branch, tenders[0].method)`) ตามเดิมทุกประการ
แล้วเพิ่ม JE "แยกยอด" 1 ใบ (template ใหม่ `ShopTenderSplitTemplate`, flow `shop-tender-split`) เมื่อมีบรรทัดอื่นที่ลงคนละบัญชีกับ primary:

    Dr บัญชีของวิธีอื่น  [ผลรวมของบรรทัดที่บัญชีต่างจาก primary]
      Cr บัญชี primary

เหตุผล: ขายสดลง JE ทีละสินค้า (`allocateCashSaleByCost`) · `TradeInCreditService.claim` เครดิตบัญชีเงินสดใบเดียว ·
deposit-applied ตอนแปลงใบจองเครดิต "บัญชีเดียวกับที่ใบขายเดบิต" · ลบร่างสัญญาอ่าน JE ดาวน์ต้องเจอ debit S11-* เท่ายอดดาวน์ 1 บรรทัดพอดี —
ทั้งหมดยังถูกต้องถ้า primary รับเต็มยอดก่อน แล้วค่อยย้ายส่วนของวิธีอื่นออก

metadata ของ JE แยกยอด
- `flow: 'shop-tender-split'`, `tenderDocType`, `tenderDocId`, `idempotencyKey: shop-tender-split:<docType>:<docId>`
- ใบขาย: ใส่ `saleId` ด้วย ⇒ `SaleVoidService` (sweep `metadata.saleId`) mirror ให้เองตอนยกเลิกใบขาย
- สัญญา: **ห้ามใส่ `contractId`** — การยกเลิกสัญญา (C-1) และยกเลิกเปลี่ยนเครื่อง sweep ตาม `metadata.contractId` และมี cash tripwire ที่ throw เมื่อเจอบรรทัดเงินสด; JE ดาวน์เองก็จงใจไม่ถูก mirror ตอนยกเลิกสัญญา ดังนั้น JE แยกยอดต้องอยู่นอก sweep เช่นกัน
- ใบจอง: ไม่ใส่ key ที่ sweep ใดใช้

## การคืนเงิน (เงินออก)

| เหตุการณ์ | บัญชี | tender |
|---|---|---|
| ยกเลิกใบขาย | sweep `saleId` mirror ทั้ง JE ขายและ JE แยกยอด (ของเดิม ได้ฟรี) | OUT `SALE_VOID_REFUND` mirror แถว IN ของใบขาย · actor = ผู้กดยกเลิก |
| ลบร่างสัญญา (คืนดาวน์) | reversal เดิมคืนเต็มยอดเข้า primary + mirror JE แยกยอดด้วย `ExchangeCancelReversalTemplate.reverse({ jeIds })` | OUT `CONTRACT_DOWN_REFUND` |
| ยกเลิกใบจองที่รับมัดจำแล้ว (มีการคืนเงิน) | refund เดิม re-resolve จาก `depositMethod` (= primary) + mirror JE แยกยอด | OUT `BOOKING_DEPOSIT_REFUND` |
| จ่ายรับซื้อมือสอง (`accept` flow BUYBACK, ราคา > 0) | ของเดิม | OUT `TRADE_IN_PAYOUT` · method `TRANSFER`→`BANK_TRANSFER` · ไม่บังคับ reference · actor = ผู้กดยอมรับราคา |

ยึดมัดจำ (ใบจองหมดอายุ) ไม่มีเงินเคลื่อน ⇒ ไม่มี tender
เอกสารเก่าที่ไม่มีแถว IN ⇒ ไม่เขียนแถว OUT (รายงานเริ่มจากวันขึ้นระบบ)

## API

- `POST /sales` `POST /contracts` `POST /bookings/:id/pay-deposit` `POST /bookings/:id/convert`: รับ `tenders?: { method, amount, reference? }[]`
- `GET /shop-tenders/daily-summary?date=YYYY-MM-DD&branchId=` — `@Roles(OWNER, FINANCE_MANAGER, ACCOUNTANT, BRANCH_MANAGER, SALES)`
  - BRANCH_MANAGER: บังคับ `branchId` = สาขาตัวเอง (ไม่มีสาขา = 403) · SALES: บังคับ `actorId = ตัวเอง`
  - วัน = เขตเวลา Asia/Bangkok
  - คืน: `totals` (รับสด/โอน/QR · จ่ายสด/โอน · `expectedCashInDrawer = รับสด − จ่ายสดออก`) · `byStaff` · `byKind` · `rows` (เวลา ประเภท เอกสาร ลูกค้า วิธี เลขอ้างอิง ผู้รับ/ผู้จ่าย ยอด `seq/seqTotal` `duplicateReference`) · `duplicateReferences`
  - เลขอ้างอิงซ้ำ = แถว IN ที่ไม่ใช่เงินสด เลขเดียวกัน (trim, ไม่สนตัวพิมพ์) คนละเอกสาร ไม่จำกัดวัน
- รายการขาย/รายละเอียดใบขายแนบ `tenders` เพื่อแสดง "เงินสด + โอน"

## หน้าเว็บ

- `components/tender/TenderInput.tsx` — ช่องรับเงินกลางตามกระดาน 4/6: บรรทัดแรกใส่ยอดเต็มให้เอง · "+ เพิ่มวิธีรับเงิน" ใส่ยอดที่เหลือให้ · ช่องเลขอ้างอิงขึ้นเมื่อโอน/QR · แถบสรุป "รับครบแล้ว / ยังขาด / เกิน" · ตัวช่วยเงินทอนเมื่อมีเงินสดบรรทัดเดียว · helper `tendersReady(rows, due)`
- ใช้ 5 จุด: POS ขายสด · POS ไฟแนนซ์นอก · ทำสัญญา (ขั้นรับเงินดาวน์) · ใบจอง รับมัดจำ · ใบจอง รับส่วนที่เหลือ — POS ได้ตัวเลือก QR / e-Wallet เพิ่ม
- หน้าใหม่ "สรุปเงินรายวัน" ในกลุ่มเมนู "ขาย" ใต้ "รายการขาย" ตามกระดาน 1–3 และ 5 (มุมเจ้าของ/ผจก. · มุมพนักงานขาย · มือถือ)
- รายการขาย: คอลัมน์/รายละเอียดวิธีรับแสดงทุกวิธีของบิล

## การทดสอบ

- unit: `normalizeTenders` (ผลรวม, เลขอ้างอิง, 4 บรรทัด, ยอด 0) · `ShopTenderSplitTemplate` (ขา Dr/Cr, idempotent, ไม่มี `contractId`) · scoping ของ daily-summary ต่อ role · ตรวจเลขอ้างอิงซ้ำ
- integration (DB จริง): ขายสดจ่ายผสม → ยอดบัญชีลิ้นชัก/ธนาคารสุทธิ = ยอดแต่ละวิธี → void → สุทธิ 0 + แถว OUT · สัญญาดาวน์จ่ายผสม → ลบร่าง → สุทธิ 0 · สัญญาดาวน์จ่ายผสม → เปิดใช้ → ยกเลิกสัญญา **ไม่ชน cash tripwire** · ใบจองมัดจำจ่ายผสม → ยกเลิกคืนเงิน → สุทธิ 0 · แปลงใบจองรับส่วนที่เหลือจ่ายผสม
- แก้ fixture/seed เดิมที่ใช้โอน/QR ไม่มีเลขอ้างอิง (~18 จุด + `cli/test-pack/_drive.ts` + `BookingsPage.forms.test.tsx`)
- web: `TenderInput` · POS / ทำสัญญา / ใบจอง ส่ง `tenders` ถูก · หน้าสรุปรายวันตาม role

## ไม่อยู่ในรอบนี้

นับเงินปิดวัน + ยืนยันรับเงิน · แนบรูปสลิป · backfill เอกสารเก่า · ค่าคอมสัญญาผ่อน (รอเจ้าของเคาะกติกา) · ลบ `createInstallmentSale`
