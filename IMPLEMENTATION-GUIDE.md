# 🤖 คู่มือ: สร้างระบบผ่อนชำระด้วย Claude Code

## สถานะปัจจุบัน

```
✅ Phase 1: Foundation (Step 1-4)   — Project Setup, DB Schema, Auth/RBAC, Branch CRUD
✅ Phase 2: Core Business (Step 5-13) — Supplier, Product, Inspection, Sticker, Customer,
                                         Contract, E-Signature, Payment, Late Fee
✅ Phase 3: Operations (Step 14-17)  — Overdue Tracking, Exchange, Repossession, Purchase Order
✅ Phase 4: Communication (Step 18-19) — Notifications (LINE + SMS templates)
✅ Phase 5: Intelligence (Step 20-21)  — Dashboard, Reports
✅ Phase 6: Polish (Step 22-24)        — Data Migration, Security (Audit), Deployment (Docker + DO)

🎉 ระบบสมบูรณ์ — ทุก Phase ถูก implement แล้ว (merged from all branches)
```

---

## ⚡ Pre-requisites (ติดตั้งก่อนเริ่ม)

### สิ่งที่ต้องมีบนเครื่อง

```bash
# 1. Node.js (v20+)
node --version

# 2. PostgreSQL (v16+)
psql --version

# 3. Redis
redis-cli ping

# 4. Git
git --version

# 5. Claude Code CLI
claude --version
```

### สร้างโปรเจค

```bash
mkdir installment-system
cd installment-system
git init
```

### ⚠️ กฎสำคัญในการใช้ Claude Code

1. **ใส่ SPEC เป็น context เสมอ** — copy SPEC-installment.md ไว้ใน root ของโปรเจค
2. **ทำทีละ step** — อย่าให้ Claude สร้างทุกอย่างพร้อมกัน
3. **ทดสอบทุก step** — รัน test ก่อนไป step ถัดไป
4. **Commit บ่อยๆ** — git commit หลังจบทุก step

---

## 🏗️ ลำดับการ Build (สำคัญมาก!)

```
Phase 1: Foundation
  Step 1  → Project Setup + Tech Stack
  Step 2  → Database Schema + Migrations
  Step 3  → Authentication + RBAC
  Step 4  → Branch Management (CRUD)

Phase 2: Core Business
  Step 5  → Supplier Management
  Step 6  → Product + Inventory (Multi-price)
  Step 7  → Phone Inspection System
  Step 8  → Sticker Printing
  Step 9  → Customer Management
  Step 10 → Installment Contract (สร้างสัญญา + คำนวณงวด)
  Step 11 → E-Signature + E-Document
  Step 12 → Payment Recording (บันทึกการชำระ)
  Step 13 → Late Fee + Early Payoff (ค่าปรับ + ปิดก่อน)

Phase 3: Operations
  Step 14 → Overdue Tracking + Call Log (ติดตามหนี้)
  Step 15 → Device Exchange (เปลี่ยนเครื่อง)
  Step 16 → Repossession + Resell (ยึดคืน)
  Step 17 → Purchase Order System

Phase 4: Communication
  Step 18 → Notification System (LINE + SMS)
  Step 19 → Notification Templates + Scheduling

Phase 5: Intelligence
  Step 20 → Dashboard (Real-time)
  Step 21 → Reports + Export (PDF/Excel)

Phase 6: Polish
  Step 22 → Data Migration Tool
  Step 23 → Security Hardening
  Step 24 → Deployment
```

---

## Phase 1: Foundation

---

### Step 1: Project Setup

**Prompt สำหรับ Claude Code:**

```
อ่านไฟล์ SPEC-installment.md ในโปรเจคนี้ทั้งหมดก่อน

จากนั้นสร้าง project structure สำหรับระบบผ่อนชำระร้านมือถือ:

Tech Stack:
- Backend: NestJS + TypeScript
- Frontend: React + TypeScript + Tailwind CSS + Vite
- Database: PostgreSQL + Prisma ORM
- Cache: Redis
- Monorepo: Turborepo (apps/api + apps/web)

สร้าง:
1. Monorepo structure ด้วย Turborepo
2. Backend (apps/api): NestJS project พร้อม Prisma, class-validator, passport-jwt
3. Frontend (apps/web): React + Vite + Tailwind + React Router + React Query
4. Shared packages: packages/shared (types, constants, utils ที่ใช้ร่วมกัน)
5. Docker Compose สำหรับ PostgreSQL + Redis (development)
6. .env.example พร้อม config ที่จำเป็น
7. ESLint + Prettier config

อย่าสร้าง business logic ใดๆ ยังแค่โครงสร้างโปรเจค + hello world
```

