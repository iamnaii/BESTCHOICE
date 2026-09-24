# ยื่น GFIN PR 1 — ใบยื่นในแท็บ GFIN + หยิบรูปจากแชท + หน้าลิงก์ชุดเช็ค + ส่งแบบคัดลอก Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** พนักงานเปิดแท็บ "GFIN" ในห้องแชท รวมชุดเช็ค (ข้อมูล 12 ข้อ + ไฟล์ตามช่อง) ครั้งเดียว ได้ลิงก์หน้าชุดเช็คสาธารณะที่เจ้าหน้าที่ GFIN เปิดดู ดาวน์โหลด และกดตอบกลับได้ แล้วส่งข้อความ+ลิงก์เข้ากลุ่มไลน์ด้วยปุ่มคัดลอก (บอทส่งเป็น PR 2)

**Architecture:** โมดูลใหม่ `external-finance-application` (NestJS/Prisma) ถือใบยื่น ไฟล์ ไทม์ไลน์ และโทเคนลิงก์ · การหยิบไฟล์จากแชทใช้ท่อเดียวกับตรวจเครดิต (`fetchProviderMedia`/`detectFile` ที่แยกออกมาเป็น util) + ดึงจาก LINE ด้วย message id · หน้าลิงก์เป็น HTML ที่ API เรนเดอร์เองใต้ `/api/g/:token` ตามแบบ `/api/shop/share/:id` · ฝั่งเว็บเพิ่มแท็บที่ 4 ใน `RoomDossier` ด้วย hook `useFinanceApplication` ที่เลียนแบบ `useRoomCredit` ทุกประการ

**Tech Stack:** NestJS 10 + Prisma + PostgreSQL (jest unit ด้วย mock · `*.db.spec.ts` บน test_db) · `packages/shared` (builder ข้อความ) · React 18 + Vite + Tailwind + shadcn + lucide-react + @tanstack/react-query (vitest + testing-library) · `archiver` (zip, dependency ใหม่)

**Spec:** `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md` (ทุกข้อ ยกเว้น §10 LINE บอท และ §6.5 หน้าตั้งค่า ซึ่งเป็น PR 2) · mockup https://claude.ai/artifact/U3DMgJ3SWb8whpiiuLYPsa บอร์ด 1–8, 10–14

## Global Constraints

- Branch `feat/gfin-precheck` (rebase บน origin/main `e90cae267` แล้ว มี spec 1 commit) · migration ใหม่ชื่อ `20261009000000_external_finance_application` (ล่าสุดคือ `20261008000000_after_sales_cases`)
- Prisma: UUID id · `createdAt/updatedAt/deletedAt` ทุก model (ยกเว้น event log แบบ append-only ต้องมี `///` comment) · ห้าม hard delete · ทุก query กรอง `deletedAt: null` · enum PascalCase ค่าตัว SCREAMING_SNAKE · migration SQL เขียนมือแบบ additive · prod ใช้ `prisma migrate deploy` เท่านั้น (`.claude/rules/database.md`)
- ห้าม `await this.audit.log(...)` ใน `$transaction` (โมดูลนี้ไม่เขียน AuditLog เอง — มีตาราง event ของตัวเอง; `AuditInterceptor` global จดทุก mutating route ให้อยู่แล้ว)
- ทุก controller พนักงาน: `@UseGuards(JwtAuthGuard, RolesGuard)` ระดับ class + `@Roles(...)` ทุก method · roles ของฟีเจอร์นี้ = `'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'` · SALES เข้าถึงเฉพาะห้องที่ `assignedToId` ว่างหรือเป็นตัวเอง (กติกา `access()` ของ `room-credit.service.ts:92-98`) · controller สาธารณะ (`g/*`) ไม่มี guard แต่ต้องมี `@Throttle` ทุก route และต้องเพิ่มในรายการ "Intentionally Public Endpoints" ของ `.claude/rules/security.md`
- ห้ามรัน `npm run lint` ใน apps/api (มี `--fix`) · type-check ด้วย `./tools/check-types.sh api` / `web` / `all` (build shared ก่อนเอง) · jest: `cd apps/api && npx jest <ไฟล์> --runInBand` · DB spec ต้องรันกับ `DATABASE_URL` ของฐานทดสอบ (`test_db` หรือ `*_test`) และล้างแถวที่สร้างเองใน `afterAll` (ลูกก่อนแม่)
- เว็บ: `useQuery`/`useMutation` เท่านั้น · `api` จาก `@/lib/api` เป็น axios instance (`api.get(url,{params})`, `.post`, `.patch`, `.delete`; response envelope `{success,data}` ถูกแกะแล้ว) · ห้าม hex/`text-gray-*`/`bg-white` · ตัวอักษรบน `bg-primary` ใช้ `text-primary-foreground` · สีเหลืองตัวอักษร `text-warning-strong` · แดง `text-destructive` · ไทย `leading-snug` · สถานะต้องมีไอคอน/ข้อความ · `toast` จาก `sonner` · ไอคอน lucide-react
- ถ้อยคำ (spec §7): ข้อความ 12 ข้อใช้แม่แบบเดิมเป๊ะ ข้อ 8–12 = `-` เสมอ · ชื่อรุ่นเต็มตามสต๊อก · ป้ายแท็บ = "GFIN" · หัวกลุ่ม "ใบยื่นใหม่" / "ใบยื่น (ร่าง)" / "ใบยื่น BC-…" · ห้ามเรียกปุ่มตอบของ GFIN ว่า "อนุมัติทางการ" — ใช้คำ "ผ่าน (แจ้งผ่านลิงก์)"
- เลขใบยื่น `BC-YYMMDD-NNN` (วันตาม Asia/Bangkok, ลำดับต่อวัน, advisory lock `hashLockKey('finance-app:<yymmdd>')` จาก `src/utils/advisory-lock.util.ts`)
- ลิงก์: โทเคน 32 ไบต์ `base64url` · หน้าลิงก์ค้นด้วย **sha256 hex** (`shareTokenHash`) เท่านั้น · โทเคนดิบเก็บเข้ารหัส `encryptPII(token, PII_ENCRYPTION_KEY)` ใน `shareTokenEnc` (ให้ปุ่ม "เปิดหน้าลิงก์"/ส่งเพิ่ม ใช้ลิงก์เดิมได้ — เบี่ยงจาก spec §12 ที่เขียนว่า "ไม่เก็บโทเคนดิบ" → บันทึกลง spec ใน Task 5) · อายุ 7 วัน (`SHARE_TTL_DAYS = 7`) · URL จริง `${SHARE_PAGE_BASE_URL}/api/g/<token>` — env ใหม่ `SHARE_PAGE_BASE_URL=https://bestchoicephone.app` (fallback `PAYMENT_LINK_BASE_URL`) เพิ่มใน `.env.example` และ deploy workflow (Task 7)
- ไฟล์: ≤ 10 MB · JPEG/PNG/GIF/WebP/PDF ตรวจจาก magic bytes (`detectFile`) · key `external-finance/<applicationId>/<uuid>.<ext>` · ≤ 40 ไฟล์ต่อใบ (`MAX_FILES = 40`)
- ทุก deploy ต้อง bump `version` ใน `apps/web/package.json` (ตอนนี้ `26.9.52` → PR นี้ `26.9.53`)
- MCP: หลัง migration ต้องเติมตารางใหม่ใน `.claude/mcp/sql/policy.mjs` (allowlist ระดับคอลัมน์) แล้ว `npm run grants` ใน `.claude/mcp` — ห้ามให้คอลัมน์ `share_token_hash`, `share_token_enc`, `summary`, `message_text`, `occupation_override`, `original_name`, `actor_name`, `note`, `meta`

## Review Focus

1. **ลูกค้าส่งรูปทาง Facebook มานานเกินอายุลิงก์ของ Meta** — กดหยิบต้องได้ 400 ข้อความ "ไฟล์หมดอายุ…ขอลูกค้าส่งใหม่" ไม่ใช่ 500 และไม่มีไฟล์ค้างใน storage (เทสต์ Task 4)
2. **หยิบรูปเดิมซ้ำ หรือกดถัดไปโดยไม่มีไฟล์บังคับ** — ต้องไม่สร้างแถวซ้ำ (unique `applicationId+sourceMessageId`) และ `send` ต้อง 400 ระบุช่องที่ขาด (เทสต์ Task 4, 5)
3. **เปิดลิงก์ที่หมดอายุ/ถูกยกเลิก/โทเคนมั่ว** — ต้อง 410 หน้าเดียวกันไม่มีข้อมูลลูกค้า และไม่นับ view (เทสต์ Task 6)
4. **GFIN กดตอบหลังใบปิดแล้ว หรือกดรัว ๆ** — ต้อง 409 ไทย และ throttle 10/นาที ไม่เปลี่ยนสถานะซ้ำ (เทสต์ Task 6)
5. **SALES เปิดห้องที่มอบหมายให้คนอื่น** — ทุก route ของใบยื่นต้อง 403 (เทสต์ Task 3)
6. **ห้อง LINE ไฟแนนซ์ที่รูปถูกบันทึกก่อน PR นี้** (ไม่มี message id) — ปุ่มหยิบต้องไม่ขึ้น และ API ต้อง 404 ข้อความชี้ให้อัปโหลดแทน (เทสต์ Task 4, 9)

## File Structure

API (`apps/api`):
- `prisma/schema.prisma` — 7 enum + 3 model + back-relation (Task 1)
- `prisma/migrations/20261009000000_external_finance_application/migration.sql` (Task 1)
- `src/modules/chatbot-finance/services/chat-room.service.ts` + `chatbot-finance.service.ts` — เก็บ `externalMessageId` ของรูป/ไฟล์ (Task 1)
- `src/modules/credit-check/services/media-fetch.util.ts` — `detectFile`/`readLimited`/`fetchProviderMedia` แยกจาก `room-credit.service.ts` (Task 4)
- `src/modules/external-finance-application/`
  - `external-finance-application.module.ts` (Task 3)
  - `constants.ts` — roles, slot config, ค่าคงที่ (Task 3)
  - `finance-application-status.util.ts` — state machine บริสุทธิ์ (Task 3)
  - `services/finance-application-number.service.ts` — `BC-YYMMDD-NNN` (Task 3)
  - `services/finance-application.service.ts` — สร้าง/อ่าน/แก้/ส่ง/ผล/ยกเลิก/ลิงก์ (Task 3, 5)
  - `services/finance-application-files.service.ts` — หยิบจากแชท/อัปโหลด/จากสต๊อก/ลบ/สตรีม (Task 4)
  - `services/finance-share.service.ts` — โทเคน, หน้าลิงก์, zip, ตอบกลับ, view log (Task 6)
  - `services/finance-share-page.util.ts` — HTML builder (Task 6)
  - `services/finance-application-notify.service.ts` — Todo + IN_APP (Task 7)
  - `crons/finance-application-purge.cron.ts` (Task 7)
  - `room-finance-applications.controller.ts` — `staff-chat/rooms/:roomId/finance-applications` (Task 3, 4)
  - `finance-applications.controller.ts` — `finance-applications/:id/*` (Task 4, 5)
  - `finance-share-public.controller.ts` — `g/:token/*` (Task 6)
  - `dto/*.dto.ts` (Task 3–6)
  - `__tests__/*.spec.ts` (mock) + `__tests__/finance-application-flow.db.spec.ts` (DB จริง)
- `src/app.module.ts` — ลงทะเบียนโมดูล (Task 3)
- `.claude/rules/security.md` + `.claude/mcp/sql/policy.mjs` (Task 7)

Shared (`packages/shared/src`):
- `finance-precheck-message.ts` + `finance-precheck-message.spec.ts` + export ใน `index.ts` (Task 2)

Web (`apps/web/src`):
- `pages/UnifiedInboxPage/components/gfin/gfin.ts` — types, MIME, slot labels, helpers (Task 8)
- `pages/UnifiedInboxPage/hooks/useFinanceApplication.ts` + test (Task 8)
- `pages/UnifiedInboxPage/components/MessageBubble.tsx` · `ChatPanel.tsx` · `index.tsx` · `RoomDossier.tsx` (Task 9)
- `pages/UnifiedInboxPage/components/gfin/GfinTab.tsx` · `GfinSlotPicker.tsx` · `GfinStepCustomer.tsx` · `GfinStepProduct.tsx` · `GfinStepFiles.tsx` · `GfinStepMessage.tsx` · `GfinStatusCard.tsx` + tests (Task 9, 10)
- `components/customer/CustomerCreateDialog.tsx` — prop `initialAddressIdCard` (Task 10)
- `apps/web/e2e/gfin-precheck.spec.ts` + `apps/web/package.json` version (Task 11)

---

### Task 1: Prisma schema + migration + แถว GFIN + webhook ไฟแนนซ์เก็บ message id

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum ต่อจาก `enum DeviceReturnStatus` บรรทัด ~303 · model ต่อจาก `model ExternalFinanceCompany` บรรทัด ~8124 · back-relation ใน `ExternalFinanceCompany`, `ChatRoom`, `Customer`, `Product`, `Branch`, `User`, `ChatMessage`)
- Create: `apps/api/prisma/migrations/20261009000000_external_finance_application/migration.sql`
- Modify: `apps/api/src/modules/chatbot-finance/services/chat-room.service.ts:89-120` (`saveMessage` รับ `externalMessageId`)
- Modify: `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` (`handleImage` ~L345 และสาขา unverified/silenced/file ~L203, L228, L268)
- Test: `apps/api/src/modules/chatbot-finance/services/chat-room.service.external-id.spec.ts`

**Interfaces:**
- Produces: Prisma models `ExternalFinanceApplication`, `ExternalFinanceApplicationFile`, `ExternalFinanceApplicationEvent` + enums `ExternalFinanceApplicationStatus`, `ExternalFinanceDocSlot`, `ExternalFinanceFileSource`, `ExternalFinanceEventKind`, `ExternalFinanceActorType`, `ExternalFinanceSendVia`, `ExternalFinanceResultSource` (Task 3–7 ใช้) · `ChatMessage.externalMessageId` ถูกเขียนสำหรับ IMAGE/FILE ของ OA ไฟแนนซ์ (Task 4, 9 ใช้)

- [ ] **Step 1: เพิ่ม enum ใน `schema.prisma` (ต่อจาก `enum DeviceReturnStatus`)**

```prisma
// ยื่น GFIN — แพ็กเช็คเครดิตจากห้องแชท (spec 2026-09-24 §4)
enum ExternalFinanceApplicationStatus { DRAFT SENT ACKNOWLEDGED MORE_INFO APPROVED REJECTED CANCELLED }
enum ExternalFinanceDocSlot { ID_SELFIE ID_CARD INCOME FB_PROFILE FB_FRIENDS FB_ACTIVITY LINE_PROFILE DEVICE_SCREEN DEVICE_PHOTO GUARANTOR_ID ADDRESS_BILL PHONE_OPENING OTHER }
enum ExternalFinanceFileSource { CHAT_MESSAGE UPLOAD PRODUCT_PHOTO }
enum ExternalFinanceEventKind { CREATED SENT RESENT LINK_VIEWED LINK_EXTENDED LINK_REVOKED PARTNER_ACK PARTNER_MORE_INFO PARTNER_APPROVED PARTNER_REJECTED STAFF_RESULT CANCELLED FILES_PURGED }
enum ExternalFinanceActorType { STAFF PARTNER SYSTEM }
enum ExternalFinanceSendVia { BOT COPY }
enum ExternalFinanceResultSource { PARTNER_LINK STAFF }
```

- [ ] **Step 2: เพิ่ม model 3 ตัว (ต่อจาก `model ExternalFinanceCompany`)**

```prisma
model ExternalFinanceApplication {
  id                 String                           @id @default(uuid())
  number             String                           @unique // BC-YYMMDD-NNN
  financeCompanyId   String                           @map("finance_company_id")
  roomId             String                           @map("room_id")
  customerId         String?                          @map("customer_id")
  productId          String?                          @map("product_id")
  branchId           String?                          @map("branch_id")
  status             ExternalFinanceApplicationStatus @default(DRAFT)
  resultSource       ExternalFinanceResultSource?     @map("result_source")
  summary            Json?                                                     // snapshot 7 ช่อง + fileCount ณ ตอนส่ง
  messageText        String?                          @map("message_text") @db.Text      // ฉบับที่ส่งจริง (รวมบรรทัดลิงก์)
  messageOverride    String?                          @map("message_override") @db.Text  // พนักงานแก้ถ้อยคำเฉพาะใบนี้ (ไม่รวมบรรทัดลิงก์)
  occupationOverride String?                          @map("occupation_override")
  sentAt             DateTime?                        @map("sent_at")
  sentById           String?                          @map("sent_by_id")
  sentVia            ExternalFinanceSendVia?          @map("sent_via")
  lineRequestId      String?                          @map("line_request_id")
  shareTokenHash     String?                          @unique @map("share_token_hash")
  shareTokenEnc      String?                          @map("share_token_enc")      // โทเคนดิบเข้ารหัสด้วย encryptPII — ให้พนักงานเปิดลิงก์เดิมได้ (หน้าลิงก์ค้นด้วย hash เท่านั้น)
  shareExpiresAt     DateTime?                        @map("share_expires_at")
  shareRevokedAt     DateTime?                        @map("share_revoked_at")
  shareViewCount     Int                              @default(0) @map("share_view_count")
  shareLastViewedAt  DateTime?                        @map("share_last_viewed_at")
  lastPartnerEventAt DateTime?                        @map("last_partner_event_at")
  closedAt           DateTime?                        @map("closed_at")
  filesPurgedAt      DateTime?                        @map("files_purged_at")
  createdById        String                           @map("created_by_id")
  createdAt          DateTime                         @default(now()) @map("created_at")
  updatedAt          DateTime                         @updatedAt @map("updated_at")
  deletedAt          DateTime?                        @map("deleted_at")

  financeCompany ExternalFinanceCompany           @relation(fields: [financeCompanyId], references: [id])
  room           ChatRoom                         @relation(fields: [roomId], references: [id])
  customer       Customer?                        @relation("CustomerFinanceApplications", fields: [customerId], references: [id])
  product        Product?                         @relation("ProductFinanceApplications", fields: [productId], references: [id])
  branch         Branch?                          @relation("BranchFinanceApplications", fields: [branchId], references: [id])
  createdBy      User                             @relation("FinanceApplicationCreatedBy", fields: [createdById], references: [id])
  sentBy         User?                            @relation("FinanceApplicationSentBy", fields: [sentById], references: [id])
  files          ExternalFinanceApplicationFile[]
  events         ExternalFinanceApplicationEvent[]

  @@index([roomId, status, deletedAt])
  @@index([customerId, deletedAt])
  @@index([status, closedAt, filesPurgedAt])
  @@map("external_finance_applications")
}

model ExternalFinanceApplicationFile {
  id              String                     @id @default(uuid())
  applicationId   String                     @map("application_id")
  slot            ExternalFinanceDocSlot
  storageKey      String?                    @map("storage_key") // null หลังลบตาม D6
  mimeType        String                     @map("mime_type")
  size            Int
  originalName    String?                    @map("original_name")
  source          ExternalFinanceFileSource
  sourceMessageId String?                    @map("source_message_id")
  sourceAngle     String?                    @map("source_angle")
  sortOrder       Int                        @default(0) @map("sort_order")
  sentAt          DateTime?                  @map("sent_at")
  createdById     String                     @map("created_by_id")
  createdAt       DateTime                   @default(now()) @map("created_at")
  updatedAt       DateTime                   @updatedAt @map("updated_at")
  deletedAt       DateTime?                  @map("deleted_at")

  application   ExternalFinanceApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)
  sourceMessage ChatMessage?               @relation("FinanceApplicationSourceMessage", fields: [sourceMessageId], references: [id])

  @@index([applicationId, deletedAt])
  @@index([sourceMessageId])
  @@map("external_finance_application_files")
}

/// Append-only timeline — updatedAt/deletedAt intentionally omitted (เหมือน AfterSalesEvent)
model ExternalFinanceApplicationEvent {
  id            String                     @id @default(uuid())
  applicationId String                     @map("application_id")
  kind          ExternalFinanceEventKind
  actorType     ExternalFinanceActorType   @map("actor_type")
  actorUserId   String?                    @map("actor_user_id")
  actorName     String?                    @map("actor_name")
  note          String?                    @db.Text
  meta          Json?
  createdAt     DateTime                   @default(now()) @map("created_at")

  application ExternalFinanceApplication @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  @@index([applicationId, createdAt])
  @@map("external_finance_application_events")
}
```

- [ ] **Step 3: back-relation** — `model ExternalFinanceCompany` เพิ่ม `applications ExternalFinanceApplication[]` · `model ChatRoom` เพิ่ม `financeApplications ExternalFinanceApplication[]` · `model Customer` เพิ่ม `financeApplications ExternalFinanceApplication[] @relation("CustomerFinanceApplications")` · `model Product` เพิ่ม `financeApplications ExternalFinanceApplication[] @relation("ProductFinanceApplications")` · `model Branch` เพิ่ม `financeApplications ExternalFinanceApplication[] @relation("BranchFinanceApplications")` · `model User` เพิ่ม `financeApplicationsCreated ExternalFinanceApplication[] @relation("FinanceApplicationCreatedBy")` และ `financeApplicationsSent ExternalFinanceApplication[] @relation("FinanceApplicationSentBy")` · `model ChatMessage` เพิ่ม `financeApplicationFiles ExternalFinanceApplicationFile[] @relation("FinanceApplicationSourceMessage")`

- [ ] **Step 4: ตรวจ schema + generate**

Run: `cd apps/api && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` และ generate สำเร็จ

- [ ] **Step 5: เขียน migration SQL มือ**

```sql
-- ยื่น GFIN — แพ็กเช็คเครดิตจากห้องแชท (spec 2026-09-24 §4). Additive only.
CREATE TYPE "ExternalFinanceApplicationStatus" AS ENUM ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'MORE_INFO', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ExternalFinanceDocSlot" AS ENUM ('ID_SELFIE', 'ID_CARD', 'INCOME', 'FB_PROFILE', 'FB_FRIENDS', 'FB_ACTIVITY', 'LINE_PROFILE', 'DEVICE_SCREEN', 'DEVICE_PHOTO', 'GUARANTOR_ID', 'ADDRESS_BILL', 'PHONE_OPENING', 'OTHER');
CREATE TYPE "ExternalFinanceFileSource" AS ENUM ('CHAT_MESSAGE', 'UPLOAD', 'PRODUCT_PHOTO');
CREATE TYPE "ExternalFinanceEventKind" AS ENUM ('CREATED', 'SENT', 'RESENT', 'LINK_VIEWED', 'LINK_EXTENDED', 'LINK_REVOKED', 'PARTNER_ACK', 'PARTNER_MORE_INFO', 'PARTNER_APPROVED', 'PARTNER_REJECTED', 'STAFF_RESULT', 'CANCELLED', 'FILES_PURGED');
CREATE TYPE "ExternalFinanceActorType" AS ENUM ('STAFF', 'PARTNER', 'SYSTEM');
CREATE TYPE "ExternalFinanceSendVia" AS ENUM ('BOT', 'COPY');
CREATE TYPE "ExternalFinanceResultSource" AS ENUM ('PARTNER_LINK', 'STAFF');

CREATE TABLE "external_finance_applications" (
  "id" TEXT NOT NULL, "number" TEXT NOT NULL, "finance_company_id" TEXT NOT NULL, "room_id" TEXT NOT NULL,
  "customer_id" TEXT, "product_id" TEXT, "branch_id" TEXT,
  "status" "ExternalFinanceApplicationStatus" NOT NULL DEFAULT 'DRAFT', "result_source" "ExternalFinanceResultSource",
  "summary" JSONB, "message_text" TEXT, "message_override" TEXT, "occupation_override" TEXT,
  "sent_at" TIMESTAMP(3), "sent_by_id" TEXT, "sent_via" "ExternalFinanceSendVia", "line_request_id" TEXT,
  "share_token_hash" TEXT, "share_token_enc" TEXT, "share_expires_at" TIMESTAMP(3), "share_revoked_at" TIMESTAMP(3),
  "share_view_count" INTEGER NOT NULL DEFAULT 0, "share_last_viewed_at" TIMESTAMP(3), "last_partner_event_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3), "files_purged_at" TIMESTAMP(3), "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3),
  CONSTRAINT "external_finance_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_finance_applications_number_key" ON "external_finance_applications"("number");
CREATE UNIQUE INDEX "external_finance_applications_share_token_hash_key" ON "external_finance_applications"("share_token_hash");
CREATE INDEX "external_finance_applications_room_id_status_deleted_at_idx" ON "external_finance_applications"("room_id", "status", "deleted_at");
CREATE INDEX "external_finance_applications_customer_id_deleted_at_idx" ON "external_finance_applications"("customer_id", "deleted_at");
CREATE INDEX "external_finance_applications_status_closed_at_files_purged_at_idx" ON "external_finance_applications"("status", "closed_at", "files_purged_at");
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_finance_company_id_fkey" FOREIGN KEY ("finance_company_id") REFERENCES "external_finance_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_finance_applications" ADD CONSTRAINT "external_finance_applications_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "external_finance_application_files" (
  "id" TEXT NOT NULL, "application_id" TEXT NOT NULL, "slot" "ExternalFinanceDocSlot" NOT NULL,
  "storage_key" TEXT, "mime_type" TEXT NOT NULL, "size" INTEGER NOT NULL, "original_name" TEXT,
  "source" "ExternalFinanceFileSource" NOT NULL, "source_message_id" TEXT, "source_angle" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0, "sent_at" TIMESTAMP(3), "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3),
  CONSTRAINT "external_finance_application_files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "external_finance_application_files_application_id_deleted_at_idx" ON "external_finance_application_files"("application_id", "deleted_at");
CREATE INDEX "external_finance_application_files_source_message_id_idx" ON "external_finance_application_files"("source_message_id");
ALTER TABLE "external_finance_application_files" ADD CONSTRAINT "external_finance_application_files_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "external_finance_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_finance_application_files" ADD CONSTRAINT "external_finance_application_files_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "external_finance_application_events" (
  "id" TEXT NOT NULL, "application_id" TEXT NOT NULL, "kind" "ExternalFinanceEventKind" NOT NULL,
  "actor_type" "ExternalFinanceActorType" NOT NULL, "actor_user_id" TEXT, "actor_name" TEXT, "note" TEXT, "meta" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_finance_application_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "external_finance_application_events_application_id_created_at_idx" ON "external_finance_application_events"("application_id", "created_at");
ALTER TABLE "external_finance_application_events" ADD CONSTRAINT "external_finance_application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "external_finance_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- แถวบริษัท GFIN (ยังไม่มี seed ที่ไหน — ผูกด้วยชื่อ unique; ใบยื่นทุกใบชี้แถวนี้)
INSERT INTO "external_finance_companies" ("id", "name", "is_active", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'GFIN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
```

- [ ] **Step 6: ทดสอบ migration บนฐานทดสอบ**

Run: `cd apps/api && DATABASE_URL=<test_db> npx prisma migrate deploy && DATABASE_URL=<test_db> npx prisma migrate status`
Expected: migration ใหม่ applied · `migrate status` = `Database schema is up to date!` · `SELECT name FROM external_finance_companies WHERE name='GFIN'` ได้ 1 แถว

- [ ] **Step 7: เขียนเทสต์ล้มก่อน — `saveMessage` ส่ง `externalMessageId` ลง Prisma**

`apps/api/src/modules/chatbot-finance/services/chat-room.service.external-id.spec.ts`:
```ts
import { ChatRoomService } from './chat-room.service';
import { MessageRole, MessageType } from '@prisma/client';

describe('ChatRoomService.saveMessage — externalMessageId', () => {
  it('passes externalMessageId through to prisma.chatMessage.create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'm1' });
    const prisma = { chatMessage: { create }, chatRoom: { update: jest.fn().mockResolvedValue({}) } } as any;
    const service = new ChatRoomService(prisma);
    await service.saveMessage({ roomId: 'r1', role: MessageRole.CUSTOMER, type: MessageType.IMAGE, text: '[image]', externalMessageId: 'LINE-MSG-1' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalMessageId: 'LINE-MSG-1', type: MessageType.IMAGE }) }));
  });
});
```
(ถ้า constructor ของ `ChatRoomService` รับ dependency มากกว่า `prisma` ให้เปิดไฟล์ดูแล้วส่ง mock เพิ่มตามลำดับจริง — ห้ามเดา)

- [ ] **Step 8: รันให้ล้ม**

Run: `cd apps/api && npx jest src/modules/chatbot-finance/services/chat-room.service.external-id.spec.ts --runInBand`
Expected: FAIL — `externalMessageId` ไม่อยู่ใน `data` (TS error หรือ assertion fail)

- [ ] **Step 9: แก้ `ChatRoomService.saveMessage`** — เพิ่ม `externalMessageId?: string;` ใน params และ `externalMessageId: params.externalMessageId,` ใน `data` (แบบเดียวกับ `room-manager.service.ts:717,739`)

- [ ] **Step 10: แก้ webhook ไฟแนนซ์ให้เก็บ id ของรูป/ไฟล์ทุกสาขา** ใน `chatbot-finance.service.ts`:
  - `handleImage` (~L353): `await this.sessions.saveMessage({ roomId, role: MessageRole.CUSTOMER, type: 'IMAGE', text: '[image]', externalMessageId: event.message.id });`
  - สาขา unverified (~L203) และ silenced (~L228): ถ้า `event.message.type === 'image'` ให้ส่ง `type: 'IMAGE', text: '[image]', externalMessageId: event.message.id` · ถ้า `=== 'file'` ให้ส่ง `type: 'FILE', text: '[file]', externalMessageId: event.message.id` · อย่างอื่นคงเดิม
  - สาขา non-text อื่น (~L268): กรณี `file` ให้ `type: 'FILE', text: '[file]', externalMessageId: event.message.id` · audio/video คงเดิม
  - เขียน helper ไฟล์เดียวกัน:
```ts
/** รูป/ไฟล์จาก LINE เก็บ message id ไว้ให้ดึงไฟล์ทีหลัง (ยื่น GFIN) — ข้อความอื่นไม่เปลี่ยน */
private inboundMediaFields(message: LineMessageContent): { type?: MessageType; text: string; externalMessageId?: string } {
  if (message.type === 'image') return { type: 'IMAGE', text: '[image]', externalMessageId: message.id };
  if (message.type === 'file') return { type: 'FILE', text: '[file]', externalMessageId: message.id };
  return { text: this.inboundMessageToText(message) };
}
```
  แล้วใช้ `...this.inboundMediaFields(event.message)` ในสามสาขานั้น

- [ ] **Step 11: รันเทสต์ให้ผ่าน + เทสต์เดิมของโมดูล**

Run: `cd apps/api && npx jest src/modules/chatbot-finance --runInBand`
Expected: PASS ทั้งหมด (spec ใหม่ + ของเดิม)

- [ ] **Step 12: type-check + commit**

Run: `./tools/check-types.sh api`
Expected: 0 errors
```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261009000000_external_finance_application apps/api/src/modules/chatbot-finance
git commit -m "feat(gfin): ตารางใบยื่นไฟแนนซ์นอก + แถว GFIN + webhook ไฟแนนซ์เก็บ message id ของรูป/ไฟล์"
```

---

### Task 2: builder ข้อความ 12 ข้อ (packages/shared)

**Files:**
- Create: `packages/shared/src/finance-precheck-message.ts`
- Create: `packages/shared/src/finance-precheck-message.spec.ts`
- Modify: `packages/shared/src/index.ts` (เพิ่ม `export * from './finance-precheck-message';`)

**Interfaces:**
- Produces: `DEFAULT_PRECHECK_TEMPLATE: string` · `PrecheckValues` · `buildPrecheckMessage(template: string, values: PrecheckValues): string` · `precheckMissingFields(values: PrecheckValues): PrecheckField[]` · `computeAgeYears(birthDate: string | Date | null, at?: Date): number | null` · `formatThaiMobile(raw: string | null): string` · `renderHand(category: string | null): '1' | '2'` (Task 5 ใช้ฝั่ง API · Task 10 ใช้ preview ฝั่งเว็บ)

- [ ] **Step 1: เขียนเทสต์ล้มก่อน**

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRECHECK_TEMPLATE, buildPrecheckMessage, precheckMissingFields,
  computeAgeYears, formatThaiMobile, renderHand,
} from './finance-precheck-message';

const values = {
  customerName: 'สมหญิง ใจดี', occupation: 'พนักงานบริษัท', model: 'iPhone 13 Pro Max 256GB',
  hand: '2' as const, imei: '355908667841899', phone: '0937581095', age: 28,
  staffName: 'ป๊อปคอร์น', fileCount: 19, link: 'https://bestchoicephone.app/api/g/abc',
};

