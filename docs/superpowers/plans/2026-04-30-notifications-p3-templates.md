# Notifications P3 — Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move 19 hardcoded customer-facing notification messages from inline strings in `scheduler.service.ts` (and 2 other services) into a proper `NotificationTemplate` Prisma model + UI editor with preview/test-send. Owner edits messages without dev/deploy.

**Architecture:** New `NotificationTemplate` table with `eventType` unique key. `sendFromTemplate(eventType, ...)` looks up template, hard-fails if missing or inactive. Template carries `category` + `channelKey` so callers offload those decisions. Seed migration inserts 19 required templates from current inline strings. Frontend gains Preview button (renders with sampleData) + Test send button (sends to current admin).

**Tech Stack:** NestJS + Prisma + PostgreSQL (apps/api), React + Vite (apps/web), Vitest tests, Sentry for hard-fail alerts.

**Spec:** `docs/superpowers/specs/2026-04-30-notifications-p3-templates-design.md`

---

## File Map

**New files (api):**
- `apps/api/src/modules/notifications/notification-template.service.ts` — CRUD + preview + test-send
- `apps/api/src/modules/notifications/notification-template.service.spec.ts`
- `apps/api/src/modules/notifications/dto/notification-template.dto.ts`

**Modified (api):**
- `apps/api/prisma/schema.prisma` — `NotificationTemplate` model + `NotificationCategory` enum
- `apps/api/prisma/migrations/<ts>_add_notification_templates/migration.sql`
- `apps/api/prisma/migrations/<ts>_seed_notification_templates/migration.sql` — INSERT 19 rows
- `apps/api/src/modules/notifications/notifications.service.ts` — refactor `sendFromTemplate(eventType, ...)`, remove old SystemConfig template lookup
- `apps/api/src/modules/notifications/notifications.controller.ts` — new template CRUD/preview/test-send endpoints; remove old SystemConfig endpoints
- `apps/api/src/modules/notifications/notifications.module.ts` — provide service
- `apps/api/src/modules/notifications/scheduler.service.ts` — replace inline `stageMessages` with `sendFromTemplate('dunning.X', ...)` calls (~12 inline messages)
- `apps/api/src/modules/notifications/notifications.service.ts` — `sendPaymentReminders`, `sendOverdueNotices` use sendFromTemplate
- `apps/api/src/modules/mdm/mdm-auto.service.ts` — sendFromTemplate('mdm.lock_notice', ...)

**Modified (web):**
- `apps/web/src/pages/NotificationsPage/components/TemplateForm.tsx` — sampleData editor + variable hints + Preview button + Test send button
- `apps/web/src/pages/NotificationsPage/components/TemplateManager.tsx` — category filter + inactive badge
- `apps/web/src/pages/NotificationsPage/index.tsx` — wire to new endpoints

---

## Phase 1 — Schema + Seed (Day 1)

### Task 1: NotificationTemplate model + Prisma enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_notification_templates/migration.sql`

- [ ] **Step 1: Add Prisma enum + model**

In `apps/api/prisma/schema.prisma`, add a new enum near other enums (e.g., after `NotificationChannel`):

```prisma
enum NotificationCategory {
  DUNNING
  REMINDER
  TRANSACTIONAL
  STAFF
  MARKETING
}
```

Then add the model (place near other notification models, e.g., after `NotificationLog`):

```prisma
model NotificationTemplate {
  id              String                @id @default(uuid())
  eventType       String                @unique @map("event_type")
  name            String
  category        NotificationCategory
  channelKey      String?               @map("channel_key")
  channel         NotificationChannel
  format          String                @default("text")
  subject         String?
  messageTemplate String                @db.Text @map("message_template")
  flexTemplate    String?               @db.Text @map("flex_template")
  description     String?               @db.Text
  isActive        Boolean               @default(true) @map("is_active")
  sampleData      Json?                 @map("sample_data")
  lastEditedBy    String?               @map("last_edited_by")

  createdAt       DateTime              @default(now()) @map("created_at")
  updatedAt       DateTime              @updatedAt @map("updated_at")
  deletedAt       DateTime?             @map("deleted_at")

  @@index([eventType])
  @@index([category])
  @@map("notification_templates")
}
```

- [ ] **Step 2: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name add_notification_templates --create-only
```

- [ ] **Step 3: Verify migration SQL**

Read the generated SQL. Expected: `CREATE TYPE "NotificationCategory"`, `CREATE TABLE "notification_templates"`, indexes. No ALTER on other tables.

- [ ] **Step 4: Apply migration**

```bash
cd apps/api && npx prisma migrate dev
```

If dev DB drift (P1+P2 had this), apply via psql:
```bash
psql -d bestchoice -f apps/api/prisma/migrations/<timestamp>_add_notification_templates/migration.sql
# Insert tracking row in _prisma_migrations
```

- [ ] **Step 5: Regenerate client**

```bash
cd apps/api && npx prisma generate
```

Verify:
```bash
grep -A 2 "notificationTemplate" apps/api/node_modules/.prisma/client/index.d.ts | head -10
```

- [ ] **Step 6: Update existing TS enum to use Prisma's**

The existing TS-side `NotificationCategory` enum at `apps/api/src/modules/notifications/notification-category.enum.ts` should now import from Prisma:

```typescript
// apps/api/src/modules/notifications/notification-category.enum.ts
import { NotificationCategory } from '@prisma/client';
export { NotificationCategory };

export const COMPLIANCE_CHECKED_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.DUNNING,
  NotificationCategory.REMINDER,
  NotificationCategory.MARKETING,
]);

export const FREQUENCY_CAP_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.DUNNING,
]);
```

This avoids enum mismatch — Prisma is the source of truth.

- [ ] **Step 7: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "notification-category|NotificationCategory" | head -10
```
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/ apps/api/src/modules/notifications/notification-category.enum.ts
git commit -m "feat(schema): NotificationTemplate model + NotificationCategory enum

