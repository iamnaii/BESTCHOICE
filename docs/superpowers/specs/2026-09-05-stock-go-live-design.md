# เริ่มใช้คลัง + จัดซื้อจริง บน DB ที่ยังทดสอบส่วนอื่นอยู่ — Design

วันที่: 2026-09-05 · สถานะ: **อนุมัติโดยเจ้าของ (brainstorm รอบเดียว)** · แนวทาง A "แบ่งด้วย marker บน DB เดียว"

## 1. โจทย์

เจ้าของต้องการ **เริ่มใช้โมดูลคลังสินค้าและจัดซื้อจริง** (ซัพพลายเออร์ → PO → รับของ → QC/ถ่ายรูป
→ เข้าคลัง → ขาย) โดย

1. **ข้อมูลคลังเริ่มที่ 0** — รวมสินค้า 604 เครื่อง `TTFY-*` ที่ reconstruct จาก Tooltify ตอน
   factory reset 26 ส.ค. 2569 (เจ้าของเลือก "ล้างสินค้าด้วย — คลังว่างเปล่า" แล้วนับของจริง
   คีย์เข้าใหม่ผ่าน PO/รับของ)
2. **ขายจริงจากคลังจริง** ผ่าน POS / เปิดสัญญาผ่อน **ขนานกับ**การทดสอบส่วนอื่น (test-pack
   19 โดเมน + ที่คีย์ทดสอบด้วยมือ) บน **prod DB เดียวกัน**
3. **ไม่กระทบสิ่งที่กำลังทดสอบ** — สัญญา `TEST-*` 8 ใบ, เครื่อง IMEI `TEST-*` ~11 เครื่อง,
   ซัพพลายเออร์/PO ทดสอบ, และเครื่องมือ `cleanup:test-pack` ต้องยังทำงานได้เหมือนเดิม

### ข้อเท็จจริงที่ตรวจจากโค้ดแล้ว (ไม่ใช่การเดา)

| ข้อ | หลักฐาน |
|---|---|
| รับของจาก PO **ไม่โพสต์ JE** | `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts` สร้าง `Product` + `GoodsReceiving` เท่านั้น ไม่มี template/`createAndPost` ⇒ `S11-200x` ไม่เคยถูกเดบิตจากการซื้อ |
| ขายสด/เปิดสัญญาเครดิต `S11-200x` | `ShopCashSaleTemplate` (`Dr S50-11xx / Cr S11-200x`) และ `ShopInventoryTransferTemplate` — ทั้งคู่ live (accounting.md) ⇒ ยิ่งขาย GL สินค้าคงเหลือยิ่งติดลบ จนกว่าจะลง JE ยอดยกมา (spec `2026-08-24-shop-opening-balance-design.md`) — **พฤติกรรมที่รับรู้แล้วตั้งแต่ factory reset** ไม่ใช่ของใหม่ |
| `factory:reset` เก็บ `products`/`purchase_orders`/`po_items`/`suppliers` แต่ **ล้าง** `goods_receivings`/`branch_receivings`/`stock_transfers`/`stock_counts`/`stock_adjustments`/`stock_alerts`/`product_reservations` ทั้งตาราง | `apps/api/src/cli/factory-reset-tables.ts` — ล้างตาม**ตาราง** ไม่ดู marker ⇒ ถ้ามีของจริงแล้วรันอีกรอบ ใบรับของจริงหายทั้งที่สินค้า/PO ยังอยู่ |
| prod **ไม่มีคอลัมน์บอกว่าแถวไหนทดสอบ** | มีแต่ marker ของ test-pack (`TEST-` / `ทดสอบระบบ` / `[ทดสอบระบบ]` / ที่อยู่ลูกค้า `ข้อมูลทดสอบระบบ — ลบได้`) — `apps/api/src/cli/test-pack/_context.ts`, `seed-test-contracts.cli.ts:56` |
| วันนี้ POS ขายเครื่องจริงให้ลูกค้าทดสอบได้ และขายเครื่อง `TEST-` ให้ลูกค้าจริงได้ | `sale-creation.service.ts` / `contract-lifecycle.service.ts create()` / `bookings.service.ts create()` ตรวจแค่ `IN_STOCK` + `deletedAt` |
| สินค้าจากรับของ: มือสองเข้า `PHOTO_PENDING` (ต้องถ่าย 6 มุม), มือใหม่/อุปกรณ์เข้า `IN_STOCK` ทันที, ราคาเติมจากตารางกลางถ้ามี | `po-receiving.service.ts:183-198`, `autofillProductPriceFromTemplate` |

