# Prompt: Code Review ทั้งระบบ BESTCHOICE

## บทบาทของคุณ

คุณเป็น **Senior Software Engineer / Tech Lead** ที่เชี่ยวชาญ NestJS, React, TypeScript, Prisma, และ PostgreSQL มีหน้าที่ตรวจสอบ code quality ทั้งระบบ BESTCHOICE ครอบคลุม security, performance, maintainability, correctness, และ coding standards

## ข้อมูลพื้นฐานของระบบ

BESTCHOICE เป็นระบบ **ผ่อนชำระ (Hire-Purchase)** สำหรับร้านขายมือถือในประเทศไทย:

### Business Model
- ปัจจุบัน 1 นิติบุคคล แบ่ง 2 ส่วนธุรกิจ (วางแผนแยก 2 นิติบุคคลในอนาคต):
  - **BESTCHOICE SHOP** (หลายสาขา) — ขายมือถือใหม่+มือสอง+แถมอุปกรณ์เสริม, **ไม่จด VAT**
  - **BESTCHOICE FINANCE** (ส่วนกลาง) — จัดไฟแนนซ์, **จด VAT**, ถือกรรมสิทธิ์สินค้าระหว่างผ่อน
- เจ้าของเดียวกันทั้ง SHOP + FINANCE, บัญชีธนาคารแยก, LINE OA แยก
- ขายเงินสด, ผ่อน (จำนวนงวดตั้งค่าได้, flat rate), ผ่านไฟแนนซ์ภายนอก (GFIN)

### Flow เงินเมื่อขายผ่อน
- ลูกค้าจ่ายดาวน์ → **SHOP เก็บ**
- FINANCE จ่ายให้ SHOP = **ยอดจัดไฟแนนซ์ + ค่าคอม** (% ของยอดจัด)
- กรรมสิทธิ์สินค้าย้ายจาก SHOP → FINANCE (จนลูกค้าผ่อนครบ)
- ลูกค้าจ่ายค่างวดให้ FINANCE (โอน/PaySolutions QR ผ่าน LINE)
- **VAT 7%** คิดจาก (เงินต้น+ดอกเบี้ย+ค่าคอม) → รวมในค่างวด → นำส่งรายเดือนตามจ่ายจริง

### Roles
| Role | ฝั่ง | หน้าที่ |
|------|-----|---------|
| OWNER | ทั้งหมด | ดูภาพรวม, อนุมัติ, ตั้งค่า, สั่งซื้อ |
| BRANCH_MANAGER | SHOP | จัดการสาขา |
| SALES | SHOP | ขายหน้าร้าน |
| FINANCE_MANAGER | FINANCE | ตรวจ/อนุมัติสัญญา+สินเชื่อ, อนุมัติค่าใช้จ่าย |
| ACCOUNTANT | FINANCE | รับค่างวด, ติดตามหนี้, นิติกรรม, บัญชี, ใบเสร็จ |

### ระบบภายนอก
- PEAK (บัญชี), CHATCONE (แชท LINE/Facebook/TikTok), MDM PJ-Soft (ล็อคเครื่อง), PaySolutions (QR)

### Tech Stack
- **Backend**: NestJS + Prisma + PostgreSQL (39 modules)
- **Frontend**: React 18 + TypeScript + Vite 6 + Tailwind CSS (57 pages)
- **Monorepo**: Turborepo with npm workspaces
- **Auth**: JWT in-memory + httpOnly refresh cookie
- **Money**: Decimal(12,2) ทุก field — ห้ามใช้ Float

---

## หมวดการตรวจสอบ

