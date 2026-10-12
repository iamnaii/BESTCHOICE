# หลังการขาย PR 5 — เปลี่ยนรุ่นเดิมสำหรับใบขายสด (`CASH_SAME_MODEL_EXCHANGE`)

- สถานะ: **สเปกร่าง 2 (2026-10-12) — แก้ตามผลตรวจทานโค้ดจริง 10 ข้อ · รอเจ้าของรีวิว ก่อนเขียนแผน**
- ต่อยอดจาก: `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` §10 (ข้อเสนอที่เจ้าของไม่แย้ง) · คำตอบฝ่ายบัญชีฉบับรวม **ข้อ 10** (30/09/2569: 10.1 รายการบัญชีถูกต้อง · 10.2 ต้องมี "ใบรับคืน" และ "ใบส่งมอบเครื่องทดแทน" อ้างเลขที่ใบขายเดิม)
- Mockup ที่เจ้าของเคาะแล้ว 12/10: canvas `https://claude.ai/artifact/SoThf1rbZEaxas5KJgudxp` กระดาน **11–14** (+ โน้ต s6/s7)
- โค้ดที่อ้างในสเปกนี้อ่านจาก `origin/main` `984b7a709` (worktree `BESTCHOICE-after-sales-pr5`)
- ร่าง 1 → ร่าง 2: ผลตรวจทาน (`/scrutinize` 12/10) พบสเปกสมมติผิดกับโค้ดจริง 10 ข้อ — แก้ครบในร่างนี้ (ตาราง §15)

## 1. คำตัดสินเจ้าของ 2026-10-12 (ปิดประเด็น — แผนทำตามนี้ ไม่ถามซ้ำ)

| # | เรื่อง | คำตัดสิน |
|---|---|---|
| ① | เครื่องที่เข้าข่าย | **มือสองเท่านั้น** (`Product.category = PHONE_USED`) — เครื่องใหม่ส่งเคลมศูนย์ (กติกาเดียวกับสัญญาผ่อน) |
| ② | เอกสาร | **ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน ออกตอนส่งมอบ พิมพ์คู่กัน** (PDF เดียว 2 หน้า · ลูกค้าเซ็นครั้งเดียว · ต้นฉบับร้านเก็บ) · ใบรับฝากเครื่องตอนเปิดเคสคงเดิม |
| ③ | ขอบเขต | **จบที่ส่งมอบ** + เปิดให้เครื่องเดิมสถานะ "รอเคลม" (`DEFECT_RETURN`) **ขอตัดจำหน่าย** ผ่านเมนูตัดสินค้าได้ · "ผู้จัดจำหน่ายส่งเครื่องแทน" = งานรอบหน้า |
| ④ | วิธีทำ | **ทาง ก — สลับเครื่องบนใบขายเดิม** (เลขใบขายเดิม ราคาเดิม รายได้/เงินสดไม่แตะ) + รายการบัญชีสลับต้นทุน 1 ใบตามข้อ 10 |
| ⑤ | ประกันของเครื่องทดแทน | ประกันร้าน (มือสอง 60 วัน) และกรอบ 7 วัน **นับใหม่จากวันส่งมอบ** |
| ⑥ | เกินกรอบ 7 วัน | **ซ่อมเท่านั้น** — ไม่มี "ข้ามกรอบ 7 วัน" ให้ ผจก./เจ้าของ (ต่างจากสัญญาผ่อน) |
| ⑦ | ยกเลิกใบขาย | ใบขายที่เปลี่ยนเครื่องแล้ว **ยกเลิกใบขายไม่ได้ถาวร** (จำเป็นจริงให้ฝ่ายบัญชีแก้รายการ) |
| ⑧ | เลขที่เอกสาร | *(ค่าเริ่มต้นของสเปก — ยังไม่ได้ถาม)* เอกสาร 2 ใบใช้เลขเคสเดิม ไม่ออกเลขเอกสารใหม่ (เหมือนใบรับฝาก/ใบส่งมอบของ PR 4) |

**สมมติฐานอื่นที่สเปกใช้ (แก้ได้ตอนรีวิว):**
- นับ 7 วันจาก**วันขาย** (`soldAt = Sale.shopWarrantyStartDate ?? Sale.createdAt` · ปฏิทินไทย · วันขาย = วัน 0) — **ปุ่มเปิดวัน 0–6** (`daysRemainingIn7Day > 0` สูตรเดียวกับสัญญาผ่อน) · **วันที่ 7 ปุ่มปิด** ด้วยข้อความ "ครบกำหนด 7 วันแล้ว — ซ่อมเท่านั้น" แม้ป้ายสถานะยังเป็น "ใน 7 วัน" (สถานะ `IN_7DAY_DEFECT` ใช้ ≤ 7 — ธรรมเนียมเดิมของสัญญาผ่อน ซึ่งวันที่ 7 มี ผจก. ข้ามกรอบได้จึงไม่มีใครสังเกต · ขายสดไม่มีข้ามกรอบ จึงต้องเขียนให้ชัด)
- เครื่องทดแทนต้องอยู่สต๊อกพร้อมขาย**สาขาเดียวกับเคส** · ผจก.สาขา/เจ้าของเป็นผู้ยืนยัน (เหมือน `assertMgr` เดิม) · ของแถมในบิลไม่แตะ
- ใบขายไฟแนนซ์นอก (`EXTERNAL_FINANCE`) เข้าข่ายเหมือนขายสด (คำตัดสิน D2 ของ hub) — สถานะเครื่องของใบประเภทนี้คือ `SOLD_INSTALLMENT` ไม่ใช่ `SOLD_CASH` (§5 ข้อ 5)
- เปลี่ยนซ้ำได้ด้วยเคสใหม่บนใบขายเดิม (นับ 7 วันจากวันส่งมอบครั้งก่อน)
- การ์ดสรุป "เปลี่ยนเครื่องค้าง" ของหน้าหลังการขาย **นับเคสขายสดด้วย** (`EXCHANGE_OUTCOMES` ใน `after-sales-query.service.ts:168` ตัด CASH ออกตอนที่ยังไม่ทำ — เปิดกลับ)

## 2. สรุปภาษาง่าย