**ทดสอบ:**
```bash
# Backend ต้องรันได้
cd apps/api && npm run start:dev
# → http://localhost:3000 ต้องตอบ OK

# Frontend ต้องรันได้
cd apps/web && npm run dev
# → http://localhost:5173 ต้องเห็นหน้าจอ

# Database ต้องเชื่อมต่อได้
docker compose up -d
npx prisma db push
```

✅ **Commit:** `git commit -m "step-01: project setup + monorepo structure"`

---

### Step 2: Database Schema

**Prompt:**

```
อ่าน SPEC-installment.md Section 12 (Data Model) และ Section 24 (Complete Data Model)

สร้าง Prisma schema (prisma/schema.prisma) ให้ครบทุก entity:

Core:
- branches (สาขา)
- users (ผู้ใช้ระบบ พร้อม role enum: SALES, BRANCH_MANAGER, OWNER, ACCOUNTANT)
- customers (ลูกค้า)
- contracts (สัญญาผ่อน พร้อม status enum ตาม Section 5)
- payments (การชำระเงิน)

Inventory:
- suppliers
- purchase_orders + po_items
- products + product_prices (หลายราคา)
- stock_transfers

Inspection:
- inspection_templates + inspection_template_items
- inspections + inspection_results

Documents:
- contract_templates
- e_documents
- signatures

Operations:
- repossessions
- notification_logs
- call_logs
- audit_logs
- system_config
- sticker_templates

กฎ:
- ทุก table ต้องมี id (UUID), created_at, updated_at
- ใช้ enum สำหรับ status fields ทั้งหมด
- สร้าง relation ให้ถูกต้อง (foreign keys)
- เพิ่ม index สำหรับ fields ที่จะ query บ่อย (customer national_id, product imei, contract status)
- เพิ่ม soft delete (deleted_at) สำหรับ customers, contracts, products

สร้าง seed file (prisma/seed.ts) ที่มี:
- 3 สาขาตัวอย่าง
- 1 admin user (owner)
- system_config เริ่มต้น (ดอกเบี้ย 8%, ดาวน์ 15%, ค่าปรับ 100/วัน cap 200)
```

**ทดสอบ:**
```bash
npx prisma migrate dev --name init
npx prisma db seed
npx prisma studio  # เปิดดูว่า table ครบ + data ถูกต้อง
```

✅ **Commit:** `git commit -m "step-02: complete database schema + seed data"`

---

### Step 3: Authentication + RBAC

**Prompt:**

```
อ่าน SPEC Section 8 (User Roles & Permissions)

สร้างระบบ Auth + RBAC:

Backend (NestJS):
1. POST /auth/login — รับ email+password → return JWT (access_token + refresh_token)
2. POST /auth/refresh — refresh token
3. GET /auth/me — ข้อมูล user ปัจจุบัน
4. Guards: JwtAuthGuard + RolesGuard
5. Decorator: @Roles('OWNER', 'BRANCH_MANAGER') สำหรับกำหนดสิทธิ์
6. BranchGuard — ตรวจว่า user เข้าถึงเฉพาะข้อมูลสาขาตัวเอง
   - SALES → เฉพาะสาขาตัวเอง
   - BRANCH_MANAGER → เฉพาะสาขาที่ดูแล
   - ACCOUNTANT → อ่านได้ทุกสาขา (read-only financial data)
   - OWNER → ทุกสาขา ทุกสิทธิ์
7. Password hashing ด้วย bcrypt
8. Rate limiting สำหรับ login (max 5 attempts / 15 min)

Frontend (React):
1. หน้า Login (email + password)
2. AuthContext + useAuth hook
3. ProtectedRoute component (check JWT + role)
4. Auto refresh token
5. Redirect to login เมื่อ token expire

เขียน unit test สำหรับ:
- Login success/failure
- Role guard ทำงานถูกต้อง
- Branch guard filter ข้อมูลถูกต้อง
```

**ทดสอบ:**
```bash
npm run test  # unit tests ต้องผ่าน
# ลอง login ด้วย seed user
# ลอง access endpoint ที่ไม่มีสิทธิ์ → ต้องได้ 403
```

