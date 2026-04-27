# Promise-to-Pay Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ "นัดชำระ" (Promise to Pay) เป็น first-class concept — มี lifecycle ชัด (active/kept/broken/superseded/canceled), 1 รอบนัดมีหลาย "ที่" (slots), ลิงก์งวดผ่อน (FIFO + override), MDM auto-lock เมื่อผิดนัดหรือโทรไม่ติด

**Architecture:** เพิ่ม fields บน CallLog (lifecycle + cycle), สร้าง PromiseSlot table แยก (multi-slot), refactor logic เข้า PromiseService, แทน broken-promise.cron ด้วย promise-resolution.cron, เพิ่ม no-promise-lock.cron, hook PaymentService สำหรับ real-time kept detection, redesign ContactLogDialog UI

**Tech Stack:** NestJS, Prisma (PostgreSQL), React, TanStack Query, BullMQ cron, MDM PJ-Soft API, LINE Messaging API

**Spec:** [docs/superpowers/specs/2026-04-27-promise-to-pay-lifecycle-design.md](../specs/2026-04-27-promise-to-pay-lifecycle-design.md)

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/api/src/modules/overdue/promise.service.ts` | Promise lifecycle core: find active, create with supersede, calculate cycle deadline, slot CRUD |
| `apps/api/src/modules/overdue/promise.service.spec.ts` | Unit tests for promise.service |
| `apps/api/src/modules/overdue/crons/promise-resolution.cron.ts` | Hourly cron: resolve slots → kept/broken; replaces broken-promise.cron |
| `apps/api/src/modules/overdue/crons/promise-resolution.cron.spec.ts` | Tests for promise-resolution cron |
| `apps/api/src/modules/overdue/crons/no-promise-lock.cron.ts` | Hourly cron: 2-NO_ANSWER + no active promise → MDM auto-lock |
| `apps/api/src/modules/overdue/crons/no-promise-lock.cron.spec.ts` | Tests for no-promise-lock cron |
| `apps/api/src/modules/overdue/installment-allocator.util.ts` | FIFO allocation helper: outstanding installments → target IDs |
| `apps/api/src/modules/overdue/installment-allocator.util.spec.ts` | Tests for FIFO allocator |
| `apps/api/scripts/backfill-promise-slots.ts` | Migrate existing CallLog (settlement* fields) → PromiseSlot rows |
| `apps/web/src/pages/CollectionsPage/components/SupersedePromiseConfirmDialog.tsx` | Confirm dialog when active promise exists before saving new |
| `apps/web/src/pages/CollectionsPage/components/InstallmentPickerPopover.tsx` | Popover to select target installments (override FIFO) |
| `apps/web/src/pages/CollectionsPage/hooks/usePromiseSlots.ts` | useState helper for managing N slots in ContactLogDialog |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add lifecycle fields to CallLog, add PromiseSlot model, add keptPromiseCount to Contract |
| `apps/api/src/modules/overdue/overdue.module.ts` | Register PromiseService, new crons |
| `apps/api/src/modules/overdue/overdue.service.ts` | Refactor promise creation to delegate to PromiseService |
| `apps/api/src/modules/overdue/dto/contact-log.dto.ts` | Replace `secondSettlementDate/Amount` with `slots: PromiseSlotDto[]`, add `targetInstallmentIds?` |
| `apps/api/src/modules/payments/payments.service.ts` | Hook real-time kept detection after Payment.create |
| `apps/api/src/modules/overdue/crons/broken-promise.cron.ts` | DELETE (replaced by promise-resolution) |
| `apps/api/src/modules/overdue/crons/mdm-auto-propose.cron.ts` | Add fast-path: skip propose, direct lock when slot.brokenAt set |
| `apps/api/src/modules/overdue/mdm-lock.service.ts` | Add `autoLock(contractId, reason)` + `autoUnlock(contractId)` methods |
| `apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx` | Replace 2-slot split toggle with N-slot manager, cycle deadline banner, install picker integration |
| `apps/web/src/pages/CollectionsPage/components/ContactLogDialog.test.tsx` | Update tests for new N-slot UI |
| `apps/web/src/pages/CollectionsPage/hooks/useContactLog.ts` | Update mutation payload to send `slots[]` instead of `settlementDate/Amount` + `secondSettlementDate/Amount` |
| `apps/web/src/pages/CollectionsPage/tabs/PromiseTab.tsx` | Add cycle view: countdown to cycleDeadline, slot grid (kept/broken/pending) |
| `apps/web/src/pages/CollectionsPage/components/ContractCard.tsx` | Show supersede banner + cycle slot count |

---

## Phase 1 — Schema Foundation

## Task 1: Add lifecycle fields to CallLog

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (CallLog model around line 1820)

- [ ] **Step 1: Add fields to CallLog**

Locate `model CallLog` in schema.prisma. Add the following fields **after** existing `brokenAt`:

```prisma
  /// Promise lifecycle (P2P redesign 2026-04-27)
  supersededAt           DateTime? @map("superseded_at")
  supersededByCallLogId  String?   @map("superseded_by_call_log_id")
  rescheduleCount        Int       @default(0) @map("reschedule_count")
  keptAt                 DateTime? @map("kept_at")
  canceledAt             DateTime? @map("canceled_at")
  canceledReason         String?   @map("canceled_reason")

  /// Promise cycle (1 รอบนัด)
  cycleStartedAt         DateTime? @map("cycle_started_at")
  cycleDeadline          DateTime? @map("cycle_deadline")

  /// Installment mapping — UUID[] of installments this promise covers
  targetInstallmentIds   String[]  @default([]) @map("target_installment_ids")

  /// Self-relation: supersede chain
  supersededBy           CallLog?  @relation("PromiseSupersedeChain", fields: [supersededByCallLogId], references: [id], onDelete: SetNull)
  supersedes             CallLog[] @relation("PromiseSupersedeChain")

  /// PromiseSlot relation — replaces secondSettlementDate/Amount
  slots                  PromiseSlot[]
```

Locate the existing `@@index([result, settlementDate, brokenAt])` line and replace with:

```prisma
  @@index([result, settlementDate, brokenAt, supersededAt, keptAt, canceledAt])
  @@index([cycleStartedAt, cycleDeadline])
  @@index([supersededByCallLogId])
```

- [ ] **Step 2: Mark legacy fields as deprecated (do NOT remove yet)**

Add comment ABOVE existing `secondSettlementDate` and `secondSettlementAmount`:

```prisma
  /// @deprecated 2026-04-27 — replaced by PromiseSlot. Keep for backward compat until backfill+cutover (Task 31).
  secondSettlementDate             DateTime?          @map("second_settlement_date")
  /// @deprecated 2026-04-27 — replaced by PromiseSlot.
  secondSettlementAmount           Decimal?           @map("second_settlement_amount") @db.Decimal(12, 2)
```

- [ ] **Step 3: Verify schema parses**

```bash
cd apps/api && npx prisma format
```

Expected: no errors. File reformatted.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat(schema): add promise lifecycle fields to CallLog"
```

---

## Task 2: Add PromiseSlot model

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add PromiseSlot model**

Add the following BELOW the `CallLog` model:

```prisma
/// "ที่" (slot) ภายใน 1 รอบนัด — supports unlimited slots per CallLog promise.
/// Replaces legacy secondSettlementDate/Amount on CallLog.
model PromiseSlot {
  id                String    @id @default(uuid())
  callLogId         String    @map("call_log_id")
  callLog           CallLog   @relation(fields: [callLogId], references: [id], onDelete: Cascade)

  slotIndex         Int       @map("slot_index")
  settlementDate    DateTime  @map("settlement_date")
  settlementAmount  Decimal   @map("settlement_amount") @db.Decimal(12, 2)

  paidAmount        Decimal   @default(0) @map("paid_amount") @db.Decimal(12, 2)
  keptAt            DateTime? @map("kept_at")
  brokenAt          DateTime? @map("broken_at")
  lockedAt          DateTime? @map("locked_at")

  notes             String?

  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  @@unique([callLogId, slotIndex])
  @@index([callLogId, settlementDate])
  @@index([keptAt, brokenAt])
  @@map("promise_slots")
}
```

- [ ] **Step 2: Format + verify**

```bash
cd apps/api && npx prisma format && npx prisma validate
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat(schema): add PromiseSlot model for multi-slot promises"
```

---

## Task 3: Add keptPromiseCount to Contract

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Contract model)

- [ ] **Step 1: Add field**

Locate `brokenPromiseCount` in Contract model. Add directly below:

```prisma
  keptPromiseCount   Int     @default(0) @map("kept_promise_count")
```

- [ ] **Step 2: Format + commit**

```bash
cd apps/api && npx prisma format
git add apps/api/prisma/schema.prisma
git commit -m "feat(schema): add keptPromiseCount to Contract"
```

---

## Task 4: Generate + apply migration

**Files:**
- Auto-generated: `apps/api/prisma/migrations/<timestamp>_add_promise_lifecycle/migration.sql`

- [ ] **Step 1: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name add_promise_lifecycle
```

Expected: Prisma creates migration file, applies to dev DB, regenerates client.

- [ ] **Step 2: Inspect generated SQL**

Open the generated `migration.sql`. Verify it contains:
- `ALTER TABLE "call_logs" ADD COLUMN "superseded_at" TIMESTAMP(3)`
- `ALTER TABLE "call_logs" ADD COLUMN "reschedule_count" INTEGER NOT NULL DEFAULT 0`
- `ALTER TABLE "call_logs" ADD COLUMN "target_installment_ids" TEXT[] DEFAULT ARRAY[]::TEXT[]`
- `ALTER TABLE "contracts" ADD COLUMN "kept_promise_count" INTEGER NOT NULL DEFAULT 0`
- `CREATE TABLE "promise_slots" (...)`
- New indexes

If SQL has DROP COLUMN for `second_settlement_*`, **abort** and re-check Task 1 step 2 (deprecated comments only, no removal).

- [ ] **Step 3: Verify type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors. Prisma client regenerated includes new fields.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/migrations/
git commit -m "feat(db): migration for promise lifecycle schema"
```

