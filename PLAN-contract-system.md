# แผนการพัฒนาระบบสัญญาผ่อนชำระ (Enhanced Contract System)

## สรุปภาพรวม

ปรับปรุงระบบสัญญาผ่อนชำระให้มี **Workflow สองฝ่าย** (ฝ่ายสร้างสัญญา vs ฝ่ายตรวจสอบ), รองรับ **ดอกเบี้ย/เงินดาวน์แยกตามประเภทสินค้า**, **กำหนดวันครบกำหนดชำระตามวันเงินเดือนออก**, **ตรวจสอบเครดิตลูกค้าด้วย AI**, **สถานะสัญญาแบบ Workflow**, **แนบ PDF สัญญาที่ลูกค้าเซ็น** และ **แนบเอกสาร KYC เพิ่มเติม**

---

## 1. Database Schema Changes (Prisma Migration)

### 1.1 เพิ่ม Enum ใหม่

```prisma
enum ContractWorkflowStatus {
  CREATING        // กำลังสร้าง - พนักงานขายกำลังกรอกข้อมูล
  PENDING_REVIEW  // รอตรวจสอบ - ส่งให้ฝ่ายตรวจสอบแล้ว
  APPROVED        // อนุมัติ - ฝ่ายตรวจสอบอนุมัติแล้ว
  REJECTED        // ปฏิเสธ - ฝ่ายตรวจสอบปฏิเสธ (ส่งกลับแก้ไข)
}

enum CreditCheckStatus {
  PENDING         // รอตรวจสอบ
  APPROVED        // ผ่าน
  REJECTED        // ไม่ผ่าน
  MANUAL_REVIEW   // ต้องตรวจสอบเพิ่มเติม
}

enum DocumentType {
  SIGNED_CONTRACT       // PDF สัญญาที่เซ็นแล้ว
  ID_CARD_COPY          // สำเนาบัตรประชาชน
  KYC                   // เอกสาร KYC
  FACEBOOK_PROFILE      // Profile Facebook
  FACEBOOK_POST         // Post Facebook ล่าสุด
  LINE_PROFILE          // Profile LINE
  DEVICE_RECEIPT_PHOTO  // รูปรับเครื่อง
  BANK_STATEMENT        // Statement ธนาคาร
  OTHER                 // อื่นๆ
}
```

### 1.2 เพิ่ม Model ใหม่

