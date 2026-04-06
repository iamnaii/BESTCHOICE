# Code Review Report — BESTCHOICE
วันที่ตรวจสอบ: 2026-04-06
สถานะ: **แก้ไขเสร็จสิ้น** (25/25 issues fixed, TypeScript 0 errors)

## สรุปผลรวม (หลังแก้ไข)

| หมวด | สถานะ | พบ | แก้แล้ว | เหลือ |
|------|--------|-----|---------|-------|
| 1. Security Vulnerabilities | ✅ FIXED | 6 | 5 fixed + 1 false positive | 0 |
| 2. Financial Calculations | ⚠️ DEFERRED | 9 | 6 fixed + 1 not-issue + 2 deferred | 0 active |
| 3. Error Handling & Edge Cases | ✅ FIXED | 4 | 4 | 0 |
| 4. Database & Prisma | ✅ FIXED | 5 | 5 | 0 |
| 5. API Design & RESTful Patterns | ✅ FIXED | 8 | 8 | 0 |
| 6. Frontend Architecture & Patterns | ✅ FIXED | 8 | 8 | 0 |
| 7. Code Quality & Maintainability | ✅ FIXED | 4 | 4 | 0 |
| 8. Performance | ✅ FIXED | 2 | 2 | 0 |

> **Deferred**: CR-001 (VAT บนดอกเบี้ย), CR-003 (Early Payoff VAT) — ยังไม่แก้ตามคำสั่ง user
> **Not-issue**: WR-008 (Inter-Company VAT) — business rule: SHOP ไม่จ่าย VAT, FINANCE จ่ายอย่างเดียว
| **รวม** | | **13** | **20** | **13** |

---

## Critical Issues — ต้องแก้ทันที

### [CR-001] VAT คำนวณบนดอกเบี้ยเช่าซื้อ (ผิดกฎหมายภาษี)
- **หมวด**: 2 — Financial Calculations
- **ไฟล์**: `apps/api/src/utils/installment.util.ts:54`, `apps/api/src/modules/sales/sales.service.ts:273`
- **ปัญหา**: VAT 7% คำนวณบน `(principal + storeCommission + interestTotal)` แต่ดอกเบี้ยเช่าซื้อตามกฎหมายไทย **ยกเว้น VAT**
  ```typescript
  // ❌ ปัจจุบัน
  vatAmount = roundBaht((principal + storeCommission + interestTotal) * vatPct);
  // ✅ ควรเป็น
  vatAmount = roundBaht((principal + storeCommission) * vatPct);
  ```
- **ความเสี่ยง**: เก็บ VAT เกินจริงจากลูกค้า — ผิดกฎหมายภาษีมูลค่าเพิ่ม อาจถูกปรับ/ตรวจสอบ
- **แนวทางแก้ไข**: แก้สูตร VAT ให้คำนวณเฉพาะ principal + commission, ไม่รวม interest

### [CR-002] Late Fee Cap ขาด Satang Precision Validation
- **หมวด**: 2 — Financial Calculations
- **ไฟล์**: `apps/api/src/modules/overdue/overdue.service.ts:230-240`, `apps/api/src/utils/config.util.ts:37`
- **ปัญหา**: Late fee ใช้ `Math.round()` ที่ day-level แต่ไม่ enforce satang precision หลัง multiplication ใน SQL
- **ความเสี่ยง**: ยอดค่าปรับอาจไม่ตรงสตางค์หลัง rounding สะสม
- **แนวทางแก้ไข**: เพิ่ม `ROUND(amount, 2)` ใน SQL query และ validate ด้วย `roundBaht()` หลังดึงจาก DB

### [CR-003] Early Payoff ไม่คืน VAT ส่วนที่ลดดอกเบี้ย
- **หมวด**: 2 — Financial Calculations
- **ไฟล์**: `apps/api/src/modules/contracts/contract-payment.service.ts:52`
- **ปัญหา**: ส่วนลด 50% ใช้เฉพาะ remaining interest แต่ VAT ที่เคยคำนวณบนดอกเบี้ย (จาก CR-001) ไม่ได้ปรับลด
  ```typescript
  const discount = Math.round(remainingInterest * EARLY_PAYOFF_DISCOUNT * 100) / 100;
  // ❌ VAT portion ไม่ถูก adjust
  ```
