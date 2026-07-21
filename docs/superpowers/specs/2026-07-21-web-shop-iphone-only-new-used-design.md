# Web-shop: iPhone-only + แยกมือ 1 (ใหม่) / มือ 2 (มือสอง)

วันที่: 2026-07-21
สถานะ: DESIGN (รอ user review)
โมดูลที่เกี่ยว: `apps/web-shop` (storefront), `apps/api/src/modules/shop-catalog`

## เป้าหมาย (หนึ่งประโยค)

ให้หน้าร้านออนไลน์ (`/products`) ขาย **เฉพาะ iPhone** และแยกให้ลูกค้าเห็น + กรองได้ชัดว่าเครื่องไหน **มือ 1 (ใหม่)** / **มือ 2 (มือสอง)** พร้อมปิดบั๊กที่หน้าร้านโชว์ราคาต้นทุน (costPrice) แทนราคาขาย

## บริบท / สภาพปัจจุบัน (trace แล้ว)

- ธุรกิจ SHOP ขาย **มือถือใหม่ + มือสอง + อุปกรณ์เสริม** (CLAUDE.md) โดยแยกบัญชีคลัง/รายได้ตามสภาพ: `S11-2001` (ใหม่) / `S11-2002` (มือสอง), `S41-1101` (ใหม่) / `S41-1102` (มือสอง) → แกน "ใหม่/มือสอง" เป็นแกนธุรกิจจริง
- ข้อมูลใหม่/มือสองถูกเก็บใน `Product.category` (enum `ProductCategory`: `PHONE_NEW`, `PHONE_USED`, `TABLET`, `ACCESSORY`) — `schema.prisma:168-173`, `1638`
  - มีข้อมูลจริงทั้งสองฝั่ง: PO receiving ตั้ง default `PHONE_NEW` (`po-receiving.service.ts:164`); trade-in accept ตั้ง `PHONE_USED` (`trade-in-lifecycle.service.ts:417`)
- **ปัญหาที่ต้องแก้ (จาก /scrutinize):**
  1. หน้า `/products` มีปุ่มกรองแบรนด์ Apple/Samsung/OPPO/Xiaomi และ API ไม่บังคับแบรนด์ → โชว์แบรนด์อื่นได้
  2. หน้าร้านไม่โชว์ใหม่/มือสองเลย (โชว์แค่เกรด A/B/C ซึ่งเป็นตำหนิของมือสอง คนละเรื่อง)
  3. **[BLOCKER ของดีไซน์]** `getProductDetail` ดึง units ด้วย brand+model+storage แต่ **ไม่กรอง category** (`shop-catalog.service.ts:140-150`) → ถ้าแยกการ์ดตาม category การ์ดมือ 1 จะลิงก์ไปหน้าที่โชว์มือสองปนมา
  4. เครื่องใหม่ไม่มี `conditionGrade` → tier ในหน้า detail จะกลายเป็น key `"unknown"` → เรนเดอร์ "เกรด unknown" (`service.ts:154`, `ProductDetailPage.tsx:214`)
  5. **[บั๊กราคา — margin leak]** หน้าร้านทั้งหมดโชว์/กรอง/เรียงด้วย `costPrice` (ต้นทุน) ไม่ใช่ `cashPrice`/`installmentPrice` (ราคาขาย) — `service.ts:74-75, 85-86, 95, 109, 156`. ยืนยันว่า costPrice = ต้นทุนจริง: กำไร = `sellingPrice.sub(costPrice)` (`sales-query.service.ts:98`) + ระบบ strip costPrice ออกจาก response ของ non-OWNER (`sales-query.service.ts:115-119`). แปลว่าเว็บกำลังโชว์ต้นทุนให้คนนอกเห็น = ตั้งราคาต่ำกว่าจริง + leak margin

## ขอบเขต

### In-scope
- A. บังคับ iPhone-only ที่ backend + ลบ UI กรองแบรนด์
- B. เพิ่ม facet "สภาพเครื่อง" (มือ 1/มือ 2): DTO param + regroup + payload + ตัวกรอง + ป้าย + หน้า detail
- C. ปิดบั๊กราคา: หน้าร้านอ่าน `cashPrice`/`installmentPrice` แทน `costPrice` (costPrice ต้องไม่หลุดออกสู่ public เด็ดขาด)
- D. แก้คำโฆษณา/SEO จาก "iPhone มือสอง" → "iPhone มือ 1 & มือ 2"

### Non-goals (ไม่แตะ)
- Schema/migration ใด ๆ (ใช้ field `category`, `cashPrice`, `installmentPrice` ที่มีอยู่แล้ว)
- ระบบบัญชี/การเงิน, flow ตะกร้า/ผ่อน/checkout, การจัดการสต็อกฝั่ง staff (แก้แค่ read ใน shop-catalog)
- /sell (ขาย/เทิร์น) — แยกโมดูล
- ความแม่นยำของ `conditionGrades` บนการ์ด (pre-existing: เอาจาก sample ถูกสุดตัวเดียว — นอก scope)

