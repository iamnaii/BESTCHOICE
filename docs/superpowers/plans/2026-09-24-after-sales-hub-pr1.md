# หลังการขาย PR 1 — ตารางเคส + เช็คประกัน/แจ้งปัญหาเครื่อง + รายการ + หน้าเคส (ทางออก "ซ่อม") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปิดโมดูล `after-sales` ให้พนักงานเช็คประกัน/แจ้งปัญหาเครื่องจากประตูเดียว เปิดเคส `AS-YYYYMMDD-NNNN` ที่ผูกใบซ่อมเดิม แล้วเดินงานซ่อมจนปิดเคสได้ครบจากหน้าเดียว (หน้าเก่า `/insurance*` ยังอยู่ แค่ redirect รายการหลักมาหน้าใหม่)

**Architecture:** ตารางกลาง `after_sales_cases` + `after_sales_events` ใน API (NestJS/Prisma) โดยทางออก "ซ่อม" ยังใช้ `RepairTicket` และ `RepairTicketsService` เดิมทั้งหมด (ลงบัญชีตอนส่งมอบเหมือนเดิม) — โมดูลใหม่แค่สร้าง/อ่าน/proxy และคำนวณ `stage` จากสถานะใบซ่อม ไม่รับ `stage` จาก client · ฝั่งเว็บ 3 หน้าใหม่ (`/after-sales`, `/after-sales/new`, `/after-sales/:id`) ตาม mockup V4 ใช้ react-query + โทเคนสีของระบบ

**Tech Stack:** NestJS 10 + Prisma + PostgreSQL (jest unit / vitest integration บน `test_db`) · React + Vite + Tailwind + shadcn + lucide-react + @tanstack/react-query (vitest + testing-library)

**Spec:** `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` (ข้อ 3, 4.0–4.4, 5, 6, 7, 12, 13, 14 แถว PR 1) · mockup https://claude.ai/artifact/SoThf1rbZEaxas5KJgudxp กระดาน 1–4, 7

## Global Constraints

- Prisma: ทุก model มี `createdAt`, `updatedAt`, `deletedAt`; id เป็น UUID; **ห้าม hard delete**; ทุก query กรอง `deletedAt: null` (`.claude/rules/database.md`)
- **ห้ามเรียก `audit.log(...)` ภายใน `$transaction`** — เรียกหลัง commit (`.claude/rules/database.md:62-70`)
- เลขเอกสาร `AS-YYYYMMDD-NNNN` วันตาม Asia/Bangkok + advisory lock ต่อวัน (`.claude/rules/accounting.md:864-866`) · prefix `AS` ยังไม่มีใครใช้ (ตรวจ 2026-09-24)
- Migration: ไฟล์ `YYYYMMDDHHMMSS_snake_name` เขียน SQL มือแบบ additive · prod ใช้ `prisma migrate deploy` เท่านั้น · **ห้ามรับ diff ที่ drop index `product_prices_one_default`** (`schema.prisma:1896-1900`)
- ทุก controller: `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` + `@Roles(...)` ทุก method (`.claude/rules/security.md:11-13`) · สาขา: OWNER/FINANCE_MANAGER/ACCOUNTANT เห็นทุกสาขา (`hasCrossBranchAccess` ใน `src/modules/auth/branch-access.util.ts`) BM/SALES เห็นสาขาตัวเอง
- ห้ามรัน `npm run lint` ใน apps/api (มี `--fix`) · integration spec ใหม่ต้องล้างข้อมูลตัวเองใน `afterAll` (ลบตาม id ที่สร้าง ลูกก่อนแม่) และต้องเพิ่ม glob ใน `.github/workflows/deploy-gcp.yml` (glob ไม่ recurse)
- เว็บ: ห้าม hex/`text-gray-*`/`bg-white`; ตัวอักษรบน `bg-primary` ใช้ `text-primary-foreground`; สีเหลืองตัวอักษร = `text-warning-strong`; ไทยใช้ `leading-snug`; สถานะต้องมีไอคอน/ข้อความ ไม่ใช่สีอย่างเดียว; ตัวอักษร ≥ 12px; ปุ่มหลักสีเขียวหน้าละปุ่มเดียว (`.claude/rules/frontend.md`)
- คำที่ใช้ (spec 4.0): "แจ้งปัญหาเครื่อง" (เปิดเคส) · "เช็คประกัน" (ดูอย่างเดียว ไม่เปิดเคส) · "รับเรื่องแล้ว" (stage `RECEIVED`) · "ใบรับฝากเครื่อง" · **ห้ามใช้คำ "รับเครื่อง"** ในหน้าจอใหม่
- ทุก deploy ต้อง bump `version` ใน `apps/web/package.json` (YY.M.ลำดับ) · route ใหม่ทุก role ที่อนุญาตต้องมีเมนู ไม่งั้น `route-reachability.test.ts` แดง
- Deviation จากสเปกข้อ 5 (บันทึกไว้ที่นี่ ให้แก้สเปกใน Task 1): `purchasePhotoSnapshot String[]` → `purchasePhotoKeys String[]` เก็บ key ของไฟล์ที่คัดลอกจาก `ProductPhoto` (ซึ่งเป็น base64 data URL) ขึ้น StorageService ตอนเปิดเคส — ไม่เก็บ base64 ในตารางเคส

## Review Focus

1. IMEI ที่พบสินค้าแต่ไม่มีทั้ง sale และ contract (เครื่องยังอยู่ในสต๊อก/เคยยึดคืน) — ต้องถือเป็น `WALK_IN` และเปิดได้แค่ "ซ่อม ลูกค้าจ่าย" ไม่ใช่ crash หรือถือว่าเป็นลูกค้าเดิม (เทสต์ใน Task 3)
2. เปิดเคสซ้ำกับ IMEI เดียวกันขณะที่เคสก่อนยังไม่ปิด — ต้อง 409 พร้อมเลขเคสเดิม ไม่สร้างซ้อน (เทสต์ใน Task 4)
3. อัปโหลดรูป 7 รูป หรือไฟล์ที่ไม่ใช่รูป/ปลอมนามสกุล — ต้อง 400 และไม่เหลือไฟล์ค้างใน storage (เทสต์ใน Task 4 และ Task 6)
4. SALES ของสาขา A เปิดเคสของสาขา B หรือดูเคสสาขา B — ต้อง 403 (BranchGuard + where สาขา) (เทสต์ใน Task 5)
5. ใบซ่อมถูกยกเลิก/ลบจากหน้าเก่า `/insurance/:id` หลังมีเคสแล้ว — `stage` ต้องกลายเป็น `CANCELLED` โดยไม่ต้องแตะเคส (เทสต์ `deriveStage` ใน Task 5)

## File Structure

API (`apps/api`):
- `prisma/schema.prisma` — enum 4 ตัว + model 2 ตัว + back-relation 4 จุด (Task 1)
- `prisma/migrations/20261008000000_after_sales_cases/migration.sql` — สร้างตาราง + backfill เคสให้ใบซ่อมเดิม (Task 1)
- `src/modules/after-sales/after-sales.module.ts` · `after-sales.controller.ts` · `after-sales.service.ts` (facade) (Task 7)
- `src/modules/after-sales/services/after-sales-doc-number.service.ts` — `AS-` (Task 2)
- `src/modules/after-sales/utils/after-sales-outcomes.util.ts` — `computeOutcomes` ตารางทางออก (Task 3)
- `src/modules/after-sales/utils/after-sales-stage.util.ts` — `deriveStage` (Task 5)
- `src/modules/after-sales/services/after-sales-lookup.service.ts` — เช็คประกัน (Task 3)
- `src/modules/after-sales/services/after-sales-case.service.ts` — สร้างเคส + รูป (Task 4)
- `src/modules/after-sales/services/after-sales-query.service.ts` — รายการ/สรุป/รายละเอียด (Task 5)
- `src/modules/after-sales/services/after-sales-repair.service.ts` — proxy ใบซ่อม + ยกเลิก + เพิ่มรูป (Task 6)
- `src/modules/after-sales/dto/*.dto.ts` (Task 3–6)
- `src/modules/repair-tickets/services/repair-ticket-lifecycle.service.ts` — แยก `createInTx` (Task 4)
- `src/modules/after-sales/__tests__/*.spec.ts` (jest unit) + `after-sales-flow.integration.spec.ts` (vitest บน DB) (Task 2–7)

Web (`apps/web/src`):
- `pages/after-sales/after-sales.ts` — types + label/icon maps + query keys + helpers (Task 8)
- `pages/AfterSalesPage.tsx` + `pages/after-sales/IntakeBox.tsx` · `SummaryStrip.tsx` · `CaseTable.tsx` (Task 9)
- `pages/AfterSalesNewPage.tsx` + `pages/after-sales/OutcomePicker.tsx` · `IntakePhotos.tsx` (Task 10)
- `pages/AfterSalesCasePage.tsx` + `pages/after-sales/CaseSteps.tsx` · `PhotoCompare.tsx` · `CaseTimeline.tsx` (Task 11)
- `App.tsx` (route + redirect) · `config/menu.ts` (เมนู 5 zone) (Task 8)

---

### Task 1: Prisma schema + migration + backfill

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum ใกล้ `enum ExchangeRequestStatus` บรรทัด 70 · model ใกล้ `model RepairTicket` บรรทัด 7587 · back-relation ใน `Customer`, `Branch`, `User`, `RepairTicket`)
- Create: `apps/api/prisma/migrations/20261008000000_after_sales_cases/migration.sql`
- Modify: `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` ข้อ 5 (`purchasePhotoSnapshot` → `purchasePhotoKeys`)

**Interfaces:**
- Produces: Prisma models `AfterSalesCase`, `AfterSalesEvent`; enums `AfterSalesSource`, `AfterSalesOutcome`, `AfterSalesStage`, `AfterSalesEventKind` ที่ Task 2–7 ใช้

- [ ] **Step 1: เพิ่ม enum ใน `schema.prisma` (วางต่อจาก `enum ExchangeApprovalTier`)**

```prisma
// หลังการขาย — เคสเดียว ทางออกหลายแบบ (spec 2026-09-23 ข้อ 5)
enum AfterSalesSource { INSTALLMENT_CONTRACT CASH_SALE WALK_IN }
enum AfterSalesOutcome { REPAIR SAME_MODEL_EXCHANGE PRICED_EXCHANGE CASH_SAME_MODEL_EXCHANGE }
enum AfterSalesStage { RECEIVED IN_REPAIR AWAITING_APPROVAL READY_FOR_PICKUP CLOSED CANCELLED }
enum AfterSalesEventKind { RECEIVED OUTCOME_SET REPAIR_SENT REPAIR_DONE REPAIR_SENT_BACK DELIVERED PHOTO_ADDED LINE_SENT LINE_SKIPPED_NO_LINK PRINTED CLOSED CANCELLED NOTE }
```

- [ ] **Step 2: เพิ่ม model 2 ตัว (วางต่อจาก `model RepairStatusLog`)**

```prisma
model AfterSalesCase {
  id            String            @id @default(uuid())
  caseNumber    String            @unique @map("case_number") // AS-YYYYMMDD-NNNN
  branchId      String            @map("branch_id")
  customerId    String            @map("customer_id")
  source        AfterSalesSource
  contractId    String?           @map("contract_id")
  saleId        String?           @map("sale_id")
  productId     String?           @map("product_id")
  deviceBrand   String?           @map("device_brand")
  deviceModel   String?           @map("device_model")
  deviceImei    String?           @map("device_imei")
  deviceSerial  String?           @map("device_serial")
  symptom       String            @db.Text
  accessories   Json              @default("{}") // {box,charger,case,other}
  unlockConfirmed Boolean         @default(false) @map("unlock_confirmed")
  photoKeys     String[]          @default([]) @map("photo_keys")            // รูปตอนรับฝาก ≥1 ≤6 (StorageService key)
  purchasePhotoKeys String[]      @default([]) @map("purchase_photo_keys")   // สำเนา ProductPhoto 6 มุม ณ วันแจ้ง
  warrantySnapshot Json           @map("warranty_snapshot")                  // {status,within7Days,daysRemainingIn7Day,shopWarrantyEnd,manufacturerWarrantyEnd,checkedAt}
  outcome       AfterSalesOutcome?
  repairTicketId String?          @unique @map("repair_ticket_id")
  exchangeRequestId String?       @unique @map("exchange_request_id")
  replacementContractId String?   @map("replacement_contract_id")
  replacementSaleId String?       @map("replacement_sale_id")
  replacementProductId String?    @map("replacement_product_id")
  stage         AfterSalesStage   @default(RECEIVED) // เขียนโดย service จาก deriveStage เท่านั้น
  receivedById  String            @map("received_by_id")
  receivedAt    DateTime          @default(now()) @map("received_at")
  approvedById  String?           @map("approved_by_id")
  approvedAt    DateTime?         @map("approved_at")
  closedAt      DateTime?         @map("closed_at")
  cancelledAt   DateTime?         @map("cancelled_at")
  cancelReason  String?           @map("cancel_reason")
  createdAt     DateTime          @default(now()) @map("created_at")
  updatedAt     DateTime          @updatedAt @map("updated_at")
  deletedAt     DateTime?         @map("deleted_at")
  branch        Branch            @relation("BranchAfterSalesCases", fields: [branchId], references: [id])
  customer      Customer          @relation("CustomerAfterSalesCases", fields: [customerId], references: [id])
  receivedBy    User              @relation("AfterSalesCaseReceivedBy", fields: [receivedById], references: [id])
  repairTicket  RepairTicket?     @relation("AfterSalesCaseRepairTicket", fields: [repairTicketId], references: [id])
  events        AfterSalesEvent[]
  @@index([branchId, stage, deletedAt])
  @@index([customerId, deletedAt])
  @@index([deviceImei])
  @@index([receivedAt])
  @@map("after_sales_cases")
}

model AfterSalesEvent {
  id        String             @id @default(uuid())
  caseId    String             @map("case_id")
  kind      AfterSalesEventKind
  note      String?            @db.Text
  actorId   String?            @map("actor_id")
  createdAt DateTime           @default(now()) @map("created_at")
  case      AfterSalesCase     @relation(fields: [caseId], references: [id], onDelete: Cascade)
  @@index([caseId, createdAt])
  @@map("after_sales_events")
}
```

- [ ] **Step 3: เพิ่ม back-relation 4 จุด** — ใน `model Branch` เพิ่ม `afterSalesCases AfterSalesCase[] @relation("BranchAfterSalesCases")` · ใน `model Customer` เพิ่ม `afterSalesCases AfterSalesCase[] @relation("CustomerAfterSalesCases")` · ใน `model User` เพิ่ม `afterSalesCasesReceived AfterSalesCase[] @relation("AfterSalesCaseReceivedBy")` · ใน `model RepairTicket` เพิ่ม `afterSalesCase AfterSalesCase? @relation("AfterSalesCaseRepairTicket")`

- [ ] **Step 4: ตรวจ schema + generate client**

Run: `cd apps/api && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` และ generate สำเร็จ

- [ ] **Step 5: เขียน migration SQL มือ (additive + backfill)**

