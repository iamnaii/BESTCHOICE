# Tooltify → BESTCHOICE: นำเข้าสต๊อก + ยอดขายย้อนหลัง

**วันที่:** 2026-08-18
**สถานะ:** Design (รออนุมัติจากเจ้าของก่อนทำ plan)
**เจ้าของงาน:** akenarin (OWNER)

---

## 1. เป้าหมาย (Goal)

เจ้าของใช้ **Tooltify** (SaaS ร้านมือถือ, ร้าน 3012 "สำนักงานใหญ่") คู่ขนานกับ BESTCHOICE และต้องการย้ายข้อมูลเข้ามา **2 อย่างที่จัดการคนละแบบ**:

- **Flow A — สต๊อกจริง:** เอาสินค้าที่ยังคงเหลือในคลังเข้ามาเป็น `Product` ปฏิบัติการ (`IN_STOCK`) เพื่อ**ขายจริงจาก BESTCHOICE ได้**
- **Flow B — ยอดขายสถิติ:** เอาประวัติการขายย้อนหลังเข้ามาเป็น**สถิติดูอย่างเดียว** (dashboard ยอด/กำไร/คนขาย/ช่องทาง) — **ไม่แตะระบบบัญชี/คอมมิชชั่น/Sale จริง**

## 2. ไม่ทำ (Non-goals)

- ❌ ไม่สร้าง `Contract` / `FinanceReceivable` / ตารางงวดผ่อน / journal entries จากข้อมูลย้อนหลัง
- ❌ ไม่โพสต์ JE บัญชีย้อนหลัง (ไฟล์ไม่มีข้อมูลพอ + จะทำงบเพี้ยน/ตกงวดปิด)
- ❌ ไม่สร้าง Customer/User รายคนจากข้อมูลขาย (ไฟล์มีแค่ label ช่องทาง + ชื่อคนขายเป็น text)
- ❌ ไม่แตะโค้ด `SalesService` / `ContractWorkflowService` (การสร้าง Sale จริงจะจุดชนวน JE + คอม — เราเลี่ยงทั้งหมด)

> **ที่มาของ non-goals:** scrutinize รอบ 2026-08-18 พบว่า `Sale` ปฏิบัติการมี `salespersonId`/`branchId`/`customerId` เป็น FK บังคับ, การสร้างผ่าน service เดินผ่าน `ShopCashSaleTemplate` (โพสต์ JE), และ `SaleType.INSTALLMENT`/`EXTERNAL_FINANCE` ที่ไม่มี contract = record ครึ่งใบ. Flow B จึงใช้ตารางแยกแทน.

---

## 3. แหล่งข้อมูล (ไฟล์ Excel ที่เจ้าของ export จาก Tooltify)

โฟลเดอร์: `~/Desktop/นำเข้าประวัติสต๊อคและยอดขายของ BESTCHOICE/`

| กลุ่ม | ไฟล์ | ชนิด | จำนวนแถว |
|---|---|---|---|
| `สต๊อค/` | `report_import_stock_*` × 3 (Q1/Q2/Q3 2026) | **flow นำเข้าคลัง** | 1,388 + 1,621 + 914 = 3,923 |
| `ขาย/` | `report_export_stock_*` × 3 (Q1/Q2/Q3 2026) | **flow ขายออก** | รายชิ้น 1,257 + 1,372 + 783 = 3,412 |

**โครงไฟล์นำเข้า** (header อยู่แถวที่ 8, 1 ชีต `Worksheet`, มี summary block ด้านบน):
`บาร์โค้ดสินค้า | ชื่อสินค้า | หมวดหมู่สินค้า | ต้นทุนสินค้า | ราคาปลีก | ราคา 2 | ราคา 3 | ราคา 4 | ราคาเบิกซ่อม | แหล่งที่มา | รายละเอียดสินค้า | วันที่นำเข้า | ผู้นำเข้า`