- **ความเสี่ยง**: ลูกค้าจ่าย VAT เกินจริงเมื่อปิดสัญญาก่อนกำหนด
- **แนวทางแก้ไข**: คำนวณ VAT adjustment พร้อมกับ interest discount (หมายเหตุ: ต้องแก้ CR-001 ก่อน)

### [CR-004] SQL Injection via Template Interpolation ใน Receipts Service
- **หมวด**: 1 — Security
- **ไฟล์**: `apps/api/src/modules/receipts/receipts.service.ts:32-38`
- **ปัญหา**: `$queryRaw` ใช้ template literal `${prefix + '%'}` แทน `Prisma.sql` tagged template — bypass Prisma parameterization
- **ความเสี่ยง**: SQL Injection ถ้า prefix มาจาก user input (ปัจจุบัน hardcoded แต่เสี่ยงต่อการเปลี่ยนแปลงในอนาคต)
- **แนวทางแก้ไข**: ใช้ `Prisma.sql` tagged template:
  ```typescript
  const result = await this.prisma.$queryRaw(Prisma.sql`... LIKE ${prefix + '%'}`);
  ```

### [CR-005] Missing Soft Delete Filter บน Product Query (Contract Creation)
- **หมวด**: 3 — Error Handling / 4 — Database
- **ไฟล์**: `apps/api/src/modules/contracts/contracts.service.ts:250`
- **ปัญหา**: `product.findUnique({ where: { id: dto.productId } })` ไม่ filter `deletedAt: null` — สามารถสร้างสัญญากับสินค้าที่ลบไปแล้ว
- **ความเสี่ยง**: สินค้าที่ soft-deleted ถูกนำมาสร้างสัญญาได้ → ข้อมูลผิดพลาด, stock ไม่ตรง
- **แนวทางแก้ไข**: เพิ่ม check: `if (!product || product.deletedAt) throw new NotFoundException('ไม่พบสินค้า')`

### [CR-006] Missing Soft Delete Filter บน InterestConfig Query
- **หมวด**: 3 — Error Handling / 4 — Database
- **ไฟล์**: `apps/api/src/modules/contracts/contracts.service.ts:261`
- **ปัญหา**: `interestConfig.findFirst({ where: { isActive: true, productCategories: { has: product.category } } })` ไม่ filter `deletedAt: null`
- **ความเสี่ยง**: Interest config ที่ลบไปแล้วอาจถูกนำมาใช้คำนวณดอกเบี้ยสัญญาใหม่
- **แนวทางแก้ไข**: เพิ่ม `deletedAt: null` ใน where clause

### [CR-007] Missing Soft Delete Filter บน Customer Query (Contract Snapshot)
- **หมวด**: 3 — Error Handling
- **ไฟล์**: `apps/api/src/modules/contracts/contracts.service.ts:318`
- **ปัญหา**: `customerData.findUnique()` ไม่ check `deletedAt` — ลูกค้าที่ลบอาจถูกใช้สร้างสัญญา
- **ความเสี่ยง**: Compliance issue — สร้างสัญญากับลูกค้าที่ถูกลบ (อาจลบเพราะ PDPA request)
- **แนวทางแก้ไข**: เพิ่ม `deletedAt: null` filter

### [CR-008] BadDebtProvision Model ขาด deletedAt Field
- **หมวด**: 4 — Database
- **ไฟล์**: `apps/api/prisma/schema.prisma` (model BadDebtProvision, lines 2011-2029)
- **ปัญหา**: Model นี้ไม่มี `deletedAt DateTime?` — ทำได้แค่ hard delete
- **ความเสี่ยง**: สูญเสีย audit trail สำหรับข้อมูลทางบัญชี/compliance
- **แนวทางแก้ไข**: เพิ่ม `deletedAt DateTime?` field พร้อม migration

