# ใบรับเครื่องคืน (Device-Return Intake) Implementation Plan — Phase 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สาขาบันทึก "ใบรับเครื่องคืน" ได้เอง (สัญญาหยุดทันที) → OWNER/ผจก.การเงินกดยืนยันหนึ่งคลิกแล้ว JP5 + ขาคู่ SHOP ลงครบสองสมุดโดยแท็ก `DEVICE_RETURN` (หักผ่านรอบจ่าย INTER-CO ที่ Phase 1 เตรียมไว้) พร้อมไลน์แจ้งลูกค้า, tag "เคยคืนเครื่อง", รายการการเดินทาง, กันระบบทวงถาม และ cron เตือนใบค้างยืนยัน.

**Architecture:** refactor `RepossessionsService.create()` เป็น `assertRepossessionPeriodsOpen()` (นอก tx) + `createInTx()` (ใน tx ของผู้เรียก) โดย JP5 ขา Dr = `11-2107` แท็ก `DEVICE_RETURN` เสมอ และ `ShopCollectShopLegs.postRepossessionIntake` ลง `Dr S11-2002 / Cr S21-1104` เสมอ (สาขาโอนสดทันที `Cr S11-1202` ถูกลบ). โมดูลใหม่ `device-returns` เป็นทางเข้าเดียวของการยึด/รับคืน: `POST /device-returns` (สาขา) → `POST /device-returns/:id/confirm` (FINANCE เรียก `createInTx`) — `POST /repossessions` + `CreateRepossessionDto` ถูกลบ. งานรอบข้าง (ไลน์ผ่าน `NotificationsService.sendFromTemplate`, tag rule ใน `CustomerTagsService.evaluateAutoTags`, journey kind `DEVICE_RETURNED`, predicate `noOpenDeviceReturnWhere()` สำหรับคิวทวงถาม/promise cron, cron 09:20) ทุกตัวเป็น best-effort หลัง commit และไม่แตะ GL.

**Tech Stack:** NestJS 11 + Prisma 6 + PostgreSQL (`apps/api`), jest (unit, mock PrismaService) + vitest (DB-backed `*.integration.spec.ts` และ `cpa-templates/*.spec.ts`), `@nestjs/schedule` cron, class-validator DTO (ข้อความไทย), `Prisma.Decimal` เท่านั้นสำหรับเงิน.

## Global Constraints

- ห้าม `git commit` / `git push` / เปิด PR ในทุกขั้น — คำสั่งเจ้าของ 2026-09-05 (ยังไม่ได้อนุญาต); ทุก task จบด้วย Checkpoint (type-check + tests) แทน commit
- โค้ดยึดคืน/INTER-CO ต้องอ่านจาก `origin/main` (worktree `D:/BESTCHOICE APP/BESTCHOICE-device-return` สร้างจาก origin/main) — ห้าม implement บน branch `feat/stock-go-live-2026-09`
- ข้อความ error/UI เป็นภาษาไทย; เงินใช้ `Prisma.Decimal` (`@db.Decimal(12, 2)`) ห้าม Number(); soft delete เท่านั้น; ทุก controller `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles` ทุก method; route รูป `/:id` บังคับขอบเขตสาขาใน service (BranchGuard ไม่ครอบ)
- AuditLog: action เป็น String; เขียนหลัง `$transaction` commit ผ่าน `AuditService.log` (pattern `pendingAudit`) ยกเว้นที่ต้อง atomic ใช้ `tx.auditLog.create` (แถวนั้นหลุด Merkle chain — ระบุเหตุผลในคอมเมนต์)
- JE ทุกใบ idempotent ด้วย `metadata.flow + idempotencyKey` (DB partial unique index); JE ที่แตะ 11-2107/S21-1104 ต้อง stamp `metadata.shopReceivableType` + `metadata.contractId`
- Unit tests = jest `*.spec.ts` (mock PrismaService; run `npm --prefix apps/api test -- <path>`); DB-backed tests = vitest `*.integration.spec.ts` under `__tests__/` (pattern: `apps/api/src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts` — real PrismaClient, seeds CoA via `seedFinanceCoa`/`seedShopCoa`; run `cd apps/api && npx vitest run --no-file-parallelism <file>` with local Postgres per `.env`); new `__tests__/` directories MUST be added to the vitest globs in `.github/workflows/deploy-gcp.yml` (step "Run DB-backed money-invariant specs", lines ~259-290 on origin/main — globs do not recurse)
- Type check: `./tools/check-types.sh api` / `./tools/check-types.sh web` must be 0 errors at every checkpoint
- Prettier: semi, singleQuote, printWidth 100, tabWidth 2; camelCase/PascalCase; kebab-case files
- Migrations: additive only, descriptive names, timestamp later than `20261002100000_customer_journey`; partial unique index = raw SQL in migration (Prisma cannot express it)
- Frontend: React Query for data, `api` from `@/lib/api`, shadcn/ui + tokens only (no hardcoded colors), `toast` from sonner, Thai text with `leading-snug`

---

## ภาพรวม Phase 2 และข้อสมมติ

- ทำงานใน worktree `D:/BESTCHOICE APP/BESTCHOICE-device-return` (branch `feat/device-return-intake` จาก origin/main) ที่ **Phase 1 ทำเสร็จแล้ว** — มี `InterCoItemType.DEVICE_RETURN`, `InterCoSettlementItem.deviceReturnAmount`, `SHOP_RECEIVABLE_TYPES` (+ `'DEVICE_RETURN'` ใน `EXPLICIT`), `deviceReturnFinanceBalance` / `deviceReturnShopBalance` ใน `interco-typed-balance.ts`, `IntercoPendingService.getPendingDeviceReturns()`, คอลัมน์ aging ใหม่, และด่านใน `ShopCollectSettlementTemplate` (typeStamp ≠ DEVICE_RETURN + ยอด DEVICE_RETURN > 0 → 400 `สัญญานี้มีค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO — …`). ทุกคำสั่ง shell ในแผนนี้รันจาก root ของ worktree นั้น (`cd "D:/BESTCHOICE APP/BESTCHOICE-device-return"`).
- เลขบรรทัดที่อ้างเป็นของ **origin/main** (commit `9a30e66`). ก่อนแก้ไฟล์ให้เปิดไฟล์จริงใน worktree เทียบก่อนเสมอ (Phase 1 อาจขยับบรรทัดในไฟล์ interco/journal ไปบ้าง แต่ไฟล์ repossessions / device-returns / customer-tags / journey / overdue ยังเป็นของ origin/main).
- runner ของเทส: ไฟล์ใต้ `journal/cpa-templates/*.spec.ts` และ `*.integration.spec.ts` เป็น **vitest** (jest ignore ตาม `apps/api/package.json` `testPathIgnorePatterns`); ที่เหลือเป็น **jest**. `./tools/check-types.sh api` รัน `tsc --noEmit` ครอบ `src/**/*` (รวม spec ทุกชนิด) แต่**ไม่**ครอบ `apps/api/e2e/**`.
- ลำดับ task บังคับ: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → (11, 12, 13 อิสระต่อกัน) → 14. (Task 4 ทิ้ง helper interim ไว้ใน product-lifecycle spec ซึ่ง Task 10 แทนด้วยเส้นทางจริง — ตั้งใจ เพื่อให้ทุก checkpoint type-check ผ่านโดยไม่ต้องคง `create()` ไว้ชั่วคราว)

| Task | สิ่งที่ส่งมอบ |
|---|---|
| 1 | Prisma: `DeviceReturn` + enums + relations + migration `20261003100000_device_returns` (partial unique raw SQL) + `device-return.predicate.ts` |
| 2 | `repossessions/table-base.util.ts` (`lookupTableBase`) + RepossessionsService ใช้ util |
| 3 | `repossession-jp5.template.ts` (`shopReceivableType`/`deviceReturnId`) + `shop-collect-shop-legs.template.ts` (Cr S21-1104 เสมอ, stamp DEVICE_RETURN) + vitest specs |
| 4 | `RepossessionsService`: `assertRepossessionPeriodsOpen` + `createInTx`, ลบ `create()`/`POST /repossessions`/`CreateRepossessionDto`, `previewCalculation(deviceReturnId)`, `findAll.deviceReturnOutstanding`; controller; jest spec; product-lifecycle interim |
| 5 | `DeviceReturnNumberService` (`DR-YYYYMMDD-NNNN`) + spec; DTO 4 ไฟล์ |
| 6 | แม่แบบไลน์ 2 แถว (migration `20261003200000_seed_device_return_templates` — precedent `20260702000001`) + `DeviceReturnNotifyService` + spec |
| 7 | `DeviceReturnsService`: `preview` / `lookup` / `create` / `list` / `findOne` / `awaitingRepossession` + spec |
| 8 | Journey kind `DEVICE_RETURNED` (shared + zod + `entries.source`) + specs — ต้องมาก่อน Task 9 (kind union) |
| 9 | `DeviceReturnsService`: `confirm` / `reject` / `cancel` / `resendLine` + spec |
| 10 | Controller + Module + `app.module.ts`; ผู้เรียกเดิมของ `create()` ทุกจุด (product-lifecycle เส้นทางจริง, e2e docs-specs, CLI/web ตรวจแล้ว) |
| 11 | Tag `RETURNED_DEVICE` ใน `CustomerTagsService` + spec |
| 12 | ทวงถาม: `queue.service.ts` promise-tab + `promise-resolution.cron.ts` autoLock skip + specs |
| 13 | `DeviceReturnPendingCron` (09:20 BKK) + spec |
| 14 | Integration spec `device-return-flow.integration.spec.ts` (golden §6.5) + CI glob `DEVRET_FILES` |

---

### Task 1: Prisma — `DeviceReturn` model, enums, migration, predicate

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum `CustomerTagType` — ก้อน `enum CustomerTagType { VIP HIGH_RISK NEW LOYAL BLACKLIST }`; model `Contract` relations tail หลังบรรทัด `interCoSettlementItems InterCoSettlementItem[]`; model `Customer` หลัง `tags CustomerTag[]`; model `Product` หลัง `repossession         Repossession?`; model `Branch` หลัง `bookings Booking[] @relation("BranchBookings")`; model `User` หลัง `repossessionsAppraised      Repossession[]            @relation("AppraisedBy")`; model `Repossession` หลัง `appraisedBy User     @relation("AppraisedBy", …)`)
- Create: `apps/api/prisma/migrations/20261003100000_device_returns/migration.sql`
- Create: `apps/api/src/modules/device-returns/device-return.predicate.ts`
- Test: `apps/api/src/modules/device-returns/device-return.predicate.spec.ts`

**Interfaces:**
- Consumes: Phase 1 migration `20261003000000_interco_device_return_type` (ต้อง apply แล้ว — `npx prisma migrate status` ต้องไม่มี pending ก่อนเริ่ม)
- Produces: Prisma `DeviceReturn` model (`prisma.deviceReturn`), enums `DeviceReturnKind { VOLUNTARY REPOSSESSION }`, `DeviceReturnStatus { PENDING_CONFIRM CONFIRMED REJECTED CANCELED }`, `CustomerTagType.RETURNED_DEVICE`; relations `Contract.deviceReturns[]`, `Customer.deviceReturns[]`, `Product.deviceReturns[]`, `Branch.deviceReturns[]`, `User.deviceReturnsReceived[]` (`@relation("DeviceReturnReceivedBy")`), `Repossession.deviceReturn?`; `export const OPEN_DEVICE_RETURN_STATUSES: DeviceReturnStatus[]`, `export function noOpenDeviceReturnWhere(): Prisma.ContractWhereInput`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน (predicate อ้าง enum ที่ยังไม่มีใน Prisma client)**

สร้าง `apps/api/src/modules/device-returns/device-return.predicate.spec.ts`:

```ts
import { noOpenDeviceReturnWhere, OPEN_DEVICE_RETURN_STATUSES } from './device-return.predicate';

/**
 * spec 2026-09-20 §5.7 — "ใบเปิดอยู่" = เครื่องอยู่ที่สาขาแล้ว (รอยืนยัน หรือยืนยันแล้ว)
 * ใช้ร่วมกันโดย queue.service.ts (แท็บนัดชำระ) + promise-resolution.cron.ts (ข้าม autoLock)
 * ห้ามมีสำเนาเงื่อนไขนี้ที่อื่น.
 */
describe('device-return.predicate', () => {
  it('OPEN_DEVICE_RETURN_STATUSES = PENDING_CONFIRM + CONFIRMED (ตาม spec §5.7 — ไม่ใช่ PENDING อย่างเดียว)', () => {
    expect(OPEN_DEVICE_RETURN_STATUSES).toEqual(['PENDING_CONFIRM', 'CONFIRMED']);
  });

  it('noOpenDeviceReturnWhere() = deviceReturns.none ของสถานะเปิด + deletedAt null', () => {
    expect(noOpenDeviceReturnWhere()).toEqual({
      deviceReturns: {
        none: { status: { in: ['PENDING_CONFIRM', 'CONFIRMED'] }, deletedAt: null },
      },
    });
  });
});
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-return.predicate.spec.ts`
Expected: FAIL — `Cannot find module './device-return.predicate'`

- [ ] **Step 3: แก้ `schema.prisma`**

(ก) enum ใหม่ 2 ตัว — วางถัดจาก `enum ConditionGrade { A B C D }` (ค้นหา `enum ConditionGrade`):

```prisma
/// ใบรับเครื่องคืน (spec 2026-09-20 §4.1) — VOLUNTARY = ลูกค้าคืนเองระหว่างสัญญาเดิน (ACTIVE/OVERDUE/DEFAULT)
/// REPOSSESSION = รับคืนหลังบอกเลิกสัญญา (TERMINATED) — ระบบ derive จากสถานะสัญญา ไม่ให้ผู้ใช้เลือก
enum DeviceReturnKind {
  VOLUNTARY
  REPOSSESSION
}

enum DeviceReturnStatus {
  PENDING_CONFIRM
  CONFIRMED
  REJECTED
  CANCELED
}
```

(ข) `enum CustomerTagType` — เพิ่มค่าท้ายสุด:

```prisma
enum CustomerTagType {
  VIP
  HIGH_RISK
  NEW
  LOYAL
  BLACKLIST
  RETURNED_DEVICE // AUTO — เคยคืน/ถูกยึดเครื่อง (spec 2026-09-20 §5.6; กฎใน CustomerTagsService.evaluateAutoTags)
}
```

(ค) model ใหม่ — วางถัดจาก `model Repossession { … }`:

```prisma
/// ใบรับเครื่องคืน (spec docs/superpowers/specs/2026-09-20-device-return-intake-design.md §4.1)
/// สาขาบันทึกรับเครื่อง (สัญญาหยุดทันทีเมื่อ VOLUNTARY) → FINANCE ยืนยันแล้ว RepossessionsService.createInTx
/// จึงลง JP5 (Dr 11-2107 DEVICE_RETURN) + ขาคู่ SHOP (Cr S21-1104 DEVICE_RETURN) — ค่าเครื่องหักผ่านรอบจ่าย INTER-CO.
/// Partial unique `device_returns_one_open_per_contract` (raw SQL ใน migration 20261003100000 — Prisma เขียนไม่ได้;
/// precedent products_imei_partial_unique): หนึ่งสัญญามีใบ PENDING_CONFIRM ได้ใบเดียว.
model DeviceReturn {
  id                     String             @id @default(uuid())
  docNumber              String             @unique @map("doc_number")
  contractId             String             @map("contract_id")
  productId              String             @map("product_id")
  customerId             String             @map("customer_id")
  receivingBranchId      String             @map("receiving_branch_id")
  receivedById           String             @map("received_by_id")
  returnKind             DeviceReturnKind   @map("return_kind")
  /// key ของ REPOSSESSION_RETURN_REASONS (UNAFFORDABLE / NO_LONGER_NEEDED / AFTER_TERMINATION / OTHER)
  returnReason           String             @map("return_reason")
  deviceReceivedAt       DateTime           @map("device_received_at")
  conditionGrade         ConditionGrade     @map("condition_grade")
  appraisalPrice         Decimal            @map("appraisal_price") @db.Decimal(12, 2)
  /// snapshot ตารางรับซื้อ (ยี่ห้อ/รุ่น/ความจุ/เกรด) ณ วันสร้าง — null = ไม่มีในตาราง
  tableBasePrice         Decimal?           @map("table_base_price") @db.Decimal(12, 2)
  repairCost             Decimal            @default(0) @map("repair_cost") @db.Decimal(12, 2)
  notes                  String?
  /// เฉพาะ VOLUNTARY — สถานะสัญญาก่อน flip เป็น TERMINATED ใช้คืนเมื่อส่งกลับ/ยกเลิก
  previousContractStatus ContractStatus?    @map("previous_contract_status")
  status                 DeviceReturnStatus @default(PENDING_CONFIRM)
  confirmedById          String?            @map("confirmed_by_id")
  confirmedAt            DateTime?          @map("confirmed_at")
  repossessionId         String?            @unique @map("repossession_id")
  rejectedById           String?            @map("rejected_by_id")
  rejectedAt             DateTime?          @map("rejected_at")
  rejectReason           String?            @map("reject_reason")
  canceledById           String?            @map("canceled_by_id")
  canceledAt             DateTime?          @map("canceled_at")
  /// SENT / FAILED / NO_LINE
  lineNotifyStatus       String?            @map("line_notify_status")
  lineNotifiedAt         DateTime?          @map("line_notified_at")
  /// NotificationLog.id ของการส่งล่าสุด
  lineNotificationId     String?            @map("line_notification_id")
  createdAt              DateTime           @default(now()) @map("created_at")
  updatedAt              DateTime           @updatedAt @map("updated_at")
  deletedAt              DateTime?          @map("deleted_at")

  contract        Contract      @relation(fields: [contractId], references: [id], onDelete: Restrict)
  product         Product       @relation(fields: [productId], references: [id], onDelete: Restrict)
  customer        Customer      @relation(fields: [customerId], references: [id], onDelete: Restrict)
  receivingBranch Branch        @relation(fields: [receivingBranchId], references: [id], onDelete: Restrict)
  receivedBy      User          @relation("DeviceReturnReceivedBy", fields: [receivedById], references: [id], onDelete: Restrict)
  repossession    Repossession? @relation(fields: [repossessionId], references: [id])

  @@index([contractId])
  @@index([customerId])
  @@index([status])
  @@index([receivingBranchId])
  @@map("device_returns")
}
```

(ง) relations ฝั่งตรงข้าม — เพิ่มบรรทัดเดียวในแต่ละ model:

```prisma
  // model Contract — ถัดจาก `interCoSettlementItems InterCoSettlementItem[]`
  deviceReturns DeviceReturn[]

  // model Customer — ถัดจาก `tags CustomerTag[]`
  deviceReturns DeviceReturn[]

  // model Product — ถัดจาก `repossession         Repossession?`
  deviceReturns DeviceReturn[]

  // model Branch — ถัดจาก `bookings Booking[] @relation("BranchBookings")`
  deviceReturns DeviceReturn[]

  // model User — ถัดจาก `repossessionsAppraised      Repossession[]            @relation("AppraisedBy")`
  deviceReturnsReceived       DeviceReturn[]            @relation("DeviceReturnReceivedBy")

  // model Repossession — ถัดจาก `appraisedBy User     @relation("AppraisedBy", fields: [appraisedById], references: [id])`
  deviceReturn DeviceReturn?
```

- [ ] **Step 4: เขียน migration ด้วยมือ (ห้ามใช้ `migrate dev` — จะได้ timestamp วันนี้ที่เรียงก่อน `20261002100000_customer_journey` และชน schema drift ที่มีอยู่แล้วบน main)**

สร้าง `apps/api/prisma/migrations/20261003100000_device_returns/migration.sql`:

```sql
-- ใบรับเครื่องคืน (spec docs/superpowers/specs/2026-09-20-device-return-intake-design.md §4.1) — additive only, ไม่มี backfill
-- ลำดับ: หลัง 20261003000000_interco_device_return_type (Phase 1)

-- CreateEnum
CREATE TYPE "DeviceReturnKind" AS ENUM ('VOLUNTARY', 'REPOSSESSION');
CREATE TYPE "DeviceReturnStatus" AS ENUM ('PENDING_CONFIRM', 'CONFIRMED', 'REJECTED', 'CANCELED');

-- AlterEnum — ADD VALUE ถอยไม่ได้ (precedent 20260986000000); ไฟล์นี้ไม่ใช้ค่าใหม่ในคำสั่งถัดไป จึงรันใน tx ได้
ALTER TYPE "CustomerTagType" ADD VALUE 'RETURNED_DEVICE';

-- CreateTable
CREATE TABLE "device_returns" (
    "id" TEXT NOT NULL,
    "doc_number" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "receiving_branch_id" TEXT NOT NULL,
    "received_by_id" TEXT NOT NULL,
    "return_kind" "DeviceReturnKind" NOT NULL,
    "return_reason" TEXT NOT NULL,
    "device_received_at" TIMESTAMP(3) NOT NULL,
    "condition_grade" "ConditionGrade" NOT NULL,
    "appraisal_price" DECIMAL(12,2) NOT NULL,
    "table_base_price" DECIMAL(12,2),
    "repair_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "previous_contract_status" "ContractStatus",
    "status" "DeviceReturnStatus" NOT NULL DEFAULT 'PENDING_CONFIRM',
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "repossession_id" TEXT,
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "canceled_by_id" TEXT,
    "canceled_at" TIMESTAMP(3),
    "line_notify_status" TEXT,
    "line_notified_at" TIMESTAMP(3),
    "line_notification_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "device_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_returns_doc_number_key" ON "device_returns"("doc_number");
CREATE UNIQUE INDEX "device_returns_repossession_id_key" ON "device_returns"("repossession_id");
CREATE INDEX "device_returns_contract_id_idx" ON "device_returns"("contract_id");
CREATE INDEX "device_returns_customer_id_idx" ON "device_returns"("customer_id");
CREATE INDEX "device_returns_status_idx" ON "device_returns"("status");
CREATE INDEX "device_returns_receiving_branch_id_idx" ON "device_returns"("receiving_branch_id");

-- AddForeignKey (onDelete: Restrict — ใบรับคืนเป็นหลักฐาน ห้ามหายไปเงียบ ๆ ใต้ parent)
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_receiving_branch_id_fkey" FOREIGN KEY ("receiving_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_repossession_id_fkey" FOREIGN KEY ("repossession_id") REFERENCES "repossessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique (spec §4.1) — หนึ่งสัญญามีใบรอยืนยันได้ใบเดียว; Prisma เขียน partial index ไม่ได้ (precedent products_imei_partial_unique)
CREATE UNIQUE INDEX "device_returns_one_open_per_contract"
  ON "device_returns" ("contract_id")
  WHERE "status" = 'PENDING_CONFIRM' AND "deleted_at" IS NULL;
```

ตรวจชื่อตาราง FK ให้ตรง `@@map` จริงใน schema (`contracts` / `products` / `customers` / `branches` / `users` / `repossessions`) ก่อนรัน.

- [ ] **Step 5: apply migration + generate client**

Run: `cd apps/api && npx prisma migrate deploy && npx prisma generate && npx prisma migrate status && cd ../..`
Expected: `1 migration found … Applied migration 20261003100000_device_returns` แล้ว `Database schema is up to date!`

- [ ] **Step 6: เขียน predicate**

สร้าง `apps/api/src/modules/device-returns/device-return.predicate.ts`:

```ts
import { DeviceReturnStatus, Prisma } from '@prisma/client';

/**
 * ใบรับเครื่องคืนที่ "เปิดอยู่" = เครื่องอยู่ที่สาขาแล้ว — รอ FINANCE ยืนยัน (PENDING_CONFIRM)
 * หรือยืนยันแล้ว (CONFIRMED). spec 2026-09-20 §5.7: ระบบทวงถามต้องไม่ทำงานกับสัญญากลุ่มนี้
 * (คิวนัดชำระไม่แสดง · promise cron ไม่สั่งล็อค MDM) — ส่งกลับ/ยกเลิกแล้วสัญญาเดินต่อตามเดิม.
 *
 * ประกาศที่นี่ที่เดียว — ผู้ใช้ทั้งสองจุด (queue.service.ts, promise-resolution.cron.ts)
 * import ตัวนี้ ห้ามพิมพ์เงื่อนไขซ้ำ. ด่าน "หนึ่งใบรอยืนยันต่อสัญญา" (partial unique) ใช้
 * PENDING_CONFIRM ตรง ๆ ไม่ใช่รายการนี้.
 */
export const OPEN_DEVICE_RETURN_STATUSES: DeviceReturnStatus[] = ['PENDING_CONFIRM', 'CONFIRMED'];

/** where ของ Contract: ไม่มีใบรับเครื่องคืนที่เปิดอยู่ (spread เข้า where ของคิว/cron) */
export function noOpenDeviceReturnWhere(): Prisma.ContractWhereInput {
  return {
    deviceReturns: {
      none: { status: { in: OPEN_DEVICE_RETURN_STATUSES }, deletedAt: null },
    },
  };
}
```

- [ ] **Step 7: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-return.predicate.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors (มีแต่ model/enum ใหม่ ยังไม่มีผู้ใช้). **Do NOT commit** (see Global Constraints).

---

### Task 2: แยก `lookupTableBase` เป็น `repossessions/table-base.util.ts`

**Files:**
- Create: `apps/api/src/modules/repossessions/table-base.util.ts`
- Test: `apps/api/src/modules/repossessions/table-base.util.spec.ts`
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts:66-71` (interface `RepossessionValuationHint`), `:99-120` (private `lookupTableBase` → ลบ), `:377-379` (previewCalculation call), `:665` (create call)

**Interfaces:**
- Consumes: `TradeInValuationService.lookupValuation(brand, model, storage, condition)` (`apps/api/src/modules/trade-in/services/trade-in-valuation.service.ts:19-53`)
- Produces: `export interface TableBaseHint { grade: string; found: boolean; suggestedPrice: number | null; note: string | null }`, `export async function lookupTableBase(valuationService: TradeInValuationService, product: { brand: string; model: string; storage?: string | null }, grade: string): Promise<TableBaseHint | null>`; `RepossessionValuationHint` กลายเป็น alias ของ `TableBaseHint` (export เดิมคงอยู่)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/api/src/modules/repossessions/table-base.util.spec.ts`:

```ts
import { lookupTableBase } from './table-base.util';

describe('lookupTableBase', () => {
  const svc = () => ({ lookupValuation: jest.fn() });

  it('found → คืน grade/found/suggestedPrice/note จากตารางรับซื้อ และเรียกด้วย storage ที่ให้', async () => {
    const valuation = svc();
    valuation.lookupValuation.mockResolvedValue({
      found: true,
      suggestedPrice: 8000,
      brand: 'Apple',
      model: 'iPhone 14',
      storage: '128GB',
      condition: 'B',
      note: 'จอเดิม',
    });
    const hint = await lookupTableBase(
      valuation as never,
      { brand: 'Apple', model: 'iPhone 14', storage: '128GB' },
      'B',
    );
    expect(hint).toEqual({ grade: 'B', found: true, suggestedPrice: 8000, note: 'จอเดิม' });
    expect(valuation.lookupValuation).toHaveBeenCalledWith('Apple', 'iPhone 14', '128GB', 'B');
  });

  it('ไม่มีในตาราง → found=false, suggestedPrice=null; storage null → ส่ง ""', async () => {
    const valuation = svc();
    valuation.lookupValuation.mockResolvedValue({
      found: false,
      suggestedPrice: null,
      brand: 'X',
      model: 'Y',
      storage: '',
      condition: 'C',
      note: null,
    });
    const hint = await lookupTableBase(valuation as never, { brand: 'X', model: 'Y', storage: null }, 'C');
    expect(hint).toEqual({ grade: 'C', found: false, suggestedPrice: null, note: null });
    expect(valuation.lookupValuation).toHaveBeenCalledWith('X', 'Y', '', 'C');
  });

  it('ไม่มี brand/model → null โดยไม่ query', async () => {
    const valuation = svc();
    expect(await lookupTableBase(valuation as never, { brand: '', model: 'Y' }, 'A')).toBeNull();
    expect(valuation.lookupValuation).not.toHaveBeenCalled();
  });

  it('lookup ล้มเหลว → null (ตารางเป็นตัวช่วย ไม่ใช่ด่าน — ห้ามล้มการยึด/รับคืน)', async () => {
    const valuation = svc();
    valuation.lookupValuation.mockRejectedValue(new Error('db down'));
    expect(await lookupTableBase(valuation as never, { brand: 'X', model: 'Y' }, 'A')).toBeNull();
  });
});
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/repossessions/table-base.util.spec.ts`
Expected: FAIL — `Cannot find module './table-base.util'`

- [ ] **Step 3: เขียน util**

สร้าง `apps/api/src/modules/repossessions/table-base.util.ts` (ตรรกะเดิมของ `RepossessionsService.lookupTableBase` origin/main:99-120 ยกมาทั้งก้อน):

```ts
import { Logger } from '@nestjs/common';
import { TradeInValuationService } from '../trade-in/services/trade-in-valuation.service';

/** ราคากลางแนะนำจากตารางรับซื้อมือสอง สำหรับเกรดที่เลือก (ใช้ทั้งหน้ายึดและใบรับเครื่องคืน) */
export interface TableBaseHint {
  grade: string;
  found: boolean;
  suggestedPrice: number | null;
  note: string | null;
}

const logger = new Logger('lookupTableBase');

/**
 * ราคาตารางรับซื้อของเครื่องนี้ที่เกรดที่เลือก (null = ไม่มี brand/model / ค้นไม่ได้).
 * อ่านอย่างเดียว ล้มเหลวต้องไม่ล้มการยึด/รับคืน — ตารางเป็นตัวช่วย ไม่ใช่ด่านบังคับ
 * (ด่าน ±15% ของผู้เรียกทำงานเฉพาะเมื่อ `found && suggestedPrice > 0`).
 * ย้ายออกจาก RepossessionsService (2026-09-20) ให้ DeviceReturnsService ใช้ร่วมได้.
 */
export async function lookupTableBase(
  valuationService: TradeInValuationService,
  product: { brand: string; model: string; storage?: string | null },
  grade: string,
): Promise<TableBaseHint | null> {
  if (!product.brand || !product.model) return null;
  try {
    const v = await valuationService.lookupValuation(
      product.brand,
      product.model,
      product.storage ?? '',
      grade,
    );
    return { grade, found: v.found, suggestedPrice: v.suggestedPrice, note: v.note };
  } catch (err) {
    logger.warn(
      `valuation lookup failed (${product.brand} ${product.model} ${grade}): ${
        err instanceof Error ? err.message : err
      }`,
    );
    return null;
  }
}
```

- [ ] **Step 4: ให้ `RepossessionsService` ใช้ util**

ใน `apps/api/src/modules/repossessions/repossessions.service.ts`:

(ก) เพิ่ม import (ถัดจาก `import { TradeInLifecycleService } …`):

```ts
import { lookupTableBase, TableBaseHint } from './table-base.util';
```

(ข) แทนที่ interface เดิม (origin/main:65-71):

```ts
/** ราคากลางแนะนำจากตารางรับซื้อมือสอง สำหรับเกรดที่เลือกบนหน้ายึด (preview-only) */
export interface RepossessionValuationHint {
  grade: string;
  found: boolean;
  suggestedPrice: number | null;
  note: string | null;
}
```
ด้วย:
```ts
/** ราคากลางแนะนำจากตารางรับซื้อมือสอง — รูปเดียวกับใบรับเครื่องคืน (table-base.util.ts) */
export type RepossessionValuationHint = TableBaseHint;
```

(ค) ลบ private method ทั้งก้อน (origin/main:95-120 — ตั้งแต่ jsdoc `ราคาตารางรับซื้อของเครื่องนี้ที่เกรดที่เลือก` ถึง `}` ปิด method).

(ง) `previewCalculation` (origin/main:377-379) แทน
```ts
    const valuation = options.conditionGrade
      ? await this.lookupTableBase(contract.product, options.conditionGrade)
      : null;
```
ด้วย
```ts
    const valuation = options.conditionGrade
      ? await lookupTableBase(this.valuationService, contract.product, options.conditionGrade)
      : null;
```

(จ) `create()` (origin/main:665) แทน
```ts
        const table = await this.lookupTableBase(contract.product, dto.conditionGrade);
```
ด้วย
```ts
        const table = await lookupTableBase(this.valuationService, contract.product, dto.conditionGrade);
```

- [ ] **Step 5: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/repossessions/table-base.util.spec.ts src/modules/repossessions/repossessions.service.spec.ts`
Expected: PASS ทั้งสองไฟล์ (spec เดิมของ repossessions mock `prisma.tradeInValuation.findFirst` ซึ่ง `TradeInValuationService` ยังอ่านผ่าน prisma ตัวเดิม — พฤติกรรมไม่เปลี่ยน)

- [ ] **Step 6: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 3: JP5 template `shopReceivableType`/`deviceReturnId` + `ShopCollectShopLegs` ลง Cr S21-1104 เสมอ

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts:10-38` (interface `RepossessionInput`), `:426-433` (metadata stamp ใน `execute`)
- Modify: `apps/api/src/modules/journal/cpa-templates/shop-collect-shop-legs.template.ts:1-45` (jsdoc + `SHOP_REPOSSESSION_INTAKE_FLOW`), `:46-56` (`ShopRepossessionIntakeInput`), `:70-116` (`postRepossessionIntake`)
- Test: `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.spec.ts:188-249` (เทส shop-collect เดิม → 2 เทส)
- Test: `apps/api/src/modules/journal/cpa-templates/shop-collect-shop-legs.template.spec.ts:24-70` (describe `postRepossessionIntake`)
- ตรวจแล้วไม่ต้องแก้: `journal/cpa-templates/__tests__/jp5-vat-split.spec.ts` (ทุก call ใช้ `depositAccountCode: '11-1101'` ไม่มี `collectedByShop` — grep origin/main ยืนยัน)

**Interfaces:**
- Consumes: Phase 1 — `classifyShopReceivable` คืน `'DEVICE_RETURN'` เมื่อ stamp ชัด; `deviceReturnFinanceBalance(client, contractId)`; ด่านใน `ShopCollectSettlementTemplate.execute` (ข้อความ `สัญญานี้มีค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO …`)
- Produces: `RepossessionInput.shopReceivableType?: 'SHOP_COLLECT' | 'DEVICE_RETURN'`, `RepossessionInput.deviceReturnId?: string` (แทน `collectedByShop?: boolean`); `ShopRepossessionIntakeInput { contractId; contractNumber; productId; appraisal: Decimal; shopCompanyId; deviceReturnId?: string; postedAt?: Date }` (ไม่มี `collectedByShop`); JE intake stamp `shopReceivableType: 'DEVICE_RETURN'` + `contractId` + `productId` + `deviceReturnId`

- [ ] **Step 1: แก้เทส JP5 ให้ล้มก่อน**

ใน `repossession-jp5.template.spec.ts` แทนที่เทส `'shop-collect (2026-07-08): deposit leg lands on 11-2107, metadata stamped, and the generic settlement clears it'` (origin/main:188-249 ทั้ง `it(...)`) ด้วย 2 เทสนี้ (imports เพิ่ม: `import { classifyShopReceivable } from '../shop-receivable-type.util';` และ `import { deviceReturnFinanceBalance } from '../../interco-settlement/interco-typed-balance';`):

```ts
  it('shop-collect แบบเก่า (shopReceivableType SHOP_COLLECT): deposit leg 11-2107, stamp เดิมครบ, ใบรับโอนล้างได้', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-2107',
      repossessionValue: new Decimal('7000.00'),
      shopReceivableType: 'SHOP_COLLECT',
    });

    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['flow'], equals: 'repossession' } } as any,
      include: { lines: true },
    });
    expect(entries.length, 'expected exactly 1 repossession JE').toBe(1);
    const shopLeg = entries[0].lines.find((l) => l.accountCode === '11-2107');
    expect(new Decimal(shopLeg!.debit.toString()).toFixed(2)).toBe('7000.00');

    // รูป metadata แบบเก่าคงเดิมทุก key (แถวเก่าถูก classify ด้วย collectedByShop / shopReceivable)
    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.collectedByShop).toBe(true);
    expect(meta.shopReceivable).toBe('11-2107');
    expect(meta.shopReceivableType).toBe('SHOP_COLLECT');
    expect(meta.deviceReturnId).toBeUndefined();
    expect(classifyShopReceivable(meta)).toBe('SHOP_COLLECT');

    const settlement = new ShopCollectSettlementTemplate(journal, prisma as any);
    await settlement.execute({
      contractId: c.id,
      depositAccountCode: '11-1201',
      amount: new Decimal('7000.00'),
    });
    const lines = await prisma.journalLine.findMany({
      where: {
        accountCode: '11-2107',
        journalEntry: {
          AND: [
            { metadata: { path: ['contractId'], equals: c.id } } as any,
            { status: 'POSTED' },
            { deletedAt: null },
          ],
        },
      },
      select: { debit: true, credit: true },
    });
    const outstanding = lines.reduce(
      (s, l) => s.plus(new Decimal(l.debit.toString())).minus(new Decimal(l.credit.toString())),
      new Decimal(0),
    );
    expect(outstanding.toFixed(2), '11-2107 fully cleared after settlement').toBe('0.00');
  });

  it('device-return (2026-09-20): deposit leg 11-2107 typed DEVICE_RETURN + deviceReturnId, ไม่มี collectedByShop, ใบรับโอนจากหน้าร้านปฏิเสธ', async () => {
    const journal = await setup();
    const c = await seedStandard17k12m(prisma);
    await new ContractActivation1ATemplate(journal, prisma as any).execute(c.id);

    const tmpl = new RepossessionJP5Template(journal, prisma as any);
    await tmpl.execute({
      contractId: c.id,
      depositAccountCode: '11-2107',
      repossessionValue: new Decimal('7000.00'),
      shopReceivableType: 'DEVICE_RETURN',
      deviceReturnId: 'dr-spec-1',
    });

    const entries = await prisma.journalEntry.findMany({
      where: { metadata: { path: ['flow'], equals: 'repossession' } } as any,
      include: { lines: true },
    });
    expect(entries.length).toBe(1);
    const meta = entries[0].metadata as Record<string, unknown>;
    expect(meta.shopReceivableType).toBe('DEVICE_RETURN');
    expect(meta.shopReceivable).toBe('11-2107');
    expect(meta.deviceReturnId).toBe('dr-spec-1');
    expect(meta.contractId).toBe(c.id);
    expect(meta.collectedByShop).toBeUndefined();
    expect(classifyShopReceivable(meta)).toBe('DEVICE_RETURN');
    // typed lens ของ Phase 1 เห็นยอดนี้ (anti-drift ระหว่าง stamp ↔ SQL twin)
    expect((await deviceReturnFinanceBalance(prisma, c.id)).toFixed(2)).toBe('7000.00');

    // ค่าเครื่องคืนต้องหักผ่านรอบจ่าย INTER-CO — ใบรับโอนสด (SHOP_COLLECT) ต้องถูกด่าน Phase 1 ปฏิเสธ
    const settlement = new ShopCollectSettlementTemplate(journal, prisma as any);
    await expect(
      settlement.execute({
        contractId: c.id,
        depositAccountCode: '11-1201',
        amount: new Decimal('7000.00'),
      }),
    ).rejects.toThrow(/ค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO/);
  });
```

- [ ] **Step 2: แก้เทส ShopCollectShopLegs ให้ล้มก่อน**

ใน `shop-collect-shop-legs.template.spec.ts` แทนที่ `describe('postRepossessionIntake', …)` ทั้งก้อน (origin/main:24-70) ด้วย:

```ts
  describe('postRepossessionIntake (2026-09-20 — ค้างจ่าย FINANCE เสมอ หักผ่านรอบจ่าย INTER-CO)', () => {
    it('Dr S11-2002 / Cr S21-1104 stamped DEVICE_RETURN + contractId + productId + deviceReturnId', async () => {
      const { legs, createAndPost } = build();
      await legs.postRepossessionIntake({
        contractId: 'c-1',
        contractNumber: 'TEST-001',
        productId: 'p-1',
        appraisal: new Decimal('6500'),
        shopCompanyId: 'shop-co',
        deviceReturnId: 'dr-1',
        postedAt: new Date('2026-09-20T00:00:00Z'),
      });
      const input = createAndPost.mock.calls[0][0];
      expect(lineTuples(input)).toEqual([
        ['S11-2002', '6500.00', '0.00'],
        ['S21-1104', '0.00', '6500.00'],
      ]);
      expect(input.companyId).toBe('shop-co');
      expect(input.postedAt).toEqual(new Date('2026-09-20T00:00:00Z'));
      expect(input.metadata).toMatchObject({
        flow: SHOP_REPOSSESSION_INTAKE_FLOW,
        idempotencyKey: `${SHOP_REPOSSESSION_INTAKE_FLOW}:c-1`,
        contractId: 'c-1',
        productId: 'p-1',
        deviceReturnId: 'dr-1',
        companyCode: 'SHOP',
        shopReceivableType: 'DEVICE_RETURN',
        appraisal: '6500.00',
      });
      expect(input.metadata.collectedByShop).toBeUndefined();
      expect(input.reference).toBe('contract:c-1:repossession-intake');
    });

    it('ไม่มีสาขาโอนสดทันทีอีกต่อไป — ไม่มีบรรทัด S11-1202 ไม่ว่ากรณีใด และ deviceReturnId ไม่ส่ง = ไม่ stamp key', async () => {
      const { legs, createAndPost } = build();
      await legs.postRepossessionIntake({
        contractId: 'c-2',
        contractNumber: 'TEST-002',
        productId: 'p-2',
        appraisal: new Decimal('1000'),
        shopCompanyId: 'shop-co',
      });
      const input = createAndPost.mock.calls[0][0];
      expect(input.lines.map((l: { accountCode: string }) => l.accountCode)).toEqual([
        'S11-2002',
        'S21-1104',
      ]);
      expect(input.metadata.shopReceivableType).toBe('DEVICE_RETURN');
      expect('deviceReturnId' in input.metadata).toBe(false);
    });

    it('rejects a non-positive appraisal (programmer error, not a business path)', async () => {
      const { legs } = build();
      await expect(
        legs.postRepossessionIntake({
          contractId: 'c-1',
          contractNumber: 'TEST-001',
          productId: 'p-1',
          appraisal: new Decimal('0'),
          shopCompanyId: 'shop-co',
        }),
      ).rejects.toThrow(/appraisal must be > 0/);
    });
  });
```

- [ ] **Step 3: รันเทสให้ล้ม**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/journal/cpa-templates/shop-collect-shop-legs.template.spec.ts src/modules/journal/cpa-templates/repossession-jp5.template.spec.ts; cd ../..`
Expected: FAIL — spec ShopCollectShopLegs: `expected [ 'S11-2002', 'S11-1202' ] to deeply equal …` / `expected 'SHOP_COLLECT' to be 'DEVICE_RETURN'`; spec JP5: TypeScript/vitest error `Object literal may only specify known properties, and 'shopReceivableType' does not exist in type` (หรือ `expected undefined to be 'DEVICE_RETURN'`)

- [ ] **Step 4: แก้ `repossession-jp5.template.ts`**

(ก) แทนที่ฟิลด์ `collectedByShop` ใน `RepossessionInput` (origin/main:15-20):

```ts
  /**
   * Shop-collect (2026-07-08): the caller substituted depositAccountCode with
   * 11-2107 ลูกหนี้-หน้าร้าน — stamp metadata so audit reports can pair the JE
   * with its later shop-collect settlement (same convention as JP4).
   */
  collectedByShop?: boolean;
```
ด้วย:
```ts
  /**
   * ประเภทลูกหนี้-หน้าร้าน 11-2107 ที่ขา Dr ของ JP5 ตั้ง (ใบรับเครื่องคืน 2026-09-20):
   * - 'DEVICE_RETURN' = ค่าเครื่องคืน ค้างจ่ายโดย SHOP หักผ่านรอบจ่าย INTER-CO
   *   (ผู้เรียกเดียวใน production คือ RepossessionsService.createInTx — เสมอ)
   * - 'SHOP_COLLECT'  = แบบเก่า ล้างผ่านใบรับโอนจากหน้าร้าน (คงไว้ให้ spec/แถวเก่า;
   *   stamp `collectedByShop: true` เพิ่มให้รูป metadata เท่าแถวเก่าทุก key)
   * ไม่ส่ง = ขา Dr เป็นเงินสด/ธนาคารจริง ไม่ stamp อะไร.
   */
  shopReceivableType?: 'SHOP_COLLECT' | 'DEVICE_RETURN';
  /** ใบรับเครื่องคืนต้นทาง (DeviceReturn.id) — stamp ลง metadata เพื่อไล่ย้อนจาก JE ไปใบ */
  deviceReturnId?: string;
```

(ข) แทนที่ metadata stamp ใน `execute` (origin/main:426-433):

```ts
          ...(input.collectedByShop
            ? {
                collectedByShop: true,
                shopReceivable: input.depositAccountCode,
                shopReceivableType: 'SHOP_COLLECT',
              }
            : {}),
```
ด้วย:
```ts
          ...(input.shopReceivableType
            ? {
                shopReceivable: input.depositAccountCode,
                shopReceivableType: input.shopReceivableType,
                // แถวเก่าถูก classify ด้วย marker นี้ (classifyShopReceivable fallback) — คงไว้เฉพาะแบบเก่า
                ...(input.shopReceivableType === 'SHOP_COLLECT' ? { collectedByShop: true } : {}),
                ...(input.deviceReturnId ? { deviceReturnId: input.deviceReturnId } : {}),
              }
            : {}),
```

(ค) ใน jsdoc ของคลาส (บล็อก `Template JP5 — Repossession (Case 5).`) เพิ่มบรรทัดท้ายสุดก่อน `*/`:

```
 *
 * ใบรับเครื่องคืน (2026-09-20): production เรียกด้วย depositAccountCode '11-2107' +
 * shopReceivableType 'DEVICE_RETURN' เสมอ — ไม่มีขาเงินสดวันยึดอีกต่อไป; ค่าเครื่องหักในรอบจ่าย INTER-CO.
```

- [ ] **Step 5: แก้ `shop-collect-shop-legs.template.ts`**

(ก) แทนที่ jsdoc หัวไฟล์ (origin/main:8-31 — ตั้งแต่ `/**` ถึง `*/` ก่อน `export const SHOP_REPOSSESSION_INTAKE_FLOW`):

```ts
/**
 * ขาคู่ฝั่ง SHOP ของ 11-2107 ที่เกิดจากการยึด/รับเครื่องคืน (JP5).
 *
 * ใบรับเครื่องคืน (`postRepossessionIntake`, spec 2026-09-20 §6.1) — mirror ของ A.4 `shop-exchange-return`:
 *   Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง            [ราคาประเมิน]
 *     Cr S21-1104 เจ้าหนี้ FINANCE                     [ราคาประเมิน]   ← FINANCE Dr 11-2107 typed DEVICE_RETURN
 *   ค้างจ่ายเสมอ — ค่าเครื่องหักจากยอดโอนในรอบจ่าย INTER-CO (แถวหักประเภทที่ 3) หรือรับเงินสด
 *   ผ่าน `POST /interco-settlement/device-returns/:contractId/settle-cash`. สาขา "โอนให้ FINANCE ทันที"
 *   (Cr S11-1202) ถูกลบ 2026-09-20: วันรับเครื่องไม่มีการโอนเงินจริง.
 *
 * ใบล้างเจ้าหนี้ (`postSettlement`) — คู่ของ `ShopCollectSettlementTemplate` (FINANCE Dr KBank / Cr 11-2107)
 * สำหรับแถวเก่าที่แท็ก SHOP_COLLECT (forward-only spec §6.6):
 *   Dr S21-1104 เจ้าหนี้ FINANCE                       [amount]
 *     Cr S11-1202 ธนาคาร SHOP (จ่าย)                   [amount]
 *
 * ทั้งสองใบ stamp `shopReceivableType` + `metadata.contractId` ให้เลนส์ S21-1104 (aging Query B /
 * drift / typed balances) จัดประเภทได้ — B2 รอบ 2 (ผู้สอบ 2026-08-25): S21-1104 รับทุกประเภท
 * แต่ต้องแยกแสดงด้วย metadata.
 *
 * ไม่ใช่ Nest provider โดยตั้งใจ — สร้างด้วย `new ShopCollectShopLegs(journalAuto)` ในผู้เรียก
 * (pattern เดียวกับ `TradeInValuationService` ใน RepossessionsService). Idempotency = `metadata.flow
 * + idempotencyKey` (DB partial unique index) — ผู้เรียกตรวจ dedupe ของใบ FINANCE ก่อนแล้วจึงเรียก.
 */
```

(ข) แทนที่ `ShopRepossessionIntakeInput` (origin/main:46-56):

```ts
export interface ShopRepossessionIntakeInput {
  contractId: string;
  contractNumber: string;
  productId: string;
  /** ราคาประเมิน = ยอดที่ JP5 ลง Dr 11-2107 ฝั่ง FINANCE (ราคาเดียว 2026-09-05) */
  appraisal: Decimal;
  shopCompanyId: string;
  /** ใบรับเครื่องคืนต้นทาง — stamp ลง metadata คู่กับ JP5 */
  deviceReturnId?: string;
  postedAt?: Date;
}
```

(ค) แทนที่ method `postRepossessionIntake` ทั้งก้อน (origin/main:70-116):

```ts
  async postRepossessionIntake(
    input: ShopRepossessionIntakeInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const amount = new Decimal(input.appraisal.toString());
    if (amount.lte(0)) {
      throw new Error(`ShopCollectShopLegs: appraisal must be > 0 (received ${amount.toString()})`);
    }
    const zero = new Decimal(0);
    return this.journal.createAndPost(
      {
        description: `รับเครื่องคืนเข้าสต็อก SHOP — สัญญา ${input.contractNumber} (ค่าเครื่องค้างจ่าย FINANCE — หักในรอบจ่าย INTER-CO)`,
        reference: `contract:${input.contractId}:repossession-intake`,
        postedAt: input.postedAt,
        metadata: {
          flow: SHOP_REPOSSESSION_INTAKE_FLOW,
          idempotencyKey: `${SHOP_REPOSSESSION_INTAKE_FLOW}:${input.contractId}`,
          contractId: input.contractId,
          productId: input.productId,
          companyCode: 'SHOP',
          appraisal: amount.toFixed(2),
          // ขาคู่ของ 11-2107 DEVICE_RETURN — เลนส์ S21-1104 key ด้วย metadata.contractId (Phase 1)
          shopReceivableType: 'DEVICE_RETURN',
          ...(input.deviceReturnId ? { deviceReturnId: input.deviceReturnId } : {}),
        },
        companyId: input.shopCompanyId,
        lines: [
          {
            accountCode: SHOP_USED_INVENTORY,
            dr: amount,
            cr: zero,
            description: 'รับเครื่องคืนเข้าสต็อก SHOP (มือสอง — ราคาประเมิน)',
          },
          {
            accountCode: SHOP_FINANCE_PAYABLE,
            dr: zero,
            cr: amount,
            description: 'เจ้าหนี้-FINANCE ค่าเครื่องคืน (หักในรอบจ่าย INTER-CO)',
          },
        ],
      },
      tx,
    );
  }
```

`postSettlement` และ `SHOP_COLLECT_SETTLEMENT_SHOP_FLOW` **ไม่แตะ** (ยังใช้ล้างแถวเก่า SHOP_COLLECT — spec §6.6).

- [ ] **Step 6: รันเทสให้ผ่าน**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/journal/cpa-templates/shop-collect-shop-legs.template.spec.ts src/modules/journal/cpa-templates/repossession-jp5.template.spec.ts; cd ../..`
Expected: PASS (ShopCollectShopLegs 5 tests, JP5 8 tests). ต้องมี Postgres ตาม `.env` เพราะ spec JP5 ใช้ DB จริง.

- [ ] **Step 7: ต่อผู้เรียกเดิมใน `repossessions.service.ts` ให้คอมไพล์ผ่าน (แก้ชั่วคราว — Task 4 เขียนทับทั้งสามจุด)**

ใน `apps/api/src/modules/repossessions/repossessions.service.ts`:

(ก) `previewCalculation` (origin/main:403-411 — call `previewJe`) แทน `collectedByShop: options.collectedByShop === true,` ด้วย `shopReceivableType: options.collectedByShop ? 'SHOP_COLLECT' : undefined,`

(ข) `create()` (origin/main:722-732 — call `execute`) แทน `collectedByShop: dto.collectedByShop === true,` ด้วย `shopReceivableType: dto.collectedByShop ? 'SHOP_COLLECT' : undefined,`

(ค) `create()` (origin/main:740-751 — call `postRepossessionIntake`) ลบบรรทัด `collectedByShop: dto.collectedByShop === true,`

ผลข้างเคียงที่ตั้งใจ: jest spec `repossessions.service.spec.ts` จะมี 3 เทสแดงจนถึง Task 4 — `'paid straight to FINANCE KBank → SHOP books Cr S11-1202 …'` (origin/main:1014), `'passes tx to JP5 template …'` (:863 คาด `collectedByShop: false`), `'collectedByShop books the JP5 deposit leg …'` (:1145 คาด `collectedByShop: true`) — ทั้งสามทดสอบพฤติกรรมที่ Task 4 ลบทิ้ง (โหมดโอนสด / flag เก่า) และถูกเขียนใหม่ทั้ง describe ใน Task 4.

- [ ] **Step 8: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 4: `RepossessionsService` — `assertRepossessionPeriodsOpen` + `createInTx`, ลบ `create()`/`POST /repossessions`/`CreateRepossessionDto`, `previewCalculation(deviceReturnId)`, `findAll.deviceReturnOutstanding`

**Files:**
- Modify: `apps/api/src/modules/repossessions/repossessions.service.ts:1-34` (imports), `:122-247` (`findAll`), `:249-483` (`previewCalculation`), `:485-926` (`create()` ทั้งก้อน → 2 method ใหม่)
- Modify: `apps/api/src/modules/repossessions/repossessions.controller.ts:4` (import), `:55-79` (preview), `:86-93` (ลบ `create`)
- Modify: `apps/api/src/modules/repossessions/dto/create-repossession.dto.ts:1-108` (ลบ class `CreateRepossessionDto` + import ที่ไม่ใช้)
- Test: `apps/api/src/modules/repossessions/repossessions.service.spec.ts` (mocks `:126-200`, preview tests `:390-400`, `:486-497`, `:545-573`, describe `create` `:612-1253` → describes `assertRepossessionPeriodsOpen` + `createInTx`)
- Modify (interim — Task 9 เขียนทับอีกครั้ง): `apps/api/src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts:663-673`, `:695-716`, `:780-791`

**Interfaces:**
- Consumes: Task 3 `RepossessionInput.shopReceivableType/deviceReturnId`, `ShopRepossessionIntakeInput` (ไม่มี `collectedByShop`); Task 2 `lookupTableBase`; Phase 1 `deviceReturnFinanceBalance`, `InterCoSettlementItem.deviceReturnAmount`
- Produces:
  - `export interface RepossessionCreateInput { contractId: string; repossessedDate: Date; paymentDate: Date; conditionGrade: string; appraisalPrice: number; repairCost?: number; notes?: string; returnReason?: RepossessionReturnReason; discountPct?: number; appraisedById: string; receivingBranchId: string; deviceReturnId: string; financeCompanyId: string; shopCompanyId: string }`
  - `export interface RepossessionCreateResult { repossession: Repossession; outstandingBalance: Prisma.Decimal; totalPaid: Prisma.Decimal; creditNote?: { outcome: string; receiptId?: string } }`
  - `async assertRepossessionPeriodsOpen(paymentDate: Date): Promise<{ financeCompanyId: string; shopCompanyId: string }>`
  - `async createInTx(tx: Prisma.TransactionClient, input: RepossessionCreateInput, actorUserId: string): Promise<RepossessionCreateResult>` — **ไม่แปลง P2002 → 409** (ผู้เรียกทำ เพราะ tx ของผู้เรียก abort แล้ว); ไม่ส่งไลน์ CN (ผู้เรียกทำหลัง commit)
  - `previewCalculation(contractId, { appraisalPrice?, discountPct?, conditionGrade?, deviceReturnId? }, user?)` — JP5 preview deposit `'11-2107'` typed `DEVICE_RETURN` เสมอ
  - `findAll` rows += `deviceReturnOutstanding: string` (2dp) = `deviceReturnFinanceBalance(prisma, cid)` − Σ `deviceReturnAmount` ของ item ใน batch POSTED ของสัญญานั้น (**same-type เท่านั้น** — กติกาที่ Phase 1 ตัดสิน; ห้ามรวม `swapCreditAmount`/`recallAmount`) ผ่าน helper ของ Phase 1 `postedDeductionsByContract(client, contractIds, columns): Promise<Map<string, Prisma.Decimal>>` (module-level export จาก `apps/api/src/modules/interco-settlement/interco-typed-balance.ts` พร้อม `DeductionColumn` / `ALL_DEDUCTION_COLUMNS` / `DEVICE_RETURN_DEDUCTION_COLUMNS`; key = contractId, ไม่มี key = 0) — **ห้ามเขียนสูตรรวม deduction ใหม่ในไฟล์นี้**
  - `GET /repossessions/preview/:contractId?appraisalPrice&discountPct&conditionGrade&deviceReturnId`

- [ ] **Step 1: แก้ jest spec ให้ล้มก่อน — mocks + preview**

ใน `apps/api/src/modules/repossessions/repossessions.service.spec.ts`:

(ก) import เพิ่มบรรทัดบน (ถัดจาก `import { RepossessionsService } from './repossessions.service';`):

```ts
import type { RepossessionCreateInput } from './repossessions.service';
import { ConflictException } from '@nestjs/common';
```

(ข) ใน object `prisma = { … }` ของ `beforeEach` (origin/main:126-200) เพิ่ม 2 model mock ถัดจาก `systemConfig: {…},`:

```ts
      // previewCalculation(deviceReturnId) — โหมดยืนยันใบรับเครื่องคืน (2026-09-20)
      deviceReturn: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // findAll.deviceReturnOutstanding — helper ของ Phase 1 `postedDeductionsByContract` อ่าน
      // InterCoSettlementItem ผ่าน prisma ตัวนี้; รูป mock ต้องตาม implementation จริงของ Phase 1
      // (ให้ทุก call คืนค่าว่าง → Σ deduction = 0). ถ้า helper ใช้ method อื่นเพิ่ม ให้เติมที่นี่
      interCoSettlementItem: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { swapCreditAmount: null, recallAmount: null, deviceReturnAmount: null },
        }),
      },
```

(ค) เทส `'customerRefund is always 0 …'` (origin/main:390-400): ลบบรรทัด `customerRefundEnabled: true,` ออกจาก options (เหลือ `{ appraisalPrice: 5000 }`) — assertions คงเดิม.

(ง) เทส `'profitLoss ignores the (retired) refund flag …'` (origin/main:486-497): เปลี่ยนชื่อเป็น `'profitLoss = ราคากลาง − ยอดปิด — ไม่มี flag คืนเงินให้ส่งอีกต่อไป (2026-09-20 option ถูกถอด)'` และลบ `customerRefundEnabled: true,` ออกจาก options.

(จ) แทนที่ 2 เทส `'includes journalPreview (dry-run JP5) — mirror create(): …'` และ `'default deposit = 11-1201 (KBank) …'` (origin/main:545-573) ด้วย 3 เทสนี้:

```ts
    it('journalPreview (dry-run JP5): ขา Dr = 11-2107 typed DEVICE_RETURN เสมอ, repoValue = appraisalPrice (2026-09-20)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());

      const result = await service.previewCalculation('contract-1', { appraisalPrice: 6000 });

      expect(result.journalPreview?.isBalanced).toBe(true);
      expect(jp5.previewJe).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          depositAccountCode: '11-2107',
          shopReceivableType: 'DEVICE_RETURN',
        }),
      );
      const input = jp5.previewJe.mock.calls[0][0];
      expect(input.repossessionValue.toFixed(2)).toBe('6000.00');
      expect(input.collectedByShop).toBeUndefined();
      expect(input.deviceReturnId).toBeUndefined();
    });

    it('deviceReturnId → เกรด/ราคาประเมินมาจากใบ (query ถูกละเลย) และ stamp deviceReturnId เข้า preview', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.deviceReturn.findFirst.mockResolvedValueOnce({
        conditionGrade: 'C',
        appraisalPrice: decimal(4500),
      });
      prisma.tradeInValuation = {
        findFirst: jest.fn().mockResolvedValue({ basePrice: decimal(5000), note: null }),
      };

      const result = await service.previewCalculation('contract-1', {
        appraisalPrice: 9999,
        conditionGrade: 'A',
        deviceReturnId: 'dr-1',
      });

      expect(prisma.deviceReturn.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'dr-1', contractId: 'contract-1', deletedAt: null } }),
      );
      // เกรดจากใบ (C) ไม่ใช่ query (A) — ตารางถูกค้นด้วย condition 'C'
      expect(prisma.tradeInValuation.findFirst.mock.calls[0][0].where.condition).toBe('C');
      expect(result.valuation).toEqual({ grade: 'C', found: true, suggestedPrice: 5000, note: null });
      expect(result.calculation.marketValue).toBe(4500);
      expect(result.calculation.marketValueSource).toBe('APPRAISAL');
      expect(jp5.previewJe).toHaveBeenCalledWith(
        expect.objectContaining({ deviceReturnId: 'dr-1', depositAccountCode: '11-2107' }),
      );
      expect(jp5.previewJe.mock.calls[0][0].repossessionValue.toFixed(2)).toBe('4500.00');
    });

    it('deviceReturnId ที่ไม่ใช่ของสัญญานี้ → NotFoundException', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.deviceReturn.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.previewCalculation('contract-1', { deviceReturnId: 'dr-other' }),
      ).rejects.toThrow(NotFoundException);
    });
```

(ฉ) ใน describe `findAll` เทสแรก `'returns paginated list with defaults'` (origin/main:273-287) เพิ่ม assertion ท้ายเทส:

```ts
      // typed DEVICE_RETURN ($queryRaw → 0) − Σ deviceReturnAmount ของ batch POSTED (helper Phase 1 → 0) = 0.00
      expect(result.data[0].deviceReturnOutstanding).toBe('0.00');
```

- [ ] **Step 2: แก้ jest spec ให้ล้มก่อน — describe `create` → `assertRepossessionPeriodsOpen` + `createInTx`**

แทนที่ `describe('create', () => { … });` ทั้งก้อน (origin/main:612-1253 — จบที่ `});` ก่อนคอมเมนต์ `// ─── refundPayment`) ด้วย:

```ts
  // ──────────────────────────────────────────────────────────────────────────
  // assertRepossessionPeriodsOpen — ด่านนอก tx ของ create() เดิม (2026-09-20 ใบรับเครื่องคืน)
  // ──────────────────────────────────────────────────────────────────────────
  describe('assertRepossessionPeriodsOpen', () => {
    it('rejects a future paymentDate (BKK calendar day)', async () => {
      const tomorrow = new Date(Date.now() + 48 * 60 * 60 * 1000);
      await expect(service.assertRepossessionPeriodsOpen(tomorrow)).rejects.toThrow(/อนาคต/);
    });

    it('ปฏิเสธ paymentDate เดือนก่อนหน้า (ห้ามข้ามเดือน — คำสั่งเจ้าของ 2026-08-08 ข้อ 3)', async () => {
      // "วันสุดท้ายของเดือนก่อน" บนปฏิทินเวลาไทย ตรึงเที่ยงวันไทยให้ห่างขอบเดือน (บทเรียน CI 2026-08-23)
      const [y, m] = bkkYearMonth(new Date()).split('-').map(Number);
      const prevMonth = new Date(Date.UTC(y, m - 1, 1, 5, 0, 0));
      prevMonth.setUTCDate(0);
      await expect(service.assertRepossessionPeriodsOpen(prevMonth)).rejects.toThrow(
        'วันที่รับเงินย้อนหลังได้เฉพาะภายในเดือนปัจจุบัน',
      );
    });

    it('เดือนปัจจุบัน → คืน company ids ทั้งสองและ validatePeriodOpen ถูกเรียก 2 ครั้ง (FINANCE + SHOP)', async () => {
      const spy = jest.spyOn(periodLockUtil, 'validatePeriodOpen');
      spy.mockClear();
      await expect(service.assertRepossessionPeriodsOpen(new Date())).resolves.toEqual({
        financeCompanyId: 'company-finance',
        shopCompanyId: 'company-shop',
      });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[0][2]).toBe('company-finance');
      expect(spy.mock.calls[1][2]).toBe('company-shop');
    });

    it('ยอมรับ paymentDate ในงวดที่ CLOSED แต่ยังอยู่ใน grace window (validatePeriodOpen ของจริง)', async () => {
      const now = new Date();
      prisma.accountingPeriod = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'period-1',
          companyId: 'company-finance',
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          status: 'CLOSED',
        }),
      };
      await expect(service.assertRepossessionPeriodsOpen(now)).resolves.toBeDefined();
      expect(prisma.accountingPeriod.findUnique).toHaveBeenCalled();
    });

    it('fails loud when FINANCE company is not configured (period guard must not silently no-op)', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue(null);
      await expect(service.assertRepossessionPeriodsOpen(new Date())).rejects.toThrow(
        'FINANCE company not configured',
      );
    });

    it('fails loud when SHOP company is not configured', async () => {
      prisma.companyInfo.findFirst.mockImplementation(
        async (args?: { where?: { companyCode?: string } }) =>
          args?.where?.companyCode === 'SHOP' ? null : { id: 'company-finance' },
      );
      await expect(service.assertRepossessionPeriodsOpen(new Date())).rejects.toThrow(
        'SHOP company not configured',
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // createInTx — ตรรกะใน tx ของ create() เดิม; ผู้เรียก production = DeviceReturnsService.confirm
  // (mock $transaction ส่ง prisma เป็น tx จึงเรียกด้วย prisma ตรง ๆ ได้)
  // ──────────────────────────────────────────────────────────────────────────
  describe('createInTx', () => {
    const baseInput = (): RepossessionCreateInput => ({
      contractId: 'contract-1',
      repossessedDate: new Date('2026-01-15T05:00:00.000Z'),
      paymentDate: new Date(),
      conditionGrade: 'B',
      appraisalPrice: 6000,
      appraisedById: 'user-branch',
      receivingBranchId: 'branch-receiving',
      deviceReturnId: 'dr-1',
      financeCompanyId: 'company-finance',
      shopCompanyId: 'company-shop',
    });
    const run = (over: Partial<RepossessionCreateInput> = {}) =>
      service.createInTx(prisma, { ...baseInput(), ...over }, 'user-1');
    const arm = (contractOverrides: Partial<Record<string, unknown>> = { status: 'TERMINATED' }) => {
      prisma.contract.findUnique.mockResolvedValue(makeContract(contractOverrides));
      prisma.repossession.create.mockResolvedValue(makeRepossession());
      prisma.contract.update.mockResolvedValue({});
      prisma.product.update.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});
    };
    const shopIntakeCalls = () =>
      journalAuto.createAndPost.mock.calls
        .filter(
          ([input]: [Record<string, unknown>]) =>
            (input.metadata as Record<string, unknown>)?.flow === 'shop-repossession-intake',
        )
        .map(([input]: [Record<string, unknown>]) => input);

    it('throws BadRequestException for invalid condition grade', async () => {
      await expect(run({ conditionGrade: 'Z' })).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid return reasons and OTHER without detail before writing', async () => {
      await expect(run({ returnReason: 'INVALID' as never })).rejects.toThrow(
        'กรุณาเลือกเหตุผลคืนเครื่องที่ถูกต้อง',
      );
      await expect(run({ returnReason: 'OTHER', notes: '  ' })).rejects.toThrow(
        'กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง',
      );
      expect(prisma.repossession.create).not.toHaveBeenCalled();
    });

    it('saves the selected return reason with readable notes and a structured audit code', async () => {
      arm();
      await run({ returnReason: 'UNAFFORDABLE', notes: 'ผู้รับเครื่องตรวจสภาพแล้ว' });
      expect(prisma.repossession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notes: 'เหตุผลคืนเครื่อง: ลูกค้าไม่สามารถผ่อนต่อได้\nผู้รับเครื่องตรวจสภาพแล้ว',
            appraisedById: 'user-branch',
            repossessedDate: new Date('2026-01-15T05:00:00.000Z'),
          }),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'REPOSSESSION',
            userId: 'user-1',
            newValue: expect.objectContaining({
              returnReason: 'UNAFFORDABLE',
              returnReasonLabel: 'ลูกค้าไม่สามารถผ่อนต่อได้',
              deviceReturnId: 'dr-1',
              receivingBranchId: 'branch-receiving',
            }),
          }),
        }),
      );
    });

    it('throws NotFoundException when contract is not found', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      await expect(run()).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when contract status is ACTIVE (no termination)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'ACTIVE' }));
      await expect(run()).rejects.toThrow(BadRequestException);
    });

    it('strict mode: rejects DEFAULT status when jp5_require_terminated_status=true', async () => {
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 'true' });
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'DEFAULT' }));
      await expect(run()).rejects.toThrow(/strict mode|หนังสือบอกเลิก/);
    });

    it('throws BadRequestException when product is already repossessed', async () => {
      prisma.contract.findUnique.mockResolvedValue(
        makeContract({ product: { ...makeContract().product, status: 'REPOSSESSED' } }),
      );
      await expect(run()).rejects.toThrow(BadRequestException);
    });

    it('device already has a Repossession row (productId @unique) → 409 Thai before any JE', async () => {
      arm();
      prisma.repossession.findFirst.mockResolvedValueOnce({ id: 'repo-old' });
      await expect(run()).rejects.toThrow(ConflictException);
      await expect(run()).rejects.toThrow(/เคยถูกยึดคืนมาแล้ว/);
      expect(jp5.execute).not.toHaveBeenCalled();
    });

    it('P2002 (lost race on the unique index) propagates as-is — ผู้เรียกแปลงเป็น 409 เพราะ tx ของมัน abort แล้ว', async () => {
      arm();
      prisma.repossession.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(run()).rejects.toMatchObject({ code: 'P2002' });
    });

    it('threads paymentDate through to JP5 postedAt (JE entryDate)', async () => {
      arm({ status: 'DEFAULT' });
      const paymentDate = new Date();
      await run({ paymentDate });
      expect(jp5.execute).toHaveBeenCalledWith(expect.objectContaining({ postedAt: paymentDate }), prisma);
    });

    it('stores profitLoss = ราคากลาง − ยอดปิดสัญญา on the repossession row', async () => {
      arm({ status: 'DEFAULT' });
      await run();
      const data = prisma.repossession.create.mock.calls[0][0].data;
      // สูตรเดียวกับ preview + ปิดยอดก่อนกำหนด: ยอดค้าง 2000 − ส่วนลด 59.58 + ค่าปรับ 100 = closing 2040.42
      expect(Number(data.closingAmount)).toBeCloseTo(2040.42, 2);
      expect(Number(data.profitLoss)).toBeCloseTo(6000 - 2040.42, 2);
      expect(data.customerRefundEnabled).toBe(false);
      expect(String(data.customerRefund)).toBe('0');
    });

    it('creates repossession, contract → CLOSED_BAD_DEBT, product → REPOSSESSED + SHOP-owned + branchId = receivingBranchId', async () => {
      arm();
      const result = await run();
      expect(prisma.repossession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REPOSSESSED', conditionGrade: 'B' }),
        }),
      );
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CLOSED_BAD_DEBT' } }),
      );
      const productData = prisma.product.update.mock.calls[0][0].data;
      expect(productData.status).toBe('REPOSSESSED');
      expect(productData.ownedByCompanyId).toBe('company-shop');
      expect(productData.branchId).toBe('branch-receiving');
      expect(productData.category).toBeUndefined(); // fixture product has no category → untouched
      expect(result.repossession).toMatchObject({ id: 'repo-1' });
      expect(result.outstandingBalance.toFixed(2)).toBe('2100.00');
      expect(result.totalPaid.toFixed(2)).toBe('1000.00');
    });

    it('JP5 ขา Dr = 11-2107 typed DEVICE_RETURN + deviceReturnId เสมอ, ใน tx เดียวกับผู้เรียก', async () => {
      arm();
      await run();
      expect(jp5.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          depositAccountCode: '11-2107',
          shopReceivableType: 'DEVICE_RETURN',
          deviceReturnId: 'dr-1',
        }),
        prisma, // tx ที่ผู้เรียกส่งมา
      );
      expect(jp5.execute.mock.calls[0][0].collectedByShop).toBeUndefined();
      expect(jp5.execute.mock.calls[0][0].repossessionValue.toFixed(2)).toBe('6000.00');
    });

    it('ขาคู่ SHOP: Dr S11-2002 / Cr S21-1104 typed DEVICE_RETURN + deviceReturnId ที่ราคาประเมิน ในสมุด SHOP', async () => {
      arm();
      prisma.tradeInValuation = { findFirst: jest.fn().mockResolvedValue(null) };
      await run();
      const [je] = shopIntakeCalls();
      expect(je).toBeDefined();
      expect(je.companyId).toBe('company-shop');
      const lines = je.lines as Array<{ accountCode: string; dr: Prisma.Decimal; cr: Prisma.Decimal }>;
      expect(lines.map((l) => [l.accountCode, l.dr.toString(), l.cr.toString()])).toEqual([
        ['S11-2002', '6000', '0'],
        ['S21-1104', '0', '6000'],
      ]);
      const meta = je.metadata as Record<string, unknown>;
      expect(meta.shopReceivableType).toBe('DEVICE_RETURN');
      expect(meta.contractId).toBe('contract-1');
      expect(meta.deviceReturnId).toBe('dr-1');
      expect(meta.idempotencyKey).toBe('shop-repossession-intake:contract-1');
      expect(jp5.execute).toHaveBeenCalledTimes(1);
    });

    it('appraisal 0 → JP5 still posts, SHOP intake skipped — no zero-value stock entry', async () => {
      arm();
      prisma.tradeInValuation = { findFirst: jest.fn().mockResolvedValue(null) };
      await run({ appraisalPrice: 0 });
      expect(shopIntakeCalls()).toHaveLength(0);
      expect(jp5.execute).toHaveBeenCalledTimes(1);
    });

    it('ไม่เขียน audit SHOP_COLLECT_REPOSSESSION อีกต่อไป (แทนด้วย DEVICE_RETURN_CONFIRMED ที่ผู้เรียก + metadata บน JE)', async () => {
      arm();
      await run();
      const actions = prisma.auditLog.create.mock.calls.map((c: any[]) => c[0].data.action);
      expect(actions).toContain('REPOSSESSION');
      expect(actions).not.toContain('SHOP_COLLECT_REPOSSESSION');
    });

    it('issues CN inside the same tx as JP5, with source=REPOSSESSION, entryNo ของ JP5 และ actor ที่ส่งมา', async () => {
      arm();
      jp5.execute.mockResolvedValueOnce({ entryNo: 'JE-JP5-123' });
      const result = await run();
      expect(creditNoteService.issueForContract).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          source: 'REPOSSESSION',
          sourceJournalEntryNo: 'JE-JP5-123',
          actorUserId: 'user-1',
        }),
        prisma,
      );
      expect(result.creditNote).toEqual({ outcome: 'ISSUED', receiptId: 'r1' });
      // การส่งไลน์ CN เป็นหน้าที่ผู้เรียกหลัง commit — createInTx ห้ามยิงเอง
      expect(cnDeliveryServiceMock.deliver).not.toHaveBeenCalled();
    });

    it('marks BadDebtProvision rows REVERSED right after JP5 posts (Task 5, 2026-07-26)', async () => {
      arm();
      await run();
      expect(prisma.badDebtProvision.updateMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', contractId: 'contract-1', deletedAt: null },
        data: { status: 'REVERSED' },
      });
    });

    it('rejects a contract with no outstanding balance before JP5/CN (ผ่อนครบ = เครื่องเป็นของลูกค้า)', async () => {
      arm({
        status: 'TERMINATED',
        payments: [
          {
            id: 'pay-1',
            installmentNo: 1,
            status: 'PAID',
            amountDue: decimal(1000),
            amountPaid: decimal(1000),
            lateFee: decimal(0),
            lateFeeWaived: false,
          },
        ],
      });
      await expect(run()).rejects.toThrow(/ไม่มียอดค้างชำระ/);
      expect(jp5.execute).not.toHaveBeenCalled();
      expect(creditNoteService.issueForContract).not.toHaveBeenCalled();
      expect(prisma.repossession.create).not.toHaveBeenCalled();
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    describe('ราคาเดียว + ตารางรับซื้อเป็นตัวเทียบ (2026-09-05)', () => {
      const tableRow = (basePrice: number) => ({
        findFirst: jest.fn().mockResolvedValue({ basePrice: decimal(basePrice), note: null }),
      });

      it('requires a note when the appraisal deviates more than 15% from the valuation table', async () => {
        arm();
        prisma.tradeInValuation = tableRow(8000); // appraisal 6000 = −25%
        await expect(run({ returnReason: 'UNAFFORDABLE', notes: '   ' })).rejects.toThrow(/เกิน 15%/);
        expect(prisma.repossession.create).not.toHaveBeenCalled();
        expect(jp5.execute).not.toHaveBeenCalled();
      });

      it('stores the table price as the marketValue snapshot when a note explains the deviation', async () => {
        arm();
        prisma.tradeInValuation = tableRow(8000);
        await run({ notes: 'จอแตก กระจกหลังร้าว' });
        const data = prisma.repossession.create.mock.calls[0][0].data;
        expect(String(data.marketValue)).toBe('8000');
        expect(Number(data.profitLoss)).toBeCloseTo(6000 - Number(data.closingAmount), 2);
      });

      it('within ±15% needs no note; marketValue falls back to the appraisal when the model is not in the table', async () => {
        arm();
        prisma.tradeInValuation = { findFirst: jest.fn().mockResolvedValue(null) };
        await run();
        expect(String(prisma.repossession.create.mock.calls[0][0].data.marketValue)).toBe('6000');
      });
    });

    it('propagates when CN issuance throws (atomicity is the caller tx — no swallow)', async () => {
      arm();
      creditNoteService.issueForContract.mockRejectedValueOnce(new Error('CN fail'));
      await expect(run()).rejects.toThrow('CN fail');
    });

    it('propagates when JP5 throws (no fire-and-forget)', async () => {
      arm();
      jp5.execute.mockRejectedValueOnce(new Error('JE fail'));
      await expect(run()).rejects.toThrow('JE fail');
    });

    it('โหลด payments เฉพาะ deletedAt:null (เหมือน previewCalculation)', async () => {
      const allPaid = makeContract({ status: 'TERMINATED' }).payments.map((p) => ({
        ...p,
        status: 'PAID',
        amountPaid: p.amountDue,
      }));
      arm({ status: 'TERMINATED', payments: allPaid });
      await expect(run()).rejects.toThrow(/ไม่มียอดค้างชำระ/);
      expect(prisma.contract.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
          }),
        }),
      );
    });
  });
```

- [ ] **Step 3: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/repossessions/repossessions.service.spec.ts`
Expected: FAIL — `service.assertRepossessionPeriodsOpen is not a function` / `service.createInTx is not a function` / preview: `expected undefined to be 'DEVICE_RETURN'`

- [ ] **Step 4: แก้ `repossessions.service.ts` — imports**

(ก) บรรทัด 12 (origin/main) แทน
```ts
import { CreateRepossessionDto, UpdateRepossessionDto, REPOSSESSION_RETURN_REASONS } from './dto/create-repossession.dto';
```
ด้วย
```ts
import {
  UpdateRepossessionDto,
  REPOSSESSION_RETURN_REASONS,
  RepossessionReturnReason,
} from './dto/create-repossession.dto';
```

(ข) บรรทัด 13 แทน `import { ConditionGrade, RepossessionStatus, ProductStatus } from '@prisma/client';` ด้วย
```ts
import { ConditionGrade, RepossessionStatus, ProductStatus, Repossession } from '@prisma/client';
```

(ค) บรรทัด 26 แทน `import { shopCollectTypedBalance } from '../interco-settlement/interco-typed-balance';` ด้วย
```ts
import {
  shopCollectTypedBalance,
  deviceReturnFinanceBalance,
  // helper ของ Phase 1 — Σ deviceReturnAmount ของ item ใน batch POSTED ต่อสัญญา (same-type only)
  postedDeductionsByContract,
  DEVICE_RETURN_DEDUCTION_COLUMNS,
} from '../interco-settlement/interco-typed-balance';
```

(ง) ถัดจาก `export interface RepossessionEligibility { … }` เพิ่ม:

```ts
/**
 * ข้อมูลตั้งต้นของการยึด/รับคืนที่ผ่านการยืนยันแล้ว (2026-09-20) — มาจากใบรับเครื่องคืน
 * (DeviceReturnsService.confirm) ไม่ใช่ DTO สาธารณะ. company ids มาจาก assertRepossessionPeriodsOpen.
 */
export interface RepossessionCreateInput {
  contractId: string;
  /** วันรับเครื่องจริง (DeviceReturn.deviceReceivedAt) */
  repossessedDate: Date;
  /** วันลงบัญชี — JP5 entryDate + period guard (ต้องผ่าน assertRepossessionPeriodsOpen ก่อน) */
  paymentDate: Date;
  conditionGrade: string;
  /** ราคาประเมิน 2 ตำแหน่ง — คอลัมน์ Decimal(12,2) ของใบ แปลงเป็น number ได้ตรงตัว */
  appraisalPrice: number;
  repairCost?: number;
  notes?: string;
  returnReason?: RepossessionReturnReason;
  discountPct?: number;
  /** ผู้ตรวจสภาพ/ตีราคาที่สาขา (DeviceReturn.receivedById) */
  appraisedById: string;
  /** สาขาที่รับเครื่องจริง — ไปเป็น product.branchId (D7 รับข้ามสาขาได้) */
  receivingBranchId: string;
  deviceReturnId: string;
  financeCompanyId: string;
  shopCompanyId: string;
}

export interface RepossessionCreateResult {
  repossession: Repossession;
  outstandingBalance: Prisma.Decimal;
  totalPaid: Prisma.Decimal;
  creditNote?: { outcome: string; receiptId?: string };
}
```

- [ ] **Step 5: แก้ `findAll` — เพิ่ม `deviceReturnOutstanding`**

ถัดจากบล็อก `const outstandingByContract = new Map<string, Prisma.Decimal>( … );` (origin/main:212-219) เพิ่ม:

```ts
    // ค่าเครื่องคืน (11-2107 typed DEVICE_RETURN) ที่ยังรอหักในรอบจ่าย INTER-CO (2026-09-20) —
    // NET = typed gross − Σ deviceReturnAmount ของ item ใน batch POSTED ของสัญญานั้น (**same-type เท่านั้น**
    // — กติกาที่ Phase 1 ตัดสิน; ขาหักของ batch ไม่ stamp contractId จึงอ่านจาก item). สูตร/helper เดียวกับ
    // IntercoPendingService.getPendingDeviceReturns — ห้ามเขียนสูตรรวม deduction ใหม่ที่นี่
    const deviceReturnByContract = new Map<string, Prisma.Decimal>();
    if (contractIds.length) {
      const deductedByContract = await postedDeductionsByContract(
        this.prisma,
        contractIds,
        DEVICE_RETURN_DEDUCTION_COLUMNS,
      );
      for (const cid of contractIds) {
        const gross = await deviceReturnFinanceBalance(this.prisma, cid);
        const net = gross.minus(deductedByContract.get(cid) ?? 0);
        deviceReturnByContract.set(cid, net.gt(0) ? net : new Prisma.Decimal(0));
      }
    }
```

และใน `dataWithCn` map (origin/main:229-244) เพิ่มฟิลด์ถัดจาก `shopCollectOutstanding: (…).toFixed(2),`:

```ts
        deviceReturnOutstanding: (
          deviceReturnByContract.get(r.contract.id) ?? new Prisma.Decimal(0)
        ).toFixed(2),
```

- [ ] **Step 6: แก้ `previewCalculation`**

(ก) signature (origin/main:249-261) แทน options ด้วย:

```ts
  async previewCalculation(
    contractId: string,
    options: {
      appraisalPrice?: number;
      discountPct?: number;
      /** เกรดสภาพ A-D — ถ้าส่งมา preview จะค้นตารางรับซื้อ (TradeInValuation) ให้เป็นราคากลางแนะนำ */
      conditionGrade?: string;
      /**
       * โหมดยืนยันใบรับเครื่องคืน (2026-09-20): เกรด/ราคาประเมินอ่านจากใบ (DeviceReturn) — query
       * conditionGrade/appraisalPrice ถูกละเลย เพื่อให้ preview === ใบที่จะถูกยืนยัน; discountPct ยังมาจาก
       * query. ใบต้องเป็นของสัญญานี้และยังไม่ถูกลบ ไม่งั้น 404.
       */
      deviceReturnId?: string;
    },
    user?: RequestUser,
  ) {
```

(ข) ถัดจากบล็อก branch scope (`const scope = getBranchScope(user); if (user && !scope.all) { … }` origin/main:281-287) เพิ่ม:

```ts
    let conditionGrade = options.conditionGrade;
    let appraisalInput: Prisma.Decimal | null =
      options.appraisalPrice != null ? new Prisma.Decimal(options.appraisalPrice) : null;
    if (options.deviceReturnId) {
      const deviceReturn = await this.prisma.deviceReturn.findFirst({
        where: { id: options.deviceReturnId, contractId, deletedAt: null },
        select: { conditionGrade: true, appraisalPrice: true },
      });
      if (!deviceReturn) throw new NotFoundException('ไม่พบใบรับเครื่องคืนของสัญญานี้');
      conditionGrade = deviceReturn.conditionGrade;
      appraisalInput = deviceReturn.appraisalPrice;
    }
```

(ค) แทน (origin/main:366-380 หลัง Task 2)
```ts
    const marketValueSource: MarketValueSource =
      options.appraisalPrice != null ? 'APPRAISAL' : null;
    const marketValue = new Prisma.Decimal(options.appraisalPrice ?? 0);

    // ราคากลางแนะนำจากตารางรับซื้อมือสอง (ยี่ห้อ+รุ่น+ความจุ+เกรด) — ตารางเดียวกับ
    // หน้ารับซื้อ (TradeInValuationService.lookupValuation). ไม่พบ = ให้พนักงานกรอกเอง.
    // preview-only: ล้มเหลวต้องไม่ล้มทั้ง response (pattern เดียวกับ journalPreview)
    const valuation = options.conditionGrade
      ? await lookupTableBase(this.valuationService, contract.product, options.conditionGrade)
      : null;
```
ด้วย
```ts
    const marketValueSource: MarketValueSource = appraisalInput ? 'APPRAISAL' : null;
    const marketValue = appraisalInput ?? new Prisma.Decimal(0);

    // ราคากลางแนะนำจากตารางรับซื้อมือสอง (ยี่ห้อ+รุ่น+ความจุ+เกรด) — ตารางเดียวกับ
    // หน้ารับซื้อ (TradeInValuationService.lookupValuation). ไม่พบ = ให้พนักงานกรอกเอง.
    // preview-only: ล้มเหลวต้องไม่ล้มทั้ง response (pattern เดียวกับ journalPreview)
    const valuation = conditionGrade
      ? await lookupTableBase(this.valuationService, contract.product, conditionGrade)
      : null;
```

(ง) แทนบล็อก JP5 preview (origin/main:392-417 — ตั้งแต่คอมเมนต์ `// JOURNAL AUTO preview (owner 2026-07-20)` ถึง `}` ปิด `if (outstandingForJe.greaterThan(0))`) ด้วย:

```ts
    // JOURNAL AUTO preview (owner 2026-07-20) — dry-run JP5 ผ่าน buildJe ตัวเดียวกับตอน post จริง
    // ใน createInTx จึงตรงกันเสมอ. ใบรับเครื่องคืน (2026-09-20): ขา Dr = 11-2107 ลูกหนี้-หน้าร้าน
    // typed DEVICE_RETURN เสมอ (ไม่มีขาเงินสดวันรับเครื่อง — ค่าเครื่องหักในรอบจ่าย INTER-CO).
    // Preview fail ต้องไม่ล้มทั้ง response.
    let journalPreview: RepossessionJePreview | null = null;
    if (outstandingForJe.greaterThan(0)) {
      try {
        journalPreview = await this.repossessionJP5Template.previewJe({
          contractId,
          depositAccountCode: '11-2107',
          repossessionValue: marketValue,
          shopReceivableType: 'DEVICE_RETURN',
          deviceReturnId: options.deviceReturnId,
          customerRefund: customerRefund.gt(0) ? customerRefund : undefined,
          // ถังพักงวดสุดท้ายที่ยอดปิดดูดซับจริง → Dr 21-1103 (คำสั่งเจ้าของ
          // 2026-08-16 §จุดหัก 3). ต้องส่งทั้ง preview และ createInTx ไม่งั้น
          // preview ≠ posted
          parkRelief: parkReliefPreview.gt(0) ? parkReliefPreview : undefined,
        });
      } catch (err) {
        this.logger.warn(
          `JP5 preview failed for contract ${contractId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
```

- [ ] **Step 7: แทนที่ `create()` ทั้งก้อนด้วย `assertRepossessionPeriodsOpen` + `createInTx`**

ลบตั้งแต่ jsdoc `/** Create repossession record and update contract/product statuses */` (origin/main:493) ถึง `return result; }` ของ `create` (origin/main:926) แล้วใส่:

```ts
  /**
   * ด่านนอก tx ของการยึด/รับคืน (2026-09-20 — เดิมอยู่ต้น create()): วันลงบัญชีต้องไม่เป็นอนาคต
   * (วันปฏิทินไทย), ต้องอยู่เดือนปัจจุบัน (ใบลดหนี้ออกเดือนปัจจุบันเสมอ — คำสั่งเจ้าของ 2026-08-08
   * ข้อ 3 — JE ต้องอยู่งวดภาษีเดียวกัน), และงวดบัญชีของ **ทั้งสองบริษัท** ต้องเปิด (JP5 ลงสมุด
   * FINANCE, ใบรับเข้าสต็อกลงสมุด SHOP). บริษัทไม่ครบ = fail LOUD (validatePeriodOpen เงียบเมื่อไม่มี
   * companyId ซึ่งจะปิด guard ที่ด่านนี้มีไว้). ผู้เรียก: DeviceReturnsService.confirm ก่อนเปิด tx.
   */
  async assertRepossessionPeriodsOpen(
    paymentDate: Date,
  ): Promise<{ financeCompanyId: string; shopCompanyId: string }> {
    if (isFutureBkkDay(paymentDate)) {
      throw new BadRequestException('วันที่รับเงินต้องไม่เป็นวันในอนาคต');
    }
    if (bkkYearMonth(paymentDate) !== bkkYearMonth(new Date())) {
      throw new BadRequestException(
        'วันที่รับเงินย้อนหลังได้เฉพาะภายในเดือนปัจจุบัน (ใบลดหนี้ต้องอยู่งวดภาษีเดียวกับ JE)',
      );
    }
    const financeCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    });
    if (!financeCompany) {
      throw new InternalServerErrorException('FINANCE company not configured');
    }
    await validatePeriodOpen(this.prisma, paymentDate, financeCompany.id);
    const shopCompany = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    });
    if (!shopCompany) {
      throw new InternalServerErrorException('SHOP company not configured');
    }
    await validatePeriodOpen(this.prisma, paymentDate, shopCompany.id);
    return { financeCompanyId: financeCompany.id, shopCompanyId: shopCompany.id };
  }

  /**
   * ยึด/รับเครื่องคืน — ตรรกะใน tx ของ create() เดิม (2026-09-20 ใบรับเครื่องคืน). ผู้เรียก
   * (DeviceReturnsService.confirm) เปิด $transaction เอง, เรียก assertRepossessionPeriodsOpen ก่อน,
   * แปลง P2002 (Repossession.productId @unique แพ้ race) เป็น 409 เอง (tx ของมัน abort แล้ว —
   * re-query ที่นี่ไม่ได้), และส่งไลน์ใบลดหนี้ **หลัง commit** (cnDeliveryService.deliver) เอง.
   *
   * โพสต์ใน tx: แถว Repossession → สัญญา CLOSED_BAD_DEBT → JP5 (ขา Dr 11-2107 typed DEVICE_RETURN
   * เสมอ — ไม่มีขาเงินสด/โหมดโอนสดอีกต่อไป) → ขาคู่ SHOP (Dr S11-2002 / Cr S21-1104 DEVICE_RETURN)
   * → ปลดถังพัก → flip ECL rows → ใบลดหนี้ → เครื่อง REPOSSESSED + กรรมสิทธิ์ SHOP + มือสอง +
   * branchId = สาขาที่รับ → audit REPOSSESSION (tx.auditLog.create — atomic กับสถานะ; หลุด Merkle
   * chain โดยตั้งใจเหมือนเดิม).
   */
  async createInTx(
    tx: Prisma.TransactionClient,
    input: RepossessionCreateInput,
    actorUserId: string,
  ): Promise<RepossessionCreateResult> {
    if (
      input.returnReason != null &&
      !Object.prototype.hasOwnProperty.call(REPOSSESSION_RETURN_REASONS, input.returnReason)
    ) {
      throw new BadRequestException('กรุณาเลือกเหตุผลคืนเครื่องที่ถูกต้อง');
    }
    if (input.returnReason === 'OTHER' && !input.notes?.trim()) {
      throw new BadRequestException('กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง');
    }
    const validGrades = ['A', 'B', 'C', 'D'];
    if (!validGrades.includes(input.conditionGrade)) {
      throw new BadRequestException(`เกรดสภาพต้องเป็น ${validGrades.join(', ')}`);
    }

    const contract = await tx.contract.findUnique({
      where: { id: input.contractId },
      include: {
        product: true,
        // mirror previewCalculation — แถว soft-deleted ห้ามเข้าสูตรยอดปิด/JP5 gate
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
      },
    });

    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    // CPA Manual Termination Policy (ปพพ.386 + termination_policy.docx):
    //   ยึดเครื่อง (JP5) ต้องมีหนังสือบอกเลิกสัญญาดิสแพตช์แล้ว = status='TERMINATED'
    //   ใบรับเครื่องคืนแบบคืนเอง (VOLUNTARY) ถูก flip เป็น TERMINATED ตั้งแต่ตอนสาขาบันทึก (D4)
    //   จึงผ่านด่านนี้โดยโครงสร้าง. DEFAULT/OVERDUE คงไว้เพื่อ legacy compat (strict mode ปิด)
    if (!['TERMINATED', 'DEFAULT', 'OVERDUE'].includes(contract.status)) {
      throw new BadRequestException(
        'สัญญานี้ไม่อยู่ในสถานะที่สามารถยึดคืนได้ — ต้องเป็น TERMINATED (ส่งหนังสือบอกเลิกแล้ว) หรือ DEFAULT/OVERDUE',
      );
    }
    const strictTerminationConfig = await tx.systemConfig.findUnique({
      where: { key: 'jp5_require_terminated_status' },
    });
    const requireTerminated = strictTerminationConfig?.value === 'true';
    if (requireTerminated && contract.status !== 'TERMINATED') {
      throw new BadRequestException(
        'JP5 strict mode: ต้องส่งหนังสือบอกเลิกสัญญา (CONTRACT_TERMINATION_60D) ก่อนยึดเครื่อง — ' +
          'เมื่อสัญญาเป็น TERMINATED แล้ว ให้กดยึดเครื่องจากหน้ายึดคืน (/repossessions) รายการ "รอยึดเครื่อง"',
      );
    }

    if (contract.product.status === 'REPOSSESSED') {
      throw new BadRequestException('สินค้านี้ถูกยึดคืนแล้ว');
    }
    // Repossession.productId @unique — loop ยึด→ขายต่อ→ผ่อนใหม่→ยึดซ้ำ ชนด่านนี้ก่อน JP5 (ไม่ใช่ P2002 กลางทาง)
    const priorRepossession = await tx.repossession.findFirst({
      where: { productId: contract.productId, deletedAt: null },
      select: { id: true },
    });
    if (priorRepossession) {
      throw new ConflictException(RE_REPOSSESSION_MSG);
    }

    if (!contract.totalMonths || contract.totalMonths <= 0) {
      throw new BadRequestException('ข้อมูลสัญญาผิดพลาด: จำนวนงวดต้องมากกว่า 0');
    }

    // ยอดค้าง (รวมค่าปรับ) — ใช้เฉพาะ gate JP5 + audit trail/return ไม่ใช่ฐานคำนวณยอดปิด
    let outstandingBalance = new Prisma.Decimal(0);
    let totalPaid = new Prisma.Decimal(0);
    let remainingMonths = 0;
    for (const p of contract.payments) {
      if (p.status !== 'PAID') {
        const lateFee = p.lateFeeWaived ? new Prisma.Decimal(0) : d(p.lateFee);
        outstandingBalance = dAdd(
          outstandingBalance,
          dSub(dAdd(d(p.amountDue), lateFee), d(p.amountPaid)),
        );
        remainingMonths += 1;
      }
      totalPaid = dAdd(totalPaid, d(p.amountPaid));
    }

    // review 2026-09-05: ไม่มียอดค้าง = ผ่อนครบ เครื่องเป็นของลูกค้า (ปพพ. ม.572) — ยึดไม่ได้
    // และห้ามปล่อยให้เครื่องไหลเข้าสต็อก SHOP โดยไม่มีใบรับเข้า. preview.eligibility ใช้กติกาเดียวกัน
    if (outstandingBalance.lte(0)) {
      throw new BadRequestException(ZERO_OUTSTANDING_MSG);
    }

    // ยอดปิดสัญญา = สูตรเดียวกับปิดสัญญาก่อนกำหนด (computePayoffQuote) — owner 2026-07-20
    const quote = computePayoffQuote({
      monthlyPayment: contract.monthlyPayment,
      remainingMonths,
      totalMonths: contract.totalMonths,
      creditBalance: contract.creditBalance,
      rescheduleAdvanceBalance: contract.rescheduleAdvanceBalance,
      vatPct: contract.vatPct,
      sellingPrice: contract.sellingPrice,
      downPayment: contract.downPayment,
      storeCommission: contract.storeCommission,
      discountPctInput: input.discountPct,
      payments: contract.payments,
    });
    const financeCost = new Prisma.Decimal(quote.financeCost);
    const remainingCost = new Prisma.Decimal(quote.remainingCost);
    const discountPct = quote.discountPercent;
    const discountAmount = new Prisma.Decimal(quote.discountAmount);
    const closingAmount = new Prisma.Decimal(quote.totalPayoff);
    // ราคาเดียว (คำตัดสินเจ้าของ 2026-09-05): ราคาประเมิน = ราคาที่หน้าร้านรับเครื่อง = ยอดที่ลงบัญชี.
    // ตารางรับซื้อเป็นตัวเทียบ: snapshot ในคอลัมน์ marketValue (ไม่มีในตาราง = ราคาประเมิน)
    // และบังคับเหตุผลเมื่อต่างจากตารางเกิน ±15% (ใบรับเครื่องคืนตรวจชั้นแรกตอนสาขาบันทึกด้วยกติกาเดียวกัน)
    const appraisal = d(input.appraisalPrice);
    const table = await lookupTableBase(this.valuationService, contract.product, input.conditionGrade);
    const tableBase =
      table?.found && table.suggestedPrice != null ? d(table.suggestedPrice) : null;
    if (tableBase && tableBase.gt(0)) {
      const deviation = appraisal.sub(tableBase).div(tableBase).abs();
      if (deviation.gt(RepossessionsService.TABLE_DEVIATION_LIMIT) && !input.notes?.trim()) {
        throw new BadRequestException(
          `ราคาประเมิน ${appraisal.toFixed(2)} ฿ ต่างจากตารางรับซื้อ (เกรด ${input.conditionGrade}: ${tableBase.toFixed(2)} ฿) ` +
            `${deviation.mul(100).toDecimalPlaces(0)}% เกิน 15% — กรุณาระบุเหตุผลในหมายเหตุ`,
        );
      }
    }
    const marketValue = tableBase ?? appraisal;
    const customerRefund = new Prisma.Decimal(0);
    const profitLoss = TWO_DP(appraisal.sub(closingAmount));
    // ถังพักงวดสุดท้าย (คำสั่งเจ้าของ 2026-08-16 §จุดหัก 3) — ยอดที่ยอดปิดดูดซับจริง clamp ด้วยยอดในถัง
    const parkRelief = Prisma.Decimal.max(
      0,
      Prisma.Decimal.min(
        d(quote.rescheduleAdvanceApplied),
        d(contract.rescheduleAdvanceBalance ?? 0),
      ),
    );

    const repossession = await tx.repossession.create({
      data: {
        contractId: input.contractId,
        productId: contract.productId,
        repossessedDate: input.repossessedDate,
        conditionGrade: input.conditionGrade as ConditionGrade,
        appraisalPrice: input.appraisalPrice,
        appraisedById: input.appraisedById,
        repairCost: input.repairCost || 0,
        notes: input.returnReason
          ? [
              `เหตุผลคืนเครื่อง: ${REPOSSESSION_RETURN_REASONS[input.returnReason]}`,
              input.notes?.trim(),
            ]
              .filter(Boolean)
              .join('\n')
          : input.notes,
        status: 'REPOSSESSED',
        marketValue,
        remainingMonths,
        financeCost,
        remainingCost,
        discountPct,
        discountAmount,
        closingAmount,
        customerRefundEnabled: false,
        customerRefund,
        profitLoss,
      },
    });

    await tx.contract.update({
      where: { id: input.contractId },
      data: { status: 'CLOSED_BAD_DEBT' },
    });

    // JP5 ใน tx เดียวกับสถานะ (ปพพ.ม.392 — เลิกสัญญาต้องกลับสู่ฐานะเดิม; JE fail = rollback ทั้งชุด)
    let creditNote: { outcome: string; receiptId?: string } | undefined;
    if (outstandingBalance.greaterThan(0)) {
      const repoValue = new Decimal(String(input.appraisalPrice));
      // ใบรับเครื่องคืน (2026-09-20): ขา Dr เป็นลูกหนี้-หน้าร้าน 11-2107 typed DEVICE_RETURN เสมอ —
      // SHOP ค้างจ่ายค่าเครื่อง แล้วหักจากยอดโอนในรอบจ่าย INTER-CO (IntercoPendingService.
      // getPendingDeviceReturns) หรือรับเงินสดผ่าน settleDeductionCash('DEVICE_RETURN').
      // ไม่มีขาเงินสด/โหมดโอนสดวันยึดอีกต่อไป (ยอดธนาคารในสมุดเคยเกินจริงเท่าราคาประเมิน).
      const jp5Result = await this.repossessionJP5Template.execute(
        {
          contractId: input.contractId,
          depositAccountCode: '11-2107',
          repossessionValue: repoValue,
          shopReceivableType: 'DEVICE_RETURN',
          deviceReturnId: input.deviceReturnId,
          postedAt: input.paymentDate,
          customerRefund: customerRefund.gt(0) ? customerRefund : undefined,
          parkRelief: parkRelief.gt(0) ? parkRelief : undefined,
        },
        tx,
      );

      // ขาคู่ฝั่ง SHOP (คำตัดสินเจ้าของ 2026-09-05): SHOP รับเครื่องเข้าสต็อกมือสองที่ราคาประเมิน คู่กับ
      // ที่ FINANCE ลง Dr — ค้างจ่าย Cr S21-1104 typed DEVICE_RETURN เสมอ (2026-09-20). tx เดียวกับ JP5.
      // ราคาประเมิน 0 → SHOP รับเครื่องเข้าโดยไม่มีต้นทุน ไม่มีใบรับเข้า (ไม่มีบรรทัดศูนย์บาท)
      if (repoValue.gt(0)) {
        await this.shopLegs.postRepossessionIntake(
          {
            contractId: input.contractId,
            contractNumber: contract.contractNumber,
            productId: contract.productId,
            appraisal: repoValue,
            shopCompanyId: input.shopCompanyId,
            deviceReturnId: input.deviceReturnId,
            postedAt: input.paymentDate,
          },
          tx,
        );
      }

      // ปลดถังพักให้ตรงกับขา Dr 21-1103 ที่ JP5 ลงจริง (template clamp ด้วย GL — อ่านค่าที่ลงจริงกลับมา)
      const postedParkRelief = d(jp5Result.parkRelief);
      if (postedParkRelief.gt(0)) {
        await tx.contract.update({
          where: { id: input.contractId },
          data: { rescheduleAdvanceBalance: { decrement: postedParkRelief } },
        });
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'RESCHEDULE_ADVANCE_CONSUMED',
            entity: 'contract',
            entityId: input.contractId,
            newValue: {
              parkRelief: postedParkRelief.toFixed(2),
              beforeParkBalance: d(contract.rescheduleAdvanceBalance ?? 0).toFixed(2),
              afterParkBalance: dSub(
                d(contract.rescheduleAdvanceBalance ?? 0),
                postedParkRelief,
              ).toFixed(2),
              repossessionId: repossession.id,
              source: 'REPOSSESSION_PARK_RELIEF',
            },
          },
        });
      }

      // Task 5 (2026-07-26) — JP5 ปล่อย 11-2102 ที่เหลือคืน 51-1103 แล้ว; flip แถว DB ให้ตรง
      await tx.badDebtProvision.updateMany({
        where: { status: 'ACTIVE', contractId: input.contractId, deletedAt: null },
        data: { status: 'REVERSED' },
      });

      // ใบลดหนี้ (ม.82/5) ใน tx เดียวกับ JE — ส่งไลน์เป็นหน้าที่ผู้เรียกหลัง commit เท่านั้น
      const cnResult = await this.creditNoteDocumentService.issueForContract(
        {
          contractId: input.contractId,
          source: 'REPOSSESSION',
          sourceJournalEntryNo: jp5Result.entryNo,
          actorUserId,
        },
        tx,
      );
      creditNote = {
        outcome: cnResult.outcome,
        receiptId: cnResult.outcome === 'ISSUED' ? cnResult.receiptId : undefined,
      };
    }

    // เครื่อง: REPOSSESSED + กรรมสิทธิ์กลับ SHOP + มือถือกลายเป็นมือสอง (S11-2002) +
    // ที่อยู่จริง = สาขาที่รับเครื่อง (D7 รับข้ามสาขาได้ — 2026-09-20)
    await tx.product.update({
      where: { id: contract.productId },
      data: {
        status: 'REPOSSESSED',
        ownedByCompanyId: input.shopCompanyId,
        branchId: input.receivingBranchId,
        ...(contract.product.category === 'PHONE_NEW'
          ? { category: 'PHONE_USED' as const }
          : {}),
      },
    });

    // audit REPOSSESSION (Decimal → string 2dp เพื่อให้ diff ได้)
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'REPOSSESSION',
        entity: 'repossession',
        entityId: repossession.id,
        newValue: {
          contractId: input.contractId,
          contractNumber: contract.contractNumber,
          productId: contract.productId,
          conditionGrade: input.conditionGrade,
          ...(input.returnReason
            ? {
                returnReason: input.returnReason,
                returnReasonLabel: REPOSSESSION_RETURN_REASONS[input.returnReason],
              }
            : {}),
          appraisalPrice: input.appraisalPrice,
          outstandingBalance: outstandingBalance.toFixed(2),
          totalPaid: totalPaid.toFixed(2),
          deviceReturnId: input.deviceReturnId,
          receivingBranchId: input.receivingBranchId,
        },
        ipAddress: '',
      },
    });

    this.logger.log(
      `Repossession created for contract ${contract.contractNumber} (device return ${input.deviceReturnId})`,
    );

    return { repossession, outstandingBalance, totalPaid, creditNote };
  }
```

- [ ] **Step 8: แก้ controller + DTO**

(ก) `repossessions.controller.ts` บรรทัด 4 → `import { UpdateRepossessionDto } from './dto/create-repossession.dto';`

(ข) แทนที่ method `previewCalculation` (origin/main:55-79) ด้วย:

```ts
  @Get('preview/:contractId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  previewCalculation(
    @Param('contractId') contractId: string,
    @CurrentUser() user: RequestUser,
    @Query('appraisalPrice') appraisalPrice?: string,
    @Query('discountPct') discountPct?: string,
    @Query('conditionGrade') conditionGrade?: string,
    @Query('deviceReturnId') deviceReturnId?: string,
  ) {
    return this.repossessionsService.previewCalculation(
      contractId,
      {
        appraisalPrice: appraisalPrice ? parseFloat(appraisalPrice) : undefined,
        discountPct: discountPct ? parseFloat(discountPct) : undefined,
        conditionGrade: conditionGrade || undefined,
        deviceReturnId: deviceReturnId || undefined,
      },
      user,
    );
  }
```

(ค) ลบ method `create` ทั้งก้อน (origin/main:86-93 — `@Post() @Roles('OWNER') create(...)`). ทางเข้าเดียวของการยึด/รับคืนคือ `POST /device-returns` → `POST /device-returns/:id/confirm` (Task 9).

(ง) `dto/create-repossession.dto.ts` — ลบ class `CreateRepossessionDto` ทั้งก้อน (origin/main:12-108) และแก้ import บรรทัด 1-2 เป็น:

```ts
import { IsString, IsNumber, IsOptional, IsIn, Min } from 'class-validator';
```
(ลบ `import { KBANK_ACCOUNT_CODE } …` เพราะไม่มีผู้ใช้แล้ว). คงไว้: `REPOSSESSION_RETURN_REASONS`, `RepossessionReturnReason`, `UpdateRepossessionDto`.

- [ ] **Step 9: product-lifecycle integration spec — เรียก `createInTx` แทน `create()` (interim; Task 9 เปลี่ยนเป็นเส้นทาง DeviceReturnsService)**

ใน `apps/api/src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts`:

(ก) เพิ่ม helper ถัดจาก `const OWNER_USER = () => …` (origin/main:326):

```ts
/**
 * interim (Task 4 ของแผนใบรับเครื่องคืน): create() ถูกลบ — ยึดผ่าน createInTx ใต้ tx ของเทสเอง
 * พร้อมใบรับเครื่องคืน synthetic. Task 9 แทนด้วย DeviceReturnsService.create+confirm (เส้นทางจริง).
 */
async function repossessViaCreateInTx(contractId: string, productId: string, customerId: string, appraisalPrice: number) {
  const { financeCompanyId, shopCompanyId } =
    await repossessionsService.assertRepossessionPeriodsOpen(new Date());
  const dr = await prisma.deviceReturn.create({
    data: {
      docNumber: `DR-LIFECYCLE-${RUN}-${Date.now() % 100000}`,
      contractId,
      productId,
      customerId,
      receivingBranchId: branchId,
      receivedById: adminId,
      returnKind: 'REPOSSESSION',
      returnReason: 'AFTER_TERMINATION',
      deviceReceivedAt: new Date(),
      conditionGrade: 'B',
      appraisalPrice: dec(String(appraisalPrice)),
    },
  });
  return prisma.$transaction((tx) =>
    repossessionsService.createInTx(
      tx,
      {
        contractId,
        repossessedDate: new Date(),
        paymentDate: new Date(),
        conditionGrade: 'B',
        appraisalPrice,
        appraisedById: adminId,
        receivingBranchId: branchId,
        deviceReturnId: dr.id,
        financeCompanyId,
        shopCompanyId,
      },
      adminId,
    ),
  );
}
```

(ข) เคส E1 (origin/main:666-674) แทน
```ts
      const repossession = await repossessionsService.create(
        {
          contractId: contract.id,
          repossessedDate: new Date().toISOString(),
          conditionGrade: 'B',
          appraisalPrice: 7000,
        } as never,
        adminId,
      );
```
ด้วย
```ts
      const { repossession } = await repossessViaCreateInTx(contract.id, product.id, customer.id, 7000);
```

(ค) เคส E1 assertion ใบรับเข้าสต็อก (origin/main:695-716) — เปลี่ยนคอมเมนต์และบรรทัดที่คาด `S11-1202`:
```ts
      // ขาคู่ SHOP ตอนยึด: กรรมสิทธิ์กลับ SHOP + มือถือกลายเป็นมือสอง + ใบรับเข้าสต็อก
      // (2026-09-20: ค้างจ่าย FINANCE เสมอ → Dr S11-2002 / Cr S21-1104 typed DEVICE_RETURN)
```
และ
```ts
      ).toEqual([
        ['S11-2002', '7000.00', '0.00'],
        ['S21-1104', '0.00', '7000.00'],
      ]);
      expect((intake!.metadata as Record<string, unknown>).shopReceivableType).toBe('DEVICE_RETURN');
```

(ง) เคส E3 (origin/main:780-791) แทน `repossessionsService.create({…} as never, adminId)` ด้วย `repossessViaCreateInTx(contract.id, product.id, customer.id, 7000)` (ใน `await expect(...).rejects.toThrow(/ไม่มียอดค้างชำระ/)` เดิม).

(จ) `afterAll` — เพิ่มบรรทัดแรกสุด (ก่อน `await prisma.payment.deleteMany(…)`):
```ts
    await prisma.deviceReturn.deleteMany({ where: { contractId: { in: createdContractIds } } });
```

- [ ] **Step 10: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/repossessions/repossessions.service.spec.ts`
Expected: PASS (ทุก describe รวม `assertRepossessionPeriodsOpen` 6 + `createInTx` 23)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts; cd ../..`
Expected: PASS (เคส E1 เห็น `S21-1104` + stamp DEVICE_RETURN, E3 ปฏิเสธยอดค้าง 0)

- [ ] **Step 11: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors (ไม่มีผู้เรียก `create()`/`CreateRepossessionDto` เหลือใต้ `src/` — ยืนยันด้วย `grep -rn "CreateRepossessionDto\|repossessionsService.create(" apps/api/src` ต้องว่าง). **Do NOT commit** (see Global Constraints).

---

### Task 5: `DeviceReturnNumberService` (`DR-YYYYMMDD-NNNN`) + DTO 4 ไฟล์

**Files:**
- Create: `apps/api/src/modules/device-returns/device-return-number.service.ts`
- Test: `apps/api/src/modules/device-returns/device-return-number.service.spec.ts`
- Create: `apps/api/src/modules/device-returns/dto/create-device-return.dto.ts`, `dto/confirm-device-return.dto.ts`, `dto/reject-device-return.dto.ts`, `dto/preview-device-return.dto.ts`

**Interfaces:**
- Consumes: pattern `apps/api/src/modules/interco-settlement/interco-batch-number.service.ts` (copy ทั้งไฟล์แล้วสลับ model/prefix/lock key); `REPOSSESSION_RETURN_REASONS`/`RepossessionReturnReason` จาก `repossessions/dto/create-repossession.dto.ts`
- Produces: `DeviceReturnNumberService.next(tx: Prisma.TransactionClient | PrismaService, issueDate?: Date): Promise<string>`; `CreateDeviceReturnDto { contractId; deviceReceivedAt; conditionGrade; appraisalPrice; repairCost?; returnReason?; notes?; receivingBranchId? }`; `ConfirmDeviceReturnDto { paymentDate?; discountPct? }`; `RejectDeviceReturnDto { reason }`; `PreviewDeviceReturnQueryDto { contractId; conditionGrade?; appraisalPrice? }`; `CONDITION_GRADES = ['A','B','C','D'] as const`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/api/src/modules/device-returns/device-return-number.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { DeviceReturnNumberService } from './device-return-number.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DeviceReturnNumberService', () => {
  let service: DeviceReturnNumberService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      deviceReturn: { findFirst: jest.fn() },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [DeviceReturnNumberService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(DeviceReturnNumberService);
  });

  it('generates first doc number for the day (DR-YYYYMMDD-0001)', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue(null);
    // 2026-09-20T05:30:00Z = 2026-09-20 12:30 BKK → 20260920
    expect(await service.next(prisma, new Date('2026-09-20T05:30:00Z'))).toBe('DR-20260920-0001');
  });

  it('increments sequence within the same BKK day', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue({ docNumber: 'DR-20260920-0007' });
    expect(await service.next(prisma, new Date('2026-09-20T05:30:00Z'))).toBe('DR-20260920-0008');
  });

  it('BKK-day rollover boundary: 16:59:59Z stays on the earlier day, 17:00:00Z rolls to the next', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue(null);
    expect(await service.next(prisma, new Date('2026-09-20T16:59:59Z'))).toBe('DR-20260920-0001');
    expect(await service.next(prisma, new Date('2026-09-20T17:00:00Z'))).toBe('DR-20260921-0001');
  });

  it('acquires a BKK-day advisory lock before reading the sequence and queries by day prefix desc', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue({ docNumber: 'DR-20260920-0099' });
    expect(await service.next(prisma, new Date('2026-09-20T05:30:00Z'))).toBe('DR-20260920-0100');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
    );
    const findArgs = prisma.deviceReturn.findFirst.mock.calls[0][0];
    expect(findArgs.where.docNumber.startsWith).toBe('DR-20260920-');
    expect(findArgs.orderBy.docNumber).toBe('desc');
  });

  it('defaults to `new Date()` when no issueDate is passed', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue(null);
    expect(await service.next(prisma)).toMatch(/^DR-\d{8}-0001$/);
  });
});
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-return-number.service.spec.ts`
Expected: FAIL — `Cannot find module './device-return-number.service'`

- [ ] **Step 3: เขียน number service**

สร้าง `apps/api/src/modules/device-returns/device-return-number.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * เลขที่ใบรับเครื่องคืน `DR-YYYYMMDD-NNNN` — copy ของ `IntercoBatchNumberService`
 * (advisory lock ต่อวัน BKK + max-via-findFirst-desc; ไม่ใช้ count() เพราะแถว soft-deleted
 * ยังถือเลขผ่าน unique). ไม่ใช้ `DocNumberService` ของ expense (ผูก enum DocumentType ใน Prisma).
 * spec 2026-09-20 §4.1.
 */
@Injectable()
export class DeviceReturnNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async next(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date = new Date(),
  ): Promise<string> {
    const { yyyymmdd } = this.getBkkDayBounds(issueDate);
    const lockKey = this.hashLockKey(`device-return:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const lastDoc = await tx.deviceReturn.findFirst({
      where: { docNumber: { startsWith: `DR-${yyyymmdd}-` } },
      orderBy: { docNumber: 'desc' },
      select: { docNumber: true },
    });

    const lastSeq = lastDoc ? parseInt(lastDoc.docNumber.split('-')[2], 10) || 0 : 0;
    const seq = String(lastSeq + 1).padStart(4, '0');
    return `DR-${yyyymmdd}-${seq}`;
  }

  /** BKK = UTC+7 ไม่มี DST — วิธีเดียวกับ other-income DocNumberService / IntercoBatchNumberService */
  private getBkkDayBounds(date: Date): { start: Date; end: Date; yyyymmdd: string } {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    const yyyymmdd = `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const start = new Date(Date.UTC(y, m - 1, d) - bkkOffsetMs);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end, yyyymmdd };
  }

  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
```

- [ ] **Step 4: เขียน DTO 4 ไฟล์**

`apps/api/src/modules/device-returns/dto/create-device-return.dto.ts`:

```ts
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  REPOSSESSION_RETURN_REASONS,
  RepossessionReturnReason,
} from '../../repossessions/dto/create-repossession.dto';

export const CONDITION_GRADES = ['A', 'B', 'C', 'D'] as const;
export type ConditionGradeCode = (typeof CONDITION_GRADES)[number];

/** POST /device-returns — spec 2026-09-20 §5.1 (ประเภทคืน/ยึด ระบบ derive จากสถานะสัญญา ไม่รับจาก client) */
export class CreateDeviceReturnDto {
  @IsUUID(undefined, { message: 'กรุณาระบุสัญญา' })
  contractId: string;

  /** วันรับเครื่องจริง (ไม่เป็นอนาคตตามปฏิทินไทย — service ตรวจ) */
  @IsDateString({}, { message: 'กรุณาระบุวันที่รับเครื่อง' })
  deviceReceivedAt: string;

  @IsIn(CONDITION_GRADES, { message: 'เกรดสภาพต้องเป็น A, B, C, D' })
  conditionGrade: ConditionGradeCode;

  /** ราคาประเมิน = ราคาที่ SHOP รับเครื่องไป (ราคาเดียว 2026-09-05) — service บังคับ > 0 */
  @IsNumber({}, { message: 'กรุณาระบุราคาประเมิน' })
  @Min(0, { message: 'ราคาประเมินต้องไม่ติดลบ' })
  appraisalPrice: number;

  @IsOptional()
  @IsNumber({}, { message: 'ค่าซ่อมต้องเป็นตัวเลข' })
  @Min(0, { message: 'ค่าซ่อมต้องไม่ติดลบ' })
  repairCost?: number;

  /**
   * key ของ REPOSSESSION_RETURN_REASONS — VOLUNTARY ต้องส่ง (UNAFFORDABLE / NO_LONGER_NEEDED / OTHER);
   * สัญญา TERMINATED ไม่ส่ง = ระบบตั้ง AFTER_TERMINATION ให้ (spec §5.1 ข้อ 2)
   */
  @IsOptional()
  @IsIn(Object.keys(REPOSSESSION_RETURN_REASONS), { message: 'กรุณาเลือกเหตุผลคืนเครื่องที่ถูกต้อง' })
  returnReason?: RepossessionReturnReason;

  /** บังคับเมื่อ returnReason = OTHER หรือราคาต่างจากตารางเกิน 15% (service ตรวจ) */
  @IsOptional()
  @IsString({ message: 'หมายเหตุต้องเป็นข้อความ' })
  @MaxLength(1000, { message: 'หมายเหตุยาวได้ไม่เกิน 1000 ตัวอักษร' })
  notes?: string;

  /** OWNER เท่านั้น (ไม่มีสาขาสังกัด) — BM/SALES ใช้ user.branchId เสมอ ค่านี้ถูกละเลย */
  @IsOptional()
  @IsUUID(undefined, { message: 'สาขาที่รับเครื่องไม่ถูกต้อง' })
  receivingBranchId?: string;
}
```

`apps/api/src/modules/device-returns/dto/confirm-device-return.dto.ts`:

```ts
import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** POST /device-returns/:id/confirm — spec 2026-09-20 §5.2 */
export class ConfirmDeviceReturnDto {
  /** วันลงบัญชี (JP5 entryDate) — ไม่ส่ง = วันนี้; ต้องเดือนปัจจุบัน BKK (assertRepossessionPeriodsOpen) */
  @IsOptional()
  @IsDateString({}, { message: 'วันที่ลงบัญชีไม่ถูกต้อง' })
  paymentDate?: string;

  /** ส่วนลดยอดปิด % — ไม่ส่ง = 50 (computePayoffQuote); มีผลเฉพาะตัวเลขบนแถวยึด ไม่ลง JE */
  @IsOptional()
  @IsNumber({}, { message: 'ส่วนลดต้องเป็นตัวเลข' })
  @Min(0, { message: 'ส่วนลดต้องไม่ติดลบ' })
  @Max(100, { message: 'ส่วนลดต้องไม่เกิน 100%' })
  discountPct?: number;
}
```

`apps/api/src/modules/device-returns/dto/reject-device-return.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /device-returns/:id/reject — spec 2026-09-20 §5.3 (reason 10–500 ตัวอักษร) */
export class RejectDeviceReturnDto {
  @IsString({ message: 'กรุณาระบุเหตุผลที่ส่งกลับ' })
  @MinLength(10, { message: 'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร' })
  @MaxLength(500, { message: 'เหตุผลยาวได้ไม่เกิน 500 ตัวอักษร' })
  reason: string;
}
```

`apps/api/src/modules/device-returns/dto/preview-device-return.dto.ts` (ValidationPipe global เปิด `transform` + `enableImplicitConversion` — `app.setup.ts:171-178` — จึงใช้ `@Type(() => Number)` แบบ `journey-list-query.dto.ts` ได้):

```ts
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { CONDITION_GRADES, ConditionGradeCode } from './create-device-return.dto';

/** GET /device-returns/preview?contractId&conditionGrade&appraisalPrice — spec 2026-09-20 §5.0 */
export class PreviewDeviceReturnQueryDto {
  @IsUUID(undefined, { message: 'กรุณาระบุสัญญา' })
  contractId: string;

  @IsOptional()
  @IsIn(CONDITION_GRADES, { message: 'เกรดสภาพต้องเป็น A, B, C, D' })
  conditionGrade?: ConditionGradeCode;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'ราคาประเมินต้องเป็นตัวเลข' })
  @Min(0, { message: 'ราคาประเมินต้องไม่ติดลบ' })
  appraisalPrice?: number;
}
```

- [ ] **Step 5: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-return-number.service.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 6: แม่แบบไลน์ 2 แถว (migration seed — precedent `20260702000001_seed_notification_templates`) + `DeviceReturnNotifyService`

**Files:**
- Create: `apps/api/prisma/migrations/20261003200000_seed_device_return_templates/migration.sql` (หลัง `20261003100000_device_returns` ของ Task 1)
- Create: `apps/api/src/modules/device-returns/device-return-notify.service.ts`
- Test: `apps/api/src/modules/device-returns/device-return-notify.service.spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.sendFromTemplate(eventType, data, recipient, { relatedId, customerId })` → `{ id: string | null; status: string; blockReason?: string }` (`notifications.service.ts:72-84`; status `SENT`/`FAILED`/`BLOCKED`/`DELAYED`; throw `InternalServerErrorException` เมื่อไม่มีแม่แบบ); placeholder syntax ของ dispatcher = **`${var}`** (`notification-dispatch.service.ts:219-227` — ไม่ใช่ `{{var}}` ตามที่ spec §5.5 เขียน); ผู้รับ = `customer.lineLinks[0].lineUserId ?? customer.lineIdFinance` (`credit-note-delivery.service.ts:108`, lineLinks กรอง `channel: FINANCE, unlinkedAt: null, deletedAt: null`); Todo fallback shape `credit-note-delivery.service.ts:296-330`
- Produces: แถว `NotificationTemplate` `DEVICE_RETURNED` / `DEVICE_RETURN_CANCELED` (channel `LINE`, channelKey `line-finance`, category `TRANSACTIONAL`, format `text`) ผ่าน migration idempotent `ON CONFLICT (event_type) DO NOTHING` — dev/CI/prod ได้แถวจาก `prisma migrate deploy` ทางเดียว ไม่มี seeder/SQL มือ; แก้ข้อความภายหลังที่ `/notifications` (migration ไม่ทับแถวที่มีอยู่); `DeviceReturnNotifyService.notify(deviceReturnId: string, eventType: 'DEVICE_RETURNED' | 'DEVICE_RETURN_CANCELED'): Promise<void>` (never throws; เขียน `lineNotifyStatus` `SENT`/`FAILED`/`NO_LINE`, `lineNotifiedAt`, `lineNotificationId`; NO_LINE → Todo MEDIUM tag `device-return` dedup); `export const DEVICE_RETURN_TODO_TAG = 'device-return'`

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/api/src/modules/device-returns/device-return-notify.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeviceReturnNotifyService, DEVICE_RETURN_TODO_TAG } from './device-return-notify.service';

function makeReturn(over: Record<string, unknown> = {}) {
  return {
    id: 'dr-1',
    docNumber: 'DR-20260920-0001',
    deletedAt: null,
    status: 'PENDING_CONFIRM',
    returnKind: 'VOLUNTARY',
    conditionGrade: 'B',
    deviceReceivedAt: new Date('2026-09-20T03:00:00.000Z'),
    receivingBranch: { name: 'ลาดพร้าว' },
    product: { brand: 'Apple', model: 'iPhone 14', storage: '128GB' },
    contract: { contractNumber: 'BCP2609-00042' },
    customer: {
      id: 'cust-1',
      name: 'สมชาย ใจดี',
      lineIdFinance: null,
      lineLinks: [{ lineUserId: 'U-link' }],
    },
    ...over,
  };
}

describe('DeviceReturnNotifyService', () => {
  let service: DeviceReturnNotifyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;

  beforeEach(async () => {
    prisma = {
      deviceReturn: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      todo: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'todo-1' }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'sys-uid' }) },
    };
    notifications = { sendFromTemplate: jest.fn().mockResolvedValue({ id: 'log-1', status: 'SENT' }) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceReturnNotifyService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = mod.get(DeviceReturnNotifyService);
  });

  it('SENT: ส่งผ่านแม่แบบ DEVICE_RETURNED ไป lineLinks ก่อน lineIdFinance พร้อมตัวแปรครบ (ไม่มีราคาประเมิน ไม่มี fallbackPhone) แล้วบันทึกผลบนใบ', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(makeReturn({ customer: { ...makeReturn().customer, lineIdFinance: 'U-old' } }));

    await service.notify('dr-1', 'DEVICE_RETURNED');

    expect(notifications.sendFromTemplate).toHaveBeenCalledTimes(1);
    const [eventType, data, recipient, options] = notifications.sendFromTemplate.mock.calls[0];
    expect(eventType).toBe('DEVICE_RETURNED');
    expect(recipient).toBe('U-link');
    expect(options).toEqual({ customerId: 'cust-1', relatedId: 'dr-1' });
    expect(data).toEqual({
      customerName: 'สมชาย ใจดี',
      docNumber: 'DR-20260920-0001',
      contractNumber: 'BCP2609-00042',
      deviceName: 'Apple iPhone 14 128GB',
      branchName: 'ลาดพร้าว',
      receivedDate: '20/09/2026',
      grade: 'B',
      returnKindLabel: 'คืนเครื่องเอง',
    });
    expect(JSON.stringify(data)).not.toMatch(/appraisal|ราคา/);
    expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: { lineNotifyStatus: 'SENT', lineNotifiedAt: expect.any(Date), lineNotificationId: 'log-1' },
    });
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('REPOSSESSION → returnKindLabel "ยึดคืนหลังบอกเลิกสัญญา"; ใช้ lineIdFinance เมื่อไม่มี lineLinks', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({ returnKind: 'REPOSSESSION', customer: { id: 'cust-1', name: 'x', lineIdFinance: 'U-fin', lineLinks: [] } }),
    );
    await service.notify('dr-1', 'DEVICE_RETURN_CANCELED');
    const [eventType, data, recipient] = notifications.sendFromTemplate.mock.calls[0];
    expect(eventType).toBe('DEVICE_RETURN_CANCELED');
    expect(recipient).toBe('U-fin');
    expect(data.returnKindLabel).toBe('ยึดคืนหลังบอกเลิกสัญญา');
  });

  it('FAILED: dispatcher คืนสถานะไม่ใช่ SENT → บันทึก FAILED + id ของ log (dispatcher retry เอง)', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(makeReturn());
    notifications.sendFromTemplate.mockResolvedValueOnce({ id: 'log-2', status: 'FAILED' });
    await service.notify('dr-1', 'DEVICE_RETURNED');
    expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: { lineNotifyStatus: 'FAILED', lineNotifiedAt: expect.any(Date), lineNotificationId: 'log-2' },
    });
  });

  it('FAILED: sendFromTemplate throw (เช่น ไม่มีแม่แบบ) → บันทึก FAILED, ไม่ throw ออก', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(makeReturn());
    notifications.sendFromTemplate.mockRejectedValueOnce(new Error('Notification template not found'));
    await expect(service.notify('dr-1', 'DEVICE_RETURNED')).resolves.toBeUndefined();
    expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: { lineNotifyStatus: 'FAILED', lineNotifiedAt: expect.any(Date), lineNotificationId: null },
    });
  });

  it('NO_LINE: ไม่มีทั้ง lineLinks และ lineIdFinance → ไม่ส่ง, บันทึก NO_LINE, สร้าง Todo MEDIUM tag device-return', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({ customer: { id: 'cust-1', name: 'สมชาย ใจดี', lineIdFinance: null, lineLinks: [] } }),
    );
    await service.notify('dr-1', 'DEVICE_RETURNED');
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
    expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: { lineNotifyStatus: 'NO_LINE', lineNotifiedAt: expect.any(Date), lineNotificationId: null },
    });
    expect(prisma.todo.findFirst).toHaveBeenCalledWith({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: { contains: 'DR-20260920-0001' },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(prisma.todo.create).toHaveBeenCalledWith({
      data: {
        title: 'แจ้งลูกค้าไม่ได้ ไม่มีไลน์ผูก — ใบรับเครื่องคืน DR-20260920-0001 (สมชาย ใจดี)',
        description: expect.stringContaining('BCP2609-00042'),
        priority: 'MEDIUM',
        tags: [DEVICE_RETURN_TODO_TAG],
        createdById: 'sys-uid',
      },
    });
  });

  it('NO_LINE dedup: มี Todo เปิดอยู่แล้วของใบเดียวกัน → ไม่สร้างซ้ำ', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({ customer: { id: 'cust-1', name: 'x', lineIdFinance: null, lineLinks: [] } }),
    );
    prisma.todo.findFirst.mockResolvedValueOnce({ id: 'todo-old' });
    await service.notify('dr-1', 'DEVICE_RETURNED');
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('ใบไม่พบ/ถูกลบ → ไม่ทำอะไร ไม่ throw', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(null);
    await expect(service.notify('missing', 'DEVICE_RETURNED')).resolves.toBeUndefined();
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
    expect(prisma.deviceReturn.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-return-notify.service.spec.ts`
Expected: FAIL — `Cannot find module './device-return-notify.service'`

- [ ] **Step 3: เขียน migration seed แม่แบบ (precedent `20260702000001_seed_notification_templates` — dev/CI/prod ได้แถวจาก `prisma migrate deploy` ทางเดียว)**

สร้าง `apps/api/prisma/migrations/20261003200000_seed_device_return_templates/migration.sql` (column list/format ก็อปจาก `git show origin/main:apps/api/prisma/migrations/20260702000001_seed_notification_templates/migration.sql` — `is_active` ใช้ default `true` ของตารางเหมือน precedent; migration นี้ไม่มี DDL จึงถอย/รันซ้ำได้):

```sql
-- ใบรับเครื่องคืน (spec docs/superpowers/specs/2026-09-20-device-return-intake-design.md §5.5) — แม่แบบไลน์แจ้งลูกค้า 2 แถว
-- Idempotent via ON CONFLICT (event_type) DO NOTHING (precedent 20260702000001_seed_notification_templates)
-- placeholder = ${var} ตาม NotificationDispatchService.replacePlaceholders — ห้ามเปลี่ยนเป็น {{var}}
-- ตัวแปรที่ DeviceReturnNotifyService ส่ง: customerName docNumber contractNumber deviceName branchName receivedDate grade returnKindLabel
-- (ไม่มีราคาประเมิน — สมมติฐานเจ้าของ: ไม่แสดงราคาในไลน์)
-- category TRANSACTIONAL = ไม่ผ่านด่านความยินยอม/quiet hours (compliance.service.ts COMPLIANCE_CHECKED_CATEGORIES) — แจ้งตามสัญญา ไม่ใช่การตลาด
-- แก้ข้อความภายหลังที่หน้า /notifications (TemplateManager) — migration ไม่ทับแถวที่มีอยู่แล้ว

INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'DEVICE_RETURNED', 'แจ้งรับเครื่องคืน (ใบรับเครื่องคืน)', 'TRANSACTIONAL', 'line-finance', 'LINE', 'text',
   'รับเครื่องคืนแล้ว ใบ ${docNumber} สัญญา ${contractNumber} ${deviceName} ที่สาขา ${branchName} วันที่ ${receivedDate} สภาพเกรด ${grade} — สัญญาหยุดนับค่างวดและค่าปรับตั้งแต่วันนี้ FINANCE จะตรวจสอบและแจ้งผลปิดสัญญาพร้อมใบลดหนี้ทางไลน์นี้',
   '{"customerName":"สมหมาย","docNumber":"DR-20260920-0001","contractNumber":"BCP2609-00042","deviceName":"Apple iPhone 14 128GB","branchName":"ลาดพร้าว","receivedDate":"20/09/2026","grade":"B","returnKindLabel":"คืนเครื่องเอง"}'::jsonb,
   'ส่งทันทีที่สาขาบันทึกใบรับเครื่องคืน (POST /device-returns) และเมื่อกดส่งซ้ำ — ไลน์การเงินเท่านั้น ไม่ตก SMS', now(), now()),

  (gen_random_uuid(), 'DEVICE_RETURN_CANCELED', 'แจ้งยกเลิกใบรับเครื่องคืน', 'TRANSACTIONAL', 'line-finance', 'LINE', 'text',
   'ใบรับเครื่องคืน ${docNumber} สัญญา ${contractNumber} ถูกยกเลิก สัญญาเดินต่อตามเดิม หากมีข้อสงสัยติดต่อสาขา ${branchName}',
   '{"customerName":"สมหมาย","docNumber":"DR-20260920-0001","contractNumber":"BCP2609-00042","deviceName":"Apple iPhone 14 128GB","branchName":"ลาดพร้าว","receivedDate":"20/09/2026","grade":"B","returnKindLabel":"คืนเครื่องเอง"}'::jsonb,
   'ส่งเมื่อ FINANCE ส่งกลับใบ (reject) หรือสาขายกเลิกใบ (cancel)', now(), now())
ON CONFLICT (event_type) DO NOTHING;
```

- [ ] **Step 4: apply migration + ตรวจแถว**

Run: `cd apps/api && npx prisma migrate deploy && npx prisma migrate status; cd ../..`
Expected: `Applied migration 20261003200000_seed_device_return_templates` แล้ว `Database schema is up to date!`

Run: `cd apps/api && npx tsx -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.notificationTemplate.findMany({ where: { eventType: { in: ['DEVICE_RETURNED', 'DEVICE_RETURN_CANCELED'] } }, select: { eventType: true, channel: true, channelKey: true, category: true, format: true, isActive: true } }).then((rows) => { console.log(JSON.stringify(rows, null, 2)); return p.\$disconnect(); });"; cd ../..`
Expected: 2 แถว (`DEVICE_RETURNED`, `DEVICE_RETURN_CANCELED`) ทั้งคู่ `channel: "LINE"`, `channelKey: "line-finance"`, `category: "TRANSACTIONAL"`, `format: "text"`, `isActive: true`


- [ ] **Step 5: เขียน notify service**

สร้าง `apps/api/src/modules/device-returns/device-return-notify.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { LineChannelType } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** tag ของ Todo ทุกใบในโมดูลนี้ (NO_LINE fallback + cron เตือนใบค้าง) — dedup อ่านค่านี้ตัวเดียว */
export const DEVICE_RETURN_TODO_TAG = 'device-return';

export type DeviceReturnLineEvent = 'DEVICE_RETURNED' | 'DEVICE_RETURN_CANCELED';

const RETURN_KIND_LABEL: Record<string, string> = {
  VOLUNTARY: 'คืนเครื่องเอง',
  REPOSSESSION: 'ยึดคืนหลังบอกเลิกสัญญา',
};

const SENTRY_TAGS = { subsystem: 'device-return' } as const;

/**
 * ไลน์แจ้งลูกค้าของใบรับเครื่องคืน (spec 2026-09-20 §5.5 — D3 ไม่มีลายเซ็น ใช้ข้อความทางเดียวแทน).
 * ส่งผ่านตัวส่งกลาง `NotificationsService.sendFromTemplate` (NotificationLog + retry + แม่แบบแก้เองได้
 * ที่ /notifications) — **ไม่ส่ง fallbackPhone** (ไลน์เท่านั้น ไม่ตก SMS). ผู้รับ = lineLinks FINANCE
 * ก่อน แล้วค่อย lineIdFinance (ตรรกะเดียวกับ credit-note-delivery.service.ts:108).
 *
 * NEVER throws — ผู้เรียก (create/reject/cancel/resend) await ได้โดยไม่ต้อง try/catch; ทุกทางล้ม
 * (ใบไม่พบ, dispatcher throw, เขียน DB ล้ม) ถูกกลืน + Sentry. ผลส่งเก็บบนใบ
 * (lineNotifyStatus SENT/FAILED/NO_LINE) — FAILED ให้ dispatcher retry เองผ่านคิว + ปุ่ม "ส่งซ้ำ";
 * NO_LINE → Todo MEDIUM tag device-return (dedup ต่อใบ) ให้สาขาแจ้งลูกค้าช่องทางอื่น.
 */
@Injectable()
export class DeviceReturnNotifyService {
  private readonly logger = new Logger(DeviceReturnNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async notify(deviceReturnId: string, eventType: DeviceReturnLineEvent): Promise<void> {
    try {
      const dr = await this.prisma.deviceReturn.findUnique({
        where: { id: deviceReturnId },
        include: {
          receivingBranch: { select: { name: true } },
          product: { select: { brand: true, model: true, storage: true } },
          contract: { select: { contractNumber: true } },
          customer: {
            select: {
              id: true,
              name: true,
              lineIdFinance: true,
              lineLinks: {
                where: { channel: LineChannelType.FINANCE, unlinkedAt: null, deletedAt: null },
                select: { lineUserId: true },
                take: 1,
              },
            },
          },
        },
      });
      if (!dr || dr.deletedAt) {
        this.logger.warn(`[device-return] notify ${eventType}: ใบ ${deviceReturnId} ไม่พบ/ถูกลบ — ข้าม`);
        return;
      }

      const lineUserId = dr.customer.lineLinks[0]?.lineUserId ?? dr.customer.lineIdFinance ?? null;
      if (!lineUserId) {
        await this.record(dr.id, 'NO_LINE', null);
        await this.createNoLineTodo(dr.id, dr.docNumber, dr.contract.contractNumber, dr.customer.name);
        return;
      }

      const data: Record<string, string> = {
        customerName: dr.customer.name,
        docNumber: dr.docNumber,
        contractNumber: dr.contract.contractNumber,
        deviceName: [dr.product.brand, dr.product.model, dr.product.storage].filter(Boolean).join(' '),
        branchName: dr.receivingBranch.name,
        receivedDate: this.bkkDate(dr.deviceReceivedAt),
        grade: dr.conditionGrade,
        returnKindLabel: RETURN_KIND_LABEL[dr.returnKind] ?? dr.returnKind,
      };

      let result: { id: string | null; status: string };
      try {
        result = await this.notifications.sendFromTemplate(eventType, data, lineUserId, {
          customerId: dr.customer.id,
          relatedId: dr.id,
        });
      } catch (err) {
        // แม่แบบหาย / dispatcher พัง — ห้ามขวางการรับเครื่อง (spec §5.5: การส่งไม่สำเร็จไม่ขวางการยืนยัน)
        this.logger.error(
          `[device-return] ส่งไลน์ ${eventType} ใบ ${dr.docNumber} ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`,
        );
        Sentry.captureException(err, { tags: { ...SENTRY_TAGS, eventType }, extra: { deviceReturnId } });
        await this.record(dr.id, 'FAILED', null);
        return;
      }

      await this.record(dr.id, result.status === 'SENT' ? 'SENT' : 'FAILED', result.id || null);
    } catch (err) {
      this.logger.error(
        `[device-return] notify ${eventType} ใบ ${deviceReturnId} พังนอกเส้นทางส่ง: ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, { tags: { ...SENTRY_TAGS, eventType }, extra: { deviceReturnId } });
    }
  }

  /** dd/MM/yyyy ตามเวลาไทย — ค.ศ. เพื่อไม่สับสนกับเลขที่ใบ (DR-YYYYMMDD) */
  private bkkDate(date: Date): string {
    return date.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private async record(
    id: string,
    lineNotifyStatus: 'SENT' | 'FAILED' | 'NO_LINE',
    lineNotificationId: string | null,
  ): Promise<void> {
    await this.prisma.deviceReturn.update({
      where: { id },
      data: { lineNotifyStatus, lineNotifiedAt: new Date(), lineNotificationId },
    });
  }

  /** Todo fallback แบบเดียวกับ credit-note-delivery.service.ts (dedup ต่อใบ: tag + docNumber ใน title + ยังไม่ DONE) */
  private async createNoLineTodo(
    deviceReturnId: string,
    docNumber: string,
    contractNumber: string,
    customerName: string,
  ): Promise<void> {
    const systemUser = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!systemUser) {
      Sentry.captureMessage('device-return: NO_LINE but SYSTEM user missing — Todo skipped', {
        level: 'warning',
        tags: SENTRY_TAGS,
        extra: { deviceReturnId, docNumber },
      });
      return;
    }
    const existing = await this.prisma.todo.findFirst({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: { contains: docNumber },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.todo.create({
      data: {
        title: `แจ้งลูกค้าไม่ได้ ไม่มีไลน์ผูก — ใบรับเครื่องคืน ${docNumber} (${customerName})`,
        description:
          `ลูกค้าของสัญญา ${contractNumber} ยังไม่ผูก LINE การเงิน ระบบส่งข้อความรับเครื่องคืนไม่ได้ — ` +
          `แจ้งลูกค้าทางโทรศัพท์/หน้าร้าน แล้วชวนผูกไลน์ · deviceReturnId: ${deviceReturnId}`,
        priority: 'MEDIUM',
        tags: [DEVICE_RETURN_TODO_TAG],
        createdById: systemUser.id,
      },
    });
  }
}
```

- [ ] **Step 6: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-return-notify.service.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 7: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 7: `DeviceReturnsService` — `preview` / `lookup` / `create` / `list` / `findOne` / `awaitingRepossession`

**Files:**
- Create: `apps/api/src/modules/device-returns/device-returns.service.ts`
- Test: `apps/api/src/modules/device-returns/device-returns.service.spec.ts`

**Interfaces:**
- Consumes: Task 4 `RepossessionsService` (`TABLE_DEVIATION_LIMIT`, `ZERO_OUTSTANDING_MSG`, `RE_REPOSSESSION_MSG`, `RequestUser`), Task 2 `lookupTableBase`, Task 5 `DeviceReturnNumberService.next(tx)` + DTOs, Task 6 `DeviceReturnNotifyService.notify`, `CustomerTagsService.recomputeForCustomer` (มีอยู่แล้ว), `JourneyEntryWriter` (Task 8 ใช้), `AuditService.log`, `CreditNoteDeliveryService.deliver` (Task 8 ใช้), `getBranchScope`/`hasCrossBranchAccess`
- Produces: `DeviceReturnsService` (constructor: `PrismaService, RepossessionsService, DeviceReturnNumberService, DeviceReturnNotifyService, CustomerTagsService, JourneyEntryWriter, AuditService, CreditNoteDeliveryService`), `export interface DeviceReturnRow` (รูปแถวที่ทุก endpoint คืน — เว็บ Phase 3 ใช้), `export interface DeviceReturnPreview`, `export function deriveReturnKind(status: ContractStatus): DeviceReturnKind | null`, `export function allowedReasonsFor(kind): RepossessionReturnReason[]`, ข้อความคงที่ `PENDING_EXISTS_MSG`, `CLOSED_MSG`, `NOT_RETURNABLE_MSG`, `PENDING_REQUEST_MSG`; รูป lookup row `{ id, contractNumber, status, customer: { id, name }, product: { id, brand, model, imeiSerial } | null, branch: { id, name } | null }` (≤ 20 แถว ไม่มีเบอร์); รูป awaiting `{ data: AwaitingRow[]; total }` (`AwaitingRow = { id, contractNumber, status, monthlyPayment: string, customer: { id, name, phone }, product: { id, name, brand, model } | null, branch: { id, name } | null }`, limit 100)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/api/src/modules/device-returns/device-returns.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerTagsService } from '../customer-tags/customer-tags.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { CreditNoteDeliveryService } from '../receipts/services/credit-note-delivery.service';
import { RepossessionsService } from '../repossessions/repossessions.service';
import { DeviceReturnNumberService } from './device-return-number.service';
import { DeviceReturnNotifyService } from './device-return-notify.service';
import { DeviceReturnsService, deriveReturnKind, allowedReasonsFor } from './device-returns.service';

const decimal = (v: number | string) => new Prisma.Decimal(v);
const OWNER = { id: 'owner-1', role: 'OWNER', branchId: null };
const BM_A = { id: 'bm-a', role: 'BRANCH_MANAGER', branchId: 'branch-a' };
const SALES_A = { id: 'sales-a', role: 'SALES', branchId: 'branch-a' };
const FM = { id: 'fm-1', role: 'FINANCE_MANAGER', branchId: null };

function makeContract(over: Record<string, unknown> = {}) {
  return {
    id: 'contract-1',
    contractNumber: 'BCP2609-00042',
    status: 'ACTIVE',
    deletedAt: null,
    branchId: 'branch-b',
    customerId: 'cust-1',
    productId: 'product-1',
    totalMonths: 12,
    product: { id: 'product-1', brand: 'Apple', model: 'iPhone 14', storage: '128GB', imeiSerial: 'IMEI-1', status: 'SOLD_INSTALLMENT' },
    customer: { id: 'cust-1', name: 'สมชาย ใจดี' },
    branch: { id: 'branch-b', name: 'บางกะปิ' },
    payments: [
      { id: 'pay-1', installmentNo: 1, status: 'PAID', amountDue: decimal(1000), amountPaid: decimal(1000), lateFee: decimal(0), lateFeeWaived: false },
      { id: 'pay-2', installmentNo: 2, status: 'OVERDUE', amountDue: decimal(1000), amountPaid: decimal(0), lateFee: decimal(100), lateFeeWaived: false },
      { id: 'pay-3', installmentNo: 3, status: 'PENDING', amountDue: decimal(1000), amountPaid: decimal(0), lateFee: decimal(0), lateFeeWaived: false },
    ],
    ...over,
  };
}

function makeReturnRow(over: Record<string, unknown> = {}) {
  return {
    id: 'dr-1',
    docNumber: 'DR-20260920-0001',
    status: 'PENDING_CONFIRM',
    returnKind: 'VOLUNTARY',
    returnReason: 'UNAFFORDABLE',
    deviceReceivedAt: new Date('2026-09-20T03:00:00.000Z'),
    conditionGrade: 'B',
    appraisalPrice: decimal(6000),
    tableBasePrice: null,
    repairCost: decimal(0),
    notes: null,
    previousContractStatus: 'ACTIVE',
    contractId: 'contract-1',
    productId: 'product-1',
    customerId: 'cust-1',
    receivingBranchId: 'branch-a',
    receivedById: 'sales-a',
    confirmedById: null,
    confirmedAt: null,
    repossessionId: null,
    rejectedById: null,
    rejectedAt: null,
    rejectReason: null,
    canceledById: null,
    canceledAt: null,
    lineNotifyStatus: null,
    lineNotifiedAt: null,
    lineNotificationId: null,
    createdAt: new Date('2026-09-20T03:05:00.000Z'),
    updatedAt: new Date('2026-09-20T03:05:00.000Z'),
    deletedAt: null,
    receivingBranch: { id: 'branch-a', name: 'ลาดพร้าว' },
    receivedBy: { id: 'sales-a', name: 'พนักงาน ก' },
    contract: {
      id: 'contract-1',
      contractNumber: 'BCP2609-00042',
      status: 'TERMINATED',
      customer: { id: 'cust-1', name: 'สมชาย ใจดี' },
      product: { id: 'product-1', brand: 'Apple', model: 'iPhone 14', imeiSerial: 'IMEI-1' },
    },
    ...over,
  };
}

describe('DeviceReturnsService', () => {
  let service: DeviceReturnsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let numberService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notify: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tags: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let repossessions: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journey: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cnDelivery: any;

  beforeEach(async () => {
    prisma = {
      contract: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      deviceReturn: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      repossession: { findFirst: jest.fn().mockResolvedValue(null) },
      contractExchangeRequest: { count: jest.fn().mockResolvedValue(0) },
      contractCancellation: { count: jest.fn().mockResolvedValue(0) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-x', name: 'สาขา X' }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      tradeInValuation: { findFirst: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn as Promise<unknown>[]);
      }),
    };
    numberService = { next: jest.fn().mockResolvedValue('DR-20260920-0001') };
    notify = { notify: jest.fn().mockResolvedValue(undefined) };
    tags = { recomputeForCustomer: jest.fn().mockResolvedValue({ added: [], removed: [] }) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    cnDelivery = { deliver: jest.fn().mockResolvedValue({ delivered: true }) };
    repossessions = {
      assertRepossessionPeriodsOpen: jest
        .fn()
        .mockResolvedValue({ financeCompanyId: 'company-finance', shopCompanyId: 'company-shop' }),
      createInTx: jest.fn().mockResolvedValue({
        repossession: { id: 'repo-1' },
        outstandingBalance: decimal(2100),
        totalPaid: decimal(1000),
        creditNote: { outcome: 'ISSUED', receiptId: 'r1' },
      }),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceReturnsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RepossessionsService, useValue: repossessions },
        { provide: DeviceReturnNumberService, useValue: numberService },
        { provide: DeviceReturnNotifyService, useValue: notify },
        { provide: CustomerTagsService, useValue: tags },
        { provide: JourneyEntryWriter, useValue: journey },
        { provide: AuditService, useValue: audit },
        { provide: CreditNoteDeliveryService, useValue: cnDelivery },
      ],
    }).compile();
    service = mod.get(DeviceReturnsService);
  });

  describe('deriveReturnKind / allowedReasonsFor', () => {
    it('TERMINATED → REPOSSESSION (AFTER_TERMINATION เท่านั้น); ACTIVE/OVERDUE/DEFAULT → VOLUNTARY (3 เหตุผล); อื่น ๆ → null', () => {
      expect(deriveReturnKind('TERMINATED')).toBe('REPOSSESSION');
      expect(deriveReturnKind('ACTIVE')).toBe('VOLUNTARY');
      expect(deriveReturnKind('OVERDUE')).toBe('VOLUNTARY');
      expect(deriveReturnKind('DEFAULT')).toBe('VOLUNTARY');
      expect(deriveReturnKind('COMPLETED')).toBeNull();
      expect(deriveReturnKind('CLOSED_BAD_DEBT')).toBeNull();
      expect(allowedReasonsFor('REPOSSESSION')).toEqual(['AFTER_TERMINATION']);
      expect(allowedReasonsFor('VOLUNTARY')).toEqual(['UNAFFORDABLE', 'NO_LONGER_NEEDED', 'OTHER']);
      expect(allowedReasonsFor(null)).toEqual([]);
    });
  });

  describe('preview', () => {
    it('ACTIVE + เกรด → VOLUNTARY, canCreate, ราคาตาราง, deviationPct, ยอดค้าง 2dp — ไม่จำกัดสาขา (D7: BM สาขาอื่นก็ดูได้)', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.tradeInValuation.findFirst.mockResolvedValue({ basePrice: decimal(8000), note: 'จอเดิม' });

      const result = await service.preview(
        { contractId: 'contract-1', conditionGrade: 'B', appraisalPrice: 6000 },
        BM_A as never,
      );

      expect(result.contract).toEqual({
        id: 'contract-1',
        contractNumber: 'BCP2609-00042',
        status: 'ACTIVE',
        customer: { id: 'cust-1', name: 'สมชาย ใจดี' },
        product: { id: 'product-1', brand: 'Apple', model: 'iPhone 14', storage: '128GB', imeiSerial: 'IMEI-1' },
        branch: { id: 'branch-b', name: 'บางกะปิ' },
      });
      expect(result.returnKind).toBe('VOLUNTARY');
      expect(result.eligibility).toEqual({ canCreate: true, reason: null });
      expect(result.allowedReasons).toEqual(['UNAFFORDABLE', 'NO_LONGER_NEEDED', 'OTHER']);
      expect(result.valuation).toEqual({ grade: 'B', found: true, suggestedPrice: 8000, note: 'จอเดิม' });
      expect(result.deviationPct).toBe(25); // |6000 − 8000| / 8000
      expect(result.outstandingBalance).toBe('2100.00');
    });

    it('TERMINATED → REPOSSESSION + เหตุผลเดียว; ไม่มีเกรด → valuation null, deviationPct null', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'TERMINATED' }));
      const result = await service.preview({ contractId: 'contract-1' }, OWNER as never);
      expect(result.returnKind).toBe('REPOSSESSION');
      expect(result.allowedReasons).toEqual(['AFTER_TERMINATION']);
      expect(result.valuation).toBeNull();
      expect(result.deviationPct).toBeNull();
    });

    it('สถานะไม่เข้าเกณฑ์ (COMPLETED) → canCreate=false พร้อมเหตุผล, kind null, allowedReasons []', async () => {
      prisma.contract.findUnique.mockResolvedValue(makeContract({ status: 'COMPLETED' }));
      const result = await service.preview({ contractId: 'contract-1' }, OWNER as never);
      expect(result.returnKind).toBeNull();
      expect(result.eligibility).toEqual({ canCreate: false, reason: 'สัญญานี้ไม่อยู่ในสถานะที่รับเครื่องคืนได้' });
      expect(result.allowedReasons).toEqual([]);
    });

    it('ยอดค้าง 0 → ZERO_OUTSTANDING_MSG; เครื่องเคยยึด → RE_REPOSSESSION_MSG; มีใบ PENDING → ข้อความใบซ้ำ; คำขอเปลี่ยนเครื่อง PENDING → ข้อความคำขอค้าง', async () => {
      const paid = makeContract().payments.map((p) => ({ ...p, status: 'PAID', amountPaid: p.amountDue }));
      prisma.contract.findUnique.mockResolvedValue(makeContract({ payments: paid }));
      expect((await service.preview({ contractId: 'contract-1' }, OWNER as never)).eligibility.reason).toMatch(/ไม่มียอดค้างชำระ/);

      prisma.contract.findUnique.mockResolvedValue(makeContract());
      prisma.repossession.findFirst.mockResolvedValueOnce({ id: 'repo-old' });
      expect((await service.preview({ contractId: 'contract-1' }, OWNER as never)).eligibility.reason).toMatch(/เคยถูกยึดคืนมาแล้ว/);

      prisma.deviceReturn.findFirst.mockResolvedValueOnce({ id: 'dr-open', docNumber: 'DR-20260919-0003' });
      expect((await service.preview({ contractId: 'contract-1' }, OWNER as never)).eligibility.reason).toBe(
        'สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว',
      );

      prisma.contractExchangeRequest.count.mockResolvedValueOnce(1);
      expect((await service.preview({ contractId: 'contract-1' }, OWNER as never)).eligibility.reason).toMatch(/คำขอเปลี่ยนเครื่อง/);
    });

    it('ไม่พบสัญญา → NotFoundException', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      await expect(service.preview({ contractId: 'nope' }, OWNER as never)).rejects.toThrow(NotFoundException);
    });
  });

  describe('lookup', () => {
    it('q สั้นกว่า 3 ตัว → [] โดยไม่ query', async () => {
      expect(await service.lookup('ab', SALES_A as never)).toEqual([]);
      expect(prisma.contract.findMany).not.toHaveBeenCalled();
    });

    it('ค้นเลขสัญญา/เบอร์/IMEI (contains) ≤ 20 แถว ทุกสาขา (D7) — แถวไม่มีเบอร์ลูกค้า', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { id: 'c1', contractNumber: 'BCP2609-00042', status: 'ACTIVE', customer: { id: 'cu1', name: 'สมชาย', phone: '0812345678' }, product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: 'IMEI-1' }, branch: { id: 'b1', name: 'ลาดพร้าว' } },
      ]);
      const rows = await service.lookup('0042', SALES_A as never);
      expect(rows).toEqual([
        { id: 'c1', contractNumber: 'BCP2609-00042', status: 'ACTIVE', customer: { id: 'cu1', name: 'สมชาย' }, product: { id: 'p1', brand: 'Apple', model: 'iPhone 14', imeiSerial: 'IMEI-1' }, branch: { id: 'b1', name: 'ลาดพร้าว' } },
      ]);
      const args = prisma.contract.findMany.mock.calls[0][0];
      expect(args.take).toBe(20);
      expect(args.where).toEqual({
        deletedAt: null,
        OR: [
          { contractNumber: { contains: '0042', mode: 'insensitive' } },
          { customer: { phone: { contains: '0042' } } },
          { product: { imeiSerial: { contains: '0042', mode: 'insensitive' } } },
        ],
      });
      expect(JSON.stringify(rows)).not.toContain('0812345678');
    });
  });

  describe('create', () => {
    const dto = () => ({
      contractId: 'contract-1',
      deviceReceivedAt: new Date(Date.now() - 3600_000).toISOString(),
      conditionGrade: 'B' as const,
      appraisalPrice: 6000,
      returnReason: 'UNAFFORDABLE' as const,
    });
    const arm = (contract = makeContract()) => {
      prisma.contract.findUnique.mockResolvedValue(contract);
      prisma.deviceReturn.create.mockResolvedValue(makeReturnRow());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(makeReturnRow({ lineNotifyStatus: 'SENT' }));
    };

    it('BM/SALES ไม่มี branchId → 403 fail-closed ก่อนแตะ DB', async () => {
      await expect(service.create(dto(), { id: 'u', role: 'SALES', branchId: null } as never)).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('OWNER ต้องระบุ receivingBranchId (400) และสาขาต้องมีอยู่ (404)', async () => {
      await expect(service.create(dto(), OWNER as never)).rejects.toThrow('กรุณาระบุสาขาที่รับเครื่อง');
      prisma.branch.findFirst.mockResolvedValueOnce(null);
      await expect(service.create({ ...dto(), receivingBranchId: 'branch-x' }, OWNER as never)).rejects.toThrow(NotFoundException);
    });

    it('วันรับเครื่องเป็นอนาคต → 400', async () => {
      const future = new Date(Date.now() + 48 * 3600_000).toISOString();
      await expect(service.create({ ...dto(), deviceReceivedAt: future }, SALES_A as never)).rejects.toThrow('วันที่รับเครื่องต้องไม่เป็นวันในอนาคต');
    });

    it('VOLUNTARY: ไม่ส่งเหตุผล → 400; เหตุผล AFTER_TERMINATION → 400; OTHER ไม่มีรายละเอียด → 400', async () => {
      arm();
      await expect(service.create({ ...dto(), returnReason: undefined }, SALES_A as never)).rejects.toThrow('กรุณาเลือกเหตุผลคืนเครื่อง');
      await expect(service.create({ ...dto(), returnReason: 'AFTER_TERMINATION' }, SALES_A as never)).rejects.toThrow(/เหตุผลคืนเครื่องไม่ตรงกับประเภท/);
      await expect(service.create({ ...dto(), returnReason: 'OTHER', notes: '  ' }, SALES_A as never)).rejects.toThrow('กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง');
      expect(prisma.deviceReturn.create).not.toHaveBeenCalled();
    });

    it('REPOSSESSION (TERMINATED): ไม่ส่งเหตุผล → ตั้ง AFTER_TERMINATION ให้; ส่งเหตุผลอื่น → 400; ไม่แตะสถานะสัญญา', async () => {
      arm(makeContract({ status: 'TERMINATED' }));
      await expect(service.create({ ...dto(), returnReason: 'UNAFFORDABLE' }, SALES_A as never)).rejects.toThrow(/รับเครื่องคืนหลังบอกเลิกสัญญา/);
      await service.create({ ...dto(), returnReason: undefined }, SALES_A as never);
      const data = prisma.deviceReturn.create.mock.calls[0][0].data;
      expect(data.returnKind).toBe('REPOSSESSION');
      expect(data.returnReason).toBe('AFTER_TERMINATION');
      expect(data.previousContractStatus).toBeNull();
      expect(prisma.contract.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('ราคาประเมิน 0 → 400 (spec §5.1 ข้อ 7)', async () => {
      arm();
      await expect(service.create({ ...dto(), appraisalPrice: 0 }, SALES_A as never)).rejects.toThrow('กรุณาระบุราคาประเมินมากกว่า 0 บาท');
    });

    it('ต่างจากตารางเกิน 15% ต้องมีหมายเหตุ (400) — มีหมายเหตุแล้ว snapshot tableBasePrice', async () => {
      arm();
      prisma.tradeInValuation.findFirst.mockResolvedValue({ basePrice: decimal(8000), note: null });
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(/เกิน 15%/);
      await service.create({ ...dto(), notes: 'จอแตก' }, SALES_A as never);
      expect(String(prisma.deviceReturn.create.mock.calls[0][0].data.tableBasePrice)).toBe('8000');
    });

    it('ด่านสิทธิ์: ยอดค้าง 0 → 400; เครื่องเคยยึด → 409; มีใบ PENDING → 409; คำขอยกเลิกสัญญาค้าง → 400', async () => {
      const paid = makeContract().payments.map((p) => ({ ...p, status: 'PAID', amountPaid: p.amountDue }));
      arm(makeContract({ payments: paid }));
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(BadRequestException);

      arm();
      prisma.repossession.findFirst.mockResolvedValueOnce({ id: 'repo-old' });
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(ConflictException);

      prisma.deviceReturn.findFirst.mockResolvedValueOnce({ id: 'dr-open', docNumber: 'DR-x' });
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow('สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว');

      prisma.contractCancellation.count.mockResolvedValueOnce(1);
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow(/คำขอยกเลิกสัญญา/);
    });

    it('VOLUNTARY สำเร็จ: เลขที่จาก number service ใน tx, แถวใบ, สัญญา → TERMINATED + audit CONTRACT_STATUS_LEGAL ใน tx, หลัง commit audit/tag/ไลน์ ตามลำดับ, คืนแถว', async () => {
      arm();
      const result = await service.create({ ...dto(), repairCost: 150, notes: 'สภาพดี' }, SALES_A as never);

      expect(numberService.next).toHaveBeenCalledWith(prisma);
      expect(prisma.deviceReturn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            docNumber: 'DR-20260920-0001',
            contractId: 'contract-1',
            productId: 'product-1',
            customerId: 'cust-1',
            receivingBranchId: 'branch-a',
            receivedById: 'sales-a',
            returnKind: 'VOLUNTARY',
            returnReason: 'UNAFFORDABLE',
            conditionGrade: 'B',
            notes: 'สภาพดี',
            previousContractStatus: 'ACTIVE',
            status: 'PENDING_CONFIRM',
          }),
        }),
      );
      const data = prisma.deviceReturn.create.mock.calls[0][0].data;
      expect(String(data.appraisalPrice)).toBe('6000');
      expect(String(data.repairCost)).toBe('150');
      expect(data.tableBasePrice).toBeNull();
      expect(prisma.contract.update).toHaveBeenCalledWith({ where: { id: 'contract-1' }, data: { status: 'TERMINATED' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'sales-a',
          action: 'CONTRACT_STATUS_LEGAL',
          entity: 'contract',
          entityId: 'contract-1',
          newValue: { from: 'ACTIVE', to: 'TERMINATED', reason: 'DEVICE_RETURN_INTAKE', deviceReturnId: 'dr-1', docNumber: 'DR-20260920-0001' },
        },
      });
      // post-commit ตามลำดับ: audit → tag → ไลน์ (ทุกตัวหลัง $transaction)
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      expect(audit.log.mock.invocationCallOrder[0]).toBeGreaterThan(txOrder);
      expect(tags.recomputeForCustomer.mock.invocationCallOrder[0]).toBeGreaterThan(audit.log.mock.invocationCallOrder[0]);
      expect(notify.notify.mock.invocationCallOrder[0]).toBeGreaterThan(tags.recomputeForCustomer.mock.invocationCallOrder[0]);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'sales-a',
          action: 'DEVICE_RETURN_CREATED',
          entity: 'device_return',
          entityId: 'dr-1',
          newValue: expect.objectContaining({ docNumber: 'DR-20260920-0001', contractNumber: 'BCP2609-00042', returnKind: 'VOLUNTARY', returnReason: 'UNAFFORDABLE', conditionGrade: 'B', appraisalPrice: '6000.00', tableBasePrice: null, receivingBranchId: 'branch-a' }),
        }),
      );
      expect(tags.recomputeForCustomer).toHaveBeenCalledWith('cust-1');
      expect(notify.notify).toHaveBeenCalledWith('dr-1', 'DEVICE_RETURNED');
      expect(result).toMatchObject({ id: 'dr-1', docNumber: 'DR-20260920-0001', status: 'PENDING_CONFIRM', appraisalPrice: '6000.00', repairCost: '0.00', lineNotifyStatus: 'SENT', receivingBranch: { id: 'branch-a', name: 'ลาดพร้าว' }, contract: { contractNumber: 'BCP2609-00042', customer: { id: 'cust-1', name: 'สมชาย ใจดี' } } });
    });

    it('OWNER ใช้ receivingBranchId จาก body; SALES ส่ง receivingBranchId มาถูกละเลย (ใช้สาขาตัวเอง)', async () => {
      arm();
      await service.create({ ...dto(), receivingBranchId: 'branch-x' }, OWNER as never);
      expect(prisma.deviceReturn.create.mock.calls[0][0].data.receivingBranchId).toBe('branch-x');
      await service.create({ ...dto(), receivingBranchId: 'branch-x' }, SALES_A as never);
      expect(prisma.deviceReturn.create.mock.calls[1][0].data.receivingBranchId).toBe('branch-a');
    });

    it('P2002 จาก partial unique (แพ้ race) → 409 ข้อความใบซ้ำ', async () => {
      arm();
      prisma.deviceReturn.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.create(dto(), SALES_A as never)).rejects.toThrow('สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว');
    });

    it('recompute tag ล้ม → ไม่ throw ออก (best-effort) และไลน์ยังถูกส่ง', async () => {
      arm();
      tags.recomputeForCustomer.mockRejectedValueOnce(new Error('boom'));
      await expect(service.create(dto(), SALES_A as never)).resolves.toBeDefined();
      expect(notify.notify).toHaveBeenCalled();
    });
  });

  describe('list / findOne / awaitingRepossession', () => {
    it('list: BM ถูกบังคับ receivingBranchId ตัวเอง แม้ส่ง branchId อื่น; default limit 50; แถวมี confirmedBy จาก user lookup', async () => {
      prisma.deviceReturn.findMany.mockResolvedValue([makeReturnRow({ status: 'CONFIRMED', confirmedById: 'fm-1', confirmedAt: new Date('2026-09-21T02:00:00.000Z'), repossessionId: 'repo-1' })]);
      prisma.deviceReturn.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([{ id: 'fm-1', name: 'ผจก.การเงิน' }]);

      const result = await service.list({ branchId: 'branch-z', status: 'CONFIRMED' }, BM_A as never);

      const args = prisma.deviceReturn.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ deletedAt: null, status: 'CONFIRMED', receivingBranchId: 'branch-a' });
      expect(args.take).toBe(50);
      expect(args.skip).toBe(0);
      expect(result).toMatchObject({ total: 1, page: 1, limit: 50 });
      expect(result.data[0]).toMatchObject({ status: 'CONFIRMED', confirmedBy: { id: 'fm-1', name: 'ผจก.การเงิน' }, repossessionId: 'repo-1' });
      expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['fm-1'] } }, select: { id: true, name: true } });
    });

    it('list: BM ไม่มี branchId → หน้าว่างโดยไม่ query; OWNER ใช้ branchId/contractId จาก query', async () => {
      expect(await service.list({}, { id: 'u', role: 'BRANCH_MANAGER', branchId: null } as never)).toEqual({ data: [], total: 0, page: 1, limit: 50 });
      expect(prisma.deviceReturn.findMany).not.toHaveBeenCalled();
      await service.list({ branchId: 'branch-z', contractId: 'contract-9', page: 2, limit: 10 }, OWNER as never);
      const args = prisma.deviceReturn.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ deletedAt: null, receivingBranchId: 'branch-z', contractId: 'contract-9' });
      expect(args.skip).toBe(10);
    });

    it('findOne: BM สาขาอื่น → 404 (ไม่ leak); FM (cross-branch) → ผ่าน', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ receivingBranchId: 'branch-b' }));
      await expect(service.findOne('dr-1', BM_A as never)).rejects.toThrow(NotFoundException);
      expect((await service.findOne('dr-1', FM as never)).docNumber).toBe('DR-20260920-0001');
    });

    it('awaitingRepossession: TERMINATED ที่ไม่มีแถวยึดและไม่มีใบ PENDING; BM กรอง contract.branchId ตัวเอง; limit 100', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { id: 'c1', contractNumber: 'BCP-1', status: 'TERMINATED', monthlyPayment: decimal('1515.83'), customer: { id: 'cu1', name: 'x', phone: '08' }, product: { id: 'p1', name: 'iPhone', brand: 'Apple', model: '14' }, branch: { id: 'branch-a', name: 'ลาดพร้าว' } },
      ]);
      prisma.contract.count.mockResolvedValue(1);
      const result = await service.awaitingRepossession(BM_A as never);
      const args = prisma.contract.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        deletedAt: null,
        status: 'TERMINATED',
        repossession: null,
        deviceReturns: { none: { status: 'PENDING_CONFIRM', deletedAt: null } },
        branchId: 'branch-a',
      });
      expect(args.take).toBe(100);
      expect(result).toEqual({
        data: [{ id: 'c1', contractNumber: 'BCP-1', status: 'TERMINATED', monthlyPayment: '1515.83', customer: { id: 'cu1', name: 'x', phone: '08' }, product: { id: 'p1', name: 'iPhone', brand: 'Apple', model: '14' }, branch: { id: 'branch-a', name: 'ลาดพร้าว' } }],
        total: 1,
      });
    });
  });
});
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-returns.service.spec.ts`
Expected: FAIL — `Cannot find module './device-returns.service'`

- [ ] **Step 3: เขียน service (ครึ่งแรก — Task 8 เติม confirm/reject/cancel/resendLine ต่อท้ายไฟล์นี้)**

สร้าง `apps/api/src/modules/device-returns/device-returns.service.ts` (pattern อ้างอิง: `repossessions.service.ts` สำหรับ branch scope/404, `contract-letter.service.ts:256-267` สำหรับ audit ใน tx):

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ContractStatus,
  DeviceReturnKind,
  DeviceReturnStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { getBranchScope } from '../auth/branch-access.util';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { CustomerTagsService } from '../customer-tags/customer-tags.service';
import { CreditNoteDeliveryService } from '../receipts/services/credit-note-delivery.service';
import {
  REPOSSESSION_RETURN_REASONS,
  RepossessionReturnReason,
} from '../repossessions/dto/create-repossession.dto';
import {
  RE_REPOSSESSION_MSG,
  RepossessionsService,
  RequestUser,
  ZERO_OUTSTANDING_MSG,
} from '../repossessions/repossessions.service';
import { lookupTableBase, TableBaseHint } from '../repossessions/table-base.util';
import { TradeInValuationService } from '../trade-in/services/trade-in-valuation.service';
import { d, dAdd, dSub } from '../../utils/decimal.util';
import { isFutureBkkDay } from '../../utils/date.util';
import { DeviceReturnNumberService } from './device-return-number.service';
import { DeviceReturnNotifyService } from './device-return-notify.service';
import { CreateDeviceReturnDto } from './dto/create-device-return.dto';

// ───────────────────────────── ข้อความคงที่ (ใช้ซ้ำใน preview.eligibility + create) ─────────────────────────────
export const NOT_RETURNABLE_MSG = 'สัญญานี้ไม่อยู่ในสถานะที่รับเครื่องคืนได้';
export const PENDING_EXISTS_MSG = 'สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว';
export const PENDING_REQUEST_MSG =
  'สัญญานี้มีคำขอเปลี่ยนเครื่องหรือคำขอยกเลิกสัญญาที่รอดำเนินการ — จัดการคำขอนั้นให้เสร็จก่อนรับเครื่องคืน';
export const CLOSED_MSG = 'ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว';
export const NOT_FOUND_MSG = 'ไม่พบใบรับเครื่องคืน';

const VOLUNTARY_STATUSES: ContractStatus[] = ['ACTIVE', 'OVERDUE', 'DEFAULT'];
const VOLUNTARY_REASONS: RepossessionReturnReason[] = ['UNAFFORDABLE', 'NO_LONGER_NEEDED', 'OTHER'];
const REPOSSESSION_REASONS: RepossessionReturnReason[] = ['AFTER_TERMINATION'];
const SENTRY_TAGS = { subsystem: 'device-return' } as const;

/** spec §5.1 ข้อ 2 — ประเภทคืน/ยึด derive จากสถานะสัญญา ไม่ให้ผู้ใช้เลือก */
export function deriveReturnKind(status: ContractStatus): DeviceReturnKind | null {
  if (status === 'TERMINATED') return 'REPOSSESSION';
  if (VOLUNTARY_STATUSES.includes(status)) return 'VOLUNTARY';
  return null;
}

export function allowedReasonsFor(kind: DeviceReturnKind | null): RepossessionReturnReason[] {
  if (kind === 'REPOSSESSION') return [...REPOSSESSION_REASONS];
  if (kind === 'VOLUNTARY') return [...VOLUNTARY_REASONS];
  return [];
}

type PaymentLike = {
  status: string;
  amountDue: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  lateFee: Prisma.Decimal;
  lateFeeWaived: boolean;
};

/** ยอดค้าง = Σ (amountDue + lateFee ถ้าไม่ waive − amountPaid) ของงวดที่ไม่ PAID — สูตรเดียวกับ RepossessionsService.createInTx */
function outstandingOf(payments: PaymentLike[]): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const p of payments) {
    if (p.status === 'PAID') continue;
    const lateFee = p.lateFeeWaived ? new Prisma.Decimal(0) : d(p.lateFee);
    total = dAdd(total, dSub(dAdd(d(p.amountDue), lateFee), d(p.amountPaid)));
  }
  return total;
}

/** include ของสัญญาที่ preview/create ใช้ร่วมกัน */
const CONTRACT_INCLUDE = {
  product: {
    select: { id: true, brand: true, model: true, storage: true, imeiSerial: true, status: true },
  },
  customer: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' as const } },
} satisfies Prisma.ContractInclude;
type ContractForIntake = Prisma.ContractGetPayload<{ include: typeof CONTRACT_INCLUDE }>;

type EligibilityContract = {
  id: string;
  status: ContractStatus;
  productId: string;
  product: { status: ProductStatus };
  payments: PaymentLike[];
};
type EligibilityCheck =
  | { ok: true }
  | { ok: false; reason: string; code: 'BAD_REQUEST' | 'CONFLICT' };

/** include ของแถวใบ — รูปเดียวที่ทุก endpoint คืน (เว็บ Phase 3 อ่านรูปนี้) */
export const DEVICE_RETURN_LIST_INCLUDE = {
  receivingBranch: { select: { id: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
  contract: {
    select: {
      id: true,
      contractNumber: true,
      status: true,
      customer: { select: { id: true, name: true } },
      product: { select: { id: true, brand: true, model: true, imeiSerial: true } },
    },
  },
} satisfies Prisma.DeviceReturnInclude;
export type DeviceReturnWithRelations = Prisma.DeviceReturnGetPayload<{
  include: typeof DEVICE_RETURN_LIST_INCLUDE;
}>;

export interface DeviceReturnRow {
  id: string;
  docNumber: string;
  status: DeviceReturnStatus;
  returnKind: DeviceReturnKind;
  returnReason: string;
  deviceReceivedAt: Date;
  conditionGrade: string;
  appraisalPrice: string;
  tableBasePrice: string | null;
  repairCost: string;
  notes: string | null;
  lineNotifyStatus: string | null;
  lineNotifiedAt: Date | null;
  receivingBranch: { id: string; name: string };
  receivedBy: { id: string; name: string };
  contract: {
    id: string;
    contractNumber: string;
    status: ContractStatus;
    customer: { id: string; name: string };
    product: { id: string; brand: string; model: string; imeiSerial: string | null };
  };
  confirmedAt: Date | null;
  confirmedBy: { id: string; name: string } | null;
  repossessionId: string | null;
  rejectReason: string | null;
  createdAt: Date;
}

export interface DeviceReturnPreview {
  contract: {
    id: string;
    contractNumber: string;
    status: ContractStatus;
    customer: { id: string; name: string };
    product: {
      id: string;
      brand: string;
      model: string;
      storage: string | null;
      imeiSerial: string | null;
    };
    branch: { id: string; name: string };
  };
  returnKind: DeviceReturnKind | null;
  eligibility: { canCreate: boolean; reason: string | null };
  allowedReasons: RepossessionReturnReason[];
  valuation: TableBaseHint | null;
  deviationPct: number | null;
  outstandingBalance: string;
}

export interface DeviceReturnListQuery {
  status?: DeviceReturnStatus;
  contractId?: string;
  branchId?: string;
  page?: number;
  limit?: number;
}

const LOOKUP_MIN_LENGTH = 3;
const LOOKUP_TAKE = 20;
const AWAITING_TAKE = 100;

/**
 * ใบรับเครื่องคืน (spec docs/superpowers/specs/2026-09-20-device-return-intake-design.md §5).
 *
 * สาขาบันทึก (create) → สัญญาหยุดทันทีเมื่อคืนเอง (D4) → FINANCE ยืนยัน (confirm → RepossessionsService.createInTx
 * ลง JP5 + ขาคู่ SHOP typed DEVICE_RETURN) / ส่งกลับ (reject) / สาขายกเลิก (cancel). งานรอบข้างทุกตัว
 * (audit ผ่าน AuditService.log, tag, journey, ไลน์, ส่ง CN) ทำ **หลัง commit** และ best-effort — ห้ามทำให้
 * การรับเครื่อง/การยืนยันล้ม (doctrine R-1). ยกเว้น audit CONTRACT_STATUS_LEGAL ที่เขียนใน tx ด้วย
 * tx.auditLog.create เพราะต้อง atomic กับการ flip สถานะสัญญา (แถวนั้นหลุด Merkle chain โดยตั้งใจ —
 * pattern เดียวกับ contract-letter.service.ts:256-267).
 *
 * ขอบเขตสาขา (spec §9): route `/:id` BranchGuard ไม่ครอบ — BM/SALES อ่านได้เฉพาะใบที่ receivingBranchId
 * = user.branchId (404 ไม่ leak); create ผูก receivingBranchId = user.branchId (OWNER ระบุใน body);
 * ไม่มี branchId = 403 fail-closed. preview/lookup **ไม่จำกัดสาขา** (D7 รับเครื่องได้ทุกสาขา).
 */
@Injectable()
export class DeviceReturnsService {
  private readonly logger = new Logger(DeviceReturnsService.name);
  /** ตารางรับซื้อ — สร้างภายในเหมือน RepossessionsService (พึ่งแค่ PrismaService) */
  private readonly valuationService = new TradeInValuationService(this.prisma);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repossessions: RepossessionsService,
    private readonly numberService: DeviceReturnNumberService,
    private readonly notify: DeviceReturnNotifyService,
    private readonly customerTags: CustomerTagsService,
    private readonly journey: JourneyEntryWriter,
    private readonly audit: AuditService,
    private readonly cnDelivery: CreditNoteDeliveryService,
  ) {}

  // ───────────────────────────── preview / lookup ─────────────────────────────

  async preview(
    query: { contractId: string; conditionGrade?: string; appraisalPrice?: number },
    _user: RequestUser,
  ): Promise<DeviceReturnPreview> {
    // D7: สาขาใดรับเครื่องได้หมด — ไม่ scope สัญญาตามสาขาผู้ดู
    const contract = await this.prisma.contract.findUnique({
      where: { id: query.contractId },
      include: CONTRACT_INCLUDE,
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const kind = deriveReturnKind(contract.status);
    const check = await this.evaluateEligibility(this.prisma, contract, kind);
    const valuation = query.conditionGrade
      ? await lookupTableBase(this.valuationService, contract.product, query.conditionGrade)
      : null;
    const table =
      valuation?.found && valuation.suggestedPrice != null && valuation.suggestedPrice > 0
        ? d(valuation.suggestedPrice)
        : null;
    const deviationPct =
      table && query.appraisalPrice != null
        ? d(query.appraisalPrice).sub(table).div(table).abs().mul(100).toDecimalPlaces(1).toNumber()
        : null;

    return {
      contract: {
        id: contract.id,
        contractNumber: contract.contractNumber,
        status: contract.status,
        customer: contract.customer,
        product: {
          id: contract.product.id,
          brand: contract.product.brand,
          model: contract.product.model,
          storage: contract.product.storage,
          imeiSerial: contract.product.imeiSerial,
        },
        branch: contract.branch,
      },
      returnKind: kind,
      eligibility: check.ok ? { canCreate: true, reason: null } : { canCreate: false, reason: check.reason },
      allowedReasons: allowedReasonsFor(kind),
      valuation,
      deviationPct,
      outstandingBalance: outstandingOf(contract.payments).toFixed(2),
    };
  }

  /** ค้นสัญญาด้วยเลขสัญญา / เบอร์ / IMEI — รายการสั้น ไม่มีเบอร์ในผลลัพธ์ (spec §5.0) */
  async lookup(q: string, _user: RequestUser) {
    const term = (q ?? '').trim();
    if (term.length < LOOKUP_MIN_LENGTH) return [];
    const rows = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        OR: [
          { contractNumber: { contains: term, mode: 'insensitive' } },
          { customer: { phone: { contains: term } } },
          { product: { imeiSerial: { contains: term, mode: 'insensitive' } } },
        ],
      },
      take: LOOKUP_TAKE,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        customer: { select: { id: true, name: true } },
        product: { select: { id: true, brand: true, model: true, imeiSerial: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      contractNumber: r.contractNumber,
      status: r.status,
      customer: { id: r.customer.id, name: r.customer.name },
      product: r.product
        ? { id: r.product.id, brand: r.product.brand, model: r.product.model, imeiSerial: r.product.imeiSerial }
        : null,
      branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    }));
  }

  // ───────────────────────────── create (สาขา) ─────────────────────────────

  async create(dto: CreateDeviceReturnDto, user: RequestUser): Promise<DeviceReturnRow> {
    const deviceReceivedAt = new Date(dto.deviceReceivedAt);
    if (Number.isNaN(deviceReceivedAt.getTime())) {
      throw new BadRequestException('กรุณาระบุวันที่รับเครื่อง');
    }
    if (isFutureBkkDay(deviceReceivedAt)) {
      throw new BadRequestException('วันที่รับเครื่องต้องไม่เป็นวันในอนาคต');
    }
    const receivingBranchId = await this.resolveReceivingBranch(dto.receivingBranchId, user);

    const created = await this.prisma
      .$transaction(async (tx) => {
        const contract = await tx.contract.findUnique({
          where: { id: dto.contractId },
          include: CONTRACT_INCLUDE,
        });
        if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

        const kind = deriveReturnKind(contract.status);
        const check = await this.evaluateEligibility(tx, contract, kind);
        if (!check.ok) {
          throw check.code === 'CONFLICT'
            ? new ConflictException(check.reason)
            : new BadRequestException(check.reason);
        }
        // kind ไม่ null แล้ว (evaluateEligibility ปฏิเสธ null ด้วย NOT_RETURNABLE_MSG)
        const returnKind = kind as DeviceReturnKind;
        const returnReason = this.resolveReturnReason(returnKind, dto.returnReason, dto.notes);

        const appraisal = d(dto.appraisalPrice);
        if (appraisal.lte(0)) {
          throw new BadRequestException('กรุณาระบุราคาประเมินมากกว่า 0 บาท');
        }
        // ตารางรับซื้อเป็นตัวเทียบ ±15% (ชุดเดียวกับ createInTx / หน้ารับซื้อ) — snapshot ไว้บนใบ
        const table = await lookupTableBase(this.valuationService, contract.product, dto.conditionGrade);
        const tableBase =
          table?.found && table.suggestedPrice != null ? d(table.suggestedPrice) : null;
        if (tableBase && tableBase.gt(0)) {
          const deviation = appraisal.sub(tableBase).div(tableBase).abs();
          if (deviation.gt(RepossessionsService.TABLE_DEVIATION_LIMIT) && !dto.notes?.trim()) {
            throw new BadRequestException(
              `ราคาประเมิน ${appraisal.toFixed(2)} ฿ ต่างจากตารางรับซื้อ (เกรด ${dto.conditionGrade}: ${tableBase.toFixed(2)} ฿) ` +
                `${deviation.mul(100).toDecimalPlaces(0)}% เกิน 15% — กรุณาระบุเหตุผลในหมายเหตุ`,
            );
          }
        }

        const docNumber = await this.numberService.next(tx);
        const row = await tx.deviceReturn.create({
          data: {
            docNumber,
            contractId: contract.id,
            productId: contract.productId,
            customerId: contract.customerId,
            receivingBranchId,
            receivedById: user.id,
            returnKind,
            returnReason,
            deviceReceivedAt,
            conditionGrade: dto.conditionGrade,
            appraisalPrice: appraisal,
            tableBasePrice: tableBase,
            repairCost: d(dto.repairCost ?? 0),
            notes: dto.notes?.trim() || null,
            // เฉพาะคืนเอง — ใช้คืนสถานะเมื่อส่งกลับ/ยกเลิก (spec §4.1)
            previousContractStatus: returnKind === 'VOLUNTARY' ? contract.status : null,
            status: 'PENDING_CONFIRM',
          },
          include: DEVICE_RETURN_LIST_INCLUDE,
        });

        if (returnKind === 'VOLUNTARY') {
          // D4: สัญญาหยุดทันทีที่รับเครื่องคืน — TERMINATED ให้ accrual/ค่าปรับ/จดหมาย/ทวงถามหยุดเอง
          // (ไม่ยิง dunning event CONTRACT_TERMINATED — ข้อความนั้นสำหรับบอกเลิกฝ่ายเดียว)
          await tx.contract.update({ where: { id: contract.id }, data: { status: 'TERMINATED' } });
          // audit ใน tx — atomic กับการ flip (rollback แล้วต้องไม่เหลือแถว); หลุด Merkle chain โดยตั้งใจ
          // pattern contract-letter.service.ts:256-267
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: 'CONTRACT_STATUS_LEGAL',
              entity: 'contract',
              entityId: contract.id,
              newValue: {
                from: contract.status,
                to: 'TERMINATED',
                reason: 'DEVICE_RETURN_INTAKE',
                deviceReturnId: row.id,
                docNumber,
              },
            },
          });
        }

        return {
          id: row.id,
          docNumber,
          contractNumber: contract.contractNumber,
          customerId: contract.customerId,
          returnKind,
          returnReason,
          conditionGrade: dto.conditionGrade,
          appraisal,
          tableBase,
          receivingBranchId,
        };
      })
      .catch((err: unknown) => {
        // ตาข่าย partial unique device_returns_one_open_per_contract — แพ้ race → 409 ไทย ไม่ใช่ raw 500
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(PENDING_EXISTS_MSG);
        }
        throw err;
      });

    // หลัง commit (ลำดับตาม spec §5.1) — ทุกตัว best-effort
    await this.audit.log({
      userId: user.id,
      action: 'DEVICE_RETURN_CREATED',
      entity: 'device_return',
      entityId: created.id,
      newValue: {
        docNumber: created.docNumber,
        contractNumber: created.contractNumber,
        returnKind: created.returnKind,
        returnReason: created.returnReason,
        conditionGrade: created.conditionGrade,
        appraisalPrice: created.appraisal.toFixed(2),
        tableBasePrice: created.tableBase ? created.tableBase.toFixed(2) : null,
        receivingBranchId: created.receivingBranchId,
      },
    });
    await this.recomputeTags(created.customerId);
    await this.notify.notify(created.id, 'DEVICE_RETURNED');

    return this.findRow(created.id);
  }

  // ───────────────────────────── list / findOne / awaiting ─────────────────────────────

  async list(
    query: DeviceReturnListQuery,
    user: RequestUser,
  ): Promise<{ data: DeviceReturnRow[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(200, Math.max(1, query.limit || 50));
    const where: Prisma.DeviceReturnWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.contractId) where.contractId = query.contractId;

    const scope = getBranchScope(user);
    if (!scope.all) {
      // BM/SALES เห็นเฉพาะใบที่สาขาตัวเองรับ — ไม่สน branchId จาก client; ไม่มีสาขา = หน้าว่าง
      if (!scope.branchId) return { data: [], total: 0, page, limit };
      where.receivingBranchId = scope.branchId;
    } else if (query.branchId) {
      where.receivingBranchId = query.branchId;
    }

    const [rows, total] = await Promise.all([
      this.prisma.deviceReturn.findMany({
        where,
        include: DEVICE_RETURN_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.deviceReturn.count({ where }),
    ]);
    return { data: await this.toRows(rows), total, page, limit };
  }

  async findOne(id: string, user: RequestUser): Promise<DeviceReturnRow> {
    const row = await this.loadScoped(id, user);
    return (await this.toRows([row]))[0];
  }

  /** รายการ "รอยึดเครื่อง" (spec §5.7): TERMINATED ที่ยังไม่มีแถวยึดและไม่มีใบ PENDING_CONFIRM */
  async awaitingRepossession(user: RequestUser) {
    const where: Prisma.ContractWhereInput = {
      deletedAt: null,
      status: 'TERMINATED',
      repossession: null,
      deviceReturns: { none: { status: 'PENDING_CONFIRM', deletedAt: null } },
    };
    const scope = getBranchScope(user);
    if (!scope.all) {
      if (!scope.branchId) return { data: [], total: 0 };
      where.branchId = scope.branchId;
    }
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: AWAITING_TAKE,
        select: {
          id: true,
          contractNumber: true,
          status: true,
          monthlyPayment: true,
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, brand: true, model: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.contract.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        id: r.id,
        contractNumber: r.contractNumber,
        status: r.status,
        monthlyPayment: d(r.monthlyPayment).toFixed(2),
        customer: { id: r.customer.id, name: r.customer.name, phone: r.customer.phone ?? '' },
        product: r.product
          ? { id: r.product.id, name: r.product.name, brand: r.product.brand, model: r.product.model }
          : null,
        branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
      })),
      total,
    };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  /**
   * ด่าน 2-6 ของ spec §5.1 — ใช้ทั้ง preview (คืนเหตุผล) และ create (โยน 400/409).
   * ลำดับคงที่: สถานะ → ยอดค้าง → เครื่องเคยยึด → ใบ PENDING ซ้ำ → คำขอเปลี่ยนเครื่อง/ยกเลิกค้าง
   */
  private async evaluateEligibility(
    client: Prisma.TransactionClient | PrismaService,
    contract: EligibilityContract,
    kind: DeviceReturnKind | null,
  ): Promise<EligibilityCheck> {
    if (!kind) return { ok: false, reason: NOT_RETURNABLE_MSG, code: 'BAD_REQUEST' };
    if (outstandingOf(contract.payments).lte(0)) {
      return { ok: false, reason: ZERO_OUTSTANDING_MSG, code: 'BAD_REQUEST' };
    }
    if (contract.product.status === 'REPOSSESSED') {
      return { ok: false, reason: RE_REPOSSESSION_MSG, code: 'CONFLICT' };
    }
    const prior = await client.repossession.findFirst({
      where: { productId: contract.productId, deletedAt: null },
      select: { id: true },
    });
    if (prior) return { ok: false, reason: RE_REPOSSESSION_MSG, code: 'CONFLICT' };
    const open = await client.deviceReturn.findFirst({
      where: { contractId: contract.id, status: 'PENDING_CONFIRM', deletedAt: null },
      select: { id: true, docNumber: true },
    });
    if (open) return { ok: false, reason: PENDING_EXISTS_MSG, code: 'CONFLICT' };
    const pendingExchange = await client.contractExchangeRequest.count({
      where: { oldContractId: contract.id, status: 'PENDING', deletedAt: null },
    });
    if (pendingExchange > 0) return { ok: false, reason: PENDING_REQUEST_MSG, code: 'BAD_REQUEST' };
    const pendingCancellation = await client.contractCancellation.count({
      where: { contractId: contract.id, status: 'PENDING', deletedAt: null },
    });
    if (pendingCancellation > 0) {
      return { ok: false, reason: PENDING_REQUEST_MSG, code: 'BAD_REQUEST' };
    }
    return { ok: true };
  }

  /** spec §5.1 ข้อ 2 — เหตุผลต้องตรงประเภท; TERMINATED ไม่ส่งมา = AFTER_TERMINATION; OTHER ต้องมี notes */
  private resolveReturnReason(
    kind: DeviceReturnKind,
    reason: RepossessionReturnReason | undefined,
    notes: string | undefined,
  ): RepossessionReturnReason {
    if (reason != null && !Object.prototype.hasOwnProperty.call(REPOSSESSION_RETURN_REASONS, reason)) {
      throw new BadRequestException('กรุณาเลือกเหตุผลคืนเครื่องที่ถูกต้อง');
    }
    if (kind === 'REPOSSESSION') {
      if (reason && reason !== 'AFTER_TERMINATION') {
        throw new BadRequestException(
          `สัญญาที่บอกเลิกแล้วต้องใช้เหตุผล "${REPOSSESSION_RETURN_REASONS.AFTER_TERMINATION}"`,
        );
      }
      return 'AFTER_TERMINATION';
    }
    if (!reason) throw new BadRequestException('กรุณาเลือกเหตุผลคืนเครื่อง');
    if (!VOLUNTARY_REASONS.includes(reason)) {
      throw new BadRequestException(
        'เหตุผลคืนเครื่องไม่ตรงกับประเภท — สัญญาที่ยังเดินอยู่ใช้ได้เฉพาะ "ผ่อนต่อไม่ไหว" "ไม่ประสงค์ใช้ต่อ" หรือ "อื่น ๆ"',
      );
    }
    if (reason === 'OTHER' && !notes?.trim()) {
      throw new BadRequestException('กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง');
    }
    return reason;
  }

  /** D7: สาขาที่รับ = user.branchId (BM/SALES fail-closed 403) · OWNER ระบุใน body (ต้องมีจริง) */
  private async resolveReceivingBranch(bodyBranchId: string | undefined, user: RequestUser) {
    const scope = getBranchScope(user);
    if (!scope.all) {
      if (!scope.branchId) {
        throw new ForbiddenException('ผู้ใช้ไม่ได้สังกัดสาขา — บันทึกรับเครื่องคืนไม่ได้');
      }
      return scope.branchId;
    }
    if (!bodyBranchId) throw new BadRequestException('กรุณาระบุสาขาที่รับเครื่อง');
    const branch = await this.prisma.branch.findFirst({
      where: { id: bodyBranchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('ไม่พบสาขาที่รับเครื่อง');
    return branch.id;
  }

  /** โหลดใบ + ขอบเขตสาขา (BM/SALES → 404 เมื่อไม่ใช่ใบของสาขาตัวเอง — ไม่ leak ว่ามีอยู่) */
  private async loadScoped(id: string, user: RequestUser): Promise<DeviceReturnWithRelations> {
    const row = await this.prisma.deviceReturn.findFirst({
      where: { id, deletedAt: null },
      include: DEVICE_RETURN_LIST_INCLUDE,
    });
    if (!row) throw new NotFoundException(NOT_FOUND_MSG);
    const scope = getBranchScope(user);
    if (!scope.all && (!scope.branchId || row.receivingBranchId !== scope.branchId)) {
      throw new NotFoundException(NOT_FOUND_MSG);
    }
    return row;
  }

  private async findRow(id: string): Promise<DeviceReturnRow> {
    const row = await this.prisma.deviceReturn.findUniqueOrThrow({
      where: { id },
      include: DEVICE_RETURN_LIST_INCLUDE,
    });
    return (await this.toRows([row]))[0];
  }

  /** แถวตอบกลับ — confirmedBy หาชื่อจาก users แบบ batch (ไม่มี relation บนคอลัมน์ confirmedById) */
  private async toRows(rows: DeviceReturnWithRelations[]): Promise<DeviceReturnRow[]> {
    const confirmerIds = [
      ...new Set(rows.map((r) => r.confirmedById).filter((x): x is string => !!x)),
    ];
    const confirmers = confirmerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: confirmerIds } },
          select: { id: true, name: true },
        })
      : [];
    const byId = new Map(confirmers.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      docNumber: r.docNumber,
      status: r.status,
      returnKind: r.returnKind,
      returnReason: r.returnReason,
      deviceReceivedAt: r.deviceReceivedAt,
      conditionGrade: r.conditionGrade,
      appraisalPrice: d(r.appraisalPrice).toFixed(2),
      tableBasePrice: r.tableBasePrice != null ? d(r.tableBasePrice).toFixed(2) : null,
      repairCost: d(r.repairCost).toFixed(2),
      notes: r.notes,
      lineNotifyStatus: r.lineNotifyStatus,
      lineNotifiedAt: r.lineNotifiedAt,
      receivingBranch: r.receivingBranch,
      receivedBy: r.receivedBy,
      contract: r.contract,
      confirmedAt: r.confirmedAt,
      confirmedBy: r.confirmedById ? (byId.get(r.confirmedById) ?? null) : null,
      repossessionId: r.repossessionId,
      rejectReason: r.rejectReason,
      createdAt: r.createdAt,
    }));
  }

  /** tag RETURNED_DEVICE เป็นกฎใน CustomerTagsService (spec §5.6) — เรียก recompute หลัง commit, best-effort */
  private async recomputeTags(customerId: string): Promise<void> {
    try {
      await this.customerTags.recomputeForCustomer(customerId);
    } catch (err) {
      this.logger.warn(
        `[device-return] recompute tag ของลูกค้า ${customerId} ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`,
      );
      Sentry.captureException(err, { tags: { ...SENTRY_TAGS, step: 'recompute-tags' } });
    }
  }
}
```

หมายเหตุสำหรับผู้ทำ: `journey` และ `cnDelivery` ยังไม่ถูกใช้ในไฟล์นี้จนกว่า Task 8 — TypeScript ไม่ error กับ private field ที่ไม่ถูกอ่านใน constructor-parameter-property (`noUnusedLocals` ไม่ได้เปิดใน `apps/api/tsconfig.json`).

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-returns.service.spec.ts`
Expected: PASS (deriveReturnKind 1, preview 5, lookup 2, create 11, list/findOne/awaiting 4 = 23 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 8: Journey kind `DEVICE_RETURNED` (shared + zod whitelist + entries.source) — ต้องมาก่อน Task 9 เพราะ `JourneyEntryInput.kind` เป็น union ของ shared และ writer ปฏิเสธ kind ที่ไม่รู้จัก

**Files:**
- Modify: `packages/shared/src/customer-journey.ts:33-45` (`JOURNEY_ENTRY_KINDS.SYSTEM`)
- Test: `packages/shared/src/customer-journey.spec.ts:36-56`
- Modify: `apps/api/src/modules/customer-journey/journey-data-schemas.ts:44-70` (`JOURNEY_DATA_SCHEMAS`)
- Test: `apps/api/src/modules/customer-journey/journey-data-schemas.spec.ts:7-17` (`HOOK_DATA`)
- Modify: `apps/api/src/modules/customer-journey/journey-entry-writer.service.db.spec.ts:23-33` (`HOOK_DATA` — DB spec, ต้องคอมไพล์ผ่าน)
- Modify: `apps/api/src/modules/customer-journey/sources/entries.source.ts:15-28` (`VIEWS`), `:33` (`TAG_LABELS`)
- Test: `apps/api/src/modules/customer-journey/sources/entries.source.spec.ts:50`

**Interfaces:**
- Consumes: `journeyDedupeKey(kind, ...parts)` (`journey-data-schemas.ts`), `JourneyEntryWriter.recordAfterCommit`
- Produces: `'DEVICE_RETURNED' ∈ JOURNEY_ENTRY_KINDS.SYSTEM` (ตำแหน่งถัดจาก `'CONTRACT_REVIEWED'`), schema `DEVICE_RETURNED: z.object({ docNumber: z.string().max(20), contractNumber, returnKind: z.enum(['VOLUNTARY','REPOSSESSION']), returnReason: z.enum(['UNAFFORDABLE','NO_LONGER_NEEDED','AFTER_TERMINATION','OTHER']) })`, VIEWS `DEVICE_RETURNED: { group: 'sale', stage: null, title: 'คืนเครื่อง' }`, `TAG_LABELS.RETURNED_DEVICE = 'เคยคืนเครื่อง'` (สอดคล้องกับที่ Phase 3 เว็บใช้ — เว็บไม่มีตารางป้ายต่อ kind, render `event.title` จาก API)

- [ ] **Step 1: แก้เทสให้ล้มก่อน (3 ไฟล์)**

(ก) `packages/shared/src/customer-journey.spec.ts` — เทส `'ชนิดแถว SYSTEM 9 · MANUAL 4 …'` (origin/main:36-56): เปลี่ยนชื่อเป็น `'ชนิดแถว SYSTEM 10 · MANUAL 4 ไม่ซ้ำกัน และยาวไม่เกิน kind VARCHAR(40)'` และรายการที่คาดเป็น:

```ts
    expect(JOURNEY_ENTRY_KINDS.SYSTEM).toEqual([
      'CONTRACT_ACTIVATED',
      'CONTRACT_REVIEWED',
      'DEVICE_RETURNED',
      'CREDIT_CHECK_OPENED_BY',
      'CREDIT_AI_SCORED',
      'BOT_HANDOFF',
      'CONTACT_ADDED',
      'LINE_LINKED',
      'PRODUCT_LINK_CLICK',
      'PLACEHOLDER_MERGED',
    ]);
```
และใน `cases` ของเทส `journeyEntryOriginOf` เพิ่ม `['DEVICE_RETURNED', 'SYSTEM'],`

(ข) `apps/api/src/modules/customer-journey/journey-data-schemas.spec.ts` — `HOOK_DATA` (origin/main:7-17) เพิ่มบรรทัดถัดจาก `CONTRACT_REVIEWED: …`:

```ts
  DEVICE_RETURNED: { docNumber: 'DR-20260920-0001', contractNumber: 'BCP2609-00042', returnKind: 'VOLUNTARY', returnReason: 'UNAFFORDABLE' },
```
และเพิ่มเทสใหม่ท้าย `describe('JOURNEY_DATA_SCHEMAS', …)`:

```ts
  it('DEVICE_RETURNED: รับเฉพาะเลขใบ/เลขสัญญา/รหัสปิด — ราคาประเมิน เกรด หมายเหตุ เบอร์ ถูกตัดทิ้ง; รหัสนอกรายการ → ไม่ผ่าน', () => {
    expect(
      sanitizeJourneyData('DEVICE_RETURNED', {
        docNumber: 'DR-20260920-0001',
        contractNumber: 'BCP2609-00042',
        returnKind: 'REPOSSESSION',
        returnReason: 'AFTER_TERMINATION',
        appraisalPrice: 7000,
        conditionGrade: 'B',
        notes: 'จอแตก โทร 0812345678',
      }),
    ).toEqual({
      ok: true,
      data: { docNumber: 'DR-20260920-0001', contractNumber: 'BCP2609-00042', returnKind: 'REPOSSESSION', returnReason: 'AFTER_TERMINATION' },
    });
    expect(sanitizeJourneyData('DEVICE_RETURNED', { docNumber: 'DR-1', contractNumber: 'BCP2609-00042', returnKind: 'VOLUNTARY', returnReason: 'ขี้เกียจผ่อน' }).ok).toBe(false);
    expect(journeyDedupeKey('DEVICE_RETURNED', 'dr-1')).toBe('DEVICE_RETURNED:dr-1');
  });
```

(ค) `apps/api/src/modules/customer-journey/sources/entries.source.spec.ts` บรรทัด 50 — รายการ `where.kind.in` เป็น:

```ts
    expect(args.where.kind).toEqual({ in: ['CONTRACT_ACTIVATED', 'CONTRACT_REVIEWED', 'DEVICE_RETURNED', 'CREDIT_AI_SCORED', 'BOT_HANDOFF', 'CONTACT_ADDED', 'LINE_LINKED', 'PRODUCT_LINK_CLICK', 'PLACEHOLDER_MERGED', 'TOUCHPOINT', 'HEARD_FROM', 'MARKED_LOST', 'REOPENED'] });
```
(รายการที่บรรทัด 73 — กลุ่ม chat อย่างเดียว — ไม่เปลี่ยน เพราะ kind ใหม่อยู่กลุ่ม sale)

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `cd packages/shared && npx vitest run src/customer-journey.spec.ts; cd ../.. && npm --prefix apps/api test -- src/modules/customer-journey/journey-data-schemas.spec.ts src/modules/customer-journey/sources/entries.source.spec.ts`
Expected: FAIL — shared: `expected [ 'CONTRACT_ACTIVATED', … ] to deeply equal …`; api: `kind:unknown` / `expected { in: […] } to deeply equal …`

- [ ] **Step 3: แก้ shared**

`packages/shared/src/customer-journey.ts` — ใน `JOURNEY_ENTRY_KINDS.SYSTEM` เพิ่ม `'DEVICE_RETURNED',` ถัดจาก `'CONTRACT_REVIEWED',` และเติมคอมเมนต์เหนือ const:

```ts
/**
 * ชนิดแถวของ customer_journey_entries.kind แยกตาม origin
 * SYSTEM = ช่วงเวลาที่ตารางต้นทางเขียนทับจนหาย (เขียนหลัง commit ด้วย dedupe_key) · MANUAL = บันทึกมือ (เฟส 3)
 * DEVICE_RETURNED (2026-09-20) = FINANCE ยืนยันใบรับเครื่องคืน — เขียนที่ DeviceReturnsService.confirm, data = เลขใบ/เลขสัญญา/รหัสปิดเท่านั้น
 */
```

- [ ] **Step 4: แก้ zod whitelist**

`apps/api/src/modules/customer-journey/journey-data-schemas.ts` — เพิ่มค่าคงที่ถัดจาก `CREDIT_AI_STATUSES`:

```ts
/** ใบรับเครื่องคืน (spec 2026-09-20 §5.6) — รหัสปิดของ DeviceReturnKind + REPOSSESSION_RETURN_REASONS; ห้ามราคา/เกรด/หมายเหตุ */
export const DEVICE_RETURN_KINDS = ['VOLUNTARY', 'REPOSSESSION'] as const;
export const DEVICE_RETURN_REASONS = ['UNAFFORDABLE', 'NO_LONGER_NEEDED', 'AFTER_TERMINATION', 'OTHER'] as const;
```
และใน `JOURNEY_DATA_SCHEMAS` ถัดจาก `CONTRACT_REVIEWED: …,` เพิ่ม:

```ts
  DEVICE_RETURNED: z.object({
    docNumber: z.string().max(20),
    contractNumber,
    returnKind: z.enum(DEVICE_RETURN_KINDS),
    returnReason: z.enum(DEVICE_RETURN_REASONS),
  }),
```

`apps/api/src/modules/customer-journey/journey-entry-writer.service.db.spec.ts` — `HOOK_DATA` (origin/main:23-33) เพิ่มถัดจาก `CONTRACT_REVIEWED: …`:

```ts
  DEVICE_RETURNED: { docNumber: 'DR-20260920-0001', contractNumber: 'BCP2609-00042', returnKind: 'REPOSSESSION', returnReason: 'AFTER_TERMINATION' },
```

- [ ] **Step 5: แก้ entries.source**

`apps/api/src/modules/customer-journey/sources/entries.source.ts`:
- ใน `VIEWS` (origin/main:15-28) เพิ่มบรรทัดถัดจาก `CONTRACT_REVIEWED: …,`:
```ts
  DEVICE_RETURNED: { group: 'sale', stage: null, title: 'คืนเครื่อง' },
```
- บรรทัด 33 `TAG_LABELS` เพิ่ม `RETURNED_DEVICE: 'เคยคืนเครื่อง'` ท้าย object (ชุดเดียวกับ `CustomerTagChips.tsx` META ที่ Phase 3 เพิ่ม):
```ts
const TAG_LABELS: Record<string, string> = { VIP: 'VIP', HIGH_RISK: 'เสี่ยงสูง', NEW: 'ลูกค้าใหม่', LOYAL: 'ลูกค้าประจำ', BLACKLIST: 'BLACKLIST', RETURNED_DEVICE: 'เคยคืนเครื่อง' };
```

- [ ] **Step 6: รันเทสให้ผ่าน**

Run: `npm run build --workspace=@installment/shared && cd packages/shared && npx vitest run src/customer-journey.spec.ts; cd ../.. && npm --prefix apps/api test -- src/modules/customer-journey/journey-data-schemas.spec.ts src/modules/customer-journey/sources/entries.source.spec.ts`
Expected: PASS ทั้ง 3 ไฟล์ (build shared ก่อน — api resolve `@installment/shared` จาก dist)

- [ ] **Step 7: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors (`Record<ShownKind, …>` และ `Record<JourneySystemEntryKind, …>` ครบทุก kind). **Do NOT commit** (see Global Constraints).

---

### Task 9: `DeviceReturnsService` — `confirm` / `reject` / `cancel` / `resendLine`

**Files:**
- Modify: `apps/api/src/modules/device-returns/device-returns.service.ts` (imports + เพิ่ม 4 public method + 1 private ก่อน `// ───────────────────────────── helpers`)
- Test: `apps/api/src/modules/device-returns/device-returns.service.spec.ts` (เพิ่ม describe)

**Interfaces:**
- Consumes: Task 4 `assertRepossessionPeriodsOpen` / `createInTx` / `RE_REPOSSESSION_MSG`, Task 8 kind `DEVICE_RETURNED` + `journeyDedupeKey`, Task 6 `notify`, Task 5 DTOs
- Produces: `confirm(id, dto: ConfirmDeviceReturnDto, user): Promise<DeviceReturnRow & { creditNote: { outcome: string; receiptId?: string } | null }>`, `reject(id, dto: RejectDeviceReturnDto, user): Promise<DeviceReturnRow & { notice: string | null }>`, `cancel(id, user): Promise<DeviceReturnRow & { notice: string | null }>`, `resendLine(id, user): Promise<DeviceReturnRow>`; audit actions `DEVICE_RETURN_CONFIRMED` / `DEVICE_RETURN_REJECTED` / `DEVICE_RETURN_CANCELED` / `DEVICE_RETURN_LINE_RESENT` (entity `device_return`), `CONTRACT_STATUS_LEGAL` reason `DEVICE_RETURN_REJECTED` / `DEVICE_RETURN_CANCELED` (ใน tx)

- [ ] **Step 1: เพิ่มเทสที่ล้มก่อน**

ใน `device-returns.service.spec.ts` เพิ่ม describe ท้ายไฟล์ (ก่อน `});` ปิด `describe('DeviceReturnsService')`):

```ts
  describe('confirm (FINANCE)', () => {
    const pending = () => makeReturnRow();

    it('PENDING → createInTx ด้วยข้อมูลจากใบ (เกรด/ราคา/วันรับ/ผู้ตรวจ/สาขา/deviceReturnId + company ids), CAS → CONFIRMED, หลัง commit audit/journey/tag/ส่ง CN', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(makeReturnRow({ status: 'CONFIRMED', confirmedById: 'fm-1', repossessionId: 'repo-1' }));
      prisma.user.findMany.mockResolvedValue([{ id: 'fm-1', name: 'ผจก.การเงิน' }]);

      const result = await service.confirm('dr-1', { discountPct: 40 }, FM as never);

      expect(repossessions.assertRepossessionPeriodsOpen).toHaveBeenCalledWith(expect.any(Date));
      expect(repossessions.createInTx).toHaveBeenCalledWith(
        prisma, // tx
        {
          contractId: 'contract-1',
          repossessedDate: new Date('2026-09-20T03:00:00.000Z'),
          paymentDate: expect.any(Date),
          conditionGrade: 'B',
          appraisalPrice: 6000,
          repairCost: 0,
          notes: undefined,
          returnReason: 'UNAFFORDABLE',
          discountPct: 40,
          appraisedById: 'sales-a',
          receivingBranchId: 'branch-a',
          deviceReturnId: 'dr-1',
          financeCompanyId: 'company-finance',
          shopCompanyId: 'company-shop',
        },
        'fm-1',
      );
      expect(prisma.deviceReturn.updateMany).toHaveBeenCalledWith({
        where: { id: 'dr-1', status: 'PENDING_CONFIRM' },
        data: { status: 'CONFIRMED', confirmedById: 'fm-1', confirmedAt: expect.any(Date), repossessionId: 'repo-1' },
      });
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      expect(audit.log.mock.invocationCallOrder[0]).toBeGreaterThan(txOrder);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'fm-1',
          action: 'DEVICE_RETURN_CONFIRMED',
          entity: 'device_return',
          entityId: 'dr-1',
          newValue: expect.objectContaining({ docNumber: 'DR-20260920-0001', repossessionId: 'repo-1', outstandingBalance: '2100.00', creditNote: 'ISSUED' }),
        }),
      );
      expect(journey.recordAfterCommit).toHaveBeenCalledWith({
        customerId: 'cust-1',
        kind: 'DEVICE_RETURNED',
        occurredAt: new Date('2026-09-20T03:00:00.000Z'),
        actorType: 'STAFF',
        actorUserId: 'fm-1',
        refType: 'contract',
        refId: 'contract-1',
        data: { docNumber: 'DR-20260920-0001', contractNumber: 'BCP2609-00042', returnKind: 'VOLUNTARY', returnReason: 'UNAFFORDABLE' },
        dedupeKey: 'DEVICE_RETURNED:dr-1',
      });
      expect(tags.recomputeForCustomer).toHaveBeenCalledWith('cust-1');
      expect(cnDelivery.deliver).toHaveBeenCalledWith('r1');
      expect(cnDelivery.deliver.mock.invocationCallOrder[0]).toBeGreaterThan(txOrder);
      expect(notify.notify).not.toHaveBeenCalled(); // ยืนยันไม่ส่งไลน์ซ้ำ — ลูกค้าได้ CN ทางไลน์จาก create path อยู่แล้ว
      expect(result).toMatchObject({ status: 'CONFIRMED', repossessionId: 'repo-1', confirmedBy: { id: 'fm-1', name: 'ผจก.การเงิน' }, creditNote: { outcome: 'ISSUED', receiptId: 'r1' } });
    });

    it('paymentDate จาก dto ถูกส่งเข้า assertRepossessionPeriodsOpen และ createInTx; period guard throw → ไม่เปิด tx', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      repossessions.assertRepossessionPeriodsOpen.mockRejectedValueOnce(new BadRequestException('วันที่รับเงินต้องไม่เป็นวันในอนาคต'));
      await expect(service.confirm('dr-1', { paymentDate: '2099-01-01' }, FM as never)).rejects.toThrow(/อนาคต/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ใบไม่ใช่ PENDING → 409 CLOSED_MSG ก่อน period guard; ใบไม่พบ → 404', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ status: 'REJECTED' }));
      await expect(service.confirm('dr-1', {}, FM as never)).rejects.toThrow('ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว');
      expect(repossessions.assertRepossessionPeriodsOpen).not.toHaveBeenCalled();
      prisma.deviceReturn.findFirst.mockResolvedValue(null);
      await expect(service.confirm('missing', {}, FM as never)).rejects.toThrow(NotFoundException);
    });

    it('CAS แพ้ (count 0 — อีกคนยืนยันก่อน) → 409 และ rollback (throw ออกจาก tx)', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      prisma.deviceReturn.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.confirm('dr-1', {}, FM as never)).rejects.toThrow(ConflictException);
      expect(audit.log).not.toHaveBeenCalled();
      expect(cnDelivery.deliver).not.toHaveBeenCalled();
    });

    it('createInTx โยน (เช่น ยอดค้าง 0 เพราะ webhook จ่ายหมดระหว่างรอ) → error เดิมทะลุออก ไม่มี post-commit', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      repossessions.createInTx.mockRejectedValueOnce(new BadRequestException('สัญญานี้ไม่มียอดค้างชำระ'));
      await expect(service.confirm('dr-1', {}, FM as never)).rejects.toThrow(/ไม่มียอดค้างชำระ/);
      expect(prisma.deviceReturn.updateMany).not.toHaveBeenCalled();
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });

    it('P2002 ใน tx (แพ้ race ของ Repossession.productId unique) → 409 RE_REPOSSESSION_MSG', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      repossessions.createInTx.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.confirm('dr-1', {}, FM as never)).rejects.toThrow(/เคยถูกยึดคืนมาแล้ว/);
    });

    it('CN ไม่ได้ออก (SKIPPED_NO_ACCRUED) → ไม่เรียก deliver; creditNote ในผลลัพธ์ยังมี outcome', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(pending());
      prisma.deviceReturn.findUnique.mockResolvedValue(pending());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(makeReturnRow({ status: 'CONFIRMED' }));
      repossessions.createInTx.mockResolvedValueOnce({ repossession: { id: 'repo-1' }, outstandingBalance: decimal(2100), totalPaid: decimal(1000), creditNote: { outcome: 'SKIPPED_NO_ACCRUED' } });
      const result = await service.confirm('dr-1', {}, FM as never);
      expect(cnDelivery.deliver).not.toHaveBeenCalled();
      expect(result.creditNote).toEqual({ outcome: 'SKIPPED_NO_ACCRUED' });
    });
  });

  describe('reject / cancel', () => {
    it('reject VOLUNTARY: CAS → REJECTED + คืนสถานะสัญญาเดิม (CAS TERMINATED→previous) + audit CONTRACT_STATUS_LEGAL ใน tx; หลัง commit audit/tag/ไลน์ยกเลิก', async () => {
      // deviceReceivedAt = วันนี้ → ไม่ข้ามเดือน → notice null (fixture วันตายตัวจะทำให้เทสแดงเมื่อเดือนเปลี่ยน)
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ deviceReceivedAt: new Date() }));
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(makeReturnRow({ status: 'REJECTED', rejectReason: 'ใบผิดสัญญา กรุณาตรวจใหม่' }));

      const result = await service.reject('dr-1', { reason: 'ใบผิดสัญญา กรุณาตรวจใหม่' }, FM as never);

      expect(prisma.deviceReturn.updateMany).toHaveBeenCalledWith({
        where: { id: 'dr-1', status: 'PENDING_CONFIRM' },
        data: { status: 'REJECTED', rejectedById: 'fm-1', rejectedAt: expect.any(Date), rejectReason: 'ใบผิดสัญญา กรุณาตรวจใหม่' },
      });
      expect(prisma.contract.updateMany).toHaveBeenCalledWith({
        where: { id: 'contract-1', status: 'TERMINATED' },
        data: { status: 'ACTIVE' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'fm-1',
          action: 'CONTRACT_STATUS_LEGAL',
          entity: 'contract',
          entityId: 'contract-1',
          newValue: { from: 'TERMINATED', to: 'ACTIVE', reason: 'DEVICE_RETURN_REJECTED', deviceReturnId: 'dr-1', docNumber: 'DR-20260920-0001' },
        },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'fm-1', action: 'DEVICE_RETURN_REJECTED', entity: 'device_return', entityId: 'dr-1', newValue: expect.objectContaining({ docNumber: 'DR-20260920-0001', reason: 'ใบผิดสัญญา กรุณาตรวจใหม่', contractStatusRestored: 'ACTIVE' }) }),
      );
      expect(tags.recomputeForCustomer).toHaveBeenCalledWith('cust-1');
      expect(notify.notify).toHaveBeenCalledWith('dr-1', 'DEVICE_RETURN_CANCELED');
      expect(result).toMatchObject({ status: 'REJECTED', rejectReason: 'ใบผิดสัญญา กรุณาตรวจใหม่', notice: null });
    });

    it('reject ใบข้ามเดือน (รับเครื่องเดือนก่อน) → notice บอกให้เปิดงวดถ้าปิดแล้ว (accrual ย้อนหลังติด validatePeriodOpen)', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ deviceReceivedAt: new Date('2020-01-15T03:00:00.000Z') }));
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(makeReturnRow({ status: 'REJECTED' }));
      const result = await service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never);
      expect(result.notice).toMatch(/PERIOD_REOPENED/);
    });

    it('reject REPOSSESSION: ไม่แตะสถานะสัญญา ไม่มี CONTRACT_STATUS_LEGAL', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ returnKind: 'REPOSSESSION', returnReason: 'AFTER_TERMINATION', previousContractStatus: null }));
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(makeReturnRow({ status: 'REJECTED' }));
      await service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never);
      expect(prisma.contract.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('reject: สัญญาถูกเปลี่ยนสถานะระหว่างรอ (CAS สัญญา count 0) → ยังส่งกลับได้ แต่บันทึกว่าไม่ได้คืนสถานะ', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(makeReturnRow({ status: 'REJECTED' }));
      prisma.contract.updateMany.mockResolvedValueOnce({ count: 0 });
      await service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ newValue: expect.objectContaining({ contractStatusRestored: null }) }));
    });

    it('reject: ใบไม่ใช่ PENDING → 409; CAS แพ้ → 409', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ status: 'CONFIRMED' }));
      await expect(service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never)).rejects.toThrow(ConflictException);
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow());
      prisma.deviceReturn.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.reject('dr-1', { reason: 'ส่งกลับให้ตรวจสอบ' }, FM as never)).rejects.toThrow(ConflictException);
    });

    it('cancel: OWNER ยกเลิกใบสาขาใดก็ได้ → CANCELED + คืนสถานะ + audit DEVICE_RETURN_CANCELED + ไลน์', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow());
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(makeReturnRow({ status: 'CANCELED' }));
      const result = await service.cancel('dr-1', OWNER as never);
      expect(prisma.deviceReturn.updateMany).toHaveBeenCalledWith({
        where: { id: 'dr-1', status: 'PENDING_CONFIRM' },
        data: { status: 'CANCELED', canceledById: 'owner-1', canceledAt: expect.any(Date) },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ newValue: expect.objectContaining({ reason: 'DEVICE_RETURN_CANCELED' }) }) }),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEVICE_RETURN_CANCELED' }));
      expect(notify.notify).toHaveBeenCalledWith('dr-1', 'DEVICE_RETURN_CANCELED');
      expect(result.status).toBe('CANCELED');
    });

    it('cancel: BM ยกเลิกได้เฉพาะใบสาขาตัวเอง (สาขาอื่น → 404 ไม่ leak); BM ไม่มี branchId → 404', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ receivingBranchId: 'branch-b' }));
      await expect(service.cancel('dr-1', BM_A as never)).rejects.toThrow(NotFoundException);
      await expect(service.cancel('dr-1', { id: 'bm', role: 'BRANCH_MANAGER', branchId: null } as never)).rejects.toThrow(NotFoundException);
      expect(prisma.deviceReturn.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('resendLine', () => {
    it('PENDING/CONFIRMED → ส่ง DEVICE_RETURNED; REJECTED/CANCELED → DEVICE_RETURN_CANCELED; audit DEVICE_RETURN_LINE_RESENT; BM สาขาอื่น → 404', async () => {
      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ status: 'CONFIRMED' }));
      prisma.deviceReturn.findUniqueOrThrow.mockResolvedValue(makeReturnRow({ status: 'CONFIRMED', lineNotifyStatus: 'SENT' }));
      const result = await service.resendLine('dr-1', BM_A as never);
      expect(notify.notify).toHaveBeenCalledWith('dr-1', 'DEVICE_RETURNED');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEVICE_RETURN_LINE_RESENT', entityId: 'dr-1', newValue: expect.objectContaining({ eventType: 'DEVICE_RETURNED', lineNotifyStatus: 'SENT' }) }));
      expect(result.lineNotifyStatus).toBe('SENT');

      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ status: 'CANCELED' }));
      await service.resendLine('dr-1', FM as never);
      expect(notify.notify).toHaveBeenLastCalledWith('dr-1', 'DEVICE_RETURN_CANCELED');

      prisma.deviceReturn.findFirst.mockResolvedValue(makeReturnRow({ receivingBranchId: 'branch-b' }));
      await expect(service.resendLine('dr-1', BM_A as never)).rejects.toThrow(NotFoundException);
    });
  });
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-returns.service.spec.ts`
Expected: FAIL — `service.confirm is not a function`

- [ ] **Step 3: เพิ่ม method ใน service**

(ก) imports เพิ่มใน `device-returns.service.ts`:

```ts
import { bkkYearMonth } from '../../utils/date.util';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';
import { ConfirmDeviceReturnDto } from './dto/confirm-device-return.dto';
import { RejectDeviceReturnDto } from './dto/reject-device-return.dto';
```
(รวม `bkkYearMonth` เข้ากับบรรทัด `import { isFutureBkkDay } from '../../utils/date.util';` เดิมเป็น `import { bkkYearMonth, isFutureBkkDay } …`)

(ข) วาง 4 public method + 1 private ก่อนบรรทัด `// ───────────────────────────── helpers ─────────────────────────────`:

```ts
  // ───────────────────────────── confirm (FINANCE — spec §5.2) ─────────────────────────────

  async confirm(id: string, dto: ConfirmDeviceReturnDto, user: RequestUser) {
    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    if (Number.isNaN(paymentDate.getTime())) {
      throw new BadRequestException('วันที่ลงบัญชีไม่ถูกต้อง');
    }
    // ยืนยัน = OWNER/FM (cross-branch) — findFirst ไม่ต้อง scope สาขา
    const existing = await this.prisma.deviceReturn.findFirst({
      where: { id, deletedAt: null },
      include: DEVICE_RETURN_LIST_INCLUDE,
    });
    if (!existing) throw new NotFoundException(NOT_FOUND_MSG);
    if (existing.status !== 'PENDING_CONFIRM') throw new ConflictException(CLOSED_MSG);

    // ด่านนอก tx ของการยึด (วันอนาคต / เดือนปัจจุบัน / งวดเปิดทั้ง FINANCE+SHOP) — ก่อนเปิด tx เหมือน create() เดิม
    const { financeCompanyId, shopCompanyId } =
      await this.repossessions.assertRepossessionPeriodsOpen(paymentDate);

    const result = await this.prisma
      .$transaction(async (tx) => {
        const dr = await tx.deviceReturn.findUnique({ where: { id } });
        if (!dr || dr.deletedAt || dr.status !== 'PENDING_CONFIRM') {
          throw new ConflictException(CLOSED_MSG);
        }
        const created = await this.repossessions.createInTx(
          tx,
          {
            contractId: dr.contractId,
            repossessedDate: dr.deviceReceivedAt,
            paymentDate,
            conditionGrade: dr.conditionGrade,
            // คอลัมน์ Decimal(12,2) ของใบ → number ตรงตัว (RepossessionCreateInput รับ number ตาม contract)
            appraisalPrice: dr.appraisalPrice.toNumber(),
            repairCost: dr.repairCost.toNumber(),
            notes: dr.notes ?? undefined,
            returnReason: dr.returnReason as RepossessionReturnReason,
            discountPct: dto.discountPct,
            appraisedById: dr.receivedById,
            receivingBranchId: dr.receivingBranchId,
            deviceReturnId: dr.id,
            financeCompanyId,
            shopCompanyId,
          },
          user.id,
        );
        // CAS — สองคนกดยืนยันพร้อมกัน: ผู้แพ้ได้ count 0 → 409 → rollback JP5/ขาคู่ SHOP ทั้งชุด
        // (JP5 reference `${contractId}:repossession` unique เป็นตาข่ายชั้นสอง)
        const cas = await tx.deviceReturn.updateMany({
          where: { id, status: 'PENDING_CONFIRM' },
          data: {
            status: 'CONFIRMED',
            confirmedById: user.id,
            confirmedAt: new Date(),
            repossessionId: created.repossession.id,
          },
        });
        if (cas.count !== 1) throw new ConflictException(CLOSED_MSG);
        return created;
      })
      .catch((err: unknown) => {
        // ตาข่าย Repossession.productId @unique / JP5 reference unique — tx abort แล้ว re-query ไม่ได้ → 409 ไทย
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(RE_REPOSSESSION_MSG);
        }
        throw err;
      });

    // หลัง commit — best-effort ทั้งหมด (doctrine R-1)
    await this.audit.log({
      userId: user.id,
      action: 'DEVICE_RETURN_CONFIRMED',
      entity: 'device_return',
      entityId: id,
      newValue: {
        docNumber: existing.docNumber,
        contractNumber: existing.contract.contractNumber,
        repossessionId: result.repossession.id,
        paymentDate: paymentDate.toISOString(),
        discountPct: dto.discountPct ?? null,
        outstandingBalance: result.outstandingBalance.toFixed(2),
        totalPaid: result.totalPaid.toFixed(2),
        creditNote: result.creditNote?.outcome ?? null,
      },
    });
    await this.journey.recordAfterCommit({
      customerId: existing.customerId,
      kind: 'DEVICE_RETURNED',
      occurredAt: existing.deviceReceivedAt,
      actorType: 'STAFF',
      actorUserId: user.id,
      refType: 'contract',
      refId: existing.contractId,
      data: {
        docNumber: existing.docNumber,
        contractNumber: existing.contract.contractNumber,
        returnKind: existing.returnKind,
        returnReason: existing.returnReason,
      },
      dedupeKey: journeyDedupeKey('DEVICE_RETURNED', id),
    });
    await this.recomputeTags(existing.customerId);
    // ใบลดหนี้ทางไลน์ — เฉพาะหลัง commit (rollback แล้วต้องไม่มีลิงก์ไปใบที่ไม่มีจริง); fire-and-forget
    if (result.creditNote?.outcome === 'ISSUED' && result.creditNote.receiptId) {
      void this.cnDelivery
        .deliver(result.creditNote.receiptId)
        .catch((err) => Sentry.captureException(err, { tags: SENTRY_TAGS }));
    }

    const row = await this.findRow(id);
    return { ...row, creditNote: result.creditNote ?? null };
  }

  // ───────────────────────────── reject (FINANCE §5.3) / cancel (สาขา §5.4) ─────────────────────────────

  async reject(id: string, dto: RejectDeviceReturnDto, user: RequestUser) {
    const existing = await this.prisma.deviceReturn.findFirst({
      where: { id, deletedAt: null },
      include: DEVICE_RETURN_LIST_INCLUDE,
    });
    if (!existing) throw new NotFoundException(NOT_FOUND_MSG);
    return this.close(existing, 'REJECTED', user, dto.reason.trim());
  }

  async cancel(id: string, user: RequestUser) {
    // OWNER ทุกใบ · BM เฉพาะใบที่สาขาตัวเองรับ (loadScoped → 404 ไม่ leak); SALES ไม่มีสิทธิ์ (controller @Roles)
    const existing = await this.loadScoped(id, user);
    return this.close(existing, 'CANCELED', user, null);
  }

  /**
   * ส่งกลับ/ยกเลิก: CAS PENDING_CONFIRM → target; VOLUNTARY คืนสถานะสัญญาเดิมด้วย CAS
   * (TERMINATED → previousContractStatus) + audit CONTRACT_STATUS_LEGAL ใน tx (atomic กับการคืนสถานะ).
   * สัญญาที่ถูกเปลี่ยนสถานะไปแล้วระหว่างรอ (count 0) = ไม่คืน แต่ใบยังปิดได้ (บันทึกใน audit หลัง commit).
   */
  private async close(
    existing: DeviceReturnWithRelations,
    target: 'REJECTED' | 'CANCELED',
    user: RequestUser,
    reason: string | null,
  ) {
    if (existing.status !== 'PENDING_CONFIRM') throw new ConflictException(CLOSED_MSG);
    const now = new Date();

    const restored = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.deviceReturn.updateMany({
        where: { id: existing.id, status: 'PENDING_CONFIRM' },
        data:
          target === 'REJECTED'
            ? { status: 'REJECTED', rejectedById: user.id, rejectedAt: now, rejectReason: reason }
            : { status: 'CANCELED', canceledById: user.id, canceledAt: now },
      });
      if (cas.count !== 1) throw new ConflictException(CLOSED_MSG);

      if (existing.returnKind !== 'VOLUNTARY' || !existing.previousContractStatus) return null;
      const contractCas = await tx.contract.updateMany({
        where: { id: existing.contractId, status: 'TERMINATED' },
        data: { status: existing.previousContractStatus },
      });
      if (contractCas.count !== 1) {
        this.logger.warn(
          `[device-return] ${existing.docNumber}: สัญญา ${existing.contract.contractNumber} ไม่อยู่ในสถานะ TERMINATED แล้ว — ไม่คืนสถานะ`,
        );
        return null;
      }
      // audit ใน tx — atomic กับการคืนสถานะ (หลุด Merkle chain โดยตั้งใจ; pattern contract-letter.service.ts:256-267)
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'CONTRACT_STATUS_LEGAL',
          entity: 'contract',
          entityId: existing.contractId,
          newValue: {
            from: 'TERMINATED',
            to: existing.previousContractStatus,
            reason: target === 'REJECTED' ? 'DEVICE_RETURN_REJECTED' : 'DEVICE_RETURN_CANCELED',
            deviceReturnId: existing.id,
            docNumber: existing.docNumber,
          },
        },
      });
      return existing.previousContractStatus;
    });

    await this.audit.log({
      userId: user.id,
      action: target === 'REJECTED' ? 'DEVICE_RETURN_REJECTED' : 'DEVICE_RETURN_CANCELED',
      entity: 'device_return',
      entityId: existing.id,
      newValue: {
        docNumber: existing.docNumber,
        contractNumber: existing.contract.contractNumber,
        returnKind: existing.returnKind,
        reason,
        contractStatusRestored: restored,
      },
    });
    await this.recomputeTags(existing.customerId);
    await this.notify.notify(existing.id, 'DEVICE_RETURN_CANCELED');

    // spec §8: ใบข้ามเดือน — accrual ย้อนหลังของงวดที่ค้างระหว่างรอต้องผ่าน validatePeriodOpen(dueDate)
    const crossedMonth = bkkYearMonth(existing.deviceReceivedAt) !== bkkYearMonth(now);
    const notice =
      restored && crossedMonth
        ? 'ใบนี้ข้ามเดือน — งวดที่ค้าง accrual ระหว่างรอจะถูก accrual ย้อนหลังโดย cron 2A ซึ่งต้องให้งวดบัญชีของเดือนนั้นยังเปิดอยู่ ถ้าปิดแล้วให้ OWNER เปิดงวดใหม่ผ่าน PERIOD_REOPENED ก่อน'
        : null;
    const row = await this.findRow(existing.id);
    return { ...row, notice };
  }

  // ───────────────────────────── resend LINE (§5.5) ─────────────────────────────

  async resendLine(id: string, user: RequestUser): Promise<DeviceReturnRow> {
    const existing = await this.loadScoped(id, user);
    const eventType: 'DEVICE_RETURNED' | 'DEVICE_RETURN_CANCELED' =
      existing.status === 'PENDING_CONFIRM' || existing.status === 'CONFIRMED'
        ? 'DEVICE_RETURNED'
        : 'DEVICE_RETURN_CANCELED';
    await this.notify.notify(existing.id, eventType);
    const row = await this.findRow(existing.id);
    await this.audit.log({
      userId: user.id,
      action: 'DEVICE_RETURN_LINE_RESENT',
      entity: 'device_return',
      entityId: existing.id,
      newValue: { docNumber: existing.docNumber, eventType, lineNotifyStatus: row.lineNotifyStatus },
    });
    return row;
  }
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-returns.service.spec.ts`
Expected: PASS (23 เดิม + confirm 7 + reject/cancel 7 + resendLine 1 = 38 tests)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 10: Controller + Module + `app.module.ts` + ผู้เรียกเดิมของ `create()`/`POST /repossessions` ทุกจุด (product-lifecycle เส้นทางจริง, e2e docs-specs)

**Files:**
- Create: `apps/api/src/modules/device-returns/device-returns.controller.ts`
- Test: `apps/api/src/modules/device-returns/device-returns.controller.spec.ts`
- Create: `apps/api/src/modules/device-returns/device-returns.module.ts`
- Modify: `apps/api/src/app.module.ts:32` (import), `:221` (imports array)
- Modify: `apps/api/src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts` (ลบ helper interim ของ Task 4, wiring `DeviceReturnsService`, เคส E1/E3, afterAll)
- Modify: `apps/api/e2e/documents/receipts.docs-spec.ts:341-343`, `apps/api/e2e/documents/receipts.browser.docs-spec.ts:117-118`
- ตรวจแล้วไม่ต้องแก้: `apps/api/src/cli/test-pack/contracts.seed.ts:317` (`'/repossessions'` เป็นแค่รายชื่อ route หน้าเว็บที่ seeder แนะนำให้เปิดดู ไม่ใช่ API call) · `apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx:234` (`api.post('/repossessions')` — **Phase 3** ถอดออก; จนกว่าจะถึงตอนนั้น overlay เดิมได้ 404 ซึ่งยอมรับได้เพราะ Phase 3 อยู่ branch เดียวกันก่อน merge) · `apps/web/e2e/*.spec.ts` (แค่ `gotoWithRetry('/repossessions')` — หน้าเดิมยังอยู่)

**Interfaces:**
- Consumes: Task 7/9 `DeviceReturnsService` ทุก method, Task 5 DTOs, `ROLES_KEY = 'roles'` (`auth/decorators/roles.decorator.ts`), `RequestUser`
- Produces: endpoints ตาม spec §5.0 — `GET /device-returns/preview` (OWNER, BM, SALES) · `GET /device-returns/lookup?q=` (OWNER, BM, SALES) · `GET /device-returns/awaiting-repossession` (OWNER, BM, FM) · `GET /device-returns?status&contractId&branchId&page&limit` (OWNER, FM, ACC, BM, SALES) · `GET /device-returns/:id` (เหมือน list) · `POST /device-returns` (OWNER, BM, SALES) · `POST /device-returns/:id/confirm` (OWNER, FM) · `POST /device-returns/:id/reject` (OWNER, FM) · `POST /device-returns/:id/cancel` (OWNER, BM) · `POST /device-returns/:id/resend-line` (OWNER, FM, BM); `DeviceReturnsModule` (exports `DeviceReturnsService`)

- [ ] **Step 1: เขียนเทส controller ที่ล้มก่อน (ล็อกตาราง @Roles ของ spec §5.0 + การส่งต่อไป service)**

สร้าง `apps/api/src/modules/device-returns/device-returns.controller.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { DeviceReturnsController } from './device-returns.controller';
import { DeviceReturnsService } from './device-returns.service';

const rolesOf = (method: string): string[] | undefined =>
  Reflect.getMetadata(ROLES_KEY, DeviceReturnsController.prototype[method as keyof DeviceReturnsController]);

describe('DeviceReturnsController', () => {
  let controller: DeviceReturnsController;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;
  const user = { id: 'u-1', role: 'OWNER', branchId: null };

  beforeEach(async () => {
    service = {
      preview: jest.fn().mockResolvedValue({}),
      lookup: jest.fn().mockResolvedValue([]),
      awaitingRepossession: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      list: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
      findOne: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      confirm: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
      cancel: jest.fn().mockResolvedValue({}),
      resendLine: jest.fn().mockResolvedValue({}),
    };
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DeviceReturnsController],
      providers: [{ provide: DeviceReturnsService, useValue: service }],
    }).compile();
    controller = mod.get(DeviceReturnsController);
  });

  it('@Roles ตรงตาราง spec §5.0 ทุก route', () => {
    expect(rolesOf('preview')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
    expect(rolesOf('lookup')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
    expect(rolesOf('awaitingRepossession')).toEqual(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER']);
    expect(rolesOf('list')).toEqual(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES']);
    expect(rolesOf('findOne')).toEqual(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES']);
    expect(rolesOf('create')).toEqual(['OWNER', 'BRANCH_MANAGER', 'SALES']);
    expect(rolesOf('confirm')).toEqual(['OWNER', 'FINANCE_MANAGER']);
    expect(rolesOf('reject')).toEqual(['OWNER', 'FINANCE_MANAGER']);
    expect(rolesOf('cancel')).toEqual(['OWNER', 'BRANCH_MANAGER']);
    expect(rolesOf('resendLine')).toEqual(['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER']);
  });

  it('list: แปลง query string → service query; status นอก enum → 400', async () => {
    await controller.list(user as never, 'CONFIRMED', 'c-1', 'b-1', '2', '10');
    expect(service.list).toHaveBeenCalledWith(
      { status: 'CONFIRMED', contractId: 'c-1', branchId: 'b-1', page: 2, limit: 10 },
      user,
    );
    await expect(controller.list(user as never, 'BOGUS')).rejects.toThrow(BadRequestException);
  });

  it('lifecycle routes ส่ง id/dto/user ต่อไป service ตรง ๆ', async () => {
    await controller.confirm('dr-1', { discountPct: 40 }, user as never);
    expect(service.confirm).toHaveBeenCalledWith('dr-1', { discountPct: 40 }, user);
    await controller.reject('dr-1', { reason: 'ใบผิดสัญญา กรุณาตรวจใหม่' }, user as never);
    expect(service.reject).toHaveBeenCalledWith('dr-1', { reason: 'ใบผิดสัญญา กรุณาตรวจใหม่' }, user);
    await controller.cancel('dr-1', user as never);
    expect(service.cancel).toHaveBeenCalledWith('dr-1', user);
    await controller.resendLine('dr-1', user as never);
    expect(service.resendLine).toHaveBeenCalledWith('dr-1', user);
    await controller.lookup('0042', user as never);
    expect(service.lookup).toHaveBeenCalledWith('0042', user);
  });
});
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-returns.controller.spec.ts`
Expected: FAIL — `Cannot find module './device-returns.controller'`

- [ ] **Step 3: เขียน controller**

สร้าง `apps/api/src/modules/device-returns/device-returns.controller.ts` (pattern: `repossessions.controller.ts` — แต่ **ไม่ใส่ `BranchGuard`** ตาม brief; ขอบเขตสาขาอยู่ใน service):

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DeviceReturnStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../repossessions/repossessions.service';
import { DeviceReturnsService } from './device-returns.service';
import { CreateDeviceReturnDto } from './dto/create-device-return.dto';
import { ConfirmDeviceReturnDto } from './dto/confirm-device-return.dto';
import { RejectDeviceReturnDto } from './dto/reject-device-return.dto';
import { PreviewDeviceReturnQueryDto } from './dto/preview-device-return.dto';

const DEVICE_RETURN_STATUSES: readonly DeviceReturnStatus[] = [
  'PENDING_CONFIRM',
  'CONFIRMED',
  'REJECTED',
  'CANCELED',
];

/**
 * ใบรับเครื่องคืน — spec 2026-09-20 §5.0. ทางเข้าเดียวของการยึด/รับคืน (POST /repossessions ถูกลบ).
 * ขอบเขตสาขาของ route `/:id` บังคับใน service (BranchGuard ไม่ครอบ — .claude/rules/security.md);
 * static routes (preview / lookup / awaiting-repossession) ต้องประกาศก่อน `:id`.
 */
@ApiTags('Device Returns')
@ApiBearerAuth('JWT')
@Controller('device-returns')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeviceReturnsController {
  constructor(private readonly service: DeviceReturnsService) {}

  @Get('preview')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  preview(@Query() query: PreviewDeviceReturnQueryDto, @CurrentUser() user: RequestUser) {
    return this.service.preview(query, user);
  }

  @Get('lookup')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  lookup(@Query('q') q: string, @CurrentUser() user: RequestUser) {
    return this.service.lookup(q ?? '', user);
  }

  @Get('awaiting-repossession')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  awaitingRepossession(@CurrentUser() user: RequestUser) {
    return this.service.awaitingRepossession(user);
  }

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('contractId') contractId?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (status && !DEVICE_RETURN_STATUSES.includes(status as DeviceReturnStatus)) {
      throw new BadRequestException('สถานะใบรับเครื่องคืนไม่ถูกต้อง');
    }
    return this.service.list(
      {
        status: status ? (status as DeviceReturnStatus) : undefined,
        contractId: contractId || undefined,
        branchId: branchId || undefined,
        page: page ? parseInt(page, 10) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      },
      user,
    );
  }

  @Get(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateDeviceReturnDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Post(':id/confirm')
  @Roles('OWNER', 'FINANCE_MANAGER')
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmDeviceReturnDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.confirm(id, dto, user);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'FINANCE_MANAGER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectDeviceReturnDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.reject(id, dto, user);
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.cancel(id, user);
  }

  @Post(':id/resend-line')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  resendLine(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.resendLine(id, user);
  }
}
```

- [ ] **Step 4: เขียน module + ลงทะเบียนใน `app.module.ts`**

สร้าง `apps/api/src/modules/device-returns/device-returns.module.ts` (`AuditModule` เป็น `@Global` และ `PrismaModule` global — ไม่ต้อง import; `TradeInValuationService` สร้างด้วย `new` ใน service):

```ts
import { Module } from '@nestjs/common';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
import { CustomerTagsModule } from '../customer-tags/customer-tags.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { RepossessionsModule } from '../repossessions/repossessions.module';
import { DeviceReturnsController } from './device-returns.controller';
import { DeviceReturnsService } from './device-returns.service';
import { DeviceReturnNumberService } from './device-return-number.service';
import { DeviceReturnNotifyService } from './device-return-notify.service';

/**
 * ใบรับเครื่องคืน (spec 2026-09-20). ไม่มี forwardRef: ไม่มีโมดูลใด import โมดูลนี้นอกจาก AppModule
 * — RepossessionsModule (createInTx), ReceiptsModule (CreditNoteDeliveryService), NotificationsModule
 * (sendFromTemplate), CustomerTagsModule (recomputeForCustomer), CustomerJourneyModule (JourneyEntryWriter)
 * ล้วนเป็น import ขาเดียว. DeviceReturnPendingCron ถูกเพิ่มเข้า providers ใน Task 13.
 */
@Module({
  imports: [
    RepossessionsModule,
    ReceiptsModule,
    NotificationsModule,
    CustomerTagsModule,
    CustomerJourneyModule,
  ],
  controllers: [DeviceReturnsController],
  providers: [DeviceReturnsService, DeviceReturnNumberService, DeviceReturnNotifyService],
  exports: [DeviceReturnsService],
})
export class DeviceReturnsModule {}
```

`apps/api/src/app.module.ts`:
- ถัดจากบรรทัด 32 `import { RepossessionsModule } from './modules/repossessions/repossessions.module';` เพิ่ม
  `import { DeviceReturnsModule } from './modules/device-returns/device-returns.module';`
- ใน `imports: [ … ]` ถัดจาก `RepossessionsModule,` (บรรทัด 221) เพิ่ม `DeviceReturnsModule,`

- [ ] **Step 5: product-lifecycle spec — เส้นทางจริง (create → confirm) แทน helper interim ของ Task 4**

ใน `apps/api/src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts`:

(ก) imports เพิ่ม (ถัดจาก `import { CreditNoteDocumentService } …`):

```ts
import { DeviceReturnsService } from '../../device-returns/device-returns.service';
import { DeviceReturnNumberService } from '../../device-returns/device-return-number.service';
import { CustomerTagsService } from '../../customer-tags/customer-tags.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
```

(ข) ถัดจาก wiring `const repossessionsService = new RepossessionsService(…)` เพิ่ม:

```ts
// ใบรับเครื่องคืน (2026-09-20) — ทางเข้าเดียวของการยึด: create (สาขา) → confirm (FINANCE → createInTx)
// ไลน์/ส่ง CN เป็น stub (ไม่ยิงออกเน็ตในเทส) · tag/journey ของจริง (เขียนหลัง commit, best-effort)
const deviceReturnsService = new DeviceReturnsService(
  prisma as never,
  repossessionsService,
  new DeviceReturnNumberService(prisma as never),
  { notify: async () => undefined } as never,
  new CustomerTagsService(prisma as never),
  new JourneyEntryWriter(prisma as never),
  audit,
  { deliver: async () => ({ delivered: false }) } as never,
);
```

(ค) **ลบ** helper `repossessViaCreateInTx` ทั้งฟังก์ชัน (interim ของ Task 4).

(ง) เคส E1 — แทน `const { repossession } = await repossessViaCreateInTx(contract.id, product.id, customer.id, 7000);` ด้วย:

```ts
      // สัญญา TERMINATED → ใบประเภท REPOSSESSION (เหตุผล AFTER_TERMINATION ตั้งให้เอง); OWNER ต้องระบุสาขาที่รับ
      const intake = await deviceReturnsService.create(
        {
          contractId: contract.id,
          deviceReceivedAt: new Date().toISOString(),
          conditionGrade: 'B',
          appraisalPrice: 7000,
          receivingBranchId: branchId,
        },
        OWNER_USER() as never,
      );
      expect(intake.status).toBe('PENDING_CONFIRM');
      expect(intake.returnKind).toBe('REPOSSESSION');
      const confirmed = await deviceReturnsService.confirm(intake.id, {}, OWNER_USER() as never);
      expect(confirmed.status).toBe('CONFIRMED');
      const repossession = await prisma.repossession.findUniqueOrThrow({
        where: { id: confirmed.repossessionId! },
      });
```

(จ) เคส E3 — แทน `repossessViaCreateInTx(contract.id, product.id, customer.id, 7000)` ใน `await expect(...)` ด้วย:

```ts
        deviceReturnsService.create(
          {
            contractId: contract.id,
            deviceReceivedAt: new Date().toISOString(),
            conditionGrade: 'B',
            appraisalPrice: 7000,
            receivingBranchId: branchId,
          },
          OWNER_USER() as never,
        ),
```
และเพิ่ม assertion ท้ายเคส: `expect(await prisma.deviceReturn.findFirst({ where: { contractId: contract.id } })).toBeNull();`

(ฉ) `afterAll` — ก่อนบรรทัด `await prisma.deviceReturn.deleteMany(…)` ที่ Task 4 เพิ่ม ให้เพิ่ม (tag/journey ที่ create/confirm เขียนจริง FK ไปลูกค้า):

```ts
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.customerTag.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
```

- [ ] **Step 6: e2e docs-specs → เส้นทาง `/device-returns`**

`apps/api/e2e/documents/receipts.docs-spec.ts` — แทนที่ 2 บรรทัด (origin/main:341-342):

```ts
    await h.client({ session: salesA }).post('/repossessions', { contractId: contractD.id, repossessedDate: today, conditionGrade: 'B', appraisalPrice: 3000 }).expect(403);
    const created = await ok(h.client({ session: owner }).post('/repossessions', { contractId: contractD.id, repossessedDate: today, conditionGrade: 'B', appraisalPrice: 3000, returnReason: 'UNAFFORDABLE', notes: 'ทดสอบระบบ ยึดคืน' }), 201, 'POST /repossessions');
```
ด้วย:
```ts
    // 2026-09-20 ใบรับเครื่องคืน: สาขา (SALES ของสาขา a) บันทึกรับเครื่องได้ — สัญญา OVERDUE = คืนเอง (VOLUNTARY) → TERMINATED ทันที;
    // การยืนยัน (JP5 + ใบลดหนี้) เป็นของ OWNER/FINANCE_MANAGER เท่านั้น → SALES ได้ 403 ที่ขั้นนี้แทน
    const intake = await ok(h.client({ session: salesA }).post('/device-returns', { contractId: contractD.id, deviceReceivedAt: today, conditionGrade: 'B', appraisalPrice: 3000, returnReason: 'UNAFFORDABLE', notes: 'ทดสอบระบบ คืนเครื่อง' }), 201, 'POST /device-returns');
    const deviceReturnId = intake.body.data.id as string;
    await h.client({ session: salesA }).post(`/device-returns/${deviceReturnId}/confirm`, {}).expect(403);
    const created = await ok(h.client({ session: owner }).post(`/device-returns/${deviceReturnId}/confirm`, {}), 201, 'POST /device-returns/:id/confirm');
```
(บรรทัด `const creditNote = created.body.data.creditNote …` และที่เหลือคงเดิม — confirm คืน `{ ...row, creditNote }`; ถ้า `world.users.salesA` ไม่มี `branchId` จะได้ 403 fail-closed ที่ POST — ให้เปลี่ยน session ที่สร้างเป็น `branchManagerA`)

`apps/api/e2e/documents/receipts.browser.docs-spec.ts` — แทนที่ (origin/main:117-118):

```ts
    const created = await h.client({ session: owner }).post('/repossessions', { contractId: repossessed.id, repossessedDate: today, conditionGrade: 'B', appraisalPrice: 3000, returnReason: 'UNAFFORDABLE', notes: 'ทดสอบระบบ ยึดคืน (browser)' });
    if (created.status !== 201) throw new Error(`POST /repossessions → ${created.status} ${JSON.stringify(created.body)}`);
```
ด้วย:
```ts
    const intake = await h.client({ session: owner }).post('/device-returns', { contractId: repossessed.id, deviceReceivedAt: today, conditionGrade: 'B', appraisalPrice: 3000, returnReason: 'UNAFFORDABLE', notes: 'ทดสอบระบบ คืนเครื่อง (browser)', receivingBranchId: world.branches.a.id });
    if (intake.status !== 201) throw new Error(`POST /device-returns → ${intake.status} ${JSON.stringify(intake.body)}`);
    const created = await h.client({ session: owner }).post(`/device-returns/${intake.body.data.id}/confirm`, {});
    if (created.status !== 201) throw new Error(`POST /device-returns/:id/confirm → ${created.status} ${JSON.stringify(created.body)}`);
```

- [ ] **Step 7: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-returns.controller.spec.ts`
Expected: PASS (3 tests)

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts; cd ../..`
Expected: PASS (E1 ผ่านเส้นทาง create→confirm: เครื่อง REPOSSESSED, intake `S21-1104` DEVICE_RETURN, ขายต่อ POS ปิดแถวยึด; E3 ปฏิเสธที่ create)

Run: `cd apps/api && npx tsc --noEmit -p e2e/tsconfig.json 2>/dev/null || npx tsc --noEmit e2e/documents/receipts.docs-spec.ts e2e/documents/receipts.browser.docs-spec.ts --esModuleInterop --experimentalDecorators --skipLibCheck; cd ../..`
Expected: 0 errors (e2e ไม่อยู่ใน `check-types.sh` — ตรวจแยก; ถ้าไม่มี `e2e/tsconfig.json` ใช้คำสั่งหลัง `||`)

- [ ] **Step 8: ยืนยันว่าไม่มีผู้เรียกเดิมเหลือ**

Run: `grep -rn "CreateRepossessionDto\|repossessionsService.create(\|post('/repossessions'\|post(\"/repossessions\"\|collectedByShop: dto\|SHOP_COLLECT_REPOSSESSION" apps/api/src apps/api/e2e; echo "exit=$?"`
Expected: ไม่มีบรรทัดผลลัพธ์ (`exit=1`) — ผู้เรียกที่ยังเหลือคือฝั่งเว็บ `RepossessionOverlay.tsx` เท่านั้น (Phase 3)

- [ ] **Step 9: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors; แล้ว `cd apps/api && npm run build 2>&1 | tail -3; cd ../..` — Expected: build ผ่าน (Nest DI ของ `DeviceReturnsModule` resolve ครบ — ถ้า `Nest can't resolve dependencies` แปลว่า import module ขาด ให้ดูรายการ imports ใน Step 4). **Do NOT commit** (see Global Constraints).

---

### Task 11: Tag `RETURNED_DEVICE` เป็นกฎในเครื่องยนต์ tag เดิม

**Files:**
- Modify: `apps/api/src/modules/customer-tags/customer-tags.service.ts:5-16` (jsdoc), `:34-39` (`AUTO_MANAGED_TAGS`), `:203-296` (`evaluateAutoTags`), `:298-313` (`autoReason`)
- Test: `apps/api/src/modules/customer-tags/customer-tags.service.spec.ts:6-26` (mockPrisma), `:56-58` (beforeEach defaults), + describe ใหม่

**Interfaces:**
- Consumes: Task 1 `prisma.deviceReturn` + `CustomerTagType.RETURNED_DEVICE`; ตาราง `repossession` (มีอยู่แล้ว)
- Produces: `evaluateAutoTags` เพิ่ม `'RETURNED_DEVICE'` เมื่อ `deviceReturn.count({ where: { customerId, deletedAt: null, status: { in: ['PENDING_CONFIRM','CONFIRMED'] } }) > 0 || repossession.count({ where: { deletedAt: null, contract: { customerId } } }) > 0`; `AUTO_MANAGED_TAGS` += `'RETURNED_DEVICE'` (recompute รายคืน `customer-tag-recompute.cron.ts` ถอดเองเมื่อกฎไม่เป็นจริง — ห้ามติด/ถอดเฉพาะกิจ); `autoReason('RETURNED_DEVICE') = 'AUTO: เคยคืน/ถูกยึดเครื่อง'`

- [ ] **Step 1: แก้เทสให้ล้มก่อน**

ใน `customer-tags.service.spec.ts`:

(ก) `mockPrisma` (origin/main:6-26) เพิ่ม 2 model:

```ts
  deviceReturn: {
    count: jest.fn(),
  },
  repossession: {
    count: jest.fn(),
  },
```

(ข) ใน `beforeEach` ถัดจาก `mockPrisma.auditLog.count.mockResolvedValue(0);` (origin/main:56) เพิ่ม:

```ts
    mockPrisma.deviceReturn.count.mockResolvedValue(0);
    mockPrisma.repossession.count.mockResolvedValue(0);
```

(ค) เพิ่ม describe ใหม่ท้ายไฟล์ (ก่อน `});` ปิด `describe('CustomerTagsService')`):

```ts
  describe('RETURNED_DEVICE — เคยคืน/ถูกยึดเครื่อง (spec 2026-09-20 §5.6)', () => {
    function customerWithOneContract() {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1', createdAt: RECENT_DATE });
      mockPrisma.contract.count.mockResolvedValue(1);
      mockPrisma.contract.findFirst.mockResolvedValue({ createdAt: RECENT_DATE });
      mockPrisma.contract.findMany.mockResolvedValue([{ id: 'c1' }]);
      mockPrisma.auditLog.count.mockResolvedValue(0);
    }

    it('มีใบรับเครื่องคืน PENDING_CONFIRM/CONFIRMED ของลูกค้า → ติด RETURNED_DEVICE (AUTO) พร้อม reason', async () => {
      customerWithOneContract();
      mockPrisma.deviceReturn.count.mockResolvedValue(1);

      const result = await service.recomputeForCustomer('cust-1');

      expect(result.added).toContain('RETURNED_DEVICE');
      expect(mockPrisma.deviceReturn.count).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', deletedAt: null, status: { in: ['PENDING_CONFIRM', 'CONFIRMED'] } },
      });
      expect(mockPrisma.customerTag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tag: 'RETURNED_DEVICE', source: 'AUTO', reason: 'AUTO: เคยคืน/ถูกยึดเครื่อง' }),
        }),
      );
    });

    it('ไม่มีใบ แต่มีแถวยึด (Repossession ผ่านสัญญาของลูกค้า) → ติดเช่นกัน', async () => {
      customerWithOneContract();
      mockPrisma.repossession.count.mockResolvedValue(1);

      const result = await service.recomputeForCustomer('cust-1');

      expect(result.added).toContain('RETURNED_DEVICE');
      expect(mockPrisma.repossession.count).toHaveBeenCalledWith({
        where: { deletedAt: null, contract: { customerId: 'cust-1' } },
      });
    });

    it('ใบถูกส่งกลับ/ยกเลิก (นับ 0) และไม่มีแถวยึด → tag AUTO เดิมถูกถอด (soft-delete) — MANUAL BLACKLIST ไม่ถูกแตะ', async () => {
      customerWithOneContract();
      mockPrisma.customerTag.findMany.mockResolvedValue([
        { id: 'tag-rd', tag: 'RETURNED_DEVICE', source: 'AUTO', deletedAt: null },
      ]);

      const result = await service.recomputeForCustomer('cust-1');

      expect(result.removed).toEqual(['RETURNED_DEVICE']);
      expect(mockPrisma.customerTag.update).toHaveBeenCalledWith({
        where: { id: 'tag-rd' },
        data: { deletedAt: expect.any(Date) },
      });
      // AUTO_MANAGED_TAGS ที่ recompute ค้นต้องรวม RETURNED_DEVICE และไม่รวม BLACKLIST
      const findArgs = mockPrisma.customerTag.findMany.mock.calls[0][0];
      expect(findArgs.where.tag.in).toEqual(['VIP', 'HIGH_RISK', 'NEW', 'LOYAL', 'RETURNED_DEVICE']);
    });
  });
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/customer-tags/customer-tags.service.spec.ts`
Expected: FAIL — `expected [] to contain 'RETURNED_DEVICE'` / `expected [ 'VIP', 'HIGH_RISK', 'NEW', 'LOYAL' ] to deeply equal …`

- [ ] **Step 3: แก้ service**

ใน `apps/api/src/modules/customer-tags/customer-tags.service.ts`:

(ก) jsdoc คลาส (origin/main:5-16) เพิ่มบรรทัดในตาราง Tag rules ถัดจาก `LOYAL`:

```
 *  - RETURNED_DEVICE : มีใบรับเครื่องคืน PENDING_CONFIRM/CONFIRMED หรือมีแถว Repossession
 *                      ผ่านสัญญาของลูกค้า (spec 2026-09-20 §5.6 — ประวัติ "เคยคืนเครื่อง")
```

(ข) `AUTO_MANAGED_TAGS` (origin/main:34-39):

```ts
  private static readonly AUTO_MANAGED_TAGS: CustomerTagType[] = [
    'VIP',
    'HIGH_RISK',
    'NEW',
    'LOYAL',
    'RETURNED_DEVICE',
  ];
```

(ค) ใน `evaluateAutoTags` ถัดจากการคำนวณ `loyalCutoff` (origin/main:270-273) และก่อน `const tags: CustomerTagType[] = [];` เพิ่ม:

```ts
    // RETURNED_DEVICE (spec 2026-09-20 §5.6): ใบรับเครื่องคืนที่เปิดอยู่/ยืนยันแล้ว **หรือ** แถวยึด
    // (Repossession ผ่านสัญญาของลูกค้า — ครอบทั้งใบที่ยืนยันแล้วและแถวยึดยุคก่อนมีใบ)
    // ใบที่ส่งกลับ/ยกเลิกไม่นับ → recompute ถอด tag เองเมื่อไม่มีแถวใดเหลือ
    const deviceReturnCount = await this.prisma.deviceReturn.count({
      where: { customerId, deletedAt: null, status: { in: ['PENDING_CONFIRM', 'CONFIRMED'] } },
    });
    const repossessionCount = await this.prisma.repossession.count({
      where: { deletedAt: null, contract: { customerId } },
    });
```
และก่อน `return tags;` เพิ่ม:

```ts
    if (deviceReturnCount > 0 || repossessionCount > 0) {
      tags.push('RETURNED_DEVICE');
    }
```

(ง) `autoReason` (origin/main:298-313) เพิ่ม case ก่อน `case 'BLACKLIST':`:

```ts
      case 'RETURNED_DEVICE':
        return 'AUTO: เคยคืน/ถูกยึดเครื่อง';
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/customer-tags/customer-tags.service.spec.ts`
Expected: PASS (เทสเดิมทั้งหมด + 3 ใหม่ — เทสเดิมไม่กระทบเพราะ count ทั้งสองคืน 0 ใน beforeEach)

- [ ] **Step 5: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors (`switch` ใน `autoReason` ครบทุกค่า enum — ถ้า TS แจ้ง not all code paths แสดงว่าลืม case). **Do NOT commit** (see Global Constraints).

---

### Task 12: ระบบทวงถาม — คิว "นัดชำระ" ไม่แสดง และ promise cron ไม่สั่งล็อค MDM เมื่อมีใบรับคืนเปิดอยู่

**Files:**
- Modify: `apps/api/src/modules/overdue/queue.service.ts` (import + `buildWhere` สาขา promise — origin/main:817-846)
- Test: `apps/api/src/modules/overdue/queue.service.spec.ts` (describe ใหม่)
- Modify: `apps/api/src/modules/overdue/crons/promise-resolution.cron.ts:1-6` (import), `:187-206` (ก่อน `mdm.autoLock`)
- Test: `apps/api/src/modules/overdue/crons/promise-resolution.cron.spec.ts:30-41` (prisma mock), + เทสใหม่

**Interfaces:**
- Consumes: Task 1 `noOpenDeviceReturnWhere()`, `OPEN_DEVICE_RETURN_STATUSES` (`device-returns/device-return.predicate.ts`)
- Produces: promise-tab `where` มี `deviceReturns: { none: … }`; `resolvePromise` ยังนับ broken/kept ตามเดิม แต่ข้าม `mdm.autoLock` + log 1 บรรทัดเมื่อ `deviceReturn.count({ where: { contractId, status: { in: OPEN_DEVICE_RETURN_STATUSES }, deletedAt: null } }) > 0`

- [ ] **Step 1: แก้เทสให้ล้มก่อน**

(ก) `queue.service.spec.ts` — เพิ่ม describe ใหม่ท้ายไฟล์ (ก่อน `});` ปิด `describe('OverdueQueueService')`; `resetEnrichmentMocks()` ถูกเรียกใน `beforeEach` เดิมอยู่แล้ว):

```ts
  describe('promise tab — สัญญาที่มีใบรับเครื่องคืนเปิดอยู่ไม่เข้าคิว (spec 2026-09-20 §5.7)', () => {
    it('where ของแท็บนัดชำระมี deviceReturns.none ของสถานะ PENDING_CONFIRM/CONFIRMED (predicate ตัวเดียวกับ promise cron)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([]);
      mockPrisma.contract.count.mockResolvedValueOnce(0);

      await service.getQueue({ tab: 'promise', userRole: 'OWNER', userBranchId: null });

      const where = mockPrisma.contract.findMany.mock.calls[0][0].where;
      expect(where.deviceReturns).toEqual({
        none: { status: { in: ['PENDING_CONFIRM', 'CONFIRMED'] }, deletedAt: null },
      });
      // เงื่อนไขเดิมของแท็บยังอยู่ครบ
      expect(where.callLogs.some.result).toBe('PROMISED');
      expect(where.callLogs.some.brokenAt).toBeNull();
    });
  });
```

(ข) `promise-resolution.cron.spec.ts` — ใน `prisma = { … }` ของ `beforeEach` (origin/main:30-41) เพิ่ม `deviceReturn: { count: jest.fn().mockResolvedValue(0) },` ถัดจาก `auditLog: …`; แล้วเพิ่มเทสใหม่ท้ายไฟล์ (ก่อน `});` ปิด describe):

```ts
  it('ใบรับเครื่องคืนเปิดอยู่ (เครื่องอยู่ที่สาขาแล้ว) → ยังนับ broken + audit ตามเดิม แต่ไม่สั่ง MDM autoLock (spec 2026-09-20 §5.7)', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        slots: [
          {
            id: 's-1',
            slotIndex: 1,
            settlementDate: new Date(Date.now() - 5 * 86400 * 1000),
            settlementAmount: { toNumber: () => 1000 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      },
    ]);
    prisma.__tx.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: null } });
    prisma.deviceReturn.count.mockResolvedValue(1);

    await cron.handleHourly();

    expect(prisma.__tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'BROKEN_PROMISE', entityId: 'c-1' }) }),
    );
    expect(prisma.deviceReturn.count).toHaveBeenCalledWith({
      where: { contractId: 'c-1', status: { in: ['PENDING_CONFIRM', 'CONFIRMED'] }, deletedAt: null },
    });
    expect(mdm.autoLock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/overdue/queue.service.spec.ts src/modules/overdue/crons/promise-resolution.cron.spec.ts`
Expected: FAIL — queue: `expected undefined to deeply equal { none: … }`; cron: `expected "autoLock" not to be called`

- [ ] **Step 3: แก้ `queue.service.ts`**

(ก) เพิ่ม import (กลุ่ม import ด้านบนไฟล์):

```ts
import { noOpenDeviceReturnWhere } from '../device-returns/device-return.predicate';
```

(ข) ใน `buildWhere` สาขา promise (origin/main:834-846) แทน
```ts
    return {
      ...branchScope,
      deletedAt: null,
      callLogs: {
```
ด้วย
```ts
    return {
      ...branchScope,
      deletedAt: null,
      // spec 2026-09-20 §5.7: แท็บนี้ไม่มีตัวกรองสถานะสัญญา — สัญญาที่มีใบรับเครื่องคืนเปิดอยู่
      // (เครื่องอยู่ที่สาขาแล้ว) ต้องไม่โผล่ให้ทวงตามนัดอีก; predicate ตัวเดียวกับ promise-resolution cron
      ...noOpenDeviceReturnWhere(),
      callLogs: {
```

- [ ] **Step 4: แก้ `promise-resolution.cron.ts`**

(ก) import เพิ่ม (ถัดจาก `import { MdmLockService } from '../mdm-lock.service';`):

```ts
import { OPEN_DEVICE_RETURN_STATUSES } from '../../device-returns/device-return.predicate';
```

(ข) แทนบล็อก `if (brokenSlot) { try { await this.mdm.autoLock(…` (origin/main:187-206) ด้วย:

```ts
    if (brokenSlot) {
      // spec 2026-09-20 §5.7: เครื่องอยู่ที่สาขาแล้ว (ใบรับเครื่องคืน PENDING_CONFIRM/CONFIRMED) —
      // นับ broken/kept ตามเดิม (สถิติ/tag ยังต้องเห็น) แต่ไม่สั่งล็อค MDM ซ้ำบนเครื่องที่ไม่ได้อยู่กับลูกค้า
      const heldByShop = await this.prisma.deviceReturn.count({
        where: {
          contractId: p.contractId,
          status: { in: OPEN_DEVICE_RETURN_STATUSES },
          deletedAt: null,
        },
      });
      if (heldByShop > 0) {
        this.logger.log(
          `promise-resolution: contract ${p.contractId} มีใบรับเครื่องคืนเปิดอยู่ — ข้าม MDM autoLock (slot${brokenSlot.slotIndex})`,
        );
        return;
      }
      try {
        await this.mdm.autoLock(
          p.contractId,
          `SLOT_BROKEN:slot${brokenSlot.slotIndex}`,
          systemUserId,
        );
      } catch (err) {
        this.logger.error(
          `MDM autoLock failed for contract ${p.contractId}: ${(err as Error).message}`,
        );
        Sentry.captureException(err, {
          tags: { cron: 'promise-resolution', step: 'mdm-autolock' },
          extra: {
            contractId: p.contractId,
            callLogId: p.id,
            slotIndex: brokenSlot.slotIndex,
          },
        });
        // Promise is already marked broken in DB — alert ops via Sentry to lock manually.
      }
    }
```

- [ ] **Step 5: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/overdue/queue.service.spec.ts src/modules/overdue/crons/promise-resolution.cron.spec.ts`
Expected: PASS ทั้งสองไฟล์ (เทสเดิมของ cron ยัง PASS — `deviceReturn.count` default 0 → autoLock ถูกเรียกตามเดิม)

- [ ] **Step 6: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 13: `DeviceReturnPendingCron` — เตือน FINANCE เมื่อใบค้างยืนยันเกิน 3 วัน / ใกล้สิ้นเดือน (09:20 BKK)

**Files:**
- Create: `apps/api/src/modules/device-returns/device-return-pending.cron.ts`
- Test: `apps/api/src/modules/device-returns/device-return-pending.cron.spec.ts`
- Modify: `apps/api/src/modules/device-returns/device-returns.module.ts` (providers += `DeviceReturnPendingCron`)

**Interfaces:**
- Consumes: `bangkokCalendarParts(date)` (`utils/date.util.ts:108` — **month เป็น 0-indexed**), `daysInMonth(year, month0)` (`:123`), `DEVICE_RETURN_TODO_TAG` (Task 6), pattern `interco-settlement/crons/shop-receivable-aging.cron.ts` (doctrine R-1: root prisma, ไม่ throw ออกจาก tick, dedup Todo ด้วย tag + title)
- Produces: `DeviceReturnPendingCron.tick(): Promise<{ pending: number; stale: number; todosCreated: number; monthEnd: boolean; monthEndTodoCreated: boolean }>`; Todo `MEDIUM` ต่อใบ PENDING_CONFIRM ที่สร้างเกิน 3 วัน (dedup: tag `device-return` + `docNumber` ใน title + ยังไม่ DONE); Todo `HIGH` เมื่อวันนี้อยู่ใน 2 วันสุดท้ายของเดือน BKK และมีใบ PENDING_CONFIRM ใด ๆ (หนึ่งใบต่อเดือน — title มี `สิ้นเดือน yyyy-MM`)

- [ ] **Step 1: เขียนเทสที่ล้มก่อน**

สร้าง `apps/api/src/modules/device-returns/device-return-pending.cron.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { PrismaService } from '../../prisma/prisma.service';
import { DEVICE_RETURN_TODO_TAG } from './device-return-notify.service';
import { DeviceReturnPendingCron } from './device-return-pending.cron';

const DAY = 86_400_000;

function pendingRow(docNumber: string, ageDays: number, now: Date) {
  return {
    id: `id-${docNumber}`,
    docNumber,
    createdAt: new Date(now.getTime() - ageDays * DAY),
    contract: { contractNumber: `BCP-${docNumber.slice(-4)}` },
    customer: { name: 'สมชาย ใจดี' },
    receivingBranch: { name: 'ลาดพร้าว' },
  };
}

describe('DeviceReturnPendingCron', () => {
  let cron: DeviceReturnPendingCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      deviceReturn: { findMany: jest.fn().mockResolvedValue([]) },
      todo: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'todo-x', ...data })),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'sys-uid' }) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [DeviceReturnPendingCron, { provide: PrismaService, useValue: prisma }],
    }).compile();
    cron = mod.get(DeviceReturnPendingCron);
  });

  afterEach(() => jest.useRealTimers());

  it('กลางเดือน: ใบค้างเกิน 3 วัน → Todo MEDIUM ต่อใบ (ใบ 1 วันไม่เตือน), ไม่มี Todo สิ้นเดือน', async () => {
    const now = new Date('2026-09-10T02:20:00.000Z'); // 09:20 BKK วันที่ 10
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([
      pendingRow('DR-20260905-0001', 5, now),
      pendingRow('DR-20260909-0002', 1, now),
    ]);

    const result = await cron.tick();

    expect(prisma.deviceReturn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDING_CONFIRM', deletedAt: null } }),
    );
    expect(result).toEqual({ pending: 2, stale: 1, todosCreated: 1, monthEnd: false, monthEndTodoCreated: false });
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
    expect(prisma.todo.create).toHaveBeenCalledWith({
      data: {
        title: 'ใบรับเครื่องคืน DR-20260905-0001 รอ FINANCE ยืนยันเกิน 5 วัน (สัญญา BCP-0001)',
        description: expect.stringContaining('สมชาย ใจดี'),
        priority: 'MEDIUM',
        tags: [DEVICE_RETURN_TODO_TAG],
        createdById: 'sys-uid',
      },
    });
    expect(prisma.todo.findFirst).toHaveBeenCalledWith({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: { contains: 'DR-20260905-0001' },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it('dedup: ใบเดิมมี Todo เปิดอยู่ → ไม่สร้างซ้ำ', async () => {
    const now = new Date('2026-09-10T02:20:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-20260905-0001', 5, now)]);
    prisma.todo.findFirst.mockResolvedValue({ id: 'todo-old' });

    const result = await cron.tick();

    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ stale: 1, todosCreated: 0 });
  });

  it('2 วันสุดท้ายของเดือน BKK (29 ก.ย. — เดือน 30 วัน) + มีใบค้าง (แม้ยังไม่เกิน 3 วัน) → Todo HIGH หนึ่งใบ title มี "สิ้นเดือน 2026-09"; รันซ้ำไม่สร้างซ้ำ', async () => {
    const now = new Date('2026-09-29T02:20:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-20260928-0009', 1, now)]);

    const first = await cron.tick();
    expect(first).toEqual({ pending: 1, stale: 0, todosCreated: 0, monthEnd: true, monthEndTodoCreated: true });
    expect(prisma.todo.create).toHaveBeenCalledWith({
      data: {
        title: 'ใบรับเครื่องคืนค้างยืนยัน 1 ใบ ก่อนสิ้นเดือน 2026-09 — ยืนยันภายในเดือนนี้ ไม่งั้น JE/ใบลดหนี้ตกเดือนถัดไป',
        description: expect.stringContaining('DR-20260928-0009'),
        priority: 'HIGH',
        tags: [DEVICE_RETURN_TODO_TAG],
        createdById: 'sys-uid',
      },
    });
    expect(prisma.todo.findFirst).toHaveBeenCalledWith({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: { contains: 'สิ้นเดือน 2026-09' },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });

    prisma.todo.findFirst.mockResolvedValue({ id: 'todo-month' });
    const second = await cron.tick();
    expect(second.monthEndTodoCreated).toBe(false);
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
  });

  it('ขอบเขตวันสิ้นเดือน: 28 ก.ย. ยังไม่ใช่ (30 − 2 = 28 < 29) → ไม่มี Todo HIGH; 30 ก.ย. ใช่', async () => {
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-20260927-0001', 1, new Date('2026-09-28T02:20:00.000Z'))]);
    jest.useFakeTimers().setSystemTime(new Date('2026-09-28T02:20:00.000Z'));
    expect((await cron.tick()).monthEnd).toBe(false);
    jest.setSystemTime(new Date('2026-09-30T02:20:00.000Z'));
    expect((await cron.tick()).monthEnd).toBe(true);
  });

  it('ไม่มีใบค้าง → ไม่แตะ Todo/ผู้ใช้ SYSTEM เลย', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T02:20:00.000Z'));
    const result = await cron.tick();
    expect(result).toEqual({ pending: 0, stale: 0, todosCreated: 0, monthEnd: true, monthEndTodoCreated: false });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('ไม่มีผู้ใช้ SYSTEM → ข้ามการสร้าง Todo (Sentry) ไม่ throw', async () => {
    const now = new Date('2026-09-10T02:20:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-20260905-0001', 5, now)]);
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(cron.tick()).resolves.toMatchObject({ stale: 1, todosCreated: 0 });
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('DB พัง → ไม่ throw ออกจาก tick (scheduler ต้องไม่ตาย)', async () => {
    prisma.deviceReturn.findMany.mockRejectedValue(new Error('db down'));
    await expect(cron.tick()).resolves.toEqual({ pending: 0, stale: 0, todosCreated: 0, monthEnd: false, monthEndTodoCreated: false });
  });
});
```

- [ ] **Step 2: รันเทสให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-return-pending.cron.spec.ts`
Expected: FAIL — `Cannot find module './device-return-pending.cron'`

- [ ] **Step 3: เขียน cron**

สร้าง `apps/api/src/modules/device-returns/device-return-pending.cron.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokCalendarParts, daysInMonth } from '../../utils/date.util';
import { DEVICE_RETURN_TODO_TAG } from './device-return-notify.service';

/** ใบค้างยืนยันเกินกี่วันจึงเตือน (spec §8) */
const STALE_DAYS = 3;
/** เหลือกี่วันก่อนสิ้นเดือน BKK จึงเตือนแรง (spec §8: ≤ 2 วัน) */
const MONTH_END_WINDOW_DAYS = 2;
const DAY_MS = 86_400_000;

interface PendingRow {
  id: string;
  docNumber: string;
  createdAt: Date;
  contract: { contractNumber: string };
  customer: { name: string };
  receivingBranch: { name: string };
}

/**
 * เตือน FINANCE เรื่องใบรับเครื่องคืนที่ค้างยืนยัน (spec 2026-09-20 §8 "ช่องว่างข้ามเดือน"):
 * confirm บังคับ paymentDate เดือนปัจจุบัน ⇒ ใบที่สร้าง 30 ก.ย. แต่ยืนยัน 2 ต.ค. ได้ JE/ใบลดหนี้เดือน ต.ค.
 * จึงต้องดันให้ยืนยันก่อนสิ้นเดือน.
 *
 * - Todo MEDIUM ต่อใบที่ PENDING_CONFIRM เกิน 3 วัน — dedup ต่อใบ (tag + docNumber ใน title + ยังไม่ DONE)
 * - Todo HIGH หนึ่งใบต่อเดือนเมื่อวันนี้อยู่ใน 2 วันสุดท้ายของเดือน BKK และมีใบค้างใด ๆ (dedup ด้วย
 *   `สิ้นเดือน yyyy-MM` ใน title) — แม้ใบจะยังไม่ถึง 3 วันก็เตือน เพราะรอไม่ได้ข้ามเดือน
 *
 * doctrine R-1 (pattern shop-receivable-aging.cron.ts): root PrismaService เท่านั้น, ไม่อยู่บนเส้นทางเงิน,
 * ห้าม throw ออกจาก tick (outer try/catch + per-row try/catch). ไม่แตะ GL/สถานะใบ.
 */
@Injectable()
export class DeviceReturnPendingCron {
  private readonly logger = new Logger(DeviceReturnPendingCron.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Daily 09:20 BKK — staggered หลัง 09:07 (interco aging) / 09:15 (letters) */
  @Cron('20 9 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<{
    pending: number;
    stale: number;
    todosCreated: number;
    monthEnd: boolean;
    monthEndTodoCreated: boolean;
  }> {
    try {
      const now = new Date();
      const pending: PendingRow[] = await this.prisma.deviceReturn.findMany({
        where: { status: 'PENDING_CONFIRM', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          docNumber: true,
          createdAt: true,
          contract: { select: { contractNumber: true } },
          customer: { select: { name: true } },
          receivingBranch: { select: { name: true } },
        },
      });

      // bangkokCalendarParts คืน month แบบ 0-indexed (ตรงกับ daysInMonth)
      const { year, month, day } = bangkokCalendarParts(now);
      const monthEnd = day >= daysInMonth(year, month) - MONTH_END_WINDOW_DAYS + 1;
      const yyyyMm = `${year}-${String(month + 1).padStart(2, '0')}`;

      if (pending.length === 0) {
        return { pending: 0, stale: 0, todosCreated: 0, monthEnd, monthEndTodoCreated: false };
      }

      const staleRows = pending.filter((r) => now.getTime() - r.createdAt.getTime() >= STALE_DAYS * DAY_MS);

      const systemUser = await this.prisma.user.findFirst({
        where: { isSystemUser: true },
        select: { id: true },
      });
      if (!systemUser) {
        // ไม่มีช่องทาง Todo เลย — Sentry เป็นช่องทางเดียวที่เหลือ
        Sentry.captureMessage('device-return pending cron: SYSTEM user missing — Todos skipped', {
          level: 'warning',
          tags: { subsystem: 'device-return', cron: 'device-return-pending' },
          extra: { pending: pending.length, stale: staleRows.length, monthEnd },
        });
        this.logger.error(
          `[device-return] ไม่พบผู้ใช้ SYSTEM — ข้ามการสร้าง Todo (ค้าง ${pending.length} ใบ, เกิน ${STALE_DAYS} วัน ${staleRows.length} ใบ)`,
        );
        return { pending: pending.length, stale: staleRows.length, todosCreated: 0, monthEnd, monthEndTodoCreated: false };
      }

      let todosCreated = 0;
      for (const row of staleRows) {
        try {
          const ageDays = Math.floor((now.getTime() - row.createdAt.getTime()) / DAY_MS);
          if (await this.hasOpenTodo(row.docNumber)) continue;
          await this.prisma.todo.create({
            data: {
              title: `ใบรับเครื่องคืน ${row.docNumber} รอ FINANCE ยืนยันเกิน ${ageDays} วัน (สัญญา ${row.contract.contractNumber})`,
              description:
                `ลูกค้า ${row.customer.name} · สาขาที่รับ ${row.receivingBranch.name} · สร้างเมื่อ ${this.bkkDate(row.createdAt)}\n` +
                `ยืนยัน/ส่งกลับที่หน้ายึดคืน → ตาราง "รอ FINANCE ยืนยัน" (ยืนยันได้เฉพาะเดือนปัจจุบัน — ใบข้ามเดือนจะได้ JE/ใบลดหนี้เดือนถัดไป)\n` +
                `deviceReturnId: ${row.id}`,
              priority: 'MEDIUM',
              tags: [DEVICE_RETURN_TODO_TAG],
              createdById: systemUser.id,
            },
          });
          todosCreated++;
        } catch (err) {
          Sentry.captureException(err, {
            tags: { subsystem: 'device-return', cron: 'device-return-pending' },
            extra: { deviceReturnId: row.id, docNumber: row.docNumber },
          });
          this.logger.error(
            `[device-return] สร้าง Todo ของใบ ${row.docNumber} ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      let monthEndTodoCreated = false;
      if (monthEnd) {
        try {
          const marker = `สิ้นเดือน ${yyyyMm}`;
          if (!(await this.hasOpenTodo(marker))) {
            const list = pending.map((r) => `• ${r.docNumber} (สัญญา ${r.contract.contractNumber} · ${r.customer.name} · สาขา ${r.receivingBranch.name})`);
            await this.prisma.todo.create({
              data: {
                title: `ใบรับเครื่องคืนค้างยืนยัน ${pending.length} ใบ ก่อน${marker} — ยืนยันภายในเดือนนี้ ไม่งั้น JE/ใบลดหนี้ตกเดือนถัดไป`,
                description:
                  `การยืนยันบังคับวันลงบัญชีเดือนปัจจุบัน (ใบลดหนี้ต้องอยู่งวดภาษีเดียวกับ JE) — ใบที่ค้างข้ามเดือนจะลงบัญชีเดือนถัดไป\n` +
                  list.join('\n') +
                  `\nข้อมูล ณ ${this.bkkDate(now)} (เวลาไทย)`,
                priority: 'HIGH',
                tags: [DEVICE_RETURN_TODO_TAG],
                createdById: systemUser.id,
              },
            });
            monthEndTodoCreated = true;
          }
        } catch (err) {
          Sentry.captureException(err, {
            tags: { subsystem: 'device-return', cron: 'device-return-pending', step: 'month-end' },
          });
          this.logger.error(
            `[device-return] สร้าง Todo สิ้นเดือนล้มเหลว: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.logger.log(
        `[device-return] pending=${pending.length} stale=${staleRows.length} todosCreated=${todosCreated} monthEnd=${monthEnd} monthEndTodoCreated=${monthEndTodoCreated}`,
      );
      return { pending: pending.length, stale: staleRows.length, todosCreated, monthEnd, monthEndTodoCreated };
    } catch (outerErr) {
      Sentry.captureException(outerErr, {
        tags: { subsystem: 'device-return', cron: 'device-return-pending', scope: 'tick' },
      });
      this.logger.error(
        `[device-return] tick ล้มเหลว: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`,
      );
      return { pending: 0, stale: 0, todosCreated: 0, monthEnd: false, monthEndTodoCreated: false };
    }
  }

  /** dedup: Todo tag device-return ที่ title มีข้อความนี้และยังไม่ DONE */
  private async hasOpenTodo(titleContains: string): Promise<boolean> {
    const existing = await this.prisma.todo.findFirst({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: { contains: titleContains },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });
    return !!existing;
  }

  /** yyyy-mm-dd ตามเวลาไทย */
  private bkkDate(date: Date): string {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  }
}
```

- [ ] **Step 4: ลงทะเบียน provider**

ใน `device-returns.module.ts` เพิ่ม `import { DeviceReturnPendingCron } from './device-return-pending.cron';` และ `providers: [DeviceReturnsService, DeviceReturnNumberService, DeviceReturnNotifyService, DeviceReturnPendingCron]`.

- [ ] **Step 5: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/device-returns/device-return-pending.cron.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Checkpoint**

Run `./tools/check-types.sh api` — Expected: 0 errors. **Do NOT commit** (see Global Constraints).

---

### Task 14: Integration spec `device-return-flow.integration.spec.ts` (DB จริง — golden §6.5) + CI glob `DEVRET_FILES`

**Files:**
- Create: `apps/api/src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts`
- Modify: `.github/workflows/deploy-gcp.yml:277-278` (glob ใหม่หลัง `STOCK_GO_LIVE_FILES`), `:279-293` (run line)

**Interfaces:**
- Consumes: ทุก task ก่อนหน้า + Phase 1 (`deviceReturnFinanceBalance`, `deviceReturnShopBalance`, `IntercoPendingService.getPendingDeviceReturns`, `IntercoAgingService.getTypedAccountDrift`, `classifyShopReceivable` → `'DEVICE_RETURN'`, ด่านใน `ShopCollectSettlementTemplate`), fixture recipe ของ `repossession-jp5.template.spec.ts` (2A งวด 1-4 + ใบเสร็จ Dr 11-1101 / Cr 11-2103 ต่องวด — ให้ตรง CSV case 5 / golden §6.5), harness pattern `interco-netting.integration.spec.ts` (real PrismaClient, no Nest DI, scoped cleanup)
- Produces: หลักฐาน (1) create → confirm โพสต์ JP5 8 บรรทัดตรง golden + SHOP `Dr S11-2002 7,000 / Cr S21-1104 7,000` ทั้งคู่ typed DEVICE_RETURN, (2) typed balances สองสมุด = 7,000 และเข้าคิว `getPendingDeviceReturns`, (3) drift ระดับบัญชีไม่ขยับ (delta 0), (4) tag `RETURNED_DEVICE` + journey `DEVICE_RETURNED`, (5) สถานะสัญญา/เครื่อง, (6) reject คืนสถานะ, (7) awaiting list, (8) ใบรับโอนสด (SHOP_COLLECT) ถูกปฏิเสธ; CI step รัน spec นี้ผ่าน `$DEVRET_FILES`

- [ ] **Step 1: เขียน integration spec (ล้มก่อนเพราะยังไม่มี glob/ยังไม่ได้รัน — ทั้งไฟล์คือเทส)**

สร้าง `apps/api/src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { RepossessionJP5Template } from '../../journal/cpa-templates/repossession-jp5.template';
import { ShopCollectSettlementTemplate } from '../../journal/cpa-templates/shop-collect-settlement.template';
import { classifyShopReceivable } from '../../journal/shop-receivable-type.util';
import { CreditNoteDocumentService } from '../../receipts/services/credit-note-document.service';
import { RepossessionsService } from '../../repossessions/repossessions.service';
import { AuditService } from '../../audit/audit.service';
import { CustomerTagsService } from '../../customer-tags/customer-tags.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { IntercoPendingService } from '../../interco-settlement/interco-pending.service';
import { IntercoAgingService } from '../../interco-settlement/interco-aging.service';
import {
  deviceReturnFinanceBalance,
  deviceReturnShopBalance,
} from '../../interco-settlement/interco-typed-balance';
import { DeviceReturnsService } from '../device-returns.service';
import { DeviceReturnNumberService } from '../device-return-number.service';
import { DeviceReturnNotifyService } from '../device-return-notify.service';

/**
 * ใบรับเครื่องคืน — flow จริงบน DB จริง (spec 2026-09-20 §6.5 golden + §6.2 anti-drift + §5.6/§5.7).
 *
 * สัญญา X: 17,000/12 งวด (CPA golden 17K/12M), งวด 1-4 accrual (2A) + จ่ายแล้ว (ใบเสร็จ Dr 11-1101 /
 * Cr 11-2103 — recipe เดียวกับ repossession-jp5.template.spec.ts "CSV golden case"), งวด 5-12 ค้าง.
 * ราคาประเมิน 7,000 → JP5 ตรง golden §6.5 ทุกบรรทัด + SHOP Dr S11-2002 / Cr S21-1104 typed DEVICE_RETURN.
 *
 * Runner: vitest (jest ignore *.integration.spec.ts). ต้องมี DB:
 *   cd apps/api && npx vitest run --no-file-parallelism src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts
 * CI: glob DEVRET_FILES ใน .github/workflows/deploy-gcp.yml (directory ใหม่ = glob ใหม่ — glob ไม่ recurse)
 *
 * Cleanup: SCOPED ตาม id ที่สเปคนี้สร้าง (audit_logs ลบไม่ได้ — DB trigger immutable ตามดีไซน์)
 */

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring (instance จริง ไม่ผ่าน Nest DI — pattern interco-netting / product-lifecycle)
// ---------------------------------------------------------------------------
const journal = new JournalAutoService(prisma as never);
const audit = new AuditService(prisma as never);
const repossessionsService = new RepossessionsService(
  prisma as never,
  journal,
  new RepossessionJP5Template(journal, prisma as never),
  null as never, // refundPayoutTemplate — legacy เท่านั้น ไม่ถูกเรียก
  null as never, // refundWaiveTemplate — legacy เท่านั้น ไม่ถูกเรียก
  new CreditNoteDocumentService(prisma as never),
  { deliver: async () => ({ delivered: false }) } as never,
);
// ไลน์: NotificationsService ปลอม (ไม่ยิงออกเน็ต) แต่ DeviceReturnNotifyService ของจริง → lineNotifyStatus ถูกเขียนจริง
const sendFromTemplate = vi.fn().mockResolvedValue({ id: 'notif-test', status: 'SENT' });
const notifyService = new DeviceReturnNotifyService(prisma as never, { sendFromTemplate } as never);
const deviceReturns = new DeviceReturnsService(
  prisma as never,
  repossessionsService,
  new DeviceReturnNumberService(prisma as never),
  notifyService,
  new CustomerTagsService(prisma as never),
  new JourneyEntryWriter(prisma as never),
  audit,
  { deliver: async () => ({ delivered: false }) } as never,
);
const pendingService = new IntercoPendingService(prisma as never);
const agingService = new IntercoAgingService(prisma as never);
const shopCollectSettlement = new ShopCollectSettlementTemplate(journal, prisma as never);

// ---------------------------------------------------------------------------
// Tracked rows (SCOPED cleanup)
// ---------------------------------------------------------------------------
const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdBranchIds: string[] = [];

let adminId: string;
let shopId: string;
let financeId: string;
let originBranchId: string;
let receivingBranchId: string;

const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');
const PREFIX = 'DEVRETTEST-';
const dec = (s: string) => new Decimal(s);
const INSTALLMENT_TOTAL = dec('1515.83');

const OWNER = () => ({ id: adminId, role: 'OWNER', branchId: null });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ลูกค้า (มี lineIdFinance → ไลน์ส่งได้) + เครื่อง + สัญญา 17K/12M + 12 งวด (schedule + payment) */
async function seedContract(seq: number, status: 'ACTIVE' | 'TERMINATED') {
  const tag = `${RUN}-${seq}`;
  const customer = await prisma.customer.create({
    data: {
      name: `${PREFIX}Customer ${tag}`,
      phone: `096${RUN_NUM}${seq}`.slice(0, 12),
      nationalId: `${PREFIX}${tag}`,
      lineIdFinance: `U-devret-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const product = await prisma.product.create({
    data: {
      name: `${PREFIX}Phone ${tag}`,
      brand: `${PREFIX}Brand`,
      model: `${PREFIX}Model-${tag}`,
      storage: '128GB',
      imeiSerial: `${PREFIX}${tag}`,
      category: 'PHONE_NEW',
      costPrice: dec('6000.00'),
      branchId: originBranchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeId,
    },
  });
  createdProductIds.push(product.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${PREFIX}${tag}`,
      customerId: customer.id,
      productId: product.id,
      branchId: originBranchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('12000.00'),
      downPayment: dec('2000.00'),
      financedAmount: dec('10000.00'),
      interestRate: dec('0.6000'),
      totalMonths: 12,
      interestTotal: dec('6000.00'),
      storeCommission: dec('1000.00'),
      vatAmount: dec('1190.00'),
      vatPct: dec('0.0700'),
      monthlyPayment: INSTALLMENT_TOTAL,
      status,
    },
  });
  createdContractIds.push(contract.id);

  // 12 งวด — รูปเดียวกับ scenario-helpers.seedStandard17k12m (principal 833.33 + interest 500 + vat 99.17)
  const startDate = new Date('2025-01-01');
  const principalPerInst = dec('10000.00').div(12).toDecimalPlaces(2);
  const interestPerInst = dec('6000.00').div(12).toDecimalPlaces(2);
  const vatPerInst = dec('1190.00').div(12).toDecimalPlaces(2);
  for (let i = 1; i <= 12; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    await prisma.installmentSchedule.create({
      data: {
        contractId: contract.id,
        installmentNo: i,
        dueDate,
        principal: principalPerInst,
        interest: interestPerInst,
        amountDue: principalPerInst.plus(interestPerInst).plus(vatPerInst),
      },
    });
    await prisma.payment.create({
      data: {
        contractId: contract.id,
        installmentNo: i,
        dueDate,
        amountDue: INSTALLMENT_TOTAL,
        amountPaid: dec('0'),
        status: 'PENDING',
      },
    });
  }
  return { contract, product, customer };
}

/** 1A + งวด 1..paidCount: 2A accrual แล้วจ่ายจริง (recipe ของ repossession-jp5.template.spec.ts) */
async function activateAndPay(contractId: string, paidCount: number) {
  await new ContractActivation1ATemplate(journal, prisma as never).execute(contractId);
  const accrual = new InstallmentAccrual2ATemplate(journal, prisma as never);
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  const insts = await prisma.installmentSchedule.findMany({
    where: { contractId },
    orderBy: { installmentNo: 'asc' },
  });
  for (let i = 0; i < paidCount; i++) {
    await accrual.execute(insts[i].id);
    const payment = await prisma.payment.update({
      where: { contractId_installmentNo: { contractId, installmentNo: insts[i].installmentNo } },
      data: { amountPaid: INSTALLMENT_TOTAL, paidDate: new Date(), paidAt: new Date(), status: 'PAID' },
    });
    await journal.createAndPost({
      description: `รับชำระงวด #${insts[i].installmentNo} — สัญญา ${contract.contractNumber}`,
      reference: payment.id,
      metadata: { tag: 'receipt', contractId, installmentScheduleId: insts[i].id, paymentId: payment.id },
      lines: [
        { accountCode: '11-1101', dr: INSTALLMENT_TOTAL, cr: dec('0'), description: 'รับเงิน' },
        { accountCode: '11-2103', dr: dec('0'), cr: INSTALLMENT_TOTAL, description: 'ล้างลูกหนี้ค้างชำระ' },
      ],
    });
  }
}

async function jeByFlow(contractId: string, flow: string) {
  const rows = await prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } } as never,
        { metadata: { path: ['flow'], equals: flow } } as never,
      ],
      deletedAt: null,
    },
    include: { lines: true },
  });
  return rows;
}

const tuples = (lines: Array<{ accountCode: string; debit: Decimal; credit: Decimal }>) =>
  lines
    .map((l) => [l.accountCode, l.debit.toFixed(2), l.credit.toFixed(2)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

describe('ใบรับเครื่องคืน — create → confirm บน DB จริง (spec 2026-09-20)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);
    // แม่แบบไลน์มาจาก migration 20261003200000_seed_device_return_templates (ไม่มี seeder) —
    // DB เทสได้แถวจาก `prisma migrate deploy`; ถ้าหายแปลว่า migration ยังไม่ apply
    expect(
      await prisma.notificationTemplate.findUnique({ where: { eventType: 'DEVICE_RETURNED' } }),
      'ไม่พบแม่แบบ DEVICE_RETURNED — รัน `npx prisma migrate deploy` (20261003200000_seed_device_return_templates)',
    ).not.toBeNull();

    shopId = (await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } })).id;
    financeId = (await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'FINANCE', deletedAt: null } })).id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    for (const name of ['__device_return_origin_branch__', '__device_return_receiving_branch__']) {
      const existing = await prisma.branch.findFirst({ where: { name, deletedAt: null } });
      const id = existing ? existing.id : (await prisma.branch.create({ data: { name, companyId: shopId } })).id;
      if (!existing) createdBranchIds.push(id);
      if (name.includes('origin')) originBranchId = id;
      else receivingBranchId = id;
    }
  }, 120_000);

  afterAll(async () => {
    const jeIds = new Set<string>();
    for (const cid of createdContractIds) {
      const rows = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: cid } as never },
        select: { id: true },
      });
      rows.forEach((r) => jeIds.add(r.id));
    }
    const jeIdList = [...jeIds];
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

    await prisma.receipt.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.deviceReturn.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.repossession.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.badDebtProvision.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.payment.deleteMany({ where: { contractId: { in: createdContractIds } } });
    await prisma.customerJourneyEntry.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.customerTag.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    for (const id of createdBranchIds) {
      try {
        await prisma.branch.delete({ where: { id } });
      } catch {
        // referenced elsewhere — leave it
      }
    }
    await prisma.$disconnect();
  }, 120_000);

  // -------------------------------------------------------------------------
  it(
    'สัญญา X (คืนเอง): create หยุดสัญญา + tag + ไลน์ → confirm โพสต์ JP5 ตรง golden §6.5 + SHOP legs typed DEVICE_RETURN, เข้าคิวหักรอบจ่าย, drift ไม่ขยับ, journey, ใบรับโอนสดถูกปฏิเสธ',
    async () => {
      const { contract, product, customer } = await seedContract(1, 'ACTIVE');
      await activateAndPay(contract.id, 4);
      const driftBefore = await agingService.getTypedAccountDrift();

      // --- สาขาบันทึก (OWNER ระบุสาขาที่รับ — D7 รับข้ามสาขาได้)
      const intake = await deviceReturns.create(
        {
          contractId: contract.id,
          deviceReceivedAt: new Date().toISOString(),
          conditionGrade: 'B',
          appraisalPrice: 7000,
          returnReason: 'UNAFFORDABLE',
          receivingBranchId,
        },
        OWNER() as never,
      );
      expect(intake.docNumber).toMatch(/^DR-\d{8}-\d{4}$/);
      expect(intake).toMatchObject({ status: 'PENDING_CONFIRM', returnKind: 'VOLUNTARY', appraisalPrice: '7000.00', lineNotifyStatus: 'SENT' });
      expect(sendFromTemplate).toHaveBeenLastCalledWith(
        'DEVICE_RETURNED',
        expect.objectContaining({ docNumber: intake.docNumber, contractNumber: contract.contractNumber }),
        `U-devret-${RUN}-1`,
        { customerId: customer.id, relatedId: intake.id },
      );
      // D4: สัญญาหยุดทันที + audit CONTRACT_STATUS_LEGAL ใน tx
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe('TERMINATED');
      expect(
        await prisma.auditLog.findFirst({
          where: { action: 'CONTRACT_STATUS_LEGAL', entity: 'contract', entityId: contract.id },
        }),
      ).toMatchObject({ newValue: expect.objectContaining({ from: 'ACTIVE', to: 'TERMINATED', reason: 'DEVICE_RETURN_INTAKE' }) });
      // §5.6 tag ติดทันทีตอนสร้าง (recompute หลัง commit)
      expect(
        await prisma.customerTag.findFirst({ where: { customerId: customer.id, tag: 'RETURNED_DEVICE', deletedAt: null } }),
      ).toMatchObject({ source: 'AUTO' });
      // ยังไม่มี JE ใด ๆ ของการยึดก่อนยืนยัน
      expect(await jeByFlow(contract.id, 'repossession')).toHaveLength(0);
      expect(await jeByFlow(contract.id, 'shop-repossession-intake')).toHaveLength(0);

      // --- FINANCE ยืนยัน
      const confirmed = await deviceReturns.confirm(intake.id, {}, OWNER() as never);
      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.repossessionId).toBeTruthy();
      expect(confirmed.creditNote?.outcome).toBe('SKIPPED_NO_ACCRUED'); // งวด accrual 1-4 จ่ายครบ → ไม่มี CN

      // golden §6.5 — JP5 (FINANCE)
      const [jp5] = await jeByFlow(contract.id, 'repossession');
      expect(jp5.status).toBe('POSTED');
      expect(tuples(jp5.lines)).toEqual([
        ['11-2101', '0.00', '11333.36'],
        ['11-2105', '0.00', '793.32'],
        ['11-2106', '4000.00', '0.00'],
        ['11-2107', '7000.00', '0.00'],
        ['21-2101', '0.00', '793.32'],
        ['21-2102', '793.32', '0.00'],
        ['41-1101', '0.00', '4000.00'],
        ['51-1102', '5126.68', '0.00'],
      ]);
      const jp5Meta = jp5.metadata as Record<string, unknown>;
      expect(jp5Meta.shopReceivableType).toBe('DEVICE_RETURN');
      expect(jp5Meta.shopReceivable).toBe('11-2107');
      expect(jp5Meta.deviceReturnId).toBe(intake.id);
      expect(jp5Meta.collectedByShop).toBeUndefined();
      expect(classifyShopReceivable(jp5Meta)).toBe('DEVICE_RETURN');

      // golden §6.5 — SHOP intake
      const [shopIntake] = await jeByFlow(contract.id, 'shop-repossession-intake');
      expect(shopIntake.companyId).toBe(shopId);
      expect(tuples(shopIntake.lines)).toEqual([
        ['S11-2002', '7000.00', '0.00'],
        ['S21-1104', '0.00', '7000.00'],
      ]);
      const intakeMeta = shopIntake.metadata as Record<string, unknown>;
      expect(intakeMeta.shopReceivableType).toBe('DEVICE_RETURN');
      expect(intakeMeta.deviceReturnId).toBe(intake.id);
      expect(classifyShopReceivable(intakeMeta)).toBe('DEVICE_RETURN');

      // §6.2 typed balances สองสมุด + คิวหักรอบจ่าย (Phase 1 lens)
      expect((await deviceReturnFinanceBalance(prisma, contract.id)).toFixed(2)).toBe('7000.00');
      expect((await deviceReturnShopBalance(prisma, contract.id)).toFixed(2)).toBe('7000.00');
      const queue = await pendingService.getPendingDeviceReturns();
      const queued = queue.find((q) => q.contractId === contract.id);
      expect(queued).toBeDefined();
      expect(queued!.deviceReturnGl.toFixed(2)).toBe('7000.00');
      expect(queued!.shopDeviceReturnGl.toFixed(2)).toBe('7000.00');
      expect(queued!.contractNumber).toBe(contract.contractNumber);

      // §6.2 anti-drift: ใบใหม่ทั้งสองต้องถูกเลนส์ classify ได้ครบ — drift ระดับบัญชีไม่ขยับ, lensTotal +7,000
      const driftAfter = await agingService.getTypedAccountDrift();
      for (const after of driftAfter) {
        const before = driftBefore.find((b) => b.accountCode === after.accountCode)!;
        expect(after.drift.minus(before.drift).toFixed(2), `${after.accountCode} drift delta`).toBe('0.00');
        expect(after.lensTotal.minus(before.lensTotal).toFixed(2), `${after.accountCode} lens delta`).toBe('7000.00');
      }

      // สถานะสัญญา/เครื่อง/แถวยึด (§5.2 ข้อ 3)
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe('CLOSED_BAD_DEBT');
      const afterProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(afterProduct.status).toBe('REPOSSESSED');
      expect(afterProduct.ownedByCompanyId).toBe(shopId);
      expect(afterProduct.category).toBe('PHONE_USED');
      expect(afterProduct.branchId).toBe(receivingBranchId); // ที่อยู่เครื่องจริง = สาขาที่รับ
      const repossession = await prisma.repossession.findUniqueOrThrow({ where: { id: confirmed.repossessionId! } });
      expect(repossession.appraisedById).toBe(adminId);
      expect(repossession.appraisalPrice.toFixed(2)).toBe('7000.00');
      expect(repossession.notes).toContain('เหตุผลคืนเครื่อง: ลูกค้าไม่สามารถผ่อนต่อได้');
      expect(await prisma.deviceReturn.findFirst({ where: { contractId: contract.id, status: 'PENDING_CONFIRM' } })).toBeNull();

      // journey (§5.6) หลัง commit
      expect(
        await prisma.customerJourneyEntry.findFirst({ where: { dedupeKey: `DEVICE_RETURNED:${intake.id}` } }),
      ).toMatchObject({
        customerId: customer.id,
        kind: 'DEVICE_RETURNED',
        refType: 'contract',
        refId: contract.id,
        data: { docNumber: intake.docNumber, contractNumber: contract.contractNumber, returnKind: 'VOLUNTARY', returnReason: 'UNAFFORDABLE' },
      });
      // audit หลัง commit (hash chain)
      expect(await prisma.auditLog.findFirst({ where: { action: 'DEVICE_RETURN_CONFIRMED', entityId: intake.id } })).toBeTruthy();
      expect(await prisma.auditLog.findFirst({ where: { action: 'SHOP_COLLECT_REPOSSESSION', entityId: contract.id } })).toBeNull();

      // §6.4 ล้างซ้ำสองทางไม่ได้ — ใบรับโอนสดของแถวเก่า (SHOP_COLLECT) ถูกด่าน Phase 1 ปฏิเสธ
      await expect(
        shopCollectSettlement.execute({ contractId: contract.id, depositAccountCode: '11-1201', amount: dec('7000.00') }),
      ).rejects.toThrow(/ค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO/);
      expect((await deviceReturnFinanceBalance(prisma, contract.id)).toFixed(2)).toBe('7000.00');

      // ยืนยันซ้ำ / สร้างใบซ้ำบนสัญญาที่ปิดแล้ว → 409/400 ไม่มี JE เพิ่ม
      await expect(deviceReturns.confirm(intake.id, {}, OWNER() as never)).rejects.toThrow(/ถูกยืนยัน\/ส่งกลับ\/ยกเลิกไปแล้ว/);
      expect(await jeByFlow(contract.id, 'repossession')).toHaveLength(1);
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it(
    'สัญญา R: create (ACTIVE → TERMINATED) → reject คืนสถานะเดิม + ใบ REJECTED + ไลน์ยกเลิก + tag หลุด — ไม่มี JE ใด ๆ',
    async () => {
      const { contract, customer } = await seedContract(2, 'ACTIVE');
      await activateAndPay(contract.id, 0);

      const intake = await deviceReturns.create(
        {
          contractId: contract.id,
          deviceReceivedAt: new Date().toISOString(),
          conditionGrade: 'C',
          appraisalPrice: 5000,
          returnReason: 'NO_LONGER_NEEDED',
          receivingBranchId,
        },
        OWNER() as never,
      );
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe('TERMINATED');

      // ใบที่สองบนสัญญาเดียวกันขณะยังรอ → 409 (partial unique + ด่าน 5)
      await expect(
        deviceReturns.create(
          { contractId: contract.id, deviceReceivedAt: new Date().toISOString(), conditionGrade: 'C', appraisalPrice: 5000, returnReason: 'OTHER', notes: 'ซ้ำ', receivingBranchId },
          OWNER() as never,
        ),
      ).rejects.toThrow(/รอยืนยันอยู่แล้ว/);

      const rejected = await deviceReturns.reject(intake.id, { reason: 'ใบผิดสัญญา กรุณาตรวจใหม่' }, OWNER() as never);
      expect(rejected).toMatchObject({ status: 'REJECTED', rejectReason: 'ใบผิดสัญญา กรุณาตรวจใหม่', notice: null });
      expect(sendFromTemplate).toHaveBeenLastCalledWith('DEVICE_RETURN_CANCELED', expect.anything(), `U-devret-${RUN}-2`, expect.anything());
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe('ACTIVE');
      const legal = await prisma.auditLog.findMany({
        where: { action: 'CONTRACT_STATUS_LEGAL', entity: 'contract', entityId: contract.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(legal.map((a) => (a.newValue as { reason: string }).reason)).toEqual(['DEVICE_RETURN_INTAKE', 'DEVICE_RETURN_REJECTED']);
      // tag หลุดเอง (ไม่มีใบเปิด ไม่มีแถวยึด)
      expect(await prisma.customerTag.findFirst({ where: { customerId: customer.id, tag: 'RETURNED_DEVICE', deletedAt: null } })).toBeNull();
      expect(await jeByFlow(contract.id, 'repossession')).toHaveLength(0);
      expect(await prisma.repossession.findFirst({ where: { contractId: contract.id } })).toBeNull();
      // ส่งกลับแล้วสร้างใบใหม่ได้ (partial unique นับเฉพาะ PENDING_CONFIRM)
      const again = await deviceReturns.create(
        { contractId: contract.id, deviceReceivedAt: new Date().toISOString(), conditionGrade: 'C', appraisalPrice: 5000, returnReason: 'UNAFFORDABLE', receivingBranchId },
        OWNER() as never,
      );
      expect(again.status).toBe('PENDING_CONFIRM');
      const canceled = await deviceReturns.cancel(again.id, OWNER() as never);
      expect(canceled.status).toBe('CANCELED');
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe('ACTIVE');
    },
    120_000,
  );

  // -------------------------------------------------------------------------
  it('สัญญา T (TERMINATED รอยึด): อยู่ในรายการ awaiting → create ใบประเภท REPOSSESSION (เหตุผลตั้งให้เอง) → หายจากรายการ', async () => {
    const { contract } = await seedContract(3, 'TERMINATED');
    await activateAndPay(contract.id, 0);

    const before = await deviceReturns.awaitingRepossession(OWNER() as never);
    expect(before.data.map((r) => r.id)).toContain(contract.id);

    const intake = await deviceReturns.create(
      { contractId: contract.id, deviceReceivedAt: new Date().toISOString(), conditionGrade: 'A', appraisalPrice: 9000, receivingBranchId },
      OWNER() as never,
    );
    expect(intake.returnKind).toBe('REPOSSESSION');
    expect(intake.returnReason).toBe('AFTER_TERMINATION');
    expect(intake.receivingBranch.id).toBe(receivingBranchId);

    const after = await deviceReturns.awaitingRepossession(OWNER() as never);
    expect(after.data.map((r) => r.id)).not.toContain(contract.id);
    // preview บอกล่วงหน้าว่าสร้างซ้ำไม่ได้
    const preview = await deviceReturns.preview({ contractId: contract.id, conditionGrade: 'A' }, OWNER() as never);
    expect(preview.eligibility).toEqual({ canCreate: false, reason: 'สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว' });
    expect(preview.returnKind).toBe('REPOSSESSION');
    expect(preview.allowedReasons).toEqual(['AFTER_TERMINATION']);
  }, 120_000);
});
```

- [ ] **Step 2: รัน spec (DB จริง)**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts; cd ../..`
Expected: PASS (3 tests). ถ้า golden JP5 ต่างที่ `51-1102`/`11-2103` ให้ตรวจก่อนว่า `activateAndPay` ทำครบ 4 งวด (2A + ใบเสร็จ) — สูตร CSV case 5 ต้องการ "accrual แล้วจ่ายจริง" ไม่ใช่ "จ่ายโดยไม่ accrual" (ดูคอมเมนต์หัวไฟล์; ตัวเลข §6.5 มาจาก recipe นี้)

- [ ] **Step 3: เพิ่ม glob ใน CI (glob ไม่ recurse — directory ใหม่ = glob ใหม่)**

ใน `.github/workflows/deploy-gcp.yml` step `Run DB-backed money-invariant specs (vitest — #1328)`:

(ก) ถัดจาก (origin/main:277-278)
```yaml
          # Stock go-live wipe (2026-09-05) — ตรรกะอยู่ใต้ src/cli/ ⇒ directory ใหม่ = glob ใหม่
          STOCK_GO_LIVE_FILES=$(ls src/cli/stock-go-live/__tests__/*.integration.spec.ts)
```
เพิ่ม
```yaml
          # ใบรับเครื่องคืน (2026-09-20) — directory ใหม่ ⇒ glob ใหม่ (บทเรียน jp5-vat-split: glob ไม่ recurse เอง)
          DEVRET_FILES=$(ls src/modules/device-returns/__tests__/*.integration.spec.ts)
```

(ข) run line (origin/main:279-293) — ต่อท้าย `$STOCK_GO_LIVE_FILES` ด้วย `\` และบรรทัดใหม่:
```yaml
          npx vitest run --no-file-parallelism $FILES \
            src/modules/installments/reschedule.service.spec.ts \
            $ACCT_FILES \
            $JP5_FILES \
            $EXCH_FILES \
            $INTERCO_FILES \
            $CONTRACTS_FILES \
            $JOURNAL_FILES \
            $OVERDUE_FILES \
            $PAYMENTS_FILES \
            $EXPDOC_FILES \
            $DASH_FILES \
            $EQUITY_FILES \
            $SALES_FILES \
            $STOCK_GO_LIVE_FILES \
            $DEVRET_FILES
```

หมายเหตุ: `repossession-jp5.template.spec.ts` / `shop-collect-shop-legs.template.spec.ts` (Task 3) อยู่ใต้ `cpa-templates/` ครอบโดย `$FILES` เดิม; `product-lifecycle.integration.spec.ts` (Task 4/10) ครอบโดย `$CONTRACTS_FILES`; jest specs ใหม่ทั้งหมด (Task 1/2/5/6/7/9/10/11/12/13) ถูก `testRegex .*\.spec\.ts$` ของ step "Test API" จับเอง.

- [ ] **Step 4: ตรวจ YAML + รัน glob เดียวกับ CI ในเครื่อง**

Run: `cd apps/api && DEVRET_FILES=$(ls src/modules/device-returns/__tests__/*.integration.spec.ts) && echo "$DEVRET_FILES" && npx vitest run --no-file-parallelism $DEVRET_FILES; cd ../..`
Expected: พิมพ์ `src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts` แล้ว PASS

- [ ] **Step 5: Checkpoint สุดท้ายของ Phase 2**

Run: `./tools/check-types.sh api` — Expected: 0 errors
Run: `npm --prefix apps/api test -- src/modules/device-returns src/modules/repossessions src/modules/customer-tags src/modules/overdue/queue.service.spec.ts src/modules/overdue/crons/promise-resolution.cron.spec.ts src/modules/customer-journey/journey-data-schemas.spec.ts src/modules/customer-journey/sources/entries.source.spec.ts` — Expected: PASS ทั้งหมด
Run: `cd apps/api && npx vitest run --no-file-parallelism src/modules/journal/cpa-templates/repossession-jp5.template.spec.ts src/modules/journal/cpa-templates/shop-collect-shop-legs.template.spec.ts src/modules/contracts/__tests__/product-lifecycle.integration.spec.ts src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts src/modules/interco-settlement/__tests__/interco-netting.integration.spec.ts; cd ../..` — Expected: PASS ทั้งหมด (netting spec ของ Phase 1/เดิมต้องไม่แดงจากการเปลี่ยน template)
**Do NOT commit** (see Global Constraints) — ส่งต่อ Phase 3 (หน้าจอ + เอกสาร) บน branch เดียวกัน. Prod rollout ของ Phase 2 = `prisma migrate deploy` อย่างเดียว (ตาราง + enum + แม่แบบไลน์มากับ migration `20261003100000` / `20261003200000`; ไม่ต้อง `seed:coa` — ไม่มีบัญชีใหม่).

---

## สิ่งที่ Phase 3 (เว็บ) พึ่งจาก Phase 2 — รูปคำตอบของ API (สรุปเพื่อให้สองแผนตรงกัน)

| Endpoint | คืน |
|---|---|
| `GET /device-returns/lookup?q=` | array ≤ 20: `{ id, contractNumber, status, customer: { id, name }, product: { id, brand, model, imeiSerial } \| null, branch: { id, name } \| null }` (ไม่มีเบอร์; q < 3 ตัว → `[]`) |
| `GET /device-returns/preview?contractId&conditionGrade&appraisalPrice` | `DeviceReturnPreview` (Task 7): `{ contract, returnKind, eligibility: { canCreate, reason }, allowedReasons, valuation, deviationPct, outstandingBalance }` |
| `GET /device-returns/awaiting-repossession` | `{ data: AwaitingRow[], total }` — `AwaitingRow = { id, contractNumber, status, monthlyPayment: string, customer: { id, name, phone }, product: { id, name, brand, model } \| null, branch: { id, name } \| null }` (limit 100, BM กรอง `contract.branchId`) |
| `GET /device-returns?…` / `GET /device-returns/:id` | `{ data: DeviceReturnRow[], total, page, limit }` / `DeviceReturnRow` (Task 7) |
| `POST /device-returns` | `DeviceReturnRow` (มี `docNumber`, `lineNotifyStatus` หลังส่งไลน์แล้ว) |
| `POST /device-returns/:id/confirm` | `DeviceReturnRow & { creditNote: { outcome, receiptId? } \| null }` |
| `POST /device-returns/:id/reject` · `/cancel` | `DeviceReturnRow & { notice: string \| null }` (notice = คำเตือนใบข้ามเดือน) |
| `POST /device-returns/:id/resend-line` | `DeviceReturnRow` |
| `GET /repossessions/preview/:contractId?deviceReturnId&discountPct` | รูปเดิม (`contract/calculation/journalPreview/valuation/eligibility`) — เกรด/ราคาจากใบ, JP5 preview deposit `11-2107` DEVICE_RETURN |
| `GET /repossessions` rows | += `deviceReturnOutstanding: string` (ปุ่ม "รับโอนหน้าร้าน" ยังผูก `shopCollectOutstanding > 0` ของแถวเก่าเท่านั้น) |