describe('buildPrecheckMessage', () => {
  it('renders the shop template byte-for-byte with dashes on items 8-12', () => {
    expect(buildPrecheckMessage(DEFAULT_PRECHECK_TEMPLATE, values)).toBe(
`รายละเอียดที่ต้องแจ้งเช็คค่ะ
1.ชื่อลูกค้า : สมหญิง ใจดี
2.ทำอาชีพ : พนักงานบริษัท
3.สนใจโทรศัพท์รุ่น : iPhone 13 Pro Max 256GB
4.มือ1/2 : 2
5.เลขอีมี่ : 355908667841899
6.เบอร์ลูกค้า : 093 758 1095
7.อายุ : 28 ปี
8.แบตเปลี่ยนมาหรือไม่? : -
9.แบตแท้หรือไม่แท้? : -
10.ลูกค้าทราบเรื่องแบตแล้วใช่ไหม? : -
11.มีกล่องหรือไม่? : -
12.มีสายชาร์จหรือไม่? : -
ส่งโดย ป๊อปคอร์น · BESTCHOICE
เอกสารทั้งหมด 19 ไฟล์: https://bestchoicephone.app/api/g/abc`);
  });
  it('leaves unknown placeholders untouched and never throws on nulls', () => {
    const text = buildPrecheckMessage('x {{nope}} {{customerName}}', { ...values, customerName: null });
    expect(text).toBe('x {{nope}} ');
  });
});
describe('precheckMissingFields', () => {
  it('lists the missing auto-filled fields in template order', () => {
    expect(precheckMissingFields({ ...values, occupation: null, age: null, phone: '' })).toEqual(['occupation', 'phone', 'age']);
    expect(precheckMissingFields(values)).toEqual([]);
  });
});
describe('helpers', () => {
  it('computeAgeYears handles birthday not yet reached this year', () => {
    expect(computeAgeYears('1997-12-27', new Date('2026-09-24T00:00:00Z'))).toBe(28);
    expect(computeAgeYears('1997-09-24', new Date('2026-09-24T00:00:00Z'))).toBe(29);
    expect(computeAgeYears(null)).toBeNull();
    expect(computeAgeYears('not-a-date')).toBeNull();
  });
  it('formatThaiMobile groups 3-3-4 and passes odd values through', () => {
    expect(formatThaiMobile('0937581095')).toBe('093 758 1095');
    expect(formatThaiMobile('+66937581095')).toBe('093 758 1095');
    expect(formatThaiMobile('12345')).toBe('12345');
    expect(formatThaiMobile(null)).toBe('');
  });
  it('renderHand maps PHONE_USED to 2, everything else to 1', () => {
    expect(renderHand('PHONE_USED')).toBe('2');
    expect(renderHand('PHONE_NEW')).toBe('1');
    expect(renderHand('TABLET')).toBe('1');
    expect(renderHand(null)).toBe('1');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd packages/shared && npx vitest run src/finance-precheck-message.spec.ts`
Expected: FAIL — module not found (ถ้า `packages/shared` ใช้ jest แทน vitest ให้ดู `packages/shared/package.json` แล้วใช้ runner เดียวกับ `installment-calc` spec ที่มีอยู่ — เปลี่ยน import เป็น `@jest/globals` ถ้าจำเป็น)

- [ ] **Step 3: เขียน implementation**

`packages/shared/src/finance-precheck-message.ts`:
```ts
/**
 * ข้อความ 12 ข้อที่ร้านส่งเข้ากลุ่มไลน์ GFIN ก่อนกรอกฟอร์มเว็บ (spec 2026-09-24 §7)
 * ถ้อยคำเดิมของทีม — ข้อ 8–12 เป็น "-" เสมอ (คำตัดสินเจ้าของ D4)
 */
export const DEFAULT_PRECHECK_TEMPLATE = `รายละเอียดที่ต้องแจ้งเช็คค่ะ
1.ชื่อลูกค้า : {{customerName}}
2.ทำอาชีพ : {{occupation}}
3.สนใจโทรศัพท์รุ่น : {{model}}
4.มือ1/2 : {{hand}}
5.เลขอีมี่ : {{imei}}
6.เบอร์ลูกค้า : {{phone}}
7.อายุ : {{age}} ปี
8.แบตเปลี่ยนมาหรือไม่? : -
9.แบตแท้หรือไม่แท้? : -
10.ลูกค้าทราบเรื่องแบตแล้วใช่ไหม? : -
11.มีกล่องหรือไม่? : -
12.มีสายชาร์จหรือไม่? : -
ส่งโดย {{staffName}} · BESTCHOICE
เอกสารทั้งหมด {{fileCount}} ไฟล์: {{link}}`;

export type PrecheckField = 'customerName' | 'occupation' | 'model' | 'hand' | 'imei' | 'phone' | 'age';
/** ลำดับตามข้อ 1–7 ของแม่แบบ — ใช้ทั้งรายงานช่องที่ขาดและเรียงข้อความเตือน */
export const PRECHECK_FIELDS: PrecheckField[] = ['customerName', 'occupation', 'model', 'hand', 'imei', 'phone', 'age'];
export const PRECHECK_FIELD_LABELS: Record<PrecheckField, string> = {
  customerName: 'ชื่อลูกค้า', occupation: 'อาชีพ', model: 'รุ่น', hand: 'มือ 1/2', imei: 'IMEI', phone: 'เบอร์ลูกค้า', age: 'อายุ (จากวันเกิด)',
};

export interface PrecheckValues {
  customerName: string | null;
  occupation: string | null;
  model: string | null;
  hand: '1' | '2' | null;
  imei: string | null;
  phone: string | null;       // ดิบ — จะถูกจัดรูป 0XX XXX XXXX ตอน render
  age: number | null;
  staffName: string | null;
  fileCount: number;
  link: string | null;
}

export function precheckMissingFields(values: PrecheckValues): PrecheckField[] {
  return PRECHECK_FIELDS.filter((field) => {
    const value = values[field];
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  });
}

/** แทนที่ {{key}} ด้วยค่า — คีย์ที่ไม่รู้จักคงไว้ (ให้ผู้ตั้งค่าเห็นว่าพิมพ์ผิด) · ค่า null → ว่าง */
export function buildPrecheckMessage(template: string, values: PrecheckValues): string {
  const rendered: Record<string, string> = {
    customerName: values.customerName ?? '',
    occupation: values.occupation ?? '',
    model: values.model ?? '',
    hand: values.hand ?? '',
    imei: values.imei ?? '',
    phone: formatThaiMobile(values.phone),
    age: values.age === null || values.age === undefined ? '' : String(values.age),
    staffName: values.staffName ?? '',
    fileCount: String(values.fileCount),
    link: values.link ?? '',
  };
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (key in rendered ? rendered[key] : whole));
}

/** อายุเต็มปี ณ วันที่ `at` (ค่าเริ่มต้น = วันนี้) — วันเกิดอ่านไม่ได้ → null */
export function computeAgeYears(birthDate: string | Date | null | undefined, at: Date = new Date()): number | null {
  if (!birthDate) return null;
  const born = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;
  let age = at.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < born.getUTCMonth() ||
    (at.getUTCMonth() === born.getUTCMonth() && at.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}

/** 0937581095 / +66937581095 → "093 758 1095" · รูปแบบอื่นคืนค่าเดิม (ตัดช่องว่าง) */
export function formatThaiMobile(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('66') && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (!/^0\d{9}$/.test(digits)) return raw.trim();
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

/** มือ 1/2 จากหมวดสินค้า — PHONE_USED = 2 นอกนั้น 1 (spec §7) */
export function renderHand(category: string | null | undefined): '1' | '2' {
  return category === 'PHONE_USED' ? '2' : '1';
}
```

- [ ] **Step 4: export + รันเทสต์ให้ผ่าน**

เพิ่มใน `packages/shared/src/index.ts`: `export * from './finance-precheck-message';`

Run: `cd packages/shared && npx vitest run src/finance-precheck-message.spec.ts && npm run build`
Expected: PASS 6 เทสต์ · build สำเร็จ (`dist/` มีไฟล์ใหม่ — api/web import ผ่าน `@installment/shared`)

- [ ] **Step 5: commit**

```bash
git add packages/shared/src/finance-precheck-message.ts packages/shared/src/finance-precheck-message.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): builder ข้อความ 12 ข้อชุดเช็ค GFIN + helper อายุ/เบอร์/มือ"
```

---

### Task 3: โมดูล API — ค่าคงที่, state machine, เลขใบยื่น, สร้าง/อ่าน/แก้ใบยื่น + สิทธิ์ห้อง

**Files:**
- Create: `apps/api/src/modules/external-finance-application/constants.ts`
- Create: `apps/api/src/modules/external-finance-application/finance-application-status.util.ts`
- Create: `apps/api/src/modules/external-finance-application/services/finance-application-number.service.ts`
- Create: `apps/api/src/modules/external-finance-application/services/finance-application.service.ts`
- Create: `apps/api/src/modules/external-finance-application/dto/finance-application.dto.ts`
- Create: `apps/api/src/modules/external-finance-application/room-finance-applications.controller.ts`
- Create: `apps/api/src/modules/external-finance-application/finance-applications.controller.ts`
- Create: `apps/api/src/modules/external-finance-application/external-finance-application.module.ts`
- Modify: `apps/api/src/app.module.ts` (import + imports array ต่อจาก `ExternalFinanceModule` บรรทัด ~399)
- Test: `apps/api/src/modules/external-finance-application/__tests__/finance-application-status.util.spec.ts`
- Test: `apps/api/src/modules/external-finance-application/__tests__/finance-application.service.spec.ts` (mock prisma)
- Test: `apps/api/src/modules/external-finance-application/__tests__/finance-application-flow.db.spec.ts` (DB จริง — เริ่มที่ task นี้ ต่อเติมใน Task 4–6)

**Interfaces:**
- Consumes: Prisma models/enums จาก Task 1
- Produces:
  - `FINANCE_APP_ROLES = ['OWNER','BRANCH_MANAGER','FINANCE_MANAGER','SALES'] as const` · `GFIN_COMPANY_NAME = 'GFIN'` · `SHARE_TTL_DAYS = 7` · `MAX_FILES = 40` · `REQUIRED_SLOTS = ['ID_SELFIE','ID_CARD','INCOME']` · `SLOT_LABELS: Record<ExternalFinanceDocSlot, string>`
  - `type FinanceActor = { id: string; role: string; branchId?: string | null; name?: string | null }`
  - `applyTransition(status, event): ExternalFinanceApplicationStatus` (throws `ConflictException` เมื่อผิดลำดับ) · `isClosed(status): boolean`
  - `FinanceApplicationNumberService.next(tx): Promise<string>`
  - `FinanceApplicationService.createDraft(roomId, actor)` · `.listForRoom(roomId, actor)` · `.get(id, actor)` · `.update(id, dto, actor)` · `.access(db, roomId, actor)` (ใช้ซ้ำใน Task 4–6) · `.addEvent(tx, applicationId, kind, actorType, fields?)`

- [ ] **Step 1: ค่าคงที่**

`constants.ts`:
```ts
import { ExternalFinanceDocSlot } from '@prisma/client';

export const FINANCE_APP_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'] as const;
export const GFIN_COMPANY_NAME = 'GFIN';
export const SHARE_TTL_DAYS = 7;
export const MAX_FILES = 40;
export const MAX_BYTES = 10 * 1024 * 1024;
export const STORAGE_PREFIX = 'external-finance';
/** ช่องที่ต้องมีไฟล์ก่อนส่ง (spec §8) */
export const REQUIRED_SLOTS: ExternalFinanceDocSlot[] = ['ID_SELFIE', 'ID_CARD', 'INCOME'];
/** ลำดับและป้ายช่อง — ใช้ทั้งหน้าลิงก์ (ชื่อโฟลเดอร์ใน zip) และฝั่งเว็บ */
export const SLOT_LABELS: Record<ExternalFinanceDocSlot, string> = {
  ID_SELFIE: 'ลูกค้าถือบัตร',
  ID_CARD: 'บัตรประชาชน',
  INCOME: 'สลิปเงินเดือน / สเตทเม้น',
  FB_PROFILE: 'หน้าเฟซบุ๊ก',
  FB_FRIENDS: 'เพื่อนเฟซบุ๊ก',
  FB_ACTIVITY: 'ความเคลื่อนไหวเฟซบุ๊ก',
  LINE_PROFILE: 'หน้าไลน์ลูกค้า',
  DEVICE_SCREEN: 'หน้าจอตั้งค่าเครื่อง',
  DEVICE_PHOTO: 'รูปเครื่อง 6 มุม',
  GUARANTOR_ID: 'บัตรคนค้ำ (ถ้ามี)',
  ADDRESS_BILL: 'บิลที่อยู่ (ถ้ามี)',
  PHONE_OPENING: 'ระยะเวลาเปิดเบอร์ (ถ้ามี)',
  OTHER: 'อื่น ๆ',
};
export const SLOT_ORDER = Object.keys(SLOT_LABELS) as ExternalFinanceDocSlot[];

export type FinanceActor = { id: string; role: string; branchId?: string | null; name?: string | null };
```

- [ ] **Step 2: เทสต์ state machine ล้มก่อน**

`__tests__/finance-application-status.util.spec.ts`:
```ts
import { ConflictException } from '@nestjs/common';
import { applyTransition, isClosed } from '../finance-application-status.util';

describe('applyTransition', () => {
  it('walks the happy path DRAFT → SENT → ACKNOWLEDGED → MORE_INFO → SENT → APPROVED', () => {
    expect(applyTransition('DRAFT', 'SEND')).toBe('SENT');
    expect(applyTransition('SENT', 'PARTNER_ACK')).toBe('ACKNOWLEDGED');
    expect(applyTransition('ACKNOWLEDGED', 'PARTNER_MORE_INFO')).toBe('MORE_INFO');
    expect(applyTransition('MORE_INFO', 'RESEND')).toBe('SENT');
    expect(applyTransition('SENT', 'PARTNER_APPROVED')).toBe('APPROVED');
  });
  it('lets staff set a result from any open post-send status and cancel from any open status', () => {
    expect(applyTransition('ACKNOWLEDGED', 'STAFF_REJECTED')).toBe('REJECTED');
    expect(applyTransition('MORE_INFO', 'STAFF_APPROVED')).toBe('APPROVED');
    expect(applyTransition('DRAFT', 'CANCEL')).toBe('CANCELLED');
    expect(applyTransition('SENT', 'CANCEL')).toBe('CANCELLED');
  });
  it('rejects impossible moves with 409', () => {
    expect(() => applyTransition('DRAFT', 'PARTNER_ACK')).toThrow(ConflictException);
    expect(() => applyTransition('APPROVED', 'PARTNER_MORE_INFO')).toThrow(ConflictException);
    expect(() => applyTransition('CANCELLED', 'SEND')).toThrow(ConflictException);
    expect(() => applyTransition('DRAFT', 'RESEND')).toThrow(ConflictException);
  });
  it('staff may correct a result after close (APPROVED ↔ REJECTED) but partner may not', () => {
    expect(applyTransition('APPROVED', 'STAFF_REJECTED')).toBe('REJECTED');
    expect(() => applyTransition('REJECTED', 'PARTNER_APPROVED')).toThrow(ConflictException);
  });
  it('isClosed', () => {
    expect(isClosed('APPROVED')).toBe(true);
    expect(isClosed('REJECTED')).toBe(true);
    expect(isClosed('CANCELLED')).toBe(true);
    expect(isClosed('SENT')).toBe(false);
  });
});
```

- [ ] **Step 3: รันให้ล้ม**

Run: `cd apps/api && npx jest src/modules/external-finance-application/__tests__/finance-application-status.util.spec.ts --runInBand`
Expected: FAIL — Cannot find module

- [ ] **Step 4: เขียน state machine**

`finance-application-status.util.ts`:
```ts
import { ConflictException } from '@nestjs/common';
import { ExternalFinanceApplicationStatus as S } from '@prisma/client';

export type FinanceTransitionEvent =
  | 'SEND' | 'RESEND' | 'PARTNER_ACK' | 'PARTNER_MORE_INFO' | 'PARTNER_APPROVED' | 'PARTNER_REJECTED'
  | 'STAFF_MORE_INFO' | 'STAFF_APPROVED' | 'STAFF_REJECTED' | 'CANCEL';

const OPEN_AFTER_SEND: S[] = ['SENT', 'ACKNOWLEDGED', 'MORE_INFO'];
const CLOSED: S[] = ['APPROVED', 'REJECTED', 'CANCELLED'];

/** ตาราง spec §9 — คู่ (สถานะปัจจุบัน, เหตุการณ์) ที่อนุญาต */
const TABLE: Record<FinanceTransitionEvent, { from: S[]; to: S }> = {
  SEND: { from: ['DRAFT'], to: 'SENT' },
  RESEND: { from: ['MORE_INFO', 'SENT', 'ACKNOWLEDGED'], to: 'SENT' },
  PARTNER_ACK: { from: ['SENT'], to: 'ACKNOWLEDGED' },
  PARTNER_MORE_INFO: { from: OPEN_AFTER_SEND, to: 'MORE_INFO' },
  PARTNER_APPROVED: { from: OPEN_AFTER_SEND, to: 'APPROVED' },
  PARTNER_REJECTED: { from: OPEN_AFTER_SEND, to: 'REJECTED' },
  STAFF_MORE_INFO: { from: OPEN_AFTER_SEND, to: 'MORE_INFO' },
  STAFF_APPROVED: { from: [...OPEN_AFTER_SEND, 'REJECTED'], to: 'APPROVED' },
  STAFF_REJECTED: { from: [...OPEN_AFTER_SEND, 'APPROVED'], to: 'REJECTED' },
  CANCEL: { from: ['DRAFT', ...OPEN_AFTER_SEND], to: 'CANCELLED' },
};

const THAI: Record<S, string> = {
  DRAFT: 'ร่าง', SENT: 'ส่งแล้ว', ACKNOWLEDGED: 'GFIN รับเรื่องแล้ว', MORE_INFO: 'GFIN ขอเอกสารเพิ่ม',
  APPROVED: 'ผ่าน', REJECTED: 'ไม่ผ่าน', CANCELLED: 'ยกเลิก',
};

export function isClosed(status: S): boolean {
  return CLOSED.includes(status);
}

export function applyTransition(status: S, event: FinanceTransitionEvent): S {
  const rule = TABLE[event];
  if (!rule.from.includes(status)) {
    throw new ConflictException(`ใบยื่นอยู่ในสถานะ "${THAI[status]}" ทำรายการนี้ไม่ได้`);
  }
  return rule.to;
}

export const FINANCE_STATUS_LABEL = THAI;
```

- [ ] **Step 5: รันเทสต์ state machine ให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/external-finance-application/__tests__/finance-application-status.util.spec.ts --runInBand`
Expected: PASS 5

- [ ] **Step 6: เลขใบยื่น (advisory lock ต่อวัน BKK — แบบ `after-sales-doc-number.service.ts`)**

`services/finance-application-number.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hashLockKey } from '../../../utils/advisory-lock.util';

/** BC-YYMMDD-NNN — วันตาม Asia/Bangkok, ลำดับต่อวัน, ใบที่ยกเลิก/ลบยังถือเลข (ห้ามกรอง deletedAt) */
@Injectable()
export class FinanceApplicationNumberService {
  static yymmddBangkok(at = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok', year: '2-digit', month: '2-digit', day: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}${get('month')}${get('day')}`;
  }

  async next(tx: Prisma.TransactionClient, at = new Date()): Promise<string> {
    const day = FinanceApplicationNumberService.yymmddBangkok(at);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${hashLockKey(`finance-app:${day}`)})`);
    const last = await tx.externalFinanceApplication.findFirst({
      where: { number: { startsWith: `BC-${day}-` } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const seq = last ? Number(last.number.split('-')[2]) + 1 : 1;
    return `BC-${day}-${String(seq).padStart(3, '0')}`;
  }
}
```

- [ ] **Step 7: DTO**

`dto/finance-application.dto.ts`:
```ts
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateFinanceApplicationDto {
  @IsOptional() @IsUUID('4', { message: 'รหัสลูกค้าไม่ถูกต้อง' }) customerId?: string;
  @IsOptional() @IsUUID('4', { message: 'รหัสสินค้าไม่ถูกต้อง' }) productId?: string;
  @IsOptional() @IsString() @MaxLength(80, { message: 'อาชีพยาวเกิน 80 ตัวอักษร' }) occupationOverride?: string;
  /** แก้ถ้อยคำเฉพาะใบนี้ (บรรทัดลิงก์ระบบต่อท้ายเองเสมอ) */
  @IsOptional() @IsString() @MaxLength(2000, { message: 'ข้อความยาวเกิน 2000 ตัวอักษร' }) messageOverride?: string;
}

export class StaffResultDto {
  @IsIn(['APPROVED', 'REJECTED', 'MORE_INFO'], { message: 'ผลต้องเป็น ผ่าน / ไม่ผ่าน / ขอเพิ่ม' })
  result: 'APPROVED' | 'REJECTED' | 'MORE_INFO';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SendFinanceApplicationDto {
  @IsIn(['COPY', 'BOT'], { message: 'วิธีส่งไม่ถูกต้อง' }) via: 'COPY' | 'BOT';
}
```
(`messageOverride` = คอลัมน์ `message_override` จาก Task 1 — Task 5 ใช้: ถ้ามีค่า ให้ใช้แทนข้อความที่ระบบร่าง แล้วต่อบรรทัดลิงก์ให้เสมอ)

- [ ] **Step 8: เทสต์ service ล้มก่อน (mock prisma)**

`__tests__/finance-application.service.spec.ts`:
```ts
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { FinanceApplicationService } from '../services/finance-application.service';

const room = { id: 'room-1', assignedToId: 'sales-2', customerId: null, deletedAt: null, channel: 'FACEBOOK' };
function makePrisma(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    chatRoom: { findFirst: jest.fn().mockResolvedValue(room) },
    externalFinanceCompany: { upsert: jest.fn().mockResolvedValue({ id: 'gfin-1' }) },
    externalFinanceApplication: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'app-1', ...data, files: [], events: [] })),
      update: jest.fn(),
    },
    externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $executeRawUnsafe: jest.fn(),
    ...overrides,
  };
  return prisma;
}
const numbers = { next: jest.fn().mockResolvedValue('BC-260924-001') } as any;
const owner = { id: 'u-owner', role: 'OWNER' };
const sales = { id: 'sales-1', role: 'SALES' };

describe('FinanceApplicationService.createDraft', () => {
  it('creates a DRAFT with number, GFIN company and CREATED event', async () => {
    const prisma = makePrisma();
    const service = new FinanceApplicationService(prisma, numbers);
    const app = await service.createDraft('room-1', owner);
    expect(app.status).toBe('DRAFT');
    expect(prisma.externalFinanceApplication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ number: 'BC-260924-001', financeCompanyId: 'gfin-1', roomId: 'room-1', createdById: 'u-owner', status: 'DRAFT' }),
    }));
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'CREATED', actorType: 'STAFF' }) }));
  });
  it('returns the existing open application instead of creating a second one', async () => {
    const existing = { id: 'app-0', status: 'SENT', roomId: 'room-1', files: [], events: [] };
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() } });
    const service = new FinanceApplicationService(prisma, numbers);
    await expect(service.createDraft('room-1', owner)).resolves.toMatchObject({ id: 'app-0' });
    expect(prisma.externalFinanceApplication.create).not.toHaveBeenCalled();
  });
  it('rejects SALES on a room assigned to someone else', async () => {
    const service = new FinanceApplicationService(makePrisma(), numbers);
    await expect(service.createDraft('room-1', sales)).rejects.toThrow(ForbiddenException);
  });
});

describe('FinanceApplicationService.update', () => {
  it('blocks edits after send', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue({ id: 'app-1', status: 'SENT', roomId: 'room-1', room }), update: jest.fn() } });
    const service = new FinanceApplicationService(prisma, numbers);
    await expect(service.update('app-1', { productId: '2b5e3d1e-0000-4000-8000-000000000001' }, owner)).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 9: รันให้ล้ม**

Run: `cd apps/api && npx jest src/modules/external-finance-application/__tests__/finance-application.service.spec.ts --runInBand`
Expected: FAIL — Cannot find module

- [ ] **Step 10: เขียน service หลัก (ส่วนสร้าง/อ่าน/แก้ — ส่ง/ผล/ลิงก์มาใน Task 5)**

`services/finance-application.service.ts`:
```ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExternalFinanceActorType, ExternalFinanceEventKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FinanceApplicationNumberService } from './finance-application-number.service';
import { FinanceActor, GFIN_COMPANY_NAME } from '../constants';
import { isClosed } from '../finance-application-status.util';
import { UpdateFinanceApplicationDto } from '../dto/finance-application.dto';

const OPEN_STATUSES = ['DRAFT', 'SENT', 'ACKNOWLEDGED', 'MORE_INFO'] as const;
const EDITABLE_STATUSES = ['DRAFT', 'MORE_INFO'] as const;

export const applicationInclude = {
  files: { where: { deletedAt: null }, orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
  events: { orderBy: { createdAt: 'asc' } },
  customer: { select: { id: true, name: true, phone: true, occupation: true, birthDate: true } },
  product: { select: { id: true, name: true, brand: true, model: true, storage: true, imeiSerial: true, serialNumber: true, category: true, batteryHealth: true, hasBox: true, accessoriesIncluded: true, status: true } },
  sentBy: { select: { id: true, name: true } },
} satisfies Prisma.ExternalFinanceApplicationInclude;

@Injectable()
export class FinanceApplicationService {
  constructor(
    private prisma: PrismaService,
    private numbers: FinanceApplicationNumberService,
  ) {}

  /** กติกาเดียวกับตรวจเครดิต (room-credit.service.ts:92-98): SALES เข้าได้เฉพาะห้องว่างหรือห้องตัวเอง */
  async access(db: Prisma.TransactionClient | PrismaService, roomId: string, actor: FinanceActor) {
    const room = await db.chatRoom.findFirst({ where: { id: roomId, deletedAt: null } });
    if (!room) throw new NotFoundException('ไม่พบห้องแชท');
    if (actor.role === 'SALES' && room.assignedToId && room.assignedToId !== actor.id)
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้');
    return room;
  }

  async addEvent(
    db: Prisma.TransactionClient | PrismaService,
    applicationId: string,
    kind: ExternalFinanceEventKind,
    actorType: ExternalFinanceActorType,
    fields: { actorUserId?: string | null; actorName?: string | null; note?: string | null; meta?: Prisma.InputJsonValue } = {},
  ) {
    return db.externalFinanceApplicationEvent.create({ data: { applicationId, kind, actorType, ...fields } });
  }

  private async gfinCompanyId(db: Prisma.TransactionClient | PrismaService) {
    // แถวถูก seed ด้วย migration แล้ว — upsert เผื่อฐานที่ยังไม่รัน migration (แบบ sale-writer.service.ts:85-94)
    const company = await db.externalFinanceCompany.upsert({
      where: { name: GFIN_COMPANY_NAME }, create: { name: GFIN_COMPANY_NAME, isActive: true }, update: {},
    });
    return company.id;
  }

  async createDraft(roomId: string, actor: FinanceActor) {
    const room = await this.access(this.prisma, roomId, actor);
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.externalFinanceApplication.findFirst({
        where: { roomId, deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        include: applicationInclude,
      });
      if (open) return open;
      const number = await this.numbers.next(tx);
      const app = await tx.externalFinanceApplication.create({
        data: {
          number, roomId, status: 'DRAFT', createdById: actor.id, branchId: actor.branchId ?? null,
          customerId: room.customerId ?? null, financeCompanyId: await this.gfinCompanyId(tx),
        },
        include: applicationInclude,
      });
      await this.addEvent(tx, app.id, 'CREATED', 'STAFF', { actorUserId: actor.id });
      return app;
    });
  }

  /** ใบเปิดของห้อง + ประวัติ: ห้องผูกลูกค้า → ทุกใบของลูกค้า (ทุกห้อง) ไม่งั้นเฉพาะห้องนี้ (spec §5.1) */
  async listForRoom(roomId: string, actor: FinanceActor) {
    const room = await this.access(this.prisma, roomId, actor);
    const where: Prisma.ExternalFinanceApplicationWhereInput = room.customerId
      ? { deletedAt: null, OR: [{ roomId }, { customerId: room.customerId }] }
      : { deletedAt: null, roomId };
    const rows = await this.prisma.externalFinanceApplication.findMany({
      where, include: applicationInclude, orderBy: { createdAt: 'desc' },
    });
    const current = rows.find((r) => r.roomId === roomId && !isClosed(r.status)) ?? null;
    return { current, history: rows.filter((r) => r.id !== current?.id) };
  }

  async get(id: string, actor: FinanceActor) {
    const app = await this.prisma.externalFinanceApplication.findFirst({
      where: { id, deletedAt: null }, include: { ...applicationInclude, room: true },
    });
    if (!app) throw new NotFoundException('ไม่พบใบยื่น');
    await this.access(this.prisma, app.roomId, actor);
    return app;
  }

  async update(id: string, dto: UpdateFinanceApplicationDto, actor: FinanceActor) {
    const app = await this.get(id, actor);
    if (!EDITABLE_STATUSES.includes(app.status as (typeof EDITABLE_STATUSES)[number]))
      throw new ConflictException('แก้ได้เฉพาะใบยื่นที่ยังเป็นร่างหรือ GFIN ขอเอกสารเพิ่ม');
    if (dto.productId) {
      const product = await this.prisma.product.findFirst({ where: { id: dto.productId, deletedAt: null }, select: { id: true, status: true } });
      if (!product) throw new NotFoundException('ไม่พบสินค้า');
      if (!['IN_STOCK', 'RESERVED'].includes(product.status))
        throw new BadRequestException('เลือกได้เฉพาะเครื่องที่พร้อมขายหรือจองอยู่');
    }
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, deletedAt: null }, select: { id: true } });
      if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    }
    return this.prisma.externalFinanceApplication.update({
      where: { id },
      data: {
        ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
        ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
        ...(dto.occupationOverride !== undefined ? { occupationOverride: dto.occupationOverride || null } : {}),
        ...(dto.messageOverride !== undefined ? { messageOverride: dto.messageOverride || null } : {}),
      },
      include: applicationInclude,
    });
  }
}
```
ถ้า `update` ต้องกัน SALES ที่ห้องถูกมอบหมายภายหลัง ให้ `get()` ครอบอยู่แล้ว (เรียก `access` ทุกครั้ง)

- [ ] **Step 11: controllers + module + ลงทะเบียน**

`room-finance-applications.controller.ts`:
```ts
import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceApplicationService } from './services/finance-application.service';
import { FinanceActor } from './constants';

