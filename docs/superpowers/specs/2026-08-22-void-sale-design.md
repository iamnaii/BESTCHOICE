# ยกเลิกใบขาย (Void Sale) — Design

**วันที่:** 2026-08-22 · **สถานะ:** **[implemented]** 2026-08-23 บน branch `feat/void-sale`
(approved โดยเจ้าของ 2026-08-22; ข้อที่ต่างจากดีไซน์ตอนลงมือถูกแก้ในเอกสารนี้แล้ว + สรุปใน
`.claude/rules/accounting.md` หัวข้อ "ยกเลิกใบขาย (void sale)")
**ที่มา:** final review ของ Phase 5 (device-swap workbook sprint) พบว่าหลังปิดช่อง `FOUND` แล้ว
**ระบบไม่เหลือทางใดเลย**ที่จะแก้ "บันทึกขายผิด" — `SalesService` มีแค่ `findAll`/`findOne`/`create`
(controller ไม่มี `@Patch`/`@Delete`) และ `SOLD_*` อยู่ใน `SYSTEM_MANAGED_STATUSES` จึงแก้สถานะ
สินค้าด้วยมือไม่ได้ด้วย

> **หมายเหตุการกลับคำตัดสิน:** 2026-08-22 เจ้าของเคยตอบ "ยอมรับช่องว่างไว้ก่อน" แล้วเปลี่ยนเป็น
> "ทำให้ถูกเลยก็ได้" ในวันเดียวกัน ⇒ เอกสารนี้แทนที่ย่อหน้า "คำตัดสินเจ้าของ 2026-08-22" ใน
> `.claude/rules/database.md` หัวข้อ "บันทึกขายผิด" (อัปเดตแล้ว 2026-08-23 — Task 7)

---

## 0. คำตัดสินเจ้าของ (ปิดประเด็น — อย่าเสนอซ้ำ)

| # | คำถาม | คำตัดสิน |
|---|---|---|
| D1 | ครอบการขายแบบไหน | **`CASH` + `EXTERNAL_FINANCE`** — `INSTALLMENT` ใช้เส้นทางยกเลิกสัญญาเดิม (Phase 3 C-1/C-2) |
| D2 | เงื่อนไขห้ามยกเลิก | **บล็อกเมื่อเงินขยับจริง** ไม่จำกัดจำนวนวัน (หลักเดียวกับยกเลิกสัญญาที่ดูว่าจ่ายมาหรือยัง ไม่ดูวัน) |
| D3 | สิทธิ์ / การอนุมัติ | **ขั้นเดียว `OWNER` + `BRANCH_MANAGER`** ไม่มี maker-checker ซ้อน (บรรทัดฐานเดียวกับที่เจ้าของสั่งปิด `interco_maker_checker_enabled` — "กิจการเล็ก คุมด้วยการกำหนดสิทธิ") |

---

## 1. ขอบเขต

### อยู่ในขอบเขต
- `Sale.saleType = 'CASH'` — มี JE ฝั่ง SHOP จริง (`ShopCashSaleTemplate` ต่อเข้า
  `sale-writer.service.ts` ตั้งแต่ **2026-06-23** commit `3a3fb03c2` / PR #1285 — **หมายเหตุใน
  `.claude/CLAUDE.md` ที่ว่า template นี้ "ZERO production callers" ล้าสมัยตั้งแต่วันนั้น
  ต้องแก้ตอน implement**) · สร้าง `SalesCommission` สถานะ `PENDING` ด้วย
- `Sale.saleType = 'EXTERNAL_FINANCE'` — **ไม่มี JE** (มีแต่ `TODO: perpetual inventory` ค้างไว้
  ในโค้ด) และ **ไม่สร้างค่าคอม** (ตรวจแล้ว `sale-writer.service.ts:468-532` ไม่มี
  `salesCommission.create` — ต่างจาก CASH และ INSTALLMENT) แต่มี `FinanceReceivable`

