# Prompt: Bug Testing & Edge Cases ทั้งระบบ BESTCHOICE

> ใช้ prompt นี้สั่ง AI ให้ตรวจหา bugs, race conditions, edge cases, security vulnerabilities ทั้งระบบ

---

```
คุณคือ Security & QA Auditor สำหรับระบบผ่อนชำระ BESTCHOICE (NestJS + React + Prisma + PostgreSQL)
ตรวจสอบ source code ทั้ง backend (apps/api) และ frontend (apps/web) อย่างละเอียด

## Tech Stack
- Backend: NestJS 10.4 + Prisma 6.19 + PostgreSQL 16
- Frontend: React 18.3 + Vite 6 + Tailwind CSS
- Auth: JWT (in-memory) + httpOnly refresh cookie + token rotation
- ORM: Prisma (no raw SQL)

## Review Reports ที่เคยทำไว้ (อ่านก่อนเริ่ม)
- docs/reports/REVIEW_REPORT.md — Health Score B-, 25 npm vulns, XSS risk
- docs/reports/system-analysis-test-scenarios.md — Edge cases 18+, security vulns 18+
- CODE_REVIEW_REPORT.md — Recent review PASS with 3 Low findings

## ===== CRITICAL BUGS ที่เคยพบ (ตรวจว่าแก้แล้วหรือยัง) =====

### Race Conditions (CRITICAL)
1. D1: Payment TransactionRef — ตรวจ duplicate นอก $transaction() → payment ซ้ำ
   ไฟล์: apps/api/src/modules/payments/payments.service.ts:38-52
   วิธีตรวจ: ดูว่า idempotency check อยู่ภายใน $transaction() หรือยัง

2. D2: Auth Token Rotation — revoke + create ไม่อยู่ใน DB transaction
   ไฟล์: apps/api/src/modules/auth/auth.service.ts:64-110
   วิธีตรวจ: ดูว่า revoke old → create new อยู่ใน $transaction() หรือยัง

3. E1: Receipt Number — 2 payments พร้อมกัน อ่าน sequence เดียวกัน → เลขซ้ำ
   ไฟล์: apps/api/src/modules/receipts/receipts.service.ts:13-33
   วิธีตรวจ: ดูว่าใช้ PostgreSQL SEQUENCE หรือ SELECT FOR UPDATE หรือยัง

4. E10: Stock Transfer Duplicate — duplicate check นอก transaction
   ไฟล์: apps/api/src/modules/products/products-stock.service.ts:81-86
   วิธีตรวจ: ดูว่า check + create อยู่ใน transaction เดียวกัน

### Financial Calculation Bugs (HIGH)
5. D4: Negative Last Installment — Math.ceil() ทำให้งวดสุดท้ายติดลบ
   ไฟล์: apps/api/src/utils/installment.util.ts:43,77
   วิธีตรวจ: ดูว่ามี validation lastAmount > 0

6. D5: Floating-Point — JS number ไม่แม่นยำกับเงิน (IEEE 754)
   ไฟล์: apps/api/src/utils/installment.util.ts:39-41
   วิธีตรวจ: ดูว่าใช้ Decimal.js หรือ integer (สตางค์) แทน float

7. E2: Overpayment Rejected — ลูกค้าโอนเกิน → reject ทั้งก้อน
   ไฟล์: apps/api/src/modules/payments/payments.service.ts:66-70
   วิธีตรวจ: ดูว่ารองรับ overpayment → credit balance

8. E3: Late Fee ไม่ recalculate ตอนชำระ — cron คำนวณแต่ถ้าจ่ายก่อน cron = 0
   ไฟล์: apps/api/src/modules/payments/payments.service.ts:61

### Security Vulnerabilities (HIGH)
9. SEC-01: DOMPurify XSS — version 3.3.1 มีช่องโหว่
   ไฟล์: apps/web/package.json
   วิธีตรวจ: ดู version >= 3.3.2

10. SEC-04: Missing @Roles() — Customer mutation endpoints ไม่มี role protection
    ไฟล์: apps/api/src/modules/customers/customers.controller.ts:42-49
    วิธีตรวจ: ดูว่า @Post() และ @Patch() มี @Roles() decorator

11. SEC-05: Missing @Roles() — Inspection mutation endpoints
    ไฟล์: apps/api/src/modules/inspections/inspections.controller.ts:84-96

12. SEC-09: Signature Input ไม่ validate — รับ raw base64 ไม่มี DTO
    ไฟล์: apps/api/src/modules/users/users.controller.ts:22

13. S1: File Upload ไม่ validate — ไม่ตรวจ file type/size/extension
    วิธีตรวจ: search ทุก @UseInterceptors(FileInterceptor) → ดูว่ามี fileFilter

14. S11: IDOR Cross-Branch — เปลี่ยน entity ID เข้าถึงข้อมูลสาขาอื่น
    วิธีตรวจ: ดูว่า GET/POST endpoints ตรวจ entity.branchId === user.branchId

15. S12: Evidence URL Tampering — ส่ง evidenceUrl เป็น external URL ได้
    ไฟล์: apps/api/src/modules/payments/payments.service.ts

### Auth & Session Bugs (MEDIUM)
16. D9: Deactivated User ยัง Refresh ได้ — isActive check หลัง token validation
    ไฟล์: apps/api/src/modules/auth/auth.service.ts:76-82

17. D10: Password Reset ไม่มี Rate Limit — spam 1000 requests สร้าง 1000 tokens
    ไฟล์: apps/api/src/modules/auth/auth.service.ts:145-179

18. S17: forgotPassword ไม่ส่ง Email จริง — console.log only
    ไฟล์: apps/api/src/modules/auth/auth.service.ts:173-175

## ===== สิ่งที่ต้องทำ =====

### ขั้นตอนที่ 1: ตรวจ CRITICAL bugs 18 จุดข้างบน
- อ่านไฟล์ที่ระบุ → ตรวจว่าแก้แล้วหรือยัง
- รายงาน: [FIXED] / [STILL BROKEN] / [PARTIALLY FIXED] พร้อม line number

### ขั้นตอนที่ 2: Scan หา bugs ใหม่
ค้นหาปัญหาเพิ่มเติมในหมวดเหล่านี้:

A. Race Conditions:
   - search: $transaction, findFirst + create/update ที่อยู่คนละ scope
   - ทุก sequence/counter generation (receipt, contract, batch number)

B. Financial Accuracy:
   - search: Math.ceil, Math.round, Math.floor ใน financial context
   - search: float/number ที่ใช้กับเงิน (ต้องเป็น Decimal)
   - ตรวจว่า sum(installments) === totalAmount ทุกกรณี

C. Authorization:
   - ทุก controller ต้องมี @UseGuards(JwtAuthGuard, RolesGuard)
   - ทุก method ที่ mutate data ต้องมี @Roles()
   - ตรวจ branch-level access control (branchId check)

D. Input Validation:
   - ทุก endpoint ที่รับ @Body() ต้องมี DTO + class-validator
   - File uploads ต้องตรวจ type + size
   - CSV parser ต้อง handle quoted fields (ไม่ใช่ naive split)

E. Error Handling:
   - search: catch block ที่ว่างเปล่า (swallow errors)
   - search: InternalServerErrorException ที่ leak internal details
   - ตรวจว่า transaction rollback ทำงานถูกต้อง

F. Frontend Security:
   - search: dangerouslySetInnerHTML → ต้องมี DOMPurify sanitize
   - search: localStorage ที่เก็บ sensitive data (token ต้องอยู่ in-memory)
   - ตรวจ XSS ใน user input ที่ render เป็น HTML

### ขั้นตอนที่ 3: Performance Bottlenecks
ตรวจจุดที่จะช้าเมื่อ scale:
- Dashboard queries ที่ไม่มี index → search: count(), aggregate() ใน service files
- N+1 queries → search: include ที่ load relation ทั้งหมด
- Missing pagination → search: findMany() ที่ไม่มี take/skip
- Cron jobs ที่ full table scan → search: @Cron ใน service files

### ขั้นตอนที่ 4: สรุปรายงาน
รายงานเป็นตาราง:

| # | ปัญหา | ไฟล์:บรรทัด | ความรุนแรง | สถานะ | แนะนำแก้ไข |
|---|-------|------------|-----------|-------|-----------|
| 1 | ... | ... | CRITICAL/HIGH/MEDIUM/LOW | FIXED/BROKEN | ... |

เรียงตาม severity: CRITICAL → HIGH → MEDIUM → LOW
แยกเป็น 2 กลุ่ม: (A) bugs เดิมที่เคยพบ (B) bugs ใหม่ที่เพิ่งพบ
```