✅ **Commit:** `git commit -m "step-03: auth + RBAC + branch-level access control"`

---

### Step 4: Branch Management

**Prompt:**

```
สร้าง CRUD สำหรับจัดการสาขา (branches):

Backend:
- GET    /branches      — list ทั้งหมด (OWNER) หรือเฉพาะสาขาตัวเอง
- GET    /branches/:id  — รายละเอียดสาขา
- POST   /branches      — สร้างสาขา (OWNER only)
- PATCH  /branches/:id  — แก้ไขสาขา (OWNER only)
- DELETE /branches/:id  — soft delete (OWNER only)

Frontend:
- หน้ารายการสาขา (table + search)
- Modal สร้าง/แก้ไขสาขา
- Layout หลัก: Sidebar navigation + Top bar แสดงชื่อ user + สาขา

สร้าง reusable components:
- DataTable (sortable, searchable, pagination)
- Modal
- Form components (Input, Select, DatePicker)
- PageHeader
- Sidebar + TopBar layout
```

✅ **Commit:** `git commit -m "step-04: branch CRUD + base layout + reusable components"`

---

## Phase 2: Core Business

---

### Step 5: Supplier Management

**Prompt:**

```
อ่าน SPEC Section 20.1 และ 20.2

สร้างระบบจัดการ Supplier:

Backend:
- CRUD /suppliers (สร้าง, ดู, แก้, ปิดใช้งาน)
- GET /suppliers/:id/purchase-history — ประวัติการซื้อจาก supplier นี้
- Fields ตาม SPEC: ชื่อ, ผู้ติดต่อ, เบอร์, LINE ID, ที่อยู่, Tax ID, status, notes

Frontend:
- หน้ารายการ Supplier (table + filter active/inactive + search)
- Form สร้าง/แก้ไข Supplier
- หน้ารายละเอียด Supplier → แสดงประวัติการซื้อ
```

✅ **Commit:** `git commit -m "step-05: supplier management"`

---

### Step 6: Product + Inventory + Multi-Price

**Prompt:**

```
อ่าน SPEC Section 20.4 (Multi-Price) และ Section 22 (Inventory)

สร้างระบบสินค้า + สต็อก:

Backend:
- CRUD /products
- POST /products/:id/prices — เพิ่มราคาขาย
- PATCH /products/:id/prices/:priceId — แก้ไขราคา
- DELETE /products/:id/prices/:priceId — ลบราคา
- POST /products/:id/transfer — โอนสินค้าระหว่างสาขา
- GET /products/stock — ดูสต็อก (filter: สาขา, สถานะ, ยี่ห้อ, ค้นหา IMEI)

Product fields:
- name, brand, model, imei_serial (unique), category (PHONE_NEW, PHONE_USED, TABLET, ACCESSORY)
- cost_price, supplier_id, po_id, branch_id
- status enum: PO_RECEIVED, INSPECTION, IN_STOCK, RESERVED, SOLD_INSTALLMENT, SOLD_CASH, REPOSSESSED, REFURBISHED, SOLD_RESELL
- condition_grade (A/B/C/D — nullable สำหรับเครื่องใหม่)
- photos (array of URLs)

Product Prices (1-to-many):
- label (string — เช่น "ราคาเงินสด", "ราคาผ่อน")
- amount (decimal)
- is_default (boolean — มีได้แค่ 1 default per product)

Frontend:
- หน้ารายการสินค้า (table + filter + search by IMEI/ชื่อ)
- หน้าเพิ่มสินค้า (form + เพิ่มหลายราคา dynamic)
- หน้ารายละเอียดสินค้า (ข้อมูล + ราคาทั้งหมด + ประวัติ + ผลตรวจ)
- หน้าสต็อกรวม (ดูทุกสาขา / filter สาขา)
- Modal โอนสินค้าระหว่างสาขา
```

✅ **Commit:** `git commit -m "step-06: product + inventory + multi-price system"`

---

### Step 7: Phone Inspection

**Prompt:**

