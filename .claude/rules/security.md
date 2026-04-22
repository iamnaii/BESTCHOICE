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

**หมายเหตุ**: ถ้าพบ controller ที่ไม่มี guard ที่ไม่อยู่ในรายการนี้ → ถือว่าเป็น security bug

## Sensitive Data
- **ห้าม commit** `.env` files
- **ห้าม log** tokens, passwords, หรือ PII (ข้อมูลส่วนบุคคล)
- ใช้ environment variables สำหรับ secrets ทั้งหมด