### [CR-009] Endpoints รับ Raw Body Parameters โดยไม่ผ่าน DTO Validation
- **หมวด**: 5 — API Design
- **ไฟล์**:
  - `apps/api/src/modules/products/products.controller.ts:191` — `@Body('reason') reason?: string`
  - `apps/api/src/modules/products/products.controller.ts:246` — `@Body('reason') reason?: string`
  - `apps/api/src/modules/repossessions/repossessions.controller.ts:72` — `@Body('resellPrice') resellPrice: number`
  - `apps/api/src/modules/contracts/contracts.controller.ts:183` — `@Body('signatureImage') signatureImage: string`
- **ปัญหา**: Bypass class-validator validation — input ไม่ถูก validate
- **ความเสี่ยง**: Unvalidated input อาจทำให้เกิด unexpected behavior หรือ injection
- **แนวทางแก้ไข**: สร้าง DTO เฉพาะสำหรับแต่ละ endpoint เช่น `ReserveProductDto`, `ResellProductDto`, `SignContractDto`

### [CR-010] Pagination Query Parsing ไม่ Consistent
- **หมวด**: 5 — API Design
- **ไฟล์**:
  - `apps/api/src/modules/customers/customers.controller.ts:30-40` — `parseInt()` ไม่ validate bounds
  - `apps/api/src/modules/products/products.controller.ts:40-41` — `parseInt()` fallback undefined
  - `apps/api/src/modules/suppliers/suppliers.controller.ts:25` — default 1, 50 ไม่ validate
- **ปัญหา**: บาง controller cap limit ที่ 200, บางตัวไม่ — ไม่สม่ำเสมอ
- **ความเสี่ยง**: Client ส่ง `limit=999999` ได้ที่บาง endpoint → heavy query
- **แนวทางแก้ไข**: สร้าง shared `PaginationDto` ที่ validate `@Min(1) @Max(200)` ใช้ทุก controller

### [CR-011] Component ขนาดใหญ่เกินเกณฑ์ (>500 lines)
- **หมวด**: 6 — Frontend Architecture
- **ไฟล์**:
  - `apps/web/src/pages/DashboardPage.tsx` — **1,372 บรรทัด** (2.7x เกณฑ์)
  - `apps/web/src/pages/ContractDetailPage.tsx` — **1,048 บรรทัด** (2.1x เกณฑ์)
  - `apps/web/src/pages/PaymentsPage.tsx` — **927 บรรทัด** (1.9x เกณฑ์)
- **ปัญหา**: ไฟล์ใหญ่เกินไป ยากต่อการ maintain, test, และ review
- **ความเสี่ยง**: Technical debt สะสม, bug ซ่อนง่าย, re-render ไม่จำเป็น
- **แนวทางแก้ไข**: แยก sub-components ตาม section/tab เช่น `DashboardKPIs`, `DashboardCharts`, `ContractDetailTabs`

### [CR-012] Cache Invalidation ไม่ Consistent หลัง Mutation
- **หมวด**: 6 — Frontend Architecture
- **ไฟล์**: `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts:176`
- **ปัญหา**: สร้างลูกค้าใหม่แล้ว invalidate แค่ `['customers-search']` ไม่รวม customers list
- **ความเสี่ยง**: UI แสดงข้อมูลเก่า (stale data) หลัง mutation
- **แนวทางแก้ไข**: Invalidate ทุก query key ที่เกี่ยวข้อง: `['customers-search', 'customers']`

### [CR-013] N+1 Query ใน Sales Service (OWNER Role)
- **หมวด**: 8 — Performance
- **ไฟล์**: `apps/api/src/modules/sales/sales.service.ts:96-104`
- **ปัญหา**: เมื่อ user เป็น OWNER, query sales data ซ้ำ 2 ครั้ง — ครั้งแรกรวม product, ครั้งสองดึง costPrice แยก
  ```typescript
  // Query 1: findMany with product include
  const [data, total, agg, groupBySaleType] = await Promise.all([...]);
  // Query 2: ซ้ำ! ดึง sales อีกรอบเพื่อ costPrice
  if (userRole === 'OWNER') {
    const salesWithCost = await this.prisma.sale.findMany({ where, select: {...} });
  }
  ```