### หมวดที่ 1: Security Vulnerabilities

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/auth/` — ทุกไฟล์ (JWT, Guards, Login, Refresh)
- `apps/api/src/guards/` — CsrfGuard, UserThrottlerGuard
- `apps/api/src/modules/*/` — ทุก controller (ตรวจ Guards + Roles)
- `apps/web/src/lib/api.ts` — axios interceptors, token handling
- `apps/web/src/contexts/AuthContext.tsx` — auth state management

**Checklist:**
- [ ] **SQL Injection**: ตรวจว่าไม่มี raw SQL queries ที่รับ user input โดยตรง — ทุก query ผ่าน Prisma parameterized
- [ ] **XSS**: ตรวจว่า frontend ไม่มี `dangerouslySetInnerHTML` โดยไม่ sanitize
- [ ] **CSRF**: ทุก mutating endpoint (POST/PUT/DELETE) ผ่าน CsrfGuard
- [ ] **Auth Guards**: ทุก controller มี `@UseGuards(JwtAuthGuard, RolesGuard)` — ตรวจว่าไม่มี controller ที่ลืมใส่
- [ ] **Role Authorization**: ทุก method มี `@Roles(...)` ที่เหมาะสม — ไม่มี endpoint ที่ทุก role เข้าถึงได้โดยไม่จำเป็น
- [ ] **JWT**: access token เก็บ in-memory เท่านั้น — ไม่มี localStorage/sessionStorage
- [ ] **Refresh Token**: httpOnly, secure, SameSite — มี token rotation
- [ ] **Password Hashing**: ใช้ bcrypt หรือ argon2 — ไม่เก็บ plaintext
- [ ] **Rate Limiting**: ThrottlerGuard ทำงานถูกต้อง — ไม่มี endpoint ที่ bypass
- [ ] **Sensitive Data**: ไม่มี password, token, PII ใน log หรือ error response
- [ ] **File Upload**: validate file type/size ก่อน upload S3 — ไม่มี path traversal
- [ ] **Environment**: `.env` ไม่ถูก commit, secrets ใช้ env vars ทั้งหมด

---

### หมวดที่ 2: Financial Calculation Correctness

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/utils/installment.util.ts` — calculateInstallment(), generatePaymentSchedule()
- `apps/api/src/modules/payments/payments.service.ts` — recordPayment(), autoAllocatePayment()
- `apps/api/src/modules/contracts/contracts.service.ts` — create(), contract calculations
- `apps/api/src/modules/contracts/contract-payment.service.ts` — getEarlyPayoffQuote()
- `apps/api/src/modules/accounting/accounting.service.ts` — P&L, expense calculations
- `apps/api/src/modules/inter-company/inter-company.service.ts` — profit allocation
- `apps/api/src/modules/sales/sales.service.ts` — sale price calculations

**Checklist:**
- [ ] **Decimal Precision**: ทุกการคำนวณเงินใช้ Decimal — ไม่มี `Number()`, `parseFloat()`, หรือ arithmetic กับ float
- [ ] **Rounding**: ใช้ satang precision อย่างสม่ำเสมอ — ยอดรวมทุกงวด = financedAmount พอดี
- [ ] **Payment Schedule**: sum(monthlyPayment * installments) = financedAmount + totalInterest
- [ ] **Late Fee**: คำนวณถูกต้อง, มี cap, ไม่เกินกฎหมาย
- [ ] **Early Payoff**: ส่วนลด 50% ดอกเบี้ยคงเหลือ — คำนวณถูกต้อง
- [ ] **Overpayment**: creditBalance จัดการถูกต้อง — ไม่สูญหาย, ใช้หักงวดถัดไป
- [ ] **VAT**: 7% คำนวณบน base ที่ถูกต้อง — ดอกเบี้ยเช่าซื้อยกเว้น VAT
- [ ] **Inter-Company**: profit allocation ตรง — Shop + Finance = Total
- [ ] **COGS**: ต้นทุนขายตัดจาก stock ถูกต้องเมื่อขาย
- [ ] **Race Conditions**: concurrent payments ไม่ทำให้ยอดผิด — ตรวจ transaction isolation

---

### หมวดที่ 3: Error Handling & Edge Cases

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/*/` — ทุก service file
- `apps/web/src/pages/` — ทุก page (error states)
- `apps/web/src/lib/api.ts` — error interceptors

**Checklist:**
- [ ] **Service Layer**: ใช้ NestJS exceptions (NotFoundException, BadRequestException, etc.) — ไม่ throw generic Error
- [ ] **Null Checks**: ตรวจ null/undefined ก่อนใช้ — โดยเฉพาะ Prisma findUnique ที่อาจ return null
- [ ] **Soft Delete**: ทุก query มี `where: { deletedAt: null }` — ไม่มี query ที่ลืม filter
- [ ] **Transaction Safety**: operations ที่แก้หลาย table ใช้ `prisma.$transaction()` — ไม่มี partial update
- [ ] **Idempotency**: payment recording มี transactionRef check — ไม่มี double payment
- [ ] **Frontend Errors**: ทุก useMutation มี `onError` handler — แสดง toast.error() ที่เข้าใจง่าย
- [ ] **Loading States**: ทุก useQuery มี loading/error state — ไม่มี blank screen
- [ ] **Empty States**: ตาราง/list ที่ว่างแสดง empty state message — ไม่ใช่ table เปล่า
- [ ] **Boundary Conditions**: amount = 0, negative values, string ที่ยาวเกิน, special characters

---

### หมวดที่ 4: Database & Prisma

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/prisma/schema.prisma` — ทุก model
- `apps/api/src/modules/*/` — ทุก service (Prisma queries)

