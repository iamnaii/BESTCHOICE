# การจอง / มัดจำ — รีดีไซน์ + ล็อกเครื่อง + ใบรับมัดจำ + ครบวงจรในหน้าแชท

- วันที่: 2026-10-05 · สถานะ: **เจ้าของเคาะ mockup แล้ว รอรีวิว spec**
- mockup (12 กระดาน): `https://claude.ai/artifact/1do1Dgg1fspTeXm188xYFV` — อ้างชื่อกระดานในเอกสารนี้เป็น 1A–5C
- โค้ดเดิม: `apps/web/src/pages/BookingsPage.tsx` (991 บรรทัด ไฟล์เดียว) · `apps/api/src/modules/bookings/`
- ข้อเท็จจริงตั้งต้น: **prod มีใบจอง 0 ใบ** (ตรวจ 2026-10-05) ⇒ ไม่มีข้อมูลเก่าให้ย้าย ทุกกติกาใหม่เริ่มจากศูนย์ได้

## 1. เป้าหมาย

ทำให้ "ใบจอง" เป็นเครื่องมือหน้าร้านที่ใช้จริงได้ทั้งลูกค้าเดินเข้าร้านและลูกค้าในแชท:
สร้างใบจอง → รับมัดจำ (เครื่องถูกล็อกให้ลูกค้า + ลูกค้าได้ใบรับมัดจำ) → ระบบเตือนก่อนหมดอายุ → ลูกค้ามารับ จ่ายส่วนต่าง ออกใบขาย

### ขอบเขต (ทำ)
1. หน้า `/bookings` ใหม่ทั้งหน้า (รายการ · ฟอร์มสร้าง · แผงรายละเอียด · กล่องยืนยันยกเลิก · จอโทรศัพท์)
2. รับมัดจำแล้ว **ล็อกเครื่อง** (`Product.status = RESERVED`) จนกว่าจะขาย / ยกเลิก / หมดอายุ
3. ใบจอง **ผูกเครื่องในสต็อก 1 เครื่องเท่านั้น** (ตัดรายการพิมพ์เอง)
4. **ใบรับเงินมัดจำ** เลข `DP-YYYYMMDD-NNNN` ออกอัตโนมัติตอนรับมัดจำ พิมพ์ได้ + ส่งเข้าแชท/LINE ได้
5. **LINE เตือนลูกค้าอัตโนมัติ** ก่อนหมดอายุ 1 วัน (ใบที่มัดจำแล้ว)
6. **ในหน้าแชท**: แท็บ "จอง/มัดจำ" · สร้างใบจองจากแชท · ส่งสรุป+บัญชีโอน · ลากสลิปมาวาง = รับมัดจำ · ใบรับมัดจำกลับเข้าแชท

### นอกขอบเขต (ไม่ทำรอบนี้)
- บอทขายสร้างใบจองเอง · ใบจองแบบไม่ผูกเครื่อง (pre-order) · ใบรับเงินคืนมัดจำตอนยกเลิก (คืนเงินยังบันทึกในสมุดเงินหน้าร้านตามเดิม) · เปลี่ยนเครื่องในใบที่มัดจำแล้ว (ยังต้องยกเลิกแล้วออกใบใหม่) · การลงบัญชีใหม่ (ไม่มี JE เพิ่ม — ดู §7)

## 2. คำตัดสินเจ้าของ (2026-10-05 — ปิดประเด็น)

| # | คำตัดสิน | ผลต่อแบบ |
|---|---|---|
| 1 | รับมัดจำแล้วล็อกเครื่อง · ยกเลิก/หมดอายุ/ขาย ปลดเอง · ใบที่ยังไม่รับมัดจำไม่ล็อก | §4, §5.1 |
| 2 | ใบจองผูกเครื่องในสต็อกเท่านั้น | ฟอร์ม 2A ไม่มีช่องพิมพ์รายการเอง · API บังคับ 1 เครื่อง (§6.1) |
| 3 | ใบรับเงินมัดจำ พิมพ์ได้ + ส่ง LINE ได้ | กระดาน 4C · §5.2 §6.4 |
| 4 | LINE เตือนอัตโนมัติก่อนหมดอายุ 1 วัน แม่แบบแก้ได้ที่หน้าแจ้งเตือน | §9 |
| 5 | ค่าเริ่มต้นหน้ารายการ = "ที่ยังเปิดอยู่" เรียงใกล้หมดอายุก่อน | §3.1 |
| 6 | ระบบในหน้าแชท "ครบวงจรออนไลน์" | กระดาน 5A–5C · §8 |

## 3. หน้าจอ (web)

แยก `BookingsPage.tsx` เป็นโฟลเดอร์ตามแบบ `CustomersPage/`: `pages/BookingsPage/index.tsx` + `components/` (`BookingKpiCards`, `BookingTable`, `CreateBookingDialog`, `BookingDetailSheet`, `CancelBookingDialog`, `DepositReceiptCard`) + `hooks/` (`useBookingsQuery`, `useBookingFilters` — URL params). ไฟล์เดิมลบ · export `STATUS_LABEL`/`computeBookingTotal`/`isDepositInRange` ย้ายไป `pages/BookingsPage/utils.ts` (มีเทสอ้างอยู่)