@Controller('staff-chat/rooms/:roomId/finance-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
export class RoomFinanceApplicationsController {
  constructor(private applications: FinanceApplicationService) {}

  @Get()
  list(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req: { user: FinanceActor }) {
    return this.applications.listForRoom(roomId, req.user);
  }

  @Post()
  create(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req: { user: FinanceActor }) {
    return this.applications.createDraft(roomId, req.user);
  }
}
```
`finance-applications.controller.ts` (เริ่มด้วย 2 route — Task 4–5 เพิ่ม):
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceApplicationService } from './services/finance-application.service';
import { UpdateFinanceApplicationDto } from './dto/finance-application.dto';
import { FinanceActor } from './constants';

@Controller('finance-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
export class FinanceApplicationsController {
  constructor(private applications: FinanceApplicationService) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.applications.get(id, req.user);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFinanceApplicationDto, @Req() req: { user: FinanceActor }) {
    return this.applications.update(id, dto, req.user);
  }
}
```
`external-finance-application.module.ts`:
```ts
import { Module, forwardRef } from '@nestjs/common';
import { RoomFinanceApplicationsController } from './room-finance-applications.controller';
import { FinanceApplicationsController } from './finance-applications.controller';
import { FinanceApplicationService } from './services/finance-application.service';
import { FinanceApplicationNumberService } from './services/finance-application-number.service';
import { LineOaModule } from '../line-oa/line-oa.module';
import { ChatbotFinanceModule } from '../chatbot-finance/chatbot-finance.module';
import { OcrModule } from '../ocr/ocr.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerPiiModule } from '../customers/customer-pii.module';

@Module({
  imports: [LineOaModule, forwardRef(() => ChatbotFinanceModule), OcrModule, NotificationsModule, CustomerPiiModule],
  controllers: [RoomFinanceApplicationsController, FinanceApplicationsController],
  providers: [FinanceApplicationService, FinanceApplicationNumberService],
  exports: [FinanceApplicationService],
})
export class ExternalFinanceApplicationModule {}
```
(`PrismaModule`/`StorageModule` เป็น `@Global()` ไม่ต้อง import · ชื่อไฟล์/คลาสของ `NotificationsModule`, `CustomerPiiModule` ให้ยืนยันด้วย `ls apps/api/src/modules/notifications apps/api/src/modules/customers | grep module` ก่อน import)

`app.module.ts`: เพิ่ม `import { ExternalFinanceApplicationModule } from './modules/external-finance-application/external-finance-application.module';` และใส่ `ExternalFinanceApplicationModule,` ถัดจาก `ExternalFinanceModule,` (~L399) พร้อมคอมเมนต์ `// ยื่น GFIN — แพ็กเช็คจากห้องแชท (spec 2026-09-24)`

- [ ] **Step 12: รันเทสต์ service ให้ผ่าน + type-check**

Run: `cd apps/api && npx jest src/modules/external-finance-application --runInBand && cd ../.. && ./tools/check-types.sh api`
Expected: PASS ทั้ง 2 spec · 0 type errors · แอปบูตได้ (`cd apps/api && npx nest build` ผ่าน)

- [ ] **Step 13: DB spec เริ่มต้น (ต่อเติมใน task ถัดไป)**

`__tests__/finance-application-flow.db.spec.ts`:
```ts
/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/external-finance-application/__tests__/finance-application-flow.db.spec.ts --runInBand
 * สร้างห้อง/ผู้ใช้/ลูกค้า/สินค้าของตัวเองแล้วลบทิ้งใน afterAll (ลูกก่อนแม่)
 */
import { PrismaClient, ChatChannel } from '@prisma/client';
import { FinanceApplicationService } from '../services/finance-application.service';
import { FinanceApplicationNumberService } from '../services/finance-application-number.service';

const prisma = new PrismaClient();
const tag = `gfin-flow-${Date.now()}`;
let roomId = ''; let userId = '';
let service: FinanceApplicationService;

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  const user = await prisma.user.findFirst({ where: { role: 'OWNER', deletedAt: null }, select: { id: true } });
  if (!user) throw new Error('ต้องมีผู้ใช้ OWNER ในฐานทดสอบ (seed ก่อน)');
  userId = user.id;
  const room = await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: tag, displayName: tag } });
  roomId = room.id;
  service = new FinanceApplicationService(prisma as any, new FinanceApplicationNumberService());
});

afterAll(async () => {
  await prisma.externalFinanceApplicationEvent.deleteMany({ where: { application: { roomId } } });
  await prisma.externalFinanceApplicationFile.deleteMany({ where: { application: { roomId } } });
  await prisma.externalFinanceApplication.deleteMany({ where: { roomId } });
  await prisma.chatMessage.deleteMany({ where: { roomId } });
  await prisma.chatRoom.delete({ where: { id: roomId } });
  await prisma.$disconnect();
});

describe('ใบยื่น GFIN บน DB จริง', () => {
  it('creates one draft per room with a BC-YYMMDD-NNN number and returns it again on the second call', async () => {
    const actor = { id: userId, role: 'OWNER' };
    const first = await service.createDraft(roomId, actor);
    expect(first.number).toMatch(/^BC-\d{6}-\d{3}$/);
    const second = await service.createDraft(roomId, actor);
    expect(second.id).toBe(first.id);
    const listed = await service.listForRoom(roomId, actor);
    expect(listed.current?.id).toBe(first.id);
    expect(listed.history).toHaveLength(0);
  });
});
```

Run: `cd apps/api && DATABASE_URL=<test_db> npx jest src/modules/external-finance-application/__tests__/finance-application-flow.db.spec.ts --runInBand`
Expected: PASS 1

- [ ] **Step 14: commit**

```bash
git add apps/api/src/modules/external-finance-application apps/api/src/app.module.ts
git commit -m "feat(gfin): โมดูลใบยื่นไฟแนนซ์นอก — สร้าง/อ่าน/แก้ร่าง + state machine + เลข BC-YYMMDD-NNN"
```

---

### Task 4: ไฟล์ของใบยื่น — หยิบจากแชท (Facebook/LINE) · อัปโหลด · รูป 6 มุมจากสต๊อก · ลบ · สตรีม

**Files:**
- Create: `apps/api/src/modules/credit-check/services/media-fetch.util.ts` (ย้าย `detectFile`, `readLimited`, `mediaUrl`, `fetchProviderMedia` ออกจาก `room-credit.service.ts:26-81, 138-166`)
- Modify: `apps/api/src/modules/credit-check/services/room-credit.service.ts` (import จาก util — พฤติกรรมเดิมทุกไบต์)
- Create: `apps/api/src/modules/external-finance-application/services/finance-application-files.service.ts`
- Create: `apps/api/src/modules/external-finance-application/dto/finance-application-files.dto.ts`
- Modify: `apps/api/src/modules/external-finance-application/finance-applications.controller.ts` (เพิ่ม 5 route)
- Modify: `apps/api/src/modules/external-finance-application/external-finance-application.module.ts` (provider ใหม่)
- Test: `apps/api/src/modules/credit-check/services/media-fetch.util.spec.ts`
- Test: `apps/api/src/modules/external-finance-application/__tests__/finance-application-files.service.spec.ts`
- Test: ต่อเติม `__tests__/finance-application-flow.db.spec.ts`

**Interfaces:**
- Consumes: `FinanceApplicationService.get/access/addEvent` (Task 3) · `StorageService.upload/getStream/delete` · `LineOaService.downloadContent(messageId, 'line-shop')` (`line-oa.service.ts:87`) · `LineFinanceClientService.getMessageContent(messageId)` (`line-finance-client.service.ts:139`)
- Produces: `fetchProviderMedia(rawUrl): Promise<{ bytes: Buffer; contentType: string }>` · `detectFile(bytes)` · `readLimited(stream)` · `FinanceApplicationFilesService.fromMessage(id, dto, actor)` · `.upload(id, slot, file, actor)` · `.fromProduct(id, actor)` · `.remove(id, fileId, actor)` · `.download(id, fileId, actor): Promise<{ file, stream }>` · route `POST /finance-applications/:id/files/from-message {messageId, slot}` · `POST .../files` (multipart `file` + field `slot`) · `POST .../files/from-product` · `DELETE .../files/:fileId` · `GET .../files/:fileId`

- [ ] **Step 1: แยก util จาก room-credit — เขียนเทสต์ล้มก่อน**

`media-fetch.util.spec.ts`:
```ts
import { BadRequestException } from '@nestjs/common';
import { detectFile, readLimited, fetchProviderMedia } from './media-fetch.util';
import { Readable } from 'stream';

describe('media-fetch.util', () => {
  it('detectFile sniffs jpeg/png/pdf and rejects unknown bytes', () => {
    expect(detectFile(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toEqual({ mimeType: 'image/jpeg', ext: 'jpg' });
    expect(detectFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]))).toEqual({ mimeType: 'image/png', ext: 'png' });
    expect(() => detectFile(Buffer.from('hello'))).toThrow(BadRequestException);
    expect(() => detectFile(Buffer.alloc(0))).toThrow(BadRequestException);
  });
  it('readLimited stops at 10MB', async () => {
    const big = Readable.from([Buffer.alloc(6 * 1024 * 1024), Buffer.alloc(6 * 1024 * 1024)]);
    await expect(readLimited(big)).rejects.toThrow('ไฟล์มีขนาดเกิน 10MB');
  });
  it('fetchProviderMedia refuses hosts outside the provider allowlist without calling fetch', async () => {
    const spy = jest.spyOn(global, 'fetch');
    await expect(fetchProviderMedia('https://evil.example.com/x.jpg')).rejects.toThrow('ไม่สามารถนำเข้าไฟล์จากแหล่งนี้ได้');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('fetchProviderMedia maps a 403 from fbcdn to the expired message', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ status: 403, ok: false, headers: new Headers(), body: { cancel: async () => undefined } } as any);
    await expect(fetchProviderMedia('https://scontent.xx.fbcdn.net/a.jpg')).rejects.toThrow('ไฟล์หมดอายุ');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd apps/api && npx jest src/modules/credit-check/services/media-fetch.util.spec.ts --runInBand`
Expected: FAIL — Cannot find module

- [ ] **Step 3: สร้าง util โดยย้ายโค้ดเดิม (ห้ามเปลี่ยนตรรกะ)**

`media-fetch.util.ts` — ย้าย `MAX_BYTES`, `EXPIRED` (export เป็น `EXPIRED_MEDIA_MSG`), `detectFile`, `mediaUrl` (export เป็น `providerMediaUrl`), `readLimited` จาก `room-credit.service.ts` มาไว้ตรง ๆ แล้วเพิ่มฟังก์ชันเดียว:
```ts
/** ดาวน์โหลดไฟล์จาก CDN ของผู้ให้บริการแชท (fbcdn/fbsbx/line-scdn) ตาม redirect ≤ 3 ครั้ง — ตรรกะเดิมของ RoomCreditService.fetchMedia */
export async function fetchProviderMedia(raw: string): Promise<{ bytes: Buffer; contentType: string }> {
  let url = providerMediaUrl(raw);
  try {
    const signal = AbortSignal.timeout(20000);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetch(url, { redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        url = providerMediaUrl(new URL(response.headers.get('location') || '', url).href);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new BadRequestException(EXPIRED_MEDIA_MSG); }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new BadRequestException('ไฟล์มีขนาดเกิน 10MB'); }
      if (!response.body) throw new BadRequestException(EXPIRED_MEDIA_MSG);
      const bytes = await readLimited(Readable.fromWeb(response.body as never));
      return { bytes, contentType: response.headers.get('content-type') || '' };
    }
    throw new BadRequestException(EXPIRED_MEDIA_MSG);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(EXPIRED_MEDIA_MSG);
  }
}
```
ใน `room-credit.service.ts`: ลบสำเนาเดิม, `import { detectFile, readLimited, fetchProviderMedia, EXPIRED_MEDIA_MSG, MAX_BYTES } from './media-fetch.util';`, เปลี่ยน `this.fetchMedia(...)` เป็น `fetchProviderMedia(...)` และที่ใช้ `EXPIRED` เป็น `EXPIRED_MEDIA_MSG`

- [ ] **Step 4: รันเทสต์ util + เทสต์ตรวจเครดิตเดิมทั้งหมด**

Run: `cd apps/api && npx jest src/modules/credit-check src/modules/staff-chat/room-credit --runInBand`
Expected: PASS ทั้งหมด (พฤติกรรมเดิมไม่เปลี่ยน)

- [ ] **Step 5: DTO ไฟล์**

`dto/finance-application-files.dto.ts`:
```ts
import { IsEnum, IsUUID } from 'class-validator';
import { ExternalFinanceDocSlot } from '@prisma/client';

export class FileFromMessageDto {
  @IsUUID('4', { message: 'รหัสข้อความไม่ถูกต้อง' }) messageId: string;
  @IsEnum(ExternalFinanceDocSlot, { message: 'กรุณาเลือกช่องเอกสาร' }) slot: ExternalFinanceDocSlot;
}
export class FileUploadFieldsDto {
  @IsEnum(ExternalFinanceDocSlot, { message: 'กรุณาเลือกช่องเอกสาร' }) slot: ExternalFinanceDocSlot;
}
```

- [ ] **Step 6: เทสต์ files service ล้มก่อน (mock)**

`__tests__/finance-application-files.service.spec.ts`:
```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FinanceApplicationFilesService } from '../services/finance-application-files.service';
import * as media from '../../credit-check/services/media-fetch.util';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
const actor = { id: 'u1', role: 'OWNER' };
const draft = { id: 'app-1', roomId: 'room-1', status: 'DRAFT', productId: 'p-1', files: [] as any[], room: { channel: 'FACEBOOK' } };

function build(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    chatMessage: { findFirst: jest.fn() },
    externalFinanceApplicationFile: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockImplementation(({ data }) => ({ id: 'f-1', ...data })), findFirst: jest.fn(), update: jest.fn() },
    productPhoto: { findUnique: jest.fn() },
    product: { findFirst: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    ...overrides,
  };
  const storage = { configured: true, upload: jest.fn().mockResolvedValue('k'), delete: jest.fn().mockResolvedValue(undefined), getStream: jest.fn() };
  const applications = { get: jest.fn().mockResolvedValue(draft), access: jest.fn().mockResolvedValue({}), addEvent: jest.fn() };
  const lineOa = { downloadContent: jest.fn() };
  const lineFinance = { getMessageContent: jest.fn() };
  const service = new FinanceApplicationFilesService(prisma, storage as any, applications as any, lineOa as any, lineFinance as any);
  return { service, prisma, storage, applications, lineOa, lineFinance };
}

describe('FinanceApplicationFilesService.fromMessage', () => {
  it('copies a Facebook image via fetchProviderMedia and stores it under external-finance/<appId>/', async () => {
    const { service, prisma, storage } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm1', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg', externalMessageId: null });
    jest.spyOn(media, 'fetchProviderMedia').mockResolvedValue({ bytes: JPEG, contentType: 'image/jpeg' });
    const file = await service.fromMessage('app-1', { messageId: 'm1', slot: 'INCOME' }, actor);
    expect(storage.upload).toHaveBeenCalledWith(expect.stringMatching(/^external-finance\/app-1\/[0-9a-f-]+\.jpg$/), JPEG, 'image/jpeg');
    expect(file).toMatchObject({ slot: 'INCOME', source: 'CHAT_MESSAGE', sourceMessageId: 'm1', mimeType: 'image/jpeg' });
  });
  it('downloads a LINE finance image by message id when there is no mediaUrl', async () => {
    const { service, prisma, lineFinance } = build();
    (service as any).applications.get.mockResolvedValue({ ...draft, room: { channel: 'LINE_FINANCE' } });
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm2', roomId: 'room-1', type: 'IMAGE', mediaUrl: null, externalMessageId: 'LINE-1' });
    lineFinance.getMessageContent.mockResolvedValue(JPEG);
    await service.fromMessage('app-1', { messageId: 'm2', slot: 'ID_CARD' }, actor);
    expect(lineFinance.getMessageContent).toHaveBeenCalledWith('LINE-1');
  });
  it('404s with an upload hint for a legacy LINE image that has neither mediaUrl nor message id', async () => {
    const { service, prisma } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm3', roomId: 'room-1', type: 'IMAGE', mediaUrl: null, externalMessageId: null });
    await expect(service.fromMessage('app-1', { messageId: 'm3', slot: 'ID_CARD' }, actor)).rejects.toThrow(NotFoundException);
    await expect(service.fromMessage('app-1', { messageId: 'm3', slot: 'ID_CARD' }, actor)).rejects.toThrow('อัปโหลด');
  });
  it('returns the existing row instead of duplicating the same message', async () => {
    const { service, prisma, storage } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm1', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg' });
    prisma.externalFinanceApplicationFile.findMany.mockResolvedValue([{ id: 'f-0', sourceMessageId: 'm1', slot: 'INCOME' }]);
    jest.spyOn(media, 'fetchProviderMedia').mockResolvedValue({ bytes: JPEG, contentType: 'image/jpeg' });
    const file = await service.fromMessage('app-1', { messageId: 'm1', slot: 'INCOME' }, actor);
    expect(file.id).toBe('f-0');
    expect(storage.delete).toHaveBeenCalled(); // ไฟล์ที่อัปโหลดไปแล้วถูกเก็บกวาด
  });
  it('removes the uploaded object when the DB write fails (no orphan)', async () => {
    const { service, prisma, storage } = build();
    prisma.chatMessage.findFirst.mockResolvedValue({ id: 'm1', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg' });
    jest.spyOn(media, 'fetchProviderMedia').mockResolvedValue({ bytes: JPEG, contentType: 'image/jpeg' });
    prisma.externalFinanceApplicationFile.create.mockRejectedValue(new Error('db down'));
    await expect(service.fromMessage('app-1', { messageId: 'm1', slot: 'INCOME' }, actor)).rejects.toThrow('db down');
    expect(storage.delete).toHaveBeenCalled();
  });
  it('rejects when the application is closed', async () => {
    const { service } = build();
    (service as any).applications.get.mockResolvedValue({ ...draft, status: 'APPROVED' });
    await expect(service.fromMessage('app-1', { messageId: 'm1', slot: 'INCOME' }, actor)).rejects.toThrow(BadRequestException);
  });
});

describe('FinanceApplicationFilesService.fromProduct', () => {
  it('copies the 6 completed angles of a PHONE_USED product into DEVICE_PHOTO', async () => {
    const { service, prisma, storage } = build();
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', category: 'PHONE_USED' });
    const dataUrl = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
    prisma.productPhoto.findUnique.mockResolvedValue({ isCompleted: true, front: dataUrl, back: dataUrl, left: dataUrl, right: dataUrl, top: dataUrl, bottom: dataUrl });
    const files = await service.fromProduct('app-1', actor);
    expect(files).toHaveLength(6);
    expect(storage.upload).toHaveBeenCalledTimes(6);
    expect(files.map((f: any) => f.sourceAngle)).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom']);
  });
  it('400s for a new phone or an incomplete photo set', async () => {
    const { service, prisma } = build();
    prisma.product.findFirst.mockResolvedValue({ id: 'p-1', category: 'PHONE_NEW' });
    await expect(service.fromProduct('app-1', actor)).rejects.toThrow('ถ่ายเพิ่ม');
  });
});
```

- [ ] **Step 7: รันให้ล้ม**

Run: `cd apps/api && npx jest src/modules/external-finance-application/__tests__/finance-application-files.service.spec.ts --runInBand`
Expected: FAIL — Cannot find module

- [ ] **Step 8: เขียน files service**

`services/finance-application-files.service.ts`:
```ts
import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ExternalFinanceDocSlot, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { LineFinanceClientService } from '../../chatbot-finance/services/line-finance-client.service';
import { detectFile, fetchProviderMedia, readLimited, EXPIRED_MEDIA_MSG } from '../../credit-check/services/media-fetch.util';
import { FinanceApplicationService } from './finance-application.service';
import { FinanceActor, MAX_FILES, STORAGE_PREFIX } from '../constants';
import { isClosed } from '../finance-application-status.util';
import { FileFromMessageDto } from '../dto/finance-application-files.dto';

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
const DATA_URL_RE = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/;
const NO_SOURCE_MSG = 'ไฟล์นี้ระบบไม่ได้เก็บไว้ (ส่งมาก่อนอัปเดต) กรุณาบันทึกรูปจากแชทแล้วอัปโหลดแทน';

@Injectable()
export class FinanceApplicationFilesService {
  private readonly logger = new Logger(FinanceApplicationFilesService.name);
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private applications: FinanceApplicationService,
    private lineOa: LineOaService,
    private lineFinance: LineFinanceClientService,
  ) {}

  private async openApplication(id: string, actor: FinanceActor) {
    const app = await this.applications.get(id, actor);
    if (isClosed(app.status)) throw new BadRequestException('ใบยื่นปิดแล้ว เพิ่ม/ลบไฟล์ไม่ได้');
    return app;
  }

  /** ดึงไบต์ของข้อความในห้อง: คีย์ staff-chat/ → storage · URL ผู้ให้บริการ → fetch · LINE ไม่มี URL → ดึงด้วย message id */
  private async loadMessageBytes(message: { mediaUrl: string | null; mediaType: string | null; externalMessageId: string | null }, channel: string) {
    if (message.mediaUrl?.startsWith('staff-chat/'))
      return { bytes: await readLimited(await this.storage.getStream(message.mediaUrl)), contentType: message.mediaType || '' };
    if (message.mediaUrl) return fetchProviderMedia(message.mediaUrl);
    if (message.externalMessageId) {
      try {
        const bytes = channel === 'LINE_FINANCE'
          ? await this.lineFinance.getMessageContent(message.externalMessageId)
          : await this.lineOa.downloadContent(message.externalMessageId, 'line-shop');
        return { bytes, contentType: '' };
      } catch (error) {
        this.logger.warn(`LINE content download failed for ${message.externalMessageId}: ${(error as Error).message}`);
        throw new BadRequestException(EXPIRED_MEDIA_MSG);
      }
    }
    throw new NotFoundException(NO_SOURCE_MSG);
  }

  async fromMessage(applicationId: string, dto: FileFromMessageDto, actor: FinanceActor) {
    const app = await this.openApplication(applicationId, actor);
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: dto.messageId, roomId: app.roomId, deletedAt: null, type: { in: ['IMAGE', 'FILE'] } },
      select: { id: true, mediaUrl: true, mediaType: true, externalMessageId: true },
    });
    if (!message) throw new NotFoundException('ไม่พบไฟล์ในห้องแชทนี้');
    const media = await this.loadMessageBytes(message, app.room.channel);
    return this.attach(app.id, media.bytes, actor, { slot: dto.slot, source: 'CHAT_MESSAGE', sourceMessageId: message.id });
  }

  async upload(applicationId: string, slot: ExternalFinanceDocSlot, file: Express.Multer.File | undefined, actor: FinanceActor) {
    const app = await this.openApplication(applicationId, actor);
    if (!file) throw new BadRequestException('กรุณาเลือกไฟล์');
    return this.attach(app.id, file.buffer, actor, { slot, source: 'UPLOAD', originalName: file.originalname });
  }

  /** รูป 6 มุมจากสต๊อก (ProductPhoto เก็บ data URL) — เฉพาะมือสองที่ถ่ายครบ (product-photos.service.ts:44-47) */
  async fromProduct(applicationId: string, actor: FinanceActor) {
    const app = await this.openApplication(applicationId, actor);
    if (!app.productId) throw new BadRequestException('เลือกเครื่องก่อน');
    const product = await this.prisma.product.findFirst({ where: { id: app.productId, deletedAt: null }, select: { id: true, category: true } });
    const photos = product?.category === 'PHONE_USED'
      ? await this.prisma.productPhoto.findUnique({ where: { productId: product.id } })
      : null;
    const complete = !!photos && photos.isCompleted && ANGLES.every((a) => !!photos[a]);
    if (!complete) throw new BadRequestException('เครื่องนี้ไม่มีรูป 6 มุมครบในสต๊อก กรุณาถ่ายเพิ่มในช่อง "รูปเครื่อง 6 มุม"');
    const existing = await this.prisma.externalFinanceApplicationFile.findMany({ where: { applicationId: app.id, deletedAt: null, source: 'PRODUCT_PHOTO' } });
    const results = [];
    for (const [index, angle] of ANGLES.entries()) {
      if (existing.some((f) => f.sourceAngle === angle)) continue;
      const match = DATA_URL_RE.exec(photos![angle] as string);
      if (!match) throw new BadRequestException(`รูปมุม ${angle} ไม่อยู่ในรูปแบบที่รองรับ`);
      results.push(await this.attach(app.id, Buffer.from(match[2], 'base64'), actor, { slot: 'DEVICE_PHOTO', source: 'PRODUCT_PHOTO', sourceAngle: angle, sortOrder: index }));
    }
    return results;
  }

  private async attach(
    applicationId: string,
    bytes: Buffer,
    actor: FinanceActor,
    meta: { slot: ExternalFinanceDocSlot; source: 'CHAT_MESSAGE' | 'UPLOAD' | 'PRODUCT_PHOTO'; sourceMessageId?: string; sourceAngle?: string; originalName?: string; sortOrder?: number },
  ) {
    const type = detectFile(bytes);
    if (!this.storage.configured) throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่าที่เก็บไฟล์');
    const key = `${STORAGE_PREFIX}/${applicationId}/${randomUUID()}.${type.ext}`;
    let retained = false;
    try {
      await this.storage.upload(key, bytes, type.mimeType);
      const saved = await this.prisma.$transaction(async (tx) => {
        const files = await tx.externalFinanceApplicationFile.findMany({ where: { applicationId, deletedAt: null } });
        const duplicate = meta.sourceMessageId && files.find((f) => f.sourceMessageId === meta.sourceMessageId);
        if (duplicate) return { file: duplicate, created: false };
        if (files.length >= MAX_FILES) throw new BadRequestException(`แนบได้สูงสุด ${MAX_FILES} ไฟล์ต่อใบยื่น`);
        const file = await tx.externalFinanceApplicationFile.create({
          data: {
            applicationId, slot: meta.slot, storageKey: key, mimeType: type.mimeType, size: bytes.length,
            originalName: meta.originalName ?? null, source: meta.source, sourceMessageId: meta.sourceMessageId ?? null,
            sourceAngle: meta.sourceAngle ?? null, sortOrder: meta.sortOrder ?? files.filter((f) => f.slot === meta.slot).length,
            createdById: actor.id,
          },
        });
        return { file, created: true };
      });
      retained = saved.created;
      return saved.file;
    } finally {
      if (!retained) {
        try { await this.storage.delete(key); } catch { this.logger.warn(`Could not remove unreferenced finance attachment ${key}`); }
      }
    }
  }

  async remove(applicationId: string, fileId: string, actor: FinanceActor) {
    const app = await this.openApplication(applicationId, actor);
    const file = await this.prisma.externalFinanceApplicationFile.findFirst({ where: { id: fileId, applicationId: app.id, deletedAt: null } });
    if (!file) throw new NotFoundException('ไม่พบไฟล์');
    if (file.sentAt) throw new BadRequestException('ไฟล์ที่ส่งไปแล้วลบไม่ได้ — ยกเลิกใบยื่นแทน');
    await this.prisma.externalFinanceApplicationFile.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
    if (file.storageKey) { try { await this.storage.delete(file.storageKey); } catch { this.logger.warn(`Could not delete ${file.storageKey}`); } }
    return { success: true };
  }

  async download(applicationId: string, fileId: string, actor: FinanceActor) {
    const app = await this.applications.get(applicationId, actor);
    const file = await this.prisma.externalFinanceApplicationFile.findFirst({ where: { id: fileId, applicationId: app.id, deletedAt: null } });
    if (!file?.storageKey) throw new NotFoundException('ไฟล์ถูกลบตามนโยบายเก็บข้อมูลแล้ว');
    return { file, stream: await this.storage.getStream(file.storageKey) };
  }
}
```
ถ้า `LineOaService`/`LineFinanceClientService` ไม่ได้ export จาก module ของมัน ให้เพิ่มใน `exports` ของ module นั้น (ตรวจ `line-oa.module.ts:75` และ `chatbot-finance.module.ts:90` — รายงานสำรวจบอกว่า export แล้วทั้งคู่)

- [ ] **Step 9: route ใน `finance-applications.controller.ts`**

```ts
import { Delete, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { pipeline } from 'stream/promises';
import { FinanceApplicationFilesService } from './services/finance-application-files.service';
import { FileFromMessageDto, FileUploadFieldsDto } from './dto/finance-application-files.dto';
// constructor: (private applications: FinanceApplicationService, private files: FinanceApplicationFilesService)

  @Post(':id/files/from-message')
  @Throttle({ short: { limit: 30, ttl: 60000 } })
  fromMessage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FileFromMessageDto, @Req() req: { user: FinanceActor }) {
    return this.files.fromMessage(id, dto, req.user);
  }

  @Post(':id/files')
  @Throttle({ short: { limit: 30, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(@Param('id', ParseUUIDPipe) id: string, @Body() fields: FileUploadFieldsDto, @UploadedFile() file: Express.Multer.File, @Req() req: { user: FinanceActor }) {
    return this.files.upload(id, fields.slot, file, req.user);
  }

  @Post(':id/files/from-product')
  fromProduct(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) {
    return this.files.fromProduct(id, req.user);
  }

  @Delete(':id/files/:fileId')
  remove(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Req() req: { user: FinanceActor }) {
    return this.files.remove(id, fileId, req.user);
  }

  @Get(':id/files/:fileId')
  async download(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Req() req: { user: FinanceActor }, @Res() res: Response) {
    const { file, stream } = await this.files.download(id, fileId, req.user);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName ?? `${file.slot}.${file.mimeType.split('/')[1]}`)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(stream, res);
  }
```
เพิ่ม `FinanceApplicationFilesService` ใน `providers` ของ module

- [ ] **Step 10: รันเทสต์ให้ผ่าน + DB spec ต่อเติม**

Run: `cd apps/api && npx jest src/modules/external-finance-application --runInBand && cd ../.. && ./tools/check-types.sh api`
Expected: PASS · 0 type errors

ต่อเติม `finance-application-flow.db.spec.ts` (ใช้ `STORAGE_LOCAL_DIR` ชั่วคราวผ่าน `ConfigService` stub แบบ `storage.service.spec.ts:172-186`):
```ts
  it('attaches a staff-chat image from the room into INCOME once (duplicate pick returns the same row)', async () => {
    const message = await prisma.chatMessage.create({ data: { roomId, role: 'STAFF', type: 'IMAGE', text: null, mediaUrl: `staff-chat/${roomId}/x.jpg`, mediaType: 'image/jpeg' } });
    await fs.writeFile(path.join(localDir, `staff-chat/${roomId}/x.jpg`), JPEG_BYTES); // เขียนไฟล์ลงที่เก็บ local ที่ StorageService ชี้ไว้
    const actor = { id: userId, role: 'OWNER' };
    const app = await service.createDraft(roomId, actor);
    const a = await files.fromMessage(app.id, { messageId: message.id, slot: 'INCOME' }, actor);
    const b = await files.fromMessage(app.id, { messageId: message.id, slot: 'INCOME' }, actor);
    expect(b.id).toBe(a.id);
    const rows = await prisma.externalFinanceApplicationFile.findMany({ where: { applicationId: app.id, deletedAt: null } });
    expect(rows).toHaveLength(1);
  });
```
(`files = new FinanceApplicationFilesService(prisma as any, storage, service, {} as any, {} as any)` โดย `storage` เป็น `StorageService` ที่สร้างจาก `ConfigService` stub `{ STORAGE_LOCAL_DIR: localDir, NODE_ENV: 'test' }` — `mkdtemp` ใน `beforeAll` และ `rm -rf` ใน `afterAll`)

Run: `cd apps/api && DATABASE_URL=<test_db> npx jest src/modules/external-finance-application/__tests__/finance-application-flow.db.spec.ts --runInBand`
Expected: PASS 2

- [ ] **Step 11: commit**

```bash
git add apps/api/src/modules/credit-check apps/api/src/modules/external-finance-application
git commit -m "feat(gfin): ไฟล์ใบยื่น — หยิบจากแชท Facebook/LINE, อัปโหลด, รูป 6 มุมจากสต๊อก (แยก media-fetch util จากตรวจเครดิต)"
```

---

### Task 5: ความพร้อม · ร่างข้อความ · ส่งแบบคัดลอก · ส่งเพิ่ม · ต่ออายุ/ยกเลิกลิงก์ · บันทึกผลเอง · ยกเลิกใบ

**Files:**
- Modify: `apps/api/src/modules/external-finance-application/services/finance-application.service.ts` (เพิ่ม `preview`, `send`, `resend`, `getShareLink`, `extendShare`, `revokeShare`, `staffResult`, `cancel` + constructor รับ `CustomerPiiService`, `ConfigService`)
- Create: `apps/api/src/modules/external-finance-application/finance-share-token.util.ts`
- Modify: `apps/api/src/modules/external-finance-application/finance-applications.controller.ts` (เพิ่ม 8 route)
- Modify: `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md` §12 (โทเคนดิบเก็บเข้ารหัส) และ §5.1 (`resend` ใช้ลิงก์เดิม)
- Test: `__tests__/finance-share-token.util.spec.ts` · ต่อเติม `__tests__/finance-application.service.spec.ts` · ต่อเติม `__tests__/finance-application-flow.db.spec.ts`

**Interfaces:**
- Consumes: `buildPrecheckMessage`, `DEFAULT_PRECHECK_TEMPLATE`, `precheckMissingFields`, `computeAgeYears`, `renderHand` จาก `@installment/shared` (Task 2) · `applyTransition` (Task 3) · `CustomerPiiService.decryptCustomerFields` · `encryptPII/decryptPII` จาก `src/utils/crypto.util.ts` (key = `PII_ENCRYPTION_KEY`)
- Produces:
  - `newShareToken(): { raw: string; hash: string }` · `hashShareToken(raw): string`
  - `FinanceApplicationService.preview(id, actor): Promise<PreviewResult>` โดย `PreviewResult = { text: string; values: PrecheckValues; missingFields: PrecheckField[]; missingRequiredSlots: ExternalFinanceDocSlot[]; warnings: string[]; canSend: boolean }`
  - `.send(id, dto, actor): Promise<{ application; messageText: string; shareUrl: string }>` · `.resend(id, actor)` · `.getShareLink(id, actor): Promise<{ url: string; expiresAt: Date | null; revokedAt: Date | null }>` · `.extendShare(id, actor)` · `.revokeShare(id, actor)` · `.staffResult(id, dto, actor)` · `.cancel(id, actor)`
  - route: `GET /finance-applications/:id/message-preview` · `POST :id/send` · `POST :id/resend` · `GET :id/share-link` · `POST :id/share/extend` · `POST :id/share/revoke` · `POST :id/result` · `POST :id/cancel`
  - (Task 6 ใช้) `findByShareToken(raw)` อยู่ใน `FinanceShareService` — ค้นด้วย `hashShareToken(raw)`

- [ ] **Step 1: token util — เทสต์ล้มก่อน**

`__tests__/finance-share-token.util.spec.ts`:
```ts
import { newShareToken, hashShareToken } from '../finance-share-token.util';

describe('finance-share-token.util', () => {
  it('makes 43-char base64url tokens and a 64-hex sha256 hash', () => {
    const { raw, hash } = newShareToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(raw)).toBe(hash);
    expect(newShareToken().raw).not.toBe(raw);
  });
});
```
Run: `cd apps/api && npx jest src/modules/external-finance-application/__tests__/finance-share-token.util.spec.ts --runInBand` → Expected: FAIL (module not found)

- [ ] **Step 2: token util**

`finance-share-token.util.ts`:
```ts
import { createHash, randomBytes } from 'crypto';

export function hashShareToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
export function newShareToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashShareToken(raw) };
}
```
Run เทสต์เดิม → Expected: PASS

- [ ] **Step 3: เทสต์ service ล้มก่อน (ต่อท้ายไฟล์ spec ของ Task 3 — แก้ทุก `new FinanceApplicationService(prisma, numbers)` เป็น `new FinanceApplicationService(prisma, numbers, pii, config)`)**

```ts
const pii = { decryptCustomerFields: (c: any) => c } as any;
const config = { get: (key: string) => (key === 'SHARE_PAGE_BASE_URL' ? 'https://bestchoicephone.app' : key === 'PII_ENCRYPTION_KEY' ? 'a'.repeat(64) : undefined) } as any;

const ready = {
  id: 'app-1', roomId: 'room-1', status: 'DRAFT', number: 'BC-260924-001', occupationOverride: null, messageOverride: null, room,
  customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0937581095', occupation: 'พนักงานบริษัท', birthDate: new Date('1997-12-27') },
  product: { id: 'p1', name: 'iPhone 13 Pro Max', brand: 'Apple', model: '13 Pro Max', storage: '256GB', imeiSerial: '355908667841899', category: 'PHONE_USED', status: 'IN_STOCK' },
  files: [{ slot: 'ID_SELFIE', sentAt: null }, { slot: 'ID_CARD', sentAt: null }, { slot: 'INCOME', sentAt: null }],
  events: [],
};

describe('FinanceApplicationService.preview / send', () => {
  it('previews the 12-item text with the model name from stock and lists nothing missing', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(ready) } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    const preview = await service.preview('app-1', owner);
    expect(preview.canSend).toBe(true);
    expect(preview.text).toContain('3.สนใจโทรศัพท์รุ่น : iPhone 13 Pro Max 256GB');
    expect(preview.text).toContain('4.มือ1/2 : 2');
    expect(preview.text).toContain('12.มีสายชาร์จหรือไม่? : -');
    expect(preview.text).toContain('{{link}}'.length ? 'เอกสารทั้งหมด 3 ไฟล์:' : '');
  });
  it('blocks send when occupation or a required slot is missing, naming both', async () => {
    const app = { ...ready, customer: { ...ready.customer, occupation: null }, files: ready.files.filter((f) => f.slot !== 'INCOME') };
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(app) } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    const preview = await service.preview('app-1', owner);
    expect(preview.canSend).toBe(false);
    expect(preview.missingFields).toEqual(['occupation']);
    expect(preview.missingRequiredSlots).toEqual(['INCOME']);
    await expect(service.send('app-1', { via: 'COPY' }, owner)).rejects.toThrow('อาชีพ');
  });
  it('send (COPY) issues a token, stamps files, stores the final text with the link and returns the url once', async () => {
    const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...ready, ...data, files: ready.files }));
    const prisma = makePrisma({
      externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(ready), update },
      externalFinanceApplicationFile: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'ป๊อปคอร์น' }) },
    });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    const result = await service.send('app-1', { via: 'COPY' }, owner);
    expect(result.shareUrl).toMatch(/^https:\/\/bestchoicephone\.app\/api\/g\/[A-Za-z0-9_-]{43}$/);
    expect(result.messageText.endsWith(`เอกสารทั้งหมด 3 ไฟล์: ${result.shareUrl}`)).toBe(true);
    expect(result.messageText).toContain('ส่งโดย ป๊อปคอร์น · BESTCHOICE');
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('SENT');
    expect(data.sentVia).toBe('COPY');
    expect(data.shareTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.shareTokenEnc).not.toContain(result.shareUrl.split('/').pop());
    expect(prisma.externalFinanceApplicationFile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ applicationId: 'app-1', sentAt: null }) }));
  });
  it('send via BOT is not available in PR 1', async () => {
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(ready) } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    await expect(service.send('app-1', { via: 'BOT' }, owner)).rejects.toThrow('PR 2');
  });
  it('staffResult APPROVED closes the application and stamps resultSource STAFF; cancel revokes the link', async () => {
    const sent = { ...ready, status: 'SENT', shareTokenHash: 'h', shareExpiresAt: new Date(Date.now() + 86400000) };
    const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...sent, ...data }));
    const prisma = makePrisma({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(sent), update } });
    const service = new FinanceApplicationService(prisma, numbers, pii, config);
    await service.staffResult('app-1', { result: 'APPROVED' }, owner);
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', resultSource: 'STAFF' });
    expect(update.mock.calls[0][0].data.closedAt).toBeInstanceOf(Date);
    await service.cancel('app-1', owner);
    expect(update.mock.calls[1][0].data).toMatchObject({ status: 'CANCELLED' });
    expect(update.mock.calls[1][0].data.shareRevokedAt).toBeInstanceOf(Date);
  });
});
```
Run: `cd apps/api && npx jest src/modules/external-finance-application/__tests__/finance-application.service.spec.ts --runInBand` → Expected: FAIL (`preview`/`send` ไม่มี)

- [ ] **Step 4: เขียนโค้ดใน `finance-application.service.ts`**

เพิ่ม import และ constructor:
```ts
import { ConfigService } from '@nestjs/config';
import { NotImplementedException } from '@nestjs/common';
import { ExternalFinanceDocSlot } from '@prisma/client';
import {
  DEFAULT_PRECHECK_TEMPLATE, buildPrecheckMessage, precheckMissingFields, computeAgeYears, renderHand,
  type PrecheckField, type PrecheckValues,
} from '@installment/shared';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { encryptPII, decryptPII } from '../../../utils/crypto.util';
import { applyTransition } from '../finance-application-status.util';
import { REQUIRED_SLOTS, SHARE_TTL_DAYS, SLOT_LABELS } from '../constants';
import { newShareToken } from '../finance-share-token.util';
import { SendFinanceApplicationDto, StaffResultDto } from '../dto/finance-application.dto';

export interface PreviewResult {
  text: string; values: PrecheckValues; missingFields: PrecheckField[];
  missingRequiredSlots: ExternalFinanceDocSlot[]; warnings: string[]; canSend: boolean;
}

  constructor(
    private prisma: PrismaService,
    private numbers: FinanceApplicationNumberService,
    private pii: CustomerPiiService,
    private config: ConfigService,
  ) {}
```
เมธอดใหม่ (วางท้ายคลาส):
```ts
  private baseUrl(): string {
    const base = this.config.get<string>('SHARE_PAGE_BASE_URL') || this.config.get<string>('PAYMENT_LINK_BASE_URL') || 'https://bestchoicephone.app';
    return base.replace(/\/+$/, '');
  }
  private piiKey(): string {
    const key = this.config.get<string>('PII_ENCRYPTION_KEY');
    if (!key) throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่า PII_ENCRYPTION_KEY');
    return key;
  }
  private modelLabel(product: { name: string | null; brand: string | null; model: string | null; storage: string | null } | null): string | null {
    if (!product) return null;
    const base = (product.name || `${product.brand ?? ''} ${product.model ?? ''}`).trim();
    if (!base) return null;
    return product.storage && !base.includes(product.storage) ? `${base} ${product.storage}` : base;
  }

  /** ค่า 7 ช่อง + จำนวนไฟล์ — ถอดรหัส PII ของลูกค้าผ่าน CustomerPiiService (ห้ามอ่านคอลัมน์ plaintext ตรง ๆ) */
  private async buildValues(app: Awaited<ReturnType<FinanceApplicationService['get']>>, staffName: string | null, link: string | null): Promise<PrecheckValues> {
    const customer = app.customer ? this.pii.decryptCustomerFields(app.customer as Record<string, unknown>) as typeof app.customer : null;
    return {
      customerName: customer?.name ?? null,
      occupation: app.occupationOverride ?? customer?.occupation ?? null,
      model: this.modelLabel(app.product),
      hand: app.product ? renderHand(app.product.category) : null,
      imei: app.product?.imeiSerial ?? null,
      phone: customer?.phone ?? null,
      age: computeAgeYears(customer?.birthDate ?? null),
      staffName,
      fileCount: app.files.length,
      link,
    };
  }

  private async staffName(actor: FinanceActor): Promise<string | null> {
    if (actor.name) return actor.name;
    const user = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } });
    return user?.name ?? null;
  }

  private renderText(app: { messageOverride: string | null }, values: PrecheckValues): string {
    const linkLine = `เอกสารทั้งหมด ${values.fileCount} ไฟล์: ${values.link ?? '{{link}}'}`;
    if (app.messageOverride?.trim()) return `${app.messageOverride.trim()}\n${linkLine}`;
    return buildPrecheckMessage(DEFAULT_PRECHECK_TEMPLATE, values);
  }

  private readiness(app: Awaited<ReturnType<FinanceApplicationService['get']>>, values: PrecheckValues) {
    const missingFields = precheckMissingFields(values);
    const present = new Set(app.files.map((f) => f.slot));
    const missingRequiredSlots = REQUIRED_SLOTS.filter((slot) => !present.has(slot));
    const warnings: string[] = [];
    if (!present.has('DEVICE_SCREEN')) warnings.push('ยังไม่มีรูปหน้าจอตั้งค่าเครื่อง — ส่งได้ แต่ GFIN อาจขอเพิ่ม');
    if (!present.has('DEVICE_PHOTO')) warnings.push('ยังไม่มีรูปเครื่อง 6 มุม');
    if (app.product && !['IN_STOCK', 'RESERVED'].includes(app.product.status)) warnings.push('สถานะเครื่องเปลี่ยนไปจากตอนเลือก — ตรวจสต๊อกก่อนส่ง');
    const blockers = [
      ...(!app.customerId ? ['ยังไม่ผูกลูกค้า'] : []),
      ...(!app.productId ? ['ยังไม่เลือกเครื่อง'] : []),
      ...missingFields.map((f) => `ข้อมูลไม่ครบ: ${PRECHECK_FIELD_LABELS[f]}`),
      ...missingRequiredSlots.map((s) => `ยังไม่มีไฟล์ช่อง "${SLOT_LABELS[s]}"`),
    ];
    return { missingFields, missingRequiredSlots, warnings, blockers, canSend: blockers.length === 0 };
  }

  async preview(id: string, actor: FinanceActor): Promise<PreviewResult> {
    const app = await this.get(id, actor);
    const values = await this.buildValues(app, await this.staffName(actor), null);
    const r = this.readiness(app, values);
    return { text: this.renderText(app, values), values, missingFields: r.missingFields, missingRequiredSlots: r.missingRequiredSlots, warnings: r.warnings, canSend: r.canSend };
  }

  async send(id: string, dto: SendFinanceApplicationDto, actor: FinanceActor) {
    if (dto.via === 'BOT') throw new NotImplementedException('ส่งด้วยบอทจะเปิดใน PR 2 — ใช้ "คัดลอกข้อความ + ลิงก์" ไปก่อน');
    const app = await this.get(id, actor);
    const values = await this.buildValues(app, await this.staffName(actor), null);
    const r = this.readiness(app, values);
    if (!r.canSend) throw new BadRequestException(`ยังส่งไม่ได้: ${r.blockers.join(' · ')}`);
    const nextStatus = applyTransition(app.status, 'SEND');
    const token = newShareToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SHARE_TTL_DAYS * 86400000);
    const shareUrl = `${this.baseUrl()}/api/g/${token.raw}`;
    const messageText = this.renderText(app, { ...values, link: shareUrl });
    const summary = { customerName: values.customerName, occupation: values.occupation, model: values.model, hand: values.hand, imei: values.imei, phone: values.phone, age: values.age, fileCount: values.fileCount };
    const application = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.externalFinanceApplication.update({
        where: { id: app.id },
        data: {
          status: nextStatus, sentAt: now, sentById: actor.id, sentVia: dto.via, messageText, summary,
          shareTokenHash: token.hash, shareTokenEnc: encryptPII(token.raw, this.piiKey()), shareExpiresAt: expiresAt, shareRevokedAt: null,
        },
        include: applicationInclude,
      });
      await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id, deletedAt: null, sentAt: null }, data: { sentAt: now } });
      await this.addEvent(tx, app.id, 'SENT', 'STAFF', { actorUserId: actor.id, meta: { via: dto.via, fileCount: values.fileCount } });
      return updated;
    });
    return { application, messageText, shareUrl };
  }

  async getShareLink(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    if (!app.shareTokenEnc) throw new NotFoundException('ใบยื่นนี้ยังไม่ได้ส่ง จึงยังไม่มีลิงก์');
    return { url: `${this.baseUrl()}/api/g/${decryptPII(app.shareTokenEnc, this.piiKey())}`, expiresAt: app.shareExpiresAt, revokedAt: app.shareRevokedAt };
  }

  /** ส่งเพิ่มเฉพาะไฟล์ที่ยังไม่เคยส่ง — ลิงก์เดิม ต่ออายุเป็น 7 วันนับจากวันนี้ (spec §5.1) */
  async resend(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    const nextStatus = applyTransition(app.status, 'RESEND');
    const pending = app.files.filter((f) => !f.sentAt);
    if (!pending.length) throw new BadRequestException('ไม่มีไฟล์ใหม่ให้ส่งเพิ่ม');
    const { url } = await this.getShareLink(id, actor);
    const now = new Date();
    const messageText = `ส่งเอกสารเพิ่ม ${pending.length} ไฟล์ (ใบยื่น ${app.number}) ลิงก์เดิม: ${url}`;
    const application = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.externalFinanceApplication.update({
        where: { id: app.id },
        data: { status: nextStatus, shareExpiresAt: new Date(now.getTime() + SHARE_TTL_DAYS * 86400000), shareRevokedAt: null },
        include: applicationInclude,
      });
      await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id, deletedAt: null, sentAt: null }, data: { sentAt: now } });
      await this.addEvent(tx, app.id, 'RESENT', 'STAFF', { actorUserId: actor.id, meta: { fileCount: pending.length } });
      return updated;
    });
    return { application, messageText, shareUrl: url };
  }

  async extendShare(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    if (!app.shareTokenHash) throw new NotFoundException('ยังไม่มีลิงก์');
    const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86400000);
    await this.prisma.$transaction(async (tx) => {
      await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { shareExpiresAt: expiresAt, shareRevokedAt: null } });
      await this.addEvent(tx, app.id, 'LINK_EXTENDED', 'STAFF', { actorUserId: actor.id, meta: { expiresAt: expiresAt.toISOString() } });
    });
    return { expiresAt };
  }

  async revokeShare(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    if (!app.shareTokenHash) throw new NotFoundException('ยังไม่มีลิงก์');
    await this.prisma.$transaction(async (tx) => {
      await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { shareRevokedAt: new Date() } });
      await this.addEvent(tx, app.id, 'LINK_REVOKED', 'STAFF', { actorUserId: actor.id });
    });
    return { success: true };
  }

  async staffResult(id: string, dto: StaffResultDto, actor: FinanceActor) {
    const app = await this.get(id, actor);
    const event = dto.result === 'APPROVED' ? 'STAFF_APPROVED' : dto.result === 'REJECTED' ? 'STAFF_REJECTED' : 'STAFF_MORE_INFO';
    const nextStatus = applyTransition(app.status, event);
    const closes = nextStatus === 'APPROVED' || nextStatus === 'REJECTED';
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.externalFinanceApplication.update({
        where: { id: app.id },
        data: { status: nextStatus, resultSource: 'STAFF', closedAt: closes ? new Date() : null },
        include: applicationInclude,
      });
      await this.addEvent(tx, app.id, 'STAFF_RESULT', 'STAFF', { actorUserId: actor.id, note: dto.note ?? null, meta: { result: dto.result } });
      return updated;
    });
  }

  async cancel(id: string, actor: FinanceActor) {
    const app = await this.get(id, actor);
    const nextStatus = applyTransition(app.status, 'CANCEL');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.externalFinanceApplication.update({
        where: { id: app.id },
        data: { status: nextStatus, closedAt: new Date(), shareRevokedAt: app.shareTokenHash ? new Date() : null },
        include: applicationInclude,
      });
      await this.addEvent(tx, app.id, 'CANCELLED', 'STAFF', { actorUserId: actor.id });
      return updated;
    });
  }
```
(เพิ่ม `PRECHECK_FIELD_LABELS` ใน import จาก `@installment/shared` และ `ServiceUnavailableException` จาก `@nestjs/common` · `applicationInclude.customer.select` ต้องมี `phoneEncrypted`, `occupation`, `birthDate`, `name`, `nameEncrypted` ตามที่ `decryptCustomerFields` ต้องการ — เปิด `customer-pii.service.ts:247-296` ดูชื่อคอลัมน์ encrypted ที่มันอ่าน แล้วเติมใน select ให้ครบ)

- [ ] **Step 5: route ใน `finance-applications.controller.ts`**

```ts
  @Get(':id/message-preview')
  preview(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) { return this.applications.preview(id, req.user); }

  @Post(':id/send')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendFinanceApplicationDto, @Req() req: { user: FinanceActor }) { return this.applications.send(id, dto, req.user); }

  @Post(':id/resend')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  resend(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) { return this.applications.resend(id, req.user); }

  @Get(':id/share-link')
  shareLink(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) { return this.applications.getShareLink(id, req.user); }

  @Post(':id/share/extend')
  extend(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) { return this.applications.extendShare(id, req.user); }

  @Post(':id/share/revoke')
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) { return this.applications.revokeShare(id, req.user); }

  @Post(':id/result')
  result(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffResultDto, @Req() req: { user: FinanceActor }) { return this.applications.staffResult(id, dto, req.user); }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: { user: FinanceActor }) { return this.applications.cancel(id, req.user); }
```
`req.user` มี `name` ไหม — เปิด `jwt.strategy.ts` (`apps/api/src/modules/auth/`) ดู `validate()` ว่าคืน `name` หรือไม่ ถ้าไม่ `staffName()` จะ query จาก DB ให้อยู่แล้ว

- [ ] **Step 6: รันเทสต์ทั้งโมดูล + type-check**

Run: `cd apps/api && npx jest src/modules/external-finance-application --runInBand && cd ../.. && ./tools/check-types.sh api`
Expected: PASS · 0 errors

- [ ] **Step 7: DB spec ต่อเติม — ส่งจริงแล้วอ่านลิงก์กลับได้**

```ts
  it('send(COPY) persists a hash + encrypted token, and getShareLink returns the same url', async () => {
    // เตรียมลูกค้า+เครื่อง: ใช้ prisma.customer.create / prisma.product.create ด้วยฟิลด์ขั้นต่ำที่ schema บังคับ (ดู seed-demo-products.ts เป็นแบบ) แล้ว service.update(app.id, { customerId, productId }, actor)
    // แนบไฟล์ 3 ช่องบังคับด้วย files.upload(app.id, slot, { buffer: JPEG_BYTES, mimetype: 'image/jpeg', originalname: 'a.jpg' } as any, actor)
    const sent = await service.send(app.id, { via: 'COPY' }, actor);
    const link = await service.getShareLink(app.id, actor);
    expect(link.url).toBe(sent.shareUrl);
    const row = await prisma.externalFinanceApplication.findUnique({ where: { id: app.id } });
    expect(row?.shareTokenHash).toHaveLength(64);
    expect(row?.shareTokenEnc).not.toContain(sent.shareUrl.split('/').pop());
    expect(row?.status).toBe('SENT');
  });
```
(ต้องตั้ง `PII_ENCRYPTION_KEY` เป็น hex 64 ตัวใน env ตอนรัน spec — เหมือน CI · `ConfigService` stub ใน DB spec: `{ get: (k) => process.env[k] }`)

Run: `cd apps/api && DATABASE_URL=<test_db> PII_ENCRYPTION_KEY=<hex64> npx jest .../finance-application-flow.db.spec.ts --runInBand` → Expected: PASS 3

- [ ] **Step 8: อัปเดตสเปก (deviation) + commit**

แก้ `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md`: §12 บรรทัด "ไม่เก็บโทเคนดิบ" → "โทเคนดิบเก็บเข้ารหัส `encryptPII` ใน `shareTokenEnc` เพื่อให้พนักงานเปิด/ส่งลิงก์เดิมได้ · หน้าลิงก์ค้นด้วย hash เท่านั้น" และ §4.1 เพิ่มแถว `shareTokenEnc`
```bash
git add apps/api/src/modules/external-finance-application docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md
git commit -m "feat(gfin): ร่างข้อความ 12 ข้อ, ส่งแบบคัดลอก, ลิงก์ชุดเช็ค (hash + โทเคนเข้ารหัส), ส่งเพิ่ม, ผล, ยกเลิก"
```

---

### Task 6: หน้าลิงก์สาธารณะ `/api/g/:token` — HTML จาก API, ไฟล์, zip, ปุ่มตอบกลับของ GFIN, บันทึกการเปิด

**Files:**
- Create: `apps/api/src/modules/external-finance-application/services/finance-share.service.ts`
- Create: `apps/api/src/modules/external-finance-application/services/finance-share-page.util.ts`
- Create: `apps/api/src/modules/external-finance-application/finance-share-public.controller.ts`
- Create: `apps/api/src/modules/external-finance-application/dto/finance-share-reply.dto.ts`
- Modify: `apps/api/src/modules/external-finance-application/external-finance-application.module.ts` (ลงทะเบียน controller + service)
- Modify: `apps/api/package.json` (เพิ่ม `archiver` + `@types/archiver`)
- Test: `__tests__/finance-share-page.util.spec.ts` · `__tests__/finance-share.service.spec.ts` · ต่อเติม `__tests__/finance-application-flow.db.spec.ts`

**Interfaces:**
- Consumes: `hashShareToken(raw)` (Task 5) · `applyTransition` (Task 3) · `SLOT_LABELS`/`SLOT_ORDER` (Task 3) · `StorageService.getStream(key)` · `escapeHtml` จาก `../../shop-catalog/share-page.util` (มีอยู่แล้ว `shop-catalog/share-page.util.ts:22`) · `FinanceApplicationNotifyService.partnerReplied(applicationId)` (Task 7 — ใน Task นี้ inject เป็น `@Optional()` และเรียกเมื่อมี)
- Produces:
  - `FinanceShareService.resolve(rawToken): Promise<ShareResolution>` โดย `ShareResolution = { state: 'OK'; app: ShareApp } | { state: 'GONE'; reason: 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'PURGED' }` — **ไม่ throw** เพื่อให้ controller เลือกหน้า 410 เอง
  - `.recordView(appId, ipHash, userAgent)` (dedupe 5 นาทีต่อ ipHash) · `.fileStream(rawToken, fileId)` · `.zipStream(rawToken): Promise<{ filename: string; archive: archiver.Archiver }>` · `.reply(rawToken, dto, ipHash)`
  - `buildFinanceSharePage(input: SharePageInput): string` · `buildGonePage(nonce): string` (HTML string ทั้งคู่)
  - route (public, ไม่มี guard): `GET /api/g/:token` (HTML) · `GET /api/g/:token/files/:fileId` · `GET /api/g/:token/zip` · `POST /api/g/:token/reply` (`@SkipCsrf()` + throttle)
  - `ipHash(req)` = sha256(ip + วันตาม BKK) — ไม่เก็บ IP ดิบ

- [ ] **Step 1: เพิ่ม dependency**

```bash
cd apps/api && npm install archiver@^5.3.2 && npm install -D @types/archiver@^5.3.4
```
(root มี `archiver@5.3.2` ผ่าน exceljs อยู่แล้ว — ประกาศ dependency ตรงใน apps/api เพื่อไม่พึ่ง hoisting ของ exceljs; Docker build ของ api ติดตั้งจาก `apps/api/package.json`)

- [ ] **Step 2: เทสต์ HTML builder ล้มก่อน**

`__tests__/finance-share-page.util.spec.ts`:
```ts
import { buildFinanceSharePage, buildGonePage } from '../services/finance-share-page.util';

const base = {
  nonce: 'abc',
  number: 'BC-260924-001',
  status: 'SENT' as const,
  expiresAt: new Date('2026-10-01T10:00:00+07:00'),
  messageText: '1.ชื่อลูกค้า : สมหญิง <ใจดี>\n2.อาชีพ : พนักงาน',
  groups: [
    { slot: 'ID_CARD' as const, label: 'บัตรประชาชน', files: [{ id: 'f1', mimeType: 'image/jpeg', size: 1234, originalName: 'บัตร.jpg', url: '/api/g/tok/files/f1' }] },
    { slot: 'DEVICE_PHOTO' as const, label: 'รูปเครื่อง 6 มุม', files: [] },
  ],
  zipUrl: '/api/g/tok/zip',
  replyUrl: '/api/g/tok/reply',
  fileCount: 1,
  lineGroupName: 'GFIN : BESTCHOICE (67301219)',
};

describe('buildFinanceSharePage', () => {
  it('escapes user text, uses the nonce on every inline script/style, and never leaks the token into OG tags', () => {
    const html = buildFinanceSharePage(base);
    expect(html).toContain('สมหญิง &lt;ใจดี&gt;');
    expect(html).not.toContain('<ใจดี>');
    expect(html).toMatch(/<meta property="og:title" content="BESTCHOICE — ชุดเช็คเครดิต"/);
    expect(html).not.toMatch(/og:.*tok/);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    const scripts = html.match(/<script/g) ?? [];
    const noncedScripts = html.match(/<script nonce="abc"/g) ?? [];
    expect(scripts.length).toBe(noncedScripts.length);
    expect(html).toContain('viewport');
    expect(html).toContain('id="lightbox"');
    expect(html).toContain('fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai');
  });
  it('renders the 4 reply choices + name field + D7 disclaimer only for an open application, and the result banner when closed', () => {
    const html = buildFinanceSharePage(base);
    for (const a of ['ACK', 'MORE_INFO', 'APPROVED', 'REJECTED']) expect(html).toContain(`data-reply="${a}"`);
    expect(html).toContain('id="name"');
    expect(html).toContain('ไม่ใช่การอนุมัติทางการ');
    const closed = buildFinanceSharePage({ ...base, status: 'APPROVED' });
    expect(closed).not.toContain('data-reply="APPROVED"');
    expect(closed).toContain('ผ่าน (แจ้งผ่านลิงก์)');
  });
  it('hides empty groups and shows the file count in the download button', () => {
    const html = buildFinanceSharePage(base);
    expect(html).not.toContain('รูปเครื่อง 6 มุม');
    expect(html).toContain('ดาวน์โหลดทั้งหมด (1 ไฟล์)');
  });
  it('gone page carries no customer data and points to the LINE group', () => {
    const html = buildGonePage('abc');
    expect(html).toContain('ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว');
    expect(html).toContain('GFIN : BESTCHOICE');
    expect(html).not.toContain('BC-');
  });
});
```
Run: `cd apps/api && npx jest src/modules/external-finance-application/__tests__/finance-share-page.util.spec.ts --runInBand` → Expected: FAIL (module not found)

- [ ] **Step 3: HTML builder**

`services/finance-share-page.util.ts` (ทำตาม mockup v6 กระดาน "หน้าลิงก์" — สีจาก token ของเว็บ: primary `#0B7A55`, bg `#F9F8F6`, card `#FDFCFB`, border `#E4E1DD`, text `#231E1A`, muted `#746A63`, warning `#935F06`, destructive `#D31212` — ไฟล์นี้เป็น HTML ที่ API เสิร์ฟให้คนนอก ไม่ใช่ React จึงใช้ hex ตรงได้):
```ts
import { escapeHtml } from '../../shop-catalog/share-page.util';
import type { ExternalFinanceApplicationStatus, ExternalFinanceDocSlot } from '@prisma/client';

export interface SharePageFile { id: string; mimeType: string; size: number; originalName: string | null; url: string }
export interface SharePageGroup { slot: ExternalFinanceDocSlot; label: string; files: SharePageFile[] }
export interface SharePageInput {
  nonce: string; number: string; status: ExternalFinanceApplicationStatus; expiresAt: Date;
  messageText: string; groups: SharePageGroup[]; zipUrl: string; replyUrl: string; fileCount: number; lineGroupName: string;
}

export const LINE_GROUP_NAME = 'GFIN : BESTCHOICE (67301219)';
const OPEN_FOR_REPLY: ExternalFinanceApplicationStatus[] = ['SENT', 'ACKNOWLEDGED', 'MORE_INFO'];
const RESULT_LABEL: Partial<Record<ExternalFinanceApplicationStatus, string>> = {
  APPROVED: 'ผ่าน (แจ้งผ่านลิงก์)', REJECTED: 'ไม่ผ่าน', CANCELLED: 'ร้านยกเลิกใบยื่นนี้แล้ว',
};

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtThaiDate = (d: Date) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

const CSS = `
:root{--p:#0B7A55;--bg:#F9F8F6;--card:#FDFCFB;--bd:#E4E1DD;--tx:#231E1A;--mu:#746A63;--wn:#935F06;--ds:#D31212}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 "IBM Plex Sans Thai",Inter,system-ui,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:16px}header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0}
.brand{font-weight:800;color:var(--p);letter-spacing:.02em}.badge{font-size:13px;padding:4px 10px;border-radius:999px;border:1px solid var(--bd);background:var(--card)}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px;margin:12px 0}
pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0}h2{font-size:15px;margin:0 0 8px;color:var(--mu);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.thumb{display:block;border:1px solid var(--bd);border-radius:10px;overflow:hidden;background:#fff;color:inherit;text-decoration:none}
.thumb img{display:block;width:100%;aspect-ratio:1;object-fit:cover}.thumb .cap{font-size:12px;padding:6px 8px;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pdf{display:flex;align-items:center;justify-content:center;aspect-ratio:1;font-weight:700;color:var(--ds)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--bd);background:var(--card);color:var(--tx);font-weight:600;text-decoration:none;cursor:pointer;font-size:15px}
.btn.primary{background:var(--p);color:#fff;border-color:var(--p)}.btn.danger{color:var(--ds);border-color:var(--ds)}.btn.warn{color:var(--wn);border-color:var(--wn)}
.btn:disabled{opacity:.5;cursor:default}.actions{display:grid;gap:10px;grid-template-columns:1fr}@media(min-width:480px){.actions{grid-template-columns:1fr 1fr 1fr}}
.note{font-size:13px;color:var(--mu)}.banner{padding:12px 14px;border-radius:12px;background:#E6F4EE;color:var(--p);font-weight:700}.banner.bad{background:#FCE8E8;color:var(--ds)}.banner.warn{background:#FBF1DC;color:var(--wn)}
textarea{width:100%;min-height:72px;border:1px solid var(--bd);border-radius:10px;padding:10px;font:inherit}footer{padding:24px 0;font-size:13px;color:var(--mu)}
.sr{position:absolute;left:-9999px}
.lb{position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:50}.lb[hidden]{display:none}.lb img{max-width:96vw;max-height:84vh;object-fit:contain}
.lb button{position:absolute;min-width:44px;min-height:44px;border:0;background:rgba(255,255,255,.15);color:#fff;font-size:22px;border-radius:12px;cursor:pointer}.lb-close{top:12px;right:12px}.lb-prev{left:8px;top:50%;transform:translateY(-50%)}.lb-next{right:8px;top:50%;transform:translateY(-50%)}.lb-cap{position:absolute;bottom:14px;left:0;right:0;text-align:center;color:#fff;font-size:13px}
`;

function fileTile(file: SharePageFile): string {
  const name = escapeHtml(file.originalName ?? 'ไฟล์');
  const isImage = file.mimeType.startsWith('image/');
  const body = isImage
    ? `<img src="${escapeHtml(file.url)}" alt="${name}" loading="lazy">`
    : `<div class="pdf" aria-hidden="true">PDF</div>`;
  // รูป → เปิด lightbox (data-lb) · PDF → เปิดแท็บใหม่
  return `<a class="thumb" href="${escapeHtml(file.url)}" ${isImage ? 'data-lb="1"' : 'target="_blank" rel="noopener"'}>${body}<div class="cap">${name} · ${fmtBytes(file.size)}</div></a>`;
}

export function buildFinanceSharePage(input: SharePageInput): string {
  const open = OPEN_FOR_REPLY.includes(input.status);
  const groups = input.groups.filter((g) => g.files.length > 0)
    .map((g) => `<section class="card"><h2>${escapeHtml(g.label)} (${g.files.length})</h2><div class="grid">${g.files.map(fileTile).join('')}</div></section>`)
    .join('');
  const result = RESULT_LABEL[input.status];
  const banner = result
    ? `<div class="banner ${input.status === 'APPROVED' ? '' : input.status === 'CANCELLED' ? 'warn' : 'bad'}">ผลล่าสุด: ${escapeHtml(result)}</div>`
    : input.status === 'MORE_INFO' ? `<div class="banner warn">แจ้งขอเอกสารเพิ่มแล้ว — ร้านจะส่งเพิ่มในลิงก์นี้</div>` : '';
  const replyBlock = open ? `
<section class="card" id="reply">
  <h2>ตอบกลับร้าน</h2>
  <p class="note" style="margin:0 0 8px">กดปุ่มเดียว ร้านเห็นทันทีในระบบ · หรือจะตอบในกลุ่มไลน์ตามเดิมก็ได้ · <strong>ไม่ใช่การอนุมัติทางการ</strong> — สัญญาเกิดเมื่อร้านกรอกฟอร์มในระบบ GFIN</p>
  <div class="actions" role="radiogroup" aria-label="คำตอบ" style="grid-template-columns:1fr 1fr">
    <button class="btn" type="button" role="radio" aria-checked="false" data-reply="ACK">รับเรื่องแล้ว</button>
    <button class="btn warn" type="button" role="radio" aria-checked="false" data-reply="MORE_INFO">ขอเอกสารเพิ่ม</button>
    <button class="btn primary" type="button" role="radio" aria-checked="false" data-reply="APPROVED">อนุมัติ</button>
    <button class="btn danger" type="button" role="radio" aria-checked="false" data-reply="REJECTED">ไม่อนุมัติ</button>
  </div>
  <label class="note" for="note" style="display:block;margin-top:10px">ข้อความถึงร้าน (ถ้ามี)</label>
  <textarea id="note" maxlength="500" placeholder="เช่น ขอสลิปเงินเดือนเดือนล่าสุด"></textarea>
  <label class="note" for="name" style="display:block;margin-top:8px">ชื่อผู้ตอบ</label>
  <input id="name" maxlength="80" placeholder="เช่น คุณเอ" style="width:100%;min-height:44px;border:1px solid var(--bd);border-radius:10px;padding:0 10px;font:inherit">
  <button class="btn primary" type="button" id="reply-submit" style="width:100%;margin-top:10px" disabled>ส่งคำตอบ</button>
  <p class="note" id="reply-status" role="status" aria-live="polite"></p>
</section>` : '';
  const script = `
(function(){var lb=document.getElementById('lightbox');var img=lb.querySelector('img');var cap=lb.querySelector('.lb-cap');var items=Array.prototype.slice.call(document.querySelectorAll('a[data-lb]'));var i=-1;
function show(n){if(n<0||n>=items.length)return;i=n;img.src=items[n].getAttribute('href');cap.textContent=(n+1)+' / '+items.length+' · '+items[n].querySelector('.cap').textContent;lb.hidden=false;document.body.style.overflow='hidden'}
function hide(){lb.hidden=true;img.src='';document.body.style.overflow=''}
items.forEach(function(a,n){a.addEventListener('click',function(e){e.preventDefault();show(n)})});
lb.querySelector('.lb-prev').addEventListener('click',function(){show(i-1)});lb.querySelector('.lb-next').addEventListener('click',function(){show(i+1)});lb.querySelector('.lb-close').addEventListener('click',hide);
document.addEventListener('keydown',function(e){if(lb.hidden)return;if(e.key==='Escape')hide();if(e.key==='ArrowLeft')show(i-1);if(e.key==='ArrowRight')show(i+1)});
var sx=0;lb.addEventListener('touchstart',function(e){sx=e.touches[0].clientX},{passive:true});lb.addEventListener('touchend',function(e){var dx=e.changedTouches[0].clientX-sx;if(dx>40)show(i-1);if(dx<-40)show(i+1)});
var copy=document.getElementById('copy-text');if(copy){copy.addEventListener('click',function(){var t=document.getElementById('message-text').textContent;navigator.clipboard.writeText(t).then(function(){copy.textContent='คัดลอกแล้ว'})})}
var b=document.querySelectorAll('[data-reply]');var s=document.getElementById('reply-status');var submit=document.getElementById('reply-submit');var name=document.getElementById('name');var busy=false;var chosen=null;
function set(t,bad){if(s){s.textContent=t;s.style.color=bad?'#D31212':'#0B7A55'}}
function ready(){if(submit)submit.disabled=!(chosen&&name&&name.value.trim())}
b.forEach(function(el){el.addEventListener('click',function(){chosen=el.getAttribute('data-reply');b.forEach(function(x){x.setAttribute('aria-checked',x===el?'true':'false');x.style.outline=x===el?'3px solid rgba(11,122,85,.35)':''});ready()})});
if(name)name.addEventListener('input',ready);
if(submit)submit.addEventListener('click',function(){if(busy||!chosen)return;var n=(document.getElementById('note')||{}).value||'';busy=true;submit.disabled=true;
fetch(${JSON.stringify(input.replyUrl)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:chosen,name:name.value.trim(),note:n})})
.then(function(res){return res.json().then(function(j){return{ok:res.ok,j:j}})})
.then(function(x){if(x.ok){set('บันทึกแล้ว ร้านได้รับแจ้งทันที');setTimeout(function(){location.reload()},800)}else{set((x.j&&x.j.message)||'บันทึกไม่สำเร็จ ลองใหม่',true);busy=false;ready()}})
.catch(function(){set('เครือข่ายขัดข้อง ลองใหม่',true);busy=false;ready()})})})();`;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<meta property="og:title" content="BESTCHOICE — ชุดเช็คเครดิต"><meta property="og:description" content="เอกสารเช็คเครดิตจากร้าน BESTCHOICE (ลิงก์มีวันหมดอายุ)"><meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap">
<title>ชุดเช็คเครดิต ${escapeHtml(input.number)} — BESTCHOICE</title><style nonce="${input.nonce}">${CSS}</style></head>
<body><div class="wrap">
<header><div class="brand">BESTCHOICE</div><div class="badge">ใบยื่น ${escapeHtml(input.number)} · ลิงก์ถึง ${escapeHtml(fmtThaiDate(input.expiresAt))}</div></header>
${banner}
<section class="card"><h2>ข้อมูลลูกค้า (12 ข้อ)</h2><pre id="message-text">${escapeHtml(input.messageText)}</pre><button class="btn" type="button" id="copy-text" style="margin-top:10px">คัดลอกข้อมูล</button></section>
<div class="actions" style="grid-template-columns:1fr"><a class="btn" href="${escapeHtml(input.zipUrl)}">ดาวน์โหลดทั้งหมด (${input.fileCount} ไฟล์)</a></div>
${groups}
${replyBlock}
<div id="lightbox" class="lb" hidden role="dialog" aria-label="ดูรูปเต็มจอ"><button type="button" class="lb-close" aria-label="ปิด">✕</button><button type="button" class="lb-prev" aria-label="รูปก่อนหน้า">‹</button><img alt=""><button type="button" class="lb-next" aria-label="รูปถัดไป">›</button><div class="lb-cap"></div></div>
<footer>ติดต่อร้านผ่านกลุ่มไลน์ <strong>${escapeHtml(input.lineGroupName)}</strong> · หน้านี้ไม่มีข้อมูลบัตรในรูปแบบข้อความนอกจากที่ร้านพิมพ์ · ไฟล์ถูกลบอัตโนมัติ 90 วันหลังปิดใบยื่น</footer>
</div><script nonce="${input.nonce}">${script}</script></body></html>`;
}

export function buildGonePage(nonce: string): string {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>ลิงก์หมดอายุ — BESTCHOICE</title><style nonce="${nonce}">${CSS}</style></head>
<body><div class="wrap"><header><div class="brand">BESTCHOICE</div></header>
<section class="card"><h2>ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว</h2><p class="note" style="margin:0">ขอลิงก์ใหม่จากร้านได้ในกลุ่มไลน์ <strong>${escapeHtml(LINE_GROUP_NAME)}</strong></p></section>
</div></body></html>`;
}
```
Run เทสต์ Step 2 → Expected: PASS 4

- [ ] **Step 4: DTO ตอบกลับ**

`dto/finance-share-reply.dto.ts`:
```ts
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const PARTNER_REPLY_ACTIONS = ['ACK', 'MORE_INFO', 'APPROVED', 'REJECTED'] as const;
export type PartnerReplyAction = (typeof PARTNER_REPLY_ACTIONS)[number];

/** spec §5.2: `{action, name (บังคับ ≤80), note (≤500)}` — ชื่อผู้ตอบไปโผล่ในไทม์ไลน์ของร้าน ("คุณเอ (GFIN)") */
export class FinanceShareReplyDto {
  @IsIn(PARTNER_REPLY_ACTIONS, { message: 'คำตอบไม่ถูกต้อง' })
  action!: PartnerReplyAction;

  @IsString() @MinLength(1, { message: 'กรุณาใส่ชื่อผู้ตอบ' }) @MaxLength(80, { message: 'ชื่อยาวเกิน 80 ตัวอักษร' })
  name!: string;

  @IsOptional() @IsString() @MaxLength(500, { message: 'หมายเหตุยาวเกิน 500 ตัวอักษร' })
  note?: string;
}
```

- [ ] **Step 5: เทสต์ service ล้มก่อน**

`__tests__/finance-share.service.spec.ts`:
```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FinanceShareService } from '../services/finance-share.service';
import { hashShareToken } from '../finance-share-token.util';

const raw = 'a'.repeat(43);
const future = new Date(Date.now() + 86400000);
const past = new Date(Date.now() - 1000);
const app = (over: Record<string, unknown> = {}) => ({
  id: 'app-1', number: 'BC-260924-001', status: 'SENT', shareTokenHash: hashShareToken(raw), shareExpiresAt: future, shareRevokedAt: null, filesPurgedAt: null,
  messageText: 'ข้อความ', shareViewCount: 0, shareLastViewedAt: null,
  files: [{ id: 'f1', slot: 'ID_CARD', mimeType: 'image/jpeg', size: 10, originalName: 'a.jpg', storageKey: 'k1', sortOrder: 0 }],
  events: [], ...over,
});
function makePrisma(row: any) {
  const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...row, ...data }));
  return {
    externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(row), update },
    externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: (fn: any) => fn({ externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(row), update }, externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}) } }),
  } as any;
}
const storage = { getStream: jest.fn().mockResolvedValue({ pipe: jest.fn() }) } as any;
const notify = { partnerReplied: jest.fn().mockResolvedValue(undefined) } as any;

describe('FinanceShareService.resolve', () => {
  it('returns OK for a live token and the same GONE shape for unknown / expired / revoked / purged', async () => {
    expect((await new FinanceShareService(makePrisma(app()), storage, notify).resolve(raw)).state).toBe('OK');
    expect(await new FinanceShareService(makePrisma(null), storage, notify).resolve('x')).toEqual({ state: 'GONE', reason: 'NOT_FOUND' });
    expect(await new FinanceShareService(makePrisma(app({ shareExpiresAt: past })), storage, notify).resolve(raw)).toEqual({ state: 'GONE', reason: 'EXPIRED' });
    expect(await new FinanceShareService(makePrisma(app({ shareRevokedAt: past })), storage, notify).resolve(raw)).toEqual({ state: 'GONE', reason: 'REVOKED' });
    expect(await new FinanceShareService(makePrisma(app({ filesPurgedAt: past })), storage, notify).resolve(raw)).toEqual({ state: 'GONE', reason: 'PURGED' });
  });
  it('looks up by sha256 hash only — never by the raw token', async () => {
    const prisma = makePrisma(app());
    await new FinanceShareService(prisma, storage, notify).resolve(raw);
    const where = prisma.externalFinanceApplication.findFirst.mock.calls[0][0].where;
    expect(where.shareTokenHash).toBe(hashShareToken(raw));
    expect(JSON.stringify(where)).not.toContain(raw);
  });
});

describe('FinanceShareService.recordView', () => {
  it('counts a view once per ipHash within 5 minutes and stamps the application', async () => {
    const prisma = makePrisma(app());
    const service = new FinanceShareService(prisma, storage, notify);
    await service.recordView('app-1', 'iphash', 'Mozilla');
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'LINK_VIEWED', actorType: 'PARTNER' }) }));
    expect(prisma.externalFinanceApplication.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shareViewCount: { increment: 1 } }) }));
    prisma.externalFinanceApplicationEvent.findFirst.mockResolvedValueOnce({ id: 'e1' });
    await service.recordView('app-1', 'iphash', 'Mozilla');
    expect(prisma.externalFinanceApplicationEvent.create).toHaveBeenCalledTimes(1);
  });
});

describe('FinanceShareService.reply', () => {
  it('APPROVED moves SENT → APPROVED with resultSource PARTNER_LINK, closes, and notifies staff', async () => {
    const prisma = makePrisma(app());
    const service = new FinanceShareService(prisma, storage, notify);
    const result = await service.reply(raw, { action: 'APPROVED', name: 'คุณเอ', note: 'ok' }, 'iphash');
    expect(result.status).toBe('APPROVED');
    const data = prisma.externalFinanceApplication.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'APPROVED', resultSource: 'PARTNER_LINK' });
    expect(data.closedAt).toBeInstanceOf(Date);
    expect(notify.partnerReplied).toHaveBeenCalledWith('app-1');
  });
  it('ACK moves SENT → ACKNOWLEDGED and stores the replier name; a second ACK only logs an event', async () => {
    const prisma = makePrisma(app());
    const service = new FinanceShareService(prisma, storage, notify);
    await service.reply(raw, { action: 'ACK', name: 'คุณเอ' }, 'h');
    expect(prisma.externalFinanceApplication.update.mock.calls[0][0].data.status).toBe('ACKNOWLEDGED');
    const acked = makePrisma(app({ status: 'ACKNOWLEDGED' }));
    await new FinanceShareService(acked, storage, notify).reply(raw, { action: 'ACK', name: 'คุณเอ' }, 'h');
    expect(acked.externalFinanceApplication.update.mock.calls[0][0].data.status).toBe('ACKNOWLEDGED');
  });
  it('rejects a reply on a closed application with 409 and does not change anything', async () => {
    const prisma = makePrisma(app({ status: 'APPROVED' }));
    await expect(new FinanceShareService(prisma, storage, notify).reply(raw, { action: 'REJECTED', name: 'x' }, 'iphash')).rejects.toThrow(ConflictException);
    expect(prisma.externalFinanceApplication.update).not.toHaveBeenCalled();
  });
  it('reply on an expired link is 404-equivalent (GONE) — same message as unknown token', async () => {
    await expect(new FinanceShareService(makePrisma(app({ shareExpiresAt: past })), storage, notify).reply(raw, { action: 'APPROVED', name: 'x' }, 'h')).rejects.toThrow(NotFoundException);
  });
});

describe('FinanceShareService.fileStream / zipStream', () => {
  it('streams only files that belong to the resolved application', async () => {
    const service = new FinanceShareService(makePrisma(app()), storage, notify);
    await expect(service.fileStream(raw, 'f1')).resolves.toMatchObject({ file: expect.objectContaining({ id: 'f1' }) });
    await expect(service.fileStream(raw, 'other')).rejects.toThrow(NotFoundException);
  });
  it('zip filename uses the application number and names entries NN-<ป้ายช่อง>.<ext> (spec §5.2)', async () => {
    const service = new FinanceShareService(makePrisma(app()), storage, notify);
    const zip = await service.zipStream(raw);
    expect(zip.filename).toBe('BC-260924-001.zip');
    expect(zip.entries).toEqual([{ name: '01-บัตรประชาชน.jpg', storageKey: 'k1' }]);
  });
});
```
Run: `cd apps/api && npx jest src/modules/external-finance-application/__tests__/finance-share.service.spec.ts --runInBand` → Expected: FAIL (module not found)

- [ ] **Step 6: service**

`services/finance-share.service.ts`:
```ts
import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import * as archiver from 'archiver';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { hashShareToken } from '../finance-share-token.util';
import { applyTransition, isClosed } from '../finance-application-status.util';
import { SLOT_LABELS, SLOT_ORDER } from '../constants';
import { FinanceShareReplyDto } from '../dto/finance-share-reply.dto';
import { FinanceApplicationNotifyService } from './finance-application-notify.service';
import type { SharePageGroup } from './finance-share-page.util';

const GONE_MSG = 'ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว';
const VIEW_DEDUPE_MS = 5 * 60 * 1000;
const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };

const shareInclude = { files: { where: { deletedAt: null }, orderBy: [{ slot: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] } } satisfies Prisma.ExternalFinanceApplicationInclude;
export type ShareApp = Prisma.ExternalFinanceApplicationGetPayload<{ include: typeof shareInclude }>;
export type ShareResolution = { state: 'OK'; app: ShareApp } | { state: 'GONE'; reason: 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'PURGED' };

@Injectable()
export class FinanceShareService {
  private readonly logger = new Logger(FinanceShareService.name);
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    @Optional() private notify?: FinanceApplicationNotifyService,
  ) {}

  async resolve(rawToken: string): Promise<ShareResolution> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return { state: 'GONE', reason: 'NOT_FOUND' };
    const app = await this.prisma.externalFinanceApplication.findFirst({
      where: { shareTokenHash: hashShareToken(rawToken), deletedAt: null }, include: shareInclude,
    });
    if (!app) return { state: 'GONE', reason: 'NOT_FOUND' };
    if (app.shareRevokedAt) return { state: 'GONE', reason: 'REVOKED' };
    if (app.filesPurgedAt) return { state: 'GONE', reason: 'PURGED' };
    if (!app.shareExpiresAt || app.shareExpiresAt < new Date()) return { state: 'GONE', reason: 'EXPIRED' };
    return { state: 'OK', app };
  }

  private async resolveOrThrow(rawToken: string): Promise<ShareApp> {
    const r = await this.resolve(rawToken);
    if (r.state !== 'OK') throw new NotFoundException(GONE_MSG);
    return r.app;
  }

  /** จัดกลุ่มไฟล์ตามช่อง (ลำดับ SLOT_ORDER) — ใช้ทั้งหน้า HTML และ zip */
  groups(app: ShareApp, urlFor: (fileId: string) => string): SharePageGroup[] {
    return SLOT_ORDER.map((slot) => ({
      slot, label: SLOT_LABELS[slot],
      files: app.files.filter((f) => f.slot === slot && f.storageKey).map((f) => ({ id: f.id, mimeType: f.mimeType, size: f.size, originalName: f.originalName, url: urlFor(f.id) })),
    }));
  }

  async recordView(appId: string, ipHash: string, userAgent: string | undefined) {
    const recent = await this.prisma.externalFinanceApplicationEvent.findFirst({
      where: { applicationId: appId, kind: 'LINK_VIEWED', createdAt: { gte: new Date(Date.now() - VIEW_DEDUPE_MS) }, meta: { path: ['ipHash'], equals: ipHash } },
      select: { id: true },
    });
    if (recent) return;
    await this.prisma.externalFinanceApplicationEvent.create({ data: { applicationId: appId, kind: 'LINK_VIEWED', actorType: 'PARTNER', meta: { ipHash, userAgent: (userAgent ?? '').slice(0, 200) } } });
    await this.prisma.externalFinanceApplication.update({ where: { id: appId }, data: { shareViewCount: { increment: 1 }, shareLastViewedAt: new Date(), lastPartnerEventAt: new Date() } });
  }

  async fileStream(rawToken: string, fileId: string) {
    const app = await this.resolveOrThrow(rawToken);
    const file = app.files.find((f) => f.id === fileId && f.storageKey);
    if (!file?.storageKey) throw new NotFoundException(GONE_MSG);
    return { file, stream: await this.storage.getStream(file.storageKey) };
  }

  /** รายการ entry ของ zip แยกออกมาให้เทสต์ได้โดยไม่ต้องอ่าน storage */
  async zipStream(rawToken: string) {
    const app = await this.resolveOrThrow(rawToken);
    const entries: { name: string; storageKey: string }[] = [];
    let n = 0;
    for (const group of this.groups(app, () => '')) {
      group.files.forEach((f, i) => {
        const original = app.files.find((x) => x.id === f.id)!;
        const ext = EXT_BY_MIME[f.mimeType] ?? 'bin';
        n += 1;
        // spec §5.2: ชื่อแบน `01-ลูกค้าถือบัตร.jpg` … ช่องที่มีหลายไฟล์ต่อท้าย -1, -2 (ป้ายช่องตัด "/" และ "(ถ้ามี)" ออก)
        const label = group.label.replace(/\s*\(ถ้ามี\)/, '').replace(/[\\/:*?"<>|]/g, '-');
        const suffix = group.files.length > 1 ? `-${i + 1}` : '';
        entries.push({ name: `${String(n).padStart(2, '0')}-${label}${suffix}.${ext}`, storageKey: original.storageKey! });
      });
    }
    const archive = archiver('zip', { zlib: { level: 6 } });
    const load = async () => {
      for (const entry of entries) archive.append(await this.storage.getStream(entry.storageKey), { name: entry.name });
      await archive.finalize();
    };
    return { filename: `${app.number}.zip`, archive, entries, load };
  }

  async reply(rawToken: string, dto: FinanceShareReplyDto, ipHash: string) {
    const app = await this.resolveOrThrow(rawToken);
    if (isClosed(app.status)) throw new ConflictException('ใบยื่นนี้ปิดแล้ว ร้านไม่รับผลเพิ่ม — ติดต่อร้านในกลุ่มไลน์');
    const event = ({ ACK: 'PARTNER_ACK', MORE_INFO: 'PARTNER_MORE_INFO', APPROVED: 'PARTNER_APPROVED', REJECTED: 'PARTNER_REJECTED' } as const)[dto.action];
    // "รับเรื่องแล้ว" ซ้ำบนใบที่รับแล้ว = จดเหตุการณ์อย่างเดียว ไม่ 409 (กดซ้ำจากมือถือเป็นเรื่องปกติ)
    const nextStatus = event === 'PARTNER_ACK' && app.status === 'ACKNOWLEDGED' ? app.status : applyTransition(app.status, event);
    const closes = nextStatus === 'APPROVED' || nextStatus === 'REJECTED';
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.externalFinanceApplication.update({
        where: { id: app.id },
        data: { status: nextStatus, ...(closes || nextStatus === 'MORE_INFO' ? { resultSource: 'PARTNER_LINK' } : {}), lastPartnerEventAt: new Date(), closedAt: closes ? new Date() : null },
      });
      await tx.externalFinanceApplicationEvent.create({ data: { applicationId: app.id, kind: event, actorType: 'PARTNER', actorName: dto.name.trim().slice(0, 80), note: dto.note?.trim() || null, meta: { ipHash } } });
      return row;
    });
    try { await this.notify?.partnerReplied(app.id); } catch (err) { this.logger.warn(`notify partnerReplied failed app=${app.id}: ${(err as Error).message}`); }
    return { status: updated.status };
  }
}
```
(`isClosed` ต้องคืน `true` สำหรับ `APPROVED`/`REJECTED`/`CANCELLED` — ตามที่ Task 3 กำหนด · `applyTransition` มีตาราง `PARTNER_*` จาก `SENT`/`ACKNOWLEDGED`/`MORE_INFO` แล้ว)

Run เทสต์ Step 5 → Expected: PASS 9

- [ ] **Step 7: controller สาธารณะ**

`finance-share-public.controller.ts`:
```ts
import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { pipeline } from 'stream/promises';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { FinanceShareService } from './services/finance-share.service';
import { buildFinanceSharePage, buildGonePage, LINE_GROUP_NAME } from './services/finance-share-page.util';
import { FinanceShareReplyDto } from './dto/finance-share-reply.dto';

/**
 * หน้าลิงก์ชุดเช็คเครดิตสำหรับเจ้าหน้าที่ GFIN — public (ไม่มี JwtAuthGuard) ตาม spec §6/§12:
 * - เข้าถึงด้วยโทเคน 256 บิตอย่างเดียว (ค้นด้วย sha256 hash) · หมดอายุ 7 วัน · ยกเลิกได้
 * - ทุก route throttle ต่อ IP · POST reply ใช้ @SkipCsrf() เพราะไม่มี session — โทเคนในพาธคือหลักฐานสิทธิ์
 * - "ไม่พบ/หมดอายุ/ยกเลิก/ล้างแล้ว" ตอบหน้า 410 เดียวกัน ไม่บอกว่าโทเคนเคยมีอยู่ไหม
 * - ห้าม log โทเคนดิบ — log เฉพาะ application id หลัง resolve
 * ดู `.claude/rules/security.md` รายการ Intentionally Public Endpoints (`finance-share-public`)
 */
@Controller('g')
export class FinanceSharePublicController {
  constructor(private share: FinanceShareService, private config: ConfigService) {}

  /** spec §12: sha256(salt ประจำระบบ + IP + วันตาม BKK) — ไม่เก็บ IP ดิบ · salt = PII_HASH_SALT (secret ที่ prod มีอยู่แล้ว) */
  private ipHash(req: Request): string {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || '';
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    const salt = this.config.get<string>('PII_HASH_SALT') ?? '';
    return createHash('sha256').update(`${salt}|${ip}|${day}`).digest('hex').slice(0, 32);
  }

  private htmlHeaders(res: Response, nonce: string) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  }

  @Get(':token')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  async page(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const nonce = randomBytes(16).toString('base64');
    const r = await this.share.resolve(token);
    this.htmlHeaders(res, nonce);
    if (r.state !== 'OK') return res.status(410).send(buildGonePage(nonce));
    await this.share.recordView(r.app.id, this.ipHash(req), req.headers['user-agent']);
    const base = `/api/g/${encodeURIComponent(token)}`;
    const groups = this.share.groups(r.app, (fileId) => `${base}/files/${fileId}`);
    return res.status(200).send(buildFinanceSharePage({
      nonce, number: r.app.number, status: r.app.status, expiresAt: r.app.shareExpiresAt!,
      messageText: r.app.messageText ?? '', groups, zipUrl: `${base}/zip`, replyUrl: `${base}/reply`,
      fileCount: groups.reduce((n, g) => n + g.files.length, 0), lineGroupName: LINE_GROUP_NAME,
    }));
  }

  @Get(':token/files/:fileId')
  @Throttle({ short: { limit: 120, ttl: 60_000 } })
  async file(@Param('token') token: string, @Param('fileId') fileId: string, @Res() res: Response) {
    const { file, stream } = await this.share.fileStream(token, fileId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName ?? file.id)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(stream, res);
  }

  @Get(':token/zip')
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  async zip(@Param('token') token: string, @Res() res: Response) {
    const { filename, archive, load } = await this.share.zipStream(token);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    archive.on('error', (err) => { res.destroy(err); });
    archive.pipe(res);
    await load();
  }

  @Post(':token/reply')
  @SkipCsrf()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  reply(@Param('token') token: string, @Body() dto: FinanceShareReplyDto, @Req() req: Request) {
    return this.share.reply(token, dto, this.ipHash(req));
  }
}
```
ตรวจก่อนเขียน: `CsrfGuard` (`apps/api/src/guards/csrf.guard.ts`) อ่าน `SKIP_CSRF_KEY` ด้วย `Reflector` ระดับ handler ใช่ไหม (grep `SKIP_CSRF_KEY` ในไฟล์นั้น) — ถ้าอ่านเฉพาะ class ให้ย้าย `@SkipCsrf()` ไประดับ class ของ controller นี้ (ทุก route เป็น token-gated อยู่แล้ว)

- [ ] **Step 8: ลงทะเบียนใน module + type-check**

ใน `external-finance-application.module.ts`: `controllers: [..., FinanceSharePublicController]`, `providers: [..., FinanceShareService]` (`FinanceApplicationNotifyService` เพิ่มใน Task 7 — ตอนนี้ `@Optional()` จึง compile ผ่าน)
Run: `./tools/check-types.sh api` → Expected: 0 errors
Run: `cd apps/api && npx jest src/modules/external-finance-application --runInBand` → Expected: PASS ทั้งหมด

- [ ] **Step 9: DB spec ต่อเติม — เปิดลิงก์จริงหลังส่ง + ตอบกลับ + ลิงก์หมดอายุ**

ต่อท้าย `finance-application-flow.db.spec.ts` (ใช้ `sent.shareUrl` จากเคส Task 5 Step 7 — ดึงโทเคนด้วย `sent.shareUrl.split('/').pop()!`):
```ts
  it('resolves the live link, counts one view per ipHash, and a partner APPROVED reply closes the application', async () => {
    const share = new FinanceShareService(prisma, storage);
    const token = sent.shareUrl.split('/').pop()!;
    const r = await share.resolve(token);
    expect(r.state).toBe('OK');
    await share.recordView(app.id, 'ip-a', 'jest');
    await share.recordView(app.id, 'ip-a', 'jest');
    const row1 = await prisma.externalFinanceApplication.findUnique({ where: { id: app.id } });
    expect(row1?.shareViewCount).toBe(1);
    const reply = await share.reply(token, { action: 'APPROVED', name: 'คุณเอ', note: 'ผ่านครับ' }, 'ip-a');
    expect(reply.status).toBe('APPROVED');
    const row2 = await prisma.externalFinanceApplication.findUnique({ where: { id: app.id }, include: { events: true } });
    expect(row2?.resultSource).toBe('PARTNER_LINK');
    expect(row2?.closedAt).not.toBeNull();
    expect(row2?.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['SENT', 'LINK_VIEWED', 'PARTNER_APPROVED']));
    await expect(share.reply(token, { action: 'REJECTED', name: 'คุณเอ' }, 'ip-a')).rejects.toThrow(ConflictException);
  });
  it('an expired link is GONE and records no view', async () => {
    await prisma.externalFinanceApplication.update({ where: { id: app.id }, data: { shareExpiresAt: new Date(Date.now() - 1000) } });
    const share = new FinanceShareService(prisma, storage);
    const token = sent.shareUrl.split('/').pop()!;
    expect(await share.resolve(token)).toEqual({ state: 'GONE', reason: 'EXPIRED' });
    await expect(share.fileStream(token, 'any')).rejects.toThrow(NotFoundException);
  });
```
Run: `cd apps/api && DATABASE_URL=<test_db> PII_ENCRYPTION_KEY=<hex64> npx jest .../finance-application-flow.db.spec.ts --runInBand` → Expected: PASS 5

- [ ] **Step 10: ทดสอบมือด้วย curl (API local พอร์ต 3000 + ฐานทดสอบตามกับดักข้อ 11 ใน memory)**

```bash
# ใช้โทเคนจาก GET /api/finance-applications/:id/share-link (ล็อกอินพนักงาน)
curl -si http://localhost:3000/api/g/<token> | head -20            # 200 text/html + CSP nonce
curl -si http://localhost:3000/api/g/$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=' | head -c 43) | head -5   # 410
curl -si -X POST http://localhost:3000/api/g/<token>/reply -H 'Content-Type: application/json' -d '{"action":"MORE_INFO","name":"คุณเอ","note":"ขอสลิปเพิ่ม"}'   # 201 {"status":"MORE_INFO"} — ไม่ต้องมี X-Requested-With
curl -s -o /tmp/x.zip -w '%{http_code}\n' http://localhost:3000/api/g/<token>/zip && unzip -l /tmp/x.zip
```
Expected: ตามคอมเมนต์ท้ายบรรทัด

- [ ] **Step 11: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/modules/external-finance-application
git commit -m "feat(gfin): หน้าลิงก์สาธารณะ /api/g/:token — HTML+CSP nonce, ไฟล์, zip, ปุ่มตอบกลับ GFIN, บันทึกการเปิด"
```

---

### Task 7: OCR จากรูปในแชท · แจ้งเตือนพนักงานเมื่อ GFIN ตอบ · cron ล้างไฟล์ 90 วัน · security.md · MCP policy · env/deploy

**Files:**
- Create: `apps/api/src/modules/external-finance-application/services/finance-application-notify.service.ts`
- Create: `apps/api/src/modules/external-finance-application/crons/finance-application-purge.cron.ts`
- Modify: `apps/api/src/modules/external-finance-application/room-finance-applications.controller.ts` (เพิ่ม `POST :roomId/finance-applications/ocr-id-card`)
- Modify: `apps/api/src/modules/external-finance-application/services/finance-application-files.service.ts` (เพิ่ม `ocrIdCardFromMessage`)
- Modify: `apps/api/src/modules/external-finance-application/external-finance-application.module.ts`
- Modify: `.claude/rules/security.md` · `.claude/mcp/sql/policy.mjs` · `.env.example` · `.github/workflows/deploy-gcp.yml`
- Test: `__tests__/finance-application-notify.service.spec.ts` · `__tests__/finance-application-purge.cron.spec.ts` · ต่อเติม `__tests__/finance-application-files.service.spec.ts`

**Interfaces:**
- Consumes: `OcrService.extractIdCard(dataUrl: string, userId?: string)` (`ocr.service.ts` — ตรวจ signature จริงก่อนเรียก: `grep -n "extractIdCard" apps/api/src/modules/ocr/ocr.service.ts`) · `fetchProviderMedia`/`LineOaService.downloadContent`/`LineFinanceClientService.getMessageContent` ผ่าน helper `loadMessageBytes` ที่ Task 4 ใช้ใน `fromMessage` (ถ้า Task 4 เขียน inline ให้แยกเป็น private method `loadMessageBytes(message)` ใน Task นี้แล้วให้ `fromMessage` เรียกใช้) · `NotificationsService.send(dto)` (`SendNotificationDto` — ดู `apps/api/src/modules/notifications/dto/*.ts` ว่าฟิลด์ `channel: 'IN_APP'`, `recipient`, `message`, `title?`, `relatedId?` ชื่ออะไรจริง) · `prisma.todo.create` (model `Todo`: `title`, `description`, `priority`, `createdById`, `assigneeId`, `roomId`, `tags`)
- Produces:
  - `FinanceApplicationFilesService.ocrIdCardFromMessage(roomId, messageId, actor): Promise<OcrIdCardResult>` (ชนิดคืนค่าเดียวกับ `OcrService.extractIdCard`) · route `POST /staff-chat/rooms/:roomId/finance-applications/ocr-id-card {messageId}`
  - `FinanceApplicationNotifyService.partnerReplied(applicationId): Promise<void>` — Todo ให้ผู้ส่ง (`sentById`, fallback `createdById`) + IN_APP
  - `FinanceApplicationPurgeCron.tick(): Promise<{ purgedApplications: number; purgedFiles: number }>` — ทุกวัน 03:30 BKK
  - env `SHARE_PAGE_BASE_URL`

- [ ] **Step 1: เทสต์ OCR-จากรูป ล้มก่อน (ต่อท้าย `finance-application-files.service.spec.ts`)**

```ts
describe('ocrIdCardFromMessage', () => {
  it('loads the chat image and hands a data URL to OcrService.extractIdCard', async () => {
    const ocr = { extractIdCard: jest.fn().mockResolvedValue({ nationalId: '1234567890123', fullName: 'สมหญิง ใจดี', confidence: 0.95 }) } as any;
    const message = { id: 'm1', roomId: 'room-1', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg', externalMessageId: null };
    const prisma = makePrisma({ chatMessage: { findFirst: jest.fn().mockResolvedValue(message) }, chatRoom: { findFirst: jest.fn().mockResolvedValue(room) } });
    fetchMock.mockResolvedValueOnce(okResponse(JPEG_BYTES, 'image/jpeg'));
    const service = new FinanceApplicationFilesService(prisma, storage, applications, lineOa, lineFinance, ocr);
    const result = await service.ocrIdCardFromMessage('room-1', 'm1', owner);
    expect(result.nationalId).toBe('1234567890123');
    expect(ocr.extractIdCard).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/), owner.id);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('rejects a PDF with a Thai message', async () => {
    const ocr = { extractIdCard: jest.fn() } as any;
    const message = { id: 'm2', roomId: 'room-1', type: 'FILE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.pdf', externalMessageId: null };
    const prisma = makePrisma({ chatMessage: { findFirst: jest.fn().mockResolvedValue(message) }, chatRoom: { findFirst: jest.fn().mockResolvedValue(room) } });
    fetchMock.mockResolvedValueOnce(okResponse(PDF_BYTES, 'application/pdf'));
    const service = new FinanceApplicationFilesService(prisma, storage, applications, lineOa, lineFinance, ocr);
    await expect(service.ocrIdCardFromMessage('room-1', 'm2', owner)).rejects.toThrow('อ่านบัตรได้เฉพาะรูปภาพ');
    expect(ocr.extractIdCard).not.toHaveBeenCalled();
  });
});
```
(ปรับ constructor ของ `FinanceApplicationFilesService` ให้รับ `OcrService` เป็นพารามิเตอร์ท้ายสุด และแก้ `new FinanceApplicationFilesService(...)` ทุกจุดในไฟล์ spec เดิมให้ส่ง `ocr` เพิ่ม — `{ extractIdCard: jest.fn() } as any`)

Run: `cd apps/api && npx jest src/modules/external-finance-application/__tests__/finance-application-files.service.spec.ts --runInBand` → Expected: FAIL

- [ ] **Step 2: เมธอด OCR + route**

ใน `finance-application-files.service.ts`:
```ts
import { OcrService } from '../../ocr/ocr.service';
// constructor เพิ่ม: private ocr: OcrService

  /** อ่านบัตรจากรูปในแชทโดยไม่แนบเข้าใบยื่น — ให้ปุ่ม "สร้างลูกค้าจากรูปบัตร" ในแท็บ GFIN (spec §5.2 ขั้น 1) */
  async ocrIdCardFromMessage(roomId: string, messageId: string, actor: FinanceActor) {
    const room = await this.applications.access(this.prisma, roomId, actor);
    const message = await this.prisma.chatMessage.findFirst({ where: { id: messageId, roomId, deletedAt: null } });
    if (!message) throw new NotFoundException('ไม่พบข้อความนี้ในห้อง');
    const media = await this.loadMessageBytes(message, room.channel);   // helper เดียวกับ fromMessage (Task 4: Facebook URL / LINE message id ตาม channel)
    if (!media.contentType.startsWith('image/')) throw new BadRequestException('อ่านบัตรได้เฉพาะรูปภาพ — ไฟล์ PDF ให้กรอกเอง');
    return this.ocr.extractIdCard(`data:${media.contentType};base64,${media.bytes.toString('base64')}`, actor.id);
  }
```
ใน `room-finance-applications.controller.ts`:
```ts
  @Post('ocr-id-card')
  @Roles(...FINANCE_APP_ROLES)
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  ocrIdCard(@Param('roomId', ParseUUIDPipe) roomId: string, @Body() dto: OcrFromMessageDto, @Req() req: { user: FinanceActor }) {
    return this.files.ocrIdCardFromMessage(roomId, dto.messageId, req.user);
  }
```
DTO `OcrFromMessageDto { @IsUUID('4', { message: 'messageId ไม่ถูกต้อง' }) messageId!: string }` ใน `dto/finance-application-files.dto.ts` · module ต้อง `imports: [OcrModule]` (ตรวจว่า `OcrModule` export `OcrService` — `grep -n exports apps/api/src/modules/ocr/ocr.module.ts`)

Run เทสต์ Step 1 → Expected: PASS

- [ ] **Step 3: เทสต์ notify ล้มก่อน**

`__tests__/finance-application-notify.service.spec.ts`:
```ts
import { FinanceApplicationNotifyService } from '../services/finance-application-notify.service';

const app = { id: 'app-1', number: 'BC-260924-001', status: 'APPROVED', roomId: 'room-1', sentById: 'u-sender', createdById: 'u-creator', events: [{ kind: 'PARTNER_APPROVED', note: 'ผ่านครับ', createdAt: new Date() }] };
function make(row: any) {
  const prisma = {
    externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(row) },
    todo: { create: jest.fn().mockResolvedValue({ id: 't1' }), findFirst: jest.fn().mockResolvedValue(null) },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u-system' }) },
  } as any;
  const notifications = { send: jest.fn().mockResolvedValue({ id: 'n1', status: 'SENT' }) } as any;
  return { prisma, notifications, service: new FinanceApplicationNotifyService(prisma, notifications) };
}

describe('FinanceApplicationNotifyService.partnerReplied', () => {
  it('creates a HIGH todo for the sender tagged gfin and pushes an IN_APP notification', async () => {
    const { prisma, notifications, service } = make(app);
    await service.partnerReplied('app-1');
    expect(prisma.todo.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assigneeId: 'u-sender', createdById: 'u-system', roomId: 'room-1', priority: 'HIGH', tags: ['gfin'], title: expect.stringContaining('BC-260924-001') }) }));
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ channel: 'IN_APP', recipient: 'u-sender' }));
  });
  it('falls back to the creator when sentById is null and does not duplicate an open todo', async () => {
    const { prisma, service } = make({ ...app, sentById: null });
    prisma.todo.findFirst.mockResolvedValueOnce({ id: 'existing' });
    await service.partnerReplied('app-1');
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });
  it('swallows notification transport errors (never throws into the public reply path)', async () => {
    const { notifications, service } = make(app);
    notifications.send.mockRejectedValueOnce(new Error('boom'));
    await expect(service.partnerReplied('app-1')).resolves.toBeUndefined();
  });
});
```
Run → Expected: FAIL (module not found)

- [ ] **Step 4: notify service**

`services/finance-application-notify.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { FINANCE_STATUS_LABEL } from '../finance-application-status.util';

