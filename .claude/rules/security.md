# Security Rules

## JWT & Authentication
- Access token เก็บใน **JS variable (in-memory)** เท่านั้น
- **ห้าม** เก็บ token ใน localStorage, sessionStorage, หรือ cookie
  - **ข้อยกเว้นเดียว (ก้อน 10 ลงเวลา 2026-10-27):** device token ของ**เครื่องตอกบัตรประจำสาขา** เก็บใน localStorage ของเครื่องนั้น (`bc.kiosk.device`) — ไม่ใช่ JWT ของผู้ใช้ หมุนทุกครั้งที่งานสำเร็จ (รุ่นที่ใช้แล้วใช้ซ้ำ = ล็อก) ให้สิทธิ์เฉพาะ `POST kiosk/punch|heartbeat` และยกเลิก/ล็อกจากเซิร์ฟเวอร์ได้ (spec `docs/superpowers/specs/2026-10-27-attendance-kiosk-design.md` §4.3)
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
- `chatbot-finance-liff` + `line-oa/liff/*` — LINE LIFF endpoints สำหรับลูกค้าเข้าถึงผ่าน LINE (ใช้ LIFF token แทน JWT) · LIFF token พิสูจน์แค่ว่า "เป็น LINE user คนนี้" ไม่ได้พิสูจน์ว่าเป็นลูกค้าคนไหน ⇒ **การผูก LINE กับลูกค้า (`customers.line_id_finance` / `customer_line_links`) ต้องผ่าน OTP ทาง SMS ไปเบอร์ของลูกค้าเท่านั้น** (`POST chatbot/finance/liff/request-otp` → `verify-otp` → `VerificationService.linkVerifiedLine` — ทางเดียว ทำผลข้างเคียงครบ: ดูดห้องผู้สนใจ · link row · journey · rich menu) · `POST line-oa/liff/register/lookup|confirm` (เดิมผูกด้วยเบอร์อย่างเดียว · lookup คืน `customerId` ของเจ้าของเบอร์) **ตอบ 410 ถาวร** และหน้า `/liff/register` พาไป `/liff/finance-verify` (Task 19, 2026-10-30) · endpoint ใหม่ที่เขียน `line_id_finance`/`customer_line_links` หรือคืน `customerId`/ชื่อของเจ้าของเบอร์ให้ผู้ที่ยังไม่ผ่าน OTP = security bug · กติกา OA ร้าน / redirect / เพดาน OTP / โหมดทดสอบ และ**ข้อยกเว้นที่ยังเหลือ** (login CSRF I-A, ทางพนักงาน I3, ไม่มีปุ่มยกเลิกผูก I4, quick reply ฝั่งร้าน I-C) อยู่หัวข้อ "LINE — ตัวตนลูกค้า · OTP · redirect" ด้านล่าง
- `sms-webhook` — รับ SMS delivery callback จาก provider
- `paysolutions` — รับ payment webhook จาก PaySolutions gateway (verify ด้วย merchantId)
- `address` — ข้อมูล static จังหวัด/อำเภอ/ตำบล (read-only, ไม่มี sensitive data)
- `shop/public-config` — GA4/FB Pixel IDs สำหรับ web-shop (non-sensitive public IDs เท่านั้น, อ่านจาก IntegrationConfig)
- `shop-*` storefront family (`shop-catalog`, `shop-reviews` read, `shop-buyback`, `shop-installment-apply` submit/status, `shop/promotions`) — public ตาม design ของ web-shop สำหรับ anonymous shoppers; ทุกตัว guard ด้วย `ShopBotDefenseGuard` + throttle และ response ต้อง PII-redacted / display-safe fields เท่านั้น
- `receipts-public` (`GET receipts/public/:token/pdf`) — ลิงก์ดาวน์โหลด PDF ใบลดหนี้ (Credit Note) ที่ลูกค้ากดจาก LINE; token-gated (256-bit random, unguessable) + หมดอายุ 30 วัน (`Receipt.publicTokenExpiresAt`) + throttled 10/min + read-only (ไม่มี mutating action ใดๆ) — แยก controller (`receipts-public.controller.ts`) เพราะ `ReceiptsController` มี class-level `BranchGuard` ที่ require `request.user` เสมอ ไม่มีทาง bypass ผ่าน `@Public()` ต่อ route ได้
- `sales-receipt-public` (`GET sales/receipt/public/:token/pdf`) — ลิงก์ใบเสร็จรับเงินขายสด (CASH/EXTERNAL_FINANCE) ที่ลูกค้าเปิดจาก LINE / QR บนกระดาษ / ลิงก์ที่พนักงานคัดลอกส่ง (ก้อน 4 · 2026-10-23); token-gated (256-bit random base64url บน `Sale.receiptToken`) + หมดอายุ 30 วัน (`Sale.receiptTokenExpiresAt` — ต่ออายุทุกครั้งที่ออกเอกสาร/แชร์ ไม่หมุน token) + ใบยกเลิก = ไม่พบ + throttled 10/min + read-only + ไม่ log token — แยก controller (`sales-receipt-public.controller.ts`) เพราะ `SalesController` มี `JwtAuthGuard`/`RolesGuard`/`BranchGuard` ระดับ class · ไม่รู้จัก/หมดอายุ/ยกเลิก ตอบ 404 ข้อความเดียวกัน
- `finance-share-public` (`GET g/:token`, `GET g/:token/files/:fileId`, `GET g/:token/zip`, `POST g/:token/reply`) — หน้าลิงก์ชุดเช็คเครดิตให้เจ้าหน้าที่ไฟแนนซ์นอก (GFIN) เปิดจากไลน์; token-gated (256-bit, ค้นด้วย sha256 hash, โทเคนดิบเก็บเข้ารหัส) + หมดอายุ 7 วัน (`ExternalFinanceApplication.shareExpiresAt`) + ยกเลิกได้ (`shareRevokedAt`) + throttled ทุก route (หน้า 60 · ไฟล์ 120 · zip 5 · reply 10 ต่อนาที) + CSP nonce + `noindex` — `POST reply` ใช้ `@SkipCsrf()` เพราะไม่มี session (โทเคนในพาธคือหลักฐานสิทธิ์) และเปลี่ยนสถานะได้เฉพาะใบที่ยังเปิด (409 เมื่อปิดแล้ว) · ไม่พบ/หมดอายุ/ยกเลิก = หน้า 410 เดียวกัน · โทเคนถูก redact จาก log/Sentry (`redactShareToken` + `sentry.ts` hooks) (spec `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md` §6, §12)
- `webhooks/line-staff` (`POST`) — webhook ของไลน์พนักงาน (Staff OA, ก้อน 7 A16) ใช้ผูกบัญชีพนักงานด้วยรหัส 6 หลัก; ตรวจลายเซ็น `X-Line-Signature` ด้วย channelSecret ใน `LineStaffWebhookGuard` (ปฏิเสธเมื่อไม่มี secret บน prod) + `@SkipCsrf()` เพราะ LINE ไม่ส่ง `X-Requested-With` · ไม่มี session · ตอบ 200 เสมอ · ไม่ log เนื้อหาข้อความ
- `kiosk` (`POST kiosk/register`, `POST kiosk/heartbeat`, `POST kiosk/punch`) — เครื่องตอกบัตรประจำสาขา (ลงเวลา ก้อน 10): ตัวตน = device token ที่หมุนเมื่องานสำเร็จ (ใน tx เดียวกับงาน) + `requestId` (ส่งซ้ำได้คำตอบเดิม · คำตอบที่จำไว้ไม่มี token ดิบ) ลงทะเบียนครั้งเดียวด้วยรหัส 8 ตัวอายุ 10 นาที · token รุ่นเก่าถูกใช้ซ้ำ = เครื่องถูกล็อกทันที + ติดธงรายการย้อนหลัง · รหัสตอกบัตร 6 หลักผิด 5 ครั้ง = เครื่องพักรับรหัส 15 นาที · error ตอบผ่าน `KioskExceptionFilter` ของ controller (`{statusCode, code, message}` · 5xx ข้อความกลาง + Sentry) · `@SkipCsrf()` (ไม่มี session) · throttle 30/นาที/IP · พิกัดตรวจช่วง lat/lng · รูปพนักงาน ≤ 300 KB เก็บ storage ดูได้เฉพาะ OWNER/BM สาขาตัวเอง (spec `2026-10-27-attendance-kiosk-design.md` §4, §8)

