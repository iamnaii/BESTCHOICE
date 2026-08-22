# Database Rules (Prisma + PostgreSQL)

## IDs
- ใช้ UUID เสมอ: `id String @id @default(uuid())`
- ห้ามใช้ autoincrement

## Timestamps
โดย default ทุก model ต้องมี 3 fields นี้:
```prisma
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
deletedAt DateTime?
```

### Exception patterns (ข้อยกเว้นที่ documented)
- **Immutable audit logs** (AuditLog, DocumentAuditLog, DataAuditLog, WebhookDelivery) — ไม่มี `updatedAt`/`deletedAt` เพราะ immutable by design. Retention handled by dedicated cron
- **One-time tokens** (PasswordResetToken, InviteToken, CustomerAccessToken, ChatbotOtpRequest) — ไม่มี `updatedAt`/`deletedAt` เพราะ use-once + TTL cleanup
- **Idempotency records** (ProcessedWebhookEvent) — มีแค่ `processedAt` เป็น createdAt-equivalent. Immutable, retention via cron
- **Append-only event logs** (ChatMessage, CallLog, BroadcastMessage receipts) — ไม่มี `updatedAt` เพราะ events ไม่แก้หลัง insert

**Rule**: ถ้า model ใหม่ควรยกเว้นต้องมี `///` comment อธิบายเหตุผล เช่น `/// Immutable audit log — updatedAt/deletedAt intentionally omitted`

## Soft Delete
- ใช้ `deletedAt DateTime?` — **ห้าม hard delete** เด็ดขาด
- ทุก query ต้องมี `where: { deletedAt: null }` เสมอ
- Soft delete = `update({ data: { deletedAt: new Date() } })`

## Money Fields
- ใช้ `Decimal` เท่านั้น: `@db.Decimal(12, 2)`
- **ห้ามใช้ Float หรือ Int** สำหรับจำนวนเงิน
- ตัวอย่าง: `price Decimal @db.Decimal(12, 2)`

## Relations
- ตั้งชื่อ `@relation("RelationName")` เมื่อ model มีหลาย relation ไปที่ model เดียวกัน
- ใส่ `@relation(onDelete: Cascade)` เฉพาะเมื่อ child ไม่มีความหมายหากไม่มี parent

## Indexes
- เพิ่ม `@@index([fieldName])` สำหรับ fields ที่ถูก query บ่อย
- Composite index สำหรับ queries ที่ filter หลาย fields พร้อมกัน

## Enums
- ประกาศที่ส่วนบนของ `schema.prisma`
- ชื่อ enum type ใช้ PascalCase เช่น `enum PaymentStatus { ... }`
- ค่า enum values ใช้ SCREAMING_SNAKE_CASE เช่น `PENDING`, `COMPLETED`

## Migrations
- ชื่อ descriptive: `add_warranty_model`, `add_phone_field_to_customer`
- Production ใช้ `prisma migrate deploy` เท่านั้น — ห้ามใช้ `migrate dev`
- Field ใหม่ที่ required บน table ที่มีข้อมูลแล้ว → ต้องมี `@default()` หรือใช้ 2-step migration (เพิ่มแบบ optional → backfill → เปลี่ยนเป็น required)
- Rename column → ใช้ `@map("old_name")` แทนการ drop แล้วสร้างใหม่

---

## สถานะสินค้า & IMEI (Phase 5)

> **ทำไมอยู่ในไฟล์นี้ ไม่ใช่ `accounting.md`:** ทั้งหัวข้อเป็นเรื่อง **ความถูกต้องของ
> ข้อมูล** — partial unique index, ความหมายของ soft delete, และด่านที่คุม state
> transition ของ `Product` — ไม่มี JE ใหม่แม้แต่ใบเดียวในเฟสนี้. `accounting.md`
> คือบ้านของผัง/เทมเพลต/รอบจ่าย; เรื่อง "IMEI เดียวกันมีได้กี่แถว" กับ "ลบสินค้าได้
> เมื่อไร" อยู่ใต้กติกา Prisma/PostgreSQL. (เฟสนี้คือ Phase 5 ของ workbook
> `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md` §7
> — Phase 1-4 อยู่ใน `accounting.md` ตามเดิม)

