# Web-shop: ยกเครื่องหน้ารายละเอียดสินค้า (ProductDetailPage overhaul)

วันที่: 2026-07-21
สถานะ: DESIGN (full scope — user เลือกเก็บครบ 3 heavy items หลัง scrutinize เตือน)
โมดูล: `apps/web-shop` (ProductDetailPage + components ใหม่) + `apps/api/src/modules/shop-catalog`
ต่อยอด: #1368 (iPhone-only/มือ1-2/cashPrice) + #1369 (model filter) — main `91f992381`

## เป้าหมาย (หนึ่งประโยค)

ทำหน้า `/products/:id` ให้แสดงข้อมูลเครื่องครบแบบร้านใหญ่ (JIB) — ตารางสเปกเครื่อง, รูปครบ+ซูม+360, เลือกเครื่องเจาะจง, สต็อก, breadcrumb, รุ่นใกล้เคียง — โดยแต่ละส่วน **conditional (มีข้อมูล-ก็-โชว์)** เพื่อติดสว่างเองเมื่อเจ้าของกรอก data

## บริบท (scrutinize ×2)

- prod มี **1 สินค้า** (iPhone 16 NEW), `gallery/gallery360` ว่าง, `cashPrice/installmentPrice` null → **คอขวดจริงคือ data เจ้าของ**; งานนี้ทำ UI ให้พร้อมรับ data (ไม่พังตอนว่าง)
- backend `getProductDetail` unit ปัจจุบันคืน: id, conditionGrade, batteryHealth, hasBox, shopWarrantyDays, cashPrice, imeiPartial, gallery, gallery360 ([shop-catalog.service.ts:210-219]) — **ขาด hasCharger/hasHeadphones/installmentPrice/color** (frontend interface ประกาศ hasCharger/hasHeadphones ไว้แต่ backend ไม่ส่ง)
- installment-preview คิดต่อ `productId` ([installment-preview.service.ts:31] `findUnique`) → unit picker re-key ได้จริง แต่ต้อง re-key **2 query** (hero preview [ProductDetailPage.tsx:91] + InstallmentCalculatorCard [:294])
- reuse ได้: `Dialog` (ui/dialog.tsx → lightbox), `InstallmentCalculatorCard` (รับ productId + มีตัวเลือกงวด 3-12), `ProductCard` (related), `shopBaseWhere()`, `smartStockCount()`

## ขอบเขต (in-scope — เก็บครบ 3 heavy items)

### Backend
- **B1** `getProductDetail` units: +`hasCharger`, +`hasHeadphones`, +`installmentPrice`, +`color` (ต่อ unit)
- **B2** endpoint ใหม่ `GET /api/shop/products/:id/related` → รุ่นอื่น (Apple, phone-cat, in-stock, ≠ รุ่นปัจจุบัน) ผ่าน `shopBaseWhere` → ProductGroup[] (+stock) limit 6

### Frontend (ProductDetailPage + components ใหม่)
- **F1** Breadcrumb (Home › สินค้าทั้งหมด › รุ่น)
- **F2** Gallery: ปลดล็อกรูปเกิน 5 + คลิกซูม lightbox (Dialog) + 360 spin (ถ้ามี gallery360)
- **F3** Unit picker: เลือกเครื่องเจาะจง → ราคา/สเปก/ผ่อน อัปเดตตาม (re-key 2 query ด้วย selectedUnit.id)
- **F4** ตารางรายละเอียดเครื่อง (conditional): แบต% · ความจุ · สี · กล่อง/สายชาร์จ/หูฟัง · ประกันร้าน · IMEI
- **F5** สต็อก (นับ units รวมทุก tier) "เหลือ X เครื่อง"
- **F6** แยกใหม่/มือสอง: ใหม่→ซ่อนเกรด/แบต, โชว์ "เครื่องใหม่ ประกันศูนย์"; มือสอง→เกรด+แบต+ตารางตำหนิ
- **F7** Related section "รุ่นใกล้เคียง" (ProductCard grid)

### Non-goals
- Schema/migration (ใช้ field เดิม) · owner data tooling (แยก) · tabs (ใช้ section เรียง) · quantity/compare/bundle

## ดีไซน์

### Backend

**B1 — `getProductDetail` units (shop-catalog.service.ts)**
เพิ่มใน push (หลัง hasBox) + interface `ProductUnit`:
```ts
color: u.color ?? undefined,
hasCharger: u.hasCharger ?? undefined,
hasHeadphones: u.hasHeadphones ?? undefined,
installmentPrice: u.installmentPrice != null ? Number(u.installmentPrice) : null,
```
(cashPrice มีแล้ว; installmentPrice per-unit จำเป็นเพื่อ feed InstallmentCalculatorCard ต่อ unit)