const TODO_TAG = 'gfin';

@Injectable()
export class FinanceApplicationNotifyService {
  private readonly logger = new Logger(FinanceApplicationNotifyService.name);
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /** GFIN ตอบผ่านลิงก์ → Todo HIGH ให้ผู้ส่ง + แจ้งเตือนในแอป (spec §9) — ห้าม throw ออก */
  async partnerReplied(applicationId: string): Promise<void> {
    const app = await this.prisma.externalFinanceApplication.findFirst({
      where: { id: applicationId, deletedAt: null },
      include: { events: { where: { actorType: 'PARTNER', kind: { in: ['PARTNER_APPROVED', 'PARTNER_REJECTED', 'PARTNER_MORE_INFO', 'PARTNER_ACK'] } }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!app) return;
    const assigneeId = app.sentById ?? app.createdById;
    const latest = app.events[0];
    const label = FINANCE_STATUS_LABEL[app.status];
    const title = `GFIN ตอบใบยื่น ${app.number}: ${label}`;
    const description = [latest?.note ? `หมายเหตุจาก GFIN: ${latest.note}` : null, `เปิดห้องแชท → แท็บ GFIN เพื่อดูรายละเอียด`].filter(Boolean).join('\n');
    try {
      const open = await this.prisma.todo.findFirst({ where: { assigneeId, tags: { has: TODO_TAG }, title, status: { not: 'DONE' }, deletedAt: null }, select: { id: true } });
      if (!open) {
        const system = await this.prisma.user.findFirst({ where: { isSystemUser: true, deletedAt: null }, select: { id: true } });
        await this.prisma.todo.create({ data: { title, description, priority: 'HIGH', createdById: system?.id ?? assigneeId, assigneeId, roomId: app.roomId, tags: [TODO_TAG] } });
      }
    } catch (err) { this.logger.warn(`todo create failed app=${app.id}: ${(err as Error).message}`); }
    try {
      await this.notifications.send({ channel: 'IN_APP', recipient: assigneeId, title, message: description, relatedId: app.id } as any);
    } catch (err) { this.logger.warn(`IN_APP notify failed app=${app.id}: ${(err as Error).message}`); }
  }
}
```
(เปิด `SendNotificationDto` จริงแล้วแทน `as any` ด้วยฟิลด์ที่มีจริง — ถ้า DTO ไม่มี `title` ให้รวมเข้า `message` · `TodoStatus` มีค่า `DONE` ตาม schema · ตรวจว่า `NotificationsModule` export `NotificationsService`)

Run เทสต์ Step 3 → Expected: PASS 3 · จากนั้นใน `FinanceShareService` (Task 6) เปลี่ยน `@Optional()` เป็น inject ปกติ และเพิ่ม provider ใน module

- [ ] **Step 5: เทสต์ cron ล้างไฟล์ ล้มก่อน**

`__tests__/finance-application-purge.cron.spec.ts`:
```ts
import { FinanceApplicationPurgeCron } from '../crons/finance-application-purge.cron';

const old = new Date(Date.now() - 91 * 86400000);
const recent = new Date(Date.now() - 10 * 86400000);
function make(apps: any[]) {
  const prisma = {
    externalFinanceApplication: { findMany: jest.fn().mockResolvedValue(apps), update: jest.fn().mockResolvedValue({}) },
    externalFinanceApplicationFile: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: (fn: any) => fn({ externalFinanceApplicationFile: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) }, externalFinanceApplication: { update: jest.fn().mockResolvedValue({}) }, externalFinanceApplicationEvent: { create: jest.fn().mockResolvedValue({}) } }),
  } as any;
  const storage = { delete: jest.fn().mockResolvedValue(undefined) } as any;
  return { prisma, storage, cron: new FinanceApplicationPurgeCron(prisma, storage) };
}

describe('FinanceApplicationPurgeCron', () => {
  it('deletes storage objects of applications closed ≥ 90 days ago, nulls storageKey, stamps filesPurgedAt and logs FILES_PURGED', async () => {
    const { prisma, storage, cron } = make([{ id: 'a1', closedAt: old, files: [{ id: 'f1', storageKey: 'k1' }, { id: 'f2', storageKey: 'k2' }] }]);
    const result = await cron.tick();
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ purgedApplications: 1, purgedFiles: 2 });
    const where = prisma.externalFinanceApplication.findMany.mock.calls[0][0].where;
    expect(where.filesPurgedAt).toBeNull();
    expect(where.closedAt.lte).toBeInstanceOf(Date);
  });
  it('keeps going when one object delete fails and reports the rest', async () => {
    const { storage, cron } = make([{ id: 'a1', closedAt: old, files: [{ id: 'f1', storageKey: 'k1' }, { id: 'f2', storageKey: 'k2' }] }]);
    storage.delete.mockRejectedValueOnce(new Error('s3 down'));
    await expect(cron.tick()).resolves.toEqual({ purgedApplications: 1, purgedFiles: 2 });
  });
  it('never touches open applications or ones closed less than 90 days ago (query shape)', async () => {
    const { prisma, cron } = make([]);
    await cron.tick();
    const where = prisma.externalFinanceApplication.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['APPROVED', 'REJECTED', 'CANCELLED']);
    expect(where.closedAt.lte.getTime()).toBeLessThan(recent.getTime());
  });
});
```
Run → Expected: FAIL

- [ ] **Step 6: cron**

`crons/finance-application-purge.cron.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