ลูกค้าซื้อมือสองเงินสด ภายใน 7 วันเครื่องมีปัญหา → พนักงานเปิดเคส "แจ้งปัญหาเครื่อง" เลือกทางออก "เปลี่ยนรุ่นเดิม" (ปุ่มที่วันนี้ปิดไว้ "รอกติกาบัญชี") → ผจก.สาขากด **ยืนยันเปลี่ยนเครื่อง** พร้อมเลือกเครื่องทดแทนรุ่น/ความจุเดิมจากสต๊อกสาขา → ระบบสลับเครื่องบนใบขายเดิม ลงบัญชีสลับต้นทุน เครื่องเดิมกลายเป็นของร้าน "รอเคลม" ส่ง LINE "มารับได้แล้ว" → ลูกค้ามารับ พนักงานกด **ส่งมอบ** พิมพ์ **ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน** ให้ลูกค้าเซ็น ประกันร้านและกรอบ 7 วันเริ่มใหม่ → ปิดเคส · เครื่องเดิมถ้าเคลมไม่ได้ ขอตัดจำหน่ายที่เมนูตัดสินค้า (เจ้าของอนุมัติ)

**ไม่เปลี่ยน:** ราคาขาย · รายได้ · เงินสด · เลขที่ใบขาย · ของแถม · สัญญาผ่อน/เครื่องยนต์ defect-exchange · LINE 3 จังหวะ (ใช้ข้อความเดิม) · ใบเสร็จ POS เดิม

## 3. เงื่อนไข (eligibility) — แหล่งเดียว

### 3.1 สิทธิ์ 7 วันของใบขาย (ของใหม่ — วันนี้ระบบไม่นับให้ขายสด)

ข้อเท็จจริง: `detectWarrantyStatus` (`repair-tickets/utils/detect-warranty-status.ts`) คืน `IN_7DAY_DEFECT` เฉพาะเมื่อมี `contract.deviceReceivedAt` · `RepairWarrantyService` ใส่ `deviceReceivedAt: null` ให้ใบขายที่ไม่มีสัญญา (บรรทัด ~202 "สิทธิ์เปลี่ยนเครื่อง 7 วันผูกกับสัญญาเท่านั้น") · `computeDaysRemainingIn7Day(sale?.contract)` คืน `null` ให้ใบขาย ⇒ `computeOutcomes` ได้ `within7 = false` เสมอ

การแก้ — **แยกสองชั้นตามธรรมเนียมเดิม: สถานะประกัน = เรื่องวันที่ล้วน · หมวดเครื่อง = เรื่องสิทธิ์เปลี่ยน**
- `DetectWarrantyInput.sale` เพิ่ม `soldAt?: Date | null` **เท่านั้น** (ไม่ใส่ category) · `detectWarrantyStatus`: ไม่มี `contract.deviceReceivedAt` + มี `sale.soldAt` → ผลต่างวันปฏิทินไทย (`toBkkCalendarDay(now) − toBkkCalendarDay(soldAt)`) ≤ 7 ⇒ `IN_7DAY_DEFECT` — สูตรเดียวกับขา `deviceReceivedAt` ทุกตัวอักษร · เครื่องใหม่ขายสดได้สถานะ/ป้าย/payer เหมือนสัญญาผ่อนเครื่องใหม่ (ไม่เปลี่ยนความหมายของสถานะตามหมวด)
- `soldAt` ของใบขาย = `Sale.shopWarrantyStartDate ?? Sale.createdAt` (`SaleWriterService.resolveSaleShopWarranty` ตั้ง start = เวลาขาย · ไม่มีนโยบายประกัน = ไม่ตั้ง → fallback `createdAt`) — หลังเปลี่ยนเครื่อง `shopWarrantyStartDate` ถูกตั้งเป็นวันส่งมอบ ⇒ กรอบ 7 วันของเครื่องทดแทนนับใหม่โดยไม่ต้องมีคอลัมน์เพิ่ม (⑤)
- `RepairWarrantyService`: `computeDaysRemainingIn7Day` รับ `{ deviceReceivedAt } | { soldAt }` (ตัวเดียว สูตรเดิม) · lookup ทั้งทาง IMEI/ลูกค้า/after-sales ส่ง `soldAt` ให้ใบขายที่ไม่มีสัญญา · `eligibility.forExchange` ของใบขาย = `warrantyStatus === 'IN_7DAY_DEFECT' && product.category === 'PHONE_USED'` (กระจกของกิ่งสัญญาบรรทัด 119–123 ซึ่ง gate ด้วย `contract.status === 'ACTIVE' && category === 'PHONE_USED'` — หมวดอยู่ชั้นนี้ ไม่ใช่ใน status)
- `after-sales-lookup.service.ts` ส่ง `productCategory` ต่อให้ `computeOutcomes` (`OutcomeInput.productCategory`)

### 3.2 ทางออก (`computeOutcomes`, `after-sales/utils/after-sales-outcomes.util.ts`) — กิ่ง `CASH_SALE`

`OutcomeInput` เพิ่ม `productCategory: ProductCategory | null`. ผลลัพธ์:

| สภาพ | ปุ่ม "เปลี่ยนรุ่นเดิม" | เหตุผล/หมายเหตุใต้ปุ่ม |
|---|---|---|
| มือสอง + `IN_7DAY_DEFECT` + `daysRemainingIn7Day > 0` (วัน 0–6) | **เปิด** (`enabled: true, implemented: true`) | note "ผจก.สาขา ต้องยืนยัน" |
| มือสอง วันที่ 7 (`IN_7DAY_DEFECT` แต่ `daysRemainingIn7Day = 0`) | ปิด | "ครบกำหนด 7 วันแล้ว — ซ่อมเท่านั้น" |
| มือสอง เกิน 7 วัน | ปิด | "เกินกรอบ 7 วันแล้ว — ซ่อมเท่านั้น" (⑥ · ไม่มี managerUp override) |
| เครื่องใหม่ (`PHONE_NEW`) / อุปกรณ์ | ปิด | "เปลี่ยนรุ่นเดิมเฉพาะมือสอง — เครื่องใหม่ส่งเคลมศูนย์" |
| walk-in / ไม่พบใบขาย | ไม่มีปุ่ม (เดิม) | — |

ทางออก "ซ่อม" ของขายสดไม่เปลี่ยน. `switchToRepair` / `rejectSameModel` ใช้กับเคส `CASH_SAME_MODEL_EXCHANGE` ได้ (ขยาย CAS predicate `SAME_MODEL_PENDING_CAS` ให้รับทั้งสอง outcome).

### 3.3 เครื่องทดแทน — ฟังก์ชันตรวจเดียว `assertCashReplacement`

ข้อเท็จจริง: intake (`after-sales-case.service.ts:150–177`) ตรวจ `replacementProductId` เฉพาะ `SAME_MODEL_EXCHANGE`/`PRICED_EXCHANGE` ผ่าน `defect.checkEligibility(contractId, …)` ซึ่งต้องมีสัญญา ⇒ outcome `CASH_SAME_MODEL_EXCHANGE` วันนี้**ไม่ถูกตรวจอะไรเลย** (รับ id เครื่องที่ขายไปแล้วก็ได้) และไม่สร้าง event `OUTCOME_SET` · ส่วน `GET /after-sales/replacement-products?sameModel=1` (`after-sales-exchange.service.ts:587–612`) กรอง `IN_STOCK` + ยี่ห้อ/รุ่น/ความจุของเครื่องเดิม + `PHONE_USED` + สาขา (role ข้ามสาขาเลือก `branchId` ได้) **อยู่แล้ว — ไม่ต้องแก้**

