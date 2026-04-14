# Auto Dunning Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform hardcoded dunning logic into a configurable rule engine with action tracking, payment link injection, promise-to-pay follow-up, and collection dashboard metrics.

**Architecture:** Add `DunningRule` model (configurable rules) and `DunningAction` model (audit trail per action). Refactor `SchedulerService` and `OverdueService` to execute rules from DB instead of hardcoded thresholds. Enhance dashboard with collection metrics. All changes build on existing overdue module, notification pipeline, and LINE/SMS infrastructure.

**Tech Stack:** NestJS 11, Prisma, PostgreSQL, React 19, TanStack Query, Tailwind CSS, BullMQ

**Existing infrastructure (do NOT rebuild):**
- `OverdueService`: escalateDunningStages(), calculateLateFees(), updateContractStatuses(), getBoardData(), call logging, settlement recording, collector assignment
- `SchedulerService`: cron jobs for late fees (00:00), status updates (00:30), escalation (01:00), reminders (08:00), overdue notices (09:00), manager/owner alerts (09:30/10:00)
- `NotificationsService`: sendPaymentReminders(), sendOverdueNotices(), sendSms(), sendLine(), BullMQ queue
- `LineOaService`: pushMessage(), sendFlexMessage(), Flex builders (payment-reminder, overdue-notice)
- `PaymentLinkService`: createPaymentLink() with 24hr expiry tokens
- Contract model: dunningStage, dunningEscalatedAt, dunningLastActionAt, assignedToId, collectionNotes, lastContactDate
- CallLog model: full audit trail of contact attempts
- DunningStage enum: NONE, REMINDER, NOTICE, FINAL_WARNING, LEGAL_ACTION

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `apps/api/prisma/migrations/XXXXXX_add_dunning_rules/migration.sql` | DunningRule + DunningAction tables |
| `apps/api/src/modules/overdue/dunning-rule.service.ts` | CRUD for dunning rules |
| `apps/api/src/modules/overdue/dunning-rule.service.spec.ts` | Tests for rule CRUD |
| `apps/api/src/modules/overdue/dunning-engine.service.ts` | Rule execution engine (replaces hardcoded logic) |
| `apps/api/src/modules/overdue/dunning-engine.service.spec.ts` | Tests for engine |
| `apps/api/src/modules/overdue/dto/dunning-rule.dto.ts` | CreateDunningRuleDto, UpdateDunningRuleDto |
| `apps/api/src/modules/overdue/dto/dunning-action-query.dto.ts` | Query filters for action log |
| `apps/web/src/pages/DunningSettingsPage.tsx` | Settings UI for dunning rules CRUD |
| `apps/web/src/pages/CollectionDashboardPage.tsx` | Collection metrics dashboard |

### Modified files
| File | Changes |
|------|---------|
| `apps/api/prisma/schema.prisma` | Add DunningRule, DunningAction models + DunningChannel enum |
| `apps/api/src/modules/overdue/overdue.controller.ts` | Add rule CRUD + action log endpoints |
| `apps/api/src/modules/overdue/overdue.module.ts` | Register new services |
| `apps/api/src/modules/notifications/scheduler.service.ts` | Replace hardcoded dunning with DunningEngineService calls |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | Add collection metrics methods |
| `apps/api/src/modules/dashboard/dashboard.controller.ts` | Add collection metrics endpoint |
| `apps/web/src/App.tsx` | Add routes for new pages |

---

## Task 1: Prisma Schema — DunningRule + DunningAction models

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add DunningChannel enum and DunningActionStatus enum to schema.prisma**

Add after existing enums (near the top of the file, where other enums are declared):

```prisma
enum DunningChannel {
  LINE
  SMS
  CALL_TASK
  INTERNAL_ALERT
}

enum DunningActionStatus {
  PENDING
  SENT
  DELIVERED
  FAILED
  SKIPPED
}
```

- [ ] **Step 2: Add DunningRule model**

Add after the CallLog model:

```prisma
model DunningRule {
  id                 String         @id @default(uuid())
  name               String         /// เช่น "แจ้งเตือน 3 วันก่อนกำหนด"
  triggerDay          Int            /// D-3 = -3, D+1 = 1, D+7 = 7
  channel            DunningChannel
  messageTemplate    String         /// template with {{customerName}}, {{contractNumber}}, {{amount}}, {{dueDate}}, {{daysOverdue}}, {{installmentNo}}
  includePaymentLink Boolean        @default(false)
  autoExecute        Boolean        @default(true) /// true=ส่งอัตโนมัติ, false=สร้าง task ให้พนักงาน
  escalateTo         UserRole?      /// assign ให้ role ไหน review (null = ไม่ escalate)
  isActive           Boolean        @default(true)
  sortOrder          Int            @default(0)
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt
  deletedAt          DateTime?

  actions            DunningAction[]

  @@index([triggerDay])
  @@index([isActive])
}
```

- [ ] **Step 3: Add DunningAction model**

```prisma
model DunningAction {
  id               String              @id @default(uuid())
  dunningRuleId    String
  dunningRule      DunningRule         @relation(fields: [dunningRuleId], references: [id], onDelete: Restrict)
  contractId       String
  contract         Contract            @relation(fields: [contractId], references: [id], onDelete: Restrict)
  paymentId        String?             /// the specific payment that triggered this action
  payment          Payment?            @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  channel          DunningChannel
  status           DunningActionStatus @default(PENDING)
  messageContent   String?             /// rendered message sent
  result           String?             /// delivery result or call outcome
  paymentLinkUrl   String?             /// payment link included (if any)
  executedAt       DateTime?
  executedById     String?             /// user who executed (for CALL_TASK)
  executedBy       User?               @relation("DunningActionExecutor", fields: [executedById], references: [id])
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt
  deletedAt        DateTime?

  @@unique([dunningRuleId, contractId, paymentId]) /// dedup: one action per rule+contract+payment
  @@index([contractId])
  @@index([status])
  @@index([createdAt])
}
```

- [ ] **Step 4: Add relations to Contract and Payment models**

In the Contract model, add:
```prisma
  dunningActions   DunningAction[]
```

In the Payment model, add:
```prisma
  dunningActions   DunningAction[]
```

In the User model, add (if not already present):
```prisma
  dunningActionsExecuted DunningAction[] @relation("DunningActionExecutor")
```

- [ ] **Step 5: Generate migration**

Run:
```bash
cd apps/api && npx prisma migrate dev --name add_dunning_rules_and_actions
```

Expected: Migration created successfully, `prisma generate` completes with 0 errors.

- [ ] **Step 6: Verify schema**

Run:
```bash
cd apps/api && npx prisma validate
```

Expected: "The schema is valid."

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(dunning): add DunningRule + DunningAction models

