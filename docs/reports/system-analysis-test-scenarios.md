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
- Access token stored **in-memory** (SEC-08 ✅ FIXED — no longer in localStorage)
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
| S4 | **Access token ใน localStorage** — XSS attack อ่าน token ได้ | ~~MEDIUM~~ **✅ FIXED** | Token moved to in-memory JS variable (SEC-08 applied). One-time migration clears localStorage on first load. |
| S5 | **ไม่มี per-user login lockout** — brute-force ได้ถ้าเปลี่ยน IP | MEDIUM | Login fail 100 ครั้งจาก IP ต่างๆ กับ user เดียวกัน → ตรวจว่า account ไม่ถูก lock |
| S6 | **Refresh token cleanup แบบ probabilistic** — 1% chance ต่อ request → token เก่าสะสม | LOW | ตรวจจำนวน expired tokens หลัง 1000 refresh cycles |
| S7 | **ไม่มี password reset flow** — ถ้าลืม password ทำอย่างไร? | ~~MEDIUM~~ **⚠️ PARTIAL** | Endpoints (`POST /auth/forgot-password`, `POST /auth/reset-password`) and pages (`/forgot-password`, `/reset-password`) exist. BUT email delivery is a commented-out stub — tokens are generated but not delivered in production. No email service configured. |
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

## 1.4 Deep-Dive Edge Cases — วิเคราะห์เชิงลึกจาก Source Code

> วิเคราะห์จาก source code โดยตรง พร้อม line references เพื่อให้ทีม dev สามารถตรวจสอบและแก้ไขได้ทันที

### A. TOCTOU Race Conditions (Time-of-Check-Time-of-Use)

จุดวิกฤตที่ "ตรวจสอบ" กับ "ดำเนินการ" ไม่อยู่ภายใน atomic operation เดียวกัน — เปิดโอกาสให้ concurrent requests ทำให้ข้อมูลผิดพลาด

| # | จุดที่พบ | ไฟล์ & บรรทัด | ความรุนแรง | ผลกระทบ |
|---|---------|---------------|-----------|---------|
| D1 | **Payment TransactionRef Idempotency** — ตรวจ duplicate `transactionRef` **นอก** serializable transaction | `payments.service.ts:38-52` | CRITICAL | 2 requests พร้อมกันผ่าน check ทั้งคู่ → บันทึก payment ซ้ำ → เงินถูกหักเกิน |
| D2 | **Auth Token Rotation** — revoke old token → create new token ไม่อยู่ใน DB transaction | `auth.service.ts:64-110` | CRITICAL | ถ้า create fails หลัง revoke → user ถูก lock out; ถ้า 2 refresh พร้อมกัน → ได้ multiple valid tokens |
| D3 | **Stock Batch Number** — ใช้ `groupBy().count()` สร้าง batch number → 2 threads เห็น count เดียวกัน | `products-stock.service.ts:41-49` | HIGH | Batch number collision → supply chain tracking ผิด |

**รายละเอียดเชิงเทคนิค:**

**D1 — Payment TransactionRef (CRITICAL)**
```
// ❌ Check อยู่นอก transaction
if (transactionRef) {
  const existing = await this.prisma.payment.findFirst({  // Line 39 — อ่านนอก TX
    where: { contractId, notes: { contains: `ref:${transactionRef}` }, status: 'PAID' },
  });
  if (existing) throw new BadRequestException(`ธุรกรรมนี้ถูกบันทึกแล้ว`);
}

const updated = await this.prisma.$transaction(async (tx) => {  // Line 52 — TX เริ่มทีหลัง
  // ... record payment ...
});
```
**วิธีแก้**: ย้าย idempotency check เข้าไปใน `$transaction()` หรือสร้าง unique constraint บน `(contractId, transactionRef)`

**D2 — Token Rotation (CRITICAL)**
```
// ❌ 3 operations ไม่อยู่ใน TX เดียวกัน
const storedToken = await this.prisma.refreshToken.findUnique({ ... });  // Line 67
await this.prisma.refreshToken.update({ data: { revokedAt: new Date() } });  // Line 85
const newRefreshToken = await this.createRefreshToken(user.id, payload);  // Line 102
```
**วิธีแก้**: ใช้ `$transaction([revoke, createNew])` หรือ optimistic locking ด้วย version field

**D3 — Batch Number (HIGH)**
```
// ❌ Non-atomic counter
const distinctBatches = await tx.stockTransfer.groupBy({ by: ['batchNumber'], ... });
return `TRF-${year}-${month}-${String(distinctBatches.length + 1).padStart(3, '0')}`;
```
**วิธีแก้**: ใช้ PostgreSQL SEQUENCE หรือ `SELECT ... FOR UPDATE` เพื่อ lock counter

**Test Scenarios — TOCTOU:**
```
TC-D1: ส่ง 10 concurrent payment requests ด้วย transactionRef เดียวกัน
       → Expected: สำเร็จแค่ 1, อีก 9 ได้ 400 "ธุรกรรมนี้ถูกบันทึกแล้ว"
       → Actual risk: อาจสำเร็จมากกว่า 1

TC-D2: ส่ง 5 concurrent refresh token requests ด้วย token เดียวกัน
       → Expected: ได้ valid token ชุดเดียว, อีก 4 ได้ 401
       → Actual risk: อาจได้ multiple valid tokens

TC-D3: สร้าง 5 concurrent stock transfers ในเดือนเดียวกัน
       → Expected: batch numbers TRF-2026-03-001 ถึง TRF-2026-03-005 (ไม่ซ้ำ)
       → Actual risk: อาจได้ TRF-2026-03-001 ซ้ำหลายครั้ง
```