### 3.1 หน้ารายการ (1A / 1B / 2B)
- **PageHeader** เดิม + ปุ่ม "สร้างใบจอง" (OWNER / BRANCH_MANAGER / SALES)
- **KPI 6 ใบ** กดกรองได้ เขียน URL param ชุดเดียวกับดรอปดาวน์ (แบบ `CustomerKpiCards`): ที่ยังเปิดอยู่ (`open=1`) · รอชำระมัดจำ (`status=PENDING_DEPOSIT`) · มัดจำแล้ว (`status=PAID`, ใบย่อย: ยอดมัดจำที่ถืออยู่) · ใกล้หมดอายุ ≤ 3 วัน (`expiring=3`) · ปิดแล้ว (`status=CLOSED` = CONVERTED+CANCELED+EXPIRED) · มัดจำที่ริบเดือนนี้ (ตัวเลขอย่างเดียว ไม่กรอง) — ตัวเลขจาก `GET /bookings/summary` (§6.2)
- **ตัวกรอง**: ค้นหา (เลขที่ · ชื่อ · เบอร์โทร · IMEI) · สถานะ · สาขา (เฉพาะ `CROSS_BRANCH_ROLES`) · ช่วงวันที่สร้าง (`DateRangeChips` เดิม → `from/to`) · ทุกตัวอยู่ใน URL
- **ค่าเริ่มต้น**: `open=1` + เรียง `expireDate asc` · ตัวกรองอื่นเรียง `createdAt desc`
- **ตาราง** = `DataTable` กลาง `density="dense"` 9 คอลัมน์ กว้างรวม **1,120 px** (งบโซน shop จอ 1440): เลขที่/สร้างเมื่อ 136 · ลูกค้า (ชื่อ+เบอร์) 190 · สินค้าที่จอง (ชื่อ+IMEI/สภาพ) 236 · สาขา 92 · มัดจำ (บรรทัดล่าง "จาก ยอดรวม") 108 · คงเหลือ 100 · สถานะ 118 · หมดอายุ (วันคงเหลือ + วันที่) 96 · ⋯ 44 — ข้อมูลเดิมครบทุกช่อง ไม่ตัดคอลัมน์
- หมดอายุ: `อีก n วัน` · `พรุ่งนี้`/`วันนี้` = `text-warning-strong` + ไอคอนนาฬิกา · เลยกำหนดแต่ cron ยังไม่ปิด = "หมดอายุแล้ว · รอระบบปิด" · ใบปิดแล้ว = วันที่เหตุการณ์ (ขาย/คืนมัดจำ/ริบ)
- แถวกดได้ทั้งแถว → เปิดแผงด้านขวา (`?bookingId=` เดิม) · เมนู ⋯ ท้ายแถว = เปิด / รับมัดจำ / ยกเลิก (ตามสิทธิ์+สถานะ)
- **หน้าว่าง (1B)**: `EmptyState` + 3 ขั้น + บรรทัดกติกา (อายุ 7 วัน · ล็อกเครื่องเมื่อรับมัดจำ · LINE เตือน · ริบ/คืน) · ซ่อน KPI และตัวกรองเมื่อ `total === 0` ทั้งระบบ (ไม่ใช่แค่ผลกรองว่าง)
- **จอโทรศัพท์ (2B)** `< md`: การ์ดแทนตาราง · KPI เป็นชิปเลื่อนข้าง · ปุ่ม + มุมบน

### 3.2 ฟอร์มสร้างใบจอง (2A)
Dialog กว้าง 760 · 4 ขั้นในหน้าเดียว:
1. **ลูกค้าและสาขา** — combobox ค้นหาชื่อ/เบอร์ (`GET /customers?search=` เดิม · ไม่ส่ง `view` — ต้องเห็นทั้งลูกค้าและผู้สนใจ) เลือกแล้วเป็นชิป + ลิงก์ "สร้างลูกค้าใหม่" เปิด `CustomerCreateDialog` เดิมแล้วเลือกให้อัตโนมัติ · สาขา = ของผู้ใช้ (OWNER เลือกได้)
2. **เครื่องที่จอง** — `BookingProductPicker` เดิม (ค้น ≥ 2 ตัวอักษร เฉพาะ `IN_STOCK` ในสาขา) → การ์ดเครื่อง (ชื่อ · IMEI · สภาพ/ประวัติเสียหาย · ราคาเงินสด · "พร้อมขาย") + ปุ่มเปลี่ยนเครื่อง · **ไม่มีช่องพิมพ์รายการเอง** · ราคาตกลง = ช่องแก้ได้ (ค่าเริ่มต้นราคาเงินสด; ≥ 0) · ข้อความกำกับ: "เครื่องจะถูกล็อกไว้ให้ลูกค้าทันทีที่รับมัดจำ · ก่อนรับมัดจำยังขายได้ตามปกติ"
3. **มัดจำและวันหมดอายุ** — ช่องมัดจำ + ชิป 10% / 20% / 50% / เต็มจำนวน (ปัดเป็นบาท) · ชิปวันหมดอายุ 3 / 7 / 14 วัน / เลือกวันที่ (ค่าเริ่มต้น 7 · ส่ง `toBangkokExpiryInstant` สิ้นวันเหมือนเดิม) · แถบสรุป ยอดรวม / มัดจำ / คงเหลือ (ไม่ใช่ Input readOnly) · มัดจำต้อง 0 < มัดจำ ≤ ยอดรวม (เดิมยอมให้ 0 — เปลี่ยนเป็นต้อง > 0 เพราะใบที่ไม่มีมัดจำไม่มีอะไรให้ล็อก)
4. **หมายเหตุ** — `Textarea`
ปุ่มท้าย: ยกเลิก · บันทึกใบจอง · **บันทึกและรับมัดจำเลย** (บันทึกแล้วเปิดแผง 3A พร้อมช่องรับเงิน)
แก้ไขใบที่ยังไม่รับมัดจำ = ฟอร์มเดียวกัน · ใบที่มัดจำแล้วแก้ได้เฉพาะหมายเหตุ + วันหมดอายุ (กติกาเดิมของ API)