Configurable dunning rules (trigger day, channel, template, payment link)
with action tracking (dedup by rule+contract+payment)."
```

---

## Task 2: Seed default dunning rules

**Files:**
- Modify: `apps/api/prisma/seed.ts` (or wherever seed logic lives)

- [ ] **Step 1: Find the seed file**

Look for the existing seed file pattern:
```bash
ls apps/api/prisma/seed*
```

- [ ] **Step 2: Add default dunning rules to seed**

Add the following seed data (insert at the end of the seed function, guarded by `upsert` to avoid duplicates):

```typescript
// Default dunning rules
const defaultRules = [
  {
    name: 'แจ้งเตือน 3 วันก่อนกำหนด',
    triggerDay: -3,
    channel: 'LINE' as const,
    messageTemplate: 'สวัสดีค่ะ คุณ{{customerName}} งวดที่ {{installmentNo}} สัญญา {{contractNumber}} ครบกำหนดชำระ {{dueDate}} จำนวน {{amount}} บาท',
    includePaymentLink: true,
    autoExecute: true,
    sortOrder: 1,
  },
  {
    name: 'แจ้งเตือน 1 วันก่อนกำหนด',
    triggerDay: -1,
    channel: 'SMS' as const,
    messageTemplate: 'BESTCHOICE: พรุ่งนี้ครบกำหนดชำระงวดที่ {{installmentNo}} จำนวน {{amount}} บาท สัญญา {{contractNumber}}',
    includePaymentLink: false,
    autoExecute: true,
    sortOrder: 2,
  },
  {
    name: 'ทวงหนี้วันที่ 1 หลังกำหนด',
    triggerDay: 1,
    channel: 'LINE' as const,
    messageTemplate: 'สวัสดีค่ะ คุณ{{customerName}} งวดที่ {{installmentNo}} สัญญา {{contractNumber}} เลยกำหนดชำระ {{daysOverdue}} วัน ยอดค้าง {{amount}} บาท กรุณาชำระโดยเร็วค่ะ',
    includePaymentLink: true,
    autoExecute: true,
    sortOrder: 3,
  },
  {
    name: 'ทวงหนี้วันที่ 3 (SMS)',
    triggerDay: 3,
    channel: 'SMS' as const,
    messageTemplate: 'BESTCHOICE: ค้างชำระ {{daysOverdue}} วัน ยอด {{amount}} บาท สัญญา {{contractNumber}} กรุณาชำระทันที',
    includePaymentLink: false,
    autoExecute: true,
    sortOrder: 4,
  },
  {
    name: 'ทวงหนี้วันที่ 7 + สร้าง call task',
    triggerDay: 7,
    channel: 'CALL_TASK' as const,
    messageTemplate: 'โทรติดตาม: คุณ{{customerName}} สัญญา {{contractNumber}} ค้างชำระ {{daysOverdue}} วัน ยอด {{amount}} บาท',
    includePaymentLink: true,
    autoExecute: false,
    sortOrder: 5,
  },
  {
    name: 'แจ้งค่าปรับ + escalate FM',
    triggerDay: 14,
    channel: 'LINE' as const,
    messageTemplate: 'คุณ{{customerName}} สัญญา {{contractNumber}} ค้างชำระ {{daysOverdue}} วัน มีค่าปรับล่าช้าสะสม กรุณาติดต่อชำระเงินทันทีเพื่อหลีกเลี่ยงค่าปรับเพิ่มเติม',
    includePaymentLink: true,
    autoExecute: true,
    escalateTo: 'FINANCE_MANAGER' as const,
    sortOrder: 6,
  },
  {
    name: 'แจ้งเตือนก่อนยึดเครื่อง',
    triggerDay: 30,
    channel: 'INTERNAL_ALERT' as const,
    messageTemplate: 'สัญญา {{contractNumber}} ค้างชำระ {{daysOverdue}} วัน — พิจารณา MDM Lock',
    includePaymentLink: false,
    autoExecute: false,
    escalateTo: 'OWNER' as const,
    sortOrder: 7,
  },
  {
    name: 'Flag bad debt candidate',
    triggerDay: 90,
    channel: 'INTERNAL_ALERT' as const,
    messageTemplate: 'สัญญา {{contractNumber}} ค้างชำระ {{daysOverdue}} วัน — พิจารณาตัดเป็นหนี้สูญ',
    includePaymentLink: false,
    autoExecute: false,
    escalateTo: 'OWNER' as const,
    sortOrder: 8,
  },
];

for (const rule of defaultRules) {
  await prisma.dunningRule.upsert({
    where: {
      // Use a combination lookup — need to find by triggerDay+channel since no unique constraint
      id: (await prisma.dunningRule.findFirst({
        where: { triggerDay: rule.triggerDay, channel: rule.channel, deletedAt: null },
        select: { id: true },
      }))?.id ?? 'non-existent-id',
    },
    create: rule,
    update: {},
  });
}
console.log('Seeded default dunning rules');
```

- [ ] **Step 3: Run seed**

```bash
cd apps/api && npx prisma db seed
```

Expected: "Seeded default dunning rules" in output.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(dunning): seed 8 default dunning rules

D-3 LINE, D-1 SMS, D+1 LINE, D+3 SMS, D+7 call task,
D+14 LINE+escalate FM, D+30 internal alert, D+90 bad debt flag."
```

---

## Task 3: DunningRule DTOs

**Files:**
- Create: `apps/api/src/modules/overdue/dto/dunning-rule.dto.ts`

- [ ] **Step 1: Create DTOs**

```typescript
import {
  IsString,
  IsInt,
  IsEnum,
  IsBoolean,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { DunningChannel } from '@prisma/client';
import { UserRole } from '@prisma/client';

export class CreateDunningRuleDto {
  @IsString({ message: 'กรุณาระบุชื่อ rule' })
  @MinLength(1, { message: 'ชื่อ rule ต้องมีอย่างน้อย 1 ตัวอักษร' })
  @MaxLength(200, { message: 'ชื่อ rule ต้องไม่เกิน 200 ตัวอักษร' })
  name: string;

  @IsInt({ message: 'triggerDay ต้องเป็นจำนวนเต็ม' })
  triggerDay: number;

  @IsEnum(DunningChannel, { message: 'channel ไม่ถูกต้อง' })
  channel: DunningChannel;

  @IsString({ message: 'กรุณาระบุ template ข้อความ' })
  @MinLength(1, { message: 'template ต้องมีอย่างน้อย 1 ตัวอักษร' })
  @MaxLength(2000, { message: 'template ต้องไม่เกิน 2000 ตัวอักษร' })
  messageTemplate: string;

  @IsBoolean()
  @IsOptional()
  includePaymentLink?: boolean;

  @IsBoolean()
  @IsOptional()
  autoExecute?: boolean;

  @IsEnum(UserRole, { message: 'escalateTo ต้องเป็น role ที่ถูกต้อง' })
  @IsOptional()
  escalateTo?: UserRole;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @IsOptional()
  sortOrder?: number;
}

export class UpdateDunningRuleDto {
  @IsString({ message: 'กรุณาระบุชื่อ rule' })
  @MinLength(1)
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @IsInt({ message: 'triggerDay ต้องเป็นจำนวนเต็ม' })
  @IsOptional()
  triggerDay?: number;

  @IsEnum(DunningChannel, { message: 'channel ไม่ถูกต้อง' })
  @IsOptional()
  channel?: DunningChannel;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @IsOptional()
  messageTemplate?: string;

  @IsBoolean()
  @IsOptional()
  includePaymentLink?: boolean;

  @IsBoolean()
  @IsOptional()
  autoExecute?: boolean;

  @IsEnum(UserRole)
  @IsOptional()
  escalateTo?: UserRole | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @IsOptional()
  sortOrder?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/overdue/dto/dunning-rule.dto.ts
git commit -m "feat(dunning): add Create/Update DunningRule DTOs with Thai validation"
```

---

## Task 4: DunningRule CRUD service + tests

