# Collections Guided Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a "guided session" workflow for `/collections` that turns daily debt collection into a 2-3 hour focused session with auto-assigned contracts, replacing free-form tabs as the default for SALES role while preserving the existing UI as Library mode.

**Architecture:** New `DailyAssignment` table + 4 background crons (auto-assign 06:00, auto-lock 09:00, pool-expiry */15min, summary 18:00) + new `collections-session` and `collections-manage` API modules + new frontend Session view (PreStart→Focus→Summary state machine) and Manager dashboard with drag-drop. Existing tabs preserved as "Library" mode behind a per-user toggle.

**Tech Stack:** NestJS + Prisma + PostgreSQL (backend), React + Vite + Tailwind + shadcn/ui + dnd-kit + react-query (frontend), `@nestjs/schedule` cron, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-04-26-collections-guided-session-design.md`

---

## File Structure

```
apps/api/
├── prisma/
│   └── schema.prisma                                              [modify]
├── src/modules/
│   ├── collections-session/                                       [new]
│   │   ├── collections-session.module.ts
│   │   ├── collections-session.controller.ts
│   │   ├── collections-session.service.ts
│   │   ├── collections-session.service.spec.ts
│   │   ├── auto-assign.service.ts
│   │   ├── auto-assign.service.spec.ts
│   │   ├── pool.service.ts
│   │   ├── pool.service.spec.ts
│   │   ├── collections-session.cron.ts
│   │   └── dto/
│   │       ├── action.dto.ts
│   │       ├── skip.dto.ts
│   │       └── claim.dto.ts
│   └── collections-manage/                                        [new]
│       ├── collections-manage.module.ts
│       ├── collections-manage.controller.ts
│       ├── collections-manage.service.ts
│       ├── collections-manage.service.spec.ts
│       └── dto/
│           ├── assign.dto.ts
│           └── transfer.dto.ts
├── src/app.module.ts                                              [modify]
└── src/modules/auth/dto/preferences.dto.ts                         [modify]

apps/web/src/pages/CollectionsPage/
├── index.tsx                                                       [modify]
├── session/                                                        [new]
│   ├── SessionView.tsx                  (state machine wrapper)
│   ├── PreStartScreen.tsx
│   ├── FocusMode.tsx
│   ├── FocusContractCard.tsx
│   ├── SessionTimer.tsx
│   ├── SessionProgress.tsx
│   ├── SkipReasonDialog.tsx
│   ├── SessionSummary.tsx
│   └── PoolBrowser.tsx
├── manage/                                                         [new]
│   ├── ManageDashboard.tsx
│   ├── CollectorColumn.tsx
│   ├── PoolColumn.tsx
│   ├── DraggableContractTile.tsx
│   ├── ManageHeaderActions.tsx
│   ├── TransferDialog.tsx
│   └── CloseSessionDialog.tsx
└── hooks/                                                          [new files]
    ├── useViewToggle.ts
    ├── useMySession.ts
    ├── useSessionActions.ts
    ├── usePool.ts
    └── useManagerBoard.ts

apps/web/src/App.tsx                                                [modify - add /collections/manage route]

apps/web/e2e/
└── collections-session.spec.ts                                    [new]
```

---

## Task 1: Prisma schema — DailyAssignment + User additions

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create migration via `npx prisma migrate dev`

- [ ] **Step 1: Add enums to schema.prisma**

Append to `apps/api/prisma/schema.prisma` (above the model definitions):

```prisma
enum AssignmentSource {
  AUTO_RELATIONSHIP
  AUTO_RECENT
  AUTO_BRANCH
  AUTO_ROUNDROBIN
  MANAGER_OVERRIDE
  SELF_CLAIMED
}

enum AssignmentStatus {
  PENDING
  IN_PROGRESS
  DONE
  SKIPPED
  CANCELLED
}

enum AssignmentOutcome {
  CALL_CONNECTED
  CALL_NO_ANSWER
  LINE_SENT
  SMS_SENT
  PAYMENT_RECEIVED
  PROMISE_MADE
  REFUSED
  SKIPPED
}

enum SkipReason {
  BUSY
  WRONG_QUEUE
  PERSONAL_CONFLICT
  OTHER
}
```

- [ ] **Step 2: Add DailyAssignment model**

Append to `apps/api/prisma/schema.prisma`:

```prisma
model DailyAssignment {
  id              String              @id @default(uuid())
  date            DateTime            @db.Date
  collectorId     String?
  contractId      String
  assignedAt      DateTime            @default(now())
  source          AssignmentSource
  status          AssignmentStatus    @default(PENDING)
  startedAt       DateTime?
  completedAt     DateTime?
  outcome         AssignmentOutcome?
  skipReason      SkipReason?
  skipNote        String?
  lockedAt        DateTime?
  lockExpiresAt   DateTime?
  escalationFlag  Boolean             @default(false)
  notes           String?
  paymentId       String?
  lineMessageId   String?
  position        Int                 @default(0)
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  deletedAt       DateTime?

  collector       User?               @relation("CollectorAssignments", fields: [collectorId], references: [id])
  contract        Contract            @relation(fields: [contractId], references: [id])

  @@unique([date, contractId])
  @@index([collectorId, date])
  @@index([date, status])
  @@index([escalationFlag, date])
}
```

- [ ] **Step 3: Add fields to User model**

Find the `model User` block in `apps/api/prisma/schema.prisma` and add these fields (before the closing `}`):

```prisma
  collectionsActive   Boolean              @default(true)
  preferences         Json?
  collectorAssignments DailyAssignment[]   @relation("CollectorAssignments")
```

- [ ] **Step 4: Add back-relation on Contract model**

Find the `model Contract` block and add (before the closing `}`):

```prisma
  dailyAssignments    DailyAssignment[]
```

- [ ] **Step 5: Run migration**

```bash
cd apps/api && npx prisma migrate dev --name add_daily_assignment
```

Expected: New SQL migration file created in `apps/api/prisma/migrations/` and DB updated. `npx prisma generate` runs automatically.

- [ ] **Step 6: Verify TypeScript client picks up new types**

```bash
./tools/check-types.sh api 2>&1 | tail -5
```

Expected: `API: OK` (no type errors)

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(collections): add DailyAssignment model + User.collectionsActive"
```

---

## Task 2: Auto-assign service — algorithm + tests (TDD)

**Files:**
- Create: `apps/api/src/modules/collections-session/auto-assign.service.ts`
- Create: `apps/api/src/modules/collections-session/auto-assign.service.spec.ts`

This is the core scheduling brain. TDD-first.

- [ ] **Step 1: Write failing test for relationship persistence**

Create `apps/api/src/modules/collections-session/auto-assign.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AutoAssignService } from './auto-assign.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AutoAssignService', () => {
  let service: AutoAssignService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const prismaMock = {
      contract: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
      dailyAssignment: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(prismaMock)),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AutoAssignService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(AutoAssignService);
    prisma = moduleRef.get(PrismaService);
  });

  it('keeps relationship when contract.assignedTo points to active collector', async () => {
    const today = new Date('2026-04-26');
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: 'u1', branchId: 'br1', daysOverdue: 10, brokenPromiseCount: 0 } as any,
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(today);

    expect(prisma.dailyAssignment.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          contractId: 'c1',
          collectorId: 'u1',
          source: 'AUTO_RELATIONSHIP',
        }),
      ]),
    });
  });
});
```

- [ ] **Step 2: Run test (expect FAIL — service not created)**

```bash
cd apps/api && npx jest auto-assign.service.spec --no-coverage 2>&1 | tail -10
```

Expected: FAIL `Cannot find module './auto-assign.service'`

- [ ] **Step 3: Create minimal service skeleton**

Create `apps/api/src/modules/collections-session/auto-assign.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentSource } from '@prisma/client';

const DEFAULT_DAILY_CAP = 30;
const DEFAULT_FLOOR = 10;
const RECENT_RELATIONSHIP_DAYS = 30;
const ESCALATION_DAYS = 90;
const ESCALATION_BROKEN_PROMISES = 2;

interface ContractInput {
  id: string;
  assignedToId: string | null;
  branchId: string;
  daysOverdue: number;
  brokenPromiseCount: number;
}

interface CollectorInput {
  id: string;
  collectionsActive: boolean;
  branchId: string | null;
}

interface AssignmentRow {
  date: Date;
  contractId: string;
  collectorId: string | null;
  source: AssignmentSource;
  escalationFlag: boolean;
  position: number;
}

@Injectable()
export class AutoAssignService {
  private readonly logger = new Logger(AutoAssignService.name);

  constructor(private prisma: PrismaService) {}

  async runForDate(date: Date): Promise<{ assigned: number; pool: number; escalation: number }> {
    const dateOnly = startOfDay(date);

    const contracts = await this.prisma.contract.findMany({
      where: {
        status: { in: ['OVERDUE', 'PENDING'] as any },
        deletedAt: null,
      },
      select: {
        id: true,
        assignedToId: true,
        branchId: true,
        daysOverdue: true,
        brokenPromiseCount: true,
      },
    }) as unknown as ContractInput[];

    const collectors = await this.prisma.user.findMany({
      where: { role: 'SALES' as any, collectionsActive: true, deletedAt: null },
      select: { id: true, collectionsActive: true, branchId: true },
    }) as unknown as CollectorInput[];

    const recentAssignments = await this.prisma.dailyAssignment.findMany({
      where: {
        date: { gte: addDays(dateOnly, -RECENT_RELATIONSHIP_DAYS) },
        collectorId: { not: null },
      },
      select: { contractId: true, collectorId: true, date: true },
      orderBy: { date: 'desc' },
    });

    const recentByContract = new Map<string, string>();
    for (const a of recentAssignments) {
      if (!recentByContract.has(a.contractId)) recentByContract.set(a.contractId, a.collectorId!);
    }

    const collectorIds = new Set(collectors.map((c) => c.id));
    const collectorByBranch = new Map<string, CollectorInput[]>();
    for (const c of collectors) {
      if (c.branchId) {
        if (!collectorByBranch.has(c.branchId)) collectorByBranch.set(c.branchId, []);
        collectorByBranch.get(c.branchId)!.push(c);
      }
    }

    const workload = new Map<string, number>();
    for (const c of collectors) workload.set(c.id, 0);

    const rows: AssignmentRow[] = [];
    let escalationCount = 0;
    let rrIndex = 0;

    for (const contract of contracts) {
      const isEscalation =
        contract.daysOverdue >= ESCALATION_DAYS &&
        contract.brokenPromiseCount >= ESCALATION_BROKEN_PROMISES;

      if (isEscalation) {
        rows.push({
          date: dateOnly,
          contractId: contract.id,
          collectorId: null,
          source: AssignmentSource.AUTO_ROUNDROBIN,
          escalationFlag: true,
          position: rows.length,
        });
        escalationCount++;
        continue;
      }

      let collectorId: string | null = null;
      let source: AssignmentSource = AssignmentSource.AUTO_ROUNDROBIN;

      if (contract.assignedToId && collectorIds.has(contract.assignedToId)) {
        collectorId = contract.assignedToId;
        source = AssignmentSource.AUTO_RELATIONSHIP;
      } else if (recentByContract.has(contract.id) && collectorIds.has(recentByContract.get(contract.id)!)) {
        collectorId = recentByContract.get(contract.id)!;
        source = AssignmentSource.AUTO_RECENT;
      } else {
        const branchCollectors = collectorByBranch.get(contract.branchId) ?? [];
        if (branchCollectors.length > 0) {
          branchCollectors.sort((a, b) => (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0));
          collectorId = branchCollectors[0].id;
          source = AssignmentSource.AUTO_BRANCH;
        } else if (collectors.length > 0) {
          collectorId = collectors[rrIndex % collectors.length].id;
          rrIndex++;
          source = AssignmentSource.AUTO_ROUNDROBIN;
        }
      }

      if (collectorId) {
        workload.set(collectorId, (workload.get(collectorId) ?? 0) + 1);
      }

      rows.push({
        date: dateOnly,
        contractId: contract.id,
        collectorId,
        source,
        escalationFlag: false,
        position: rows.length,
      });
    }

    // Cap enforcement: push overflow to pool
    for (const [cid, count] of workload.entries()) {
      if (count > DEFAULT_DAILY_CAP) {
        const overflow = count - DEFAULT_DAILY_CAP;
        let pushed = 0;
        for (let i = rows.length - 1; i >= 0 && pushed < overflow; i--) {
          if (rows[i].collectorId === cid && !rows[i].escalationFlag) {
            rows[i].collectorId = null;
            rows[i].source = AssignmentSource.AUTO_ROUNDROBIN;
            pushed++;
          }
        }
        workload.set(cid, DEFAULT_DAILY_CAP);
      }
    }

    // Floor top-up: pull from pool to under-loaded collectors
    const pool = rows.filter((r) => r.collectorId === null && !r.escalationFlag);
    for (const cid of collectorIds) {
      const have = workload.get(cid) ?? 0;
      if (have < DEFAULT_FLOOR && pool.length > 0) {
        const need = DEFAULT_FLOOR - have;
        for (let i = 0; i < pool.length && i < need; i++) {
          pool[i].collectorId = cid;
          pool[i].source = AssignmentSource.AUTO_ROUNDROBIN;
          workload.set(cid, (workload.get(cid) ?? 0) + 1);
        }
        pool.splice(0, Math.min(need, pool.length));
      }
    }

    const poolCount = rows.filter((r) => r.collectorId === null).length - escalationCount;

    await this.prisma.$transaction(async (tx) => {
      await tx.dailyAssignment.deleteMany({
        where: { date: dateOnly, status: 'PENDING' },
      });
      if (rows.length > 0) {
        await tx.dailyAssignment.createMany({
          data: rows.map((r) => ({
            date: r.date,
            contractId: r.contractId,
            collectorId: r.collectorId,
            source: r.source,
            escalationFlag: r.escalationFlag,
            position: r.position,
          })),
        });
      }
    });

    this.logger.log(
      `Auto-assign ${dateOnly.toISOString().slice(0, 10)}: ${rows.length - poolCount - escalationCount} assigned, ${poolCount} pool, ${escalationCount} escalation`,
    );

    return {
      assigned: rows.length - poolCount - escalationCount,
      pool: poolCount,
      escalation: escalationCount,
    };
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
```

