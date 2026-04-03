# Prompt: E2E Testing ทั้งระบบ BESTCHOICE

> ใช้ prompt นี้สั่ง AI ให้เขียน/รัน E2E tests ครอบคลุมทุกหน้า ทุก role

---

```
คุณคือ QA Engineer สำหรับระบบผ่อนชำระ BESTCHOICE (NestJS + React + Prisma + PostgreSQL)

## Tech Stack
- Frontend: React 18 + TypeScript + Vite 6 + Tailwind CSS (apps/web)
- Backend: NestJS + Prisma + PostgreSQL (apps/api)
- E2E: Playwright (apps/web/e2e/)
- Test Account: admin@bestchoice.com / admin1234

## E2E Tests ที่มีอยู่แล้ว (8 ไฟล์, 46 tests)
- login.spec.ts (8) — login, redirect, sidebar
- dashboard.spec.ts (7) — KPI, quick actions, navigation
- customers.spec.ts (6) — CRUD, search, filter
- contracts.spec.ts (7) — wizard, upload, status badges
- payments.spec.ts (6) — tabs, recording, filter
- overdue.spec.ts (6) — dunning stages, follow-up
- installment-calculation.spec.ts (6) — financial accuracy
- invite-resend.spec.ts (6) — invite lifecycle

## Test Helpers ที่ใช้ได้
- e2e/helpers/auth.ts: loginAsAdmin(page), loginViaAPI(page), getToken(page), getAuthHeaders()
- e2e/helpers/test-data.ts: TEST_CUSTOMER, TEST_CONTRACT, TEST_PAYMENT
- global-setup.ts: cached token ใน .playwright-auth.json

## หน้าที่ยังไม่มี E2E test (ต้องเขียนเพิ่ม)

### กลุ่ม ขาย (ทุก role เข้าถึงได้)
- [ ] POS ขายสินค้า /pos — scan product, add to cart, checkout, print receipt
- [ ] ประวัติการขาย /sales — list, filter by date/branch, view detail
- [ ] ตรวจเครดิต /credit-checks — AI credit check, manual override, history

### กลุ่ม สัญญา
- [ ] สร้างสัญญา /contracts/create — full wizard (เลือกสินค้า → เลือกลูกค้า → กำหนดงวด → อัปโหลดเอกสาร → เซ็นสัญญา)
- [ ] รายละเอียดสัญญา /contracts/:id — view, status change, payment history
- [ ] เซ็นสัญญา /contracts/:id/sign — e-signature flow
- [ ] สถานะเอกสาร /document-dashboard — document tracking (OWNER, BRANCH_MANAGER)

### กลุ่ม ติดตามหนี้
- [ ] เปลี่ยนเครื่อง /exchange — exchange workflow (OWNER, BRANCH_MANAGER)
- [ ] ยึดคืน & ขายต่อ /repossessions — repossession + resell (OWNER, BRANCH_MANAGER)

### กลุ่ม การเงิน (OWNER, BRANCH_MANAGER, ACCOUNTANT)
- [ ] ใบเสร็จรับเงิน /receipts — list, search, verify, print
- [ ] ตรวจสอบสลิป /slip-review — review pending slips, approve/reject
- [ ] นำเข้าชำระเงิน (CSV) /payments/import-csv — upload CSV, validation, import
- [ ] เงินรับจากไฟแนนซ์ /finance-receivable — record finance receivable
- [ ] บันทึกรายจ่าย /expenses — create/list expenses
- [ ] งบกำไรขาดทุน /profit-loss — P&L report, date range filter

### กลุ่ม คลังสินค้า
- [ ] คลังสินค้า /stock — product list, tabs, search, filter by status
- [ ] โอนสาขา /stock/transfers — create transfer, approve, receive
- [ ] ปรับสต็อก /stock/adjustments — adjustment reasons, submit
- [ ] ตรวจนับสต็อก /stock/count — start count, submit differences
- [ ] แจ้งเตือนสต็อก /stock/alerts — low stock alerts
- [ ] ขั้นตอนสต็อก /stock/workflow — workflow pipeline
- [ ] ตรวจสอบสินค้า /inspections — create inspection, 6-angle photos, complete

### กลุ่ม จัดซื้อ
- [ ] สั่งซื้อ /purchase-orders — create PO, approve, receive goods
- [ ] ผู้ขาย /suppliers — CRUD, contact info, PO history

### กลุ่ม รายงาน
- [ ] รายงาน /reports — financial reports, export PDF/Excel
- [ ] แจ้งเตือน /notifications — notification list, mark read

### กลุ่ม ตั้งค่า (OWNER)
- [ ] สาขา /branches — CRUD branches
- [ ] จัดการผู้ใช้ /users — CRUD users, invite, deactivate
- [ ] ตั้งค่าระบบ /settings — general settings
- [ ] ราคาตั้งต้น /settings/pricing-templates — pricing templates
- [ ] เทมเพลตสัญญา /contract-templates — contract template editor
- [ ] PDPA /pdpa — consent management (OWNER, BRANCH_MANAGER)
- [ ] Audit Logs /audit-logs — search, filter, detail view
- [ ] Financial Audit /financial-audit — audit reports (OWNER, ACCOUNTANT)
- [ ] สถานะระบบ /system-status — system health check
- [ ] นำเข้าข้อมูล /migration — data import tool

### Public Pages (ไม่ต้อง login)
- [ ] Landing Page /landing
- [ ] Forgot Password /forgot-password — send reset email
- [ ] Reset Password /reset-password — reset form
- [ ] Contract Verify /verify/:id — public contract verification
- [ ] Receipt Verify /verify/:receiptNumber
- [ ] Customer Portal /customer-access/:token

### LIFF Pages (LINE In-App Browser)
- [ ] LIFF Contract /liff/contract
- [ ] LIFF Payment /pay/:token
- [ ] LIFF History /liff/history
- [ ] LIFF Profile /liff/profile
- [ ] LIFF Register /liff/register
- [ ] LIFF Early Payoff /liff/early-payoff

## กฎการเขียน E2E Test

1. ไฟล์ใหม่วางที่ apps/web/e2e/<feature>.spec.ts
2. ใช้ loginViaAPI(page) สำหรับ fast auth (ไม่ใช่ loginAsAdmin ยกเว้น test login flow)
3. ใช้ Thai text matching เพราะ UI เป็นภาษาไทย
4. Handle empty state gracefully — ถ้าไม่มีข้อมูลให้ test ว่าแสดง empty state ถูกต้อง
5. ใช้ unique test data (timestamp suffix) เพื่อ isolation
6. ทุก test ต้อง cleanup ข้อมูลที่สร้าง (หรือใช้ soft delete)
7. Timeout: navigation 20s, action 15s
8. Screenshot on failure, video on retry

## Role-Based Testing
ทดสอบว่าแต่ละ role เห็นเมนูที่ถูกต้อง:
- SALES: ขาย + สัญญา(บางส่วน) + คลัง(ดูอย่างเดียว)
- ACCOUNTANT: การเงิน + รายงาน + คลัง(ดูอย่างเดียว) + Financial Audit
- BRANCH_MANAGER: ทุกอย่างยกเว้น ตั้งค่าระบบ/จัดการผู้ใช้/สาขา
- OWNER: ทุกอย่าง

## คำสั่ง
เขียน E2E tests ให้ครบทุกหน้าที่ยังไม่มี test โดย:
1. จัดกลุ่มตาม feature (1 spec file ต่อ 1 กลุ่ม)
2. ทุก test ต้อง assert ว่าหน้า load สำเร็จ (heading/title visible)
3. ทุก form ต้อง test: validation, submit success, error handling
4. ทุก list ต้อง test: search, filter, pagination, empty state
5. ทดสอบ role-based access — SALES ไม่ควรเข้าหน้า /settings ได้
6. รัน ./tools/check-types.sh web ก่อน commit
```