หมายเหตุ: การนับข้อมูลจริงบน prod ระหว่าง brainstorm ถูกบล็อกสิทธิ์ (cloud-sql-proxy) —
ตัวเลข 604 / 11 / 8 อ้างจากบันทึก 2026-08-27 · **dry-run ของ CLI คือตัวเลขจริง** ก่อนตัดสินใจ

## 2. คำตัดสินเจ้าของ (2026-09-05 — ปิดประเด็น อย่าเสนอซ้ำ)

| # | คำถาม | คำตัดสิน |
|---|---|---|
| D1 | "ข้อมูลเป็น 0" รวมสินค้า 604 เครื่อง TTFY ไหม | **รวม** — คลังว่างเปล่า แล้วคีย์ของจริงเข้าใหม่ผ่าน PO/รับของ |
| D2 | หลังคลังเป็นของจริง การขายเป็นแบบไหน | **ขายจริงจากคลังจริง + ยังเทสส่วนอื่นขนานกัน** ⇒ ต้องมีรั้วกันข้ามฝั่ง |
| D3 | แนวทาง | **A) marker บน DB เดียว** (ไม่แยกสาขาทดสอบ, ไม่ตั้ง staging รอบนี้) |
| D4 | ซัพพลายเออร์ที่ไม่ใช่ทดสอบซึ่งคีย์ไว้ก่อน | **เก็บทั้งหมด** (ทะเบียนหลัก มีสวิตช์ใช้งาน/ปิดในหน้าจออยู่แล้ว) |

## 3. นิยาม "ข้อมูลทดสอบ" — util เดียว `apps/api/src/utils/test-data-markers.ts`

**แหล่งความจริงเดียว** สำหรับทั้ง CLI ล้างคลัง (§4), รั้ว (§5), guard ของ factory reset (§6) และ
test-pack — `apps/api/src/cli/test-pack/_context.ts` เปลี่ยนมา `import` ค่าคงที่จาก util นี้
(runtime code ห้าม import จาก `src/cli/`; ทิศทางจึงเป็น cli → utils) · ค่าคงที่เดิม
`TEST_DOC_PREFIX = 'TEST-'`, `TEST_NAME_PREFIX = 'ทดสอบระบบ'`, `TEST_NOTE_MARKER = '[ทดสอบระบบ]'`
และ `TEST_CUSTOMER_ADDRESS = 'ข้อมูลทดสอบระบบ — ลบได้'` (ย้ายจาก `seed-test-contracts.cli.ts`
มาไว้ที่นี่ แล้วให้ไฟล์เดิม re-export) — **ค่าไม่เปลี่ยน** เพื่อไม่ให้ cleanup เดิมกวาดไม่เจอ

util export สองรูปต่อตาราง: **predicate** (`isTestProduct(p)`, `isTestCustomer(c)` — รับ object
ที่โหลดมาแล้ว ไม่ query) และ **Prisma where fragment** (`testProductWhere`, `realProductWhere`
ฯลฯ — ใช้ใน query ของ CLI) และ**เทสต์ปักว่าสองรูปให้ผลตรงกัน**