```
อ่าน SPEC Section 19 (Phone Inspection) ทั้งหมด

สร้างระบบตรวจเช็คมือถือ:

Backend:

1. Inspection Templates (OWNER จัดการ):
   - CRUD /inspection-templates
   - CRUD /inspection-templates/:id/items
   - Template fields: name, device_type (PHONE/TABLET), is_active
   - Template Item fields: category, item_name, score_type (PASS_FAIL/GRADE/SCORE_1_5/NUMBER), is_required, weight, sort_order

2. Inspections (ตรวจจริง):
   - POST /inspections — เริ่มตรวจ (เลือก product + template)
   - PATCH /inspections/:id — อัพเดทผลตรวจ
   - POST /inspections/:id/complete — ส่งผลตรวจ (คำนวณ auto grade)
   - PATCH /inspections/:id/override-grade — ผจก. override grade
   - POST /inspections/:id/photos — upload รูปเครื่อง

3. Auto-Grading Logic:
   - คำนวณ weighted score จากทุกหัวข้อ
   - A ≥ 90%, B ≥ 70%, C ≥ 50%, D < 50% (configurable ใน system_config)
   - ถ้ามี required item ที่ fail → grade ไม่เกิน C

Frontend:
- หน้าตั้งค่า Template (OWNER) — drag & drop จัดลำดับ, เพิ่ม/ลบหัวข้อ
- หน้าตรวจเช็ค — แสดง checklist ทีละหัวข้อ (mobile-friendly)
  - แต่ละหัวข้อ: ให้คะแนน + ช่องหมายเหตุ
  - ถ่ายรูป 4 ด้าน (บังคับ)
  - แสดง auto grade เมื่อตรวจครบ
- หน้าผลตรวจ — แสดง summary + grade + รูป (ผจก. override ได้)
```

✅ **Commit:** `git commit -m "step-07: phone inspection system with customizable checklist"`

---

### Step 8: Sticker Printing

**Prompt:**

```
อ่าน SPEC Section 18 (ปริ้นสติกเกอร์)

สร้างระบบปริ้นสติกเกอร์:

Backend:
- CRUD /sticker-templates
- GET /products/:id/sticker-preview?templateId=xxx — generate sticker preview (HTML)
- GET /products/:id/sticker-print?templateId=xxx — generate print-ready HTML

Sticker Template fields:
- name, size_width_mm, size_height_mm, layout_config (JSON), placeholders[], is_active

Frontend:
1. หน้าจัดการ Template สติกเกอร์ (OWNER):
   - เลือกขนาด (preset: 50x30, 60x40, 62mm roll หรือ custom)
   - เลือก placeholder ที่จะแสดง (checkbox list)
   - Preview สติกเกอร์ real-time
   
2. ปุ่มปริ้นสติกเกอร์ในหน้าสินค้า:
   - เลือก template
   - Preview → Print (ใช้ window.print() กับ @media print CSS)
   - Batch print: เลือกหลายสินค้า → print ทีเดียว

3. QR Code generation:
   - ใช้ library qrcode สร้าง QR ที่ลิงก์ไป /products/:id
   - แสดงใน sticker + หน้ารายละเอียดสินค้า

สร้าง print-optimized CSS ที่:
- ซ่อน navigation/header ตอน print
- แสดงเฉพาะสติกเกอร์ตามขนาดที่ตั้งไว้
- รองรับ thermal printer (black & white, sharp text)
```

✅ **Commit:** `git commit -m "step-08: sticker printing with customizable templates + QR"`

---

### Step 9: Customer Management

**Prompt:**

```
อ่าน SPEC Section 4 (ข้อมูลลูกค้า) และ Section 11.6 (ลูกค้าซ้ำ)

สร้างระบบจัดการลูกค้า:

Backend:
- CRUD /customers
- GET /customers/search?q=xxx — ค้นหาด้วย ชื่อ, เบอร์, เลขบัตร ปชช., เลขสัญญา
- GET /customers/:id/contracts — สัญญาทั้งหมดของลูกค้า
- POST /customers/:id/documents — upload เอกสาร (บัตร ปชช., สลิปเงินเดือน)
- GET /customers/:id/risk-flag — เช็คว่ามีสัญญา OVERDUE/DEFAULT อยู่ไหม

Customer fields:
- name, national_id (encrypted + unique), phone, phone_secondary
- line_id, address_id_card, address_current
- occupation, workplace
- documents[] (file URLs)

กฎ:
- เลขบัตร ปชช. ต้อง encrypt ใน database (AES-256)
- Validate เลขบัตร ปชช. 13 หลัก (checksum)
- ค้นหาด้วย national_id ต้องทำ encrypted search
- ลูกค้าซ้ำ: ถ้า national_id ซ้ำ → return existing customer
- Risk flag: ถ้ามีสัญญา OVERDUE/DEFAULT → แสดงคำเตือน

Frontend:
- หน้ารายการลูกค้า (table + search)
- หน้าเพิ่ม/แก้ไขลูกค้า (form + upload เอกสาร)
- หน้ารายละเอียดลูกค้า → แสดงทุกสัญญา + risk flag
- ค้นหาลูกค้าต้องเร็ว (autocomplete)
```