ของใหม่: `assertCashReplacement(client, { sale, caseBranchId, customer }, productId)` ใน `after-sales/utils/` (pure + query) — ใช้ **สองจุด**: intake (`createCase` กิ่ง `isCashSameModel` — บังคับ `replacementProductId` และสร้าง `OUTCOME_SET` เหมือน `isSameModel`) และยืนยัน (ใน tx §5 ข้อ 2). ต้องครบทุกข้อ ไม่มีใครข้ามได้:
`brand`/`model`/`storage` ตรงกับเครื่องเดิมของใบขาย · `category = PHONE_USED` · `status = IN_STOCK` · `deletedAt = null` · `branchId = case.branchId` · `assertSameTestSide(customer, product)` (รั้วข้อมูลทดสอบของการขาย) · ไม่ใช่เครื่องเดิมของใบขายเอง. การจอง: เครื่อง `IN_STOCK` ที่มี `ProductReservation` ยังเป็น `IN_STOCK` (จองบนเว็บไม่แตะสถานะ) ⇒ ตอนยืนยันใช้ `updateMany where status IN_STOCK` + `preemptReservationsInTx(tx, [id])` แบบ `SaleWriterService`

### 3.4 เวลา "ตอนยืนยัน" ของเคสซ่อมที่ซ่อมไม่ได้ (`fromRepair`)

อนุญาตให้ยืนยันเปลี่ยนรุ่นเดิมจากเคส `REPAIR` ของใบขายสดได้ **เฉพาะเมื่อยังอยู่ในกรอบ (วัน 0–6) ณ เวลายืนยัน** (ตรวจซ้ำด้วย `soldAt` ไม่ใช่สถานะที่ snapshot ตอนเปิดเคส) — เกินแล้ว = 400 ข้อความตาม §3.2 (⑥)

## 4. ขั้นตอนของเคส (stage เดิมของ hub §5 — ไม่มี stage ใหม่)

```
เปิดเคส (ใบรับฝาก) ด้วยทางออก CASH_SAME_MODEL_EXCHANGE ─▶ สร้างที่ stage AWAITING_APPROVAL ทันที (เหมือน SAME_MODEL_EXCHANGE ใน `after-sales-case.service.ts` · เลือกเครื่องทดแทนได้ตั้งแต่ตอนนี้)
   · เคส REPAIR ที่ซ่อมไม่ได้ (stage RECEIVED / IN_REPAIR / READY_FOR_PICKUP = `REPAIR_CONFIRM_STAGES` เดิม) ─▶ ยืนยันเปลี่ยนรุ่นเดิมได้เมื่อยังอยู่ในกรอบ (§3.4)
   ─ผจก. ยืนยัน (ลงบัญชี · สลับใบขาย)─▶ READY_FOR_PICKUP (LINE "มารับได้แล้ว" · พิมพ์ 2 ใบได้)
   ─ส่งมอบ─▶ CLOSED (LINE "ปิดเคส" · ประกันใหม่เริ่ม)
AWAITING_APPROVAL ─ปฏิเสธ/เปลี่ยนเป็นซ่อม─▶ (เหมือน SAME_MODEL เดิม)
```

**stage ไม่ใช่สิ่งที่ service เขียนแล้วจบ — ทุกผู้อ่านคำนวณใหม่ด้วย `deriveStage` แล้วเขียนทับ (`reconcileStage` CAS):** `OPEN_EXCHANGE_STAGE` ใน `after-sales/utils/after-sales-stage.util.ts:44` คืน `READY_FOR_PICKUP` เฉพาะเมื่อมี `replacementContractId` ⇒ เคสขายสด (ไม่มีสัญญาใหม่) จะถูกดันกลับเป็น `AWAITING_APPROVAL` ทันทีที่มีคนเปิดดู ถ้าไม่แก้ชุดนี้พร้อมกัน:
- `StageInput` เพิ่ม `replacementSaleId?: string | null` · `OPEN_EXCHANGE_STAGE`: `closedAt → CLOSED` · `replacementContractId || replacementSaleId → READY_FOR_PICKUP` · ไม่งั้น `AWAITING_APPROVAL` (ใช้กับทั้ง `CASH_SAME_MODEL_EXCHANGE` และ `REPAIR` ที่ `repairStatus = REPLACED`)
- `ReconcilableCase` + `RECONCILE_SELECT` (`after-sales-stage-reconcile.ts`) + select ของ `AfterSalesQueryService` (บรรทัด 62 — คอมเมนต์ R7 ชี้ที่เดียวกัน) + `CaseForLine` ของ `after-sales-line.service.ts` เพิ่ม `replacementSaleId`
- marker คือ `replacementSaleId` ที่เขียน**ใน tx เดียวกับการยืนยัน** — ห้ามใช้ `approvedAt` (กิ่งสัญญาผ่อนตั้ง `approvedAt` ตอนจองเคสก่อน engine สำเร็จ — จะทำให้เคสผ่อนขึ้น READY ก่อนมีสัญญาใหม่)
- เทส `after-sales-stage.util.spec` เพิ่มเคส cash 3 แบบ + integration: ยืนยันแล้วเรียก `getCase` ซ้ำ stage ต้องยัง `READY_FOR_PICKUP`

ยกเลิกเคสหลังยืนยัน**ไม่ได้** (เหมือน `SAME_MODEL_EXCHANGE` ที่มีสัญญาใหม่แล้ว) — การย้อนรายการเป็นงานฝ่ายบัญชี (⑦)

## 5. ตอน ผจก. ยืนยัน — `AfterSalesExchangeService.confirmCashSameModel` (route เดิม `POST /after-sales/:id/exchange/confirm` แยกกิ่งด้วย `case.saleId != null && case.contractId == null` — เคสที่มีสัญญาเดินทาง `confirmSameModel` เดิม ไม่เปลี่ยน)

ลำดับ (ธุรกรรม Serializable เดียว — ยกเว้นข้อ 0 และ 8):