**Files:**
- Create: `apps/api/src/modules/overdue/dunning-rule.service.ts`
- Create: `apps/api/src/modules/overdue/dunning-rule.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// dunning-rule.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { DunningRuleService } from './dunning-rule.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DunningRuleService', () => {
  let service: DunningRuleService;
  let prisma: PrismaService;

  const mockPrisma = {
    dunningRule: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DunningRuleService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DunningRuleService>(DunningRuleService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return only active, non-deleted rules ordered by sortOrder', async () => {
      const rules = [
        { id: '1', name: 'D-3 LINE', triggerDay: -3, sortOrder: 1, isActive: true },
        { id: '2', name: 'D+1 LINE', triggerDay: 1, sortOrder: 2, isActive: true },
      ];
      mockPrisma.dunningRule.findMany.mockResolvedValue(rules);

      const result = await service.findAll();

      expect(result).toEqual(rules);
      expect(mockPrisma.dunningRule.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('findActiveRulesForDay', () => {
    it('should return only active rules matching triggerDay', async () => {
      const rules = [{ id: '1', triggerDay: -3, channel: 'LINE', isActive: true }];
      mockPrisma.dunningRule.findMany.mockResolvedValue(rules);

      const result = await service.findActiveRulesForDay(-3);

      expect(result).toEqual(rules);
      expect(mockPrisma.dunningRule.findMany).toHaveBeenCalledWith({
        where: { triggerDay: -3, isActive: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('create', () => {
    it('should create a new dunning rule', async () => {
      const dto = {
        name: 'Test Rule',
        triggerDay: 5,
        channel: 'LINE' as const,
        messageTemplate: 'Hello {{customerName}}',
      };
      const created = { id: 'new-id', ...dto, isActive: true, sortOrder: 0 };
      mockPrisma.dunningRule.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(mockPrisma.dunningRule.create).toHaveBeenCalledWith({ data: dto });
    });
  });

  describe('update', () => {
    it('should update an existing rule', async () => {
      const existing = { id: '1', name: 'Old', deletedAt: null };
      mockPrisma.dunningRule.findFirst.mockResolvedValue(existing);
      mockPrisma.dunningRule.update.mockResolvedValue({ ...existing, name: 'New' });

      const result = await service.update('1', { name: 'New' });

      expect(result.name).toBe('New');
    });

    it('should throw NotFoundException for deleted rule', async () => {
      mockPrisma.dunningRule.findFirst.mockResolvedValue(null);

      await expect(service.update('bad-id', { name: 'New' })).rejects.toThrow('ไม่พบ Dunning Rule');
    });
  });

  describe('softDelete', () => {
    it('should set deletedAt on the rule', async () => {
      mockPrisma.dunningRule.findFirst.mockResolvedValue({ id: '1', deletedAt: null });
      mockPrisma.dunningRule.update.mockResolvedValue({ id: '1', deletedAt: new Date() });

      const result = await service.softDelete('1');

      expect(result.deletedAt).toBeTruthy();
      expect(mockPrisma.dunningRule.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest dunning-rule.service.spec --no-coverage
```

Expected: FAIL — `Cannot find module './dunning-rule.service'`

- [ ] **Step 3: Implement DunningRuleService**

```typescript
// dunning-rule.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDunningRuleDto, UpdateDunningRuleDto } from './dto/dunning-rule.dto';

@Injectable()
export class DunningRuleService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.dunningRule.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findActiveRulesForDay(triggerDay: number) {
    return this.prisma.dunningRule.findMany({
      where: { triggerDay, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findAllActiveRules() {
    return this.prisma.dunningRule.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { triggerDay: 'asc' },
    });
  }

  async create(dto: CreateDunningRuleDto) {
    return this.prisma.dunningRule.create({ data: dto });
  }

  async update(id: string, dto: UpdateDunningRuleDto) {
    const rule = await this.prisma.dunningRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('ไม่พบ Dunning Rule');

    return this.prisma.dunningRule.update({
      where: { id },
      data: dto,
    });
  }

  async softDelete(id: string) {
    const rule = await this.prisma.dunningRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('ไม่พบ Dunning Rule');

    return this.prisma.dunningRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest dunning-rule.service.spec --no-coverage
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/dunning-rule.service.ts apps/api/src/modules/overdue/dunning-rule.service.spec.ts
git commit -m "feat(dunning): DunningRule CRUD service with tests

findAll, findActiveRulesForDay, create, update, softDelete.
5 unit tests covering CRUD + not-found error."
```

---

## Task 5: Dunning Engine — rule execution service + tests

**Files:**
- Create: `apps/api/src/modules/overdue/dunning-engine.service.ts`
- Create: `apps/api/src/modules/overdue/dunning-engine.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// dunning-engine.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { DunningEngineService } from './dunning-engine.service';
import { DunningRuleService } from './dunning-rule.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';
import { Logger } from '@nestjs/common';

describe('DunningEngineService', () => {
  let service: DunningEngineService;

  const mockPrisma = {
    payment: { findMany: jest.fn() },
    dunningAction: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    contract: { update: jest.fn() },
  };
  const mockRuleService = { findAllActiveRules: jest.fn() };
  const mockNotifications = { send: jest.fn() };
  const mockPaymentLink = { createPaymentLink: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DunningEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DunningRuleService, useValue: mockRuleService },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: PaymentLinkService, useValue: mockPaymentLink },
      ],
    }).compile();

    service = module.get<DunningEngineService>(DunningEngineService);
    jest.clearAllMocks();
  });

  describe('renderTemplate', () => {
    it('should replace all template variables', () => {
      const template = 'คุณ{{customerName}} สัญญา {{contractNumber}} ยอด {{amount}} บาท ค้าง {{daysOverdue}} วัน';
      const vars = {
        customerName: 'สมชาย',
        contractNumber: 'BC-001',
        amount: '5,000',
        daysOverdue: '7',
        dueDate: '15/04/2026',
        installmentNo: '3',
      };

      const result = service.renderTemplate(template, vars);

      expect(result).toBe('คุณสมชาย สัญญา BC-001 ยอด 5,000 บาท ค้าง 7 วัน');
    });

    it('should leave unknown variables as-is', () => {
      const result = service.renderTemplate('{{unknown}}', { customerName: 'A' });
      expect(result).toBe('{{unknown}}');
    });
  });

  describe('dedup', () => {
    it('should skip if action already exists for rule+contract+payment', async () => {
      mockPrisma.dunningAction.findFirst.mockResolvedValue({ id: 'existing' });

      const shouldSkip = await service.hasExistingAction('rule-1', 'contract-1', 'payment-1');

      expect(shouldSkip).toBe(true);
    });

    it('should not skip if no existing action', async () => {
      mockPrisma.dunningAction.findFirst.mockResolvedValue(null);

      const shouldSkip = await service.hasExistingAction('rule-1', 'contract-1', 'payment-1');

      expect(shouldSkip).toBe(false);
    });
  });

  describe('executeRules', () => {
    it('should process pre-due rules (negative triggerDay) for upcoming payments', async () => {
      const rule = {
        id: 'rule-1',
        triggerDay: -3,
        channel: 'LINE',
        messageTemplate: 'งวด {{installmentNo}} ครบกำหนด {{dueDate}}',
        includePaymentLink: true,
        autoExecute: true,
        escalateTo: null,
      };
      mockRuleService.findAllActiveRules.mockResolvedValue([rule]);

      // Payment due in 3 days
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      mockPrisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          contractId: 'c-1',
          installmentNo: 3,
          dueDate: threeDaysFromNow,
          amountDue: { toNumber: () => 5000 },
          amountPaid: { toNumber: () => 0 },
          lateFee: { toNumber: () => 0 },
          contract: {
            id: 'c-1',
            contractNumber: 'BC-001',
            customer: { name: 'สมชาย', lineId: 'U123', phone: '0812345678', id: 'cust-1' },
          },
        },
      ]);

      mockPrisma.dunningAction.findFirst.mockResolvedValue(null); // no dedup
      mockPaymentLink.createPaymentLink.mockResolvedValue({ url: 'https://pay.link/abc' });
      mockNotifications.send.mockResolvedValue({ id: 'notif-1', status: 'SENT' });
      mockPrisma.dunningAction.create.mockResolvedValue({ id: 'action-1' });

      const result = await service.executeRules();

      expect(result.executed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(mockNotifications.send).toHaveBeenCalledTimes(1);
      expect(mockPaymentLink.createPaymentLink).toHaveBeenCalledTimes(1);
    });

    it('should skip if action already exists (dedup)', async () => {
      const rule = {
        id: 'rule-1',
        triggerDay: -3,
        channel: 'LINE',
        messageTemplate: 'test',
        includePaymentLink: false,
        autoExecute: true,
        escalateTo: null,
      };
      mockRuleService.findAllActiveRules.mockResolvedValue([rule]);

      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      mockPrisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          contractId: 'c-1',
          installmentNo: 1,
          dueDate: threeDaysFromNow,
          amountDue: { toNumber: () => 3000 },
          amountPaid: { toNumber: () => 0 },
          lateFee: { toNumber: () => 0 },
          contract: {
            id: 'c-1',
            contractNumber: 'BC-002',
            customer: { name: 'สมหญิง', lineId: 'U456', phone: '0899999999', id: 'cust-2' },
          },
        },
      ]);

      mockPrisma.dunningAction.findFirst.mockResolvedValue({ id: 'existing' }); // already sent

      const result = await service.executeRules();

      expect(result.executed).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });

    it('should create CALL_TASK action without sending notification', async () => {
      const rule = {
        id: 'rule-call',
        triggerDay: 7,
        channel: 'CALL_TASK',
        messageTemplate: 'โทรติดตาม {{customerName}}',
        includePaymentLink: false,
        autoExecute: false,
        escalateTo: null,
      };
      mockRuleService.findAllActiveRules.mockResolvedValue([rule]);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      mockPrisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay-2',
          contractId: 'c-2',
          installmentNo: 2,
          dueDate: sevenDaysAgo,
          amountDue: { toNumber: () => 4000 },
          amountPaid: { toNumber: () => 0 },
          lateFee: { toNumber: () => 350 },
          contract: {
            id: 'c-2',
            contractNumber: 'BC-003',
            customer: { name: 'สมศรี', lineId: null, phone: '0877777777', id: 'cust-3' },
          },
        },
      ]);

      mockPrisma.dunningAction.findFirst.mockResolvedValue(null);
      mockPrisma.dunningAction.create.mockResolvedValue({ id: 'action-call' });

      const result = await service.executeRules();

      expect(result.executed).toBe(1);
      expect(mockNotifications.send).not.toHaveBeenCalled(); // CALL_TASK = no auto-send
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest dunning-engine.service.spec --no-coverage
```

