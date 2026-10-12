# หลังการขาย PR 5 — เปลี่ยนรุ่นเดิมสำหรับใบขายสด (`CASH_SAME_MODEL_EXCHANGE`)

- สถานะ: **สเปกร่าง 1 (2026-10-12) — รอเจ้าของรีวิว ก่อนเขียนแผน**
- ต่อยอดจาก: `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` §10 (ข้อเสนอที่เจ้าของไม่แย้ง) · คำตอบฝ่ายบัญชีฉบับรวม **ข้อ 10** (30/09/2569: 10.1 รายการบัญชีถูกต้อง · 10.2 ต้องมี "ใบรับคืน" และ "ใบส่งมอบเครื่องทดแทน" อ้างเลขที่ใบขายเดิม)
- Mockup ที่เจ้าของเคาะแล้ว 12/10: canvas `https://claude.ai/artifact/SoThf1rbZEaxas5KJgudxp` กระดาน **11–14** (+ โน้ต s6/s7)
- โค้ดที่อ้างในสเปกนี้อ่านจาก `origin/main` `984b7a709` (worktree `BESTCHOICE-after-sales-pr5`)

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

สมมติฐานอื่นที่สเปกใช้ (แก้ได้ตอนรีวิว): นับ 7 วันจาก**วันขาย** (ปฏิทินไทย รวมวันขาย — สูตรเดียวกับ `DEFECT_WINDOW_DAYS` ของสัญญาผ่อน) · เครื่องทดแทนต้องอยู่สต๊อกพร้อมขาย**สาขาเดียวกับเคส** · ผจก.สาขา/เจ้าของเป็นผู้ยืนยัน (เหมือน `assertMgr` เดิม) · ของแถมในบิลไม่แตะ · ใบขายไฟแนนซ์นอก (`EXTERNAL_FINANCE`) เข้าข่ายเหมือนขายสด (คำตัดสิน D2 ของ hub) · เปลี่ยนซ้ำได้ด้วยเคสใหม่บนใบขายเดิม (นับ 7 วันจากวันส่งมอบครั้งก่อน)

## 2. สรุปภาษาง่าย

ลูกค้าซื้อมือสองเงินสด ภายใน 7 วันเครื่องมีปัญหา → พนักงานเปิดเคส "แจ้งปัญหาเครื่อง" เลือกทางออก "เปลี่ยนรุ่นเดิม" (ปุ่มที่วันนี้ปิดไว้ "รอกติกาบัญชี") → ผจก.สาขากด **ยืนยันเปลี่ยนเครื่อง** พร้อมเลือกเครื่องทดแทนรุ่น/ความจุเดิมจากสต๊อกสาขา → ระบบสลับเครื่องบนใบขายเดิม ลงบัญชีสลับต้นทุน เครื่องเดิมกลายเป็นของร้าน "รอเคลม" ส่ง LINE "มารับได้แล้ว" → ลูกค้ามารับ พนักงานกด **ส่งมอบ** พิมพ์ **ใบรับคืนเครื่อง + ใบส่งมอบเครื่องทดแทน** ให้ลูกค้าเซ็น ประกันร้านและกรอบ 7 วันเริ่มใหม่ → ปิดเคส · เครื่องเดิมถ้าเคลมไม่ได้ ขอตัดจำหน่ายที่เมนูตัดสินค้า (เจ้าของอนุมัติ)

**ไม่เปลี่ยน:** ราคาขาย · รายได้ · เงินสด · เลขที่ใบขาย · ของแถม · สัญญาผ่อน/เครื่องยนต์ defect-exchange · LINE 3 จังหวะ (ใช้ข้อความเดิม) · ใบเสร็จ POS เดิม

## 3. เงื่อนไข (eligibility) — แหล่งเดียว

### 3.1 สิทธิ์ 7 วันของใบขาย (ของใหม่ — วันนี้ระบบไม่นับให้ขายสด)

ข้อเท็จจริง: `detectWarrantyStatus` (`repair-tickets/utils/detect-warranty-status.ts`) คืน `IN_7DAY_DEFECT` เฉพาะเมื่อมี `contract.deviceReceivedAt` · `RepairWarrantyService` ใส่ `deviceReceivedAt: null` ให้ใบขายที่ไม่มีสัญญา (บรรทัด ~188 "สิทธิ์เปลี่ยนเครื่อง 7 วันผูกกับสัญญาเท่านั้น") ⇒ ใบขายสดไม่เคยเป็น `IN_7DAY_DEFECT` และ `computeOutcomes` ปิดปุ่มด้วย `within7 = false`

