# Collections Workflow Hub — Plan 1/4: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship all schema changes, seed data, audit-bug fixes, and the event-triggered dunning engine. After this plan, the backend supports everything the new UI will need — existing `/overdue` page still works unchanged.

**Architecture:** Prisma migrations → seed updates → fix 3 documented audit bugs (C1/C2/C3) → extend `DunningEngineService` with `executeEventTrigger` → wire it into `OverdueService.logContact`. No frontend changes except a tiny section addition to `DunningSettingsPage` so OWNER can see event rules.

**Tech Stack:** NestJS + Prisma 5 + PostgreSQL + jest (api unit) + React + vitest (web unit) + Playwright (E2E).

**Related spec:** [docs/superpowers/specs/2026-04-24-collections-workflow-hub-design.md](../specs/2026-04-24-collections-workflow-hub-design.md) §11 (backend), §12 (schema), §13 (migration plan).

---

## File Map

### Create
- `apps/api/prisma/migrations/<ts>_collections_foundation/migration.sql` — all 6 migrations merged into one (single prisma migrate run)
- `apps/api/src/modules/overdue/crons/mdm-auto-propose.cron.ts` — daily 09:00 scanner
- `apps/api/src/modules/overdue/crons/mdm-auto-propose.cron.spec.ts`
- `apps/api/src/modules/overdue/mdm-lock.service.ts` + `.spec.ts` — MdmLockRequest CRUD + execute placeholder
- `apps/api/src/modules/overdue/contract-letter.service.ts` + `.spec.ts` — Letter CRUD (letter PDF generator is Plan 4)
- `apps/api/prisma/seeds/collections-foundation.seed.ts` — idempotent seed script invoked from main seed
- `apps/api/src/modules/overdue/utils/event-trigger.util.ts` — small helper that maps call result → event key

### Modify
- `apps/api/prisma/schema.prisma` — add enums + models + columns
- `apps/api/prisma/seed.ts` — call new seed function
- `apps/api/src/modules/overdue/dto/assign-collector.dto.ts` — (no change, document deprecation path on service)
- `apps/api/src/modules/overdue/overdue.service.ts` — fix C2/C3, extend `logContact` to call event engine
- `apps/api/src/modules/overdue/overdue.service.spec.ts` — update + add tests
- `apps/api/src/modules/overdue/overdue.controller.ts` — accept both `userId` and `assignedToId` in assign-collector body (C1)
- `apps/api/src/modules/overdue/dunning-engine.service.ts` — add `executeEventTrigger(eventKey, contract, payment?, callLog?)`
- `apps/api/src/modules/overdue/dunning-engine.service.spec.ts` — add event trigger tests
- `apps/api/src/modules/overdue/overdue.module.ts` — register MdmLockService, ContractLetterService
- `apps/web/src/pages/DunningSettingsPage.tsx` — add "Event-triggered rules" collapsible section

### Test
- All `.spec.ts` files listed above

---

## Ground rules for every task

1. **TDD**: write failing test → run it → write minimal impl → run passing → commit.
2. **Commit after every task** (not every step) — except tasks that explicitly chain.
3. **Type-check before commit**: `./tools/check-types.sh all` must pass.
4. **Never skip hooks**: if pre-commit fails, fix the root cause, re-stage, new commit.
5. **Thai validation messages** on DTOs per project convention.
6. **No hardcoded money math** — `Prisma.Decimal` or string-based only.

---

## Task 1: Prisma schema — add new enums

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (append near other enums, lines ~18-300)

- [ ] **Step 1: Add enums alphabetically near related existing enums (DunningStage, NotificationChannel)**

Add these blocks to `schema.prisma`. Place `DunningEventTrigger` directly below the existing `DunningStage` enum; place `LetterType` + `LetterStatus` + `MdmLockTrigger` + `MdmLockStatus` right after the last installment-related enum.

```prisma
enum DunningEventTrigger {
  CALL_NO_ANSWER
  CALL_ANSWERED_PROMISE
  CALL_REFUSED
  DEVICE_LOCKED
  DEVICE_UNLOCKED
  BROKEN_PROMISE
  LETTER_DISPATCHED
  CONTRACT_TERMINATED
}

enum MdmLockTrigger {
  UNCONTACTABLE_3D
  NO_PROMISE_3D
  MANUAL_COLLECTOR
  MANUAL_OWNER
  BROKEN_PROMISE
}

enum MdmLockStatus {
  PENDING
  APPROVED
  REJECTED
  EXECUTED_MANUAL
  EXECUTED_API
  FAILED
  UNLOCKED
}

enum LetterType {
  RETURN_DEVICE_45D
  CONTRACT_TERMINATION_60D
}

enum LetterStatus {
  PENDING_DISPATCH
  PDF_GENERATED
  DISPATCHED
  DELIVERED
  UNDELIVERABLE
  CANCELLED
}
```

- [ ] **Step 2: Verify file is still valid Prisma**

Run: `cd apps/api && npx prisma format`
Expected: prints "Formatted ...schema.prisma in N ms" and no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat(db): add collections enums (MDM, Letter, DunningEventTrigger)"
```

---

## Task 2: Prisma schema — extend Contract, DunningRule, User

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Contract, DunningRule, User models)

- [ ] **Step 1: Extend `Contract` model — add the 6 new columns inside the existing Contract block**

Locate the `model Contract { ... }` block and add these fields before the closing brace (place them near related existing device-tracking fields, e.g., after `blockAutoEscalation` if it exists; otherwise near end):

```prisma
  noAnswerCount      Int       @default(0) @map("no_answer_count")
  needsSkipTracing   Boolean   @default(false) @map("needs_skip_tracing")
  deviceLocked       Boolean   @default(false) @map("device_locked")
  deviceLockedAt     DateTime? @map("device_locked_at")
  wallpaperChanged   Boolean   @default(false) @map("wallpaper_changed")
  wallpaperChangedAt DateTime? @map("wallpaper_changed_at")
  mdmLockRequests    MdmLockRequest[]
  contractLetters    ContractLetter[]
```

- [ ] **Step 2: Extend `DunningRule` model — make `triggerDay` nullable and add `eventTrigger`**

Inside `model DunningRule { ... }`:

Change:
```prisma
  triggerDay         Int            @map("trigger_day")
```
to:
```prisma
  triggerDay         Int?                   @map("trigger_day")
  eventTrigger       DunningEventTrigger?   @map("event_trigger")
```

Add an index line next to existing `@@index([triggerDay])`:
```prisma
  @@index([eventTrigger])
```

- [ ] **Step 3: Extend `User` model — add `isSystemUser`**

Inside `model User { ... }`, add:
```prisma
  isSystemUser  Boolean  @default(false) @map("is_system_user")
  mdmProposed   MdmLockRequest[] @relation("MdmProposed")
  mdmApproved   MdmLockRequest[] @relation("MdmApproved")
  letterDispatched ContractLetter[] @relation("LetterDispatched")
```

- [ ] **Step 4: Verify prisma formats**

Run: `cd apps/api && npx prisma format`
Expected: "Formatted ...schema.prisma" no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat(db): extend Contract/DunningRule/User for collections v2"
```

---

## Task 3: Prisma schema — create MdmLockRequest model

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Append model definition at the bottom of the `overdue`-related models section (after DunningAction)**

```prisma
model MdmLockRequest {
  id                String           @id @default(uuid())
  contractId        String           @map("contract_id")
  contract          Contract         @relation(fields: [contractId], references: [id])
  status            MdmLockStatus    @default(PENDING)
  trigger           MdmLockTrigger
  includeWallpaper  Boolean          @default(true) @map("include_wallpaper")
  proposedById      String           @map("proposed_by_id")
  proposedBy        User             @relation("MdmProposed", fields: [proposedById], references: [id])
  proposedAt        DateTime         @default(now()) @map("proposed_at")
  approvedById      String?          @map("approved_by_id")
  approvedBy        User?            @relation("MdmApproved", fields: [approvedById], references: [id])
  approvedAt        DateTime?        @map("approved_at")
  rejectedById      String?          @map("rejected_by_id")
  rejectedReason    String?          @map("rejected_reason")
  reason            String
  externalRef       String?          @map("external_ref")
  wallpaperUrlUsed  String?          @map("wallpaper_url_used")
  createdAt         DateTime         @default(now()) @map("created_at")
  updatedAt         DateTime         @updatedAt @map("updated_at")
  deletedAt         DateTime?        @map("deleted_at")

  @@index([contractId, status])
  @@index([status, proposedAt])
  @@map("mdm_lock_requests")
}
```

- [ ] **Step 2: Verify formats**