### 3.3 แผงรายละเอียด (3A / 3B / 4A) — `Sheet` ด้านขวา 620 px
- หัว: เลขที่ (mono) + ป้ายสถานะ + "สร้าง เมื่อ · โดย · สาขา" + เมนู ⋯ + ปิด · แถบใต้หัว: วันหมดอายุ + วันคงเหลือ (+ วันที่จะส่ง LINE เตือน เมื่อ PAID)
- ส่วน: ลูกค้า (ชื่อ · เบอร์ + คัดลอก · ลิงก์ดูลูกค้า) · เครื่องที่จอง (การ์ด + สถานะสด: `พร้อมขาย · จะล็อกเมื่อรับมัดจำ` / `ล็อกไว้ให้ลูกค้ารายนี้แล้ว` / `ถูกขาย/ย้ายสาขาไปแล้ว` สีแดง) · ยอดเงิน (ยอดรวม · มัดจำ (+ วิธี/เวลา/ผู้รับ/เลขใบรับมัดจำ) · คงเหลือ) · **กล่องใบรับมัดจำ** (พิมพ์ · ส่งเข้าแชท/LINE อีกครั้ง · สถานะส่งล่าสุด) · หมายเหตุ · ประวัติ (ไทม์ไลน์จาก `events[]` §6.3)
- **ปุ่มหลักปุ่มเดียวตามสถานะ** (กล่องขอบเขียว): `PENDING_DEPOSIT` → `TenderInput` + "บันทึกรับมัดจำ N บาท" · `PAID` + มัดจำไม่เต็ม → `TenderInput` ส่วนต่าง + แถบ "รวม N · ครบพอดี / ขาด N" + ติ๊กยืนยัน + "รับส่วนต่าง N และออกใบขาย" · `PAID` + มัดจำเต็ม → "ออกใบขายโดยใช้มัดจำ" · ติ๊ก "เครื่องมีประวัติเสียหาย…" แสดงเฉพาะ `wasPreviouslyDamaged` และ OWNER / FINANCE_MANAGER (กติกาเดิม) · ขายสำเร็จ → เปิดใบขาย/ใบเสร็จต่อทันที (navigate `/sales?saleId=` ตามหน้าประวัติการขายเดิม)
- **เมนู ⋯**: แก้ไขใบจอง / แก้หมายเหตุ-วันหมดอายุ · ยกเลิกใบจอง (→ 4B) · ลบใบจอง (OWNER / BRANCH_MANAGER · เฉพาะ PENDING · มีกล่องยืนยัน)
- สถานะปิดแล้ว (4A): อ่านอย่างเดียว · แถบบน: ขายแล้ว (ปุ่มเปิดใบขาย) / ยกเลิก (เหตุผล · คืนมัดจำ เท่าไร ทางไหน เมื่อไร) / หมดอายุ (ริบมัดจำ N เข้ารายได้) · ไม่มีเมนู ⋯
- ใบที่เลยกำหนดแต่ cron ยังไม่ปิด: แถบเตือน "ถึงกำหนดแล้ว รอระบบปิดเวลา 00:30" ปุ่มทุกอย่างปิด (กติกาเดิม)

### 3.4 กล่องยืนยันยกเลิก (4B)
`AlertDialog`: บอกยอดคืน + ช่องทางคืน "ตามวิธีที่รับมา" + ลงสมุดเงินหน้าร้านของวันนี้ + "เครื่องจะกลับเป็นพร้อมขายทันที" · **เหตุผลบังคับ** (ชิป: ลูกค้าเปลี่ยนใจ · ไม่ผ่านเครดิต · เครื่องถูกขายไปก่อน · เปลี่ยนรุ่น/สี + ช่องพิมพ์) · ปุ่มแดง "ยืนยันยกเลิกและคืนมัดจำ N" · ใบ PENDING: ข้อความไม่มีเรื่องคืนเงิน

### 3.5 ใบรับเงินมัดจำ (4C)
หน้าพิมพ์ `/bookings/:id/deposit-receipt/print` (staff · browser print แบบ `GoodsReceiptPrintPage`) และหน้าสาธารณะ `/dp/:token` (ลูกค้า · นอก `ProtectedRoute`) เนื้อหาเดียวกัน: หัวร้าน+สาขา (ที่อยู่/เบอร์จาก `Branch`) · "ใบรับเงินมัดจำ" + เลข DP + วันเวลา · ลูกค้า (ชื่อ · เบอร์ **ปิดบางส่วน** บนหน้าสาธารณะ) · อ้างอิง BK + ผู้รับเงิน · เครื่อง (ชื่อ · IMEI · "ล็อกให้ลูกค้าแล้ว") · ราคาเครื่อง / มัดจำที่รับ (วิธี) / คงเหลือ · กล่องกำหนดรับเครื่อง + กติการิบ/คืน · ท้าย: "หลักฐานการรับเงินมัดจำ ไม่ใช่ใบกำกับภาษี · ใบเสร็จฉบับเต็มออกเมื่อชำระครบ"

### 3.6 ในหน้าแชท (5A / 5B / 5C) — ดู §8

## 4. กติกาธุรกิจและสถานะ