---

### B. Calculation & Rounding Edge Cases

ปัญหาเกี่ยวกับการคำนวณทางการเงินที่อาจทำให้ยอดเงินไม่ตรง

| # | ปัญหา | ไฟล์ & บรรทัด | ความรุนแรง | ตัวอย่างที่เกิดปัญหา |
|---|-------|---------------|-----------|---------------------|
| D4 | **Negative Last Installment** — `Math.ceil()` ทำให้ผลรวมงวดที่ 1 ถึง n-1 > financedAmount | `installment.util.ts:43,77` | HIGH | financedAmount=1.50, months=10 → last = -7.50 |
| D5 | **Floating-Point Precision** — IEEE 754 double ไม่แม่นยำกับเลขทศนิยม | `installment.util.ts:39-41` | MEDIUM | 8500 × 0.08 × 12 = 8160.000000000002 |
| D6 | **Due Day Feb Clamping** — paymentDueDay=31 ถูก clamp เป็น 28 ในกุมภาพันธ์ | `installment.util.ts:72-74` | LOW | ลูกค้าเลือกวันที่ 31 แต่ Feb ถูกเลื่อนเป็น 28 |

**รายละเอียด D4 — Negative Last Installment (HIGH):**
```javascript
// installment.util.ts:43
const monthlyPayment = Math.ceil(financedAmount / totalMonths);

// installment.util.ts:77 — งวดสุดท้ายคือยอดคงเหลือ
const amount = isLast ? financedAmount - monthlyPayment * (totalMonths - 1) : monthlyPayment;

// ตัวอย่างปัญหา:
// financedAmount = 1.50 (กรณีสินค้าราคาถูกมาก หลังหัก down payment)
// totalMonths = 10
// monthlyPayment = Math.ceil(1.50 / 10) = Math.ceil(0.15) = 1
// งวดสุดท้าย = 1.50 - (1 × 9) = 1.50 - 9 = -7.50 ❌ ติดลบ!
```
**วิธีแก้**: เพิ่ม validation `if (lastAmount <= 0) throw new Error()` หรือใช้ `Math.round()` แทน `Math.ceil()`

**รายละเอียด D5 — Floating-Point (MEDIUM):**
```javascript
// installment.util.ts:39-41
const interest = principal * interestRate * totalMonths;
const commission = principal * storeCommissionPct;
const vat = (principal + commission + interest) * vatPct;

// JavaScript floating-point ไม่แม่นยำ:
// 8500 * 0.08 * 12 → 8160.000000000002 (แทนที่จะเป็น 8160)
// สะสมจาก principal → interest → commission → VAT → financedAmount
// → Math.ceil อาจปัดเศษเกิน 1 บาท

// ผลกระทบสะสม: 1,000 สัญญา × ±1 บาท = ±1,000 บาท ต่อรอบ
```
**วิธีแก้**: ใช้ `Decimal.js` library หรือคำนวณเป็นสตางค์ (integer) แล้วหาร 100

**Test Scenarios — Calculation:**
```
TC-D4: สร้างสัญญา sellingPrice=100, downPayment=98.50, months=10
       → financedAmount ≈ 1.50 (หลังรวมดอกเบี้ย+VAT)
       → ตรวจว่างวดสุดท้ายไม่ติดลบ

TC-D5: คำนวณ 100 สัญญาที่ sellingPrice = 1,000 ถึง 100,000
       → sum(all installment amounts) ต้อง = financedAmount ทุกกรณี (tolerance ±0 บาท)

TC-D6: สัญญา paymentDueDay=31, เริ่มเดือน Jan 2026
       → ตรวจว่า:
         - Jan: วันที่ 31 ✓
         - Feb: วันที่ 28 (non-leap) ✓
         - Mar: วันที่ 31 ✓
         - Apr: วันที่ 30 ✓
```

---

### C. Input Validation Edge Cases

| # | ปัญหา | ไฟล์ & บรรทัด | ความรุนแรง |
|---|-------|---------------|-----------|
| D7 | **CSV Parser แบบ naive** — ใช้ `line.split(',')` ไม่ handle quoted fields | `payments.service.ts:479` | MEDIUM |
| D8 | **Late Fee Waiver Race** — check flag นอก transaction | `payments.service.ts:527-549` | MEDIUM |

**รายละเอียด D7 — CSV Parser (MEDIUM):**
```javascript
// payments.service.ts:479
const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));

// ❌ ปัญหาที่เกิด:
// Input: CN001,1,1000,"หมายเหตุ, มีจุลภาค",REF001
// Expected: ["CN001", "1", "1000", "หมายเหตุ, มีจุลภาค", "REF001"] (5 columns)
// Actual:   ["CN001", "1", "1000", "หมายเหตุ", "มีจุลภาค", "REF001"] (6 columns!)
```
**วิธีแก้**: ใช้ `papaparse` หรือ `csv-parser` library