### IMEI ซ้ำถูกกันด้วย partial unique index อยู่แล้ว (T5-C12)

```sql
-- migration 20260525200000_product_imei_partial_unique
CREATE UNIQUE INDEX "products_imei_serial_active_unique"
  ON "products" ("imei_serial")
  WHERE "deleted_at" IS NULL;
```

**ตั้งใจให้ IMEI กลับมาใช้ใหม่ได้หลังแถวเดิมถูกลบ** — ไม่ใช่ช่องโหว่ที่ลืมปิด:
เดิมเป็น `UNIQUE` ธรรมดา ⇒ เครื่องที่ตัดจำหน่าย/ถูกลบไปแล้ว **บล็อก IMEI นั้นตลอดกาล**
ซึ่งผิดกับธุรกิจรับซื้อมือสอง (เครื่องเดิมกลับเข้ามาขายซ้ำได้จริง เช่น ตัดหนี้สูญ →
อีกหลายเดือนลูกค้าเอาเครื่องเดิมมาเทิร์น → `trade-in.service.ts accept()` ต้องสร้าง
`Product` แถวใหม่ด้วย IMEI เดิม). Prisma เขียน partial unique ไม่ได้ ⇒ `@unique` บน
`imeiSerial` ใน `schema.prisma` **ยังอยู่** (คงชนิด TS) แต่ระดับ DB ถูกสลับเป็น partial
index ตาม migration ข้างบน. ทุก service ที่เช็คซ้ำเองต้องกรอง `deletedAt: null` ให้ตรงกับ DB.

**ผลที่ตามมา (สำคัญที่สุดของเฟสนี้):** เมื่อ "แถวหลุดจาก index" = "IMEI ว่าง" การกระทำ
สองอย่างจึงเทียบเท่ากันเชิงความเสี่ยง — **ลบสินค้า** (ทั้งแถวหลุด) และ **แก้ IMEI**
(ค่าเดิมหลุด). ทั้งคู่ต้องผ่านด่านเดียวกัน.

### `product-hold.util.ts` — ด่านเดียวของ "เครื่องนี้ยังถูกถือครองอยู่ไหม"

`assertProductNotHeld(client, product, action, subjectFields?)` —
`apps/api/src/modules/products/product-hold.util.ts` ใช้ร่วมกัน **ทั้ง
`ProductsService.remove()` (ลบ) และ `ProductsService.update()` (แก้ IMEI/Serial)**.

**ทำไมการลบเคยเป็นช่องขายซ้ำ:** ก่อน Phase 5 `remove()` ไม่มี guard เลย ⇒ ลบเครื่องที่
สัญญา ACTIVE ถืออยู่ได้ → IMEI ว่างในสายตา index → รับเครื่องเดิมเข้าสต็อกใหม่ → **ขาย/
จัดไฟแนนซ์ซ้ำบนเครื่องที่ยังผ่อนไม่จบ**. การแก้ IMEI แย่กว่าอีกชั้น เพราะนอกจากปลด slot
แล้วยัง **ตัดสาย สัญญา↔เครื่อง เงียบ ๆ** (MDM จะไปล็อกผิดเครื่อง) — และ PATCH มีสิทธิ์
กว้างกว่า DELETE จึงเป็นประตูที่หลวมกว่า.

4 ชั้นที่ด่านตรวจ (เรียงตามลำดับจริงในโค้ด):