```
PENDING_DEPOSIT ──รับมัดจำ──▶ PAID ──รับส่วนต่าง+ขาย──▶ CONVERTED
   │  │                        │  │
   │  └──ยกเลิก──▶ CANCELED    │  └──ยกเลิก (คืนมัดจำ 100%)──▶ CANCELED
   └──cron 00:30 เลย expireDate──▶ EXPIRED ◀──cron (ริบมัดจำ)──┘
เครื่อง:  IN_STOCK ──(รับมัดจำ)──▶ RESERVED ──(ขาย)──▶ SOLD_CASH
                                   └──(ยกเลิก / หมดอายุ)──▶ IN_STOCK
```
- **ล็อกตอนรับมัดจำ** (`payDeposit`, ใน tx เดียวกับ JE/สมุดเงิน): `product.updateMany({ where: { id, status: 'IN_STOCK', branchId: booking.branchId, deletedAt: null }, data: { status: 'RESERVED' } })` → `count !== 1` ⇒ `409 เครื่องนี้ถูกขายหรือย้ายสาขาไปแล้ว กรุณาแก้ใบจองเลือกเครื่องอื่นก่อนรับมัดจำ` (ธุรกรรมทั้งก้อน rollback — ไม่มีการรับเงินโดยไม่ล็อก) · เรียก `preemptReservationsInTx(tx, [productId])` ให้เหมือนของแถมสัญญา · เขียน `Booking.lockedProductId`
- **ปลดล็อก**: `cancel` (จาก PAID) และ `autoExpire` (จาก PAID): `product.updateMany({ where: { id: lockedProductId, status: 'RESERVED' }, data: { status: 'IN_STOCK' } })` + ล้าง `lockedProductId` · ไม่ผ่าน `product-enter-stock.util` โดยตั้งใจ — คลาสเดียวกับปลดจองของแถม (เครื่องเป็น IN_STOCK มีราคาอยู่ก่อนแล้ว) · ถ้า `count = 0` (เครื่องถูกเปลี่ยนสถานะด้วยมือระหว่างล็อก) ไม่ throw: บันทึก AuditLog `BOOKING_UNLOCK_SKIPPED` + Sentry warning แล้วปิดใบตามปกติ
- **ขาย** (`convert`): claim สต็อกเปลี่ยนเป็น `status: lockedProductId === product.id ? 'RESERVED' : 'IN_STOCK'` (ใบ PAID ก่อน deploy ที่ไม่มีล็อกยังขายได้) · `preemptReservationsInTx` คงเดิม
- **หนึ่งล็อกต่อหนึ่งเครื่อง**: partial unique index `bookings(locked_product_id) WHERE locked_product_id IS NOT NULL AND deleted_at IS NULL` (raw SQL ใน migration แบบ `products_imei_serial_active_unique`) + CAS บน `status: 'IN_STOCK'` เป็นด่านแรก
- **ผลต่อที่อื่น**: POS / เปิดสัญญา / ของแถม ไม่เห็นเครื่อง RESERVED อยู่แล้ว (ต้อง IN_STOCK) · `product-hold.util` กันลบ/แก้ IMEI อยู่แล้ว (ข้อความ remedy "ยกเลิกจองก่อน" ตอนนี้มีปุ่มจริงแล้ว) · หน้ารายการสินค้า แท็บ "ทั้งหมด": แถว RESERVED แสดง "จองไว้ · BK-… (ลูกค้า)" ลิงก์ไปใบจอง (อ่านจาก `Booking.lockedProductId`) · หน้ารายละเอียดสินค้า: ป้ายเดียวกัน
- **ใบจอง = 1 เครื่อง**: `create`/`update` ปฏิเสธเมื่อ `items.length !== 1 || !items[0].productId || quantity !== 1` → `400 ใบจองต้องผูกเครื่องในสต็อก 1 เครื่อง` · เครื่องต้อง `IN_STOCK` ในสาขาของใบตอนสร้าง (ตรวจเพื่อข้อความดี ๆ — ด่านจริงอยู่ตอนรับมัดจำ) · `depositAmount > 0`
- **มัดจำเต็มจำนวน** (`deposit === total`): PAID แล้วขายโดยไม่ต้องรับส่วนต่าง (กติกาเดิม) — ยังล็อกเครื่องเหมือนกัน
- **หมดอายุ**: cron 00:30 เดิม (`booking-expire.cron.ts`) เพิ่มปลดล็อกใน tx เดียวกับ flip + JE ริบมัดจำ
- **การยกเลิก**: ต้องมี `cancelReason` (เดิม optional) ขั้นต่ำ 3 ตัวอักษร

## 5. ข้อมูล (Prisma)

### 5.1 `Booking` (เพิ่มคอลัมน์ — additive ทั้งหมด)
| คอลัมน์ | ชนิด | ความหมาย |
|---|---|---|
| `lockedProductId` | `String?` + partial unique (SQL) | เครื่องที่ล็อกให้ใบนี้ (ตั้งตอนรับมัดจำ ล้างตอนปลด) |
| `lockedAt` / `unlockedAt` | `DateTime?` | เวลาล็อก/ปลด |
| `sourceRoomId` | `String?` | ห้องแชทที่สร้างใบนี้ (null = หน้าร้าน) → journey "จองจากแชท" + ห้องปลายทางเริ่มต้นตอนส่งข้อความ |
| `expiryReminderSentAt` | `DateTime?` | ส่ง LINE เตือนแล้วเมื่อ |
| `expiryReminderSkipReason` | `String?` | ส่งไม่ได้เพราะอะไร (`NO_CHANNEL` / `SEND_FAILED`) — cron ไม่ลองซ้ำ |

### 5.2 ใหม่ `BookingDepositReceipt` (`booking_deposit_receipts`)
`id` · `receiptNumber String @unique` (`DP-YYYYMMDD-NNNN`) · `bookingId String @unique` (หนึ่งใบต่อหนึ่งใบจอง — ไม่มีการออกซ้ำ ใบจองใบเดียวรับมัดจำได้ครั้งเดียว) · `amount Decimal(12,2)` · `tenders Json` (snapshot บรรทัดรับเงิน) · `slipStorageKey String?` (เมื่อรับผ่านสลิป) · `issuedAt` · `issuedById` · `publicToken String @unique` (32 ไบต์ base64url) · `publicTokenExpiresAt` (= `expireDate` + 30 วัน) · `lastSentAt DateTime?` · `lastSentRoomId String?` · `lastSentChannel String?` · `createdAt/updatedAt/deletedAt`
เลขที่: `DepositReceiptNumberService` advisory lock ต่อวันไทย (แบบ `IntercoBatchNumberService` — ไม่ใช้ `findFirst desc` แบบเลข BK เพราะไม่กันชน)

### 5.3 `SlipFingerprint`
เพิ่ม `bookingId String?` + ทำ `contractId` เป็น nullable + CHECK (`contract_id IS NOT NULL OR booking_id IS NOT NULL`) · hash สูตรเดิม (`refNo|amount|bank|date` หรือ `imageUrl`) ⇒ สลิปใบเดียวใช้ปิดยอดสัญญาและมัดจำซ้ำกันไม่ได้

### 5.4 `NotificationTemplate`
seed ด้วย migration (idempotent `ON CONFLICT DO NOTHING` แบบ `20261003200000_seed_device_return_templates`): `BOOKING_EXPIRING` (ข้อความเตือนก่อนหมดอายุ) · `BOOKING_DEPOSIT_RECEIPT` (ข้อความประกอบการ์ดใบรับมัดจำ) · `BOOKING_SUMMARY` (สรุปใบจอง + บัญชีโอน) — ตัวแปร `{{customerName}} {{bookingNumber}} {{productName}} {{depositAmount}} {{balanceAmount}} {{expireDate}} {{bankAccount}} {{receiptUrl}}`