### นอกขอบเขต (พร้อมเหตุผล)
| สิ่งที่ไม่ทำ | เหตุผล |
|---|---|
| `Sale.saleType = 'INSTALLMENT'` | มีเส้นทางยกเลิกสัญญาอยู่แล้ว (`ContractCancellationService`, Phase 3) ซึ่งคืนเครื่องเข้าสต็อก + กวาด JE + ปลด ECL ให้ครบอยู่แล้ว การทำซ้อนจะเป็นกติกาชุดที่สอง |
| ขายเครื่องยึด (`SOLD_RESELL`) | ไม่มีแถว `Sale` เลย — สถานะถูกตั้งโดย `repossessions.service.ts` `updateStatus` (`SOLD` → product `SOLD_RESELL`) ⇒ ถ้าคีย์ผิดต้องแก้ที่หน้ายึดเครื่อง เป็นงานคนละใบ |
| แก้ไขใบขายในที่ (edit) | เลือก **void + คีย์ใหม่** แทน: การแก้ราคา/สินค้าในที่ต้องกลับ JE เดิมแล้วโพสต์ใหม่อยู่ดี = ความซับซ้อนเท่ากันแต่มีทางพลาดมากกว่า และไม่เหลือหลักฐานว่าคีย์ผิดอะไรไว้ |
| คืนคิวจองบนเว็บที่ถูกตัดตอนขาย | `preemptReservationsInTx` ตัด hold ของลูกค้ารายอื่นไปแล้วตอนขาย — คืนไม่ได้จริง (ลูกค้าอาจไปซื้อที่อื่นแล้ว/ได้รับแจ้งไปแล้ว) **บันทึกเป็นข้อจำกัดที่ยอมรับ** ไม่ใช่บั๊ก |

---

## 2. เงื่อนไขห้ามยกเลิก (guards)

ทุกข้ออ่าน **ในทรานแซกชัน** ก่อนแตะ state ใด ๆ และให้ข้อความไทยที่**ชี้ทางออกที่ทำได้จริง**
(บทเรียน Phase 5: finding "ชี้ทางที่ไม่มีจริง" ซ้ำ 3 รอบ — ต้องเปิดโค้ดหน้าจอปลายทาง + `@Roles`
ก่อนเขียนข้อความ)

| # | เงื่อนไข | เหตุผล | ทางออกที่บอกผู้ใช้ |
|---|---|---|---|
| G1 | ใบขายถูกยกเลิกไปแล้ว (`deletedAt != null`) | idempotency | บอกว่ายกเลิกไปแล้วเมื่อไร โดยใคร |
| G2 | งวดบัญชีของวันที่จะโพสต์กลับรายการปิดแล้ว (เฉพาะใบที่มี JE) | โพสต์เข้าเดือนปิดไม่ได้ | ให้บัญชีเปิดงวดผ่านเส้นทาง `PERIOD_REOPENED` เดิม |
| G3 | ไฟแนนซ์ภายนอกโอนเงินมาแล้ว — `FinanceReceivable.receivedAmount > 0` **หรือ** `status ∈ {RECEIVED, PARTIALLY_RECEIVED}` (**แก้ 2026-08-23 จากเดิม `status != PENDING`** — ดูหมายเหตุใต้ตาราง) | เงินเข้าจริงแล้ว ต้องคืนก่อน | ให้บันทึกคืนเงิน/ปรับรายการรับจากไฟแนนซ์ก่อน (ผจก.สาขาเปิดดูได้แต่แก้ไม่ได้) |
| G4 | ค่าคอมไม่อยู่ในสถานะที่เรียกคืนได้ — สถานะ **ไม่ใช่** `PENDING`/`APPROVED` (ครอบ `PAID` + `PARTIALLY_CLAWED_BACK` + ค่าใหม่ในอนาคต) | เงินออกจริง | บอกตรง ๆ ว่ายังไม่มีเมนูเรียกคืน ให้เจ้าของ/ผจก.การเงินตัดสินใจ |
| **G4b** | **รอบจ่ายค่าคอม** (`CommissionPayout`) ที่ครอบค่าคอมใบนี้อยู่ในสถานะ `APPROVED`/`PAID` (**เพิ่ม 2026-08-23** — ดูหมายเหตุใต้ตาราง) | `markPayoutPaid` ไม่แตะ `SalesCommission.status` ⇒ G4 มองไม่เห็นเงินที่จ่ายผ่านรอบจ่าย | บอกตรง ๆ ว่ายังไม่มีเมนูยกเลิก/แก้ไขรอบจ่าย ให้เจ้าของตัดสินใจ |
| G5 | สินค้าถูกผูกไปที่อื่นแล้ว — reuse `assertProductNotHeld` (Phase 5) ด้วย action ใหม่ · **ตรวจทั้งสินค้าหลักและของแถมทุกชิ้น** ถ้าชิ้นใดชิ้นหนึ่งไม่ผ่าน = ยกเลิกทั้งใบไม่ได้ | เครื่องอาจถูกขายต่อ/จอง/เข้าสัญญาใหม่ไปแล้ว | ระบุ**ชื่อสินค้าและสถานะปัจจุบัน**ของชิ้นที่ติด + flow ที่ถูกต้อง |
| G6 | ใบขายมาจากออเดอร์ออนไลน์ (`Sale.onlineOrderId != null`) | สถานะสองฝั่งจะเพี้ยน (order ยัง `PAID`/`DELIVERED` แต่ใบขายหาย) | ให้จัดการที่เมนูออเดอร์ออนไลน์ |
| G7 | มีใบซ่อมที่ยังไม่ปิดบน**เครื่องของใบขายนี้** — `RepairTicket` **ไม่มี `saleId`** (มีแต่ `customerId`/`contractId`/`productId`) จึงตรวจ `productId ∈ {หลัก, ของแถม}` + `status notIn [CLOSED, CANCELLED, REPLACED]` (enum จริง `RepairStatus`; exclude-list) — **แก้ 2026-08-23 จากเดิมที่เขียนว่า "อ้างอิงใบขายนี้"** | ประกันอิงใบขาย (`repair-warranty.service.ts` อ่าน `Sale`) — ยกเลิกแล้วเคลมจะลอย | ให้ปิด/ยกเลิกใบซ่อมที่เมนู "รับซ่อม/รับประกัน" ก่อน |