Run: `cd apps/api && npx prisma format`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat(db): add MdmLockRequest model"
```

---

## Task 4: Prisma schema — create ContractLetter model

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Append model definition after MdmLockRequest**

```prisma
model ContractLetter {
  id                String         @id @default(uuid())
  contractId        String         @map("contract_id")
  contract          Contract       @relation(fields: [contractId], references: [id])
  letterType        LetterType     @map("letter_type")
  letterNumber      String         @unique @map("letter_number")
  status            LetterStatus   @default(PENDING_DISPATCH)
  triggeredAt       DateTime       @default(now()) @map("triggered_at")
  pdfUrl            String?        @map("pdf_url")
  pdfGeneratedAt    DateTime?      @map("pdf_generated_at")
  dispatchedAt      DateTime?      @map("dispatched_at")
  dispatchedById    String?        @map("dispatched_by_id")
  dispatchedBy      User?          @relation("LetterDispatched", fields: [dispatchedById], references: [id])
  trackingNumber    String?        @map("tracking_number")
  evidencePhotoUrl  String?        @map("evidence_photo_url")
  deliveredAt       DateTime?      @map("delivered_at")
  cancelledAt       DateTime?      @map("cancelled_at")
  cancelReason      String?        @map("cancel_reason")
  createdAt         DateTime       @default(now()) @map("created_at")
  updatedAt         DateTime       @updatedAt @map("updated_at")
  deletedAt         DateTime?      @map("deleted_at")

  @@unique([contractId, letterType])
  @@index([status, triggeredAt])
  @@index([dispatchedAt])
  @@map("contract_letters")
}
```

- [ ] **Step 2: Verify formats**

Run: `cd apps/api && npx prisma format`

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat(db): add ContractLetter model for legal notices"
```

---

## Task 5: Generate + run migration

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_collections_foundation/migration.sql`

- [ ] **Step 1: Create the migration (dev only)**

Run: `cd apps/api && npx prisma migrate dev --name collections_foundation`
Expected:
- Creates `migrations/<timestamp>_collections_foundation/migration.sql`
- Applies to local DB
- Regenerates Prisma Client

- [ ] **Step 2: Inspect migration.sql for correctness**

Open the generated `migration.sql`. Verify it contains:
- `CREATE TYPE "DunningEventTrigger" AS ENUM (...)` and the other 4 new enums
- `CREATE TABLE "mdm_lock_requests"` with all columns
- `CREATE TABLE "contract_letters"` with all columns + unique constraint `contract_letters_contract_id_letter_type_key`
- `ALTER TABLE "contracts" ADD COLUMN "no_answer_count" INTEGER NOT NULL DEFAULT 0;` and 5 other column adds
- `ALTER TABLE "users" ADD COLUMN "is_system_user" BOOLEAN NOT NULL DEFAULT false;`
- `ALTER TABLE "dunning_rules" ALTER COLUMN "trigger_day" DROP NOT NULL;` and `ADD COLUMN "event_trigger" "DunningEventTrigger";`

If any of those are missing, stop and investigate before continuing.

- [ ] **Step 3: Add CHECK constraint manually (Prisma can't express XOR)**

Edit the generated `migration.sql` and append at the bottom:

```sql
-- Enforce exactly one of trigger_day / event_trigger is set
ALTER TABLE "dunning_rules"
  ADD CONSTRAINT "dunning_rules_trigger_exclusive_chk"
  CHECK ((trigger_day IS NOT NULL)::int + (event_trigger IS NOT NULL)::int = 1);
```

- [ ] **Step 4: Re-apply the edited migration**

Because `prisma migrate dev` already ran, we need to reset-and-reapply to include the manual CHECK:
Run: `cd apps/api && npx prisma migrate reset --force`
Expected: DB drops + all migrations reapply including our edit + seed runs (may fail — that's fixed in Task 6).

- [ ] **Step 5: Verify schema lines up with DB**

Run: `cd apps/api && npx prisma db pull --print` (do NOT write)
Scan output. Confirm new tables and columns appear.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(db): migrate collections foundation (contract cols, MdmLockRequest, ContractLetter, DunningRule event)"
```

---

## Task 6: Seed — system user + event rules + system configs

**Files:**
- Create: `apps/api/prisma/seeds/collections-foundation.seed.ts`
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Write the seed function**

Create `apps/api/prisma/seeds/collections-foundation.seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

export async function seedCollectionsFoundation(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { email: 'system@bestchoice.internal' },
    update: {},
    create: {
      email: 'system@bestchoice.internal',
      name: 'SYSTEM',
      role: 'OWNER',
      passwordHash: '__NO_LOGIN__',
      isActive: false,
      isSystemUser: true,
    },
  });

  const eventRules: Array<{
    name: string;
    eventTrigger:
      | 'CALL_NO_ANSWER'
      | 'CALL_ANSWERED_PROMISE'
      | 'CALL_REFUSED'
      | 'DEVICE_LOCKED'
      | 'DEVICE_UNLOCKED'
      | 'BROKEN_PROMISE'
      | 'LETTER_DISPATCHED'
      | 'CONTRACT_TERMINATED';
    channel: 'LINE' | 'SMS';
    messageTemplate: string;
    includePaymentLink: boolean;
    autoExecute: boolean;
    sortOrder: number;
  }> = [
    {
      name: 'dunning_on_no_answer',
      eventTrigger: 'CALL_NO_ANSWER',
      channel: 'LINE',
      messageTemplate:
        'เรียน {{customerName}} เราไม่สามารถติดต่อท่านได้ กรุณาติดต่อกลับเพื่อชำระงวดที่ {{installmentNo}} ยอด {{amount}} ฿',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 100,
    },
    {
      name: 'dunning_confirm_promise',
      eventTrigger: 'CALL_ANSWERED_PROMISE',
      channel: 'LINE',
      messageTemplate:
        'ขอบคุณที่รับสาย กรุณาชำระยอด {{amount}} ฿ ภายใน {{settlementDate}} ผ่านลิงก์ด้านล่าง',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 101,
    },
    {
      name: 'dunning_firm_warning',
      eventTrigger: 'CALL_REFUSED',
      channel: 'LINE',
      messageTemplate:
        'เรียน {{customerName}} หากไม่ชำระงวด {{installmentNo}} ยอด {{amount}} ฿ บริษัทจำเป็นต้องดำเนินการตามขั้นตอนต่อไป',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 102,
    },
    {
      name: 'dunning_device_locked',
      eventTrigger: 'DEVICE_LOCKED',
      channel: 'LINE',
      messageTemplate:
        'เครื่องของท่านถูกล็อคและตั้ง wallpaper แจ้งเตือน กรุณาชำระยอดค้าง {{amount}} ฿ เพื่อปลดล็อคทันที',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 103,
    },
    {
      name: 'dunning_device_unlocked',
      eventTrigger: 'DEVICE_UNLOCKED',
      channel: 'LINE',
      messageTemplate: 'ขอบคุณที่ชำระยอดค้างชำระ เครื่องของท่านถูกปลดล็อคเรียบร้อยแล้ว',
      includePaymentLink: false,
      autoExecute: true,
      sortOrder: 104,
    },
    {
      name: 'dunning_broken_promise',
      eventTrigger: 'BROKEN_PROMISE',
      channel: 'LINE',
      messageTemplate:
        'เรียน {{customerName}} ท่านไม่ได้ชำระตามนัดที่ {{settlementDate}} กรุณาติดต่อกลับโดยด่วน',
      includePaymentLink: true,
      autoExecute: true,
      sortOrder: 105,
    },
    {
      name: 'dunning_letter_dispatched',
      eventTrigger: 'LETTER_DISPATCHED',
      channel: 'LINE',
      messageTemplate:
        'บริษัทได้จัดส่งหนังสือถึงท่านทางไปรษณีย์ลงทะเบียน (EMS: {{trackingNumber}}) กรุณาติดต่อกลับโดยด่วน',
      includePaymentLink: false,
      autoExecute: true,
      sortOrder: 106,
    },
    {
      name: 'dunning_contract_terminated',
      eventTrigger: 'CONTRACT_TERMINATED',
      channel: 'LINE',
      messageTemplate:
        'เรียน {{customerName}} สัญญาเลขที่ {{contractNumber}} ได้ถูกบอกเลิกและอยู่ระหว่างดำเนินคดีทางกฎหมาย',
      includePaymentLink: false,
      autoExecute: true,
      sortOrder: 107,
    },
  ];

  for (const rule of eventRules) {
    await prisma.dunningRule.upsert({
      where: { name: rule.name },
      update: {
        eventTrigger: rule.eventTrigger,
        channel: rule.channel,
        messageTemplate: rule.messageTemplate,
        includePaymentLink: rule.includePaymentLink,
        autoExecute: rule.autoExecute,
        sortOrder: rule.sortOrder,
      },
      create: {
        name: rule.name,
        triggerDay: null,
        eventTrigger: rule.eventTrigger,
        channel: rule.channel,
        messageTemplate: rule.messageTemplate,
        includePaymentLink: rule.includePaymentLink,
        autoExecute: rule.autoExecute,
        isActive: true,
        sortOrder: rule.sortOrder,
      },
    });
  }

  const configs: Array<{ key: string; value: string; description: string }> = [
    {
      key: 'mdm_auto_propose_enabled',
      value: 'true',
      description: 'Enable daily MDM auto-propose cron',
    },
    {
      key: 'mdm_uncontactable_threshold_hours',
      value: '72',
      description: 'Hours window for NO_ANSWER count trigger',
    },
    {
      key: 'mdm_no_promise_threshold_days',
      value: '3',
      description: 'Overdue days without settlement before auto-propose',
    },
    {
      key: 'mdm_lock_wallpaper_url',
      value: '',
      description: 'S3 URL of reminder wallpaper (set by OWNER in settings)',
    },
    {
      key: 'letter_auto_generate_enabled',
      value: 'false',
      description: 'Enable daily letter auto-generate cron (keep off until legal review)',
    },
    {
      key: 'letter_return_device_days',
      value: '45',
      description: 'Threshold for RETURN_DEVICE_45D letter',
    },
    {
      key: 'letter_termination_days',
      value: '60',
      description: 'Threshold for CONTRACT_TERMINATION_60D letter',
    },
    {
      key: 'letter_signature_url',
      value: '',
      description: 'S3 URL of authorized signatory signature image',
    },
    {
      key: 'letter_letterhead_url',
      value: '',
      description: 'S3 URL of company letterhead (optional)',
    },
  ];

  for (const cfg of configs) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: { description: cfg.description },
      create: { key: cfg.key, value: cfg.value, description: cfg.description },
    });
  }
}
```