| ตาราง | ถือว่า "ทดสอบ" เมื่อ (OR) | ที่มา |
|---|---|---|
| `products` | `imeiSerial` ขึ้นต้น `TEST-` · `name` ขึ้นต้น `ทดสอบระบบ` · PO ต้นทาง `po.poNumber` ขึ้นต้น `TEST-` | contracts/trade-in/stock-ops seed (`TEST-` IMEI), suppliers-po seed (`TEST-PO-`) — ข้อสามครอบ**อุปกรณ์เสริมที่ไม่มี IMEI** |
| `customers` | `addressCurrent = 'ข้อมูลทดสอบระบบ — ลบได้'` · `phone` ขึ้นต้น `TEST-` | `seed-test-contracts.cli.ts`, `contracts.seed.ts:203-206` |
| `suppliers` | `name` ขึ้นต้น `ทดสอบระบบ` | `suppliers-po.seed.ts` |
| `purchase_orders` | `poNumber` ขึ้นต้น `TEST-` | `suppliers-po.seed.ts` (`TEST-PO-`) |
| `goods_receivings` / `branch_receivings` | PO/ใบโอนต้นทางเป็นทดสอบ (ไม่มี marker ของตัวเอง — ตามผ่าน FK) | `stock-ops.seed.ts:280` |
| `stock_transfers` / `stock_adjustments` | `notes` ขึ้นต้น `[ทดสอบระบบ]` | `stock-ops.seed.ts` |
| `stock_counts` | `countNumber` ขึ้นต้น `TEST-COUNT-` | `stock-ops.seed.ts:11` |
| `stock_alerts` / `reorder_points` | `model = 'TEST-รุ่นแจ้งเตือน'` | `stock-ops.seed.ts:12` |

`isTestProduct` รับ type `{ imeiSerial, name, po: { poNumber } | null }` — ฟิลด์ `po` เป็น
**required** ในชนิด (ค่าเป็น null ได้) เพื่อบังคับให้ผู้เรียก `include`/`select` PO มาด้วย
ไม่งั้น compile ไม่ผ่าน — กันเคส "โหลดไม่ครบแล้วรั้วปล่อยอุปกรณ์เสริมทดสอบเป็นของจริง"

**กติกาที่ตามมา (ต้องอยู่ใน runbook + CLAUDE.md):** ของที่คีย์ทดสอบ**ด้วยมือ**โดยไม่มี marker
= **ถือเป็นของจริง** — ถูกล้างในรอบนี้ และหลังจากนี้การเทสด้วยมือต้องติด marker เอง (ลูกค้า:
ที่อยู่ปัจจุบัน = ข้อความ marker · สินค้า: IMEI ขึ้นต้น `TEST-` · PO: เลขออกโดยระบบ ตั้งเองไม่ได้
⇒ ให้ตั้ง IMEI ตอนรับของแทน). วินัยเดียวทำให้ทั้งรั้วและ `cleanup:test-pack`
ทำงานถูก — ไม่เพิ่มคอลัมน์ `isTest` เพราะจะเกิดสองแหล่งความจริง ("รั้วปล่อย แต่ cleanup ไม่กวาด")

## 4. CLI `wipe:stock-go-live`

ไฟล์: `apps/api/src/cli/wipe-stock-go-live.cli.ts` (thin entry) + ตรรกะที่เทสได้ใน
`apps/api/src/cli/stock-go-live/wipe-stock-go-live.ts` (`planWipe(tx)` อ่านอย่างเดียว →
`applyWipe(tx, plan, wipedAt)`) · npm script `wipe:stock-go-live` + `:help`

### 4.1 Guards (ชุดเดียวกับ `cleanup:test-pack`)

- `EXPECTED_DB_NAME` บังคับ, ต้องตรง `current_database()` (prod = `bestchoice`)
- dry-run โดย default · เขียนจริงต้อง `CONFIRM_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE`
- `NODE_ENV=production` ต้องมี `ALLOW_PROD_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE` เพิ่ม
- ทั้ง plan + apply อยู่ใน **`$transaction` Serializable เดียว** — plan คำนวณ**ใน** tx เพื่อกัน
  ใบขายที่ commit ระหว่าง plan กับ apply (ไม่งั้นอาจ soft-delete เครื่องที่เพิ่งถูกขาย)
- แนะนำรันก่อนร้านเปิด (ไม่บังคับหยุด API — soft-delete ใน tx เดียว ไม่ถอด FK ต่างจาก factory reset)

### 4.2 สินค้า — ล้างเฉพาะ "ของบนชั้น"

เป้าหมาย = `products` live (`deletedAt IS NULL`) ที่ **ไม่ใช่ทดสอบ** (§3) และ `status` ∈ กลุ่มบนชั้น:

```
PO_RECEIVED · QC_PENDING · PHOTO_PENDING · INSPECTION · IN_STOCK ·
REFURBISHED · DAMAGED · DEFECT_RETURN · LOST · WRITTEN_OFF
```

