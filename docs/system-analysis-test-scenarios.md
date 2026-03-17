# BESTCHOICE System Analysis — Test Scenarios & Feature Recommendations

## Context
วิเคราะห์ระบบผ่อนชำระ BESTCHOICE ทั้ง backend (NestJS + Prisma + PostgreSQL) และ frontend (React + TypeScript) เพื่อระบุ edge cases, security vulnerabilities, performance bottlenecks และแนะนำฟีเจอร์เพิ่มเติม

---

# Part 1: Test Scenarios

## 1.1 Edge Cases — กรณีการใช้งานที่ผิดปกติ

### A. Payment & Financial Edge Cases

| # | Scenario | ไฟล์ที่เกี่ยวข้อง | ความรุนแรง |
|---|----------|-------------------|-----------|
| E1 | **Receipt number race condition** — 2 payments จ่ายพร้อมกัน ทำให้ `findFirst()` อ่านค่า sequence เดียวกัน → เลขใบเสร็จซ้ำ | `receipts.service.ts:13-33` | CRITICAL |
| E2 | **Overpayment ถูก reject ทั้งหมด** — ลูกค้าโอนเกิน 1 บาท ระบบปฏิเสธทั้งก้อน ต้องโอนใหม่ | `payments.service.ts:66-70` | HIGH |
| E3 | **Late fee ไม่ถูก recalculate ตอนชำระ** — cron คำนวณค่าปรับ แต่ถ้าลูกค้าจ่ายก่อน cron รัน จะได้ lateFee=0 | `payments.service.ts:61` | HIGH |
| E4 | **Receipt generation fail silently** — payment บันทึก PAID แต่ใบเสร็จไม่ถูกสร้าง (catch block ว่าง) | `payments.service.ts:114-116` | HIGH |
| E5 | **Floating-point rounding** — `principal * interestRate * months` ใช้ JS number ไม่ใช่ Decimal → สะสม error ใน amount สูง | `installment.util.ts:39-41` | HIGH |
| E6 | **Waiver logic ตรวจแค่ principal** — ยกเว้นค่าปรับแล้ว mark PAID แต่ยังมียอดดอกเบี้ย/commission ค้าง | `payments.service.ts:349` | MEDIUM |
| E7 | **Auto-allocate partial failure** — loop จ่ายหลายงวด ถ้า fail กลางทาง → บางงวดถูก update บางงวดไม่ | `payments.service.ts:152-179` | MEDIUM |
| E8 | **Last installment rounding** — `Math.ceil()` ทำให้งวดสุดท้ายอาจน้อยกว่างวดอื่น (ไม่มี validation ว่าไม่ติดลบ) | `installment.util.ts:76-77` | LOW |
| E9 | **เดือนเปลี่ยน → receipt prefix เปลี่ยน** — ถ้า 2 receipt สร้างคร่อมเที่ยงคืน seq reset เป็น 1 | `receipts.service.ts:20-25` | LOW |

**Test Scenarios:**
```
TC-E1: สร้าง 10 concurrent payment requests → ตรวจว่า receipt numbers ไม่ซ้ำกัน
TC-E2: จ่ายเงิน 5,001 บาท (ค้าง 5,000) → ต้อง handle overpayment gracefully
TC-E3: ลูกค้าเลยกำหนด 3 วัน แต่ cron ยังไม่รัน → จ่ายเงิน → ตรวจว่า late fee ถูกต้อง
TC-E4: Mock receipt service ให้ throw → ตรวจว่า payment ยังเป็น PAID + มี error log
TC-E5: คำนวณผ่อน 99,999.99 บาท × 0.08% × 36 เดือน → ตรวจว่ายอดรวม = sum of all installments
TC-E6: ยกเว้นค่าปรับ → ตรวจว่ายังมียอด commission/interest ค้างหรือไม่
TC-E7: Auto-allocate 5 งวด แต่ mock ให้งวดที่ 3 fail → ตรวจว่า rollback ทั้งหมด
```

### B. Stock & Inventory Edge Cases

| # | Scenario | ไฟล์ | ความรุนแรง |
|---|----------|------|-----------|
| E10 | **Stock transfer race condition** — duplicate check อยู่นอก transaction → 2 request สร้าง transfer ซ้ำ | `products-stock.service.ts:81-86` | CRITICAL |
| E11 | **Bulk transfer timeout** — 100+ items ใน transaction เดียว เกิน 15s timeout → rollback ทั้งหมด | `products-stock.service.ts:190` | MEDIUM |
| E12 | **Product status ไม่เปลี่ยนระหว่าง transfer** — สินค้า IN_STOCK ตลอด แม้กำลัง IN_TRANSIT | `products-stock.service.ts:362-365` | MEDIUM |
| E13 | **Contract number race condition** — เหมือน receipt แต่อยู่ใน transaction (ดีกว่า) แต่ isolation level ไม่ specified | `sequence.util.ts:16-36` | MEDIUM |