**G3 — ทำไมเลิกใช้ `status != PENDING` (แก้สเปค 2026-08-23):** `FinanceReceivableStatus`
มี 5 ค่า และ **`DISPUTED` / `OVERDUE` แปลว่ายังไม่ได้เงิน** — โค้ดรายงานของระบบเองยืนยัน
(`finance-receivable.service.ts` จัด `DISPUTED` เป็น `disputedAmount` เต็มจำนวน
`netExpectedAmount` ส่วน `OVERDUE` เป็นยอดค้าง) ⇒ นับสองตัวนี้เป็น "โอนมาแล้ว" คือ
false positive ที่ล็อกใบขายไว้**ถาวร** (ปุ่ม "แจ้งปัญหา" ตั้ง `DISPUTED` ได้ แต่ไม่มีคอนโทรล
บน UI พากลับ `PENDING`) และขัดคำตัดสิน **D2 ที่ให้บล็อกเมื่อ "เงินขยับจริง"**. ขา
`receivedAmount > 0` ครอบเคสเงินเข้าจริงไว้อีกชั้นอยู่แล้ว ⇒ ขา status เดิมเติมเฉพาะ
false positive. เปลี่ยนเป็น allow-list `{RECEIVED, PARTIALLY_RECEIVED}`

**G4b — รอบจ่ายค่าคอม (เพิ่ม 2026-08-23):** มีสองเส้นทางจ่ายเงินอิสระกัน —
`POST /commissions/:id/pay` เขียน `SalesCommission.status = 'PAID'` (G4 เห็น) แต่
`PATCH /commissions/payouts/:id/paid` เขียน **เฉพาะ `CommissionPayout`** ไม่แตะค่าคอมเลย
(G4 บอด) ⇒ พนักงานรับเงินจริงแล้วแต่ค่าคอมยัง `PENDING` ⇒ ยกเลิกใบขายผ่านฉลุยแล้ว flip
`CLAWED_BACK` ทั้งที่เงินออกไปแล้ว. รอบจ่ายผูกกับคู่ **(salespersonId, period)** ไม่ใช่ `saleId`