**โครงไฟล์ขาย** — summary รายประเภทการจ่าย + **ตารางรายชิ้นที่ section "รายการขาย"** (header key = `บาร์โค้ดสินค้า`, 14 คอลัมน์):
`บาร์โค้ดสินค้า | ชื่อสินค้า | หมวดหมู่สินค้า | ผู้ซื้อสินค้า | ร้านค้า | คำสั่งซื้อ | รูปแบบการขาย | กลุ่มราคาขาย | ต้นทุนรวม | ราคาตั้งขาย | ราคาขาย | กำไร | ผู้ขายสินค้า | วันที่ขายสินค้า`

**parser:** `openpyxl` (มี prototype ใน scratchpad session) → พอร์ตเป็น TypeScript ด้วย `exceljs` (มีใน repo แล้ว) หรือคง Python เป็น pre-step แปลงเป็น JSON. **ตัดสินใจ:** ใช้ `exceljs` ใน CLI (in-repo, ไม่มี dependency นอก).

---

## 4. ข้อเท็จจริงจากข้อมูลจริง (verified)

- **barcode = IMEI** สำหรับมือถือ (15 หลัก, unique 838 ตัว, ซ้ำแค่ 23) · = **SKU code** สำหรับ accessory (42 SKU ซ้ำเป็นพัน เช่น `CCCT01` × 517)
- **กลุ่มราคา → ช่องทางขาย** (เจ้าของยืนยัน): `ราคาปลีก`=ลูกค้าทั่วไป/เงินสด · `ราคา 2`=**BESTCHOICE ไฟแนนซ์** (ดาวน์+ยอดจัด+คอม) · `ราคา 3`=**GFIN** (ไฟแนนซ์นอก)
- **บิลหลายรายการ exploded อยู่แล้ว** ในตารางรายชิ้น (แชร์ `คำสั่งซื้อ`) — ของแถมขายที่ `ราคาขาย=0`
- **match rate:** IMEI ที่ขาย 822 ตัว เจอในไฟล์นำเข้า 796 (96.8%)
- `รายละเอียดสินค้า` ของมือถือ = `% แบตเตอรี่ : NN%` + เทอมดาวน์/ผ่อน (multiline)

---

## 5. Mapping (→ enum จริงของ BESTCHOICE)

| Tooltify | BESTCHOICE | หมายเหตุ |
|---|---|---|
| `บาร์โค้ด` (15 หลัก) | `Product.imeiSerial` | เฉพาะมือถือ/แท็บ |
| `บาร์โค้ด` (SKU accessory) | เก็บใน `Product.accessoryType` (imeiSerial=null) | กัน unique index ชน |
| `iPhone มือ 1` | `ProductCategory.PHONE_NEW` | |
| `iPhone มือ 2` | `ProductCategory.PHONE_USED` | |
| `iPad มือ 1` | `ProductCategory.TABLET` | |
| `Accessories` / หมวดว่าง | `ProductCategory.ACCESSORY` | 110 แถว Q1 หมวดว่าง → ACCESSORY |
| `ต้นทุนสินค้า` | `Product.costPrice` | |
| `ราคาปลีก` | `Product.cashPrice` | |
| `ราคา 2` | `Product.installmentPrice` | = BESTCHOICE finance |
| `% แบตเตอรี่` (จากรายละเอียด) | `Product.batteryHealth` | regex parse |
| **กลุ่มราคา** ราคาปลีก / ราคา 2 / ราคา 3 | `saleChannel` = CASH / INSTALLMENT / EXTERNAL_FINANCE (**Flow B, text**) | ไม่ใช่ FK |
| `รูปแบบการขาย` เงินสด/โอน/QR | payment = CASH / BANK_TRANSFER / QR_EWALLET (**Flow B, text**) | |

### 5.1 brand / model (⚠️ field บังคับ non-null — ต้องนิยาม ไม่มีในไฟล์ตรงๆ)