```prisma
// ตั้งค่าดอกเบี้ย/เงินดาวน์ตามประเภทสินค้า
model InterestConfig {
  id                 String          @id @default(uuid())
  name               String          // เช่น "มือ 1", "มือ 2"
  productCategories  String[]        // เช่น ["PHONE_NEW"], ["PHONE_USED"]
  interestRate       Decimal         @map("interest_rate") @db.Decimal(5, 4)
  minDownPaymentPct  Decimal         @map("min_down_payment_pct") @db.Decimal(5, 4)
  maxInstallmentMonths Int           @map("max_installment_months")
  minInstallmentMonths Int           @map("min_installment_months")
  isActive           Boolean         @default(true) @map("is_active")
  createdAt          DateTime        @default(now()) @map("created_at")
  updatedAt          DateTime        @updatedAt @map("updated_at")

  @@map("interest_configs")
}

// เอกสารแนบสัญญา
model ContractDocument {
  id           String       @id @default(uuid())
  contractId   String       @map("contract_id")
  documentType DocumentType @map("document_type")
  fileName     String       @map("file_name")
  fileUrl      String       @map("file_url")
  fileSize     Int?         @map("file_size")
  notes        String?
  uploadedById String       @map("uploaded_by_id")
  createdAt    DateTime     @default(now()) @map("created_at")

  contract   Contract @relation(fields: [contractId], references: [id])
  uploadedBy User     @relation("DocumentUploadedBy", fields: [uploadedById], references: [id])

  @@index([contractId])
  @@index([documentType])
  @@map("contract_documents")
}

// ผลตรวจสอบเครดิตลูกค้า
model CreditCheck {
  id              String            @id @default(uuid())
  contractId      String            @map("contract_id")
  customerId      String            @map("customer_id")
  status          CreditCheckStatus @default(PENDING)

  // Statement ธนาคาร
  bankName        String?           @map("bank_name")
  statementFiles  String[]          @default([]) @map("statement_files")
  statementMonths Int               @default(3) @map("statement_months")  // ย้อนหลังกี่เดือน

  // ผลวิเคราะห์จาก AI
  aiAnalysis      Json?             @map("ai_analysis")   // ผลวิเคราะห์แบบละเอียด
  aiScore         Int?              @map("ai_score")       // คะแนน 0-100
  aiSummary       String?           @map("ai_summary")     // สรุปผลภาษาไทย
  aiRecommendation String?          @map("ai_recommendation") // คำแนะนำ

  // ตรวจสอบโดย
  checkedById     String?           @map("checked_by_id")
  checkedAt       DateTime?         @map("checked_at")
  reviewNotes     String?           @map("review_notes")

  createdAt       DateTime          @default(now()) @map("created_at")
  updatedAt       DateTime          @updatedAt @map("updated_at")

  contract  Contract @relation(fields: [contractId], references: [id])
  customer  Customer @relation(fields: [customerId], references: [id])
  checkedBy User?    @relation("CreditCheckedBy", fields: [checkedById], references: [id])

  @@index([contractId])
  @@index([customerId])
  @@index([status])
  @@map("credit_checks")
}
```

### 1.3 แก้ไข Contract Model (เพิ่ม fields)

```prisma
model Contract {
  // ... fields เดิมทั้งหมด ...

  // === NEW FIELDS ===
  workflowStatus     ContractWorkflowStatus @default(CREATING) @map("workflow_status")

  // ฝ่ายตรวจสอบ
  reviewedById       String?    @map("reviewed_by_id")
  reviewedAt         DateTime?  @map("reviewed_at")
  reviewNotes        String?    @map("review_notes")

  // วันที่ครบกำหนดชำระ (ตามวันเงินเดือนออก)
  paymentDueDay      Int?       @map("payment_due_day")  // วันที่ครบกำหนดในแต่ละเดือน (1-28)

  // ที่มาดอกเบี้ย
  interestConfigId   String?    @map("interest_config_id")

  // Relations ใหม่
  reviewedBy         User?      @relation("ContractReviewer", fields: [reviewedById], references: [id])
  interestConfig     InterestConfig? @relation(fields: [interestConfigId], references: [id])
  contractDocuments  ContractDocument[]
  creditCheck        CreditCheck?

  @@index([workflowStatus])
}
```

### 1.4 แก้ไข User Model (เพิ่ม Relations)

```prisma
model User {
  // ... relations เดิม ...
  contractsReviewed     Contract[]         @relation("ContractReviewer")
  documentsUploaded     ContractDocument[] @relation("DocumentUploadedBy")
  creditChecks          CreditCheck[]      @relation("CreditCheckedBy")
}
```

### 1.5 แก้ไข Customer Model (เพิ่ม Relation)

```prisma
model Customer {
  // ... relations เดิม ...
  creditChecks  CreditCheck[]
}
```

---

## 2. Backend API Changes

### 2.1 Interest Config Module (ตั้งค่าดอกเบี้ย)