- [ ] **Step 4: Run relationship-persistence test (expect PASS)**

```bash
cd apps/api && npx jest auto-assign.service.spec -t "keeps relationship" --no-coverage 2>&1 | tail -10
```

Expected: PASS (1 test)

- [ ] **Step 5: Add tests for branch fallback, round-robin, escalation, cap, floor**

Append to `auto-assign.service.spec.ts` (inside the `describe` block):

```typescript
  it('falls back to branch lowest-workload when no prior relationship', async () => {
    const today = new Date('2026-04-26');
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: null, branchId: 'br1', daysOverdue: 5, brokenPromiseCount: 0 } as any,
      { id: 'c2', assignedToId: null, branchId: 'br1', daysOverdue: 5, brokenPromiseCount: 0 } as any,
      { id: 'c3', assignedToId: null, branchId: 'br1', daysOverdue: 5, brokenPromiseCount: 0 } as any,
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br1' } as any,
      { id: 'u2', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(today);

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    const u1Count = created.filter((r: any) => r.collectorId === 'u1').length;
    const u2Count = created.filter((r: any) => r.collectorId === 'u2').length;
    expect(Math.abs(u1Count - u2Count)).toBeLessThanOrEqual(1);
    expect(created.every((r: any) => r.source === 'AUTO_BRANCH')).toBe(true);
  });

  it('round-robins when no same-branch collector exists', async () => {
    const today = new Date('2026-04-26');
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: null, branchId: 'br_unknown', daysOverdue: 5, brokenPromiseCount: 0 } as any,
      { id: 'c2', assignedToId: null, branchId: 'br_unknown', daysOverdue: 5, brokenPromiseCount: 0 } as any,
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br_other' } as any,
      { id: 'u2', collectionsActive: true, branchId: 'br_other' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(today);

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    expect(created).toHaveLength(2);
    expect(new Set(created.map((r: any) => r.collectorId))).toEqual(new Set(['u1', 'u2']));
    expect(created.every((r: any) => r.source === 'AUTO_ROUNDROBIN')).toBe(true);
  });

  it('marks 90+ days with broken promises as escalation (no collector)', async () => {
    const today = new Date('2026-04-26');
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: 'u1', branchId: 'br1', daysOverdue: 95, brokenPromiseCount: 3 } as any,
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(today);

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    expect(created[0]).toMatchObject({
      contractId: 'c1',
      collectorId: null,
      escalationFlag: true,
    });
  });

  it('caps at 30 contracts per collector — overflow to pool', async () => {
    const today = new Date('2026-04-26');
    const contracts = Array.from({ length: 35 }, (_, i) => ({
      id: `c${i}`,
      assignedToId: 'u1',
      branchId: 'br1',
      daysOverdue: 5,
      brokenPromiseCount: 0,
    }));
    prisma.contract.findMany.mockResolvedValue(contracts as any);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(today);

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    const u1Count = created.filter((r: any) => r.collectorId === 'u1').length;
    const poolCount = created.filter((r: any) => r.collectorId === null).length;
    expect(u1Count).toBe(30);
    expect(poolCount).toBe(5);
  });

  it('skips collectors that are not collectionsActive', async () => {
    const today = new Date('2026-04-26');
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c1', assignedToId: 'u1', branchId: 'br1', daysOverdue: 5, brokenPromiseCount: 0 } as any,
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u2', collectionsActive: true, branchId: 'br1' } as any,
    ]);
    prisma.dailyAssignment.findMany.mockResolvedValue([]);

    await service.runForDate(today);

    const created = (prisma.dailyAssignment.createMany.mock.calls[0][0] as any).data;
    expect(created[0].collectorId).toBe('u2');
    expect(created[0].source).toBe('AUTO_BRANCH');
  });
```

- [ ] **Step 6: Run all auto-assign tests**

```bash
cd apps/api && npx jest auto-assign.service.spec --no-coverage 2>&1 | tail -10
```

Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/collections-session/auto-assign.service.ts apps/api/src/modules/collections-session/auto-assign.service.spec.ts
git commit -m "feat(collections): auto-assign service with relationship/branch/round-robin/cap/escalation"
```

---

## Task 3: Cron orchestration (auto-assign + auto-lock + pool-expiry + summary)

**Files:**
- Create: `apps/api/src/modules/collections-session/collections-session.cron.ts`

- [ ] **Step 1: Create cron file**

Create `apps/api/src/modules/collections-session/collections-session.cron.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoAssignService } from './auto-assign.service';

@Injectable()
export class CollectionsSessionCron {
  private readonly logger = new Logger(CollectionsSessionCron.name);

  constructor(
    private autoAssign: AutoAssignService,
    private prisma: PrismaService,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'Asia/Bangkok' })
  async runAutoAssign(): Promise<void> {
    this.logger.log('Starting collections auto-assign');
    try {
      const result = await this.autoAssign.runForDate(new Date());
      this.logger.log(
        `Auto-assign done: assigned=${result.assigned} pool=${result.pool} escalation=${result.escalation}`,
      );
    } catch (error) {
      this.logger.error('Collections auto-assign failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'collections-auto-assign' },
      });
    }
  }

  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
  async runAutoLock(): Promise<void> {
    this.logger.log('Starting collections auto-lock');
    try {
      const today = startOfDay(new Date());
      const result = await this.prisma.dailyAssignment.updateMany({
        where: { date: today, lockedAt: null, status: 'PENDING' },
        data: { lockedAt: new Date() },
      });
      this.logger.log(`Auto-lock: ${result.count} assignments locked`);
    } catch (error) {
      this.logger.error('Collections auto-lock failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'collections-auto-lock' },
      });
    }
  }

  @Cron('*/15 9-20 * * *', { timeZone: 'Asia/Bangkok' })
  async runPoolExpiry(): Promise<void> {
    try {
      const now = new Date();
      const result = await this.prisma.dailyAssignment.updateMany({
        where: {
          source: 'SELF_CLAIMED',
          status: 'PENDING',
          lockExpiresAt: { lte: now },
        },
        data: { collectorId: null, lockedAt: null, lockExpiresAt: null },
      });
      if (result.count > 0) {
        this.logger.log(`Pool-expiry: released ${result.count} self-claimed contracts`);
      }
    } catch (error) {
      this.logger.error('Pool-expiry cron failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'collections-pool-expiry' },
      });
    }
  }

  @Cron('0 18 * * *', { timeZone: 'Asia/Bangkok' })
  async runDailySummary(): Promise<void> {
    this.logger.log('Computing collections daily summary');
    try {
      const today = startOfDay(new Date());
      const summaries = await this.prisma.dailyAssignment.groupBy({
        by: ['collectorId', 'status'],
        where: { date: today, collectorId: { not: null } },
        _count: true,
      });
      this.logger.log(`Daily summary computed: ${summaries.length} (collector,status) buckets`);
    } catch (error) {
      this.logger.error('Daily summary failed', error);
      Sentry.captureException(error, {
        tags: { kind: 'cron-job', cron: 'collections-summary' },
      });
    }
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
```

- [ ] **Step 2: Type check**

```bash
./tools/check-types.sh api 2>&1 | tail -5
```

Expected: `API: OK`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/collections-session/collections-session.cron.ts
git commit -m "feat(collections): cron jobs for auto-assign, auto-lock, pool-expiry, summary"
```

---

## Task 4: Pool service + tests

**Files:**
- Create: `apps/api/src/modules/collections-session/pool.service.ts`
- Create: `apps/api/src/modules/collections-session/pool.service.spec.ts`

- [ ] **Step 1: Write failing test for claim from pool**

Create `apps/api/src/modules/collections-session/pool.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PoolService } from './pool.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConflictException } from '@nestjs/common';

describe('PoolService', () => {
  let service: PoolService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const prismaMock = {
      dailyAssignment: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [PoolService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(PoolService);
    prisma = moduleRef.get(PrismaService);
  });

  it('claims an unassigned contract from pool', async () => {
    const today = new Date();
    prisma.dailyAssignment.findFirst.mockResolvedValue({
      id: 'a1',
      collectorId: null,
      contractId: 'c1',
      status: 'PENDING',
    } as any);
    prisma.dailyAssignment.update.mockResolvedValue({} as any);

    await service.claim('a1', 'u1');

    expect(prisma.dailyAssignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        collectorId: 'u1',
        source: 'SELF_CLAIMED',
        lockedAt: expect.any(Date),
        lockExpiresAt: expect.any(Date),
      }),
    });
  });

  it('throws ConflictException when contract already claimed', async () => {
    prisma.dailyAssignment.findFirst.mockResolvedValue(null);
    await expect(service.claim('a1', 'u1')).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

```bash
cd apps/api && npx jest pool.service.spec --no-coverage 2>&1 | tail -10
```

Expected: FAIL (`Cannot find module`)

- [ ] **Step 3: Implement service**

Create `apps/api/src/modules/collections-session/pool.service.ts`:

```typescript
import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const SELF_CLAIM_LOCK_HOURS = 2;

@Injectable()
export class PoolService {
  constructor(private prisma: PrismaService) {}

  async list(branchId?: string) {
    const today = startOfDay(new Date());
    return this.prisma.dailyAssignment.findMany({
      where: {
        date: today,
        collectorId: null,
        status: 'PENDING',
        deletedAt: null,
        ...(branchId ? { contract: { branchId } } : {}),
      },
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ escalationFlag: 'desc' }, { position: 'asc' }],
    });
  }

  async claim(assignmentId: string, userId: string) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SELF_CLAIM_LOCK_HOURS * 60 * 60 * 1000);

    const row = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, collectorId: null, status: 'PENDING', deletedAt: null },
    });
    if (!row) {
      throw new ConflictException('สัญญานี้ถูกหยิบไปแล้วหรือไม่อยู่ใน pool');
    }

    return this.prisma.dailyAssignment.update({
      where: { id: assignmentId },
      data: {
        collectorId: userId,
        source: 'SELF_CLAIMED',
        lockedAt: now,
        lockExpiresAt: expiresAt,
      },
    });
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
```

- [ ] **Step 4: Run tests (expect PASS)**

```bash
cd apps/api && npx jest pool.service.spec --no-coverage 2>&1 | tail -10
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/collections-session/pool.service.ts apps/api/src/modules/collections-session/pool.service.spec.ts
git commit -m "feat(collections): pool list + self-claim with 2hr lock"
```

---

## Task 5: Session service + DTOs + controller

**Files:**
- Create: `apps/api/src/modules/collections-session/dto/action.dto.ts`
- Create: `apps/api/src/modules/collections-session/dto/skip.dto.ts`
- Create: `apps/api/src/modules/collections-session/collections-session.service.ts`
- Create: `apps/api/src/modules/collections-session/collections-session.service.spec.ts`
- Create: `apps/api/src/modules/collections-session/collections-session.controller.ts`
- Create: `apps/api/src/modules/collections-session/collections-session.module.ts`

- [ ] **Step 1: Create DTOs**

Create `apps/api/src/modules/collections-session/dto/action.dto.ts`:

```typescript
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AssignmentOutcome } from '@prisma/client';