การแก้:
- `DetectWarrantyInput.sale` เพิ่ม `soldAt?: Date | null` และ `category?: ProductCategory | null` · `detectWarrantyStatus`: ไม่มี `contract.deviceReceivedAt` + มี `sale.soldAt` + `sale.category === 'PHONE_USED'` → ผลต่างวันปฏิทินไทย (`toBkkCalendarDay(now) − toBkkCalendarDay(soldAt)`) ≤ 7 ⇒ `IN_7DAY_DEFECT` — **สูตรเดียวกับขา `deviceReceivedAt` ทุกตัวอักษร** (วันขาย = วัน 0 · ถึงวัน 7) (ลำดับความสำคัญเดิม: 7 วัน → ประกันร้าน → ประกันศูนย์ → หมด) · **เครื่องใหม่ (`PHONE_NEW`) ขายสดไม่เข้าเงื่อนไขนี้** — สถานะเดิม (ประกันร้าน/ศูนย์) และ payer ของการซ่อมไม่เปลี่ยน
- `soldAt` ของใบขาย = `Sale.shopWarrantyStartDate ?? Sale.createdAt` (หลังเปลี่ยนเครื่อง `shopWarrantyStartDate` ถูกตั้งเป็นวันส่งมอบ ⇒ กรอบ 7 วันของเครื่องทดแทนนับใหม่โดยไม่ต้องมีคอลัมน์เพิ่ม — ⑤)
- `RepairWarrantyService` (lookup ทั้งทาง IMEI และทางลูกค้า): ส่ง `soldAt` + `category` ให้ใบขายที่ไม่มีสัญญา · `daysRemainingIn7Day` คำนวณด้วย helper เดิม (`sevenDayDefect`) จาก `soldAt` · `eligibility.forExchange` ของใบขาย = `IN_7DAY_DEFECT && category PHONE_USED`
- `after-sales-lookup.service.ts` ส่ง `productCategory` ต่อให้ `computeOutcomes`

### 3.2 ทางออก (`computeOutcomes`, `after-sales/utils/after-sales-outcomes.util.ts`) — กิ่ง `CASH_SALE`

`OutcomeInput` เพิ่ม `productCategory`. ผลลัพธ์:

| สภาพ | ปุ่ม "เปลี่ยนรุ่นเดิม" | เหตุผล/หมายเหตุใต้ปุ่ม |
|---|---|---|
| มือสอง + `IN_7DAY_DEFECT` + `daysRemainingIn7Day > 0` | **เปิด** (`enabled: true, implemented: true`) | note "ผจก.สาขา ต้องยืนยัน" |
| มือสอง เกิน 7 วัน | ปิด | "เกินกรอบ 7 วันแล้ว — ซ่อมเท่านั้น" (⑥ · ไม่มี managerUp override) |
| เครื่องใหม่ (`PHONE_NEW`) / อุปกรณ์ | ปิด | "เปลี่ยนรุ่นเดิมเฉพาะมือสอง — เครื่องใหม่ส่งเคลมศูนย์" |
| walk-in / ไม่พบใบขาย | ไม่มีปุ่ม (เดิม) | — |

ทางออก "ซ่อม" ของขายสดไม่เปลี่ยน. `switchToRepair` / `rejectSameModel` ใช้กับเคส `CASH_SAME_MODEL_EXCHANGE` ได้ (ขยาย CAS predicate `SAME_MODEL_PENDING_CAS` ให้รับทั้งสอง outcome).

### 3.3 เครื่องทดแทน (`replacementProducts` + ตรวจซ้ำตอนยืนยัน)

ต้องครบทุกข้อ ไม่มีใครข้ามได้: `brand`/`model`/`storage` ตรงกับเครื่องเดิม · `category = PHONE_USED` · `status = IN_STOCK` · `deletedAt = null` · `branchId = case.branchId` · ไม่ติดจอง/ของแถม (`assertProductNotHeld` ไม่จำเป็น — เครื่อง `IN_STOCK` ที่ถูกจองจะเป็น `RESERVED` อยู่แล้ว; ตอนยืนยันใช้ compare-and-set `updateMany where status IN_STOCK` + `preemptReservationsInTx` แบบ `SaleWriterService`) · `assertSameTestSide(customer, product)` (รั้วข้อมูลทดสอบของการขาย) · `replacementProducts` endpoint เดิมรับ `sameModel=1` อยู่แล้ว — เพิ่มตัวกรอง `category`/`branch` เมื่อเคสเป็นขายสด

### 3.4 เวลา "ตอนยืนยัน" ของเคสซ่อมที่ซ่อมไม่ได้ (`fromRepair`)

อนุญาตให้ยืนยันเปลี่ยนรุ่นเดิมจากเคส `REPAIR` ของใบขายสดได้ **เฉพาะเมื่อยังอยู่ในกรอบ 7 วัน ณ เวลายืนยัน** (ตรวจซ้ำด้วย `soldAt` ไม่ใช่สถานะที่ snapshot ตอนเปิดเคส) — เกินแล้ว = 400 "เกินกรอบ 7 วันแล้ว — ซ่อมเท่านั้น" (⑥)