0. `assertMgr(user)` (OWNER / BRANCH_MANAGER สาขาเดียวกัน) · โหลดเคส (ต้อง `saleId` และ `source = CASH_SALE` · outcome `CASH_SAME_MODEL_EXCHANGE` (stage ต้องเป็น `AWAITING_APPROVAL`) หรือ `REPAIR` (fromRepair — stage ใน `REPAIR_CONFIRM_STAGES` เดิม) · ยังไม่มี `replacementSaleId`)
1. **CAS จองเคส** บนแถวเคส (`approvedAt`/`approvedById` · stage ที่ยืนยันได้ · `replacementSaleId: null` · `cancelledAt: null` · `approvedAt: null`) — คนที่สองได้ 409 (pattern M4 เดิม) · ล้มระหว่างทาง = ปล่อยการจองคืนเหมือนเดิม
2. ตรวจเงื่อนไข §3.1–3.4 ซ้ำใน tx ด้วยข้อมูลสด: ใบขายยังไม่ถูกลบ/ยกเลิก · `Sale.productId` = เครื่องเดิมของเคส · **สถานะเครื่องเดิมตรงกับที่ใบขายประเภทนั้นตั้งไว้** (`SALE_MAIN_PRODUCT_STATUS[sale.saleType]` — ย้ายแผนที่จาก `sale-void.service.ts:33–40` ไป `sales/services/sale-product-status.util.ts` ให้ใช้ร่วมกัน: `CASH → SOLD_CASH` · `EXTERNAL_FINANCE → SOLD_INSTALLMENT`) · `assertCashReplacement` (§3.3) · กรอบ 7 วัน ณ ตอนนี้ (§3.4)
3. **ต้นทุน**: ต้นทุนเดิม = `SaleCostSnapshot.mainProductCost` ของใบขาย (ยอดที่ลงตอนขาย — **ไม่ใช่** `Product.costPrice` ปัจจุบันซึ่งแก้มือได้) · **ไม่มี snapshot → 400** "ไม่พบต้นทุนที่ลงบัญชีตอนขาย — ให้ฝ่ายบัญชีตรวจก่อน" (snapshot ถูกเขียนโดยผู้เขียนใบขายทั้ง 3 ทาง — POS · แปลงใบจอง · เปิดสัญญา — ตั้งแต่ migration `20261001000000_sale_cost_snapshot` และ prod เป็นข้อมูลทดสอบที่จะล้าง ⇒ ไม่ค้น JE ย้อนหลัง) · ต้นทุนใหม่ = `Product.costPrice` ของเครื่องทดแทน (ตัวเดียวกับที่ POS จะใช้)
4. **ใบขาย** (`Sale`): `productId` → เครื่องทดแทน · `exchangeCaseId` = เคส (คอลัมน์ใหม่ตัวเดียว — เครื่องเดิม/เวลา/ต้นทุนเดิมอ่านจาก `AfterSalesCase.productId` / `approvedAt` / JE metadata) · `SaleCostSnapshot.mainProductCost` → ต้นทุนใหม่ (ผู้อ่าน: กำไรบนหน้าประวัติการขาย `sales-query.service.ts:105–108`) · ประกัน/กรอบ 7 วัน**ยังไม่**เปลี่ยน — เปลี่ยนตอนส่งมอบ §6
5. **สินค้า**: เครื่องเดิม `<สถานะตามใบขาย> → DEFECT_RETURN` (`updateMany where { id, status: expected }` count ≠ 1 → 409) · เครื่องทดแทน `IN_STOCK → <สถานะตามใบขาย>` ด้วย `updateMany where { id, status: 'IN_STOCK', deletedAt: null }` count ≠ 1 → 409 "เครื่องทดแทนถูกขาย/จองไปแล้ว" · `preemptReservationsInTx(tx, [newProductId])`
6. **บัญชี** — `ShopCashExchangeTemplate` ใหม่ (`journal/cpa-templates/shop-cash-exchange.template.ts`, SHOP company, `validatePeriodOpen` SHOP วันนี้):

```
Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง   [ต้นทุนเดิมที่ลงตอนขาย]   ← เครื่องเดิมกลับเข้าคลังที่ต้นทุนเดิม
   Cr S50-1102 ต้นทุนขาย-มือถือมือสอง                 [ต้นทุนเดิม]
Dr S50-1102 ต้นทุนขาย-มือถือมือสอง     [ต้นทุนเครื่องทดแทน]     ← ต้นทุนขายของบิลนี้เปลี่ยนเป็นของเครื่องทดแทน
   Cr S11-2002 สินค้าคงคลัง-มือถือมือสอง              [ต้นทุนเครื่องทดแทน]
```
   รหัสบัญชีมาจาก `ShopAccountResolver.resolveProductAccounts(category)` ของแต่ละเครื่อง (① ทำให้เป็นมือสองทั้งคู่ แต่ template ไม่ hardcode) · บรรทัดยอด 0 ไม่ลง (ทั้งสองคู่เป็น 0 = ไม่มีรายการ ผลลัพธ์บอก `journalEntryNo: null`) · metadata: `tag: 'SHOP_CASH_EXCHANGE'` · `flow: 'shop-cash-exchange'` · `idempotencyKey: shop-cash-exchange:<caseId>` · `saleId` · `afterSalesCaseId` · `oldProductId` / `newProductId` · `oldCost` / `newCost` · `companyCode: 'SHOP'` · **ไม่ stamp `contractId`** · `reference: sale:<saleId>:exchange:<caseId>` · ตัวอย่างข้อ 10: 10,700.00 / 10,500.00 — รายได้ 13,900 และเงินสดไม่แตะ · ใบไฟแนนซ์นอกที่ JE ขายไม่เคยลง (`externalFinanceAccountsReady` ปิด) ยังลงรายการนี้ตามปกติ — ต้นทุนเดิมมาจาก snapshot ไม่ใช่ JE
7. **เคส**: `outcome = CASH_SAME_MODEL_EXCHANGE` · `replacementProductId` · `replacementSaleId = sale.id` (marker ของ `deriveStage` — §4) · `approvedById/At` · `stage = READY_FOR_PICKUP` · event `APPROVED` note "ยืนยันเปลี่ยนเครื่อง · ใบขาย SL-… · เครื่องทดแทน IMEI …" (+ " · จากใบซ่อม (ซ่อมไม่ได้)") · เคสซ่อมเดิม (fromRepair): **เมธอดใหม่ `RepairTicketsService.markReplacedBySale(ticketId, { caseNumber }, user, tx)`** — `markReplaced` เดิม (`repair-ticket-lifecycle.service.ts:626`) บังคับ `replacementContractId: string` และเขียนลง FK `@unique` ไป Contract จึงใช้กับขายสดไม่ได้ · ตัวใหม่: CAS `OPEN/IN_PROGRESS/READY_FOR_PICKUP → REPLACED` + `replacedAt` + `RepairStatusLog` note "เปลี่ยนรุ่นเดิมบนใบขายสด · เคส AS-…" · `replacementContractId` คง null · **audit หลัง commit** (ตัวเดิมเรียก `audit.log` ใน tx — ห้ามก็อปแบบ) · ไม่สร้างเอกสารค่าซ่อม
8. **หลัง commit**: `AuditService.log` `AFTER_SALES_CASH_EXCHANGE_CONFIRMED` (entity `after_sales_case` · newValue: saleId, saleNumber, oldProductId, newProductId, journalEntryNo, oldCost/newCost **เฉพาะเมื่อ `canSeeCost(user.role)`**) · LINE จังหวะ READY (fire-and-forget เหมือนเดิม)