**ไฟล์ใหม่:** `apps/api/src/modules/interest-config/`

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/interest-configs` | GET | ALL | ดึงรายการ config ดอกเบี้ยทั้งหมด |
| `/interest-configs` | POST | OWNER | สร้าง config ดอกเบี้ยใหม่ |
| `/interest-configs/:id` | PUT | OWNER | แก้ไข config ดอกเบี้ย |
| `/interest-configs/:id` | DELETE | OWNER | ลบ config ดอกเบี้ย |
| `/interest-configs/by-category/:category` | GET | ALL | ดึง config ตาม category สินค้า |

**Business Logic:**
- เมื่อสร้างสัญญา ให้ดึง config จาก `InterestConfig` ตาม category ของสินค้า
- ถ้าไม่พบ config → ใช้ค่าจาก `SystemConfig` เป็น fallback
- OWNER สามารถแก้ไข interest rate, min down payment, min/max months ตาม category ได้

### 2.2 Contract Workflow (สถานะสัญญา)

**แก้ไขไฟล์:** `apps/api/src/modules/contracts/contracts.service.ts` + `contracts.controller.ts`

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/contracts` | POST | SALES, BRANCH_MANAGER | สร้างสัญญา (workflow_status = CREATING) |
| `/contracts/:id/submit-review` | POST | SALES, BRANCH_MANAGER | ส่งตรวจสอบ (CREATING → PENDING_REVIEW) |
| `/contracts/:id/approve` | POST | OWNER, BRANCH_MANAGER | อนุมัติสัญญา (PENDING_REVIEW → APPROVED) |
| `/contracts/:id/reject` | POST | OWNER, BRANCH_MANAGER | ปฏิเสธ+ส่งกลับ (PENDING_REVIEW → REJECTED) |
| `/contracts/:id/resubmit` | POST | SALES, BRANCH_MANAGER | แก้ไขแล้วส่งใหม่ (REJECTED → PENDING_REVIEW) |
| `/contracts/:id/activate` | POST | OWNER, BRANCH_MANAGER | เปิดใช้งาน (APPROVED → ACTIVE) |

**Workflow Flow:**
```
CREATING → PENDING_REVIEW → APPROVED → ACTIVE (เดิม)
                ↓
            REJECTED → PENDING_REVIEW (ส่งใหม่)
```

**Permission:**
- **ฝ่ายทำสัญญา (SALES):** สร้าง, แก้ไข, ส่งตรวจสอบ, ส่งใหม่หลังถูกปฏิเสธ
- **ฝ่ายตรวจสอบ (OWNER, BRANCH_MANAGER):** อนุมัติ, ปฏิเสธ, เปิดใช้งาน
- SALES ที่สร้างสัญญาไม่สามารถอนุมัติสัญญาตัวเองได้ (ป้องกัน conflict of interest)

### 2.3 Custom Due Date (วันครบกำหนดตามเงินเดือน)

**แก้ไขไฟล์:** `apps/api/src/modules/contracts/contracts.service.ts`

- เพิ่ม field `paymentDueDay` ใน `CreateContractDto` (optional, 1-28)
- แก้ไขส่วน payment schedule generation:
  - ถ้ามี `paymentDueDay` → ใช้วันนั้นเป็นวันครบกำหนดทุกเดือน
  - ถ้าไม่ระบุ → ใช้วันที่ 1 ของเดือน (behavior เดิม)
- จำกัดให้ 1-28 เพื่อหลีกเลี่ยงปัญหาเดือนที่มี 29-31 วัน

### 2.4 Contract Documents Module (เอกสารแนบ)