```sql
-- After-sales hub — เคสกลาง (spec 2026-09-23 ข้อ 5). Additive only.
CREATE TYPE "AfterSalesSource" AS ENUM ('INSTALLMENT_CONTRACT', 'CASH_SALE', 'WALK_IN');
CREATE TYPE "AfterSalesOutcome" AS ENUM ('REPAIR', 'SAME_MODEL_EXCHANGE', 'PRICED_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE');
CREATE TYPE "AfterSalesStage" AS ENUM ('RECEIVED', 'IN_REPAIR', 'AWAITING_APPROVAL', 'READY_FOR_PICKUP', 'CLOSED', 'CANCELLED');
CREATE TYPE "AfterSalesEventKind" AS ENUM ('RECEIVED', 'OUTCOME_SET', 'REPAIR_SENT', 'REPAIR_DONE', 'REPAIR_SENT_BACK', 'DELIVERED', 'PHOTO_ADDED', 'LINE_SENT', 'LINE_SKIPPED_NO_LINK', 'PRINTED', 'CLOSED', 'CANCELLED', 'NOTE');

CREATE TABLE "after_sales_cases" (
  "id" TEXT NOT NULL, "case_number" TEXT NOT NULL, "branch_id" TEXT NOT NULL, "customer_id" TEXT NOT NULL,
  "source" "AfterSalesSource" NOT NULL, "contract_id" TEXT, "sale_id" TEXT, "product_id" TEXT,
  "device_brand" TEXT, "device_model" TEXT, "device_imei" TEXT, "device_serial" TEXT,
  "symptom" TEXT NOT NULL, "accessories" JSONB NOT NULL DEFAULT '{}', "unlock_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "photo_keys" TEXT[] DEFAULT ARRAY[]::TEXT[], "purchase_photo_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "warranty_snapshot" JSONB NOT NULL, "outcome" "AfterSalesOutcome",
  "repair_ticket_id" TEXT, "exchange_request_id" TEXT, "replacement_contract_id" TEXT, "replacement_sale_id" TEXT, "replacement_product_id" TEXT,
  "stage" "AfterSalesStage" NOT NULL DEFAULT 'RECEIVED',
  "received_by_id" TEXT NOT NULL, "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by_id" TEXT, "approved_at" TIMESTAMP(3), "closed_at" TIMESTAMP(3), "cancelled_at" TIMESTAMP(3), "cancel_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3),
  CONSTRAINT "after_sales_cases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "after_sales_cases_case_number_key" ON "after_sales_cases"("case_number");
CREATE UNIQUE INDEX "after_sales_cases_repair_ticket_id_key" ON "after_sales_cases"("repair_ticket_id");
CREATE UNIQUE INDEX "after_sales_cases_exchange_request_id_key" ON "after_sales_cases"("exchange_request_id");
CREATE INDEX "after_sales_cases_branch_id_stage_deleted_at_idx" ON "after_sales_cases"("branch_id", "stage", "deleted_at");
CREATE INDEX "after_sales_cases_customer_id_deleted_at_idx" ON "after_sales_cases"("customer_id", "deleted_at");
CREATE INDEX "after_sales_cases_device_imei_idx" ON "after_sales_cases"("device_imei");
CREATE INDEX "after_sales_cases_received_at_idx" ON "after_sales_cases"("received_at");
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "after_sales_cases" ADD CONSTRAINT "after_sales_cases_repair_ticket_id_fkey" FOREIGN KEY ("repair_ticket_id") REFERENCES "repair_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "after_sales_events" (
  "id" TEXT NOT NULL, "case_id" TEXT NOT NULL, "kind" "AfterSalesEventKind" NOT NULL, "note" TEXT, "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "after_sales_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "after_sales_events_case_id_created_at_idx" ON "after_sales_events"("case_id", "created_at");
ALTER TABLE "after_sales_events" ADD CONSTRAINT "after_sales_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "after_sales_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: ใบซ่อมเดิมทุกใบ (รวมข้อมูลทดสอบ) ได้เคส 1 ใบ เลข AS-<วันสร้างใบซ่อม BKK>-<ลำดับในวัน> stage ตามสถานะใบซ่อม
INSERT INTO "after_sales_cases" ("id","case_number","branch_id","customer_id","source","contract_id","product_id","device_brand","device_model","device_imei","device_serial","symptom","warranty_snapshot","outcome","repair_ticket_id","stage","received_by_id","received_at","created_at","updated_at","closed_at","cancelled_at")
SELECT gen_random_uuid()::text,
  'AS-' || to_char(rt.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD') || '-' || lpad((row_number() OVER (PARTITION BY (rt.created_at AT TIME ZONE 'Asia/Bangkok')::date ORDER BY rt.created_at))::text, 4, '0'),
  rt.branch_id, rt.customer_id,
  CASE WHEN rt.contract_id IS NOT NULL THEN 'INSTALLMENT_CONTRACT'::"AfterSalesSource" WHEN rt.warranty_status = 'WALK_IN' THEN 'WALK_IN' ELSE 'CASH_SALE' END,
  rt.contract_id, rt.product_id, rt.device_brand, rt.device_model, rt.device_imei, rt.device_serial, rt.defect_description,
  jsonb_build_object('status', rt.warranty_status, 'checkedAt', rt.created_at, 'backfilled', true),
  'REPAIR', rt.id,
  CASE rt.status WHEN 'OPEN' THEN 'RECEIVED'::"AfterSalesStage" WHEN 'IN_PROGRESS' THEN 'IN_REPAIR' WHEN 'READY_FOR_PICKUP' THEN 'READY_FOR_PICKUP' WHEN 'CLOSED' THEN 'CLOSED' WHEN 'REPLACED' THEN 'CLOSED' ELSE 'CANCELLED' END,
  rt.created_by_id, rt.created_at, rt.created_at, rt.updated_at,
  CASE WHEN rt.status IN ('CLOSED','REPLACED') THEN COALESCE(rt.returned_to_customer_at, rt.replaced_at, rt.updated_at) END,
  rt.cancelled_at
FROM "repair_tickets" rt WHERE rt.deleted_at IS NULL;
```

- [ ] **Step 6: ทดสอบ migration บนฐานเทสเปล่า (ห้ามชี้ฐาน dev ของเจ้าของ)**

Run: `cd apps/api && DATABASE_URL=postgresql://test:test@localhost:5432/test_db?schema=public npx prisma migrate deploy 2>&1 | tail -3 && DATABASE_URL=postgresql://test:test@localhost:5432/test_db?schema=public npx prisma migrate status 2>&1 | tail -2`
Expected: `20261008000000_after_sales_cases` applied · status "Database schema is up to date!" (ถ้าเห็น drift ข้อความเกี่ยวกับ `product_prices_one_default` ให้เพิกเฉย ห้ามสร้าง migration ลบ)

- [ ] **Step 7: อัปเดตสเปกข้อ 5** — แทนบรรทัด `purchasePhotoSnapshot String[] ...` ด้วย `purchasePhotoKeys String[]  // key ไฟล์สำเนา ProductPhoto 6 มุมบน StorageService ณ วันแจ้ง (ไม่เก็บ base64 ในตาราง)`

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261008000000_after_sales_cases/migration.sql docs/superpowers/specs/2026-09-23-after-sales-hub-design.md
git commit -m "feat(after-sales): ตารางเคสหลังการขาย + events + backfill จากใบซ่อมเดิม"
```

### Task 2: เลขเคส `AS-YYYYMMDD-NNNN`

**Files:**
- Create: `apps/api/src/modules/after-sales/services/after-sales-doc-number.service.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/doc-number.spec.ts`

**Interfaces:**
- Produces: `AfterSalesDocNumberService.nextCaseNumber(tx: Prisma.TransactionClient | PrismaService, issueDate?: Date): Promise<string>`

- [ ] **Step 1: เขียนเทสต์ (jest unit, mock tx เหมือน `repair-tickets/__tests__/lookup-by-imei.spec.ts`)**

```ts
import { AfterSalesDocNumberService } from '../services/after-sales-doc-number.service';

describe('AfterSalesDocNumberService', () => {
  const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(0), afterSalesCase: { findFirst: jest.fn() } };
  const svc = new AfterSalesDocNumberService({} as never);
  const bkkNoon = new Date('2026-09-24T05:00:00.000Z'); // 12:00 BKK

  it('เริ่มที่ 0001 เมื่อวันนั้นยังไม่มีเคส', async () => {
    tx.afterSalesCase.findFirst.mockResolvedValue(null);
    await expect(svc.nextCaseNumber(tx as never, bkkNoon)).resolves.toBe('AS-20260924-0001');
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'));
  });
  it('ต่อจากเลขสูงสุดของวัน (นับตามวัน BKK ไม่ใช่ UTC)', async () => {
    tx.afterSalesCase.findFirst.mockResolvedValue({ caseNumber: 'AS-20260924-0012' });
    await expect(svc.nextCaseNumber(tx as never, new Date('2026-09-23T17:30:00.000Z'))).resolves.toBe('AS-20260924-0013');
  });
});
```

- [ ] **Step 2: รันให้แดง** — `cd apps/api && npx jest src/modules/after-sales/__tests__/doc-number.spec.ts` → FAIL (module not found)

- [ ] **Step 3: เขียน service (โคลนจาก `repair-tickets/services/doc-number.service.ts` เปลี่ยน model/prefix/lock key)**

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/** AS-YYYYMMDD-NNNN — วันตาม Asia/Bangkok, advisory lock ต่อวัน (แบบเดียวกับ RT-) */
@Injectable()
export class AfterSalesDocNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async nextCaseNumber(tx: Prisma.TransactionClient | PrismaService, issueDate: Date = new Date()): Promise<string> {
    const yyyymmdd = this.bkkYyyymmdd(issueDate);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${this.hashLockKey(`as-case:${yyyymmdd}`)})`);
    const last = await tx.afterSalesCase.findFirst({
      where: { caseNumber: { startsWith: `AS-${yyyymmdd}-` } },
      orderBy: { caseNumber: 'desc' },
      select: { caseNumber: true },
    });
    const lastSeq = last ? parseInt(last.caseNumber.split('-')[2], 10) || 0 : 0;
    return `AS-${yyyymmdd}-${String(lastSeq + 1).padStart(4, '0')}`;
  }

  private bkkYyyymmdd(date: Date): string {
    const [y, m, d] = date.toLocaleString('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).split('-');
    return `${y}${m}${d}`;
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return h;
  }
}
```

- [ ] **Step 4: รันให้เขียว** — `npx jest src/modules/after-sales/__tests__/doc-number.spec.ts` → PASS 2 tests

- [ ] **Step 5: Commit** — `git add apps/api/src/modules/after-sales && git commit -m "feat(after-sales): เลขเคส AS-YYYYMMDD-NNNN"`

### Task 3: ตารางทางออก `computeOutcomes` + เช็คประกัน `lookup`

**Files:**
- Create: `apps/api/src/modules/after-sales/utils/after-sales-outcomes.util.ts`
- Create: `apps/api/src/modules/after-sales/services/after-sales-lookup.service.ts`
- Create: `apps/api/src/modules/after-sales/dto/lookup.dto.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/outcomes.spec.ts`

**Interfaces:**
- Consumes: `RepairTicketsService.lookupByImei(imei, user)` (คืน `{found:false} | {found:true, product{id,brand,model,storage,imeiSerial,category}, sale{id,saleType}|null, customer{id,name,phone}|null, contract{id,contractNumber,status}|null, warrantyStatus, daysRemainingIn7Day, purchasedAt, shopWarrantyEndDate, manufacturerWarrantyEndDate}`) · `DefectExchangeService.checkEligibility(contractId)` (คืน `{eligible, reasons[], daysRemaining, ...}`) · `ProductPhotosService.getPhotos(productId)` (คืน `{photos:{front..bottom}}` หรือ `{applicable:false}`)
- Produces: `computeOutcomes(input: OutcomeInput): OutcomeOption[]` และ `AfterSalesLookupService.lookup(dto: LookupDto, user: ReqUser): Promise<LookupResult>` (Task 4, 7, 10 ใช้)

- [ ] **Step 1: เขียนเทสต์ตารางทางออก (ทุกช่องของสเปก 4.3)**

```ts
import { computeOutcomes } from '../utils/after-sales-outcomes.util';

const base = { source: 'INSTALLMENT_CONTRACT' as const, warrantyStatus: 'IN_7DAY_DEFECT' as const, daysRemainingIn7Day: 2, contractStatus: 'ACTIVE', defectEligible: true, defectReasons: [] as string[], viewerRole: 'SALES' };
const pick = (opts: ReturnType<typeof computeOutcomes>, o: string) => opts.find((x) => x.outcome === o)!;

describe('computeOutcomes — ตารางทางออก (spec 4.3)', () => {
  it('ผ่อน ≤7 วัน: เปิดทั้ง 3 ทาง · ซ่อมร้านจ่าย', () => {
    const o = computeOutcomes(base);
    expect(o.map((x) => [x.outcome, x.enabled])).toEqual([['REPAIR', true], ['SAME_MODEL_EXCHANGE', true], ['PRICED_EXCHANGE', true]]);
    expect(pick(o, 'REPAIR').payerDefault).toBe('SHOP');
  });
  it('ผ่อน ในประกันร้าน: SALES เปลี่ยนรุ่นเดิม/มีราคาไม่ได้ พร้อมเหตุผล · BM ได้แต่ต้องยืนยัน', () => {
    const sales = computeOutcomes({ ...base, warrantyStatus: 'IN_SHOP_WARRANTY', daysRemainingIn7Day: 0, defectEligible: false, defectReasons: ['เกินกรอบ 7 วัน'] });
    expect(pick(sales, 'SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: false, reason: 'เกินกรอบ 7 วัน' });
    expect(pick(sales, 'PRICED_EXCHANGE')).toMatchObject({ enabled: false, reason: 'เกินกรอบ 7 วัน — ผจก.สาขาหรือเจ้าของยื่นได้' });
    const bm = computeOutcomes({ ...base, warrantyStatus: 'IN_SHOP_WARRANTY', daysRemainingIn7Day: 0, defectEligible: false, defectReasons: ['เกินกรอบ 7 วัน'], viewerRole: 'BRANCH_MANAGER' });
    expect(pick(bm, 'SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: true, note: 'ข้ามกรอบ 7 วัน — ผจก. ต้องยืนยัน' });
    expect(pick(bm, 'PRICED_EXCHANGE').enabled).toBe(true);
  });
  it('ผ่อน ในประกันศูนย์: ซ่อมเคลมศูนย์เท่านั้น', () => {
    const o = computeOutcomes({ ...base, warrantyStatus: 'IN_MANUFACTURER', daysRemainingIn7Day: 0, defectEligible: false, defectReasons: ['เกินกรอบ 7 วัน'], viewerRole: 'OWNER' });
    expect(pick(o, 'REPAIR').payerDefault).toBe('SUPPLIER_CLAIM');
    expect(pick(o, 'PRICED_EXCHANGE')).toMatchObject({ enabled: false, reason: 'อยู่ในประกันศูนย์ — ส่งเคลมก่อน' });
  });
  it('ผ่อน หมดประกัน: ซ่อมลูกค้าจ่าย · มีราคาได้ (BM)', () => {
    const o = computeOutcomes({ ...base, warrantyStatus: 'OUT_OF_WARRANTY', daysRemainingIn7Day: 0, defectEligible: false, defectReasons: ['เกินกรอบ 7 วัน'], viewerRole: 'BRANCH_MANAGER' });
    expect(pick(o, 'REPAIR').payerDefault).toBe('CUSTOMER');
    expect(pick(o, 'PRICED_EXCHANGE').enabled).toBe(true);
  });
  it('ขายสด ≤7 วัน: ซ่อม + เปลี่ยนรุ่นเดิม(ขายสด) แต่ปิดรอกติกาบัญชี · ไม่มีเปลี่ยนแบบมีราคา', () => {
    const o = computeOutcomes({ ...base, source: 'CASH_SALE', contractStatus: undefined });
    expect(o.map((x) => x.outcome)).toEqual(['REPAIR', 'CASH_SAME_MODEL_EXCHANGE']);
    expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: false, reason: 'รอกติกาบัญชี (สเปกข้อ 10)' });
  });
  it('ขายสด เกิน 7 วัน: ซ่อมอย่างเดียว เหตุผลบอกวัน', () => {
    const o = computeOutcomes({ ...base, source: 'CASH_SALE', contractStatus: undefined, warrantyStatus: 'IN_SHOP_WARRANTY', daysRemainingIn7Day: 0 });
    expect(pick(o, 'CASH_SAME_MODEL_EXCHANGE')).toMatchObject({ enabled: false, reason: 'เกินกรอบ 7 วันแล้ว' });
  });
  it('walk-in (ไม่พบ IMEI หรือพบแต่ไม่มีใบขาย/สัญญา): ซ่อมลูกค้าจ่ายเท่านั้น', () => {
    const o = computeOutcomes({ ...base, source: 'WALK_IN', warrantyStatus: 'WALK_IN', daysRemainingIn7Day: 0, contractStatus: undefined });
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ outcome: 'REPAIR', enabled: true, payerDefault: 'CUSTOMER' });
  });
  it('ทุกทางออกที่ไม่ใช่ REPAIR ยัง implemented=false ใน PR 1', () => {
    expect(computeOutcomes(base).map((x) => x.implemented)).toEqual([true, false, false]);
  });
});
```

- [ ] **Step 2: รันให้แดง** — `cd apps/api && npx jest src/modules/after-sales/__tests__/outcomes.spec.ts` → FAIL

- [ ] **Step 3: เขียน util**

```ts
import type { AfterSalesOutcome, AfterSalesSource, WarrantyStatus } from '@prisma/client';

export interface OutcomeInput {
  source: AfterSalesSource;
  warrantyStatus: WarrantyStatus;
  daysRemainingIn7Day: number;
  contractStatus?: string;
  defectEligible: boolean;   // จาก DefectExchangeService.checkEligibility(...).eligible
  defectReasons: string[];   // ...reasons
  viewerRole: string;
}
export interface OutcomeOption {
  outcome: AfterSalesOutcome;
  enabled: boolean;
  implemented: boolean;      // PR 1: เฉพาะ REPAIR
  reason?: string;           // ทำไมปิด (แสดงใต้ปุ่ม)
  note?: string;             // เงื่อนไขเพิ่มเมื่อเปิด
  payerDefault?: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
}

const MANAGER_UP = new Set(['BRANCH_MANAGER', 'OWNER']);
const PAYER: Record<WarrantyStatus, OutcomeOption['payerDefault']> = {
  IN_7DAY_DEFECT: 'SHOP', IN_SHOP_WARRANTY: 'SHOP', IN_MANUFACTURER: 'SUPPLIER_CLAIM', OUT_OF_WARRANTY: 'CUSTOMER', WALK_IN: 'CUSTOMER',
};