## 4. ขั้นตอนของเคส (stage เดิมของ hub §5 — ไม่มี stage ใหม่)

```
เปิดเคส (ใบรับฝาก) ด้วยทางออก CASH_SAME_MODEL_EXCHANGE ─▶ สร้างที่ stage AWAITING_APPROVAL ทันที (เหมือน SAME_MODEL_EXCHANGE ใน `after-sales-case.service.ts` · เลือกเครื่องทดแทนได้ตั้งแต่ตอนนี้)
   · เคส REPAIR ที่ซ่อมไม่ได้ (stage RECEIVED / IN_REPAIR / READY_FOR_PICKUP = `REPAIR_CONFIRM_STAGES` เดิม) ─▶ ยืนยันเปลี่ยนรุ่นเดิมได้เมื่อยังอยู่ในกรอบ 7 วัน (§3.4)
   ─ผจก. ยืนยัน (ลงบัญชี · สลับใบขาย)─▶ READY_FOR_PICKUP (LINE "มารับได้แล้ว" · พิมพ์ 2 ใบได้)
   ─ส่งมอบ─▶ CLOSED (LINE "ปิดเคส" · ประกันใหม่เริ่ม)
AWAITING_APPROVAL ─ปฏิเสธ/เปลี่ยนเป็นซ่อม─▶ (เหมือน SAME_MODEL เดิม)
```

ยกเลิกเคสหลังยืนยัน**ไม่ได้** (เหมือน `SAME_MODEL_EXCHANGE` ที่มีสัญญาใหม่แล้ว) — การย้อนรายการเป็นงานฝ่ายบัญชี (⑦)

## 5. ตอน ผจก. ยืนยัน — `AfterSalesExchangeService.confirmCashSameModel` (route เดิม `POST /after-sales/:id/exchange/confirm` แยกกิ่งด้วย `case.saleId`)

ลำดับ (ธุรกรรม Serializable เดียว — ยกเว้นข้อ 0 และ 8):

0. `assertMgr(user)` (OWNER / BRANCH_MANAGER สาขาเดียวกัน) · โหลดเคส (ต้อง `saleId` และ `source = CASH_SALE` · outcome `CASH_SAME_MODEL_EXCHANGE` (stage ต้องเป็น `AWAITING_APPROVAL`) หรือ `REPAIR` (fromRepair — stage ใน `REPAIR_CONFIRM_STAGES` เดิม) · ยังไม่มี `replacementSaleId`) · กิ่งเลือกจาก `case.saleId != null && case.contractId == null` — เคสที่มีสัญญาเดินทางเดิม `confirmSameModel` ไม่เปลี่ยน
1. **CAS จองเคส** บนแถวเคส (`approvedAt`/`approvedById` · stage ที่ยืนยันได้ · `replacementSaleId: null` · `cancelledAt: null`) — คนที่สองได้ 409 (pattern M4 เดิม) · ล้มระหว่างทาง = ปล่อยการจองคืนเหมือนเดิม
2. ตรวจเงื่อนไข §3.1–3.4 ซ้ำใน tx ด้วยข้อมูลสด (ใบขายยังไม่ถูกลบ/ยกเลิก · ยังไม่มี `exchangeCaseId` ของเคสอื่นที่เปิดอยู่ · เครื่องเดิมยัง `SOLD_CASH` และ `Sale.productId` = เครื่องเดิมของเคส)
3. **ต้นทุน**: ต้นทุนเดิม = `SaleCostSnapshot.mainProductCost` ของใบขาย (ยอดที่ `ShopCashSaleTemplate` ลงตอนขาย — **ไม่ใช่** `Product.costPrice` ปัจจุบันซึ่งแก้มือได้) · ไม่มี snapshot (ใบขายยุคก่อน) → อ่านจากบรรทัด `Cr S11-200x` ของรายการ `shop-cash-sale:<saleId>:<productId>` · ไม่พบทั้งคู่ → 400 "ไม่พบต้นทุนที่ลงบัญชีตอนขาย — ให้ฝ่ายบัญชีตรวจก่อน" (ไม่เดา) · ต้นทุนใหม่ = `Product.costPrice` ของเครื่องทดแทน (ตัวเดียวกับที่ POS จะใช้)
4. **ใบขาย** (`Sale`): `productId` → เครื่องทดแทน · `exchangedFromProductId` = เครื่องเดิม · `exchangedAt` = now · `exchangeCaseId` = เคส · `SaleCostSnapshot.mainProductCost` → ต้นทุนใหม่ · `previousMainProductCost` = ต้นทุนเดิม · `exchangedAt` · (ประกัน/กรอบ 7 วัน**ยังไม่**เปลี่ยน — เปลี่ยนตอนส่งมอบ §6)
5. **สินค้า**: เครื่องเดิม `SOLD_CASH → DEFECT_RETURN` (เหมือน defect-exchange ของสัญญาผ่อน) · เครื่องทดแทน `IN_STOCK → SOLD_CASH` ด้วย `updateMany where { id, status: 'IN_STOCK', deletedAt: null }` count ≠ 1 → 409 "เครื่องทดแทนถูกขาย/จองไปแล้ว" · `preemptReservationsInTx(tx, [newProductId])`
6. **บัญชี** — `ShopCashExchangeTemplate` ใหม่ (`journal/cpa-templates/shop-cash-exchange.template.ts`, SHOP company, `validatePeriodOpen` SHOP วันนี้):