## ดีไซน์

### A. iPhone-only enforcement (backend-hard)

ใน `shop-catalog.service.ts` ตั้งค่าคงที่ระดับโมดูล:
```ts
const SHOP_BRAND = 'Apple';                     // ⚠️ verify ค่าจริงใน DB ก่อน (ดู Open verifications)
const PHONE_CATEGORIES = ['PHONE_NEW', 'PHONE_USED'] as const;
```
Base `where` ของทั้ง list + detail เพิ่ม:
```ts
brand: SHOP_BRAND,
category: { in: [...PHONE_CATEGORIES] },
```
- ตัด Samsung/OPPO/Xiaomi (ต่างแบรนด์) และ iPad/AirPods/Mac (category `TABLET`/`ACCESSORY`) ออกจากหน้าร้าน = **เฉพาะ iPhone จริง**
- ผลข้างเคียงที่ยืนยันแล้วกับ user: อุปกรณ์เสริม/แท็บเล็ตจะไม่โผล่บนเว็บ (ตรงกับ "ขายเฉพาะไอโฟน")

Frontend `apps/web-shop`:
- `CatalogPage.tsx`: ลบ `BRANDS` pills + brand state + brand query param + heroNoun brand-map → heroNoun คงที่ = `'iPhone'`
- `FilterSidebar.tsx`: ลบ brand `<select>`

### B. facet "สภาพเครื่อง" (มือ 1 / มือ 2)

**B1. DTO** — `list-products.dto.ts` เพิ่ม:
```ts
@IsOptional() @IsIn(['NEW', 'USED'])
condition?: 'NEW' | 'USED';
```
map: `NEW → PHONE_NEW`, `USED → PHONE_USED` (คำศัพท์ public แยกจาก enum ภายใน)

**B2. Grouping** — `listGroupedByModel`:
- group key เปลี่ยนจาก `['brand','model','storage']` → `['brand','model','storage','category']`
- ผล: iPhone 16 128GB ที่มีทั้งใหม่+มือสอง = **2 การ์ดแยก**
- ถ้ามี `filters.condition` → เพิ่ม `where.category = PHONE_NEW|PHONE_USED` (ทับ base `in` ให้แคบลง)
- `allGroups` (total) ต้อง group ด้วย key เดียวกัน (`+category`)

**B3. Payload** — `ProductGroup` interface (`service.ts:4-15`) เพิ่ม field:
```ts
condition: 'NEW' | 'USED';   // มาจาก g.category
```
ProductCard interface ฝั่ง web-shop เพิ่ม `condition` ด้วย (ผ่าน mapping ใน CatalogPage ที่ปัจจุบันเติม `stock`)

**B4. ตัวกรอง UI** — `CatalogPage.tsx`:
- แถวใหม่แทนแถวแบรนด์: **"สภาพเครื่อง: [ทั้งหมด] [มือ 1 · ของใหม่] [มือ 2 · มือสอง]"**
- state `condition` sync กับ URL ผ่าน `useSearchParams` (มีอยู่แล้ว, `CatalogPage.tsx:77`) → key `?condition=NEW|USED`
- ตัวกรองเกรด A/B/C เดิม: **แสดงเฉพาะเมื่อ `condition !== 'NEW'`** (มือ 1 ไม่มีเกรดตำหนิ)

**B5. ป้ายบนการ์ด** — `ProductCard.tsx`:
- ป้ายมุมรูป: `NEW → "มือ 1 · ของใหม่"` (โทนเขียว emerald), `USED → "มือ 2 · มือสอง"` (โทนกลาง)
- การ์ดมือ 1: `conditionGrades` ว่าง (เพราะ sample.conditionGrade = null) → ไม่มีชิปเกรด = ถูกต้องอยู่แล้ว