export const PURGE_AFTER_DAYS = 90;
const BATCH = 50;

/** ลบไฟล์ของใบยื่นที่ปิดครบ 90 วัน (D6 — เจ้าของเคาะ 2026-09-24) · เก็บแถว/เหตุการณ์ไว้ ลบเฉพาะ object ใน storage */
@Injectable()
export class FinanceApplicationPurgeCron {
  private readonly logger = new Logger(FinanceApplicationPurgeCron.name);
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Bangkok' })
  async run() {
    try {
      const r = await this.tick();
      if (r.purgedApplications) this.logger.log(`purged ${r.purgedFiles} files across ${r.purgedApplications} applications`);
    } catch (err) {
      this.logger.error('finance-application-purge failed', err as Error);
      Sentry.captureException(err);
    }
  }

  async tick() {
    const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 86400000);
    const apps = await this.prisma.externalFinanceApplication.findMany({
      where: { status: { in: ['APPROVED', 'REJECTED', 'CANCELLED'] }, closedAt: { lte: cutoff }, filesPurgedAt: null, deletedAt: null },
      select: { id: true, closedAt: true, files: { where: { deletedAt: null, storageKey: { not: null } }, select: { id: true, storageKey: true } } },
      take: BATCH,
    });
    let purgedFiles = 0;
    for (const app of apps) {
      for (const file of app.files) {
        try { await this.storage.delete(file.storageKey!); } catch (err) { this.logger.warn(`delete ${file.storageKey} failed: ${(err as Error).message}`); }
        purgedFiles += 1;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id }, data: { storageKey: null } });
        await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { filesPurgedAt: new Date(), shareRevokedAt: new Date() } });
        await tx.externalFinanceApplicationEvent.create({ data: { applicationId: app.id, kind: 'FILES_PURGED', actorType: 'SYSTEM', meta: { fileCount: app.files.length } } });
      });
    }
    return { purgedApplications: apps.length, purgedFiles };
  }
}
```
(ลบ object ก่อน แล้วค่อย null key — ถ้า process ตายกลางทาง แถวยังมี key และรอบถัดไปลบซ้ำได้ · `storage.delete` ของ key ที่ไม่มีแล้วต้องไม่ throw — ตรวจ `storage.service.ts` ว่า delete บน key หายตอบอย่างไร ถ้า throw ให้ catch ตามโค้ดข้างบนอยู่แล้ว)

module: `providers: [..., FinanceApplicationPurgeCron]` (`ScheduleModule.forRoot()` อยู่ที่ app.module แล้ว)
Run เทสต์ Step 5 → Expected: PASS 3

- [ ] **Step 7: security.md + MCP policy + env + deploy**

`.claude/rules/security.md` — เพิ่มบรรทัดในรายการ "Intentionally Public Endpoints":
```md
- `finance-share-public` (`GET g/:token`, `GET g/:token/files/:fileId`, `GET g/:token/zip`, `POST g/:token/reply`) — หน้าลิงก์ชุดเช็คเครดิตให้เจ้าหน้าที่ไฟแนนซ์นอก (GFIN) เปิดจากไลน์; token-gated (256-bit, ค้นด้วย sha256 hash, โทเคนดิบเก็บเข้ารหัส) + หมดอายุ 7 วัน (`ExternalFinanceApplication.shareExpiresAt`) + ยกเลิกได้ (`shareRevokedAt`) + throttled ทุก route (หน้า 60 · ไฟล์ 120 · zip 5 · reply 10 ต่อนาที) + CSP nonce + `noindex` — `POST reply` ใช้ `@SkipCsrf()` เพราะไม่มี session (โทเคนในพาธคือหลักฐานสิทธิ์) และเปลี่ยนสถานะได้เฉพาะใบที่ยังเปิด (409 เมื่อปิดแล้ว) · ไม่พบ/หมดอายุ/ยกเลิก = หน้า 410 เดียวกัน (spec `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md` §6, §12)
```

`.claude/mcp/sql/policy.mjs` — เพิ่มใน `PII_TABLE_ALLOWLIST` (ตารางถือข้อมูลลูกค้า = ตาราง PII ต้องระบุคอลัมน์เป๊ะ):
```js
  // ── ใบยื่นไฟแนนซ์นอก (migration 20261009000000_external_finance_application) — ตั้งใจไม่ให้:
  //    summary / message_text / message_override (ข้อความ 12 ข้อ = ชื่อ อาชีพ IMEI เบอร์ อายุ) · occupation_override ·
  //    share_token_hash / share_token_enc (ลิงก์สาธารณะ) · line_request_id
  external_finance_applications: [
    'id', 'number', 'finance_company_id', 'room_id', 'customer_id', 'product_id', 'branch_id', 'status', 'result_source',
    'sent_at', 'sent_by_id', 'sent_via', 'share_expires_at', 'share_revoked_at', 'share_view_count', 'share_last_viewed_at',
    'last_partner_event_at', 'closed_at', 'files_purged_at', 'created_by_id', 'created_at', 'updated_at', 'deleted_at',
  ],
  //    ไม่ให้ original_name (ชื่อไฟล์ที่ลูกค้าตั้งอาจมีชื่อจริง) · storage_key (พาธไฟล์เอกสาร)
  external_finance_application_files: [
    'id', 'application_id', 'slot', 'mime_type', 'size', 'source', 'source_message_id', 'source_angle', 'sort_order',
    'sent_at', 'created_by_id', 'created_at', 'updated_at', 'deleted_at',
  ],
  //    ไม่ให้ actor_name / note (ข้อความอิสระจาก GFIN) / meta (ipHash + user agent)
  external_finance_application_events: ['id', 'application_id', 'kind', 'actor_type', 'actor_user_id', 'created_at'],