**Test Scenarios:**
```
TC-E10: สร้าง 5 concurrent transfer requests สำหรับ product เดียวกัน → ต้องสำเร็จแค่ 1
TC-E11: สร้าง bulk transfer 200 items → ตรวจว่า timeout handling ถูกต้อง
TC-E12: Transfer product → ตรวจว่า branch อื่นไม่เห็นสินค้านี้ใน stock
TC-E13: สร้าง 10 concurrent contracts → ตรวจว่า contract numbers ไม่ซ้ำ
```

### C. Contract Lifecycle Edge Cases

```
TC-E14: สร้างสัญญาแล้ว approve → ลบสินค้า → ตรวจว่าสัญญายังใช้ได้
TC-E15: สัญญา OVERDUE → ลูกค้าจ่ายครบ → ตรวจว่าสถานะเปลี่ยนเป็น COMPLETED
TC-E16: สัญญา DEFAULT → ยึดเครื่อง → ลูกค้ามาจ่ายต่อ → ระบบจัดการอย่างไร?
TC-E17: Early payoff ขณะมี late fee → ตรวจว่าคำนวณยอดปิดสัญญาถูกต้อง
TC-E18: เปลี่ยนอัตราดอกเบี้ยใน Settings → สัญญาเก่าที่มีอยู่ได้รับผลกระทบหรือไม่?
```

---

## 1.2 Security Vulnerabilities — ช่องโหว่ด้านความปลอดภัย

### สิ่งที่ทำได้ดีแล้ว
- JWT + refresh token rotation + httpOnly cookie
- RBAC + Branch-level access control
- Input validation (class-validator + global whitelist pipe)
- Security headers (CSP, HSTS, X-Frame-Options, X-XSS-Protection)
- CSRF protection (X-Requested-With header + sameSite)
- Rate limiting (200 req/s global, 30/min login, 10/min refresh)
- LINE webhook HMAC-SHA256 signature verification
- Audit logging with sensitive field redaction
- Prisma ORM (no raw SQL injection risk)
- XSS detection middleware

### ช่องโหว่ที่ควรทดสอบ

| # | Vulnerability | ความรุนแรง | Test Scenario |
|---|--------------|-----------|--------------|
| S1 | **File upload ไม่ validate** — slip upload ไม่ตรวจ file type/size/extension → อาจ upload script | HIGH | Upload .exe, .svg+XSS, 100MB file → ตรวจว่าถูก reject |
| S2 | **Public contract verify endpoint** — `GET /contracts/:id/verify?hash=...` ไม่มี rate limit → brute-force hash | MEDIUM | ส่ง 1000 requests กับ random hash → ตรวจว่ามี rate limit |
| S3 | **ไม่มี 2FA** — admin account ถูก compromise → full system access | MEDIUM | Test ว่า sensitive operations (delete, void, settings) ต้องการ re-authentication |
| S4 | **Access token ใน localStorage** — XSS attack อ่าน token ได้ | MEDIUM | ตรวจว่า CSP policy ป้องกัน inline script injection |
| S5 | **ไม่มี per-user login lockout** — brute-force ได้ถ้าเปลี่ยน IP | MEDIUM | Login fail 100 ครั้งจาก IP ต่างๆ กับ user เดียวกัน → ตรวจว่า account ไม่ถูก lock |
| S6 | **Refresh token cleanup แบบ probabilistic** — 1% chance ต่อ request → token เก่าสะสม | LOW | ตรวจจำนวน expired tokens หลัง 1000 refresh cycles |
| S7 | **ไม่มี password reset flow** — ถ้าลืม password ทำอย่างไร? | MEDIUM | ตรวจว่ามี forgot password endpoint |
| S8 | **ไม่มี session invalidation สำหรับ concurrent login** — login จาก 2 devices ไม่ revoke เก่า | LOW | Login 2 devices → ตรวจว่า device เก่ายังใช้ได้ (อาจ ok ตาม business need) |