**หมายเหตุ**: ถ้าพบ controller ที่ไม่มี guard ที่ไม่อยู่ในรายการนี้ → ถือว่าเป็น security bug

## LINE — ตัวตนลูกค้า · OTP · redirect (Task 20, 2026-10-31)

**OTP ทาง SMS คือหลักฐานตัวตนเดียวของลูกค้าฝั่ง LINE** — LIFF token / LINE webhook บอกแค่ "เป็น LINE user คนนี้"
ไม่ได้บอกว่าเป็นลูกค้าคนไหน. กติกาด้านล่างบังคับในโค้ดแล้ว เขียน endpoint/บอทใหม่ต้องทำตาม:

1. **OA ร้าน (SHOP) ตอบชื่อเต็ม/สัญญา/ยอด/งวด/ใบเสร็จ/QR ชำระ/รับสลิป/สาขาของสัญญา/บริบท AI เฉพาะ LINE ที่ยืนยัน OTP แล้ว** —
   ตัวตน = แถว `customer_line_links` ช่อง `FINANCE` ที่ยังผูก (`unlinkedAt`/`deletedAt` = null) ผ่าน
   `findOtpVerifiedCustomerId` (`line-oa/services/otp-verified-customer.ts`) · **ห้ามใช้ `customers.line_id_shop` เป็นหลักฐานตัวตน**
   (เคยผูกได้ด้วยการพิมพ์เบอร์ + พนักงานพิมพ์เองได้) · ยังไม่ยืนยัน = `buildShopVerifyPrompt()` ข้อความเดียว (ลิงก์ LINE Login →
   `/liff/finance-verify`) ไม่มีชื่อ ไม่บอกว่าเบอร์มีในระบบ · **พิมพ์เบอร์ในแชทไม่ผูกอะไร** (`selfLinkByPhone` ถูกถอด) ·
   สมมติฐาน: OA ร้าน / OA การเงิน / LIFF channel อยู่ LINE provider เดียวกัน (userId เดียวกัน) — ถ้าไม่ใช่ ไม่มีใครผ่าน (fail closed) ⇒
   **ตรวจใน LINE Developers Console ก่อนเชื่อม OA ร้านกับ prod**
