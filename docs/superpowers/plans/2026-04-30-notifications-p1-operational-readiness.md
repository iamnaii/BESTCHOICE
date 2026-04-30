# Notifications P1 — Operational Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ระบบ notification ส่งจาก prod ไปถึงลูกค้าได้จริง — แก้ bug routing (LINE OA mismatch), ใส่ credentials, มี per-channel observability, และเอกสาร rotation/incident runbook

**Architecture:** Schema เพิ่ม `lineIdShop` + rename `lineId` → `lineIdFinance` ใน Customer. NotificationsService.send() รับ `channelKey` parameter เลือก token + recipient field ตาม OA context. 21 files / 58 call sites updated ผ่าน explicit channelKey

**Tech Stack:** NestJS + Prisma + PostgreSQL (apps/api), React + Vite (apps/web), Vitest (test), ThaiBulkSMS API v2 (SMS), LINE Messaging API (3 OA channels)

**Spec:** `docs/superpowers/specs/2026-04-30-notifications-p1-operational-readiness-design.md`

---

## Phase 1 — Schema Foundation (Day 1)

### Task 1: Schema migration — rename `lineId` → `lineIdFinance` + add `lineIdShop`

**Files:**
- Modify: `apps/api/prisma/schema.prisma:700` (Customer model)
- Create: `apps/api/prisma/migrations/<timestamp>_rename_customer_line_id_to_finance_and_add_shop/migration.sql`

- [ ] **Step 1: Update Prisma schema**