ข้อผิดพลาด: `P2002` (idempotency ของ JE / unique) และ `P2034` → 409 ภาษาไทย (pattern `SaleVoidService`) · งวดบัญชี SHOP ปิด**และพ้นช่วงผ่อนผัน** → 400 ข้อความเดิมของ `validatePeriodOpen` (เดือนปัจจุบันที่ปิดแล้วยังลงได้ถึงวันสิ้นเดือน + `period_grace_days` — กติกาทั้งระบบ ไม่ได้บล็อกเฉพาะทางนี้ · ruling T15 ตอนทำ PR 5) · ทุกข้อล้ม = ทั้งธุรกรรมย้อนกลับ + ปล่อยการจองเคส

## 6. ตอนส่งมอบ — `deliver` กิ่งขายสด (route เดิม `POST /after-sales/:id/exchange/deliver`)

- เงื่อนไข: outcome `CASH_SAME_MODEL_EXCHANGE` + `replacementSaleId` · stage `READY_FOR_PICKUP` · ผู้ใช้ทุก role ที่เข้าถึงเคสได้ (เหมือน deliver เดิม — ไม่ต้องเป็น ผจก.) · `deliver` เดิม (`after-sales-exchange.service.ts:281–284`) ปฏิเสธเคสที่ไม่มี `replacementContractId` — แยกกิ่งด้วย `saleId`
- DTO ใหม่ `CashDeliverDto` (optional): `accessories` (กล่อง/สายชาร์จ/เคส/อื่น ๆ ที่ส่งมอบ — พิมพ์บนใบที่ 2) · `note`
- ใน tx: **ประกันร้าน + กรอบ 7 วันเริ่มใหม่**: `Sale.shopWarrantyStartDate = now` **เสมอ** (เป็นฐานกรอบ 7 วัน §3.1) · `shopWarrantyEndDate = days != null ? now + days : null` โดย `days = resolveShopWarrantyDays(เครื่องทดแทน, SystemConfig SHOP_WARRANTY_DAYS)` (`warranty/shop-warranty-policy.ts` — คืน `null` เมื่อไม่ใช่ PHONE_USED หรือตั้ง 0) · ย้าย `SaleWriterService.resolveSaleShopWarranty` (private) ออกเป็น helper ใช้ร่วม `sales/services/sale-shop-warranty.util.ts` ให้ POS และส่งมอบใช้ตัวเดียวกัน · เคส `closedAt`, `stage = CLOSED`, events `DELIVERED` + `CLOSED`
- หลัง commit: audit `AFTER_SALES_CASH_EXCHANGE_DELIVERED` · LINE จังหวะ CLOSED — `AfterSalesLineService.loadReplacement` (`after-sales-line.service.ts:233–256`) อ่านวันหมดประกันจากสัญญาเท่านั้น ⇒ เพิ่มกิ่ง `c.saleId` → `Sale.shopWarrantyEndDate` ไม่งั้นข้อความปิดเคสพิมพ์ประกัน "—"
- ไม่มีรายการบัญชีตอนส่งมอบ (ลงไปแล้วตอนยืนยัน)

## 7. เอกสาร 2 ใบ (`after-sales/documents/*` — renderer และฟอนต์เดิมของ PR 4)

| ใบ | kind | route | พิมพ์ได้เมื่อ | เนื้อหา (กระดาน 13/14) |
|---|---|---|---|---|
| ใบรับคืนเครื่อง (ใบที่ 1/2) | `RETURN` | `GET /after-sales/:id/return.pdf` | stage `READY_FOR_PICKUP` / `CLOSED` ของเคส `CASH_SAME_MODEL_EXCHANGE` | หัวเอกสาร + เลขเคส · วันที่รับคืน (= `closedAt` ถ้าปิดแล้ว ไม่งั้นวันนี้) · อ้างอิงใบขาย (เลข+วันที่) · สาขา · พนักงานผู้รับคืน · ลูกค้า (ผู้ส่งคืน) · ใบขาย (เลข · วันซื้อ · ราคาขาย "ไม่เปลี่ยน") · ตารางเครื่องที่รับคืน (เครื่อง/IMEI/Serial) · อุปกรณ์ที่คืนมาด้วย (จากใบรับฝาก) + Find My · เหตุผลการรับคืน ("เครื่องมีปัญหาภายใน 7 วันนับจากวันซื้อ (แจ้ง … · วันที่ n) — อาการ: …" / "ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมแทน (ใบซ่อม RT-…)") · สภาพเครื่อง ณ วันรับคืน (อ้างรูปตอนซื้อ/ตอนรับฝาก + ผู้ยืนยัน) · ผลของการรับคืน 3 บรรทัด (ไม่มีคืนเงิน/เงินเพิ่ม · เครื่องเป็นของร้าน รอส่งเคลม · ใบขายเดิมยังเป็นหลักฐานการซื้อ) · ข้อความรับทราบ · ลายเซ็น ลูกค้า (ผู้ส่งคืน) / พนักงานผู้รับคืน · footer "ไม่ใช่ใบเสร็จ/ใบกำกับภาษี" |
| ใบส่งมอบเครื่องทดแทน (ใบที่ 2/2) | `REPLACEMENT_HANDOVER` | `GET /after-sales/:id/handover.pdf` (route เดิม — เคสขายสดให้ใบนี้แทน `HANDOVER_CASH_UNSUPPORTED_MSG`) | เดียวกัน | หัวเอกสาร · เลขเคส · วันที่ส่งมอบ · อ้างอิงใบขาย · อ้างอิงใบรับคืน (ใบที่ 1 วันเดียวกัน) · พนักงานผู้ส่งมอบ · ลูกค้า (ผู้รับมอบ) · ใบขาย (เลข · ราคาขาย "เท่าเดิม" · การชำระ "ชำระแล้วตามใบขายเดิม ไม่มีเงินเปลี่ยนมือ") · ตาราง เครื่องเดิม (รับคืนแล้ว) / เครื่องที่ส่งมอบ · อุปกรณ์ที่ส่งมอบ · ค่าใช้จ่าย "ไม่มี" + เหตุผล · ประกันของเครื่องที่ส่งมอบ (ประกันร้าน 60 วัน ถึง … · กรอบ 7 วัน ถึง … · ประกันศูนย์ "— (มือสอง ไม่มี)") · ผลต่อใบขาย 2 บรรทัด · ข้อความรับทราบ · ลายเซ็น · footer "ใบขายเดิมยังเป็นหลักฐานการซื้อ" |
| ทั้งสองใบ | — | `GET /after-sales/:id/exchange-docs.pdf` | เดียวกัน | PDF เดียว 2 หน้า (หน้า 1 = RETURN · หน้า 2 = REPLACEMENT_HANDOVER) — ปุ่ม "พิมพ์ใบรับคืน + ใบส่งมอบ (2 ใบ)" ใช้ route นี้ |