**Test Scenarios — Input Validation:**
```
TC-D7: Import CSV ที่มี:
       Row 1: CN001,1,1000,"หมายเหตุ, มีจุลภาค",REF001 → ต้อง parse เป็น 5 fields
       Row 2: CN002,2,,"",REF002 → ต้อง handle empty field + empty quotes
       Row 3: CN003,3,5000,"ข้อมูล""ที่มี""quote",REF003 → ต้อง handle escaped quotes
       → ตรวจว่า import สำเร็จทั้ง 3 rows ไม่ error

TC-D8: ส่ง 2 concurrent waive late fee requests สำหรับ payment เดียวกัน
       → Expected: สำเร็จแค่ 1, อีก 1 ได้ "รายการนี้ยกเว้นค่าปรับแล้ว"
       → Actual risk: อาจสำเร็จทั้ง 2 → audit trail ผิด
```

---

### D. Auth & Session Edge Cases

| # | ปัญหา | ไฟล์ & บรรทัด | ความรุนแรง |
|---|-------|---------------|-----------|
| D9 | **Deactivated User ยัง Refresh ได้** — isActive check หลัง token validation | `auth.service.ts:76-82` | MEDIUM |
| D10 | **Password Reset ไม่มี Rate Limit** — spam 1000 requests สร้าง 1000 tokens | `auth.service.ts:145-179` | MEDIUM |
| D11 | **Guardian Age Boundary Shift** — age checked 2 ครั้ง แยก stage | `contracts.service.ts:580-687` | LOW |

**รายละเอียด D9 — Deactivated User (MEDIUM):**
```javascript
// auth.service.ts — refresh flow:
// 1. Find valid token in DB (line 67) ✓
// 2. Validate token not expired/revoked ✓
// 3. Revoke old token (line 85)
// 4. Find user and check isActive (line 76-82) ← อยู่หลัง revoke!

// ❌ Timeline ที่เป็นปัญหา:
// T=0: Admin deactivate user (isActive=false)
// T=1: User ส่ง refresh token → old token ถูก revoke
// T=2: isActive check → fail → throw 401
// ผลลัพธ์: Old token revoked แต่ new token ไม่ได้สร้าง → user lock out (correct)
// แต่ถ้า 2 refresh requests race → request แรก revoke + create ก่อน isActive check
```

**รายละเอียด D11 — Guardian Age Shift (LOW):**
```
Timeline ที่เป็นปัญหา:
- ลูกค้าเกิด 2006-03-20 (อายุ 19 ปี 362 วัน)
- 17 Mar 2026: Submit for review → age=19 → ต้องมี guardian ✓
- 20 Mar 2026: Activate contract → age=20 → ไม่ต้องมี guardian?
- แต่ code ที่ line 682 ยังตรวจ age → ไม่พบ guardian signature → block activation

ผลลัพธ์: สัญญาถูก approve แล้วแต่ activate ไม่ได้ เพราะ guardian requirement เปลี่ยน
(เป็น edge case ที่เกิดยากมาก แต่ควร document ไว้)
```

**Test Scenarios — Auth Edge Cases:**
```
TC-D9: Login → ให้ admin deactivate user (API) → ส่ง refresh token → ต้อง 401

TC-D10: ส่ง POST /auth/forgot-password ด้วย email เดียวกัน 50 ครั้งใน 60 วินาที
        → Expected: ถูก rate limit หลังจาก N ครั้ง
        → Actual risk: ทุก request สำเร็จ → DB เต็มด้วย tokens

TC-D11: สร้าง customer birthDate = (today - 19 years - 364 days)
        → สร้างสัญญา + submit for review (ต้องมี guardian)
        → รอ 2 วัน (จำลอง) → activate contract
        → ตรวจว่า guardian requirement ยังถูก enforce
```

---

## 1.5 Deep-Dive Security Analysis — ช่องโหว่เพิ่มเติมจาก Source Code

> เพิ่มเติมจาก section 1.2 — เจาะลึกจุดที่ยังไม่ได้ cover โดยอ้างอิง source code จริง

### A. Critical Security Issues

| # | ช่องโหว่ | ไฟล์ | ความรุนแรง | Attack Vector |
|---|---------|------|-----------|---------------|
| S11 | **IDOR — Cross-Branch Data Access** | หลายไฟล์ | HIGH | เปลี่ยน entity ID ใน URL เพื่อเข้าถึงข้อมูลสาขาอื่น |
| S12 | **Evidence URL Tampering** | `payments.service.ts` | HIGH | ส่ง evidenceUrl เป็น external URL หรือ path traversal |
| S13 | **Refresh Token Fallback Bug** | `auth.service.ts:237-289` | MEDIUM | DB path สร้าง hex token แต่ fallback path verify เป็น JWT → always fail |

**S11 — IDOR Cross-Branch (HIGH):**
```
Attack Scenario:
1. SALES login ที่สาขา A → ได้ JWT ที่มี branchId = "branch-a"
2. ส่ง GET /api/contracts/contract-id-of-branch-b
3. ถ้า controller ไม่ตรวจ branchId ของ contract กับ branchId ใน JWT → ดูข้อมูลสาขา B ได้

ตรวจสอบที่ต้องทำ:
- GET /api/contracts/:id → ต้องตรวจ contract.branchId === user.branchId
- GET /api/payments/:id → ต้องตรวจ payment.contract.branchId === user.branchId
- GET /api/customers/:id → ต้องตรวจ customer.branchId === user.branchId
- POST /api/payments → ต้องตรวจ contract อยู่ใน branch เดียวกัน
```