**Checklist:**
- [ ] **IDs**: ทุก model ใช้ UUID — ไม่มี autoincrement
- [ ] **Timestamps**: ทุก model มี `createdAt`, `updatedAt`, `deletedAt`
- [ ] **Money Fields**: ทุก field เกี่ยวกับเงินใช้ `@db.Decimal(12, 2)` — ไม่มี Float/Int
- [ ] **Indexes**: fields ที่ถูก query/filter บ่อยมี `@@index` — ตรวจ WHERE clause ที่ไม่มี index
- [ ] **N+1 Queries**: ไม่มี loop ที่ query DB ทุก iteration — ใช้ `include` หรือ batch query
- [ ] **Select Optimization**: query ที่ไม่ต้องการทุก field ใช้ `select` — ไม่ดึง data เกินจำเป็น
- [ ] **Relations**: foreign key constraints ถูกต้อง — onDelete policy เหมาะสม
- [ ] **Enums**: PascalCase type, SCREAMING_SNAKE_CASE values
- [ ] **Migration Safety**: ไม่มี destructive migration ที่ drop column/table โดยไม่ได้ตั้งใจ

---

### หมวดที่ 5: API Design & RESTful Patterns

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/*/` — ทุก controller + DTO
- `apps/api/src/modules/*/dto/` — ทุก DTO file

**Checklist:**
- [ ] **HTTP Methods**: GET สำหรับ read, POST สำหรับ create, PATCH/PUT สำหรับ update, DELETE สำหรับ soft delete
- [ ] **Status Codes**: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found — ใช้ถูกต้อง
- [ ] **DTO Validation**: ทุก input มี class-validator decorators — ไม่มี endpoint ที่รับ raw body
- [ ] **CreateDto vs UpdateDto**: แยก DTO — UpdateDto ทุก field เป็น optional
- [ ] **Pagination**: response shape `{ data, total, page, limit }` สม่ำเสมอทุก list endpoint
- [ ] **Search/Filter**: ใช้ query params — ไม่ใช้ request body สำหรับ GET
- [ ] **Consistent Response**: ทุก endpoint return shape เดียวกัน — ไม่มี inconsistency
- [ ] **Error Messages**: ภาษาไทย, ชัดเจน, ไม่ expose internal details
- [ ] **Controller Bloat**: controller ไม่มี business logic — ทุกอย่างอยู่ใน service

---

### หมวดที่ 6: Frontend Architecture & Patterns

**ไฟล์ที่ต้องตรวจ:**
- `apps/web/src/pages/` — ทุก page file
- `apps/web/src/components/` — shared components
- `apps/web/src/hooks/` — custom hooks
- `apps/web/src/store/` — Zustand stores
- `apps/web/src/contexts/` — React contexts
- `apps/web/src/types/` — TypeScript types

**Checklist:**
- [ ] **Data Fetching**: ใช้ `useQuery`/`useMutation` เท่านั้น — ไม่มี raw `useEffect` + `fetch`
- [ ] **Cache Invalidation**: ทุก mutation เรียก `queryClient.invalidateQueries()` หลังสำเร็จ
- [ ] **API Client**: ใช้ `api.get()`/`api.post()` จาก `@/lib/api` — ไม่มี raw fetch/axios
- [ ] **Component Size**: ไม่มี component ที่ใหญ่เกิน 500 บรรทัด — ควรแยก sub-components
- [ ] **Type Safety**: ไม่มี `any` type ที่ไม่จำเป็น — ทุก API response มี proper type
- [ ] **Memory Leaks**: useEffect cleanup functions ถูกต้อง — ไม่มี subscription ที่ไม่ unsubscribe
- [ ] **Memoization**: expensive calculations ใช้ `useMemo`/`useCallback` — ไม่ over-memoize
- [ ] **Routing**: ทุก page lazy-loaded — ProtectedRoute ครอบทุก authenticated route
- [ ] **Zustand**: ใช้สำหรับ complex client state เท่านั้น — ไม่ใช้แทน React Query
- [ ] **Import Aliases**: ใช้ `@/` consistently — ไม่มี relative imports ข้าม level มากเกิน

---

### หมวดที่ 7: Code Quality & Maintainability

**ไฟล์ที่ต้องตรวจ:**
- ทุกไฟล์ที่ตรวจในหมวดก่อนหน้า

**Checklist:**
- [ ] **Dead Code**: ไม่มี functions/imports/variables ที่ไม่ถูกใช้
- [ ] **Duplicate Code**: ไม่มี logic ที่ copy-paste ระหว่าง modules — ควร extract shared utility
- [ ] **Magic Numbers**: ไม่มีตัวเลขใน code โดยไม่มีชื่อ constant — เช่น `7` ควรเป็น `VAT_RATE`
- [ ] **Naming**: camelCase (vars/functions), PascalCase (components/classes/types) — ไม่มี inconsistency
- [ ] **File Organization**: ไม่มีไฟล์ที่อยู่ผิดที่ — services ใน services/, components ใน components/
- [ ] **Console.log**: ไม่มี `console.log` ที่ลืมลบ — ใช้ Logger service แทน
- [ ] **TODO/FIXME**: รวบรวม TODO/FIXME/HACK comments ทั้งหมด — ประเมินว่าต้องแก้หรือไม่
- [ ] **Hardcoded Values**: ไม่มี URL, API keys, credentials hardcoded ใน source code
- [ ] **TypeScript Strict**: ไม่มี `@ts-ignore` หรือ `@ts-nocheck` โดยไม่มีเหตุผล
- [ ] **Circular Dependencies**: ไม่มี circular imports ระหว่าง modules

---

### หมวดที่ 8: Performance

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/reports/reports.service.ts` — heavy queries
- `apps/api/src/modules/dashboard/dashboard.service.ts` — aggregations
- `apps/api/src/modules/accounting/accounting.service.ts` — P&L calculations
- `apps/web/src/pages/DashboardPage.tsx` — initial load
- `apps/web/src/pages/ContractsPage.tsx` — large data table
- `apps/web/src/pages/PaymentsPage.tsx` — large data table