- **กลไก 2 หน้า:** `render()` วันนี้ = หนึ่ง kind → หนึ่ง `AfterSalesDoc` → `buildAfterSalesDocHtml(doc)` → `htmlToPdf` หนึ่งไฟล์ (`after-sales-document.service.ts:68–86`) ⇒ เพิ่ม `renderCashExchangeDocs(caseId, user)`: compose ทั้งสองเอกสารจาก `DocSource` เดียว แล้ว `buildAfterSalesDocHtml` รับ `AfterSalesDoc | AfterSalesDoc[]` คั่นด้วย `page-break-after: always` (ไม่ merge PDF ไม่เพิ่ม dependency) · `recordPrinted` ลง event `PRINTED` ใบเดียว note "พิมพ์ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน" (พิมพ์แยกใบ = note ของใบนั้น) กันซ้ำ 5 นาทีเหมือนเดิม
- `AfterSalesDocKind` เป็น TS union ใน `after-sales-document.service.ts:20` (ไม่ใช่ Prisma enum) → เพิ่มสองค่า + `DOC_NOTE` · web `CaseDocKind` ตาม
- ไม่มีเลขที่เอกสารใหม่ (⑧) · ไม่มีช่องราคาเครื่อง/ต้นทุนบนเอกสาร · ถ้อยคำบนเอกสารคงกติกา PR 4 ("ไม่ใช้คำว่า รับเครื่อง") · กรณี "ข้ามกรอบ 7 วัน" ไม่มีบนใบ (⑥) · ใบรับฝากของเคสยังพิมพ์ได้
- `after-sales-doc-compose.ts`: ฟังก์ชันใหม่ `composeReturnDoc(source)` / `composeReplacementHandoverDoc(source)` (pure · ทดสอบถ้อยคำด้วย jest เหมือน `doc-compose.spec.ts`) · `handoverBlockReason` คืน `null` ให้เคสขายสดที่ `READY_FOR_PICKUP`/`CLOSED` · ลบ `HANDOVER_CASH_UNSUPPORTED_MSG` ทั้ง api และ web (`pages/after-sales/after-sales.ts`)

## 8. เครื่องเดิมหลังเปลี่ยน — "รอเคลม" (`DEFECT_RETURN`) → ตัดจำหน่ายได้ (③)

- `stock-adjustments.service.ts:326–327`: เงื่อนไข `REQUESTABLE_STATUSES.EXIT.includes(status) || (reason === 'WRITE_OFF' && status === 'DAMAGED')` ขยายเป็น `… || (reason === 'WRITE_OFF' && (status === 'DAMAGED' || status === 'DEFECT_RETURN'))` + ข้อความแจ้งสถานะที่ขอได้ (บรรทัด 335–336) · `FOUND_POLICY.DEFECT_RETURN` (บรรทัด 145) คง `toInStock: false` — แก้ hint เป็น "เครื่องรอเคลมผู้จัดจำหน่าย — เคลมไม่ได้ให้ขอตัดจำหน่าย" · เหตุผลอื่น (LOST/DAMAGED) ไม่เปิด · `assertProductNotHeld(…, 'STOCK_ADJUST')` ผ่านอยู่แล้ว (`DEFECT_RETURN` ไม่อยู่ใน `HELD_STATUS_REMEDY` · ไม่มีสัญญาถือ)
- เจ้าของอนุมัติ → `ShopStockWriteOffTemplate` เดิม `Dr S53-1102 / Cr S11-2002` ที่ `costPrice` — `resolveBookedInventory` พบการรับเข้าเดิม (ใบรับของ/รับซื้อ) และยอดบัญชีของเครื่องเดิมถูกคืนเข้า S11-2002 ที่ต้นทุนเดิมโดย §5 ข้อ 6 แล้ว ⇒ สมดุล (`costPrice` ของเครื่องเดิมไม่ถูกแตะ) · ไม่ตรงกัน (เช่น `costPrice` ถูกแก้มือ) → Sentry `booked-amount-mismatch` เดิม · เครื่องที่ไม่เคยลงบัญชีรับเข้า (ยกมา/เพิ่มมือ) = ตัดโดยไม่มี JE + Todo แจ้งบัญชี ตามกติกาก้อน 3 เดิม
- หน้าจอเคส/ใบขายแสดงป้าย "รอเคลมผู้จัดจำหน่าย" + ลิงก์ไปเมนูตัดสินค้า · "ได้เครื่องแทน" ไม่ทำรอบนี้ (เครื่องเดิมค้าง `DEFECT_RETURN` จนกว่ามีงานนั้น — เป็นช่องว่างเดิมของสัญญาผ่อนเช่นกัน)

## 9. ด่าน / สิทธิ์ / ผลข้างเคียง