✅ **Commit:** `git commit -m "step-09: customer management with encrypted national_id + risk flag"`

---

### Step 10: Installment Contract (หัวใจของระบบ)

**Prompt:**

```
อ่าน SPEC Section 3 (แผนผ่อนชำระ), Section 5 (Lifecycle), Section 11 (Edge Cases)

นี่คือ step สำคัญที่สุด — สร้างระบบสัญญาผ่อนชำระ:

Backend — Contract Service:

1. POST /contracts — สร้างสัญญา
   Input: customer_id, product_id, plan_type (STORE_DIRECT/CREDIT_CARD/STORE_WITH_INTEREST),
          down_payment, total_months, selling_price (เลือกจาก product prices),
          interest_rate (default จาก system_config)
   
   Logic:
   - Validate: down_payment >= selling_price * min_down_pct (default 15%)
   - Validate: total_months between 6-12
   - Validate: product status = IN_STOCK
   - คำนวณตาม SPEC Section 3.3:
     * interest_total = selling_price × interest_rate × total_months
     * financed_amount = (selling_price - down_payment) + interest_total
     * monthly_payment = financed_amount / total_months
   - สร้าง payment schedule (installments) ทั้งหมดล่วงหน้า
     * installment_no: 1 to total_months
     * due_date: วันที่ 1 ของแต่ละเดือนถัดไป (หรือ configurable)
     * amount_due: monthly_payment
   - เปลี่ยนสถานะ product → RESERVED
   - สถานะสัญญา → DRAFT

2. POST /contracts/:id/activate — ยืนยันสัญญา (หลังเซ็น + วางดาวน์)
   - สถานะ → ACTIVE
   - product → SOLD_INSTALLMENT
   
3. GET /contracts — list สัญญา (filter: status, branch, customer, date range)
4. GET /contracts/:id — รายละเอียดสัญญา + ตารางผ่อน + ประวัติชำระ
5. GET /contracts/:id/schedule — ตารางผ่อนพร้อมสถานะแต่ละงวด

6. POST /contracts/:id/early-payoff — ปิดบัญชีก่อนกำหนด
   Logic ตาม SPEC Section 3.4:
   - remaining_interest = monthly_interest × remaining_months
   - discount = remaining_interest × 50%
   - payoff_amount = remaining_principal + (remaining_interest - discount)

Frontend — Wizard สร้างสัญญา (4 steps):
Step 1: เลือกสินค้า
  - ค้นหาด้วย ชื่อ/รุ่น/IMEI หรือ scan QR
  - แสดง: ชื่อ, รูป, grade, ราคาทั้งหมด, สถานะ
  - เลือกราคาที่จะใช้ (default = is_default price)

Step 2: ข้อมูลลูกค้า
  - ค้นหาลูกค้าเดิม (by national_id/phone/name)
  - หรือสร้างลูกค้าใหม่ inline
  - แสดง risk flag ถ้ามีสัญญาค้างชำระ

Step 3: เลือกแผนผ่อน
  - เลือก plan_type
  - กรอกเงินดาวน์ (แสดง % + validate >= 15%)
  - เลือกจำนวนงวด (6-12)
  - แสดง preview ตารางผ่อน real-time:
    | งวดที่ | วันครบกำหนด | เงินต้น | ดอกเบี้ย | รวม |
  - แสดงสรุป: ราคาสินค้า, ดาวน์, ดอกเบี้ยรวม, ยอดผ่อนรวม, ค่างวด/เดือน

Step 4: ยืนยัน
  - แสดงสรุปทั้งหมด (สินค้า + ลูกค้า + แผนผ่อน)
  - ปุ่ม "สร้างสัญญา" → POST /contracts

เขียน unit test ให้ครบ:
- คำนวณดอกเบี้ย flat rate ถูกต้อง
- คำนวณ early payoff ถูกต้อง
- Validate down payment >= 15%
- Validate total_months 6-12
- ลูกค้าที่มี DEFAULT → แสดง warning
```