export class ActionDto {
  @IsEnum(AssignmentOutcome, { message: 'ผลการดำเนินการไม่ถูกต้อง' })
  outcome: AssignmentOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  paymentId?: string;

  @IsOptional()
  @IsString()
  lineMessageId?: string;
}
```

Create `apps/api/src/modules/collections-session/dto/skip.dto.ts`:

```typescript
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SkipReason } from '@prisma/client';

export class SkipDto {
  @IsEnum(SkipReason, { message: 'เหตุผลข้ามไม่ถูกต้อง' })
  reason: SkipReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
```

- [ ] **Step 2: Write failing test for service action handler**

Create `apps/api/src/modules/collections-session/collections-session.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { CollectionsSessionService } from './collections-session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('CollectionsSessionService', () => {
  let service: CollectionsSessionService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const prismaMock = {
      dailyAssignment: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CollectionsSessionService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(CollectionsSessionService);
    prisma = moduleRef.get(PrismaService);
  });

  it('returns ordered session list with breakdown', async () => {
    prisma.dailyAssignment.findMany.mockResolvedValue([
      {
        id: 'a1', contractId: 'c1', escalationFlag: false, position: 0, status: 'PENDING',
        contract: { daysOverdue: 95, customer: { phone: '08x' } },
      } as any,
      {
        id: 'a2', contractId: 'c2', escalationFlag: false, position: 1, status: 'PENDING',
        contract: { daysOverdue: 5, customer: { phone: '08y' } },
      } as any,
    ]);

    const result = await service.getMySession('u1');

    expect(result.contracts).toHaveLength(2);
    expect(result.target.count).toBe(2);
    expect(result.summary).toBeUndefined();
  });

  it('records action and advances to next contract', async () => {
    prisma.dailyAssignment.findFirst.mockResolvedValueOnce({
      id: 'a1', collectorId: 'u1', status: 'PENDING',
    } as any);
    prisma.dailyAssignment.update.mockResolvedValue({} as any);
    prisma.dailyAssignment.findFirst.mockResolvedValueOnce({
      id: 'a2', collectorId: 'u1', status: 'PENDING', contractId: 'c2',
    } as any);

    const result = await service.recordAction('a1', 'u1', {
      outcome: 'CALL_CONNECTED' as any,
    });

    expect(prisma.dailyAssignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({
        outcome: 'CALL_CONNECTED',
        status: 'DONE',
        completedAt: expect.any(Date),
      }),
    });
    expect(result.nextContractId).toBe('c2');
  });

  it('throws NotFound when assignment not owned by user', async () => {
    prisma.dailyAssignment.findFirst.mockResolvedValue(null);
    await expect(
      service.recordAction('a1', 'u1', { outcome: 'CALL_CONNECTED' as any }),
    ).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 3: Run (expect FAIL)**

```bash
cd apps/api && npx jest collections-session.service.spec --no-coverage 2>&1 | tail -5
```

Expected: FAIL

- [ ] **Step 4: Implement service**

Create `apps/api/src/modules/collections-session/collections-session.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionDto } from './dto/action.dto';
import { SkipDto } from './dto/skip.dto';

const ETA_PER_CONTRACT_MIN = 5;

@Injectable()
export class CollectionsSessionService {
  constructor(private prisma: PrismaService) {}

  async getMySession(userId: string) {
    const today = startOfDay(new Date());

    const assignments = await this.prisma.dailyAssignment.findMany({
      where: {
        date: today,
        collectorId: userId,
        deletedAt: null,
      },
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true, phone: true, lineId: true } },
            branch: { select: { id: true, name: true } },
            assignedTo: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [
        { escalationFlag: 'desc' },
        { position: 'asc' },
      ],
    });

    const pending = assignments.filter((a) => a.status === 'PENDING' || a.status === 'IN_PROGRESS');
    const done = assignments.filter((a) => a.status === 'DONE' || a.status === 'SKIPPED');

    const ordered = [...pending].sort((a, b) => {
      if (a.escalationFlag !== b.escalationFlag) return a.escalationFlag ? -1 : 1;
      const ago = (a.contract as any).daysOverdue;
      const bgo = (b.contract as any).daysOverdue;
      if (ago !== bgo) return bgo - ago;
      const aHasPhone = !!(a.contract as any).customer?.phone;
      const bHasPhone = !!(b.contract as any).customer?.phone;
      if (aHasPhone !== bHasPhone) return aHasPhone ? -1 : 1;
      return a.position - b.position;
    });

    const callsCount = pending.filter((a) => !!(a.contract as any).customer?.phone).length;
    const lineCount = pending.filter((a) => !!(a.contract as any).customer?.lineId && !(a.contract as any).customer?.phone).length;

    const summary = pending.length === 0 && done.length > 0
      ? this.buildSummary(done)
      : undefined;

    return {
      contracts: ordered,
      target: {
        count: pending.length,
        etaMinutes: pending.length * ETA_PER_CONTRACT_MIN,
      },
      breakdown: {
        calls: callsCount,
        lines: lineCount,
        severe: pending.filter((a) => (a.contract as any).daysOverdue >= 30).length,
        medium: pending.filter((a) => (a.contract as any).daysOverdue >= 8 && (a.contract as any).daysOverdue < 30).length,
        light: pending.filter((a) => (a.contract as any).daysOverdue < 8).length,
      },
      summary,
    };
  }

  async startSession(userId: string) {
    const today = startOfDay(new Date());
    await this.prisma.dailyAssignment.updateMany({
      where: { date: today, collectorId: userId, status: 'PENDING', startedAt: null },
      data: { startedAt: new Date() },
    });
    return { sessionStartedAt: new Date() };
  }

  async recordAction(assignmentId: string, userId: string, dto: ActionDto) {
    const row = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, collectorId: userId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('ไม่พบรายการในคิวของคุณ');

    await this.prisma.dailyAssignment.update({
      where: { id: assignmentId },
      data: {
        outcome: dto.outcome,
        status: 'DONE',
        completedAt: new Date(),
        notes: dto.notes,
        paymentId: dto.paymentId,
        lineMessageId: dto.lineMessageId,
      },
    });

    const next = await this.prisma.dailyAssignment.findFirst({
      where: {
        date: row.date,
        collectorId: userId,
        status: 'PENDING',
        deletedAt: null,
      },
      orderBy: [{ escalationFlag: 'desc' }, { position: 'asc' }],
    });

    return { nextContractId: next?.contractId ?? null };
  }

  async skip(assignmentId: string, userId: string, dto: SkipDto) {
    const row = await this.prisma.dailyAssignment.findFirst({
      where: { id: assignmentId, collectorId: userId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('ไม่พบรายการในคิวของคุณ');

    if (dto.reason === 'WRONG_QUEUE') {
      await this.prisma.dailyAssignment.update({
        where: { id: assignmentId },
        data: {
          collectorId: null,
          status: 'PENDING',
          skipReason: dto.reason,
          skipNote: dto.note,
        },
      });
    } else {
      await this.prisma.dailyAssignment.update({
        where: { id: assignmentId },
        data: {
          status: 'SKIPPED',
          completedAt: new Date(),
          skipReason: dto.reason,
          skipNote: dto.note,
        },
      });
    }

    const next = await this.prisma.dailyAssignment.findFirst({
      where: {
        date: row.date,
        collectorId: userId,
        status: 'PENDING',
        deletedAt: null,
      },
      orderBy: [{ escalationFlag: 'desc' }, { position: 'asc' }],
    });

    return { nextContractId: next?.contractId ?? null };
  }

  private buildSummary(done: any[]) {
    const callsConnected = done.filter((a) => a.outcome === 'CALL_CONNECTED').length;
    const callsNoAnswer = done.filter((a) => a.outcome === 'CALL_NO_ANSWER').length;
    const lineSent = done.filter((a) => a.outcome === 'LINE_SENT').length;
    const skipped = done.filter((a) => a.status === 'SKIPPED').length;
    const startedAt = done.reduce<Date | null>(
      (min, a) => (a.startedAt && (!min || a.startedAt < min) ? a.startedAt : min),
      null,
    );
    const finishedAt = done.reduce<Date | null>(
      (max, a) => (a.completedAt && (!max || a.completedAt > max) ? a.completedAt : max),
      null,
    );
    const elapsedMinutes =
      startedAt && finishedAt
        ? Math.round((finishedAt.getTime() - startedAt.getTime()) / 60000)
        : 0;

    return {
      total: done.length,
      callsConnected,
      callsNoAnswer,
      lineSent,
      skipped,
      elapsedMinutes,
    };
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
```

- [ ] **Step 5: Run tests (expect PASS)**

```bash
cd apps/api && npx jest collections-session.service.spec --no-coverage 2>&1 | tail -10
```

Expected: PASS (3 tests)

- [ ] **Step 6: Create controller**

Create `apps/api/src/modules/collections-session/collections-session.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CollectionsSessionService } from './collections-session.service';
import { PoolService } from './pool.service';
import { ActionDto } from './dto/action.dto';
import { SkipDto } from './dto/skip.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('collections/session')
export class CollectionsSessionController {
  constructor(
    private session: CollectionsSessionService,
    private pool: PoolService,
  ) {}

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Get('mine')
  getMine(@CurrentUser() user: any) {
    return this.session.getMySession(user.id);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('start')
  start(@CurrentUser() user: any) {
    return this.session.startSession(user.id);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post(':id/action')
  action(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: ActionDto) {
    return this.session.recordAction(id, user.id, dto);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post(':id/skip')
  skip(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: SkipDto) {
    return this.session.skip(id, user.id, dto);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Get('pool')
  pool_(@CurrentUser() user: any) {
    return this.pool.list(user.branchId);
  }

  @Roles('SALES', 'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('pool/:id/claim')
  claim(@Param('id') id: string, @CurrentUser() user: any) {
    return this.pool.claim(id, user.id);
  }
}
```

- [ ] **Step 7: Create module**

Create `apps/api/src/modules/collections-session/collections-session.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../prisma/prisma.module';
import { CollectionsSessionController } from './collections-session.controller';
import { CollectionsSessionService } from './collections-session.service';
import { AutoAssignService } from './auto-assign.service';
import { PoolService } from './pool.service';
import { CollectionsSessionCron } from './collections-session.cron';

@Module({
  imports: [PrismaModule, ScheduleModule.forFeature()],
  controllers: [CollectionsSessionController],
  providers: [CollectionsSessionService, AutoAssignService, PoolService, CollectionsSessionCron],
  exports: [CollectionsSessionService, AutoAssignService],
})
export class CollectionsSessionModule {}
```

- [ ] **Step 8: Register module in AppModule**

Modify `apps/api/src/app.module.ts` — add import:

```typescript
import { CollectionsSessionModule } from './modules/collections-session/collections-session.module';
```

And add to the `imports` array of `@Module`.

- [ ] **Step 9: Type check + commit**

```bash
./tools/check-types.sh api 2>&1 | tail -5
```

Expected: `API: OK`

```bash
git add apps/api/src/modules/collections-session/
git add apps/api/src/app.module.ts
git commit -m "feat(collections): session controller + service with TDD"
```

---

## Task 6: Manage service + DTOs + controller

**Files:**
- Create: `apps/api/src/modules/collections-manage/dto/assign.dto.ts`
- Create: `apps/api/src/modules/collections-manage/dto/transfer.dto.ts`
- Create: `apps/api/src/modules/collections-manage/collections-manage.service.ts`
- Create: `apps/api/src/modules/collections-manage/collections-manage.service.spec.ts`
- Create: `apps/api/src/modules/collections-manage/collections-manage.controller.ts`
- Create: `apps/api/src/modules/collections-manage/collections-manage.module.ts`

- [ ] **Step 1: Create DTOs**

Create `apps/api/src/modules/collections-manage/dto/assign.dto.ts`:

```typescript
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class AssignDto {
  @IsUUID()
  assignmentId: string;

  @IsOptional()
  @IsUUID()
  toCollectorId?: string;
}
```

Create `apps/api/src/modules/collections-manage/dto/transfer.dto.ts`:

```typescript
import { IsInt, IsUUID, Min } from 'class-validator';

export class TransferDto {
  @IsUUID()
  fromCollectorId: string;

  @IsUUID()
  toCollectorId: string;

  @IsInt()
  @Min(1)
  count: number;
}
```

- [ ] **Step 2: Implement service**

Create `apps/api/src/modules/collections-manage/collections-manage.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoAssignService } from '../collections-session/auto-assign.service';
import { TransferDto } from './dto/transfer.dto';

@Injectable()
export class CollectionsManageService {
  constructor(
    private prisma: PrismaService,
    private autoAssign: AutoAssignService,
  ) {}

  async getBoard(branchScope?: string[]) {
    const today = startOfDay(new Date());
    const collectors = await this.prisma.user.findMany({
      where: {
        role: 'SALES' as any,
        deletedAt: null,
        ...(branchScope ? { branchId: { in: branchScope } } : {}),
      },
      select: {
        id: true,
        name: true,
        collectionsActive: true,
        branch: { select: { id: true, name: true } },
      },
    });

    const assignments = await this.prisma.dailyAssignment.findMany({
      where: { date: today, deletedAt: null },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            outstanding: true,
            daysOverdue: true,
            customer: { select: { id: true, name: true, phone: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { position: 'asc' },
    });

    const byCollector = new Map<string, any[]>();
    const pool: any[] = [];
    for (const a of assignments) {
      if (a.collectorId) {
        if (!byCollector.has(a.collectorId)) byCollector.set(a.collectorId, []);
        byCollector.get(a.collectorId)!.push(a);
      } else {
        pool.push(a);
      }
    }

    return {
      date: today,
      collectors: collectors.map((c) => {
        const items = byCollector.get(c.id) ?? [];
        const done = items.filter((a) => a.status === 'DONE' || a.status === 'SKIPPED').length;
        return {
          id: c.id,
          name: c.name,
          branch: c.branch,
          active: c.collectionsActive,
          assignments: items,
          progress: { total: items.length, done },
        };
      }),
      pool: {
        items: pool.filter((a) => !a.escalationFlag),
        escalation: pool.filter((a) => a.escalationFlag),
      },
      lockedAt: assignments.find((a) => a.lockedAt)?.lockedAt ?? null,
    };
  }

  async assignContract(assignmentId: string, toCollectorId: string | null) {
    const row = await this.prisma.dailyAssignment.findUnique({ where: { id: assignmentId } });
    if (!row) throw new NotFoundException('ไม่พบรายการ');

    return this.prisma.dailyAssignment.update({
      where: { id: assignmentId },
      data: {
        collectorId: toCollectorId,
        source: 'MANAGER_OVERRIDE',
      },
    });
  }

  async lock() {
    const today = startOfDay(new Date());
    return this.prisma.dailyAssignment.updateMany({
      where: { date: today, lockedAt: null, status: 'PENDING' },
      data: { lockedAt: new Date() },
    });
  }

  async transfer(dto: TransferDto) {
    const today = startOfDay(new Date());
    const items = await this.prisma.dailyAssignment.findMany({
      where: {
        date: today,
        collectorId: dto.fromCollectorId,
        status: 'PENDING',
        deletedAt: null,
      },
      orderBy: { position: 'asc' },
      take: dto.count,
    });
    if (items.length === 0) return { moved: 0 };
    await this.prisma.dailyAssignment.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { collectorId: dto.toCollectorId, source: 'MANAGER_OVERRIDE' },
    });
    return { moved: items.length };
  }

  async closeSession(collectorId: string) {
    const today = startOfDay(new Date());
    return this.prisma.dailyAssignment.updateMany({
      where: { date: today, collectorId, status: 'PENDING' },
      data: { collectorId: null, source: 'MANAGER_OVERRIDE' },
    });
  }

  async autoBalance() {
    return this.autoAssign.runForDate(new Date());
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
```

- [ ] **Step 3: Test transfer**

Create `apps/api/src/modules/collections-manage/collections-manage.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { CollectionsManageService } from './collections-manage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoAssignService } from '../collections-session/auto-assign.service';

describe('CollectionsManageService', () => {
  let service: CollectionsManageService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const prismaMock = {
      dailyAssignment: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      user: { findMany: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CollectionsManageService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AutoAssignService, useValue: { runForDate: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(CollectionsManageService);
    prisma = moduleRef.get(PrismaService);
  });

  it('transfers N pending contracts oldest-first', async () => {
    prisma.dailyAssignment.findMany.mockResolvedValue([
      { id: 'a1' }, { id: 'a2' }, { id: 'a3' },
    ] as any);
    prisma.dailyAssignment.updateMany.mockResolvedValue({ count: 3 } as any);

    const result = await service.transfer({
      fromCollectorId: 'u1',
      toCollectorId: 'u2',
      count: 3,
    });

    expect(result.moved).toBe(3);
    expect(prisma.dailyAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2', 'a3'] } },
      data: { collectorId: 'u2', source: 'MANAGER_OVERRIDE' },
    });
  });

  it('returns 0 when from-collector has no pending', async () => {
    prisma.dailyAssignment.findMany.mockResolvedValue([]);
    const result = await service.transfer({
      fromCollectorId: 'u1',
      toCollectorId: 'u2',
      count: 5,
    });
    expect(result.moved).toBe(0);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && npx jest collections-manage.service.spec --no-coverage 2>&1 | tail -10
```

Expected: PASS (2 tests)

- [ ] **Step 5: Create controller**

Create `apps/api/src/modules/collections-manage/collections-manage.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CollectionsManageService } from './collections-manage.service';
import { AssignDto } from './dto/assign.dto';
import { TransferDto } from './dto/transfer.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('collections/manage')
export class CollectionsManageController {
  constructor(private manage: CollectionsManageService) {}

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Get('board')
  board(@CurrentUser() user: any) {
    const scope = user.role === 'BRANCH_MANAGER' && user.branchId ? [user.branchId] : undefined;
    return this.manage.getBoard(scope);
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('assign')
  assign(@Body() dto: AssignDto) {
    return this.manage.assignContract(dto.assignmentId, dto.toCollectorId ?? null);
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('lock')
  lock() {
    return this.manage.lock();
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('transfer')
  transfer(@Body() dto: TransferDto) {
    return this.manage.transfer(dto);
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('close-session/:collectorId')
  close(@Param('collectorId') collectorId: string) {
    return this.manage.closeSession(collectorId);
  }

  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @Post('auto-balance')
  autoBalance() {
    return this.manage.autoBalance();
  }
}
```

- [ ] **Step 6: Create module + register**

Create `apps/api/src/modules/collections-manage/collections-manage.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CollectionsSessionModule } from '../collections-session/collections-session.module';
import { CollectionsManageController } from './collections-manage.controller';
import { CollectionsManageService } from './collections-manage.service';

@Module({
  imports: [PrismaModule, CollectionsSessionModule],
  controllers: [CollectionsManageController],
  providers: [CollectionsManageService],
})
export class CollectionsManageModule {}
```

Modify `apps/api/src/app.module.ts` — add import + register:

```typescript
import { CollectionsManageModule } from './modules/collections-manage/collections-manage.module';
```

Add to `imports` array.

- [ ] **Step 7: Type check + commit**

```bash
./tools/check-types.sh api 2>&1 | tail -5
git add apps/api/src/modules/collections-manage/ apps/api/src/app.module.ts
git commit -m "feat(collections): manage controller + service for OWNER/MANAGER dashboard"
```

---

## Task 7: User preferences endpoint (toggle persistence)

**Files:**
- Modify: `apps/api/src/modules/auth/dto/preferences.dto.ts` (or create if missing)
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`

- [ ] **Step 1: Create preferences DTO**

Create `apps/api/src/modules/auth/dto/preferences.dto.ts`:

```typescript
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  @IsIn(['SESSION', 'LIBRARY'])
  collectionsDefaultView?: 'SESSION' | 'LIBRARY';
}
```

- [ ] **Step 2: Add service method**

In `apps/api/src/modules/auth/auth.service.ts`, add:

```typescript
async updatePreferences(userId: string, prefs: Record<string, unknown>) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundException('ไม่พบผู้ใช้');
  const current = (user.preferences as Record<string, unknown>) ?? {};
  const merged = { ...current, ...prefs };
  return this.prisma.user.update({
    where: { id: userId },
    data: { preferences: merged },
    select: { id: true, preferences: true },
  });
}
```

- [ ] **Step 3: Add controller endpoint**

In `apps/api/src/modules/auth/auth.controller.ts`, add:

```typescript
@UseGuards(JwtAuthGuard)
@Patch('me/preferences')
updatePreferences(@CurrentUser() user: any, @Body() dto: UpdatePreferencesDto) {
  return this.authService.updatePreferences(user.id, dto);
}
```

(Add corresponding imports.)

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh api 2>&1 | tail -5
git add apps/api/src/modules/auth/
git commit -m "feat(auth): user preferences endpoint for collections view toggle"
```