**S12 — Evidence URL Tampering (HIGH):**
```
Attack Scenario:
1. Record payment ด้วย evidenceUrl = "https://evil.com/fake-slip.jpg"
2. พนักงาน review slip → เห็น URL ที่ดูเหมือนจริง แต่เป็นรูปปลอม
3. หรือส่ง evidenceUrl = "../../etc/passwd" → path traversal

ตรวจสอบที่ต้องทำ:
- evidenceUrl ต้องเป็น relative path ภายใน /uploads/ เท่านั้น
- หรือ validate ว่าเป็น URL ของ domain ตัวเอง
- ไม่ควรมี "..", "://", หรือ absolute path
```

**S13 — Refresh Token Type Mismatch (MEDIUM):**
```javascript
// auth.service.ts — DB path (line 226):
const token = crypto.randomBytes(64).toString('hex');  // ← สร้างเป็น hex string

// auth.service.ts — Fallback JWT path (line 257-289):
async refreshTokenJwt(token: string) {
  const payload = this.jwtService.verify(token, { secret: ... });  // ← verify hex เป็น JWT → FAIL!
}

// ปัญหา: ถ้า DB unavailable → fallback พยายาม verify hex string เป็น JWT → always 401
// User experience: ถ้า DB down ชั่วคราว → ทุกคนถูก logout → ไม่สามารถ refresh ได้
```

### B. Medium Security Issues

| # | ช่องโหว่ | รายละเอียด | ความรุนแรง |
|---|---------|-----------|-----------|
| S14 | **National ID in Search Response** | ถ้า search customers by name → response อาจรวม nationalId (even if encrypted) | MEDIUM |
| S15 | **Prisma Error Information Leak** | Unique constraint error อาจ leak field name เช่น "email already exists" | MEDIUM |
| S16 | **No Password Strength Validation** | auth.service.ts ไม่ validate password complexity ตอน reset | MEDIUM |
| S17 | **forgotPassword ไม่ส่ง Email จริง** | Line 173-175 comment out → console.log only → ไม่มี reset flow จริง | MEDIUM |
| S18 | **Refresh Token Probabilistic Cleanup** | 1% chance cleanup per request → tokens สะสมไม่จำกัด → DB bloat | LOW |

**S16 — Password Strength (MEDIUM):**
```javascript
// auth.service.ts — resetPassword()
const hashedPassword = await bcrypt.hash(dto.newPassword, 10);  // ← ไม่ตรวจ strength
// ✗ ไม่มี: minimum length, uppercase, lowercase, number, special char
// ✗ ไม่มี: check against breached passwords (HaveIBeenPwned)
// ✗ ลูกค้าอาจตั้ง password เป็น "1234" ได้
```

**S17 — forgotPassword Not Sending Email (MEDIUM):**
```javascript
// auth.service.ts:173-175
// TODO: Send email with reset link
// In production, integrate with email service
this.logger.log(`Password reset token for ${dto.email}: ${token}`);
// ← Token ถูก log ไว้ใน console → ถ้า log ถูกเข้าถึง → compromise ได้
```

### C. Security Test Scenarios — ครบชุด

```
TC-S11: Login สาขา A (SALES role) → GET /api/contracts/:id ของสาขา B → ต้อง 403
TC-S12: Record payment ด้วย evidenceUrl = "https://evil.com/fake.jpg" → ต้อง reject
TC-S13: ส่ง random hex string 128 chars เป็น refresh token (ไม่ใช่ JWT) → ตรวจ error graceful
TC-S14: GET /api/customers?search=สมชาย → ตรวจว่า response ไม่มี plaintext nationalId field
TC-S15: POST /api/customers ด้วย email ซ้ำ → ตรวจ error message ไม่ leak field name
TC-S16: POST /api/auth/reset-password ด้วย newPassword="1" → ต้อง reject (too weak)
TC-S17: POST /api/auth/forgot-password → ตรวจว่ามี email ส่งจริง (ไม่ใช่แค่ console.log)
TC-S18: สร้าง 100 refresh tokens → ตรวจว่า expired tokens ถูก cleanup ภายใน 24 ชม.
```

### D. สรุปตาราง Risk Assessment — ทั้งหมด

| ลำดับ | ปัญหา | ความรุนแรง | ประเภท | แนะนำแก้ไข |
|------|-------|-----------|--------|-----------|
| D1 | TransactionRef check นอก TX | CRITICAL | Race Condition | ย้ายเข้า $transaction() |
| D2 | Token rotation ไม่ atomic | CRITICAL | Race Condition | ใช้ DB transaction |
| D3 | Batch number collision | HIGH | Race Condition | ใช้ DB SEQUENCE |
| S11 | IDOR cross-branch | HIGH | Authorization | เพิ่ม branch check ทุก endpoint |
| S12 | Evidence URL tampering | HIGH | Input Validation | Validate URL domain + path |
| D4 | Negative last installment | HIGH | Calculation | เพิ่ม validation |
| D5 | Floating-point precision | MEDIUM | Calculation | ใช้ Decimal.js |
| D7 | CSV naive parser | MEDIUM | Input Validation | ใช้ papaparse |
| D8 | Late fee waiver race | MEDIUM | Race Condition | Wrap ใน transaction |
| D9 | Deactivated user refresh | MEDIUM | Auth | Check isActive ก่อน revoke |
| D10 | Password reset no rate limit | MEDIUM | Brute Force | เพิ่ม rate limiter |
| S13 | Token type mismatch | MEDIUM | Auth Bug | แก้ fallback logic |
| S16 | No password strength | MEDIUM | Auth | เพิ่ม validation rules |
| S17 | Email not implemented | MEDIUM | Feature Gap | Implement email service |
| D6 | Due day Feb clamping | LOW | UX | เพิ่มหมายเหตุใน UI |
| D11 | Guardian age shift | LOW | Edge Case | Document + test |
| S18 | Token cleanup probabilistic | LOW | Maintenance | เพิ่ม cron job cleanup |

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