```
Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง   [ต้นทุนเดิมที่ลงตอนขาย]   ← เครื่องเดิมกลับเข้าคลังที่ต้นทุนเดิม
   Cr S50-1102 ต้นทุนขาย-มือถือมือสอง                 [ต้นทุนเดิม]
Dr S50-1102 ต้นทุนขาย-มือถือมือสอง     [ต้นทุนเครื่องทดแทน]     ← ต้นทุนขายของบิลนี้เปลี่ยนเป็นของเครื่องทดแทน
   Cr S11-2002 สินค้าคงคลัง-มือถือมือสอง              [ต้นทุนเครื่องทดแทน]
```
   รหัสบัญชีมาจาก `ShopAccountResolver.resolveProductAccounts(category)` ของแต่ละเครื่อง (① ทำให้เป็นมือสองทั้งคู่ แต่ template ไม่ hardcode) · บรรทัดยอด 0 ไม่ลง (ทั้งสองคู่เป็น 0 = ไม่มีรายการ ผลลัพธ์บอก `journalEntryNo: null`) · metadata: `tag: 'SHOP_CASH_EXCHANGE'` · `flow: 'shop-cash-exchange'` · `idempotencyKey: shop-cash-exchange:<caseId>` · `saleId` · `afterSalesCaseId` · `oldProductId` / `newProductId` · `oldCost` / `newCost` · `companyCode: 'SHOP'` · **ไม่ stamp `contractId`** · `reference: sale:<saleId>:exchange:<caseId>` · ตัวอย่างข้อ 10: 10,700.00 / 10,500.00 — รายได้ 13,900 และเงินสดไม่แตะ
7. **เคส**: `outcome = CASH_SAME_MODEL_EXCHANGE` · `replacementProductId` · `replacementSaleId = sale.id` (ใบขายเดิม — ฟิลด์นี้มีอยู่แล้วตาม hub §5) · `approvedById/At` · `stage = READY_FOR_PICKUP` · event `APPROVED` note "ยืนยันเปลี่ยนเครื่อง · ใบขาย SL-… · เครื่องทดแทน IMEI …" (+ " · จากใบซ่อม (ซ่อมไม่ได้)") · เคสซ่อมเดิม (fromRepair): ปิดใบซ่อมเป็น `REPLACED` แบบเดียวกับ `markReplaced` ของ engine ผ่อน (ไม่สร้างเอกสารค่าซ่อม)
8. **หลัง commit**: `AuditService.log` `AFTER_SALES_CASH_EXCHANGE_CONFIRMED` (entity `after_sales_case` · newValue: saleId, saleNumber, oldProductId, newProductId, journalEntryNo, oldCost/newCost **เฉพาะเมื่อผู้เรียกเห็นต้นทุนได้** — ดู §9) · LINE จังหวะ READY (fire-and-forget เหมือนเดิม)

ข้อผิดพลาด: `P2002` (idempotency ของ JE / unique) และ `P2034` → 409 ภาษาไทย (pattern `SaleVoidService`) · งวดบัญชี SHOP ปิด → 400 ข้อความเดิมของ `validatePeriodOpen` · ทุกข้อล้ม = ทั้งธุรกรรมย้อนกลับ + ปล่อยการจองเคส

## 6. ตอนส่งมอบ — `deliver` กิ่งขายสด (route เดิม `POST /after-sales/:id/exchange/deliver`)