| ชั้น | ตรวจอะไร | ทำไมต้องมีชั้นนี้ |
|---|---|---|
| 1 | `product.status` ∈ `RESERVED` / `SOLD_INSTALLMENT` / `REPOSSESSED` | เคสตรงไปตรงมา — แต่ละสถานะมีข้อความบอก **ทางออก** ของตัวเอง (`HELD_STATUS_REMEDY`) |
| 2 | มี `Contract` ที่ `status notIn FINISHED_CONTRACT_STATUSES` อ้างอยู่ | กันสถานะเพี้ยน (เป็น `IN_STOCK` ทั้งที่สัญญายังเดิน — ข้อมูลเก่า/แก้มือ) |
| 3 | มี `ProductReservation` `ACTIVE` ที่ยังไม่หมดอายุ | **flow จองบนเว็บไม่แตะ `product.status` เลย** ⇒ ชั้น 1 มองไม่เห็น |
| 4 | มี `OnlineOrder` ที่ `status notIn RELEASED_ONLINE_ORDER_STATUSES` | จ่ายเงินแล้วแต่ fulfilment ค้าง — ก็ไม่แตะ `product.status` เช่นกัน |

- `FINISHED_CONTRACT_STATUSES` และ `RELEASED_ONLINE_ORDER_STATUSES` เป็น **exclude list
  (`notIn`) ไม่ใช่ include list** โดยตั้งใจ — enum value ใหม่ที่เพิ่มวันหลังจะถูก "กันไว้
  ก่อน" อัตโนมัติ ไม่หลุด guard เงียบ ๆ.
- `TERMINATED` / `DEFAULT` **ไม่อยู่** ใน `FINISHED_CONTRACT_STATUSES`: บอกเลิกสัญญาแล้ว
  แต่ยังไม่ได้ยึดเครื่องคืน = ยังถือครอง. เส้นทางยึด/ตัดหนี้สูญไปลงจอดที่
  `CLOSED_BAD_DEBT` ซึ่งอยู่ในลิสต์.
- `PAYMENT_RECEIVED_UNFULFILLABLE` **อยู่** ในลิสต์ที่ปล่อยได้ (แพ้ race — เครื่องถูกขาย
  ให้คนอื่นไปแล้ว ออเดอร์นี้รอคืนเงิน ไม่ได้ถือเครื่องตัวนี้).
- `changedIdentityFields()` ตัดสินว่า "แก้จริงไหม" — ไม่ส่งมา = ไม่แตะ, ส่งค่าเดิม = ผ่าน,
  **ล้างค่า (null/ว่าง) นับเป็นการแก้** เพราะปลด slot เหมือนกัน.

**ห้ามเขียนด่านชุดที่สอง** — เงื่อนไขใหม่ให้เติมในไฟล์นี้ไฟล์เดียว.

### `product-enter-stock.util.ts` — ประตูเข้า `IN_STOCK` ทั้งหมด

`IN_STOCK` = "ขายที่ POS ได้ทันที" (`sale-writer.service.ts:125` รับเฉพาะสถานะนี้ และ
`deletedAt` ต้องเป็น null) ⇒ **ประตูที่หลวมที่สุดคือกติกาจริง** ทุกประตูที่คนกดจึงผ่าน
helper เดียวกัน (`apps/api/src/modules/products/product-enter-stock.util.ts`):

| ประตู | ด่านราคา | `via` ใน AuditLog |
|---|---|---|
| `ProductsService.returnToStock` — ปุ่ม "นำเข้าคลังพร้อมขาย" | บังคับ **ยืนยันราคา** (ดูล่าง) | `BUTTON` |
| `ProductsService.update` — PATCH เปลี่ยนสถานะด้วยมือ | บังคับ **มีราคา** (`assertSellableOnEnterStock`) | `PATCH` |
| `ProductPhotosService.completePhotos` — ยืนยันรูป 6 มุม | **soft gate** (ดูล่าง) | `PHOTO_COMPLETE` |

ทุกประตูเขียน AuditLog รูปเดียวกัน (`ENTER_STOCK_AUDIT_ACTION = 'PRODUCT_RETURNED_TO_STOCK'`,
`enterStockAuditData()`) ที่บันทึกราคาเก่า→ใหม่เสมอ ⇒ ตรวจย้อนได้ว่าเครื่องไหนเข้าคลังโดย
ไม่มีการยืนยันราคา (`newValue.via !== 'BUTTON'` และราคาใน `newValue` เท่ากับ `oldValue`).