---

## Phase 2 — Backend Service Layer

## Task 5: Create installment-allocator utility

**Files:**
- Create: `apps/api/src/modules/overdue/installment-allocator.util.ts`
- Create: `apps/api/src/modules/overdue/installment-allocator.util.spec.ts`

- [ ] **Step 1: Write failing test**

Create `installment-allocator.util.spec.ts`:

```typescript
import { Decimal } from '@prisma/client/runtime/library';
import { allocateFifo } from './installment-allocator.util';

describe('allocateFifo', () => {
  it('fills oldest installments first within target amount', () => {
    const installments = [
      { id: 'i1', dueDate: new Date('2026-03-01'), remainingAmount: new Decimal(4000) },
      { id: 'i2', dueDate: new Date('2026-04-01'), remainingAmount: new Decimal(4000) },
      { id: 'i3', dueDate: new Date('2026-05-01'), remainingAmount: new Decimal(4000) },
    ];
    expect(allocateFifo(installments, new Decimal(5000))).toEqual(['i1', 'i2']);
  });

  it('returns single installment when target fits in oldest', () => {
    const installments = [
      { id: 'i1', dueDate: new Date('2026-03-01'), remainingAmount: new Decimal(4000) },
      { id: 'i2', dueDate: new Date('2026-04-01'), remainingAmount: new Decimal(4000) },
    ];
    expect(allocateFifo(installments, new Decimal(3000))).toEqual(['i1']);
  });

  it('handles empty list', () => {
    expect(allocateFifo([], new Decimal(1000))).toEqual([]);
  });

  it('returns all when target exceeds total', () => {
    const installments = [
      { id: 'i1', dueDate: new Date('2026-03-01'), remainingAmount: new Decimal(4000) },
      { id: 'i2', dueDate: new Date('2026-04-01'), remainingAmount: new Decimal(4000) },
    ];
    expect(allocateFifo(installments, new Decimal(99999))).toEqual(['i1', 'i2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest installment-allocator.util.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `installment-allocator.util.ts`:

```typescript
import { Decimal } from '@prisma/client/runtime/library';

export interface InstallmentSlice {
  id: string;
  dueDate: Date;
  remainingAmount: Decimal;
}

/**
 * FIFO greedy: fill oldest installment first until accumulated remaining
 * amount >= target. Returns ordered installment IDs covered (partial coverage
 * of last one is included — UI surfaces the partial).
 */
export function allocateFifo(installments: InstallmentSlice[], target: Decimal): string[] {
  const sorted = [...installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const result: string[] = [];
  let acc = new Decimal(0);
  for (const i of sorted) {
    if (acc.gte(target)) break;
    result.push(i.id);
    acc = acc.add(i.remainingAmount);
  }
  return result;
}
```

- [ ] **Step 4: Verify pass**

```bash
cd apps/api && npx jest installment-allocator.util.spec.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/installment-allocator.util.*
git commit -m "feat(overdue): FIFO installment allocator utility"
```

---

## Task 6: Create PromiseService skeleton + cycleDeadline calculator

**Files:**
- Create: `apps/api/src/modules/overdue/promise.service.ts`
- Create: `apps/api/src/modules/overdue/promise.service.spec.ts`

- [ ] **Step 1: Write failing test for cycleDeadline**

Create `promise.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PromiseService } from './promise.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PromiseService.calcCycleDeadline', () => {
  let service: PromiseService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { installment: { findMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [
        PromiseService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PromiseService);
  });

  it('returns the next future installment dueDate', async () => {
    const today = new Date('2026-04-27');
    prisma.installment.findMany.mockResolvedValue([
      { dueDate: new Date('2026-03-01') }, // past
      { dueDate: new Date('2026-05-01') }, // future, nearest
      { dueDate: new Date('2026-06-01') },
    ]);
    const deadline = await service.calcCycleDeadline('contract-1', today);
    expect(deadline.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('falls back to last day of next calendar month when all installments overdue', async () => {
    const today = new Date('2026-04-27');
    prisma.installment.findMany.mockResolvedValue([
      { dueDate: new Date('2026-01-01') },
      { dueDate: new Date('2026-02-01') },
    ]);
    const deadline = await service.calcCycleDeadline('contract-1', today);
    // last day of May 2026 = 2026-05-31
    expect(deadline.toISOString().slice(0, 10)).toBe('2026-05-31');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest promise.service.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement skeleton**

Create `promise.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PromiseService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cycle deadline = next installment dueDate > now, else last day of next calendar month.
   * Spec section 2.1.
   */
  async calcCycleDeadline(contractId: string, now: Date = new Date()): Promise<Date> {
    const installments = await this.prisma.installment.findMany({
      where: { contractId, deletedAt: null },
      select: { dueDate: true },
    });

    const future = installments
      .map((i) => i.dueDate)
      .filter((d) => d.getTime() > now.getTime())
      .sort((a, b) => a.getTime() - b.getTime());

    if (future.length > 0) return future[0];

    // Fallback: last day of next calendar month
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    nextMonth.setHours(23, 59, 59, 999);
    return nextMonth;
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
cd apps/api && npx jest promise.service.spec.ts
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/promise.service.*
git commit -m "feat(overdue): PromiseService skeleton + cycleDeadline calculator"
```

---

## Task 7: PromiseService.findActivePromise

**Files:**
- Modify: `apps/api/src/modules/overdue/promise.service.ts`
- Modify: `apps/api/src/modules/overdue/promise.service.spec.ts`

- [ ] **Step 1: Add failing test**

Append to `promise.service.spec.ts`:

```typescript
describe('PromiseService.findActivePromise', () => {
  let service: PromiseService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { callLog: { findFirst: jest.fn() }, installment: { findMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [PromiseService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(PromiseService);
  });

  it('queries with the canonical active filter', async () => {
    prisma.callLog.findFirst.mockResolvedValue(null);
    await service.findActivePromise('contract-1');

    const where = prisma.callLog.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      contractId: 'contract-1',
      result: 'PROMISED',
      brokenAt: null,
      supersededAt: null,
      keptAt: null,
      canceledAt: null,
    });
  });

  it('includes slots ordered by slotIndex', async () => {
    prisma.callLog.findFirst.mockResolvedValue(null);
    await service.findActivePromise('contract-1');

    const args = prisma.callLog.findFirst.mock.calls[0][0];
    expect(args.include.slots).toMatchObject({
      orderBy: { slotIndex: 'asc' },
    });
  });
});
```

- [ ] **Step 2: Run + verify fail**

```bash
cd apps/api && npx jest promise.service.spec.ts -t findActivePromise
```

Expected: FAIL — `findActivePromise is not a function`.

- [ ] **Step 3: Implement**

In `promise.service.ts`, add method:

```typescript
async findActivePromise(contractId: string) {
  return this.prisma.callLog.findFirst({
    where: {
      contractId,
      result: 'PROMISED',
      brokenAt: null,
      supersededAt: null,
      keptAt: null,
      canceledAt: null,
    },
    include: {
      slots: {
        orderBy: { slotIndex: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}
```

- [ ] **Step 4: Verify pass**

```bash
cd apps/api && npx jest promise.service.spec.ts
```

Expected: ALL pass (4/4).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/promise.service.*
git commit -m "feat(overdue): PromiseService.findActivePromise with canonical filter"
```

---

## Task 8: PromiseService.createPromise with supersede + reschedule penalty

**Files:**
- Modify: `apps/api/src/modules/overdue/promise.service.ts`
- Modify: `apps/api/src/modules/overdue/promise.service.spec.ts`

- [ ] **Step 1: Write failing tests for 3 reschedule scenarios**

Append to `promise.service.spec.ts`:

```typescript
describe('PromiseService.createPromise (supersede + reschedule)', () => {
  let service: PromiseService;
  let prisma: any;

  beforeEach(async () => {
    const tx: any = {
      callLog: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'new-cl' }),
      },
      contract: { update: jest.fn().mockResolvedValue({}) },
      promiseSlot: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      callLog: {
        findFirst: jest.fn(),
      },
      installment: { findMany: jest.fn().mockResolvedValue([]) },
      __tx: tx,
    };
    const module = await Test.createTestingModule({
      providers: [PromiseService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(PromiseService);
  });

  it('first promise (no active) — rescheduleCount=0, no broken increment', async () => {
    prisma.callLog.findFirst.mockResolvedValue(null);

    await service.createPromise({
      contractId: 'c-1',
      userId: 'u-1',
      slots: [{ settlementDate: new Date('2026-05-05'), settlementAmount: 1000 }],
      targetInstallmentIds: ['i-1'],
      notes: 'x',
    });

    const createCall = prisma.__tx.callLog.create.mock.calls[0][0];
    expect(createCall.data.rescheduleCount).toBe(0);
    expect(prisma.__tx.contract.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokenPromiseCount: { increment: 1 } }) }),
    );
  });

  it('reschedule before due (1st time) — supersede old, no broken count', async () => {
    prisma.callLog.findFirst.mockResolvedValue({
      id: 'old-cl',
      contractId: 'c-1',
      cycleStartedAt: new Date('2026-04-01'),
      cycleDeadline: new Date('2026-05-31'),
      rescheduleCount: 0,
      slots: [{ settlementDate: new Date('2026-05-10') }], // future
    });

    await service.createPromise({
      contractId: 'c-1',
      userId: 'u-1',
      slots: [{ settlementDate: new Date('2026-05-15'), settlementAmount: 1000 }],
      targetInstallmentIds: ['i-1'],
    });

    const updateCall = prisma.__tx.callLog.update.mock.calls.find(
      (c: any) => c[0].where.id === 'old-cl',
    );
    expect(updateCall[0].data.supersededAt).toBeInstanceOf(Date);
    expect(updateCall[0].data.brokenAt).toBeUndefined();
    expect(prisma.__tx.contract.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ brokenPromiseCount: { increment: 1 } }) }),
    );
  });

  it('reschedule before due (2nd time) — supersede + broken increment', async () => {
    prisma.callLog.findFirst.mockResolvedValue({
      id: 'old-cl',
      contractId: 'c-1',
      cycleStartedAt: new Date('2026-04-01'),
      cycleDeadline: new Date('2026-05-31'),
      rescheduleCount: 1, // already rescheduled once
      slots: [{ settlementDate: new Date('2026-05-10') }], // future
    });

    await service.createPromise({
      contractId: 'c-1',
      userId: 'u-1',
      slots: [{ settlementDate: new Date('2026-05-15'), settlementAmount: 1000 }],
      targetInstallmentIds: ['i-1'],
    });

    const updateCall = prisma.__tx.callLog.update.mock.calls.find(
      (c: any) => c[0].where.id === 'old-cl',
    );
    expect(updateCall[0].data.brokenAt).toBeInstanceOf(Date);
    expect(prisma.__tx.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1' },
        data: { brokenPromiseCount: { increment: 1 } },
      }),
    );
  });

  it('reschedule after due (any time) — supersede + broken increment', async () => {
    prisma.callLog.findFirst.mockResolvedValue({
      id: 'old-cl',
      contractId: 'c-1',
      cycleStartedAt: new Date('2026-04-01'),
      cycleDeadline: new Date('2026-05-31'),
      rescheduleCount: 0, // first reschedule but past due
      slots: [{ settlementDate: new Date('2026-04-10') }], // PAST
    });

    await service.createPromise({
      contractId: 'c-1',
      userId: 'u-1',
      slots: [{ settlementDate: new Date('2026-05-05'), settlementAmount: 1000 }],
      targetInstallmentIds: ['i-1'],
    });

    expect(prisma.__tx.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { brokenPromiseCount: { increment: 1 } },
      }),
    );
  });

  it('rejects slot.settlementDate > cycleDeadline', async () => {
    prisma.callLog.findFirst.mockResolvedValue({
      id: 'old-cl',
      cycleDeadline: new Date('2026-05-31'),
      rescheduleCount: 0,
      slots: [{ settlementDate: new Date('2026-05-10') }],
    });

    await expect(
      service.createPromise({
        contractId: 'c-1',
        userId: 'u-1',
        slots: [{ settlementDate: new Date('2026-06-15'), settlementAmount: 1000 }], // beyond deadline
        targetInstallmentIds: ['i-1'],
      }),
    ).rejects.toThrow(/cycleDeadline|เพดาน/);
  });
});
```

- [ ] **Step 2: Run + verify fail**

```bash
cd apps/api && npx jest promise.service.spec.ts -t createPromise
```

Expected: FAIL.

- [ ] **Step 3: Implement createPromise**

In `promise.service.ts`, add interfaces + method:

```typescript
import { BadRequestException } from '@nestjs/common';