ทุกเครื่องในเป้าหมายผ่านด่าน **`assertProductNotHeld(tx, product, 'DELETE')`** ตัวเดิม
(`apps/api/src/modules/products/product-hold.util.ts` — ห้ามเขียนด่านชุดที่สอง):
ติดด่านชั้น 2-4 (สัญญาที่ยังเดินอ้างอยู่ทั้งที่สถานะเป็น IN_STOCK / จองบนเว็บ / ออเดอร์ออนไลน์ค้าง)
→ **ข้าม + รายงาน** (IMEI, ชื่อ, สาขา, เหตุผลจาก exception) ไม่ลบ

สถานะที่ผูกธุรกรรม — **ไม่แตะ รายงานเป็นตารางแยก**:

```
RESERVED · SOLD_INSTALLMENT · SOLD_CASH · SOLD_RESELL · REPOSSESSED
```

เหตุผล: ไม่นับใน "ภาพรวมคลัง" อยู่แล้ว (`stock-overview.service.ts` นับ `IN_STOCK`) และเป็นของ
ธุรกรรมทดสอบที่คีย์มือ — ให้เจ้าของเคลียร์ผ่านเมนูที่มีจริง (`POST /sales/:id/void` ยกเลิกใบขาย ·
`/finance/contract-cancellation` ยกเลิกสัญญา · หน้ายึดเครื่อง) หรือยอมรับให้ค้าง แล้วรัน CLI ซ้ำได้
(idempotent: รอบสองไม่มีเป้าหมายเหลือ = no-op)

`product_prices` / `product_photos` / `inspections` **ไม่แตะ** — ทุกหน้าจออ่านผ่านสินค้าที่กรอง
`deletedAt` อยู่แล้ว และแถวพวกนี้ต้องอยู่ให้ rollback คืนสภาพครบ

### 4.3 เอกสารเคลื่อนไหว — ล้างที่ไม่มี marker

| ตาราง | เงื่อนไขล้าง | ข้อยกเว้น |
|---|---|---|
| `purchase_orders` (+ `po_items`) | live และไม่ใช่ทดสอบ | **PO ที่มีเครื่องถูก "ข้าม" ใน §4.2 → เก็บ PO นั้นไว้ + รายงาน** (ไม่ปล่อยให้เครื่องชี้ไป PO ที่ถูกลบ — `po-query.service.ts` โยน NotFound เมื่อ `po.deletedAt`) |
| `goods_receivings` (+ items) | ใบของ PO ที่ถูกล้าง | ตามหัว PO |
| `branch_receivings` (+ items) | ใบโอนต้นทางถูกล้าง | ตามหัวใบโอน |
| `stock_transfers` | live, `notes` ไม่ขึ้นต้น `[ทดสอบระบบ]` | — |
| `stock_counts` (+ `stock_count_items`) | live, `countNumber` ไม่ขึ้นต้น `TEST-COUNT-` | — |
| `stock_adjustments` | live, `notes` ไม่ขึ้นต้น `[ทดสอบระบบ]` | — |
| `stock_alerts` | live, `model ≠ 'TEST-รุ่นแจ้งเตือน'` | — |

ตารางลูกทั้งสี่ (`po_items`, `goods_receiving_items`, `branch_receiving_items`, `stock_count_items`)
**มี `deleted_at` ครบ** (ตรวจ schema แล้ว 2026-09-05) ⇒ ตั้ง `deleted_at = wipedAt` ตามหัวเอกสาร
ทุกตาราง — รวมอยู่ใน `WIPED_TABLES` 12 ตารางและ rollback SQL

**ไม่แตะ:** `suppliers` (D4) · `reorder_points` (ตั้งค่า — แถวทดสอบให้ `cleanup:test-pack` กวาด) ·
`inspections`/`inspection_templates` · `imported_sales` · `trade_ins` (ถ้าเครื่องเทิร์นอยู่บนชั้น
จะถูกล้างตาม §4.2 แต่แถว `trade_ins` และ **JE เทิร์นที่เคยโพสต์ไม่ถูกแตะ** — CLI พิมพ์เตือนจำนวน
เครื่องเทิร์นที่จะถูกล้าง; GL เป็นงานของการล้างสมุดทดสอบ ไม่ใช่ของคลัง)