ประตูที่ **จงใจไม่ผ่าน** helper (ตรวจครบทุกจุดที่เขียน `status: 'IN_STOCK'` เมื่อ 2026-08-22):
`po-receiving` (ของใหม่ ตั้งราคาในใบเดียวกัน) · `stock-adjustments` reason `FOUND`
(มี allow-list ของตัวเอง + 4-eyes + แถว `StockAdjustment` เป็นหลักฐาน) · เส้นทาง **ยกเลิก**
สัญญา/เปลี่ยนเครื่อง (เครื่องกลับมาพร้อมราคาของตัวเอง + audit ของ flow นั้นเอง) ·
**ปลดจอง** `RESERVED → IN_STOCK` (benign โดยโครงสร้าง: ต้องเป็น `IN_STOCK` มีราคาอยู่ก่อน
จึงถูกจองได้ การปลดจองคือคืนสภาพเดิม) · `tooltify-stock-parser.ts` (migration ข้อมูลเก่า
อ่านราคาจากชีตแถวเดียวกัน).

#### `FOUND_POLICY` — allow-list ของเหตุผล "พบของ"

`stock-adjustments.service.ts` — ประกาศด้วย `satisfies Record<ProductStatus, ...>` ⇒
**สถานะใหม่ใน enum จะ compile ไม่ผ่านจนกว่าจะตัดสินใจ**ว่าอยู่ฝั่งไหน. `toInStock: true`
มีแค่ 3 สถานะที่ "พบของที่หายไป" มีความหมายจริง: `LOST` / `DAMAGED` / `WRITTEN_OFF`.

ทำไมต้องเป็น allow-list ไม่ใช่ deny ทีละสถานะ: รอบก่อนปฏิเสธเฉพาะ `REFURBISHED` แต่
`repossessions.service.ts` ตั้ง `REPOSSESSED` ตอนยึด (`REFURBISHED` มาทีหลังตอน
`markReadyForSale` ที่บังคับตีราคาใหม่) ⇒ **เครื่องยึดที่ยังถือราคาขายเดิมไหลเข้า `IN_STOCK`
ทางนี้ได้ โดยไม่เช็คราคา ไม่มี AuditLog เข้าคลัง** ทั้งที่ปุ่มนำเข้าคลังปฏิเสธมัน. allow-list
ปิดสถานะที่ยังไม่มีใครนึกถึงด้วย (`SOLD_INSTALLMENT → IN_STOCK` แย่กว่าอีก).

สถานะที่ `toInStock: false` **ยังกู้แถวที่ถูก soft-delete คืนได้** (`deletedAt: null`) แต่
กลับไปสถานะเดิมของมัน ไม่ใช่ `IN_STOCK` — **นี่คือทางกู้เครื่องที่ถูกลบทางเดียวที่ระบบมี**
จึงห้ามปิด แต่ต้องไม่กลายเป็นประตูลัดเข้าคลัง.

#### คำตัดสินเจ้าของ 2026-08-21 + ทำไมต้องบังคับยืนยันราคา

**คำตัดสิน:** มีปุ่ม "นำเข้าคลังพร้อมขาย" ให้หน้าร้านกดเอง (`REFURBISHED → IN_STOCK` +
AuditLog) — **POS ยังขายเฉพาะ `IN_STOCK` เหมือนเดิม** ไม่ขยายให้ขาย `REFURBISHED` ตรง ๆ
(สเปค §7 ข้อ 2 เขียนไว้อีกอย่าง — ดูหัวข้อ "spec §7 ต่างจากความจริงตรงไหน" ล่าง).
`REFURBISHED → IN_STOCK` จึงอยู่ใน `MANUAL_TRANSITION_DENY` (`product-status.util.ts`) —
**เฉพาะคู่นี้** ไม่ยัด `REFURBISHED` เข้า `SYSTEM_MANAGED_STATUSES` ทั้งสถานะ เพราะระบบ
**ตั้ง** REFURBISHED (ยึดเครื่อง / เปลี่ยนเครื่อง A.4) แต่ไม่มี flow ไหน **ปลด** มัน ⇒
เหมารวมจะบล็อก `REFURBISHED → DAMAGED` (ตรวจแล้วเจอเสียเพิ่ม) และ `DAMAGED → REFURBISHED`
(ซ่อมเสร็จ) = เครื่องค้างสถานะถาวร.