- **ยกเลิกใบขาย** (`SaleVoidService`): ด่านใหม่ **G9** ต่อจาก G1 (`sale-void.service.ts:195`) — `sale.exchangeCaseId != null` → 400 "ใบขายนี้เปลี่ยนเครื่องแล้ว (เคส AS-…) — ยกเลิกใบขายไม่ได้ ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น" (⑦) · หน้าประวัติการขายซ่อนปุ่มยกเลิกเมื่อมี `exchangeCaseId` · (JE สลับต้นทุน stamp `saleId` จึงอยู่ใน sweep ของ void โดยโครงสร้าง — G9 ปิดทางก่อนถึง)
- **ลบ/แก้ IMEI/ตัดสินค้า** เครื่องทดแทน (`SOLD_CASH`/`SOLD_INSTALLMENT`) และเครื่องเดิม (`DEFECT_RETURN`): `product-hold.util` เดิม · ไม่เพิ่มด่าน
- **ต้นทุนบนจอ**: ตัวเลขต้นทุน (เก่า/ใหม่ · รายการบัญชีในกล่องยืนยัน · `journalEntryNo` ยังเห็นได้) ตัดฝั่ง server ด้วย `canSeeCost(role)` ตัวเดิม (`products/cost-visibility.util.ts` — deny-list: ทุก role ยกเว้น SALES) ไม่เขียนกติกาชุดที่สอง
- **สิทธิ์**: ยืนยัน = OWNER / BM สาขาเดียวกัน (`assertMgr`) · ส่งมอบ/พิมพ์ = ตาม role เดิมของเคส · ตัดจำหน่าย = ผู้ขอ SALES/BM/OWNER · เจ้าของอนุมัติ (ก้อน 3)
- **หน้าใบขาย** (`/sales` รายละเอียด): ป้าย "เปลี่ยนเครื่อง <วันที่> (เคส AS-…)" (วันที่ = `case.approvedAt`) · แสดงเครื่องเดิม IMEI (= `case.productId`) · เครื่องปัจจุบัน = ทดแทน · ปุ่มยกเลิกซ่อน · รายงานยอดขายตามรุ่น/เครื่องใช้ `productId` ปัจจุบัน (ยอดไม่เปลี่ยนเพราะรุ่นเดียวกัน)
- **สรุปเงินหน้าร้านรายวัน / สมุดเงิน**: ไม่มีเงินเคลื่อน ⇒ ไม่มีแถว `shop_tenders` ไม่มี JE แยกยอด
- **ไฟแนนซ์นอก** (`EXTERNAL_FINANCE`): รายการบัญชีเดียวกัน (ไม่แตะ `S11-3101`/`FinanceReceivable`) · สถานะเครื่องตาม `SALE_MAIN_PRODUCT_STATUS` (= `SOLD_INSTALLMENT`) ทั้งด่านและการ flip · ใบส่งมอบบรรทัด "การชำระ" = "ตามใบขายเดิม (ไฟแนนซ์ …)"
- **ของแถม** (`bundleProductIds`): ไม่แตะ ไม่พิมพ์
- **LINE**: ไม่มีแม่แบบใหม่ — `after-sales-line-copy.util` จัด `CASH_SAME_MODEL_EXCHANGE` เข้ากิ่งเดียวกับ `SAME_MODEL_EXCHANGE` อยู่แล้ว และถ้อยคำกิ่งนั้นไม่มีคำว่า "สัญญา" (ตรวจแล้ว) · งานจริงอยู่ที่ `loadReplacement` (§6)
- **การ์ดสรุป**: `EXCHANGE_OUTCOMES` (`after-sales-query.service.ts:168`) เพิ่ม `CASH_SAME_MODEL_EXCHANGE` ให้ `openExchange`/`exchanges` นับเคสขายสด (สมมติฐาน §1)
- **เปลี่ยนซ้ำ**: เครื่องทดแทนมีปัญหาอีกภายในกรอบนับจากวันส่งมอบ → เปิดเคสใหม่บนใบขายเดิมได้ (เครื่องเดิมของเคสใหม่ = เครื่องทดแทนครั้งก่อน) · `exchangeCaseId` เก็บเคสล่าสุด ประวัติครบอยู่ในเคส/audit/JE

## 10. ข้อมูล (Prisma · migration `<timestamp>_sale_exchange_case` — เพิ่มคอลัมน์ nullable ตัวเดียว)

```
Sale
  exchangeCaseId  String?  @map("exchange_case_id")   // เคสหลังการขายครั้งล่าสุดที่สลับเครื่องบนใบนี้  @@index
```
ไม่เพิ่ม: `exchangedFromProductId` (= `AfterSalesCase.productId`) · `exchangedAt` (= `AfterSalesCase.approvedAt`) · คอลัมน์ประวัติบน `SaleCostSnapshot` (ต้นทุนเดิมอยู่ใน JE metadata `oldCost`) · `AfterSalesCase` (`replacementSaleId` / `replacementProductId` มีแล้ว) · `AfterSalesEventKind` · `RepairTicket` · ไม่มี backfill (prod ไม่มีเคสขายสดที่เปลี่ยนเครื่อง)

## 11. หน้าจอ (ตาม mockup กระดาน 11–14)

- `OutcomePicker`: ปุ่ม "เปลี่ยนรุ่นเดิม" ของขายสดเปิดตาม §3.2 (ข้อความใต้ปุ่มจาก API) · intake ของขายสดเลือกเครื่องทดแทนได้ตั้งแต่เปิดเคส (`ReplacementProductPicker` เดิม — endpoint เดิมกรองครบแล้ว §3.3)
- หน้าเคส: `ExchangeCard` รองรับขายสด (ใบขายแทนสัญญา · "ราคาขายเท่าเดิม · ไม่มีเงินเปลี่ยนมือ" · ประกันนับใหม่จากวันส่งมอบ) — `pages/after-sales/after-sales.ts` อ้าง `replacementContract` 18 จุด ต้องมีกิ่ง `sale` คู่กัน · `ConfirmExchangeDialog` กิ่งขายสด: picker · ติ๊กตรวจ 2 ข้อ · กล่อง "รายการบัญชีที่จะลง" (เฉพาะ role ที่เห็นต้นทุน) · ข้อความ "เมื่อกดยืนยัน ระบบจะทำให้" 5 ข้อ (กระดาน 11) · ปุ่มหลัก "ยืนยันเปลี่ยนเครื่อง"
- stage `READY_FOR_PICKUP`: ปุ่มหลัก "ส่งมอบเครื่องทดแทน" + ปุ่มรอง "พิมพ์ใบรับคืน + ใบส่งมอบ (2 ใบ)" · กล่องส่งมอบ (กระดาน 12): ปุ่มพิมพ์ 2 ใบ · ติ๊ก 2 ข้อ (ลูกค้าตรวจ/เซ็นแล้ว) · อุปกรณ์ที่ส่งมอบ · ปุ่ม "ยืนยันส่งมอบ + ปิดเคส"
- `StepBar` ของ `CASH_SAME_MODEL_EXCHANGE` (มีแล้วใน `AfterSalesCasePage.tsx:82`) ถ้อยคำขั้น 2–4 ตามกระดาน · การ์ดเครื่องเดิมป้าย "รอเคลมผู้จัดจำหน่าย" + ลิงก์เมนูตัดสินค้า
- มือถือ: ปุ่มหลักล่างจอตามกระดาน 7 เดิม

## 12. การทดสอบ (ด่านก่อน merge)