export interface CreatePromiseSlotInput {
  settlementDate: Date;
  settlementAmount: number | string;
  notes?: string;
}

export interface CreatePromiseInput {
  contractId: string;
  userId: string;
  slots: CreatePromiseSlotInput[];
  targetInstallmentIds: string[];
  notes?: string;
}

async createPromise(input: CreatePromiseInput) {
  const now = new Date();

  return this.prisma.$transaction(async (tx) => {
    const oldPromise = await this.prisma.callLog.findFirst({
      where: {
        contractId: input.contractId,
        result: 'PROMISED',
        brokenAt: null,
        supersededAt: null,
        keptAt: null,
        canceledAt: null,
      },
      include: { slots: { orderBy: { slotIndex: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    let cycleStartedAt: Date;
    let cycleDeadline: Date;
    let rescheduleCount = 0;

    if (oldPromise) {
      cycleStartedAt = oldPromise.cycleStartedAt ?? now;
      cycleDeadline = oldPromise.cycleDeadline ?? (await this.calcCycleDeadline(input.contractId, now));
      rescheduleCount = oldPromise.rescheduleCount + 1;

      const oldHasPastDueSlot = oldPromise.slots.some((s) => s.settlementDate.getTime() < now.getTime());
      const shouldCountBroken = oldHasPastDueSlot || rescheduleCount >= 2;

      await tx.callLog.update({
        where: { id: oldPromise.id },
        data: {
          supersededAt: now,
          ...(shouldCountBroken ? { brokenAt: now } : {}),
        },
      });

      if (shouldCountBroken) {
        await tx.contract.update({
          where: { id: input.contractId },
          data: { brokenPromiseCount: { increment: 1 } },
        });
      }
    } else {
      cycleStartedAt = now;
      cycleDeadline = await this.calcCycleDeadline(input.contractId, now);
    }

    // Validate slots within deadline
    for (const slot of input.slots) {
      if (slot.settlementDate.getTime() > cycleDeadline.getTime()) {
        throw new BadRequestException(
          `วันที่นัดเกินเพดานรอบ (cycleDeadline = ${cycleDeadline.toISOString().slice(0, 10)})`,
        );
      }
    }

    // Compute primary settlementDate/Amount = first slot (legacy compat for old fields)
    const primary = [...input.slots].sort(
      (a, b) => a.settlementDate.getTime() - b.settlementDate.getTime(),
    )[0];

    const newPromise = await tx.callLog.create({
      data: {
        contractId: input.contractId,
        userId: input.userId,
        result: 'PROMISED',
        notes: input.notes,
        settlementDate: primary.settlementDate,
        settlementAmount: primary.settlementAmount as any,
        rescheduleCount,
        cycleStartedAt,
        cycleDeadline,
        targetInstallmentIds: input.targetInstallmentIds,
        ...(oldPromise ? { /* link added below */ } : {}),
      },
    });

    if (oldPromise) {
      await tx.callLog.update({
        where: { id: oldPromise.id },
        data: { supersededByCallLogId: newPromise.id },
      });
    }

    // Insert slots
    await tx.promiseSlot.createMany({
      data: input.slots
        .sort((a, b) => a.settlementDate.getTime() - b.settlementDate.getTime())
        .map((s, idx) => ({
          callLogId: newPromise.id,
          slotIndex: idx + 1,
          settlementDate: s.settlementDate,
          settlementAmount: s.settlementAmount as any,
          notes: s.notes,
        })),
    });

    return newPromise;
  });
}
```

- [ ] **Step 4: Verify pass**

```bash
cd apps/api && npx jest promise.service.spec.ts
```

Expected: ALL pass (8/8 cumulative).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/promise.service.*
git commit -m "feat(overdue): PromiseService.createPromise with supersede+reschedule"
```

---

## Task 9: Wire PromiseService into OverdueModule

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.module.ts`

- [ ] **Step 1: Read existing module**

```bash
grep -n "providers\|exports" apps/api/src/modules/overdue/overdue.module.ts
```

- [ ] **Step 2: Register PromiseService**

In `overdue.module.ts`:
- Add import: `import { PromiseService } from './promise.service';`
- Add to `providers` array: `PromiseService`
- Add to `exports` array: `PromiseService`

- [ ] **Step 3: Verify type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/overdue/overdue.module.ts
git commit -m "feat(overdue): register PromiseService in module"
```

---

## Task 10: Update ContactLog DTO for slot input

**Files:**
- Modify: `apps/api/src/modules/overdue/dto/contact-log.dto.ts`

- [ ] **Step 1: Read existing DTO**

```bash
cat apps/api/src/modules/overdue/dto/contact-log.dto.ts
```

Identify the existing `CreateContactLogDto` (or equivalent) with `settlementDate`, `settlementAmount`, `secondSettlementDate`, `secondSettlementAmount`.

- [ ] **Step 2: Add PromiseSlotDto + targetInstallmentIds**

Add these classes (and update the main DTO):

```typescript
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, ValidateNested, ArrayMinSize } from 'class-validator';

export class PromiseSlotDto {
  @IsDateString({}, { message: 'วันที่นัดต้องเป็นวันที่ที่ถูกต้อง' })
  settlementDate!: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'ยอดต้องเป็นตัวเลข' })
  settlementAmount!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

// Inside CreateContactLogDto, ADD:

@IsOptional()
@IsArray()
@ValidateNested({ each: true })
@Type(() => PromiseSlotDto)
@ArrayMinSize(1, { message: 'ต้องมีอย่างน้อย 1 ที่' })
slots?: PromiseSlotDto[];

@IsOptional()
@IsArray()
@IsUUID('4', { each: true })
targetInstallmentIds?: string[];
```

Keep `settlementDate`, `settlementAmount`, `secondSettlementDate`, `secondSettlementAmount` as `@IsOptional()` (deprecated, accepted for backward compat during cutover).

- [ ] **Step 3: Verify type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/overdue/dto/contact-log.dto.ts
git commit -m "feat(overdue): add slots[] + targetInstallmentIds to ContactLog DTO"
```

---

## Task 11: Refactor OverdueService.logContact to use PromiseService

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.service.ts`

- [ ] **Step 1: Locate logContact method**

```bash
grep -n "logContact\|PROMISED" apps/api/src/modules/overdue/overdue.service.ts | head -20
```

- [ ] **Step 2: Inject PromiseService**

In the OverdueService constructor, add:

```typescript
constructor(
  private prisma: PrismaService,
  private promiseService: PromiseService,
  // ... existing deps
) {}
```

Add import at top:
```typescript
import { PromiseService } from './promise.service';
```

- [ ] **Step 3: Branch on result === 'PROMISED'**

Inside `logContact`, locate where CallLog is created. Wrap in branching logic:

```typescript
if (dto.result === 'PROMISED') {
  // Build slots from either new dto.slots OR legacy single/dual settlement fields
  const slots = dto.slots && dto.slots.length > 0
    ? dto.slots.map((s) => ({
        settlementDate: new Date(s.settlementDate),
        settlementAmount: s.settlementAmount,
        notes: s.notes,
      }))
    : [
        ...(dto.settlementDate
          ? [{
              settlementDate: new Date(dto.settlementDate),
              settlementAmount: Number(dto.settlementAmount),
            }]
          : []),
        ...(dto.secondSettlementDate
          ? [{
              settlementDate: new Date(dto.secondSettlementDate),
              settlementAmount: Number(dto.secondSettlementAmount),
            }]
          : []),
      ];

  if (slots.length === 0) {
    throw new BadRequestException('ต้องระบุอย่างน้อย 1 ที่');
  }

  const targetInstallmentIds = dto.targetInstallmentIds && dto.targetInstallmentIds.length > 0
    ? dto.targetInstallmentIds
    : await this.computeFifoTargets(dto.contractId, slots.reduce((acc, s) => acc + Number(s.settlementAmount), 0));

  return this.promiseService.createPromise({
    contractId: dto.contractId,
    userId,
    slots,
    targetInstallmentIds,
    notes: dto.notes,
  });
}
// else: existing path for NO_ANSWER / UNREACHABLE / etc.
```

Add helper method `computeFifoTargets` to `OverdueService`:

```typescript
private async computeFifoTargets(contractId: string, targetAmount: number): Promise<string[]> {
  const installments = await this.prisma.installment.findMany({
    where: {
      contractId,
      deletedAt: null,
      paidAt: null,
    },
    select: {
      id: true,
      dueDate: true,
      remainingAmount: true,
    },
  });
  const { Decimal } = await import('@prisma/client/runtime/library');
  const { allocateFifo } = await import('./installment-allocator.util');
  return allocateFifo(
    installments.map((i) => ({
      id: i.id,
      dueDate: i.dueDate,
      remainingAmount: i.remainingAmount as any,
    })),
    new Decimal(targetAmount),
  );
}
```

NOTE: confirm `Installment` model field names — adjust `paidAt` / `remainingAmount` if codebase uses different names.

- [ ] **Step 4: Type check**

```bash
./tools/check-types.sh api
```

Expected: 0 errors. If `Installment.remainingAmount` doesn't exist, look for the correct field (e.g., `amount - paidAmount`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/overdue.service.ts
git commit -m "feat(overdue): route PROMISED contact logs through PromiseService"
```

---

## Phase 3 — Crons

## Task 12: Create promise-resolution.cron

**Files:**
- Create: `apps/api/src/modules/overdue/crons/promise-resolution.cron.ts`
- Create: `apps/api/src/modules/overdue/crons/promise-resolution.cron.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { Test } from '@nestjs/testing';
import { PromiseResolutionCron } from './promise-resolution.cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';

describe('PromiseResolutionCron', () => {
  let cron: PromiseResolutionCron;
  let prisma: any;
  let mdm: any;

  beforeEach(async () => {
    prisma = {
      callLog: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      promiseSlot: { update: jest.fn().mockResolvedValue({}) },
      contract: { update: jest.fn().mockResolvedValue({}) },
      payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };
    mdm = { autoLock: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        PromiseResolutionCron,
        { provide: PrismaService, useValue: prisma },
        { provide: MdmLockService, useValue: mdm },
      ],
    }).compile();
    cron = module.get(PromiseResolutionCron);
  });

  it('marks slot kept when paidAmount >= settlementAmount in window', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        slots: [
          {
            id: 's-1',
            slotIndex: 1,
            settlementDate: new Date(Date.now() - 2 * 86400 * 1000),
            settlementAmount: { toNumber: () => 1000 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      },
    ]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: { toNumber: () => 1500 } } });

    await cron.handleHourly();

    expect(prisma.promiseSlot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's-1' },
        data: expect.objectContaining({ keptAt: expect.any(Date) }),
      }),
    );
  });

  it('marks promise broken + triggers MDM lock when slot underpaid', async () => {
    prisma.callLog.findMany.mockResolvedValue([
      {
        id: 'cl-1',
        contractId: 'c-1',
        slots: [
          {
            id: 's-1',
            slotIndex: 1,
            settlementDate: new Date(Date.now() - 2 * 86400 * 1000),
            settlementAmount: { toNumber: () => 1000 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      },
    ]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: { toNumber: () => 500 } } });

    await cron.handleHourly();

    expect(prisma.promiseSlot.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ brokenAt: expect.any(Date) }),
      }),
    );
    expect(prisma.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cl-1' },
        data: expect.objectContaining({ brokenAt: expect.any(Date) }),
      }),
    );
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { brokenPromiseCount: { increment: 1 } },
      }),
    );
    expect(mdm.autoLock).toHaveBeenCalledWith('c-1', expect.stringContaining('SLOT_BROKEN'));
  });

  it('marks promise kept + increments keptPromiseCount when ALL slots kept', async () => {
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
            keptAt: new Date(),
            brokenAt: null,
          },
          {
            id: 's-2',
            slotIndex: 2,
            settlementDate: new Date(Date.now() - 2 * 86400 * 1000),
            settlementAmount: { toNumber: () => 500 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      },
    ]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: { toNumber: () => 600 } } });

    await cron.handleHourly();

    expect(prisma.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cl-1' },
        data: expect.objectContaining({ keptAt: expect.any(Date) }),
      }),
    );
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { keptPromiseCount: { increment: 1 } },
      }),
    );
  });
});
```

- [ ] **Step 2: Run + verify fail**

```bash
cd apps/api && npx jest promise-resolution.cron.spec.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement cron**