**ไฟล์ใหม่:** `apps/api/src/modules/contract-documents/`

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/contracts/:id/documents` | GET | ALL | ดึงเอกสารแนบทั้งหมดของสัญญา |
| `/contracts/:id/documents` | POST | SALES, BRANCH_MANAGER, OWNER | อัปโหลดเอกสาร |
| `/contracts/:id/documents/:docId` | DELETE | SALES, BRANCH_MANAGER, OWNER | ลบเอกสาร |

**Document Types ที่รองรับ:**
- `SIGNED_CONTRACT` - PDF สัญญาที่ลูกค้าเซ็น
- `ID_CARD_COPY` - สำเนาบัตรประชาชน
- `KYC` - เอกสาร KYC
- `FACEBOOK_PROFILE` - Screenshot Profile Facebook
- `FACEBOOK_POST` - Screenshot Post Facebook ล่าสุด (ไม่เกิน 1 เดือน)
- `LINE_PROFILE` - Screenshot Profile LINE
- `DEVICE_RECEIPT_PHOTO` - รูปรับเครื่อง
- `BANK_STATEMENT` - Statement ธนาคาร
- `OTHER` - อื่นๆ

**Validation:**
- ไฟล์ PDF สำหรับ SIGNED_CONTRACT
- ไฟล์ภาพ (PNG, JPG, WEBP) หรือ PDF สำหรับเอกสารอื่น
- ขนาดไม่เกิน 10MB ต่อไฟล์

### 2.5 Credit Check Module (ตรวจสอบเครดิต AI)

**ไฟล์ใหม่:** `apps/api/src/modules/credit-check/`

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/contracts/:id/credit-check` | POST | SALES, BRANCH_MANAGER | สร้างการตรวจสอบเครดิต + อัปโหลด statement |
| `/contracts/:id/credit-check` | GET | ALL | ดูผลตรวจสอบเครดิต |
| `/contracts/:id/credit-check/analyze` | POST | SALES, BRANCH_MANAGER | ส่งให้ AI วิเคราะห์ |
| `/contracts/:id/credit-check/override` | POST | OWNER, BRANCH_MANAGER | override ผล AI (manual review) |

**AI Analysis Logic (ใช้ Anthropic Claude API):**

ส่ง bank statement images/PDF ให้ Claude วิเคราะห์ตามเกณฑ์:
1. **รายได้สม่ำเสมอ** - มีเงินเข้าประจำทุกเดือนหรือไม่
2. **ยอดเงินคงเหลือ** - มีเงินเหลือเพียงพอต่อค่างวดหรือไม่
3. **พฤติกรรมการใช้จ่าย** - มีการใช้จ่ายฟุ่มเฟือยหรือไม่
4. **ภาระหนี้** - มีการโอนเงินชำระหนี้อื่นหรือไม่
5. **ความเสี่ยง** - คะแนนรวม 0-100

**Response Format:**
```json
{
  "aiScore": 75,
  "aiSummary": "ลูกค้ามีรายได้สม่ำเสมอ เงินเดือนเข้าทุกวันที่ 25...",
  "aiRecommendation": "แนะนำอนุมัติ ค่างวดไม่เกิน 30% ของรายได้",
  "aiAnalysis": {
    "monthlyIncome": 25000,
    "averageBalance": 15000,
    "debtObligations": 3000,
    "riskFactors": [],
    "incomeConsistency": "stable",
    "affordabilityRatio": 0.28
  }
}
```

---

## 3. Frontend Changes

### 3.1 แก้ไข ContractCreatePage.tsx (เพิ่ม Steps)

**Steps ใหม่:**
1. เลือกสินค้า (เดิม)
2. เลือกลูกค้า (เดิม)
3. เลือกแผนผ่อน + กำหนดวันชำระ (แก้ไข)
   - เพิ่ม dropdown เลือกวันที่ครบกำหนดชำระ (1-28)
   - แสดง interest rate จาก InterestConfig อัตโนมัติตาม category สินค้า
   - แสดง min down payment ตาม InterestConfig
   - สามารถ override ดอกเบี้ยได้ (ถ้ามีสิทธิ์)
4. แนบเอกสาร (ใหม่)
   - อัปโหลดสำเนาบัตรประชาชน
   - อัปโหลด KYC
   - อัปโหลด Facebook Profile / Post
   - อัปโหลด LINE Profile
   - อัปโหลดรูปรับเครื่อง
5. ตรวจสอบเครดิต (ใหม่) - optional
   - อัปโหลด bank statement 3 เดือน
   - กดปุ่ม "AI วิเคราะห์" ให้ AI ตรวจสอบ
   - แสดงผลวิเคราะห์จาก AI