✅ **Commit:** `git commit -m "step-10: installment contract system + calculation engine + wizard UI"`

---

### Step 11: E-Signature + E-Document

**Prompt:**

```
อ่าน SPEC Section 17 (เซ็นสัญญาออนไลน์ & E-Document)

สร้างระบบเซ็นสัญญาและจัดเก็บเอกสาร:

Backend:
1. Contract Template Management (OWNER):
   - CRUD /contract-templates
   - Template เป็น HTML with placeholders
   - Placeholders: {customer_name}, {national_id}, {product_name}, {imei},
     {selling_price}, {down_payment}, {monthly_payment}, {total_months},
     {interest_rate}, {payment_schedule_table}, {customer_signature},
     {staff_signature}, {date}, {contract_number}, {branch_name}

2. E-Signature:
   - POST /contracts/:id/sign — บันทึกลายเซ็น
     Input: signature_image (base64 PNG), signer_type (CUSTOMER/STAFF)
     เก็บ: signature image, IP address, user agent, timestamp
   
3. E-Document Generation:
   - POST /contracts/:id/generate-document — generate signed PDF
     Logic:
     - ดึง template → แทน placeholders ด้วยข้อมูลจริง
     - ฝัง signature images
     - Convert HTML → PDF (ใช้ Puppeteer)
     - คำนวณ SHA-256 hash ของ PDF
     - เก็บ PDF ใน file storage (S3/local)
     - บันทึก metadata ใน e_documents table
     - PDF ห้ามแก้ไขหลังสร้าง (immutable)
   
   - GET /contracts/:id/document — download PDF
   - POST /contracts/:id/send-document — ส่งสำเนาผ่าน LINE (implement later)

4. Receipt Generation:
   - GET /payments/:id/receipt — generate ใบเสร็จ PDF

Frontend:
1. Signature Pad Component:
   - ใช้ react-signature-canvas หรือ signature_pad library
   - Canvas ขนาดเต็มหน้าจอ (mobile-friendly)
   - ปุ่ม: Clear, Undo, Confirm
   - แสดงคำแนะนำ "กรุณาเซ็นชื่อในกรอบ"

2. เพิ่มใน Contract Wizard (Step 4 ต่อจาก Step 10):
   - หลังกด "สร้างสัญญา":
   - แสดง Preview สัญญา (HTML rendered จาก template)
   - ลูกค้าเซ็น → พนักงานเซ็น
   - ระบบ generate PDF → แสดงปุ่มดาวน์โหลด + ส่ง LINE

3. หน้าจัดการ Template สัญญา (OWNER):
   - WYSIWYG editor (ใช้ TipTap หรือ ReactQuill)
   - แสดงรายการ placeholder ที่ใช้ได้
   - Preview template กับข้อมูลตัวอย่าง

4. หน้ารวมเอกสาร:
   - ค้นหาเอกสารด้วย: เลขสัญญา, ชื่อลูกค้า, วันที่
   - ดู/ดาวน์โหลด PDF
   - แสดง hash สำหรับ verify integrity
```

✅ **Commit:** `git commit -m "step-11: e-signature + e-document + PDF generation"`

---

### Step 12: Payment Recording

**Prompt:**