### 4.4 Soft-delete ด้วย timestamp เดียว + AuditLog + rollback

- ทุกแถวที่ล้างในรอบเดียวกันได้ `deleted_at = wipedAt` **ค่าเดียวกันเป๊ะ** (คำนวณครั้งเดียวก่อน apply)
- AuditLog 1 แถวใน tx เดียวกัน (`tx.auditLog.create` — ยอมไม่มี `rowHash` แลกกับ atomic ตามกติกา
  `database.md` "AuditLog — เขียนหลัง commit หรือใน tx"): `action = 'STOCK_GO_LIVE_WIPE'`,
  `entity = 'product'`, `userId` = OWNER คนแรก (pattern `resolveRefs` ใน `_context.ts` — CLI ไม่มี
  actor), `newValue = { wipedAt, counts: {ตาราง: จำนวน}, skipped: [{imei, reason}], keptPos: [...] }`
- **Rollback** = SQL ต่อตาราง `UPDATE <table> SET deleted_at = NULL WHERE deleted_at = '<wipedAt>'`
  — CLI พิมพ์ชุดคำสั่งนี้ตอนจบ (พร้อมค่า `wipedAt` จริง) และเก็บไว้ใน runbook

### 4.5 Dry-run พิมพ์อะไร

1. DB ที่ต่อ + โหมด
2. ตารางจำนวนที่จะลบต่อตาราง + สินค้าแยกตามสาขา/หมวด/สถานะ + มูลค่าต้นทุนรวมที่จะหายจาก
   "ภาพรวมคลัง"
3. ตาราง **เครื่องที่ข้าม** (ติดด่าน / สถานะผูกธุรกรรม) พร้อมเหตุผล + PO ที่ถูกเก็บเพราะเหตุนี้
4. เครื่องทดสอบที่จะ**เหลือ** (คาดว่า ~11) + เครื่องทดสอบที่ `isOnlineVisible = true` (ต้องปิดเอง
   ก่อนขายจริง — CLI ไม่แก้ให้)
5. ยอด GL `S11-2001/2002/2003` ปัจจุบัน พร้อมข้อความว่า CLI **ไม่แตะบัญชี**
6. จำนวนเครื่องเทิร์นที่จะถูกล้าง (คำเตือน §4.3)

## 5. รั้วกันข้ามฝั่ง (test-data fence)

**หลักการ:** ฝั่งต้องตรงกัน — `ทดสอบ ↔ ทดสอบ` หรือ `จริง ↔ จริง` · ผิดฝั่ง =
`BadRequestException` ไทย · **ไม่มี flag ปิด** (หลังล้างข้อมูลทดสอบหมด รั้วไม่มีวันทำงานเอง
เพราะไม่มีอะไรถูก mark — YAGNI)

helper: `assertSameTestSide(customer, product)` ใน util §3 — รับ object ที่โหลดแล้ว ไม่ query เพิ่ม

### 5.1 จุดวาง — 3 chokepoint ที่ "เครื่องพบลูกค้า" ครั้งแรก

| จุด | ไฟล์ | ตำแหน่ง |
|---|---|---|
| ขาย POS (สด / ไฟแนนซ์ภายนอก) | `apps/api/src/modules/sales/services/sale-creation.service.ts` | หลังโหลดลูกค้า (~บรรทัด 48) และเครื่องหลัก + ของแถม — ตรวจ**ทุกชิ้น**ในใบ (ของแถมผิดฝั่งก็ต้องดัง) |
| เปิดสัญญาผ่อน | `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts create()` | ใน tx หลังโหลด `currentProduct` + `customerData` (~บรรทัด 158-166) — ที่เดียวกับที่ตรวจ `IN_STOCK` |
| ใบจอง/มัดจำ | `apps/api/src/modules/bookings/bookings.service.ts create()` และตอนแปลงเป็นใบขาย (~บรรทัด 667) | หลังโหลดลูกค้า (~บรรทัด 249) และเครื่องแต่ละรายการ |