**B6. หน้า detail** — แก้ 2 seam:
- `getProductDetail`: `allUnits` where **เพิ่ม `category: product.category`** (ปิด BLOCKER #3) → หน้า detail โชว์เฉพาะ units ที่ตรง category กับการ์ดที่กด
- เครื่องใหม่ (PHONE_NEW): **ซ่อน tier/label "เกรด"** (ปิด #4) — โชว์ป้าย "เครื่องใหม่ · มือ 1" ใต้ชื่อรุ่นแทน; มือสองยังโชว์เกรดเหมือนเดิม
- ส่ง `category` → คำนวณ `condition` โชว์ป้ายบน `ProductDetailPage.tsx`

### C. ปิดบั๊กราคา (costPrice → cashPrice/installmentPrice)

**หลักการ: `costPrice` ต้องไม่ถูก return หรือใช้คำนวณอะไรที่ public เห็น**

`shop-catalog.service.ts`:
- price filter (`minPrice`/`maxPrice`): `where.costPrice` → `where.cashPrice`
- sort price_asc/desc: `_min: { costPrice }` → `_min: { cashPrice }`
- group `_min`: `{ costPrice: true }` → `{ cashPrice: true }`
- `minPrice = _min.cashPrice`; monthly = `calculateMonthlyPayment(cashPrice-based, ...)`
- detail tiers + units: `costPrice` → `cashPrice`
- **Fallback (cashPrice = null):** ไม่ fall กลับไป costPrice เด็ดขาด → `minPrice = null` แล้วการ์ด/detail โชว์สถานะ **"สอบถามราคา"** (แทน ฿0) + ปุ่มทักไลน์; นับเป็น data-dependency ให้เจ้าของกรอก cashPrice
- (Refinement — verify: ใช้ `installmentPrice` เป็นฐานยอดผ่อน/เดือน ถ้ามันคือราคาผ่อนรวม; ถ้าไม่ชัดใช้ cashPrice เป็นฐานประมาณการเหมือนเดิม แต่เป็น cashPrice ไม่ใช่ costPrice)

### D. คำโฆษณา / SEO (จาก "มือสองอย่างเดียว" → ครอบคลุมมือ 1)

- `lib/copy.ts:46` heroTitle, `:54` serviceBuyTitle (`ซื้อ/ผ่อนมือถือ`→`ซื้อ/ผ่อน iPhone`), `:287` about milestone
- `HomeHero.tsx:24` inline `iPhone มือสองคุณภาพ` → `iPhone มือ 1 & มือ 2 คุณภาพ`
- `HomePage.tsx:142` "ซื้อมือถือมือสอง..." เพิ่มเครื่องใหม่
- meta description 6 หน้า: `HomePage.tsx:86`, `CatalogPage.tsx:74`, `ContactPage.tsx:24`, `AboutPage.tsx:72`, `HowItWorksPage.tsx:88`, `PromotionsPage.tsx:47` — `iPhone มือสอง` → `iPhone มือ 1 และมือสอง`

## ไฟล์ที่แตะ

Backend (`apps/api`):
- `modules/shop-catalog/dto/list-products.dto.ts` — +`condition`
- `modules/shop-catalog/shop-catalog.service.ts` — iPhone hard-filter, group +category, price basis cashPrice, +condition payload, detail category filter + new-phone handling
- `modules/shop-catalog/shop-catalog.service.spec.ts` — tests (TDD)

Frontend (`apps/web-shop`):
- `pages/CatalogPage.tsx`, `components/catalog/FilterSidebar.tsx`, `components/catalog/ProductCard.tsx`, `pages/ProductDetailPage.tsx`
- `lib/copy.ts`, `pages/HomePage.tsx`, `components/hero/HomeHero.tsx`, `pages/AboutPage.tsx`, `pages/ContactPage.tsx`, `pages/HowItWorksPage.tsx`, `pages/PromotionsPage.tsx`

## Testing (TDD — jest ฝั่ง api, พฤติกรรมสำคัญ)

`shop-catalog.service.spec.ts`:
1. list คืนเฉพาะ `brand='Apple'` + category ∈ {PHONE_NEW,PHONE_USED} (กัน Samsung + กัน iPad/accessory)
2. `condition='NEW'` → เฉพาะ PHONE_NEW ; `'USED'` → เฉพาะ PHONE_USED
3. รุ่น+ความจุเดียวกันที่มีทั้งใหม่+มือสอง → **2 groups** (แยก card)
4. ราคา/เรียง/min ใช้ `cashPrice` ไม่ใช่ `costPrice`; **response ไม่มี costPrice โผล่** ที่ไหนเลย
5. cashPrice = null → minPrice = null (ไม่ fall กลับ costPrice)
6. `getProductDetail` จากการ์ด PHONE_USED → คืนเฉพาะ units PHONE_USED (ไม่ปนใหม่) ; PHONE_NEW → ไม่มี tier "unknown"

Frontend: verify build เขียว + (ถ้ามี) render test การ์ดโชว์ป้ายถูก condition

## Owner data-dependencies (นอกโค้ด — เข้าบัคเก็ต "รอของจากร้าน")
- กรอก `cashPrice` (+`installmentPrice`) ให้สินค้า ไม่งั้นโชว์ "สอบถามราคา"
- ลงสต็อกเครื่อง `PHONE_NEW` ให้ online-visible ไม่งั้นแท็บ "มือ 1" ว่าง (prod ปัจจุบันน่าจะมีแต่ PHONE_USED)

## Open verifications (ตอน implement)
- ค่า `brand` จริงใน DB เป็น `'Apple'` เป๊ะ? (เผื่อ `'iPhone'`/`'APPLE'` → ต้อง normalize หรือใช้ case-insensitive)
- `installmentPrice` หมายถึงยอดผ่อนรวม หรือ /เดือน? (กำหนดฐานคำนวณยอดผ่อน)

## Risks / rollout
- **เปลี่ยนราคาที่ลูกค้าเห็น** (จากต้นทุน→ราคาขาย) = outward-facing → ควรให้เจ้าของยืนยันว่ากรอก cashPrice ครบก่อน deploy จริง (ระหว่างนี้ fallback "สอบถามราคา" กัน ฿0)
- ไม่มี migration → deploy ปลอดภัย, rollback = revert โค้ด