- **`DRAFT` ไม่บล็อก** (คำตัดสินเจ้าของ 2026-08-23 "รอบที่ยังเป็นร่าง → ยกเลิกได้") แต่ต้อง
  **soft-delete ร่างนั้นใน `$transaction` เดียวกัน** + audit `COMMISSION_PAYOUT_DRAFT_VOIDED`
  เพราะ `generatePayouts` ข้ามรอบที่ยังอยู่ ⇒ ปล่อยร่างไว้ = ยอดค้างเกินจริงแล้วถูกอนุมัติ/
  จ่ายตามยอดเก่า. ลบแล้วกดสร้างใหม่ได้ยอดถูก (ขา `upsert.update` ตั้ง `deletedAt: null` +
  คำนวณใหม่ ซึ่งตัด `CLAWED_BACK` ออกเองอยู่แล้ว)
- **ห้ามแก้เป็นการหักยอด** (`totalCommission -= commissionAmount`) แทนการลบร่าง — รอบที่
  generate **ก่อน** ค่าคอมใบนี้เกิดไม่เคยนับใบนี้ ⇒ หักยอด = **จ่ายพนักงานขาด**
- **นับเฉพาะรอบที่ครอบค่าคอมใบนี้จริง**: `generatePayouts` ไม่คำนวณรอบที่สร้างไปแล้วใหม่ ⇒
  ค่าคอมที่เกิด**หลัง**กดสร้างรอบไม่เคยอยู่ในยอดรอบนั้น (สร้างรอบ 20 ส.ค. → คีย์ใบขายผิด
  21 ส.ค. → ต้องยกเลิกได้). พิสูจน์ด้วยคอลัมน์ใหม่ **`CommissionPayout.generatedAt`**
  (`commission.createdAt <= generatedAt`) — **ห้ามใช้ `createdAt` ของรอบ** เพราะขา
  `upsert.update` ที่ restore หลัง soft-delete คำนวณยอดใหม่แต่ `createdAt` ยังเป็นของเดิม ·
  `generatedAt = null` (รอบยุคก่อนมีคอลัมน์) = พิสูจน์ไม่ได้ ⇒ ถือว่าครอบไว้ก่อน (ปลอดภัย)

**G6 — ทางออกที่บอกผู้ใช้ (แก้ 2026-08-23):** ตรวจ `shop-orders.service.ts` แล้วพบว่าทั้งสอง
ทางที่เคยแนะนำใช้ไม่ได้จริง — `markRefunded` บังคับ `status === 'PAYMENT_RECEIVED_UNFULFILLABLE'`
ซึ่งโดยนิยามแปลว่า**ไม่มีใบขาย** (ประชากรที่ชน G6 เข้าเงื่อนไขไม่ได้ตลอดกาล) ส่วน `cancelOrder`
แตะแค่ `onlineOrder.status` + `productReservation` **ไม่แตะ Sale / product.status / JE** ⇒
ทำตามแล้วได้สถานะสองฝั่งไม่ตรงกันพอดีกับที่ข้อความอ้างว่าจะกัน. ข้อความจึงเขียนตามความจริงว่า
ระบบยังไม่มีเส้นทางยกเลิกที่ล้างทั้งออเดอร์และใบขายพร้อมกัน ⇒ ให้เจ้าของตรวจก่อน

**G5 — action ใหม่บน helper เดิม:** `assertProductNotHeld` (`product-hold.util.ts`) มี 3 action
แล้ว (`DELETE` / `CHANGE_IDENTITY` / `RESTORE_TO_CONTRACT`) — เพิ่ม **`RESTORE_TO_STOCK`**
โดยสถานะที่ยอมให้ผ่านคือสถานะที่ **ใบขายนี้เป็นคนตั้งเอง** (`SOLD_CASH` สำหรับ CASH,
`SOLD_INSTALLMENT` สำหรับ EXTERNAL_FINANCE) — สถานะอื่นทั้งหมดแปลว่ามีคนอื่นมาผูกต่อไปแล้ว
**ห้ามเขียน guard ชุดที่สอง**

---

## 3. สิ่งที่กลับรายการ