```
แล้ว:
```bash
cd .claude/mcp && npm run grants && git diff --stat sql/
```
Expected: ไฟล์ grants ที่ generate ได้เพิ่ม 3 ตารางด้วยคอลัมน์ข้างบนเท่านั้น (apply บน prod หลัง migration — ขั้นตอนเดียวกับ PR #1631)

`.env.example` — ใต้ `PAYMENT_LINK_BASE_URL`:
```
# หน้าลิงก์ชุดเช็คเครดิต GFIN (public) — ต้องเป็นโดเมนที่ rewrite /api/** ไป Cloud Run (ไม่ใช่ web.app ของ Firebase ที่ไม่มี rewrite)
SHARE_PAGE_BASE_URL=http://localhost:3000
```
`.github/workflows/deploy-gcp.yml` — ใน `--set-env-vars` ถัดจากบรรทัด `FRONTEND_URL=...` (บรรทัด ~626):
```
          SHARE_PAGE_BASE_URL=https://bestchoicephone.app,\
```
(ตรวจว่า `firebase.json` ของโปรเจกต์ที่เสิร์ฟ `bestchoicephone.app` มี rewrite `/api/**` → Cloud Run — `grep -n '"source": "/api' firebase.json apps/web/firebase.json 2>/dev/null` · ถ้าไม่มี ให้ใช้โดเมน API ตรง เช่น `https://api.bestchoicephone.app` ตาม `API_BASE_URL` ใน env prod)

- [ ] **Step 8: type-check + เทสต์ทั้งโมดูล + commit**

```bash
./tools/check-types.sh api && cd apps/api && npx jest src/modules/external-finance-application --runInBand && cd ../..
git add apps/api/src/modules/external-finance-application .claude/rules/security.md .claude/mcp .env.example .github/workflows/deploy-gcp.yml
git commit -m "feat(gfin): OCR บัตรจากรูปในแชท, แจ้งเตือนเมื่อ GFIN ตอบ, cron ล้างไฟล์ 90 วัน, security/MCP/env"
```

---

### Task 8: เว็บ — ชนิดข้อมูล GFIN, MIME ลาก-วาง, ป้ายช่อง, helper ความพร้อม + hook `useFinanceApplication`

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/gfin/gfin.ts`
- Create: `apps/web/src/pages/UnifiedInboxPage/components/gfin/gfin.test.ts`
- Create: `apps/web/src/pages/UnifiedInboxPage/hooks/useFinanceApplication.ts`
- Create: `apps/web/src/pages/UnifiedInboxPage/hooks/useFinanceApplication.test.tsx`

**Interfaces:**
- Consumes: `api`, `getErrorMessage` จาก `@/lib/api` · `toast` จาก `sonner` · API ของ Task 3–7
- Produces:
  - `GFIN_MESSAGE_MIME = 'application/x-bestchoice-gfin-message'` · `GFIN_ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp'`
  - ชนิด `FinanceSlot` (13 ค่า) · `FinanceStatus` · `FinanceFile` · `FinanceEvent` · `FinanceApplication` · `FinancePreview` · `SLOT_LABELS: Record<FinanceSlot, string>` · `SLOT_ORDER: FinanceSlot[]` · `REQUIRED_SLOTS` · `STATUS_LABEL: Record<FinanceStatus, string>`
  - `isGfinPickable(message: { type?: string | null; mediaUrl?: string | null; externalMessageId?: string | null }): boolean`
  - `gfinStep(app: FinanceApplication | null, preview: FinancePreview | null): 1 | 2 | 3 | 4` · `slotCounts(files: FinanceFile[]): Record<FinanceSlot, number>` · `needsAttention(app: FinanceApplication | null): boolean`
  - `useFinanceApplication(roomId: string | null): FinanceApplicationModel` — ดู interface ใน Step 4 (Task 9–10 ใช้ทุกฟิลด์)

- [ ] **Step 1: เทสต์ helper ล้มก่อน**

`components/gfin/gfin.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isGfinPickable, gfinStep, slotCounts, needsAttention, SLOT_ORDER, REQUIRED_SLOTS } from './gfin';
// readSeen/markSeen เป็น wrapper ของ localStorage ที่ try/catch — ไม่ต้องเทสต์แยก

const app = (over: Partial<import('./gfin').FinanceApplication> = {}): import('./gfin').FinanceApplication => ({
  id: 'a1', number: 'BC-260924-001', status: 'DRAFT', roomId: 'r1', customerId: null, productId: null, customer: null, product: null,
  occupationOverride: null, messageOverride: null, messageText: null, sentAt: null, sentVia: null, resultSource: null,
  shareExpiresAt: null, shareRevokedAt: null, shareViewCount: 0, shareLastViewedAt: null, lastPartnerEventAt: null, closedAt: null,
  files: [], events: [], createdAt: '2026-09-24T12:00:00Z', ...over,
});
const preview = (over: Partial<import('./gfin').FinancePreview> = {}): import('./gfin').FinancePreview => ({
  text: '', values: {} as never, missingFields: [], missingRequiredSlots: [], warnings: [], canSend: true, ...over,
});

describe('isGfinPickable', () => {
  it('accepts IMAGE/FILE with a media url or a LINE message id, rejects text and legacy LINE media without id', () => {
    expect(isGfinPickable({ type: 'IMAGE', mediaUrl: 'https://x/a.jpg' })).toBe(true);
    expect(isGfinPickable({ type: 'FILE', mediaUrl: null, externalMessageId: '555' })).toBe(true);
    expect(isGfinPickable({ type: 'IMAGE', mediaUrl: null, externalMessageId: null })).toBe(false);
    expect(isGfinPickable({ type: 'TEXT', mediaUrl: 'https://x/a.jpg' })).toBe(false);
  });
});
describe('gfinStep', () => {
  it('1 until the customer fields are complete, 2 until a product is chosen, 3 until required slots exist, then 4', () => {
    expect(gfinStep(app(), preview({ missingFields: ['customerName'] }))).toBe(1);
    expect(gfinStep(app({ customerId: 'c1' }), preview({ missingFields: ['occupation'] }))).toBe(1);
    expect(gfinStep(app({ customerId: 'c1' }), preview())).toBe(2);
    expect(gfinStep(app({ customerId: 'c1', productId: 'p1' }), preview({ missingRequiredSlots: ['INCOME'] }))).toBe(3);
    expect(gfinStep(app({ customerId: 'c1', productId: 'p1' }), preview())).toBe(4);
  });
});
describe('slotCounts / needsAttention / constants', () => {
  it('counts files per slot with zeros for every slot', () => {
    const c = slotCounts([{ id: 'f', slot: 'ID_CARD', mimeType: 'image/jpeg', size: 1, originalName: null, source: 'CHAT_MESSAGE', sourceMessageId: 'm', sourceAngle: null, sortOrder: 0, sentAt: null, createdAt: '' }]);
    expect(c.ID_CARD).toBe(1);
    expect(c.OTHER).toBe(0);
    expect(Object.keys(c)).toEqual(SLOT_ORDER);
  });
  it('flags a partner event newer than the last time the tab was opened; nothing for drafts or already-seen', () => {
    const t1 = '2026-09-24T12:14:00Z', t0 = '2026-09-24T12:00:00Z';
    expect(needsAttention(app({ status: 'MORE_INFO', lastPartnerEventAt: t1 }))).toBe(true);
    expect(needsAttention(app({ status: 'MORE_INFO', lastPartnerEventAt: t1 }), t0)).toBe(true);
    expect(needsAttention(app({ status: 'MORE_INFO', lastPartnerEventAt: t1 }), t1)).toBe(false);
    expect(needsAttention(app())).toBe(false);
    expect(needsAttention(null)).toBe(false);
    expect(REQUIRED_SLOTS).toEqual(['ID_SELFIE', 'ID_CARD', 'INCOME']);
  });
});
```
Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/gfin/gfin.test.ts` → Expected: FAIL (module not found)

- [ ] **Step 2: `gfin.ts`**

```ts
export const GFIN_MESSAGE_MIME = 'application/x-bestchoice-gfin-message';
export const GFIN_ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp';
export const GFIN_LINE_GROUP = 'GFIN : BESTCHOICE (67301219)';
export const GFIN_WEB_FORM_URL = 'https://client.gfinn.xyz/shop/loans/request';

export type FinanceSlot = 'ID_SELFIE' | 'ID_CARD' | 'INCOME' | 'FB_PROFILE' | 'FB_FRIENDS' | 'FB_ACTIVITY' | 'LINE_PROFILE' | 'DEVICE_SCREEN' | 'DEVICE_PHOTO' | 'GUARANTOR_ID' | 'ADDRESS_BILL' | 'PHONE_OPENING' | 'OTHER';
export type FinanceStatus = 'DRAFT' | 'SENT' | 'ACKNOWLEDGED' | 'MORE_INFO' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type FinanceEventKind = 'CREATED' | 'SENT' | 'RESENT' | 'LINK_VIEWED' | 'LINK_EXTENDED' | 'LINK_REVOKED' | 'PARTNER_ACK' | 'PARTNER_MORE_INFO' | 'PARTNER_APPROVED' | 'PARTNER_REJECTED' | 'STAFF_RESULT' | 'CANCELLED' | 'FILES_PURGED';

/** ป้ายช่องเดียวกับ `SLOT_LABELS` ฝั่ง API (constants.ts) — เปลี่ยนต้องเปลี่ยนคู่กัน */
export const SLOT_LABELS: Record<FinanceSlot, string> = {
  ID_SELFIE: 'ลูกค้าถือบัตร', ID_CARD: 'บัตรประชาชน', INCOME: 'สลิปเงินเดือน / สเตทเม้น',
  FB_PROFILE: 'หน้าเฟซบุ๊ก', FB_FRIENDS: 'เพื่อนเฟซบุ๊ก', FB_ACTIVITY: 'ความเคลื่อนไหวเฟซบุ๊ก', LINE_PROFILE: 'หน้าไลน์ลูกค้า',
  DEVICE_SCREEN: 'หน้าจอตั้งค่าเครื่อง', DEVICE_PHOTO: 'รูปเครื่อง 6 มุม',
  GUARANTOR_ID: 'บัตรคนค้ำ (ถ้ามี)', ADDRESS_BILL: 'บิลที่อยู่ (ถ้ามี)', PHONE_OPENING: 'ระยะเวลาเปิดเบอร์ (ถ้ามี)', OTHER: 'อื่น ๆ',
};
export const SLOT_ORDER = Object.keys(SLOT_LABELS) as FinanceSlot[];
/** 9 ช่องหลักที่โชว์เสมอ (mockup ขั้น 3 "8/9 ช่อง") — ที่เหลือโผล่เมื่อกด "เพิ่มช่อง" หรือมีไฟล์แล้ว */
export const PRIMARY_SLOTS: FinanceSlot[] = ['ID_SELFIE', 'ID_CARD', 'INCOME', 'FB_PROFILE', 'FB_FRIENDS', 'FB_ACTIVITY', 'LINE_PROFILE', 'DEVICE_SCREEN', 'DEVICE_PHOTO'];
export const REQUIRED_SLOTS: FinanceSlot[] = ['ID_SELFIE', 'ID_CARD', 'INCOME'];
export const STATUS_LABEL: Record<FinanceStatus, string> = {
  DRAFT: 'ร่าง', SENT: 'ส่งแล้ว รอ GFIN', ACKNOWLEDGED: 'GFIN รับเรื่องแล้ว', MORE_INFO: 'GFIN ขอเพิ่ม',
  APPROVED: 'ผ่าน', REJECTED: 'ไม่ผ่าน', CANCELLED: 'ยกเลิก',
};
export const OPEN_STATUSES: FinanceStatus[] = ['DRAFT', 'SENT', 'ACKNOWLEDGED', 'MORE_INFO'];

export interface FinanceFile { id: string; slot: FinanceSlot; mimeType: string; size: number; originalName: string | null; source: 'CHAT_MESSAGE' | 'UPLOAD' | 'PRODUCT_PHOTO'; sourceMessageId: string | null; sourceAngle: string | null; sortOrder: number; sentAt: string | null; createdAt: string }
export interface FinanceEvent { id: string; kind: FinanceEventKind; actorType: 'STAFF' | 'PARTNER' | 'SYSTEM'; actorUserId: string | null; actorName: string | null; note: string | null; meta: Record<string, unknown> | null; createdAt: string }
export interface FinanceApplication {
  id: string; number: string; status: FinanceStatus; roomId: string; customerId: string | null; productId: string | null;
  customer: { id: string; name: string; phone: string | null; occupation: string | null; birthDate: string | null } | null;
  product: { id: string; name: string | null; brand: string | null; model: string | null; storage: string | null; color: string | null; imeiSerial: string | null; category: string | null; status: string } | null;
  occupationOverride: string | null; messageOverride: string | null; messageText: string | null;
  sentAt: string | null; sentVia: 'BOT' | 'COPY' | null; resultSource: 'PARTNER_LINK' | 'STAFF' | null;
  shareExpiresAt: string | null; shareRevokedAt: string | null; shareViewCount: number; shareLastViewedAt: string | null;
  lastPartnerEventAt: string | null; closedAt: string | null; files: FinanceFile[]; events: FinanceEvent[]; createdAt: string;
}
export type PrecheckField = 'customerName' | 'occupation' | 'model' | 'hand' | 'imei' | 'phone' | 'age';
export const FIELD_LABELS: Record<PrecheckField, string> = { customerName: 'ชื่อลูกค้า', occupation: 'อาชีพ', model: 'รุ่น', hand: 'มือ 1/2', imei: 'IMEI', phone: 'เบอร์โทร', age: 'อายุ (วันเกิด)' };
export interface FinancePreview { text: string; values: Record<string, unknown>; missingFields: PrecheckField[]; missingRequiredSlots: FinanceSlot[]; warnings: string[]; canSend: boolean }

export function isGfinPickable(message: { type?: string | null; mediaUrl?: string | null; externalMessageId?: string | null }): boolean {
  if (message.type !== 'IMAGE' && message.type !== 'FILE') return false;
  return !!message.mediaUrl || !!message.externalMessageId;
}
const CUSTOMER_FIELDS: PrecheckField[] = ['customerName', 'occupation', 'phone', 'age'];
export function gfinStep(app: FinanceApplication | null, preview: FinancePreview | null): 1 | 2 | 3 | 4 {
  if (!app?.customerId) return 1;
  if (preview?.missingFields.some((f) => CUSTOMER_FIELDS.includes(f))) return 1;
  if (!app.productId) return 2;
  if (!preview || preview.missingRequiredSlots.length > 0) return 3;
  return 4;
}
export function slotCounts(files: FinanceFile[]): Record<FinanceSlot, number> {
  const counts = Object.fromEntries(SLOT_ORDER.map((s) => [s, 0])) as Record<FinanceSlot, number>;
  for (const f of files) counts[f.slot] += 1;
  return counts;
}
/** จุดเหลืองบนแท็บ (spec §6.1): มีเหตุการณ์จาก GFIN ที่ใหม่กว่าครั้งล่าสุดที่ผู้ใช้เปิดแท็บ (`seenAt` จาก localStorage) */
export function needsAttention(app: FinanceApplication | null, seenAt: string | null = null): boolean {
  if (!app || !app.lastPartnerEventAt) return false;
  return !seenAt || new Date(app.lastPartnerEventAt) > new Date(seenAt);
}
const SEEN_KEY = (appId: string) => `gfin-seen:${appId}`;
export function readSeen(appId: string): string | null { try { return localStorage.getItem(SEEN_KEY(appId)); } catch { return null; } }
export function markSeen(app: FinanceApplication | null): void { if (!app?.lastPartnerEventAt) return; try { localStorage.setItem(SEEN_KEY(app.id), app.lastPartnerEventAt); } catch { /* private mode */ } }
export const productLabel = (p: FinanceApplication['product']) => p ? [p.name || `${p.brand ?? ''} ${p.model ?? ''}`.trim(), p.storage && !(p.name ?? '').includes(p.storage) ? p.storage : null, p.color].filter(Boolean).join(' · ') : '';
export const imeiTail = (imei: string | null | undefined) => (imei ? `IMEI …${imei.slice(-4)}` : '');
```
Run เทสต์ Step 1 → Expected: PASS

- [ ] **Step 3: เทสต์ hook ล้มก่อน**

`hooks/useFinanceApplication.test.tsx` (pattern เดียวกับ `useRoomCredit.test.tsx`):
```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
const get = vi.fn(); const post = vi.fn(); const patch = vi.fn(); const del = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), delete: (...a: unknown[]) => del(...a) },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { useFinanceApplication } from './useFinanceApplication';
const wrap = (qc: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const draft = { id: 'a1', number: 'BC-1', status: 'DRAFT', roomId: 'A', customerId: null, productId: null, files: [], events: [] };
beforeEach(() => { get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset(); });

it('loads current + history for the room and exposes the preview only when a draft exists', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockImplementation((url: string) => {
    if (url === '/staff-chat/rooms/A/finance-applications') return Promise.resolve({ data: { current: draft, history: [] } });
    if (url === '/finance-applications/a1/message-preview') return Promise.resolve({ data: { text: 'x', missingFields: ['occupation'], missingRequiredSlots: [], warnings: [], canSend: false } });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  const { result } = renderHook(() => useFinanceApplication('A'), { wrapper: wrap(qc) });
  await waitFor(() => expect(result.current.current?.id).toBe('a1'));
  await waitFor(() => expect(result.current.preview?.missingFields).toEqual(['occupation']));
  expect(result.current.step).toBe(1);
});

it('start() posts a draft, attachMessage() posts from-message with the slot, and both invalidate the room query', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  get.mockResolvedValue({ data: { current: null, history: [] } });
  post.mockResolvedValue({ data: draft });
  const { result } = renderHook(() => useFinanceApplication('A'), { wrapper: wrap(qc) });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.start(); });
  expect(post).toHaveBeenCalledWith('/staff-chat/rooms/A/finance-applications');
  get.mockResolvedValue({ data: { current: draft, history: [] } });
  await waitFor(() => expect(result.current.current?.id).toBe('a1'));
  await act(async () => { await result.current.attachMessage('m1', 'INCOME'); });
  expect(post).toHaveBeenCalledWith('/finance-applications/a1/files/from-message', { messageId: 'm1', slot: 'INCOME' }, expect.objectContaining({ timeout: 120000 }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['room-gfin', 'A'] });
});

it('send(COPY) returns the message text so the caller can copy it, and marks busy while pending', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockResolvedValue({ data: { current: { ...draft, customerId: 'c', productId: 'p' }, history: [] } });
  post.mockResolvedValue({ data: { application: { ...draft, status: 'SENT' }, messageText: 'ข้อความ', shareUrl: 'https://x/api/g/t' } });
  const { result } = renderHook(() => useFinanceApplication('A'), { wrapper: wrap(qc) });
  await waitFor(() => expect(result.current.current?.id).toBe('a1'));
  let out: { messageText: string; shareUrl: string } | undefined;
  await act(async () => { out = await result.current.send('COPY'); });
  expect(out?.messageText).toBe('ข้อความ');
  expect(post).toHaveBeenCalledWith('/finance-applications/a1/send', { via: 'COPY' });
  expect(result.current.busy).toBe(false);
});
```
Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/hooks/useFinanceApplication.test.tsx` → Expected: FAIL

- [ ] **Step 4: hook**

`hooks/useFinanceApplication.ts`:
```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { gfinStep, type FinanceApplication, type FinancePreview, type FinanceSlot } from '../components/gfin/gfin';

interface RoomFinanceData { current: FinanceApplication | null; history: FinanceApplication[] }
export interface SendResult { application: FinanceApplication; messageText: string; shareUrl: string }
export interface OcrIdCard { nationalId: string | null; nationalIdValid: boolean; prefix: string | null; firstName: string | null; lastName: string | null; fullName: string | null; birthDate: string | null; address: string | null; addressStructured: Record<string, string> | null; confidence: number }

export interface FinanceApplicationModel {
  roomId: string | null;
  current: FinanceApplication | null;
  history: FinanceApplication[];
  preview: FinancePreview | null;
  step: 1 | 2 | 3 | 4;
  loading: boolean;
  busy: boolean;
  start(): Promise<FinanceApplication>;
  update(patch: { customerId?: string | null; productId?: string | null; occupationOverride?: string | null; messageOverride?: string | null }): Promise<void>;
  attachMessage(messageId: string, slot: FinanceSlot): Promise<void>;
  upload(slot: FinanceSlot, files: File[]): Promise<void>;
  fromProduct(): Promise<void>;
  removeFile(fileId: string): Promise<void>;
  send(via: 'COPY' | 'BOT'): Promise<SendResult>;
  resend(): Promise<SendResult>;
  shareLink(): Promise<{ url: string; expiresAt: string | null; revokedAt: string | null }>;
  extend(): Promise<void>;
  revoke(): Promise<void>;
  result(result: 'APPROVED' | 'REJECTED' | 'MORE_INFO', note?: string): Promise<void>;
  cancel(): Promise<void>;
  ocrIdCard(messageId: string): Promise<OcrIdCard>;
}

export const gfinQueryKey = (roomId: string | null) => ['room-gfin', roomId] as const;

export function useFinanceApplication(roomId: string | null): FinanceApplicationModel {
  const qc = useQueryClient();
  const query = useQuery<RoomFinanceData>({
    queryKey: gfinQueryKey(roomId),
    enabled: !!roomId,
    queryFn: async () => (await api.get(`/staff-chat/rooms/${roomId}/finance-applications`)).data,
    refetchInterval: (q) => (q.state.data?.current && q.state.data.current.status !== 'DRAFT' ? 15000 : false),
  });
  const current = query.data?.current ?? null;
  const previewQuery = useQuery<FinancePreview>({
    queryKey: ['room-gfin-preview', current?.id, current?.files.length, current?.customerId, current?.productId, current?.occupationOverride, current?.messageOverride],
    enabled: !!current && (current.status === 'DRAFT' || current.status === 'MORE_INFO'),
    queryFn: async () => (await api.get(`/finance-applications/${current!.id}/message-preview`)).data,
  });
  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: gfinQueryKey(roomId) });
    await qc.invalidateQueries({ queryKey: ['room-gfin-preview'] });
  };
  const mutation = useMutation({
    mutationKey: ['room-gfin-action', roomId],
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: invalidate,
  });
  const run = <T,>(fn: () => Promise<T>) => mutation.mutateAsync(fn) as Promise<T>;
  const need = () => { if (!current) throw new Error('ยังไม่มีใบยื่น'); return current.id; };
  const base = () => `/finance-applications/${need()}`;
  return {
    roomId, current, history: query.data?.history ?? [], preview: previewQuery.data ?? null,
    step: gfinStep(current, previewQuery.data ?? null),
    loading: query.isLoading, busy: mutation.isPending,
    start: () => run(async () => (await api.post(`/staff-chat/rooms/${roomId}/finance-applications`)).data),
    update: (patch) => run(async () => { await api.patch(base(), patch); }),
    attachMessage: (messageId, slot) => run(async () => { await api.post(`${base()}/files/from-message`, { messageId, slot }, { timeout: 120000 }); toast.success(`ใส่ช่อง "${slot}" แล้ว`); }),
    upload: (slot, files) => run(async () => {
      const failures: string[] = [];
      for (const [i, file] of files.entries()) {
        try {
          const form = new FormData(); form.append('file', file); form.append('slot', slot);
          await api.post(`${base()}/files`, form, { timeout: 120000, headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (error) { failures.push(`ไฟล์ที่ ${i + 1}: ${getErrorMessage(error)}`); }
      }
      if (failures.length) toast.error(failures.join('\n')); else toast.success(`อัปโหลด ${files.length} ไฟล์แล้ว`);
    }),
    fromProduct: () => run(async () => { const r = await api.post(`${base()}/files/from-product`); toast.success(`ดึงรูป ${r.data?.length ?? 6} มุมจากสต๊อกแล้ว`); }),
    removeFile: (fileId) => run(async () => { await api.delete(`${base()}/files/${fileId}`); }),
    send: (via) => run(async () => (await api.post(`${base()}/send`, { via })).data),
    resend: () => run(async () => (await api.post(`${base()}/resend`)).data),
    shareLink: () => run(async () => (await api.get(`${base()}/share-link`)).data),
    extend: () => run(async () => { await api.post(`${base()}/share/extend`); toast.success('ต่ออายุลิงก์อีก 7 วันแล้ว'); }),
    revoke: () => run(async () => { await api.post(`${base()}/share/revoke`); toast.success('ยกเลิกลิงก์แล้ว'); }),
    result: (result, note) => run(async () => { await api.post(`${base()}/result`, { result, note }); toast.success('บันทึกผลแล้ว'); }),
    cancel: () => run(async () => { await api.post(`${base()}/cancel`); toast.success('ยกเลิกใบยื่นแล้ว'); }),
    ocrIdCard: (messageId) => run(async () => (await api.post(`/staff-chat/rooms/${roomId}/finance-applications/ocr-id-card`, { messageId }, { timeout: 90000 })).data),
  };
}
```
(ข้อความ toast ของ `attachMessage` ให้ใช้ป้ายไทย `SLOT_LABELS[slot]` ไม่ใช่ค่า enum — import `SLOT_LABELS` จาก `../components/gfin/gfin`)

Run เทสต์ Step 3 → Expected: PASS 3 · `./tools/check-types.sh web` → 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/gfin apps/web/src/pages/UnifiedInboxPage/hooks/useFinanceApplication.ts apps/web/src/pages/UnifiedInboxPage/hooks/useFinanceApplication.test.tsx
git commit -m "feat(gfin): web types/helpers + hook useFinanceApplication"
```

---

### Task 9: เว็บ — ปุ่ม GFIN ข้างรูปในแชท, ลากไปวางแผงขวา, แท็บ "GFIN" ใน RoomDossier, popover เลือกช่อง

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx` (props `onGfinMessage`, `gfinAttached`, `gfinBusy`; message type เพิ่ม `externalMessageId`)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.test.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (ส่งต่อ 3 props)
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (เรียก `useFinanceApplication` + slot picker state + ส่ง props)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx` (แท็บที่ 4 + drop → เลือกช่อง)
- Create: `apps/web/src/pages/UnifiedInboxPage/components/gfin/GfinSlotPicker.tsx` + `GfinSlotPicker.test.tsx`
- Create: `apps/web/src/pages/UnifiedInboxPage/components/gfin/GfinTab.tsx` (โครงเปล่าใน Task นี้ — เนื้อหาเต็มใน Task 10)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx`

**Interfaces:**
- Consumes: `GFIN_MESSAGE_MIME`, `isGfinPickable`, `SLOT_LABELS`, `PRIMARY_SLOTS`, `slotCounts`, `needsAttention` (Task 8) · `FinanceApplicationModel` (Task 8)
- Produces:
  - `MessageBubbleProps` เพิ่ม `onGfinMessage?: (messageId: string) => void; gfinAttached?: boolean; gfinBusy?: boolean` และ `message.externalMessageId?: string | null`
  - `ChatPanelProps` เพิ่ม `onGfinMessage?`, `gfinMessageIds?: string[]`, `gfinBusy?`
  - `RoomDossierProps` เพิ่ม `gfin?: FinanceApplicationModel; onPickSlot?: (messageId: string) => void; gfinFocus?: { roomId: string; tick: number } | null`
  - `GfinSlotPicker({ open, onOpenChange, counts, onPick(slot), title? })` · `GfinTab({ room, customerId, gfin, onPickSlotForMessage })`
  - `TabKey` เพิ่ม `'gfin'` ป้าย "GFIN" + จุดสีเหลือง (`bg-warning`) เมื่อ `needsAttention(gfin.current)`

- [ ] **Step 1: เทสต์ MessageBubble ล้มก่อน (ต่อท้ายไฟล์ test เดิม)**

```tsx
describe('GFIN pick button', () => {
  const base = { id: 'm1', role: 'CUSTOMER', type: 'IMAGE', mediaUrl: 'https://scontent.xx.fbcdn.net/a.jpg', createdAt: '2026-09-24T12:00:00Z' };
  it('shows the GFIN button for a pickable image and calls onGfinMessage with the id', () => {
    const onGfin = vi.fn();
    render(<MessageBubble message={base} onGfinMessage={onGfin} />);
    fireEvent.click(screen.getByRole('button', { name: 'ใส่ในใบยื่น GFIN' }));
    expect(onGfin).toHaveBeenCalledWith('m1');
  });
  it('hides the button for a legacy LINE image without media url or message id, shows it when only externalMessageId exists', () => {
    const { rerender } = render(<MessageBubble message={{ ...base, mediaUrl: null, externalMessageId: null }} onGfinMessage={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'ใส่ในใบยื่น GFIN' })).toBeNull();
    rerender(<MessageBubble message={{ ...base, mediaUrl: null, externalMessageId: '9' }} onGfinMessage={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'ใส่ในใบยื่น GFIN' })).toBeInTheDocument();
  });
  it('drag start writes both the credit and GFIN MIME payloads', () => {
    render(<MessageBubble message={base} onGfinMessage={vi.fn()} onCreditMessage={vi.fn()} />);
    const setData = vi.fn();
    const bubble = screen.getByRole('button', { name: 'ใส่ในใบยื่น GFIN' }).parentElement!;
    fireEvent.dragStart(bubble, { dataTransfer: { setData, clearData: vi.fn(), types: [] } });
    expect(setData).toHaveBeenCalledWith('application/x-bestchoice-gfin-message', 'm1');
    expect(setData).toHaveBeenCalledWith('application/x-bestchoice-credit-message', 'm1');
  });
  it('marks an attached message and offers removal on the second click', () => {
    const onGfin = vi.fn();
    render(<MessageBubble message={base} onGfinMessage={onGfin} gfinAttached />);
    fireEvent.click(screen.getByRole('button', { name: 'เอาออกจากใบยื่น GFIN' }));
    expect(onGfin).toHaveBeenCalledWith('m1');
  });
});
```
Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/MessageBubble.test.tsx` → Expected: FAIL

- [ ] **Step 2: MessageBubble**

```tsx
import { Landmark } from 'lucide-react';
import { GFIN_MESSAGE_MIME, isGfinPickable } from './gfin/gfin';
// props
  onGfinMessage?: (messageId: string) => void;
  gfinAttached?: boolean;
  gfinBusy?: boolean;
  message: { /* เดิม */ externalMessageId?: string | null; };
// ในคอมโพเนนต์
  const canGfin = !!onGfinMessage && isGfinPickable(message);
  const draggable = (canCredit || canGfin) && !mediaBroken && !creditBusy && !gfinBusy;
  // <div draggable={draggable} onDragStart={...}>: ใส่ทั้งสอง MIME เมื่อเข้าเงื่อนไข
  //   if (canCredit) event.dataTransfer.setData(CREDIT_MESSAGE_MIME, message.id);
  //   if (canGfin) event.dataTransfer.setData(GFIN_MESSAGE_MIME, message.id);
  // ปุ่ม GFIN — วางใต้ปุ่มเครดิต (top ขยับลง 12 = h-11 + gap) ฝั่งเดียวกัน
  {canGfin && <button type="button"
    aria-label={gfinAttached ? 'เอาออกจากใบยื่น GFIN' : 'ใส่ในใบยื่น GFIN'}
    title={mediaBroken ? 'ไฟล์อาจหมดอายุ กรุณาขอไฟล์ใหม่' : gfinAttached ? 'อยู่ในใบยื่นแล้ว · กดเพื่อเอาออก' : 'ใส่ในใบยื่น GFIN · ลูกค้าไม่เห็น'}
    disabled={mediaBroken || gfinBusy}
    onClick={event => { event.stopPropagation(); onGfinMessage?.(message.id); }}
    className={cn('absolute flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed',
      canCredit ? (canCopy ? 'top-20' : 'top-[52px]') : (canCopy ? 'top-8' : 'top-1'), isCustomer ? '-right-12' : '-left-12', gfinAttached ? 'text-primary opacity-100' : 'opacity-0')}>
    {gfinAttached ? <Check className="size-4" /> : <Landmark className="size-4" />}
  </button>}