### 5.5 Migration ลำดับ
`20261018000000_booking_lock_and_source` (5.1 + partial unique · PR 2) → `20261018100000_booking_deposit_receipts` (5.2 · PR 3) → `20261018200000_seed_booking_templates` (5.4 · PR 4) → `20261018300000_slip_fingerprint_booking` (5.3 · PR 5) — ทุกตัว additive · ไม่มี backfill (prod 0 ใบ)

## 6. API (`bookings` module — roles เดิม: อ่าน OWNER/BM/FM/ACCOUNTANT/SALES · เขียน OWNER/BM/SALES · ลบ OWNER/BM)

### 6.1 เปลี่ยน
- `POST /bookings`, `PATCH /bookings/:id`: บังคับ 1 เครื่อง (§4) · รับ `sourceRoomId?` · `depositAmount > 0`
- `POST /bookings/:id/pay-deposit`: รับ `{ tenders }` (เดิม) **หรือ** `{ slipTicket }` (§8.3) · ใน tx: claim+ล็อกเครื่อง → JE/สมุดเงิน (เดิม) → สร้าง `BookingDepositReceipt` → (สลิป) `SlipFingerprint` → AuditLog `BOOKING_DEPOSIT_PAID` (+ `lockedProductId`, `receiptNumber`) · หลัง commit: journey `BOOKING_DEPOSIT_PAID` + ส่งใบรับมัดจำเข้าแชท/LINE เมื่อ `sendReceipt !== false` และมีช่องทาง (ไม่บล็อก ไม่ throw — ผลใน response `receiptDelivery: SENT|NO_CHANNEL|FAILED`)
- `POST /bookings/:id/cancel`: `cancelReason` บังคับ · ปลดล็อก · response มี `refundAmount`/`refundMethod`
- `POST /bookings/:id/convert`: claim สต็อกตาม §4 · response มี `saleId` (เดิมมี) + `receiptUrl` สำหรับเปิดใบขายต่อ
- `GET /bookings`: เพิ่ม `open=1` (PENDING+PAID), `status=CLOSED`, `expiring=<days>`, `sort=expireDate|createdAt`, `search` ค้นเพิ่ม `customer.phone` (hash/normalize แบบ `/customers`) และ `items.product.imeiSerial` · ตอบ `lockedProductId`, `depositReceipt {receiptNumber, lastSentAt}`, `product.status` ปัจจุบันของเครื่องที่ผูก (เช็คสดในแผง)
- `GET /bookings/:id`: เพิ่ม `events[]` (§6.3) + `depositReceipt` + `product.status`

### 6.2 ใหม่ — สรุป KPI
`GET /bookings/summary?branchId&from&to` → `{ open, pendingDeposit, paid, paidDepositHeld, expiringWithin3Days, closed: {converted, canceled, expired}, forfeitedThisMonth }` · scope สาขาตาม `applyBranchScope` เดิม · ตัวเลขกับตัวกรองใช้ `where` ตัวเดียวกัน (บทเรียนหน้าลูกค้า: การ์ดกับคอลัมน์ต้องอ่านฟิลด์เดียวกัน)

### 6.3 ไทม์ไลน์
`events[]` ประกอบจาก AuditLog ของ entity `booking` (`BOOKING_CREATED`, `BOOKING_UPDATED`, `BOOKING_DEPOSIT_PAID`, `BOOKING_RECEIPT_SENT`, `BOOKING_REMINDER_SENT`, `BOOKING_CANCELED`, `BOOKING_CONVERTED`, `BOOKING_EXPIRED`) — action string ธรรมดา · แต่ละ event: `at`, `actor {id,name}|'SYSTEM'`, `kind`, `data` (ยอด/วิธี/เลขเอกสาร) · เขียน AuditLog **ใน tx เดียว** (`tx.auditLog.create`) เฉพาะที่ต้อง atomic กับสถานะ (จ่าย/ยกเลิก/ขาย/หมดอายุ — เหมือนเดิม) ส่วนส่งข้อความ/เตือน เขียนหลัง commit

### 6.4 ใหม่ — ใบรับมัดจำ
- `GET /bookings/:id/deposit-receipt` (staff) → ข้อมูลพิมพ์ครบ
- `POST /bookings/:id/deposit-receipt/send { roomId? }` (OWNER/BM/SALES) → ส่งเข้าห้องที่ระบุ / ห้องล่าสุดของลูกค้า / LINE SHOP ที่ผูกไว้ (§8.4) → อัปเดต `lastSent*` + AuditLog `BOOKING_RECEIPT_SENT`
- `GET /bookings/deposit-receipts/public/:token` (ไม่มี JwtAuthGuard · controller แยกแบบ `receipts-public.controller.ts` · throttle 10/นาที · ไม่พบ/หมดอายุ/ถูกลบ = 404 เดียวกัน) → JSON display-safe: ชื่อลูกค้า · เบอร์ปิดบางส่วน · เครื่อง · ยอด · วันรับ · ที่อยู่/เบอร์สาขา · **ไม่มี** id ภายใน/ชื่อพนักงานเต็ม · ต้องเพิ่มในรายการ public endpoints ของ `.claude/rules/security.md`

### 6.5 ใหม่ — แชท
- `POST /bookings/:id/send-summary { roomId }` → ข้อความสรุป + บัญชีโอน (§8.2)
- `POST /bookings/:id/deposit-slip/read { roomId, messageId }` หรือ multipart `slip` → ผลตรวจ + `slipTicket` (§8.3)
- `GET /bookings?customerId=` เดิม (แท็บใช้)

## 7. การลงบัญชี — ไม่มีรายการใหม่