6. ยืนยัน + ส่งตรวจสอบ (แก้ไข)
   - แสดงสรุปทุกอย่าง
   - ปุ่ม "บันทึกร่าง" (CREATING)
   - ปุ่ม "ส่งตรวจสอบ" (PENDING_REVIEW)

### 3.2 แก้ไข ContractDetailPage.tsx

- แสดง `workflowStatus` เพิ่มจาก `status` เดิม
- เพิ่มส่วนแสดงเอกสารแนบทั้งหมด (ดู/ดาวน์โหลด)
- เพิ่มส่วนผลตรวจสอบเครดิต (AI Score + Summary)
- เพิ่มปุ่ม "อนุมัติ" / "ปฏิเสธ" สำหรับ OWNER/BRANCH_MANAGER
- เพิ่มกล่องใส่เหตุผลปฏิเสธ
- เพิ่มส่วนแนบ PDF สัญญาที่ลูกค้าเซ็น
- แสดงวันที่ครบกำหนดชำระ (paymentDueDay)

### 3.3 แก้ไข ContractsPage.tsx

- เพิ่ม filter ตาม `workflowStatus`
- เพิ่ม column แสดง `workflowStatus`
- เพิ่ม tab/view แยก:
  - "สัญญาของฉัน" (ฝ่ายสร้าง)
  - "รอตรวจสอบ" (ฝ่ายตรวจสอบ)

### 3.4 หน้าตั้งค่าดอกเบี้ย (ใหม่)

**ไฟล์ใหม่:** `apps/web/src/pages/InterestConfigPage.tsx`
- Route: `/settings/interest-config` (OWNER only)
- ตาราง config ดอกเบี้ยทั้งหมด
- Modal สร้าง/แก้ไข config
- แยกตามประเภท: มือ 1, มือ 2, Tablet, Accessory ฯลฯ

### 3.5 Component อัปโหลดเอกสาร (ใหม่)

**ไฟล์ใหม่:** `apps/web/src/components/contract/DocumentUpload.tsx`
- Drag & drop upload
- แสดง preview รูปภาพ / icon PDF
- แสดงประเภทเอกสาร
- ปุ่มลบ

### 3.6 Component ผลเครดิตเช็ค (ใหม่)

**ไฟล์ใหม่:** `apps/web/src/components/contract/CreditCheckPanel.tsx`
- อัปโหลด bank statement (ภาพ/PDF)
- ปุ่ม "AI วิเคราะห์"
- แสดงผล: Score gauge, สรุป, คำแนะนำ
- Loading state ระหว่าง AI วิเคราะห์

---

## 4. ลำดับการ Implement (Phases)

### Phase 1: Database & Interest Config
1. เพิ่ม enums, models ใหม่ใน schema.prisma
2. Run migration
3. สร้าง InterestConfig module (CRUD)
4. Seed ข้อมูล default (มือ 1: 8%, มือ 2: 10%)
5. แก้ contract create logic ให้ใช้ InterestConfig

### Phase 2: Contract Workflow
6. เพิ่ม workflowStatus field + reviewer fields ใน Contract
7. สร้าง endpoints: submit-review, approve, reject, resubmit
8. เพิ่ม permission check (ห้ามอนุมัติสัญญาตัวเอง)
9. แก้ frontend ContractsPage - เพิ่ม tab/filter workflow
10. แก้ frontend ContractDetailPage - เพิ่มปุ่ม approve/reject

### Phase 3: Custom Due Date
11. เพิ่ม paymentDueDay ใน CreateContractDto
12. แก้ payment schedule generation ให้ใช้ paymentDueDay
13. แก้ frontend ContractCreatePage - เพิ่ม date picker