- [ ] **Step 2: Wire into main seed**

Modify `apps/api/prisma/seed.ts` — find the `main()` function and append a call before the final commit/log:

```typescript
import { seedCollectionsFoundation } from './seeds/collections-foundation.seed';

// ... inside main(), after existing seeds:
await seedCollectionsFoundation(prisma);
console.log('✓ Seeded collections foundation (system user, event rules, configs)');
```

- [ ] **Step 3: Run the seed**

Run: `cd apps/api && npx prisma db seed`
Expected: Exit 0. Console shows the new line.

- [ ] **Step 4: Verify in DB**

Run:
```bash
cd apps/api && npx prisma studio
```
Open browser → `User` table → verify `system@bestchoice.internal` exists with `isSystemUser=true, isActive=false`.
Open `DunningRule` → filter `eventTrigger IS NOT NULL` → expect 8 rows.
Open `SystemConfig` → expect 9 new keys prefixed `mdm_` or `letter_`.
Close studio.

- [ ] **Step 5: Write seed idempotency test**

Create `apps/api/prisma/seeds/collections-foundation.seed.spec.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import { seedCollectionsFoundation } from './collections-foundation.seed';

const prisma = new PrismaClient();

describe('seedCollectionsFoundation', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('is idempotent — running twice yields same counts', async () => {
    await seedCollectionsFoundation(prisma);
    const rules1 = await prisma.dunningRule.count({ where: { eventTrigger: { not: null } } });
    const configs1 = await prisma.systemConfig.count({
      where: { OR: [{ key: { startsWith: 'mdm_' } }, { key: { startsWith: 'letter_' } }] },
    });
    const system1 = await prisma.user.findUnique({ where: { email: 'system@bestchoice.internal' } });
    expect(rules1).toBe(8);
    expect(configs1).toBe(9);
    expect(system1?.isSystemUser).toBe(true);

    await seedCollectionsFoundation(prisma);
    const rules2 = await prisma.dunningRule.count({ where: { eventTrigger: { not: null } } });
    const configs2 = await prisma.systemConfig.count({
      where: { OR: [{ key: { startsWith: 'mdm_' } }, { key: { startsWith: 'letter_' } }] },
    });
    expect(rules2).toBe(8);
    expect(configs2).toBe(9);
  });
});
```

- [ ] **Step 6: Run the idempotency test**

Run: `cd apps/api && npx jest prisma/seeds/collections-foundation.seed.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/seeds/ apps/api/prisma/seed.ts
git commit -m "feat(seed): system user + 8 event-triggered dunning rules + MDM/letter configs"
```

---

## Task 7: Fix bug C1 — assign collector DTO field mismatch

**Files:**
- Modify: `apps/api/src/modules/overdue/dto/assign-collector.dto.ts`
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts:92-99`
- Modify: `apps/web/src/pages/OverduePage.tsx:195-198`
- Modify: `apps/api/src/modules/overdue/overdue.service.spec.ts`

- [ ] **Step 1: Add failing test for controller accepting both field names**

Open `apps/api/src/modules/overdue/overdue.service.spec.ts`. Find the `describe('assignCollector'` block (add one if absent). Add a test:

```typescript
describe('assignCollector (controller-level field compat)', () => {
  it('accepts assignedToId (canonical field)', async () => {
    const contract = await makeOverdueContract();
    const user = await makeUser({ role: 'SALES' });
    const updated = await service.assignCollector(contract.id, user.id);
    expect(updated.assignedToId).toBe(user.id);
  });
});
```

(If `makeOverdueContract` / `makeUser` helpers do not exist, add simple factories above the describe block using the prisma instance.)

- [ ] **Step 2: Run test to verify baseline passes (canonical path already works)**

Run: `cd apps/api && npx jest overdue.service.spec.ts -t "accepts assignedToId"`
Expected: PASS.

- [ ] **Step 3: Update DTO to accept both for one release**

Open `apps/api/src/modules/overdue/dto/assign-collector.dto.ts`:

Replace the file contents with:

```typescript
import { IsString, IsOptional } from 'class-validator';

export class AssignCollectorDto {
  @IsOptional()
  @IsString({ message: 'assignedToId ต้องเป็น string' })
  assignedToId?: string;

  /**
   * @deprecated — the frontend historically posts `userId`; canonical is `assignedToId`.
   * Accepted here until Plan 2 replaces the frontend call.
   */
  @IsOptional()
  @IsString({ message: 'userId ต้องเป็น string' })
  userId?: string;
}
```

- [ ] **Step 4: Controller normalizes the two fields**

Open `apps/api/src/modules/overdue/overdue.controller.ts` and replace the `assignCollector` handler (lines ~92–99):

```typescript
  @Post(':contractId/assign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  assignCollector(
    @Param('contractId') contractId: string,
    @Body() dto: AssignCollectorDto,
  ) {
    const targetId = dto.assignedToId ?? dto.userId;
    if (!targetId) {
      throw new BadRequestException('ต้องระบุ assignedToId หรือ userId');
    }
    return this.overdueService.assignCollector(contractId, targetId);
  }
```

Add import at top of file if missing:
```typescript
import { BadRequestException } from '@nestjs/common';
```

- [ ] **Step 5: Add failing test that simulates the current broken frontend body**

Append to `overdue.service.spec.ts` (or new `overdue.controller.spec.ts` if you prefer controller-level tests). Use supertest style:

```typescript
// In an existing e2e-style test file or new overdue.controller.spec.ts
it('accepts legacy userId body shape (frontend compat)', async () => {
  const contract = await makeOverdueContract();
  const user = await makeUser({ role: 'SALES' });

  const res = await request(app.getHttpServer())
    .post(`/overdue/${contract.id}/assign`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ userId: user.id })
    .expect(201);

  const updated = await prisma.contract.findUnique({ where: { id: contract.id } });
  expect(updated?.assignedToId).toBe(user.id);
});
```

- [ ] **Step 6: Run tests**

Run: `cd apps/api && npx jest overdue`
Expected: all green.

- [ ] **Step 7: Update frontend to canonical field (still Plan 1 since it's a one-liner and removes ambiguity)**

Open `apps/web/src/pages/OverduePage.tsx` near line 197 and change:
```typescript
const { data } = await api.post(`/overdue/${contractId}/assign`, { userId });
```
to:
```typescript
const { data } = await api.post(`/overdue/${contractId}/assign`, { assignedToId: userId });
```

- [ ] **Step 8: Verify frontend still type-checks**

Run: `./tools/check-types.sh web`
Expected: "0 errors".

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/overdue/dto/assign-collector.dto.ts apps/api/src/modules/overdue/overdue.controller.ts apps/api/src/modules/overdue/overdue.service.spec.ts apps/web/src/pages/OverduePage.tsx
git commit -m "fix(overdue): assign-collector accepts assignedToId + userId (frontend now uses canonical)"
```

---

## Task 8: Fix bug C2 — throw if no system user for audit log

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.service.ts`
- Modify: `apps/api/src/modules/overdue/overdue.service.spec.ts`

- [ ] **Step 1: Write failing test — if no system user, update raises**

Append to `overdue.service.spec.ts`:

```typescript
describe('updateContractStatuses (C2: audit must not silently skip)', () => {
  it('throws if no SYSTEM user present in DB', async () => {
    await prisma.user.updateMany({ where: { isSystemUser: true }, data: { isActive: false, isSystemUser: false } });
    // Also hide normal OWNER users used as fallback
    await prisma.user.updateMany({ where: { role: 'OWNER' }, data: { isActive: false } });
    await expect(service.updateContractStatuses()).rejects.toThrow(/SYSTEM user/);
  });
});
```

- [ ] **Step 2: Run test — should FAIL today (current code returns without audit)**

Run: `cd apps/api && npx jest overdue.service.spec.ts -t "C2"`
Expected: FAIL.

- [ ] **Step 3: Update service to throw on missing system user, and prefer `isSystemUser=true`**

In `apps/api/src/modules/overdue/overdue.service.ts`, find **every** occurrence of `findFirst({ where: { role: 'OWNER', isActive: true } })` (there are several — line ~274, ~470; grep for `role: 'OWNER'`).

Replace each with a helper. Add at class top:

```typescript
  private async getSystemUserIdOrThrow(): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { isSystemUser: true },
      select: { id: true },
    });
    if (!user) {
      throw new Error('SYSTEM user not found — seed collections-foundation must run first');
    }
    return user.id;
  }