Create `promise-resolution.cron.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';

const GRACE_DAYS = 1;

@Injectable()
export class PromiseResolutionCron {
  private readonly logger = new Logger(PromiseResolutionCron.name);

  constructor(
    private prisma: PrismaService,
    private mdm: MdmLockService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - GRACE_DAYS * 86400 * 1000);

    // Active promises with at least one slot past grace
    const promises = await this.prisma.callLog.findMany({
      where: {
        result: 'PROMISED',
        brokenAt: null,
        supersededAt: null,
        keptAt: null,
        canceledAt: null,
        slots: { some: { settlementDate: { lt: cutoff }, keptAt: null, brokenAt: null } },
      },
      include: { slots: { orderBy: { slotIndex: 'asc' } } },
    });

    for (const p of promises) {
      try {
        await this.resolvePromise(p, now, cutoff);
      } catch (err) {
        this.logger.error(`failed to resolve promise ${p.id}`, err);
      }
    }
    this.logger.log(`resolved ${promises.length} promise(s)`);
  }

  private async resolvePromise(p: any, now: Date, cutoff: Date) {
    let allSlotsKept = true;
    let brokenSlot: any = null;

    for (const slot of p.slots) {
      if (slot.keptAt) continue; // already kept

      // Skip slots not yet past grace
      if (slot.settlementDate.getTime() >= cutoff.getTime()) {
        allSlotsKept = false;
        continue;
      }

      // Sum payments allocated to this slot's window
      const windowEnd = new Date(slot.settlementDate.getTime() + GRACE_DAYS * 86400 * 1000);
      const sum = await this.prisma.payment.aggregate({
        where: {
          contractId: p.contractId,
          deletedAt: null,
          createdAt: { lte: windowEnd },
        },
        _sum: { amount: true },
      });
      const paid = sum._sum.amount?.toNumber() ?? 0;
      const target = slot.settlementAmount.toNumber();

      if (paid >= target) {
        await this.prisma.promiseSlot.update({
          where: { id: slot.id },
          data: { keptAt: now, paidAmount: paid as any },
        });
      } else {
        brokenSlot = slot;
        allSlotsKept = false;
        await this.prisma.promiseSlot.update({
          where: { id: slot.id },
          data: { brokenAt: now, paidAmount: paid as any, lockedAt: now },
        });
        break; // first broken slot: stop, mark whole promise broken
      }
    }

    if (brokenSlot) {
      await this.prisma.callLog.update({
        where: { id: p.id },
        data: { brokenAt: now },
      });
      await this.prisma.contract.update({
        where: { id: p.contractId },
        data: { brokenPromiseCount: { increment: 1 } },
      });
      await this.mdm.autoLock(p.contractId, `SLOT_BROKEN:slot${brokenSlot.slotIndex}`);
    } else if (allSlotsKept) {
      await this.prisma.callLog.update({
        where: { id: p.id },
        data: { keptAt: now },
      });
      await this.prisma.contract.update({
        where: { id: p.contractId },
        data: { keptPromiseCount: { increment: 1 } },
      });
    }
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
cd apps/api && npx jest promise-resolution.cron.spec.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/crons/promise-resolution.cron.*
git commit -m "feat(overdue): promise-resolution cron resolves slots → kept/broken + MDM lock"
```

---

## Task 13: Add MdmLockService.autoLock + autoUnlock

**Files:**
- Modify: `apps/api/src/modules/overdue/mdm-lock.service.ts`

- [ ] **Step 1: Inspect existing service**

```bash
grep -n "lock\|propose\|approve" apps/api/src/modules/overdue/mdm-lock.service.ts | head -20
```

- [ ] **Step 2: Add autoLock + autoUnlock methods**

Append to MdmLockService class:

```typescript
/**
 * Auto-lock without approval (P2P spec section 3.5/5.6).
 * Triggered by promise-resolution cron + no-promise-lock cron.
 * Idempotent: skips if already locked.
 */
async autoLock(contractId: string, reason: string): Promise<void> {
  const contract = await this.prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, mdmLockedAt: true, primaryProductId: true },
  });
  if (!contract || contract.mdmLockedAt) return;

  // Issue lock command via MDM provider (existing helper)
  await this.lockDevice(contractId, reason);

  await this.prisma.contract.update({
    where: { id: contractId },
    data: { mdmLockedAt: new Date() },
  });

  await this.prisma.auditLog.create({
    data: {
      action: 'MDM_AUTO_LOCK',
      entityType: 'Contract',
      entityId: contractId,
      newValue: { reason },
    },
  });
}

/**
 * Auto-unlock when whole promise cycle is kept (spec section 5.4).
 */
async autoUnlock(contractId: string, reason: string): Promise<void> {
  const contract = await this.prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, mdmLockedAt: true },
  });
  if (!contract || !contract.mdmLockedAt) return;

  await this.unlockDevice(contractId, reason);

  await this.prisma.contract.update({
    where: { id: contractId },
    data: { mdmLockedAt: null },
  });

  await this.prisma.auditLog.create({
    data: {
      action: 'MDM_AUTO_UNLOCK',
      entityType: 'Contract',
      entityId: contractId,
      newValue: { reason },
    },
  });
}
```