## 1.6 Deep-Dive Performance Analysis — วิเคราะห์จุดคอขวดเชิงลึก

> วิเคราะห์จาก source code + architecture pattern เพื่อประเมินผลกระทบเมื่อระบบมี data เยอะขึ้น

### A. Database Query Performance

| # | จุดคอขวด | ผลกระทบเมื่อ scale | วิธีแก้ | Effort |
|---|---------|-------------------|--------|--------|
| PD1 | **Dashboard N+1 queries** — หลาย `count()` + `aggregate()` query พร้อมกัน ไม่มี indexing strategy | 10K+ contracts → dashboard load > 5s | สร้าง composite indexes, ใช้ materialized view สำหรับ daily summary | Medium |
| PD2 | **Overdue Cron Full Table Scan** — scan ทุก ACTIVE contract ทุกวัน เพื่อคำนวณ late fee | 50K contracts → cron > 2 นาที, DB CPU spike 100% | Batch processing (1000 records/batch), partition table by status, cursor-based iteration | High |
| PD3 | **Contract List with Eager Loading** — include customer + payments + product ทุก row | 1000 contracts × 12 payments each = 12,000 payment rows loaded | ใช้ pagination + `select` เฉพาะ field ที่ต้องการ, lazy load payments | Medium |
| PD4 | **Audit Log Unbounded Growth** — log ทุก mutation ไม่มี archiving/partitioning | 1M+ records → query > 10s, table size > 5GB | เพิ่ม table partitioning by month, archive old logs to cold storage | Medium |

**รายละเอียด PD2 — Overdue Cron (ปัญหาหนักสุด):**
```
ปัจจุบัน:
1. Query: SELECT * FROM Contract WHERE status IN ('ACTIVE', 'OVERDUE')  ← full table scan
2. Loop: For each contract → query all installments → calculate late fee → update
3. ไม่มี batch/cursor → load ทั้งหมดใน memory
4. ไม่มี index บน (status, nextDueDate)

ผลกระทบเมื่อขยาย:
- 10 สาขา × 500 สัญญา/สาขา = 5,000 สัญญา → ~30 วินาที
- 10 สาขา × 5,000 สัญญา/สาขา = 50,000 สัญญา → ~5 นาที (timeout risk)
- DB connection pool exhausted ระหว่าง cron → user requests queue up

แนะนำ:
- เพิ่ม index: CREATE INDEX idx_contract_status_due ON "Contract" (status, "nextDueDate")
- Batch processing: process 500 records per batch with cursor
- Separate connection pool สำหรับ cron jobs
- Run outside business hours (e.g., 3 AM)
```

### B. Application-Level Bottlenecks

| # | จุดคอขวด | ผลกระทบ | วิธีแก้ | Effort |
|---|---------|---------|--------|--------|
| PD5 | **Receipt PDF Synchronous Generation** — สร้าง PDF ใน request-response cycle | ลูกค้ารอนาน, concurrent receipts ทำให้ CPU spike | ย้ายไป background queue (Bull/BullMQ), return receipt ID + status polling | High |
| PD6 | **Excel Export In-Memory** — fetch 10K records ใน memory → serialize เป็น Excel | Memory spike 200-500MB per export, crash ถ้า concurrent | Stream-based export (ExcelJS streaming), cursor-based data fetch | Medium |
| PD7 | **AI Credit Check No Circuit Breaker** — external API call ไม่มี fallback | Anthropic API down → credit check timeout → contract creation blocked | เพิ่ม circuit breaker (opossum), fallback to manual review, cache recent results | Medium |
| PD8 | **LINE Notification No Batching** — ส่งทีละ message ไม่ใช้ multicast API | 1000 notifications → 1000 HTTP calls → 30+ วินาที + rate limit risk | ใช้ LINE Messaging API multicast (max 500/request), retry with exponential backoff | Low |

### C. Frontend Performance

| # | จุดคอขวด | ผลกระทบ | วิธีแก้ |
|---|---------|---------|--------|
| PD9 | **Slip Review ไม่มี Virtual Scroll** — render 50+ images ในหน้าเดียว | Memory spike, scroll lag | ใช้ virtualized list (react-virtual), lazy load images |
| PD10 | **Contract Form No Debounce** — search customer/product ส่ง API ทุก keystroke | API overload, poor UX | เพิ่ม debounce 300ms บน search inputs |
| PD11 | **Bundle Size** — ไม่มี code splitting สำหรับ heavy pages (reports, POS) | Initial load > 3s | Dynamic import (`React.lazy()`) สำหรับ routes ที่ไม่ใช้บ่อย |