- **jest (mock)**: `after-sales-outcomes.util.spec` กิ่ง CASH_SALE 5 สภาพ (รวมวันที่ 7) + ไม่มี override · `detect-warranty-status.spec` ใบขายใน/นอก 7 วันจาก `soldAt` · เครื่องใหม่ขายสดได้ `IN_7DAY_DEFECT` เหมือนสัญญา (หมวดไม่อยู่ชั้นนี้) · `repair-warranty.service.spec` `forExchange`/`daysRemainingIn7Day` ของใบขาย · `after-sales-stage.util.spec` cash: `replacementSaleId` → READY · `closedAt` → CLOSED · ไม่มี marker → AWAITING · `assert-cash-replacement.spec` ทุกเงื่อนไข §3.3 · `after-sales-case.service.spec` intake CASH ต้องมี `replacementProductId` + สร้าง `OUTCOME_SET` · `shop-cash-exchange.template.spec` golden ข้อ 10 (10,700/10,500 · 4 บรรทัด · metadata · idempotency key · ยอด 0 ข้ามบรรทัด · ทั้งสองศูนย์ไม่ลง) · `exchange-service.spec` confirmCashSameModel (CAS 409 · ไม่มี snapshot = 400 · fromRepair นอกกรอบ = 400 · `EXTERNAL_FINANCE` ใช้ `SOLD_INSTALLMENT` · ปล่อยการจองเมื่อล้ม) + deliver (ประกันใหม่ · `days = null` → end null start ตั้ง · ปิดเคส) · `repair-ticket-lifecycle.spec` `markReplacedBySale` · `sale-void.service.spec` G9 · `stock-adjustments.service.spec` WRITE_OFF จาก DEFECT_RETURN · `doc-compose.spec` ถ้อยคำ 2 ใบ · `line-service.spec` ประกันจาก Sale · web: `OutcomePicker.test` · `ExchangeCard.test` · dialog ขายสด
- **vitest (DB จริง · `after-sales/__tests__/after-sales-cash-exchange.integration.spec.ts` — glob `AFTERSALES_FILES` ครอบแล้ว)**: ขายสดมือสอง 13,900 ต้นทุน 10,700 → เปิดเคส (ทางออกเปิด) → ผจก. ยืนยันด้วยเครื่องทดแทนต้นทุน 10,500 → GL S11-2002 สุทธิ +200 · S50-1102 สุทธิ −200 · S41-1102/เงินสดไม่ขยับ · `Sale.productId` สลับ + `exchangeCaseId` + snapshot 10,500 · สถานะเครื่อง 2 ตัว · เคส READY · **เรียก `getCase` ซ้ำ stage ยัง READY_FOR_PICKUP (reconcile ไม่ดันกลับ)** · → ส่งมอบ → ประกัน/กรอบ 7 วันใหม่ (ลองเปิดเคสที่สองบนใบขายเดิม ได้ทางออกเปลี่ยนรุ่นเดิมอีกครั้งภายในกรอบจากวันส่งมอบ) · PDF 2 หน้า render ได้ (smoke) · ยกเลิกใบขาย = 400 G9 · ขอตัดจำหน่ายเครื่อง DEFECT_RETURN → เจ้าของอนุมัติ → `Dr S53-1102 / Cr S11-2002` 10,700 · ใบ `EXTERNAL_FINANCE` เดินครบ (เครื่องเป็น `SOLD_INSTALLMENT` ทั้งก่อน/หลัง) · เคสเครื่องใหม่ = ปุ่มปิด · วันที่ 7 = ปุ่มปิด · เกิน 7 วัน = ปุ่มปิด + confirm 400 · ยืนยันซ้อน 2 คน = 409 · งวด SHOP ของเดือนปัจจุบันที่ปิดแล้ว = ยังยืนยันได้ในช่วงผ่อนผัน + JE ลง (เทส 10 ปักพฤติกรรมจริง — ruling T15)
- **E2E**: smoke เปิดเคสขายสด → ปุ่มเปลี่ยนรุ่นเดิมเปิด (optional ถ้ามี fixture ขายสดอยู่แล้ว)
- ไม่แก้ golden เดิมของ `ShopCashSaleTemplate` / defect-exchange / after-sales PR 1–4

## 13. ไม่ทำใน PR นี้ (บันทึกไว้)

- ผลเคลม "ได้เครื่องแทนจากผู้จัดจำหน่าย" (IMEI ใหม่เข้าคลังที่ต้นทุนเดิม) — งานรอบหน้า
- LIFF ให้ลูกค้าดู/ดาวน์โหลดเอกสาร 2 ใบ
- การย้อนรายการเปลี่ยนเครื่อง (ยกเลิกใบขาย/ยกเลิกเคสหลังยืนยัน) — ฝ่ายบัญชีแก้มือ
- เปลี่ยนรุ่นเดิมของเครื่องใหม่ขายสด (①) และการข้ามกรอบ 7 วัน (⑥)
- `markReplaced` เดิมเรียก `audit.log` ใน tx (บั๊กเดิมของสัญญาผ่อน) — ไม่แก้ในนี้ บันทึกไว้

## 14. Rollout

migration เพิ่มคอลัมน์ nullable ตัวเดียว · ไม่มี backfill · forward-only · bump `apps/web/package.json` · กติกาบัญชี: เพิ่มหัวข้อ "เปลี่ยนรุ่นเดิมขายสด (PR 5 · ข้อ 10)" ใน `.claude/rules/accounting.md` (ตาราง SHOP templates + flow/metadata + ด่าน G9 + ตัดจำหน่ายจาก DEFECT_RETURN) · ผู้ตรวจอิสระอ่านทั้งสาขาก่อน push · merge รอเจ้าของ

## 15. ผลตรวจทานร่าง 1 → ร่าง 2 (`/scrutinize` 12/10)

| # | พบ | แก้ที่ |
|---|---|---|
| 1 | `deriveStage` ดันเคสขายสดกลับ AWAITING_APPROVAL (ไม่มี `replacementContractId`) | §4 ย่อหน้า stage · §5 ข้อ 7 · §12 |
| 2 | ไฟแนนซ์นอก hardcode `SOLD_CASH` และ JE-scan ใช้ key ของขายสด | §5 ข้อ 2/5 · §9 |
| 3 | intake ไม่ตรวจเครื่องทดแทนของเคสขายสด · `replacementProducts` กรองครบอยู่แล้ว | §3.3 |
| 4 | `markReplaced` ต้องมีสัญญา | §5 ข้อ 7 · §13 |
| 5 | หมวดเครื่องถูกใส่ใน `detectWarrantyStatus` ผิดชั้น | §3.1 |
| 6 | JE-scan · คอลัมน์ประวัติ 4 ตัว ไม่มีผู้อ่าน | §5 ข้อ 3/4 · §10 |
| 7 | วันที่ 7 กำกวม | §1 สมมติฐาน · §3.2 |
| 8 | LINE ปิดเคสอ่านประกันจากสัญญาเท่านั้น | §6 |
| 9 | PDF 2 หน้า ไม่มีกลไก | §7 |
| 10 | การ์ดสรุปไม่นับเคสขายสด | §1 สมมติฐาน · §9 |
