# CEO Roadmap — BESTCHOICE Next Phase
วันที่: 2026-04-15

## Executive Summary

แผนพัฒนา 3 ก้อนใหญ่ เรียงตาม revenue impact:
1. **Auto Dunning + Smart Collections** (เดือน 1-2) — เก็บเงินอัตโนมัติ
2. **Accounting Structure + PEAK Sync** (เดือน 2-3) — บัญชีถูกต้อง ปิดบัญชีเองได้
3. **UI Redesign (Metronic)** (เดือน 4-6) — ปรับทั้งระบบ 78+ หน้า

แนวทาง: **Revenue First** — แก้ปัญหาเงินค้างชำระก่อน แล้วค่อยแก้โครงสร้างบัญชี แล้วปรับ UI ทั้งระบบ

---

## Part 1: Auto Dunning + Smart Collections

### ปัญหา
- ทวงหนี้ manual ทั้งหมด — พนักงานเปิดดูรายชื่อค้างชำระ แล้วทักทีละคน
- ไม่มี reminder ก่อนถึงวันครบกำหนด
- ไม่มี escalation — ค้าง 1 งวดกับ 5 งวดได้รับการปฏิบัติเหมือนกัน
- ไม่มี tracking ว่าทวงไปกี่ครั้ง ผลเป็นยังไง

### 1.1 Dunning Rules Engine

ระบบ rule-based ที่ Owner ตั้งค่าได้ผ่านหน้า Settings:

```
ก่อนครบกำหนด:
  D-3  → LINE แจ้งเตือน "งวดที่ X ครบกำหนดอีก 3 วัน" + ลิงก์จ่ายเงิน (PaySolutions QR)
  D-1  → SMS แจ้งเตือน "พรุ่งนี้ครบกำหนดชำระ"

หลังเกินกำหนด:
  D+1  → LINE "เลยกำหนดชำระ 1 วัน กรุณาชำระโดยเร็ว" + QR
  D+3  → SMS ทวงครั้ง 2
  D+7  → LINE + สร้าง call task ให้พนักงานโทร
  D+14 → LINE แจ้งค่าปรับ + assign ให้ FINANCE_MANAGER review
  D+30 → แจ้งเตือน MDM lock (manual approve ก่อน lock จริง)
  D+90 → flag เป็น bad debt candidate
```

**Data model:**
```prisma
model DunningRule {
  id            String   @id @default(uuid())
  name          String                           // เช่น "แจ้งเตือน 3 วันก่อนกำหนด"
  triggerDay    Int                              // D-3 = -3, D+7 = 7
  channel       DunningChannel                   // LINE, SMS, CALL_TASK, INTERNAL_ALERT
  messageTemplate String                         // template with {{variables}}
  includePaymentLink Boolean @default(false)
  autoExecute   Boolean  @default(true)          // true=ส่งอัตโนมัติ, false=สร้าง task ให้พนักงาน
  escalateTo    UserRole?                        // assign ให้ role ไหน review
  isActive      Boolean  @default(true)
  sortOrder     Int
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?
}

enum DunningChannel {
  LINE
  SMS
  CALL_TASK
  INTERNAL_ALERT
  MDM_LOCK_REQUEST
}
```

**Cron job:** `DunningCronService` รันทุกเช้า 08:00
- Query installments ที่ dueDate match กับ dunning rules
- สร้าง `DunningAction` records
- Execute ทันที (LINE/SMS) หรือสร้าง task (CALL_TASK)
- Dedup: ไม่ส่งซ้ำถ้า action สำหรับ installment+rule นั้นมีอยู่แล้ว

### 1.2 Collection Pipeline (Kanban)

```
[ปกติ] → [เตือนแล้ว] → [ค้างชำระ] → [ทวงแล้ว] → [นัดจ่าย] → [ส่งต่อ FM] → [MDM Lock] → [ยึดเครื่อง]
```