### D. Infrastructure Scaling Concerns

```
สถานการณ์ปัจจุบัน vs. เมื่อขยาย:

                     ปัจจุบัน (1-2 สาขา)    เป้าหมาย (10+ สาขา)
─────────────────────────────────────────────────────────────────
Users พร้อมกัน:      5-10 คน                 50-100 คน
Contracts:           500-1,000               10,000-50,000
Payments/เดือน:      500-1,000               5,000-50,000
API requests/วัน:    5,000-10,000            50,000-500,000
DB size:             < 1 GB                  5-20 GB
─────────────────────────────────────────────────────────────────

จุดที่จะเป็นปัญหาแรก (ตามลำดับ):
1. Overdue cron timeout (PD2) — เมื่อ contracts > 10,000
2. Dashboard load time (PD1) — เมื่อ contracts > 5,000
3. Receipt PDF generation (PD5) — เมื่อ concurrent payments > 20
4. Audit log query (PD4) — เมื่อ records > 500,000
5. Global rate limit 200/s (P1 เดิม) — เมื่อ users > 50 concurrent
```

**Performance Test Plan — ครบชุด:**
```
Tier 1 — Smoke Tests (ทุก deploy):
TC-PD1: Dashboard load < 3s กับ 1,000 contracts
TC-PD2: Contract list page < 2s กับ pagination
TC-PD3: Customer search < 1s กับ 10,000 records
TC-PD4: Payment recording < 3s end-to-end

Tier 2 — Load Tests (weekly):
TC-PD5: 20 concurrent users browsing + 5 recording payments → p95 < 5s
TC-PD6: Overdue cron กับ 10,000 contracts → complete < 60s
TC-PD7: Excel export 5,000 records → download < 15s, memory < 300MB

Tier 3 — Stress Tests (before major release):
TC-PD8: 100 concurrent payment recordings → all succeed, p99 < 10s
TC-PD9: 50,000 contracts → dashboard loads < 10s
TC-PD10: LINE notification broadcast 1,000 users → complete < 60s, no rate limit errors
TC-PD11: Overdue cron กับ 50,000 contracts → complete < 5 minutes
```

---

# Part 2: Feature Recommendations

