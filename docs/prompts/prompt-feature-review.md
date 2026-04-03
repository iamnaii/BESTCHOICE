# Prompt: Feature Review & Recommendations ก่อน Deploy

> ใช้ prompt นี้สั่ง AI ให้ review ทั้งโปรแกรม แนะนำฟีเจอร์ที่ควรมี/ปรับปรุงก่อน deploy จริง

---

```
คุณคือ Product Manager + Tech Lead สำหรับระบบผ่อนชำระ BESTCHOICE
ระบบนี้ใช้ในร้านมือถือในไทย (5+ สาขา) จัดการสัญญาผ่อนชำระ, สต็อก, การเงิน, ติดตามหนี้

## Tech Stack
- Frontend: React 18 + TypeScript + Vite 6 + Tailwind CSS
- Backend: NestJS + Prisma + PostgreSQL
- Integrations: LINE LIFF, Anthropic AI (OCR, Credit Check), S3 Storage

## สถานะปัจจุบัน (จาก IMPLEMENTATION-GUIDE.md)
- Phase 1-6 ✅ สมบูรณ์ (Foundation → Core Business → Operations → Communication → Intelligence → Polish)
- Health Score: B- (จาก REVIEW_REPORT.md)

## Known Gaps ที่ยังไม่ได้แก้
1. Password reset email: endpoints exist แต่ไม่ส่ง email จริง (console.log only)
2. LIFF payment: เป็น mock — ลูกค้าชำระจริงไม่ได้
3. Receipt number race condition → เลขใบเสร็จอาจซ้ำ
4. 25 npm vulnerabilities (12 high severity)
5. Missing @Roles() decorator บน customer/inspection mutation endpoints
6. Floating-point precision ในการคำนวณงวด (ใช้ JS number แทน Decimal)

## ฟีเจอร์ที่มีอยู่แล้ว (46 API modules, 57 pages)

### ขาย
- POS ขายสินค้า, ประวัติการขาย, ลูกค้า, ตรวจเครดิต (AI)

### สัญญาผ่อน
- สัญญาผ่อน (wizard 5 ขั้นตอน), ชำระเงิน, สถานะเอกสาร
- E-Signature, contract templates, auto-calculate installments

### ติดตามหนี้
- ติดตามหนี้ (4 dunning stages), เปลี่ยนเครื่อง, ยึดคืน & ขายต่อ
- Late fee calculation (cron), call logs

### การเงิน
- ใบเสร็จรับเงิน, ตรวจสอบสลิป, นำเข้า CSV, เงินรับจากไฟแนนซ์
- บันทึกรายจ่าย, งบกำไรขาดทุน

### คลังสินค้า & จัดซื้อ
- คลังสินค้า, โอนสาขา, ปรับสต็อก, ตรวจนับ, แจ้งเตือนสต็อก
- ขั้นตอนสต็อก (workflow), ตรวจสอบสินค้า (6-angle photos)
- สั่งซื้อ (PO lifecycle), ผู้ขาย

### รายงาน
- รายงาน (financial), แจ้งเตือน (LINE + SMS templates)

### ตั้งค่า & ระบบ
- สาขา, จัดการผู้ใช้ (invite system), ตั้งค่าระบบ
- ราคาตั้งต้น, เทมเพลตสัญญา, PDPA
- Audit Logs, Financial Audit, สถานะระบบ, นำเข้าข้อมูล (migration)

### Integrations
- LINE LIFF (contract, payment, history, profile, register, early payoff)
- AI OCR (ID card, payment slip, driving license, book bank)
- AI Credit Check (risk scoring)
- S3 Storage (MinIO in dev)

## Competitive Landscape
- คู่แข่ง A (ShopApp): มี Real Payment Gateway, SMS, 2FA, Auto Dunning
- คู่แข่ง B (Manual/Excel): ไม่มีระบบ
- BESTCHOICE differentiators: AI Credit Check, LINE LIFF, PDPA, IMEI tracking

## User Roles
- OWNER — Full access, ดูทุกสาขา
- BRANCH_MANAGER — Branch-level operations
- ACCOUNTANT — การเงิน, รายงาน
- SALES — ขาย, สัญญา, คลัง(ดูอย่างเดียว)

## ===== สิ่งที่ต้องทำ =====

### Part 1: Review ทั้งโปรแกรม
อ่าน source code ทั้ง backend และ frontend แล้วให้คะแนน 1-10 ในหัวข้อเหล่านี้:

| หมวด | คะแนน | เหตุผล |
|------|-------|--------|
| Security | ?/10 | Auth, RBAC, input validation, XSS, CSRF |
| Code Quality | ?/10 | Structure, naming, DRY, error handling |
| Performance | ?/10 | Queries, indexing, caching, pagination |
| UX/UI | ?/10 | Responsiveness, Thai text, error messages, loading states |
| Test Coverage | ?/10 | E2E, unit tests, edge cases |
| Documentation | ?/10 | API docs, README, deployment guides |
| Scalability | ?/10 | Can handle 10+ branches, 50K+ contracts |
| Business Logic | ?/10 | Financial calculations, workflow correctness |

### Part 2: Must-Fix ก่อน Deploy (จัดลำดับ P0-P2)

ระบุสิ่งที่ต้องแก้ก่อน deploy จริง เรียงตาม priority:

**P0 — ต้องแก้ก่อน go-live (ห้าม deploy ถ้ายังไม่แก้)**
- Race conditions ที่ทำให้ข้อมูลเงินผิด
- Security vulnerabilities ที่เป็น critical/high
- Known gaps ที่ block user flow

**P1 — ควรแก้ภายใน 2 สัปดาห์หลัง go-live**
- Performance bottlenecks ที่จะเกิดเมื่อมีข้อมูลมาก
- UX issues ที่ทำให้พนักงานทำงานช้า
- Missing features ที่คู่แข่งมี

**P2 — Nice to have (ภายใน 1-3 เดือน)**
- Feature enhancements
- Code quality improvements

### Part 3: Feature Recommendations

แนะนำฟีเจอร์ใหม่ที่ควรมี จัดเป็น 3 กลุ่ม:

**A. ฟีเจอร์ที่ขาดไม่ได้ (Must-Have)**
สำหรับร้านมือถือผ่อนชำระในไทย — ถ้าไม่มีจะ compete ไม่ได้

ฟีเจอร์ที่เคยแนะนำไว้ (ตรวจว่ามีแล้วหรือยัง):
- M1: Real Payment Gateway (PromptPay, Credit Card) — ปัจจุบัน LIFF เป็น mock
- M2: SMS Notification — fallback สำหรับลูกค้าที่ไม่ใช้ LINE
- M3: Receipt Number Concurrency Fix — เลขใบเสร็จซ้ำ = ปัญหากฎหมาย
- M4: Automated Dunning Workflow — auto-escalation ตามวันค้างชำระ
- M5: Overpayment Credit System — ลูกค้าโอนเกิน → credit balance
- M6: Database Backup & Disaster Recovery
- M7: Password Reset Flow (Email)
- M8: Two-Factor Authentication (2FA)
- M9: Warranty/Service Tracking
- M10: Email Integration

**B. ฟีเจอร์เสริม (Nice-to-Have)**
- N1: LINE Chatbot — ลูกค้าเช็คยอด/ส่งสลิปผ่าน LINE chat
- N2: PromptPay Auto-Reconciliation — ตรวจยอดโอนอัตโนมัติ
- N3: AI Risk Scoring Dashboard — predict โอกาสผิดนัด
- N4: Automated Financial Reports — auto-generate ทุกวัน/สัปดาห์
- N5: Customer Loyalty Program — จ่ายตรงเวลา → สะสมแต้ม
- N6: Trade-In Calculator — คำนวณราคารับซื้อเครื่องเก่า
- N7: Mobile App (PWA) — ใช้มือถือที่หน้าร้าน
- N8: QR Code Inventory — scan QR ดูข้อมูลสินค้าทันที

**C. ฟีเจอร์ระยะยาว (Growth)**
- N9: Customer Self-Service Portal (เว็บ ไม่ต้องใช้ LINE)
- N10: Real-time Dashboard (WebSocket)
- N11: Promotional Campaign Management
- N12: Integration กับระบบบัญชี (PEAK/FlowAccount)
- N13: Returns & Refunds Workflow
- N14: Multi-Currency Support

### Part 4: Deployment Readiness Checklist

ตรวจรายการเหล่านี้แล้วรายงาน:
- [ ] TypeScript compile ผ่านทั้ง api + web (./tools/check-types.sh all)
- [ ] E2E tests ผ่าน (cd apps/web && npx playwright test)
- [ ] npm audit — vulnerabilities ที่เป็น critical/high แก้แล้ว
- [ ] Environment variables ครบ (ดู .env.example)
- [ ] S3 storage configured
- [ ] Database migrations up to date
- [ ] CORS settings ถูกต้องสำหรับ production domain
- [ ] Rate limiting เหมาะสม (200 req/sec global, 30/min login)
- [ ] Audit logging ทำงาน
- [ ] PDPA consent flow ทำงาน
- [ ] LINE LIFF configured กับ production LIFF ID
- [ ] Backup strategy configured
- [ ] Error monitoring (Sentry/similar) setup
- [ ] SSL/HTTPS configured

### Part 5: Priority Roadmap

สร้าง roadmap 12 สัปดาห์:

Phase 1 — "Go Live" (สัปดาห์ 1-4):
  ← fix critical bugs + must-have features

Phase 2 — "Operational Efficiency" (สัปดาห์ 5-8):
  ← performance fixes + automation features

Phase 3 — "Scale & Security" (สัปดาห์ 9-12):
  ← security hardening + growth features

แต่ละ phase ระบุ: feature list, effort estimate (Low/Medium/High), dependencies
```
