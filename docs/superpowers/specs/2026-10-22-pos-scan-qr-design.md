# ยิง QR / IMEI ที่หน้าขาย (POS) — เลือกเครื่องทันที หรือบอกเหตุผลที่ขายไม่ได้ (A4 · 2026-10-22)

ก้อน 3 ของแผนปิดช่องว่าง Tooltify → BESTCHOICE (A5 สติกเกอร์ 60×40 + QR = PR #1726 · A4 = งานนี้ · A6 ฉลากพัสดุ = ถัดไป).
Mockup ที่เจ้าของเคาะ: canvas `TAzRReVG6MaHZZ7tfiUZZB` บอร์ด `Pos.dc.html` (เจ้าของสั่ง "เริ่มต่อได้เลย" 2026-10-22).

## เจตนา

พนักงานหน้าร้านยิง QR บนสติกเกอร์ (หรือยิงบาร์โค้ด IMEI บนกล่อง) ที่ช่องค้นหาของหน้าขาย แล้ว**ระบบเลือกเครื่องให้ทันที**
โดยไม่ต้องกดจากรายการ. ถ้าเครื่องนั้นขายไม่ได้ ระบบต้องบอก**เหตุผลที่มันรู้** (ใครจอง ขายไปเมื่อไร อยู่สาขาไหน ยังไม่ผ่านขั้นตอนอะไร)
พร้อมปุ่มพาไปจัดการต่อ ไม่ใช่แค่ "ไม่พบสินค้า".

เครื่องยิงทำงานเป็นคีย์บอร์ด: พิมพ์ค่าที่อ่านได้แล้วกด Enter — จึงไม่ต้องมีปุ่ม "ยิง" แยก และการค้นหาด้วยชื่อรุ่นแบบเดิมยังใช้ได้เหมือนเดิม.

## สิ่งที่ QR บนสติกเกอร์เข้ารหัส (จาก A5 — `stickerView.ts resolveStickerId`)

IMEI (`Product.imeiSerial`) → ถ้าไม่มี ใช้รหัสสินค้าเดิม (`Product.legacyProductCode`) → ถ้าไม่มี ใช้ `Product.id` ทั้งก้อน.
การค้นหาตอนยิงจึงเทียบ**ค่าเท่ากันทั้งสาม**ช่องนี้ (ไม่ใช่ `contains`).

## เป้าหมาย / ไม่ทำ

- ทำ: endpoint ค้นหาแบบค่าเท่ากัน + ตัดสิน "ขายได้ไหม เพราะอะไร" ฝั่ง server · Enter ที่ช่องค้นหา POS เรียก endpoint นี้ ·
  แถบเขียวเมื่อเลือกให้แล้ว · แถบแดง (`role="alert"`) เมื่อไม่ได้ พร้อมปุ่มพาไปต่อ และ**คงค่าที่ยิงไว้ในช่อง**ให้ตรวจเอง.
- ไม่ทำ: เปลี่ยนกติกาขาย (`assertSaleProductEligible` ยังเป็นด่านจริงตอนบันทึกขาย — เช่น `wasPreviouslyDamaged` ต้องยืนยันตอนขายเหมือนเดิม) ·
  ไม่กรองข้อมูลทดสอบ (`assertSameTestSide` ตัดสินตอนขายเหมือนรายการค้นหาเดิม) · ไม่แตะหน้าสร้างสัญญา / ของแถม / รับซื้อ ·
  ไม่มีเสียง/สั่น · ไม่เพิ่มการตั้งค่า.

## API — `GET /products/scan?code=<ค่าที่ยิง>`

- Roles: `OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES` (ชุดเดียวกับ `GET /products`) · ประกาศ**ก่อน** `@Get(':id')`.
- DTO `ScanProductDto { code: string }` — `@IsString() @Length(1, 128)` ข้อความไทย "กรุณาระบุรหัสที่ยิง"; service ตัดช่องว่างหัวท้าย.
- ราคาทุน: controller ตัด `costPrice` ออกจาก `product` เมื่อ `!canSeeCost(user.role)` (SALES) เหมือน `findOne`.
- Service ใหม่ `ProductScanService.scan(rawCode, actor: { role; branchId? })` ที่ `apps/api/src/modules/products/services/product-scan.service.ts`
  (ไม่ยัดเข้า `products.service.ts` ที่ใหญ่อยู่แล้ว) — ลงทะเบียนใน `ProductsModule`.

### ผลลัพธ์ `ScanOutcome`

```ts
type ScanReason =
  | 'SELLABLE' | 'NOT_FOUND' | 'DELETED' | 'OTHER_BRANCH'
  | 'BOOKED' | 'DRAFT_CONTRACT' | 'WEB_RESERVED' | 'RESERVED'
  | 'ON_CONTRACT' | 'SOLD' | 'NOT_READY';

interface ScanOutcome {
  code: string;                       // ค่าที่ค้น (trim แล้ว)
  reason: ScanReason;
  sellable: boolean;                  // === (reason === 'SELLABLE')
  product: ProductRow | null;         // แถวเต็มรูปเดียวกับ GET /products (include เดิม + effectiveShopWarrantyDays) — null เมื่อ NOT_FOUND/DELETED
  branch: { id: string; name: string } | null;                                            // สาขาของเครื่อง
  booking: { id: string; bookingNumber: string; customerName: string; expireDate: string } | null;
  contract: { id: string; contractNumber: string; customerName: string; status: string } | null;
  sale: { id: string; saleNumber: string; customerName: string; soldAt: string } | null;
  reservation: { expiresAt: string } | null;
}
```
วันที่เป็น ISO string (เว็บเป็นคนจัดรูป "25 ต.ค." ด้วย `formatDateShortThai`). ช่องที่ไม่เกี่ยวกับ reason นั้นเป็น `null`.

### ลำดับตัดสิน (หยุดที่ข้อแรกที่เข้า)

1. ค้นเครื่องที่ยังไม่ถูกลบ: `product.findFirst({ where: { deletedAt: null, OR: [{ imeiSerial: code }, { legacyProductCode: code }, { id: code }] }, include: productInclude })`
   (IMEI ของเครื่องที่ยังอยู่ไม่ซ้ำกันตาม partial unique `products_imei_serial_active_unique`).
   ไม่พบ → ค้นซ้ำเฉพาะแถวที่ถูกลบ (`deletedAt: { not: null }`) — เจอ = `DELETED` · ไม่เจอ = `NOT_FOUND`.
2. `SOLD_CASH` / `SOLD_RESELL` → `SOLD` + ใบขายล่าสุดที่ยังไม่ถูกยกเลิก (`sale.findFirst({ where: { productId, deletedAt: null }, orderBy: { createdAt: 'desc' } })`,
   `soldAt = sale.createdAt`) — เครื่องยึดที่ขายต่อผ่านสัญญาอาจไม่มีแถว `Sale` ⇒ `sale: null` แต่ reason ยังเป็น `SOLD`.
3. `SOLD_INSTALLMENT` → สัญญาที่ยังผูกอยู่ (`contract.findFirst({ where: { productId, deletedAt: null, status: { notIn: ['DRAFT', 'CANCELED'] } }, orderBy: { createdAt: 'desc' } })`
   — นิยามเดียวกับ `ProductsService.loadActiveContract`) → `ON_CONTRACT`; ไม่มีสัญญา (ขายผ่านไฟแนนซ์นอกตั้ง `SOLD_INSTALLMENT` เหมือนกัน) → `SOLD` ตามข้อ 2.
4. สาขา: `!hasCrossBranchAccess(actor) && actor.branchId !== product.branchId` (รวมบัญชีที่ไม่มีสาขา — fail-closed) → `OTHER_BRANCH`
   (กติกาเดียวกับ `assertSaleProductEligible`; OWNER/FM/ACCOUNTANT ข้ามสาขาได้ ซึ่งหน้าขายส่ง `branchId` ของเครื่องอยู่แล้ว).
   เหตุที่ตรวจหลังข้อ 2–3: "ขายไปแล้ว" เป็นข้อเท็จจริงที่เฉพาะกว่า "อยู่สาขาอื่น" และไม่หลอกให้ไปขอโอนเครื่องที่ไม่มีอยู่แล้ว.
5. `RESERVED` → ถามเจ้าของการจองตามลำดับ: ใบจอง `PAID` ที่ล็อกเครื่อง (`booking.findFirst({ where: { lockedProductId, status: 'PAID', deletedAt: null } })` — ชุดเงื่อนไขเดียวกับ `booking-lock.util.ts`) → `BOOKED` ·
   ร่างสัญญา (`contract.findFirst({ where: { productId, status: 'DRAFT', deletedAt: null } })`) → `DRAFT_CONTRACT` ·
   จองผ่านเว็บที่ยังไม่หมดเวลา (`productReservation.findFirst({ where: { productId, status: 'ACTIVE', expiresAt: { gt: now } } })`) → `WEB_RESERVED` ·
   ไม่พบเจ้าของ → `RESERVED` (สถานะไม่มีเจ้าของในสคีมา — ให้ผู้จัดการตรวจในคลัง).
6. `IN_STOCK` → `SELLABLE`.
7. สถานะอื่นทั้งหมด (`PO_RECEIVED` `QC_PENDING` `PHOTO_PENDING` `INSPECTION` `REPOSSESSED` `REFURBISHED` `DAMAGED` `DEFECT_RETURN` `LOST` `WRITTEN_OFF` `ADJUSTMENT_PENDING`
   และค่าใหม่ในอนาคต) → `NOT_READY` (เว็บแปลงป้ายจาก `statusLabels` ของมันเอง — สถานะใหม่ที่ยังไม่มีป้ายแสดงรหัสดิบ ไม่ล้ม).

`product` ใน SELLABLE คือแถวเดียวกับที่รายการค้นหาส่ง ⇒ หน้าขายใช้ `handleSelectProduct(product)` เดิมได้ทันที (ราคาตั้งต้น/ของแถม/สาขาเหมือนกดจากรายการ).

## เว็บ — `apps/web/src/pages/POSPage`

### `scanOutcome.ts` (pure · ไม่มี DOM)

- `isScanCandidate(value)`: `trim().length >= 3` และ**ไม่มีช่องว่าง** — Enter หลังพิมพ์ "iPhone 15" ไม่ใช่การยิง (รายการค้นหาเดิมทำงานอยู่แล้ว) ·
  IMEI 15 หลัก / รหัสสินค้า / uuid ผ่านทั้งหมด.
- `scanIdLabel(product)`: imei → `{ label: 'IMEI', text }` · `legacyProductCode` → `{ label: 'รหัส', text }` · ไม่งั้น `{ label: 'ID', text: id.slice(0, 8) }` (กติกาเดียวกับสติกเกอร์ A5).
- `describeScanBlock(outcome)` → `{ title, detail, link: { label, to } | null }` — ข้อความทุกเหตุผล (ชี้ทางเฉพาะที่ role ที่เจอ error เข้าถึงได้จริง — ตรวจ `App.tsx` แล้ว:
  `/bookings` `/stock/products` `/sales` `/contracts/:id` เปิดให้ SALES ทุกเส้นทาง · `/bookings?bookingId=` `/sales?saleId=` `/stock/products?view=all&q=` เป็น deep link ที่มีอยู่แล้ว — **`/stock` เฉย ๆ คือหน้าภาพรวมที่ไม่อ่าน `q`** และหน้ารายการสินค้าต้อง `view=all` ไม่งั้นเห็นเฉพาะเครื่องพร้อมขาย (ผลตรวจทานอิสระ 2026-10-22)):

| reason | title (ต่อท้าย "เครื่องนี้ขายไม่ได้ตอนนี้ · ") | detail | link |
|---|---|---|---|
| `NOT_FOUND` | *(ไม่มีคำนำ)* `ไม่พบรหัส “<code>” ในระบบ` | `ถ้าพิมพ์ชื่อรุ่น ให้เลือกจากรายการด้านล่าง · ถ้ายิงจากสติกเกอร์ ลองยิงใหม่อีกครั้ง` | — |
| `DELETED` | *(ไม่มีคำนำ)* `เครื่องรหัส <code> ถูกลบออกจากระบบแล้ว` | `ถ้าเครื่องยังอยู่จริง ให้ผู้จัดการตรวจสอบก่อนขาย` | — |
| `OTHER_BRANCH` | `อยู่สาขาอื่น` | `เครื่องอยู่ที่ <branch.name> — ให้ผู้จัดการโอนมาสาขานี้ก่อน` | — (role ที่ได้เหตุผลนี้มีแค่ SALES/BM ซึ่งหน้าคลังสินค้าไม่แสดงเครื่องของสาขาอื่นให้ — `findAll` บังคับ `branchId` เมื่อ `groupAccessories` · โอนเครื่องทำได้เฉพาะ OWNER/BM) |
| `BOOKED` | `จองไว้แล้ว` | `ใบจอง <bookingNumber> ของ<ชื่อลูกค้า> หมดอายุ <D MMM>` | `เปิดใบจอง <bookingNumber>` → `/bookings?bookingId=<id>` |
| `DRAFT_CONTRACT` | `ติดร่างสัญญา` | `ร่างสัญญา <contractNumber> ของ<ชื่อลูกค้า>` | `เปิดร่างสัญญา <contractNumber>` → `/contracts/<id>` |
| `WEB_RESERVED` | `ลูกค้าจองผ่านเว็บ` | `หมดเวลาจอง <DD/MM/YYYY HH:mm>` (`formatDateTime`) | `ดูในคลังสินค้า` → `/stock/products?view=all&q=<code>` |
| `RESERVED` | `ติดจอง` | `ระบบไม่พบว่าใครถือเครื่องนี้ — ให้ผู้จัดการตรวจสถานะในคลังสินค้า` | `ดูในคลังสินค้า` → `/stock/products?view=all&q=<code>` |
| `ON_CONTRACT` | `ติดสัญญาผ่อน` | `สัญญา <contractNumber> ของ<ชื่อลูกค้า>` | `เปิดสัญญา <contractNumber>` → `/contracts/<id>` |
| `SOLD` | `ขายไปแล้ว` | มีใบขาย: `ใบขาย <saleNumber> ของ<ชื่อลูกค้า> เมื่อ <D MMM>` · ไม่มี: `ไม่พบใบขายของเครื่องนี้ — ให้ผู้จัดการตรวจประวัติการขาย` | มีใบขาย: `เปิดใบขาย <saleNumber>` → `/sales?saleId=<id>` |
| `NOT_READY` | `<statusLabels[status].label ?? status>` (เช่น รอถ่ายรูป) | `เครื่องยังไม่ผ่านขั้นตอนเข้าคลัง — ต้องเป็น “พร้อมขาย” ก่อนจึงขายได้` | `ดูในคลังสินค้า` → `/stock/products?view=all&q=<code>` |
| *(reason ที่เว็บยังไม่รู้จัก — แท็บเก่าข้าม deploy)* | `<reason ดิบ>` | — | — |

"ของ<ชื่อลูกค้า>" = `ของ` + `honorific(name)`: เติม `คุณ` หน้าชื่อเมื่อชื่อยังไม่ขึ้นต้นด้วย นาย/นาง/นางสาว/คุณ (ข้อมูลลูกค้าบางแถวเก็บคำนำหน้าในชื่อ).

### `ProductSearch.tsx`

- Enter ในช่อง `#pos-product-search` เมื่อ `isScanCandidate(ค่า)` และไม่ได้กำลังยิงอยู่ → `GET /products/scan?code=<trim>` (`useMutation` — เรียกตามเหตุการณ์ ไม่ใช่ตามค่าช่อง).
  ระหว่างรอ: ข้อความ "กำลังตรวจรหัส…" ใต้ช่อง · Enter ซ้ำไม่ยิงซ้ำ.
- `sellable` → `onSelectProduct(outcome.product)` (หน้าขายล้างช่องค้นหาและตั้งราคาตั้งต้นเองใน `handleSelectProduct`) และจำผลไว้ → การ์ดเครื่องที่เลือกมี
  **แถบเขียว** (`Alert variant="success" appearance="solid"`, `role="status"`) ข้อความ `ยิงแล้ว · เลือกเครื่องให้แล้ว` + บรรทัดรอง `<label> <text>` จาก `scanIdLabel` (ฟอนต์ mono).
  แถบหายเมื่อกด "เปลี่ยน" หรือเครื่องที่เลือกไม่ใช่เครื่องที่ยิง (เช่น เลือกจากรายการแทน).
- ไม่ sellable → **แถบแดง** `Alert variant="destructive" appearance="solid"` `role="alert"` เหนือช่องค้นหา: title + detail จาก `describeScanBlock` · ปุ่ม `link` (ถ้ามี — `Link` ของ react-router สไตล์ปุ่ม)
  + ปุ่ม `ยิงเครื่องอื่น` (ล้างแถบ ล้างช่อง และโฟกัสช่องค้นหา) · **ค่าที่ยิงยังอยู่ในช่อง** (mockup: "คงค่าที่ยิงไว้ให้ตรวจเอง") — รายการค้นหาเดิมใต้ช่องยังทำงานกับค่านั้น.
  แถบหายเมื่อ: ยิงครั้งถัดไป · กด "ยิงเครื่องอื่น" · เลือกเครื่องจากรายการ.
- เรียกไม่สำเร็จ (เครือข่าย/500) → แถบแดงเดียวกัน title `ตรวจรหัสไม่สำเร็จ` detail = `getErrorMessage(error)` ไม่มี link (ไม่ใช้ toast — ข้อความอยู่ตรงที่ตามอง).
- placeholder เปลี่ยนเป็น `ค้นหารุ่น / IMEI / รหัสสินค้า — ยิง QR ได้เลย` · `aria-label` คงเดิม (`ค้นหาสินค้า รุ่น หรือ IMEI` — e2e `sales-menu-regression.spec.ts` อ้างชื่อนี้).
- ตัวกรองเครื่องนอก/ไทย (`DeviceOriginFilter`) ไม่มีผลกับการยิง (ยิงคือค่าเท่ากัน 1 เครื่อง).

### ไม่เปลี่ยน

`POSPage/index.tsx` ไม่แก้ — `handleSelectProduct` รับ `Product` รูปเดิม · `types.ts Product` เพิ่ม `legacyProductCode?: string | null` (รายการ `GET /products` ส่งอยู่แล้ว แค่ type ไม่ประกาศ).

## ทดสอบ

- API jest: `services/product-scan.service.spec.ts` (prisma mock แบบ `products.service.spec.ts`) ครบทุก reason + where ของการค้น + ลำดับ (ขายแล้วที่สาขาอื่น = `SOLD`) +
  `effectiveShopWarrantyDays` ติดมากับ product · `products.controller.spec.ts` เพิ่ม: SALES ไม่เห็น `costPrice` ใน `product` ของ scan, OWNER เห็น.
- เว็บ vitest: `scanOutcome.test.ts` (candidate / idLabel / ข้อความทุก reason / honorific) · `components/ProductSearch.test.tsx` (harness แบบ `CustomerSearch.test.tsx`):
  Enter ยิงแล้วเลือกให้ + แถบเขียว · Enter เจอ BOOKED → `role="alert"` + ลิงก์ href + "ยิงเครื่องอื่น" ล้าง · Enter บนข้อความมีช่องว่างไม่เรียก API ·
  error เครือข่าย → แถบแดง · ขณะรอไม่ยิงซ้ำ.
- เวอร์ชันเว็บ 26.10.49.

## ที่รู้ว่ายังเปิด

- ยิงเครื่องของสาขาอื่นที่ขายไปแล้ว/ติดสัญญา: ลิงก์ `/sales?saleId=` และ `/contracts/:id` อาจเปิดไม่เห็นใบ (หน้าปลายทาง scope สาขาของ SALES) — ข้อเท็จจริงถูก ปุ่มอาจว่าง; ยอมรับได้.
- เครื่องที่ `wasPreviouslyDamaged` ถูกเลือกให้แล้วไปชนด่านตอนบันทึกขาย (POS ไม่มีช่องยืนยัน `previouslyDamagedAcknowledged` — เหมือนกดจากรายการเดิม) — งานต่อ: ส่งธงใน `ScanOutcome` ขึ้นคำเตือนบนแถบเขียว หรือเพิ่ม UI ยืนยันที่ POS.
- เครื่องยิงบางรุ่นส่ง Tab แทน Enter — ตั้งค่าที่ตัวเครื่องยิงเป็น Enter (suffix CR) · ไม่รองรับ Tab ในรอบนี้.
- ไม่มี endpoint ค้นค่าเท่ากันสำหรับหน้าอื่น (รับซื้อ/โอน/นับสต็อก) — ถ้าต้องการให้ reuse `ProductScanService` ไม่เขียนชุดที่สอง.