`Product.brand` และ `Product.model` เป็น `String` **บังคับ** (schema.prisma:1649-1650, ไม่มี default) แต่ Tooltify มีแค่ `ชื่อสินค้า` เดียว → ต้อง derive แยก 2 เคส + **fallback ห้าม null**:

**มือถือ/แท็บ** (`ชื่อสินค้า` เช่น `iPhone 16 128GB White (สีขาว)`):
- parse ตาม convention เดิมของ repo (ดู `products.service.spec.ts:117` → `model:'iPhone 13'`, `storage:'128GB'`):
  - `brand` = ยี่ห้อ (`Apple` สำหรับ iPhone/iPad; ยี่ห้ออื่น = คำแรก)
  - `model` = รุ่นรวมยี่ห้อ (`iPhone 16`) · `storage` = `128GB` (regex `\d+(GB|TB)`) · `color` = ในวงเล็บ/คำท้าย
- **fallback:** parse ไม่ได้ → `brand='Unknown'`, `model=ชื่อสินค้าเต็ม` (ไม่ null), log ไว้ตรวจ

**Accessory** (`ชื่อสินค้า` เช่น `ชุดชาร์จ Type C to Type C - iStar`):
- ไม่มี brand/model แบบมือถือ → `brand` = vendor (ข้อความหลัง `" - "` เช่น `iStar`; ไม่มี → `'-'`), `model` = ชื่อสินค้าเต็ม
- เก็บของจริงใน `accessoryType` = SKU/บาร์โค้ด, `accessoryBrand` = vendor

**parser ต้อง validate เอง** (ราคา ≥ 0, IMEI 14-15 หลักสำหรับมือถือ, หมวดอยู่ใน enum) ก่อน insert — เพราะ CLI เขียน Prisma ตรง ข้าม DTO validation ของ `ProductsService` (ดู §8).

---

## 6. Flow A — สต๊อกจริง (operational `Product`, IN_STOCK)

### 6.1 ✅ แหล่งข้อมูลสต๊อกคงเหลือ (LOCKED: A1)

ไฟล์ import/sales ที่มีเป็น **flow** ไม่ใช่ snapshot คงเหลือ → คำนวณ imported−sold จะ overestimate. **เจ้าของยืนยันจะ export ไฟล์ "สต๊อกคงเหลือ" เพิ่ม (A1)** → Flow A ใช้ไฟล์นี้เป็น **source of truth ของ "มีอะไรในคลังตอนนี้"**, ใช้ไฟล์นำเข้าเดิมแค่ enrich (ต้นทุน/แหล่งที่มา/แบต% ถ้าไฟล์คงเหลือไม่มี).

> **⏳ ต้องได้ไฟล์คงเหลือก่อนเขียน plan Flow A ให้ครบ** — โครงคอลัมน์ของไฟล์นี้ (ต่างจาก import file) ต้องอ่านจริงก่อน (กันออกแบบ parser จากคอลัมน์ที่เดา ตามบทเรียน spike รอบแรก). Flow B (ยอดขายสถิติ) ไม่ต้องรอไฟล์นี้ — เขียน plan ได้เลย.

### 6.2 กติกาสร้าง Product (จากไฟล์คงเหลือ A1)

- **มือถือ/แท็บ (IMEI):** 1 แถว/เครื่อง. `imeiSerial=IMEI`, `status=IN_STOCK`, `category` ตาม map, `costPrice/cashPrice/installmentPrice/batteryHealth` จากไฟล์. `brand`/`model` derive ตาม **§5.1**. `legacy_product_code = TTFY-<IMEI>` (@unique → idempotent + reversible).
- **branchId (LOCKED: สำนักงานใหญ่):** CLI **resolve `Branch WHERE isMainWarehouse=true AND deletedAt=null` ตอนรัน** (ไม่ hardcode id — dev/prod ต่างกัน; seed dev = "คลังสินค้าหลัก branch-001"). guard: ถ้าเจอ 0 หรือ >1 → error หยุด ให้เจ้าของระบุ.
- **Accessory (SKU, นับจำนวน):** `Product` ไม่มี field quantity → สร้าง **1 แถว/ชิ้นคงเหลือ**. คงเหลือต่อ SKU จากไฟล์คงเหลือ (A1) หรือ imported−sold clamp≥0 (A2). `imeiSerial=null`, `accessoryType=<SKU>`, `category=ACCESSORY`, cost/ราคา จาก import ล่าสุด. `legacy_product_code = TTFY-<SKU>-<seq>` (unique ต่อชิ้น).
- **ownedByCompanyId** = SHOP (default — ยังไม่ผ่านไฟแนนซ์).