**Data model:**
```prisma
model CollectionCase {
  id            String           @id @default(uuid())
  contractId    String
  contract      Contract         @relation(fields: [contractId], references: [id])
  stage         CollectionStage  @default(NORMAL)
  assignedToId  String?
  assignedTo    User?            @relation(fields: [assignedToId], references: [id])
  totalOverdue  Decimal          @db.Decimal(12, 2)
  overdueCount  Int              // จำนวนงวดค้าง
  lastContactAt DateTime?
  lastContactResult String?      // รับสาย/ไม่รับ/นัดจ่าย
  promiseDate   DateTime?        // ลูกค้านัดจ่ายวันไหน
  notes         String?
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  deletedAt     DateTime?

  actions       DunningAction[]
}

enum CollectionStage {
  NORMAL
  REMINDED
  OVERDUE
  CONTACTED
  PROMISE_TO_PAY
  ESCALATED_FM
  MDM_LOCKED
  REPOSSESSION
}
```

- Kanban UI: drag-drop เลื่อน stage ได้
- Auto-advance: cron เลื่อน stage ตาม dunning rules
- แต่ละ card: ชื่อลูกค้า, ค้างกี่งวด, ยอดค้าง, ทวงกี่ครั้ง, ครั้งล่าสุดเมื่อไหร่

### 1.3 Communication Log

```prisma
model DunningAction {
  id              String        @id @default(uuid())
  collectionCaseId String
  collectionCase  CollectionCase @relation(fields: [collectionCaseId], references: [id])
  dunningRuleId   String?
  dunningRule     DunningRule?  @relation(fields: [dunningRuleId], references: [id])
  channel         DunningChannel
  status          DunningActionStatus @default(PENDING)
  messageContent  String?
  result          String?       // delivered, failed, answered, no_answer, promise_to_pay
  executedAt      DateTime?
  executedById    String?
  executedBy      User?         @relation(fields: [executedById], references: [id])
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  deletedAt       DateTime?
}

enum DunningActionStatus {
  PENDING
  EXECUTING
  COMPLETED
  FAILED
  SKIPPED
}
```

### 1.4 Dashboard Metrics

เพิ่มใน Dashboard:
- Aging buckets: 1-7, 8-14, 15-30, 31-60, 61-90, 90+ วัน (จำนวนสัญญา + ยอดเงิน)
- Collection rate %: เดือนนี้ vs เดือนก่อน (MoM)
- Recovery amount: ยอดเงินที่เก็บได้หลังทวง
- Top 10 ลูกค้าค้างสูงสุด
- Dunning effectiveness: อัตราจ่ายหลังได้รับแจ้งเตือนแต่ละ channel

### 1.5 ต่อยอดจากของเดิม

| ของที่มีอยู่ | ใช้ยังไง |
|-------------|---------|
| `notifications.service.ts` | ส่ง SMS |
| `line-oa` module | ส่ง LINE messages |
| `chatbot-finance` | AI ตอบลูกค้าเมื่อถามยอดค้าง |
| PaySolutions QR | แนบ payment link ในข้อความ |
| `overdue` module | data source สำหรับ Collection Cases |
| `bad-debt.service.ts` | เชื่อมกับ D+90 bad debt flag |

---

## Part 2: Accounting Structure + PEAK Sync

### ปัญหา
- Payment ไม่แยก principal / interest / commission / VAT — เก็บเป็นก้อนเดียว
- Journal entries รวมยอดไม่ถูกต้องตาม TFRS for NPAEs
- ปิดบัญชีรายเดือนต้อง manual
- PEAK module มีแล้วแต่ journal structure ยังไม่พร้อม

### 2.1 Payment Restructure

เพิ่ม fields ใน Payment model:
```prisma
model Payment {
  // existing fields...
  principalAmount   Decimal? @db.Decimal(12, 2)
  interestAmount    Decimal? @db.Decimal(12, 2)
  commissionAmount  Decimal? @db.Decimal(12, 2)
  vatAmount         Decimal? @db.Decimal(12, 2)
  lateFeeAmount     Decimal? @db.Decimal(12, 2)
}
```

- `generatePaymentSchedule()` คำนวณแยกทุกส่วนตั้งแต่เปิดสัญญา
- Migration script: backfill payments ที่มีอยู่จากข้อมูลสัญญา (คำนวณย้อนหลัง)
- Fields เป็น optional เพื่อ backward compatibility กับ records เก่า

### 2.2 Journal Auto-generation

ปรับ `JournalAutoService` ให้สร้าง journal ที่ถูกต้อง:

| Event | Dr | Cr |
|-------|----|----|
| **ลูกค้าจ่ายงวด** | Cash [amountPaid] | HP Receivable [principal+interest+commission], VAT Output [vat], Late Fee Income [lateFee] |
| **เปิดสัญญา** | HP Receivable [financedAmount+interest+commission+VAT] | Revenue [sellingPrice+interest+commission], VAT Output [vat]. Dr COGS [costPrice] / Cr Inventory [costPrice] |
| **ตัดหนี้สูญ** | Bad Debt Expense [writeOff-provision], Allowance for Doubtful [provision] | HP Receivable [writeOff] |
| **จ่ายค่าใช้จ่าย** | Expense [amount excl VAT], VAT Input [vat] | Cash [total] |
| **Inter-company** | SHOP Receivable from FINANCE | FINANCE Payable to SHOP |

ทุก journal: `sum(Dr) === sum(Cr)` — throw + Sentry ถ้าไม่ balance (มีอยู่แล้ว)

### 2.3 VAT Tracking แยก Entity

```
SHOP (ไม่จด VAT):
  - ขายเงินสด → ไม่คิด VAT
  - รับดาวน์ → ไม่คิด VAT

FINANCE (จด VAT 7%):
  - ค่างวด → VAT 7% ของ (principal + interest + commission)
  - ค่าปรับ → ไม่คิด VAT (policy decision)
```

- Monthly VAT summary อัตโนมัติ → ใช้ยื่น ภ.พ.30
- Tax report page แสดง VAT Input vs Output แยกตามเดือน
- CR-001 (VAT on interest ตาม ม.81(1)(ช)) ยังคง deferred — รอนักบัญชีตัดสินใจ

### 2.4 Monthly Close Workflow

```
1. ระบบสร้าง draft → รวม journal ทั้งเดือน
2. Data Audit check → ตรวจ unbalanced entries, missing journals
3. FINANCE_MANAGER review → approve หรือ flag issues
4. Generate reports → P&L, Balance Sheet, Trial Balance, VAT Summary
5. PEAK Sync → export approved journals ไป PEAK
6. Lock period → ห้ามแก้ไข journal ในเดือนที่ปิดแล้ว
```

**Data model:**
```prisma
model AccountingPeriod {
  id          String               @id @default(uuid())
  year        Int
  month       Int
  status      AccountingPeriodStatus @default(OPEN)
  closedById  String?
  closedBy    User?                @relation(fields: [closedById], references: [id])
  closedAt    DateTime?
  peakSyncedAt DateTime?
  notes       String?
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt

  @@unique([year, month])
}

enum AccountingPeriodStatus {
  OPEN
  REVIEW
  CLOSED
  SYNCED
}
```

### 2.5 PEAK Sync

`PeakService` มีอยู่แล้ว — ต้องทำเพิ่ม:
- ใส่ credentials ใน env (`PEAK_USER_TOKEN`, `PEAK_CONNECT_ID`, `PEAK_SECRET_KEY`)
- เพิ่ม sync status dashboard: exported / pending / error per period
- เพิ่ม retry mechanism สำหรับ entries ที่ fail
- เพิ่ม manual re-sync button สำหรับ OWNER/ACCOUNTANT
- Account codes map 1:1 กับ PEAK format (`XX-XXXX`) อยู่แล้ว

---

## Part 3: UI Redesign (Metronic ทั้งระบบ)

### ปัญหา
- UI ใช้ Radix + Tailwind ประกอบเอง — ไม่มี design system กลาง
- หน้าตาแต่ละหน้าไม่ consistent
- 78+ pages ไม่มี component library ที่ reuse ได้ง่าย

### แนวทาง: Progressive Migration ตาม Dependency

ทุกหน้า priority สูงเท่ากัน — จัดกลุ่มตาม dependency (ต้องสร้าง foundation ก่อนถึงจะทำหน้าอื่นได้):

**Group 0: Foundation (ต้องทำก่อน)**
- Metronic theme tokens (colors, typography, spacing, shadows)
- Core components: Button, Input, Select, Badge, Card, Modal, DataTable, Sidebar, TopBar, Breadcrumb
- MainLayout redesign + Dark mode
- Design system reference: `/Users/iamnaii/Desktop/App/metronic-template`

**Group 1: Operations**
- Dashboard (5 role-specific layouts)
- POS Page
- Customers + Customer Detail
- Contracts + Contract Create + Contract Detail + Contract Sign + Contract Verify
- Payments + CSV Import + Receipts