- เงื่อนไข: outcome `CASH_SAME_MODEL_EXCHANGE` · stage `READY_FOR_PICKUP` · ผู้ใช้ทุก role ที่เข้าถึงเคสได้ (เหมือน deliver เดิม — ไม่ต้องเป็น ผจก.)
- DTO ใหม่ `CashDeliverDto` (optional): `accessories` (กล่อง/สายชาร์จ/เคส/อื่น ๆ ที่ส่งมอบ — พิมพ์บนใบที่ 2) · `note`
- ใน tx: `Sale.shopWarrantyStartDate = now` · `shopWarrantyEndDate = now + resolveShopWarrantyDays(เครื่องทดแทน)` (`warranty/shop-warranty-policy.ts` — ตัวเดียวกับที่ POS ใช้) ⇒ กรอบ 7 วันของเครื่องทดแทนเริ่มวันนี้โดยอัตโนมัติ (§3.1) · เคส `closedAt`, `stage = CLOSED`, events `DELIVERED` + `CLOSED`
- หลัง commit: audit `AFTER_SALES_CASH_EXCHANGE_DELIVERED` · LINE จังหวะ CLOSED
- ไม่มีรายการบัญชีตอนส่งมอบ (ลงไปแล้วตอนยืนยัน)

## 7. เอกสาร 2 ใบ (`after-sales/documents/*` — renderer และฟอนต์เดิมของ PR 4)

| ใบ | kind | route | พิมพ์ได้เมื่อ | เนื้อหา (กระดาน 13/14) |
|---|---|---|---|---|
| ใบรับคืนเครื่อง (ใบที่ 1/2) | `RETURN` | `GET /after-sales/:id/return.pdf` | stage `READY_FOR_PICKUP` / `CLOSED` ของเคส `CASH_SAME_MODEL_EXCHANGE` | หัวเอกสาร + เลขเคส · วันที่รับคืน (= `closedAt` ถ้าปิดแล้ว ไม่งั้นวันนี้) · อ้างอิงใบขาย (เลข+วันที่) · สาขา · พนักงานผู้รับคืน · ลูกค้า (ผู้ส่งคืน) · ใบขาย (เลข · วันซื้อ · ราคาขาย "ไม่เปลี่ยน") · ตารางเครื่องที่รับคืน (เครื่อง/IMEI/Serial) · อุปกรณ์ที่คืนมาด้วย (จากใบรับฝาก) + Find My · เหตุผลการรับคืน ("เครื่องมีปัญหาภายใน 7 วันนับจากวันซื้อ (แจ้ง … · วันที่ n) — อาการ: …" / "ซ่อมไม่ได้ — เปลี่ยนรุ่นเดิมแทน (ใบซ่อม RT-…)") · สภาพเครื่อง ณ วันรับคืน (อ้างรูปตอนซื้อ/ตอนรับฝาก + ผู้ยืนยัน) · ผลของการรับคืน 3 บรรทัด (ไม่มีคืนเงิน/เงินเพิ่ม · เครื่องเป็นของร้าน รอส่งเคลม · ใบขายเดิมยังเป็นหลักฐานการซื้อ) · ข้อความรับทราบ · ลายเซ็น ลูกค้า (ผู้ส่งคืน) / พนักงานผู้รับคืน · footer "ไม่ใช่ใบเสร็จ/ใบกำกับภาษี" |
| ใบส่งมอบเครื่องทดแทน (ใบที่ 2/2) | `REPLACEMENT_HANDOVER` | `GET /after-sales/:id/handover.pdf` (route เดิม — เคสขายสดให้ใบนี้แทน `HANDOVER_CASH_UNSUPPORTED_MSG`) | เดียวกัน | หัวเอกสาร · เลขเคส · วันที่ส่งมอบ · อ้างอิงใบขาย · อ้างอิงใบรับคืน (ใบที่ 1 วันเดียวกัน) · พนักงานผู้ส่งมอบ · ลูกค้า (ผู้รับมอบ) · ใบขาย (เลข · ราคาขาย "เท่าเดิม" · การชำระ "ชำระแล้วตามใบขายเดิม ไม่มีเงินเปลี่ยนมือ") · ตาราง เครื่องเดิม (รับคืนแล้ว) / เครื่องที่ส่งมอบ · อุปกรณ์ที่ส่งมอบ · ค่าใช้จ่าย "ไม่มี" + เหตุผล · ประกันของเครื่องที่ส่งมอบ (ประกันร้าน 60 วัน ถึง … · กรอบ 7 วัน ถึง … · ประกันศูนย์ "— (มือสอง ไม่มี)") · ผลต่อใบขาย 2 บรรทัด · ข้อความรับทราบ · ลายเซ็น · footer "ใบขายเดิมยังเป็นหลักฐานการซื้อ" |
| ทั้งสองใบ | — | `GET /after-sales/:id/exchange-docs.pdf` | เดียวกัน | PDF เดียว 2 หน้า (หน้า 1 = RETURN · หน้า 2 = REPLACEMENT_HANDOVER) — ปุ่ม "พิมพ์ใบรับคืน + ใบส่งมอบ (2 ใบ)" ใช้ route นี้ |