**Security Test Scenarios:**
```
TC-S1: Upload ไฟล์ .php, .exe, .html → ต้อง reject ทั้งหมด
TC-S2: Upload ไฟล์ 50MB → ต้อง reject (size limit)
TC-S3: Upload SVG ที่มี <script> tag → ต้อง sanitize หรือ reject
TC-S4: ส่ง request โดยไม่มี X-Requested-With header ไปยัง POST endpoint → ต้อง 403
TC-S5: ส่ง JWT ที่ expire แล้ว → ต้อง 401 + auto-refresh ผ่าน cookie
TC-S6: Logout แล้วใช้ refresh token เดิม → ต้อง fail (token revoked)
TC-S7: SALES role พยายาม access /settings → ต้อง 403
TC-S8: BRANCH_MANAGER สาขา A พยายาม record payment สาขา B → ต้อง 403
TC-S9: Inject SQL ใน search field "'; DROP TABLE--" → Prisma ป้องกัน → ไม่มี error
TC-S10: XSS payload ใน customer name "<script>alert(1)</script>" → ต้อง sanitize
```

---

## 1.3 Performance Bottlenecks — จุดที่อาจช้า

| # | Bottleneck | ไฟล์ | สาเหตุ | Test Scenario |
|---|-----------|------|--------|--------------|
| P1 | **Dashboard aggregate queries** — หลาย aggregate + count queries พร้อมกัน | `dashboard.service.ts` | N+1 queries, full table scan | Load dashboard ด้วย 10,000+ contracts → วัดเวลา |
| P2 | **Overdue cron job** — scan ทุก contract ที่ active + คำนวณ late fee | `overdue.service.ts:227-243` | Full table scan ทุกวัน | Run cron กับ 50,000 contracts → วัดเวลา + DB load |
| P3 | **Receipt PDF generation** — สร้าง PDF ทุกครั้งที่ชำระ | `receipts.service.ts` | Synchronous PDF generation | สร้าง 100 receipts พร้อมกัน → วัด response time |
| P4 | **Slip review GET evidence** — `take: 50` แต่ไม่มี pagination | `line-oa.controller.ts` | เมื่อมีสลิปมาก → ขาดหน้าถัดไป | สร้าง 500 pending slips → ตรวจว่า 450 หายไป |
| P5 | **Export Excel limit 10,000** — fetch ทั้งหมดใน memory | `SlipReviewPage.tsx` | Memory spike บน client | Export 10,000 records → วัด memory usage |
| P6 | **Stock dashboard analytics** — หลาย aggregate queries | `products.service.ts` | Multiple full table scans | Load stock dashboard ด้วย 5,000+ products → วัดเวลา |
| P7 | **Notification batch send** — LINE API rate limit 500 msg/sec | `line-oa.service.ts` | ส่ง notification ทีละ 1 ไม่ batch | ส่ง notification 1,000 คน → วัดเวลา + rate limit errors |
| P8 | **Audit log table growth** — log ทุก mutation ไม่มี archiving | `audit.interceptor.ts` | Table โตไม่จำกัด → query ช้า | Query audit logs หลัง 1M records → วัด response time |

**Performance Test Scenarios:**
```
TC-P1: Login 20 users พร้อมกัน load Dashboard → response < 3s
TC-P2: 100 concurrent payment requests → ทุก request สำเร็จภายใน 5s
TC-P3: Search customers "สม" กับ 100,000 records → response < 1s
TC-P4: Load contracts page กับ 50,000 contracts → pagination ทำงานถูกต้อง < 2s
TC-P5: Export Excel 10,000 records → download < 10s, memory < 500MB
TC-P6: Overdue cron กับ 50,000 active contracts → complete < 60s
TC-P7: Stock transfer bulk 100 items → complete < 15s (ไม่ timeout)
```

---

# Part 2: Feature Recommendations

## 2.1 Must-Have — ฟีเจอร์ที่ขาดไม่ได้