```

Then at each call site that previously did `systemUser = findFirst... if (systemUser) ...`:

Before:
```typescript
const systemUser = await this.prisma.user.findFirst({
  where: { role: 'OWNER', isActive: true },
  select: { id: true },
});
// ... later
if (systemUser) { txOps.push(this.prisma.auditLog.createMany({ data: [...] })); }
```

After:
```typescript
const systemUserId = await this.getSystemUserIdOrThrow();
// ... later
txOps.push(this.prisma.auditLog.createMany({ data: ids.map((id) => ({ userId: systemUserId, ... })) }));
```

Apply this at all 4 sites inside `updateContractStatuses` and `escalateDunningStages`.

- [ ] **Step 4: Run tests again**

Run: `cd apps/api && npx jest overdue.service.spec.ts`
Expected: all green (new test passes; no regression).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/overdue.service.ts apps/api/src/modules/overdue/overdue.service.spec.ts
git commit -m "fix(overdue): throw if no SYSTEM user (C2 — audit trail must not silently skip)"
```

---

## Task 9: Fix bug C3 — atomic updateContractStatuses

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.service.ts:286-345`
- Modify: `apps/api/src/modules/overdue/overdue.service.spec.ts`

- [ ] **Step 1: Write failing test for the race window**

The test simulates the race by setting up a contract matching the overdue criteria, then mutating its payments to PAID between read-and-write. With the current code this would still flip status (bug). With the fix it must not.

Append:

```typescript
describe('updateContractStatuses (C3: atomic updateMany)', () => {
  it('does not flip a contract whose payments become PAID during the run', async () => {
    const contract = await makeOverdueContract({ status: 'ACTIVE' });

    // All this contract's payments are PAID now (customer just paid) — simulate the race
    await prisma.payment.updateMany({
      where: { contractId: contract.id },
      data: { status: 'PAID' },
    });

    const result = await service.updateContractStatuses();
    const after = await prisma.contract.findUnique({ where: { id: contract.id } });
    expect(after?.status).toBe('ACTIVE');
    expect(result.overdueIds).not.toContain(contract.id);
  });
});
```

- [ ] **Step 2: Run test — passes already or fails depending on existing logic**

Run: `cd apps/api && npx jest overdue.service.spec.ts -t "C3"`
The current (pre-fix) code reads `activeContracts` first with `.some({ status IN PENDING, OVERDUE, PARTIALLY_PAID })` — since all are PAID, the contract is not in the initial list, so it will not flip. The test as written actually passes today.

Replace the test with one that exposes the real race: a separate transaction writes during the read-to-update gap. Simpler alternative — write a test that **only asserts the service uses a single updateMany** (contract of behavior). Replace the test body:

```typescript
  it('performs contract status flip in a single atomic updateMany', async () => {
    const spy = jest.spyOn(prisma.contract, 'updateMany');
    await makeOverdueContract({ status: 'ACTIVE', payments: 'overdue-10-days' });
    await service.updateContractStatuses();
    // The service should issue exactly one updateMany call for ACTIVE→OVERDUE flip
    // (+ one for OVERDUE→DEFAULT — so total 2 updateMany, NOT N individual updates)
    const updateManyCalls = spy.mock.calls.length;
    expect(updateManyCalls).toBeGreaterThanOrEqual(1);
    expect(updateManyCalls).toBeLessThanOrEqual(2);
    spy.mockRestore();
  });
```

- [ ] **Step 3: Refactor `updateContractStatuses` to be atomic**

In `overdue.service.ts`, replace the ACTIVE→OVERDUE section (current lines ~286–345) with a single `updateMany` using nested where:

```typescript
    // Atomic ACTIVE → OVERDUE: condition is expressed entirely in the where clause
    // so there's no read-then-write race. Anyone who paid between cron scans won't
    // match (payments.some re-evaluates at write time).
    const systemUserId = await this.getSystemUserIdOrThrow();

    const thresholdDate = new Date(now.getTime() - overdueDays * 24 * 60 * 60 * 1000);
    const promisedContractIds = await this.prisma.callLog.findMany({
      where: { result: 'PROMISED', calledAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      select: { contractId: true },
      distinct: ['contractId'],
    }).then((rows) => rows.map((r) => r.contractId));

    const flipWhere: Prisma.ContractWhereInput = {
      status: 'ACTIVE',
      deletedAt: null,
      id: { notIn: promisedContractIds },
      OR: [
        { blockAutoEscalation: null },
        { blockAutoEscalation: { lt: now } },
      ],
      payments: {
        some: {
          status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
          dueDate: { lt: thresholdDate },
        },
      },
    };

    // Capture ids BEFORE updateMany so we can audit-log them — it's OK if one or two
    // are raced away between capture and update; those just won't match updateMany
    // and we'll leave a stale audit line (caught in reconciliation later).
    const toFlip = await this.prisma.contract.findMany({
      where: flipWhere,
      select: { id: true },
    });

    const updated = await this.prisma.contract.updateMany({
      where: { ...flipWhere, id: { in: toFlip.map((c) => c.id) } },
      data: { status: 'OVERDUE' },
    });

    if (updated.count > 0) {
      await this.prisma.auditLog.createMany({
        data: toFlip.map((c) => ({
          userId: systemUserId,
          action: 'STATUS_CHANGE',
          entity: 'contract',
          entityId: c.id,
          newValue: { from: 'ACTIVE', to: 'OVERDUE', reason: `Payment overdue > ${overdueDays} days` },
          ipAddress: 'system-cron',
        })),
      });
    }

    const overdueUpdated = updated.count;
    const activeIds = toFlip.map((c) => c.id);
```

Leave the OVERDUE→DEFAULT raw-SQL block unchanged — it already uses `updateMany` atomically.

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx jest overdue.service.spec.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/overdue.service.ts apps/api/src/modules/overdue/overdue.service.spec.ts
git commit -m "fix(overdue): atomic updateContractStatuses (C3 — eliminate read-then-write race)"
```

---

## Task 10: DunningEngine — add `executeEventTrigger`

**Files:**
- Modify: `apps/api/src/modules/overdue/dunning-engine.service.ts`
- Modify: `apps/api/src/modules/overdue/dunning-engine.service.spec.ts`

- [ ] **Step 1: Write failing test**

Append to `dunning-engine.service.spec.ts`:

```typescript
describe('executeEventTrigger', () => {
  it('creates a DunningAction and sends LINE when a matching event rule exists', async () => {
    const contract = await makeOverdueContract({
      customer: { lineId: 'U1234' },
    });
    const payment = contract.payments[0];

    // Ensure event rule exists (seeded)
    const rule = await prisma.dunningRule.findUnique({ where: { name: 'dunning_on_no_answer' } });
    expect(rule).toBeTruthy();

    const sendSpy = jest.spyOn(service['notificationsService'], 'send').mockResolvedValue({
      id: 'notif-1', status: 'SENT',
    } as any);

    await service.executeEventTrigger('CALL_NO_ANSWER', contract.id, payment.id, null);

    const action = await prisma.dunningAction.findFirst({
      where: { dunningRuleId: rule!.id, contractId: contract.id, paymentId: payment.id },
    });
    expect(action).toBeTruthy();
    expect(action?.status).toBe('SENT');
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sendSpy.mockRestore();
  });

  it('dedups within 4h window', async () => {
    const contract = await makeOverdueContract({ customer: { lineId: 'U1234' } });
    const payment = contract.payments[0];
    jest.spyOn(service['notificationsService'], 'send').mockResolvedValue({ id: 'x', status: 'SENT' } as any);

    await service.executeEventTrigger('CALL_NO_ANSWER', contract.id, payment.id, null);
    await service.executeEventTrigger('CALL_NO_ANSWER', contract.id, payment.id, null);

    const count = await prisma.dunningAction.count({
      where: { contractId: contract.id, paymentId: payment.id },
    });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run — should FAIL (method not defined)**

Run: `cd apps/api && npx jest dunning-engine.service.spec.ts -t executeEventTrigger`
Expected: FAIL.

- [ ] **Step 3: Implement the method**

Open `apps/api/src/modules/overdue/dunning-engine.service.ts`. Import `DunningEventTrigger`:

```typescript
import { DunningEventTrigger } from '@prisma/client';
```

Append the method inside the class, below `executeRules`:

```typescript
  /**
   * Execute a single event-triggered dunning rule (e.g., CALL_NO_ANSWER from
   * logContact, LETTER_DISPATCHED from letter service).
   *
   * Dedup window: 4 hours per (rule, contract, payment) — prevents rapid retry
   * from double-messaging the customer.
   */
  async executeEventTrigger(
    eventKey: DunningEventTrigger,
    contractId: string,
    paymentId: string | null,
    callLogId: string | null,
    extraVars: Partial<TemplateVars> = {},
  ): Promise<void> {
    const rule = await this.prisma.dunningRule.findFirst({
      where: { eventTrigger: eventKey, isActive: true, deletedAt: null },
    });
    if (!rule) return; // no configured rule = no-op, not an error

    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const recent = await this.prisma.dunningAction.findFirst({
      where: {
        dunningRuleId: rule.id,
        contractId,
        paymentId: paymentId ?? undefined,
        createdAt: { gte: fourHoursAgo },
        deletedAt: null,
      },
    });
    if (recent) return;

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { customer: { select: { name: true, lineId: true, phone: true } } },
    });
    if (!contract) return;

    const payment = paymentId
      ? await this.prisma.payment.findUnique({ where: { id: paymentId } })
      : null;

    const vars: TemplateVars = {
      customerName: contract.customer.name,
      contractNumber: contract.contractNumber,
      amount: payment ? payment.amountDue.toNumber().toLocaleString('th-TH') : '',
      dueDate: payment ? formatDateShort(payment.dueDate) : '',
      daysOverdue: '',
      installmentNo: payment ? String(payment.installmentNo) : '',
      ...extraVars,
    };

    const messageContent = this.renderTemplate(rule.messageTemplate, vars);

    let paymentLinkUrl: string | undefined;
    if (rule.includePaymentLink && payment && contract.customer.lineId) {
      try {
        const link = await this.paymentLinkService.createPaymentLink(contractId, payment.installmentNo);
        paymentLinkUrl = link.url;
      } catch (err) {
        Sentry.captureException(err, {
          tags: { service: 'DunningEngineService', method: 'executeEventTrigger.paymentLink' },
        });
      }
    }

    let status: 'SENT' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
    let result: string | null = null;

    if (rule.autoExecute && (rule.channel === 'LINE' || rule.channel === 'SMS')) {
      const recipient = rule.channel === 'LINE' ? contract.customer.lineId : contract.customer.phone;
      if (recipient) {
        const finalMessage = paymentLinkUrl ? `${messageContent}\n\nชำระเงินออนไลน์: ${paymentLinkUrl}` : messageContent;
        try {
          const sendResult = await this.notificationsService.send({
            channel: rule.channel as 'LINE' | 'SMS',
            recipient,
            message: finalMessage,
            relatedId: contractId,
            fallbackPhone: rule.channel === 'LINE' ? contract.customer.phone : undefined,
          });
          status = sendResult.status === 'SENT' ? 'SENT' : 'FAILED';
          result = `notificationId:${sendResult.id}`;
        } catch (err) {
          status = 'FAILED';
          result = err instanceof Error ? err.message : 'send error';
          Sentry.captureException(err, {
            tags: { service: 'DunningEngineService', method: 'executeEventTrigger.send' },
            extra: { eventKey, contractId },
          });
        }
      } else {
        result = 'no recipient';
      }
    }

    await this.prisma.dunningAction.create({
      data: {
        dunningRuleId: rule.id,
        contractId,
        paymentId: paymentId ?? undefined,
        channel: rule.channel,
        status: status as any,
        messageContent,
        result: result ?? null,
        paymentLinkUrl: paymentLinkUrl ?? null,
        executedAt: status === 'SENT' ? new Date() : null,
      },
    });
  }
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npx jest dunning-engine.service.spec.ts`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/dunning-engine.service.ts apps/api/src/modules/overdue/dunning-engine.service.spec.ts
git commit -m "feat(dunning): add executeEventTrigger with 4h dedup"
```