export function computeOutcomes(i: OutcomeInput): OutcomeOption[] {
  const within7 = i.warrantyStatus === 'IN_7DAY_DEFECT' && i.daysRemainingIn7Day > 0;
  const managerUp = MANAGER_UP.has(i.viewerRole);
  const repair: OutcomeOption = { outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: PAYER[i.warrantyStatus] };
  if (i.source === 'WALK_IN') return [repair];

  if (i.source === 'CASH_SALE') {
    const cash: OutcomeOption = { outcome: 'CASH_SAME_MODEL_EXCHANGE', enabled: false, implemented: false,
      reason: within7 ? 'รอกติกาบัญชี (สเปกข้อ 10)' : 'เกินกรอบ 7 วันแล้ว' };
    return [repair, cash];
  }

  // INSTALLMENT_CONTRACT
  const sameModel: OutcomeOption = i.defectEligible
    ? { outcome: 'SAME_MODEL_EXCHANGE', enabled: true, implemented: false, note: 'ผจก.สาขา ต้องยืนยัน' }
    : managerUp
      ? { outcome: 'SAME_MODEL_EXCHANGE', enabled: true, implemented: false, note: 'ข้ามกรอบ 7 วัน — ผจก. ต้องยืนยัน' }
      : { outcome: 'SAME_MODEL_EXCHANGE', enabled: false, implemented: false, reason: i.defectReasons[0] ?? 'ไม่เข้าเงื่อนไขเปลี่ยนรุ่นเดิม' };

  let priced: OutcomeOption;
  if (i.contractStatus !== 'ACTIVE') priced = { outcome: 'PRICED_EXCHANGE', enabled: false, implemented: false, reason: 'สัญญาไม่ได้อยู่ในสถานะเปิดใช้' };
  else if (i.warrantyStatus === 'IN_MANUFACTURER') priced = { outcome: 'PRICED_EXCHANGE', enabled: false, implemented: false, reason: 'อยู่ในประกันศูนย์ — ส่งเคลมก่อน' };
  else if (within7 || managerUp) priced = { outcome: 'PRICED_EXCHANGE', enabled: true, implemented: false, note: 'มีขั้นอนุมัติตามราคารับซื้อ' };
  else priced = { outcome: 'PRICED_EXCHANGE', enabled: false, implemented: false, reason: 'เกินกรอบ 7 วัน — ผจก.สาขาหรือเจ้าของยื่นได้' };
  return [repair, sameModel, priced];
}
```

- [ ] **Step 4: รันให้เขียว** — `npx jest src/modules/after-sales/__tests__/outcomes.spec.ts` → PASS 8 tests

- [ ] **Step 5: DTO + lookup service**

`dto/lookup.dto.ts`:
```ts
import { IsOptional, IsString, IsUUID, MinLength, ValidateIf } from 'class-validator';
export class LookupDto {
  @ValidateIf((o) => !o.customerId) @IsString() @MinLength(4, { message: 'IMEI อย่างน้อย 4 ตัว' }) imei?: string;
  @ValidateIf((o) => !o.imei) @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() productId?: string; // ใช้เมื่อค้นด้วยลูกค้าแล้วเลือกเครื่อง
}
```

`services/after-sales-lookup.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { ProductPhotosService } from '../../quality-control/product-photos.service';
import { computeOutcomes, OutcomeOption } from '../utils/after-sales-outcomes.util';
import { LookupDto } from '../dto/lookup.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };
export interface LookupResult {
  found: boolean;
  source: 'INSTALLMENT_CONTRACT' | 'CASH_SALE' | 'WALK_IN';
  product: { id: string; brand: string; model: string; storage?: string | null; imeiSerial: string | null } | null;
  customer: { id: string; name: string; phone: string | null } | null;
  contract: { id: string; contractNumber: string; status: string } | null;
  sale: { id: string; saleType: string } | null;
  warranty: { status: string; daysRemainingIn7Day: number; purchasedAt: string | null; shopWarrantyEndDate: string | null; manufacturerWarrantyEndDate: string | null; checkedAt: string };
  purchasePhotos: { front: string | null; back: string | null; left: string | null; right: string | null; top: string | null; bottom: string | null } | null; // data URL จาก ProductPhoto (null = ไม่มีรูปตอนซื้อ)
  openCase: { id: string; caseNumber: string; stage: string } | null; // เคสที่ยังไม่ปิดของ IMEI นี้ (กันเปิดซ้ำ)
  outcomes: OutcomeOption[];
}

@Injectable()
export class AfterSalesLookupService {
  constructor(private readonly prisma: PrismaService, private readonly repair: RepairTicketsService,
    private readonly defect: DefectExchangeService, private readonly photos: ProductPhotosService) {}

  async lookup(dto: LookupDto, user: ReqUser): Promise<LookupResult> {
    if (!dto.imei) throw new NotFoundException('ค้นด้วยลูกค้า: เลือกเครื่องก่อน (productId)'); // PR 1: ค้นด้วย IMEI; ค้นด้วยลูกค้าใช้ ContactCombobox แล้วให้พนักงานกรอก IMEI
    const r = await this.repair.lookupByImei(dto.imei, user);
    const checkedAt = new Date().toISOString();
    if (!r.found) {
      return { found: false, source: 'WALK_IN', product: null, customer: null, contract: null, sale: null, purchasePhotos: null, openCase: null,
        warranty: { status: 'WALK_IN', daysRemainingIn7Day: 0, purchasedAt: null, shopWarrantyEndDate: null, manufacturerWarrantyEndDate: null, checkedAt },
        outcomes: computeOutcomes({ source: 'WALK_IN', warrantyStatus: 'WALK_IN', daysRemainingIn7Day: 0, defectEligible: false, defectReasons: [], viewerRole: user.role }) };
    }
    const source = r.contract ? 'INSTALLMENT_CONTRACT' : r.sale ? 'CASH_SALE' : 'WALK_IN'; // Review Focus 1: พบเครื่องแต่ไม่มีใบขาย/สัญญา = walk-in
    let defectEligible = false; let defectReasons: string[] = [];
    if (r.contract) { const e = await this.defect.checkEligibility(r.contract.id); defectEligible = e.eligible; defectReasons = e.reasons; }
    const photos = await this.photos.getPhotos(r.product.id);
    const openCase = await this.prisma.afterSalesCase.findFirst({
      where: { deviceImei: r.product.imeiSerial ?? dto.imei, deletedAt: null, stage: { notIn: ['CLOSED', 'CANCELLED'] } },
      select: { id: true, caseNumber: true, stage: true }, orderBy: { receivedAt: 'desc' } });
    const warrantyStatus = source === 'WALK_IN' ? 'WALK_IN' : r.warrantyStatus;
    return {
      found: true, source, product: r.product, customer: r.customer, contract: r.contract, sale: r.sale, openCase,
      warranty: { status: warrantyStatus, daysRemainingIn7Day: r.daysRemainingIn7Day ?? 0, purchasedAt: r.purchasedAt ?? null, shopWarrantyEndDate: r.shopWarrantyEndDate ?? null, manufacturerWarrantyEndDate: r.manufacturerWarrantyEndDate ?? null, checkedAt },
      purchasePhotos: 'photos' in photos ? photos.photos : null,
      outcomes: computeOutcomes({ source, warrantyStatus, daysRemainingIn7Day: r.daysRemainingIn7Day ?? 0, contractStatus: r.contract?.status, defectEligible, defectReasons, viewerRole: user.role }),
    };
  }
}
```
(ถ้า type ของ `lookupByImei` ไม่ export ให้ประกาศ `type ImeiLookup = Awaited<ReturnType<RepairTicketsService['lookupByImei']>>` แล้ว narrow ด้วย `'found' in r && r.found`)

- [ ] **Step 6: เทสต์ lookup แบบ mock (เพิ่มใน `__tests__/lookup.spec.ts`)** — 3 เคส: ไม่พบ → WALK_IN 1 ทาง · พบ+สัญญา → เรียก `checkEligibility` และ `getPhotos` แล้ว `outcomes` 3 ทาง · พบแต่ไม่มี sale/contract → source WALK_IN และ `warranty.status='WALK_IN'` (Review Focus 1). ใช้ `new AfterSalesLookupService(prisma, repair, defect, photos)` โดย `repair = { lookupByImei: jest.fn() }`, `defect = { checkEligibility: jest.fn() }`, `photos = { getPhotos: jest.fn().mockResolvedValue({ applicable: false }) }`, `prisma = { afterSalesCase: { findFirst: jest.fn().mockResolvedValue(null) } }`

- [ ] **Step 7: รัน** — `npx jest src/modules/after-sales` → PASS ทั้ง 3 ไฟล์

- [ ] **Step 8: Commit** — `git add apps/api/src/modules/after-sales && git commit -m "feat(after-sales): ตารางทางออก computeOutcomes + เช็คประกัน lookup"`

### Task 4: เปิดเคส (แจ้งปัญหาเครื่อง) ในธุรกรรมเดียวกับใบซ่อม + รูปตอนรับฝาก + สำเนารูปตอนซื้อ

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/services/repair-ticket-lifecycle.service.ts:49-120` (แยก `createInTx`)
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` (เปิด `createInTx` ผ่าน facade)
- Create: `apps/api/src/modules/after-sales/dto/create-case.dto.ts`
- Create: `apps/api/src/modules/after-sales/services/after-sales-case.service.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/case-create.spec.ts` (jest, mock) — เคส DB จริงอยู่ใน Task 7

**Interfaces:**
- Consumes: `RepairTicketDocNumberService.nextTicketNumber(tx)` · `AfterSalesDocNumberService.nextCaseNumber(tx)` (Task 2) · `AfterSalesLookupService.lookup` (Task 3) · `StorageService.upload(key, buffer, mime)/delete(key)` (`src/modules/storage/storage.service.ts`, @Global) · `assertEvidenceImage(file, label)` + `evidenceImageExtension(mime)` + `EVIDENCE_IMAGE_MAX_BYTES` จาก `src/utils/upload-image.util.ts` · `AuditService.log(entry)`
- Produces: `RepairTicketLifecycleService.createInTx(dto, user, tx)` (ไม่เปิด tx ไม่เรียก audit) · `RepairTicketsService.createInTx(dto, user, tx)` · `AfterSalesCaseService.createCase(dto: CreateCaseDto, files: Express.Multer.File[], user): Promise<{ id, caseNumber, repairTicketId }>`

- [ ] **Step 1: เขียนเทสต์ facade เดิมยังผ่าน แล้ว refactor `create` → `createInTx`** — รัน `npx jest src/modules/repair-tickets` ก่อนแตะเพื่อจดจำนวนเทสต์ที่ผ่าน จากนั้นแก้ `repair-ticket-lifecycle.service.ts`:

```ts
  /** เขียนใบซ่อมภายใน tx ที่ผู้เรียกเปิดไว้ — ไม่เรียก audit (กติกา database.md: ห้าม audit.log ใน $transaction) */
  async createInTx(dto: CreateRepairTicketDto, user: ReqUser, tx: Prisma.TransactionClient) {
    const contract = dto.contractId ? await tx.contract.findUnique({ where: { id: dto.contractId, deletedAt: null }, select: { id: true, deviceReceivedAt: true, shopWarrantyEndDate: true } }) : null;
    if (dto.contractId && !contract) throw new NotFoundException('ไม่พบสัญญา');
    const product = dto.productId ? await tx.product.findUnique({ where: { id: dto.productId, deletedAt: null }, select: { id: true, warrantyExpireDate: true } }) : null;
    if (dto.productId && !product) throw new NotFoundException('ไม่พบสินค้า');
    const warrantyStatus = detectWarrantyStatus({ contract, product });
    const payer = dto.payer ?? defaultPayer(warrantyStatus);
    const ticketNumber = await this.docNumber.nextTicketNumber(tx);
    const ticket = await tx.repairTicket.create({ data: { /* ...ฟิลด์เดิมทุกตัวจาก create() เดิม... */ ticketNumber, status: 'OPEN', warrantyStatus, payer, branchId: dto.branchId, createdById: user.id, customerId: dto.customerId, contractId: dto.contractId ?? null, productId: dto.productId ?? null, deviceBrand: dto.deviceBrand ?? null, deviceModel: dto.deviceModel ?? null, deviceImei: dto.deviceImei ?? null, deviceSerial: dto.deviceSerial ?? null, defectDescription: dto.defectDescription, repairSupplierId: dto.repairSupplierId ?? null, estimatedCost: dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : null, notes: dto.notes ?? null } });
    await tx.repairStatusLog.create({ data: { ticketId: ticket.id, fromStatus: 'OPEN', toStatus: 'OPEN', changedById: user.id, note: 'รับเรื่องซ่อม' } });
    return { ticket, warrantyStatus, payer };
  }

  async create(dto: CreateRepairTicketDto, user: ReqUser) {
    const { ticket, warrantyStatus, payer } = await this.prisma.$transaction((tx) => this.createInTx(dto, user, tx));
    await this.audit.log({ userId: user.id, action: 'REPAIR_TICKET_CREATED', entity: 'repair_ticket', entityId: ticket.id, newValue: { ticketNumber: ticket.ticketNumber, warrantyStatus, payer } });
    return ticket;
  }
```
ใน facade `repair-tickets.service.ts` เพิ่ม `createInTx(dto, user, tx) { return this.lifecycle.createInTx(dto, user, tx); }` ข้าง `create`. รัน `npx jest src/modules/repair-tickets` → จำนวนผ่านเท่าเดิม (เทสต์ที่ mock `audit.log` ใน tx ถ้ามีให้ปรับ expectation ว่าเรียกหลัง tx — ยังต้องถูกเรียก 1 ครั้ง)

- [ ] **Step 2: DTO (multipart: ฟิลด์มาเป็น string ต้องแปลงเอง)**

```ts
import { Type, Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
const parseJson = ({ value }: { value: unknown }) => (typeof value === 'string' ? JSON.parse(value) : value);
export class CreateCaseDto {
  @IsString() @MinLength(4) imei!: string;                       // ตัวที่สแกน (ค้นซ้ำฝั่ง server เพื่อไม่เชื่อ client)
  @IsOptional() @IsUUID() customerId?: string;                   // บังคับเมื่อ walk-in / ไม่พบ IMEI
  @IsOptional() @IsString() deviceBrand?: string; @IsOptional() @IsString() deviceModel?: string; @IsOptional() @IsString() deviceSerial?: string;
  @IsString() @MinLength(5, { message: 'อาการต้องระบุอย่างน้อย 5 ตัวอักษร' }) symptom!: string;
  @Transform(parseJson) accessories!: { box?: boolean; charger?: boolean; case?: boolean; other?: string };
  @Transform(({ value }) => value === true || value === 'true') @IsBoolean() unlockConfirmed!: boolean;
  @IsOptional() @IsString() note?: string;
  @IsIn(['REPAIR']) outcome!: 'REPAIR';                          // PR 1 รับเฉพาะซ่อม (PR 2 เพิ่ม enum อื่น)
  @IsOptional() @IsIn(['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM']) payer?: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) estimatedCost?: number;
  @IsOptional() @IsUUID() repairSupplierId?: string;
  @IsUUID() branchId!: string;
}
```

- [ ] **Step 3: เทสต์ createCase (mock prisma/tx/storage)** — เคส: (a) พบ IMEI มีสัญญา → เรียก `repair.createInTx` ด้วย `customerId` ของลูกค้าที่พบ, สร้างเคส `source=INSTALLMENT_CONTRACT`, `purchasePhotoKeys` 6 รายการ, `photoKeys` = จำนวนไฟล์, event `RECEIVED`+`OUTCOME_SET`, `audit.log` ถูกเรียก**หลัง** `$transaction` resolve; (b) ไม่มีไฟล์ → `BadRequestException('ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป')` และไม่แตะ storage; (c) 7 ไฟล์ → 400 (Review Focus 3); (d) มีเคสเปิดอยู่ของ IMEI เดิม → `ConflictException` ข้อความมีเลขเคสเดิม (Review Focus 2); (e) tx โยน error หลังอัปโหลด → `storage.delete` ถูกเรียกครบทุก key (Review Focus 3). ไฟล์ mock: `{ buffer: Buffer.from([0xff,0xd8,0xff,0xe0]), mimetype: 'image/jpeg', size: 4, originalname: 'a.jpg' }` และ mock `assertEvidenceImage` ด้วย `jest.mock('../../../utils/upload-image.util', () => ({ ...jest.requireActual(...), assertEvidenceImage: jest.fn() }))`

- [ ] **Step 4: รันให้แดง** — `npx jest src/modules/after-sales/__tests__/case-create.spec.ts` → FAIL

- [ ] **Step 5: เขียน service**

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { AfterSalesDocNumberService } from './after-sales-doc-number.service';
import { AfterSalesLookupService } from './after-sales-lookup.service';
import { CreateCaseDto } from '../dto/create-case.dto';
import { assertEvidenceImage, evidenceImageExtension } from '../../../utils/upload-image.util';

type ReqUser = { id: string; role: string; branchId?: string | null };
const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export const MAX_INTAKE_PHOTOS = 6;

@Injectable()
export class AfterSalesCaseService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly audit: AuditService,
    private readonly repair: RepairTicketsService, private readonly docNumber: AfterSalesDocNumberService, private readonly lookupSvc: AfterSalesLookupService) {}

  async createCase(dto: CreateCaseDto, files: Express.Multer.File[], user: ReqUser) {
    if (!files?.length) throw new BadRequestException('ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป');
    if (files.length > MAX_INTAKE_PHOTOS) throw new BadRequestException(`รูปตอนรับฝากได้ไม่เกิน ${MAX_INTAKE_PHOTOS} รูป`);
    files.forEach((f) => assertEvidenceImage(f, 'รูปตอนรับฝาก'));
    const look = await this.lookupSvc.lookup({ imei: dto.imei }, user);
    if (look.openCase) throw new ConflictException(`เครื่องนี้มีเคสที่ยังไม่ปิดอยู่แล้ว: ${look.openCase.caseNumber}`);
    const customerId = look.customer?.id ?? dto.customerId;
    if (!customerId) throw new BadRequestException('ไม่พบเครื่องในระบบ — ต้องเลือกลูกค้า');
    const outcome = look.outcomes.find((o) => o.outcome === dto.outcome);
    if (!outcome?.enabled) throw new BadRequestException(outcome?.reason ?? 'ทางออกนี้ทำไม่ได้กับเครื่องนี้');

    const id = randomUUID();
    const uploaded: string[] = [];
    const put = async (key: string, buf: Buffer, mime: string) => { await this.storage.upload(key, buf, mime); uploaded.push(key); return key; };
    try {
      const photoKeys = await Promise.all(files.map((f) => put(`after-sales/${id}/intake-${Date.now()}-${randomUUID()}.${evidenceImageExtension(f.mimetype)}`, f.buffer, f.mimetype)));
      const purchasePhotoKeys: string[] = [];
      for (const angle of ANGLES) {            // สำเนา ProductPhoto (data URL) ณ วันแจ้ง — D6
        const dataUrl = look.purchasePhotos?.[angle];
        if (!dataUrl) continue;
        const [head, b64] = dataUrl.split(',');
        const mime = /^data:(image\/[a-z]+);base64$/.exec(head)?.[1] ?? 'image/jpeg';
        purchasePhotoKeys.push(await put(`after-sales/${id}/purchase-${angle}.${evidenceImageExtension(mime)}`, Buffer.from(b64, 'base64'), mime));
      }
      const result = await this.prisma.$transaction(async (tx) => {
        const caseNumber = await this.docNumber.nextCaseNumber(tx);
        const { ticket } = await this.repair.createInTx({
          customerId, contractId: look.contract?.id, productId: look.product?.id, branchId: dto.branchId,
          deviceBrand: look.product?.brand ?? dto.deviceBrand, deviceModel: look.product?.model ?? dto.deviceModel,
          deviceImei: look.product?.imeiSerial ?? dto.imei, deviceSerial: dto.deviceSerial,
          defectDescription: dto.symptom, payer: dto.payer ?? outcome.payerDefault, estimatedCost: dto.estimatedCost, repairSupplierId: dto.repairSupplierId, notes: dto.note,
        } as never, user, tx);
        const c = await tx.afterSalesCase.create({ data: {
          id, caseNumber, branchId: dto.branchId, customerId, source: look.source, contractId: look.contract?.id ?? null, saleId: look.sale?.id ?? null, productId: look.product?.id ?? null,
          deviceBrand: ticket.deviceBrand, deviceModel: ticket.deviceModel, deviceImei: ticket.deviceImei, deviceSerial: ticket.deviceSerial,
          symptom: dto.symptom, accessories: dto.accessories ?? {}, unlockConfirmed: dto.unlockConfirmed, photoKeys, purchasePhotoKeys,
          warrantySnapshot: { ...look.warranty, within7Days: look.warranty.daysRemainingIn7Day > 0 }, outcome: 'REPAIR', repairTicketId: ticket.id, stage: 'RECEIVED', receivedById: user.id,
          events: { create: [
            { kind: 'RECEIVED', actorId: user.id, note: `รับเรื่องแล้ว · รูป ${photoKeys.length} · รูปตอนซื้อ ${purchasePhotoKeys.length}` },
            { kind: 'OUTCOME_SET', actorId: user.id, note: `ซ่อม · ผู้จ่าย ${ticket.payer}${ticket.repairSupplierId ? ' · ส่งศูนย์' : ' · ซ่อมที่ร้าน'}` },
          ] },
        }, select: { id: true, caseNumber: true, repairTicketId: true } });
        return c;
      });
      await this.audit.log({ userId: user.id, action: 'AFTER_SALES_CASE_CREATED', entity: 'after_sales_case', entityId: result.id, newValue: { caseNumber: result.caseNumber, outcome: 'REPAIR', repairTicketId: result.repairTicketId } });
      return result;
    } catch (err) {
      await Promise.all(uploaded.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw err;
    }
  }
}
```