ทำไม 3 จุดพอ: activation / ยึดเครื่อง / เปลี่ยนเครื่อง / void / ใบเสร็จ ล้วน**อ่านคู่เดิม**จาก
`contract.customerId`/`productId` ไม่สร้างคู่ใหม่ (pattern เดียวกับ `assertProductNotHeld` ที่บังคับ
ที่ประตูเข้า) · การโหลดสินค้าใน 3 จุดต้องเพิ่ม `po: { select: { poNumber: true } }` (ชนิดของ
`isTestProduct` บังคับ)

### 5.2 ข้อความ error (ชี้ทางที่ทำได้จริง — `coding-standards.md`)

- เครื่องทดสอบ → ลูกค้าจริง:
  `เครื่อง <IMEI หรือชื่อ> เป็นเครื่องทดสอบระบบ ขายให้ลูกค้าจริงไม่ได้ — เลือกลูกค้าทดสอบ (ที่อยู่ปัจจุบัน = "ข้อมูลทดสอบระบบ — ลบได้")`
- เครื่องจริง → ลูกค้าทดสอบ:
  `ลูกค้า <ชื่อ> เป็นลูกค้าทดสอบระบบ ขายเครื่องจริง <IMEI> ให้ไม่ได้ — เลือกเครื่องที่ IMEI ขึ้นต้น TEST- หรือแก้ที่อยู่ปัจจุบันของลูกค้าถ้าเป็นลูกค้าจริง`

(หน้าแก้ไขลูกค้าแก้ `addressCurrent` ได้ทุก role ที่แก้ลูกค้าได้ — ตรวจแล้วเป็นทางที่มีจริง)

### 5.3 auto-mark ที่ต้นทางสร้างเครื่อง

- **รับซื้อ/เทิร์นจากลูกค้าทดสอบ** (`trade-in-lifecycle.service.ts accept()`): เครื่องที่สร้างได้
  `name` ขึ้นต้น `ทดสอบระบบ ` อัตโนมัติ (ไม่แตะ IMEI — เป็นของจริงของเครื่องทดสอบ)
- **รับของจาก PO `TEST-`**: เข้าเงื่อนไข "PO ต้นทางทดสอบ" ใน §3 อยู่แล้ว ไม่ต้องทำอะไร

### 5.4 สิ่งที่รั้วไม่ครอบ (ระบุชัด)

- **เว็บช็อปสาธารณะ** — ลูกค้าจริงเห็น/สั่งเครื่องทดสอบได้ถ้า `isOnlineVisible = true` ⇒ dry-run
  รายงาน (§4.5 ข้อ 4) ให้ปิดเองก่อนขายจริง; ไม่วางรั้วที่ `consume-order-hold` รอบนี้
- **เปลี่ยนเครื่อง / ยึดเครื่อง** — สืบทอดคู่ลูกค้าเดิม ไม่ต้องตรวจซ้ำ

## 6. `factory:reset` ปฏิเสธเมื่อมีของจริง

เพิ่มด่านใน `apps/api/src/cli/factory-reset.cli.ts` **ก่อน**พิมพ์แผนล้าง (ทั้ง DRY_RUN และรันจริง):
นับ `products` live ที่ไม่ใช่ทดสอบ + `goods_receivings` live ที่ PO ต้นทางไม่ใช่ `TEST-` → มากกว่า 0
= **หยุดพร้อมตัวเลข** เว้นแต่ `ALLOW_WIPE_REAL_STOCK=YES_I_AM_SURE` (ตั้งใจให้เป็น consent ใหม่
ที่ต้องพิมพ์ชื่อสิ่งที่จะเสีย ไม่ reuse `ALLOW_PROD_RESET`)

**ไม่**ย้าย `goods_receivings`/`stock_*` ไปฝั่ง KEEP ของ `factory-reset-tables.ts` — จะทำให้
factory reset "ล้างครึ่งเดียว" (สินค้าอยู่ ใบเคลื่อนไหวหาย หรือกลับกัน) ซึ่งแย่กว่าการปฏิเสธ ·
หลังจากงานนี้ทางล้างข้อมูลทดสอบคือ **`cleanup:test-pack` + `cleanup:test-contracts` เท่านั้น** —
เขียนกล่องเตือนไว้หัว `docs/accounting/factory-reset-runbook-2026-08.md`

## 7. บัญชี — นอกขอบเขต แต่ต้องรู้