Replaces SystemConfig-JSON template storage with proper Prisma model.
NotificationCategory enum now defined at DB level (Prisma source of truth)
— TS-side enum re-exports from @prisma/client.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Seed 19 required templates

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_seed_notification_templates/migration.sql`

- [ ] **Step 1: Write seed SQL**

Each INSERT mirrors the current inline string. Use `ON CONFLICT (event_type) DO NOTHING` for idempotency.

```sql
-- Dunning escalation stages (4)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'dunning.reminder', 'แจ้งเตือนค้างชำระ (REMINDER)', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] แจ้งเตือน: คุณ${name} มียอดค้างชำระ ${amount} บาท สัญญา ${contractNumber} กรุณาชำระโดยเร็ว',
   '{"name":"สมหมาย","amount":"1,500","contractNumber":"CT-001-2026","daysOverdue":"2"}'::jsonb,
   'Stage 1 dunning — sent at first overdue. Soft tone.', now(), now()),

  (gen_random_uuid(), 'dunning.notice', 'แจ้งค้างชำระ (NOTICE)', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] แจ้งค้างชำระ: คุณ${name} มียอดค้างชำระ ${amount} บาท ค้างชำระ ${daysOverdue} วัน กรุณาติดต่อชำระเงินทันที',
   '{"name":"สมหมาย","amount":"1,500","contractNumber":"CT-001-2026","daysOverdue":"7"}'::jsonb,
   'Stage 2 dunning — firm tone, mentions days overdue.', now(), now()),

  (gen_random_uuid(), 'dunning.final_warning', 'เตือนครั้งสุดท้าย (FINAL_WARNING)', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] เตือนครั้งสุดท้าย: คุณ${name} ค้างชำระ ${daysOverdue} วัน ยอด ${amount} บาท หากไม่ชำระภายใน 30 วัน จะดำเนินการตามกฎหมาย',
   '{"name":"สมหมาย","amount":"1,500","contractNumber":"CT-001-2026","daysOverdue":"30"}'::jsonb,
   'Stage 3 dunning — final warning before legal action.', now(), now()),

  (gen_random_uuid(), 'dunning.legal_action', 'แจ้งดำเนินการ (LEGAL_ACTION)', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] แจ้งดำเนินการ: สัญญา ${contractNumber} ค้างชำระเกิน 60 วัน ทางร้านจะดำเนินการยึดคืนสินค้า กรุณาติดต่อร้านทันที',
   '{"name":"สมหมาย","amount":"1,500","contractNumber":"CT-001-2026","daysOverdue":"60"}'::jsonb,
   'Stage 4 dunning — legal action notice.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Pre-due reminders (2)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'payment.due_in_3_days', 'เตือนก่อนถึงงวด 3 วัน', 'REMINDER', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] แจ้งเตือน: คุณ${name} งวดที่ ${installmentNo} (${amount} บาท) ครบกำหนด ${dueDate} (อีก 3 วัน)',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","dueDate":"5 พ.ค. 2569"}'::jsonb,
   'Sent 3 days before due date.', now(), now()),

  (gen_random_uuid(), 'payment.due_in_1_day', 'เตือนก่อนถึงงวด 1 วัน', 'REMINDER', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] เตือนความจำ: คุณ${name} งวดที่ ${installmentNo} (${amount} บาท) ครบกำหนดพรุ่งนี้ ${dueDate}',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","dueDate":"5 พ.ค. 2569"}'::jsonb,
   'Sent 1 day before due date.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Overdue notices (3)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'payment.overdue_day_1', 'แจ้งค้างชำระ วันที่ 1', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] คุณ${name} ค้างชำระงวดที่ ${installmentNo} ยอด ${amount} บาท (เลยกำหนด 1 วัน) กรุณาชำระโดยเร็ว',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","contractNumber":"CT-001-2026"}'::jsonb,
   'Sent on day 1 overdue.', now(), now()),

  (gen_random_uuid(), 'payment.overdue_day_3', 'แจ้งค้างชำระ วันที่ 3', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] คุณ${name} ค้างชำระมาแล้ว 3 วัน ยอด ${amount} บาท กรุณาติดต่อร้านเพื่อชำระเงิน',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","contractNumber":"CT-001-2026"}'::jsonb,
   'Sent on day 3 overdue.', now(), now()),

  (gen_random_uuid(), 'payment.overdue_day_7', 'แจ้งค้างชำระ วันที่ 7', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] คุณ${name} ค้างชำระมาแล้ว 7 วัน ยอด ${amount} บาท หากไม่ชำระภายใน 7 วันถัดไป สถานะสัญญาอาจถูกปรับเป็น OVERDUE',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","contractNumber":"CT-001-2026"}'::jsonb,
   'Sent on day 7 overdue.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Status change (2)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'contract.status_overdue', 'แจ้งสัญญาถูกปรับเป็น OVERDUE', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] สัญญา ${contractNumber} ของคุณ${name} ถูกปรับสถานะเป็น OVERDUE เนื่องจากค้างชำระเกินกำหนด ยอดรวมค้างชำระ ${totalOverdue} บาท กรุณาติดต่อร้านทันที',
   '{"name":"สมหมาย","contractNumber":"CT-001-2026","totalOverdue":"4,500","daysOverdue":"15"}'::jsonb,
   'When contract status changes to OVERDUE.', now(), now()),

  (gen_random_uuid(), 'contract.status_default', 'แจ้งสัญญาถูกปรับเป็น DEFAULT', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] สัญญา ${contractNumber} ของคุณ${name} ถูกปรับสถานะเป็น DEFAULT (ผิดนัดชำระ) ทางร้านจะดำเนินการตามขั้นตอนต่อไป กรุณาติดต่อร้านด่วน',
   '{"name":"สมหมาย","contractNumber":"CT-001-2026","totalOverdue":"4,500","daysOverdue":"60"}'::jsonb,
   'When contract status changes to DEFAULT.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Auto payment link (1)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'payment.auto_link', 'ส่งลิงก์ชำระเงิน', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] คุณ${name} ลิงก์สำหรับชำระค่างวดที่ ${installmentNo} (${amount} บาท): ${paymentUrl}',
   '{"name":"สมหมาย","amount":"1,500","installmentNo":"3","paymentUrl":"https://pay.example.com/abc"}'::jsonb,
   'Auto-generated payment link sent to customer.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- MDM lock notice (1)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'mdm.lock_notice', 'แจ้งเตือนล็อคเครื่อง', 'DUNNING', 'line-finance', 'LINE', 'text',
   '[BESTCHOICE FINANCE] เครื่องของคุณ${name} ภายใต้สัญญา ${contractNumber} ได้ถูกล็อคเนื่องจากค้างชำระ ${daysOverdue} วัน กรุณาชำระเงินเพื่อปลดล็อค',
   '{"name":"สมหมาย","contractNumber":"CT-001-2026","daysOverdue":"45"}'::jsonb,
   'When MDM auto-locks customer device.', now(), now())
ON CONFLICT (event_type) DO NOTHING;