- ไม่มีเลขที่เอกสารใหม่ (⑧) · ไม่มีช่องราคาเครื่อง/ต้นทุนบนเอกสาร · ถ้อยคำบนเอกสารคงกติกา PR 4 ("ไม่ใช้คำว่า รับเครื่อง") · กรณี "ข้ามกรอบ 7 วัน" ไม่มีบนใบ (⑥)
- การพิมพ์ลงไทม์ไลน์ `PRINTED` ("พิมพ์ใบรับคืนเครื่อง" / "พิมพ์ใบส่งมอบเครื่องทดแทน" / รวม) กันซ้ำ 5 นาทีเหมือนเดิม · ใบรับฝากของเคสยังพิมพ์ได้
- `after-sales-doc-compose.ts`: ฟังก์ชันใหม่ `composeReturnDoc(source)` / `composeReplacementHandoverDoc(source)` (pure · ทดสอบถ้อยคำด้วย jest เหมือน `doc-compose.spec.ts`) · ลบ `HANDOVER_CASH_UNSUPPORTED_MSG`

## 8. เครื่องเดิมหลังเปลี่ยน — "รอเคลม" (`DEFECT_RETURN`) → ตัดจำหน่ายได้ (③)

- `stock-adjustments.service.ts`: เหตุผล `WRITE_OFF` ขอได้จากสถานะ `DEFECT_RETURN` เพิ่มเติมจาก `DAMAGED` (`REQUESTABLE_STATUSES.EXIT` คงเดิม · เงื่อนไขพิเศษแบบ `DAMAGED`) · `FOUND_POLICY.DEFECT_RETURN` คง `toInStock: false` (hint ปรับเป็น "เครื่องรอเคลม — เคลมไม่ได้ให้ขอตัดจำหน่าย") · เหตุผลอื่น (LOST/DAMAGED) ไม่เปิด
- เจ้าของอนุมัติ → `ShopStockWriteOffTemplate` เดิม `Dr S53-1102 / Cr S11-2002` ที่ `costPrice` — `resolveBookedInventory` พบการรับเข้าเดิม (ใบรับของ/รับซื้อ) และยอดบัญชีของเครื่องเดิมถูกคืนเข้า S11-2002 ที่ต้นทุนเดิมโดย §5 ข้อ 6 แล้ว ⇒ สมดุล (`costPrice` ของเครื่องเดิมไม่ถูกแตะ) · ไม่ตรงกัน (เช่น `costPrice` ถูกแก้มือ) → Sentry `booked-amount-mismatch` เดิม
- หน้าจอเคส/ใบขายแสดงป้าย "รอเคลมผู้จัดจำหน่าย" + ลิงก์ไปเมนูตัดสินค้า · "ได้เครื่องแทน" ไม่ทำรอบนี้ (เครื่องเดิมค้าง `DEFECT_RETURN` จนกว่ามีงานนั้น — เป็นช่องว่างเดิมของสัญญาผ่อนเช่นกัน)

## 9. ด่าน / สิทธิ์ / ผลข้างเคียง