**Checklist:**
- [ ] **N+1 Queries**: report/dashboard queries ไม่มี N+1 — ใช้ `include` หรือ aggregate
- [ ] **Pagination**: list endpoints ทุกตัว paginated — ไม่มี endpoint ที่ return ทุก record
- [ ] **Query Optimization**: queries ที่ JOIN หลาย table มี appropriate indexes
- [ ] **Frontend Bundle**: ทุก page lazy-loaded — ไม่มี page ที่ import ใน main bundle
- [ ] **Image/File**: uploads มี size limit — downloads ใช้ streaming ถ้าไฟล์ใหญ่
- [ ] **Debounce**: search inputs ใช้ `useDebounce` — ไม่ fire API ทุก keystroke
- [ ] **Re-renders**: ไม่มี unnecessary re-renders จาก context/state changes
- [ ] **Caching**: React Query cache ใช้ `staleTime` ที่เหมาะสม — ไม่ refetch ทุกครั้ง

---

## รูปแบบรายงานผลตรวจสอบ

```markdown
# Code Review Report — BESTCHOICE
วันที่ตรวจสอบ: [วันที่]

## สรุปผลรวม
| หมวด | สถานะ | Critical | Warning | Info |
|------|--------|----------|---------|------|
| 1. Security | PASS/FAIL | 0 | 0 | 0 |
| 2. Financial Calculations | ... | ... | ... | ... |
| 3. Error Handling | ... | ... | ... | ... |
| 4. Database & Prisma | ... | ... | ... | ... |
| 5. API Design | ... | ... | ... | ... |
| 6. Frontend Architecture | ... | ... | ... | ... |
| 7. Code Quality | ... | ... | ... | ... |
| 8. Performance | ... | ... | ... | ... |

## Critical Issues — ต้องแก้ทันที
### [CR-001] ชื่อประเด็น
- **หมวด**: X
- **ไฟล์**: path/to/file.ts:line
- **ปัญหา**: อธิบายปัญหาพร้อม code snippet
- **ความเสี่ยง**: ผลกระทบ (data loss, security breach, financial error, etc.)
- **แนวทางแก้ไข**: code fix ที่เสนอ

## Warning Issues — ควรแก้ไข
### [WR-001] ชื่อประเด็น
- (รูปแบบเดียวกัน)

## Info / Suggestions — ข้อเสนอแนะ
### [IN-001] ชื่อประเด็น
- (รูปแบบเดียวกัน)

## Good Practices Found
- รายการสิ่งที่ทำได้ดี

## Code Metrics Summary
| Metric | Count |
|--------|-------|
| Files reviewed | X |
| Critical issues | X |
| Warning issues | X |
| Info suggestions | X |
| TODO/FIXME found | X |
| Dead code instances | X |
| Missing Guards | X |
| N+1 queries | X |

## Action Items
| # | Issue | Severity | File | Est. Effort |
|---|-------|----------|------|-------------|
| 1 | ... | Critical/Warning/Info | ... | S/M/L |
```

---

## ขอบเขตที่ไม่ต้องตรวจ

- ไม่ตรวจ UI/UX design (มี audit แยก)
- ไม่ตรวจหลักบัญชีไทย (มี accounting audit แยก)
- ไม่ตรวจ E2E test coverage (มี audit แยก)
- ไม่ตรวจ infrastructure/DevOps
- ไม่ต้อง fix code — รายงานปัญหาเท่านั้น

---

## วิธีใช้ Prompt นี้

1. **Copy Prompt ทั้งหมด** ไปใช้ใน Claude Code conversation ใหม่
2. Claude จะ **อ่านไฟล์** ตามที่ระบุในแต่ละหมวด
3. ตรวจสอบตาม **Checklist** ทีละข้อ
4. สร้าง **รายงาน** ตามรูปแบบที่กำหนด
5. Review ผลและดำเนินการตาม Action Items

### คำสั่งเริ่มต้น:
```
ตรวจสอบ code quality ทั้งระบบ BESTCHOICE โดยใช้ Prompt ใน docs/prompts/CODE-REVIEW-PROMPT.md — อ่านทุกไฟล์ที่ระบุ, ตรวจตาม Checklist ทุกข้อ, และสร้างรายงาน Code Review Report
```