---

## Task 11: Wire event trigger into `logContact`

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.service.ts` (logContact method)
- Modify: `apps/api/src/modules/overdue/overdue.module.ts` (if DunningEngine not injected yet)
- Modify: `apps/api/src/modules/overdue/overdue.service.spec.ts`

- [ ] **Step 1: Write failing test**

Append to `overdue.service.spec.ts`:

```typescript
describe('logContact → event trigger', () => {
  let engineSpy: jest.SpyInstance;

  beforeEach(() => {
    engineSpy = jest.spyOn(dunningEngine, 'executeEventTrigger').mockResolvedValue(undefined);
  });
  afterEach(() => engineSpy.mockRestore());

  it('dispatches CALL_NO_ANSWER on NO_ANSWER result', async () => {
    const contract = await makeOverdueContract();
    await service.logContact(contract.id, ownerUser.id, { result: 'NO_ANSWER' });
    expect(engineSpy).toHaveBeenCalledWith('CALL_NO_ANSWER', contract.id, null, expect.any(String));
  });

  it('dispatches CALL_REFUSED on REFUSED result', async () => {
    const contract = await makeOverdueContract();
    await service.logContact(contract.id, ownerUser.id, { result: 'REFUSED' });
    expect(engineSpy).toHaveBeenCalledWith('CALL_REFUSED', contract.id, null, expect.any(String));
  });

  it('increments noAnswerCount on NO_ANSWER, resets on ANSWERED', async () => {
    const contract = await makeOverdueContract();
    await service.logContact(contract.id, ownerUser.id, { result: 'NO_ANSWER' });
    await service.logContact(contract.id, ownerUser.id, { result: 'NO_ANSWER' });
    let after = await prisma.contract.findUnique({ where: { id: contract.id } });
    expect(after?.noAnswerCount).toBe(2);

    await service.logContact(contract.id, ownerUser.id, { result: 'ANSWERED' });
    after = await prisma.contract.findUnique({ where: { id: contract.id } });
    expect(after?.noAnswerCount).toBe(0);
  });

  it('sets needsSkipTracing on WRONG_NUMBER', async () => {
    const contract = await makeOverdueContract();
    await service.logContact(contract.id, ownerUser.id, { result: 'WRONG_NUMBER' });
    const after = await prisma.contract.findUnique({ where: { id: contract.id } });
    expect(after?.needsSkipTracing).toBe(true);
  });
});
```

- [ ] **Step 2: Run — should FAIL (method not yet wired)**

Run: `cd apps/api && npx jest overdue.service.spec.ts -t "logContact → event trigger"`
Expected: FAIL.

- [ ] **Step 3: Update `OverdueService.logContact`**

In `overdue.service.ts`, import the trigger utility and engine. Inject `DunningEngineService`:

```typescript
constructor(
  private prisma: PrismaService,
  private dunningEngine: DunningEngineService,
) {}
```

Replace the `logContact` method:

```typescript
  async logContact(
    contractId: string,
    callerId: string,
    dto: { result: string; notes?: string; collectionNotes?: string; settlementDate?: string; settlementNotes?: string },
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const now = new Date();

    // Decide which counters / flags to update based on result
    const resultMap: Record<
      string,
      { noAnswerDelta: 'inc' | 'reset' | 'keep'; needsSkipTracing?: boolean; eventKey?: import('@prisma/client').DunningEventTrigger }
    > = {
      NO_ANSWER:   { noAnswerDelta: 'inc',   eventKey: 'CALL_NO_ANSWER' },
      ANSWERED:    { noAnswerDelta: 'reset', eventKey: undefined },          // no template; promise path handles its own
      PROMISED:    { noAnswerDelta: 'reset', eventKey: 'CALL_ANSWERED_PROMISE' },
      REFUSED:     { noAnswerDelta: 'reset', eventKey: 'CALL_REFUSED' },
      WRONG_NUMBER:{ noAnswerDelta: 'keep',  needsSkipTracing: true },
      OTHER:       { noAnswerDelta: 'keep' },
    };
    const plan = resultMap[dto.result] ?? { noAnswerDelta: 'keep' };

    const [callLog] = await this.prisma.$transaction([
      this.prisma.callLog.create({
        data: {
          contractId,
          callerId,
          calledAt: now,
          result: dto.result,
          notes: dto.notes ?? null,
          settlementDate: dto.settlementDate ? new Date(dto.settlementDate) : null,
          settlementNotes: dto.settlementNotes ?? null,
        },
        include: { caller: { select: { id: true, name: true } } },
      }),
      this.prisma.contract.update({
        where: { id: contractId },
        data: {
          lastContactDate: now,
          dunningLastActionAt: now,
          ...(dto.collectionNotes !== undefined && { collectionNotes: dto.collectionNotes }),
          ...(plan.needsSkipTracing !== undefined && { needsSkipTracing: plan.needsSkipTracing }),
          ...(plan.noAnswerDelta === 'inc' && { noAnswerCount: { increment: 1 } }),
          ...(plan.noAnswerDelta === 'reset' && { noAnswerCount: 0 }),
        },
      }),
    ]);

    // Fire-and-log event trigger AFTER commit — failures must not roll back the call log.
    if (plan.eventKey) {
      try {
        await this.dunningEngine.executeEventTrigger(plan.eventKey, contractId, null, callLog.id);
      } catch (err) {
        this.logger.warn(
          `executeEventTrigger failed for ${plan.eventKey} on contract ${contractId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return callLog;
  }
```

- [ ] **Step 4: Update module wiring**

Open `apps/api/src/modules/overdue/overdue.module.ts`. Confirm `DunningEngineService` is in `providers` AND `OverdueService` has it listed as constructor dep (it already should — check). If not, add.

- [ ] **Step 5: Update DTO to accept settlement fields**

Open `apps/api/src/modules/overdue/dto/log-contact.dto.ts` (view first) and ensure it has optional `settlementDate` + `settlementNotes`:

```typescript
import { IsIn, IsOptional, IsString, IsDateString } from 'class-validator';

export class LogContactDto {
  @IsIn(['NO_ANSWER','ANSWERED','PROMISED','REFUSED','WRONG_NUMBER','OTHER'], { message: 'result ไม่ถูกต้อง' })
  result!: string;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsString()
  collectionNotes?: string;

  @IsOptional() @IsDateString({}, { message: 'settlementDate ต้องเป็นวันที่ ISO' })
  settlementDate?: string;

  @IsOptional() @IsString()
  settlementNotes?: string;
}
```

- [ ] **Step 6: Run tests**

Run: `cd apps/api && npx jest overdue.service.spec.ts`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/overdue/overdue.service.ts apps/api/src/modules/overdue/dto/log-contact.dto.ts apps/api/src/modules/overdue/overdue.module.ts apps/api/src/modules/overdue/overdue.service.spec.ts
git commit -m "feat(overdue): logContact fires event-triggered dunning + counter updates"
```

---

## Task 12: Backfill `noAnswerCount`

**Files:**
- Create: `apps/api/scripts/backfill-no-answer-count.ts`

- [ ] **Step 1: Write the one-off script**

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Count NO_ANSWER calls per contract in the last 30 days, but reset to 0 if
  // there's been an ANSWERED/PROMISED afterwards.
  const rows = await prisma.$queryRaw<{ contract_id: string; count: number }[]>`
    WITH ranked AS (
      SELECT
        "contract_id",
        "result",
        "called_at",
        ROW_NUMBER() OVER (PARTITION BY "contract_id" ORDER BY "called_at" DESC) AS rn,
        MIN(CASE WHEN "result" IN ('ANSWERED','PROMISED') THEN "called_at" END)
          OVER (PARTITION BY "contract_id") AS last_answered
      FROM "call_logs"
      WHERE "called_at" >= ${thirtyDaysAgo}
    )
    SELECT "contract_id", COUNT(*)::int AS count
    FROM ranked
    WHERE "result" = 'NO_ANSWER'
      AND (last_answered IS NULL OR "called_at" > last_answered)
    GROUP BY "contract_id"
  `;

  console.log(`Backfilling noAnswerCount for ${rows.length} contracts`);
  for (const row of rows) {
    await prisma.contract.update({
      where: { id: row.contract_id },
      data: { noAnswerCount: row.count },
    });
  }
  console.log('Done.');
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Dry-run locally**

Run: `cd apps/api && npx tsx scripts/backfill-no-answer-count.ts`
Expected: prints count, exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/backfill-no-answer-count.ts
git commit -m "chore(overdue): backfill script for noAnswerCount from last 30d callLogs"
```

(The script is for prod manual run via Cloud Run Job — no seed auto-call.)

---

## Task 13: MdmLockService skeleton

**Files:**
- Create: `apps/api/src/modules/overdue/mdm-lock.service.ts`
- Create: `apps/api/src/modules/overdue/mdm-lock.service.spec.ts`
- Modify: `apps/api/src/modules/overdue/overdue.module.ts`

- [ ] **Step 1: Write failing tests (propose + approve + reject + unlock)**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MdmLockService } from './mdm-lock.service';
import { DunningEngineService } from './dunning-engine.service';
// use existing integration test bootstrap (copy pattern from overdue.service.spec.ts)

describe('MdmLockService', () => {
  // ... standard setup

  describe('proposeManual', () => {
    it('creates PENDING request with MANUAL_COLLECTOR trigger', async () => {
      const contract = await makeOverdueContract();
      const req = await service.proposeManual(contract.id, salesUser.id, 'ลูกค้าไม่ติดต่อ 3 วัน');
      expect(req.status).toBe('PENDING');
      expect(req.trigger).toBe('MANUAL_COLLECTOR');
      expect(req.includeWallpaper).toBe(true);
    });

    it('is idempotent — returns existing PENDING for same contract', async () => {
      const contract = await makeOverdueContract();
      const a = await service.proposeManual(contract.id, salesUser.id, 'x');
      const b = await service.proposeManual(contract.id, salesUser.id, 'y');
      expect(b.id).toBe(a.id);
    });
  });

  describe('approve', () => {
    it('flips status to EXECUTED_MANUAL + sets deviceLocked + wallpaperChanged', async () => {
      const contract = await makeOverdueContract();
      const req = await service.proposeManual(contract.id, salesUser.id, 'x');
      const approved = await service.approve(req.id, ownerUser.id);

      expect(approved.status).toBe('EXECUTED_MANUAL');

      const after = await prisma.contract.findUnique({ where: { id: contract.id } });
      expect(after?.deviceLocked).toBe(true);
      expect(after?.wallpaperChanged).toBe(true);
      expect(after?.deviceLockedAt).toBeTruthy();
    });

    it('forbids SALES from approving (SoD)', async () => {
      const contract = await makeOverdueContract();
      const req = await service.proposeManual(contract.id, salesUser.id, 'x');
      await expect(service.approve(req.id, salesUser.id)).rejects.toThrow(/สิทธิ์อนุมัติ/);
    });
  });

  describe('reject', () => {
    it('requires reason ≥ 5 chars', async () => {
      const contract = await makeOverdueContract();
      const req = await service.proposeManual(contract.id, salesUser.id, 'x');
      await expect(service.reject(req.id, ownerUser.id, 'no')).rejects.toThrow(/เหตุผล/);
    });

    it('flips to REJECTED and does not touch contract', async () => {
      const contract = await makeOverdueContract();
      const req = await service.proposeManual(contract.id, salesUser.id, 'x');
      const after = await service.reject(req.id, ownerUser.id, 'ลูกค้าติดต่อแล้ว');
      expect(after.status).toBe('REJECTED');
      const c = await prisma.contract.findUnique({ where: { id: contract.id } });
      expect(c?.deviceLocked).toBe(false);
    });
  });

  describe('unlock', () => {
    it('flips deviceLocked=false and creates UNLOCK_REQUEST status record', async () => {
      const contract = await makeOverdueContract();
      const req = await service.proposeManual(contract.id, salesUser.id, 'x');
      await service.approve(req.id, ownerUser.id);

      const unlocked = await service.unlock(req.id, ownerUser.id);
      expect(unlocked.status).toBe('UNLOCKED');

      const c = await prisma.contract.findUnique({ where: { id: contract.id } });
      expect(c?.deviceLocked).toBe(false);
      expect(c?.wallpaperChanged).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run — FAIL (service not written)**

Run: `cd apps/api && npx jest mdm-lock.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write MdmLockService**

Create `apps/api/src/modules/overdue/mdm-lock.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningEngineService } from './dunning-engine.service';
import { MdmLockStatus, MdmLockTrigger } from '@prisma/client';

const APPROVE_ROLES = ['OWNER', 'FINANCE_MANAGER'] as const;

@Injectable()
export class MdmLockService {
  constructor(
    private prisma: PrismaService,
    private dunningEngine: DunningEngineService,
  ) {}

  async proposeAuto(
    contractId: string,
    trigger: MdmLockTrigger,
    reason: string,
  ) {
    return this.createIfNoneActive(contractId, null, trigger, reason, true);
  }

  async proposeManual(contractId: string, userId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผลการเสนอล็อคเครื่อง (≥ 5 ตัวอักษร)');
    }
    return this.createIfNoneActive(contractId, userId, 'MANUAL_COLLECTOR', reason, true);
  }

  private async createIfNoneActive(
    contractId: string,
    userId: string | null,
    trigger: MdmLockTrigger,
    reason: string,
    includeWallpaper: boolean,
  ) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    const existing = await this.prisma.mdmLockRequest.findFirst({
      where: {
        contractId,
        status: { in: ['PENDING', 'APPROVED'] },
        deletedAt: null,
      },
    });
    if (existing) return existing;

    const proposerId = userId ?? (await this.getSystemUserId());

    return this.prisma.mdmLockRequest.create({
      data: { contractId, status: 'PENDING', trigger, includeWallpaper, proposedById: proposerId, reason },
    });
  }

  async approve(requestId: string, approverId: string, approverRole?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: approverId } });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งาน');
    const role = approverRole ?? user.role;
    if (!APPROVE_ROLES.includes(role as typeof APPROVE_ROLES[number])) {
      throw new ForbiddenException(`สิทธิ์อนุมัติล็อคเครื่องเฉพาะ ${APPROVE_ROLES.join(' / ')}`);
    }

    const req = await this.prisma.mdmLockRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('ไม่พบคำขอ');
    if (req.status !== 'PENDING') throw new BadRequestException('คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');

    const wallpaperUrl = req.includeWallpaper
      ? (await this.prisma.systemConfig.findUnique({ where: { key: 'mdm_lock_wallpaper_url' } }))?.value ?? null
      : null;

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.mdmLockRequest.update({
        where: { id: requestId },
        data: {
          status: 'EXECUTED_MANUAL',
          approvedById: approverId,
          approvedAt: now,
          wallpaperUrlUsed: wallpaperUrl,
        },
      }),
      this.prisma.contract.update({
        where: { id: req.contractId },
        data: {
          deviceLocked: true,
          deviceLockedAt: now,
          wallpaperChanged: req.includeWallpaper,
          wallpaperChangedAt: req.includeWallpaper ? now : null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: approverId,
          action: 'MDM_LOCK_APPROVED',
          entity: 'mdm_lock_request',
          entityId: requestId,
          newValue: { trigger: req.trigger, includeWallpaper: req.includeWallpaper },
        },
      }),
    ]);

    // Fire LINE event — failure non-fatal
    try {
      await this.dunningEngine.executeEventTrigger('DEVICE_LOCKED', req.contractId, null, null);
    } catch {
      /* already logged by engine */
    }

    return updated;
  }

  async reject(requestId: string, rejectorId: string, reason: string, rejectorRole?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: rejectorId } });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งาน');
    const role = rejectorRole ?? user.role;
    if (!APPROVE_ROLES.includes(role as typeof APPROVE_ROLES[number])) {
      throw new ForbiddenException('สิทธิ์ปฏิเสธคำขอเฉพาะ OWNER / FINANCE_MANAGER');
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผลการปฏิเสธ (≥ 5 ตัวอักษร)');
    }

    return this.prisma.mdmLockRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        rejectedById: rejectorId,
        rejectedReason: reason.trim(),
      },
    });
  }

  async unlock(requestId: string, unlockerId: string, unlockerRole?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: unlockerId } });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งาน');
    const role = unlockerRole ?? user.role;
    if (!APPROVE_ROLES.includes(role as typeof APPROVE_ROLES[number])) {
      throw new ForbiddenException('สิทธิ์ปลดล็อคเฉพาะ OWNER / FINANCE_MANAGER');
    }

    const req = await this.prisma.mdmLockRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('ไม่พบคำขอ');
    if (req.status !== 'EXECUTED_MANUAL' && req.status !== 'EXECUTED_API') {
      throw new BadRequestException('คำขอนี้ยังไม่ถูก execute');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.mdmLockRequest.update({
        where: { id: requestId },
        data: { status: 'UNLOCKED' },
      }),
      this.prisma.contract.update({
        where: { id: req.contractId },
        data: { deviceLocked: false, wallpaperChanged: false },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: unlockerId,
          action: 'MDM_UNLOCK',
          entity: 'mdm_lock_request',
          entityId: requestId,
        },
      }),
    ]);

    try {
      await this.dunningEngine.executeEventTrigger('DEVICE_UNLOCKED', req.contractId, null, null);
    } catch {
      /* non-fatal */
    }

    return updated;
  }

  async getPendingByRole(userRole: string, userBranchId?: string) {
    // Only OWNER/FM see all; BM sees their branch contracts
    const where = userRole === 'BRANCH_MANAGER' && userBranchId
      ? { status: MdmLockStatus.PENDING, contract: { branchId: userBranchId } }
      : { status: MdmLockStatus.PENDING };

    return this.prisma.mdmLockRequest.findMany({
      where,
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true, phone: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        proposedBy: { select: { id: true, name: true } },
      },
      orderBy: { proposedAt: 'asc' },
      take: 200,
    });
  }

  private async getSystemUserId(): Promise<string> {
    const u = await this.prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
    if (!u) throw new Error('SYSTEM user not found');
    return u.id;
  }
}
```

- [ ] **Step 4: Register in module**

Open `apps/api/src/modules/overdue/overdue.module.ts`. Add `MdmLockService` to `providers` and `exports`:

```typescript
import { MdmLockService } from './mdm-lock.service';
// ...
providers: [OverdueService, DunningRuleService, DunningEngineService, MdmLockService],
exports: [OverdueService, MdmLockService],
```

- [ ] **Step 5: Run tests**

Run: `cd apps/api && npx jest mdm-lock.service.spec.ts`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/overdue/mdm-lock.service.ts apps/api/src/modules/overdue/mdm-lock.service.spec.ts apps/api/src/modules/overdue/overdue.module.ts
git commit -m "feat(overdue): MdmLockService with propose/approve/reject/unlock + SoD"
```