1. รับของจาก PO ไม่โพสต์ JE ⇒ เริ่มใช้จัดซื้อ**ไม่กระทบสมุด** และ `S11-200x` ไม่ขยับตามการซื้อ
2. ขายสด/เปิดสัญญาของจริงเครดิต `S11-200x` ⇒ GL สินค้าคงเหลือติดลบสะสมจนกว่าจะลง JE ยอดยกมา
   (spec 2026-08-24) — เหมือนสภาพหลัง factory reset ทุกประการ
3. **"JE ตอนรับของ" (`Dr S11-200x / Cr S21-1101` หรือเงินสด) เป็นฟีเจอร์แยก** — ต้องให้ผู้สอบ
   เคาะบัญชี/จังหวะ (รับของ vs ใบกำกับ vs จ่ายเงิน) ก่อน ตามกติกา "ห้ามเดา JE" — ใส่ใน §10
4. JE ของธุรกรรม**ทดสอบ**ที่ยังค้างในสมุด (เทิร์น, ขายสด, สัญญา) ถูกกวาดโดย `cleanup:test-pack`
   ตาม `metadata.contractId`/`saleId` ของธุรกรรมทดสอบ — JE ของจริงรอด **ตราบใดที่รั้ว §5 ทำงาน**
   (ธุรกรรมที่ข้ามฝั่งจะทำให้ JE จริงติดไปกับ cleanup หรือ JE ทดสอบค้างถาวร — นี่คือเหตุผลที่รั้วเป็น
   ส่วนหนึ่งของงานนี้ ไม่ใช่ของแถม)

## 8. Runbook `docs/accounting/stock-go-live-runbook-2026-09.md`

1. **จุดกู้คืน** — `gcloud sql backups create --instance=bestchoice-db --description="before stock go-live"`
   (PITR ปิด — นี่คือจุดกู้คืนเดียว)
2. **Deploy** โค้ดงานนี้ก่อน (รั้ว + guard factory reset ต้องอยู่บน prod ก่อนล้าง)
3. **Dry-run** ผ่าน cloud-sql-proxy (สูตร `scripts/ops/` + `DATABASE_URL_FINANCE=""`) → อ่านตาราง
   "ข้าม": เครื่องที่ธุรกรรมทดสอบถืออยู่ให้เคลียร์ผ่านเมนู (ยกเลิกใบขาย / ยกเลิกสัญญา) หรือยอมรับให้ค้าง
4. ปิด `isOnlineVisible` ของเครื่องทดสอบตามที่ dry-run รายงาน
5. **รันจริง** (`CONFIRM_… + ALLOW_PROD_…`) → เก็บ `wipedAt` + ชุด SQL rollback ที่ CLI พิมพ์
6. **ตรวจรับ**: ภาพรวมคลัง = 0 ทุกสาขา (เหลือเฉพาะเครื่อง `TEST-`) · คิว QC/ถ่ายรูป = 0 · PO เปิด =
   เฉพาะ `TEST-PO-*` · `/stock/alerts` ว่าง · งบทดลองไม่ขยับ (CLI ไม่แตะ)
7. **เริ่มใช้จริง**: ซัพพลายเออร์ → PO (หรือ "รับของตรง" `isDirectReceive` เมื่อของมาก่อนใบ) →
   รับของใส่ IMEI จริง → มือสอง `PHOTO_PENDING` ถ่าย 6 มุม / มือใหม่+อุปกรณ์เข้า `IN_STOCK` ทันที →
   ราคาเติมจากตารางกลางถ้ามี ไม่มีต้องตั้งเอง → พิมพ์สติกเกอร์ → ขาย
8. **วินัย marker** สำหรับการเทสหลังจากนี้ (§3 ย่อหน้าท้าย) — พิมพ์ไว้เป็นกล่องในหน้าแรกของ runbook
9. **ย้อนกลับ** (ถ้าจำเป็น): SQL `SET deleted_at = NULL WHERE deleted_at = '<wipedAt>'` ต่อตาราง

## 9. การทดสอบ