แก้ [apps/api/prisma/schema.prisma:700](apps/api/prisma/schema.prisma#L700):

```prisma
// BEFORE
lineId             String?   @map("line_id")

// AFTER
lineIdFinance      String?   @map("line_id_finance")  // OA "น้องเบส" (FINANCE)
lineIdShop         String?   @map("line_id_shop")     // OA "ร้าน" (SHOP)
```

- [ ] **Step 2: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name rename_customer_line_id_to_finance_and_add_shop --create-only
```

- [ ] **Step 3: Edit migration SQL to use RENAME instead of DROP+ADD**

แก้ไฟล์ `apps/api/prisma/migrations/<timestamp>_.../migration.sql` ให้ใช้:

```sql
-- Rename existing column (preserves data — assume current values = finance OA IDs)
ALTER TABLE "customers" RENAME COLUMN "line_id" TO "line_id_finance";

-- Add new column for shop OA
ALTER TABLE "customers" ADD COLUMN "line_id_shop" TEXT;
```

ลบ DROP COLUMN + ADD COLUMN ที่ Prisma generate มาตรฐาน (default จะลบข้อมูลทิ้ง)

- [ ] **Step 4: Apply migration to dev DB**

```bash
cd apps/api && npx prisma migrate dev
```

Expected: "Database schema is up to date"

- [ ] **Step 5: Verify Prisma client regenerated**

```bash
cd apps/api && npx prisma generate && grep -A 2 "lineIdFinance\|lineIdShop" node_modules/.prisma/client/index.d.ts | head -10
```

Expected: เห็น `lineIdFinance: string | null` และ `lineIdShop: string | null` ใน Customer type

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(schema): rename Customer.lineId to lineIdFinance, add lineIdShop

Splits LINE OA identity per channel — preparation for per-channel
routing in NotificationsService."
```

---

## Phase 2 — NotificationsService Core Refactor (Day 1-2)

### Task 2: Add `channelKey` to SendNotificationDto

**Files:**
- Modify: `apps/api/src/modules/notifications/dto/create-notification.dto.ts`

- [ ] **Step 1: Add LineChannelKey type and field**

```typescript
import { IsEnum, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import { NotificationChannel } from '@prisma/client';

export type LineChannelKey = 'line-shop' | 'line-finance' | 'line-staff';

export const LINE_CHANNEL_KEYS: LineChannelKey[] = ['line-shop', 'line-finance', 'line-staff'];

export class SendNotificationDto {
  @IsEnum(['LINE', 'SMS', 'IN_APP'])
  channel!: NotificationChannel;

  // NEW: required when channel === 'LINE', defaults to 'line-finance' for backward compat
  @ValidateIf((o) => o.channel === 'LINE')
  @IsOptional()
  @IsEnum(LINE_CHANNEL_KEYS, { message: 'channelKey ต้องเป็น line-shop, line-finance หรือ line-staff' })
  channelKey?: LineChannelKey;

  @IsString()
  recipient!: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  message!: string;

  @IsString()
  @IsOptional()
  relatedId?: string;

  @IsString()
  @IsOptional()
  fallbackPhone?: string;

  @IsOptional()
  noRetry?: boolean;
}
```

- [ ] **Step 2: Run type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```

Expected: ไม่มี new error เกี่ยวกับ DTO นี้ (อาจมี error ที่ NotificationsService ยังใช้ field เดิม — แก้ใน Task 3)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/notifications/dto/create-notification.dto.ts
git commit -m "feat(notifications): add channelKey to SendNotificationDto

Supports per-OA routing for LINE channel."
```

---

### Task 3: Refactor `getLineToken` to accept channelKey

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts:26-28`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/modules/notifications/notifications.service.routing.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

describe('NotificationsService — channel routing', () => {
  let service: NotificationsService;
  let integrationConfig: { getValue: jest.Mock };

  beforeEach(async () => {
    integrationConfig = { getValue: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: { notificationLog: { create: jest.fn() } } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: FlexTemplatesService, useValue: {} },
        { provide: QuickReplyService, useValue: {} },
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('getLineToken("line-shop") reads line-shop channelToken', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('shop-token-xxx');
    // @ts-expect-error — testing private method
    const token = await service.getLineToken('line-shop');
    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-shop', 'channelToken');
    expect(token).toBe('shop-token-xxx');
  });

  it('getLineToken("line-finance") reads line-finance channelToken', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('finance-token-yyy');
    // @ts-expect-error — testing private method
    const token = await service.getLineToken('line-finance');
    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-finance', 'channelToken');
    expect(token).toBe('finance-token-yyy');
  });

  it('getLineToken("line-staff") reads line-staff channelToken', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('staff-token-zzz');
    // @ts-expect-error
    const token = await service.getLineToken('line-staff');
    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-staff', 'channelToken');
    expect(token).toBe('staff-token-zzz');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/api && npx jest --testPathPattern=notifications.service.routing.spec.ts 2>&1 | tail -20
```

Expected: FAIL — `getLineToken` doesn't accept argument or always returns line-shop value

- [ ] **Step 3: Update getLineToken to accept channelKey**

แก้ [notifications.service.ts:26-28](apps/api/src/modules/notifications/notifications.service.ts#L26):

```typescript
import type { LineChannelKey } from './dto/create-notification.dto';

// BEFORE
private async getLineToken(): Promise<string> {
  return (await this.integrationConfig.getValue('line-shop', 'channelToken')) || '';
}

// AFTER
private async getLineToken(channelKey: LineChannelKey): Promise<string> {
  return (await this.integrationConfig.getValue(channelKey, 'channelToken')) || '';
}
```

- [ ] **Step 4: Update call sites in same file (line 140, 173)**

Search [notifications.service.ts](apps/api/src/modules/notifications/notifications.service.ts) for `await this.getLineToken()` and update — these are in `sendLine()` and `sendLineFlexMessage()`:

```typescript
// sendLine — line 139-170 area
private async sendLine(recipient: string, message: string, channelKey: LineChannelKey): Promise<void> {
  const lineChannelAccessToken = await this.getLineToken(channelKey);
  // ...rest unchanged
}

// sendLineFlexMessage — line 172-200 area
private async sendLineFlexMessage(recipient: string, flexMessage: FlexMessagePayload, channelKey: LineChannelKey): Promise<void> {
  const lineChannelAccessToken = await this.getLineToken(channelKey);
  // ...rest unchanged
}
```

- [ ] **Step 5: Update `send()` to pass channelKey through**

Update [notifications.service.ts:53-138](apps/api/src/modules/notifications/notifications.service.ts#L53):

```typescript
async send(dto: SendNotificationDto): Promise<{ id: string; status: string; errorMsg?: string }> {
  // Default channelKey for LINE notifications (backward compat — will be removed in Task 23)
  const channelKey: LineChannelKey = dto.channelKey ?? 'line-finance';

  let status = 'PENDING';
  let errorMsg: string | null = null;
  let sentAt: Date | null = null;
  let externalId: string | null = null;
  let retryCount = 0;
  const maxRetries = 2;

  const attemptSend = async (): Promise<void> => {
    if (dto.channel === 'LINE') {
      await this.sendLine(dto.recipient, dto.message, channelKey);  // ← pass channelKey
    } else if (dto.channel === 'SMS') {
      const messageId = await this.sendSms(dto.recipient, dto.message);
      if (messageId) externalId = messageId;
    }
  };

  // ...rest of method unchanged (retry loop, fallback SMS, log creation)
}
```

- [ ] **Step 6: Run test — verify pass**

```bash
cd apps/api && npx jest --testPathPattern=notifications.service.routing.spec.ts 2>&1 | tail -10
```

Expected: 3 tests pass

- [ ] **Step 7: Run full notifications module tests**

```bash
cd apps/api && npx jest --testPathPattern=notifications 2>&1 | tail -10
```

Expected: PASS (เก่าใช้ default 'line-finance' ยังทำงาน)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/notifications/
git commit -m "feat(notifications): support per-OA channelKey routing

NotificationsService.send() accepts channelKey ('line-shop'|'line-finance'|'line-staff').
Defaults to 'line-finance' for backward compat — to be removed after all
call sites are updated explicitly."
```

---

### Task 4: Update `send()` to use correct lineId field per channelKey

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`

**Note:** ที่ผ่านมา recipient (lineId) ถูก passed มาจาก caller. ใน Task นี้ caller ยังไม่เปลี่ยน — ดังนั้น service ไม่ต้องรู้ field name. คาดว่า caller ส่ง `customer.lineIdFinance` หรือ `lineIdShop` ที่ตรงกับ channelKey ตอน Task 5+ refactor caller. ใน task นี้แค่ verify type signature.

- [ ] **Step 1: Type check entire API**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "lineId" | head -20
```

Expected: เห็น list ของ files ที่ใช้ `customer.lineId` (field เก่าที่ rename แล้ว) — จะแก้ใน Task 5-12

ถ้าไม่มี error เกี่ยวกับ `lineId` แสดงว่า Prisma type ยังไม่ regenerate. Run:

```bash
cd apps/api && npx prisma generate
cd apps/api && npx tsc --noEmit 2>&1 | grep "Property 'lineId'" | wc -l
```

Expected: ~58 occurrences (= call sites ที่จะแก้ใน phase 4)

- [ ] **Step 2: ไม่ต้อง commit (no code change in this task)**

---

## Phase 3 — LIFF Write-Side Update (Day 2)

### Task 5: Update `verification.service.ts` to write `lineIdFinance`

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/services/verification.service.ts:325-328`

- [ ] **Step 1: Write failing test**

Update existing test file `apps/api/src/modules/chatbot-finance/services/verification.service.spec.ts` (or create if not exist):

```typescript
it('writes lineUserId to customer.lineIdFinance (not lineId)', async () => {
  const customerId = 'c-uuid';
  const lineUserId = 'U1234567890abcdef';
  const updateMock = jest.fn();
  prismaMock.customer.update = updateMock;
  prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock));

  await service.bindLineToCustomer(lineUserId, customerId);

  expect(updateMock).toHaveBeenCalledWith({
    where: { id: customerId },
    data: { lineIdFinance: lineUserId },  // ← finance OA, not generic lineId
  });
});
```

- [ ] **Step 2: Update verification.service.ts**

แก้ [verification.service.ts:325-328](apps/api/src/modules/chatbot-finance/services/verification.service.ts#L325):

```typescript
// BEFORE
await tx.customer.update({
  where: { id: customerId },
  data: { lineId: lineUserId },
});

// AFTER
await tx.customer.update({
  where: { id: customerId },
  data: { lineIdFinance: lineUserId },  // chatbot-finance writes finance OA ID
});
```

- [ ] **Step 3: Run test**

```bash
cd apps/api && npx jest --testPathPattern=verification.service.spec.ts 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/chatbot-finance/
git commit -m "feat(chatbot-finance): write lineIdFinance instead of lineId

Verification flow runs in line-finance OA context (น้องเบส) — must
write the finance-specific lineId field."
```

---

### Task 6: Update `liff-api.service.ts` to write `lineIdShop`

**Files:**
- Modify: `apps/api/src/modules/line-oa/liff-api.service.ts:172-192` (`confirmLinkLine`)
- Modify: `apps/api/src/modules/line-oa/liff-api.service.ts:185-194` (LIFF register flow)

**Context:** [liff-api.service.ts](apps/api/src/modules/line-oa/liff-api.service.ts) อยู่ใน module `line-oa` ซึ่งจัดการ shop OA (line-shop). ดังนั้น lineId ที่ link ผ่าน flow นี้ = shop OA ID

- [ ] **Step 1: Update `confirmLinkLine`**

แก้ [liff-api.service.ts:172](apps/api/src/modules/line-oa/liff-api.service.ts#L172):

```typescript
async confirmLinkLine(customerId: string, lineId: string): Promise<{ success: boolean; error?: string }> {
  // Check if lineId already linked to another customer (in shop OA)
  const existingLink = await this.prisma.customer.findFirst({
    where: { lineIdShop: lineId, deletedAt: null },  // ← was lineId
  });
  if (existingLink) {
    return { success: false, error: 'บัญชี LINE นี้เชื่อมต่อกับลูกค้ารายอื่นแล้ว' };
  }

  const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) {
    return { success: false, error: 'ไม่พบข้อมูลลูกค้า' };
  }
  if (customer.lineIdShop && customer.lineIdShop !== lineId) {  // ← was customer.lineId
    return { success: false, error: 'ลูกค้ารายนี้เชื่อมต่อกับบัญชี LINE อื่นแล้ว' };
  }

  await this.prisma.customer.update({
    where: { id: customerId },
    data: { lineIdShop: lineId },  // ← was lineId
  });

  this.logger.log(`[LIFF] Linked LINE ${lineId} to customer ${customer.name} via shop registration`);
  return { success: true };
}
```

- [ ] **Step 2: Update `unlinkLine` and other methods in same file**

Search for all `lineId` references in [liff-api.service.ts](apps/api/src/modules/line-oa/liff-api.service.ts):

```bash
grep -n "lineId" apps/api/src/modules/line-oa/liff-api.service.ts
```

Update each occurrence to `lineIdShop` (this file = shop OA context)

- [ ] **Step 3: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "liff-api.service.ts" | head -10
```

Expected: ไม่มี error ในไฟล์นี้แล้ว

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npx jest --testPathPattern=liff-api 2>&1 | tail -10
```

Expected: PASS (อาจ skip ถ้าไม่มี test file)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/line-oa/liff-api.service.ts
git commit -m "feat(line-oa): liff-api writes lineIdShop instead of lineId

LIFF register flow runs in line-shop OA context — must write the
shop-specific lineId field."
```

---

## Phase 4 — Update Read-Side Call Sites (Day 3-4)

### Task 7: Update `scheduler.service.ts` — finance notifications

**Files:**
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts`

**Pattern:** ทุก cron ที่ส่ง notification ไปยังลูกค้า (overdue, payment, dunning, status change) → `customer.lineIdFinance` + `channelKey: 'line-finance'`

Cron methods ที่ใช้ `customer.lineId`:
- `notifyStatusChangedCustomers` (line 89-146)
- `handleDunningEscalation` (line 207-275)
- ตัวอื่นๆ ที่ Sentry-tagged เป็น customer noti

- [ ] **Step 1: Update `notifyStatusChangedCustomers`**

แก้ [scheduler.service.ts:89-146](apps/api/src/modules/notifications/scheduler.service.ts#L89):

```typescript
// Replace include block (line 92-99 area)
include: {
  customer: { select: { id: true, name: true, lineIdFinance: true, phone: true } },  // ← was lineId
  payments: { /* unchanged */ },
},

// Replace lineId access (line 103-104 area)
const lineId = contract.customer?.lineIdFinance;  // ← was lineId
if (!lineId) continue;

// Replace LINE send call (line 138 area)
await this.lineOaService.sendFlexMessage(lineId, flex, 'line-finance');  // ← add channelKey
```

(สำหรับ `lineOaService.sendFlexMessage` signature — จะแก้ใน Task 14)

- [ ] **Step 2: Update `handleDunningEscalation`**

แก้ [scheduler.service.ts:207-275](apps/api/src/modules/notifications/scheduler.service.ts#L207):

```typescript
// Replace include
include: {
  customer: { select: { name: true, lineIdFinance: true, phone: true } },
  payments: { /* unchanged */ },
},

// Replace lineId access (line 235-236 area)
if (!contract?.customer?.lineIdFinance) continue;
const lineId = contract.customer.lineIdFinance;

// Replace `await this.notificationsService.send(...)` call (line 253 area)
await this.notificationsService.send({
  channelKey: 'line-finance',  // ← NEW
  channel: 'LINE',
  recipient: lineId,
  subject: `Dunning: ${esc.to}`,
  message,
  relatedId: esc.contractId,
  fallbackPhone: isSmsPaymentReminderDisabled() ? undefined : (contract.customer.phone || undefined),
});
```

- [ ] **Step 3: Update remaining cron methods in scheduler.service.ts**

For each method that currently calls `customer.lineId` or `notificationsService.send()` for customer-facing notification:
- `handlePaymentReminders` (line 151+) → channelKey: 'line-finance'
- `handleOverdueNotices` (line 165+) → channelKey: 'line-finance'
- `handleManagerNotifications` (line 179+) → channelKey: 'line-staff'
- `handleOwnerDefaultNotifications` (line 193+) → channelKey: 'line-staff'
- `handleAutoPaymentLinks` (line 365+) → channelKey: 'line-finance'
- `handleNotificationRetryQueue` (line 438+) → preserve channelKey from log

For each, search the method body for `customer.lineId` → replace with `customer.lineIdFinance` (customer noti) or use `lineIdShop` if context is shop. Add `channelKey:` field to all `notificationsService.send()` calls

- [ ] **Step 4: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "scheduler.service.ts" | head -10
```

Expected: ไม่มี error ในไฟล์นี้

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications/scheduler.service.ts
git commit -m "feat(notifications): scheduler routes per-channel via channelKey

19 cron methods updated to use line-finance for customer notifications,
line-staff for manager/owner alerts."
```

---

### Task 8: Update `notifications.service.ts` template/SMS reminder methods

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts` — methods `sendPaymentReminders`, `sendOverdueNotices`, `notifyManagersOverdue`, `notifyOwnerDefault`, `processQueue`

- [ ] **Step 1: Find all `customer.lineId` in notifications.service.ts**

```bash
grep -n "customer\.lineId\|customer?.lineId" apps/api/src/modules/notifications/notifications.service.ts
```

- [ ] **Step 2: Replace with `lineIdFinance` (or `lineIdShop` if shop context)**

ทุก method ที่ส่ง customer notification ใช้ `customer.lineIdFinance` + add `channelKey: 'line-finance'` ใน internal `send()` calls

ตัวอย่าง — method `sendPaymentReminders` ที่ส่ง LINE Flex:

```typescript
// BEFORE
if (customer.lineId) {
  await this.sendLineFlexMessage(customer.lineId, flex);
}

// AFTER
if (customer.lineIdFinance) {
  await this.sendLineFlexMessage(customer.lineIdFinance, flex, 'line-finance');
}
```

- [ ] **Step 3: Type check + run notifications tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "notifications.service.ts" | head -10
cd apps/api && npx jest --testPathPattern=notifications 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/notifications/notifications.service.ts
git commit -m "feat(notifications): service uses lineIdFinance + explicit channelKey"
```

---

### Task 9: Update `lineOaService.sendFlexMessage` signature

**Files:**
- Modify: `apps/api/src/modules/line-oa/line-oa.service.ts` (`sendFlexMessage` method + others using token)

**Context:** เดิม `lineOaService.sendFlexMessage(recipient, flex)` ใช้ token เดียว (line-shop hardcoded). เพิ่ม channelKey parameter

- [ ] **Step 1: Find all token uses in line-oa.service.ts**

```bash
grep -n "channelToken\|getValue.*channelToken\|line-shop\|line-finance" apps/api/src/modules/line-oa/line-oa.service.ts
```

- [ ] **Step 2: Refactor methods to accept channelKey**

```typescript
import type { LineChannelKey } from '../notifications/dto/create-notification.dto';

async sendFlexMessage(
  recipient: string,
  flexMessage: FlexMessagePayload,
  channelKey: LineChannelKey = 'line-finance',  // default for BC
): Promise<void> {
  const token = await this.integrationConfig.getValue(channelKey, 'channelToken');
  if (!token) throw new Error(`LINE ${channelKey} channelToken not configured`);
  // ...rest of method
}

// Repeat for sendTextMessage, sendMulticast, etc.
```

- [ ] **Step 3: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "line-oa.service.ts" | head -10
```

Expected: ไม่มี error ในไฟล์นี้ (callers อาจ error — แก้ใน task ถัดไป)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/line-oa/line-oa.service.ts
git commit -m "feat(line-oa): sendFlexMessage accepts channelKey

Replaces hardcoded line-shop token with explicit per-OA routing."
```

---

### Task 10: Batch update — overdue module (5 files)

**Files:**
- Modify: `apps/api/src/modules/overdue/bulk.service.ts`
- Modify: `apps/api/src/modules/overdue/dunning-engine.service.ts`
- Modify: `apps/api/src/modules/overdue/dunning-retry.service.ts`
- Modify: `apps/api/src/modules/overdue/overdue.service.ts`
- Modify: `apps/api/src/modules/overdue/queue.service.ts`
- Modify: `apps/api/src/modules/overdue/dto/queue-query.dto.ts` (DTO field rename)

**Context:** Overdue module ทำงานกับ FINANCE (ทวงหนี้) → ทุก `customer.lineId` → `lineIdFinance` + `channelKey: 'line-finance'`

- [ ] **Step 1: Update each file**

For each file in the list, find and replace:

```bash
# Find all occurrences
for f in apps/api/src/modules/overdue/{bulk,dunning-engine,dunning-retry,overdue,queue}.service.ts apps/api/src/modules/overdue/dto/queue-query.dto.ts; do
  echo "=== $f ==="
  grep -n "lineId" "$f"
done
```

For each match:
- `customer.lineId` → `customer.lineIdFinance`
- `customer: { select: { ..., lineId: true } }` → `customer: { select: { ..., lineIdFinance: true } }`
- ทุก `notificationsService.send()` → add `channelKey: 'line-finance'`
- ทุก `lineOaService.sendFlexMessage(recipient, flex)` → `(recipient, flex, 'line-finance')`

- [ ] **Step 2: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "modules/overdue" | head -20
```

Expected: ไม่มี error ใน overdue module

- [ ] **Step 3: Run overdue tests**

```bash
cd apps/api && npx jest --testPathPattern=overdue 2>&1 | tail -15
```

Expected: PASS (mocks ที่ใช้ `lineId` อาจ fail — fix in Phase 6 Task 19)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/overdue/
git commit -m "feat(overdue): use lineIdFinance + channelKey=line-finance

5 services + 1 DTO updated to read finance OA lineId for dunning,
queue, and bulk operations."
```

---

### Task 11: Batch update — contracts module (3 files)

**Files:**
- Modify: `apps/api/src/modules/contracts/contracts.service.ts:356`
- Modify: `apps/api/src/modules/contracts/contract-workflow.service.ts:505`
- Modify: `apps/api/src/modules/contracts/documents.service.ts:492-500, 976`

**Context:** Contracts ทุกตัวอยู่ใน FINANCE context (สัญญาผ่อน) → `lineIdFinance` + `channelKey: 'line-finance'`

- [ ] **Step 1: Update each file**

For each file:

```bash
grep -n "lineId" apps/api/src/modules/contracts/contracts.service.ts apps/api/src/modules/contracts/contract-workflow.service.ts apps/api/src/modules/contracts/documents.service.ts
```

Replace pattern:
- `customer.lineId` → `customer.lineIdFinance`
- `lineId: customerData.lineId` → `lineIdFinance: customerData.lineIdFinance, lineIdShop: customerData.lineIdShop` (Task 17 will update DTO/form)
- `notificationsService.send({ ... })` → add `channelKey: 'line-finance'`

**Special case** — [documents.service.ts:976](apps/api/src/modules/contracts/documents.service.ts#L976) is a template variable substitution `'{customer_line_id}': esc(contract.customer?.lineId || '-')` — change to `lineIdFinance`

- [ ] **Step 2: Type check**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "modules/contracts" | head -10
```

- [ ] **Step 3: Run contracts tests**

```bash
cd apps/api && npx jest --testPathPattern=contracts 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/contracts/
git commit -m "feat(contracts): contract notifications use lineIdFinance"
```

---

### Task 12: Batch update — payments + paysolutions

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts:1153-1174`
- Modify: `apps/api/src/modules/paysolutions/paysolutions.service.ts:107-1321` (multiple places)

**Context:** Payment/PaySolutions = FINANCE → `lineIdFinance` + `channelKey: 'line-finance'`

- [ ] **Step 1: Update payments.service.ts**

```bash
grep -n "lineId" apps/api/src/modules/payments/payments.service.ts
```

Replace all `customer.lineId` → `customer.lineIdFinance` and add `channelKey: 'line-finance'` to send/sendFlexMessage calls

- [ ] **Step 2: Update paysolutions.service.ts**

```bash
grep -n "lineId" apps/api/src/modules/paysolutions/paysolutions.service.ts
```

11+ occurrences (lines 107, 119, 1004, 1009, 1030, 1051, 1055, 1074, 1201, 1204, 1321, 1324). Replace pattern same as Task 10.

**Note:** `if (contract.customer.lineId !== lineId)` (line 119) — this is comparing incoming lineId from PaySolutions webhook. PaySolutions doesn't know about OA — match against `lineIdFinance` (since payment flow is finance-side):

```typescript
if (contract.customer.lineIdFinance !== lineId) {
  // ...
}
```

- [ ] **Step 3: Type check + tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "payments|paysolutions" | head -20
cd apps/api && npx jest --testPathPattern="payments|paysolutions" 2>&1 | tail -15
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/payments/ apps/api/src/modules/paysolutions/
git commit -m "feat(payments,paysolutions): finance notifications use lineIdFinance"
```

---

### Task 13: Batch update — collections + mdm + line-oa

**Files:**
- Modify: `apps/api/src/modules/collections-session/collections-session.service.ts:24, 66`
- Modify: `apps/api/src/modules/mdm/mdm-auto.service.ts:81, 203, 276, 279, 300, 302`
- Modify: `apps/api/src/modules/line-oa/payment-links/payment-link.service.ts:94`
- Modify: `apps/api/src/modules/line-oa/line-oa-payment.controller.ts:657, 687`

**Context:** ทั้งหมดเป็น FINANCE context → `lineIdFinance` + `channelKey: 'line-finance'`

- [ ] **Step 1: Update each file**

Same pattern as Task 10/11/12. Replace `customer.lineId` → `customer.lineIdFinance` + add `channelKey: 'line-finance'`

- [ ] **Step 2: Type check + tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "mdm|collections|payment-link|line-oa-payment" | head -20
cd apps/api && npx jest --testPathPattern="mdm|collections" 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/collections-session/ apps/api/src/modules/mdm/ apps/api/src/modules/line-oa/payment-links/ apps/api/src/modules/line-oa/line-oa-payment.controller.ts
git commit -m "feat(collections,mdm,line-oa): finance notifications use lineIdFinance"
```

---

### Task 14: Batch update — staff-chat (decide context)

**Files:**
- Modify: `apps/api/src/modules/staff-chat/services/chat-commerce.service.ts`
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts`

**Context:** staff-chat = inbox สำหรับพนักงาน. ลูกค้าที่แชทเข้ามาผ่าน LINE OA — context ขึ้นกับ OA ไหน

- [ ] **Step 1: Investigate which OA context**

```bash
grep -n "lineId\|channelKey\|line-shop\|line-finance" apps/api/src/modules/staff-chat/services/chat-commerce.service.ts apps/api/src/modules/staff-chat/staff-chat.controller.ts
```

Read the methods that use `customer.lineId` — check if context is finance (overdue chat) or shop (sales chat). Likely both depending on which OA the chat thread came from. The chat thread itself should have a `channelKey` field (verify in schema)

- [ ] **Step 2: Use thread's channelKey to pick correct lineId field**

Pattern (assuming `chatThread.channelKey` exists or can be derived):

```typescript
const lineId = chatThread.channelKey === 'line-finance'
  ? customer.lineIdFinance
  : customer.lineIdShop;
```

If chat thread schema doesn't track which OA — investigate during execution. May need schema change (defer to follow-up if too complex)

- [ ] **Step 3: Type check + tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "staff-chat" | head -10
cd apps/api && npx jest --testPathPattern=staff-chat 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/staff-chat/
git commit -m "feat(staff-chat): pick lineId field based on chat thread OA"
```

---

### Task 15: Batch update — shop-saving-plan (SHOP context)

**Files:**
- Modify: `apps/api/src/modules/shop-saving-plan/saving-plan-reminder.cron.ts:22, 25`
- Modify: `apps/api/src/modules/shop-saving-plan/shop-saving-plan.service.ts:100`

**Context:** shop-saving-plan = SHOP feature → `lineIdShop` + `channelKey: 'line-shop'`

- [ ] **Step 1: Update each file**

```typescript
// saving-plan-reminder.cron.ts
// BEFORE
if (!plan.customer.lineId) continue;
await this.notificationsService.send({
  channel: 'LINE',
  recipient: plan.customer.lineId,
  // ...
});

// AFTER
if (!plan.customer.lineIdShop) continue;  // Skip + Sentry log if missing (shop OA not linked)
await this.notificationsService.send({
  channelKey: 'line-shop',
  channel: 'LINE',
  recipient: plan.customer.lineIdShop,
  // ...
});
```

- [ ] **Step 2: Type check + tests**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "shop-saving-plan" | head -5
cd apps/api && npx jest --testPathPattern=shop-saving-plan 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/shop-saving-plan/
git commit -m "feat(shop-saving-plan): use lineIdShop + channelKey=line-shop"
```

---

### Task 16: Final type check — verify zero remaining `customer.lineId` references

- [ ] **Step 1: Grep for remaining usage**

```bash
grep -rnE "customer\.lineId(?!Finance|Shop)" apps/api/src --include="*.ts" 2>/dev/null
```

Expected: 0 results (regex excludes lineIdFinance/lineIdShop)

หรือใช้ TypeScript check:

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "Property 'lineId' does not exist" | wc -l
```

Expected: 0

- [ ] **Step 2: Run full API test suite**

```bash
cd apps/api && npx jest 2>&1 | tail -20
```

Expected: All pass (test mocks ยังไม่ update ใน Phase 6 — บางตัวอาจ fail เกี่ยวกับ mock data; fix in Task 19)

- [ ] **Step 3: ถ้ามี test fail เพราะ mock data — list ออกมาเก็บไว้ใน Task 19**

```bash
cd apps/api && npx jest 2>&1 | grep -E "FAIL|lineId" > /tmp/p1-failing-tests.txt
cat /tmp/p1-failing-tests.txt
```

---

## Phase 5 — Frontend UI Updates (Day 4-5)

### Task 17: Update CustomerEditModal — 2 LINE ID input fields

**Files:**
- Modify: `apps/web/src/components/contract/CustomerEditModal.tsx`

- [ ] **Step 1: Update form state interface**

แก้ [CustomerEditModal.tsx:40-128](apps/web/src/components/contract/CustomerEditModal.tsx) form state:

```typescript
// BEFORE
phone: '', phoneSecondary: '', email: '', lineId: '',

// AFTER
phone: '', phoneSecondary: '', email: '',
lineIdFinance: '', lineIdShop: '',
```

- [ ] **Step 2: Update form initialization (line 63)**

```typescript
email: fc.email || '',
lineIdFinance: fc.lineIdFinance || '',
lineIdShop: fc.lineIdShop || '',
```

- [ ] **Step 3: Update reset state (line 90)**

```typescript
email: '',
lineIdFinance: '', lineIdShop: '',
facebookLink: '', facebookName: '',
```

- [ ] **Step 4: Update submit payload (line 128)**

```typescript
lineIdFinance: form.lineIdFinance || null,
lineIdShop: form.lineIdShop || null,
```

- [ ] **Step 5: Update form input (line 281)**

แทน 1 input field ด้วย 2 inputs:

```tsx
<div>
  <label className="text-sm text-muted-foreground">LINE ID (น้องเบส / FINANCE)</label>
  <input
    type="text"
    value={form.lineIdFinance}
    onChange={(e) => setForm({ ...form, lineIdFinance: e.target.value })}
    className="w-full px-3 py-2 border border-input rounded-lg text-sm"
    placeholder="U1234567890abcdef..."
  />
</div>
<div>
  <label className="text-sm text-muted-foreground">LINE ID (ร้าน / SHOP)</label>
  <input
    type="text"
    value={form.lineIdShop}
    onChange={(e) => setForm({ ...form, lineIdShop: e.target.value })}
    className="w-full px-3 py-2 border border-input rounded-lg text-sm"
    placeholder="U1234567890abcdef..."
  />
</div>
```

- [ ] **Step 6: Type check web**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep "CustomerEditModal" | head -5
```

Expected: ไม่มี error

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/contract/CustomerEditModal.tsx
git commit -m "feat(web): customer edit form has 2 LINE ID fields (finance + shop)"
```

---

### Task 18: NotificationsPage — per-channel stats cards

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.controller.ts` (`/logs/stats` endpoint)
- Modify: `apps/api/src/modules/notifications/notifications.service.ts` (`getLogStats` method or equivalent)
- Modify: `apps/web/src/pages/NotificationsPage/index.tsx`

- [ ] **Step 1: Write failing test for stats endpoint**

`apps/api/src/modules/notifications/notifications.service.stats.spec.ts`:

```typescript
describe('NotificationsService.getLogStats', () => {
  it('returns per-channel breakdown', async () => {
    prismaMock.notificationLog.groupBy.mockResolvedValue([
      { channel: 'LINE', status: 'SENT', _count: { _all: 100 } },
      { channel: 'LINE', status: 'FAILED', _count: { _all: 5 } },
      { channel: 'SMS', status: 'SENT', _count: { _all: 50 } },
      { channel: 'IN_APP', status: 'SENT', _count: { _all: 10 } },
    ]);
    const stats = await service.getLogStats();
    expect(stats).toEqual({
      line: { total: 105, sent: 100, failed: 5, pending: 0 },
      sms: { total: 50, sent: 50, failed: 0, pending: 0, creditRemaining: expect.any(Number) },
      in_app: { total: 10, sent: 10, failed: 0, pending: 0 },
    });
  });
});
```

- [ ] **Step 2: Run test — verify fail**

```bash
cd apps/api && npx jest --testPathPattern=notifications.service.stats 2>&1 | tail -10
```

- [ ] **Step 3: Implement getLogStats with groupBy**

In `notifications.service.ts`:

```typescript
async getLogStats() {
  const groups = await this.prisma.notificationLog.groupBy({
    by: ['channel', 'status'],
    where: { deletedAt: null, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    _count: { _all: true },
  });

  const empty = () => ({ total: 0, sent: 0, failed: 0, pending: 0 });
  const result = {
    line: empty(),
    sms: { ...empty(), creditRemaining: 0 },
    in_app: empty(),
  };

  for (const g of groups) {
    const key = g.channel === 'IN_APP' ? 'in_app' : g.channel.toLowerCase() as 'line' | 'sms';
    const bucket = result[key];
    const count = g._count._all;
    bucket.total += count;
    if (g.status === 'SENT') bucket.sent += count;
    else if (g.status === 'FAILED') bucket.failed += count;
    else bucket.pending += count;
  }

  // Add SMS credit
  const credit = await this.checkSmsCredit();
  result.sms.creditRemaining = credit.credit ?? 0;

  return result;
}
```

- [ ] **Step 4: Update controller (line 65-68 area in NotificationsPage)**

ไม่ต้องแก้ controller ถ้า `getLogStats()` คืน new shape อยู่แล้ว — controller pass-through

- [ ] **Step 5: Update NotificationsPage UI**

แก้ [NotificationsPage/index.tsx:65-145](apps/web/src/pages/NotificationsPage/index.tsx#L65):

```typescript
interface PerChannelStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
}

interface LogStats {
  line: PerChannelStats;
  sms: PerChannelStats & { creditRemaining: number };
  in_app: PerChannelStats;
}

// In JSX where stats is rendered (line 145+):
{stats && (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">LINE</div>
      <div className="text-2xl font-semibold">{stats.line.sent} / {stats.line.total}</div>
      <div className="text-xs text-muted-foreground">
        {stats.line.failed} failed, {stats.line.pending} pending
      </div>
    </div>
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">SMS</div>
      <div className="text-2xl font-semibold">{stats.sms.sent} / {stats.sms.total}</div>
      <div className="text-xs text-muted-foreground">
        Credit: {stats.sms.creditRemaining}
        {stats.sms.creditRemaining < 100 && <span className="text-destructive"> (ใกล้หมด)</span>}
      </div>
    </div>
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">IN_APP</div>
      <div className="text-2xl font-semibold">{stats.in_app.sent} / {stats.in_app.total}</div>
      <div className="text-xs text-muted-foreground">
        {stats.in_app.failed} failed
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Run test + type check**

```bash
cd apps/api && npx jest --testPathPattern=notifications.service.stats 2>&1 | tail -10
cd apps/web && npx tsc --noEmit 2>&1 | grep "NotificationsPage" | head -5
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/notifications/ apps/web/src/pages/NotificationsPage/
git commit -m "feat(notifications): per-channel stats with SMS credit balance"
```

---

### Task 19: SMS credit alert cron + IntegrationHub UI

**Files:**
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts` (add cron method)
- Modify: `apps/web/src/pages/IntegrationHubPage.tsx` (add credit display)

- [ ] **Step 1: Add cron method to scheduler.service.ts**

After existing crons, add:

```typescript
/**
 * Run daily at 09:00 ICT — alert if SMS credit is low
 */
@Cron('0 2 * * *')  // 09:00 ICT = 02:00 UTC
async handleSmsCreditAlert() {
  this.logger.log('Checking SMS credit balance...');
  try {
    const credit = await this.notificationsService.checkSmsCredit();
    if (!credit.configured) return;
    if (credit.credit !== undefined && credit.credit < 100) {
      const message = `[BESTCHOICE] เครดิต SMS ใกล้หมด: เหลือ ${credit.credit} เครดิต — กรุณาเติมก่อนหมด`;
      // Send to line-staff (notifyTargets)
      const staffTargets = (await this.integrationConfig.getValue('line-staff', 'notifyTargets')) || '';
      const targets = staffTargets.split(',').map((s) => s.trim()).filter(Boolean);
      for (const target of targets) {
        await this.notificationsService.send({
          channelKey: 'line-staff',
          channel: 'LINE',
          recipient: target,
          message,
          relatedId: 'sms-credit-alert',
          noRetry: true,
        });
      }
      this.logger.warn(`SMS credit low (${credit.credit}) — alerted ${targets.length} staff`);
    }
  } catch (error) {
    this.reportCronFailure('sms-credit-alert', error);
  }
}
```

- [ ] **Step 2: Add IntegrationConfigService dependency to scheduler**

If not already injected, add to constructor:

```typescript
constructor(
  // ...existing
  private integrationConfig: IntegrationConfigService,
)
```

- [ ] **Step 3: Update IntegrationHubPage to show SMS credit**

แก้ [IntegrationHubPage.tsx](apps/web/src/pages/IntegrationHubPage.tsx):

```typescript
// Add query
const { data: smsCredit } = useQuery({
  queryKey: ['sms-credit'],
  queryFn: async () => (await api.get<{ configured: boolean; credit?: number }>('/notifications/sms/credit')).data,
  refetchInterval: 5 * 60 * 1000, // every 5 minutes
});

// In SMS integration card section:
{smsCredit?.configured && (
  <div className="text-sm">
    เครดิต SMS เหลือ: <span className={smsCredit.credit && smsCredit.credit < 100 ? 'text-destructive font-semibold' : 'text-foreground'}>
      {smsCredit.credit ?? 0}
    </span>
  </div>
)}
```

- [ ] **Step 4: Verify endpoint exists**

```bash
grep -n "sms/credit\|smsCredit\|checkSmsCredit" apps/api/src/modules/notifications/notifications.controller.ts
```

If not exposed, add:

```typescript
@Get('sms/credit')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
async getSmsCredit() {
  return this.notificationsService.checkSmsCredit();
}
```

- [ ] **Step 5: Type check + commit**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "scheduler|notifications.controller" | head -5
cd apps/web && npx tsc --noEmit 2>&1 | grep "IntegrationHub" | head -5

git add apps/api/src/modules/notifications/ apps/web/src/pages/IntegrationHubPage.tsx
git commit -m "feat(notifications): SMS credit alert cron + UI display

Daily 09:00 ICT cron alerts line-staff if credit < 100.
IntegrationHub shows current credit, warns if low."
```

---

## Phase 6 — Tests + Documentation (Day 5-6)

### Task 20: Update test mocks referencing `customer.lineId`

**Files:**
- Modify: `apps/api/src/modules/**/*.spec.ts` (~26 files)

- [ ] **Step 1: Find all spec files with `lineId`**

```bash
grep -rln "customer\.lineId\|lineId:" apps/api/src --include="*.spec.ts" | sort -u
```

- [ ] **Step 2: For each file, update mocks**

Pattern:
- `lineId: 'U1234...'` in mock customer → `lineIdFinance: 'U1234...'`
- `select: { lineId: true }` → `select: { lineIdFinance: true, lineIdShop: true }`
- `customer.lineId` access → `customer.lineIdFinance` (most contexts) or `lineIdShop`

Decision rule: if test is for finance flow (overdue, payment, contract) → `lineIdFinance`. If for shop flow (saving plan, promo) → `lineIdShop`.

- [ ] **Step 3: Run full test suite**

```bash
cd apps/api && npx jest 2>&1 | tail -20
```

Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/
git commit -m "test: update mocks to use lineIdFinance/lineIdShop fields"
```

---

### Task 21: Add integration test for routing

**Files:**
- Create: `apps/api/src/modules/notifications/notifications.routing.integration.spec.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
// ...other imports

describe('NotificationsService — integration: per-channel routing', () => {
  let service: NotificationsService;
  let prisma: { notificationLog: { create: jest.Mock } };
  let integrationConfig: { getValue: jest.Mock };
  let fetchMock: jest.SpyInstance;

  beforeEach(async () => {
    prisma = { notificationLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) } };
    integrationConfig = { getValue: jest.fn() };
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        // ...other providers
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('LINE send with channelKey=line-finance uses finance token', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('finance-token-yyy');

    await service.send({
      channelKey: 'line-finance',
      channel: 'LINE',
      recipient: 'Uxxx',
      message: 'test',
    });

    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-finance', 'channelToken');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer finance-token-yyy' }),
      }),
    );
  });

  it('LINE send with channelKey=line-staff uses staff token', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('staff-token-zzz');
    await service.send({
      channelKey: 'line-staff',
      channel: 'LINE',
      recipient: 'Uxxx',
      message: 'staff alert',
    });
    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-staff', 'channelToken');
  });

  it('LINE send without channelKey defaults to line-finance', async () => {
    integrationConfig.getValue.mockResolvedValueOnce('finance-token-yyy');
    await service.send({
      channel: 'LINE',
      recipient: 'Uxxx',
      message: 'test',
    });
    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-finance', 'channelToken');
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/api && npx jest --testPathPattern=notifications.routing.integration 2>&1 | tail -15
```

Expected: 3 tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/notifications/notifications.routing.integration.spec.ts
git commit -m "test(notifications): integration test for per-channel routing"
```

---

### Task 22: Write runbook — credential rotation

**Files:**
- Create: `docs/runbooks/notifications-credential-rotation.md`

- [ ] **Step 1: Write runbook**

```markdown
# Notifications — Credential Rotation Runbook

## When to rotate
- LINE channel access token: every 12 months OR if leaked OR if developer access compromised
- ThaiBulkSMS API Key/Secret: every 6 months OR if leaked
- LINE channel secret: only if compromised (used for webhook signature verification — change requires webhook URL update too)

## Pre-flight checklist
- [ ] Notify team via Slack/LINE — "rotation in progress, brief outage possible"
- [ ] Have new credential ready in a secure note (not chat)
- [ ] Confirm time window (off-business-hours preferred — after 20:00 ICT)

## LINE channel access token rotation

### 1. Generate new token at LINE Developers Console
1. Login https://developers.line.biz/console
2. Select provider → channel (line-shop / line-finance / line-staff)
3. Messaging API tab → Channel access token (long-lived)
4. Click "Reissue" — copy new token immediately

### 2. Update via UI (preferred, no downtime)
1. Login BESTCHOICE admin → Settings → Integrations
2. Click on the integration row → "แก้ไข"
3. Paste new `channelToken` → "ทดสอบเชื่อมต่อ" → "บันทึก"
4. Verify last log: `notification_logs` for sent recently — should show SENT

### 3. Verify
```sql
SELECT channel, status, COUNT(*)
FROM notification_logs
WHERE created_at > now() - interval '15 minutes'
GROUP BY 1, 2;
```
SENT > 0 = success. FAILED with "Invalid token" = old token still in use → cache issue, restart Cloud Run.

### 4. Rollback
- Revert IntegrationConfig value to previous token
- LINE Console: ใช้ "Reissue" ไม่ลบ token เก่าทันที (เก่ายังใช้งานได้ถ้าไม่กด revoke)

## ThaiBulkSMS API Key rotation

### 1. Generate new key
1. Login https://account.thaibulksms.com
2. Setting → API Setting → Generate new API Key + Secret
3. Note: เก่ายังใช้งานได้ 24 ชม. (มี grace period)

### 2. Update via UI
1. BESTCHOICE → Settings → Integrations → SMS
2. Paste new apiKey + apiSecret → "ทดสอบ" → save

### 3. Verify credit balance fetch works
- IntegrationHubPage → SMS card should show current credit (proves new key authenticates)

### 4. Rollback
- Revert via UI (old key valid 24h)

## Rich menu / LIFF ID changes
- LIFF ID changes require frontend rebuild + redeploy (env vars `VITE_LIFF_ID*`)
- Do NOT rotate LIFF ID unless creating new LIFF app

## Post-rotation
- Update password manager / 1Password vault
- Document rotation in `docs/audit-log/credential-rotations.md` (date, who, channel)
- Schedule next rotation in calendar
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/notifications-credential-rotation.md
git commit -m "docs: notifications credential rotation runbook"
```

---

### Task 23: Write runbook — incident response

**Files:**
- Create: `docs/runbooks/notifications-incident.md`

- [ ] **Step 1: Write runbook**

```markdown
# Notifications — Incident Response Runbook

## Symptom: Failure rate spike

### Detection
- Sentry alert: `notification.failed > 10/hour`
- Manual: NotificationsPage → channel card shows high `failed` count
- User report: "ลูกค้าไม่ได้รับแจ้งเตือน"

### Investigation
```sql
SELECT channel, error_msg, COUNT(*)
FROM notification_logs
WHERE created_at > now() - interval '1 hour' AND status = 'FAILED'
GROUP BY 1, 2
ORDER BY 3 DESC LIMIT 20;
```

### Common causes + fixes

| error_msg | Cause | Fix |
|---|---|---|
| `not configured` | IntegrationConfig missing key | UI → Integrations → fill credentials |
| `Invalid token` | Token rotated externally / expired | Run credential-rotation runbook |
| `400 The request body has 1 error(s)` | LINE user ID invalid (lineIdFinance from wrong OA?) | Check customer record + manually re-link |
| `403 Forbidden` | LINE webhook IP changed / token revoked | Re-verify in LINE Console |
| `Cannot read property 'getValue'` | Service crash / Prisma disconnected | Cloud Run logs → restart |
| `credentials invalid` (SMS) | API key rotated externally | Run rotation runbook |
| `number invalid` | Customer phone format bad | Update customer record |

## Symptom: SMS credit exhausted

### Detection
- Cron alert: line-staff "เครดิต SMS ใกล้หมด"
- IntegrationHubPage shows credit = 0

### Action
1. Top up at https://account.thaibulksms.com → Top Up
2. Verify new balance via IntegrationHubPage (refresh)
3. Manually trigger SMS retry queue:
```sql
UPDATE notification_logs
SET next_retry_at = now()
WHERE channel = 'SMS' AND status = 'RETRY_PENDING' AND created_at > now() - interval '24 hours';
```
4. Cron `handleNotificationRetryQueue` runs every 5 mins — pending will be retried

## Symptom: Sender ID rejected

### Detection
- All SMS fail with `sender invalid`
- ThaiBulkSMS dashboard shows sender as "Pending" or "Rejected"

### Action
1. Login ThaiBulkSMS → Sender Names → check status
2. If Pending: wait 3-7 business days, follow up via support
3. If Rejected: read rejection reason, resubmit with correction
4. Temporary workaround: use approved generic sender (e.g., `BESTCHOICE` if approved, or `default`)

## Symptom: Customer reports no LINE notification but log shows SENT

### Investigation
1. Check `notification_logs.recipient` — is it a valid LINE user ID format `Uxxxx...`?
2. Cross-check: which `lineIdFinance` vs `lineIdShop` was used?
3. LINE has no DLR for Messaging API push → status SENT means LINE accepted, not user received
4. Possible causes:
   - User blocked the OA → unblockable from API side, must ask user
   - User unfollowed OA → check if they re-followed
   - User ID belongs to different OA (data quality issue) → manually re-link

## Escalation
- L1: Owner / dev on call — fix per runbook
- L2: Reach out to provider:
  - LINE: https://developers.line.biz/en/docs/contact/
  - ThaiBulkSMS: support@thaibulksms.com / 02-119-2300
- L3: Disable affected cron temporarily (`@Cron` decorator → comment out + redeploy)
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/notifications-incident.md
git commit -m "docs: notifications incident response runbook"
```

---

## Phase 7 — Production Setup (Day 6-7)

### Task 24: Submit SMS Sender ID at ThaiBulkSMS

**Files:** None (external action)

- [ ] **Step 1: Login ThaiBulkSMS dashboard**

https://account.thaibulksms.com

- [ ] **Step 2: Navigate to Sender Names**

Settings → Sender Names → Add new

- [ ] **Step 3: Submit `BESTCHOICE`**

- Sender name: `BESTCHOICE`
- Sample message: `[BESTCHOICE] แจ้งเตือนชำระค่างวด งวดที่ 3 ครบกำหนด 5 พ.ค. 2569 ยอด 1,500 บาท`
- Use case: Installment payment reminders + collection notices for our finance customers

- [ ] **Step 4: Wait for approval (3-7 business days)**

Mark on calendar: check status daily until approved

- [ ] **Step 5: Once approved, update IntegrationConfig**

UI → Settings → Integrations → SMS → set `sender = BESTCHOICE` → save

---

### Task 25: Setup credentials in production (manual UI work)

**Files:** None (UI action)

- [ ] **Step 1: Verify all 4 integrations show in IntegrationHubPage**

Login as OWNER → Settings → Integrations → see 4 cards: line-shop, line-finance, line-staff, sms

- [ ] **Step 2: For each LINE integration, fill credentials**

Per [integration-registry.ts](apps/api/src/modules/integrations/integration-registry.ts):

**line-shop:**
- channelToken: long-lived from LINE Console
- channelSecret: from LINE Console
- liffId: from LIFF app

**line-finance:**
- channelToken: from LINE Console (น้องเบส)
- channelSecret: from LINE Console
- liffId: from LIFF app

**line-staff:**
- channelToken: from LINE Console
- channelSecret: from LINE Console
- notifyTargets: comma-separated user IDs of OWNER + relevant managers (get from LINE Login or LIFF profile)

**sms:**
- apiKey + apiSecret + sender (after Task 24 approval)

- [ ] **Step 3: After each, click "ทดสอบเชื่อมต่อ"**

Expected: Connection successful

- [ ] **Step 4: Set webhook URLs in providers**

LINE Developers Console for each channel:
- line-shop webhook: `https://<prod-domain>/api/line-oa/webhook`
- line-finance webhook: `https://<prod-domain>/api/chatbot/finance/webhook`

ThaiBulkSMS dashboard:
- DLR webhook: `https://<prod-domain>/api/sms-webhook`

- [ ] **Step 5: End-to-end test**

UI → Settings → LINE OA → "ส่งทดสอบ":
- Pick "payment_reminder" template
- Recipient: own LINE OA-linked user
- Verify message received in LINE app

UI → Settings → Integrations → SMS → "ทดสอบ":
- Send to own phone
- Verify SMS received + DLR logged in `notification_logs.delivered_at`

---

### Task 26: Remove `channelKey` default — force explicit usage

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts` (`send()` method)
- Modify: `apps/api/src/modules/notifications/dto/create-notification.dto.ts`

**Context:** หลังจากทุก call site update แล้ว (Phase 4 done), ลบ default value เพื่อบังคับให้ทุก call ระบุ channelKey ชัดเจน — TypeScript จะ error ถ้าลืม

- [ ] **Step 1: Make channelKey required in DTO**

```typescript
// BEFORE
@ValidateIf((o) => o.channel === 'LINE')
@IsOptional()
@IsEnum(LINE_CHANNEL_KEYS)
channelKey?: LineChannelKey;

// AFTER
@ValidateIf((o) => o.channel === 'LINE')
@IsEnum(LINE_CHANNEL_KEYS, { message: 'channelKey ต้องเป็น line-shop, line-finance หรือ line-staff' })
channelKey!: LineChannelKey;
```

- [ ] **Step 2: Remove default in send()**

```typescript
// BEFORE
const channelKey: LineChannelKey = dto.channelKey ?? 'line-finance';

// AFTER
if (dto.channel === 'LINE' && !dto.channelKey) {
  throw new BadRequestException('channelKey จำเป็นสำหรับ LINE notification');
}
const channelKey = dto.channelKey;
```

- [ ] **Step 3: Type check — find any callers still missing channelKey**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "channelKey" | head -20
```

Expected: ไม่มี error (Phase 4 ครอบคลุมหมด)

- [ ] **Step 4: Run full test suite**

```bash
cd apps/api && npx jest 2>&1 | tail -10
cd apps/web && npx jest 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications/
git commit -m "feat(notifications): require explicit channelKey for LINE

Removes BC default — every call site must specify the OA explicitly."
```

---

### Task 27: Final verification + acceptance criteria

- [ ] **Step 1: Run full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors

- [ ] **Step 2: Run full test suite**

```bash
./tools/run-tests.sh --skip-e2e
```

Expected: All pass

- [ ] **Step 3: Run E2E smoke**

```bash
cd apps/web && npx playwright test e2e/login.spec.ts e2e/page-health-check.spec.ts
```

Expected: Pass

- [ ] **Step 4: Verify acceptance criteria from spec**

Walk through each item in spec §10:
- [ ] Schema migrated, no orphan `lineId` references — `grep -rn "customer\.lineId[^F^S]" apps/` returns 0
- [ ] All 4 integrations have credentials (manual check via UI)
- [ ] Test message sent via 3 LINE OAs (Task 25 step 5)
- [ ] SMS DLR received in NotificationLog (Task 25 step 5)
- [ ] Cron payment-reminder dry-run shows 0 LINE failures (run via prod admin trigger or wait 24hr observe)
- [ ] /notifications page shows per-channel breakdown
- [ ] SMS credit visible in IntegrationHubPage
- [ ] Sender ID approved at ThaiBulkSMS
- [ ] 2 runbooks committed
- [ ] Type check + test suite pass

- [ ] **Step 5: Update memory**

Save project memory after merge:
- Path: `/Users/iamnaii/.claude/projects/-Users-iamnaii-Desktop-App-BESTCHOICE/memory/project_notifications_p1_shipped.md`
- Index entry: `[Project: Notifications P1 shipped](project_notifications_p1_shipped.md) — operational readiness — multi-OA routing + per-channel obs + runbooks shipped <date>`

---

## Self-Review Notes

**Spec coverage:**
- ✅ Schema rename + add → Task 1
- ✅ Routing logic explicit channelKey → Tasks 2-9
- ✅ 21 files / 58 call sites updated → Tasks 7-15
- ✅ Per-channel stats → Task 18
- ✅ SMS credit alert → Task 19
- ✅ Sender ID submission → Task 24
- ✅ Setup steps → Task 25
- ✅ Runbooks → Tasks 22, 23
- ✅ Acceptance criteria → Task 27
- ✅ Backfill (assume current = finance) → Task 1 step 3 SQL note
- ✅ Default → forced explicit → Task 26

**Type consistency:** All tasks use `LineChannelKey` from `notifications/dto/create-notification.dto.ts`. Method signatures consistent: `(recipient, message, channelKey)` for `sendLine`, `(recipient, flex, channelKey)` for `sendLineFlexMessage`.

**Risk mitigation:**
- Task 4 default `'line-finance'` ensures BC during Phase 4 mass update
- Task 26 removes default only after all call sites updated (Phase 4 must be complete)
- Task 16 verifies no remaining `customer.lineId` (without Finance/Shop suffix)

**Estimated effort:** 7 days
- Day 1: Tasks 1-4 (schema + service core)
- Day 2: Tasks 5-9 (LIFF write side + service refactor)
- Day 3-4: Tasks 10-16 (call site batch updates)
- Day 4-5: Tasks 17-19 (UI + observability)
- Day 5-6: Tasks 20-23 (tests + runbooks)
- Day 6-7: Tasks 24-27 (prod setup + cleanup)

Sender ID submission (Task 24) start day 1 in parallel — has 3-7 day external lead time.