```
(ปุ่มเครดิตเดิมใช้ `canCredit` ที่ต้องมี `mediaUrl` — ห้อง LINE เก่าที่ไม่มี `mediaUrl` จึงไม่มีปุ่มเครดิตแต่ยังมีปุ่ม GFIN ได้ถ้ามี `externalMessageId` — ตรงกับ Review Focus ข้อ 6)

Run เทสต์ Step 1 → Expected: PASS 4 (เทสต์เดิมของไฟล์ต้องยังผ่าน)

- [ ] **Step 3: ChatPanel + index ส่ง props**

`ChatPanel.tsx` — props เพิ่ม `onGfinMessage?: (messageId: string) => void; gfinMessageIds?: string[]; gfinBusy?: boolean;` (default `gfinMessageIds = []`) และที่ `<MessageBubble …>` เพิ่ม `onGfinMessage={onGfinMessage} gfinAttached={gfinMessageIds.includes(item.data.id)} gfinBusy={gfinBusy}`.

`index.tsx` (ถัดจาก `const credit = useRoomCredit(...)`):
```tsx
import { useFinanceApplication } from './hooks/useFinanceApplication';
import GfinSlotPicker from './components/gfin/GfinSlotPicker';
import { slotCounts, SLOT_LABELS } from './components/gfin/gfin';
  const gfin = useFinanceApplication(activeRoomId);
  const [slotPick, setSlotPick] = useState<{ roomId: string; messageId: string } | null>(null);
  const [gfinFocus, setGfinFocus] = useState<{ roomId: string; tick: number } | null>(null);
  /* กดปุ่ม GFIN ข้างรูป / ลากมาวาง: ยังไม่มีใบยื่น → สร้างร่างก่อนแล้วค่อยถามช่อง (mockup PickSlot)
     หยิบซ้ำ = เอาออก (spec §6.4 — เหมือนตรวจเครดิต) เฉพาะไฟล์ที่ยังไม่ถูกส่ง; ส่งแล้วต้องเลือกช่องใหม่แทน */
  const pickSlotForMessage = async (messageId: string) => {
    if (!activeRoomId) return;
    const attached = gfin.current?.files.find(f => f.sourceMessageId === messageId && !f.sentAt);
    if (attached) { await gfin.removeFile(attached.id); return; }
    if (!gfin.current) { try { await gfin.start(); } catch { return; } }
    setSlotPick({ roomId: activeRoomId, messageId });
  };
  const onSlotPicked = async (slot: FinanceSlot) => {
    if (!slotPick) return;
    setSlotPick(null);
    await gfin.attachMessage(slotPick.messageId, slot);
    setGfinFocus({ roomId: slotPick.roomId, tick: Date.now() });
    if (window.innerWidth < 1280) setCustomerPanelOpen(true);
  };
```
ส่งเข้า `<ChatPanel … onGfinMessage={pickSlotForMessage} gfinMessageIds={gfin.current?.files.flatMap(f => f.sourceMessageId ? [f.sourceMessageId] : []) ?? []} gfinBusy={gfin.busy} />` และ `<RoomDossier … gfin={gfin} gfinFocus={gfinFocus} onPickSlot={pickSlotForMessage} />` ทั้งสองจุด (desktop + Sheet) · วาง `<GfinSlotPicker open={!!slotPick && slotPick.roomId === activeRoomId} onOpenChange={(o) => !o && setSlotPick(null)} counts={slotCounts(gfin.current?.files ?? [])} onPick={onSlotPicked} />` ท้าย JSX ของหน้า

- [ ] **Step 4: เทสต์ GfinSlotPicker ล้มก่อน**

`components/gfin/GfinSlotPicker.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GfinSlotPicker from './GfinSlotPicker';
import { SLOT_ORDER } from './gfin';

const counts = Object.fromEntries(SLOT_ORDER.map((s) => [s, 0])) as Record<(typeof SLOT_ORDER)[number], number>;

describe('GfinSlotPicker', () => {
  it('lists the 9 primary slots with counts, reveals the optional ones on demand, and confirms the chosen slot', () => {
    const onPick = vi.fn();
    render(<GfinSlotPicker open onOpenChange={vi.fn()} counts={{ ...counts, INCOME: 5 }} onPick={onPick} />);
    expect(screen.getByText('ใส่ช่องไหนของใบยื่น GFIN?')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(9);
    expect(screen.getByRole('radio', { name: /สลิปเงินเดือน/ })).toHaveTextContent('5 → 6');
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มช่อง' }));
    expect(screen.getAllByRole('radio')).toHaveLength(13);
    fireEvent.click(screen.getByRole('radio', { name: /บัตรประชาชน/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ใส่ช่องนี้' }));
    expect(onPick).toHaveBeenCalledWith('ID_CARD');
  });
  it('confirm is disabled until a slot is chosen', () => {
    render(<GfinSlotPicker open onOpenChange={vi.fn()} counts={counts} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'ใส่ช่องนี้' })).toBeDisabled();
  });
});
```
Run → Expected: FAIL

- [ ] **Step 5: GfinSlotPicker**

```tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PRIMARY_SLOTS, SLOT_LABELS, SLOT_ORDER, type FinanceSlot } from './gfin';

export default function GfinSlotPicker({ open, onOpenChange, counts, onPick, title = 'ใส่ช่องไหนของใบยื่น GFIN?' }: {
  open: boolean; onOpenChange: (open: boolean) => void; counts: Record<FinanceSlot, number>; onPick: (slot: FinanceSlot) => void; title?: string;
}) {
  const [slot, setSlot] = useState<FinanceSlot | null>(null);
  const [showAll, setShowAll] = useState(false);
  const slots = showAll ? SLOT_ORDER : SLOT_ORDER.filter((s) => PRIMARY_SLOTS.includes(s) || counts[s] > 0);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setSlot(null); setShowAll(false); } onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div role="radiogroup" aria-label="ช่องเอกสาร" className="grid max-h-[60vh] gap-1.5 overflow-y-auto">
          {slots.map((s) => {
            const on = slot === s;
            return (
              <button key={s} type="button" role="radio" aria-checked={on} onClick={() => setSlot(s)}
                className={cn('flex min-h-11 items-center justify-between rounded-lg border px-3 text-left text-sm leading-snug', on ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>
                <span>{SLOT_LABELS[s]}</span>
                <span className="text-xs font-semibold text-muted-foreground">{on ? `${counts[s]} → ${counts[s] + 1}` : counts[s] || ''}</span>
              </button>
            );
          })}
        </div>
        {!showAll && <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>เพิ่มช่อง</Button>}
        <p className="m-0 text-xs leading-snug text-muted-foreground">ระบบคัดลอกรูปเก็บไว้ทันที ลิงก์ Facebook หมดอายุก็ไม่หาย · ลูกค้าไม่เห็น</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button disabled={!slot} onClick={() => slot && onPick(slot)}>ใส่ช่องนี้</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
Run เทสต์ Step 4 → Expected: PASS 2

- [ ] **Step 6: เทสต์ RoomDossier ล้มก่อน (ต่อท้ายไฟล์ test เดิม — ใช้ helper `renderDossier`/mock ของไฟล์นั้น)**

```tsx
vi.mock('./gfin/GfinTab', () => ({ __esModule: true, default: (p: { gfin?: { current?: { number?: string } | null } }) => <div data-testid="gfin-tab">{p.gfin?.current?.number ?? 'none'}</div> }));
describe('GFIN tab', () => {
  const gfin = (current: any) => ({ roomId: 'r1', current, history: [], preview: null, step: 1, loading: false, busy: false, start: vi.fn(), update: vi.fn(), attachMessage: vi.fn(), upload: vi.fn(), fromProduct: vi.fn(), removeFile: vi.fn(), send: vi.fn(), resend: vi.fn(), shareLink: vi.fn(), extend: vi.fn(), revoke: vi.fn(), result: vi.fn(), cancel: vi.fn(), ocrIdCard: vi.fn() });
  it('renders a 4th tab "GFIN" with an attention dot for an unseen GFIN event; opening the tab clears the dot', async () => {
    localStorage.clear();
    renderDossier({ room: baseRoom, customerId: 'c1', gfin: gfin({ id: 'a', number: 'BC-1', status: 'MORE_INFO', lastPartnerEventAt: '2026-09-24T12:14:00Z', resultSource: null, files: [], events: [] }) });
    const tab = screen.getByRole('tab', { name: /GFIN/ });
    expect(within(tab).getByLabelText('มีความเคลื่อนไหวจาก GFIN')).toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.getByTestId('gfin-tab')).toHaveTextContent('BC-1');
    await waitFor(() => expect(within(tab).queryByLabelText('มีความเคลื่อนไหวจาก GFIN')).toBeNull());
    expect(localStorage.getItem('gfin-seen:a')).toBe('2026-09-24T12:14:00Z');
  });
  it('dropping a chat message while the GFIN tab is open asks for a slot instead of attaching to credit', () => {
    const onPickSlot = vi.fn();
    const credit = { files: [], toggleMessage: vi.fn(), upload: vi.fn(), busy: false } as any;
    renderDossier({ room: baseRoom, customerId: 'c1', credit, gfin: gfin(null), onPickSlot });
    fireEvent.click(screen.getByRole('tab', { name: /GFIN/ }));
    const aside = screen.getByRole('complementary', { name: 'ข้อมูลลูกค้า' });
    fireEvent.drop(aside, { dataTransfer: { types: ['application/x-bestchoice-gfin-message', 'application/x-bestchoice-credit-message'], getData: (t: string) => (t.endsWith('gfin-message') || t.endsWith('credit-message') ? 'm1' : ''), files: [] } });
    expect(onPickSlot).toHaveBeenCalledWith('m1');
    expect(credit.toggleMessage).not.toHaveBeenCalled();
  });
});
```
Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/RoomDossier.test.tsx` → Expected: FAIL

- [ ] **Step 7: RoomDossier**

```tsx
import GfinTab from './gfin/GfinTab';
import { GFIN_MESSAGE_MIME, needsAttention, readSeen, markSeen } from './gfin/gfin';
import type { FinanceApplicationModel } from '../hooks/useFinanceApplication';
type TabKey = 'customer' | 'money' | 'device' | 'gfin';
interface RoomDossierProps { /* เดิม */ gfin?: FinanceApplicationModel; gfinFocus?: { roomId: string; tick: number } | null; onPickSlot?: (messageId: string) => void; }
// tabs: เพิ่มรายการที่ 4 — จุดเหลืองเมื่อมีเหตุการณ์ GFIN ใหม่กว่าครั้งล่าสุดที่เปิดแท็บ (spec §6.1)
  const gfinApp = gfin?.current ?? null;
  const [seenTick, setSeenTick] = useState(0);
  const gfinDot = needsAttention(gfinApp, gfinApp ? readSeen(gfinApp.id) : null);
  useEffect(() => { if (tab === 'gfin' && gfinApp) { markSeen(gfinApp); setSeenTick(t => t + 1); } }, [tab, gfinApp?.id, gfinApp?.lastPartnerEventAt]);   // seenTick บังคับ re-render หลัง markSeen
    { key: 'gfin', label: 'GFIN', dot: gfinDot },
// ปุ่มแท็บ: หลัง {t.label} เพิ่ม
    {t.dot && <span aria-label="มีความเคลื่อนไหวจาก GFIN" className="size-2 rounded-full bg-warning" />}
// gfinFocus → เปิดแท็บ GFIN (เหมือน creditFocus แต่ไม่ต้อง scroll)
  useEffect(() => { if (gfinFocus && gfinFocus.roomId === room?.id) setTab('gfin'); }, [gfinFocus, room?.id]);
// acceptsCredit: รับ GFIN MIME ด้วยเมื่ออยู่แท็บ gfin
  const acceptsDrop = (event: React.DragEvent) => {
    const types = Array.from(event.dataTransfer.types);
    if (tab === 'gfin') return !!gfin && types.some(t => t === 'Files' || t === GFIN_MESSAGE_MIME);
    return !!credit && types.some(t => t === 'Files' || t === CREDIT_MESSAGE_MIME);
  };
// onDrop: แยกสองทาง
  if (tab === 'gfin') {
    const messageId = event.dataTransfer.getData(GFIN_MESSAGE_MIME);
    if (messageId) onPickSlot?.(messageId); else window.dispatchEvent(new CustomEvent('gfin-drop-files', { detail: Array.from(event.dataTransfer.files) }));
    return;
  }
  /* เดิม: เครดิต */
// overlay ตอนลาก: ข้อความตามแท็บ — 'วางที่นี่ = ใส่ในใบยื่น GFIN' เมื่อ tab === 'gfin'
// เนื้อหาแท็บ
  {tab === 'gfin' && <GfinTab room={room} customerId={customerId} gfin={gfin} onPickSlotForMessage={onPickSlot} />}
```
(ไฟล์ที่ลากจากเครื่องมาวางบนแท็บ GFIN: `GfinTab` ฟัง `window` event `gfin-drop-files` แล้วเปิด slot picker ของตัวเองก่อนอัปโหลด — ทำใน Task 10; ทางเลือกนี้เลี่ยงส่ง callback ผ่าน props ซ้อนหลายชั้น · แทนที่ `acceptsCredit` ทุกจุดด้วย `acceptsDrop`)

`GfinTab.tsx` โครงชั่วคราวเพื่อให้ Task นี้ compile และเทสต์ผ่าน:
```tsx
import type { DossierRoom } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
export interface GfinTabProps { room: DossierRoom; customerId: string | null; gfin?: FinanceApplicationModel; onPickSlotForMessage?: (messageId: string) => void }
export default function GfinTab({ gfin }: GfinTabProps) {
  return <div className="p-2.5 text-xs text-muted-foreground">{gfin?.current ? `ใบยื่น ${gfin.current.number}` : 'ยังไม่มีใบยื่น'}</div>;
}
```
Run เทสต์ Step 6 → Expected: PASS 2 · เทสต์เดิมทั้งไฟล์ยังผ่าน · `./tools/check-types.sh web` → 0 errors

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage
git commit -m "feat(gfin): ปุ่ม GFIN ข้างรูปในแชท, ลากวางแผงขวา, แท็บ GFIN, popover เลือกช่อง"
```

---

### Task 10: เว็บ — แท็บ GFIN: ขั้น 1 ลูกค้า (OCR บัตรจากแชท) · ขั้น 2 เครื่อง · ขั้น 3 รูป · ขั้น 4 ข้อความ+ส่ง · การ์ดสถานะ+ประวัติ

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/gfin/GfinTab.tsx` (แทนโครงชั่วคราว)
- Create: `apps/web/src/pages/UnifiedInboxPage/components/gfin/GfinStepCustomer.tsx` · `GfinStepProduct.tsx` · `GfinStepFiles.tsx` · `GfinStepMessage.tsx` · `GfinStatusCard.tsx` · `GfinTab.test.tsx`
- Modify: `apps/web/src/components/customer/CustomerCreateDialog.tsx` (prop `initialAddressIdCard?: AddressData`)

**Interfaces:**
- Consumes: `FinanceApplicationModel` (Task 8) · `GfinSlotPicker` (Task 9) · `LinkCustomerDialog` (`{ open, onOpenChange, roomId, mergesProspect?, onLinked? }`) · `useLinkRoomCustomer(roomId, { onSuccess })` (`hooks/useLinkRoomCustomer.ts:29`) · `CustomerCreateDialog` (`initialValues`, `onCreated(customer)`) · `GET /staff-chat/products/search?q=` (`ChatProductHit[]` — ค้น name/brand/model/**imeiSerial** `contains` แล้ว `chat-commerce.service.ts:211-218`) · `PATCH /customers/:id` (`UpdateCustomerDto` มี `occupation`, `birthDate`, `phone`) · `openCreditDocument(url)` จาก `@/lib/credit-document` (เปิดไฟล์ผ่าน blob พร้อม header auth) · `useCopyToClipboard()` จาก `@/hooks/useCopyToClipboard` · `formatThaiDateTime` จาก `@/lib/date` · `Group` จาก `../RoomDossier`
- Produces: `GfinTab` เต็ม (props ตาม Task 9) · `CustomerCreateDialogProps.initialAddressIdCard`

- [ ] **Step 1: prop `initialAddressIdCard` ใน CustomerCreateDialog + ให้ `openCreditDocument` รู้จัก URL ไฟล์ของใบยื่น**

`apps/web/src/lib/credit-document.ts` — regex เดิม match เฉพาะ `/staff-chat/rooms/:id/credit-check/files/:fileId`; ถ้าไม่ขยาย ไฟล์ของใบยื่นจะถูก `window.open` ตรง ๆ โดยไม่มี header auth (401):
```ts
export const isRoomCreditDocument = (url: string) =>
  /^\/staff-chat\/rooms\/[^/]+\/credit-check\/files\/[^/?#]+$/.test(url) ||
  /^\/finance-applications\/[^/]+\/files\/[^/?#]+$/.test(url);
```
(เพิ่มเทสต์ 1 ข้อใน `credit-document.test.ts` ถ้ามีไฟล์นั้น — ไม่มีก็สร้าง: URL ใบยื่นต้องคืน `true`, URL ภายนอกคืน `false`)


```tsx
// CustomerCreateDialogProps เพิ่ม
  /** ที่อยู่ตามบัตรตั้งต้น (จาก OCR รูปบัตรในแชท — แท็บ GFIN) */
  initialAddressIdCard?: AddressData;
// CustomerCreateForm: destructure `initialAddressIdCard` และ
  const [addressIdCard, setAddressIdCard] = useState<AddressData>(initialAddressIdCard ?? emptyAddress);
```
(ฟอร์ม mount เฉพาะตอน `open` จึงใช้เป็นค่าตั้งต้นได้ตรง ๆ — ไม่ต้อง `useEffect`)
Run: `cd apps/web && npx vitest run src/components/customer` → Expected: เทสต์เดิมผ่าน

- [ ] **Step 2: เทสต์ GfinTab ล้มก่อน**

`components/gfin/GfinTab.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
const get = vi.fn(); const patch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), default: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/customer/CustomerCreateDialog', () => ({ __esModule: true, default: (p: { open: boolean; initialValues?: { firstName?: string } }) => (p.open ? <div data-testid="create-dialog">{p.initialValues?.firstName}</div> : null) }));
vi.mock('../LinkCustomerDialog', () => ({ __esModule: true, default: (p: { open: boolean }) => (p.open ? <div data-testid="link-dialog" /> : null) }));
import GfinTab from './GfinTab';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';

const room = { id: 'r1', channel: 'FACEBOOK', displayName: 'Somying J.', customer: null } as any;
const model = (over: Partial<FinanceApplicationModel> = {}): FinanceApplicationModel => ({
  roomId: 'r1', current: null, history: [], preview: null, step: 1, loading: false, busy: false,
  start: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue(undefined), attachMessage: vi.fn(), upload: vi.fn(), fromProduct: vi.fn(), removeFile: vi.fn(),
  send: vi.fn().mockResolvedValue({ application: {}, messageText: 'TEXT', shareUrl: 'https://x/api/g/t' }), resend: vi.fn(), shareLink: vi.fn(), extend: vi.fn(), revoke: vi.fn(), result: vi.fn(), cancel: vi.fn(),
  ocrIdCard: vi.fn().mockResolvedValue({ nationalId: '1234567890123', nationalIdValid: true, prefix: 'น.ส.', firstName: 'สมหญิง', lastName: 'ใจดี', fullName: null, birthDate: '1997-12-27', address: null, addressStructured: null, confidence: 0.95 }),
  ...over,
});
const app = (over: Record<string, unknown> = {}) => ({ id: 'a1', number: 'BC-260924-001', status: 'DRAFT', roomId: 'r1', customerId: null, productId: null, customer: null, product: null, occupationOverride: null, messageOverride: null, messageText: null, sentAt: null, sentVia: null, resultSource: null, shareExpiresAt: null, shareRevokedAt: null, shareViewCount: 0, shareLastViewedAt: null, lastPartnerEventAt: null, closedAt: null, files: [], events: [], createdAt: '2026-09-24T12:00:00Z', ...over }) as any;
const renderTab = (gfin: FinanceApplicationModel, customerId: string | null = null) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><GfinTab room={room} customerId={customerId} gfin={gfin} onPickSlotForMessage={vi.fn()} /></MemoryRouter></QueryClientProvider>);
};
beforeEach(() => { get.mockReset(); patch.mockReset(); });

describe('GfinTab', () => {
  it('empty state offers "เริ่มใบยื่น" and starts a draft', async () => {
    const gfin = model();
    renderTab(gfin);
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มใบยื่น' }));
    await waitFor(() => expect(gfin.start).toHaveBeenCalled());
  });
  it('step 1 without a linked customer: reading an ID-card image pre-fills the create dialog', async () => {
    const gfin = model({ current: app({ files: [{ id: 'f1', slot: 'ID_CARD', sourceMessageId: 'm1', mimeType: 'image/jpeg', size: 1, originalName: null, source: 'CHAT_MESSAGE', sourceAngle: null, sortOrder: 0, sentAt: null, createdAt: '' }] }), step: 1 });
    renderTab(gfin);
    fireEvent.click(screen.getByRole('button', { name: 'อ่านบัตรจากรูปที่หยิบไว้' }));
    await waitFor(() => expect(gfin.ocrIdCard).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText('อ่านบัตรแล้ว (OCR) · ตรวจทานก่อนสร้าง')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'สร้างลูกค้าและผูกห้อง' }));
    expect(screen.getByTestId('create-dialog')).toHaveTextContent('สมหญิง');
  });
  it('step 1 with a linked customer missing occupation: inline save PATCHes the customer', async () => {
    patch.mockResolvedValue({ data: {} });
    const gfin = model({ current: app({ customerId: 'c1', customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0937581095', occupation: null, birthDate: '1997-12-27' } }), preview: { text: '', values: {}, missingFields: ['occupation'], missingRequiredSlots: [], warnings: [], canSend: false }, step: 1 });
    renderTab(gfin, 'c1');
    fireEvent.change(screen.getByLabelText('อาชีพ'), { target: { value: 'พนักงานบริษัท' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกอาชีพ' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/customers/c1', { occupation: 'พนักงานบริษัท' }));
  });
  it('step 4 copy flow: confirm dialog → send(COPY) → text copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const gfin = model({ current: app({ customerId: 'c1', productId: 'p1', product: { id: 'p1', name: 'iPhone 13 Pro Max', brand: 'Apple', model: '13 Pro Max', storage: '256GB', color: 'ทอง', imeiSerial: '355908667841899', category: 'PHONE_USED', status: 'IN_STOCK' }, customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0937581095', occupation: 'พนักงาน', birthDate: '1997-12-27' } }), preview: { text: '1.ชื่อลูกค้า : สมหญิง ใจดี', values: {}, missingFields: [], missingRequiredSlots: [], warnings: ['ยังไม่มีรูปหน้าจอตั้งค่าเครื่อง'], canSend: true }, step: 4 });
    renderTab(gfin, 'c1');
    expect(screen.getByText('1.ชื่อลูกค้า : สมหญิง ใจดี')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ส่งเช็ค GFIN' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'คัดลอกข้อความ + ลิงก์' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /ตรวจแล้วว่าไฟล์ทุกใบเป็นของลูกค้าคนนี้/ }));
    fireEvent.click(screen.getByRole('button', { name: 'คัดลอกและทำเครื่องหมายว่าส่งแล้ว' }));
    await waitFor(() => expect(gfin.send).toHaveBeenCalledWith('COPY'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('TEXT'));
  });
  it('status card after MORE_INFO shows the partner note, resend, and staff result buttons', () => {
    const gfin = model({ current: app({ status: 'MORE_INFO', customerId: 'c1', productId: 'p1', sentAt: '2026-09-24T12:04:00Z', shareExpiresAt: '2026-10-01T12:04:00Z', shareViewCount: 2, lastPartnerEventAt: '2026-09-24T12:14:00Z', events: [{ id: 'e1', kind: 'SENT', actorType: 'STAFF', actorUserId: 'u', actorName: null, note: null, meta: null, createdAt: '2026-09-24T12:04:00Z' }, { id: 'e2', kind: 'PARTNER_MORE_INFO', actorType: 'PARTNER', actorUserId: null, actorName: null, note: 'ขอรูปหน้าจอแบตเพิ่มค่ะ', meta: null, createdAt: '2026-09-24T12:14:00Z' }] }), step: 4 });
    renderTab(gfin, 'c1');
    expect(screen.getByText('GFIN ขอเพิ่ม')).toBeInTheDocument();
    expect(screen.getByText(/ขอรูปหน้าจอแบตเพิ่มค่ะ/)).toBeInTheDocument();
    expect(screen.getByText(/เปิดดู 2 ครั้ง/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เพิ่มรูปแล้วส่งเพิ่ม' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ผ่าน (แจ้งผ่านลิงก์)' })).toBeInTheDocument();
  });
});
```
Run: `cd apps/web && npx vitest run src/pages/UnifiedInboxPage/components/gfin/GfinTab.test.tsx` → Expected: FAIL

- [ ] **Step 3: `GfinTab.tsx` (โครง + สลับหน้าจอ)**

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Group } from '../RoomDossier';
import type { DossierRoom } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import { GFIN_LINE_GROUP, STATUS_LABEL, type FinanceSlot } from './gfin';
import GfinSlotPicker from './GfinSlotPicker';
import GfinStepCustomer from './GfinStepCustomer';
import GfinStepProduct from './GfinStepProduct';
import GfinStepFiles from './GfinStepFiles';
import GfinStepMessage from './GfinStepMessage';
import GfinStatusCard from './GfinStatusCard';
import { slotCounts } from './gfin';
import { formatThaiDateShort } from '@/lib/date';

export interface GfinTabProps { room: DossierRoom; customerId: string | null; gfin?: FinanceApplicationModel; onPickSlotForMessage?: (messageId: string) => void }
const STEP_LABEL = ['ลูกค้า', 'เครื่อง', 'รูป', 'ข้อความ'];

export default function GfinTab({ room, customerId, gfin, onPickSlotForMessage }: GfinTabProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | null>(null);       // null = ตามระบบ (gfin.step) · ผู้ใช้กดย้อน/ข้ามได้
  const [dropFiles, setDropFiles] = useState<File[] | null>(null);
  useEffect(() => { setStep(null); }, [gfin?.current?.id]);
  useEffect(() => {
    const handler = (e: Event) => setDropFiles((e as CustomEvent<File[]>).detail);
    window.addEventListener('gfin-drop-files', handler);
    return () => window.removeEventListener('gfin-drop-files', handler);
  }, []);
  if (!gfin) return null;
  const app = gfin.current;
  const active = step ?? gfin.step;

  if (!app) return (
    <div className="flex flex-col gap-2.5 p-2.5">
      <Group label="ใบยื่นใหม่">
        <p className="m-0 text-sm font-semibold leading-snug">รวมชุดเช็คแล้วส่งเข้ากลุ่มไลน์ GFIN ในคลิกเดียว</p>
        <p className="m-0 mt-1 text-xs leading-snug text-muted-foreground">ข้อความ 12 ข้อ + ลิงก์เอกสารทั้งชุด · ลูกค้าไม่เห็น</p>
        <Button className="mt-2.5 w-full" disabled={gfin.busy} onClick={() => gfin.start()}>เริ่มใบยื่น</Button>
      </Group>
      <Group label="ประวัติใบยื่น" count={gfin.history.length}>
        {gfin.history.length === 0
          ? <p className="m-0 text-xs leading-relaxed text-muted-foreground">ลูกค้าคนนี้ยังไม่เคยยื่น GFIN · ใบที่ส่งแล้วจะเรียงที่นี่พร้อมผล</p>
          : <ul className="m-0 list-none p-0 text-xs">{gfin.history.map(h => <li key={h.id} className="flex justify-between py-1"><span>{h.number} · {formatThaiDateShort(h.createdAt)}</span><span className="font-semibold">{STATUS_LABEL[h.status]}</span></li>)}</ul>}
      </Group>
      <Group label="กลุ่มไลน์ปลายทาง"><p className="m-0 text-xs leading-snug">{GFIN_LINE_GROUP}</p><p className="m-0 text-xs leading-snug text-muted-foreground">ส่งด้วยบอทจะเปิดในเฟสถัดไป · ตอนนี้คัดลอกข้อความ + ลิงก์ไปวางในกลุ่ม</p></Group>
    </div>
  );

  if (app.status !== 'DRAFT') return <GfinStatusCard app={app} gfin={gfin} history={gfin.history} onAddMore={() => setStep(3)} showFilesStep={step === 3} onCloseFiles={() => setStep(null)} onPickSlotForMessage={onPickSlotForMessage} dropFiles={dropFiles} onDropFilesHandled={() => setDropFiles(null)} />;

  return (
    <div className="flex flex-col gap-2.5 p-2.5">
      <Group label="ใบยื่น (ร่าง)" right={<button type="button" className="text-destructive" onClick={() => gfin.cancel()} disabled={gfin.busy}>ยกเลิกใบยื่น</button>}>
        <p className="m-0 text-xs text-muted-foreground">ขั้น {active}/4</p>
        <ol className="m-0 mt-2 grid list-none grid-cols-4 gap-1 p-0" aria-label="ขั้นตอน">
          {STEP_LABEL.map((label, i) => { const n = (i + 1) as 1 | 2 | 3 | 4; const done = n < gfin.step; const on = n === active;
            return <li key={label}><button type="button" onClick={() => setStep(n)} aria-current={on ? 'step' : undefined}
              className={['w-full rounded-md border px-1 py-1 text-[11px] font-semibold leading-snug', on ? 'border-primary bg-primary text-primary-foreground' : done ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'].join(' ')}>{n} {label}</button></li>; })}
        </ol>
      </Group>
      {active === 1 && <GfinStepCustomer room={room} customerId={customerId} gfin={gfin} onNext={() => setStep(2)} />}
      {active === 2 && <GfinStepProduct gfin={gfin} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {active === 3 && <GfinStepFiles gfin={gfin} onBack={() => setStep(2)} onNext={() => setStep(4)} dropFiles={dropFiles} onDropFilesHandled={() => setDropFiles(null)} />}
      {active === 4 && <GfinStepMessage gfin={gfin} onBack={() => setStep(3)} />}
    </div>
  );
}
```

- [ ] **Step 4: `GfinStepCustomer.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Group } from '../RoomDossier';
import type { DossierRoom } from '../RoomDossier';
import LinkCustomerDialog from '../LinkCustomerDialog';
import CustomerCreateDialog from '@/components/customer/CustomerCreateDialog';
import { useLinkRoomCustomer } from '../../hooks/useLinkRoomCustomer';
import type { AddressData } from '@/components/ui/AddressForm';
import type { FinanceApplicationModel, OcrIdCard } from '../../hooks/useFinanceApplication';
import { FIELD_LABELS } from './gfin';
import { formatThaiDate } from '@/lib/date';

export default function GfinStepCustomer({ room, customerId, gfin, onNext }: { room: DossierRoom; customerId: string | null; gfin: FinanceApplicationModel; onNext: () => void }) {
  const qc = useQueryClient();
  const app = gfin.current!;
  const [ocr, setOcr] = useState<OcrIdCard | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const idCardFile = app.files.find(f => f.slot === 'ID_CARD' && f.sourceMessageId);
  const link = useLinkRoomCustomer(room.id, { onSuccess: async (newCustomerId) => { await gfin.update({ customerId: newCustomerId }); toast.success('ผูกลูกค้ากับห้องแล้ว'); } });
  const missing = gfin.preview?.missingFields ?? [];
  const [draft, setDraft] = useState({ occupation: app.customer?.occupation ?? '', phone: app.customer?.phone ?? '', birthDate: app.customer?.birthDate?.slice(0, 10) ?? '' });
  const saveField = useMutation({
    mutationFn: async (patch: Record<string, string>) => api.patch(`/customers/${app.customerId}`, patch),
    onSuccess: async () => { toast.success('บันทึกแล้ว'); await qc.invalidateQueries({ queryKey: ['room-gfin'] }); await qc.invalidateQueries({ queryKey: ['room-gfin-preview'] }); await qc.invalidateQueries({ queryKey: ['customers'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (!app.customerId) return (
    <Group label="1 ลูกค้า">
      <p className="m-0 text-xs leading-relaxed text-muted-foreground">ห้องนี้ยังไม่ผูกลูกค้า · หยิบรูปบัตรประชาชนจากแชท (ลากมาวาง หรือกดปุ่ม GFIN ข้างรูป) เลือกช่อง "บัตรประชาชน" แล้วให้ระบบอ่าน</p>
      {idCardFile && !ocr && <Button size="sm" className="mt-2 w-full" disabled={gfin.busy} onClick={async () => { try { setOcr(await gfin.ocrIdCard(idCardFile.sourceMessageId!)); } catch { /* toast จาก hook */ } }}>อ่านบัตรจากรูปที่หยิบไว้</Button>}
      {ocr && (
        <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2 text-xs leading-snug">
          <p className="m-0 font-semibold">อ่านบัตรแล้ว (OCR) · ตรวจทานก่อนสร้าง</p>
          <dl className="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-muted-foreground">ชื่อ</dt><dd className="m-0">{[ocr.prefix, ocr.firstName, ocr.lastName].filter(Boolean).join(' ') || ocr.fullName || '-'}</dd>
            <dt className="text-muted-foreground">เลขบัตร</dt><dd className="m-0">{ocr.nationalId ?? '-'} {ocr.nationalId && (ocr.nationalIdValid ? '✓' : '✗ ตรวจอีกครั้ง')}</dd>
            <dt className="text-muted-foreground">วันเกิด</dt><dd className="m-0">{ocr.birthDate ? formatThaiDate(ocr.birthDate) : '-'}</dd>
            <dt className="text-muted-foreground">ที่อยู่</dt><dd className="m-0">{ocr.address ?? '-'}</dd>
          </dl>
          <p className="m-0 mt-1 text-muted-foreground">ข้อมูลที่ข้อความ 12 ข้อต้องใช้แต่บัตรไม่มี: อาชีพ · เบอร์โทร — กรอกในฟอร์มสร้างลูกค้า</p>
        </div>
      )}
      <div className="mt-2 grid gap-1.5">
        <Button size="sm" onClick={() => setCreateOpen(true)}>สร้างลูกค้าและผูกห้อง</Button>
        <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>ผูกกับลูกค้าเดิม (ค้นหาจากเลขบัตร/เบอร์)</Button>
      </div>
      <CustomerCreateDialog open={createOpen} onOpenChange={setCreateOpen}
        initialValues={{ prefix: ocr?.prefix ?? undefined, firstName: ocr?.firstName ?? undefined, lastName: ocr?.lastName ?? undefined, nationalId: ocr?.nationalId ?? undefined, birthDate: ocr?.birthDate ?? undefined, ...(room.channel === 'FACEBOOK' && room.displayName ? { facebookName: room.displayName } : {}) }}
        initialAddressIdCard={ocr?.addressStructured as AddressData | undefined}
        context={<span>บันทึกแล้วจะผูกกับห้องแชทนี้และใบยื่น GFIN ให้เอง</span>}
        onCreated={(customer) => link.mutate(customer.id)}
        onUseExisting={(customer) => link.mutate(customer.id)} />
      <LinkCustomerDialog open={linkOpen} onOpenChange={setLinkOpen} roomId={room.id} mergesProspect={!!room.customer?.chatPlaceholder} onLinked={async () => { const fresh = await api.get(`/staff-chat/rooms/${room.id}`); const id = fresh.data?.customer?.id ?? fresh.data?.customerId; if (id) await gfin.update({ customerId: id }); }} />
    </Group>
  );

  return (
    <Group label="1 ลูกค้า" right={<span>{app.customer?.name}</span>}>
      {missing.length === 0 ? <p className="m-0 text-xs text-primary">ข้อมูลครบสำหรับข้อความ 12 ข้อ</p> : <p className="m-0 text-xs text-warning-strong">ยังขาด: {missing.map(f => FIELD_LABELS[f]).join(' · ')}</p>}
      {missing.includes('occupation') && <div className="mt-2 flex gap-1.5"><Input aria-label="อาชีพ" value={draft.occupation} onChange={e => setDraft({ ...draft, occupation: e.target.value })} placeholder="เช่น พนักงานบริษัท" /><Button size="sm" disabled={!draft.occupation.trim() || saveField.isPending} onClick={() => saveField.mutate({ occupation: draft.occupation.trim() })}>บันทึกอาชีพ</Button></div>}
      {missing.includes('phone') && <div className="mt-2 flex gap-1.5"><Input aria-label="เบอร์โทร" inputMode="tel" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="0XXXXXXXXX" /><Button size="sm" disabled={!/^0\d{8,9}$/.test(draft.phone) || saveField.isPending} onClick={() => saveField.mutate({ phone: draft.phone })}>บันทึกเบอร์</Button></div>}
      {missing.includes('age') && <div className="mt-2 flex gap-1.5"><Input aria-label="วันเกิด" type="date" value={draft.birthDate} onChange={e => setDraft({ ...draft, birthDate: e.target.value })} /><Button size="sm" disabled={!draft.birthDate || saveField.isPending} onClick={() => saveField.mutate({ birthDate: draft.birthDate })}>บันทึกวันเกิด</Button></div>}
      <Button size="sm" className="mt-2.5 w-full" disabled={missing.length > 0} onClick={onNext}>ถัดไป: เครื่อง</Button>
    </Group>
  );
}
```
(ตรวจก่อนเขียน: `GET /staff-chat/rooms/:id` คืน `customer.id`/`customerId` ชื่อไหน — ดู `sessionQuery` ใน `index.tsx` และ `DossierRoom.customer` · ถ้า `LinkRoomResult` ของ `useLinkRoomCustomer` มี `customerId` ให้ใช้แทนการ GET ซ้ำ · `prefix` ใน `CustomerFormData` เป็น enum/union? เปิด `apps/web/src/lib/schemas.ts:62` ก่อนส่งค่า OCR ตรง ๆ — ถ้าเป็น union ให้ map ค่าที่ไม่ตรงเป็น `undefined`)