2. **LINE Login callback redirect เฉพาะหน้า `/liff/*` และ `/pay/*` บนโดเมนเว็บ** — `returnPath` (ใน `state` ที่ไม่ลงนาม) ผ่าน
   `sanitizeReturnPath` (ต้องขึ้นต้น `/` ตัวเดียว · ห้าม `//`, `/\`, `\`, อักขระควบคุม/ช่องว่าง · ตัดสินบน path ที่ normalize dot-segment แล้ว —
   `/..//evil` = `//evil` ไม่ผ่าน · allowlist `^/(liff|pay)(/|$)`) แล้ว `buildFrontendReturnUrl` = `new URL(path, FRONTEND_URL ค่าแรก)` +
   ยืนยัน `origin` ตรง · ไม่ผ่าน = `/liff/contract` (`utils/line-login.util.ts`) · ทั้งทางสำเร็จ (`#id_token=`) และทาง `login_error`
   (FRONTEND_URL ใช้ไม่ได้ = 500 ข้อความกลาง ไม่ throw) · **ห้ามต่อสตริง `${FRONTEND_URL}${path}` เพื่อ redirect อีก**
   (`'https://web' + '@evil/'` = host `evil`) · **ไม่ได้กัน login CSRF** — ดูข้อยกเว้นข้างล่าง
3. **OTP (`VerificationService`)**: 3 ครั้งต่อรหัส (ช่วงละ 5 นาที) กินแบบ atomic ก่อนเทียบรหัส (`updateManyAndReturn` … `WHERE attempts < 3
   AND expires_at > now`) · ขอรหัสใหม่ในช่วงเดิม **ไม่รีเซ็ต** attempts · ผิดครบแล้วล็อกจนหมดช่วง (แถวไม่ถูกลบ) ·
   **cooldown 60 วิ/LINE แบบ atomic**: อ่านแถว→ตรวจ→เพดาน→เขียนแถว อยู่ในทรานแซกชันที่เริ่มด้วย
   `pg_advisory_xact_lock(hashtext('otp-request:'||lineUserId))` (ยิงขนานจาก LINE เดียวผ่านได้คำขอเดียว) · ส่ง SMS หลัง commit ·
   **เพดานต่อวันไทย** (แถวนับใน `chatbot_otp_requests` คีย์ `otp-quota:…`): ต่อ LINE ข้ามทุกเบอร์ (นับทั้งจริงและ decoy) **5** · ต่อ (ลูกค้า, LINE) **2**
   (กินก่อน) · ต่อลูกค้ารวมทุก LINE **8** ⇒ เดาได้ ≤ 24 ครั้ง/ลูกค้า/วัน · LINE ผู้โจมตี 3 บัญชีเผาได้ 6 เจ้าของเบอร์ยังได้รหัส (ต้อง ≥ 4 บัญชีถึงล็อกได้ทั้งวัน) ·
   ส่ง SMS ไม่สำเร็จ = log + Sentry + ทิ้งรหัส + ปลด cooldown + คืนโควตาลูกค้า/(ลูกค้า, LINE) · `requestOtp` **ตอบเหมือนกันทุกไบต์** ทั้งเบอร์ที่พบ/ไม่พบ/
   ถึงเพดาน (แถว decoy `customer_id = ''` ไม่มีรหัสที่ใช้ได้ · ไม่ส่ง SMS) และ **ไม่ await SMS + รอเวลาตอบขั้นต่ำ 1 วิ ทุกทางที่สำเร็จ** (timing) ·
   หน้า OTP บอก "ไม่ได้รับ SMS ภายใน 2 นาที? … โทรหาสาขา" (คำตอบเหมือนส่งแล้วเสมอ) · lock ในหน่วยความจำนับเฉพาะเบอร์ผิดรูปแบบ (นับ "ไม่พบ" = oracle)
4. **`TEST_MODE_BYPASS` มีผลบน `NODE_ENV=production` เฉพาะเมื่อตั้ง env `ALLOW_TEST_MODE_BYPASS=YES_I_AM_SURE`** — ไม่ตั้ง = flag ถูกเมิน
   (log + Sentry warning ทุก 10 นาที) และ `PUT settings/test-mode` เปิดไม่ได้ (400 ไทย) · dev/UAT (non-production) ทำงานเหมือนเดิม

**ข้อยกเว้นที่ยังเหลือ (รู้ตัว — ยังไม่ได้ปิด อย่าอ่านกติกาข้างบนว่า "ปิดหมดแล้ว"):**
- **I3 — พนักงานเขียน `line_id_finance` ได้โดยไม่มี OTP** และหน้า LIFF การเงินอนุญาตด้วยคอลัมน์นี้ (`liff-api.service.ts` `findCustomerByLineId`):
  ฟอร์มลูกค้า `CreateCustomerDto`/`UpdateCustomerDto.lineIdFinance` · skip-tracing `newLineId` · นำเข้า CSV (`migration.service.ts`) ⇒
  social engineering ในแชท ("ผูกไลน์ให้หน่อย") → พนักงานคัด U-id ใส่ลูกค้า → ผู้ขออ่านสัญญาคนนั้นได้
- **I4 — ไม่มีปุ่มพนักงาน "ยกเลิกผูก LINE การเงิน"** — ลูกค้าที่ยังผูก LINE เครื่องเก่าได้ 409 ตอนยืนยัน OTP (`CUSTOMER_LINKED_TO_OTHER_LINE_MESSAGE`)
  และสาขาไม่มีทางช่วยนอกจากแก้ DB
- **OA ร้าน — ต้องตัดสินก่อนเชื่อมกับ prod**: LIFF ประกัน/หลังการขาย (`liff-warranty.service.ts`, `liff-after-sales.service.ts`) และข้อความ push
  ฝั่งร้าน (ใบเสร็จขายสด, ประกัน, ออเดอร์ออนไลน์, PaySolutions, หลังการขาย, แคมเปญ) ยังอ่าน `line_id_shop` · ลูกค้าเขียนคอลัมน์นี้เองไม่ได้แล้ว
  (เหลือพนักงาน + บอทขายตอนสร้างลูกค้าใหม่จากแชท) ⇒ หน้า "ประกันของฉัน" ที่บอกให้ "พิมพ์เบอร์ในแชท" จะวนไม่จบจนกว่าจะเลือก (ก) ให้หน้าเหล่านี้อ่าน
  ตัวตนจากแถว OTP หรือ (ข) ให้ OTP เขียน `line_id_shop` ด้วย · ค่า `line_id_shop` ที่ผูกด้วยเบอร์ไปก่อนหน้านี้ (ถ้ามี) ยังอยู่ — ตรวจ/ล้างก่อนเชื่อม
- **I-A Login CSRF — ยังเปิด (Important สูง · ต้องปิดก่อนเปิด LIFF ให้ลูกค้า · งานแยก)** มีสองทาง: (1) `state` ของ LINE Login ไม่ลงนามและไม่ผูก session ⇒
  ผู้โจมตีส่งลิงก์ callback (โดเมน API จริง) ที่มี `code` ของ LINE ตัวเอง — หน้าเว็บของผู้โจมตีขอ `code` ใหม่ได้ทุกครั้งที่เหยื่อกด จึง**ไม่มีกรอบเวลาจำกัด**
  (2) **ไม่ผ่าน API เลย**: `useLiffInit.ts` เชื่อ `?line_login=true&line_user_id=…&line_display_name=…#id_token=…` จาก URL ตรง ๆ ⇒ ส่งลิงก์หน้าเว็บที่ฝัง id_token
  ของผู้โจมตี (ปลอมชื่อ/รูปบนการ์ดได้ด้วย) · ทั้งสองทางพาเหยื่อเข้าหน้า OTP ในนาม LINE ผู้โจมตี → เหยื่อกรอกเบอร์+OTP ของตัวเอง = ผูก LINE ผู้โจมตีกับลูกค้าเหยื่อ
  (และเหยื่อผูกเองไม่ได้ — 409 + ไม่มีปุ่มพนักงาน I4) · **nonce/cookie ฝั่ง API อย่างเดียวปิดได้แค่ทาง (1)** — ทางแก้ที่ถูกคือ **OIDC `nonce` ฝั่งหน้าเว็บ**:
  `redirectToLineLogin` สุ่ม nonce เก็บ `sessionStorage` แล้วส่งไป `authorize` → ส่งต่อให้ LINE (ฝังใน claim ของ id_token) → หน้าเว็บรับ id_token เฉพาะเมื่อ
  `payload.nonce` ตรงค่าใน `sessionStorage` (ลบทันที) และเอา `sub`/`name`/`picture` จาก payload แทน query · cookie `__Host-` `SameSite=Lax` host-only บน API
  เป็นชั้นเสริม · HMAC state อย่างเดียวไม่ช่วย · ต้องทดสอบบน LINE iOS/Android + Safari/Chrome ก่อนเปิด · เสริมการตรวจจับ: SMS แจ้งเบอร์ลูกค้าหลังผูก LINE สำเร็จ
- **I-C — OA ร้าน: ปุ่ม quick reply (postback `TEMPLATE:`) เติมตัวแปรลูกค้า** (`{customerName}` `{contractNumber}` `{amountDue}` …) จาก `chat_rooms.customer_id`
  (`canned-response-variable.service.ts`) ซึ่งบอทขาย (`capture_lead` `LINKED_BY_PHONE`) ผูกห้องได้ด้วยเบอร์อย่างเดียว — ไม่ผ่าน `findOtpVerifiedCustomerId` ⇒
  ก่อนเปิดบอทขายบน OA ร้าน (และตรวจ Facebook ที่อาจเปิดอยู่): เติมตัวแปรลูกค้าเฉพาะห้อง LINE ที่ `findOtpVerifiedCustomerId(room.lineUserId) === room.customerId`
- เวลาตอบ `requestOtp`: SMS ไม่ถูก await และทุกทางที่สำเร็จรอขั้นต่ำ 1 วิ — ส่วนต่างที่เหลือคือ query เพดานของเบอร์จริง (ระดับมิลลิวินาที อยู่ใต้ขั้นต่ำ) ·
  ถ้า provider ช้าเกิน 1 วิ SMS ยังส่งต่อหลังตอบ (Cloud Run ลด CPU หลังตอบ — อาจช้าลง ไม่หาย)

## Sensitive Data
- **ห้าม commit** `.env` files
- **ห้าม log** tokens, passwords, หรือ PII (ข้อมูลส่วนบุคคล)
- ใช้ environment variables สำหรับ secrets ทั้งหมด