> จาก production-ready website [bestchoicephone.app](https://bestchoicephone.app/) และ source code analysis
> วิเคราะห์จากมุมมอง Product Manager สำหรับอุตสาหกรรมร้านมือถือผ่อนชำระในประเทศไทย

## 2.1 Must-Have — ฟีเจอร์ที่ขาดไม่ได้

| # | ฟีเจอร์ | เหตุผล | Priority | Effort |
|---|---------|--------|---------|--------|
| M1 | **Real Payment Gateway Integration** (PromptPay, Credit Card) | ปัจจุบัน LIFF payment เป็น mock — ลูกค้าชำระจริงไม่ได้ ต้อง integrate Omise/2C2P/SCB API เพื่อรับเงินผ่าน QR PromptPay และบัตรเครดิต | P0 | High |
| M2 | **SMS Notification** | LINE ครอบคลุมแค่ลูกค้าที่ add LINE OA — SMS เป็นช่องทาง fallback สำหรับแจ้งค้างชำระ (ลูกค้ากลุ่ม installment มือถือราคาถูกอาจไม่ใช้ LINE) | P0 | Medium |
| M3 | **Receipt Number Concurrency Fix** | Race condition ทำให้เลขใบเสร็จซ้ำ (E1, D1) → ใช้ PostgreSQL SEQUENCE เพื่อ guarantee uniqueness | P0 | Low |
| M4 | **Automated Dunning/Collection Workflow** | ปัจจุบัน overdue tracking เป็น manual → ต้องมี auto-escalation ตามจำนวนวันค้างชำระ | P1 | High |
| M5 | **Overpayment Credit System** | ลูกค้าโอนเกินจำนวน → ระบบควรรับเงินแล้วเก็บเป็น credit balance apply งวดถัดไปอัตโนมัติ | P1 | Medium |
| M6 | **Database Backup & Disaster Recovery** | ข้อมูลการเงิน + สัญญา + ข้อมูลส่วนบุคคล (PDPA) สูญหายไม่ได้ → ต้องมี automated daily backup + point-in-time recovery | P1 | Medium |
| M7 | **Password Reset Flow (Email)** | ปัจจุบัน forgotPassword ไม่ส่ง email จริง (S17) → ต้อง implement email service | P1 | Medium |
| M8 | **Two-Factor Authentication (2FA)** | OWNER/BRANCH_MANAGER เข้าถึงข้อมูลการเงินทุกสาขา → ต้องมี 2FA (OTP via SMS/LINE) ตาม PDPA best practices | P1 | High |
| M9 | **Warranty/Service Tracking** | ร้านมือถือต้องจัดการ warranty → ลูกค้าเคลมเครื่องเสีย, ส่งซ่อม, เปลี่ยนเครื่อง, track สถานะ | P2 | High |
| M10 | **Email Integration** | ส่งใบเสร็จ, สรุปยอด, แจ้งเตือน ทาง email → ช่องทางเสริมนอกจาก LINE | P2 | Medium |

**รายละเอียด M4 — Automated Dunning Workflow:**
```
Auto-Escalation Timeline:
─────────────────────────────────────────────────────────
วันที่ 0    : ครบกำหนดชำระ → สถานะ PENDING
วันที่ +1   : แจ้งเตือน LINE + SMS "กรุณาชำระค่างวด"
วันที่ +3   : แจ้งเตือนซ้ำ "เลยกำหนดชำระ 3 วัน" + late fee เริ่มนับ
วันที่ +7   : สถานะ → OVERDUE, assign ทีมติดตามโทร
วันที่ +14  : ส่งจดหมายเตือน (auto-generate PDF)
วันที่ +30  : Dunning Stage 2 → โทรผู้ค้ำประกัน/บุคคลอ้างอิง
วันที่ +60  : สถานะ → DEFAULT, เริ่มกระบวนการยึดเครื่อง
วันที่ +90  : Dunning Stage 3 → ปิดสัญญา CLOSED_BAD_DEBT
─────────────────────────────────────────────────────────

Implementation:
- NestJS @Cron('0 8 * * *') รันทุกเช้า 8:00
- สร้าง DunningAction table track ทุก action + result
- Configurable timeline ต่อ branch (บางสาขาอาจ aggressive กว่า)
- Dashboard: "สัญญาที่ต้องติดตามวันนี้" sorted by severity
```

**รายละเอียด M5 — Overpayment Credit System:**
```
Flow ปัจจุบัน (มีปัญหา):
  ลูกค้าโอน 5,100 บาท (ค้าง 5,000) → ระบบ cap เหลือ 5,000 → เงินเกิน 100 หายไป

Flow ที่ควรจะเป็น:
  ลูกค้าโอน 5,100 บาท → ระบบรับ 5,100 → จ่ายงวด 5,000 → credit balance = 100
  งวดถัดไป (ค้าง 5,000) → auto-apply credit 100 → ลูกค้าจ่ายแค่ 4,900

Implementation:
- เพิ่ม creditBalance field ใน Contract model (มีแล้ว!)
- แก้ recordPayment() ให้ increment creditBalance แทน cap
- เพิ่ม applyCreditBalance() คำนวณอัตโนมัติตอน generate payment link
- แสดง credit balance ใน LIFF payment page + dashboard
```

---

## 2.2 Nice-to-Have — ฟีเจอร์เสริมที่สร้างความแตกต่าง

> เรียงตาม Impact × Feasibility สำหรับตลาดร้านมือถือผ่อนชำระไทย

### Tier A — High Impact, Medium Effort

| # | ฟีเจอร์ | ประโยชน์ | ทำไมสำคัญสำหรับตลาดไทย |
|---|---------|---------|------------------------|
| N1 | **LINE Chatbot สำหรับลูกค้า** | ลูกค้าเช็คยอดค้าง, ดูกำหนดชำระ, ส่งสลิป ผ่าน LINE chat | LINE มีผู้ใช้ 54M คนในไทย → ลูกค้าไม่ต้องโหลดแอปเพิ่ม, ลด call center 60%+ |
| N2 | **PromptPay Auto-Reconciliation** | เชื่อมต่อ bank API ตรวจยอดโอนอัตโนมัติ จับคู่กับ payment link | ปัจจุบันพนักงานต้อง manual review สลิปทุกรายการ → ลดเวลาจาก 5 นาที/รายการ เหลือ 0 |
| N3 | **AI-Powered Risk Scoring Dashboard** | แสดง risk score ของแต่ละสัญญา, predict โอกาสผิดนัดชำระ | ระบบมี Anthropic API อยู่แล้ว (credit check) → ต่อยอดเป็น risk prediction → จัดลำดับติดตามหนี้ |
| N4 | **Automated Financial Reports** | สร้าง report อัตโนมัติ (กำไร-ขาดทุน, aging, cash flow) ส่ง email/LINE ของ OWNER | OWNER ต้อง export data manual → ควร auto-generate ทุกวัน/สัปดาห์/เดือน |

### Tier B — Medium Impact, Low-Medium Effort

| # | ฟีเจอร์ | ประโยชน์ | ทำไมสำคัญสำหรับตลาดไทย |
|---|---------|---------|------------------------|
| N5 | **Customer Loyalty Program** | จ่ายตรงเวลา → สะสมแต้ม → ลดดอกเบี้ย/ส่วนลดอุปกรณ์เสริม | สร้าง retention, ลูกค้ากลับมาซื้อเครื่องใหม่ → lifetime value เพิ่ม |
| N6 | **ระบบ Trade-In Calculator** | คำนวณราคารับซื้อเครื่องเก่า, หักจาก down payment อัตโนมัติ | ร้านมือถือส่วนใหญ่รับเทิร์น → ถ้ามีระบบคำนวณ = ปิดการขายเร็วขึ้น |
| N7 | **Mobile App (PWA)** | พนักงาน SALES ใช้มือถือที่หน้าร้าน/ออกบูธ | PWA = ไม่ต้อง publish App Store, ทำงาน offline ได้, push notification |
| N8 | **QR Code Inventory Management** | Scan QR บนกล่องสินค้า → ดูข้อมูล + status ทันที | ลดเวลา search สินค้าใน stock จาก 30 วินาที เหลือ 3 วินาที |

### Tier C — Nice to Have, Higher Effort

| # | ฟีเจอร์ | ประโยชน์ | หมายเหตุ |
|---|---------|---------|---------|
| N9 | **Customer Self-Service Portal** | ลูกค้าดูสัญญา/จ่ายเงิน/download ใบเสร็จ ผ่านเว็บ (ไม่ต้องใช้ LINE) | เสริม LIFF, รองรับลูกค้าที่ไม่ใช้ LINE |
| N10 | **Real-time Dashboard (WebSocket)** | Dashboard update แบบ real-time ไม่ต้อง refresh | ดีสำหรับ OWNER ที่ monitor หลายสาขา |
| N11 | **Promotional Campaign Management** | สร้าง campaign: ดอกเบี้ย 0%, down 0%, bundle deals | เพิ่มยอดขายช่วง high season (ปีใหม่, สงกรานต์, iPhone launch) |
| N12 | **Integration กับระบบบัญชี** | Export เข้า PEAK/FlowAccount/Express | ลด manual entry, แต่ต้อง customize ต่อ software |
| N13 | **Returns & Refunds Workflow** | จัดการคืนสินค้า/คืนเงิน เชื่อมกับ stock + accounting | ซับซ้อน แต่จำเป็นเมื่อ scale |
| N14 | **Multi-Currency Support** | รองรับลูกค้าต่างชาติ/สาขาชายแดน | เฉพาะสาขาชายแดน (ลาว, กัมพูชา, พม่า) |

---

## 2.3 Competitive Analysis — เปรียบเทียบกับคู่แข่งในตลาด

```
ฟีเจอร์                    BESTCHOICE    คู่แข่ง A (ShopApp)    คู่แข่ง B (Manual/Excel)
─────────────────────────────────────────────────────────────────────────────────────
Contract Management              ✅              ✅                     ❌
IMEI Tracking                    ✅              ⚠️ (manual)            ❌
Credit Check (AI)                ✅              ❌                     ❌
LINE LIFF Payment                ✅              ❌                     ❌
Multi-Branch                     ✅              ✅                     ❌
PDPA Compliance                  ✅              ⚠️                     ❌
Automated Dunning                ⚠️ (partial)    ✅                     ❌
Real Payment Gateway             ❌ (mock)       ✅                     N/A
SMS Notification                 ❌              ✅                     ❌
2FA                              ❌              ✅                     N/A
Auto Financial Reports           ❌              ✅                     ❌
Trade-In System                  ❌              ❌                     ❌
─────────────────────────────────────────────────────────────────────────────────────

Key Differentiators ของ BESTCHOICE:
1. AI Credit Check — ไม่มีคู่แข่งมี
2. LINE LIFF Payment — customer-facing mobile experience
3. PDPA Compliance — legal requirement ที่หลายคู่แข่งยังไม่มี
4. IMEI + 6-angle Photo Tracking — ป้องกันการโกง

Gap ที่ต้องปิด (P0):
1. Real Payment Gateway — ไม่มี = ขายไม่ได้จริง
2. SMS Notification — ลูกค้าที่ไม่ใช้ LINE จะพลาดการแจ้งเตือน
3. Receipt Concurrency — ใบเสร็จซ้ำ = ปัญหาทางกฎหมาย
```

---

# Priority Roadmap

```
Phase 1 — "Go Live" (สัปดาห์ที่ 1-4)
├── M1: Real Payment Gateway (PromptPay + Credit Card)
├── M3: Receipt Number Concurrency Fix
├── M2: SMS Notification (ThaiBulkSMS/Twilio)
└── Critical bugs: D1 (TransactionRef race), D2 (Token rotation)

Phase 2 — "Operational Efficiency" (สัปดาห์ที่ 5-8)
├── M4: Automated Dunning Workflow
├── M5: Overpayment Credit System
├── M7: Password Reset (Email)
├── M6: Database Backup
└── Performance: PD2 (Overdue cron), PD1 (Dashboard indexes)

Phase 3 — "Scale & Security" (สัปดาห์ที่ 9-12)
├── M8: Two-Factor Authentication
├── N1: LINE Chatbot
├── N2: PromptPay Auto-Reconciliation
├── N4: Automated Financial Reports
└── Performance: PD5 (Receipt PDF queue), PD6 (Excel streaming)

Phase 4 — "Growth" (Q2+)
├── N3: AI Risk Scoring Dashboard
├── N5: Customer Loyalty Program
├── N6: Trade-In Calculator
├── M9: Warranty Tracking
└── Nice-to-haves: N7-N14 ตามความต้องการ
```

---

# Testing Strategy

```
Layer 1: Unit Tests
  cd apps/api && npx jest --coverage
  เป้าหมาย coverage: >80% สำหรับ services, >90% สำหรับ utils

Layer 2: Integration Tests
  cd apps/api && npx jest --config jest.integration.config.ts
  ทดสอบ API endpoints + database interactions

Layer 3: E2E Tests
  cd apps/web && npx playwright test
  ทดสอบ user flows: login → create contract → record payment → verify receipt

Layer 4: Load Tests
  k6 run load-tests/dashboard.js
  k6 run load-tests/payments.js
  ทดสอบ performance under concurrent load (20-100 users)

Layer 5: Security Tests
  npx playwright test e2e/security-edge-cases.spec.ts
  OWASP ZAP scan ทุก release
```