**เหตุผลเชิงธุรกิจของด่านราคา:** เครื่องมือสองที่รับคืน (ยึด / เปลี่ยนเครื่อง / รับเทิร์น)
**ถือราคาตอนเป็นเครื่องใหม่ติดตัวมาด้วย** — `cashPrice`/`installmentPrice` และแถว
`ProductPrice` ที่ตั้งไว้ตั้งแต่ขายรอบแรกยังอยู่ครบ และ **ระบบไม่มี flow "ล้างราคา" เลย**
(ฟอร์มแก้ราคาปล่อยช่องว่าง ⇒ `undefined` ⇒ ไม่แตะคอลัมน์; `PriceManagementModal` ปฏิเสธ
ยอด `<= 0`; `removePrice` เป็น soft delete ที่ปฏิเสธเมื่อเหลือแถวเดียว) ⇒ ถ้าปล่อยเข้าคลัง
โดยไม่ยืนยัน **ราคาเครื่องใหม่จะกลายเป็นราคาตั้งต้นที่ POS/บอทหยิบไปขายเครื่องมือสอง**.
ด่านจึงตรวจ **สองที่**: คอลัมน์ (`cashPrice`/`installmentPrice`) และแถว `ProductPrice` ที่
`syncPriceRowsFromColumns` จะ **ไม่** ทับ (`unconfirmedLeftoverPrices` mirror ตรรกะการเลือก
เป้าหมายของ sync ตรง ๆ — label ตรงก่อน แล้วค่อย default row) — เพราะ POS/บอทหยิบ
`isDefault take:1` ไปขาย ไม่ได้อ่านคอลัมน์อย่างเดียว.

#### `completePhotos` = soft gate (ตั้งใจ ไม่ใช่ด่านหลุด)

ยืนยันรูป 6 มุม **สำเร็จเสมอ** — แต่เลื่อนเป็น `IN_STOCK` เฉพาะเมื่อเครื่องมีราคาแล้ว
(ไม่มีราคา = รูปถูกบันทึก สถานะคง `PHOTO_PENDING`). ปฏิเสธทั้งใบไม่ได้เพราะ **สายรับซื้อ/
เทิร์นสร้างเครื่องเป็น `PHOTO_PENDING` โดยยังไม่มีราคา และ `SALES` ตั้งราคาเองไม่ได้** ⇒
พนักงานถ่ายรูปจะตันทั้งงาน ทั้งที่งานของเขาเสร็จแล้วจริง. ราคามาทีหลัง แล้วค่อยเข้าคลัง
ผ่านปุ่ม/PATCH.

### State diagram: workbook เทียบสถานะจริงในระบบ

สเปค §7 ข้อ 3 สั่งให้ "ตรวจ flow ปัจจุบันให้ตรง state diagram ของ workbook" — ทำโดย
**พิสูจน์ด้วย integration test บน DB จริง แทนการสร้าง state machine กลางตัวใหม่**
(state machine กลางจะเป็นกติกาชุดที่สองซ้อนกับด่านที่มีอยู่):

```
PO_RECEIVED / QC_PENDING / PHOTO_PENDING ──(มีราคา)──▶ IN_STOCK ──(POS)──▶ SOLD_CASH
                                                          │
                                     (เปิดสัญญา) ─────────┴──▶ SOLD_INSTALLMENT
                                                                    │
   ┌────────────────────────┬───────────────────────────────────────┤
   │ ยึดเครื่อง (JP5)        │ เปลี่ยนเครื่อง (A.4)                    │ ยกเลิกสัญญา
   ▼                        ▼                                       ▼
REPOSSESSED             REFURBISHED                              IN_STOCK
   │                        │                                (คืนพร้อมราคาเดิม)
   │ markReadyForSale       │ ปุ่ม "นำเข้าคลังพร้อมขาย"
   │ (ตีราคาใหม่)            │ (ยืนยันราคา)
   ▼                        ▼
REFURBISHED ──(ขายผ่านเมนูยึด)──▶ SOLD_RESELL          IN_STOCK
```

