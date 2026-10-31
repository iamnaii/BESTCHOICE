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
- `chatbot-finance-liff` + `line-oa/liff/*` — LINE LIFF endpoints สำหรับลูกค้าเข้าถึงผ่าน LINE (ใช้ LIFF token แทน JWT) · LIFF token พิสูจน์แค่ว่า "เป็น LINE user คนนี้" ไม่ได้พิสูจน์ว่าเป็นลูกค้าคนไหน ⇒ **การผูก LINE กับลูกค้า (`customers.line_id_finance` / `customer_line_links`) ต้องผ่าน OTP ทาง SMS ไปเบอร์ของลูกค้าเท่านั้น** (`POST chatbot/finance/liff/request-otp` → `verify-otp` → `VerificationService.linkVerifiedLine` — ทางเดียว ทำผลข้างเคียงครบ: ดูดห้องผู้สนใจ · link row · journey · rich menu) · หน้า LIFF การเงิน/ลิงก์ชำระหาลูกค้าจาก**แถว OTP ที่ยังผูก**เท่านั้น — คอลัมน์ `line_id_finance` ไม่ให้สิทธิ์ (กติกาข้อ 9 ของหัวข้อ LINE) · `POST line-oa/liff/register/lookup|confirm` (เดิมผูกด้วยเบอร์อย่างเดียว · lookup คืน `customerId` ของเจ้าของเบอร์) **ตอบ 410 ถาวร** และหน้า `/liff/register` พาไป `/liff/finance-verify` (Task 19, 2026-10-30) · endpoint ใหม่ที่เขียน `line_id_finance`/`customer_line_links` หรือคืน `customerId`/ชื่อของเจ้าของเบอร์ให้ผู้ที่ยังไม่ผ่าน OTP = security bug · กติกา OA ร้าน / redirect / LINE Login nonce / เพดาน OTP / โหมดทดสอบ และ**ข้อยกเว้นที่ยังเหลือ** (ทดสอบเครื่องจริงของ I-A · ค่า `line_id_finance` ค้างที่ยังแสดงบนหน้าจอพนักงาน · push ฝั่งร้านที่ยังอ่าน `line_id_shop`) อยู่หัวข้อ "LINE — ตัวตนลูกค้า · OTP · redirect" ด้านล่าง
- `line-oa/liff/contracts/:contractId/document` + `line-oa/liff/receipts/:receiptId/download` (`GET` · `LiffDownloadController`) — **ไม่มี `LiffTokenGuard`** (เปิดเป็นแท็บใหม่ แนบ header ไม่ได้) · หลักฐานเดียวคือตั๋วครั้งเดียว `?dl=` ที่ออกโดย `POST line-oa/liff/download-ticket` (ผ่าน `LiffTokenGuard` ทาง header) — 256 บิต · เก็บเฉพาะ sha256 · อายุ 60 วิ · ผูก (LINE, ชนิด, id เอกสาร) · ใช้แล้วเผา · ตรวจเจ้าของซ้ำด้วย LINE ของตั๋ว · throttle 30/นาที (Task 22 M-3 · กติกาข้อ 7 ของหัวข้อ LINE ด้านล่าง) · ใน access manifest จัดเป็น `"classification":"public"` (fix round 1 M-4 — แบบเดียวกับเส้นที่ใช้ token ในลิงก์อื่น · ไม่มี guard ตัวตน)
- `line-oa/line-login` (`GET authorize`, `GET callback`, `POST verify`) — LINE Login สำหรับหน้า LIFF ที่เปิดนอก LIFF (เบราว์เซอร์ / in-app browser) · `@SkipCsrf()` (ไม่มี session) · `verify` throttle 20/นาที/IP ยืนยัน id_token กับ LINE + nonce ของแท็บ แล้วคืนตัวตนจาก token เท่านั้น (ไม่เขียนอะไร) — กติกาข้อ 3 ของหัวข้อ LINE ด้านล่าง
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

## LINE — ตัวตนลูกค้า · OTP · redirect (Task 20 + 21 + 22, 2026-10-31)

**OTP ทาง SMS คือหลักฐานตัวตนเดียวของลูกค้าฝั่ง LINE** — LIFF token / LINE webhook บอกแค่ "เป็น LINE user คนนี้"
ไม่ได้บอกว่าเป็นลูกค้าคนไหน. กติกาด้านล่างบังคับในโค้ดแล้ว เขียน endpoint/บอทใหม่ต้องทำตาม:

1. **OA ร้าน (SHOP) ตอบชื่อเต็ม/สัญญา/ยอด/งวด/ใบเสร็จ/QR ชำระ/รับสลิป/สาขาของสัญญา/บริบท AI เฉพาะ LINE ที่ยืนยัน OTP แล้ว** —
   ตัวตน = แถว `customer_line_links` ช่อง `FINANCE` ที่ยังผูก (`unlinkedAt`/`deletedAt` = null) ผ่าน
   `findOtpVerifiedCustomerId` (`line-oa/services/otp-verified-customer.ts`) · **ห้ามใช้ `customers.line_id_shop` เป็นหลักฐานตัวตน**
   (เคยผูกได้ด้วยการพิมพ์เบอร์ + พนักงานพิมพ์เองได้) · ยังไม่ยืนยัน = `buildShopVerifyPrompt()` ข้อความเดียว (ลิงก์ LINE Login →
   `/liff/finance-verify`) ไม่มีชื่อ ไม่บอกว่าเบอร์มีในระบบ · **พิมพ์เบอร์ในแชทไม่ผูกอะไร** (`selfLinkByPhone` ถูกถอด) ·
   สมมติฐาน: OA ร้าน / OA การเงิน / LIFF channel อยู่ LINE provider เดียวกัน (userId เดียวกัน) — ถ้าไม่ใช่ ไม่มีใครผ่าน (fail closed) ⇒
   **ตรวจใน LINE Developers Console ก่อนเชื่อม OA ร้านกับ prod** ·
   หน้า LIFF ฝั่งร้าน ("ประกันของฉัน" `liff-warranty.service.ts` · เคสหลังการขาย `liff-after-sales.service.ts`) หาลูกค้าด้วย `findShopLiffCustomerId`
   (Task 22 ทางเลือก ก): แถว OTP ของ LINE เดียวกันก่อน (ลูกค้าเงินสดยืนยันได้ — OTP ค้นจากเบอร์ ไม่ดูว่ามีสัญญา) · `line_id_shop` เป็นทางสำรอง**เฉพาะแถวที่
   `updated_at` ก่อน `LEGACY_SHOP_LINE_ID_CUTOFF` (2026-10-31 00:00 เวลาไทย)** — ค่าที่พนักงาน/บอทขายเขียนหลังจากนั้นไม่นับ · ไม่ใช้ทางเลือก ข
   (ให้ OTP เขียน `line_id_shop` ด้วย) เพราะคอลัมน์นั้นยังมีผู้เขียนที่ไม่ผ่าน OTP · หน้าที่ยังไม่ยืนยันบอก "พิมพ์ ลงทะเบียน ในแชท" (บอทร้านตอบลิงก์ยืนยัน)