Expected: FAIL — `Cannot find module './dunning-engine.service'`

- [ ] **Step 3: Implement DunningEngineService**

```typescript
// dunning-engine.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningRuleService } from './dunning-rule.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';
import { DunningChannel } from '@prisma/client';
import { formatDateShort } from '../../utils/thai-date.util';

interface TemplateVars {
  customerName: string;
  contractNumber: string;
  amount: string;
  dueDate: string;
  daysOverdue: string;
  installmentNo: string;
}

@Injectable()
export class DunningEngineService {
  private readonly logger = new Logger(DunningEngineService.name);

  constructor(
    private prisma: PrismaService,
    private ruleService: DunningRuleService,
    private notificationsService: NotificationsService,
    private paymentLinkService: PaymentLinkService,
  ) {}

  /**
   * Replace {{variable}} placeholders in a template string.
   */
  renderTemplate(template: string, vars: TemplateVars): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return key in vars ? vars[key as keyof TemplateVars] : match;
    });
  }

  /**
   * Check if an action already exists for this rule+contract+payment (dedup).
   */
  async hasExistingAction(
    dunningRuleId: string,
    contractId: string,
    paymentId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.dunningAction.findFirst({
      where: { dunningRuleId, contractId, paymentId, deletedAt: null },
    });
    return !!existing;
  }

  /**
   * Main execution loop: load all active rules, find matching payments, execute actions.
   * Called by SchedulerService cron job.
   */
  async executeRules(): Promise<{ executed: number; skipped: number; failed: number }> {
    const now = new Date();
    const rules = await this.ruleService.findAllActiveRules();

    let executed = 0;
    let skipped = 0;
    let failed = 0;

    for (const rule of rules) {
      try {
        const payments = await this.findMatchingPayments(rule.triggerDay, now);

        for (const payment of payments) {
          try {
            // Dedup check
            if (await this.hasExistingAction(rule.id, payment.contractId, payment.id)) {
              skipped++;
              continue;
            }

            const customer = payment.contract.customer;
            const outstanding = payment.amountDue.toNumber() - payment.amountPaid.toNumber() + payment.lateFee.toNumber();
            const daysOverdue = rule.triggerDay > 0
              ? Math.floor((now.getTime() - payment.dueDate.getTime()) / (1000 * 60 * 60 * 24))
              : Math.abs(rule.triggerDay);

            const vars: TemplateVars = {
              customerName: customer.name,
              contractNumber: payment.contract.contractNumber,
              amount: outstanding.toLocaleString('th-TH'),
              dueDate: formatDateShort(payment.dueDate),
              daysOverdue: String(daysOverdue),
              installmentNo: String(payment.installmentNo),
            };

            const message = this.renderTemplate(rule.messageTemplate, vars);

            // Generate payment link if configured
            let paymentLinkUrl: string | undefined;
            if (rule.includePaymentLink && customer.lineId) {
              try {
                const link = await this.paymentLinkService.createPaymentLink(
                  payment.contractId,
                  payment.id,
                  outstanding,
                );
                paymentLinkUrl = link.url;
              } catch (err) {
                this.logger.warn(`Failed to create payment link for ${payment.contract.contractNumber}: ${err}`);
              }
            }

            // Execute based on channel
            let sendResult: string | undefined;
            if (rule.autoExecute && (rule.channel === 'LINE' || rule.channel === 'SMS')) {
              const fullMessage = paymentLinkUrl
                ? `${message}\n\nชำระเงิน: ${paymentLinkUrl}`
                : message;

              const channel = rule.channel === 'LINE' && customer.lineId ? 'LINE' : 'SMS';
              const recipient = channel === 'LINE' ? customer.lineId! : customer.phone;

              if (recipient) {
                const notifResult = await this.notificationsService.send({
                  channel,
                  recipient,
                  subject: `Dunning: ${rule.name}`,
                  message: fullMessage,
                  relatedId: payment.contractId,
                  fallbackPhone: customer.phone || undefined,
                });
                sendResult = notifResult.status;
              }
            }

            // Record the action
            await this.prisma.dunningAction.create({
              data: {
                dunningRuleId: rule.id,
                contractId: payment.contractId,
                paymentId: payment.id,
                channel: rule.channel,
                status: rule.autoExecute ? (sendResult === 'SENT' ? 'SENT' : sendResult === 'FAILED' ? 'FAILED' : 'PENDING') : 'PENDING',
                messageContent: message,
                result: sendResult,
                paymentLinkUrl,
                executedAt: rule.autoExecute ? now : null,
              },
            });

            // Escalate if configured
            if (rule.escalateTo) {
              await this.prisma.contract.update({
                where: { id: payment.contractId },
                data: { dunningLastActionAt: now },
              });
            }

            executed++;
          } catch (err) {
            failed++;
            this.logger.warn(`Dunning action failed for rule ${rule.name}, contract ${payment.contractId}: ${err}`);
            Sentry.captureException(err, {
              tags: { kind: 'dunning-engine', rule: rule.name },
            });
          }
        }
      } catch (err) {
        this.logger.error(`Failed to process dunning rule ${rule.name}: ${err}`);
        Sentry.captureException(err, {
          tags: { kind: 'dunning-engine', rule: rule.name },
        });
      }
    }

    this.logger.log(`Dunning engine: ${executed} executed, ${skipped} skipped, ${failed} failed`);
    return { executed, skipped, failed };
  }

  /**
   * Find payments matching a trigger day.
   * Negative triggerDay = days BEFORE due (upcoming payments).
   * Positive triggerDay = days AFTER due (overdue payments).
   */
  private async findMatchingPayments(triggerDay: number, now: Date) {
    const targetDate = new Date(now);
    if (triggerDay < 0) {
      // Pre-due: find payments due in abs(triggerDay) days
      targetDate.setDate(targetDate.getDate() + Math.abs(triggerDay));
    } else {
      // Post-due: find payments overdue by triggerDay days
      targetDate.setDate(targetDate.getDate() - triggerDay);
    }

    // Match payments where dueDate falls on the target day
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const statusFilter = triggerDay < 0
      ? { in: ['PENDING'] as const }
      : { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] as const };

    return this.prisma.payment.findMany({
      where: {
        dueDate: { gte: startOfDay, lte: endOfDay },
        status: statusFilter,
        contract: {
          status: triggerDay < 0
            ? { in: ['ACTIVE'] }
            : { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
          deletedAt: null,
        },
      },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true, lineId: true, phone: true } },
          },
        },
      },
    });
  }

  /**
   * Get dunning action history for a contract.
   */
  async getActionsForContract(contractId: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const where = { contractId, deletedAt: null };

    const [data, total] = await Promise.all([
      this.prisma.dunningAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
        include: {
          dunningRule: { select: { name: true, channel: true, triggerDay: true } },
          executedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.dunningAction.count({ where }),
    ]);

    return { data, total, page, limit: safeLimit };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest dunning-engine.service.spec --no-coverage
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/dunning-engine.service.ts apps/api/src/modules/overdue/dunning-engine.service.spec.ts
git commit -m "feat(dunning): rule execution engine with dedup + payment links

Processes all active DunningRules, matches payments by triggerDay,
sends LINE/SMS via NotificationsService, creates DunningAction records.
Dedup by rule+contract+payment. 6 unit tests."
```