ปักไว้ที่ `apps/api/src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts`
(5 เคส บน DB จริง): เครื่องเดียวเปิดสองสัญญาพร้อมกันไม่ได้ · ขายสดซ้ำไม่ได้ · **ห่วงโซ่
ลบเครื่อง → รับ IMEI เดิมเข้าใหม่ → ขายซ้ำ ถูกปิดครบสาย** · MEMO exchange → `REFURBISHED`
→ ปุ่มนำเข้าคลัง → ขาย POS ได้ · ยึดเครื่อง `SOLD_INSTALLMENT → REPOSSESSED → REFURBISHED
→ SOLD_RESELL`. ส่วนด่าน `deletedAt` ของการเปิดสัญญา/เปลี่ยนเครื่อง (รวม race ภายใน tx)
อยู่ที่ `product-guard.integration.spec.ts`. ทั้งสองไฟล์อยู่ใต้
`src/modules/contracts/__tests__/` ซึ่ง CI glob ครอบแล้ว (เพิ่มไว้ตั้งแต่ Phase 3).

### spec §7 ต่างจากความจริงตรงไหน (อ่านก่อนเชื่อสเปค)

| สเปคเขียนว่า | ความจริงในโค้ด |
|---|---|
| ต้องเพิ่ม guard กัน IMEI ซ้ำ (ข้อ 1) | **กันอยู่แล้ว** ด้วย partial unique index ตั้งแต่ T5-C12 — รูจริงคือ (ก) `remove()` ไม่มี guard ⇒ ปลด IMEI ให้ว่างแล้วรับเข้าใหม่ (ข) `activate()`/exchange finalize **ไม่เช็ค `deletedAt`** ⇒ เปิดสัญญาบนสินค้าที่ถูกลบได้ |
| ขายได้เฉพาะ `IN_STOCK` **/ `REFURBISHED`** (ข้อ 2) | POS (`sale-writer`) รับ **`IN_STOCK` อย่างเดียว** และคำตัดสินเจ้าของ 2026-08-21 คือคงไว้แบบนั้น — `REFURBISHED` ต้องกดปุ่มนำเข้าคลัง (ยืนยันราคา) ก่อน |
| ทำ state machine กลางให้ตรง diagram (ข้อ 3) | ใช้ integration test พิสูจน์ flow จริงแทน — ด่านที่มีอยู่ (`product-hold` / `product-enter-stock` / `MANUAL_TRANSITION_DENY` / `FOUND_POLICY`) **คือ** กติกา ไม่สร้างชั้นที่สอง |

### carries ที่ยังเปิดอยู่ (ตรวจแล้วว่าจริง ณ 2026-08-22)

**ลำดับต้น — ของที่พังอยู่วันนี้:**

- **`apps/web/src/pages/StockAdjustmentsPage.tsx:126` ไม่ส่ง `approverId` เลย** ขณะที่
  `CreateStockAdjustmentDto.approverId` เป็น `@IsNotEmpty` และ service เช็คเป็น guard แรก
  ⇒ **ฟอร์มปรับสต็อกตาย 400 ทั้งใบ ทุกเหตุผล ไม่ใช่แค่ `FOUND`** (pre-existing ไม่ใช่ของ
  Phase 5). ผลตามมา: `FOUND_POLICY` ที่เพิ่งทำ **ยังไม่เคยถูกใช้จากหน้าจอเลย** — ต้องเพิ่ม
  ช่องเลือกผู้อนุมัติในฟอร์ม (`GET /users/approvers` มีอยู่แล้ว) ก่อนจะพิสูจน์ได้ว่า
  allow-list ทำงานจริงบนเส้นทางผู้ใช้.