- [ ] **Step 6: รันให้เขียว** — `npx jest src/modules/after-sales` → PASS · `npx jest src/modules/repair-tickets` → เท่าเดิม

- [ ] **Step 7: Commit** — `git add apps/api/src/modules/after-sales apps/api/src/modules/repair-tickets && git commit -m "feat(after-sales): เปิดเคสพร้อมใบซ่อมในธุรกรรมเดียว + รูปตอนรับฝาก + สำเนารูปตอนซื้อ"`

### Task 5: `deriveStage` + รายการ/สรุป/รายละเอียดเคส

**Files:**
- Create: `apps/api/src/modules/after-sales/utils/after-sales-stage.util.ts`
- Create: `apps/api/src/modules/after-sales/dto/list-cases.dto.ts`
- Create: `apps/api/src/modules/after-sales/services/after-sales-query.service.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/stage.spec.ts`

**Interfaces:**
- Consumes: `hasCrossBranchAccess(user)` จาก `src/modules/auth/branch-access.util.ts` · Prisma models Task 1
- Produces: `deriveStage(input: StageInput): AfterSalesStage` · `AfterSalesQueryService.list(dto, user)` → `{ data: CaseRow[], total, page, limit, summary? }` · `getCase(id, user)` → `CaseDetail` · `findByTicket(ticketId, user)` → `{ id }` · `STALE_DAYS = { IN_REPAIR: 14, READY_FOR_PICKUP: 7, AWAITING_APPROVAL: 2 }`

- [ ] **Step 1: เทสต์ deriveStage (ตารางสเปกข้อ 5 + Review Focus 5)**

```ts
import { deriveStage } from '../utils/after-sales-stage.util';
describe('deriveStage', () => {
  it.each([
    [{ outcome: null, cancelledAt: null, repairStatus: null }, 'RECEIVED'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'OPEN' }, 'RECEIVED'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'IN_PROGRESS' }, 'IN_REPAIR'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'READY_FOR_PICKUP' }, 'READY_FOR_PICKUP'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'CLOSED' }, 'CLOSED'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'REPLACED' }, 'CLOSED'],
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: 'CANCELLED' }, 'CANCELLED'],   // ใบซ่อมถูกยกเลิกจากหน้าเก่า
    [{ outcome: 'REPAIR', cancelledAt: null, repairStatus: null, repairDeleted: true }, 'CANCELLED'], // ใบซ่อมถูกลบ
    [{ outcome: 'REPAIR', cancelledAt: new Date(), repairStatus: 'OPEN' }, 'CANCELLED'],
  ] as const)('%j → %s', (input, expected) => { expect(deriveStage(input as never)).toBe(expected); });
});
```

- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/after-sales/__tests__/stage.spec.ts`

- [ ] **Step 3: util**

```ts
import type { AfterSalesOutcome, AfterSalesStage, RepairStatus } from '@prisma/client';
export interface StageInput { outcome: AfterSalesOutcome | null; cancelledAt: Date | null; repairStatus: RepairStatus | null; repairDeleted?: boolean }
const REPAIR_STAGE: Record<RepairStatus, AfterSalesStage> = { OPEN: 'RECEIVED', IN_PROGRESS: 'IN_REPAIR', READY_FOR_PICKUP: 'READY_FOR_PICKUP', CLOSED: 'CLOSED', REPLACED: 'CLOSED', CANCELLED: 'CANCELLED' };
export const STALE_DAYS: Partial<Record<AfterSalesStage, number>> = { IN_REPAIR: 14, READY_FOR_PICKUP: 7, AWAITING_APPROVAL: 2 };
/** stage คำนวณจากบันทึกของทางออก ไม่รับจาก client (spec ข้อ 5) — PR 2 เพิ่มกิ่ง SAME_MODEL/PRICED */
export function deriveStage(i: StageInput): AfterSalesStage {
  if (i.cancelledAt) return 'CANCELLED';
  if (i.outcome === 'REPAIR') { if (i.repairDeleted || !i.repairStatus) return 'CANCELLED'; return REPAIR_STAGE[i.repairStatus]; }
  return 'RECEIVED';
}
/** วันที่ใช้วัด "ค้างนาน" ของ stage นั้น */
export function stageSince(stage: AfterSalesStage, t: { sentToRepairAt: Date | null; repairedAt: Date | null } | null, receivedAt: Date): Date {
  if (stage === 'IN_REPAIR' && t?.sentToRepairAt) return t.sentToRepairAt;
  if (stage === 'READY_FOR_PICKUP' && t?.repairedAt) return t.repairedAt;
  return receivedAt;
}
export const isStale = (stage: AfterSalesStage, since: Date, now = new Date()) => { const d = STALE_DAYS[stage]; return d != null && now.getTime() - since.getTime() > d * 86400000; };
```

- [ ] **Step 4: รันให้เขียว** — PASS 9 cases

- [ ] **Step 5: ListDto + query service**

`dto/list-cases.dto.ts` (โคลนโครงจาก `repair-tickets/dto/list-repair-tickets.dto.ts`): `tab?: 'ACTIVE'|'AWAITING_APPROVAL'|'READY'|'DONE'` (default `ACTIVE`) · `branchId?` UUID · `q?` string (เลขเคส/IMEI/ชื่อ/เบอร์/เลขสัญญา) · `stale?` boolean · `summary?` boolean · `page = 1` · `limit = 50 (max 200)`

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { deriveStage, isStale, stageSince } from '../utils/after-sales-stage.util';
import { ListCasesDto } from '../dto/list-cases.dto';
type ReqUser = { id: string; role: string; branchId?: string | null };
const TAB_STAGES = { ACTIVE: ['RECEIVED', 'IN_REPAIR', 'AWAITING_APPROVAL'], AWAITING_APPROVAL: ['AWAITING_APPROVAL'], READY: ['READY_FOR_PICKUP'], DONE: ['CLOSED', 'CANCELLED'] } as const;
const ROW_SELECT = { id: true, caseNumber: true, source: true, outcome: true, stage: true, receivedAt: true, deviceBrand: true, deviceModel: true, deviceImei: true, branchId: true,
  customer: { select: { id: true, name: true, phone: true } }, branch: { select: { id: true, name: true } }, receivedBy: { select: { id: true, name: true } },
  repairTicket: { select: { id: true, ticketNumber: true, status: true, payer: true, estimatedCost: true, actualCost: true, sentToRepairAt: true, repairedAt: true, repairSupplierId: true, deletedAt: true } } } satisfies Prisma.AfterSalesCaseSelect;

@Injectable()
export class AfterSalesQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private branchWhere(user: ReqUser, branchId?: string): Prisma.AfterSalesCaseWhereInput {
    if (!hasCrossBranchAccess(user)) { if (!user.branchId) throw new ForbiddenException('บัญชีไม่ได้ผูกสาขา'); return { branchId: user.branchId }; }
    return branchId ? { branchId } : {};
  }

  /** stage จริง ณ ตอนอ่าน (กันกรณีใบซ่อมถูกแก้จากหน้าเก่า) + ป้ายค้างนาน */
  private decorate<T extends { stage: string; outcome: any; cancelledAt?: Date | null; receivedAt: Date; repairTicket: { status: any; deletedAt: Date | null; sentToRepairAt: Date | null; repairedAt: Date | null } | null }>(row: T) {
    const stage = deriveStage({ outcome: row.outcome, cancelledAt: row.cancelledAt ?? null, repairStatus: row.repairTicket?.status ?? null, repairDeleted: !!row.repairTicket?.deletedAt });
    const since = stageSince(stage, row.repairTicket, row.receivedAt);
    return { ...row, stage, stageSince: since, stale: isStale(stage, since), daysInStage: Math.floor((Date.now() - since.getTime()) / 86400000) };
  }

  async list(dto: ListCasesDto, user: ReqUser) {
    const where: Prisma.AfterSalesCaseWhereInput = { deletedAt: null, ...this.branchWhere(user, dto.branchId), stage: { in: [...TAB_STAGES[dto.tab ?? 'ACTIVE']] } };
    if (dto.q) where.OR = [{ caseNumber: { contains: dto.q, mode: 'insensitive' } }, { deviceImei: { contains: dto.q } }, { customer: { name: { contains: dto.q, mode: 'insensitive' } } }, { customer: { phone: { contains: dto.q } } }, { repairTicket: { contract: { contractNumber: { contains: dto.q, mode: 'insensitive' } } } }];
    const page = dto.page ?? 1, limit = dto.limit ?? 50;
    const [rows, total] = await Promise.all([
      this.prisma.afterSalesCase.findMany({ where, select: { ...ROW_SELECT, cancelledAt: true }, orderBy: { receivedAt: 'asc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.afterSalesCase.count({ where }) ]);
    let data = rows.map((r) => this.decorate(r));
    if (dto.stale) data = data.filter((r) => r.stale);
    data.sort((a, b) => Number(b.stale) - Number(a.stale) || a.stageSince.getTime() - b.stageSince.getTime()); // ค้างนานก่อน
    return { data, total, page, limit, summary: dto.summary ? await this.summary(user, dto.branchId) : undefined };
  }

  /** แถบตัวเลขเจ้าของ (spec ข้อ 9) — PR 1 คิดจากใบซ่อมของเคส; awaitingApproval/exchanges = 0 จน PR 2 */
  async summary(user: ReqUser, branchId?: string) {
    const scope = { deletedAt: null, ...this.branchWhere(user, branchId) };
    const open = await this.prisma.afterSalesCase.findMany({ where: { ...scope, stage: { notIn: ['CLOSED', 'CANCELLED'] } }, select: { ...ROW_SELECT, cancelledAt: true } });
    const rows = open.map((r) => this.decorate(r));
    const monthStart = new Date(new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 7) + '-01T00:00:00+07:00');
    const closed = await this.prisma.repairTicket.findMany({ where: { status: 'CLOSED', deletedAt: null, returnedToCustomerAt: { gte: monthStart }, afterSalesCase: { isNot: null, ...(scope.branchId ? { is: { branchId: scope.branchId } } : {}) } }, select: { payer: true, actualCost: true } });
    const sum = (p: string) => closed.filter((t) => t.payer === p).reduce((s, t) => s + Number(t.actualCost ?? 0), 0);
    const money = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user.role);
    return { open: rows.length, openRepair: rows.filter((r) => r.outcome === 'REPAIR').length, openExchange: 0, stale: rows.filter((r) => r.stale).length, awaitingApproval: rows.filter((r) => r.stage === 'AWAITING_APPROVAL').length,
      repairCostShop: money ? sum('SHOP') : null, repairCostCustomer: money ? sum('CUSTOMER') : null, supplierClaims: closed.filter((t) => t.payer === 'SUPPLIER_CLAIM').length, exchanges: 0 };
  }

  async getCase(id: string, user: ReqUser) {
    const row = await this.prisma.afterSalesCase.findFirst({ where: { id, deletedAt: null }, include: { customer: { select: { id: true, name: true, phone: true } }, branch: { select: { id: true, name: true } }, receivedBy: { select: { id: true, name: true } },
      repairTicket: { include: { repairSupplier: { select: { id: true, name: true } }, statusLogs: { orderBy: { createdAt: 'asc' }, include: { changedBy: { select: { name: true } } } }, expenseDocument: { select: { id: true, docNumber: true } }, otherIncome: { select: { id: true, docNumber: true } }, contract: { select: { id: true, contractNumber: true } } } },
      events: { orderBy: { createdAt: 'asc' } } } });
    if (!row) throw new NotFoundException('ไม่พบเคส');
    if (!hasCrossBranchAccess(user) && row.branchId !== user.branchId) throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
    const lineLinked = !!(await this.prisma.customerLineLink.findFirst({ where: { customerId: row.customerId }, select: { id: true } }).catch(() => null)); // ถ้า model ชื่ออื่น ให้ grep "customerLineLink" ใน sale-warranty-notifier.service.ts
    const d = this.decorate(row);
    const timeline = [
      ...row.events.map((e) => ({ at: e.createdAt, kind: e.kind, note: e.note, actorId: e.actorId })),
      ...(row.repairTicket?.statusLogs ?? []).filter((l) => !(l.fromStatus === 'OPEN' && l.toStatus === 'OPEN')).map((l) => ({ at: l.createdAt, kind: `REPAIR_${l.toStatus}`, note: l.note, actorName: l.changedBy?.name })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return { ...d, lineLinked, timeline, photoCount: row.photoKeys.length, purchasePhotoAngles: row.purchasePhotoKeys.map((k) => /purchase-([a-z]+)\./.exec(k)?.[1] ?? '') , photoKeys: undefined, purchasePhotoKeys: undefined };
  }

  async findByTicket(ticketId: string, user: ReqUser) {
    const row = await this.prisma.afterSalesCase.findFirst({ where: { repairTicketId: ticketId, deletedAt: null }, select: { id: true, branchId: true } });
    if (!row) throw new NotFoundException('ใบซ่อมนี้ยังไม่มีเคส');
    if (!hasCrossBranchAccess(user) && row.branchId !== user.branchId) throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
    return { id: row.id };
  }
}
```
(`stage` ที่เก็บในตารางใช้สำหรับกรอง/index — Task 6 จะเขียนกลับหลังทุก transition ด้วย `deriveStage` เดียวกัน; `list` ยังคำนวณซ้ำตอนอ่านเพื่อกันใบซ่อมที่ถูกแก้จากหน้าเก่า)

- [ ] **Step 6: เทสต์ query แบบ mock 2 เคส** ใน `__tests__/query.spec.ts`: (a) SALES สาขา A `list` → `where.branchId` = A และส่ง `branchId` สาขา B มาก็ยังถูกแทนด้วย A · `getCase` ของสาขา B → `ForbiddenException` (Review Focus 4) (b) `summary` สำหรับ SALES คืน `repairCostShop: null`