- **ยกเลิกใบขาย** (`SaleVoidService`): ด่านใหม่ **G9** หลัง G1 — `sale.exchangeCaseId != null` → 400 "ใบขายนี้เปลี่ยนเครื่องแล้ว (เคส AS-…) — ยกเลิกใบขายไม่ได้ ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น" (⑦) · หน้าประวัติการขายซ่อนปุ่มยกเลิกเมื่อมี `exchangeCaseId`
- **ลบ/แก้ IMEI/ตัดสินค้า** เครื่องทดแทน (`SOLD_CASH`) และเครื่องเดิม (`DEFECT_RETURN`): `product-hold.util` เดิม — `SOLD_CASH` ลบ/แก้ IMEI ได้ตามเดิม · ไม่เพิ่มด่าน
- **ต้นทุนบนจอ**: ตัวเลขต้นทุน (เก่า/ใหม่ · รายการบัญชีในกล่องยืนยัน · `previousMainProductCost` · `journalEntryNo` ยังเห็นได้) ตัดฝั่ง server ด้วย `canSeeCost(role)` ตัวเดิม (`products/cost-visibility.util.ts` — deny-list: ทุก role ยกเว้น SALES) ไม่เขียนกติกาชุดที่สอง
- **สิทธิ์**: ยืนยัน = OWNER / BM สาขาเดียวกัน (`assertMgr`) · ส่งมอบ/พิมพ์ = ตาม role เดิมของเคส · ตัดจำหน่าย = ผู้ขอ SALES/BM/OWNER · เจ้าของอนุมัติ (ก้อน 3)
- **หน้าใบขาย** (`/sales` รายละเอียด): ป้าย "เปลี่ยนเครื่อง <วันที่> (เคส AS-…)" · แสดงเครื่องเดิม IMEI · เครื่องปัจจุบัน = ทดแทน · ปุ่มยกเลิกซ่อน · รายงานยอดขายตามรุ่น/เครื่องใช้ `productId` ปัจจุบัน (ยอดไม่เปลี่ยนเพราะรุ่นเดียวกัน)
- **สรุปเงินหน้าร้านรายวัน / สมุดเงิน**: ไม่มีเงินเคลื่อน ⇒ ไม่มีแถว `shop_tenders` ไม่มี JE แยกยอด
- **ไฟแนนซ์นอก** (`EXTERNAL_FINANCE`): รายการเดียวกัน (ไม่แตะ `S11-3101`/`FinanceReceivable`) · ใบส่งมอบบรรทัด "การชำระ" = "ตามใบขายเดิม (ไฟแนนซ์ …)"
- **ของแถม** (`bundleProductIds`): ไม่แตะ ไม่พิมพ์
- **LINE**: ไม่มีแม่แบบใหม่ — `after-sales-line-copy.util` และ LIFF จัด `CASH_SAME_MODEL_EXCHANGE` เข้ากิ่งเดียวกับ `SAME_MODEL_EXCHANGE` อยู่แล้ว (ข้อความกล่าวถึง "สัญญา" ต้องตรวจให้เป็นกลางสำหรับขายสด — งานในแผน)
- **เปลี่ยนซ้ำ**: เครื่องทดแทนมีปัญหาอีกภายใน 7 วันนับจากวันส่งมอบ → เปิดเคสใหม่บนใบขายเดิมได้ (เครื่องเดิมของเคสใหม่ = เครื่องทดแทนครั้งก่อน) · คอลัมน์ `exchangedFrom*/exchangeCaseId` เก็บครั้งล่าสุด ประวัติครบอยู่ในเคส/audit/JE

## 10. ข้อมูล (Prisma · migration `<timestamp>_sale_cash_exchange` (ตั้งชื่อตอน `prisma migrate dev`) — เพิ่มคอลัมน์ nullable เท่านั้น)

```
Sale
  exchangedFromProductId  String?    @map("exchanged_from_product_id")   // เครื่องเดิมครั้งล่าสุด
  exchangedAt             DateTime?  @map("exchanged_at")                // เวลา ผจก. ยืนยัน
  exchangeCaseId          String?    @map("exchange_case_id")            // เคสหลังการขายครั้งล่าสุด  @@index
SaleCostSnapshot
  previousMainProductCost Decimal?   @map("previous_main_product_cost") @db.Decimal(12, 2)
  exchangedAt             DateTime?  @map("exchanged_at")
```
`AfterSalesCase` ไม่เพิ่มคอลัมน์ (`replacementSaleId` / `replacementProductId` มีแล้ว) · `AfterSalesEventKind` ไม่เพิ่ม · ไม่มี backfill (prod ไม่มีเคสขายสดที่เปลี่ยนเครื่อง)

## 11. หน้าจอ (ตาม mockup กระดาน 11–14)

- `OutcomePicker`: ปุ่ม "เปลี่ยนรุ่นเดิม" ของขายสดเปิดตาม §3.2 (ข้อความใต้ปุ่มจาก API) · intake ของขายสดเลือกเครื่องทดแทนได้ตั้งแต่เปิดเคส (`ReplacementProductPicker` เดิม + ตัวกรอง §3.3)
- หน้าเคส: `ExchangeCard` รองรับขายสด (ใบขายแทนสัญญา · "ราคาขายเท่าเดิม · ไม่มีเงินเปลี่ยนมือ" · ประกันนับใหม่จากวันส่งมอบ) · `ConfirmExchangeDialog` กิ่งขายสด: picker · ติ๊กตรวจ 2 ข้อ · กล่อง "รายการบัญชีที่จะลง" (เฉพาะ role ที่เห็นต้นทุน) · ข้อความ "เมื่อกดยืนยัน ระบบจะทำให้" 5 ข้อ (กระดาน 11) · ปุ่มหลัก "ยืนยันเปลี่ยนเครื่อง"
- stage `READY_FOR_PICKUP`: ปุ่มหลัก "ส่งมอบเครื่องทดแทน" + ปุ่มรอง "พิมพ์ใบรับคืน + ใบส่งมอบ (2 ใบ)" · กล่องส่งมอบ (กระดาน 12): ปุ่มพิมพ์ 2 ใบ · ติ๊ก 2 ข้อ (ลูกค้าตรวจ/เซ็นแล้ว) · อุปกรณ์ที่ส่งมอบ · ปุ่ม "ยืนยันส่งมอบ + ปิดเคส"
- `StepBar` ของ `CASH_SAME_MODEL_EXCHANGE` (มีแล้วใน `AfterSalesCasePage.tsx:82`) ถ้อยคำขั้น 2–4 ตามกระดาน · การ์ดเครื่องเดิมป้าย "รอเคลมผู้จัดจำหน่าย" + ลิงก์เมนูตัดสินค้า
- มือถือ: ปุ่มหลักล่างจอตามกระดาน 7 เดิม