ทั้งหมดอยู่ใน `$transaction` เดียว `isolationLevel: 'Serializable'` (เท่ากับตอนสร้างการขาย —
`sale-writer.service.ts` ใช้ Serializable อยู่แล้ว) และ **P2034 → 409 ไทย** ตาม pattern
`approveBatch`/`approveCancellation` (log warn + `Sentry.captureMessage` level warning เอง เพราะ
`SentryExceptionFilter` จับเฉพาะ ≥500)

| ลำดับ | สิ่งที่ทำ | หมายเหตุ |
|---|---|---|
| 1 | สินค้าหลัก + ของแถม (`bundleProductIds`) → **`IN_STOCK`** | ตอนขาย `verifyProductInStock`/`markBundleProductsSold` บังคับว่าต้องเป็น `IN_STOCK` มาก่อน ⇒ คืนที่เดิมถูกต้องตามนิยาม **ไม่ต้องยืนยันราคาใหม่** (ไม่มี flow ไหนแตะราคาระหว่างขาย) |
| 2 | กลับรายการ JE ทุกใบที่ `metadata.saleId = <saleId>` (CASH เท่านั้น) | JE ประทับ `flow: 'shop-cash-sale'`, `tag: 'SHOP_CASH_SALE'`, `saleId` ไว้แล้ว · mirror สลับ Dr/Cr ลงวันที่ **วันที่ยกเลิก** · `metadata.flow = 'shop-cash-sale-void'`, `idempotencyKey = 'shop-cash-sale-void:<jeId>'` (**แก้ 2026-08-22 จากเดิมที่เขียน `sale-void:` ไว้**: sweep engine ผูก prefix กับ `flowLabel` และ unique index `journal_entries_idempotency_idx` scope ด้วย `flow` อยู่แล้ว ⇒ unique ต่อ JE ต้นทางและชนกับ flow อื่นไม่ได้โดยโครงสร้าง — การเพิ่ม option แค่ให้สตริงสวยคือการขยาย API บนเส้นทางเงินโดยไม่จำเป็น), `reversesEntryId` · ใบเดิมคง `POSTED` + ประทับ `reversed: true` (pattern เดียวกับ `reverseBatch`/`ExchangeCancelReversalTemplate`) |
| 3 | `FinanceReceivable` ของใบนี้ → soft delete | เฉพาะ EXTERNAL_FINANCE · G3 การันตีแล้วว่ายังไม่มีเงินเข้า |
| 4 | `SalesCommission` → `CLAWED_BACK` | **เฉพาะ CASH** (EXTERNAL_FINANCE ไม่สร้างค่าคอมตั้งแต่แรก) · ครอบทั้ง `PENDING` และ `APPROVED` (G4 บล็อกเฉพาะ `PAID` ⇒ สองสถานะนี้เข้ามาถึงขั้นนี้ได้) · สถานะมีอยู่แล้วใน enum ไม่ต้องเพิ่ม |
| 5 | `Sale` → `deletedAt = now()`, `voidReason`, `voidedById` | ดูข้อ 4 เรื่องทำไมใช้ `deletedAt` |
| 6 | `AuditLog { action: 'SALE_VOIDED', entity: 'sale' }` | `newValue` เก็บ saleNumber, saleType, netAmount, reason, productIds, reversalEntryNumbers, commissionIds |

**ป้องกันข้อมูลเพี้ยน:** ถ้าใบขาย `CASH`/`EXTERNAL_FINANCE` ดันมี `contractId` ผูกอยู่ (ไม่ควร
เกิด — เป็นของ `INSTALLMENT` เท่านั้น) ให้ **ปฏิเสธพร้อมข้อความว่าข้อมูลผิดปกติ** ไม่ใช่เดินต่อ
แล้วทิ้งสัญญาลอย

**Audit เขียนแบบไหน:** ใช้ `tx.auditLog.create` ในทรานแซกชันเดียวกัน (atomic กับการคืนสถานะ
สินค้า) ตามกติกาที่ Phase 5 เขียนไว้ใน `.claude/rules/database.md` — **ห้ามเรียก
`AuditService.log` ในทรานแซกชัน** เด็ดขาด (เปิด root `$transaction` ซ้อน → P2028 ถูกกลืน →
audit หายเงียบ ซึ่ง Phase 5 เพิ่งพิสูจน์ว่าเกิดจริง 100%)