---

## Task 6: Wire into controller + module

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts`
- Modify: `apps/api/src/modules/overdue/overdue.module.ts`

- [ ] **Step 1: Read current controller and module files**

```bash
head -50 apps/api/src/modules/overdue/overdue.controller.ts
cat apps/api/src/modules/overdue/overdue.module.ts
```

- [ ] **Step 2: Register new services in OverdueModule**

Add `DunningRuleService` and `DunningEngineService` to the module's providers. Add `PaymentLinkService` to imports if not already imported (it's from `line-oa` module):

```typescript
// Add to imports at top of overdue.module.ts
import { DunningRuleService } from './dunning-rule.service';
import { DunningEngineService } from './dunning-engine.service';

// Add to providers array
providers: [OverdueService, DunningRuleService, DunningEngineService],

// Add to exports array (so SchedulerService can use DunningEngineService)
exports: [OverdueService, DunningEngineService],
```

Ensure `NotificationsModule` and `LineOaModule` (which contains `PaymentLinkService`) are in the module's imports.

- [ ] **Step 3: Add dunning rule CRUD endpoints to controller**

Add these endpoints to `overdue.controller.ts`:

```typescript
import { DunningRuleService } from './dunning-rule.service';
import { DunningEngineService } from './dunning-engine.service';
import { CreateDunningRuleDto, UpdateDunningRuleDto } from './dto/dunning-rule.dto';

// Inject in constructor:
// private dunningRuleService: DunningRuleService,
// private dunningEngineService: DunningEngineService,

// --- Dunning Rules CRUD (OWNER only) ---

@Get('dunning-rules')
@Roles('OWNER', 'FINANCE_MANAGER')
async getDunningRules() {
  return this.dunningRuleService.findAll();
}

@Post('dunning-rules')
@Roles('OWNER')
async createDunningRule(@Body() dto: CreateDunningRuleDto) {
  return this.dunningRuleService.create(dto);
}

@Patch('dunning-rules/:id')
@Roles('OWNER')
async updateDunningRule(@Param('id') id: string, @Body() dto: UpdateDunningRuleDto) {
  return this.dunningRuleService.update(id, dto);
}

@Delete('dunning-rules/:id')
@Roles('OWNER')
async deleteDunningRule(@Param('id') id: string) {
  return this.dunningRuleService.softDelete(id);
}

// --- Dunning Actions (history) ---

@Get('contracts/:id/dunning-actions')
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
async getDunningActions(
  @Param('id') contractId: string,
  @Query('page') page?: string,
  @Query('limit') limit?: string,
) {
  return this.dunningEngineService.getActionsForContract(
    contractId,
    page ? parseInt(page) : 1,
    limit ? parseInt(limit) : 50,
  );
}

// --- Manual trigger (OWNER only) ---

@Post('cron/execute-dunning-rules')
@Roles('OWNER')
async manualExecuteDunningRules() {
  return this.dunningEngineService.executeRules();
}
```

- [ ] **Step 4: Run type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/
git commit -m "feat(dunning): wire DunningRule CRUD + DunningAction endpoints

GET/POST/PATCH/DELETE dunning-rules (OWNER),
GET dunning-actions per contract (OWNER/FM/BM),
POST manual execute trigger (OWNER)."
```

---

## Task 7: Refactor SchedulerService to use DunningEngine

**Files:**
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts`

- [ ] **Step 1: Inject DunningEngineService into SchedulerService**

Add to constructor:
```typescript
import { DunningEngineService } from '../overdue/dunning-engine.service';

// Add to constructor params:
private dunningEngineService: DunningEngineService,
```

- [ ] **Step 2: Add new cron job for rule-based dunning execution**

Add a new cron method that runs the configurable engine. Keep existing hardcoded crons as-is for backward compatibility (they handle different things: payment reminders, overdue notices, manager alerts). The new engine handles configurable rules:

```typescript
/**
 * Run daily at 08:15: execute configurable dunning rules
 * This runs AFTER payment reminders (08:00) and BEFORE overdue notices (09:00)
 * to complement the existing hardcoded notification pipeline.
 */
@Cron('15 8 * * *')
async handleDunningRuleExecution() {
  this.logger.log('Starting configurable dunning rule execution...');
  try {
    const result = await this.dunningEngineService.executeRules();
    this.logger.log(
      `Dunning rules complete: ${result.executed} executed, ${result.skipped} skipped, ${result.failed} failed`,
    );
  } catch (error) {
    this.reportCronFailure('dunning-rule-execution', error);
  }
}
```

- [ ] **Step 3: Update SchedulerModule imports if needed**

Ensure `OverdueModule` is in the imports of `SchedulerModule` (or wherever `SchedulerService` lives) so `DunningEngineService` is available.

- [ ] **Step 4: Run type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications/scheduler.service.ts apps/api/src/modules/notifications/
git commit -m "feat(dunning): add rule-based dunning cron at 08:15

DunningEngineService.executeRules() runs daily, processing
all active DunningRules. Complements existing hardcoded pipeline."
```

---

## Task 8: Collection Dashboard metrics — backend

**Files:**
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.controller.ts`

- [ ] **Step 1: Add collection metrics method to DashboardService**

```typescript
/**
 * Collection dashboard metrics:
 * - Aging buckets (contract count + amount per bucket)
 * - Collection rate (payments received this month vs total due)
 * - Recovery after dunning (payments received within 7 days of dunning action)
 * - Top delinquent customers
 * - Dunning channel effectiveness
 */