- รับมัดจำ: `ShopBookingDepositTemplate` + `ShopTenderRecorder` เดิม (ล็อกเครื่องไม่แตะ GL — สินค้าคงคลัง S11-200x ไม่เปลี่ยนจนกว่าจะขาย)
- ยกเลิก: `ShopBookingRefundTemplate` + tender OUT เดิม · หมดอายุ: `ShopBookingForfeitTemplate` เดิม · ขาย: `ShopBookingDepositAppliedTemplate` + `ShopCashSaleTemplate` เดิม
- ใบรับมัดจำเป็น **เอกสาร** ไม่ใช่รายการบัญชี และไม่ใช่ใบกำกับภาษี (SHOP ไม่จด VAT) — ระบุบนใบ
- รับผ่านสลิป = tender `BANK_TRANSFER` 1 บรรทัด `reference = refNo` → ลงบัญชีธนาคารรับเงินของร้าน (S11-1201) ตามกติกา tender เดิม

## 8. ในหน้าแชท (inbox)

### 8.1 แท็บ "จอง/มัดจำ" ใน `RoomDossier` (5A)
- แท็บที่ 5 ต่อจาก GFIN · ป้ายนับ = ใบที่ยังเปิดอยู่ของลูกค้าห้องนี้
- ต้องผูกลูกค้าแล้ว (`customerId`) — ผู้สนใจที่ยังไม่ผูก: ข้อความชี้ทางเดียวกับแท็บสัญญา + ปุ่ม "สร้างลูกค้าใหม่" (ฟอร์มเดิมของ inbox) แล้วค่อยสร้างใบจอง
- เนื้อหา: การ์ดใบจอง (เลขที่ · สถานะ · เครื่อง · มัดจำ/คงเหลือ · หมดอายุ · สถานะส่งสรุป/ใบรับมัดจำ) ปุ่ม "ส่งสรุป+บัญชีโอน(อีกครั้ง)" / "ส่งใบรับมัดจำอีกครั้ง" / "เปิดใบจอง" (navigate `/bookings?bookingId=`) · กล่องรับสลิป (เส้นประ) เมื่อมีใบ PENDING_DEPOSIT · `ProductContextCard` เดิม + ปุ่ม "สร้างใบจองจากเครื่องนี้" · ปุ่ม "สร้างใบจองใหม่จากแชท"
- สร้างจากแชท = `CreateBookingDialog` ตัวเดียวกับหน้า `/bookings` รับ `initialCustomer`, `initialProduct?`, `sourceRoomId` · สาขา = สาขาผู้ใช้ (ผู้ใช้ไม่มีสาขา = OWNER เลือก) · บันทึกแล้วถาม "ส่งสรุป + บัญชีโอนเข้าแชทเลยไหม"
- ปุ่ม "ใบจอง / มัดจำ" ในแถบเครื่องมือของช่องพิมพ์ = สลับไปแท็บนี้

### 8.2 ส่งสรุปใบจอง + บัญชีโอน
- เนื้อหา: เลขที่ · เครื่อง · ราคา · มัดจำที่ต้องโอน · บัญชีรับเงินของร้าน · รับเครื่องได้ถึง · "โอนแล้วส่งสลิปในแชทนี้ได้เลย" · การ์ดสรุป **ไม่มีปุ่มลิงก์** (ใบจองที่ยังไม่รับมัดจำไม่มีหน้าสาธารณะ — ลิงก์มีเฉพาะการ์ดใบรับมัดจำ §8.4)
- **บัญชีรับเงินของร้าน**: จากตั้งค่า "ช่องทางชำระเงิน" (`/settings/finance/payment-methods`) ที่มีอยู่ — `PaymentMethodConfig` method `BANK_TRANSFER` ที่ `isDefault` และ `accountCode` ขึ้นต้น `S` (บัญชีฝั่ง SHOP เช่น S11-1201) → รายละเอียดธนาคารจาก `BankAccount` ของบัญชีนั้น (`bankName` + `accountNumber`) · ชื่อบัญชี = ชื่อนิติบุคคล SHOP จาก `CompanyInfo` · ไม่มี config/เลขบัญชี → ปุ่มส่งสรุปปิด + ข้อความชี้ไปหน้าตั้งค่า (OWNER/FM) · `isCompanyAccount` ของด่านสลิป (§8.3) เทียบกับ `accountNumber` ชุดเดียวกันนี้ (ทุก config SHOP ที่ enabled ไม่ใช่แค่ default)
- ส่งผ่าน `MessageRouterService.sendStaffMessage` ขยายรับ `flexJson?` (persist `ChatMessage.flexJson` ที่มีอยู่แล้ว · adapter LINE ส่ง Flex · adapter อื่นใช้ `text`) · `text` = marker `[flex:booking-summary|<bookingNo>|<amount>|<expireDate>] ` + ข้อความธรรมดาเนื้อหาเดียวกัน (Facebook/TikTok เห็นข้อความธรรมดา) · inbox วาด `BookingFlexPreview` จาก marker (แบบ `PaymentFlexPreview`)
- AuditLog `BOOKING_SUMMARY_SENT` (หลัง commit) · ส่งซ้ำได้