### 6.3 Idempotency + Reversibility (⚠️ `legacy_product_code` = `@unique` ธรรมดา ไม่ partial)

`legacyProductCode` เป็น `@unique` เต็ม (schema.prisma:1700) — **row ที่ soft-delete ยังจอง code เดิม**. ดังนั้น:
- **Idempotency:** upsert by `legacy_product_code`. ถ้าเจอ row **soft-deleted** (deletedAt≠null) ที่ code ตรง → **restore** (deletedAt=null) + update ค่าล่าสุด (ไม่ใช่ skip — ป้องกัน re-import หลัง reverse แล้วเงียบ). ถ้าเจอ row active → skip/update.
- **Reverse:** ใช้ **hard-delete** ทุก Product ที่ `legacy_product_code LIKE 'TTFY-%'` (ไม่ใช่ soft-delete — เพื่อ**ปล่อย unique code** ให้ re-import ได้จริง). guard: ห้ามลบถ้ามี Sale/Contract/StockTransfer อ้างถึง (FK) — report แล้วหยุด ไม่ลบทับของที่ถูกใช้ไปแล้ว.

---

## 7. Flow B — ยอดขายสถิติ (ตารางใหม่ read-only)

> **ชื่อ source-neutral โดยตั้งใจ** (`ImportedSale` ไม่ใช่ `TooltifyHistoricalSale`) — ตาราง/route จะอยู่ยาวกว่าตัว import ครั้งนี้; `source` เป็น field ทำให้อนาคต import จากที่อื่นใช้ตารางเดียวกันได้.

### 7.1 Prisma model ใหม่

```prisma
/// ยอดขายย้อนหลังที่นำเข้าจากระบบภายนอก (import ครั้งนี้ = Tooltify) — สถิติดูอย่างเดียว
/// Immutable import snapshot — updatedAt/deletedAt intentionally omitted (reverse = DELETE by importBatch)
model ImportedSale {
  id             String    @id @default(uuid())
  source         String    @default("TOOLTIFY")        // ระบบต้นทาง (future-proof)
  barcode        String    @map("barcode")            // IMEI หรือ SKU
  productName    String    @map("product_name")
  category       String                               // เก็บ text ตามไฟล์ (iPhone มือ 2 ฯลฯ)
  buyerLabel     String    @map("buyer_label")         // ลูกค้าทั่วไป / BESTCHOICE / GFIN
  shopLabel      String?   @map("shop_label")          // ร้านค้า (- / บริษัท จีฟินน์ฯ)
  orderNumber    String    @map("order_number")        // คำสั่งซื้อ (group รายการในบิลเดียว)
  paymentType    String    @map("payment_type")        // เงินสด / โอน / QR
  priceGroup     String    @map("price_group")         // ราคาปลีก / ราคา 2 / ราคา 3
  saleChannel    String    @map("sale_channel")        // CASH / INSTALLMENT / EXTERNAL_FINANCE (derived)
  costTotal      Decimal   @map("cost_total")   @db.Decimal(12, 2)
  listPrice      Decimal   @map("list_price")   @db.Decimal(12, 2)
  salePrice      Decimal   @map("sale_price")   @db.Decimal(12, 2)
  profit         Decimal                        @db.Decimal(12, 2)
  salespersonName String   @map("salesperson_name")    // text — ไม่ใช่ FK
  soldAt         DateTime  @map("sold_at")
  importBatch    String    @map("import_batch")        // ชื่อไฟล์ต้นทาง (reversible per batch)
  importedAt     DateTime  @default(now()) @map("imported_at")

  @@unique([source, barcode, orderNumber, soldAt])     // idempotency: re-run ไม่ซ้ำ
  @@index([soldAt])
  @@index([saleChannel])
  @@index([salespersonName])
  @@index([category])
  @@index([orderNumber])
  @@map("imported_sales")
}
```