NOTE: Adjust `lockDevice` / `unlockDevice` method names if existing service uses different names. The intent is to wrap whatever low-level API call already exists.

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/overdue/mdm-lock.service.ts
git commit -m "feat(overdue): MdmLockService.autoLock + autoUnlock"
```

---

## Task 14: Create no-promise-lock.cron

**Files:**
- Create: `apps/api/src/modules/overdue/crons/no-promise-lock.cron.ts`
- Create: `apps/api/src/modules/overdue/crons/no-promise-lock.cron.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { Test } from '@nestjs/testing';
import { NoPromiseLockCron } from './no-promise-lock.cron';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';

describe('NoPromiseLockCron', () => {
  let cron: NoPromiseLockCron;
  let prisma: any;
  let mdm: any;

  beforeEach(async () => {
    prisma = {
      contract: { findMany: jest.fn() },
      callLog: { findMany: jest.fn() },
    };
    mdm = { autoLock: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        NoPromiseLockCron,
        { provide: PrismaService, useValue: prisma },
        { provide: MdmLockService, useValue: mdm },
      ],
    }).compile();
    cron = module.get(NoPromiseLockCron);
  });

  it('locks when last 2 callLogs are NO_ANSWER/UNREACHABLE consecutively', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', mdmLockedAt: null },
    ]);
    prisma.callLog.findMany.mockResolvedValue([
      { id: 'cl-2', result: 'NO_ANSWER', createdAt: new Date('2026-04-26') },
      { id: 'cl-1', result: 'UNREACHABLE', createdAt: new Date('2026-04-25') },
    ]);

    await cron.handleHourly();

    expect(mdm.autoLock).toHaveBeenCalledWith('c-1', expect.stringContaining('NO_PROMISE'));
  });

  it('does NOT lock if only 1 NO_ANSWER (not consecutive)', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', mdmLockedAt: null },
    ]);
    prisma.callLog.findMany.mockResolvedValue([
      { id: 'cl-2', result: 'NO_ANSWER', createdAt: new Date('2026-04-26') },
      { id: 'cl-1', result: 'PROMISED', createdAt: new Date('2026-04-20') }, // breaks streak
    ]);

    await cron.handleHourly();

    expect(mdm.autoLock).not.toHaveBeenCalled();
  });

  it('skips already-locked contracts', async () => {
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', mdmLockedAt: new Date() },
    ]);

    await cron.handleHourly();

    expect(mdm.autoLock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run + verify fail**

```bash
cd apps/api && npx jest no-promise-lock.cron.spec.ts
```

- [ ] **Step 3: Implement**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { MdmLockService } from '../mdm-lock.service';

const NO_CONTACT_RESULTS = ['NO_ANSWER', 'UNREACHABLE'];

@Injectable()
export class NoPromiseLockCron {
  private readonly logger = new Logger(NoPromiseLockCron.name);

  constructor(
    private prisma: PrismaService,
    private mdm: MdmLockService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly() {
    // Candidates: contracts overdue >= 1 day, not currently locked, no active promise
    const candidates = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        mdmLockedAt: null,
        status: { in: ['OVERDUE', 'DEFAULT'] },
        callLogs: {
          none: {
            result: 'PROMISED',
            brokenAt: null,
            supersededAt: null,
            keptAt: null,
            canceledAt: null,
          },
        },
      },
      select: { id: true, mdmLockedAt: true },
    });

    let locked = 0;
    for (const c of candidates) {
      const last2 = await this.prisma.callLog.findMany({
        where: { contractId: c.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { id: true, result: true, createdAt: true },
      });

      if (last2.length === 2 && last2.every((cl) => NO_CONTACT_RESULTS.includes(cl.result))) {
        await this.mdm.autoLock(c.id, 'NO_PROMISE_2_NO_CONTACT');
        locked++;
      }
    }
    this.logger.log(`no-promise-lock: locked ${locked} contract(s)`);
  }
}
```

NOTE: confirm `Contract.status` enum has `OVERDUE`/`DEFAULT` values — adjust if different.

- [ ] **Step 4: Verify pass**

```bash
cd apps/api && npx jest no-promise-lock.cron.spec.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/overdue/crons/no-promise-lock.cron.*
git commit -m "feat(overdue): no-promise-lock cron for 2-NO_CONTACT auto-lock"
```

---

## Task 15: Register new crons + retire broken-promise.cron

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.module.ts`
- Delete: `apps/api/src/modules/overdue/crons/broken-promise.cron.ts`
- Delete: `apps/api/src/modules/overdue/crons/broken-promise.cron.spec.ts`

- [ ] **Step 1: Add new crons to module providers**

In `overdue.module.ts`:

```typescript
import { PromiseResolutionCron } from './crons/promise-resolution.cron';
import { NoPromiseLockCron } from './crons/no-promise-lock.cron';

@Module({
  // ...
  providers: [
    // ... existing
    PromiseResolutionCron,
    NoPromiseLockCron,
  ],
})
```

Remove the `BrokenPromiseCron` import and provider entry.

- [ ] **Step 2: Delete legacy cron**

```bash
rm apps/api/src/modules/overdue/crons/broken-promise.cron.ts
rm apps/api/src/modules/overdue/crons/broken-promise.cron.spec.ts
```

- [ ] **Step 3: Type check + run cron tests**

```bash
./tools/check-types.sh api
cd apps/api && npx jest crons/
```

Expected: 0 errors, all cron tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/overdue/overdue.module.ts apps/api/src/modules/overdue/crons/
git commit -m "refactor(overdue): retire broken-promise.cron, register P2P crons"
```

---

## Phase 4 — Real-time Hook (PaymentService)

## Task 16: PaymentService real-time kept detection

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts`
- Modify: `apps/api/src/modules/payments/payments.module.ts`

- [ ] **Step 1: Inject PromiseService + MdmLockService**

In `payments.service.ts`, add to constructor:

```typescript
constructor(
  private prisma: PrismaService,
  private promiseService: PromiseService,
  private mdmLockService: MdmLockService,
  // ... existing
) {}
```

Add imports:
```typescript
import { PromiseService } from '../overdue/promise.service';
import { MdmLockService } from '../overdue/mdm-lock.service';
```

In `payments.module.ts`, import OverdueModule (or whichever module exports PromiseService + MdmLockService):

```typescript
import { OverdueModule } from '../overdue/overdue.module';

@Module({
  imports: [..., OverdueModule],
  // ...
})
```

- [ ] **Step 2: Add hook method**

In `PaymentsService`, add private method:

```typescript
private async checkPromiseAfterPayment(contractId: string): Promise<void> {
  const active = await this.promiseService.findActivePromise(contractId);
  if (!active) return;

  const now = new Date();
  let allKept = true;

  for (const slot of active.slots) {
    if (slot.keptAt) continue;
    if (slot.brokenAt) {
      allKept = false;
      continue;
    }

    const windowEnd = new Date(slot.settlementDate.getTime() + 1 * 86400 * 1000);
    const sum = await this.prisma.payment.aggregate({
      where: {
        contractId,
        deletedAt: null,
        createdAt: { lte: windowEnd },
      },
      _sum: { amount: true },
    });
    const paid = (sum._sum.amount as any)?.toNumber?.() ?? 0;
    const target = (slot.settlementAmount as any).toNumber();

    if (paid >= target) {
      await this.prisma.promiseSlot.update({
        where: { id: slot.id },
        data: { keptAt: now, paidAmount: paid as any },
      });
    } else {
      allKept = false;
    }
  }

  if (allKept) {
    await this.prisma.callLog.update({
      where: { id: active.id },
      data: { keptAt: now },
    });
    await this.prisma.contract.update({
      where: { id: contractId },
      data: { keptPromiseCount: { increment: 1 } },
    });
    // Auto-unlock per spec 5.4
    await this.mdmLockService.autoUnlock(contractId, 'CYCLE_KEPT');
  }
}
```

- [ ] **Step 3: Call hook after payment.create**

In the existing `recordPayment` (or `create`) method, **after** the Payment row is created and committed, append:

```typescript
await this.checkPromiseAfterPayment(payment.contractId);
return payment;
```

If method is wrapped in a transaction, hook OUTSIDE the transaction (after commit) so MDM API call doesn't roll back the payment.

- [ ] **Step 4: Type check**

```bash
./tools/check-types.sh api
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payments/
git commit -m "feat(payments): real-time promise-kept detection + auto-unlock hook"
```

---

## Task 17: Test PaymentService kept hook

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.spec.ts` (or create if missing)

- [ ] **Step 1: Add test for kept-hook**

Append (or create file with):

```typescript
describe('PaymentsService.checkPromiseAfterPayment', () => {
  let service: PaymentsService;
  let prisma: any;
  let promiseService: any;
  let mdm: any;

  beforeEach(async () => {
    prisma = {
      payment: { aggregate: jest.fn() },
      promiseSlot: { update: jest.fn().mockResolvedValue({}) },
      callLog: { update: jest.fn().mockResolvedValue({}) },
      contract: { update: jest.fn().mockResolvedValue({}) },
    };
    promiseService = { findActivePromise: jest.fn() };
    mdm = { autoUnlock: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PromiseService, useValue: promiseService },
        { provide: MdmLockService, useValue: mdm },
        // ... other deps as needed (mock minimally)
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  it('marks all slots kept + auto-unlocks when full cycle paid', async () => {
    promiseService.findActivePromise.mockResolvedValue({
      id: 'cl-1',
      contractId: 'c-1',
      slots: [
        {
          id: 's-1',
          slotIndex: 1,
          settlementDate: new Date(Date.now() - 86400 * 1000),
          settlementAmount: { toNumber: () => 1000 },
          keptAt: null,
          brokenAt: null,
        },
      ],
    });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: { toNumber: () => 1500 } } });

    // @ts-expect-error access private for test
    await service.checkPromiseAfterPayment('c-1');

    expect(prisma.promiseSlot.update).toHaveBeenCalled();
    expect(prisma.callLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ keptAt: expect.any(Date) }) }),
    );
    expect(mdm.autoUnlock).toHaveBeenCalledWith('c-1', 'CYCLE_KEPT');
  });
});
```

- [ ] **Step 2: Run + pass**

```bash
cd apps/api && npx jest payments.service.spec.ts -t checkPromiseAfterPayment
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/payments/payments.service.spec.ts
git commit -m "test(payments): real-time promise-kept detection"
```

---

## Phase 5 — UI Layer

## Task 18: usePromiseSlots hook

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/hooks/usePromiseSlots.ts`

