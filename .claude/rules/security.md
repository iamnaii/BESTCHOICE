# Security Rules

## JWT & Authentication
- Access token เก็บใน **JS variable (in-memory)** เท่านั้น
- **ห้าม** เก็บ token ใน localStorage, sessionStorage, หรือ cookie
- Refresh token อยู่ใน httpOnly cookie — browser ส่งให้อัตโนมัติ
- ใช้ token rotation เมื่อ refresh
- Reference: `apps/web/src/lib/api.ts`, `apps/web/src/contexts/AuthContext.tsx`

## Controller Guards
- ทุก controller ต้องมี `@UseGuards(JwtAuthGuard, RolesGuard)` ที่ class level
- ทุก method ต้องมี `@Roles(...)` decorator ระบุ roles ที่เข้าถึงได้
- Roles ที่ใช้: `OWNER`, `BRANCH_MANAGER`, `ACCOUNTANT`, `SALES`
- Reference: `apps/api/src/modules/auth/guards/` (JwtAuthGuard, RolesGuard)
- Global guards อยู่ที่: `apps/api/src/guards/` (CsrfGuard, UserThrottlerGuard)

## Branch scope บน route ที่มีแต่ `:id` — หน้าที่ของ service ไม่ใช่ guard

`BranchGuard` (`apps/api/src/modules/auth/guards/branch.guard.ts`) ทำงาน**เฉพาะ** request ที่มี
`branchId` ใน params/query/body — route รูป `/:id` (เช่น `GET /sales/:id`, `POST /sales/:id/void`)
ไม่มีให้ตรวจ guard จึงปล่อยผ่านเสมอ (doc ของ guard เองระบุว่า "the service layer is expected to
scope by `user.branchId`"). ⇒ mutating route ที่ BRANCH_MANAGER เข้าถึงได้ต้องบังคับขอบเขตสาขาใน
service เอง: อ่าน `branchId` ของ entity ใน tx แล้ว `ForbiddenException` เมื่อ
`role === 'BRANCH_MANAGER' && entity.branchId !== user.branchId` — BM ที่ไม่มี `branchId` ติดตัว
= **fail-closed** (เข้าเงื่อนไขเดียวกัน). ส่ง `@CurrentUser()` ทั้งก้อนเข้า service (ไม่ใช่แค่ `id`).
Precedent: `contract-exchange-cancel.service.ts`, `SaleVoidService` (`VoidSaleActor`, 2026-08-23).
Role ข้ามสาขา (`CROSS_BRANCH_ROLES` ใน `branch-access.util.ts`) ผ่านตามเดิม.

## Global Security (ห้ามปิดหรือ bypass)
- **ThrottlerGuard** — จำกัด 200 req/sec
- **CsrfGuard** — ป้องกัน CSRF สำหรับ mutating endpoints
- **AuditInterceptor** — บันทึก audit log ทุก action

## Input Validation
- ทุก DTO ต้องใช้ class-validator decorators
- **ห้ามเชื่อ client input** — validate ทุกอย่างฝั่ง server
- Error messages เป็นภาษาไทย เช่น `{ message: 'กรุณาระบุชื่อ' }`

## Intentionally Public Endpoints (ไม่มี JwtAuthGuard)
- `chatbot-finance-liff` — LINE LIFF endpoints สำหรับลูกค้าเข้าถึงผ่าน LINE (ใช้ LIFF token แทน JWT)
- `sms-webhook` — รับ SMS delivery callback จาก provider
- `paysolutions` — รับ payment webhook จาก PaySolutions gateway (verify ด้วย merchantId)
- `address` — ข้อมูล static จังหวัด/อำเภอ/ตำบล (read-only, ไม่มี sensitive data)
- `shop/public-config` — GA4/FB Pixel IDs สำหรับ web-shop (non-sensitive public IDs เท่านั้น, อ่านจาก IntegrationConfig)
- `shop-*` storefront family (`shop-catalog`, `shop-reviews` read, `shop-buyback`, `shop-installment-apply` submit/status, `shop/promotions`) — public ตาม design ของ web-shop สำหรับ anonymous shoppers; ทุกตัว guard ด้วย `ShopBotDefenseGuard` + throttle และ response ต้อง PII-redacted / display-safe fields เท่านั้น
- `receipts-public` (`GET receipts/public/:token/pdf`) — ลิงก์ดาวน์โหลด PDF ใบลดหนี้ (Credit Note) ที่ลูกค้ากดจาก LINE; token-gated (256-bit random, unguessable) + หมดอายุ 30 วัน (`Receipt.publicTokenExpiresAt`) + throttled 10/min + read-only (ไม่มี mutating action ใดๆ) — แยก controller (`receipts-public.controller.ts`) เพราะ `ReceiptsController` มี class-level `BranchGuard` ที่ require `request.user` เสมอ ไม่มีทาง bypass ผ่าน `@Public()` ต่อ route ได้
- `finance-share-public` (`GET g/:token`, `GET g/:token/files/:fileId`, `GET g/:token/zip`, `POST g/:token/reply`) — หน้าลิงก์ชุดเช็คเครดิตให้เจ้าหน้าที่ไฟแนนซ์นอก (GFIN) เปิดจากไลน์; token-gated (256-bit, ค้นด้วย sha256 hash, โทเคนดิบเก็บเข้ารหัส) + หมดอายุ 7 วัน (`ExternalFinanceApplication.shareExpiresAt`) + ยกเลิกได้ (`shareRevokedAt`) + throttled ทุก route (หน้า 60 · ไฟล์ 120 · zip 5 · reply 10 ต่อนาที) + CSP nonce + `noindex` — `POST reply` ใช้ `@SkipCsrf()` เพราะไม่มี session (โทเคนในพาธคือหลักฐานสิทธิ์) และเปลี่ยนสถานะได้เฉพาะใบที่ยังเปิด (409 เมื่อปิดแล้ว) · ไม่พบ/หมดอายุ/ยกเลิก = หน้า 410 เดียวกัน · โทเคนถูก redact จาก log/Sentry (`redactShareToken` + `sentry.ts` hooks) (spec `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md` §6, §12)

**หมายเหตุ**: ถ้าพบ controller ที่ไม่มี guard ที่ไม่อยู่ในรายการนี้ → ถือว่าเป็น security bug

## Sensitive Data
- **ห้าม commit** `.env` files
- **ห้าม log** tokens, passwords, หรือ PII (ข้อมูลส่วนบุคคล)
- ใช้ environment variables สำหรับ secrets ทั้งหมด