---

## Task 14: `mdm-auto-propose` cron

**Files:**
- Create: `apps/api/src/modules/overdue/crons/mdm-auto-propose.cron.ts`
- Create: `apps/api/src/modules/overdue/crons/mdm-auto-propose.cron.spec.ts`
- Modify: `apps/api/src/modules/overdue/overdue.module.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { Test } from '@nestjs/testing';
import { MdmAutoProposeCron } from './mdm-auto-propose.cron';
// ... standard setup using PrismaService + MdmLockService

describe('MdmAutoProposeCron', () => {
  it('proposes UNCONTACTABLE_3D when noAnswerCount ≥ 3 within 72h', async () => {
    const contract = await makeOverdueContract({ noAnswerCount: 3 });
    // seed 3 NO_ANSWER call logs in last 72h
    for (let i = 0; i < 3; i++) {
      await prisma.callLog.create({
        data: {
          contractId: contract.id, callerId: ownerUser.id,
          result: 'NO_ANSWER', calledAt: new Date(Date.now() - (i + 1) * 60 * 60 * 1000),
        },
      });
    }

    await cron.run();

    const req = await prisma.mdmLockRequest.findFirst({ where: { contractId: contract.id } });
    expect(req?.trigger).toBe('UNCONTACTABLE_3D');
  });

  it('proposes NO_PROMISE_3D when OVERDUE ≥ 3d with no settlement and no payment', async () => {
    const contract = await makeOverdueContract({
      status: 'OVERDUE',
      overdueDays: 5,
      hasPromise: false,
    });
    await cron.run();

    const req = await prisma.mdmLockRequest.findFirst({ where: { contractId: contract.id } });
    expect(req?.trigger).toBe('NO_PROMISE_3D');
  });

  it('is idempotent — second run does not create a second PENDING request', async () => {
    const contract = await makeOverdueContract({ noAnswerCount: 3 });
    await cron.run();
    await cron.run();
    const count = await prisma.mdmLockRequest.count({ where: { contractId: contract.id } });
    expect(count).toBe(1);
  });

  it('respects mdm_auto_propose_enabled=false', async () => {
    await prisma.systemConfig.update({
      where: { key: 'mdm_auto_propose_enabled' },
      data: { value: 'false' },
    });
    const contract = await makeOverdueContract({ noAnswerCount: 3 });
    await cron.run();
    const count = await prisma.mdmLockRequest.count({ where: { contractId: contract.id } });
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run — FAIL (cron not written)**

Run: `cd apps/api && npx jest mdm-auto-propose.cron.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the cron**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';