- **`audit.log` ภายใน `$transaction` เป็นทั้งคลาส ไม่ใช่จุดเดียว** — Phase 5 Task 5 แก้ไป
  5 จุด (contract-exchange) แต่ sweep ยังพบผู้ต้องสงสัย: `contract-lifecycle.service.ts:313`,
  `closing.service.ts:150/320`, `monthly-close.service.ts:250/437`,
  `other-income-lifecycle.service.ts:694/1008`, `refunds.service.ts:336`,
  `repair-ticket-lifecycle.service.ts` (7 จุด). **อาจมี false positive** (บางจุดเรียกหลัง tx
  ปิดแล้ว) ⇒ ต้องตรวจทีละจุด ห้ามไล่แก้เหมา. กลไก: `AuditService.log` เปิด **root
  `$transaction` ซ้อน** ⇒ P2028 / pool starvation ⇒ **audit หายเงียบ** (Task 4 พบว่า
  `EXCHANGE_MEMO_APPLIED` มี 0 แถว ทั้งที่ย้ายกรรมสิทธิ์เครื่องจริง). และ
  **`tx.auditLog.create` ไม่ใช่คำตอบเสมอไป** — มันทิ้ง `rowHash`/`sequenceNumber` เป็น NULL
  ⇒ แถวหลุด Merkle chain (`verifyChain` กรองออก). ทางที่ถูกคือย้ายไปเรียก **หลัง tx commit**.
  ดักไว้แล้วที่ call site ของ `finalizeAfterActivation` (คอมเมนต์เตือนว่าสองใบนั้นปลอดภัย
  เพราะ **ไม่มี `userId`** เท่านั้น — เติม `userId` ตรง ๆ = สร้าง P2028 กลับมา).

**carries จาก Tasks 1-5 (เรียงตามผลกระทบ):**

- **ไม่มีความสามารถ "ล้างราคา"** — ทำให้ข้อความของด่านยืนยันราคาต้องอ้อมไปทางที่ทำได้จริง
  (ยืนยันทับ / แก้ยอดที่หน้าจัดการราคา) แทนที่จะบอกว่า "ล้างราคาเดิมทิ้ง"
- **provenance ปิด two-hop PATCH** — ปลายทางปิดแล้ว แต่ยังไม่มีร่องรอยว่าเครื่องมาจาก
  สายไหน ⇒ แยก "เครื่องใหม่ที่ยังไม่เคยตั้งราคา" กับ "เครื่องมือสองที่ถือราคาเก่า" ได้จาก
  สถานะเท่านั้น
- **`po-receiving`** ยังไม่ผ่าน helper (ยอมรับได้วันนี้เพราะตั้งราคาในใบเดียวกัน — ถ้าวันใด
  ใบรับของอนุญาตให้ข้ามราคา ต้องต่อ helper ทันที)
- `liveRows` jsdoc ค้างยุค (M1) · `StockReservationService.PRODUCT_INCLUDE` เป็น clone ที่
  **ไม่กรอง `deletedAt`** (M2) · `FOUND_POLICY.RESERVED` hint ชี้ "ยกเลิกจอง" ที่ยังไม่มี UI (M3)
- **ไม่มีหน้าจอกู้เครื่องที่ถูก soft-delete** — ทางเดียวคือ stock adjustment reason `FOUND`
  ซึ่งฟอร์มพังอยู่ (ข้อบน) ⇒ วันนี้กู้ผ่าน UI ไม่ได้เลย
- `consume-order-hold.util.ts:60` ล็อกแถวโดยไม่เช็ค `deletedAt` (ออเดอร์ที่จ่ายช้าเดินต่อบน
  เครื่องที่ถูกลบ) · `products.service.create()` ไม่เช็ค IMEI ก่อน ⇒ ชน P2002 ดิบ = 500
  (ควรเป็นข้อความไทย) · TOCTOU ของด่านนอก tx (ด่านใน tx ปิดเคสหลักแล้ว)
- **P2034 ที่เส้นทางรับชำระ** — ดู `.claude/rules/accounting.md` หัวข้อ "ผลข้างเคียงที่ต้อง
  เฝ้า" (รอ Sentry spike ก่อนลงมือ ไม่เติมล่วงหน้าแบบเหวี่ยงแห)