### 8.3 ลากสลิปมาวาง → รับมัดจำ (5B)
- **ลาก**: `MessageBubble` เพิ่ม `BOOKING_MESSAGE_MIME` บนรูป (สิทธิ์ `canBooking` = OWNER/BM/SALES) · `RoomDossier` `onDrop` เมื่อ `tab === 'booking'`: มีใบ PENDING_DEPOSIT 1 ใบ → เริ่มอ่านสลิปทันที · หลายใบ → ให้เลือกใบก่อน · ไม่มี → ป้าย "ยังไม่มีใบจองที่รอมัดจำ สร้างใบจองก่อน" · ปุ่มสำรอง "เลือกรูปสลิปจากเครื่อง" (ไฟล์)
- **อ่าน**: `POST /bookings/:id/deposit-slip/read` → ดึงรูปจาก `ChatMessage.mediaUrl` ผ่าน `StorageService` (ทางเดียวกับ `RoomCreditService.attachMessage` — เฉพาะ key `staff-chat/`, ไม่รับ URL จาก client) → `VisionService.extractSlip(buffer, mime)` → `evaluateSlipChecks` เดิมโดย `expectedAmount = depositAmount`, `isCompanyAccount` = บัญชีรับเงินหน้าร้าน (§8.2), `reused` = `SlipFingerprint` → ตอบ `{ reading, checks[5], passed, ticket? }` · `ticket` = HMAC-SHA256 (`JWT_SECRET`) ของ `bookingId · messageId/fileKey · hash · amount · refNo · date · staffId` อายุ 15 นาที (รูปเดียวกับ early-payoff) — ออกเฉพาะเมื่อผ่านครบ
- **จอ**: การ์ดตรวจ 3 บรรทัดที่ลูกค้าเห็น (ยอดตรง · บัญชีร้าน · ไม่ซ้ำ) + 2 บรรทัดระบบ (อ่านได้ ≥ 90% · วันที่ไม่เป็นอนาคต) · ไม่ผ่านข้อใด: ปุ่มบันทึกปิด + บอกเหตุผล + ปุ่ม "บันทึกด้วยมือ" → เปิด `TenderInput` ปกติ (พนักงานกรอกเอง ไม่ใช้สลิปเป็นหลักฐานอัตโนมัติ)
- **ยืนยัน**: ติ๊ก "ตรวจแล้วว่าสลิปนี้เป็นของใบจองนี้จริง" (บังคับ) + "ส่งใบรับมัดจำกลับเข้าแชท" (ค่าเริ่มต้นเปิด) → `POST /bookings/:id/pay-deposit { slipTicket, sendReceipt }` → tenders = `[{ method: 'BANK_TRANSFER', amount, reference: refNo }]` + `slipStorageKey` + `SlipFingerprint{ bookingId }` (unique → P2002 = 409 "สลิปนี้ถูกใช้แล้ว") ใน tx เดียวกับล็อกเครื่อง/JE/ใบรับมัดจำ
- ยอดในสลิป ≠ มัดจำ (เช่นลูกค้าโอนมากกว่า/น้อยกว่า): ไม่ผ่าน `AMOUNT_MATCH` → ทางมือ (พนักงานแก้ยอดมัดจำในใบก่อน หรือรับผสม) — ไม่เดาเอง

### 8.4 ใบรับมัดจำกลับเข้าแชท (5C)
- ปลายทางเริ่มต้น: ห้องที่ส่งสลิป → `sourceRoomId` → ห้องล่าสุดของลูกค้า (ทุกช่องทาง) → `CustomerLineLink` channel `SHOP` ผ่าน adapter LINE SHOP (push ตรง ไม่มีห้อง) → ไม่มีเลย = `NO_CHANNEL` (จอบอก "พิมพ์ให้ลูกค้า")
- การ์ด Flex (LINE) / ข้อความธรรมดา (อื่น): เลข DP · รับแล้ว N (วิธี) · เครื่อง · คงเหลือ · มารับได้ถึง · ปุ่ม "ดูใบรับมัดจำ" → `/dp/:token` · marker `[flex:booking-receipt|<dp>|<amount>|<balance>|<expireDate>] <url>`
- การ์ดในแท็บเปลี่ยนเป็น มัดจำแล้ว · ล็อกเครื่อง · เลข DP · วันเตือน LINE
- ปิดการขายไม่ทำจากแชท (ต้องส่งมอบเครื่องจริง) — ปุ่ม "เปิดใบจอง" พาไปแผง 3B

## 9. LINE เตือนก่อนหมดอายุ

- `booking-expiry-reminder.cron.ts` ทุกวัน **09:00 เวลาไทย** (ก่อน cron ปิดใบ 00:30 ของวันถัดไป ~15 ชม.) · kill switch `SystemConfig.booking_expiry_reminder_enabled` (ไม่ seed · missing = เปิด แบบ `shop_receivable_aging_alerts_enabled`)
- เป้าหมาย: `status = PAID` · `expireDate` อยู่ในวัน "พรุ่งนี้" (ปฏิทินไทย) · `expiryReminderSentAt IS NULL` · `expiryReminderSkipReason IS NULL` · ใบที่สร้างและหมดอายุภายใน 1 วัน (ไม่มี "พรุ่งนี้") = ไม่เตือน
- ส่งผ่าน helper เดียวกับ §8.4 ด้วยแม่แบบ `BOOKING_EXPIRING` (render `{{…}}`) · สำเร็จ → `expiryReminderSentAt` + AuditLog `BOOKING_REMINDER_SENT` (SYSTEM OWNER แบบ autoExpire) + `NotificationLog` category `BOOKING` · ไม่มีช่องทาง → `NO_CHANNEL` · ส่งล้ม → `SEND_FAILED` + Sentry warning (ไม่ลองซ้ำอัตโนมัติ — พนักงานเห็นในแผง "เตือนไม่สำเร็จ โทรลูกค้า")
- doctrine R-1: root prisma · ต่อใบ try/catch · ไม่ throw ออกจาก tick · Sentry capture แบบ cron อื่น
- ใบ `PENDING_DEPOSIT` **ไม่เตือน** (คำตัดสินข้อ 4 พูดถึงมัดจำที่จะถูกริบ) — เปิดเป็นสวิตช์ภายหลังได้ถ้าเจ้าของต้องการ

## 10. สิทธิ์และความปลอดภัย

- roles ตามเดิมทุก endpoint · `BRANCH_MANAGER`/`SALES` ถูก `applyBranchScope` ของ service (route รูป `/:id` — service ตรวจเอง ตามกติกา security.md)
- หน้าสาธารณะ `/dp/:token`: token 256 บิต · หมดอายุ · 404 เดียวกันทุกกรณี · throttle · ไม่มี mutating action · PII: เบอร์ปิดบางส่วน ไม่มีเลขบัตร ไม่มีชื่อพนักงานเต็ม · เพิ่มในรายการ public endpoints ของ `security.md`
- สลิป: รับเฉพาะ `messageId` ของห้องที่ผู้ใช้เข้าถึงได้ (`RoomCreditAccess` เดิม) หรือไฟล์อัปโหลด (magic-byte ตรวจชนิด · ≤ 5 MB) · ticket HMAC ผูก staffId
- AuditLog ทุกการเปลี่ยนสถานะ (เดิม) + เหตุการณ์ส่งข้อความ/เตือน (ใหม่)