---

## 4. ทำให้ใบที่ยกเลิกหายจากรายงานอย่างถูกต้อง

**ใช้ `Sale.deletedAt`** (มีคอลัมน์ + `@@index([deletedAt])` อยู่แล้ว) เพราะผู้อ่าน 10 จุดกรอง
`deletedAt: null` อยู่แล้ว ⇒ ยอดขาย/สรุปรายวัน/กำไรขาดทุน/ประกัน/สิทธิ์รีวิว หักใบที่ยกเลิก
ออกให้เองโดยไม่ต้องเดินแก้ทีละที่

**ตาราง "8 จุดที่ยังไม่กรอง" ที่สำรวจไว้ 2026-08-22 — ผลตรวจจริงตอน implement (Task 4, 2026-08-23):
ส่วนใหญ่เป็น false positive** ของหน้าต่างสำรวจ 6 บรรทัด (`where` อยู่ไกลกว่านั้น). ของจริง:

| จุด | ผลตรวจจริง |
|---|---|
| `sales-query.service.ts` `findAll` (6 บรรทัดที่สำรวจ) | **กรองอยู่แล้ว** — `where` ก้อนเดียวใช้ร่วม findMany/count/aggregate/groupBy; เพิ่ม opt-out `includeVoided` ที่จุดสร้าง `where` จุดเดียว (summary ของหน้ารายการตอนเปิดสวิตช์จึงรวมใบยกเลิกด้วย — UI ติดป้ายเตือน). สรุปรายวัน/สินค้าขายดีกรองอยู่แล้ว ไม่มี opt-out |
| `sales-query.service.ts` `findOne` | ทิศ**กลับ** — เคย**บล็อก**ใบที่ `deletedAt` ด้วย NotFound ⇒ แก้ให้เปิดดูได้ + คืน `voidReason`/`voidedBy {id,name}` (ไม่มีผู้เรียกพึ่ง NotFound) |
| `accounting/transactional-report.service.ts` `getMonthlyPLSummary` | **ต้องกรองจริง 2 จุด** (revenue ≈384 + COGS ≈400) — เติมแล้ว; `sale.aggregate` อีก 4 จุด (balance sheet / cash flow) กรองอยู่แล้ว |
| `utils/sequence.util.ts` `generateSaleNumber` | **ห้ามกรอง** — ใบยกเลิกยังถือเลข ไม่งั้นเลขซ้ำ (คอมเมนต์กำกับในโค้ดแล้ว) |

**หน้าประวัติการขาย** มีสวิตช์ "แสดงใบที่ยกเลิกแล้ว" (ส่ง `includeVoided=true`) เพื่อตรวจย้อนหลัง
— ใบที่ยกเลิกแสดงป้ายชัดเจน + เหตุผล + คนกด + เวลา

---

## 5. โครงสร้างโค้ด

```
apps/api/src/modules/sales/
  services/
    sale-void.service.ts        ← ใหม่ (guards + reversal ใน tx เดียว)
  dto/void-sale.dto.ts          ← ใหม่ ({ reason: string, min 10 })
  sales.controller.ts           ← + POST /sales/:id/void  (@Roles OWNER, BRANCH_MANAGER)
apps/api/src/modules/products/
  product-hold.util.ts          ← + action 'RESTORE_TO_STOCK' (ไม่สร้าง helper ใหม่)
apps/web/src/pages/
  SalesHistoryPage.tsx          ← + ปุ่ม/ไดอะล็อก/สวิตช์แสดงใบที่ยกเลิก
```

`sale-void.service.ts` แยกจาก `sale-writer.service.ts` เพราะคนละความรับผิดชอบ (writer =
สร้าง 3 แบบ, void = กลับรายการ) และไฟล์ writer ใหญ่อยู่แล้ว (~530 บรรทัด)