- [ ] **Step 1: Create hook**

```typescript
import { useState, useCallback } from 'react';

export interface PromiseSlot {
  id: string;          // local UUID for React key (not server-side)
  settlementDate: string; // YYYY-MM-DD
  settlementAmount: string; // number string
}

const newSlot = (): PromiseSlot => ({
  id: crypto.randomUUID(),
  settlementDate: '',
  settlementAmount: '',
});

export function usePromiseSlots(initial?: PromiseSlot[]) {
  const [slots, setSlots] = useState<PromiseSlot[]>(initial ?? [newSlot()]);

  const addSlot = useCallback(() => {
    setSlots((prev) => [...prev, newSlot()]);
  }, []);

  const removeSlot = useCallback((id: string) => {
    setSlots((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  }, []);

  const updateSlot = useCallback((id: string, patch: Partial<PromiseSlot>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const reset = useCallback((next?: PromiseSlot[]) => {
    setSlots(next ?? [newSlot()]);
  }, []);

  return { slots, addSlot, removeSlot, updateSlot, reset, setSlots };
}
```

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/CollectionsPage/hooks/usePromiseSlots.ts
git commit -m "feat(web): usePromiseSlots hook for N-slot management"
```

---

## Task 19: SupersedePromiseConfirmDialog

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/components/SupersedePromiseConfirmDialog.tsx`

- [ ] **Step 1: Create dialog**

```tsx
import { AlertTriangle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { formatNumber } from '@/utils/formatters';

interface OldPromise {
  settlementDate: string; // ISO
  settlementAmount: number;
  rescheduleCount: number;
}

interface Props {
  open: boolean;
  oldPromise: OldPromise | null;
  willCountBroken: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SupersedePromiseConfirmDialog({
  open,
  oldPromise,
  willCountBroken,
  onConfirm,
  onCancel,
}: Props) {
  if (!oldPromise) return null;

  const dateLabel = new Date(oldPromise.settlementDate).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <Modal isOpen={open} onClose={onCancel} title="ยืนยันการเลื่อนนัด" size="sm">
      <div className="space-y-4">
        <div className="rounded-xl bg-muted/40 px-4 py-3 leading-snug">
          <div className="text-sm text-muted-foreground">นัดเดิม</div>
          <div className="text-base font-semibold">
            {dateLabel} · {formatNumber(oldPromise.settlementAmount)} ฿
          </div>
        </div>

        {willCountBroken ? (
          <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4 flex items-start gap-2">
            <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm leading-snug">
              <div className="font-semibold text-destructive">นัดนี้จะถูกนับเป็นผิดนัด 1 ครั้ง</div>
              <div className="text-xs text-muted-foreground mt-1">
                {oldPromise.rescheduleCount >= 1
                  ? 'เลื่อนเกิน 1 ครั้งในรอบเดียวกัน'
                  : 'นัดเดิมเลยวันที่นัดผ่านมาแล้ว'}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm leading-snug">
            แจ้งล่วงหน้าก่อนถึงวันนัด — <span className="font-semibold">ไม่นับผิดนัด</span>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2 border-t border-border/40">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 text-base border border-input rounded-lg hover:bg-muted transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 text-base bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
          >
            ยืนยันเลื่อนนัด
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/CollectionsPage/components/SupersedePromiseConfirmDialog.tsx
git commit -m "feat(web): SupersedePromiseConfirmDialog for reschedule flow"
```

---

## Task 20: InstallmentPickerPopover

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/components/InstallmentPickerPopover.tsx`

- [ ] **Step 1: Create popover**

```tsx
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { formatNumber } from '@/utils/formatters';

export interface InstallmentOption {
  id: string;
  installmentNumber: number;
  dueDate: string; // ISO
  remainingAmount: number;
  daysOverdue: number;
}

interface Props {
  open: boolean;
  installments: InstallmentOption[];
  selectedIds: string[];
  onChange: (ids: string[], totalAmount: number) => void;
  onClose: () => void;
}