async getCollectionMetrics(branchId?: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const branchFilter = branchId ? { contract: { branchId, deletedAt: null } } : { contract: { deletedAt: null } };
  const contractBranchFilter = branchId ? { branchId, deletedAt: null } : { deletedAt: null };

  // 1. Aging buckets
  const overduePayments = await this.prisma.payment.findMany({
    where: {
      status: { in: ['OVERDUE', 'PARTIALLY_PAID'] },
      dueDate: { lt: now },
      ...branchFilter,
    },
    select: {
      amountDue: true,
      amountPaid: true,
      lateFee: true,
      dueDate: true,
      contractId: true,
    },
  });

  const buckets = [
    { label: '1-7 วัน', min: 1, max: 7, count: 0, amount: 0 },
    { label: '8-14 วัน', min: 8, max: 14, count: 0, amount: 0 },
    { label: '15-30 วัน', min: 15, max: 30, count: 0, amount: 0 },
    { label: '31-60 วัน', min: 31, max: 60, count: 0, amount: 0 },
    { label: '61-90 วัน', min: 61, max: 90, count: 0, amount: 0 },
    { label: '90+ วัน', min: 91, max: Infinity, count: 0, amount: 0 },
  ];

  for (const p of overduePayments) {
    const daysOverdue = Math.floor((now.getTime() - p.dueDate.getTime()) / (1000 * 60 * 60 * 24));
    const outstanding = Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee);
    for (const bucket of buckets) {
      if (daysOverdue >= bucket.min && daysOverdue <= bucket.max) {
        bucket.count++;
        bucket.amount += outstanding;
        break;
      }
    }
  }

  // 2. Collection rate: payments collected this month / total due this month
  const [collectedThisMonth, dueThisMonth] = await Promise.all([
    this.prisma.payment.aggregate({
      where: {
        status: 'PAID',
        paidDate: { gte: startOfMonth },
        ...branchFilter,
      },
      _sum: { amountPaid: true },
      _count: true,
    }),
    this.prisma.payment.aggregate({
      where: {
        dueDate: { gte: startOfMonth, lte: now },
        ...branchFilter,
      },
      _sum: { amountDue: true },
      _count: true,
    }),
  ]);

  const collectedAmount = Number(collectedThisMonth._sum.amountPaid ?? 0);
  const dueAmount = Number(dueThisMonth._sum.amountDue ?? 0);
  const collectionRate = dueAmount > 0 ? Math.round((collectedAmount / dueAmount) * 10000) / 100 : 0;

  // 2b. Last month collection rate for MoM
  const [collectedLastMonth, dueLastMonth] = await Promise.all([
    this.prisma.payment.aggregate({
      where: {
        status: 'PAID',
        paidDate: { gte: startOfLastMonth, lte: endOfLastMonth },
        ...branchFilter,
      },
      _sum: { amountPaid: true },
    }),
    this.prisma.payment.aggregate({
      where: {
        dueDate: { gte: startOfLastMonth, lte: endOfLastMonth },
        ...branchFilter,
      },
      _sum: { amountDue: true },
    }),
  ]);

  const lastMonthCollected = Number(collectedLastMonth._sum.amountPaid ?? 0);
  const lastMonthDue = Number(dueLastMonth._sum.amountDue ?? 0);
  const lastMonthRate = lastMonthDue > 0 ? Math.round((lastMonthCollected / lastMonthDue) * 10000) / 100 : 0;

  // 3. Top 10 delinquent customers
  const topDelinquent: { customerId: string; customerName: string; totalOverdue: number; contractCount: number }[] =
    await this.prisma.$queryRaw`
      SELECT
        c."customer_id" AS "customerId",
        cu."name" AS "customerName",
        SUM(p."amount_due" - p."amount_paid" + p."late_fee")::float AS "totalOverdue",
        COUNT(DISTINCT c."id")::int AS "contractCount"
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id
      JOIN customers cu ON cu.id = c.customer_id
      WHERE p.status IN ('OVERDUE', 'PARTIALLY_PAID')
        AND p.due_date < NOW()
        AND c.deleted_at IS NULL
        AND c.status IN ('OVERDUE', 'DEFAULT')
        ${branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty}
      GROUP BY c.customer_id, cu.name
      ORDER BY "totalOverdue" DESC
      LIMIT 10
    `;

  // 4. Dunning channel effectiveness (actions sent in last 30 days → how many led to payment within 7 days)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const channelStats = await this.prisma.$queryRaw`
    SELECT
      da.channel,
      COUNT(*)::int AS "totalSent",
      COUNT(
        CASE WHEN EXISTS (
          SELECT 1 FROM payments p
          WHERE p.contract_id = da.contract_id
            AND p.status = 'PAID'
            AND p.paid_date BETWEEN da.executed_at AND da.executed_at + interval '7 days'
        ) THEN 1 END
      )::int AS "ledToPayment"
    FROM dunning_actions da
    WHERE da.status = 'SENT'
      AND da.executed_at >= ${thirtyDaysAgo}
      AND da.deleted_at IS NULL
    GROUP BY da.channel
  `;

  return {
    agingBuckets: buckets,
    collectionRate: {
      current: collectionRate,
      lastMonth: lastMonthRate,
      mom: collectionRate - lastMonthRate,
    },
    collected: {
      thisMonth: collectedAmount,
      count: collectedThisMonth._count,
    },
    topDelinquent,
    channelEffectiveness: channelStats,
  };
}
```

- [ ] **Step 2: Add endpoint to DashboardController**

```typescript
@Get('collection-metrics')
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
async getCollectionMetrics(@Request() req: any) {
  const branchId = ['SALES', 'BRANCH_MANAGER'].includes(req.user.role)
    ? req.user.branchId
    : undefined;
  return this.dashboardService.getCollectionMetrics(branchId);
}
```

- [ ] **Step 3: Run type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/dashboard/
git commit -m "feat(dunning): collection dashboard metrics endpoint

Aging buckets, collection rate MoM, top 10 delinquent,
dunning channel effectiveness (30-day lookback)."
```

---

## Task 9: Dunning Settings page (frontend)

**Files:**
- Create: `apps/web/src/pages/DunningSettingsPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create DunningSettingsPage**

A settings page where OWNER can view, create, edit, toggle, reorder, and delete dunning rules. Use the same patterns as other settings pages (e.g., `InterestConfigPage.tsx` or `PricingTemplatesPage.tsx`).