> ยกเว้น `updatedAt/deletedAt` โดยตั้งใจ (immutable snapshot) — มี `///` comment ตาม rule ใน `database.md`. Reverse = `DELETE WHERE import_batch IN (...)` (guard confirm). Idempotency ผ่าน `@@unique` → re-run ไฟล์เดิมไม่เพิ่มซ้ำ.

### 7.2 API + Dashboard
- โมดูลใหม่ `imported-sales` (read-only): `GET /imported-sales` (filter: ช่วงวัน/ช่องทาง/คนขาย/หมวด, paginate) + `GET /imported-sales/summary` (ยอด/กำไร group by เดือน/ช่องทาง/คนขาย/หมวด).
- หน้าใหม่ `ImportedSalesPage` — โมเดลตาม `SalesHistoryPage.tsx` (ใช้ `useQuery` + filter). เมนู OWNER/ACCOUNTANT.
- Guard: `@Roles('OWNER','ACCOUNTANT','FINANCE_MANAGER')` + JwtAuthGuard + RolesGuard (ตาม security.md).
- **หมายเหตุ profit:** ของแถม ฿0 มี `profit` ติดลบ (=−ต้นทุน) → summary รวมทั้งบิลได้กำไรสุทธิตรงกับ Tooltify (ของแถมกินกำไร) — ถูกต้อง ไม่ต้อง filter ออก.

---

## 8. CLI — `import:tooltify` (ตาม pattern CLI ของ repo)

- ที่ `apps/api/src/cli/import-tooltify.cli.ts` + script `"import:tooltify"` ใน `apps/api/package.json` (+ `:help`).
- Bootstrap: `new PrismaClient()` ตรง (แบบ `ecl-dry-run.cli.ts`) — **ไม่ผ่าน SalesService** → ไม่มี JE/คอม.
- **Guards (ตาม wipe/backfill CLI):** `DRY_RUN=1` default · เขียนจริงต้อง `CONFIRM_IMPORT=YES_I_AM_SURE` + `EXPECTED_DB_NAME=<db>` · prod ต้อง `ALLOW_PROD_IMPORT=YES_I_AM_SURE` เพิ่ม.
- **Phase:** (1) parse + **validate** ไฟล์ทั้งหมด (ราคา≥0, IMEI 14-15 หลัก, หมวดใน enum, brand/model derive ตาม §5.1 — ห้าม null) → (2) Flow A: upsert Product IN_STOCK (idempotent + restore-soft-deleted ตาม §6.3) → (3) Flow B: insert `ImportedSale` (idempotent by `@@unique` source+barcode+orderNumber+soldAt).
- **Validate-in-parser** (เพราะเขียน Prisma ตรง ข้าม DTO ของ `ProductsService`): แถวที่ไม่ผ่าน → skip + log ลง report ไม่ทำให้ทั้ง run ล้ม.
- **Dry-run output:** นับ Product ที่จะสร้าง (แยกมือถือ/แท็บ/accessory), TooltifyHistoricalSale กี่แถว, กี่ IMEI match/ไม่ match, สรุปยอด/กำไรต่อช่องทาง (reconcile กับ summary block ในไฟล์), รายการ conflict (IMEI ซ้ำ, code ซ้ำ).

---

## 9. Edge cases