---

## Task 8: Frontend — useViewToggle + session API hooks

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/hooks/useViewToggle.ts`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useMySession.ts`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useSessionActions.ts`
- Create: `apps/web/src/pages/CollectionsPage/hooks/usePool.ts`
- Create: `apps/web/src/pages/CollectionsPage/hooks/useManagerBoard.ts`

- [ ] **Step 1: useViewToggle**

Create `apps/web/src/pages/CollectionsPage/hooks/useViewToggle.ts`:

```typescript
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export type CollectionsView = 'SESSION' | 'LIBRARY';

const ROLE_DEFAULTS: Record<string, CollectionsView> = {
  SALES: 'SESSION',
  ACCOUNTANT: 'LIBRARY',
  OWNER: 'LIBRARY',
  BRANCH_MANAGER: 'LIBRARY',
  FINANCE_MANAGER: 'LIBRARY',
};

export function useViewToggle() {
  const { user, refresh } = useAuth();
  const stored = (user?.preferences as { collectionsDefaultView?: CollectionsView } | undefined)
    ?.collectionsDefaultView;
  const initial: CollectionsView = stored ?? ROLE_DEFAULTS[user?.role ?? ''] ?? 'LIBRARY';
  const [view, setView] = useState<CollectionsView>(initial);

  useEffect(() => {
    if (stored && stored !== view) setView(stored);
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useMutation({
    mutationFn: (next: CollectionsView) =>
      api.patch('/auth/me/preferences', { collectionsDefaultView: next }),
    onSuccess: () => refresh?.(),
  });

  const setAndPersist = (next: CollectionsView) => {
    setView(next);
    persist.mutate(next);
  };

  return { view, setView: setAndPersist };
}
```

- [ ] **Step 2: useMySession**

Create `apps/web/src/pages/CollectionsPage/hooks/useMySession.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface SessionContract {
  id: string;
  contractId: string;
  escalationFlag: boolean;
  contract: {
    id: string;
    contractNumber: string;
    outstanding: number;
    daysOverdue: number;
    brokenPromiseCount: number;
    noAnswerCount: number;
    customer: { id: string; name: string; phone: string | null; lineId: string | null };
    branch: { id: string; name: string };
    assignedTo: { id: string; name: string } | null;
  };
}

export interface MySession {
  contracts: SessionContract[];
  target: { count: number; etaMinutes: number };
  breakdown: { calls: number; lines: number; severe: number; medium: number; light: number };
  summary?: {
    total: number;
    callsConnected: number;
    callsNoAnswer: number;
    lineSent: number;
    skipped: number;
    elapsedMinutes: number;
  };
}

export function useMySession() {
  return useQuery<MySession>({
    queryKey: ['collections-session', 'mine'],
    queryFn: async () => {
      const { data } = await api.get('/collections/session/mine');
      return data;
    },
    refetchOnWindowFocus: false,
  });
}
```

- [ ] **Step 3: useSessionActions**

Create `apps/web/src/pages/CollectionsPage/hooks/useSessionActions.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export type Outcome =
  | 'CALL_CONNECTED'
  | 'CALL_NO_ANSWER'
  | 'LINE_SENT'
  | 'SMS_SENT'
  | 'PAYMENT_RECEIVED'
  | 'PROMISE_MADE'
  | 'REFUSED'
  | 'SKIPPED';

export type SkipReason = 'BUSY' | 'WRONG_QUEUE' | 'PERSONAL_CONFLICT' | 'OTHER';

export function useSessionActions() {
  const qc = useQueryClient();

  const start = useMutation({
    mutationFn: () => api.post('/collections/session/start'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-session', 'mine'] }),
  });

  const action = useMutation({
    mutationFn: ({
      assignmentId,
      outcome,
      notes,
      paymentId,
      lineMessageId,
    }: {
      assignmentId: string;
      outcome: Outcome;
      notes?: string;
      paymentId?: string;
      lineMessageId?: string;
    }) =>
      api.post(`/collections/session/${assignmentId}/action`, {
        outcome,
        notes,
        paymentId,
        lineMessageId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-session', 'mine'] }),
  });

  const skip = useMutation({
    mutationFn: ({
      assignmentId,
      reason,
      note,
    }: {
      assignmentId: string;
      reason: SkipReason;
      note?: string;
    }) => api.post(`/collections/session/${assignmentId}/skip`, { reason, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-session', 'mine'] }),
  });

  return { start, action, skip };
}
```

- [ ] **Step 4: usePool**

Create `apps/web/src/pages/CollectionsPage/hooks/usePool.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export function usePool() {
  return useQuery({
    queryKey: ['collections-session', 'pool'],
    queryFn: async () => {
      const { data } = await api.get('/collections/session/pool');
      return data;
    },
  });
}

export function useClaimPool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) =>
      api.post(`/collections/session/pool/${assignmentId}/claim`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collections-session'] });
    },
  });
}
```

- [ ] **Step 5: useManagerBoard**

Create `apps/web/src/pages/CollectionsPage/hooks/useManagerBoard.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export function useManagerBoard() {
  return useQuery({
    queryKey: ['collections-manage', 'board'],
    queryFn: async () => {
      const { data } = await api.get('/collections/manage/board');
      return data;
    },
    refetchInterval: 30_000,
  });
}

export function useManageActions() {
  const qc = useQueryClient();

  const assign = useMutation({
    mutationFn: ({
      assignmentId,
      toCollectorId,
    }: {
      assignmentId: string;
      toCollectorId: string | null;
    }) => api.post('/collections/manage/assign', { assignmentId, toCollectorId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  const lock = useMutation({
    mutationFn: () => api.post('/collections/manage/lock'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  const transfer = useMutation({
    mutationFn: (body: { fromCollectorId: string; toCollectorId: string; count: number }) =>
      api.post('/collections/manage/transfer', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  const closeSession = useMutation({
    mutationFn: (collectorId: string) =>
      api.post(`/collections/manage/close-session/${collectorId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  const autoBalance = useMutation({
    mutationFn: () => api.post('/collections/manage/auto-balance'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections-manage'] }),
  });

  return { assign, lock, transfer, closeSession, autoBalance };
}
```

- [ ] **Step 6: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/hooks/
git commit -m "feat(collections-web): hooks for session/pool/manage + view toggle"
```

---

## Task 9: PreStartScreen + SessionTimer + SessionProgress

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/session/PreStartScreen.tsx`
- Create: `apps/web/src/pages/CollectionsPage/session/SessionTimer.tsx`
- Create: `apps/web/src/pages/CollectionsPage/session/SessionProgress.tsx`

- [ ] **Step 1: SessionTimer**

Create `apps/web/src/pages/CollectionsPage/session/SessionTimer.tsx`:

```tsx
import { useEffect, useState } from 'react';

interface Props {
  startedAt: Date;
  targetMinutes: number;
}

export default function SessionTimer({ startedAt, targetMinutes }: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = now.getTime() - startedAt.getTime();
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
  const ratio = elapsedMin / targetMinutes;
  const color =
    ratio >= 1.3 ? 'text-destructive' : ratio >= 1 ? 'text-warning' : 'text-muted-foreground';

  return (
    <span className={`font-mono tabular-nums text-sm ${color}`}>
      {String(elapsedMin).padStart(2, '0')}:{String(elapsedSec).padStart(2, '0')}
      <span className="text-2xs text-muted-foreground/60 ml-1">
        / {String(targetMinutes).padStart(2, '0')}:00
      </span>
    </span>
  );
}
```

- [ ] **Step 2: SessionProgress**

Create `apps/web/src/pages/CollectionsPage/session/SessionProgress.tsx`:

```tsx
interface Props {
  current: number;
  total: number;
}

export default function SessionProgress({ current, total }: Props) {
  const pct = total === 0 ? 0 : Math.round((current / total) * 100);
  return (
    <div className="flex items-center gap-3 min-w-[140px]">
      <div className="font-mono tabular-nums text-sm tracking-tight whitespace-nowrap">
        {current} <span className="text-muted-foreground">/ {total}</span>
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: PreStartScreen**

Create `apps/web/src/pages/CollectionsPage/session/PreStartScreen.tsx`:

```tsx
import { Phone, MessageCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import type { MySession } from '../hooks/useMySession';

interface Props {
  data: MySession | undefined;
  isLoading: boolean;
  onStart: () => void;
  starting?: boolean;
}

export default function PreStartScreen({ data, isLoading, onStart, starting }: Props) {
  const { user } = useAuth();
  const count = data?.target.count ?? 0;
  const eta = data?.target.etaMinutes ?? 0;
  const breakdown = data?.breakdown;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
        <div className="text-base font-semibold leading-snug mb-1">วันนี้ไม่มีคิวงานของคุณ 🎉</div>
        <div className="text-sm text-muted-foreground leading-snug">
          ดู pool กลางถ้าอยากหยิบงานเพิ่ม
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm p-6 sm:p-8">
      <div className="text-sm text-muted-foreground leading-snug mb-1">
        สวัสดี {user?.name ?? ''} 👋
      </div>
      <div className="text-2xl sm:text-3xl font-bold leading-snug mb-1">
        วันนี้คุณมีคิว <span className="text-primary tabular-nums">{count}</span> ราย
      </div>
      <div className="text-sm text-muted-foreground leading-snug mb-6">
        ประมาณ {Math.floor(eta / 60)} ชม. {eta % 60} นาที
      </div>

      <Button
        size="lg"
        className="w-full sm:w-auto sm:min-w-[280px] h-14 text-base"
        onClick={onStart}
        disabled={starting}
      >
        {starting ? (
          <Loader2 className="size-5 animate-spin mr-2" />
        ) : (
          <span className="mr-2">▶</span>
        )}
        เริ่มงานเก็บเงิน
      </Button>

      {breakdown && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8 pt-6 border-t border-border/40">
          <Stat icon={Phone} label="ต้องโทร" value={breakdown.calls} color="text-primary" />
          <Stat icon={MessageCircle} label="ส่ง LINE" value={breakdown.lines} color="text-info" />
          <Stat label="🔴 ค้างนาน" value={breakdown.severe} color="text-destructive" />
          <Stat label="🟠 ค้างปานกลาง" value={breakdown.medium} color="text-warning" />
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  color = 'text-foreground',
}: {
  icon?: any;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {Icon && <Icon className={`size-4 ${color}`} />}
      <div>
        <div className="text-2xs uppercase tracking-wider text-muted-foreground/80 leading-snug">
          {label}
        </div>
        <div className="font-mono text-base font-bold tabular-nums tracking-tight leading-none">
          {value}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/session/PreStartScreen.tsx apps/web/src/pages/CollectionsPage/session/SessionTimer.tsx apps/web/src/pages/CollectionsPage/session/SessionProgress.tsx
git commit -m "feat(collections-web): pre-start screen + session timer + progress"
```

---

## Task 10: FocusContractCard + SkipReasonDialog

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/session/FocusContractCard.tsx`
- Create: `apps/web/src/pages/CollectionsPage/session/SkipReasonDialog.tsx`

- [ ] **Step 1: SkipReasonDialog**

Create `apps/web/src/pages/CollectionsPage/session/SkipReasonDialog.tsx`:

```tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SkipReason } from '../hooks/useSessionActions';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (reason: SkipReason, note?: string) => void;
}

const REASONS: { value: SkipReason; label: string }[] = [
  { value: 'BUSY', label: 'ลูกค้าไม่ว่าง — โทรซ้ำภายหลัง' },
  { value: 'WRONG_QUEUE', label: 'ไม่ใช่ลูกค้าของฉัน — คืนกลับ pool' },
  { value: 'PERSONAL_CONFLICT', label: 'มีเรื่องส่วนตัว — ขอข้าม' },
  { value: 'OTHER', label: 'อื่นๆ' },
];

export default function SkipReasonDialog({ open, onOpenChange, onSubmit }: Props) {
  const [reason, setReason] = useState<SkipReason>('BUSY');
  const [note, setNote] = useState('');

  const submit = () => {
    onSubmit(reason, note.trim() || undefined);
    setNote('');
    setReason('BUSY');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ข้ามรายการนี้ — เพราะอะไร?</DialogTitle>
        </DialogHeader>
        <RadioGroup value={reason} onValueChange={(v) => setReason(v as SkipReason)}>
          {REASONS.map((r) => (
            <div key={r.value} className="flex items-center gap-2 py-1.5">
              <RadioGroupItem value={r.value} id={`skip-${r.value}`} />
              <Label htmlFor={`skip-${r.value}`} className="text-sm leading-snug cursor-pointer">
                {r.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
        {reason === 'OTHER' && (
          <Textarea
            placeholder="เหตุผล (สั้นๆ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="mt-2"
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={submit}>ข้ามและไปต่อ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: FocusContractCard**

Create `apps/web/src/pages/CollectionsPage/session/FocusContractCard.tsx`:

```tsx
import { useState } from 'react';
import { Phone, MessageSquare, SkipForward, ChevronDown, AlertTriangle, PhoneMissed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/utils/formatters';
import { CallButton } from '@/components/CallButton';
import { agingBucket, agingColor, formatRelativeTime } from '../utils/cardIndicators';
import type { SessionContract } from '../hooks/useMySession';

interface Props {
  assignment: SessionContract;
  onCall: () => void;
  onSendLine: () => void;
  onSkip: () => void;
  onOpen360: () => void;
}

function severityPanel(daysOverdue: number): { bg: string; fg: string; label: string } {
  if (daysOverdue >= 90) return { bg: 'bg-destructive', fg: 'text-destructive-foreground', label: '90+ วัน' };
  if (daysOverdue >= 30) return { bg: 'bg-destructive/85', fg: 'text-destructive-foreground', label: '30-89 วัน' };
  if (daysOverdue >= 8) return { bg: 'bg-warning', fg: 'text-warning-foreground', label: '8-29 วัน' };
  if (daysOverdue >= 1) return { bg: 'bg-primary', fg: 'text-primary-foreground', label: '1-7 วัน' };
  return { bg: 'bg-muted', fg: 'text-muted-foreground', label: '0 วัน' };
}

export default function FocusContractCard({ assignment, onCall, onSendLine, onSkip, onOpen360 }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const c = assignment.contract;
  const sev = severityPanel(c.daysOverdue);

  return (
    <div className="rounded-2xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className={`${sev.bg} ${sev.fg} px-5 py-4 flex items-baseline justify-between`}>
        <div>
          <div className="text-2xs uppercase tracking-wider opacity-80 leading-snug">
            ความเร่งด่วน
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums tracking-tight leading-none mt-0.5">
            {sev.label}
          </div>
        </div>
        {assignment.escalationFlag && (
          <span className="inline-flex items-center gap-1 text-2xs font-medium opacity-90 leading-snug">
            <AlertTriangle className="size-3.5" /> Escalation
          </span>
        )}
      </div>

      <div className="px-5 sm:px-6 py-5">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <div className="font-mono text-xs text-primary font-medium leading-snug">
            {c.contractNumber}
          </div>
          <div className="text-2xs text-muted-foreground leading-snug">{c.branch.name}</div>
        </div>

        <div className="text-xl sm:text-2xl font-bold leading-snug truncate">{c.customer.name}</div>

        {c.customer.phone && (
          <div className="font-mono tabular-nums text-base text-muted-foreground tracking-tight mt-1 leading-snug">
            {c.customer.phone}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-border/40 flex items-baseline gap-4 flex-wrap">
          <div>
            <div className="text-2xs uppercase tracking-wider text-muted-foreground/80 leading-snug">
              ค้างชำระ
            </div>
            <div className="font-mono text-2xl font-bold tabular-nums text-destructive tracking-tight leading-none mt-0.5">
              {formatNumber(c.outstanding)} <span className="text-base font-medium">฿</span>
            </div>
          </div>

          {c.brokenPromiseCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 text-destructive text-2xs font-medium px-2 py-0.5 leading-snug">
              <AlertTriangle className="size-3" />
              นัดผิด {c.brokenPromiseCount}
            </span>
          )}
          {c.noAnswerCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning border border-warning/20 text-2xs font-medium px-2 py-0.5 leading-snug">
              <PhoneMissed className="size-3" />
              ไม่รับ {c.noAnswerCount}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mt-6">
          <CallButton
            customerId={c.customer.id}
            contractId={c.id}
            phone={c.customer.phone}
            size="lg"
            className="h-14 text-base flex-col gap-0.5"
            onCallEnded={onCall}
          />
          <Button
            variant="outline"
            size="lg"
            className="h-14 text-base flex-col gap-0.5"
            disabled={!c.customer.lineId}
            onClick={onSendLine}
          >
            <MessageSquare className="size-5" />
            <span className="text-xs leading-none">LINE</span>
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-14 text-base flex-col gap-0.5"
            onClick={onSkip}
          >
            <SkipForward className="size-5" />
            <span className="text-xs leading-none">ข้าม</span>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowDetails((v) => !v);
            if (!showDetails) onOpen360();
          }}
          className="w-full mt-4 flex items-center justify-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className={`size-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
          {showDetails ? 'ซ่อนข้อมูลลูกค้า' : 'ดูข้อมูลลูกค้า'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/session/FocusContractCard.tsx apps/web/src/pages/CollectionsPage/session/SkipReasonDialog.tsx
git commit -m "feat(collections-web): focus contract card + skip dialog"
```

---

## Task 11: FocusMode (state machine integrating actions + dialogs)

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/session/FocusMode.tsx`

- [ ] **Step 1: FocusMode**

Create `apps/web/src/pages/CollectionsPage/session/FocusMode.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import SessionTimer from './SessionTimer';
import SessionProgress from './SessionProgress';
import FocusContractCard from './FocusContractCard';
import SkipReasonDialog from './SkipReasonDialog';
import ContactLogDialog from '../components/ContactLogDialog';
import SendLineAdHocDialog from '../components/SendLineAdHocDialog';
import Customer360Panel from '../components/Customer360Panel';
import { useSessionActions } from '../hooks/useSessionActions';
import type { MySession, SessionContract } from '../hooks/useMySession';
import type { ContractRow } from '../types';

const DEFAULT_TARGET_MINUTES = 150;

interface Props {
  session: MySession;
  startedAt: Date;
  onPause: () => void;
}

export default function FocusMode({ session, startedAt, onPause }: Props) {
  const pending = useMemo(() => session.contracts, [session.contracts]);
  const total = pending.length + (session.summary?.total ?? 0);
  const currentIdx = (session.summary?.total ?? 0);
  const current: SessionContract | undefined = pending[0];

  const [showSkip, setShowSkip] = useState(false);
  const [contactLogContract, setContactLogContract] = useState<ContractRow | null>(null);
  const [lineDialogContract, setLineDialogContract] = useState<ContractRow | null>(null);
  const [panelContract, setPanelContract] = useState<ContractRow | null>(null);

  const { action, skip } = useSessionActions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!current) return;
      if (e.key === '3') setShowSkip(true);
      if (e.key === 'Escape') onPause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, onPause]);

  if (!current) {
    return null;
  }

  const handleCallEnded = () => {
    setContactLogContract(current.contract as unknown as ContractRow);
  };

  const handleLineSent = () => {
    action.mutate(
      { assignmentId: current.id, outcome: 'LINE_SENT' },
      {
        onSuccess: () => {
          toast.success('ส่ง LINE เรียบร้อย — ไปรายต่อไป');
        },
      },
    );
  };

  const handleSkipSubmit = (reason: any, note?: string) => {
    skip.mutate(
      { assignmentId: current.id, reason, note },
      { onSuccess: () => toast.success('ข้ามรายการแล้ว') },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <SessionProgress current={currentIdx} total={total} />
        <div className="flex items-center gap-3">
          <SessionTimer startedAt={startedAt} targetMinutes={DEFAULT_TARGET_MINUTES} />
          <Button variant="ghost" size="sm" onClick={onPause}>
            <Pause className="size-4 mr-1.5" /> หยุดพัก
          </Button>
        </div>
      </div>

      <FocusContractCard
        assignment={current}
        onCall={handleCallEnded}
        onSendLine={() => setLineDialogContract(current.contract as unknown as ContractRow)}
        onSkip={() => setShowSkip(true)}
        onOpen360={() => setPanelContract(current.contract as unknown as ContractRow)}
      />

      <SkipReasonDialog open={showSkip} onOpenChange={setShowSkip} onSubmit={handleSkipSubmit} />

      <ContactLogDialog
        open={!!contactLogContract}
        contract={contactLogContract}
        onClose={() => setContactLogContract(null)}
        onSaved={(result) => {
          const outcome = result?.outcome ?? 'CALL_CONNECTED';
          action.mutate({
            assignmentId: current.id,
            outcome,
            notes: result?.notes,
          });
          setContactLogContract(null);
        }}
      />

      <SendLineAdHocDialog
        open={!!lineDialogContract}
        contract={lineDialogContract}
        onClose={() => setLineDialogContract(null)}
        onSent={(messageId) => {
          action.mutate({
            assignmentId: current.id,
            outcome: 'LINE_SENT',
            lineMessageId: messageId,
          });
          setLineDialogContract(null);
        }}
      />

      <Customer360Panel
        contract={panelContract}
        onClose={() => setPanelContract(null)}
        onRequestSendLine={setLineDialogContract}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update ContactLogDialog interface to support `onSaved` callback (if missing)**

Open `apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx`. Verify the props interface includes `onSaved?: (result: { outcome?: string; notes?: string }) => void` and that the save handler invokes it after the existing save logic. If missing, add:

```tsx
interface Props {
  // ... existing
  onSaved?: (result: { outcome?: string; notes?: string }) => void;
}
```

In the save success handler, call `props.onSaved?.({ outcome: form.callResult, notes: form.notes })` before closing.

(Read the existing file first; if the prop already exists, no change needed.)

- [ ] **Step 3: Update SendLineAdHocDialog to support `onSent` callback**

Open `apps/web/src/pages/CollectionsPage/components/SendLineAdHocDialog.tsx`. Verify the props interface includes `onSent?: (messageId: string) => void`. If missing, add it and call after successful send.

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/session/FocusMode.tsx
git add apps/web/src/pages/CollectionsPage/components/ContactLogDialog.tsx
git add apps/web/src/pages/CollectionsPage/components/SendLineAdHocDialog.tsx
git commit -m "feat(collections-web): focus mode state machine + dialog callback wiring"
```

---

## Task 12: SessionSummary + PoolBrowser

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/session/SessionSummary.tsx`
- Create: `apps/web/src/pages/CollectionsPage/session/PoolBrowser.tsx`

- [ ] **Step 1: SessionSummary**

Create `apps/web/src/pages/CollectionsPage/session/SessionSummary.tsx`:

```tsx
import { CheckCircle2, PhoneOff, MessageCircle, Coins, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MySession } from '../hooks/useMySession';

interface Props {
  summary: NonNullable<MySession['summary']>;
  targetMinutes: number;
  onShowPool: () => void;
  onBackToHome: () => void;
}

export default function SessionSummary({ summary, targetMinutes, onShowPool, onBackToHome }: Props) {
  const delta = targetMinutes - summary.elapsedMinutes;
  const fasterText =
    delta > 0
      ? `เร็วกว่าเป้า ${delta} นาที`
      : delta < 0
        ? `ช้ากว่าเป้า ${Math.abs(delta)} นาที`
        : 'ตรงเป้า';

  return (
    <div className="rounded-2xl border border-border/50 bg-card shadow-sm p-6 sm:p-8 text-center">
      <div className="text-5xl mb-2">🎉</div>
      <div className="text-xl sm:text-2xl font-bold leading-snug mb-1">
        ทำครบทั้ง {summary.total} ราย!
      </div>
      <div className="text-sm text-muted-foreground leading-snug mb-6">ผลงานวันนี้</div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl mx-auto">
        <Stat icon={CheckCircle2} label="โทรติด" value={summary.callsConnected} color="text-success" />
        <Stat icon={PhoneOff} label="โทรไม่ติด" value={summary.callsNoAnswer} color="text-muted-foreground" />
        <Stat icon={MessageCircle} label="ส่ง LINE" value={summary.lineSent} color="text-info" />
        <Stat icon={Coins} label="ข้าม" value={summary.skipped} color="text-warning" />
        <Stat icon={Clock} label="ใช้เวลา" value={`${Math.floor(summary.elapsedMinutes / 60)}:${String(summary.elapsedMinutes % 60).padStart(2, '0')}`} color="text-foreground" />
        <div className="rounded-xl border border-border/40 bg-muted/30 px-4 py-3 flex items-center justify-center text-2xs text-muted-foreground leading-snug">
          {fasterText}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 justify-center mt-8">
        <Button variant="outline" onClick={onShowPool}>
          ดู pool กลาง
        </Button>
        <Button onClick={onBackToHome}>กลับหน้าหลัก</Button>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  color = 'text-foreground',
}: {
  icon: any;
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card px-4 py-3 flex items-center gap-3">
      <Icon className={`size-5 shrink-0 ${color}`} />
      <div className="text-left min-w-0">
        <div className="text-2xs uppercase tracking-wider text-muted-foreground/80 leading-snug">{label}</div>
        <div className="font-mono text-base font-bold tabular-nums tracking-tight leading-none">{value}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: PoolBrowser**

Create `apps/web/src/pages/CollectionsPage/session/PoolBrowser.tsx`:

```tsx
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/utils/formatters';
import { toast } from 'sonner';
import { useClaimPool, usePool } from '../hooks/usePool';

export default function PoolBrowser({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = usePool();
  const claim = useClaimPool();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const items: any[] = data ?? [];

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold leading-snug">Pool กลาง</div>
          <div className="text-2xs text-muted-foreground leading-snug">
            {items.length} รายการ — หยิบเพิ่มได้
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          ปิด
        </Button>
      </div>
      <div className="divide-y divide-border/40">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground leading-snug">
            ไม่มีงานใน pool ตอนนี้
          </div>
        ) : (
          items.map((a) => (
            <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs text-primary leading-snug">
                  {a.contract.contractNumber}
                </div>
                <div className="text-sm font-semibold truncate leading-snug">
                  {a.contract.customer.name}
                </div>
                <div className="text-2xs text-muted-foreground leading-snug">
                  ค้าง {a.contract.daysOverdue} วัน · {formatNumber(a.contract.outstanding)} ฿
                  {a.escalationFlag && (
                    <span className="ml-2 inline-flex text-destructive">⚠ Escalation</span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  claim.mutate(a.id, {
                    onSuccess: () => toast.success('หยิบงานเข้า session แล้ว'),
                    onError: () =>
                      toast.error('ไม่สามารถหยิบได้ — อาจมีคนอื่นหยิบไปก่อน'),
                  });
                }}
                disabled={claim.isPending}
              >
                หยิบ
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/session/SessionSummary.tsx apps/web/src/pages/CollectionsPage/session/PoolBrowser.tsx
git commit -m "feat(collections-web): session summary + pool browser"
```

---

## Task 13: SessionView (state machine wrapper)

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/session/SessionView.tsx`

- [ ] **Step 1: SessionView**

Create `apps/web/src/pages/CollectionsPage/session/SessionView.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMySession } from '../hooks/useMySession';
import { useSessionActions } from '../hooks/useSessionActions';
import PreStartScreen from './PreStartScreen';
import FocusMode from './FocusMode';
import SessionSummary from './SessionSummary';
import PoolBrowser from './PoolBrowser';

const TARGET_MINUTES = 150;
const STORAGE_KEY = 'collections.session.startedAt';

type Phase = 'PRE' | 'FOCUS' | 'PAUSE' | 'SUMMARY' | 'POOL';

export default function SessionView() {
  const { data, isLoading } = useMySession();
  const { start } = useSessionActions();
  const [phase, setPhase] = useState<Phase>('PRE');
  const [startedAt, setStartedAt] = useState<Date | null>(null);

  // Restore from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const d = new Date(stored);
      if (!isNaN(d.getTime())) {
        setStartedAt(d);
        setPhase('FOCUS');
      }
    }
  }, []);

  // Auto-detect summary state from server
  useEffect(() => {
    if (data?.summary && data.contracts.length === 0 && phase !== 'POOL') {
      setPhase('SUMMARY');
    }
  }, [data, phase]);

  const handleStart = () => {
    start.mutate(undefined, {
      onSuccess: () => {
        const now = new Date();
        localStorage.setItem(STORAGE_KEY, now.toISOString());
        setStartedAt(now);
        setPhase('FOCUS');
      },
    });
  };

  const handlePause = () => setPhase('PAUSE');
  const handleResume = () => setPhase('FOCUS');
  const handleBackToHome = () => {
    localStorage.removeItem(STORAGE_KEY);
    setPhase('PRE');
  };

  if (phase === 'POOL') return <PoolBrowser onClose={() => setPhase('SUMMARY')} />;

  if (phase === 'SUMMARY' && data?.summary) {
    return (
      <SessionSummary
        summary={data.summary}
        targetMinutes={TARGET_MINUTES}
        onShowPool={() => setPhase('POOL')}
        onBackToHome={handleBackToHome}
      />
    );
  }

  if ((phase === 'FOCUS' || phase === 'PAUSE') && data && startedAt) {
    if (phase === 'PAUSE') {
      return (
        <div className="rounded-xl border border-border/50 bg-card p-6 text-center">
          <div className="text-base font-semibold leading-snug mb-1">หยุดพักอยู่</div>
          <div className="text-sm text-muted-foreground leading-snug mb-4">
            กดปุ่มด้านล่างเพื่อทำงานต่อ
          </div>
          <button
            type="button"
            onClick={handleResume}
            className="rounded-lg bg-primary text-primary-foreground px-6 py-2.5 text-base font-medium"
          >
            เริ่มต่อ
          </button>
        </div>
      );
    }
    return <FocusMode session={data} startedAt={startedAt} onPause={handlePause} />;
  }

  return (
    <PreStartScreen
      data={data}
      isLoading={isLoading}
      onStart={handleStart}
      starting={start.isPending}
    />
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/session/SessionView.tsx
git commit -m "feat(collections-web): session view state machine"
```

---

## Task 14: Manage Dashboard — scaffolding + drag-drop columns

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/manage/ManageDashboard.tsx`
- Create: `apps/web/src/pages/CollectionsPage/manage/CollectorColumn.tsx`
- Create: `apps/web/src/pages/CollectionsPage/manage/PoolColumn.tsx`
- Create: `apps/web/src/pages/CollectionsPage/manage/DraggableContractTile.tsx`

- [ ] **Step 1: Verify dnd-kit is installed**

```bash
cat /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web/package.json | grep -E "@dnd-kit/(core|sortable)"
```

If missing, install:

```bash
cd apps/web && npm install @dnd-kit/core @dnd-kit/sortable
```

- [ ] **Step 2: DraggableContractTile**

Create `apps/web/src/pages/CollectionsPage/manage/DraggableContractTile.tsx`:

```tsx
import { useDraggable } from '@dnd-kit/core';
import { formatNumber } from '@/utils/formatters';

interface Props {
  assignmentId: string;
  contract: {
    contractNumber: string;
    outstanding: number;
    daysOverdue: number;
    customer: { name: string };
  };
  escalation?: boolean;
}

export default function DraggableContractTile({ assignmentId, contract, escalation }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: assignmentId,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`rounded-lg border border-border/50 bg-card px-2.5 py-1.5 cursor-grab active:cursor-grabbing select-none ${
        isDragging ? 'opacity-50 shadow-md' : ''
      } ${escalation ? 'border-destructive/40' : ''}`}
    >
      <div className="font-mono text-2xs text-primary leading-snug">{contract.contractNumber}</div>
      <div className="text-xs font-medium truncate leading-snug">{contract.customer.name}</div>
      <div className="text-2xs text-muted-foreground tabular-nums leading-snug">
        {contract.daysOverdue}ว · {formatNumber(contract.outstanding)} ฿
      </div>
    </div>
  );
}
```

- [ ] **Step 3: CollectorColumn**

Create `apps/web/src/pages/CollectionsPage/manage/CollectorColumn.tsx`:

```tsx
import { useDroppable } from '@dnd-kit/core';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DraggableContractTile from './DraggableContractTile';

interface Props {
  collector: {
    id: string;
    name: string;
    branch: { name: string } | null;
    active: boolean;
    assignments: Array<{ id: string; escalationFlag: boolean; contract: any }>;
    progress: { total: number; done: number };
  };
  locked: boolean;
  onTransferClick?: () => void;
  onCloseSessionClick?: () => void;
}

function statusColor(total: number, active: boolean): string {
  if (!active) return 'border-warning/40 bg-warning/5';
  if (total > 30) return 'border-destructive/40 bg-destructive/5';
  if (total >= 25) return 'border-warning/40 bg-warning/5';
  return 'border-border/50 bg-card';
}

export default function CollectorColumn({ collector, locked, onTransferClick, onCloseSessionClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: collector.id });
  const total = collector.assignments.length;
  const pct = total === 0 ? 0 : Math.round((collector.progress.done / total) * 100);

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border ${statusColor(total, collector.active)} ${
        isOver ? 'ring-2 ring-primary/40' : ''
      } p-3 flex flex-col gap-2 min-h-[200px]`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-snug truncate">{collector.name}</div>
          <div className="text-2xs text-muted-foreground leading-snug">
            {collector.branch?.name ?? '—'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-base font-bold tabular-nums leading-none">{total}</div>
          <div className="text-2xs text-muted-foreground leading-snug">ราย</div>
        </div>
      </div>

      {!collector.active && (
        <div className="text-2xs text-warning bg-warning/10 rounded px-2 py-1 leading-snug">
          🟡 วันนี้ไม่ active
        </div>
      )}

      {locked && total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-2xs text-muted-foreground leading-snug">
            <span>ความคืบหน้า</span>
            <span className="font-mono tabular-nums">
              {collector.progress.done}/{total} ({pct}%)
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 mt-1 max-h-[280px] overflow-y-auto">
        {collector.assignments.map((a) => (
          <DraggableContractTile
            key={a.id}
            assignmentId={a.id}
            contract={a.contract}
            escalation={a.escalationFlag}
          />
        ))}
      </div>

      {locked && (
        <div className="flex gap-1.5 mt-auto pt-2 border-t border-border/40">
          {onTransferClick && (
            <Button variant="ghost" size="sm" className="text-2xs" onClick={onTransferClick}>
              โอนคิว
            </Button>
          )}
          {onCloseSessionClick && (
            <Button variant="ghost" size="sm" className="text-2xs text-destructive" onClick={onCloseSessionClick}>
              ปิด session
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: PoolColumn**

Create `apps/web/src/pages/CollectionsPage/manage/PoolColumn.tsx`:

```tsx
import { useDroppable } from '@dnd-kit/core';
import DraggableContractTile from './DraggableContractTile';

interface Props {
  items: Array<{ id: string; contract: any }>;
  escalation: Array<{ id: string; contract: any }>;
}

export default function PoolColumn({ items, escalation }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: '__pool__' });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border border-dashed border-border bg-muted/20 p-3 flex flex-col gap-2 min-h-[200px] ${
        isOver ? 'ring-2 ring-primary/40 bg-primary/5' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold leading-snug">Pool กลาง</div>
          <div className="text-2xs text-muted-foreground leading-snug">
            {items.length + escalation.length} รายการ ({escalation.length} escalation)
          </div>
        </div>
      </div>

      {escalation.length > 0 && (
        <div className="space-y-1">
          <div className="text-2xs uppercase tracking-wider text-destructive font-semibold leading-snug">
            ⚠ Escalation
          </div>
          {escalation.map((a) => (
            <DraggableContractTile key={a.id} assignmentId={a.id} contract={a.contract} escalation />
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-1 mt-1">
          {items.map((a) => (
            <DraggableContractTile key={a.id} assignmentId={a.id} contract={a.contract} />
          ))}
        </div>
      )}

      {items.length === 0 && escalation.length === 0 && (
        <div className="text-2xs text-muted-foreground text-center py-4 leading-snug">
          Pool ว่าง
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: ManageDashboard**

Create `apps/web/src/pages/CollectionsPage/manage/ManageDashboard.tsx`:

```tsx
import { useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import CollectorColumn from './CollectorColumn';
import PoolColumn from './PoolColumn';
import TransferDialog from './TransferDialog';
import CloseSessionDialog from './CloseSessionDialog';
import { useManagerBoard, useManageActions } from '../hooks/useManagerBoard';

export default function ManageDashboard() {
  useDocumentTitle('แบ่งคิวงาน');
  const { data, isLoading } = useManagerBoard();
  const { assign, lock, autoBalance } = useManageActions();
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const [closeFor, setCloseFor] = useState<string | null>(null);

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const assignmentId = String(e.active.id);
    const target = String(e.over.id);
    const toCollectorId = target === '__pool__' ? null : target;
    assign.mutate(
      { assignmentId, toCollectorId },
      {
        onSuccess: () => toast.success('ย้ายสำเร็จ'),
        onError: () => toast.error('ย้ายไม่สำเร็จ'),
      },
    );
  };

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title="แบ่งคิวงาน" subtitle="กำหนดงานเก็บเงินรายวัน" />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const lockedAt = data.lockedAt ? new Date(data.lockedAt) : null;

  return (
    <div>
      <PageHeader
        title="แบ่งคิวงาน"
        subtitle={
          lockedAt
            ? `Locked ตอน ${lockedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`
            : 'Auto-assigned 06:00 — Lock 09:00'
        }
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                autoBalance.mutate(undefined, {
                  onSuccess: () => toast.success('Re-balance เรียบร้อย'),
                })
              }
              disabled={autoBalance.isPending}
            >
              🔄 Auto-balance ใหม่
            </Button>
            {!lockedAt && (
              <Button
                onClick={() =>
                  lock.mutate(undefined, {
                    onSuccess: () => toast.success('Lock & ส่งคิวเรียบร้อย'),
                  })
                }
                disabled={lock.isPending}
              >
                ✓ Lock & ส่งคิว
              </Button>
            )}
          </div>
        }
      />

      <DndContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {data.collectors.map((c: any) => (
            <CollectorColumn
              key={c.id}
              collector={c}
              locked={!!lockedAt}
              onTransferClick={lockedAt ? () => setTransferFrom(c.id) : undefined}
              onCloseSessionClick={lockedAt ? () => setCloseFor(c.id) : undefined}
            />
          ))}
          <PoolColumn items={data.pool.items} escalation={data.pool.escalation} />
        </div>
      </DndContext>

      <TransferDialog
        fromCollectorId={transferFrom}
        collectors={data.collectors}
        onClose={() => setTransferFrom(null)}
      />
      <CloseSessionDialog collectorId={closeFor} onClose={() => setCloseFor(null)} />
    </div>
  );
}
```

- [ ] **Step 6: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/manage/ManageDashboard.tsx apps/web/src/pages/CollectionsPage/manage/CollectorColumn.tsx apps/web/src/pages/CollectionsPage/manage/PoolColumn.tsx apps/web/src/pages/CollectionsPage/manage/DraggableContractTile.tsx
git commit -m "feat(collections-web): manage dashboard board + drag-drop columns"
```

---

## Task 15: TransferDialog + CloseSessionDialog

**Files:**
- Create: `apps/web/src/pages/CollectionsPage/manage/TransferDialog.tsx`
- Create: `apps/web/src/pages/CollectionsPage/manage/CloseSessionDialog.tsx`

- [ ] **Step 1: TransferDialog**

Create `apps/web/src/pages/CollectionsPage/manage/TransferDialog.tsx`:

```tsx
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useManageActions } from '../hooks/useManagerBoard';

interface Props {
  fromCollectorId: string | null;
  collectors: Array<{ id: string; name: string; assignments: any[] }>;
  onClose: () => void;
}

export default function TransferDialog({ fromCollectorId, collectors, onClose }: Props) {
  const { transfer } = useManageActions();
  const [toId, setToId] = useState('');
  const [count, setCount] = useState(5);

  const fromName = collectors.find((c) => c.id === fromCollectorId)?.name ?? '';
  const others = collectors.filter((c) => c.id !== fromCollectorId);

  const submit = () => {
    if (!fromCollectorId || !toId) return;
    transfer.mutate(
      { fromCollectorId, toCollectorId: toId, count },
      {
        onSuccess: (res: any) => {
          toast.success(`โอน ${res?.data?.moved ?? count} รายการแล้ว`);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={!!fromCollectorId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>โอนคิวจาก {fromName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>โอนไปให้</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger>
                <SelectValue placeholder="เลือกพนักงาน" />
              </SelectTrigger>
              <SelectContent>
                {others.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.assignments.length} ราย)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>จำนวน</Label>
            <Input
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={submit} disabled={!toId || transfer.isPending}>
            โอน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: CloseSessionDialog**

Create `apps/web/src/pages/CollectionsPage/manage/CloseSessionDialog.tsx`:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useManageActions } from '../hooks/useManagerBoard';

interface Props {
  collectorId: string | null;
  onClose: () => void;
}

export default function CloseSessionDialog({ collectorId, onClose }: Props) {
  const { closeSession } = useManageActions();
  return (
    <AlertDialog open={!!collectorId} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ปิด session ของพนักงาน?</AlertDialogTitle>
          <AlertDialogDescription>
            คิวที่ยังไม่ทำจะถูกย้ายไปที่ pool กลาง — ใช้กรณีฉุกเฉิน เช่น พนักงานป่วย
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!collectorId) return;
              closeSession.mutate(collectorId, {
                onSuccess: () => {
                  toast.success('ปิด session แล้ว');
                  onClose();
                },
              });
            }}
          >
            ปิด session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 3: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/manage/TransferDialog.tsx apps/web/src/pages/CollectionsPage/manage/CloseSessionDialog.tsx
git commit -m "feat(collections-web): transfer dialog + close session dialog"
```

---

## Task 16: Integrate toggle in CollectionsPage + add Manage route

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/index.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add toggle to CollectionsPage**

Modify `apps/web/src/pages/CollectionsPage/index.tsx` — replace the top of the component body (after `useState` for `activeTab`) with toggle logic:

Add imports:
```tsx
import SessionView from './session/SessionView';
import { useViewToggle } from './hooks/useViewToggle';
import { Button } from '@/components/ui/button';
```

Inside the component, after the `useDocumentTitle` line:
```tsx
const { view, setView } = useViewToggle();
```

Replace the existing `return ( <div> ... </div> )` outer JSX with:

```tsx
return (
  <div>
    <PageHeader
      title="ติดตามหนี้"
      subtitle={view === 'SESSION' ? 'คิวงานวันนี้ของคุณ' : 'รายการสัญญาทั้งหมด'}
      actions={
        <div className="inline-flex items-center rounded-lg border border-border/50 bg-card p-0.5 text-2xs">
          <Button
            type="button"
            size="sm"
            variant={view === 'SESSION' ? 'default' : 'ghost'}
            className="h-7 px-3"
            onClick={() => setView('SESSION')}
          >
            Session
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'LIBRARY' ? 'default' : 'ghost'}
            className="h-7 px-3"
            onClick={() => setView('LIBRARY')}
          >
            Library
          </Button>
        </div>
      }
    />

    <MigrationBanner />

    {view === 'SESSION' ? (
      <SessionView />
    ) : (
      <>
        <CollectionsHeader onSwitchToToday={() => setActiveTab('today')} />
        <CollectionsTabs
          active={effectiveTab}
          onChange={(key) => {
            setActiveTab(key);
            setSearch('');
            setBranchId('');
          }}
          canSeeApproval={canSeeApproval}
          canSeeAnalytics={canSeeAnalytics}
        />
        {/* keep existing tab body unchanged */}
        {showFilters && (
          <CollectionsFilters
            search={search}
            onSearchChange={setSearch}
            branchId={branchId}
            onBranchChange={setBranchId}
            showBranchFilter={showBranchFilter}
          />
        )}
        {effectiveTab === 'today' && (
          <QueueTab
            search={search}
            branchId={branchId}
            onLogContact={openContactDialog}
            onOpen360={openPanel}
            onSendLine={setLineDialogContract}
            onSkipTrace={setSkipTraceContract}
            onSwitchTab={(tab) => setActiveTab(tab as CollectionsTabKey)}
          />
        )}
        {effectiveTab === 'followup' && (
          <FollowUpTab
            search={search}
            branchId={branchId}
            onLogContact={openContactDialog}
            onOpen360={openPanel}
            onSendLine={setLineDialogContract}
            onSkipTrace={setSkipTraceContract}
          />
        )}
        {effectiveTab === 'promise' && (
          <PromiseTab
            search={search}
            branchId={branchId}
            onLogContact={openContactDialog}
            onOpen360={openPanel}
            onSendLine={setLineDialogContract}
            onSkipTrace={setSkipTraceContract}
          />
        )}
        {effectiveTab === 'approval' && canSeeApproval && <ApprovalTab />}
        {effectiveTab === 'all' && <AllTab />}
        {effectiveTab === 'analytics' && canSeeAnalytics && <AnalyticsTab />}
      </>
    )}

    <ContactLogDialog
      open={!!dialogContract}
      contract={dialogContract}
      onClose={() => setDialogContract(null)}
    />
    <SendLineAdHocDialog
      open={!!lineDialogContract}
      contract={lineDialogContract}
      onClose={() => setLineDialogContract(null)}
    />
    <Customer360Panel
      contract={panelContract}
      onClose={closePanel}
      onRequestSendLine={setLineDialogContract}
    />
    <SkipTracingWizard
      open={!!skipTraceContract}
      contract={skipTraceContract}
      onClose={() => setSkipTraceContract(null)}
    />
  </div>
);
```

- [ ] **Step 2: Add /collections/manage route**

Open `apps/web/src/App.tsx`. Find the existing `/collections` route. Add a new lazy import + route:

```tsx
const ManageDashboard = lazy(() => import('./pages/CollectionsPage/manage/ManageDashboard'));
```

Add inside the routes (under `<MainLayout>` and `<ProtectedRoute>`):

```tsx
<Route path="/collections/manage" element={<ManageDashboard />} />
```

- [ ] **Step 3: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/index.tsx apps/web/src/App.tsx
git commit -m "feat(collections-web): toggle Session/Library + Manage route"
```

---

## Task 17: Default redirect for OWNER/MANAGER → /collections/manage

**Files:**
- Modify: `apps/web/src/pages/CollectionsPage/index.tsx`

- [ ] **Step 1: Add role-based redirect**

In `apps/web/src/pages/CollectionsPage/index.tsx`, near the top of the component (right after `useAuth`), add:

```tsx
import { useNavigate } from 'react-router-dom';
// ...
const navigate = useNavigate();
useEffect(() => {
  if (
    user?.role &&
    ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(user.role) &&
    !user.preferences?.collectionsDefaultView
  ) {
    navigate('/collections/manage', { replace: true });
  }
}, [user, navigate]);
```

(Add `import { useEffect } from 'react'` if not present.)

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh web 2>&1 | tail -5
git add apps/web/src/pages/CollectionsPage/index.tsx
git commit -m "feat(collections-web): default OWNER/MANAGER to /collections/manage"
```

---

## Task 18: E2E smoke test for full session flow

**Files:**
- Create: `apps/web/e2e/collections-session.spec.ts`

- [ ] **Step 1: Write E2E spec**

Create `apps/web/e2e/collections-session.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Collections Guided Session', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'sales1@bestchoice.com');
    await page.fill('input[name="password"]', 'admin1234');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\//);
  });

  test('SALES sees pre-start screen with start button', async ({ page }) => {
    await page.goto('/collections');
    await expect(page.getByRole('button', { name: /เริ่มงานเก็บเงิน/ })).toBeVisible({ timeout: 10000 });
  });

  test('toggle to Library shows the existing tabs', async ({ page }) => {
    await page.goto('/collections');
    await page.getByRole('button', { name: 'Library' }).click();
    await expect(page.getByText('คิววันนี้').first()).toBeVisible();
    await expect(page.getByText('นัดชำระ').first()).toBeVisible();
  });

  test('OWNER lands on manage dashboard', async ({ page }) => {
    await page.goto('/api/auth/logout').catch(() => {});
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin@bestchoice.com');
    await page.fill('input[name="password"]', 'admin1234');
    await page.click('button[type="submit"]');
    await page.goto('/collections');
    await expect(page).toHaveURL(/\/collections\/manage/);
    await expect(page.getByText(/แบ่งคิวงาน/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
cd apps/web && npx playwright test e2e/collections-session.spec.ts --reporter=list 2>&1 | tail -20
```

Expected: all 3 tests PASS (pre-conditions: API running, DB has DailyAssignment seeded for sales1 — if not, the start button visibility may not show; the test still passes structurally if seed exists).

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/collections-session.spec.ts
git commit -m "test(collections): E2E smoke for session flow + role-based default"
```

---

## Task 19: Final integration pass — full type check + tests

- [ ] **Step 1: Full type check (api + web)**

```bash
./tools/check-types.sh all 2>&1 | tail -10
```

Expected: Both API and Web report `OK`.

- [ ] **Step 2: Run all backend tests**

```bash
cd apps/api && npx jest --no-coverage 2>&1 | tail -10
```

Expected: All tests PASS. Total count includes the 11+ new tests added (auto-assign × 6, pool × 2, session × 3, manage × 2 = 13 new).

- [ ] **Step 3: Run all web tests**

```bash
cd apps/web && npx vitest run 2>&1 | tail -10
```

Expected: All tests PASS.

- [ ] **Step 4: Final commit (if anything left)**

```bash
git status
git log --oneline -25
```

If clean, no commit needed.

---

## Summary

**Backend:**
- 1 Prisma migration (DailyAssignment + User additions)
- 2 modules: `collections-session` (session, pool, auto-assign, cron) + `collections-manage` (dashboard, transfer, lock)
- 4 cron jobs (auto-assign 06:00, auto-lock 09:00, pool-expiry */15min 9-20h, summary 18:00)
- 12 API endpoints (6 session + 6 manage)
- 13+ unit tests covering algorithm scenarios + service behavior

**Frontend:**
- 5 hooks (`useViewToggle`, `useMySession`, `useSessionActions`, `usePool`, `useManagerBoard`)
- 9 session components (PreStartScreen, FocusMode, FocusContractCard, SessionTimer, SessionProgress, SkipReasonDialog, SessionSummary, PoolBrowser, SessionView)
- 6 manage components (ManageDashboard, CollectorColumn, PoolColumn, DraggableContractTile, TransferDialog, CloseSessionDialog)
- Existing tabs preserved as Library mode behind toggle
- Role-aware default: SALES → Session, OWNER/MANAGER → /collections/manage, ACCOUNTANT → Library
- E2E smoke test

**Test plan:**
- [ ] Unit tests for auto-assign algorithm scenarios pass
- [ ] Unit tests for pool claim conflict pass
- [ ] Unit tests for session action+skip flows pass
- [ ] Unit tests for manage transfer pass
- [ ] Type check (`./tools/check-types.sh all`) passes
- [ ] E2E: SALES login → /collections shows pre-start screen
- [ ] E2E: Library toggle shows existing tabs
- [ ] E2E: OWNER login → /collections redirects to /collections/manage
- [ ] Manual: cron run produces expected DailyAssignment rows
- [ ] Manual: drag-drop on Manage dashboard moves a contract between collectors
- [ ] Manual: SALES completes a session and sees the Summary screen

---

## Self-Review

**Spec coverage:**
- ✅ Session view (pre-start, focus, summary) — Tasks 9, 10, 11, 12, 13
- ✅ Auto-assign cron + algorithm — Tasks 2, 3
- ✅ Manager dashboard — Tasks 6, 14, 15
- ✅ Library fallback — Task 16 (toggle)
- ✅ DailyAssignment data model — Task 1
- ✅ User.collectionsActive + preferences — Tasks 1, 7
- ✅ All 12+ API endpoints — Tasks 4, 5, 6
- ✅ 4 cron jobs — Task 3
- ✅ Pool claim with 2hr lock + expiry — Tasks 4, 3
- ✅ Self-claim from pool — Task 4
- ✅ Drag-drop assignment — Tasks 14
- ✅ Transfer + close session — Task 15
- ✅ Auto-balance button — Task 14
- ✅ Lock & ส่งคิว button — Task 14
- ✅ Role-based default view — Task 17
- ✅ Toggle persistence — Tasks 7, 8

**Placeholder scan:** None.

**Type consistency:**
- `MySession.target.etaMinutes` matches usage in PreStartScreen
- `SessionContract` shape used in FocusContractCard matches the API response shape
- `Outcome` enum values match backend `AssignmentOutcome` enum
- `SkipReason` values match backend `SkipReason` enum
- Drag-drop uses `assignmentId` (DailyAssignment.id) consistently

**Scope:** Single cohesive plan for Phase 1 (build). Phase 2 (soft launch with แนน/กวาง/ตุ๊กตา) and Phase 3 (mobile/keyboard/notifications) are intentionally deferred and will get their own plans.