export default function InstallmentPickerPopover({
  open,
  installments,
  selectedIds,
  onChange,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<string[]>(selectedIds);

  if (!open) return null;

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function apply() {
    const total = installments
      .filter((i) => draft.includes(i.id))
      .reduce((acc, i) => acc + i.remainingAmount, 0);
    onChange(draft, total);
    onClose();
  }

  return (
    <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold leading-snug">เลือกงวดที่นัดจ่าย</div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted">
          <X className="size-4" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1">
        {installments.length === 0 && (
          <div className="text-sm text-muted-foreground leading-snug py-2">
            ไม่มีงวดที่ค้างอยู่
          </div>
        )}
        {installments.map((i) => {
          const selected = draft.includes(i.id);
          const dateLabel = new Date(i.dueDate).toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
          });
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => toggle(i.id)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                selected
                  ? 'border-primary bg-primary/10'
                  : 'border-input bg-card hover:bg-muted'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`size-4 rounded border flex items-center justify-center ${
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
                  }`}
                >
                  {selected && <Check className="size-3" />}
                </div>
                <div className="text-sm leading-snug">
                  <div className="font-medium">งวดที่ {i.installmentNumber} — {dateLabel}</div>
                  <div className="text-xs text-muted-foreground">
                    ค้าง {i.daysOverdue} วัน
                  </div>
                </div>
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {formatNumber(i.remainingAmount)} ฿
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 justify-end pt-3 mt-2 border-t border-border/40">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-muted"
        >
          ยกเลิก
        </button>
        <button
          onClick={apply}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90"
        >
          ใช้
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/CollectionsPage/components/InstallmentPickerPopover.tsx
git commit -m "feat(web): InstallmentPickerPopover for FIFO override"
```

---

## Task 21: ContactLogDialog redesign — N-slot manager

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx`
- Modify: `apps/web/src/pages/CollectionsPage/hooks/useContactLog.ts`

- [ ] **Step 1: Update useContactLog mutation payload**

In `useContactLog.ts`, change the mutation body to use `slots[]` + `targetInstallmentIds`:

```typescript
type ContactLogMutationPayload = {
  contractId: string;
  result: 'PROMISED' | 'NO_ANSWER' | 'UNREACHABLE';
  notes?: string;
  callResult?: string;
  negotiationResult?: string;
  slots?: Array<{
    settlementDate: string;
    settlementAmount: number;
    notes?: string;
  }>;
  targetInstallmentIds?: string[];
};
```

Remove `secondSettlementDate`/`secondSettlementAmount` from the payload type. Update the API call to send `slots[]`.

- [ ] **Step 2: Replace single-slot UI with N-slot manager**

In `ContactLogDialog.tsx`:

- Import `usePromiseSlots`, `SupersedePromiseConfirmDialog`, `InstallmentPickerPopover`.
- Replace `splitPayment`, `secondSettlementDate`, `settlementAmount` state with `usePromiseSlots()`.
- Replace the section between `{/* Settlement card */}` and the closing `</div>` (the entire split toggle block) with:

```tsx
{showSettlement && (
  <div className="space-y-4 rounded-xl border border-success/30 bg-success/5 p-4">
    {cycleDeadline && (
      <div className="rounded-lg bg-card border border-border px-3 py-2 text-sm leading-snug">
        เพดานรอบนัด: <span className="font-semibold tabular-nums">
          {new Date(cycleDeadline).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
        </span> {' '}— ทุก "ที่" ต้องไม่เกินวันนี้
      </div>
    )}

    {slots.map((slot, idx) => (
      <div key={slot.id} className="rounded-lg border border-border/60 bg-card p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold leading-snug">ที่ {idx + 1}</div>
          {slots.length > 1 && (
            <button
              type="button"
              onClick={() => removeSlot(slot.id)}
              className="text-xs text-destructive hover:underline"
            >
              ลบ
            </button>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            วันที่นัด <span className="text-destructive">*</span>
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {QUICK_DATE_OPTIONS.map((opt) => {
              const computed = opt.endOfMonth
                ? endOfThisMonth()
                : opt.offsetDays != null
                  ? dateOffset(opt.offsetDays)
                  : '';
              const active = slot.settlementDate === computed;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => updateSlot(slot.id, { settlementDate: computed })}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card border-input hover:bg-muted'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <input
            type="date"
            min={getTomorrow()}
            max={cycleDeadline ? cycleDeadline.slice(0, 10) : undefined}
            value={slot.settlementDate}
            onChange={(e) => updateSlot(slot.id, { settlementDate: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            ยอด <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              min={0.01}
              step="0.01"
              value={slot.settlementAmount}
              onChange={(e) => updateSlot(slot.id, { settlementAmount: e.target.value })}
              className="w-full px-3 py-2 pr-9 border border-input rounded-lg text-sm tabular-nums"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">฿</span>
          </div>
        </div>
      </div>
    ))}

    <button
      type="button"
      onClick={addSlot}
      className="w-full px-3 py-2 rounded-lg border-2 border-dashed border-border hover:bg-muted text-sm font-medium leading-snug"
    >
      + เพิ่ม "ที่"
    </button>

    {/* Installment picker — TODO Task 22 wires this in */}
  </div>
)}
```

Add state at top of component:
```tsx
const { slots, addSlot, removeSlot, updateSlot, reset: resetSlots } = usePromiseSlots();
const [supersedeConfirmOpen, setSupersedeConfirmOpen] = useState(false);
```

Update `handleSubmit` to:
1. Check if active promise exists (from existing `recentCallQuery` or new fetch)
2. If yes, open SupersedePromiseConfirmDialog first; only proceed when confirmed
3. Send `slots: slots.map(...)` instead of `settlementDate/Amount/secondSettlementDate/Amount`

Add cycleDeadline fetch — augment the dialog with a query:
```tsx
const cycleDeadlineQuery = useQuery({
  queryKey: ['contract-cycle-deadline', contract?.id],
  queryFn: async () => {
    const { data } = await api.get(`/overdue/contracts/${contract!.id}/cycle-deadline`);
    return data.cycleDeadline as string;
  },
  enabled: open && !!contract && outcome === 'WILL_PAY',
});
const cycleDeadline = cycleDeadlineQuery.data;
```

NOTE: this implies we need a new API endpoint `/overdue/contracts/:id/cycle-deadline`. Add this in Task 23.

Update `useEffect` reset block:
```tsx
useEffect(() => {
  if (open) {
    setOutcome(null);
    setNotes('');
    resetSlots([{ id: crypto.randomUUID(), settlementDate: '', settlementAmount: contract ? String(contract.outstanding) : '' }]);
    setSettlementNotes('');
    setEscalationReason('');
  }
}, [open, contract?.id, contract?.outstanding, resetSlots]);
```

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

Fix any errors related to removed `splitPayment`, `secondSettlementDate`, etc.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx apps/web/src/pages/CollectionsPage/hooks/useContactLog.ts
git commit -m "feat(web): ContactLogDialog N-slot manager + cycle deadline"
```

---

## Task 22: Wire InstallmentPicker into ContactLogDialog

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx`

- [ ] **Step 1: Add state + query for installments**

In ContactLogDialog, add:

```tsx
const [pickerOpen, setPickerOpen] = useState(false);
const [overrideMode, setOverrideMode] = useState(false);
const [targetInstallmentIds, setTargetInstallmentIds] = useState<string[]>([]);

const installmentsQuery = useQuery({
  queryKey: ['contract-overdue-installments', contract?.id],
  queryFn: async () => {
    const { data } = await api.get(`/overdue/contracts/${contract!.id}/overdue-installments`);
    return data as InstallmentOption[];
  },
  enabled: open && !!contract && outcome === 'WILL_PAY',
});
```

(NEW endpoint also added in Task 23.)

- [ ] **Step 2: Add picker UI in settlement card**

After the slot manager, before the addSlot button, add:

```tsx
<div className="relative">
  <button
    type="button"
    onClick={() => setPickerOpen((v) => !v)}
    className="text-sm text-primary hover:underline leading-snug"
  >
    {overrideMode
      ? `ครอบงวด ${targetInstallmentIds.length} งวด · แก้`
      : 'ครอบงวด: อัตโนมัติ (FIFO) · ระบุงวดเอง'}
  </button>
  {installmentsQuery.data && (
    <InstallmentPickerPopover
      open={pickerOpen}
      installments={installmentsQuery.data}
      selectedIds={targetInstallmentIds}
      onChange={(ids, total) => {
        setTargetInstallmentIds(ids);
        setOverrideMode(ids.length > 0);
        // Auto-fill first slot's amount if user wants
        if (slots.length === 1 && total > 0) {
          updateSlot(slots[0].id, { settlementAmount: String(total) });
        }
      }}
      onClose={() => setPickerOpen(false)}
    />
  )}
</div>
```

- [ ] **Step 3: Send targetInstallmentIds in mutation**

In `handleSubmit`, include:

```tsx
mutation.mutate({
  // ... existing
  slots: slots.map((s) => ({
    settlementDate: s.settlementDate,
    settlementAmount: Number(s.settlementAmount),
  })),
  targetInstallmentIds: overrideMode ? targetInstallmentIds : undefined,
});
```

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx
git commit -m "feat(web): InstallmentPicker wired into ContactLogDialog"
```

---

## Task 23: Add API endpoints — cycle-deadline + overdue-installments

**Files:**
- Modify: `apps/api/src/modules/overdue/overdue.controller.ts`
- Modify: `apps/api/src/modules/overdue/overdue.service.ts`

- [ ] **Step 1: Add controller endpoints**

In `overdue.controller.ts`:

```typescript
@Get('contracts/:id/cycle-deadline')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
async getCycleDeadline(@Param('id') id: string) {
  return this.overdueService.getCycleDeadline(id);
}

@Get('contracts/:id/overdue-installments')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
async getOverdueInstallments(@Param('id') id: string) {
  return this.overdueService.getOverdueInstallments(id);
}
```

- [ ] **Step 2: Add service methods**

In `overdue.service.ts`:

```typescript
async getCycleDeadline(contractId: string) {
  const active = await this.promiseService.findActivePromise(contractId);
  if (active?.cycleDeadline) {
    return { cycleDeadline: active.cycleDeadline.toISOString() };
  }
  const deadline = await this.promiseService.calcCycleDeadline(contractId);
  return { cycleDeadline: deadline.toISOString() };
}

async getOverdueInstallments(contractId: string) {
  const installments = await this.prisma.installment.findMany({
    where: { contractId, deletedAt: null, paidAt: null },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      installmentNumber: true,
      dueDate: true,
      remainingAmount: true,
    },
  });
  const now = Date.now();
  return installments.map((i) => ({
    id: i.id,
    installmentNumber: i.installmentNumber,
    dueDate: i.dueDate.toISOString(),
    remainingAmount: Number(i.remainingAmount),
    daysOverdue: Math.max(0, Math.floor((now - i.dueDate.getTime()) / 86400_000)),
  }));
}
```

NOTE: confirm `Installment` field names — use the same names as installment.service uses elsewhere.

- [ ] **Step 3: Type check + commit**

```bash
./tools/check-types.sh api
git add apps/api/src/modules/overdue/
git commit -m "feat(overdue): add cycle-deadline + overdue-installments endpoints"
```

---

## Task 24: PromiseTab cycle view

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/tabs/PromiseTab.tsx`

- [ ] **Step 1: Inspect existing tab**

```bash
cat apps/web/src/pages/CollectionsPage/tabs/PromiseTab.tsx
```

- [ ] **Step 2: Add slot grid + countdown**

For each promise card, add:

```tsx
{p.cycleDeadline && (
  <div className="text-xs text-muted-foreground leading-snug mb-1">
    เพดานรอบ: {new Date(p.cycleDeadline).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
    {' · '}
    เหลือ {Math.max(0, Math.ceil((new Date(p.cycleDeadline).getTime() - Date.now()) / 86400000))} วัน
  </div>
)}

{p.slots && p.slots.length > 0 && (
  <div className="flex gap-1 mt-2">
    {p.slots.map((s) => {
      const status = s.keptAt ? 'kept' : s.brokenAt ? 'broken' : 'pending';
      const tone = {
        kept: 'bg-success text-success-foreground',
        broken: 'bg-destructive text-destructive-foreground',
        pending: 'bg-muted text-muted-foreground',
      }[status];
      return (
        <div
          key={s.id}
          className={`px-2 py-0.5 rounded text-xs font-medium leading-snug ${tone}`}
          title={`ที่ ${s.slotIndex} — ${new Date(s.settlementDate).toLocaleDateString('th-TH')} · ${s.settlementAmount} ฿`}
        >
          ที่ {s.slotIndex}
        </div>
      );
    })}
  </div>
)}
```

API: ensure the existing PromiseTab query returns `slots` + `cycleDeadline`. If not, modify the API endpoint (likely `overdueController.listPromises` or similar) to `include: { slots: true }`.

- [ ] **Step 3: Type check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/pages/CollectionsPage/tabs/PromiseTab.tsx
git commit -m "feat(web): PromiseTab slot grid + cycle countdown"
```

---

## Phase 6 — Backfill + E2E

## Task 25: Backfill PromiseSlot rows from legacy CallLog

**Files:**
- Create: `apps/api/scripts/backfill-promise-slots.ts`

- [ ] **Step 1: Write script**

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const legacy = await prisma.callLog.findMany({
    where: {
      result: 'PROMISED',
      deletedAt: null,
      slots: { none: {} }, // not yet migrated
      settlementDate: { not: null },
    },
    select: {
      id: true,
      contractId: true,
      settlementDate: true,
      settlementAmount: true,
      secondSettlementDate: true,
      secondSettlementAmount: true,
      brokenAt: true,
      createdAt: true,
    },
  });

  console.log(`Found ${legacy.length} legacy promises to backfill`);

  for (const cl of legacy) {
    const slots: any[] = [];
    if (cl.settlementDate && cl.settlementAmount) {
      slots.push({
        callLogId: cl.id,
        slotIndex: 1,
        settlementDate: cl.settlementDate,
        settlementAmount: cl.settlementAmount,
        ...(cl.brokenAt ? { brokenAt: cl.brokenAt } : {}),
      });
    }
    if (cl.secondSettlementDate && cl.secondSettlementAmount) {
      slots.push({
        callLogId: cl.id,
        slotIndex: 2,
        settlementDate: cl.secondSettlementDate,
        settlementAmount: cl.secondSettlementAmount,
      });
    }

    if (slots.length === 0) continue;

    await prisma.promiseSlot.createMany({ data: slots });

    // Set cycleStartedAt = createdAt, cycleDeadline = max settlementDate (legacy fallback)
    const maxDate = slots.reduce(
      (max, s) => (s.settlementDate.getTime() > max.getTime() ? s.settlementDate : max),
      slots[0].settlementDate,
    );
    await prisma.callLog.update({
      where: { id: cl.id },
      data: {
        cycleStartedAt: cl.createdAt,
        cycleDeadline: maxDate,
      },
    });
  }

  console.log('Backfill complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add to package.json scripts**

In `apps/api/package.json` `scripts`:

```json
"backfill:promise-slots": "tsx scripts/backfill-promise-slots.ts"
```

- [ ] **Step 3: Run on dev DB**

```bash
cd apps/api && npm run backfill:promise-slots
```

Verify counts match expectation.

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/backfill-promise-slots.ts apps/api/package.json
git commit -m "feat(api): backfill script for PromiseSlot from legacy CallLog"
```

---

## Task 26: Backfill keptPromiseCount for historical promises

**Files:**
- Append to: `apps/api/scripts/backfill-promise-slots.ts` (or create new script)

- [ ] **Step 1: Append backfill block**

Inside `main()`, after slot backfill:

```typescript
// Backfill keptAt for promises where total payments in window covered settlementAmount
const candidatePromises = await prisma.callLog.findMany({
  where: {
    result: 'PROMISED',
    brokenAt: null,
    keptAt: null,
    supersededAt: null,
    canceledAt: null,
    settlementDate: { lt: new Date() },
  },
  select: { id: true, contractId: true, settlementDate: true, settlementAmount: true },
});

let backfilledKept = 0;
for (const p of candidatePromises) {
  if (!p.settlementDate || !p.settlementAmount) continue;
  const windowEnd = new Date(p.settlementDate.getTime() + 86400 * 1000);
  const sum = await prisma.payment.aggregate({
    where: { contractId: p.contractId, deletedAt: null, createdAt: { lte: windowEnd } },
    _sum: { amount: true },
  });
  const paid = sum._sum.amount?.toNumber() ?? 0;
  if (paid >= (p.settlementAmount as any).toNumber()) {
    await prisma.callLog.update({ where: { id: p.id }, data: { keptAt: windowEnd } });
    await prisma.contract.update({
      where: { id: p.contractId },
      data: { keptPromiseCount: { increment: 1 } },
    });
    backfilledKept++;
  }
}
console.log(`Backfilled ${backfilledKept} kept promise(s)`);
```

- [ ] **Step 2: Run + commit**

```bash
cd apps/api && npm run backfill:promise-slots
git add apps/api/scripts/backfill-promise-slots.ts
git commit -m "feat(api): backfill keptAt + keptPromiseCount for historical promises"
```

---

## Task 27: E2E — happy path (3 slots all kept)

**Files:**
- Create: `apps/web/e2e/promise-lifecycle-happy.spec.ts`

- [ ] **Step 1: Write E2E test**

```typescript
import { test, expect } from '@playwright/test';

test('promise with 3 slots — record + see cycle banner + slot count', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=email]', 'manager.ladprao@bestchoice.com');
  await page.fill('input[name=password]', 'admin1234');
  await page.click('button[type=submit]');

  await page.goto('/collections');
  await page.getByRole('button', { name: /บันทึกผล/i }).first().click();
  await page.getByText('นัดชำระ').click();

  // Slot 1
  await page.getByRole('button', { name: /อีก 3 วัน/ }).first().click();
  await page.locator('input[type=number]').first().fill('1000');

  // Add slot 2
  await page.getByRole('button', { name: /\+ เพิ่ม "ที่"/ }).click();
  await page.getByRole('button', { name: /อีก 7 วัน/ }).click();
  await page.locator('input[type=number]').nth(1).fill('1500');

  // Add slot 3
  await page.getByRole('button', { name: /\+ เพิ่ม "ที่"/ }).click();
  await page.getByRole('button', { name: /อีก 15 วัน/ }).click();
  await page.locator('input[type=number]').nth(2).fill('1500');

  await page.getByRole('button', { name: /^บันทึก$/ }).click();

  // Assert: dialog closed + cycle banner appears in PromiseTab
  await expect(page.getByText(/เพดานรอบ/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/ที่ 1.*ที่ 2.*ที่ 3/s)).toBeVisible();
});
```

- [ ] **Step 2: Run E2E**

```bash
cd apps/web && npx playwright test promise-lifecycle-happy.spec.ts
```

Expected: PASS (or document failure as a UI integration gap to fix).

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/promise-lifecycle-happy.spec.ts
git commit -m "test(e2e): promise 3-slot happy path"
```

---

## Task 28: E2E — supersede flow

**Files:**
- Create: `apps/web/e2e/promise-supersede.spec.ts`

- [ ] **Step 1: Write test**

```typescript
import { test, expect } from '@playwright/test';

test('reschedule before due — confirm dialog + no broken increment', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=email]', 'manager.ladprao@bestchoice.com');
  await page.fill('input[name=password]', 'admin1234');
  await page.click('button[type=submit]');

  await page.goto('/collections');

  // First promise
  await page.getByRole('button', { name: /บันทึกผล/i }).first().click();
  await page.getByText('นัดชำระ').click();
  await page.getByRole('button', { name: /อีก 3 วัน/ }).click();
  await page.locator('input[type=number]').first().fill('5000');
  await page.getByRole('button', { name: /^บันทึก$/ }).click();
  await page.waitForLoadState('networkidle');

  // Second promise (reschedule)
  await page.getByRole('button', { name: /บันทึกผล/i }).first().click();
  await page.getByText('นัดชำระ').click();
  await page.getByRole('button', { name: /อีก 7 วัน/ }).click();
  await page.locator('input[type=number]').first().fill('5000');
  await page.getByRole('button', { name: /^บันทึก$/ }).click();

  // Confirm dialog should appear
  await expect(page.getByRole('heading', { name: /ยืนยันการเลื่อนนัด/i })).toBeVisible();
  await expect(page.getByText(/ไม่นับผิดนัด/)).toBeVisible();
  await page.getByRole('button', { name: /ยืนยันเลื่อนนัด/i }).click();

  await expect(page.getByText(/ยืนยันการเลื่อนนัด/i)).not.toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd apps/web && npx playwright test promise-supersede.spec.ts
git add apps/web/e2e/promise-supersede.spec.ts
git commit -m "test(e2e): promise supersede confirm-dialog flow"
```

---

## Task 29: Final type check + full test suite

- [ ] **Step 1: Run all type checks**

```bash
./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 2: Run all unit tests**

```bash
cd apps/api && npx jest
cd apps/web && npm test
```

Expected: All pass. If any fails, fix the failing test in the relevant task and re-run.

- [ ] **Step 3: Run E2E suite**

```bash
cd apps/web && npx playwright test
```

Expected: All pass. Document any flaky failures as known issues.

- [ ] **Step 4: Commit any test fixes**

```bash
git add -A
git commit -m "test: stabilize after promise lifecycle changes"
```

---

## Task 30: Update CLAUDE.md hardening section

**Files:**
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 1: Append to "Hardening History" section**

Add a new "v5" section under existing v4:

```markdown
### v5 (2026-04-27 — Promise-to-Pay Lifecycle Redesign)
- **PromiseSlot model**: 1 promise → N "ที่" (slots) — replaces 2-slot split
- **Lifecycle fields on CallLog**: `supersededAt`, `keptAt`, `canceledAt`, `cycleStartedAt`, `cycleDeadline`, `rescheduleCount`, `targetInstallmentIds[]`
- **`Contract.keptPromiseCount`** new (counterpart to `brokenPromiseCount`)
- **`promise-resolution.cron`** replaces `broken-promise.cron` — resolves slots → kept/broken + auto-MDM-lock on broken
- **`no-promise-lock.cron`** new — 2 consecutive NO_ANSWER/UNREACHABLE + no active promise → MDM auto-lock
- **PaymentService real-time hook** — kept detection on Payment.create, auto-unlock when whole cycle kept
- **ContactLogDialog redesign** — N-slot manager, confirm dialog for supersede, installment picker (FIFO + override)
- **Reschedule rules** — before due 1st time = free, ≥2 = broken; after due = broken always
- **Grace 1 day** consistent across kept/broken decision
- **Backfill script** — legacy `secondSettlementDate/Amount` → PromiseSlot rows
```

- [ ] **Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: P2P lifecycle v5 hardening notes"
```

---

## Self-Review Checklist (run before handing off)

- [ ] Spec section 1 (goal) → covered by overall plan
- [ ] Spec 2.1 (1 รอบนัด) → Task 6 (cycleDeadline), Task 8 (createPromise inherits cycle), Task 21 (UI banner)
- [ ] Spec 2.2 (Promise→Installment mapping) → Task 5 (FIFO util), Task 11 (DTO/service wire), Task 20+22 (UI picker), Task 23 (overdue-installments endpoint)
- [ ] Spec 2.3 (state machine) → derived from fields; no enum needed; handled in queries (Task 7) + cron transitions (Task 12)
- [ ] Spec 3.1 (kept rule grace 1 day) → Task 12 (GRACE_DAYS const), Task 16 (window in payment hook)
- [ ] Spec 3.2 (active limit + confirm) → Task 7 (canonical query), Task 8 (supersede tx), Task 19 (UI dialog), Task 21 (handleSubmit gate)
- [ ] Spec 3.3 (reschedule penalty) → Task 8 (3 test cases match table)
- [ ] Spec 3.4 (cycle Q1-Q4) → Task 6+8 (deadline+inherit), Task 12 (slot grace+lock), spec 5.4 hook (Q3 unlock = Task 16), Task 8 cycleStartedAt (Q4)
- [ ] Spec 3.5 (no-promise auto-lock) → Task 14
- [ ] Spec 3.6 (multi-slot) → Task 2 (PromiseSlot model), Task 18-22 (UI)
- [ ] Spec 4 (schema) → Tasks 1-4
- [ ] Spec 5.1 (canonical query) → Task 7
- [ ] Spec 5.2 (resolution cron) → Task 12
- [ ] Spec 5.3 (no-promise-lock cron) → Task 14
- [ ] Spec 5.4 (real-time kept) → Task 16-17
- [ ] Spec 5.5 (supersede logic) → Task 8
- [ ] Spec 5.6 (MDM auto-lock) → Task 13
- [ ] Spec 6.1-6.4 (UI) → Tasks 19-24
- [ ] Spec 7 (migration phases) → Tasks 1-4 (Phase 1) + Tasks 25-26 (Phase 2 backfill) + Task 15 (Phase 3 cutover for cron) + Phase 4 cleanup deferred (call out in spec)
- [ ] Spec 8 (test plan) → unit in tasks 5-17; E2E in 27-28
- [ ] Spec 10 (acceptance criteria) — verify checklist after Task 29