**B2 — related (shop-catalog.service.ts + controller.ts)**
```ts
async listRelated(productId: string): Promise<ProductGroup[]> {
  const product = await this.prisma.product.findFirst({
    where: { id: productId, ...shopBaseWhere() },
  });
  if (!product) return [];
  const groups = await this.prisma.product.groupBy({
    by: [...GROUP_BY],
    where: { ...shopBaseWhere(), model: { not: product.model } },
    _min: { cashPrice: true },
    _count: { id: true },
    orderBy: [{ _count: { id: 'desc' as const } }],
    take: 6,
  });
  // map เหมือน listGroupedByModel (sample findFirst per group, minPrice/monthly/condition)
}
```
controller `@Get('products/:id/related')` (path ลึกกว่า `products/:id` — ไม่ชน) + map `smartStockCount` เหมือน `list`

### Frontend — components ใหม่ (apps/web-shop/src/components/)

| Component | หน้าที่ | reuse |
|---|---|---|
| `catalog/Breadcrumb.tsx` | nav path | — |
| `catalog/ImageLightbox.tsx` | ซูม/pan รูปใน Dialog | Dialog |
| `catalog/Product360Viewer.tsx` | drag หมุน gallery360 frames | — |
| `catalog/UnitPicker.tsx` | chips เลือกเครื่อง (grade/สี/แบต/ราคา) → onSelect | — |
| `catalog/SpecTable.tsx` | ตาราง conditional rows | — |
| `catalog/RelatedSection.tsx` | useQuery related + ProductCard grid | ProductCard |

### Frontend — ProductDetailPage restructure
- `ProductUnit`/`ProductDetail` interface: +color/hasCharger/hasHeadphones/installmentPrice per unit
- state `selectedUnitId` (default = เครื่องถูกสุด = `flatUnits` min cashPrice); `flatUnits = Object.values(tiers).flatMap(t=>t.units)`
- `selectedUnit = flatUnits.find(u=>u.id===selectedUnitId) ?? flatUnits[0]`
- ราคา = `selectedUnit.cashPrice` (>0 else "สอบถามราคา")
- hero preview query: `queryKey:['shop-product-preview', selectedUnitId]`, `productId=${selectedUnitId}`, enabled เมื่อ `selectedUnit?.installmentPrice`
- `<InstallmentCalculatorCard productId={selectedUnitId} cashPrice={selectedUnit.cashPrice} installmentPrice={selectedUnit.installmentPrice} />`
- `<UnitPicker units={flatUnits} selectedId={selectedUnitId} onSelect={setSelectedUnitId} isNew={isNew} />` (โชว์เฉพาะเมื่อ flatUnits.length > 1)
- `<SpecTable unit={selectedUnit} storage={data.storage} isNew={isNew} />`
- stock = `flatUnits.length` → StockIndicator/badge
- gallery: `data.gallery` (ไม่ slice) → thumbnails ทั้งหมด; main image คลิก → `<ImageLightbox images={gallery} index={activeImage} />`; ถ้า `data.gallery360.length>0` → ปุ่ม/แท็บ "360°" → `<Product360Viewer frames={gallery360} />`
- Breadcrumb บนสุด · RelatedSection ท้ายหน้า (ก่อน/หลัง Reviews)

## ไฟล์ที่แตะ
Backend: `shop-catalog.service.ts`, `shop-catalog.controller.ts`, `shop-catalog.service.spec.ts`
Frontend: `pages/ProductDetailPage.tsx` + 6 components ใหม่ใน `components/catalog/`

## Testing
- api jest: `getProductDetail` คืน field ใหม่ (hasCharger/hasHeadphones/installmentPrice/color per unit); `listRelated` — groupBy `model: { not }` + shopBaseWhere + limit 6, exclude รุ่นปัจจุบัน, product ไม่พบ→[]
- frontend: tsc + build เขียว; (ถ้ามี infra) render test UnitPicker/SpecTable conditional
- manual: unit picker เปลี่ยน→ราคา+ผ่อน+สเปก sync; lightbox เปิด/ซูม; 360 หมุน (ต้องมี data); related grid; conditional rows ซ่อนเมื่อ null

## Data-dependencies (owner — ทำให้ส่วนต่างๆ ติดสว่าง)
รูป (gallery), 360 set (gallery360 — มือสองมักไม่มี), cashPrice/installmentPrice, batteryHealth/hasCharger/hasHeadphones/สี/ประกัน per เครื่อง, ≥2 รุ่น (related)

## Risks
ไม่มี migration · แต่ละ section conditional (ไม่พังตอน data ว่าง) · rollback = revert · ⚠️ scrutinize เตือน: 360/unit-picker/related คือ investment เผื่ออนาคต (ร้าน 1 สินค้า) — user ยืนยันเก็บครบ