| กรณี | จัดการ |
|---|---|
| IMEI มือถือซ้ำ 23 ตัว (partial-unique `WHERE deleted_at IS NULL`) | dedup ก่อน insert — เลือก record วันที่ล่าสุด; Flow A สร้างครั้งเดียว/IMEI |
| 26 IMEI ขายแต่ไม่มีในไฟล์นำเข้า | Flow B บันทึกได้ปกติ (สถิติไม่ต้อง match Product); Flow A ไม่เกี่ยว (ขายไปแล้ว) |
| หมวดว่าง 110 แถว | → `ACCESSORY` |
| accessory คงเหลือติดลบ (ขาย > นำเข้าในช่วง) | clamp ≥ 0 (มี opening stock ก่อน Q1) |
| **accessory row บานถ้าใช้ A2** (reconstruct) — SKU ซ้ำพัน เช่น CCCT01 นำเข้า 517 | **cap ต่อ SKU + log** ถ้า qty > threshold; ยิ่งตอกย้ำต้องใช้ A1 (ไฟล์คงเหลือ ~593) ไม่ใช่ reconstruct |
| SKU ต้นทุนต่างกันข้ามไตรมาส | ใช้ต้นทุน import ล่าสุด (approx — ไม่รู้ชิ้นไหนเหลือ) |
| ชื่อ `iPhone 16 128GB White (สีขาว)` / accessory | parser แยก brand/model/storage/color ตาม §5.1 (2 เคส + fallback ห้าม null) |

---

## 10. Testing
- Unit: parser (แถว header จริง, multiline รายละเอียด, battery regex, ชื่อ→brand/model), mapping (หมวด→enum, กลุ่มราคา→channel), accessory qty reconcile.
- Integration (dev DB): รัน CLI dry-run บน fixture ย่อ → assert นับ Product/TooltifyHistoricalSale + reconcile ยอดกับ summary block.
- ตาม `run-tests.sh` + `check-types.sh all`.

## 11. Runbook ความปลอดภัย prod (prod = ของจริง ไม่ล้างแล้ว)
1. รัน dry-run บน **dev DB** ก่อน → ตรวจนับ.
2. รัน dry-run บน **prod-copy** (cloud-sql-proxy) → reconcile ยอดกับ Tooltify (622 คงเหลือ, ยอดขายต่อช่องทาง).
3. เจ้าของตรวจตัวเลข → รันจริง prod ด้วย env guard ครบ.
4. Verify: นับ Product `TTFY-%`, TooltifyHistoricalSale, ยอดรวม dashboard = summary ไฟล์.
5. Bump version ใน `apps/web/package.json` หลัง deploy หน้า/โมดูลใหม่ (VersionBadge = วิธีเจ้าของเช็คว่าได้โค้ดใหม่จริง).

## 12. Decisions locked / open
- ✅ 2 flow แยก (สต๊อกจริง + สถิติ) · ✅ accessory เข้าสต๊อกจริงด้วย (1 แถว/ชิ้นคงเหลือ) · ✅ ลง prod (มี dry-run gate) · ✅ ของแถม ฿0 → Flow B บันทึก flat (ไม่ bundle, ไม่ขึ้น Sale จริง)
- ✅ (scrutinize รอบ 2) brand/model mapping 2 เคส + fallback (§5.1) · reverse = **hard-delete** ปล่อย unique code (§6.3) · ตารางชื่อ neutral `ImportedSale` + field `source` (§7) · validate-in-parser (§8)
- ✅ **§6.1 LOCKED:** Flow A ใช้ไฟล์ **สต๊อกคงเหลือ (A1)** — เจ้าของ export เพิ่ม (⏳ รอไฟล์ก่อนเขียน plan Flow A)
- ✅ **branch LOCKED:** สำนักงานใหญ่ — resolve `isMainWarehouse=true` ตอนรัน (ไม่ hardcode)
- ⏳ **รอ input:** ไฟล์รายงานสต๊อกคงเหลือจาก Tooltify (โครงคอลัมน์ต้องอ่านจริงก่อนออกแบบ parser Flow A)