**Group 2: Collections & Inventory**
- Overdue + Collection Pipeline (ใหม่จาก Part 1)
- Slip Review + Exchange + Repossessions
- Stock + Transfers + Alerts + Count + Adjustments
- Products + Product Create + Product Detail
- Suppliers + Supplier Detail + Purchase Orders

**Group 3: Finance & Reports**
- Finance Receivable + Finance Portfolio
- Commissions + Expenses
- Tax Reports + P&L + Chart of Accounts + Financial Audit
- Trade-In + Promotions + Credit Checks

**Group 4: Communication**
- Unified Inbox (chat system)
- LINE OA Settings + SMS Settings
- Notifications + Canned Responses
- Chatbot Finance (Analytics, Sessions, Knowledge, Learning)
- Chat Analytics + Ads Tracking

**Group 5: Admin**
- Users + Branches + Company Settings
- Contract Templates + Pricing Templates + Interest Config
- Audit Logs + System Status + Webhooks
- PDPA + Document Dashboard + Migration
- Landing + Login + Forgot/Reset Password + Register Invite

**Group 6: LIFF (Customer Mobile)**
- Contract, History, Profile, Early Payoff, Register
- Customer Portal + Customer Access
- Receipt Verify + Payment links
- Mobile-first design

### หลักการ Redesign
- **Metronic v9** เป็น design system หลัก
- **Component-first** — สร้าง shared components ก่อน ทุกหน้าประกอบจาก components เดียวกัน
- **Progressive migration** — หน้าเก่ายังใช้ได้ระหว่าง transition
- **Mobile responsive** — ทุกหน้าใช้บน tablet/มือถือได้
- **Status/priority colors** — design tokens กลาง ไม่ hardcode
- **Dark mode** — ตั้งแต่ foundation

---

## Timeline

```
2026 เม.ย. - พ.ค.  ┃ Part 1: Auto Dunning + Smart Collections
                    ┃   - Dunning Rules Engine + Cron
                    ┃   - Collection Pipeline (Kanban)
                    ┃   - Communication Log
                    ┃   - Dashboard Metrics
                    ┃
2026 พ.ค. - มิ.ย.  ┃ Part 2: Accounting Structure + PEAK Sync
                    ┃   - Payment restructure + migration
                    ┃   - Journal auto-generation fix
                    ┃   - VAT tracking + ภ.พ.30
                    ┃   - Monthly Close workflow
                    ┃   - PEAK Sync activation
                    ┃
2026 ก.ค. - ก.ย.   ┃ Part 3: UI Redesign (Metronic)
                    ┃   - Group 0: Foundation + Design System
                    ┃   - Group 1: Operations (Dashboard, POS, Contracts, Payments)
                    ┃   - Group 2: Collections & Inventory
                    ┃   - Group 3: Finance & Reports
                    ┃   - Group 4: Communication
                    ┃   - Group 5: Admin
                    ┃   - Group 6: LIFF (Customer Mobile)
```

---

## Deferred Items (ไม่อยู่ใน scope นี้)

| Item | เหตุผล |
|------|--------|
| CR-001: VAT on interest (ม.81(1)(ช)) | รอนักบัญชีตัดสินใจ |
| N-005: Interest upfront vs accrual | ต้อง CPA review |
| GFIN integration | รอ API spec จาก partner |
| MDM PJ-Soft auto-lock | รอ API credentials — D+30 rule สร้าง request เฉยๆ ยังไม่ lock จริง |
| SaaS / Multi-tenant | อนาคต — ต้อง validate product-market fit ก่อน |
| Native mobile app | ประเมินหลัง PWA + LIFF redesign เสร็จ |

---

## Success Criteria

| Metric | Before | Target |
|--------|--------|--------|
| Collection rate | ไม่มีข้อมูล (manual) | >85% ภายใน 30 วัน |
| เวลาปิดบัญชี/เดือน | >10 ชม. manual | <1 ชม. (review + approve) |
| PEAK sync | manual export | auto monthly |
| UI consistency | ไม่มี design system | 100% Metronic components |
| พนักงาน training time | ไม่มีข้อมูล | ลด 50% (UX ง่ายขึ้น) |