```
อ่าน SPEC Section 6 (ช่องทางชำระ) และ Section 11.2-11.3 (partial/overpayment)

สร้างระบบบันทึกการชำระเงิน:

Backend:
1. POST /contracts/:id/payments — บันทึกการชำระ
   Input: installment_no (หรือ auto-detect งวดที่ค้าง), amount_paid,
          payment_method (CASH/BANK_TRANSFER/QR_EWALLET), evidence_url, notes
   
   Logic:
   - Auto-detect: หาค่างวดที่ค้างเก่าที่สุด
   - Partial payment: ถ้า amount_paid < amount_due → บันทึก partial, ยอดที่เหลือยกไปงวดถัดไป
   - Overpayment: ถ้า amount_paid > amount_due → ส่วนเกินหัก advance ของงวดถัดไป
   - Overpayment งวดสุดท้าย: flag ให้พนักงานคืนเงินส่วนเกิน
   - อัพเดทสถานะงวด: PENDING → PAID / PARTIALLY_PAID
   - ถ้าชำระครบทุกงวด → สถานะสัญญา → COMPLETED
   - บันทึก recorded_by (พนักงานที่บันทึก)
   - Generate ใบเสร็จอัตโนมัติ

2. GET /contracts/:id/payments — ประวัติการชำระทั้งหมด
3. GET /payments/daily-summary — สรุปรายการชำระประจำวัน (แยกช่องทาง, แยกสาขา)

Frontend:
1. หน้าบันทึกการชำระ:
   - ค้นหาสัญญา (เลขสัญญา / ชื่อลูกค้า / scan QR)
   - แสดงข้อมูลสัญญา + งวดที่ค้าง (highlight แดง)
   - กรอกจำนวนเงิน (default = ยอดงวดที่ค้าง)
   - เลือกช่องทาง
   - Upload หลักฐาน (สลิปโอน)
   - ปุ่มยืนยัน → แสดงใบเสร็จ

2. UX สำคัญ:
   - ต้องทำได้ภายใน 30 วินาที (ตาม SPEC Section 9.3)
   - แสดงสถานะชัดเจน: เขียว=จ่ายแล้ว, เหลือง=ใกล้ครบกำหนด, แดง=ค้าง
   - เสียง notification เมื่อบันทึกสำเร็จ

เขียน unit test:
- Partial payment คำนวณยอมยกไปถูก
- Overpayment หัก advance ถูก
- Overpayment งวดสุดท้าย flag ถูก
- สถานะ contract เปลี่ยนเป็น COMPLETED เมื่อจ่ายครบ
```

✅ **Commit:** `git commit -m "step-12: payment recording + partial/overpayment handling"`

---

### Step 13: Late Fee + Early Payoff

**Prompt:**

```
อ่าน SPEC Section 3.2, 3.4, 3.5 และ Section 11.1

สร้างระบบค่าปรับและปิดบัญชีก่อนกำหนด:

Backend:

1. Late Fee Calculation (Cron Job — รันทุกวัน เที่ยงคืน):
   - หาทุกงวดที่ due_date < วันนี้ AND status != PAID
   - คำนวณ: late_fee = MIN(days_overdue × 100, 200) ต่องวด
   - อัพเดท late_fee ในแต่ละ payment record
   - ถ้าค้าง > 7 วัน → contract status → OVERDUE + แจ้ง ผจก.
   - ถ้าค้าง 2 งวดติดต่อกัน → contract status → DEFAULT + แจ้งเจ้าของ

2. Cron endpoint (internal):
   - POST /cron/calculate-late-fees — คำนวณค่าปรับทั้งระบบ
   - POST /cron/update-contract-statuses — อัพเดทสถานะสัญญา

3. Early Payoff:
   - GET /contracts/:id/early-payoff-quote — คำนวณยอดปิดบัญชี
     Response: remaining_principal, remaining_interest, discount_50pct, total_payoff
   - POST /contracts/:id/early-payoff — ทำการปิดบัญชี
     - บันทึก payment สำหรับยอดปิด
     - contract status → EARLY_PAYOFF
     - Generate ใบปิดบัญชี

Frontend:
1. แสดงค่าปรับในหน้าสัญญา (สีแดง, แยกต่างหากจากเงินต้น)
2. ปุ่ม "ปิดบัญชีก่อนกำหนด" ในหน้ารายละเอียดสัญญา:
   - แสดง quote: เงินต้นคงเหลือ, ดอกเบี้ยที่เหลือ, ส่วนลด 50%, ยอดที่ต้องจ่าย
   - ปุ่มยืนยัน → เลือกช่องทางจ่าย → บันทึก

เขียน unit test:
- ค่าปรับวันที่ 1 = 100, วันที่ 2 = 200, วันที่ 3+ = ยังคง 200 (cap)
- หลายงวดค้าง → คิดค่าปรับแยกแต่ละงวด
- Early payoff ลดดอกเบี้ย 50% ถูกต้อง
- สถานะเปลี่ยนถูก: ACTIVE → OVERDUE → DEFAULT
```

✅ **Commit:** `git commit -m "step-13: late fee cron + early payoff + status transitions"`

---

## Phase 3-6: ส่วนที่เหลือ (Step 14-24)

### Step 14: Overdue Tracking + Call Log
```
Prompt keywords: SPEC Section 11.1, call_logs table
- หน้าติดตามหนี้ (รายชื่อ OVERDUE/DEFAULT + filter)
- บันทึก call log (วันเวลา, ผลลัพธ์, หมายเหตุ)
- Timeline view ของการติดตามแต่ละสัญญา
```