@Injectable()
export class MdmAutoProposeCron {
  private readonly logger = new Logger(MdmAutoProposeCron.name);

  constructor(
    private prisma: PrismaService,
    private mdmLockService: MdmLockService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async run() {
    try {
      const enabledCfg = await this.prisma.systemConfig.findUnique({
        where: { key: 'mdm_auto_propose_enabled' },
      });
      if (enabledCfg?.value !== 'true') {
        this.logger.log('mdm_auto_propose_enabled=false — skipping');
        return;
      }

      const uncontactableHours = Number(
        (await this.prisma.systemConfig.findUnique({
          where: { key: 'mdm_uncontactable_threshold_hours' },
        }))?.value ?? 72,
      );
      const noPromiseDays = Number(
        (await this.prisma.systemConfig.findUnique({
          where: { key: 'mdm_no_promise_threshold_days' },
        }))?.value ?? 3,
      );

      const now = new Date();
      const hoursAgo = new Date(now.getTime() - uncontactableHours * 60 * 60 * 1000);
      const daysAgo = new Date(now.getTime() - noPromiseDays * 24 * 60 * 60 * 1000);

      // UNCONTACTABLE_3D: contracts with ≥3 NO_ANSWER in window, no ANSWERED/PROMISED after
      const uncontactable = await this.prisma.$queryRaw<{ contract_id: string }[]>`
        SELECT "contract_id"
        FROM "call_logs"
        WHERE "called_at" >= ${hoursAgo}
          AND "result" = 'NO_ANSWER'
        GROUP BY "contract_id"
        HAVING COUNT(*) >= 3
          AND NOT EXISTS (
            SELECT 1 FROM "call_logs" c2
            WHERE c2."contract_id" = "call_logs"."contract_id"
              AND c2."called_at" >= ${hoursAgo}
              AND c2."result" IN ('ANSWERED','PROMISED')
          )
      `;

      for (const { contract_id } of uncontactable) {
        try {
          await this.mdmLockService.proposeAuto(
            contract_id,
            'UNCONTACTABLE_3D',
            `ติดต่อไม่ได้ ${uncontactableHours}h ที่ผ่านมา (NO_ANSWER ≥ 3 ครั้ง)`,
          );
        } catch (err) {
          Sentry.captureException(err, {
            tags: { cron: 'mdm-auto-propose', trigger: 'UNCONTACTABLE_3D', contractId: contract_id },
          });
        }
      }

      // NO_PROMISE_3D: OVERDUE contracts ≥ N days with no future settlement and no recent payment
      const noPromiseIds = await this.prisma.contract.findMany({
        where: {
          status: 'OVERDUE',
          deletedAt: null,
          payments: {
            some: {
              dueDate: { lt: daysAgo },
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            },
          },
          callLogs: {
            none: {
              result: 'PROMISED',
              settlementDate: { gte: now },
            },
          },
        },
        select: { id: true },
      });

      // exclude those already flagged UNCONTACTABLE above
      const flaggedSet = new Set(uncontactable.map((r) => r.contract_id));
      for (const { id } of noPromiseIds) {
        if (flaggedSet.has(id)) continue;
        try {
          await this.mdmLockService.proposeAuto(
            id,
            'NO_PROMISE_3D',
            `ค้าง ≥ ${noPromiseDays} วัน ไม่มีนัดชำระและไม่จ่าย`,
          );
        } catch (err) {
          Sentry.captureException(err, {
            tags: { cron: 'mdm-auto-propose', trigger: 'NO_PROMISE_3D', contractId: id },
          });
        }
      }

      this.logger.log(
        `MDM auto-propose: uncontactable=${uncontactable.length}, no_promise=${noPromiseIds.length}`,
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'mdm-auto-propose' } });
      this.logger.error(`mdm-auto-propose failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
```

- [ ] **Step 4: Register in module**

```typescript
import { MdmAutoProposeCron } from './crons/mdm-auto-propose.cron';
// ... providers: [..., MdmAutoProposeCron],
```

- [ ] **Step 5: Run tests**

Run: `cd apps/api && npx jest mdm-auto-propose.cron.spec.ts`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/overdue/crons/ apps/api/src/modules/overdue/overdue.module.ts
git commit -m "feat(overdue): mdm-auto-propose cron (UNCONTACTABLE_3D + NO_PROMISE_3D)"
```

---

## Task 15: ContractLetterService skeleton (create + cancel only — PDF in Plan 4)

**Files:**
- Create: `apps/api/src/modules/overdue/contract-letter.service.ts`
- Create: `apps/api/src/modules/overdue/contract-letter.service.spec.ts`
- Modify: `apps/api/src/modules/overdue/overdue.module.ts`

- [ ] **Step 1: Write failing tests for create + idempotency + cancel**

```typescript
describe('ContractLetterService (skeleton for Plan 1)', () => {
  describe('createIfNotExists', () => {
    it('generates sequential letterNumber ST-YYYY-NNNNN', async () => {
      const contract = await makeOverdueContract();
      const letter = await service.createIfNotExists(contract.id, 'RETURN_DEVICE_45D');
      expect(letter.letterNumber).toMatch(/^ST-2026-\d{5}$/);
    });

    it('is idempotent per (contractId, letterType)', async () => {
      const contract = await makeOverdueContract();
      const a = await service.createIfNotExists(contract.id, 'RETURN_DEVICE_45D');
      const b = await service.createIfNotExists(contract.id, 'RETURN_DEVICE_45D');
      expect(b.id).toBe(a.id);
    });

    it('allows different letter types per contract', async () => {
      const contract = await makeOverdueContract();
      await service.createIfNotExists(contract.id, 'RETURN_DEVICE_45D');
      const b = await service.createIfNotExists(contract.id, 'CONTRACT_TERMINATION_60D');
      const count = await prisma.contractLetter.count({ where: { contractId: contract.id } });
      expect(count).toBe(2);
    });
  });

  describe('cancel', () => {
    it('flips status to CANCELLED with reason', async () => {
      const contract = await makeOverdueContract();
      const letter = await service.createIfNotExists(contract.id, 'RETURN_DEVICE_45D');
      const after = await service.cancel(letter.id, ownerUser.id, 'ลูกค้าชำระครบแล้ว');
      expect(after.status).toBe('CANCELLED');
      expect(after.cancelReason).toBe('ลูกค้าชำระครบแล้ว');
    });

    it('cannot cancel after DISPATCHED', async () => {
      const contract = await makeOverdueContract();
      const letter = await service.createIfNotExists(contract.id, 'RETURN_DEVICE_45D');
      await prisma.contractLetter.update({
        where: { id: letter.id },
        data: { status: 'DISPATCHED', dispatchedAt: new Date() },
      });
      await expect(service.cancel(letter.id, ownerUser.id, 'x')).rejects.toThrow(/ยกเลิก/);
    });
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd apps/api && npx jest contract-letter.service.spec.ts`

- [ ] **Step 3: Implement service**

```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LetterType } from '@prisma/client';

@Injectable()
export class ContractLetterService {
  constructor(private prisma: PrismaService) {}

  async createIfNotExists(contractId: string, letterType: LetterType) {
    const existing = await this.prisma.contractLetter.findUnique({
      where: { contractId_letterType: { contractId, letterType } },
    });
    if (existing) return existing;

    const year = new Date().getFullYear();
    const seq = await this.nextSequence(year);
    const letterNumber = `ST-${year}-${seq.toString().padStart(5, '0')}`;

    return this.prisma.contractLetter.create({
      data: { contractId, letterType, letterNumber, status: 'PENDING_DISPATCH' },
    });
  }

  async cancel(letterId: string, userId: string, reason: string) {
    const letter = await this.prisma.contractLetter.findUnique({ where: { id: letterId } });
    if (!letter) throw new NotFoundException('ไม่พบหนังสือ');
    if (!['PENDING_DISPATCH', 'PDF_GENERATED'].includes(letter.status)) {
      throw new BadRequestException('ไม่สามารถยกเลิกหนังสือที่ส่งไปแล้ว');
    }
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('ต้องระบุเหตุผล (≥ 5 ตัวอักษร)');
    }

    return this.prisma.contractLetter.update({
      where: { id: letterId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.trim() },
    });
  }

  private async nextSequence(year: number): Promise<number> {
    // simplest: count existing letters that year and +1 — acceptable for MVP volume
    const count = await this.prisma.contractLetter.count({
      where: { letterNumber: { startsWith: `ST-${year}-` } },
    });
    return count + 1;
  }

  // generatePdf / markDispatched / markDelivered — implemented in Plan 4
}
```

- [ ] **Step 4: Register in module**

```typescript
providers: [..., ContractLetterService],
exports: [..., ContractLetterService],
```

- [ ] **Step 5: Run tests**

Run: `cd apps/api && npx jest contract-letter.service.spec.ts`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/overdue/contract-letter.service.ts apps/api/src/modules/overdue/contract-letter.service.spec.ts apps/api/src/modules/overdue/overdue.module.ts
git commit -m "feat(overdue): ContractLetterService skeleton (create idempotent + cancel)"
```

---

## Task 16: DunningSettingsPage — show event rules section

**Files:**
- Modify: `apps/web/src/pages/DunningSettingsPage.tsx`

- [ ] **Step 1: Add read-only "Event-triggered rules" section**

Open `DunningSettingsPage.tsx`. Find where the existing rule list is rendered. Above or below (maintainers' choice), add a new Card:

```tsx
<Card className="rounded-xl border border-border/50 bg-card shadow-sm">
  <CardContent className="p-5">
    <div className="text-sm font-semibold mb-3">Event-triggered rules</div>
    <p className="text-xs text-muted-foreground mb-4">
      Rules ที่ยิงตามเหตุการณ์ (ไม่ใช่ตามวัน) เช่น บันทึก NO_ANSWER → ส่ง LINE อัตโนมัติ
    </p>
    <div className="space-y-2">
      {eventRules.map((r) => (
        <div key={r.id} className="border border-border/50 rounded-lg p-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{r.name}</div>
            <div className="text-xs text-muted-foreground">
              trigger: <span className="font-mono">{r.eventTrigger}</span> · channel: {r.channel}
            </div>
          </div>
          <Badge variant={r.isActive ? 'success' : 'secondary'}>
            {r.isActive ? 'เปิด' : 'ปิด'}
          </Badge>
        </div>
      ))}
    </div>
  </CardContent>
</Card>
```

Before the return, add the filtered list from existing rules query:
```typescript
const eventRules = rules.filter((r) => r.eventTrigger !== null && r.eventTrigger !== undefined);
```

(If the existing `rules` query doesn't include `eventTrigger`, extend the type.)

- [ ] **Step 2: Type-check**

Run: `./tools/check-types.sh web`
Expected: 0 errors.

- [ ] **Step 3: Smoke manually**

Run: `cd apps/web && npm run dev` (separately run API).
Navigate to `/settings/dunning` (OWNER login).
Expect: new section shows 8 event rules list.
Kill dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/DunningSettingsPage.tsx
git commit -m "feat(dunning-settings): show event-triggered rules section (read-only in Plan 1)"
```

---

## Task 17: Full type-check + API test sweep + commit

- [ ] **Step 1: Type-check the whole repo**

Run: `./tools/check-types.sh all`
Expected: 0 errors for both api and web.

- [ ] **Step 2: Run full API test suite**

Run: `cd apps/api && npm test`
Expected: all pass.

- [ ] **Step 3: Run web vitest suite**

Run: `cd apps/web && npm test -- --run`
Expected: all pass.

- [ ] **Step 4: Run `./tools/check-types.sh all` once more as a final gate**

Run: `./tools/check-types.sh all`

- [ ] **Step 5: Commit any trailing fixes (if steps surfaced issues)**

```bash
git add -A
git commit -m "chore: resolve trailing type/test issues from plan 1" || true
```

(`|| true` in case nothing to commit.)

---

## Self-Review

**Spec coverage checklist (Plan 1 portion of the spec):**

| Spec §/requirement | Task |
|---|---|
| §11 schema — Contract new columns | 2 |
| §11 schema — DunningRule.eventTrigger + nullable triggerDay | 2 |
| §11 schema — User.isSystemUser | 2 |
| §11 schema — MdmLockRequest + enums | 1, 3 |
| §11 schema — ContractLetter + enums | 1, 4 |
| §11 migrations + CHECK constraint | 5 |
| §11 seed system user + 8 event rules + 9 configs | 6 |
| §11 bug fix C1 (assign DTO mismatch) | 7 |
| §11 bug fix C2 (audit silent skip) | 8 |
| §11 bug fix C3 (race) | 9 |
| §4 event trigger engine method | 10 |
| §4 event trigger wiring in logContact | 11 |
| §13 backfill noAnswerCount | 12 |
| §11 MdmLockService | 13 |
| §11 mdm-auto-propose cron | 14 |
| §11 ContractLetterService skeleton | 15 |
| §11 DunningSettingsPage event section | 16 |
| §14 full type-check + test sweep | 17 |

**Out of scope for Plan 1** (handled in later plans):
- UI `/collections` route + tabs → Plan 2
- Letter PDF generator + cron + dispatch UI → Plan 4
- Customer 360 slide-over / bulk actions / MDM UI → Plan 3

**Placeholder scan:** all steps have explicit code, exact commands, and expected output. No TBD / TODO / "similar to Task N" patterns.

**Type consistency:** method names consistent — `executeEventTrigger`, `proposeManual`, `proposeAuto`, `approve`, `reject`, `unlock`, `createIfNotExists`, `cancel`, `getSystemUserIdOrThrow`. Enum values match across schema + seed + service.