- [ ] **Step 7: รัน + Commit** — `npx jest src/modules/after-sales` PASS → `git commit -m "feat(after-sales): deriveStage + รายการ/สรุป/รายละเอียดเคส"`

### Task 6: proxy ใบซ่อม · ยกเลิกเคส · เพิ่มรูป · อ่านรูป

**Files:**
- Create: `apps/api/src/modules/after-sales/services/after-sales-repair.service.ts`
- Create: `apps/api/src/modules/after-sales/dto/cancel-case.dto.ts` (`@IsString() @MinLength(10) reason!: string`)
- Test: `apps/api/src/modules/after-sales/__tests__/repair-proxy.spec.ts`

**Interfaces:**
- Consumes: `RepairTicketsService.send(id, SendDto{repairSupplierId!, sentToRepairAt?, externalClaimNo?, estimatedCost?}, user)` · `markRepaired(id, MarkRepairedDto{actualCost!, payer!, repairedAt?}, user)` · `sendBack(id, SendBackDto{note!}, user)` · `returnToCustomer(id, ReturnToCustomerDto{returnedToCustomerAt?}, user)` · `cancel(id, CancelDto{note!}, user)` · `StorageService.getStream(key)/upload/delete` · `AfterSalesQueryService.getCase`
- Produces: `AfterSalesRepairService.send/markRepaired/sendBack/returnToCustomer(caseId, dto, user)` · `cancelCase(caseId, dto, user)` · `addPhoto(caseId, file, user)` · `getPhoto(caseId, index, user)` / `getPurchasePhoto(caseId, angle, user)` → `{ key, stream }`

- [ ] **Step 1: เทสต์ (mock)** — (a) `send` เรียก `repair.send(ticketId, dto, user)` แล้ว update เคส `stage='IN_REPAIR'` + event `REPAIR_SENT` (b) `returnToCustomer` → `stage='CLOSED'`, `closedAt` ตั้ง, event `DELIVERED`+`CLOSED` (c) `cancelCase` เมื่อใบซ่อม OPEN → เรียก `repair.cancel` ด้วย `{ note: reason }`; เมื่อใบซ่อม IN_PROGRESS → `BadRequestException('ยกเลิกไม่ได้ เครื่องอยู่ที่ศูนย์ — บันทึกส่งซ่อมต่อ/ซ่อมเสร็จก่อน')` (d) `addPhoto` รูปที่ 7 → 400 และไม่ upload (Review Focus 3) (e) `getPhoto(index=5)` เมื่อมี 3 รูป → `NotFoundException`

- [ ] **Step 2: รันให้แดง** — `npx jest src/modules/after-sales/__tests__/repair-proxy.spec.ts`

- [ ] **Step 3: service**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { SendDto } from '../../repair-tickets/dto/send.dto';
import { MarkRepairedDto } from '../../repair-tickets/dto/mark-repaired.dto';
import { SendBackDto } from '../../repair-tickets/dto/send-back.dto';
import { ReturnToCustomerDto } from '../../repair-tickets/dto/return-to-customer.dto';
import { assertEvidenceImage, evidenceImageExtension } from '../../../utils/upload-image.util';
import { AfterSalesQueryService } from './after-sales-query.service';
import { deriveStage } from '../utils/after-sales-stage.util';
import { MAX_INTAKE_PHOTOS } from './after-sales-case.service';
import { CancelCaseDto } from '../dto/cancel-case.dto';
type ReqUser = { id: string; role: string; branchId?: string | null };
type Kind = 'REPAIR_SENT' | 'REPAIR_DONE' | 'REPAIR_SENT_BACK' | 'DELIVERED' | 'PHOTO_ADDED' | 'CANCELLED' | 'CLOSED';