**Migration:** additive 2 คอลัมน์บน `sales` — `void_reason TEXT NULL`,
`voided_by_id TEXT NULL` (**แก้ 2026-08-23 จาก `UUID`** — `users.id` เป็น TEXT ตาม init migration,
ประกาศ UUID = FK สร้างไม่ผ่าน; FK ห่อ `DO $$` ให้รันซ้ำได้) + `@@index([voidedById])`, `onDelete:
Restrict` ตามกติกาหลักฐานทางการเงิน (`20261000000000_sale_void_fields`). เวลาที่ยกเลิก = `deletedAt`
ที่มีอยู่แล้ว ไม่เพิ่มคอลัมน์ซ้ำ. **เพิ่มระหว่าง review:** `CommissionPayout.generatedAt`
(`20261000100000_commission_payout_generated_at`, nullable) สำหรับ G4b.

**Branch scope (เพิ่มตอน Task 4 review):** `BranchGuard` ไม่ scope route `/:id` ⇒ service รับ
`VoidSaleActor { id, role, branchId }` ทั้งก้อน และปฏิเสธ BM ที่สาขาไม่ตรง (BM ไม่มี `branchId` =
fail-closed). ไม่เพิ่ม guard ใหม่.

---

## 6. การทดสอบ

**Unit (jest)** — guard ทุกข้อ G1-G7 มีเทสของตัวเอง + เทสว่าไม่มีการเขียน DB เมื่อ guard ตก

**Integration (vitest, DB จริง, `--no-file-parallelism`)** — ไฟล์ใหม่
`apps/api/src/modules/sales/__tests__/sale-void.integration.spec.ts` (prefix `VOIDTEST-`):

1. ขายสด (มีของแถม) → ยกเลิก → สินค้าหลัก **และ** ของแถมกลับเป็น `IN_STOCK` · JE ของใบนั้น
   **สุทธิเป็นศูนย์ทุกบัญชี** · ค่าคอม `CLAWED_BACK` · `Sale.deletedAt` ตั้ง · ขายเครื่องเดิมใหม่ได้
2. ขายผ่านไฟแนนซ์ภายนอก → ยกเลิก → `FinanceReceivable` หาย · ไม่มี JE ให้กลับรายการ (ยืนยันว่า
   ไม่ throw)
3. G3: ไฟแนนซ์โอนมาแล้ว → ปฏิเสธ · G4: ค่าคอมจ่ายแล้ว → ปฏิเสธ · G5: เครื่องถูกขายต่อไปแล้ว →
   ปฏิเสธ (ทั้งสามเคสต้องพิสูจน์ว่า **ไม่มีอะไรถูกเขียน**)
4. ยกเลิกซ้ำ (G1) → ปฏิเสธ ไม่สร้าง JE ใบที่สอง
5. **CI glob:** ต้องตรวจว่า `.github/workflows/deploy-gcp.yml` ครอบ
   `src/modules/sales/__tests__/*.integration.spec.ts` — บทเรียน `jp5-vat-split`: glob
   ไม่ recurse เอง ไดเรกทอรีใหม่ต้องเติม glob ใหม่เสมอ

**Web (vitest)** — ปุ่มเห็นเฉพาะ OWNER/BM · ไดอะล็อกบังคับเหตุผล ≥10 ตัวอักษร · สวิตช์แสดงใบที่
ยกเลิกส่ง query param ถูก

---

## 7. เอกสารที่ต้องอัปเดตตอน implement

ทำแล้วทั้งหมด 2026-08-23 (Task 7):

1. ✅ `.claude/rules/database.md` — ย่อหน้า "ยอมรับช่องว่างไว้ก่อน" เขียนใหม่ + เติม void-sale ใน
   รายการยกเว้นของ `product-enter-stock.util`