- [ ] **Step 5: `GfinStepProduct.tsx`**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/useDebounce';
import { Group } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import { productLabel, imeiTail } from './gfin';

interface Hit { id: string; name: string; brand: string; model: string; color: string | null; storage: string | null; status: string; category: string; branchName: string | null }
const STATUS: Record<string, string> = { IN_STOCK: 'พร้อมขาย', RESERVED: 'จองแล้ว' };
const HAND = (category: string | null) => (category === 'PHONE_USED' ? 'มือ 2' : 'มือ 1');

export default function GfinStepProduct({ gfin, onBack, onNext }: { gfin: FinanceApplicationModel; onBack: () => void; onNext: () => void }) {
  const app = gfin.current!;
  const [q, setQ] = useState('');
  const debounced = useDebounce(q, 350);
  const search = useQuery<Hit[]>({ queryKey: ['gfin-product-search', debounced], enabled: debounced.trim().length >= 2, queryFn: async () => (await api.get('/staff-chat/products/search', { params: { q: debounced.trim() } })).data });
  const hits = (search.data ?? []).filter(h => h.status === 'IN_STOCK' || h.status === 'RESERVED');
  /* spec §8: มือสองที่รูป 6 มุมครบ → ระบบเติมช่อง DEVICE_PHOTO ให้ตอนเลือกเครื่อง (ลบออกได้ในขั้นรูป) · ไม่ครบ → API 400 พร้อมข้อความชี้ให้ถ่ายเพิ่ม (toast จาก hook) */
  const pick = async (h: Hit) => {
    await gfin.update({ productId: h.id });
    if (h.category === 'PHONE_USED') { try { await gfin.fromProduct(); } catch { /* toast แล้ว — ไปถ่ายเพิ่มในขั้นรูป */ } }
  };
  return (
    <Group label="2 เครื่อง">
      {app.product ? (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-2 text-xs leading-snug">
          <p className="m-0 font-semibold">{productLabel(app.product)}</p>
          <p className="m-0 text-muted-foreground">{HAND(app.product.category)} · {imeiTail(app.product.imeiSerial)} · {STATUS[app.product.status] ?? app.product.status}</p>
          <p className="m-0 mt-1 font-mono">{app.product.imeiSerial}</p>
          <button type="button" className="mt-1 text-primary" onClick={() => gfin.update({ productId: null })}>เปลี่ยนเครื่อง</button>
        </div>
      ) : (
        <>
          <Input aria-label="ค้นหาเครื่องในสต๊อก" placeholder="พิมพ์ IMEI ท้าย 4 ตัว หรือชื่อรุ่น" value={q} onChange={e => setQ(e.target.value)} />
          <ul className="m-0 mt-2 max-h-56 list-none overflow-y-auto p-0">
            {hits.map(h => <li key={h.id}><button type="button" disabled={gfin.busy} onClick={() => pick(h)} className="w-full rounded-md px-2 py-1.5 text-left text-xs leading-snug hover:bg-muted"><span className="font-semibold">{[h.name, h.storage, h.color].filter(Boolean).join(' · ')}</span><br /><span className="text-muted-foreground">{HAND(h.category)} · {STATUS[h.status]}{h.branchName ? ` · ${h.branchName}` : ''}</span></button></li>)}
            {search.isSuccess && hits.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">ไม่พบเครื่องพร้อมขาย/จองที่ตรงคำค้น</li>}
          </ul>
        </>
      )}
      <p className="m-0 mt-2 text-xs leading-snug text-muted-foreground">ข้อ 8 ถึง 12 ในข้อความ (แบต กล่อง สายชาร์จ) ระบบใส่ "-" ให้เสมอ ไม่ต้องตอบ</p>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5"><Button size="sm" variant="outline" onClick={onBack}>ย้อนกลับ</Button><Button size="sm" disabled={!app.productId} onClick={onNext}>ถัดไป: รูป</Button></div>
    </Group>
  );
}
```
(ผลค้นหา `ChatProductHit` ไม่มี IMEI — พิมพ์ท้าย 4 ตัวจะกรองที่ API แล้ว (`imeiSerial contains`) แต่ในรายการโชว์ไม่ได้ · ถ้าอยากโชว์ ให้เพิ่ม `imeiLast4` ใน `searchProducts` ของ `chat-commerce.service.ts` (select `imeiSerial` แล้ว map `slice(-4)`) — ทำได้ในงานนี้ ไม่กระทบผู้เรียกเดิม)

- [ ] **Step 6: `GfinStepFiles.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Group } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import GfinSlotPicker from './GfinSlotPicker';
import { GFIN_ACCEPT, PRIMARY_SLOTS, REQUIRED_SLOTS, SLOT_LABELS, SLOT_ORDER, slotCounts, type FinanceSlot } from './gfin';
import { openCreditDocument } from '@/lib/credit-document';
import { formatThaiTime } from '@/lib/date';

export default function GfinStepFiles({ gfin, onBack, onNext, dropFiles, onDropFilesHandled }: { gfin: FinanceApplicationModel; onBack?: () => void; onNext?: () => void; dropFiles: File[] | null; onDropFilesHandled: () => void }) {
  const app = gfin.current!;
  const counts = slotCounts(app.files);
  const [showAll, setShowAll] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);   // รอเลือกช่อง (อัปโหลด/ลากไฟล์)
  const [uploadSlot, setUploadSlot] = useState<FinanceSlot | null>(null); // กด "อัปโหลด/ถ่าย" ของช่องนั้น → เปิด input
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (dropFiles?.length) { setPendingFiles(dropFiles); onDropFilesHandled(); } }, [dropFiles, onDropFilesHandled]);
  useEffect(() => { if (uploadSlot) input.current?.click(); }, [uploadSlot]);
  const filled = PRIMARY_SLOTS.filter(s => counts[s] > 0).length;
  const slots = showAll ? SLOT_ORDER : SLOT_ORDER.filter(s => PRIMARY_SLOTS.includes(s) || counts[s] > 0);
  const missingRequired = gfin.preview?.missingRequiredSlots ?? REQUIRED_SLOTS.filter(s => counts[s] === 0);
  const usedPhone = app.product?.category === 'PHONE_USED';
  const sourceLine = (slot: FinanceSlot) => { const fs = app.files.filter(f => f.slot === slot); if (!fs.length) return 'ยังไม่มี'; const imgs = fs.filter(f => f.mimeType.startsWith('image/')).length; const pdfs = fs.length - imgs; const src = fs.every(f => f.source === 'PRODUCT_PHOTO') ? 'จากสต๊อก' : fs.some(f => f.source === 'CHAT_MESSAGE') ? `จากแชท ${formatThaiTime(fs[0].createdAt)}` : 'อัปโหลด'; return `${fs.length} ไฟล์${pdfs ? ` · รูป ${imgs} + PDF ${pdfs}` : ''} · ${src}`; };
  return (
    <Group label="3 รูป" count={app.files.length} right={<button type="button" onClick={() => setPendingFiles([])}>อัปโหลด</button>}>
      <p className="m-0 text-xs leading-snug text-muted-foreground">ลากจากแชทมาวาง หรือกดปุ่ม GFIN ข้างรูป · ครบ {filled}/{PRIMARY_SLOTS.length} ช่อง · PDF ใช้ได้ เปิดในหน้าลิงก์</p>
      <ul className="m-0 mt-2 list-none divide-y divide-border p-0">
        {slots.map(slot => (
          <li key={slot} className="py-1.5 text-xs leading-snug">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="m-0 font-semibold">{SLOT_LABELS[slot]}{REQUIRED_SLOTS.includes(slot) && counts[slot] === 0 && <span className="ml-1 text-destructive">*ต้องมี</span>}</p><p className="m-0 text-muted-foreground">{sourceLine(slot)}</p></div>
              <div className="flex shrink-0 gap-1">
                {slot === 'DEVICE_SCREEN' && <Button size="sm" variant="outline" aria-label="ถ่ายหน้าจอเครื่อง" onClick={() => setUploadSlot(slot)}><Camera className="size-3.5" /></Button>}
                {slot === 'DEVICE_PHOTO' && counts[slot] === 0 && usedPhone && <Button size="sm" variant="outline" disabled={gfin.busy} onClick={() => gfin.fromProduct()}>ดึงจากสต๊อก</Button>}
                {slot !== 'DEVICE_SCREEN' && <Button size="sm" variant="outline" aria-label={`อัปโหลดเข้าช่อง ${SLOT_LABELS[slot]}`} onClick={() => setUploadSlot(slot)}><Upload className="size-3.5" /></Button>}
              </div>
            </div>
            {counts[slot] > 0 && <ul className="m-0 mt-1 list-none p-0">{app.files.filter(f => f.slot === slot).map(f => <li key={f.id} className="flex items-center justify-between gap-2 py-0.5"><button type="button" className="min-w-0 truncate text-left text-primary hover:underline" onClick={() => openCreditDocument(`/finance-applications/${app.id}/files/${f.id}`)}>{f.originalName ?? (f.sourceAngle ? `มุม ${f.sourceAngle}` : f.mimeType.startsWith('image/') ? 'รูป' : 'ไฟล์')}</button>{!f.sentAt && <button type="button" aria-label="เอาไฟล์ออก" disabled={gfin.busy} onClick={() => gfin.removeFile(f.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>}</li>)}</ul>}
          </li>
        ))}
      </ul>
      {!showAll && <button type="button" className="mt-1 text-xs font-semibold text-primary" onClick={() => setShowAll(true)}>เพิ่มช่อง (บัตรคนค้ำ · บิลที่อยู่ · ระยะเวลาเปิดเบอร์ · อื่น ๆ)</button>}
      {!usedPhone && counts.DEVICE_PHOTO === 0 && <p className="m-0 mt-1 text-xs leading-snug text-muted-foreground">เครื่องใหม่ หรือมือสองที่ยังถ่ายไม่ครบ: ช่อง 6 มุมต้องถ่ายเพิ่ม</p>}
      <input ref={input} type="file" multiple accept={GFIN_ACCEPT} capture={uploadSlot === 'DEVICE_SCREEN' ? 'environment' : undefined} className="hidden" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length && uploadSlot) gfin.upload(uploadSlot, files); setUploadSlot(null); }} />
      <GfinSlotPicker open={pendingFiles !== null} onOpenChange={o => !o && setPendingFiles(null)} counts={counts} title={pendingFiles?.length ? `ไฟล์ ${pendingFiles.length} ไฟล์ ใส่ช่องไหน?` : 'อัปโหลดเข้าช่องไหน?'} onPick={slot => { const files = pendingFiles ?? []; setPendingFiles(null); if (files.length) gfin.upload(slot, files); else setUploadSlot(slot); }} />
      {onBack && onNext && <div className="mt-2.5 grid grid-cols-2 gap-1.5"><Button size="sm" variant="outline" onClick={onBack}>ย้อนกลับ</Button><Button size="sm" disabled={missingRequired.length > 0} title={missingRequired.length ? `ยังขาด ${missingRequired.map(s => SLOT_LABELS[s]).join(', ')}` : undefined} onClick={onNext}>ถัดไป: ข้อความ</Button></div>}
    </Group>
  );
}
```
(`openCreditDocument` เปิดผ่าน `api.get(url, { responseType: 'blob' })` เฉพาะ URL ที่ regex ใน Step 1 รู้จัก — ขยายแล้วใน Step 1)

- [ ] **Step 7: `GfinStepMessage.tsx` (ขั้น 4 + กล่องยืนยัน + คัดลอก)**

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Group } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import { GFIN_LINE_GROUP, productLabel, imeiTail } from './gfin';

export default function GfinStepMessage({ gfin, onBack }: { gfin: FinanceApplicationModel; onBack: () => void }) {
  const app = gfin.current!;
  const preview = gfin.preview;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(app.messageOverride ?? '');
  const [confirm, setConfirm] = useState(false);
  const [checked, setChecked] = useState(false);
  const copyAndSend = async () => {
    const r = await gfin.send('COPY');
    setConfirm(false);
    try { await navigator.clipboard.writeText(r.messageText); toast.success('คัดลอกแล้ว วางในกลุ่มไลน์ GFIN ได้เลย'); }
    catch { toast.error('คัดลอกอัตโนมัติไม่ได้ — กด "คัดลอกข้อความอีกครั้ง" ในการ์ดสถานะ'); }
  };
  return (
    <Group label="4 ข้อความ" right={<button type="button" onClick={() => setEditing(v => !v)}>{editing ? 'ใช้แม่แบบเดิม' : 'แก้ข้อความ'}</button>}>
      <p className="m-0 text-xs leading-snug text-muted-foreground">ถ้อยคำเดียวกับที่ทีมส่งทุกวันนี้ + ลิงก์ชุดเอกสารต่อท้าย</p>
      {editing ? (
        <><Textarea aria-label="ข้อความ 12 ข้อ" rows={14} className="mt-2 text-xs leading-snug" value={text} onChange={e => setText(e.target.value)} placeholder={preview?.text} />
          <div className="mt-1 flex gap-1.5"><Button size="sm" disabled={gfin.busy} onClick={async () => { await gfin.update({ messageOverride: text.trim() || null }); setEditing(false); }}>บันทึกถ้อยคำ</Button><Button size="sm" variant="ghost" onClick={() => { setText(''); gfin.update({ messageOverride: null }); setEditing(false); }}>ล้าง</Button></div>
          <p className="m-0 mt-1 text-xs text-muted-foreground">บรรทัด "เอกสารทั้งหมด N ไฟล์: ลิงก์" ระบบต่อท้ายให้เสมอ ไม่ต้องพิมพ์</p></>
      ) : (
        <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-2 font-sans text-xs leading-snug">{preview?.text ?? 'กำลังร่าง…'}</pre>
      )}
      <p className="m-0 mt-2 text-xs leading-snug text-muted-foreground">ส่ง 1 ข้อความ · เอกสารทุกไฟล์รวม PDF เปิดในหน้าลิงก์ · ลิงก์ใช้ได้ 7 วัน · ยกเลิกได้ทุกเมื่อ · ระบบจดว่าใครเปิดเมื่อไร</p>
      {preview?.warnings.map(w => <p key={w} className="m-0 mt-1 text-xs leading-snug text-warning-strong">{w}</p>)}
      <div className="mt-2.5 grid gap-1.5">
        <Button size="sm" disabled title="ส่งด้วยบอทจะเปิดใน PR 2 — ใช้คัดลอกไปก่อน">ส่งเช็ค GFIN</Button>
        <Button size="sm" variant="outline" disabled={!preview?.canSend || gfin.busy} onClick={() => setConfirm(true)}>คัดลอกข้อความ + ลิงก์</Button>
        <Button size="sm" variant="ghost" onClick={onBack}>ย้อนกลับ</Button>
      </div>
      <p className="m-0 mt-1 text-xs leading-snug text-muted-foreground">บอทส่งเข้ากลุ่มจะพร้อมในเฟสถัดไป · ตอนนี้คัดลอกแล้ววางในกลุ่ม "{GFIN_LINE_GROUP}" เอง ลิงก์เดียวกัน</p>
      <Dialog open={confirm} onOpenChange={o => { setConfirm(o); if (!o) setChecked(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>ทำเครื่องหมายว่าส่งเข้ากลุ่ม "GFIN : BESTCHOICE"?</DialogTitle></DialogHeader>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-snug">
            <dt className="text-muted-foreground">ลูกค้า</dt><dd className="m-0">{app.customer?.name} · {productLabel(app.product)} · {imeiTail(app.product?.imeiSerial)}</dd>
            <dt className="text-muted-foreground">จะส่ง</dt><dd className="m-0">1 ข้อความ = 12 ข้อ + ลิงก์ชุดเอกสาร {app.files.length} ไฟล์</dd>
            <dt className="text-muted-foreground">ลิงก์</dt><dd className="m-0">ใช้ได้ 7 วัน · ยกเลิกได้ทุกเมื่อ · ระบบจดว่าใครเปิดเมื่อไร</dd>
            <dt className="text-muted-foreground">ใครเห็น</dt><dd className="m-0">สมาชิกกลุ่ม · ลูกค้าไม่เห็น · ตัวอย่างลิงก์ในไลน์ไม่โชว์ชื่อลูกค้า</dd>
          </dl>
          <label className="flex items-start gap-2 text-xs leading-snug"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-0.5" />ตรวจแล้วว่าไฟล์ทุกใบเป็นของลูกค้าคนนี้ ไม่ติดข้อมูลคนอื่น</label>
          <DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>ยกเลิก</Button><Button disabled={!checked || gfin.busy} onClick={copyAndSend}>คัดลอกและทำเครื่องหมายว่าส่งแล้ว</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Group>
  );
}
```

- [ ] **Step 8: `GfinStatusCard.tsx`**

```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Group } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import GfinStepFiles from './GfinStepFiles';
import { GFIN_WEB_FORM_URL, OPEN_STATUSES, STATUS_LABEL, productLabel, imeiTail, slotCounts, PRIMARY_SLOTS, type FinanceApplication, type FinanceEvent } from './gfin';
import { formatThaiDateShort, formatThaiDateTime, formatThaiTime } from '@/lib/date';

const EVENT_LABEL: Record<FinanceEvent['kind'], string> = {
  CREATED: 'สร้างใบยื่น', SENT: 'ส่งเข้ากลุ่มแล้ว', RESENT: 'ส่งเพิ่ม', LINK_VIEWED: 'GFIN เปิดดูลิงก์', LINK_EXTENDED: 'ต่ออายุลิงก์', LINK_REVOKED: 'ยกเลิกลิงก์',
  PARTNER_ACK: 'GFIN รับเรื่อง', PARTNER_MORE_INFO: 'GFIN ตอบผ่านหน้าลิงก์: ขอเอกสารเพิ่ม', PARTNER_APPROVED: 'GFIN ตอบผ่านหน้าลิงก์: ผ่าน', PARTNER_REJECTED: 'GFIN ตอบผ่านหน้าลิงก์: ไม่ผ่าน',
  STAFF_RESULT: 'ร้านบันทึกผลเอง', CANCELLED: 'ยกเลิกใบยื่น', FILES_PURGED: 'ลบไฟล์ตามนโยบาย 90 วัน',
};
const badgeClass = (s: FinanceApplication['status']) => s === 'APPROVED' ? 'bg-primary/10 text-primary' : s === 'REJECTED' || s === 'CANCELLED' ? 'bg-destructive/10 text-destructive' : s === 'MORE_INFO' ? 'bg-warning/10 text-warning-strong' : 'bg-muted text-foreground';

export default function GfinStatusCard({ app, gfin, history, onAddMore, showFilesStep, onCloseFiles, dropFiles, onDropFilesHandled }: {
  app: FinanceApplication; gfin: FinanceApplicationModel; history: FinanceApplication[]; onAddMore: () => void; showFilesStep: boolean; onCloseFiles: () => void;
  onPickSlotForMessage?: (messageId: string) => void; dropFiles: File[] | null; onDropFilesHandled: () => void;
}) {
  const open = OPEN_STATUSES.includes(app.status);
  const counts = slotCounts(app.files);
  const filledSlots = PRIMARY_SLOTS.filter(s => counts[s] > 0).length;
  const pendingFiles = app.files.filter(f => !f.sentAt).length;
  const linkAlive = !!app.shareExpiresAt && !app.shareRevokedAt && new Date(app.shareExpiresAt) > new Date();
  const [note, setNote] = useState('');
  const copyText = async () => { if (app.messageText) { await navigator.clipboard.writeText(app.messageText); toast.success('คัดลอกข้อความ + ลิงก์แล้ว'); } };
  const openLink = async () => { const { url } = await gfin.shareLink(); window.open(url, '_blank', 'noopener,noreferrer'); };
  const resend = async () => { const r = await gfin.resend(); await navigator.clipboard.writeText(r.messageText); toast.success('คัดลอกข้อความ "ส่งเพิ่ม" แล้ว วางในกลุ่มไลน์ได้เลย'); onCloseFiles(); };
  const latestPartner = [...app.events].reverse().find(e => e.actorType === 'PARTNER' && e.note);
  return (
    <div className="flex flex-col gap-2.5 p-2.5">
      <Group label={`ใบยื่น ${app.number}`} right={<span className={`rounded-full px-2 py-0.5 text-[11px] ${badgeClass(app.status)}`}>{STATUS_LABEL[app.status]}</span>}>
        <p className="m-0 text-xs leading-snug">{productLabel(app.product)} · {app.product?.category === 'PHONE_USED' ? 'มือ 2' : 'มือ 1'} · {imeiTail(app.product?.imeiSerial)}</p>
        <p className="m-0 text-xs leading-snug text-muted-foreground">ข้อความ 12 ข้อ + ลิงก์ · {app.files.length} ไฟล์ · {filledSlots} ช่อง</p>
        {app.product && !['IN_STOCK', 'RESERVED'].includes(app.product.status) && <p className="m-0 mt-1 text-xs leading-snug text-warning-strong">สถานะเครื่องเปลี่ยนไปจากตอนส่ง ({app.product.status}) — ตรวจสต๊อกก่อนทำใบขาย</p>}
        <div className="mt-2 rounded-lg border border-border p-2 text-xs leading-snug">
          <p className="m-0 font-semibold">ลิงก์ชุดเอกสาร · เปิดดู {app.shareViewCount} ครั้ง</p>
          <p className="m-0 text-muted-foreground">{app.shareLastViewedAt ? `ล่าสุด ${formatThaiTime(app.shareLastViewedAt)}` : 'ยังไม่มีใครเปิด'}{app.shareExpiresAt ? ` · ${linkAlive ? 'หมดอายุ' : 'หมดอายุแล้ว'} ${formatThaiDateShort(app.shareExpiresAt)}` : ''}{app.shareRevokedAt ? ' · ยกเลิกแล้ว' : ''}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={openLink} disabled={!linkAlive || gfin.busy}><ExternalLink className="mr-1 size-3.5" />เปิดหน้าลิงก์</Button>
            <Button size="sm" variant="outline" onClick={copyText} disabled={!app.messageText}><Copy className="mr-1 size-3.5" />คัดลอกข้อความอีกครั้ง</Button>
            {open && <Button size="sm" variant="ghost" onClick={() => gfin.extend()} disabled={gfin.busy}>ต่ออายุ</Button>}
            {linkAlive && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => gfin.revoke()} disabled={gfin.busy}>ยกเลิกลิงก์</Button>}
          </div>
        </div>
      </Group>
      <Group label="ไทม์ไลน์">
        <ol className="m-0 list-none p-0 text-xs leading-snug">{app.events.map(e => <li key={e.id} className="border-l-2 border-border py-1 pl-2"><p className="m-0 font-semibold">{EVENT_LABEL[e.kind]}</p><p className="m-0 text-muted-foreground">{formatThaiDateTime(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ''}{e.note ? ` · "${e.note}"` : ''}</p></li>)}</ol>
      </Group>
      {open && (
        <Group label="ขั้นต่อไป">
          {latestPartner?.note && <p className="m-0 mb-1.5 rounded-md bg-warning/10 p-2 text-xs leading-snug text-warning-strong">GFIN: "{latestPartner.note}"</p>}
          {showFilesStep ? (<><GfinStepFiles gfin={gfin} dropFiles={dropFiles} onDropFilesHandled={onDropFilesHandled} /><div className="mt-1.5 grid grid-cols-2 gap-1.5"><Button size="sm" variant="outline" onClick={onCloseFiles}>ปิด</Button><Button size="sm" disabled={pendingFiles === 0 || gfin.busy} onClick={resend}>ส่งเพิ่ม ({pendingFiles} ไฟล์ใหม่)</Button></div></>)
            : <Button size="sm" className="w-full" onClick={onAddMore}>เพิ่มรูปแล้วส่งเพิ่ม</Button>}
          <p className="m-0 mt-2 text-xs font-semibold leading-snug">GFIN ตอบในไลน์แทน? บันทึกผลเอง</p>
          <input aria-label="หมายเหตุผล" className="mt-1 w-full rounded-md border border-border px-2 py-1 text-xs" placeholder="หมายเหตุ (ถ้ามี)" value={note} onChange={e => setNote(e.target.value)} />
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            <Button size="sm" disabled={gfin.busy} onClick={() => gfin.result('APPROVED', note || undefined)}>ผ่าน (แจ้งผ่านลิงก์)</Button>
            <Button size="sm" variant="outline" className="text-destructive" disabled={gfin.busy} onClick={() => gfin.result('REJECTED', note || undefined)}>ไม่ผ่าน</Button>
            <Button size="sm" variant="outline" disabled={gfin.busy} onClick={() => gfin.result('MORE_INFO', note || undefined)}>ขอเพิ่ม</Button>
          </div>
          <Button size="sm" variant="ghost" className="mt-1 w-full text-destructive" disabled={gfin.busy} onClick={() => gfin.cancel()}>ยกเลิกใบยื่น</Button>
        </Group>
      )}
      {app.status === 'APPROVED' && (
        <Group label="เมื่อผ่านแล้ว ขั้นต่อไป">
          <a href={GFIN_WEB_FORM_URL} target="_blank" rel="noopener noreferrer" className="block text-xs font-semibold text-primary hover:underline">กรอกฟอร์มเว็บ GFIN (เฟส 2 เติมให้)</a>
          <Link to="/pos" className="mt-1 block text-xs font-semibold text-primary hover:underline">ทำใบขายไฟแนนซ์นอกที่ POS · ใส่เลขสัญญา</Link>
        </Group>
      )}
      {!open && <Button size="sm" className="mx-0" disabled={gfin.busy} onClick={() => gfin.start()}>เริ่มใบยื่นใหม่</Button>}
      <Group label="ประวัติใบยื่น" count={history.length}>
        {history.length === 0 ? <p className="m-0 text-xs text-muted-foreground">ยังไม่มีใบก่อนหน้า</p> : <ul className="m-0 list-none p-0 text-xs">{history.map(h => <li key={h.id} className="flex justify-between py-1"><span>{h.number} · {formatThaiDateShort(h.createdAt)}</span><span className="font-semibold">{STATUS_LABEL[h.status]}</span></li>)}</ul>}
      </Group>
    </div>
  );
}
```
(ปุ่ม "ผ่าน (แจ้งผ่านลิงก์)" ใช้คำตาม Global Constraints — ไม่ใช่ "อนุมัติทางการ" · `gfin.start()` บนใบที่ปิดแล้ว: API `createDraft` คืนใบเปิดล่าสุดถ้ามี ไม่งั้นสร้างใหม่ — ใบปิดแล้วจึงได้ใบใหม่)

- [ ] **Step 9: รันเทสต์ + type-check + ดูจริงในเบราว์เซอร์**

```bash
cd apps/web && npx vitest run src/pages/UnifiedInboxPage && npm run lint && cd ../.. && ./tools/check-types.sh web
```
Expected: PASS ทั้งหมด · lint 0 error · types 0 error
เปิด `http://localhost:5173/inbox/<ห้อง FACEBOOK ที่มีรูปบัตร>` (API จริง + ฐานทดสอบ ตาม memory ข้อ 11) แล้วไล่ตาม mockup: แท็บ GFIN → เริ่มใบยื่น → กดปุ่ม GFIN ข้างรูปบัตร → เลือก "บัตรประชาชน" → อ่านบัตร → สร้างลูกค้า → เลือกเครื่อง → หยิบสลิป/เฟซ → ดึง 6 มุม → ข้อความ → คัดลอก → การ์ดสถานะ → เปิดหน้าลิงก์ในแท็บใหม่ → กด "ขอเอกสารเพิ่ม" บนหน้าลิงก์ → กลับมาเห็นจุดเหลืองที่แท็บ + Todo ใหม่. ถ่ายภาพหน้าจอ 3 จุด (แท็บขั้น 3, การ์ดสถานะ, หน้าลิงก์บนมือถือ 390px) ไว้แนบ PR

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage apps/web/src/components/customer/CustomerCreateDialog.tsx apps/web/src/lib/credit-document.ts
git commit -m "feat(gfin): แท็บ GFIN ครบ 4 ขั้น + การ์ดสถานะ/ประวัติ + OCR บัตรจากแชท"
```

---

### Task 11: bump version · Playwright smoke · ตรวจทั้งชุดก่อนเปิด PR

**Files:**
- Modify: `apps/web/package.json` (`"version": "26.9.53"`)
- Create: `apps/web/e2e/gfin-precheck.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md` (หัวข้อ "สถานะ": PR 1 เสร็จ — ระบุสิ่งที่เลื่อนไป PR 2)

**Interfaces:**
- Consumes: `loginViaAPI(page)` (`e2e/helpers/auth.ts:159`) · `gotoWithRetry`/`hasErrorBoundary` (`e2e/helpers/navigation.ts`) · ทุกอย่างจาก Task 1–10

- [ ] **Step 1: bump version**

`apps/web/package.json` → `"version": "26.9.53"` (ค่าเดิม `26.9.52`)

- [ ] **Step 2: Playwright smoke (ใช้ข้อมูล seed ของ CI — ห้องแชทจาก `seed.ts`; ถ้าไม่มีห้อง ให้สร้างผ่าน API ก่อนใน test)**

`apps/web/e2e/gfin-precheck.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('GFIN pre-check tab', () => {
  test.beforeEach(async ({ page }) => { await loginViaAPI(page); });

  test('inbox room shows a GFIN tab; starting a draft creates BC- number; public link of a fake token is 410', async ({ page, request }) => {
    const rooms = await page.request.get('/api/staff-chat/rooms?limit=1');
    expect(rooms.ok()).toBeTruthy();
    const list = await rooms.json();
    const room = (list.data ?? list)[0];
    test.skip(!room, 'no chat rooms seeded');
    const ok = await gotoWithRetry(page, `/inbox/${room.id}`);
    expect(ok).toBe(true);
    expect(await hasErrorBoundary(page)).toBe(false);
    if (await page.viewportSize()!.width < 1280) await page.getByRole('button', { name: /ข้อมูลลูกค้า/ }).first().click();
    await page.getByRole('tab', { name: /GFIN/ }).click();
    await page.getByRole('button', { name: 'เริ่มใบยื่น' }).click();
    await expect(page.getByText(/ใบยื่น \(ร่าง\)/)).toBeVisible({ timeout: 15000 });
    const apps = await page.request.get(`/api/staff-chat/rooms/${room.id}/finance-applications`);
    const body = await apps.json();
    expect((body.data ?? body).current.number).toMatch(/^BC-\d{6}-\d{3}$/);
    await page.getByRole('button', { name: 'ยกเลิกใบยื่น' }).click();
    await expect(page.getByRole('button', { name: 'เริ่มใบยื่น' })).toBeVisible({ timeout: 15000 });

    const gone = await request.get('/api/g/' + 'A'.repeat(43));
    expect(gone.status()).toBe(410);
    expect(await gone.text()).toContain('ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว');
    expect(await gone.text()).not.toContain('BC-');
  });
});
```
Run: `cd apps/web && npx playwright test e2e/gfin-precheck.spec.ts` → Expected: PASS (ต้องมี API + ฐานทดสอบรันอยู่ตาม `playwright.config.ts`)

- [ ] **Step 3: ตรวจทั้งชุด**

```bash
./tools/check-types.sh all
cd apps/api && npx jest --runInBand && cd ../..
cd apps/web && npm run test && npm run lint && cd ../..
cd packages/shared && npm test 2>/dev/null || npx jest && cd ../..
git status --short   # ต้องไม่มีไฟล์ค้าง
```
Expected: 0 type errors · api/web/shared เทสต์เขียวทั้งหมด (จำนวนเดิม + ที่เพิ่มใน Task 1–10)

- [ ] **Step 4: อัปเดตสเปก + commit + สรุปให้เจ้าของ (ยังไม่ push — repo เป็น public ต้องถามก่อน)**

ในสเปกเพิ่มหัวข้อท้ายไฟล์:
```md
## สถานะ (2026-09-2x)
- PR 1 (`feat/gfin-precheck`): ใบยื่นในแท็บ GFIN · หยิบไฟล์จากแชท/อัปโหลด/6 มุม · ข้อความ 12 ข้อ · หน้าลิงก์ `/api/g/:token` + ปุ่มตอบกลับ 4 แบบ (รับเรื่อง/ขอเพิ่ม/อนุมัติ/ไม่อนุมัติ + ชื่อผู้ตอบ) · ส่งแบบคัดลอก · แจ้งเตือน Todo/IN_APP · ล้างไฟล์ 90 วัน — เสร็จ
- เลื่อนไป PR 2: บอท OA ไฟแนนซ์ส่งเข้ากลุ่ม (`via: BOT` ตอบ 501) · เลือกกลุ่มไลน์ในตั้งค่า · webhook join/leave กลุ่ม · เติมฟอร์มเว็บ GFIN
- เบี่ยงจากสเปกที่ตัดสินตอนเขียนแผน (PR 1): §4.1 เก็บโทเคนดิบเข้ารหัส `shareTokenEnc` (ให้เปิด/ส่งลิงก์เดิมได้) · §5.1 OCR จากรูปในแชทอยู่ที่ `POST /staff-chat/rooms/:roomId/finance-applications/ocr-id-card` (ไม่ใช่ `/ocr/id-card/from-message`) · §13 ไม่มี push ผ่าน `events.gateway` — แท็บ refetch ทุก 15 วิ + Todo/IN_APP · §14 e2e เป็น smoke (สร้างร่าง/ยกเลิก/410) ส่วน flow เต็มทดสอบมือ · §12 "จุดเหลืองเมื่อใหม่กว่าที่เคยเปิด" เก็บเวลาเปิดใน localStorage ต่อเครื่อง
```
```bash
git add apps/web/package.json apps/web/e2e/gfin-precheck.spec.ts docs/superpowers/specs/2026-09-24-gfin-precheck-package-design.md
git commit -m "chore(gfin): bump web 26.9.53, e2e smoke, spec status"
```
รายงานเจ้าของ: จำนวน commit · สิ่งที่ต้องทำก่อน merge (env `SHARE_PAGE_BASE_URL` อยู่ใน workflow แล้ว · MCP grants apply บน prod หลัง migration · secret ไม่มีเพิ่ม) · ขออนุญาต push (repo public — ไม่มีเอกสารภายในใน PR นี้ นอกจากสเปก/แผนใน `docs/superpowers/` ซึ่งเจ้าของเคยให้ push มาก่อน)