@Injectable()
export class AfterSalesRepairService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly repair: RepairTicketsService, private readonly query: AfterSalesQueryService) {}

  /** โหลดเคส (เช็คสิทธิ์สาขาผ่าน query.getCase) แล้วคืน ticketId */
  private async ticketOf(caseId: string, user: ReqUser) {
    const c = await this.query.getCase(caseId, user);
    if (!c.repairTicket) throw new BadRequestException('เคสนี้ไม่ได้เลือกทางออก "ซ่อม"');
    return { c, ticketId: c.repairTicket.id };
  }
  /** เขียน stage กลับ + event หลังใบซ่อมเปลี่ยนสถานะ (นอก tx ของใบซ่อม — ใบซ่อมคือความจริง เคสตามหลัง) */
  private async sync(caseId: string, user: ReqUser, kind: Kind, note: string, extra: Record<string, unknown> = {}) {
    const t = await this.prisma.repairTicket.findFirst({ where: { afterSalesCase: { id: caseId } }, select: { status: true, deletedAt: true } });
    const stage = deriveStage({ outcome: 'REPAIR', cancelledAt: null, repairStatus: t?.status ?? null, repairDeleted: !!t?.deletedAt });
    return this.prisma.afterSalesCase.update({ where: { id: caseId }, data: { stage, ...(stage === 'CLOSED' ? { closedAt: new Date() } : {}), ...extra, events: { create: { kind, note, actorId: user.id } } }, select: { id: true, stage: true } });
  }

  async send(caseId: string, dto: SendDto, user: ReqUser) { const { ticketId } = await this.ticketOf(caseId, user); await this.repair.send(ticketId, dto, user); return this.sync(caseId, user, 'REPAIR_SENT', `ส่งซ่อม${dto.externalClaimNo ? ` · เลขเคลม ${dto.externalClaimNo}` : ''}`); }
  async markRepaired(caseId: string, dto: MarkRepairedDto, user: ReqUser) { const { ticketId } = await this.ticketOf(caseId, user); await this.repair.markRepaired(ticketId, dto, user); return this.sync(caseId, user, 'REPAIR_DONE', `ซ่อมเสร็จ · ค่าซ่อมจริง ${dto.actualCost} · ผู้จ่าย ${dto.payer}`); }
  async sendBack(caseId: string, dto: SendBackDto, user: ReqUser) { const { ticketId } = await this.ticketOf(caseId, user); await this.repair.sendBack(ticketId, dto, user); return this.sync(caseId, user, 'REPAIR_SENT_BACK', dto.note); }
  async returnToCustomer(caseId: string, dto: ReturnToCustomerDto, user: ReqUser) { const { ticketId } = await this.ticketOf(caseId, user); await this.repair.returnToCustomer(ticketId, dto, user); await this.sync(caseId, user, 'DELIVERED', 'ส่งมอบคืนลูกค้าแล้ว'); return this.sync(caseId, user, 'CLOSED', 'ปิดเคส'); }

  async cancelCase(caseId: string, dto: CancelCaseDto, user: ReqUser) {
    const { c, ticketId } = await this.ticketOf(caseId, user);
    if (c.repairTicket!.status === 'IN_PROGRESS') throw new BadRequestException('ยกเลิกไม่ได้ เครื่องอยู่ที่ศูนย์ — บันทึกส่งซ่อมต่อ/ซ่อมเสร็จก่อน');
    if (['CLOSED', 'REPLACED', 'CANCELLED'].includes(c.repairTicket!.status)) throw new BadRequestException('เคสนี้จบแล้ว');
    await this.repair.cancel(ticketId, { note: dto.reason }, user);
    return this.sync(caseId, user, 'CANCELLED', dto.reason, { cancelledAt: new Date(), cancelReason: dto.reason });
  }

  async addPhoto(caseId: string, file: Express.Multer.File, user: ReqUser) {
    const c = await this.query.getCase(caseId, user);
    const row = await this.prisma.afterSalesCase.findUniqueOrThrow({ where: { id: caseId }, select: { photoKeys: true } });
    if (row.photoKeys.length >= MAX_INTAKE_PHOTOS) throw new BadRequestException(`รูปตอนรับฝากได้ไม่เกิน ${MAX_INTAKE_PHOTOS} รูป`);
    assertEvidenceImage(file, 'รูปตอนรับฝาก');
    const key = `after-sales/${caseId}/intake-${Date.now()}-${randomUUID()}.${evidenceImageExtension(file.mimetype)}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    try { await this.prisma.afterSalesCase.update({ where: { id: caseId }, data: { photoKeys: { push: key }, events: { create: { kind: 'PHOTO_ADDED', actorId: user.id, note: `เพิ่มรูป (${row.photoKeys.length + 1}/${MAX_INTAKE_PHOTOS})` } } } }); }
    catch (e) { await this.storage.delete(key).catch(() => undefined); throw e; }
    return { photoCount: row.photoKeys.length + 1, stage: c.stage };
  }

  async getPhoto(caseId: string, index: number, user: ReqUser) {
    await this.query.getCase(caseId, user);
    const row = await this.prisma.afterSalesCase.findUniqueOrThrow({ where: { id: caseId }, select: { photoKeys: true } });
    const key = row.photoKeys[index]; if (!key) throw new NotFoundException('ไม่มีรูปลำดับนี้');
    return { key, stream: await this.storage.getStream(key) };
  }
  async getPurchasePhoto(caseId: string, angle: string, user: ReqUser) {
    await this.query.getCase(caseId, user);
    const row = await this.prisma.afterSalesCase.findUniqueOrThrow({ where: { id: caseId }, select: { purchasePhotoKeys: true } });
    const key = row.purchasePhotoKeys.find((k) => k.includes(`/purchase-${angle}.`)); if (!key) throw new NotFoundException('ไม่มีรูปตอนซื้อมุมนี้');
    return { key, stream: await this.storage.getStream(key) };
  }
}
```

- [ ] **Step 4: รันให้เขียว + Commit** — `npx jest src/modules/after-sales` PASS → `git commit -m "feat(after-sales): proxy ใบซ่อม ยกเลิกเคส เพิ่ม/อ่านรูป"`

### Task 7: Controller + Module + ลงทะเบียน + integration spec บน DB จริง

**Files:**
- Create: `apps/api/src/modules/after-sales/after-sales.controller.ts` · `after-sales.module.ts` · `after-sales.service.ts` (facade บาง ๆ)
- Modify: `apps/api/src/app.module.ts` (import + ใส่ใน `imports:` ถัดจาก `RepairTicketsModule` บรรทัด ~221)
- Modify: `.github/workflows/deploy-gcp.yml` (~บรรทัด 264 เพิ่ม `AFTERSALES_FILES=$(ls src/modules/after-sales/__tests__/*.integration.spec.ts)` และต่อท้ายคำสั่ง vitest)
- Test: `apps/api/src/modules/after-sales/__tests__/after-sales-flow.integration.spec.ts` (vitest)

**Interfaces:**
- Produces (HTTP, prefix `/api/admin/after-sales`): `GET lookup?imei=` · `POST /` (multipart: ฟิลด์ `CreateCaseDto` + `photos[]`) · `GET /?tab=&q=&stale=&summary=&branchId=&page=&limit=` · `GET /by-ticket/:ticketId` · `GET /:id` · `GET /:id/photos/:index` · `GET /:id/purchase-photos/:angle` · `POST /:id/photos` (multipart `file`) · `POST /:id/repair/send|mark-repaired|send-back|return` · `POST /:id/cancel`

- [ ] **Step 1: module + facade**

```ts
// after-sales.module.ts
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RepairTicketsModule } from '../repair-tickets/repair-tickets.module';
import { DefectExchangeModule } from '../defect-exchange/defect-exchange.module';
import { QualityControlModule } from '../quality-control/quality-control.module'; // ต้อง export ProductPhotosService — ถ้ายังไม่ export ให้เพิ่มใน exports ของโมดูลนั้น
import { AfterSalesController } from './after-sales.controller';
import { AfterSalesService } from './after-sales.service';
import { AfterSalesDocNumberService } from './services/after-sales-doc-number.service';
import { AfterSalesLookupService } from './services/after-sales-lookup.service';
import { AfterSalesCaseService } from './services/after-sales-case.service';
import { AfterSalesQueryService } from './services/after-sales-query.service';
import { AfterSalesRepairService } from './services/after-sales-repair.service';
@Module({ imports: [AuditModule, RepairTicketsModule, DefectExchangeModule, QualityControlModule], controllers: [AfterSalesController],
  providers: [AfterSalesService, AfterSalesDocNumberService, AfterSalesLookupService, AfterSalesCaseService, AfterSalesQueryService, AfterSalesRepairService], exports: [AfterSalesService] })
export class AfterSalesModule {}
```
facade `after-sales.service.ts`: inject 4 service แล้ว re-export method ชื่อเดิม (`lookup`, `createCase`, `list`, `getCase`, `findByTicket`, `send`, `markRepaired`, `sendBack`, `returnToCustomer`, `cancelCase`, `addPhoto`, `getPhoto`, `getPurchasePhoto`) — ไม่มี logic

- [ ] **Step 2: controller (guards ครบตาม security.md · static route ก่อน `:id`)**

```ts
import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AfterSalesService } from './after-sales.service';
import { LookupDto } from './dto/lookup.dto';
import { CreateCaseDto } from './dto/create-case.dto';
import { ListCasesDto } from './dto/list-cases.dto';
import { CancelCaseDto } from './dto/cancel-case.dto';
import { SendDto } from '../repair-tickets/dto/send.dto';
import { MarkRepairedDto } from '../repair-tickets/dto/mark-repaired.dto';
import { SendBackDto } from '../repair-tickets/dto/send-back.dto';
import { ReturnToCustomerDto } from '../repair-tickets/dto/return-to-customer.dto';
import { EVIDENCE_IMAGE_MAX_BYTES } from '../../utils/upload-image.util';

const ALL = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'] as const;
const STAFF = ['OWNER', 'BRANCH_MANAGER', 'SALES'] as const;
const MGR = ['OWNER', 'BRANCH_MANAGER'] as const;
const sendImage = (res: Response, key: string, stream: NodeJS.ReadableStream) => { const ext = key.split('.').pop(); res.setHeader('Content-Type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'); res.setHeader('Content-Disposition', 'inline'); res.setHeader('Cache-Control', 'private, max-age=300'); stream.pipe(res); };

@Controller('after-sales')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class AfterSalesController {
  constructor(private readonly svc: AfterSalesService) {}
  @Get('lookup') @Roles(...ALL) lookup(@Query() dto: LookupDto, @CurrentUser() user: any) { return this.svc.lookup(dto, user); }
  @Post() @Roles(...STAFF) @UseInterceptors(FilesInterceptor('photos', 6, { limits: { fileSize: EVIDENCE_IMAGE_MAX_BYTES } }))
  create(@Body() dto: CreateCaseDto, @UploadedFiles() photos: Express.Multer.File[], @CurrentUser() user: any) { return this.svc.createCase(dto, photos ?? [], user); }
  @Get() @Roles(...ALL) list(@Query() dto: ListCasesDto, @CurrentUser() user: any) { return this.svc.list(dto, user); }
  @Get('by-ticket/:ticketId') @Roles(...ALL) byTicket(@Param('ticketId', ParseUUIDPipe) ticketId: string, @CurrentUser() user: any) { return this.svc.findByTicket(ticketId, user); }
  @Get(':id') @Roles(...ALL) get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) { return this.svc.getCase(id, user); }
  @Get(':id/photos/:index') @Roles(...ALL) async photo(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number, @CurrentUser() user: any, @Res() res: Response) { const { key, stream } = await this.svc.getPhoto(id, index, user); sendImage(res, key, stream); }
  @Get(':id/purchase-photos/:angle') @Roles(...ALL) async purchasePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('angle') angle: string, @CurrentUser() user: any, @Res() res: Response) { const { key, stream } = await this.svc.getPurchasePhoto(id, angle, user); sendImage(res, key, stream); }
  @Post(':id/photos') @Roles(...STAFF) @UseInterceptors(FileInterceptor('file', { limits: { fileSize: EVIDENCE_IMAGE_MAX_BYTES } }))
  addPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: any) { return this.svc.addPhoto(id, file, user); }
  @Post(':id/repair/send') @Roles(...STAFF) send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendDto, @CurrentUser() user: any) { return this.svc.send(id, dto, user); }
  @Post(':id/repair/mark-repaired') @Roles(...STAFF) markRepaired(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkRepairedDto, @CurrentUser() user: any) { return this.svc.markRepaired(id, dto, user); }
  @Post(':id/repair/send-back') @Roles(...STAFF) sendBack(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendBackDto, @CurrentUser() user: any) { return this.svc.sendBack(id, dto, user); }
  @Post(':id/repair/return') @Roles(...STAFF) ret(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnToCustomerDto, @CurrentUser() user: any) { return this.svc.returnToCustomer(id, dto, user); }
  @Post(':id/cancel') @Roles(...MGR) cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelCaseDto, @CurrentUser() user: any) { return this.svc.cancelCase(id, dto, user); }
}
```

- [ ] **Step 3: ลงทะเบียนใน `app.module.ts` + boot** — เพิ่ม `import { AfterSalesModule } from './modules/after-sales/after-sales.module';` และ `AfterSalesModule,` ถัดจาก `RepairTicketsModule,` · รัน `cd apps/api && npx nest build 2>&1 | tail -3` → ไม่มี error · ถ้า `QualityControlModule` ไม่ export `ProductPhotosService` ให้เพิ่ม `exports: [ProductPhotosService]` (ตรวจว่าโมดูลชื่อไฟล์ตรง: `ls src/modules/quality-control/*.module.ts`)

- [ ] **Step 4: integration spec (vitest, DB จริง, ล้างข้อมูลตัวเอง)** — ไฟล์ `__tests__/after-sales-flow.integration.spec.ts` โครงตาม `src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts` (wiring instance จริงด้วย `new`, `PREFIX`/`RUN`, `created` tracker, `afterAll` ลบลูกก่อนแม่ รวม `after_sales_events` → `after_sales_cases` → `repair_status_logs` → `repair_tickets` → product/customer/branch ที่สร้าง). StorageService ใช้ตัวปลอมในหน่วยความจำ: `const files = new Map<string, Buffer>(); const storage = { upload: async (k, b) => { files.set(k, b); return k; }, delete: async (k) => { files.delete(k); }, getStream: async (k) => Readable.from(files.get(k)!) } as never;` · `ProductPhotosService` ปลอมคืน `{ photos: { front: 'data:image/jpeg;base64,/9j/4AAQ', back: null, left: null, right: null, top: null, bottom: null } }` · `DefectExchangeService` ปลอมคืน `{ eligible: false, reasons: ['เกินกรอบ 7 วัน'] }`
  เคสที่ต้องมี:
  1. seed: branch, user OWNER (`admin@bestchoice.com` find-or-create), customer, product PHONE_USED มี `imeiSerial = PREFIX+RUN`, ใบขายสด (`sale`) ผูก product+customer เมื่อ 3 วันก่อน (ใช้ model/ฟิลด์ตามที่ `lookupByImei` อ่าน — เปิด `repair-warranty.service.ts:316-397` ดูชื่อฟิลด์จริงก่อน seed)
  2. `lookup({imei})` → `found=true`, `source='CASH_SALE'`, `outcomes[0].outcome='REPAIR'`, `outcomes[1]` = `CASH_SAME_MODEL_EXCHANGE` ปิด
  3. `createCase(dto, [jpegFile], user)` → เลข `AS-YYYYMMDD-0001` (เทียบ `yyyymmdd` ของวันนี้ BKK), `repairTicketId` ชี้ใบซ่อม `RT-` ที่มี `warrantyStatus` ไม่ใช่ WALK_IN, `purchasePhotoKeys` ยาว 1, storage มี 2 ไฟล์, events 2 แถว
  4. `createCase` ซ้ำ IMEI เดิม → `ConflictException` (Review Focus 2)
  5. `send` → `stage='IN_REPAIR'` · `markRepaired({actualCost: 1500, payer: 'SHOP'})` → `READY_FOR_PICKUP` · `returnToCustomer({})` → `CLOSED` + ใบซ่อม CLOSED + `expenseDocumentId` ไม่ null (ลงบัญชีเดิมทำงาน) — ถ้าเทสต์เดิมของ `returnToCustomer` ต้องการผัง COA ให้เรียก `seedShopCoa(prisma)` ใน `beforeAll` และ `SettingsService`/`ExpenseDocumentsService` ของจริงตามที่ facade ต้องการ (ดู constructor `repair-tickets.service.ts:40-49`)
  6. `list({tab:'DONE', summary:true}, owner)` → มีเคสนี้ · `summary.repairCostShop >= 1500`
  7. SALES ของสาขาอื่น `getCase` → `ForbiddenException` (Review Focus 4)

Run: `cd apps/api && DATABASE_URL=postgresql://test:test@localhost:5432/test_db?schema=public npx vitest run --no-file-parallelism src/modules/after-sales/__tests__/after-sales-flow.integration.spec.ts`
Expected: 7 passed · ตาราง `after_sales_cases` ไม่มีแถวของ RUN นี้เหลือหลังจบ (`afterAll`)

- [ ] **Step 5: CI glob** — ใน `.github/workflows/deploy-gcp.yml` บล็อกที่มี `EXCH_FILES=$(ls src/modules/contract-exchange/__tests__/*.integration.spec.ts)` เพิ่มบรรทัด `AFTERSALES_FILES=$(ls src/modules/after-sales/__tests__/*.integration.spec.ts)` และต่อ `$AFTERSALES_FILES` ในคำสั่ง `npx vitest run --no-file-parallelism ...` เดียวกัน

- [ ] **Step 6: เทสต์ทั้งชุดที่แตะ** — `npx jest src/modules/after-sales src/modules/repair-tickets` PASS · `npx tsc --noEmit -p tsconfig.json 2>&1 | tail -2` ไม่มี error

- [ ] **Step 7: Commit** — `git add apps/api/src/modules/after-sales apps/api/src/app.module.ts apps/api/src/modules/quality-control .github/workflows/deploy-gcp.yml && git commit -m "feat(after-sales): API /after-sales + module + integration spec"`

### Task 8: เว็บ — types/helpers · เมนู · route · redirect

**Files:**
- Create: `apps/web/src/pages/after-sales/after-sales.ts`
- Modify: `apps/web/src/config/menu.ts` (แทนคู่ `/insurance` + `/insurance/exchange-requests` ด้วยรายการเดียวใน 5 จุด: ~182-184, ~243-245, ~368-369, ~536, ~697-698)
- Modify: `apps/web/src/App.tsx` (lazy import 3 หน้า · route 3 เส้น · redirect 5 เส้น)
- Test: `apps/web/src/pages/after-sales/after-sales.test.ts`

**Interfaces:**
- Produces: types `AfterSalesStage`, `AfterSalesOutcome`, `LookupResult`, `CaseRow`, `CaseDetail`, `ListResponse`; maps `STAGE_LABEL`, `STAGE_ICON`, `STAGE_TILE`, `OUTCOME_LABEL`, `SOURCE_LABEL`, `PAYER_LABEL`; helper `outcomeReasonLabel`; query keys `afterSalesKeys = { list: (p) => [...], case: (id) => [...], lookup: (imei) => [...] }`; re-export `baht`, `timeOf`, `dayOf`, `dayTimeOf`, `daysSince` จาก `../shop-daily-cash/cash-close`

- [ ] **Step 1: เทสต์ helper**

```ts
import { describe, expect, it } from 'vitest';
import { STAGE_LABEL, STAGE_ICON, STAGE_TILE, SOURCE_LABEL, OUTCOME_LABEL, staleLabel } from './after-sales';
describe('after-sales maps', () => {
  it('ทุก stage มีป้าย+ไอคอน+สี (สถานะห้ามบอกด้วยสีอย่างเดียว)', () => {
    for (const s of ['RECEIVED', 'IN_REPAIR', 'AWAITING_APPROVAL', 'READY_FOR_PICKUP', 'CLOSED', 'CANCELLED'] as const) {
      expect(STAGE_LABEL[s]).toBeTruthy(); expect(STAGE_ICON[s]).toBeTruthy(); expect(STAGE_TILE[s]).toMatch(/border-|bg-/);
    }
    expect(STAGE_LABEL.RECEIVED).toBe('รับเรื่องแล้ว');
    expect(SOURCE_LABEL.WALK_IN).toBe('ไม่ได้ซื้อจากร้าน');
    expect(OUTCOME_LABEL.REPAIR).toBe('ซ่อม');
  });
  it('staleLabel บอกจำนวนวันตาม stage', () => {
    expect(staleLabel('IN_REPAIR', 16)).toBe('ส่งศูนย์ 16 วัน (เกิน 14)');
    expect(staleLabel('READY_FOR_PICKUP', 3)).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้แดง** — `cd apps/web && npx vitest run src/pages/after-sales/after-sales.test.ts`

- [ ] **Step 3: เขียน `after-sales.ts`**

```ts
import { AlertTriangle, CheckCircle2, Clock, Inbox, Wrench, XCircle, type LucideIcon } from 'lucide-react';
export { baht, timeOf, dayOf, dayTimeOf, daysSince, thaiShortDate } from '../shop-daily-cash/cash-close';
export type AfterSalesStage = 'RECEIVED' | 'IN_REPAIR' | 'AWAITING_APPROVAL' | 'READY_FOR_PICKUP' | 'CLOSED' | 'CANCELLED';
export type AfterSalesOutcome = 'REPAIR' | 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE' | 'CASH_SAME_MODEL_EXCHANGE';
export type AfterSalesSource = 'INSTALLMENT_CONTRACT' | 'CASH_SALE' | 'WALK_IN';
export type Payer = 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
export interface OutcomeOption { outcome: AfterSalesOutcome; enabled: boolean; implemented: boolean; reason?: string; note?: string; payerDefault?: Payer }
export interface LookupResult {
  found: boolean; source: AfterSalesSource;
  product: { id: string; brand: string; model: string; storage?: string | null; imeiSerial: string | null } | null;
  customer: { id: string; name: string; phone: string | null } | null;
  contract: { id: string; contractNumber: string; status: string } | null; sale: { id: string; saleType: string } | null;
  warranty: { status: string; daysRemainingIn7Day: number; purchasedAt: string | null; shopWarrantyEndDate: string | null; manufacturerWarrantyEndDate: string | null; checkedAt: string };
  purchasePhotos: Record<'front' | 'back' | 'left' | 'right' | 'top' | 'bottom', string | null> | null;
  openCase: { id: string; caseNumber: string; stage: AfterSalesStage } | null; outcomes: OutcomeOption[];
}
export interface CaseRow { id: string; caseNumber: string; source: AfterSalesSource; outcome: AfterSalesOutcome | null; stage: AfterSalesStage; stale: boolean; daysInStage: number; receivedAt: string; deviceBrand: string | null; deviceModel: string | null; deviceImei: string | null;
  customer: { id: string; name: string; phone: string | null }; branch: { id: string; name: string }; receivedBy: { id: string; name: string };
  repairTicket: { id: string; ticketNumber: string; status: string; payer: Payer; estimatedCost: string | null; actualCost: string | null; sentToRepairAt: string | null; repairedAt: string | null } | null }
export interface Summary { open: number; openRepair: number; openExchange: number; stale: number; awaitingApproval: number; repairCostShop: number | null; repairCostCustomer: number | null; supplierClaims: number; exchanges: number }
export interface ListResponse { data: CaseRow[]; total: number; page: number; limit: number; summary?: Summary }
export interface TimelineItem { at: string; kind: string; note: string | null; actorName?: string }
export interface CaseDetail extends CaseRow { symptom: string; accessories: { box?: boolean; charger?: boolean; case?: boolean; other?: string }; unlockConfirmed: boolean; warrantySnapshot: { status: string; daysRemainingIn7Day: number; shopWarrantyEndDate: string | null; manufacturerWarrantyEndDate: string | null; checkedAt: string };
  photoCount: number; purchasePhotoAngles: string[]; lineLinked: boolean; timeline: TimelineItem[]; cancelReason: string | null; closedAt: string | null; contractId: string | null; saleId: string | null;
  repairTicket: (CaseRow['repairTicket'] & { externalClaimNo: string | null; repairSupplier: { id: string; name: string } | null; expenseDocument: { id: string; docNumber: string } | null; otherIncome: { id: string; docNumber: string } | null }) | null }

export const STAGE_LABEL: Record<AfterSalesStage, string> = { RECEIVED: 'รับเรื่องแล้ว', IN_REPAIR: 'กำลังซ่อม', AWAITING_APPROVAL: 'รออนุมัติ', READY_FOR_PICKUP: 'รอลูกค้ารับ', CLOSED: 'ปิดเคส', CANCELLED: 'ยกเลิก' };
export const STAGE_ICON: Record<AfterSalesStage, LucideIcon> = { RECEIVED: Inbox, IN_REPAIR: Wrench, AWAITING_APPROVAL: Clock, READY_FOR_PICKUP: CheckCircle2, CLOSED: CheckCircle2, CANCELLED: XCircle };
/** โทเคนเท่านั้น — ตัวอักษรเหลือง = text-warning-strong (frontend.md) */
export const STAGE_TILE: Record<AfterSalesStage, string> = { RECEIVED: 'border-border bg-muted text-foreground', IN_REPAIR: 'border-warning/40 bg-warning/10 text-warning-strong', AWAITING_APPROVAL: 'border-warning/40 bg-warning/10 text-warning-strong', READY_FOR_PICKUP: 'border-primary/20 bg-primary/10 text-primary', CLOSED: 'border-primary/20 bg-primary/10 text-primary', CANCELLED: 'border-border bg-muted text-muted-foreground' };
export const STALE_ICON = AlertTriangle;
export const SOURCE_LABEL: Record<AfterSalesSource, string> = { INSTALLMENT_CONTRACT: 'สัญญาผ่อน', CASH_SALE: 'ขายสด / ไฟแนนซ์นอก', WALK_IN: 'ไม่ได้ซื้อจากร้าน' };
export const OUTCOME_LABEL: Record<AfterSalesOutcome, string> = { REPAIR: 'ซ่อม', SAME_MODEL_EXCHANGE: 'เปลี่ยนรุ่นเดิม', PRICED_EXCHANGE: 'เปลี่ยนแบบมีราคา', CASH_SAME_MODEL_EXCHANGE: 'เปลี่ยนรุ่นเดิม (ขายสด)' };
export const PAYER_LABEL: Record<Payer, string> = { SHOP: 'ร้านจ่าย', CUSTOMER: 'ลูกค้าจ่าย', SUPPLIER_CLAIM: 'เคลมศูนย์' };
export const WARRANTY_LABEL: Record<string, string> = { IN_7DAY_DEFECT: 'อยู่ในกรอบ 7 วัน', IN_SHOP_WARRANTY: 'ในประกันร้าน', IN_MANUFACTURER: 'ในประกันศูนย์', OUT_OF_WARRANTY: 'หมดประกัน', WALK_IN: 'ไม่ได้ซื้อจากร้าน' };
const STALE_DAYS: Partial<Record<AfterSalesStage, [number, string]>> = { IN_REPAIR: [14, 'ส่งศูนย์'], READY_FOR_PICKUP: [7, 'รอรับ'], AWAITING_APPROVAL: [2, 'รออนุมัติ'] };
export function staleLabel(stage: AfterSalesStage, days: number): string | null { const s = STALE_DAYS[stage]; return s && days > s[0] ? `${s[1]} ${days} วัน (เกิน ${s[0]})` : null; }
export const afterSalesKeys = { all: ['after-sales'] as const, list: (p: Record<string, unknown>) => ['after-sales', 'list', p] as const, case: (id: string) => ['after-sales', 'case', id] as const, lookup: (imei: string) => ['after-sales', 'lookup', imei] as const };
```

- [ ] **Step 4: รันให้เขียว** · **Step 5: เมนู** — ในแต่ละจุดทั้ง 5 แทนสองรายการด้วย `{ label: 'หลังการขาย', path: '/after-sales', icon: ShieldCheck }` (จุดที่ 536 มีรายการเดียวก็แทนด้วยตัวนี้) · รัน `npx vitest run src/config` (มี `route-reachability.test.ts`) → PASS

- [ ] **Step 6: routes ใน `App.tsx`** — เพิ่ม lazy import ข้างบรรทัด 97: `const AfterSalesPage = lazy(() => import('@/pages/AfterSalesPage')); const AfterSalesNewPage = lazy(() => import('@/pages/AfterSalesNewPage')); const AfterSalesCasePage = lazy(() => import('@/pages/AfterSalesCasePage'));` · ใต้ route `/shop/daily-cash` เพิ่ม:
```tsx
<Route path="/after-sales" element={<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}><AfterSalesPage /></ProtectedRoute>} />
<Route path="/after-sales/new" element={<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}><AfterSalesNewPage /></ProtectedRoute>} />
<Route path="/after-sales/:id" element={<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']}><AfterSalesCasePage /></ProtectedRoute>} />
```
redirect (คงหน้าเก่าไว้ให้ปุ่มภายในยังทำงาน แต่ทางเข้าหลักไป หน้าใหม่): เปลี่ยน element ของ `path="/insurance"` เป็น `<Navigate to="/after-sales" replace />` · `/insurance/warranty-check` → `/after-sales?check=1` · `/insurance/exchange-requests` คงเดิม (PR 2 ย้าย) · `/insurance/new` และ `/insurance/:id` คงเดิม (หน้า `/after-sales/:id` มีลิงก์ไปใบซ่อมเก่าถ้าต้องใช้ปุ่มที่ยังไม่ย้าย) — สร้าง component เล็ก `pages/after-sales/TicketRedirect.tsx` สำหรับ `/insurance/:id` ที่ `useQuery(['after-sales','by-ticket',id])` → `api.get('/after-sales/by-ticket/'+id)` แล้ว `<Navigate to={'/after-sales/'+data.id} replace />`; ถ้า 404 ให้ render `RepairTicketDetailPage` เดิม
  รัน `npx tsc --noEmit -p tsconfig.json` (apps/web) → ผ่าน (หน้า 3 ไฟล์ยังไม่มี → สร้างไฟล์ว่างชั่วคราว `export default function AfterSalesPage() { return null; }` ให้ compile แล้ว Task 9–11 ค่อยเขียนจริง)

- [ ] **Step 7: Commit** — `git add apps/web/src/pages/after-sales apps/web/src/pages/AfterSales*.tsx apps/web/src/config/menu.ts apps/web/src/App.tsx && git commit -m "feat(web/after-sales): เมนูเดียว หลังการขาย + route + redirect + types"`

### Task 9: เว็บ — หน้าหลัก `/after-sales` (กล่องเช็คประกัน/แจ้งปัญหา · แถบตัวเลข · ตารางเคส)

**Files:**
- Create: `apps/web/src/pages/AfterSalesPage.tsx` · `apps/web/src/pages/after-sales/IntakeBox.tsx` · `SummaryStrip.tsx` · `CaseTable.tsx`
- Test: `apps/web/src/pages/AfterSalesPage.test.tsx`

**Interfaces:**
- Consumes: `GET /after-sales?tab=&q=&stale=&summary=1&branchId=` → `ListResponse` · `GET /after-sales/lookup?imei=` → `LookupResult` · maps จาก Task 8 · `PageHeader` (`@/components/ui/PageHeader`) · `QueryBoundary` · `useAuth`
- Produces: `IntakeBox({ onOpenCase(imei: string) })` (ใช้ซ้ำใน Task 10 เป็นขั้นที่ 1) · `SummaryStrip({ summary, showMoney })` · `CaseTable({ rows })`

- [ ] **Step 1: เทสต์ (render, mock api)** — โครงเหมือน `CashCloseCard.test.tsx` (mock `@/lib/api`, `sonner`, ห่อ `MemoryRouter` + `QueryClientProvider`; mock `@/contexts/AuthContext` ให้ `useAuth` คืน `{ user: { id:'u1', role:'OWNER', branchId:null } }`)
  1. เจ้าของเปิดหน้า: `mocks.get` คืน list 2 แถว (1 stale IN_REPAIR 16 วัน) + summary → เห็นหัว "หลังการขาย", ปุ่ม `เช็คประกัน` และ `แจ้งปัญหาเครื่อง`, ช่อง "เคสเปิดอยู่" = 7, ป้าย "ส่งศูนย์ 16 วัน (เกิน 14)", ไม่มีคำว่า "รับเครื่อง" ใน document (`expect(document.body.textContent).not.toMatch(/รับเครื่อง(?!ไป)/)`)
  2. พนักงานขาย: `useAuth` role SALES → ไม่เห็น "ค่าซ่อม" (money null) และไม่มีแท็บ "รออนุมัติ"
  3. กดเช็คประกัน: พิมพ์ IMEI 15 หลักแล้วกดปุ่ม → `mocks.get` ถูกเรียกด้วย `/after-sales/lookup` และการ์ดผลแสดง "ในประกันร้าน", ชื่อลูกค้า, ปุ่ม "แจ้งปัญหาเครื่อง ต่อเลย" (ลิงก์ไป `/after-sales/new?imei=...`) · ไม่พบ → ข้อความ "ไม่พบเครื่องในระบบ — รับซ่อมได้ (ลูกค้าจ่าย)"
  4. มี `openCase` ในผล → แสดง "เครื่องนี้มีเคสที่ยังไม่ปิด AS-…" และปุ่มต่อเลยเปลี่ยนเป็นลิงก์ไปเคสนั้น (Review Focus 2 ฝั่งจอ)

- [ ] **Step 2: รันให้แดง** — `npx vitest run src/pages/AfterSalesPage.test.tsx`

- [ ] **Step 3: `IntakeBox.tsx`** — การ์ดพื้น `border-primary/20 bg-primary/5` ตาม mockup กระดาน 1: `<input>` 56px (`h-14 text-lg`) + `Button variant="outline"` "เช็คประกัน" + `Button variant="primary" size="lg"` "แจ้งปัญหาเครื่อง" (`Link` ไป `/after-sales/new?imei=`) · เช็คประกัน = `useMutation(() => api.get('/after-sales/lookup', { params: { imei } }))` แสดงผลใต้กล่อง: ป้าย `WARRANTY_LABEL[status]` (สี `STAGE_TILE`-style ด้วยโทเคน) · ลูกค้า · เครื่อง · ที่มา `SOURCE_LABEL` · "ลูกค้ารับเครื่องไป {dayOf(purchasedAt)} · กรอบ 7 วัน เหลือ N วัน · ประกันร้านถึง … · ประกันศูนย์ถึง …" · "ทำได้ตอนนี้: …" จาก `outcomes.filter(o=>o.enabled).map(OUTCOME_LABEL)` · "รูปตอนซื้อ: N มุม" · ปุ่ม "แจ้งปัญหาเครื่อง ต่อเลย" / "แค่เช็ค พอแล้ว" · ถ้า `openCase` แสดงกล่องเตือนเหลือง (`bg-warning/10 text-warning-strong`) + ลิงก์เคส · `?check=1` ใน URL = โฟกัสช่องอัตโนมัติ

- [ ] **Step 4: `SummaryStrip.tsx`** — การ์ดเดียว `grid grid-cols-2 sm:grid-cols-5 divide-x divide-border` 5 ช่อง: เคสเปิดอยู่ (`openRepair`/`openExchange`) · ค้างนาน (`text-warning-strong`) · รออนุมัติ · เดือนนี้ ค่าซ่อม (แสดงเฉพาะ `showMoney`: `baht(repairCostShop)`/`baht(repairCostCustomer)` + "เคลมศูนย์ N ใบ") · เปลี่ยนเครื่อง (PR 1 = 0 แสดง "—") · ตัวเลข `text-2xl font-bold tabular-nums` ป้าย `text-xs text-muted-foreground`

- [ ] **Step 5: `CaseTable.tsx`** — `hidden md:block` `<table className="w-full text-sm">` คอลัมน์: เลขเคส (Link `/after-sales/:id` `text-primary font-semibold`) · ลูกค้า (+เบอร์ `text-xs text-muted-foreground`) · เครื่อง / IMEI · ที่มา (`SOURCE_LABEL` chip `bg-muted`) · ทางออก (`OUTCOME_LABEL` + `PAYER_LABEL` จาก repairTicket.payer) · **ขั้นตอนตอนนี้** (chip `STAGE_TILE[stage]` + `STAGE_ICON` + `STAGE_LABEL`; ถ้า `stale` แทนด้วย `STALE_ICON` + `staleLabel`) · แจ้งเมื่อ (`dayOf(receivedAt)` + ผู้รับเรื่อง) · ค่าใช้จ่าย (`~${baht(estimatedCost)}` หรือ `baht(actualCost)`; text-right tabular-nums) · แถว `hover:bg-accent` · `md:hidden` = การ์ดต่อเคส (เลขเคส+chip แถวแรก, ลูกค้า·เครื่อง, ทางออก·ที่มา·วัน) · ว่าง = "ไม่มีเคสในแท็บนี้" + ข้อความ "ลูกค้าเอาเครื่องมา? เริ่มที่กล่องด้านบน"

- [ ] **Step 6: `AfterSalesPage.tsx`** — `useDocumentTitle('หลังการขาย')` · `PageHeader title="หลังการขาย" subtitle="ทุกเรื่องหลังการขายอยู่ที่นี่ — เช็คประกัน · ซ่อม · เปลี่ยนเครื่อง"` + `action` = select สาขา (เฉพาะ cross-branch role; รายชื่อจาก `GET /branches` ตามที่ ShopDailyCashPage ทำ) · ลำดับ: `IntakeBox` → `SummaryStrip` → แท็บ chips (กำลังทำ/รออนุมัติ/รอลูกค้ารับ/เสร็จแล้ว + chip กรอง "ค้างนาน") → `CaseTable` · แท็บ "รออนุมัติ" ซ่อนสำหรับ SALES · `useQuery<ListResponse>({ queryKey: afterSalesKeys.list({tab,q,stale,branchId}), queryFn: async () => (await api.get('/after-sales', { params: { tab, q: q || undefined, stale: stale || undefined, summary: 1, branchId: branchId || undefined } })).data, staleTime: 0, refetchOnMount: 'always' })` · ช่องค้นหา debounce 300ms · ป้ายใต้ตาราง "ป้ายค้างนาน: ส่งซ่อมเกิน 14 วัน · รอรับเกิน 7 วัน · รออนุมัติเกิน 2 วัน"

- [ ] **Step 7: รันให้เขียว + tsc + Commit** — `npx vitest run src/pages/AfterSalesPage.test.tsx` PASS · `npx tsc --noEmit -p tsconfig.json` · `git commit -m "feat(web/after-sales): หน้าหลัก — เช็คประกัน/แจ้งปัญหา + แถบตัวเลข + ตารางเคส"`

### Task 10: เว็บ — แจ้งปัญหาเครื่อง `/after-sales/new` (3 ขั้นในหน้าเดียว)

**Files:**
- Create: `apps/web/src/pages/AfterSalesNewPage.tsx` · `apps/web/src/pages/after-sales/OutcomePicker.tsx` · `IntakePhotos.tsx` · `PurchasePhotoStrip.tsx` · `StepBar.tsx`
- Test: `apps/web/src/pages/after-sales/OutcomePicker.test.tsx` · `apps/web/src/pages/AfterSalesNewPage.test.tsx`

**Interfaces:**
- Consumes: `LookupResult` (จาก `GET /after-sales/lookup?imei=` — หน้าอ่าน `?imei=` จาก URL แล้วยิงเอง) · `POST /after-sales` multipart (`photos[]` + ฟิลด์ `CreateCaseDto`: `imei, customerId?, deviceBrand?, deviceModel?, deviceSerial?, symptom, accessories (JSON string), unlockConfirmed, note?, outcome='REPAIR', payer?, estimatedCost?, repairSupplierId?, branchId`) · `ContactCombobox({ roleNeeded:'CUSTOMER', value, onSelect })` (`@/components/contacts/ContactCombobox`, `childId` = customerId) · `RepairCenterCombobox` (`pages/insurance/components/RepairCenterCombobox.tsx`) สำหรับศูนย์ซ่อม · `EvidenceImageInput`/`EVIDENCE_IMAGE_ACCEPT` (`pages/shop-daily-cash/EvidenceImage.tsx`, `cash-close.ts:168`)
- Produces: `StepBar({ steps: { tone:'done'|'now'|'idle'; title; hint? }[] })` — วงกลม 26px มีเลข/✓ ที่เดียว หัวข้อสูง 26px (แบบเดียวกับ `CashStatusHero.HeroSteps` หลังแก้ 2026-09-23 — ห้ามใส่เลขนำหน้าหัวข้อ) · `OutcomePicker({ options: OutcomeOption[]; value; onChange })` · `IntakePhotos({ files: File[]; onChange; max: 6 })` · `PurchasePhotoStrip({ photos: LookupResult['purchasePhotos'] })`

- [ ] **Step 1: เทสต์ `OutcomePicker`** — render ด้วย `options` 3 ตัว (REPAIR enabled implemented, SAME_MODEL enabled implemented=false note, PRICED disabled reason) → ปุ่ม "ซ่อม" กดได้และเรียก `onChange('REPAIR')` · ปุ่ม "เปลี่ยนรุ่นเดิม" เป็น `disabled` และมีข้อความ "เปิดใช้ในรอบถัดไป" · ปุ่ม "เปลี่ยนแบบมีราคา" `disabled` และแสดง `reason` · ทุกปุ่มเป็น `<button type="button" aria-pressed>` (`getAllByRole('button')` = 3)

- [ ] **Step 2: เทสต์หน้า** — mock `useAuth` = SALES สาขา `br-1`; `mocks.get` สำหรับ `/after-sales/lookup` คืนผลสัญญาผ่อน ≤7 วัน + `purchasePhotos` 2 มุม; (a) render ที่ `/after-sales/new?imei=356812345674412` → เห็นการ์ดขั้น 1 (ชื่อลูกค้า, "ลูกค้ารับเครื่องไปเมื่อ", แถบ "รูปตอนซื้อ" 2 รูป), ขั้น 3 ปุ่มทางออก 3 ปุ่ม, กล่องสรุปก่อนบันทึก · (b) กด "บันทึกและเปิดเคส" โดยไม่มีรูป → ข้อความ "ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป" และ `mocks.post` ไม่ถูกเรียก · (c) ใส่อาการ ≥5 ตัว + เพิ่มไฟล์ 1 (`new File(['x'], 'a.jpg', { type: 'image/jpeg' })` ผ่าน `userEvent.upload`) + ติ๊ก unlock → กดบันทึก → `mocks.post` ถูกเรียกด้วย `'/after-sales'` และ `FormData` ที่มี `outcome=REPAIR`, `imei`, `branchId=br-1`, `photos` 1 ไฟล์ → `toast.success` และ navigate ไป `/after-sales/<id>` (ตรวจด้วย `Routes` ปลอมที่ `/after-sales/:id` render "CASE PAGE") · (d) lookup ไม่พบ → ต้องเห็น `ContactCombobox` (placeholder "เลือก/ค้นหาผู้ติดต่อ") และช่องยี่ห้อ/รุ่น และปุ่มทางออกมีแค่ "ซ่อม" (ลูกค้าจ่าย)

- [ ] **Step 3: รันให้แดง** — `npx vitest run src/pages/after-sales/OutcomePicker.test.tsx src/pages/AfterSalesNewPage.test.tsx`

- [ ] **Step 4: `StepBar.tsx`** (คัดลอกโครงจาก `HeroSteps` ใน `pages/shop-daily-cash/CashStatusHero.tsx` ให้เป็น component กลาง: `<ol className="grid grid-cols-1 gap-y-2.5 rounded-lg border border-border/70 bg-card px-1.5 py-3 sm:grid-cols-N">` แต่ละ `<li className="flex items-start gap-2.5 px-3 leading-snug">` วงกลม `h-[26px] w-[26px]` (done = `bg-primary text-primary-foreground` + `Check`; now = `border-2 border-warning bg-warning/10 text-foreground` + เลข; idle = `border-2 border-dashed border-border text-muted-foreground` + เลข) หัวข้อ `<span className="flex min-h-[26px] items-center font-semibold">` + hint `text-muted-foreground`) — และเปลี่ยน `CashStatusHero.tsx` ให้ใช้ `StepBar` ตัวนี้แทน `HeroSteps` เดิม (เทสต์ `CashStatusHero.test.tsx` ต้องยังผ่าน)

- [ ] **Step 5: `OutcomePicker.tsx`** — `grid grid-cols-1 sm:grid-cols-3 gap-3`; ปุ่มแต่ละอัน `rounded-xl border p-4 text-left` เลือกแล้ว `border-2 border-primary bg-primary/5`; ปิด = `bg-muted text-muted-foreground cursor-not-allowed` + `reason` ใต้ชื่อ; `enabled && !implemented` = ปิดด้วยข้อความ "เปิดใช้ในรอบถัดไป" (PR 2); ไอคอน `Wrench` / `ArrowLeftRight` / `Banknote` จาก lucide; ชื่อ `OUTCOME_LABEL`; บรรทัดรอง = `PAYER_LABEL[payerDefault]` สำหรับ REPAIR หรือ `note`

- [ ] **Step 6: `IntakePhotos.tsx`** — แถบรูป: thumbnail `h-20 w-28 rounded-lg object-cover` จาก `URL.createObjectURL(file)` (revoke ตอน unmount) + ปุ่มลบ (`aria-label="ลบรูป"`) + ช่องเพิ่ม `<label>` ห่อ `<input type="file" accept={EVIDENCE_IMAGE_ACCEPT} capture="environment" multiple>` ข้อความ "ถ่ายเพิ่ม (สูงสุด 6)"; เกิน 6 → `toast.error`; ไฟล์ >5MB หรือ type ไม่ตรง → `toast.error` (กติกาเดียวกับ `EvidenceImageInput`)

- [ ] **Step 7: `PurchasePhotoStrip.tsx`** — รับ `photos` (data URL ต่อมุม) แสดง 6 ช่อง label หน้า/หลัง/ซ้าย/ขวา/บน/ล่าง; มุมที่ null = ช่องประ "ไม่มี"; ทั้งหมด null หรือ `photos===null` → ข้อความ "ไม่มีรูปตอนซื้อ (เช่น เครื่องใหม่ซีล) — เทียบไม่ได้"; หัวแถบ "รูปตอนซื้อ — 6 มุมที่ถ่ายตอนรับเข้าสต๊อก (ระบบบันทึกติดเคสให้)"

- [ ] **Step 8: `AfterSalesNewPage.tsx`** — `useSearchParams` อ่าน `imei`; ไม่มี → แสดงช่อง IMEI + ปุ่ม "ค้นหา" (setSearchParams) · `useQuery(afterSalesKeys.lookup(imei), () => api.get('/after-sales/lookup', { params: { imei } }))` · ถ้า `openCase` → กล่องเตือน + ลิงก์ไปเคส และปิดปุ่มบันทึก · โครงตาม mockup กระดาน 3: `StepBar` 3 ขั้น (ขั้น 3 = now) · การ์ดขั้น 1 "เครื่องและลูกค้า" (พบ: facts grid + `PurchasePhotoStrip`; ไม่พบ: `ContactCombobox roleNeeded="CUSTOMER"` + ช่อง ยี่ห้อ/รุ่น/Serial) · การ์ดขั้น 2 "สภาพและอาการ" (textarea อาการ `minLength 5`, `IntakePhotos`, เช็คลิสต์ 4 checkbox กล่อง/สายชาร์จ/เคส/อื่นๆ(+ช่องข้อความ), checkbox "ลูกค้าปิด Find My / ปลดล็อกเครื่องให้แล้ว", หมายเหตุ) · การ์ดขั้น 3 "สิทธิ์และทางออก" (กล่องสิทธิ์เขียว `bg-primary/10 text-primary` ข้อความจาก `WARRANTY_LABEL` + วันหมดประกัน + "เหลืออีก N วัน", `OutcomePicker`, ฟอร์มย่อยซ่อม: select ผู้จ่าย (ค่าเริ่มต้น `payerDefault`) · ค่าซ่อมประมาณ · `RepairCenterCombobox` (ว่าง = ซ่อมที่ร้าน)) · แถบล่าง "สรุปก่อนบันทึก" (ข้อความประกอบจาก state) + `Button variant="primary" size="lg"` "บันทึกและเปิดเคส" ปุ่มเดียว + ปุ่มรอง `outline` "ยกเลิก" · submit: `useMutation` สร้าง `FormData` (ฟิลด์ทั้งหมด + `photos` ต่อไฟล์ + `accessories` เป็น `JSON.stringify`) → `api.post('/after-sales', form, { headers: { 'Content-Type': 'multipart/form-data' } })` → `toast.success('เปิดเคส ' + caseNumber)` → `invalidateQueries({ queryKey: afterSalesKeys.all })` → `navigate('/after-sales/' + id)`; error → `toast.error(getErrorMessage(err))` · ตรวจฝั่งจอก่อนส่ง: รูป ≥1, อาการ ≥5, walk-in ต้องมีลูกค้า

- [ ] **Step 9: รันให้เขียว + Commit** — vitest 2 ไฟล์ + `CashStatusHero.test.tsx` PASS · tsc ผ่าน · `git commit -m "feat(web/after-sales): หน้าแจ้งปัญหาเครื่อง 3 ขั้น + StepBar กลาง"`

### Task 11: เว็บ — หน้าเคส `/after-sales/:id`

**Files:**
- Create: `apps/web/src/pages/AfterSalesCasePage.tsx` · `apps/web/src/pages/after-sales/PhotoCompare.tsx` · `CaseTimeline.tsx` · `RepairActionDialogs.tsx`
- Test: `apps/web/src/pages/AfterSalesCasePage.test.tsx`

**Interfaces:**
- Consumes: `GET /after-sales/:id` → `CaseDetail` · รูป `GET /after-sales/:id/photos/:index` และ `/purchase-photos/:angle` (blob ผ่าน `EvidenceImageLink`-style fetch `responseType:'blob'`) · `POST /after-sales/:id/repair/send {repairSupplierId, externalClaimNo?, estimatedCost?}` · `/repair/mark-repaired {actualCost, payer}` · `/repair/send-back {note}` · `/repair/return {}` · `/cancel {reason}` · `POST /after-sales/:id/photos` multipart `file` · `StepBar` (Task 10)
- Produces: หน้าเดียวปุ่มหลักปุ่มเดียวตาม stage

- [ ] **Step 1: เทสต์** (mock api + auth) — (a) stage `IN_REPAIR` stale 16 วัน: หัวมีเลขเคส, chip "ส่งศูนย์ 16 วัน (เกิน 14)" (มีไอคอน), ปุ่มหลักเดียว "บันทึกซ่อมเสร็จ" (`getAllByRole('button', { name: /บันทึกซ่อมเสร็จ/ })` ยาว 1), `StepBar` หัวข้อ "รับเรื่องแล้ว / กำลังซ่อม / รอลูกค้ารับ / ปิดเคส" ไม่มีเลขซ้ำในหัวข้อ, ตารางเทียบรูปมี 6 หัวคอลัมน์และช่อง "ไม่ได้ถ่าย" 3 ช่อง (photoCount 3), ป้าย LINE "ยังไม่ผูก LINE — โทรแจ้ง" เมื่อ `lineLinked=false` (b) กด "บันทึกซ่อมเสร็จ" → dialog กรอกค่าซ่อมจริง 1500 + ผู้จ่าย → ยืนยัน → `mocks.post` เรียก `/after-sales/<id>/repair/mark-repaired` ด้วย `{ actualCost: 1500, payer: 'SHOP' }` → `toast.success` (c) stage `READY_FOR_PICKUP` → ปุ่มหลัก "ส่งมอบคืนลูกค้า" (d) stage `CLOSED` → ไม่มีปุ่มหลัก มีลิงก์เอกสารบัญชี `docNumber` (e) SALES ไม่เห็นปุ่ม "ยกเลิกเคส"; BM เห็น

- [ ] **Step 2: รันให้แดง** — `npx vitest run src/pages/AfterSalesCasePage.test.tsx`

- [ ] **Step 3: `PhotoCompare.tsx`** — `grid` คอลัมน์ `[88px repeat(6,minmax(0,1fr))]` หัว 6 มุม; แถว "ตอนซื้อ" = `purchasePhotoAngles.includes(angle)` ? `<CaseImage src={`/after-sales/${id}/purchase-photos/${angle}`}>` : ช่องประ "ไม่มี"; แถว "ตอนรับฝาก" = index 0..photoCount-1 เรียงตามคอลัมน์ (คอลัมน์ที่เกิน = ช่องประ "ไม่ได้ถ่าย" + ปุ่ม "เพิ่มรูป" ถ้ายัง <6 และ role STAFF) · `CaseImage` = component ย่อยที่ `useQuery` โหลด blob ผ่าน `api.get(path, { responseType: 'blob' })` แล้ว `URL.createObjectURL` (แบบ `EvidenceImageLink`) แตะเปิด `Dialog` ขยาย · ข้อความใต้ตาราง "รูปตอนซื้อบันทึกติดเคสตอนแจ้ง — ถ่ายรูปเครื่องใหม่ภายหลังไม่กระทบหลักฐาน"

- [ ] **Step 4: `CaseTimeline.tsx`** — รับ `timeline: TimelineItem[]` เรียงใหม่→เก่า จุด `h-2.5 w-2.5 rounded-full bg-primary` เส้น `bg-border`; ป้ายชนิด: `RECEIVED`→"รับเรื่อง", `OUTCOME_SET`→"เลือกทางออก", `REPAIR_IN_PROGRESS`→"ส่งซ่อม", `REPAIR_READY_FOR_PICKUP`→"ซ่อมเสร็จ", `REPAIR_CLOSED`→"ส่งมอบคืน", `REPAIR_SENT_BACK`→"ส่งซ่อมต่อ", `PHOTO_ADDED`→"เพิ่มรูป", `CANCELLED`→"ยกเลิก", `CLOSED`→"ปิดเคส", `LINE_*`→"LINE" (PR 3) · แถวบนสุดถ้า `stale` = แถวเตือน `text-warning-strong` "ค้าง N วัน — เกินเกณฑ์"

- [ ] **Step 5: `RepairActionDialogs.tsx`** — 4 dialog (shadcn `Dialog`) : ส่งซ่อม (`RepairCenterCombobox` บังคับ + เลขเคลม + ค่าซ่อมประมาณ) · ซ่อมเสร็จ (ค่าซ่อมจริง `min 0` บังคับ + select ผู้จ่าย ค่าเริ่มต้นจาก `repairTicket.payer`) · ส่งซ่อมต่อ (note ≥10) · ยกเลิกเคส (reason ≥10, เฉพาะ BM/OWNER) · ส่งมอบคืน = `ConfirmDialog` ข้อความ "ระบบจะสร้างเอกสารบัญชีค่าซ่อมตามผู้จ่าย (ร่าง) และปิดเคส" · ทุก mutation: `onSuccess` → `toast.success` + `invalidateQueries(afterSalesKeys.all)`; `onError` → `toast.error(getErrorMessage)`

- [ ] **Step 6: `AfterSalesCasePage.tsx`** — `useParams id` → `useQuery(afterSalesKeys.case(id))` ใน `QueryBoundary` · หัว (กรอบ `border-warning/40 bg-warning/10` เมื่อ stage ต้องลงมือ IN_REPAIR/RECEIVED/READY, `border-primary/20 bg-primary/5` เมื่อ CLOSED, `border-border bg-card` เมื่อ CANCELLED): breadcrumb `หลังการขาย / เคส`, `h1 caseNumber`, chip stage/stale, chip ทางออก+ผู้จ่าย, chip ที่มา, บรรทัดสรุปลูกค้า·เครื่อง·ศูนย์/เคลม · ขวา: **ปุ่มหลักปุ่มเดียวตาม stage** (RECEIVED→"ส่งซ่อม" (ถ้ามีศูนย์) หรือ "บันทึกซ่อมเสร็จ" (ซ่อมที่ร้าน) · IN_REPAIR→"บันทึกซ่อมเสร็จ" · READY_FOR_PICKUP→"ส่งมอบคืนลูกค้า" · CLOSED/CANCELLED→ไม่มี) + ปุ่มรอง outline: "ส่งซ่อมต่อ" (เมื่อ READY), "ใบรับฝากเครื่อง" (PR 4: ปุ่ม `disabled` + title "เร็ว ๆ นี้"), "ยกเลิกเคส" (BM/OWNER, สี `text-destructive`) · `StepBar` 4 ขั้น (done/now/idle จาก stage; hint = วันเวลา+ชื่อจาก timeline) · grid 2 คอลัมน์: ซ้าย การ์ด "เครื่องและลูกค้า" (ลิงก์ `/customers/:id`, `/contracts/:id`), "สิทธิ์ ณ วันแจ้ง" (chips จาก `warrantySnapshot`), `PhotoCompare`, เช็คลิสต์ chips (`accessories`, unlock), อาการ · ขวา `CaseTimeline`, การ์ด "ค่าใช้จ่ายและบัญชี" (ประมาณ/จริง/ผู้จ่าย + ลิงก์ `expenseDocument`/`otherIncome` ถ้ามี, ไม่มี = "จะสร้างตอนส่งมอบ"), การ์ด "LINE ลูกค้า" (`lineLinked` ? "พร้อมส่ง (เปิดใช้รอบถัดไป)" : ป้าย `bg-warning/10 text-warning-strong` "ยังไม่ผูก LINE — โทรแจ้ง") · มือถือ: ปุ่มหลักซ้ำใน `sticky bottom-0 md:hidden` bar (mockup กระดาน 7) — ยังนับเป็นปุ่มเดียว (render เฉพาะจอเล็กด้วย `md:hidden`; ในเทสต์ jsdom จะเห็น 2 ปุ่ม → ใส่ `data-testid="mobile-bar"` และ query ปุ่มหลักนอก bar)

- [ ] **Step 7: รันให้เขียว + Commit** — vitest PASS · tsc · `git commit -m "feat(web/after-sales): หน้าเคส — ปุ่มเดียวตาม stage + เทียบรูปมุมต่อมุม + ไทม์ไลน์"`

### Task 12: bump version · ตรวจทั้งชุด · ดูหน้าจริง · เปิด PR

**Files:**
- Modify: `apps/web/package.json` (`version` → รุ่นถัดไปของเดือน เช่น `26.9.49` — ดูค่าปัจจุบันก่อน)
- Modify: `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` (หัวเรื่อง "สถานะ" → "PR 1 เปิดแล้ว #<เลข>")

- [ ] **Step 1: ตรวจ API** — `cd apps/api && npx jest src/modules/after-sales src/modules/repair-tickets` PASS · `DATABASE_URL=postgresql://test:test@localhost:5432/test_db?schema=public npx vitest run --no-file-parallelism src/modules/after-sales/__tests__/after-sales-flow.integration.spec.ts` PASS · `npx tsc --noEmit -p tsconfig.json` ผ่าน · boot: `npx nest build && node -e "require('./dist/src/app.module')"` ไม่ throw (หรือรัน `npm run start:dev` ชี้ `test_db` แล้ว `curl -s -o /dev/null -w '%{http_code}' localhost:3002/api/admin/after-sales` = 401)

- [ ] **Step 2: ตรวจเว็บ** — `cd apps/web && npx vitest run src/pages/after-sales src/pages/AfterSales*.test.tsx src/pages/shop-daily-cash src/config` PASS · `npx tsc --noEmit -p tsconfig.json` · `npx eslint src/pages/after-sales src/pages/AfterSales*.tsx src/config/menu.ts src/App.tsx` ไม่มี error

- [ ] **Step 3: ดูหน้าจริง (mock API + vite ตัวที่สอง + Chrome headless แยกโปรไฟล์ — ห้ามแตะ 5173/3001 ของเจ้าของ)** — สูตรจาก memory `bestchoice-local-dev-gotchas` ข้อ 5/10: mock `node` บน 3002 คืน `/auth/me` (OWNER) + `/after-sales?...` (list+summary 5 แถวเหมือน mockup) + `/after-sales/lookup` (พบ/ไม่พบ ตาม imei) + `/after-sales/:id` (IN_REPAIR stale) + `/branches` · `VITE_API_URL=http://localhost:3002/api/admin npx vite --port 5177 --strictPort` · Chrome: `--headless=new --remote-debugging-port=9337 --user-data-dir=<scratch>` · `BU_NAME=<ชื่อใหม่> BU_CDP_URL=http://localhost:9337 browser-harness` เปิด `/after-sales`, `/after-sales/new?imei=...`, `/after-sales/<id>` ถ่ายทั้ง `document.documentElement.classList.remove('dark')` และ `.add('dark')` · เช็ค: ไม่มีคำ "รับเครื่อง" (ยกเว้น "ลูกค้ารับเครื่องไป"), ปุ่มหลักสีเขียวหน้าละปุ่มเดียว, chip เหลืองอ่านออกในจอมืด, มือถือ (viewport 390) ไม่มี scroll แนวนอน (`document.documentElement.scrollWidth <= 390`) · ปิด task ด้วย TaskStop ตาม id ที่ spawn เอง

- [ ] **Step 4: bump + spec status + commit** — `git add apps/web/package.json docs/superpowers/specs/2026-09-23-after-sales-hub-design.md && git commit -m "chore(web): bump version 26.9.<n> — after-sales PR 1"`

- [ ] **Step 5: เปิด PR (ยังไม่ merge — เจ้าของสั่ง merge เอง)** — `git push -u origin feat/after-sales-hub` แล้ว `gh pr create --title "feat(after-sales): หลังการขาย PR 1 — เคสเดียว เช็คประกัน/แจ้งปัญหาเครื่อง ทางออกซ่อม" --body` สรุป: สเปก/แผน/mockup ลิงก์ · migration `20261008000000_after_sales_cases` (+backfill 4 แถว prod) · redirect `/insurance` → `/after-sales` · ยังไม่มี LINE/เปลี่ยนเครื่อง (PR 2–3) · รูปสาธิต 3 หน้า × 2 โหมด · ปิดท้ายด้วย `🤖 Generated with [Claude Code](https://claude.com/claude-code)` · แจ้งเจ้าของว่า repo เป็น public (memory `bestchoice-repo-is-public`) — สเปก/แผนอยู่ใน `docs/superpowers/*` เหมือนสเปกเดิม ๆ

---

## Self-review (ทำแล้ว 2026-09-24)

- **Spec coverage (PR 1 = spec ข้อ 14 แถว 1):** ตาราง+backfill (T1) · เลขเคส (T2) · lookup+ตารางทางออก 4.3 (T3) · เปิดเคสธุรกรรมเดียว + รูป ≥1 ≤6 + สำเนารูปตอนซื้อ D6 (T4) · stage คำนวณจากทางออก ข้อ 5 + รายการ/สรุป ข้อ 9 + สิทธิ์สาขา ข้อ 7 (T5) · ปุ่มตามขั้น 4.4 + ยกเลิก + เพิ่มรูป (T6) · API ข้อ 6 (T7) · เมนู/redirect 4.1 (T8) · หน้าหลัก 4.2 (T9) · แจ้งปัญหา 4.3 (T10) · หน้าเคส 4.4 + มือถือ 4.6 (T11) · เทสต์ ข้อ 13 (T3–T11) · ไม่อยู่ใน PR 1 โดยตั้งใจ: LINE (ข้อ 8 → PR 3), เปลี่ยนเครื่องทั้ง 3 แบบ + แท็บรออนุมัติ 4.5 (PR 2), ใบรับฝากเครื่อง PDF (PR 4), ลบไฟล์ wizard เก่า/บั๊ก 403 ข้อ 12 (PR 2 ตอนถอดหน้าเก่า)
- **Review Focus → เทสต์:** 1 → T3 Step 6 (c) · 2 → T4 Step 3 (d) + T7 เคส 4 + T9 เทสต์ 4 · 3 → T4 Step 3 (b)(c)(e) + T6 Step 1 (d) · 4 → T5 Step 6 + T7 เคส 7 · 5 → T5 Step 1 แถว CANCELLED/repairDeleted
- **Type consistency:** `createInTx` คืน `{ ticket, warrantyStatus, payer }` (T4) ใช้ใน T4 เท่านั้น · `OutcomeOption` (T3) ใช้ใน T4/T8/T10 ชื่อฟิลด์ตรงกัน (`outcome, enabled, implemented, reason, note, payerDefault`) · `LookupResult` API (T3) = เว็บ (T8) ฟิลด์ตรงกัน · `deriveStage`/`STALE_DAYS` (T5) กับ `staleLabel` (T8) ใช้เกณฑ์ 14/7/2 เท่ากัน · endpoint ชื่อใน T7 ตรงกับที่ T9–T11 เรียก
- **สิ่งที่ผู้ทำต้องเปิดดูเองก่อนเขียน (ไม่ใช่ placeholder — ไฟล์มีอยู่แล้ว):** ชื่อฟิลด์ที่ `lookupByImei` อ่านจาก sale/contract (`repair-warranty.service.ts:316-397`) สำหรับ seed ใน T7 · ชื่อ model ผูก LINE ลูกค้า (`grep customerLineLink apps/api/src/modules/line-oa`) ใน T5 · ชื่อไฟล์โมดูล quality-control ใน T7