### Phase 4: Document Attachments
14. สร้าง ContractDocument model + migration
15. สร้าง contract-documents endpoints (upload, list, delete)
16. สร้าง DocumentUpload component (frontend)
17. เพิ่มส่วนเอกสารใน ContractCreatePage (step ใหม่)
18. เพิ่มส่วนเอกสารใน ContractDetailPage

### Phase 5: Credit Check with AI
19. สร้าง CreditCheck model + migration
20. สร้าง credit-check module + Anthropic integration
21. สร้าง CreditCheckPanel component (frontend)
22. เพิ่มส่วนเครดิตเช็คใน ContractCreatePage
23. เพิ่มส่วนเครดิตเช็คใน ContractDetailPage

### Phase 6: Settings Page
24. สร้าง InterestConfigPage (frontend)
25. เพิ่ม route ใน App.tsx
26. เพิ่ม link ใน Sidebar

---

## 5. ไฟล์ที่ต้องแก้ไข

### Backend (แก้ไข)
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `apps/api/prisma/schema.prisma` | เพิ่ม enums, models, fields ใหม่ |
| `apps/api/src/modules/contracts/contracts.service.ts` | เพิ่ม workflow logic, custom due date, interest config |
| `apps/api/src/modules/contracts/contracts.controller.ts` | เพิ่ม endpoints workflow |
| `apps/api/src/modules/contracts/dto/contract.dto.ts` | เพิ่ม fields ใหม่ใน DTO |
| `apps/api/src/app.module.ts` | import modules ใหม่ |

### Backend (สร้างใหม่)
| ไฟล์ | Description |
|---|---|
| `apps/api/src/modules/interest-config/` | module, controller, service, dto |
| `apps/api/src/modules/contract-documents/` | module, controller, service, dto |
| `apps/api/src/modules/credit-check/` | module, controller, service, dto |

### Frontend (แก้ไข)
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `apps/web/src/pages/ContractCreatePage.tsx` | เพิ่ม steps, interest config, due date, documents, credit check |
| `apps/web/src/pages/ContractDetailPage.tsx` | เพิ่ม workflow actions, documents view, credit check result |
| `apps/web/src/pages/ContractsPage.tsx` | เพิ่ม workflow filter/tabs |
| `apps/web/src/App.tsx` | เพิ่ม routes ใหม่ |
| `apps/web/src/components/layout/Sidebar.tsx` | เพิ่ม menu items |

### Frontend (สร้างใหม่)
| ไฟล์ | Description |
|---|---|
| `apps/web/src/pages/InterestConfigPage.tsx` | หน้าตั้งค่าดอกเบี้ย |
| `apps/web/src/components/contract/DocumentUpload.tsx` | Component อัปโหลดเอกสาร |
| `apps/web/src/components/contract/CreditCheckPanel.tsx` | Component ตรวจเครดิต AI |
| `apps/web/src/components/contract/WorkflowStatusBadge.tsx` | Badge แสดง workflow status |

---

## 6. สรุปฟีเจอร์ตาม Requirements

| Requirement | Solution |
|---|---|
| แบ่งสองฝ่าย (ทำสัญญา vs ตรวจสอบ) | ContractWorkflowStatus + role-based permissions |
| ดอกเบี้ย/ดาวน์แยกตามประเภท (มือ 1, มือ 2) | InterestConfig model แยกตาม ProductCategory |
| แก้ไขวันครบกำหนดชำระตามเงินเดือน | paymentDueDay field (1-28) ใน Contract |
| เช็คเครดิตผ่าน Bank Statement + AI | CreditCheck module + Anthropic Claude API |
| สถานะสัญญา (สร้าง, รอตรวจ, อนุมัติ) | ContractWorkflowStatus enum |
| แนบ PDF สัญญาที่เซ็น | ContractDocument (SIGNED_CONTRACT type) |
| แนบเอกสารเพิ่มเติม (บัตร, KYC, FB, LINE, รูปรับเครื่อง) | ContractDocument with DocumentType enum |