-- Staff alerts (5)
INSERT INTO notification_templates (id, event_type, name, category, channel_key, channel, format, message_template, sample_data, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'staff.manager_overdue_summary', 'สรุปสัญญาค้างชำระ (manager)', 'STAFF', 'line-staff', 'LINE', 'text',
   'สรุปสัญญาค้างชำระวันนี้ (${date}): ${count} สัญญา, รวม ${totalAmount} บาท. รายละเอียด: ${listSummary}',
   '{"date":"30 เม.ย. 2569","count":"15","totalAmount":"75,000","listSummary":"CT-001 / CT-002 / CT-003..."}'::jsonb,
   'Daily manager summary at 09:30 ICT.', now(), now()),

  (gen_random_uuid(), 'staff.owner_default_alert', 'แจ้งสัญญา DEFAULT (owner)', 'STAFF', 'line-staff', 'LINE', 'text',
   'แจ้ง: สัญญา ${contractNumber} ของลูกค้า ${name} ถูกปรับเป็น DEFAULT — ค้างชำระ ${daysOverdue} วัน',
   '{"contractNumber":"CT-001-2026","name":"สมหมาย","daysOverdue":"60"}'::jsonb,
   'Owner alert when contract defaults.', now(), now()),

  (gen_random_uuid(), 'staff.daily_report', 'รายงานสรุปวัน', 'STAFF', 'line-staff', 'LINE', 'text',
   'รายงาน ${date}: ขายสด ${cashSales} บาท / ผ่อน ${hpSales} บาท / รับชำระ ${received} บาท / สัญญาใหม่ ${newContracts} ฉบับ',
   '{"date":"30 เม.ย. 2569","cashSales":"50,000","hpSales":"125,000","received":"35,000","newContracts":"3"}'::jsonb,
   'Daily summary at 23:55 ICT.', now(), now()),

  (gen_random_uuid(), 'staff.weekly_report', 'รายงานสรุปสัปดาห์', 'STAFF', 'line-staff', 'LINE', 'text',
   'สรุปสัปดาห์ ${weekStart}-${weekEnd}: ยอดขายรวม ${totalSales} / รับชำระ ${totalReceived} / ค้างชำระ ${totalOverdue}',
   '{"weekStart":"24 เม.ย.","weekEnd":"30 เม.ย.","totalSales":"500,000","totalReceived":"125,000","totalOverdue":"75,000"}'::jsonb,
   'Weekly summary every Monday 00:05 ICT.', now(), now()),

  (gen_random_uuid(), 'staff.daily_line_report', 'รายงาน LINE OA', 'STAFF', 'line-staff', 'LINE', 'text',
   'LINE OA ${date}: ส่งสำเร็จ ${sent} / ล้มเหลว ${failed} / ค้างคิว ${pending}',
   '{"date":"30 เม.ย. 2569","sent":"450","failed":"5","pending":"12"}'::jsonb,
   'LINE OA stats at 20:00 ICT.', now(), now()),

  (gen_random_uuid(), 'staff.sms_credit_low', 'แจ้งเครดิต SMS ใกล้หมด', 'STAFF', 'line-staff', 'LINE', 'text',
   '[BESTCHOICE] เครดิต SMS ใกล้หมด: เหลือ ${credit} เครดิต — กรุณาเติมก่อนหมด',
   '{"credit":"50"}'::jsonb,
   'When SMS credit < 100.', now(), now())
ON CONFLICT (event_type) DO NOTHING;
```

- [ ] **Step 2: Generate empty migration + paste SQL**

```bash
cd apps/api && npx prisma migrate dev --name seed_notification_templates --create-only
```

Replace generated migration.sql with the content above.

- [ ] **Step 3: Apply migration**

```bash
cd apps/api && npx prisma migrate dev
```

Or via psql if dev DB drift:
```bash
psql -d bestchoice -f apps/api/prisma/migrations/<timestamp>_seed_notification_templates/migration.sql
```

- [ ] **Step 4: Verify 19 rows inserted**

```bash
psql -d bestchoice -c "SELECT event_type, category FROM notification_templates ORDER BY category, event_type;"
```
Expected: 19 rows, 4 DUNNING + 2 REMINDER + 5 DUNNING (overdue+status+auto+mdm) + 5 STAFF + ... wait let me recount: 4+2+3+2+1+1+5 = 18. Plus the recount... actually 18 in spec list but seed includes 19; verify count matches and update either.

Actually my listing: dunning (4) + due-in (2) + overdue (3) + status (2) + auto-link (1) + mdm (1) + staff (5) = 18. The 19th was "TRANSACTIONAL templates defer". So 18 is correct. Adjust spec/plan as needed but seed is correct.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/migrations/
git commit -m "feat(schema): seed 18 required notification templates

Inserts dunning (4) + reminder (2) + overdue (3) + status (2) +
auto-link (1) + mdm (1) + staff (5) = 18 templates.

ON CONFLICT DO NOTHING — idempotent on re-run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Service + sendFromTemplate refactor (Day 2)

### Task 3: NotificationTemplateService CRUD + DTO

**Files:**
- Create: `apps/api/src/modules/notifications/notification-template.service.ts`
- Create: `apps/api/src/modules/notifications/notification-template.service.spec.ts`
- Create: `apps/api/src/modules/notifications/dto/notification-template.dto.ts`
- Modify: `apps/api/src/modules/notifications/notifications.module.ts`

- [ ] **Step 1: Create DTOs**

```typescript
// apps/api/src/modules/notifications/dto/notification-template.dto.ts
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { NotificationCategory, NotificationChannel } from '@prisma/client';

export class CreateNotificationTemplateDto {
  @IsString() @MaxLength(100)
  eventType!: string;

  @IsString() @MaxLength(200)
  name!: string;

  @IsEnum(NotificationCategory)
  category!: NotificationCategory;

  @IsString() @IsOptional()
  channelKey?: string;

  @IsEnum(['LINE', 'SMS', 'IN_APP'])
  channel!: NotificationChannel;

  @IsString() @IsOptional()
  format?: string;

  @IsString() @IsOptional()
  subject?: string;

  @IsString()
  messageTemplate!: string;

  @IsString() @IsOptional()
  flexTemplate?: string;

  @IsString() @IsOptional()
  description?: string;

  @IsBoolean() @IsOptional()
  isActive?: boolean;

  @IsObject() @IsOptional()
  sampleData?: Record<string, string>;
}

export class UpdateNotificationTemplateDto {
  @IsString() @MaxLength(200) @IsOptional()
  name?: string;

  @IsEnum(NotificationCategory) @IsOptional()
  category?: NotificationCategory;

  @IsString() @IsOptional()
  channelKey?: string;

  @IsEnum(['LINE', 'SMS', 'IN_APP']) @IsOptional()
  channel?: NotificationChannel;

  @IsString() @IsOptional()
  format?: string;

  @IsString() @IsOptional()
  subject?: string;

  @IsString() @IsOptional()
  messageTemplate?: string;

  @IsString() @IsOptional()
  flexTemplate?: string;

  @IsString() @IsOptional()
  description?: string;

  @IsBoolean() @IsOptional()
  isActive?: boolean;

  @IsObject() @IsOptional()
  sampleData?: Record<string, string>;
}

export class PreviewTemplateDto {
  @IsObject() @IsOptional()
  data?: Record<string, string>;
}