## 12. การทดสอบ (ด่านก่อน merge)

- **jest (mock)**: `after-sales-outcomes.util.spec` กิ่ง CASH_SALE 3 สภาพ + ไม่มี override · `detect-warranty-status.spec` ใบขายมือสองใน/นอก 7 วัน · เครื่องใหม่ไม่เปลี่ยน · `repair-warranty.service.spec` forExchange ของใบขาย · `shop-cash-exchange.template.spec` golden ข้อ 10 (10,700/10,500 · 4 บรรทัด · metadata · idempotency key · ยอด 0 ข้ามบรรทัด · ทั้งสองศูนย์ไม่ลง) · `exchange-service.spec` confirmCashSameModel (CAS 409 · ต้นทุนเดิมจาก snapshot/JE/ไม่พบ=400 · fromRepair นอกกรอบ=400 · ปล่อยการจองเมื่อล้ม) + deliver (ประกันใหม่ · ปิดเคส) · `sale-void.service.spec` G9 · `stock-adjustments.service.spec` WRITE_OFF จาก DEFECT_RETURN · `doc-compose.spec` ถ้อยคำ 2 ใบ · web: `OutcomePicker.test` · `ExchangeCard.test` · dialog ขายสด
- **vitest (DB จริง · `after-sales/__tests__/after-sales-cash-exchange.integration.spec.ts` — glob `AFTERSALES_FILES` ครอบแล้ว)**: ขายสดมือสอง 13,900 ต้นทุน 10,700 → เปิดเคส (ทางออกเปิด) → ผจก. ยืนยันด้วยเครื่องทดแทนต้นทุน 10,500 → GL S11-2002 สุทธิ +200 · S50-1102 สุทธิ −200 · S41-1102/เงินสดไม่ขยับ · `Sale.productId` สลับ + คอลัมน์ใหม่ + snapshot 10,500/เดิม 10,700 · สถานะเครื่อง 2 ตัว · เคส READY · → ส่งมอบ → ประกัน/กรอบ 7 วันใหม่ (ลองเปิดเคสที่สองบนใบขายเดิม ได้ทางออกเปลี่ยนรุ่นเดิมอีกครั้งภายใน 7 วันจากวันส่งมอบ) · PDF 2 หน้า render ได้ (smoke) · ยกเลิกใบขาย = 400 G9 · ขอตัดจำหน่ายเครื่อง DEFECT_RETURN → เจ้าของอนุมัติ → `Dr S53-1102 / Cr S11-2002` 10,700 · เคสเครื่องใหม่ = ปุ่มปิด · เกิน 7 วัน = ปุ่มปิด + confirm 400 · ยืนยันซ้อน 2 คน = 409 · งวด SHOP ปิด = 400
- **E2E**: smoke เปิดเคสขายสด → ปุ่มเปลี่ยนรุ่นเดิมเปิด (optional ถ้ามี fixture ขายสดอยู่แล้ว)
- ไม่แก้ golden เดิมของ `ShopCashSaleTemplate` / defect-exchange / after-sales PR 1–4

## 13. ไม่ทำใน PR นี้ (บันทึกไว้)

- ผลเคลม "ได้เครื่องแทนจากผู้จัดจำหน่าย" (IMEI ใหม่เข้าคลังที่ต้นทุนเดิม) — งานรอบหน้า
- LIFF ให้ลูกค้าดู/ดาวน์โหลดเอกสาร 2 ใบ
- การย้อนรายการเปลี่ยนเครื่อง (ยกเลิกใบขาย/ยกเลิกเคสหลังยืนยัน) — ฝ่ายบัญชีแก้มือ
- เปลี่ยนรุ่นเดิมของเครื่องใหม่ขายสด (①) และการข้ามกรอบ 7 วัน (⑥)

## 14. Rollout

migration เพิ่มคอลัมน์ nullable เท่านั้น · ไม่มี backfill · forward-only · bump `apps/web/package.json` · กติกาบัญชี: เพิ่มหัวข้อ "เปลี่ยนรุ่นเดิมขายสด (PR 5 · ข้อ 10)" ใน `.claude/rules/accounting.md` (ตาราง SHOP templates + flow/metadata + ด่าน G9 + ตัดจำหน่ายจาก DEFECT_RETURN) · ผู้ตรวจอิสระอ่านทั้งสาขาก่อน push · merge รอเจ้าของ