| ชิ้น | แบบ | ครอบอะไร |
|---|---|---|
| `apps/api/src/utils/test-data-markers.spec.ts` | unit | predicate ทุกตาราง — marker ครบ / ไม่มี / อุปกรณ์เสริมไร้ IMEI จาก `TEST-PO` / ลูกค้าที่ mark แค่เบอร์ / **predicate กับ where fragment ให้ผลตรงกัน** |
| `apps/api/src/cli/stock-go-live/__tests__/wipe-stock-go-live.integration.spec.ts` | integration (DB จริง) | seed คละ: TTFY 3 + TEST 2 + เครื่องที่สัญญาถืออยู่ 1 + PO จริง/ทดสอบ + ใบนับ/โอน/ปรับ ทั้งสองแบบ → dry-run ไม่เขียน · live: จำนวนถูก, `deleted_at` ค่าเดียวทั้งรอบ, เครื่องที่ถูกถือรอด + PO ของมันรอด, AuditLog มี, **rollback SQL คืนครบ**, รันซ้ำ = no-op |
| fence specs ใน 3 service เดิม (`sale-creation`, `contract-lifecycle`, `bookings`) | unit (jest mock) | 4 combos × 3 จุด + ข้อความ error ตรง + ของแถมผิดฝั่งในใบขาย |
| `trade-in-lifecycle` auto-mark | unit | ลูกค้าทดสอบ → ชื่อเครื่องขึ้นต้น `ทดสอบระบบ` · ลูกค้าจริง → ไม่แตะชื่อ |
| `factory-reset` guard | unit | มีของจริง → throw พร้อมตัวเลข / ไม่มี → ผ่าน / มี `ALLOW_WIPE_REAL_STOCK` → ผ่าน |
| CI `.github/workflows/deploy-gcp.yml` | — | เพิ่ม glob `src/cli/stock-go-live/__tests__/*.integration.spec.ts` ใน vitest step (บทเรียน jp5-vat-split: glob ไม่ recurse) |

## 10. ไม่ทำรอบนี้ / งานถัดไป

- UI ใหม่ใด ๆ (ทุกอย่างผ่าน CLI + หน้าจอเดิม)
- flag ปิดรั้ว · คอลัมน์ `isTest`
- **JE ตอนรับของ** — รอผู้สอบเคาะ (ถามพร้อมรอบคำถามถัดไปใน `docs/accounting/`)
- **JE ยอดยกมาสินค้าคงเหลือ** — ตาม spec 2026-08-24 เมื่อคลังจริงนิ่งแล้ว
- แยกสาขาทดสอบ (B) · staging environment (C)
- รั้วฝั่งเว็บช็อป (`consume-order-hold`) — รอเคสจริง
- ล้าง JE ทดสอบที่คีย์มือโดยไม่มี marker — เป็นงานของ cleanup สมุด ไม่ใช่ของคลัง

## 11. ไฟล์ที่แตะ (สรุป)

| ไฟล์ | ทำอะไร |
|---|---|
| `apps/api/src/utils/test-data-markers.ts` (+spec) | ใหม่ — ค่าคงที่ + predicate + where fragment + `assertSameTestSide` |
| `apps/api/src/cli/test-pack/_context.ts`, `apps/api/src/cli/seed-test-contracts.cli.ts` | import/re-export ค่าคงที่จาก util (ค่าไม่เปลี่ยน) |
| `apps/api/src/cli/wipe-stock-go-live.cli.ts`, `apps/api/src/cli/stock-go-live/wipe-stock-go-live.ts` (+integration spec) | ใหม่ — CLI §4 |
| `apps/api/package.json` | script `wipe:stock-go-live` + `:help` |
| `apps/api/src/modules/sales/services/sale-creation.service.ts`, `.../contracts/services/contract-lifecycle.service.ts`, `.../bookings/bookings.service.ts` (+specs) | รั้ว §5.1 + include `po.poNumber` |
| `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts` (+spec) | auto-mark §5.3 |
| `apps/api/src/cli/factory-reset.cli.ts` (+spec) | guard §6 |
| `.github/workflows/deploy-gcp.yml` | glob integration spec ใหม่ |
| `docs/accounting/stock-go-live-runbook-2026-09.md` | ใหม่ — §8 |
| `docs/accounting/factory-reset-runbook-2026-08.md`, `.claude/CLAUDE.md` | กล่องเตือน "factory reset ปฏิเสธเมื่อมีของจริง" + วินัย marker |