export class TestSendTemplateDto {
  @IsObject() @IsOptional()
  data?: Record<string, string>;
}
```

- [ ] **Step 2: Write failing test**

```typescript
// apps/api/src/modules/notifications/notification-template.service.spec.ts
import { Test } from '@nestjs/testing';
import { NotificationTemplateService } from './notification-template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('NotificationTemplateService', () => {
  let service: NotificationTemplateService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      notificationTemplate: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationTemplateService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(NotificationTemplateService);
  });

  describe('findByEventType', () => {
    it('returns template when found', async () => {
      const tpl = { id: 't1', eventType: 'dunning.reminder', isActive: true };
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce(tpl);
      const result = await service.findByEventType('dunning.reminder');
      expect(result).toEqual(tpl);
    });

    it('returns null when not found', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce(null);
      const result = await service.findByEventType('missing.template');
      expect(result).toBeNull();
    });
  });

  describe('renderPreview', () => {
    it('renders template with data substitution', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce({
        eventType: 'dunning.reminder',
        messageTemplate: 'Hi ${name}, you owe ${amount}',
        sampleData: { name: 'John', amount: '1500' },
        format: 'text',
      });
      const result = await service.renderPreview('dunning.reminder');
      expect(result.rendered).toBe('Hi John, you owe 1500');
    });

    it('throws NotFoundException for missing template', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce(null);
      await expect(service.renderPreview('missing.template')).rejects.toThrow(NotFoundException);
    });

    it('uses overrideData if provided, falls back to sampleData', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValueOnce({
        eventType: 'dunning.reminder',
        messageTemplate: 'Hi ${name}',
        sampleData: { name: 'Sample' },
        format: 'text',
      });
      const result = await service.renderPreview('dunning.reminder', { name: 'Custom' });
      expect(result.rendered).toBe('Hi Custom');
    });
  });

  describe('extractVariables', () => {
    it('parses ${var} placeholders from template', () => {
      const vars = service.extractVariables('Hi ${name}, you owe ${amount} for ${contractNumber}');
      expect(vars).toEqual(['name', 'amount', 'contractNumber']);
    });

    it('deduplicates repeated variables', () => {
      const vars = service.extractVariables('Hi ${name}, hello again ${name}');
      expect(vars).toEqual(['name']);
    });

    it('returns empty for template without placeholders', () => {
      expect(service.extractVariables('No placeholders here')).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Implement service**

```typescript
// apps/api/src/modules/notifications/notification-template.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationCategory, NotificationTemplate } from '@prisma/client';
import {
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
} from './dto/notification-template.dto';

@Injectable()
export class NotificationTemplateService {
  private readonly logger = new Logger(NotificationTemplateService.name);

  constructor(private prisma: PrismaService) {}

  async findByEventType(eventType: string): Promise<NotificationTemplate | null> {
    return this.prisma.notificationTemplate.findUnique({
      where: { eventType },
    });
  }

  async findAll(filter?: { category?: NotificationCategory; isActive?: boolean }) {
    return this.prisma.notificationTemplate.findMany({
      where: {
        deletedAt: null,
        category: filter?.category,
        isActive: filter?.isActive,
      },
      orderBy: [{ category: 'asc' }, { eventType: 'asc' }],
    });
  }

  async create(dto: CreateNotificationTemplateDto, lastEditedBy?: string) {
    const existing = await this.prisma.notificationTemplate.findUnique({
      where: { eventType: dto.eventType },
    });
    if (existing) {
      throw new NotFoundException(`Template with eventType ${dto.eventType} already exists`);
    }
    return this.prisma.notificationTemplate.create({
      data: {
        ...dto,
        format: dto.format ?? 'text',
        sampleData: dto.sampleData ? (dto.sampleData as any) : undefined,
        lastEditedBy: lastEditedBy ?? null,
      },
    });
  }

  async update(eventType: string, dto: UpdateNotificationTemplateDto, lastEditedBy?: string) {
    const tpl = await this.findByEventType(eventType);
    if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);
    return this.prisma.notificationTemplate.update({
      where: { eventType },
      data: {
        ...dto,
        sampleData: dto.sampleData ? (dto.sampleData as any) : undefined,
        lastEditedBy: lastEditedBy ?? tpl.lastEditedBy,
      },
    });
  }

  async softDelete(eventType: string, lastEditedBy?: string) {
    const tpl = await this.findByEventType(eventType);
    if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);
    return this.prisma.notificationTemplate.update({
      where: { eventType },
      data: {
        deletedAt: new Date(),
        isActive: false,
        lastEditedBy: lastEditedBy ?? tpl.lastEditedBy,
      },
    });
  }

  /**
   * Renders template with data → returns rendered text + optional flex JSON.
   * Uses sampleData if no overrideData provided.
   */
  async renderPreview(eventType: string, overrideData?: Record<string, string>) {
    const tpl = await this.findByEventType(eventType);
    if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);

    const data = overrideData ?? (tpl.sampleData as Record<string, string> | null) ?? {};
    const rendered = this.replacePlaceholders(tpl.messageTemplate, data);

    let flexJson: object | null = null;
    if (tpl.format === 'flex' && tpl.flexTemplate) {
      try {
        const parsed = JSON.parse(tpl.flexTemplate);
        flexJson = this.replacePlaceholdersInJson(parsed, data);
      } catch (err) {
        this.logger.warn(`Flex template parse error for ${eventType}: ${err}`);
      }
    }

    return { rendered, flexJson };
  }

  /** Extracts ${var} placeholders from a template string, deduplicated and ordered. */
  extractVariables(template: string): string[] {
    const regex = /\$\{([^}]+)\}/g;
    const seen = new Set<string>();
    const order: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(template)) !== null) {
      const varName = match[1].trim();
      if (!seen.has(varName)) {
        seen.add(varName);
        order.push(varName);
      }
    }
    return order;
  }

  private replacePlaceholders(tmpl: string, data: Record<string, string>): string {
    return tmpl.replace(/\$\{([^}]+)\}/g, (_match, varName) => {
      const trimmed = (varName as string).trim();
      return data[trimmed] ?? `\${${trimmed}}`;
    });
  }

  private replacePlaceholdersInJson(obj: any, data: Record<string, string>): any {
    if (typeof obj === 'string') return this.replacePlaceholders(obj, data);
    if (Array.isArray(obj)) return obj.map((item) => this.replacePlaceholdersInJson(item, data));
    if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.replacePlaceholdersInJson(v, data);
      }
      return result;
    }
    return obj;
  }
}
```

- [ ] **Step 4: Update notifications.module.ts**

Add `NotificationTemplateService` to providers + exports:
```typescript
import { NotificationTemplateService } from './notification-template.service';

@Module({
  // ...
  providers: [/* existing */, NotificationTemplateService],
  exports: [/* existing */, NotificationTemplateService],
})
export class NotificationsModule {}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && npx jest --testPathPattern=notification-template.service 2>&1 | tail -10
```
Expected: 8 tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/notifications/notification-template.service.ts \
        apps/api/src/modules/notifications/notification-template.service.spec.ts \
        apps/api/src/modules/notifications/dto/notification-template.dto.ts \
        apps/api/src/modules/notifications/notifications.module.ts
git commit -m "feat(notifications): NotificationTemplateService with CRUD + preview

CRUD + findByEventType + renderPreview + extractVariables.
Used by NotificationsService.sendFromTemplate (Task 4) and
controller endpoints (Task 5).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Refactor sendFromTemplate to use eventType + hard-fail

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`

- [ ] **Step 1: Replace sendFromTemplate signature + body**

Find the existing `sendFromTemplate` method (around line 519) and replace:

```typescript
import { NotificationTemplateService } from './notification-template.service';

// In constructor:
constructor(
  private prisma: PrismaService,
  // ...existing
  private compliance: ComplianceService,
  private templateService: NotificationTemplateService,  // NEW
) {}

// Replace existing sendFromTemplate:
async sendFromTemplate(
  eventType: string,
  data: Record<string, string>,
  recipient: string,
  options: {
    relatedId?: string;
    customerId?: string;
    bypassCompliance?: boolean;
  } = {},
): Promise<{ id: string | null; status: string; blockReason?: string }> {
  const tpl = await this.templateService.findByEventType(eventType);

  if (!tpl) {
    Sentry.captureMessage(`Notification template missing: ${eventType}`, {
      level: 'error',
      tags: { module: 'notifications', eventType },
    });
    throw new InternalServerErrorException(`Notification template not found: ${eventType}`);
  }

  if (!tpl.isActive) {
    this.logger.warn(`Template ${eventType} is inactive — send blocked`);
    Sentry.captureMessage(`Notification template inactive: ${eventType}`, {
      level: 'warning',
      tags: { module: 'notifications', eventType },
    });
    return { id: null, status: 'BLOCKED', blockReason: 'TEMPLATE_INACTIVE' };
  }

  const message = this.replacePlaceholders(tpl.messageTemplate, data);

  // For Flex templates, render JSON and send via lineOaService
  if (tpl.format === 'flex' && tpl.flexTemplate && tpl.channel === 'LINE' && tpl.channelKey) {
    try {
      const flexJson = JSON.parse(tpl.flexTemplate);
      const resolvedFlex = this.replacePlaceholdersInJson(flexJson, data) as FlexMessagePayload;
      await this.sendLineFlexMessage(recipient, resolvedFlex, tpl.channelKey as LineChannelKey);

      const log = await this.prisma.notificationLog.create({
        data: {
          channel: 'LINE',
          channelKey: tpl.channelKey,
          recipient,
          subject: tpl.subject ?? tpl.name,
          message: `Flex: ${message}`,
          status: 'SENT',
          relatedId: options.relatedId ?? null,
          customerId: options.customerId ?? null,
          category: tpl.category,
          blockReason: null,
          sentAt: new Date(),
        },
      });
      return { id: log.id, status: 'SENT' };
    } catch (err) {
      this.logger.warn(`Flex template send failed for ${eventType}, falling back to text: ${err}`);
      // Fall through to text send below
    }
  }

  // Text path (default)
  return this.send({
    channel: tpl.channel,
    channelKey: tpl.channelKey as LineChannelKey | undefined,
    recipient,
    subject: tpl.subject ?? tpl.name,
    message,
    relatedId: options.relatedId,
    customerId: options.customerId,
    category: tpl.category,
    bypassCompliance: options.bypassCompliance,
  });
}
```

Notice: caller no longer passes `category`/`channelKey` — template owns them.

- [ ] **Step 2: Remove old SystemConfig template methods**

Find old `createTemplate`, `listTemplates`, `getTemplate`, `updateTemplate`, `deleteTemplate` methods that read from `SystemConfig` (around line 868-970). Delete them — they're replaced by NotificationTemplateService.

- [ ] **Step 3: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "notifications.service.ts" | head -10
```

Watch for compilation errors in places that called the old `sendFromTemplate(templateId, ...)` — there's only 1 internal caller (in sendBulk around line 621). Update it:

```typescript
// In sendBulk, find the existing sendFromTemplate call:
const result = await this.sendFromTemplate(eventType, data, recipient, {
  relatedId: contractId,
  customerId: customer.id,
});
```

If sendBulk previously took a `templateId` param, rename to `eventType` and document.

- [ ] **Step 4: Run notifications tests**

```bash
cd apps/api && npx jest --testPathPattern=notifications 2>&1 | tail -15
```

Tests that previously hit old SystemConfig template methods will fail — they need migration to mock `notificationTemplate` instead. Fix them.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications/notifications.service.ts
git commit -m "feat(notifications): sendFromTemplate uses eventType lookup + hard-fail

- Looks up template by eventType from NotificationTemplate model
- Hard-fail with Sentry capture if template missing/inactive
- Template carries channel/channelKey/category — caller offloads
- Removes old SystemConfig-JSON template CRUD methods (replaced by
  NotificationTemplateService)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Cron Migration (Day 3)

### Task 5: Migrate scheduler.service.ts inline messages

**Files:**
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts`

- [ ] **Step 1: Audit current inline messages**

```bash
grep -n "REMINDER:\|NOTICE:\|FINAL_WARNING:\|LEGAL_ACTION:\|stageMessages\|notificationsService\.send" apps/api/src/modules/notifications/scheduler.service.ts | head -30
```

- [ ] **Step 2: Replace handleDunningEscalation stageMessages**

```typescript
// BEFORE
const stageMessages: Record<string, string> = {
  REMINDER: `[BESTCHOICE FINANCE] แจ้งเตือน: คุณ${contract.customer.name}...`,
  NOTICE: `[BESTCHOICE FINANCE] แจ้งค้างชำระ: คุณ${contract.customer.name}...`,
  // ...
};
const message = stageMessages[esc.to];
await this.notificationsService.send({
  channelKey: 'line-finance',
  channel: 'LINE',
  recipient: lineId,
  subject: `Dunning: ${esc.to}`,
  message,
  relatedId: esc.contractId,
  customerId: contract.customer.id,
  category: NotificationCategory.DUNNING,
});

// AFTER
const eventType = `dunning.${esc.to.toLowerCase()}`;
await this.notificationsService.sendFromTemplate(
  eventType,
  {
    name: contract.customer.name,
    amount: totalOverdue.toLocaleString(),
    contractNumber: esc.contractNumber,
    daysOverdue: String(esc.daysOverdue),
  },
  lineId,
  {
    relatedId: esc.contractId,
    customerId: contract.customer.id,
  },
);
```

- [ ] **Step 3: Replace notifyStatusChangedCustomers**

The existing flex message in `notifyStatusChangedCustomers` uses `buildOverdueNoticeFlex` builder — keep as-is for now since it's a TS builder, not a string template. Spec calls these out as defer to v2.

But for the OVERDUE/DEFAULT status text (if used), replace with template lookup. Search `'overdue'` / `'default'` related messaging in the function.

- [ ] **Step 4: Replace handleAutoPaymentLinks** (around line 365+)

If it has an inline message, replace with `sendFromTemplate('payment.auto_link', { name, amount, installmentNo, paymentUrl }, lineId, ...)`.

- [ ] **Step 5: Replace staff alert messages**

For `handleManagerNotifications`, `handleOwnerDefaultNotifications`, `handleDailyReport`, `handleWeeklyReport`, `handleDailyLineReport`, `handleSmsCreditAlert` — each has an inline message string. Replace with corresponding `staff.*` template.

For each, gather the variables it would need (name, count, amount, etc.) and pass as `data`.

- [ ] **Step 6: Type check + tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "scheduler.service.ts" | head -10
cd apps/api && npx jest --testPathPattern=scheduler 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/notifications/scheduler.service.ts
git commit -m "feat(notifications): scheduler crons use sendFromTemplate

12+ inline message strings replaced with sendFromTemplate(eventType, ...)
calls. Templates loaded from DB (NotificationTemplate model). Caller
no longer specifies channelKey/category — template owns them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Migrate notifications.service.ts internal methods

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`

- [ ] **Step 1: Find inline messages in sendPaymentReminders + sendOverdueNotices**

```bash
grep -nA 20 "async sendPaymentReminders\|async sendOverdueNotices" apps/api/src/modules/notifications/notifications.service.ts | head -60
```

- [ ] **Step 2: Replace inline messages**

For each branch (3-day, 1-day reminder; day 1, 3, 7 overdue), replace with sendFromTemplate:

```typescript
// In sendPaymentReminders 3-day branch:
await this.sendFromTemplate(
  'payment.due_in_3_days',
  {
    name: customer.name,
    amount: amountDue.toLocaleString(),
    installmentNo: String(payment.installmentNo),
    dueDate: formatDate(payment.dueDate),
  },
  customer.lineIdFinance,
  {
    relatedId: contract.id,
    customerId: customer.id,
  },
);

// Similar for 1-day, overdue 1/3/7
```

- [ ] **Step 3: Type check + tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "notifications.service.ts" | head -5
cd apps/api && npx jest --testPathPattern=notifications.service 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/notifications/notifications.service.ts
git commit -m "feat(notifications): sendPaymentReminders and sendOverdueNotices use templates

5 inline messages migrated to sendFromTemplate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Migrate mdm-auto.service.ts customer lock notice

**File:**
- Modify: `apps/api/src/modules/mdm/mdm-auto.service.ts`

- [ ] **Step 1: Find lock notice send call**

```bash
grep -nA 15 "notificationsService\.send\|customer.lineIdFinance.*push" apps/api/src/modules/mdm/mdm-auto.service.ts | head -30
```

- [ ] **Step 2: Replace with sendFromTemplate('mdm.lock_notice', ...)**

```typescript
await this.notificationsService.sendFromTemplate(
  'mdm.lock_notice',
  {
    name: contract.customer.name,
    contractNumber: contract.contractNumber,
    daysOverdue: String(daysOverdue),
  },
  contract.customer.lineIdFinance,
  {
    relatedId: contract.id,
    customerId: contract.customer.id,
  },
);
```

- [ ] **Step 3: Type check + tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "mdm-auto" | head -5
cd apps/api && npx jest --testPathPattern=mdm-auto 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/mdm/mdm-auto.service.ts
git commit -m "feat(mdm): auto-lock notice uses sendFromTemplate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Controller + Preview/Test-Send (Day 4)

### Task 8: Replace SystemConfig template controller endpoints

**File:**
- Modify: `apps/api/src/modules/notifications/notifications.controller.ts`

- [ ] **Step 1: Find existing template endpoints**

```bash
grep -nE "Templates\(\)|/templates" apps/api/src/modules/notifications/notifications.controller.ts | head -10
```

- [ ] **Step 2: Replace with new ones using NotificationTemplateService**

```typescript
import { NotificationTemplateService } from './notification-template.service';
import {
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
  PreviewTemplateDto,
  TestSendTemplateDto,
} from './dto/notification-template.dto';

// Inject in constructor:
constructor(
  private notificationsService: NotificationsService,
  private templateService: NotificationTemplateService,  // NEW
) {}

// Replace existing template endpoints:

@Get('templates')
@Roles('OWNER', 'BRANCH_MANAGER')
async listTemplates(@Query('category') category?: string) {
  return this.templateService.findAll(category ? { category: category as any } : undefined);
}

@Get('templates/:eventType')
@Roles('OWNER', 'BRANCH_MANAGER')
async getTemplate(@Param('eventType') eventType: string) {
  const tpl = await this.templateService.findByEventType(eventType);
  if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);
  return tpl;
}

@Post('templates')
@Roles('OWNER')
async createTemplate(@Body() dto: CreateNotificationTemplateDto, @Request() req: any) {
  return this.templateService.create(dto, req.user?.id);
}

@Patch('templates/:eventType')
@Roles('OWNER')
async updateTemplate(
  @Param('eventType') eventType: string,
  @Body() dto: UpdateNotificationTemplateDto,
  @Request() req: any,
) {
  return this.templateService.update(eventType, dto, req.user?.id);
}

@Delete('templates/:eventType')
@Roles('OWNER')
async deleteTemplate(@Param('eventType') eventType: string, @Request() req: any) {
  return this.templateService.softDelete(eventType, req.user?.id);
}

@Post('templates/:eventType/preview')
@Roles('OWNER', 'BRANCH_MANAGER')
async previewTemplate(
  @Param('eventType') eventType: string,
  @Body() dto: PreviewTemplateDto,
) {
  return this.templateService.renderPreview(eventType, dto.data);
}

@Post('templates/:eventType/test-send')
@Roles('OWNER', 'BRANCH_MANAGER')
async testSendTemplate(
  @Param('eventType') eventType: string,
  @Body() dto: TestSendTemplateDto,
  @Request() req: any,
) {
  const adminUser = req.user;
  const tpl = await this.templateService.findByEventType(eventType);
  if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);

  // Resolve recipient based on template's channel
  let recipient: string | null = null;
  if (tpl.channel === 'LINE') {
    recipient = adminUser.lineIdFinance ?? adminUser.lineIdShop ?? null;
  } else if (tpl.channel === 'SMS') {
    recipient = adminUser.phone ?? null;
  }

  if (!recipient) {
    throw new BadRequestException(`Cannot test-send: admin has no ${tpl.channel} contact`);
  }

  // Use the template's sample data (or override if provided)
  const data = dto.data ?? (tpl.sampleData as Record<string, string> | null) ?? {};

  // Prepend [TEST] prefix to message body BEFORE sending
  const testData = { ...data, _test_prefix: '[TEST] ' };

  return this.notificationsService.sendFromTemplate(eventType, testData, recipient, {
    bypassCompliance: true,  // test sends bypass time/frequency gates
  });
}
```

For the `[TEST]` prefix: simpler approach — pass an extra prefix into messageTemplate via wrapper. Actually since templates already start with `[BESTCHOICE FINANCE]`, just prepend `[TEST] ` in the rendered message before sending. Modify by wrapping `sendFromTemplate` call to inject `[TEST] ` prefix:

```typescript
// Cleaner: render manually + send raw
const rendered = await this.templateService.renderPreview(eventType, dto.data);
return this.notificationsService.send({
  channel: tpl.channel,
  channelKey: tpl.channelKey as any,
  recipient,
  subject: `[TEST] ${tpl.subject ?? tpl.name}`,
  message: `[TEST] ${rendered.rendered}`,
  customerId: adminUser.id,
  category: tpl.category,
  bypassCompliance: true,
});
```

- [ ] **Step 3: Type check + run tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "notifications.controller" | head -10
cd apps/api && npx jest --testPathPattern=notifications 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/notifications/notifications.controller.ts
git commit -m "feat(notifications): template CRUD + preview + test-send endpoints

- GET/POST/PATCH/DELETE /notifications/templates(/:eventType)
- POST /notifications/templates/:eventType/preview — render with sampleData
- POST /notifications/templates/:eventType/test-send — send to current admin
  with [TEST] prefix + bypassCompliance=true
- All endpoints require OWNER or BRANCH_MANAGER role
- Replaces old SystemConfig-JSON endpoints

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Frontend (Day 5)

### Task 9: Update TemplateForm — preview + test send + variable hints

**File:**
- Modify: `apps/web/src/pages/NotificationsPage/components/TemplateForm.tsx`

- [ ] **Step 1: Add state for preview + test send + sampleData**

```typescript
const [previewModalOpen, setPreviewModalOpen] = useState(false);
const [previewResult, setPreviewResult] = useState<{ rendered: string; flexJson?: any } | null>(null);
const [sampleDataJson, setSampleDataJson] = useState(JSON.stringify(template?.sampleData ?? {}, null, 2));
```

- [ ] **Step 2: Add Preview mutation**

```typescript
const previewMutation = useMutation({
  mutationFn: async () => {
    let parsedData: any = undefined;
    try {
      parsedData = JSON.parse(sampleDataJson);
    } catch {
      // Use template's sampleData
    }
    const res = await api.post(`/notifications/templates/${form.eventType}/preview`, { data: parsedData });
    return res.data as { rendered: string; flexJson?: any };
  },
  onSuccess: (data) => {
    setPreviewResult(data);
    setPreviewModalOpen(true);
  },
  onError: (err) => toast.error(getErrorMessage(err)),
});
```

- [ ] **Step 3: Add Test send mutation**

```typescript
const testSendMutation = useMutation({
  mutationFn: async () => {
    let parsedData: any = undefined;
    try { parsedData = JSON.parse(sampleDataJson); } catch {}
    const res = await api.post(`/notifications/templates/${form.eventType}/test-send`, { data: parsedData });
    return res.data;
  },
  onSuccess: () => toast.success('ส่งทดสอบเรียบร้อย — เช็ค LINE/SMS ของคุณ'),
  onError: (err) => toast.error(getErrorMessage(err)),
});
```

- [ ] **Step 4: Add sample data editor + variables hint**

In the form JSX, after messageTemplate textarea, add:

```tsx
{/* Variables hint */}
<div className="text-xs text-muted-foreground">
  Variables: {extractVariables(form.messageTemplate).map((v) => (
    <code key={v} className="mx-1 px-1 bg-muted rounded">${'{' + v + '}'}</code>
  ))}
</div>

{/* Sample data editor */}
<div>
  <label className="text-sm">ข้อมูลตัวอย่าง (JSON สำหรับ preview)</label>
  <textarea
    value={sampleDataJson}
    onChange={(e) => setSampleDataJson(e.target.value)}
    className="w-full px-3 py-2 border border-input rounded-lg font-mono text-xs"
    rows={4}
    placeholder='{"name":"สมหมาย","amount":"1500"}'
  />
</div>

{/* Preview + Test send buttons */}
<div className="flex gap-2 mt-4">
  <Button type="button" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
    Preview
  </Button>
  <Button type="button" onClick={() => testSendMutation.mutate()} disabled={testSendMutation.isPending}>
    ส่งทดสอบให้ตัวเอง
  </Button>
</div>

{/* Preview modal */}
{previewModalOpen && previewResult && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-card rounded-lg p-6 max-w-2xl w-full">
      <h3 className="font-semibold mb-2">Preview</h3>
      <pre className="bg-muted p-3 rounded text-sm whitespace-pre-wrap">{previewResult.rendered}</pre>
      {previewResult.flexJson && (
        <pre className="mt-2 bg-muted p-3 rounded text-xs overflow-auto max-h-64">
          {JSON.stringify(previewResult.flexJson, null, 2)}
        </pre>
      )}
      <Button onClick={() => setPreviewModalOpen(false)} className="mt-4">ปิด</Button>
    </div>
  </div>
)}
```

Implement `extractVariables(template)` locally:
```typescript
function extractVariables(template: string): string[] {
  const regex = /\$\{([^}]+)\}/g;
  const seen = new Set<string>();
  const order: string[] = [];
  let match;
  while ((match = regex.exec(template)) !== null) {
    const varName = match[1].trim();
    if (!seen.has(varName)) { seen.add(varName); order.push(varName); }
  }
  return order;
}
```

- [ ] **Step 5: Update form save submit to include sampleData**

```typescript
const submitData = {
  ...form,
  sampleData: tryParseJson(sampleDataJson) ?? null,
};
```

- [ ] **Step 6: Type check**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep "TemplateForm" | head -5
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/NotificationsPage/components/TemplateForm.tsx
git commit -m "feat(web): TemplateForm preview + test send + variable hints

- Variables hint row parsed from messageTemplate
- SampleData JSON editor
- Preview button → modal with rendered text + flex JSON
- Test send button → sends to current admin with [TEST] prefix
- Save includes sampleData

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Update TemplateManager — category filter + inactive badge

**File:**
- Modify: `apps/web/src/pages/NotificationsPage/components/TemplateManager.tsx`

- [ ] **Step 1: Add category filter dropdown**

```typescript
const [categoryFilter, setCategoryFilter] = useState<string>('');

const { data: templates } = useQuery({
  queryKey: ['notification-templates', categoryFilter],
  queryFn: async () => {
    const url = categoryFilter ? `/notifications/templates?category=${categoryFilter}` : '/notifications/templates';
    return (await api.get(url)).data;
  },
});

// In JSX, before list:
<select
  value={categoryFilter}
  onChange={(e) => setCategoryFilter(e.target.value)}
  className="px-3 py-2 border border-input rounded-lg text-sm"
>
  <option value="">ทั้งหมด</option>
  <option value="DUNNING">DUNNING (ทวงหนี้)</option>
  <option value="REMINDER">REMINDER (เตือนก่อนงวด)</option>
  <option value="TRANSACTIONAL">TRANSACTIONAL (ใบเสร็จ)</option>
  <option value="STAFF">STAFF (ทีม)</option>
  <option value="MARKETING">MARKETING (โปรโมชั่น)</option>
</select>
```

- [ ] **Step 2: Add inactive badge to template list rows**

In the row JSX:
```tsx
{!template.isActive && (
  <span className="ml-2 px-2 py-0.5 bg-warning/20 text-warning text-xs rounded">ปิดใช้งาน</span>
)}
```

- [ ] **Step 3: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep "TemplateManager" | head -5
git add apps/web/src/pages/NotificationsPage/components/TemplateManager.tsx
git commit -m "feat(web): TemplateManager category filter + inactive badge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Update NotificationsPage — wire to new endpoints

**File:**
- Modify: `apps/web/src/pages/NotificationsPage/index.tsx`

- [ ] **Step 1: Update template TS interface**

Find existing `interface NotificationTemplate` and update:
```typescript
interface NotificationTemplate {
  id: string;
  eventType: string;        // CHANGED: was templateId
  name: string;
  category: string;
  channelKey: string | null;
  channel: string;
  format: string;
  subject: string | null;
  messageTemplate: string;
  flexTemplate: string | null;
  description: string | null;
  isActive: boolean;
  sampleData: Record<string, string> | null;
  lastEditedBy: string | null;
  updatedAt: string;
}
```

- [ ] **Step 2: Update default template form state**

Replace `defaultTemplateForm` to include eventType + sampleData defaults.

- [ ] **Step 3: Update mutations to use new endpoints**

If existing mutations call `/notifications/templates/${id}` they should now use `${eventType}`.

- [ ] **Step 4: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep "NotificationsPage" | head -5
git add apps/web/src/pages/NotificationsPage/index.tsx
git commit -m "feat(web): NotificationsPage wires to new template endpoints

- Template type uses eventType (instead of legacy id-as-templateId)
- Mutations target /templates/:eventType paths
- Includes sampleData in form

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Final Verification (Day 5-6)

### Task 12: Add integration test for template-driven send

**File:**
- Create: `apps/api/src/modules/notifications/template-integration.spec.ts`

- [ ] **Step 1: Write integration test**

```typescript
// apps/api/src/modules/notifications/template-integration.spec.ts
import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NotificationTemplateService } from './notification-template.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { InternalServerErrorException } from '@nestjs/common';

describe('NotificationsService — sendFromTemplate integration', () => {
  let service: NotificationsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      notificationLog: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'log1', ...data })),
        count: jest.fn().mockResolvedValue(0),
      },
      notificationTemplate: {
        findUnique: jest.fn(),
      },
    };

    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }) as any);

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        NotificationTemplateService,
        ComplianceService,
        HolidayService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: FlexTemplatesService, useValue: {} },
        { provide: QuickReplyService, useValue: {} },
        { provide: IntegrationConfigService, useValue: { getValue: jest.fn().mockResolvedValue('token') } },
        { provide: PDPAService, useValue: { hasActiveConsent: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  afterEach(() => jest.useRealTimers());

  it('renders template + sends with template category', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z')); // 14:00 ICT
    prisma.notificationTemplate.findUnique.mockResolvedValueOnce({
      eventType: 'dunning.reminder',
      name: 'Reminder',
      category: 'DUNNING',
      channel: 'LINE',
      channelKey: 'line-finance',
      format: 'text',
      subject: null,
      messageTemplate: '[BESTCHOICE FINANCE] hi ${name}, owe ${amount}',
      flexTemplate: null,
      isActive: true,
      sampleData: null,
    });

    const result = await service.sendFromTemplate(
      'dunning.reminder',
      { name: 'John', amount: '1500' },
      'Uxxx',
      { customerId: 'c1', relatedId: 'k1' },
    );

    expect(result.status).toBe('SENT');
    expect(prisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message: '[BESTCHOICE FINANCE] hi John, owe 1500',
          category: 'DUNNING',
          channelKey: 'line-finance',
        }),
      }),
    );
  });

  it('throws InternalServerErrorException when template missing', async () => {
    prisma.notificationTemplate.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.sendFromTemplate('nonexistent.template', {}, 'Uxxx', {})
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('returns BLOCKED when template inactive', async () => {
    prisma.notificationTemplate.findUnique.mockResolvedValueOnce({
      eventType: 'dunning.reminder',
      isActive: false,
      messageTemplate: 'hi',
      category: 'DUNNING',
      channel: 'LINE',
      channelKey: 'line-finance',
      format: 'text',
    });
    const result = await service.sendFromTemplate('dunning.reminder', {}, 'Uxxx', {});
    expect(result.status).toBe('BLOCKED');
    expect(result.blockReason).toBe('TEMPLATE_INACTIVE');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/api && npx jest --testPathPattern=template-integration 2>&1 | tail -10
```
Expected: 3 pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/notifications/template-integration.spec.ts
git commit -m "test(notifications): integration tests for template-driven sends

3 tests cover happy path (render + send), missing-template (throw),
inactive-template (BLOCKED).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Final verification + memory

- [ ] **Step 1: Full type check**

```bash
bash tools/check-types.sh all 2>&1 | tail -3
```
Expected: PASS

- [ ] **Step 2: Full test suite**

```bash
cd apps/api && npx jest 2>&1 | tail -10
```
Expected: all pass (no regressions, 3+ new template tests)

- [ ] **Step 3: Walk through acceptance criteria**

- [ ] Schema migration creates `notification_templates` table
- [ ] Seed migration inserts 18 required templates
- [ ] Templates carry category + channelKey
- [ ] All inline messages in scheduler.service + notifications.service + mdm-auto removed (verify with grep for [BESTCHOICE FINANCE] in source — should find only in flex builders)
- [ ] Cron methods use `sendFromTemplate(eventType, ...)`
- [ ] Hard-fail: missing template → Sentry + Exception
- [ ] Hard-fail: inactive template → BLOCKED status
- [ ] Preview endpoint renders with sampleData
- [ ] Test send endpoint sends to current admin
- [ ] UI: Preview + Test send buttons
- [ ] UI: TemplateManager category filter + inactive badge

- [ ] **Step 4: Save memory**

`/Users/iamnaii/.claude/projects/-Users-iamnaii-Desktop-App-BESTCHOICE/memory/project_notifications_p3_shipped.md`

- [ ] **Step 5: Final commit if needed**

```bash
git add .
git commit -m "chore: P3 final verification + acceptance sign-off"
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ NotificationTemplate model + Prisma enum — Task 1
- ✅ Seed migration 18 templates — Task 2
- ✅ NotificationTemplateService CRUD — Task 3
- ✅ sendFromTemplate refactor + hard-fail — Task 4
- ✅ Cron migration (3 services) — Tasks 5+6+7
- ✅ Preview + Test send endpoints — Task 8
- ✅ TemplateForm UI — Task 9
- ✅ TemplateManager UI — Task 10
- ✅ NotificationsPage wiring — Task 11
- ✅ Integration test — Task 12
- ✅ Final verification — Task 13

**Type consistency:**
- `eventType` (string) used consistently across DTOs, service, controller, frontend
- `NotificationCategory` enum imported from `@prisma/client` everywhere
- `sendFromTemplate(eventType, data, recipient, options)` signature consistent

**Estimated effort:** 5-6 days
- Day 1: Tasks 1-2 (schema + seed)
- Day 2: Tasks 3-4 (service + sendFromTemplate refactor)
- Day 3: Tasks 5-7 (cron migration)
- Day 4: Task 8 (controller endpoints)
- Day 5: Tasks 9-11 (frontend)
- Day 6: Tasks 12-13 (tests + verification)