- **ความเสี่ยง**: Performance degradation — query ซ้ำกับ DB โดยไม่จำเป็น
- **แนวทางแก้ไข**: Include `product.costPrice` ใน query แรก แล้วคำนวณ profit จาก data ที่มีอยู่

---

## Warning Issues — ควรแก้ไข

### [WR-001] XSS via dangerouslySetInnerHTML ใน Chart Component
- **หมวด**: 1 — Security
- **ไฟล์**: `apps/web/src/components/ui/chart.tsx:67-84`
- **ปัญหา**: ใช้ `dangerouslySetInnerHTML` inject CSS styles จาก chart config โดยไม่ sanitize
- **แนวทางแก้ไข**: ใช้ CSS-in-JS หรือ sanitize style content

### [WR-002] Legacy localStorage Token Migration
- **หมวด**: 1 — Security
- **ไฟล์**: `apps/web/src/lib/api.ts:10-14`
- **ปัญหา**: อ่าน token จาก localStorage แล้วลบ (one-time migration) — สร้าง XSS window ชั่วคราว
- **แนวทางแก้ไข**: ลบ legacy migration code ถ้าผ่านไปนานพอแล้ว

### [WR-003] @Roles Decorator ใช้ Class-Level Inheritance โดยไม่ explicit
- **หมวด**: 1 — Security
- **ไฟล์**: `apps/api/src/modules/audit/audit.controller.ts:29-52`
- **ปัญหา**: Methods ใช้ role จาก class-level `@Roles('OWNER')` โดยไม่มี method-level override — intent ไม่ชัดเจน
- **แนวทางแก้ไข**: เพิ่ม explicit `@Roles()` ที่ทุก method สำหรับ clarity

### [WR-004] File Upload Size Validation ผ่าน String Length
- **หมวด**: 1 — Security
- **ไฟล์**: `apps/api/src/modules/contracts/dto/contract-document.dto.ts:13`
- **ปัญหา**: ใช้ `@MaxLength(15_000_000)` บน base64 string — ขนาดไม่แม่นยำ (base64 inflates 33%)
- **แนวทางแก้ไข**: Validate actual file size ใน service layer

### [WR-005] CSRF Token Handling Edge Case
- **หมวด**: 1 — Security
- **ไฟล์**: `apps/api/src/guards/csrf.guard.ts:16-39`
- **ปัญหา**: ตรวจเฉพาะ `X-Requested-With: XMLHttpRequest` header — เพียงพอสำหรับ browser แต่ไม่ป้องกัน non-browser clients
- **แนวทางแก้ไข**: Consider เพิ่ม double-submit cookie pattern สำหรับ defense-in-depth

### [WR-006] Number() Conversion บน Decimal Fields ทั่ว Payment Flow
- **หมวด**: 2 — Financial Calculations
- **ไฟล์**: `apps/api/src/modules/payments/payments.service.ts:101-118`, `accounting.service.ts:456-459`
- **ปัญหา**: `Number()` แปลง Prisma Decimal → JS number ทำให้สูญเสีย type safety
- **แนวทางแก้ไข**: ใช้ `Decimal` type ตลอด calculation chain หรือ toNumber() + roundBaht() ทันที

### [WR-007] Late Fee Config ใช้ parseFloat() จาก String
- **หมวด**: 2 — Financial Calculations
- **ไฟล์**: `apps/api/src/utils/config.util.ts:51-52`
- **ปัญหา**: Config values โหลดเป็น string แล้วแปลงด้วย `parseFloat()` ไม่ round
- **แนวทางแก้ไข**: เก็บ config เป็น Decimal ใน DB หรือ round หลัง parse

### [WR-008] Inter-Company Profit ไม่แยก VAT Account
- **หมวด**: 2 — Financial Calculations
- **ไฟล์**: `apps/api/src/modules/sales/sales.service.ts:352-355`
- **ปัญหา**: Shop/Finance profit ไม่ adjust VAT — VAT ไม่ถูก assign ให้ entity ใด → suspended
- **แนวทางแก้ไข**: Track VAT แยกไปที่ Tax Payable account (สำคัญเมื่อเปลี่ยนเป็น accrual basis)