2. **LINE Login callback redirect เฉพาะหน้า `/liff/*` และ `/pay/*` บนโดเมนเว็บ** — `returnPath` (ใน `state` ที่ไม่ลงนาม) ผ่าน
   `sanitizeReturnPath` (ต้องขึ้นต้น `/` ตัวเดียว · ห้าม `//`, `/\`, `\`, อักขระควบคุม/ช่องว่าง · ตัดสินบน path ที่ normalize dot-segment แล้ว —
   `/..//evil` = `//evil` ไม่ผ่าน · allowlist `^/(liff|pay)(/|$)`) แล้ว `buildFrontendReturnUrl` = `new URL(path, FRONTEND_URL ค่าแรก)` +
   ยืนยัน `origin` ตรง · ไม่ผ่าน = `/liff/contract` (`utils/line-login.util.ts`) · ทั้งทางสำเร็จ (`#id_token=`) และทาง `login_error`
   (FRONTEND_URL ใช้ไม่ได้ = 500 ข้อความกลาง ไม่ throw) · **ห้ามต่อสตริง `${FRONTEND_URL}${path}` เพื่อ redirect อีก**
   (`'https://web' + '@evil/'` = host `evil`) · redirect ปลอดภัยอย่างเดียว**ไม่กัน login CSRF** — ข้อ 3 กัน
3. **LINE Login ผูก id_token กับแท็บที่เริ่มล็อกอินด้วย OIDC `nonce`** (Task 21 I-A — ปิด login CSRF / identity injection ทั้งสองทาง):
   `useLiffInit.redirectToLineLogin` สุ่ม nonce 32 ไบต์ (base64url) เก็บ `sessionStorage` (`bc_ll_nonce`) แล้วส่ง `authorize?nonce=` →
   API ส่งต่อให้ LINE (รูปแบบ `LINE_LOGIN_NONCE_PATTERN` ไม่ตรง = ไม่ส่ง) → LINE ฝังเป็น claim ใน id_token · callback คืน
   **เฉพาะ** `?line_login=true#id_token=` (ไม่มี userId/ชื่อ/รูปใน query อีก) · หน้าเว็บรับ token จาก URL **เฉพาะเมื่อแท็บนี้มี nonce ค้างอยู่**
   และ `POST line-oa/line-login/verify {idToken, nonce}` ผ่าน (API ยืนยันกับ LINE `/oauth2/v2.1/verify` — ลายเซ็น/aud/exp/nonce — แล้วเทียบ
   claim `nonce` (timing-safe) + `aud` + `sub` เอง) · nonce ใช้ครั้งเดียว · **ตัวตน (sub/ชื่อ/รูป) มาจาก payload ที่ยืนยันแล้วเท่านั้น** ·
   ไม่มี/ไม่ตรง = ล้าง URL ทิ้ง token แล้วเริ่มล็อกอินของแท็บนี้ใหม่**หนึ่งครั้งต่อ 2 นาที** (`bc_ll_retry_at` — ในแอป LINE เป็นการล็อกอินอัตโนมัติ)
   ครั้งที่สองบอกให้เปิดลิงก์ใหม่จากแชท · เก็บ nonce ไม่ได้ = ไม่เริ่มล็อกอิน ⇒ code ของผู้โจมตี (ลิงก์ callback) และลิงก์หน้าเว็บที่ฝัง
   `#id_token=` ของผู้โจมตี ใช้ไม่ได้ทั้งคู่ · `buildBrowserUrl` (ลิงก์ที่บอทส่ง) ชี้**หน้าเว็บ** ให้หน้าเว็บเริ่มล็อกอินพร้อม nonce เอง
   (ลิงก์ authorize รุ่นเก่าในประวัติแชทยังใช้ได้ — เสียหนึ่งรอบ) · ทาง LIFF SDK (`liff.init` → `liff.getProfile()`/`getIDToken()` ใต้ `/liff/contract`)
   ไม่ผ่าน nonce นี้ — **และ SDK เองอ่าน `#access_token`/`#id_token` จาก fragment ของ URL ได้** (`@line/liff` บางเวอร์ชัน/UA แอป LINE เก่า) ⇒
   ตัวตนฝั่ง API ปลอดภัยเพราะ **`LiffTokenGuard` ยืนยัน id_token กับ LINE ทุกคำขอ** (ลายเซ็น LINE ปลอมไม่ได้) ไม่ใช่เพราะ SDK ไม่แตะ URL · ห้ามเชื่อ
   `liff.getProfile()`/ค่าจาก SDK เป็นตัวตนฝั่ง server โดยไม่ verify ·
   **ห้ามอ่านตัวตนจาก query/fragment ของ URL ที่ไหนอีก** และห้ามเพิ่มทางรับ id_token จาก URL ที่ไม่ผ่าน `verify` ·
   ไม่ใช้ cookie ผูก state ฝั่ง API: บน prod หน้าเว็บเรียก authorize ผ่าน rewrite `/api/**` ของ Firebase Hosting (host เว็บ — ส่งต่อเฉพาะ cookie
   `__session`) แต่ callback อยู่ host ของ API (`API_BASE_URL`) ⇒ cookie host-only ไปไม่ถึง · HMAC state อย่างเดียวไม่ช่วย (ผู้โจมตีขอ state ที่ลงนามเองได้) ·
   **id_token/nonce ห้ามถึง Sentry/log** (fix round 1 I-1 — id_token ใช้ยืนยันกับ LINE ได้จนหมดอายุ): `sentry.ts` redact body key `idToken`/`id_token`/`nonce`
   (error event + transaction ที่ถูก sample) · header `x-liff-id-token` · `redactShareToken` ล้างพารามิเตอร์ `?idToken=`/`id_token=`/`dl=` (ตั๋วดาวน์โหลด — fix round 1 M-6 ล้างด้วยชื่อ ไม่พึ่งความยาว 43 ตัว) ในทุก string ของ event
   (url · query_string · span attributes · breadcrumb · ข้อความ error) · `query_string` แบบ object / คู่ `[key, value]` ล้างด้วยชื่อที่ `SENSITIVE_QUERY_PARAMS`
   (`sentry.ts`) — endpoint/ฟิลด์ใหม่ที่พก id_token หรือ credential ใน URL ต้องเติมในรายการเหล่านี้ (+ เทสใน `sentry.spec.ts`)
4. **OTP (`VerificationService`)**: 3 ครั้งต่อรหัส (ช่วงละ 5 นาที) กินแบบ atomic ก่อนเทียบรหัส (`updateManyAndReturn` … `WHERE attempts < 3
   AND expires_at > now`) · ขอรหัสใหม่ในช่วงเดิม **ไม่รีเซ็ต** attempts · ผิดครบแล้วล็อกจนหมดช่วง (แถวไม่ถูกลบ) ·
   **cooldown 60 วิ/LINE แบบ atomic**: อ่านแถว→ตรวจ→เพดาน→เขียนแถว อยู่ในทรานแซกชันที่เริ่มด้วย
   `pg_try_advisory_xact_lock(hashtext('otp-request:'||lineUserId))` (ยิงขนานจาก LINE เดียวผ่านได้คำขอเดียว · ล็อกไม่ได้ = ตอบ cooldown ทันที
   ไม่เข้าคิวถือ connection ของ pool — R-2) · ส่ง SMS หลัง commit ·
   **เพดานต่อวันไทย** (แถวนับใน `chatbot_otp_requests` คีย์ `otp-quota:…`): ต่อ LINE ข้ามทุกเบอร์ (นับทั้งจริงและ decoy) **5** · ต่อ (ลูกค้า, LINE) **2**
   (กินก่อน) · ต่อลูกค้ารวมทุก LINE **8** ⇒ เดาได้ ≤ 24 ครั้ง/ลูกค้า/วัน · LINE ผู้โจมตี 3 บัญชีเผาได้ 6 เจ้าของเบอร์ยังได้รหัส (ต้อง ≥ 4 บัญชีถึงล็อกได้ทั้งวัน) ·
   ส่ง SMS ไม่สำเร็จ = log + Sentry + ทิ้งรหัส + ปลด cooldown + คืนโควตาลูกค้า/(ลูกค้า, LINE) **เฉพาะเมื่อรหัสนั้นยังไม่ถูกเดาเลย**
   (`UPDATE … WHERE hash = รหัสที่ออก AND attempts = attempts ตอนออก` คำสั่งเดียว — ถูกเดาแล้ว = ทิ้งรหัสแต่ไม่คืน ⇒ ≤ 24 ครั้ง/ลูกค้า/วัน จริงแม้ provider ล่ม — R-1) ·
   งานส่ง SMS ที่ไม่ await ปิดท้ายด้วย `.catch` (logger/Sentry ที่โยนเองไม่เป็น unhandled rejection — R-3) · cron ล้างแถวหมดอายุลบผ่าน
   `FOR UPDATE SKIP LOCKED` (ไม่รอล็อกแถวของใคร ⇒ ไม่มีวงจร deadlock กับคำขอ OTP · เทียบ `now() AT TIME ZONE 'UTC'` — R-2) ·
   `requestOtp` **ตอบเหมือนกันทุกไบต์** ทั้งเบอร์ที่พบ/ไม่พบ/
   ถึงเพดาน (แถว decoy `customer_id = ''` ไม่มีรหัสที่ใช้ได้ · ไม่ส่ง SMS) และ **ไม่ await SMS + รอเวลาตอบขั้นต่ำ 1 วิ ทุกทางที่สำเร็จ** (timing) ·
   หน้า OTP บอก "ไม่ได้รับ SMS ภายใน 2 นาที? … โทรหาสาขา" (คำตอบเหมือนส่งแล้วเสมอ) · lock ในหน่วยความจำนับเฉพาะเบอร์ผิดรูปแบบ (นับ "ไม่พบ" = oracle)
5. **`TEST_MODE_BYPASS` มีผลบน `NODE_ENV=production` เฉพาะเมื่อตั้ง env `ALLOW_TEST_MODE_BYPASS=YES_I_AM_SURE`** — ไม่ตั้ง = flag ถูกเมิน
   (log + Sentry warning ทุก 10 นาที) และ `PUT settings/test-mode` เปิดไม่ได้ (400 ไทย) · dev/UAT (non-production) ทำงานเหมือนเดิม
6. **พนักงาน/API ตั้ง `line_id_finance` ไม่ได้ — ล้างได้ = ยกเลิกผูก** (Task 22 I3/I4 · `line-oa/services/finance-line-link.ts`):
   `staffLineFinanceChange(ค่าที่ส่งมา, ค่าปัจจุบัน)` — ไม่ส่ง/ค่าเดิม (ฟอร์มแก้ไขส่งทุกช่องกลับมา) = ไม่แตะ · ว่าง/null ขณะมีค่า = ยกเลิกผูก ·
   ค่าใหม่ = 400 `LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE` (ชี้ทางของลูกค้าเอง: ส่งข้อความใดก็ได้ในแชท LINE การเงิน → การ์ด "เริ่มยืนยันตัวตน" —
   ระบบไม่มีปุ่มพนักงานส่งลิงก์ยืนยัน) · ใช้ที่ `POST/PATCH /customers` (`CustomerWriteService`) และ skip-tracing `newLineId` (ค่าใหม่ = ทั้งคำขอ 400 · **ค่าว่าง = ไม่แตะ** —
   skip-tracing เปิดให้ SALES/ACCOUNTANT/FM จึงห้ามยกเลิกผูก (fix round 1 M-1) ⇒ ทางยกเลิกผูกของพนักงานเหลือ `PATCH /customers/:id` (OWNER/BM) ทางเดียว) ·
   นำเข้าลูกค้า (`migration.service.ts`) ตัดคอลัมน์ `lineId` ทิ้ง + แถวเตือน `IMPORT_LINE_ID_IGNORED_MSG` ใน `errors` (แถวยังนำเข้า ไม่นับ failed) ·
   **ยกเลิกผูกมีทางเดียว `unlinkFinanceLine(tx, …)`** ในทรานแซกชันเดียวกับงานของผู้เรียก: `{ lineUserId }` (ลูกค้ากดใน LIFF — ล้างคอลัมน์บนทุกลูกค้าที่ถือ
   LINE นั้น รวมแถวที่ถูกลบ + ปิดแถวของ LINE นั้น) · `{ customerId }` (พนักงาน — ล้างคอลัมน์ + ปิดแถวของลูกค้าคนนั้น**เท่านั้น** ห้ามปิดตาม LINE: ค่าในคอลัมน์อาจเป็น
   U-id ที่พนักงานพิมพ์ซึ่งยืนยัน OTP ไว้กับลูกค้าอีกคน) · ไม่สลับ rich menu · writer ใหม่ของ `line_id_finance`/`customer_line_links` ต้องผ่าน OTP หรือ helper นี้
7. **id_token ไม่อยู่ใน URL ที่ไหนอีก (Task 22 M-3)**: `LiffTokenGuard` อ่าน header `X-Liff-Id-Token` เท่านั้น (`?idToken=` ถูกถอด) · ลิงก์ดาวน์โหลด
   (สัญญา PDF / ใบเสร็จ) = เว็บกดแล้วเปิดแท็บเปล่าในจังหวะคลิก → `POST line-oa/liff/download-ticket` (header) → เปิด `…?dl=<ตั๋ว>`
   (`web lib/liff-download.ts` · `withLiffToken`/`getLiffIdToken` ถูกลบ) · ตั๋ว (`LiffDownloadTicketService`) เก็บในตาราง `chatbot_otp_requests` เดิม คีย์
   `liff-dl:<sha256>` แบบเดียวกับแถวนับเพดาน OTP (`hash` = `<ชนิด>|<id>|<LINE>` · cron ล้างแถวหมดอายุทุก 10 นาที · ไม่ต้อง migration · ใช้ข้าม instance ได้ —
   prod ไม่มี Redis) · ใช้ตั๋ว = `findUnique` แล้ว `deleteMany` ผู้ลบได้คนเดียว (ยิงพร้อมกันผ่านคำขอเดียว) แล้วเทียบอายุ/ชนิด/id — ไม่ตรง = เผาทิ้ง ·
   ตั๋ว (43 ตัว base64url) ถูกล้างใน Sentry ด้วยชื่อพารามิเตอร์ `dl` (ข้อ 3) · access manifest จัด GET สองเส้นเป็น `public` · การล้าง `?idToken=` ใน Sentry คงไว้สำหรับหน้าเว็บรุ่นเก่าที่ยังเปิดค้าง (ลิงก์จากหน้าเหล่านั้นได้ 401)
8. **ปุ่ม quick reply ที่ลูกค้ากดเอง (postback `TEMPLATE:` → `CannedResponseSenderService.send(…, staffId = null)`) เติมตัวแปรลูกค้า**
   (`{customerName}` `{customerPhone}` `{contractNumber}` `{amountDue}` `{dueDate}` `{installmentNo}`) **เฉพาะห้อง LINE ที่
   `findOtpVerifiedCustomerId(room.lineUserId) === room.customerId`** (Task 22 I-C) — ไม่ผ่าน = คำกลาง (`ลูกค้า` / `-`) · Facebook ไม่มีทางยืนยัน OTP ⇒ คำกลางเสมอ ·
   `{branchName}` (สาขาของพนักงานที่ดูแลห้อง) ไม่ใช่ข้อมูลลูกค้า เติมตามเดิม · พนักงานกดส่งเอง (`staffId` มีค่า) ใช้ลูกค้าของห้องตามเดิม (พนักงานเห็นห้องและตัดสินเอง)
9. **`customers.line_id_finance` ไม่ใช่หลักฐานตัวตน และไม่ใช่ปลายทางข้อความการเงิน** (Task 22 fix round 1 I-1 — คอลัมน์แยกจากแถว OTP ได้:
   ค่าที่พนักงาน/นำเข้าเขียนก่อน Task 22 · ลูกค้าที่กู้จากถังขยะ/ชุบ ghost · ค่าที่ค้างบนลูกค้าเดิมหลัง LINE นั้นไปยืนยัน OTP กับอีกคน):
   - **สิทธิ์** — หน้า LIFF การเงินทุกจุด (`liff-api.service.ts` — สัญญา · ประวัติชำระ · โปรไฟล์ · ลิงก์ชำระ · ยอดปิด/ปิดยอด · ใบเสร็จ · ความยินยอม ·
     การแจ้งเตือน · สิทธิ์ออกตั๋วดาวน์โหลด PDF ผ่าน `findCustomerByLineId`)
     และลิงก์ชำระ PaySolutions (`paysolutions-intent.service.ts` `createPaymentIntent` — สัญญาต้องเป็นของลูกค้าตามแถว) หาลูกค้าด้วย `findOtpVerifiedCustomerId`
     ตัวเดียว · ไม่มีแถว active = ไม่มีสิทธิ์ (fail closed) · `LiffTokenGuard` ยังปล่อยผ่าน LINE ที่ไม่มีแถว link (หน้า OTP ต้องเปิดได้) — ปลอดภัย**เพราะ** service
     ตัดสินจากแถว ⇒ endpoint LIFF ใหม่ห้ามอ่านคอลัมน์ · ยกเลิกผูกใน LIFF (`unlinkLineAccount`) ล้างตาม LINE ของผู้เรียกเท่านั้น (ค่าค้างที่ชี้ LINE ตัวเอง — ไม่ให้สิทธิ์ใคร)
   - **ผู้รับข้อความ** — ผู้ส่งข้อความ LINE การเงินทุกตัวอ่าน U-id จากแถว: `FINANCE_LINE_RECIPIENT_SELECT` (ใน select ของลูกค้า) + `financeLineRecipient(customer)`
     หรือ `findFinanceLineRecipient(prisma|tx, customerId)` (`otp-verified-customer.ts`) · คิวส่งกรองด้วย `lineLinks: { some: ACTIVE_FINANCE_LINK_WHERE }` ·
     ชุดปัจจุบัน: เตือนงวด/ค้างชำระ (`notification-reminder`) · `collections-notifier` · `notification-dispatch` (sendBulk) · `overdue` `dunning-engine` /
     `dunning-retry` / `bulk` · `payment-post-commit-hooks` · `paysolutions-webhook` · QR ของ `paysolutions-intent` · `mdm-auto` · เอกสารสัญญา
     (`contract-workflow` / `generated-documents` / `document-persistence`) · `credit-note-delivery` · `device-return-notify` (เลิกทางสำรองคอลัมน์) ·
     ด่านส่งใบเสร็จ (`receipt-issuance`) · `payment-link` / `payment-evidence` · `chat-commerce` (ช่อง LINE_FINANCE) — คอลัมน์ค้างแต่ไม่มีแถว = ไม่ส่ง (ไม่ไปผิดคน)
   - **ผู้อ่านคอลัมน์ที่เหลือ** ถูกปักด้วย `line-oa/services/line-id-finance-readers.spec.ts` (allow-list พร้อมเหตุผล — แสดงผล/รายงาน/กรองคิว/ล้างค่า ·
     ไม่ตัดสินสิทธิ์ ไม่เป็นปลายทาง) · ไฟล์ใหม่ใต้ `src/modules` ที่อ้าง `lineIdFinance` = เทสแดง — ใช้แถว OTP หรือเพิ่มในรายการพร้อมเหตุผลในรีวิว
   - **ผูกใหม่ล้างค่าเดิม** — `bind` (`verification.service.ts`) ล้าง U-id นี้ออกจาก `line_id_finance` ของลูกค้าคนอื่นทุกคน (รวมแถวที่ถูกลบ) ในทรานแซกชันเดียวกับการผูก
   - ห้องแชท LINE การเงินใหม่ไม่จับคู่ลูกค้าด้วยคอลัมน์ (`chat-prospect.service.ts` `findExistingCustomerId`: ห้องเดิมของ LINE เดียวกัน → แถว link ที่ยังผูก →
     ไม่พบ = สร้างผู้สนใจใหม่ · คอลัมน์ใช้เฉพาะ `line_id_shop` ของห้อง LINE ร้าน)

**ข้อยกเว้นที่ยังเหลือ (รู้ตัว — ยังไม่ได้ปิด อย่าอ่านกติกาข้างบนว่า "ปิดหมดแล้ว"):**
- **I3 — ปิดในโค้ดแล้ว (Task 22 กติกาข้อ 6 + fix round 1 กติกาข้อ 9) · ที่ยังเหลือ (ส่วนใหญ่เป็นเรื่องการแสดงผล):** (ก) ค่า `line_id_finance` ที่พนักงาน/นำเข้า
  เขียนไว้**ก่อน deploy Task 22** ยังอยู่ — ไม่ให้สิทธิ์ LIFF/ลิงก์ชำระ และไม่เป็นปลายทางข้อความแล้ว (ข้อ 9) แต่ยังแสดงบนหน้าลูกค้าของพนักงาน · ป้าย/ตัวกรอง
  "มี LINE" ของคิวทวงถาม (`overdue` / `collections-session`) · คอลัมน์รายงานลูกหนี้ · ช่อง `{customer_line_id}` ในเอกสารสัญญา ⇒ พนักงานอาจเห็นว่าลูกค้า
  "มี LINE" ทั้งที่ข้อความไม่ถูกส่ง · **กวาดหนึ่งครั้งก่อนเปิด LIFF ให้ลูกค้า (1 ธ.ค.)** ด้วย SQL อ่านอย่างเดียวด้านล่าง (รันบน prod ได้ตอนนี้เพื่อรู้ขนาด) แล้วล้างทีละแถว:
  มีสัญญา = หน้าสัญญา › แก้ไขข้อมูลลูกค้า (ข้อ I4) · **ไม่มีสัญญา (`contracts = 0`) ล้างผ่านหน้าจอไม่ได้** (`EditCustomerDialog` ส่งเฉพาะช่องไม่ว่าง) ⇒
  `PATCH /customers/:id {"lineIdFinance": null}` ด้วยบัญชี OWNER (ผ่าน `unlinkFinanceLine` + audit) · แถวที่ถูกลบ (`deleted = true`): ล้างหลังกู้จากถังขยะ
  (ถังขยะเตือน "เคยผูก LINE" อยู่แล้ว) — `bind` ของ LINE เดียวกันก็ล้างให้เอง (ข้อ 9) · (ข) ~~ให้ LIFF การเงินอนุญาตจากแถว link~~ — ทำแล้ว (ข้อ 9) ·
  (ค) `line_id_shop` ยังเขียนได้จากฟอร์มพนักงาน/บอทขาย (ไม่มีทาง OTP ฝั่งร้าน — คงไว้) · ไม่ใช่หลักฐานตัวตนแล้ว (ข้อ 1) แต่ยังเป็นปลายทาง push ฝั่งร้าน

  ```sql
  -- (ค-1) คอลัมน์ที่ไม่มีแถว OTP ของ (ลูกค้าคนนี้, LINE นี้) หนุน — รวมแถวที่ถูกลบ (กู้จากถังขยะ/ชุบ ghost ได้)
  --   link_owner ไม่ว่าง = LINE นี้ยืนยัน OTP กับลูกค้า "คนอื่น" (ก่อน fix round 1 เห็นข้อมูลแถวนี้ผ่าน LIFF ได้) ⇒ ล้างก่อน
  --   looks_like_sub = รูปแบบ LINE userId จริง (U + 32 hex) — ค่าที่ไม่ใช่รูปนี้ไม่มีทางตรง `sub` ของ LIFF
  SELECT c.id, c.deleted_at IS NOT NULL AS deleted, c.updated_at,
         c.line_id_finance ~ '^U[0-9a-f]{32}$' AS looks_like_sub,
         l.customer_id AS link_owner,
         (SELECT count(*) FROM contracts k WHERE k.customer_id = c.id AND k.deleted_at IS NULL) AS contracts
  FROM customers c
  LEFT JOIN customer_line_links l
    ON l.line_user_id = c.line_id_finance AND l.channel = 'FINANCE'
   AND l.unlinked_at IS NULL AND l.deleted_at IS NULL
  WHERE NULLIF(btrim(c.line_id_finance), '') IS NOT NULL
    AND l.customer_id IS DISTINCT FROM c.id
  ORDER BY (l.customer_id IS NOT NULL) DESC, deleted, c.updated_at DESC;

  -- (ค-2) U-id เดียวกันบนลูกค้าที่ยังไม่ถูกลบมากกว่า 1 คน
  SELECT line_id_finance, array_agg(id ORDER BY updated_at) AS customer_ids
  FROM customers
  WHERE deleted_at IS NULL AND NULLIF(btrim(line_id_finance), '') IS NOT NULL
  GROUP BY line_id_finance HAVING count(*) > 1;
  ```

- **I4 — ปิดแล้ว (Task 22)**: OWNER/BM ล้างช่อง "LINE ID (น้องเบส / FINANCE)" ที่หน้าสัญญา › แก้ไขข้อมูลลูกค้า (`CustomerEditModal` ส่ง `null` เมื่อช่องว่าง
  — เฉพาะเมื่อโหลดข้อมูลลูกค้าฉบับเต็มได้: ทางสำรอง (โหลดไม่ได้) ไม่ส่งช่องที่ไม่ได้โหลดเลย ⇒ ไม่ยกเลิกผูก/ไม่ล้างอีเมล-ที่อยู่-ผู้อ้างอิงเงียบ — fix round 1 M-2)
  → ยกเลิกผูก (ปิดแถว) ⇒ ลูกค้ายืนยัน OTP ด้วย LINE ใหม่ได้ ไม่ติด 409 (พิสูจน์บน Postgres `verification-link.db.spec.ts` ข้อ 7) · หน้าลูกค้า › แก้ไข
  (`EditCustomerDialog`) **ล้างไม่ได้** (ส่งเฉพาะช่องที่ไม่ว่าง) · ไม่มีปุ่มเฉพาะ — ถ้าต้องการต้องทำ mockup ก่อน
- **OA ร้าน — หน้า LIFF ประกัน/หลังการขายปิดแล้ว (Task 22 ทางเลือก ก · ข้อ 1) · ที่ยังเหลือก่อนเชื่อมกับ prod**: ข้อความ push ฝั่งร้าน (ใบเสร็จขายสด,
  ประกัน, ออเดอร์ออนไลน์, PaySolutions, หลังการขาย, แคมเปญ) ยังส่งไป `line_id_shop` ⇒ ลูกค้าที่ยืนยัน OTP แล้วแต่ไม่มีค่านี้ไม่ได้รับ push ฝั่งร้าน
  (ไม่รั่ว — แค่ไม่ได้รับ) และค่าที่พนักงานพิมพ์เป็นปลายทางที่ไม่ผ่าน OTP · ป้าย "ผูก LINE ร้านแล้ว" บนหน้าลูกค้า (`LineLinkInvite`) ยังดู `lineIdShop` ·
  แถวสำรองของหน้า LIFF (`line_id_shop` ที่แก้ล่าสุดก่อน cutoff — ชุดจำกัด ไม่โตขึ้น) ตรวจ/ล้างก่อนเชื่อม:

  ```sql
  -- คอลัมน์เก็บ UTC: '2026-10-30 17:00:00' = 31 ต.ค. 00:00 เวลาไทย (LEGACY_SHOP_LINE_ID_CUTOFF)
  -- ตัดแถวที่ LINE เดียวกันยืนยัน OTP แล้ว — หน้า LIFF ใช้แถว OTP ก่อน ไม่ได้พึ่งทางสำรอง (fix round 1 M-7)
  SELECT id FROM customers
  WHERE line_id_shop IS NOT NULL AND deleted_at IS NULL AND updated_at < '2026-10-30 17:00:00'
    AND NOT EXISTS (SELECT 1 FROM customer_line_links l
      WHERE l.line_user_id = customers.line_id_shop AND l.channel = 'FINANCE'
        AND l.unlinked_at IS NULL AND l.deleted_at IS NULL);
  ```

- **I-A Login CSRF — ปิดในโค้ดแล้ว (Task 21, 2026-10-31 · กติกาข้อ 3) · ที่ยังเหลือ:** (ก) **ยังไม่ได้ทดสอบบนเครื่องจริง** — ก่อนเปิด LIFF ให้ลูกค้า (1 ธ.ค.)
  ต้องผ่านครบ 4 แบบ (แอป LINE iOS · แอป LINE Android · Safari · Chrome): เปิดลิงก์ยืนยันตัวตนจากแชท → ล็อกอิน → หน้า OTP แสดงชื่อ/รูป LINE ของตัวเอง ·
  เปิดลิงก์หน้าเว็บที่ฝัง `#id_token=` ของบัญชีอื่น → ไม่ขึ้นชื่อนั้น ได้ล็อกอินเป็นบัญชีตัวเอง · ลิงก์ authorize รุ่นเก่า → ได้หน้า OTP (ล็อกอินเพิ่มหนึ่งรอบ) ·
  ไปหน้า LIFF อื่น/รีเฟรชในแท็บเดิมไม่ต้องล็อกอินซ้ำ · `/liff/contract` ใน LIFF จริง (liff.line.me) ไม่ผ่านทางนี้และต้องทำงานเหมือนเดิม ·
  กดดาวน์โหลดสัญญา PDF / ใบเสร็จในแอป LINE (iOS · Android) ได้ไฟล์ในครั้งแรก — ได้ 401 = ตัว preview/prefetch ของ in-app browser ยิง HEAD/GET ก่อนแล้วเผาตั๋ว
  (Task 22 review M-5 — แก้: `consume` เฉพาะ `GET`) ·
  ใน **Sentry** event ของ `/line-login/verify` (503 และ transaction ที่ถูก sample) ไม่มี `idToken`/`nonce` และไม่มี token ใน header/`?idToken=` (ข) ล็อกอินที่ข้ามบริบทกลางทาง (เปิดจากเบราว์เซอร์ภายนอก →
  สลับไปแอป LINE → กลับมาเปิด callback ในแท็บ/เบราว์เซอร์อื่น) **fail closed**: แท็บใหม่ไม่มี nonce ⇒ ทิ้ง token แล้วเริ่มล็อกอินใหม่ในแท็บนั้น (ผู้ใช้อาจต้องกดล็อกอิน
  LINE อีกครั้ง) — ไม่รั่ว แต่ UX อาจวนถ้าระบบเปิดแท็บใหม่ทุกครั้ง (ตรวจในข้อ ก) (ค) เบราว์เซอร์ที่ปิด storage (เช่น Safari "Block All Cookies") ล็อกอินนอก LIFF
  ไม่ได้ — หน้าจอบอกให้เปิดในแอป LINE (ง) ยังไม่มี SMS แจ้งเบอร์ลูกค้าหลังผูก LINE สำเร็จ (มาตรการตรวจจับเสริมที่รีวิวเสนอ — ใช้กับ I3 ได้ด้วย)
  (จ) deploy: เว็บ (26.10.70) กับ API ต้องขึ้นพร้อมกัน — เว็บรุ่นเก่ากับ API ใหม่ = ล็อกอินนอก LIFF ล้ม ("ข้อมูลเข้าสู่ระบบ LINE ไม่ครบ") จนเว็บใหม่ขึ้น ·
  เว็บใหม่กับ API เก่า = verify 404 → "ยืนยันการเข้าสู่ระบบ LINE ไม่ได้ในขณะนี้" (ไม่รั่วทั้งสองแบบ)
  (ฉ) ของเดิมที่ยังไม่แก้ (M-2): session cache ของหน้า LIFF เก็บ id_token ใน sessionStorage (`bcp_liff_session_v1` — กติกา "ห้ามเก็บ token
  ใน sessionStorage" ข้างบนหมายถึง access token ของพนักงาน) · ~~M-3 ลิงก์ดาวน์โหลดใส่ id_token ใน `?idToken=`~~ — **ปิดแล้ว (Task 22 · ข้อ 7)** ·
  deploy Task 22: เว็บ (26.10.71) กับ API ขึ้นพร้อมกัน — เว็บรุ่นเก่ากับ API ใหม่ = ปุ่มดาวน์โหลดได้ 401 (ไม่มีตั๋ว) จนเว็บใหม่ขึ้น
- **I-C — ปิดแล้ว (Task 22 · ข้อ 8) · ที่ยังเหลือ:** ด่าน `verifiedOnly` ของแม่แบบยังดู `chat_rooms.verified_at` (ตั้งได้ตอนผูกห้องด้วยเบอร์/พนักงานผูก) —
  ตัวแปรลูกค้าถูกแทนด้วยคำกลางแล้ว แต่ข้อความคงที่ของแม่แบบ `verifiedOnly` ยังส่งได้ · พนักงานกดส่งเองยังใช้ลูกค้าของห้อง (บอทขาย `LINKED_BY_PHONE`
  ทำให้พนักงานเห็นห้องเป็นลูกค้าคนนั้น — social engineering คลาสเดียวกับ I3) · Facebook: ปุ่มที่ลูกค้ากดได้คำกลางเสมอ — ตรวจแม่แบบที่ใช้ตัวแปรลูกค้าและมี
  ปุ่ม `TEMPLATE:` บน Facebook ว่ายังสื่อความได้
- เวลาตอบ `requestOtp`: SMS ไม่ถูก await และทุกทางที่สำเร็จรอขั้นต่ำ 1 วิ — ส่วนต่างที่เหลือคือ query เพดานของเบอร์จริง (ระดับมิลลิวินาที อยู่ใต้ขั้นต่ำ) ·
  ถ้า provider ช้าเกิน 1 วิ SMS ยังส่งต่อหลังตอบ (Cloud Run ลด CPU หลังตอบ — อาจช้าลง ไม่หาย)

## Sensitive Data
- **ห้าม commit** `.env` files
- **ห้าม log** tokens, passwords, หรือ PII (ข้อมูลส่วนบุคคล)
- ใช้ environment variables สำหรับ secrets ทั้งหมด

## Credentials ใน Integration Hub (`INTEGRATION_ENCRYPTION_KEY` — 2026-10-31)
- ค่า sensitive เข้ารหัสด้วย `INTEGRATION_ENCRYPTION_KEY` (Secret Manager → `bestchoice-api` + worker) ·
  ค่าที่ถอดไม่ได้ = **"ยังไม่ตั้งค่า"** (`IntegrationConfigService.getValue` คืน `undefined` — ไม่คืน ciphertext,
  ไม่ throw, **ไม่ใช้ env สำรองของช่องนั้น**) ⇒ ผู้เรียกต้องรับมือ `undefined` แบบ fail closed
  (webhook guard ปฏิเสธบน production) · ด่านที่ "ตั้งค่าอยู่" ต้องหมายถึงปลอดภัย (เช่นด่าน PEAK ของ
  `import:legacy-backoffice`) ใช้ `checkEncryptedFields(integration).failed` นับค่าที่ถอดไม่ได้ว่าตั้งค่าอยู่
- key ต้องเป็น hex 64 ตัว (trim) — รูปแบบผิด = ถือว่าไม่มี key (error + Sentry ไม่บอกค่า/ความยาว, บูตไม่ล้ม) ·
  ช่องลับที่ส่งค่าว่างตอนบันทึก = ไม่เปลี่ยน (ไม่มีการ "ล้าง" ช่องลับจาก UI) · ปุ่มทดสอบการเชื่อมต่อใช้ค่าจาก
  `getConfig` เท่านั้น (ห้ามเติม `|| process.env.*` — ผู้อ่านผ่าน Hub ไม่ใช้ env เมื่อแถวถอดไม่ได้) · **ข้อยกเว้นที่รู้:**
  Claude บางส่วน (`ai-usage/ai-text.service.ts`, `chat-engine/services/after-hours.service.ts`, การเช็ค key ของ AI suggest ใน
  `staff-chat`) อ่าน env `ANTHROPIC_API_KEY` ตรง และอีเมลแจ้งเตือน (`notifications/email-provider.service.ts`) อ่าน `SMTP_*` ตรง —
  ไม่ผ่าน Hub ⇒ ผลปุ่มทดสอบของการ์ด Claude / อีเมล สะท้อนเฉพาะฟีเจอร์ที่อ่านผ่าน Hub (OCR, วิเคราะห์เครดิต, บอท, `EmailService`)
- แถว `integration.*` ออกได้ทาง `/integrations/*` (masked) เท่านั้น — `GET /settings` (`SettingsWriteService.findAll`)
  กรองออกแล้ว พร้อมคีย์ลับรุ่นเก่านอก prefix นี้ (`isSecretSettingKey` ใน `settings.constants.ts` = `integration.*` หรือ
  `isSensitiveKey` ยกเว้นคีย์ที่แค่ชื่อเหมือน เช่น `customer_access_token_hours`) · endpoint ใหม่ที่คืนแถว `system_config`
  ทั้งตารางต้องใช้ `isSecretSettingKey` แบบเดียวกัน
- ตรวจ key บน prod จากบรรทัดบูต `integration encrypted fields: key=… ok=N [...] failed=M [...]` (ชื่อช่องเท่านั้น) —
  ห้ามอ่าน/พิมพ์ค่า secret หรือค่าใน `system_config` · runbook: `docs/runbooks/2026-10-31-integration-encryption-key.md`
- ⚠ dev/CI ที่ใช้ DB ชุดเดียวกับ prod แต่ไม่มี key: webhook guard ของ LINE/Yeastar เห็น "ยังไม่ตั้งค่า" แล้ว **ข้ามการตรวจ
  ลายเซ็น (DEV ONLY, `NODE_ENV !== 'production'`)** — ห้ามเปิด dev แบบนี้ออกอินเทอร์เน็ต (tunnel) · production ปฏิเสธ 401