2. ✅ กล่อง "⚠ WIRING STATUS — DEFERRED" **อยู่ใน `.claude/rules/accounting.md`** (ไม่ใช่
   `CLAUDE.md` — CLAUDE.md โหลด rules เข้ามาจึงเห็นรวมกัน) — เติม stale note #2:
   `ShopCashSaleTemplate` มี caller ตั้งแต่ 2026-06-23 (`3a3fb03c2`, PR #1285); `CLAUDE.md` ได้
   pointer หนึ่งบรรทัดใน Important Notes
3. ✅ `.claude/rules/accounting.md` — หัวข้อ "ยกเลิกใบขาย (void sale)" ครบ: flow
   `shop-cash-sale-void`, **F1** (บั๊ก production เดิม: JE ต่อชิ้นชน `journal_entries_ref_unique` —
   ขายสด+ของแถมมีต้นทุนสร้างไม่ได้ตั้งแต่ 2026-06-23, แก้ `e8d9a5246` reference =
   `sale:<saleId>:<productId>`), G4b + `generatedAt`, restore-reset DRAFT, AuditLog actions, carries
4. ✅ `.claude/rules/security.md` — กติกา branch scope บน route `/:id` เป็นหน้าที่ของ service

---

## 9. ยังเปิดอยู่หลัง implement (carries — ไม่ block merge)

- `assertProductNotHeld` overloads ให้ `expectedStatus` บังคับ compile-time เฉพาะ `RESTORE_TO_STOCK`
  (~4 บรรทัด ไม่แตะ caller เดิม) — ยังไม่ทำ
- ternary ข้อความ G4b: `PayoutStatus` ค่าใหม่จะได้คำว่า "อนุมัติแล้ว" (cosmetic)
- `approvePayout` READ COMMITTED race กับ void — ปิดบางส่วนด้วย restore-reset เป็น DRAFT
  (`eed8a68e6`); ยก isolation เมื่อมีสัญญาณจริง
- ค่าคอม `CLAWED_BACK` ไม่คืนยอดให้รอบ `APPROVED`/`PAID` (ไม่มีทางเกิดวันนี้ — G4b บล็อก) —
  ทบทวนเมื่อมีเมนูแก้ไข/ยกเลิกรอบจ่าย
- **ไม่มีเมนูยกเลิก/แก้ไขรอบจ่ายค่าคอม** (`PayoutStatus.CANCELLED` ไม่มี endpoint ตั้งได้) ⇒ ใบขายที่
  ค่าคอมถูกนับในรอบ `APPROVED`/`PAID` ยกเลิกไม่ได้จนกว่าจะมี — ทางแก้ที่ถูกคือทำปุ่มยกเลิกรอบ
  ไม่ใช่ผ่อนด่าน
- SALES เห็นใบยกเลิก + เหตุผล + คนกด ผ่าน `findAll?includeVoided=true` (API เปิดทุก role อยู่ก่อน —
  pre-existing, ไม่มี PII ใหม่)
- G6: ออเดอร์ออนไลน์ยังไม่มีเส้นทางล้างสองฝั่ง (ออเดอร์ + ใบขาย + สินค้า + JE) — ข้อความบอกให้เจ้าของ
  ตรวจก่อน
- G5 "เครื่องถูกเปิดสัญญาต่อ" ไม่มีเคส integration (ตั้งฉากไม่ได้โดยไม่เขียน `product.status` ตรง) —
  ครอบด้วย unit + `product-lifecycle.integration.spec.ts`
- F2 (test-only): G4b เทียบ `commission.createdAt` (Prisma engine) กับ `generatedAt` (Node) — เทส
  ใส่ `sleep(150)` กัน timer quantum บน Windows; บน prod ช่องว่างเป็นนาที/วัน

---

## 8. สิ่งที่จงใจไม่ทำ (YAGNI)

- **ไม่มีใบลดหนี้** — SHOP ไม่จด VAT จึงไม่มีภาระ ม.86/10 (ต่างจากใบเสร็จฝั่ง FINANCE ที่ต้องมี
  ใบลดหนี้คู่เสมอ)
- **ไม่มีการคืนเงินเป็นรายการแยก** — การกลับรายการ JE พาเงินสดกลับออกจากบัญชีให้แล้ว การส่งเงิน
  คืนลูกค้าเป็นการกระทำจริงหน้าร้าน ไม่ต้องมีเอกสารที่สอง
- **ไม่มีสถานะ `VOIDED` บน `Sale`** — `deletedAt` + `voidReason` พอ และได้การกรองจากผู้อ่านเดิมฟรี
- **ไม่ยกเลิกบางส่วน** (เช่น ถอดของแถมชิ้นเดียว) — ยกเลิกทั้งใบแล้วคีย์ใหม่