| # | ฟีเจอร์ | เหตุผล | Priority |
|---|---------|--------|---------|
| M1 | **Real Payment Gateway Integration** (PromptPay, Credit Card) | ปัจจุบันเป็น mock — ไม่สามารถรับเงินจริงผ่าน LIFF ได้ ต้อง integrate Omise/2C2P/SCB API จริง | P0 |
| M2 | **SMS Notification** | LINE ครอบคลุมแค่ลูกค้าที่ add LINE OA — SMS เป็นช่องทาง fallback สำคัญสำหรับแจ้งค้างชำระ (ลูกค้ากลุ่ม installment มือถือมักไม่ใช้ LINE ทุกคน) | P0 |
| M3 | **Automated Dunning/Collection Workflow** | ปัจจุบัน overdue tracking เป็น manual — ต้องมี auto-escalation: วันที่ 1 → SMS เตือน, วันที่ 7 → โทรติดตาม, วันที่ 30 → ส่งจดหมาย, วันที่ 60 → ยึดเครื่อง | P1 |
| M4 | **Overpayment Credit System** | ลูกค้าโอนเกินต้อง reject ทั้งก้อน → ควรมี credit ledger ที่รับเงินเกินแล้ว apply ไปงวดถัดไป | P1 |
| M5 | **Database Backup & Data Export** | ไม่มี backup feature — ข้อมูลการเงินหายไม่ได้ ต้องมี scheduled backup + manual export (CSV/Excel) | P1 |
| M6 | **Password Reset Flow** | ไม่มี forgot password — admin ต้อง reset ให้เอง ควรมี email-based reset link | P1 |
| M7 | **Two-Factor Authentication (2FA)** | ข้อมูลการเงิน + ข้อมูลส่วนบุคคลลูกค้า (PDPA) → OWNER/BRANCH_MANAGER ควรมี 2FA (OTP via SMS/LINE) | P1 |
| M8 | **Receipt Number Concurrency Fix** | Race condition ทำให้เลขใบเสร็จซ้ำ → ใช้ DB sequence หรือ Serializable transaction | P0 |
| M9 | **Warranty/Service Tracking** | ร้านขายมือถือต้องจัดการ warranty — ลูกค้าเคลมเครื่องเสีย, ส่งซ่อม, เปลี่ยนเครื่อง | P2 |
| M10 | **Email Integration** | Receipts page มี mention email แต่ไม่มี implementation — ต้องส่งใบเสร็จทาง email ได้ | P2 |

## 2.2 Nice-to-Have — ฟีเจอร์เสริมที่สร้างความแตกต่าง

| # | ฟีเจอร์ | ประโยชน์ |
|---|---------|---------|
| N1 | **AI-Powered Credit Scoring** | ใช้ประวัติชำระของลูกค้าเก่า + ข้อมูล demographic → predict ความเสี่ยงค้างชำระ → แนะนำ approve/reject + วงเงิน |
| N2 | **Customer Loyalty Program** | ลูกค้าจ่ายตรงเวลา → สะสมแต้ม → ลดดอกเบี้ยสัญญาถัดไป หรือ ส่วนลดอุปกรณ์เสริม |
| N3 | **Real-time Dashboard with WebSocket** | Dashboard update แบบ real-time ไม่ต้อง refresh — เห็นยอดขาย/ชำระเข้าทันที |
| N4 | **WhatsApp/Facebook Messenger Integration** | เพิ่มช่องทางสื่อสารนอกเหนือจาก LINE → เข้าถึงลูกค้าได้หลากหลายขึ้น |
| N5 | **Mobile App (PWA)** | พนักงานใช้มือถือที่หน้าร้าน → PWA ทำงาน offline ได้ + push notification |
| N6 | **QR Code Inventory Management** | Scan QR บนสินค้า → ดูข้อมูล + status ทันที ไม่ต้อง search |
| N7 | **Promotional Campaign Management** | สร้าง campaign: ดอกเบี้ย 0% 3 เดือนแรก, down payment 0%, bundle deals → track conversion |
| N8 | **Returns & Refunds Workflow** | จัดการการคืนสินค้า/คืนเงิน → เชื่อมกับ stock + accounting |
| N9 | **Customer Self-Service Portal (Web)** | นอกจาก LINE LIFF → web portal ที่ลูกค้า login ดูสัญญา/จ่ายเงิน/download ใบเสร็จ ได้โดยไม่ต้องใช้ LINE |
| N10 | **Automated Financial Reports** | สร้าง report อัตโนมัติ (รายวัน/สัปดาห์/เดือน) → ส่งเข้า email/LINE ของ OWNER |
| N11 | **Multi-Currency Support** | รองรับลูกค้าต่างชาติ/สาขาชายแดน → แสดงราคา THB + สกุลอื่น |
| N12 | **Integration กับบัญชี (Accounting Software)** | Export ข้อมูลเข้า QuickBooks/PEAK/FlowAccount → ลด manual data entry |

---

# Priority Roadmap

1. **P0** (ทำทันที): M1 Payment Gateway, M2 SMS Notification, M8 Receipt Race Condition Fix
2. **P1** (Sprint ถัดไป): M3 Dunning, M4 Overpayment Credit, M5 Backup, M6 Password Reset, M7 2FA
3. **P2** (Roadmap): M9 Warranty, M10 Email, Nice-to-Haves

# Testing Strategy

- **Unit tests**: `cd apps/api && npx jest --coverage`
- **E2E tests**: `cd apps/web && npx playwright test`
- **Load testing**: k6 หรือ Artillery สำหรับ performance scenarios