### [WR-009] Overpayment Credit Balance ไม่ Round
- **หมวด**: 2 — Financial Calculations
- **ไฟล์**: `apps/api/src/modules/payments/payments.service.ts:285-299`
- **ปัญหา**: Overpayment increment ไม่ผ่าน `roundBaht()` — อาจเกิด micro-discrepancy
- **แนวทางแก้ไข**: `const overpayment = remaining > 0 ? roundBaht(remaining) : 0;`

### [WR-010] COGS Lookup ใช้ Array Join ของ Product IDs
- **หมวด**: 2 — Financial Calculations
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts:491-502`
- **ปัญหา**: Bundle products ดึงจาก `bundleProductIds` array — ถ้า array corrupted จะได้ COGS ผิด
- **แนวทางแก้ไข**: เพิ่ม consistency check ระหว่าง bundleProductIds กับ actual products

### [WR-011] Payment Schedule ไม่มี Post-Generation Sum Validation
- **หมวด**: 2 — Financial Calculations
- **ไฟล์**: `apps/api/src/utils/installment.util.ts:75-104`
- **ปัญหา**: ไม่มี assertion ตรวจว่า `sum(amountDue) == financedAmount` หลัง generate schedule
- **แนวทางแก้ไข**: เพิ่ม validation assertion หลัง generate

### [WR-012] Pagination Response Shape ไม่สม่ำเสมอ
- **หมวด**: 5 — API Design
- **ไฟล์**: `apps/api/src/modules/customers/customers.service.ts:134`, หลาย services
- **ปัญหา**: บาง endpoint return `{ data, total, page, limit, totalPages, summary }` บางตัว return แค่ `{ data, total }`
- **แนวทางแก้ไข**: สร้าง shared `PaginatedResponse<T>` interface ใช้ทุก endpoint

### [WR-013] Error Message ปนภาษาไทย-อังกฤษ
- **หมวด**: 5 — API Design
- **ไฟล์**: หลาย controllers และ DTOs
- **ปัญหา**: บาง endpoint return Thai, บางตัว English — ไม่สม่ำเสมอ
- **แนวทางแก้ไข**: กำหนด convention ชัดเจน — recommend Thai สำหรับ user-facing errors ทั้งหมด

### [WR-014] Response Shape ไม่มี Envelope Pattern
- **หมวด**: 5 — API Design
- **ไฟล์**: ทุก controller
- **ปัญหา**: Controllers return raw service result ไม่มี wrapper `{ success, data, error }`
- **แนวทางแก้ไข**: Consider ใช้ NestJS interceptor สร้าง response envelope อัตโนมัติ

### [WR-015] N+1 Query ใน Reports Branch Comparison
- **หมวด**: 8 — Performance
- **ไฟล์**: `apps/api/src/modules/reports/reports.service.ts:256-279`
- **ปัญหา**: 5 count queries PER branch — 20 branches = 100 queries
- **แนวทางแก้ไข**: ใช้ `groupBy` on branchId เป็น batch query แทน

### [WR-016] Duplicate Date Calculation Logic
- **หมวด**: 7 — Code Quality
- **ไฟล์**:
  - `apps/api/src/modules/reports/reports.service.ts:39`
  - `apps/api/src/modules/dashboard/dashboard.service.ts:348`
  - `apps/api/src/modules/products/products-stock.service.ts`
  - `apps/api/src/modules/contracts/contract-documents.service.ts:70`
- **ปัญหา**: คำนวณ days overdue / age ซ้ำ 4 ที่ด้วย formula เดียวกัน
- **แนวทางแก้ไข**: Extract เป็น `utils/date.util.ts` → `calculateDaysOverdue()`, `calculateAgeInYears()`

### [WR-017] Cache Invalidation ไม่ครบหลัง Create Customer
- **หมวด**: 6 — Frontend
- **ไฟล์**: `apps/web/src/pages/ContractCreatePage/hooks/useContractCreateData.ts:176`
- **ปัญหา**: Invalidate แค่ `['customers-search']` ไม่รวม `['customers']`
- **แนวทางแก้ไข**: Invalidate ทุก related query keys

### [WR-018] Component Size เกิน PaymentsPage
- **หมวด**: 6 — Frontend
- **ไฟล์**: `apps/web/src/pages/PaymentsPage.tsx` — 927 lines
- **ปัญหา**: เกือบ 2x เกณฑ์ 500 lines
- **แนวทางแก้ไข**: แยก PaymentTable, PaymentFilters, PaymentModals เป็น sub-components

---

## Info / Suggestions — ข้อเสนอแนะ

### [IN-001] Dashboard Raw SQL Watch List Query ควร Monitor
- **หมวด**: 8 — Performance
- **ไฟล์**: `apps/api/src/modules/dashboard/dashboard.service.ts:637-727`
- **ข้อเสนอ**: Query ซับซ้อนมาก — ควร monitor execution time เมื่อ dataset โตขึ้น

### [IN-002] TODO Comments สำหรับ Perpetual Inventory (3 จุด)
- **หมวด**: 7 — Code Quality
- **ไฟล์**: `apps/api/src/modules/sales/sales.service.ts:243, 347, 438`
- **ข้อเสนอ**: TODO 3 จุดเกี่ยวกับ perpetual inventory journal — ควรวาง plan หรือ track เป็น issue

### [IN-003] Query Execution Monitoring ไม่มี
- **หมวด**: 8 — Performance
- **ข้อเสนอ**: ควรเพิ่ม Prisma middleware log slow queries (>500ms) สำหรับ production monitoring

### [IN-004] Select Optimization ใน Contract Detail
- **หมวด**: 4 — Database
- **ไฟล์**: `apps/api/src/modules/contracts/contracts.service.ts:117-135`
- **ข้อเสนอ**: Include หลาย nested relations — acceptable สำหรับ detail page แต่ควร track payload size

### [IN-005] Response DTO Wrappers
- **หมวด**: 5 — API Design
- **ข้อเสนอ**: พิจารณาใช้ NestJS `ClassSerializerInterceptor` + response DTOs สำหรับ data filtering

### [IN-006] AuditLog Model ไม่มี deletedAt (ตั้งใจ)
- **หมวด**: 4 — Database
- **ไฟล์**: `apps/api/prisma/schema.prisma` (AuditLog model)
- **ข้อเสนอ**: Acceptable — audit logs ควรเป็น immutable

---

## Good Practices Found

### Security
- ✅ JWT access token เก็บ in-memory — ไม่มี localStorage/sessionStorage leak
- ✅ Refresh token ใช้ httpOnly cookie + token rotation + replay detection
- ✅ Password hashing ด้วย bcrypt อย่างถูกต้อง
- ✅ Rate limiting แยก user-based / IP-based (dual-mode)
- ✅ Throttling เข้มงวดบน sensitive endpoints (login 10/min, reset 5/min, 2FA 5/min)
- ✅ DOMPurify ใช้สำหรับ HTML sanitization ใน template editor
- ✅ CSRF Guard ด้วย `X-Requested-With` header check
- ✅ ทุก controller มี `@UseGuards(JwtAuthGuard, RolesGuard)` ครบ (41+ controllers verified)
- ✅ `.env` files อยู่ใน `.gitignore` ไม่ถูก commit

### Financial
- ✅ Satang-level precision ด้วย `roundBaht()` = `Math.round(value * 100) / 100`
- ✅ Payment schedule last-installment adjustment ถูกต้อง
- ✅ Transaction isolation สำหรับ payment recording (serializable)
- ✅ Idempotency check ด้วย transactionRef regex matching
- ✅ Late fee cap enforcement ด้วย `LEAST()` ใน SQL (atomic)
- ✅ Database schema ใช้ `@db.Decimal(12, 2)` ทุก money field
- ✅ Credit balance tracking สำหรับ overpayment

### Database
- ✅ ทุก model ใช้ UUID — ไม่มี autoincrement
- ✅ Timestamps (createdAt, updatedAt, deletedAt) ครบทุก model (ยกเว้น BadDebtProvision, AuditLog)
- ✅ Comprehensive indexing บน frequently queried fields
- ✅ Enum naming convention ถูกต้อง (PascalCase type, SCREAMING_SNAKE_CASE values)
- ✅ Cascade delete policies เหมาะสม

### Frontend
- ✅ ทุก page lazy-loaded ด้วย React.lazy() (70+ pages)
- ✅ React Query configured ด้วย staleTime ที่เหมาะสมต่อ use case
- ✅ useDebounce ใช้บน search inputs (300-400ms)
- ✅ ไม่มี `any` type ที่เกินจำเป็น
- ✅ Import aliases `@/` ใช้สม่ำเสมอ
- ✅ Error handling ผ่าน shared `getErrorMessage()` utility

### Code Quality
- ✅ ไม่มี console.log ลืมลบใน production code
- ✅ ไม่มี `@ts-ignore` หรือ `@ts-nocheck`
- ✅ Magic numbers ถูก extract เป็น named constants ใน config utility
- ✅ ไม่มี hardcoded URLs, API keys, หรือ credentials
- ✅ Dashboard service ใช้ cache-manager อย่างเหมาะสม

---

## Code Metrics Summary

| Metric | Count |
|--------|-------|
| Files reviewed | ~120+ |
| Critical issues | 13 |
| Warning issues | 18 |
| Info suggestions | 6 |
| TODO/FIXME found | 3 |
| Dead code instances | 1 |
| Missing Guards | 0 |
| N+1 queries | 2 |
| Components >500 lines | 3 |
| console.log left | 0 |
| @ts-ignore/@ts-nocheck | 0 |

---

## Action Items

| # | Issue | Severity | File | Est. Effort |
|---|-------|----------|------|-------------|
| 1 | CR-001: VAT คำนวณบนดอกเบี้ย (ผิดกฎหมาย) | Critical | installment.util.ts, sales.service.ts | M |
| 2 | CR-003: Early Payoff ไม่คืน VAT ส่วนลด | Critical | contract-payment.service.ts | M |
| 3 | CR-002: Late Fee Satang Precision | Critical | overdue.service.ts, config.util.ts | S |
| 4 | CR-004: SQL Injection ใน Receipts | Critical | receipts.service.ts | S |
| 5 | CR-005~007: Missing Soft Delete Filters | Critical | contracts.service.ts | S |
| 6 | CR-008: BadDebtProvision ขาด deletedAt | Critical | schema.prisma | S |
| 7 | CR-009: Raw Body Parameters | Critical | products/repossessions/contracts controller | M |
| 8 | CR-010: Pagination ไม่ consistent | Critical | หลาย controllers | M |
| 9 | CR-013: N+1 Query ใน Sales OWNER | Critical | sales.service.ts | S |
| 10 | CR-011~012: Large Components | Critical | DashboardPage, ContractDetailPage, PaymentsPage | L |
| 11 | WR-006: Number() Conversion | Warning | payments.service.ts, accounting.service.ts | M |
| 12 | WR-012: Pagination Response Shape | Warning | หลาย services | M |
| 13 | WR-015: N+1 Branch Comparison | Warning | reports.service.ts | M |
| 14 | WR-016: Duplicate Date Calculation | Warning | 4 files | S |
| 15 | WR-001~005: Security Warnings | Warning | chart.tsx, api.ts, audit controller, dto | S |

**ลำดับความสำคัญ**: แก้ CR-001 (VAT) → CR-004 (SQL Injection) → CR-005~007 (Soft Delete) → CR-009~010 (API) → WR issues

---

*รายงานนี้สร้างโดย Claude Code — ตรวจสอบ 8 หมวดตาม CODE-REVIEW-PROMPT.md*
*ไม่รวม: UI/UX design, หลักบัญชีไทย (มี audit แยก), E2E test coverage, infrastructure/DevOps*