## 11. การทดสอบ

- **API (jest)**: `bookings.service.spec.ts` ขยาย: ล็อกตอนรับมัดจำ (CAS ล้ม → 409 ไม่มี JE) · ปลดตอนยกเลิก/หมดอายุ · convert รับ RESERVED ของตัวเอง แต่ไม่รับ RESERVED ของใบอื่น/ของแถม · 1 เครื่องบังคับ · เลข DP กันชน (สองคอนเนกชัน แบบ `customer-phone-lock.race.db.spec.ts`) · สลิป: ticket ปลอม/หมดอายุ/ซ้ำ · summary KPI = ตัวกรอง · cron เตือน: เลือกใบถูก · ไม่ซ้ำ · kill switch · NO_CHANNEL
- **Integration (vitest DB)**: `bookings/__tests__/booking-lock-flow.integration.spec.ts` — สร้าง → รับมัดจำ (ล็อก) → POS ขายเครื่องนี้ไม่ได้ → ยกเลิก → POS ขายได้ · สร้าง → รับมัดจำ → convert → SOLD_CASH + JE เดิมครบ · **ต้องเพิ่ม glob** `src/modules/bookings/__tests__/*.integration.spec.ts` ใน vitest step ของ `deploy-gcp.yml` (ตรวจแล้ว 2026-10-05: ยังไม่มี — jest มองไม่เห็นไฟล์ `*.integration.spec.ts`)
- **Web (vitest)**: แทน `BookingsPage.test.tsx`/`.forms.test.tsx` ด้วยเทสต่อ component (KPI เขียน URL · ตารางเรียง/ป้ายหมดอายุ · ฟอร์ม 1 เครื่อง + ชิป · Sheet ปุ่มหลักตามสถานะ · กล่องยกเลิกบังคับเหตุผล · แท็บแชท + drop) · กติกา vitest เดิม: hook ห้ามคืน mock
- **E2E (playwright)**: อัปเดต `bookings.spec.ts` (ปุ่ม/ป้ายใหม่) + เพิ่ม flow รับมัดจำแล้วเครื่องหายจาก POS
- **ตรวจภาพ**: เปิด local preview วัดด้วย DOM ว่าตาราง 1,120 px ไม่ล้น/ไม่ตัดคำที่ 1440 (สูตร `scratchpad/shots/check.mjs` เดิม) · จอ 390

## 12. การปล่อย (PR ตามลำดับ — แต่ละตัว deploy แยกได้)

| PR | เนื้อหา | migration |
|---|---|---|
| 1 | API: `GET /bookings` ตัวกรอง/ค้นหา/เรียงใหม่ + `summary` + `events[]` · บังคับ 1 เครื่อง + `cancelReason` · web: หน้า `/bookings` ใหม่ทั้งหน้า (1A/1B/2A/2B/3A/3B/4A/4B) | — |
| 2 | ล็อกเครื่อง: `lockedProductId` + CAS ใน pay-deposit/cancel/expire/convert · ป้าย "จองไว้" ในรายการ/รายละเอียดสินค้า | 20261018000000 |
| 3 | ใบรับเงินมัดจำ: model + เลข DP + หน้าพิมพ์ + หน้าสาธารณะ + public controller + กล่องในแผง (4C) + `sourceRoomId` | 20261018100000 (+ security.md) |
| 4 | แชท ก้อน 1: แท็บ จอง/มัดจำ · สร้างจากแชท · ส่งสรุป+บัญชีโอน (Flex + marker + preview) · `sendStaffMessage` รับ `flexJson` | 20261018200000 (templates) |
| 5 | แชท ก้อน 2: ลากสลิป → อ่าน → ticket → pay-deposit ด้วยสลิป → ใบรับมัดจำกลับเข้าแชท (5B/5C) | 20261018300000 |
| 6 | LINE เตือนก่อนหมดอายุ (cron + kill switch + ป้ายในแผง) | — |

- bump `apps/web/package.json` ทุก PR ที่แตะ web (YY.M.ลำดับ) · ทุก PR ผ่าน type-check api+web + jest + vitest + e2e ที่เกี่ยว · ขอผู้ตรวจอิสระอ่านก่อน push (กติกาเจ้าของ)
- หลัง PR 2 ขึ้น prod: ใบ PAID ที่สร้างก่อนหน้า (ถ้ามี) ไม่มีล็อก — convert ยังผ่านทาง `IN_STOCK` · ไม่มี backfill (prod 0 ใบ)
- ถอยกลับ: ทุก migration additive · ถอย PR 2 ขณะมีเครื่อง RESERVED จากใบจอง = เครื่องค้าง RESERVED จนกว่าจะปลดมือ (ยกเลิกใบจองในเวอร์ชันเดิมไม่ปลด) ⇒ ถ้าต้องถอยให้ปลดด้วย SQL จาก `locked_product_id` ก่อน

## 13. ที่ยังเปิดอยู่ (ไม่บล็อก — ตัดสินตอนทำแผนหรือรอบหน้า)

- เปลี่ยนเครื่องในใบที่มัดจำแล้ว (ตอนนี้ยกเลิก+ออกใหม่) — ถ้าเจ้าของต้องการ ค่อยเพิ่ม "เปลี่ยนเครื่อง" ที่ปลดล็อกเดิม/ล็อกใหม่ใน tx เดียว
- ใบรับเงินคืนมัดจำตอนยกเลิก (เอกสารให้ลูกค้า) — ไม่ได้ขอ
- ภาพรวมสต็อก: จำนวน "จองไว้" ในหน้าภาพรวมคลัง
- เตือนใบ PENDING_DEPOSIT ที่ยังไม่โอน (สวิตช์แยก)
