# Consecutive-Missed → ECL Signal Implementation Plan (Spec Section #1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a contract's consecutive non-full-paid installment streak escalate (never lower) its ECL provision bucket, computed by **deriving** the streak (no persisted counter).

**Architecture:** Extract the consecutive-missed SQL CTE that already lives inline in the overdue cron into one shared `ConsecutiveMissedService`. The cron consumes it (behaviour-preserving). `BadDebtService` consumes the same service to floor each contract's aging bucket with a streak-derived bucket via `max(severity)` — applied in BOTH the provisioning path and the on-payment reversal path so they stay consistent. No schema change, no migration, no increment/reset wiring.

**Tech Stack:** NestJS, Prisma (PostgreSQL, `@Global` PrismaModule), vitest (DB-backed specs).

## Global Constraints

- Money is `Prisma.Decimal` / `Decimal` — never `Number()` on sums (CLAUDE.md backend rules).
- Soft-delete aware: every contract/payment query filters `deletedAt: null`.
- One streak definition only — `bad-debt.service` and `overdue-cron` MUST call the same method; no second copy of the CTE (spec Risk #4).
- Bucket strings are exactly `'1-30' | '31-60' | '61-90' | '91-180' | '180+'` (B1–B5), matching `BadDebtService.getAgingBucket`.
- Severity is compared by **provision rate** (B1 2% < B2 15% < B3 50% < B4 75% < B5 100%) — reuse the existing rate ordering, do not invent a parallel order.
- Spec ref: `docs/superpowers/specs/2026-06-25-payment-recording-doc-code-alignment-design.md` §Section 1.

---

## File Structure

- **Create** `apps/api/src/modules/overdue/consecutive-missed.service.ts` — the single streak query.
- **Create** `apps/api/src/modules/overdue/consecutive-missed.module.ts` — exports the service (deps: global `PrismaService`); imported by both `OverdueModule` and `AccountingModule` (no cycle — pulls only the one provider).
- **Create** `apps/api/src/modules/overdue/consecutive-missed.service.spec.ts` — DB-backed streak tests.
- **Modify** `apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts:84-202` — `updateContractStatuses` consumes the service instead of the inline CTE.
- **Modify** `apps/api/src/modules/overdue/overdue.module.ts` — import `ConsecutiveMissedModule`.
- **Modify** `apps/api/src/modules/accounting/bad-debt.service.ts` — streak→bucket map, `effectiveBucket`, apply in `calculateProvisions` + `reverseStageOnPayment`.
- **Modify** `apps/api/src/modules/accounting/accounting.module.ts` — import `ConsecutiveMissedModule`.
- **Modify** `apps/api/src/modules/installments/reschedule.service.ts:118-126` — delete the dead `consecutiveMissed` reset.

---

### Task 1: `ConsecutiveMissedService` — the single streak definition

**Files:**
- Create: `apps/api/src/modules/overdue/consecutive-missed.service.ts`
- Create: `apps/api/src/modules/overdue/consecutive-missed.module.ts`
- Test: `apps/api/src/modules/overdue/consecutive-missed.service.spec.ts`

**Interfaces:**
- Produces: `ConsecutiveMissedService.getStreaks(opts: { contractIds?: string[]; statuses?: string[] }, asOf: Date, client?: Prisma.TransactionClient | PrismaService): Promise<Map<string, number>>` — returns `contractId → max consecutive run of unpaid-overdue installments` (only runs ≥ 1 appear). When `contractIds` is provided-but-empty, returns an empty Map without querying.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/overdue/consecutive-missed.service.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { ConsecutiveMissedService } from './consecutive-missed.service';

const prisma = new PrismaClient();

/** Force payment statuses + dueDates so installments 2,3,4 are unpaid-overdue
 *  (a run of 3) while 1 and 5 are PAID — expected streak = 3. */
async function seedStreak(contractId: string, now: Date) {
  const payments = await prisma.payment.findMany({
    where: { contractId }, orderBy: { installmentNo: 'asc' },
  });
  const past = (d: number) => new Date(now.getTime() - d * 86_400_000);
  for (const p of payments) {
    if ([2, 3, 4].includes(p.installmentNo)) {
      await prisma.payment.update({
        where: { id: p.id },
        data: { status: 'PENDING', dueDate: past(20 * (5 - p.installmentNo) + 5) },
      });
    } else {
      await prisma.payment.update({ where: { id: p.id }, data: { status: 'PAID' } });
    }
  }
}

describe('ConsecutiveMissedService.getStreaks', () => {
  let svc: ConsecutiveMissedService;
  let contractId: string;
  const now = new Date('2026-06-25T00:00:00Z');

  beforeAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });
    await seedStreak(contractId, now);
    svc = new ConsecutiveMissedService(prisma as any);
  });

  it('derives the longest unpaid-overdue run (paid installments break it)', async () => {
    const streaks = await svc.getStreaks({ contractIds: [contractId] }, now);
    expect(streaks.get(contractId)).toBe(3);
  });

  it('returns an empty map for an empty contractIds list (no query)', async () => {
    const streaks = await svc.getStreaks({ contractIds: [] }, now);
    expect(streaks.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/overdue/consecutive-missed.service.spec.ts`
Expected: FAIL — `Cannot find module './consecutive-missed.service'`.

- [ ] **Step 3: Write the service**

```ts
// apps/api/src/modules/overdue/consecutive-missed.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

@Injectable()
export class ConsecutiveMissedService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single source of truth for the consecutive-missed streak (moved VERBATIM
   * from overdue-lifecycle-cron's inline CTE, then parameterised). Returns
   * `contractId -> max run of consecutive unpaid-overdue installments`.
   * "Unpaid-overdue" = status IN (PENDING, OVERDUE, PARTIALLY_PAID) AND due_date < asOf.
   * Only contracts with a run >= 1 appear in the map.
   */
  async getStreaks(
    opts: { contractIds?: string[]; statuses?: string[] },
    asOf: Date,
    client: Client = this.prisma,
  ): Promise<Map<string, number>> {
    if (opts.contractIds && opts.contractIds.length === 0) return new Map();

    const statusFilter = opts.statuses?.length
      ? Prisma.sql`AND c."status"::text IN (${Prisma.join(opts.statuses)})`
      : Prisma.empty;
    const idFilter = opts.contractIds?.length
      ? Prisma.sql`AND p."contract_id" IN (${Prisma.join(opts.contractIds)})`
      : Prisma.empty;

    const rows = await client.$queryRaw<{ id: string; consecutive: number }[]>(Prisma.sql`
      WITH payment_streaks AS (
        SELECT
          p."contract_id",
          p."installment_no",
          p."status",
          p."due_date",
          ROW_NUMBER() OVER (PARTITION BY p."contract_id" ORDER BY p."installment_no") -
          ROW_NUMBER() OVER (PARTITION BY p."contract_id",
            CASE WHEN p."status" IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID') AND p."due_date" < ${asOf}
                 THEN 1 ELSE 0 END
            ORDER BY p."installment_no") AS grp
        FROM "payments" p
        JOIN "contracts" c ON c."id" = p."contract_id"
        WHERE c."deleted_at" IS NULL ${statusFilter} ${idFilter}
      ),
      max_consecutive AS (
        SELECT "contract_id" AS id, MAX(cnt) AS consecutive
        FROM (
          SELECT "contract_id", grp, COUNT(*) AS cnt
          FROM payment_streaks
          WHERE "status" IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID') AND "due_date" < ${asOf}
          GROUP BY "contract_id", grp
        ) sub
        GROUP BY "contract_id"
      )
      SELECT id, consecutive::int FROM max_consecutive WHERE consecutive >= 1
    `);

    return new Map(rows.map((r) => [r.id, r.consecutive]));
  }
}
```

- [ ] **Step 4: Write the module**

```ts
// apps/api/src/modules/overdue/consecutive-missed.module.ts
import { Module } from '@nestjs/common';
import { ConsecutiveMissedService } from './consecutive-missed.service';

@Module({
  providers: [ConsecutiveMissedService],
  exports: [ConsecutiveMissedService],
})
export class ConsecutiveMissedModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/overdue/consecutive-missed.service.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/overdue/consecutive-missed.service.ts apps/api/src/modules/overdue/consecutive-missed.module.ts apps/api/src/modules/overdue/consecutive-missed.service.spec.ts
git commit -m "feat(overdue): extract consecutive-missed streak into one shared service"
```

---

### Task 2: Cron consumes the shared service (behaviour-preserving)

**Files:**
- Modify: `apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts:18-21,170-202`
- Modify: `apps/api/src/modules/overdue/overdue.module.ts` (imports)
- Test: `apps/api/src/modules/overdue/services/overdue-lifecycle-cron.consecutive.spec.ts`

**Interfaces:**
- Consumes: `ConsecutiveMissedService.getStreaks` (Task 1).

- [ ] **Step 1: Write the failing characterization test**

```ts
// apps/api/src/modules/overdue/services/overdue-lifecycle-cron.consecutive.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../consecutive-missed.service';

const prisma = new PrismaClient();

describe('updateContractStatuses — DEFAULT flip unchanged after refactor', () => {
  let contractId: string;
  const now = new Date();

  beforeAll(async () => {
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    if (!(await prisma.user.findFirst({ where: { isSystemUser: true } }))) {
      await prisma.user.create({
        data: { email: 'sys@bestchoice.com', password: 'x', name: 'sys', role: 'OWNER', isSystemUser: true },
      });
    }
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });
    // Installments 1 and 2 unpaid-overdue (a run of 2) → must flip to DEFAULT.
    const ps = await prisma.payment.findMany({ where: { contractId }, orderBy: { installmentNo: 'asc' } });
    for (const p of ps) {
      const overdue = [1, 2].includes(p.installmentNo);
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          status: overdue ? 'PENDING' : 'PAID',
          dueDate: overdue ? new Date(now.getTime() - p.installmentNo * 5 * 86_400_000) : p.dueDate,
        },
      });
    }
  });

  it('flips a contract with >=2 consecutive missed to DEFAULT', async () => {
    const svc = new OverdueLifecycleCronService(prisma as any, new ConsecutiveMissedService(prisma as any));
    await svc.updateContractStatuses();
    const c = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(c!.status).toBe('DEFAULT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/overdue/services/overdue-lifecycle-cron.consecutive.spec.ts`
Expected: FAIL — `OverdueLifecycleCronService` constructor currently takes 1 arg (`prisma`), so passing the 2nd arg is a type error / the new field is undefined.

- [ ] **Step 3: Inject the service into the cron**

In `overdue-lifecycle-cron.service.ts`, add the import and constructor param:

```ts
import { ConsecutiveMissedService } from '../consecutive-missed.service';
// ...
  constructor(
    private prisma: PrismaService,
    private consecutiveMissed: ConsecutiveMissedService,
  ) {}
```

- [ ] **Step 4: Replace the inline CTE with the shared service**

In `updateContractStatuses`, replace the whole `const defaultCandidates: ... = await this.prisma.$queryRaw\`...\`` block (lines ~172-202) with:

```ts
    // Step 2: OVERDUE → DEFAULT (2+ consecutive missed payments).
    // Streak derivation lives in ConsecutiveMissedService (single source of truth).
    const streaks = await this.consecutiveMissed.getStreaks({ statuses: ['OVERDUE'] }, now);
    const defaultCandidates: { id: string; consecutive: number }[] = [...streaks.entries()]
      .filter(([, consecutive]) => consecutive >= 2)
      .map(([id, consecutive]) => ({ id, consecutive }));
```

(The downstream `defaultIds` / `updateMany` / `auditLog` block at lines 204+ is unchanged — it already consumes `defaultCandidates`.)

- [ ] **Step 5: Register the module**

In `overdue.module.ts`, add `ConsecutiveMissedModule` to `imports`:

```ts
import { ConsecutiveMissedModule } from './consecutive-missed.module';
// ...
  imports: [ChatEngineModule, NotificationsModule, LineOaModule, ConsecutiveMissedModule, forwardRef(() => PaymentsModule)],
```

- [ ] **Step 6: Run the characterization test + the existing overdue suite**

Run: `cd apps/api && npx vitest run src/modules/overdue/services/overdue-lifecycle-cron.consecutive.spec.ts src/modules/overdue`
Expected: PASS (new test + no regressions in existing overdue specs).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts apps/api/src/modules/overdue/overdue.module.ts apps/api/src/modules/overdue/services/overdue-lifecycle-cron.consecutive.spec.ts
git commit -m "refactor(overdue): cron consumes shared ConsecutiveMissedService (behaviour-preserving)"
```

---

### Task 3: Streak→bucket map + `effectiveBucket` in BadDebtService

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts:23-41` (imports/ctor) + add private helpers
- Modify: `apps/api/src/modules/accounting/accounting.module.ts` (imports)
- Test: `apps/api/src/modules/accounting/bad-debt.streak-bucket.spec.ts`

**Interfaces:**
- Consumes: `ConsecutiveMissedService` (Task 1).
- Produces (private, used by Tasks 4-5):
  - `streakToBucket(streak: number): string | null` — `<2 → null`, `2 → '31-60'`, `3 → '61-90'`, `4 → '91-180'`, `>=5 → '180+'` (defaults; overridable via SystemConfig `consecutive_missed_bucket_map`).
  - `effectiveBucket(agingBucket: string, streakBucket: string | null, rates: Record<string, number>): string` — returns whichever of the two has the higher provision rate (aging wins ties / when streakBucket null).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/accounting/bad-debt.streak-bucket.spec.ts
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BadDebtService } from './bad-debt.service';
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';

const prisma = new PrismaClient();
// Helper services unused by these pure-method tests; pass undefined-safe stubs.
const svc = new BadDebtService(
  prisma as any, undefined as any, undefined as any, undefined as any, undefined as any,
  new ConsecutiveMissedService(prisma as any),
);
const RATES = { '1-30': 0.02, '31-60': 0.15, '61-90': 0.5, '91-180': 0.75, '180+': 1.0 };

describe('streakToBucket / effectiveBucket', () => {
  it('maps streak counts to floor buckets (default map)', () => {
    expect((svc as any).streakToBucket(1)).toBeNull();
    expect((svc as any).streakToBucket(2)).toBe('31-60');
    expect((svc as any).streakToBucket(3)).toBe('61-90');
    expect((svc as any).streakToBucket(7)).toBe('180+');
  });

  it('takes the more-severe bucket by rate', () => {
    // aging low (B1 2%), streak floor B3 50% → B3 wins
    expect((svc as any).effectiveBucket('1-30', '61-90', RATES)).toBe('61-90');
    // aging high (B4 75%), streak floor B2 15% → aging wins
    expect((svc as any).effectiveBucket('91-180', '31-60', RATES)).toBe('91-180');
    // no streak floor → aging unchanged
    expect((svc as any).effectiveBucket('1-30', null, RATES)).toBe('1-30');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/accounting/bad-debt.streak-bucket.spec.ts`
Expected: FAIL — `BadDebtService` constructor has 5 args (no `ConsecutiveMissedService`); `streakToBucket` is not a function.

- [ ] **Step 3: Add the ctor dep + the two helpers**

In `bad-debt.service.ts`, import and add to the constructor:

```ts
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';
// ...
  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    private badDebtProvisionTemplate: BadDebtProvisionTemplate,
    private badDebtWriteOffTemplate: BadDebtWriteOffTemplate,
    private eclStageReverseTemplate: EclStageReverseTemplate,
    private consecutiveMissed: ConsecutiveMissedService,
  ) {}
```

Add a default map constant near `DEFAULT_PROVISION_RATES`:

```ts
// streak count -> minimum aging bucket it floors the provision to (CPA spec §1).
// Threshold = the largest key <= streak. Streak 0-1 → no floor (aging only).
const DEFAULT_STREAK_BUCKET_MAP: Record<string, string> = {
  '2': '31-60',  // B2
  '3': '61-90',  // B3
  '4': '91-180', // B4
  '5': '180+',   // B5
};
```

Add the two private methods (place them next to `getAgingBucket`):

```ts
  /** Load streak→bucket map from SystemConfig or use defaults. */
  private async getStreakBucketMap(): Promise<Record<string, string>> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'consecutive_missed_bucket_map' },
    });
    if (config) {
      try {
        return JSON.parse(config.value);
      } catch (err) {
        Sentry.captureException(err, {
          level: 'error',
          tags: { subsystem: 'bad-debt', key: 'consecutive_missed_bucket_map' },
        });
        this.logger.error('Corrupt consecutive_missed_bucket_map — using defaults');
      }
    }
    return DEFAULT_STREAK_BUCKET_MAP;
  }

  /** Floor bucket for a streak: the entry whose threshold is the largest <= streak. */
  private streakToBucket(streak: number, map = DEFAULT_STREAK_BUCKET_MAP): string | null {
    let best: string | null = null;
    let bestThreshold = -1;
    for (const [k, bucket] of Object.entries(map)) {
      const threshold = Number(k);
      if (streak >= threshold && threshold > bestThreshold) {
        bestThreshold = threshold;
        best = bucket;
      }
    }
    return best;
  }

  /** Of (aging, streak-floor) buckets, return the one with the higher provision rate. */
  private effectiveBucket(
    agingBucket: string,
    streakBucket: string | null,
    rates: Record<string, number>,
  ): string {
    if (!streakBucket) return agingBucket;
    return (rates[streakBucket] || 0) > (rates[agingBucket] || 0) ? streakBucket : agingBucket;
  }
```

(Note: `streakToBucket`'s signature keeps the default map so the pure unit test in Step 1 passes without DB; Task 4 passes the config-loaded map.)

- [ ] **Step 4: Register the module dep**

In `accounting.module.ts`, add `ConsecutiveMissedModule` to `imports`:

```ts
import { ConsecutiveMissedModule } from '../overdue/consecutive-missed.module';
// ... add ConsecutiveMissedModule to the @Module({ imports: [...] }) array
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/accounting/bad-debt.streak-bucket.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/accounting/accounting.module.ts apps/api/src/modules/accounting/bad-debt.streak-bucket.spec.ts
git commit -m "feat(bad-debt): streak->bucket map + effectiveBucket (max-severity) helpers"
```

---

### Task 4: Apply the streak floor in `calculateProvisions`

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts:183-208`
- Test: `apps/api/src/modules/accounting/bad-debt.streak-provision.spec.ts`

**Interfaces:**
- Consumes: `getStreaks` (Task 1), `streakToBucket` / `effectiveBucket` / `getStreakBucketMap` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/accounting/bad-debt.streak-provision.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { BadDebtService } from './bad-debt.service';
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { BadDebtProvisionTemplate } from '../journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';

const prisma = new PrismaClient();

function build() {
  const journal = new JournalAutoService(prisma as any);
  return new BadDebtService(
    prisma as any, journal,
    new BadDebtProvisionTemplate(journal, prisma as any),
    new BadDebtWriteOffTemplate(journal, prisma as any),
    new EclStageReverseTemplate(journal, prisma as any),
    new ConsecutiveMissedService(prisma as any),
  );
}

describe('calculateProvisions — streak floors a low-aging contract', () => {
  let contractId: string;

  beforeAll(async () => {
    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);
    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'a', role: 'OWNER' } });
    }
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });
    // 3 consecutive unpaid-overdue installments, but each only ~10-14 days overdue
    // → aging = B1 (1-30, 2%), streak = 3 → floor B3 (61-90, 50%).
    const now = Date.now();
    const ps = await prisma.payment.findMany({ where: { contractId }, orderBy: { installmentNo: 'asc' } });
    for (const p of ps) {
      const overdue = [1, 2, 3].includes(p.installmentNo);
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          status: overdue ? 'PARTIALLY_PAID' : 'PAID',
          dueDate: overdue ? new Date(now - (14 - p.installmentNo) * 86_400_000) : p.dueDate,
        },
      });
    }
  });

  it('provisions at the streak-floored bucket (B3 50%), not aging B1 (2%)', async () => {
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    const result = await build().calculateProvisions(admin!.id);
    const row = await prisma.badDebtProvision.findFirst({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
      orderBy: { provisionDate: 'desc' },
    });
    expect(row!.agingBucket).toBe('61-90');
    expect(Number(row!.provisionRate)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/accounting/bad-debt.streak-provision.spec.ts`
Expected: FAIL — provision row has `agingBucket = '1-30'`, rate `0.02` (streak floor not applied yet).

- [ ] **Step 3: Apply the floor in the provisioning loop**

In `calculateProvisions`, fetch streaks once before the loop (after `contractIdsInScope` is built, ~line 168):

```ts
    const streakMap = await this.getStreakBucketMap();
    const streaks = await this.consecutiveMissed.getStreaks(
      { contractIds: contractIdsInScope },
      now,
    );
```

Then inside the `for (const [contractId, data] of contractOutstanding)` loop, replace:

```ts
      const bucket = this.getAgingBucket(daysOverdue);
      const rate = rates[bucket] || 0;
```

with:

```ts
      const agingBucket = this.getAgingBucket(daysOverdue);
      const streakBucket = this.streakToBucket(streaks.get(contractId) ?? 0, streakMap);
      const bucket = this.effectiveBucket(agingBucket, streakBucket, rates);
      const rate = rates[bucket] || 0;
```

(Everything downstream already keys off `bucket` / `rate` — no other change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/accounting/bad-debt.streak-provision.spec.ts`
Expected: PASS (`agingBucket = '61-90'`, rate `0.5`).

- [ ] **Step 5: Run the existing bad-debt suite (no regression)**

Run: `cd apps/api && npx vitest run src/modules/accounting`
Expected: PASS — existing provision tests (no streak ≥2) are unaffected because `streakToBucket(<2)` returns null.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/accounting/bad-debt.streak-provision.spec.ts
git commit -m "feat(bad-debt): floor provision bucket by consecutive-missed streak (max severity)"
```

---

### Task 5: Apply the streak floor in `reverseStageOnPayment`

**Files:**
- Modify: `apps/api/src/modules/accounting/bad-debt.service.ts:588`
- Test: `apps/api/src/modules/accounting/bad-debt.streak-reverse.spec.ts`

**Interfaces:**
- Consumes: `getStreaks`, `streakToBucket`, `effectiveBucket`, `getStreakBucketMap` (Tasks 1, 3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/accounting/bad-debt.streak-reverse.spec.ts
// Scenario: a contract provisioned at B3 via the streak floor. A payment lowers
// AGING to B1, but the streak is still >=2 (B2 floor) → reverse must release
// only down to B2 (rate 0.15), NOT all the way to B1/CURRENT.
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedStandard17k12m } from '../journal/__tests__/scenario-helpers';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { BadDebtService } from './bad-debt.service';
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { BadDebtProvisionTemplate } from '../journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../journal/cpa-templates/bad-debt-writeoff.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';

const prisma = new PrismaClient();

describe('reverseStageOnPayment respects the streak floor', () => {
  let contractId: string;
  let svc: BadDebtService;

  beforeAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.badDebtProvision.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);
    if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
      await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'a', role: 'OWNER' } });
    }
    const journal = new JournalAutoService(prisma as any);
    svc = new BadDebtService(
      prisma as any, journal,
      new BadDebtProvisionTemplate(journal, prisma as any),
      new BadDebtWriteOffTemplate(journal, prisma as any),
      new EclStageReverseTemplate(journal, prisma as any),
      new ConsecutiveMissedService(prisma as any),
    );
    const c = await seedStandard17k12m(prisma);
    contractId = c.id;
    await new ContractActivation1ATemplate(journal, prisma as any).execute(contractId);
    await prisma.contract.update({ where: { id: contractId }, data: { status: 'OVERDUE' } });
    // Two installments unpaid-overdue but only ~10 days each → aging B1, streak 2 → floor B2.
    const now = Date.now();
    const ps = await prisma.payment.findMany({ where: { contractId }, orderBy: { installmentNo: 'asc' } });
    for (const p of ps) {
      const overdue = [1, 2].includes(p.installmentNo);
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          status: overdue ? 'PARTIALLY_PAID' : 'PAID',
          dueDate: overdue ? new Date(now - (11 - p.installmentNo) * 86_400_000) : p.dueDate,
        },
      });
    }
    // Provision at the streak floor (B2 15%).
    const admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    await svc.calculateProvisions(admin!.id);
  });

  it('does not over-release: keeps the B2 streak floor when aging alone would be B1', async () => {
    const before = await prisma.badDebtProvision.findFirst({
      where: { contractId, status: 'ACTIVE', deletedAt: null },
    });
    expect(before!.agingBucket).toBe('31-60'); // streak floor applied at provisioning

    const result = await svc.reverseStageOnPayment(contractId);
    // Aging alone (B1) is below B2, but the streak floor is still B2 → no downward reverse.
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/accounting/bad-debt.streak-reverse.spec.ts`
Expected: FAIL — `reverseStageOnPayment` computes `newBucket` from aging only (`'1-30'`), sees a rate drop vs the persisted B2 provision, and releases (returns a non-null reverse) instead of `null`.

- [ ] **Step 3: Apply the floor to `newBucket`**

In `reverseStageOnPayment`, replace the single line at ~588:

```ts
    const newBucket = this.getAgingBucket(maxOverdueDays);
```

with the streak-floored version (insert just before it, using the same `now` already declared at line 552):

```ts
    const streakMap = await this.getStreakBucketMap();
    const streaks = await this.consecutiveMissed.getStreaks({ contractIds: [contractId] }, now, db);
    const agingBucket = this.getAgingBucket(maxOverdueDays);
    const streakBucket = this.streakToBucket(streaks.get(contractId) ?? 0, streakMap);
    const newBucket = this.effectiveBucket(agingBucket, streakBucket, rates);
```

(`rates` is already loaded at line 589 `const rates = await this.getProvisionRates();` — move that line above this block so `rates` is in scope, or reuse it. Verify ordering when editing.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/accounting/bad-debt.streak-reverse.spec.ts`
Expected: PASS (`reverseStageOnPayment` returns `null` — no over-release).

- [ ] **Step 5: Run the full accounting + payments suites (no regression)**

Run: `cd apps/api && npx vitest run src/modules/accounting src/modules/payments`
Expected: PASS — existing reverse-on-payment tests (no streak) unaffected (`streakToBucket(<2)` → null → aging-only behaviour preserved).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/accounting/bad-debt.service.ts apps/api/src/modules/accounting/bad-debt.streak-reverse.spec.ts
git commit -m "fix(bad-debt): reverseStageOnPayment honours the streak floor (no over-release)"
```

---

### Task 6: Delete the dead `consecutiveMissed` reset

**Files:**
- Modify: `apps/api/src/modules/installments/reschedule.service.ts:118-126`

- [ ] **Step 1: Confirm the current dead block**

Run: `cd apps/api && sed -n '116,127p' src/modules/installments/reschedule.service.ts`
Expected: the `// Reset consecutiveMissed if field exists` comment + the `try { await (tx.contract as any).update({ ... consecutiveMissed: 0 }) } catch { ... }` block.

- [ ] **Step 2: Delete the block**

Remove lines 118-126 (the comment + the `try/catch`). The streak is now derived from live payment state, so there is nothing to reset on reschedule. Leave the surrounding `amountDue` update (112-116) and the `AuditLog` block (128+) untouched.

- [ ] **Step 3: Run the reschedule suite**

Run: `cd apps/api && npx vitest run src/modules/installments`
Expected: PASS — no test depended on the `consecutiveMissed` reset (it was a no-op `catch`).

- [ ] **Step 4: Type-check the whole API (catch any dangling reference)**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 0 errors — no remaining reference to a `consecutiveMissed` field anywhere.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/installments/reschedule.service.ts
git commit -m "chore(installments): remove dead consecutiveMissed reset (streak is now derived)"
```

---

## Self-Review

**Spec coverage (Section 1 of the design doc):**
- Derive, not persist → Tasks 1-2 (shared service + cron consumes it); no schema/migration anywhere ✓
- `bad-debt` reads streak, maps→bucket, `max(aging, counter)` → Tasks 3-4 ✓
- `reverseStageOnPayment` consistent with the floor → Task 5 (refines the spec's "self-corrects" note: the reverse path needs the floor too, or it over-releases) ✓
- One streak definition, no drift → Task 1 is the only CTE; Task 2 deletes the cron's copy ✓
- Streak→bucket map config `consecutive_missed_bucket_map` w/ defaults → Task 3 ✓
- Delete reschedule dead code → Task 6 ✓
- Gate: none ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `getStreaks(opts, asOf, client?) → Map<string, number>` used identically in Tasks 2, 4, 5. `streakToBucket(streak, map?) → string | null` and `effectiveBucket(aging, streakBucket, rates) → string` defined in Task 3, consumed unchanged in Tasks 4-5. `BadDebtService` constructor gains exactly one 6th arg (`ConsecutiveMissedService`) in Task 3; Tasks 4-5 test-construct it with that 6-arg shape.

**Note for the implementer:** Task 5 Step 3 requires `rates` to be in scope above the new block — when editing, move the existing `const rates = await this.getProvisionRates();` (currently line 589) above the streak block.