```typescript
// DunningSettingsPage.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, GripVertical, MessageSquare, Phone, Bell, ToggleLeft, ToggleRight, Link2,
} from 'lucide-react';

interface DunningRule {
  id: string;
  name: string;
  triggerDay: number;
  channel: 'LINE' | 'SMS' | 'CALL_TASK' | 'INTERNAL_ALERT';
  messageTemplate: string;
  includePaymentLink: boolean;
  autoExecute: boolean;
  escalateTo: string | null;
  isActive: boolean;
  sortOrder: number;
}

const channelLabels: Record<string, { label: string; icon: typeof MessageSquare }> = {
  LINE: { label: 'LINE', icon: MessageSquare },
  SMS: { label: 'SMS', icon: Phone },
  CALL_TASK: { label: 'โทรติดตาม', icon: Phone },
  INTERNAL_ALERT: { label: 'แจ้งเตือนภายใน', icon: Bell },
};

function formatTriggerDay(day: number) {
  if (day < 0) return `${Math.abs(day)} วันก่อนกำหนด`;
  if (day === 0) return 'วันครบกำหนด';
  return `${day} วันหลังกำหนด`;
}

export default function DunningSettingsPage() {
  const queryClient = useQueryClient();
  const [editingRule, setEditingRule] = useState<DunningRule | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data: rules = [], isLoading } = useQuery<DunningRule[]>({
    queryKey: ['dunning-rules'],
    queryFn: () => api.get('/overdue/dunning-rules').then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<DunningRule>) => api.post('/overdue/dunning-rules', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dunning-rules'] });
      toast.success('สร้าง Rule สำเร็จ');
      setShowForm(false);
    },
    onError: () => toast.error('สร้าง Rule ไม่สำเร็จ'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DunningRule> }) =>
      api.patch(`/overdue/dunning-rules/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dunning-rules'] });
      toast.success('อัปเดต Rule สำเร็จ');
      setEditingRule(null);
    },
    onError: () => toast.error('อัปเดต Rule ไม่สำเร็จ'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/overdue/dunning-rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dunning-rules'] });
      toast.success('ลบ Rule สำเร็จ');
    },
    onError: () => toast.error('ลบ Rule ไม่สำเร็จ'),
  });

  const toggleActive = (rule: DunningRule) => {
    updateMutation.mutate({ id: rule.id, data: { isActive: !rule.isActive } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ตั้งค่าระบบทวงหนี้อัตโนมัติ</h1>
          <p className="text-sm text-gray-500 mt-1">
            กำหนด rules สำหรับแจ้งเตือนและทวงหนี้อัตโนมัติ
          </p>
        </div>
        <button
          onClick={() => { setEditingRule(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          เพิ่ม Rule
        </button>
      </div>

      {/* Rules timeline */}
      <div className="rounded-lg border bg-white">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Dunning Timeline</h2>
          <p className="text-xs text-gray-500">เรียงตามวันที่ trigger (ก่อนกำหนด → หลังกำหนด)</p>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">กำลังโหลด...</div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center text-gray-400">ยังไม่มี Rule — กดปุ่ม "เพิ่ม Rule" เพื่อเริ่มต้น</div>
        ) : (
          <div className="divide-y">
            {rules.map((rule) => {
              const channelInfo = channelLabels[rule.channel];
              const ChannelIcon = channelInfo?.icon || Bell;
              return (
                <div
                  key={rule.id}
                  className={`flex items-center gap-4 p-4 ${!rule.isActive ? 'opacity-50' : ''}`}
                >
                  <GripVertical className="h-4 w-4 text-gray-300 cursor-grab" />

                  {/* Trigger day badge */}
                  <div className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                    rule.triggerDay < 0
                      ? 'bg-blue-100 text-blue-700'
                      : rule.triggerDay <= 7
                        ? 'bg-yellow-100 text-yellow-700'
                        : rule.triggerDay <= 30
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-red-100 text-red-700'
                  }`}>
                    {rule.triggerDay < 0 ? `D${rule.triggerDay}` : `D+${rule.triggerDay}`}
                  </div>

                  {/* Channel icon */}
                  <ChannelIcon className="h-4 w-4 text-gray-500" />

                  {/* Rule info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{rule.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {formatTriggerDay(rule.triggerDay)} • {channelInfo?.label || rule.channel}
                      {rule.includePaymentLink && (
                        <span className="inline-flex items-center gap-1 ml-2">
                          <Link2 className="h-3 w-3" /> ลิงก์จ่ายเงิน
                        </span>
                      )}
                      {rule.escalateTo && (
                        <span className="ml-2 text-orange-600">→ {rule.escalateTo}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleActive(rule)} title={rule.isActive ? 'ปิด' : 'เปิด'}>
                      {rule.isActive
                        ? <ToggleRight className="h-5 w-5 text-green-500" />
                        : <ToggleLeft className="h-5 w-5 text-gray-400" />}
                    </button>
                    <button
                      onClick={() => { setEditingRule(rule); setShowForm(true); }}
                      className="p-1 rounded hover:bg-gray-100"
                    >
                      <Pencil className="h-4 w-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`ลบ "${rule.name}"?`)) deleteMutation.mutate(rule.id);
                      }}
                      className="p-1 rounded hover:bg-gray-100"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create/Edit Form Modal — implement as a slide-over or modal */}
      {showForm && (
        <DunningRuleForm
          rule={editingRule}
          onSubmit={(data) => {
            if (editingRule) {
              updateMutation.mutate({ id: editingRule.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          onClose={() => { setShowForm(false); setEditingRule(null); }}
        />
      )}
    </div>
  );
}

function DunningRuleForm({
  rule,
  onSubmit,
  onClose,
}: {
  rule: DunningRule | null;
  onSubmit: (data: Partial<DunningRule>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(rule?.name || '');
  const [triggerDay, setTriggerDay] = useState(String(rule?.triggerDay ?? 0));
  const [channel, setChannel] = useState(rule?.channel || 'LINE');
  const [messageTemplate, setMessageTemplate] = useState(rule?.messageTemplate || '');
  const [includePaymentLink, setIncludePaymentLink] = useState(rule?.includePaymentLink ?? false);
  const [autoExecute, setAutoExecute] = useState(rule?.autoExecute ?? true);
  const [escalateTo, setEscalateTo] = useState(rule?.escalateTo || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      triggerDay: parseInt(triggerDay),
      channel: channel as DunningRule['channel'],
      messageTemplate,
      includePaymentLink,
      autoExecute,
      escalateTo: escalateTo || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-bold">{rule ? 'แก้ไข Rule' : 'เพิ่ม Rule ใหม่'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">ชื่อ Rule</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required
              className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="เช่น แจ้งเตือน 3 วันก่อนกำหนด" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">วันที่ trigger</label>
              <input type="number" value={triggerDay} onChange={(e) => setTriggerDay(e.target.value)} required
                className="w-full rounded-lg border px-3 py-2 text-sm" />
              <p className="text-xs text-gray-500 mt-1">ค่าลบ = ก่อนกำหนด, ค่าบวก = หลังกำหนด</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ช่องทาง</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm">
                <option value="LINE">LINE</option>
                <option value="SMS">SMS</option>
                <option value="CALL_TASK">โทรติดตาม (task)</option>
                <option value="INTERNAL_ALERT">แจ้งเตือนภายใน</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Template ข้อความ</label>
            <textarea value={messageTemplate} onChange={(e) => setMessageTemplate(e.target.value)} required rows={3}
              className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="ใช้ตัวแปร: {{customerName}}, {{contractNumber}}, {{amount}}, {{dueDate}}, {{daysOverdue}}, {{installmentNo}}" />
            <p className="text-xs text-gray-500 mt-1">
              ตัวแปร: {'{{customerName}}'}, {'{{contractNumber}}'}, {'{{amount}}'}, {'{{dueDate}}'}, {'{{daysOverdue}}'}, {'{{installmentNo}}'}
            </p>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includePaymentLink} onChange={(e) => setIncludePaymentLink(e.target.checked)} />
              แนบลิงก์จ่ายเงิน
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoExecute} onChange={(e) => setAutoExecute(e.target.checked)} />
              ส่งอัตโนมัติ
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Escalate ให้ (ไม่บังคับ)</label>
            <select value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm">
              <option value="">ไม่ escalate</option>
              <option value="FINANCE_MANAGER">ผจก.การเงิน</option>
              <option value="BRANCH_MANAGER">ผจก.สาขา</option>
              <option value="OWNER">เจ้าของ</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">
              ยกเลิก
            </button>
            <button type="submit" className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90">
              {rule ? 'บันทึก' : 'สร้าง'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

Find the Settings routes section and add:
```typescript
const DunningSettingsPage = lazy(() => import('@/pages/DunningSettingsPage'));

// In the routes:
<Route path="/settings/dunning" element={<ProtectedRoute roles={['OWNER']}><DunningSettingsPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Add sidebar link**

Find the Settings section in the sidebar and add a link to `/settings/dunning` with label "ระบบทวงหนี้อัตโนมัติ".

- [ ] **Step 4: Run type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/DunningSettingsPage.tsx apps/web/src/App.tsx
git commit -m "feat(dunning): settings page for dunning rules CRUD

Timeline view of rules (D-3 to D+90), create/edit modal,
toggle active/inactive, soft delete. OWNER only."
```

---

## Task 10: Collection Dashboard page (frontend)

**Files:**
- Create: `apps/web/src/pages/CollectionDashboardPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create CollectionDashboardPage**

```typescript
// CollectionDashboardPage.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TrendingUp, TrendingDown, Users, Banknote, BarChart3 } from 'lucide-react';

interface CollectionMetrics {
  agingBuckets: { label: string; min: number; max: number; count: number; amount: number }[];
  collectionRate: { current: number; lastMonth: number; mom: number };
  collected: { thisMonth: number; count: number };
  topDelinquent: { customerId: string; customerName: string; totalOverdue: number; contractCount: number }[];
  channelEffectiveness: { channel: string; totalSent: number; ledToPayment: number }[];
}

export default function CollectionDashboardPage() {
  const { data: metrics, isLoading } = useQuery<CollectionMetrics>({
    queryKey: ['collection-metrics'],
    queryFn: () => api.get('/dashboard/collection-metrics').then((r) => r.data),
    refetchInterval: 60_000, // refresh every minute
  });

  if (isLoading || !metrics) {
    return <div className="p-8 text-center text-gray-400">กำลังโหลด...</div>;
  }

  const totalOverdue = metrics.agingBuckets.reduce((sum, b) => sum + b.amount, 0);
  const totalContracts = metrics.agingBuckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Collection Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard
          title="Collection Rate"
          value={`${metrics.collectionRate.current}%`}
          change={metrics.collectionRate.mom}
          icon={<BarChart3 className="h-5 w-5" />}
        />
        <KPICard
          title="เก็บได้เดือนนี้"
          value={`฿${metrics.collected.thisMonth.toLocaleString()}`}
          subtitle={`${metrics.collected.count} รายการ`}
          icon={<Banknote className="h-5 w-5" />}
        />
        <KPICard
          title="ยอดค้างทั้งหมด"
          value={`฿${totalOverdue.toLocaleString()}`}
          subtitle={`${totalContracts} สัญญา`}
          icon={<Users className="h-5 w-5" />}
        />
        <KPICard
          title="Collection Rate เดือนก่อน"
          value={`${metrics.collectionRate.lastMonth}%`}
          icon={<BarChart3 className="h-5 w-5" />}
        />
      </div>

      {/* Aging Buckets */}
      <div className="rounded-lg border bg-white p-6">
        <h2 className="font-semibold mb-4">Aging Buckets</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {metrics.agingBuckets.map((bucket) => (
            <div key={bucket.label} className="rounded-lg border p-4 text-center">
              <div className="text-xs text-gray-500 mb-1">{bucket.label}</div>
              <div className="text-lg font-bold">{bucket.count}</div>
              <div className="text-sm text-gray-600">฿{bucket.amount.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Delinquent */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="font-semibold mb-4">ลูกค้าค้างชำระสูงสุด</h2>
          <div className="space-y-3">
            {metrics.topDelinquent.map((customer, i) => (
              <div key={customer.customerId} className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-400 w-6">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{customer.customerName}</div>
                  <div className="text-xs text-gray-500">{customer.contractCount} สัญญา</div>
                </div>
                <div className="text-sm font-bold text-red-600">
                  ฿{customer.totalOverdue.toLocaleString()}
                </div>
              </div>
            ))}
            {metrics.topDelinquent.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-4">ไม่มีลูกค้าค้างชำระ</div>
            )}
          </div>
        </div>

        {/* Channel Effectiveness */}
        <div className="rounded-lg border bg-white p-6">
          <h2 className="font-semibold mb-4">ประสิทธิภาพช่องทางทวงหนี้ (30 วัน)</h2>
          <div className="space-y-3">
            {metrics.channelEffectiveness.map((ch) => {
              const rate = ch.totalSent > 0 ? Math.round((ch.ledToPayment / ch.totalSent) * 100) : 0;
              return (
                <div key={ch.channel} className="flex items-center gap-3">
                  <div className="w-24 text-sm font-medium">{ch.channel}</div>
                  <div className="flex-1">
                    <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-sm w-20 text-right">
                    {rate}% ({ch.ledToPayment}/{ch.totalSent})
                  </div>
                </div>
              );
            })}
            {metrics.channelEffectiveness.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-4">ยังไม่มีข้อมูล — ระบบจะเริ่มเก็บสถิติเมื่อ dunning rules ทำงาน</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({
  title,
  value,
  change,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  change?: number;
  subtitle?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500">{title}</span>
        <span className="text-gray-400">{icon}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {change !== undefined && (
        <div className={`flex items-center gap-1 text-sm mt-1 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs เดือนก่อน
        </div>
      )}
      {subtitle && <div className="text-sm text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Add route in App.tsx**

```typescript
const CollectionDashboardPage = lazy(() => import('@/pages/CollectionDashboardPage'));

// In routes:
<Route path="/collection-dashboard" element={<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER']}><CollectionDashboardPage /></ProtectedRoute>} />
```

- [ ] **Step 3: Add sidebar link**

Add a link to `/collection-dashboard` in the Collections section with label "Collection Dashboard".

- [ ] **Step 4: Run type check**

```bash
./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 5: Test in browser**

Start dev server and verify:
```bash
cd apps/web && npm run dev
```

1. Navigate to `/settings/dunning` as admin — see 8 default rules
2. Toggle a rule on/off — verify toast + state change
3. Navigate to `/collection-dashboard` — see KPI cards, aging buckets, top delinquent list
4. If no overdue data: verify empty states render correctly

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/CollectionDashboardPage.tsx apps/web/src/App.tsx
git commit -m "feat(dunning): collection dashboard page

KPI cards (collection rate, collected amount, total overdue),
aging buckets (6 tiers), top 10 delinquent, channel effectiveness."
```

---

## Task 11: Full type check + verification

**Files:** None (verification only)

- [ ] **Step 1: Run full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors across api + web.

- [ ] **Step 2: Run API tests**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: All existing tests pass + new dunning tests pass.

- [ ] **Step 3: Manual smoke test**

1. Login as admin
2. `/settings/dunning` — CRUD rules, toggle active, delete
3. `/overdue` — existing board still works
4. `/collection-dashboard` — metrics render
5. POST `/overdue/cron/execute-dunning-rules` via API — verify execution log

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: address type/test issues from dunning enhancement"
```

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | Prisma schema: DunningRule + DunningAction + migration | Schema validation |
| 2 | Seed 8 default dunning rules | Seed run |
| 3 | DTOs: CreateDunningRuleDto, UpdateDunningRuleDto | — |
| 4 | DunningRuleService (CRUD) | 5 unit tests |
| 5 | DunningEngineService (rule execution) | 6 unit tests |
| 6 | Controller endpoints + module wiring | Type check |
| 7 | SchedulerService: add rule-based cron at 08:15 | Type check |
| 8 | Dashboard collection metrics (backend) | Type check |
| 9 | DunningSettingsPage (frontend) | Manual + type check |
| 10 | CollectionDashboardPage (frontend) | Manual + type check |
| 11 | Full verification | Type check + all tests |