### Step 15: Device Exchange
```
Prompt keywords: SPEC Section 5.2, Section 11.4
- คำนวณยอดคงค้าง + ส่วนต่างเครื่องใหม่
- ปิดสัญญาเดิม → EXCHANGED
- สร้างสัญญาใหม่ พร้อม link
```

### Step 16: Repossession + Resell
```
Prompt keywords: SPEC Section 23
- บันทึกการยึดคืน (สภาพเครื่อง, ราคาตี, ภาพถ่าย)
- Flow: REPOSSESSED → REFURBISHED → IN_STOCK → ขายต่อ
- คำนวณกำไร/ขาดทุน
```

### Step 17: Purchase Order
```
Prompt keywords: SPEC Section 20.3
- สร้าง PO → อนุมัติ → รับสินค้า (partial/full)
- สินค้าเข้าสต็อก auto → ตรวจเช็ค (มือสอง)
- Generate PO PDF
```

### Step 18-19: Notification (LINE + SMS)
```
Prompt keywords: SPEC Section 7
- LINE Messaging API integration
- SMS provider (ThaiBulkSMS/Twilio)
- Notification queue (Redis + Bull)
- Template ข้อความ configurable
- Scheduling: เตือน 3 วัน + 1 วันก่อน, ทวง 1/3/7 วันหลัง
```

### Step 20-21: Dashboard + Reports
```
Prompt keywords: SPEC Section 10
- Dashboard: ยอดรวม, กราฟ, KPIs, top overdue
- Reports: Aging, P&L, ลูกค้าเสี่ยง, เปรียบเทียบสาขา/พนักงาน
- Export PDF (Puppeteer) + Excel (ExcelJS)
```

### Step 22: Data Migration
```
- Script import ลูกค้า + สัญญาเดิมจาก CSV/Excel
- Validation + error reporting
- Parallel run mode
```

### Step 23: Security Hardening
```
- HTTPS only
- Helmet.js headers
- CORS configuration
- Rate limiting (ทุก endpoint)
- Input sanitization
- SQL injection protection (Prisma handles this)
- Audit log ครอบคลุมทุก write operation
- Backup script (pg_dump + S3)
```

### Step 24: Deployment
```
- Dockerfile (multi-stage build)
- Docker Compose (production)
- DigitalOcean / AWS Lightsail setup
- Nginx reverse proxy + SSL (Let's Encrypt)
- GitHub Actions CI/CD
- Health check endpoint
- Monitoring (Uptime Kuma / Sentry)
```

---

## 📋 Prompt Pattern สำหรับทุก Step

เวลาส่ง prompt ให้ Claude Code ให้ใช้ pattern นี้:

```
อ่านไฟล์ SPEC-installment.md Section [X]

[อธิบายสิ่งที่ต้องทำ]

Tech constraints:
- Backend: NestJS + Prisma + PostgreSQL
- Frontend: React + Tailwind + React Query
- ใช้ existing components จาก [path]
- ใช้ existing API pattern จาก [path ไฟล์ตัวอย่าง]

สร้าง:
1. [Backend endpoints]
2. [Frontend pages]
3. [Unit tests]

อย่าแก้ไขไฟล์ที่ไม่เกี่ยวข้อง
```

---

## ⏱️ Timeline ประมาณ

| Phase | ระยะเวลา | ผลลัพธ์ |
|---|---|---|
| Phase 1: Foundation (Step 1-4) | 1-2 สัปดาห์ | โครงสร้าง + auth + สาขา |
| Phase 2: Core (Step 5-13) | 3-5 สัปดาห์ | ขายผ่อนได้จริง! |
| Phase 3: Operations (Step 14-17) | 2-3 สัปดาห์ | ทวงหนี้ + PO + ยึดคืน |
| Phase 4: Communication (Step 18-19) | 1-2 สัปดาห์ | แจ้งเตือน LINE/SMS |
| Phase 5: Intelligence (Step 20-21) | 1-2 สัปดาห์ | Dashboard + รายงาน |
| Phase 6: Polish (Step 22-24) | 1-2 สัปดาห์ | Migration + Deploy |
| **รวม** | **~10-16 สัปดาห์** | **ระบบสมบูรณ์** |

> 💡 หลัง Phase 2 (Step 13) คุณจะมีระบบที่ใช้งานจริงได้แล้ว (MVP) — สร้างสัญญา, รับชำระ, คิดค่าปรับ, ปิดบัญชี
