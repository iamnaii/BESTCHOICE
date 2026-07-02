# Late-fee Live Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ค่าปรับ (late fee) shown for unpaid installments reflect the current late-fee SystemConfig immediately on read, instead of a stale stored stamp.

**Architecture:** Add one pure helper `resolveLivePaymentLateFee` beside the existing `resolveLateFee` engine, then call it on the read path (`getPendingPayments` per-row, `getPendingSummary` for the KPI total) so the display matches what `PaymentReceiptOrchestrator` already recomputes at record time. No change to the engine dispatch, the overdue cron, the orchestrator, the settings card, or the wizard.

**Tech Stack:** NestJS + Prisma + `Prisma.Decimal` money math; Jest mock-based unit tests (fake `prisma`, no real DB).

## Global Constraints

- Money is `Prisma.Decimal`, never IEEE-754 float. Copy verbatim from existing code.
- Keep BOTH late-fee modes (`PER_DAY` / `BRACKET`). Do NOT touch `resolveLateFee`, `computeBracketLateFee`, `computePerDayLateFee`, `loadLateFeeConfig`, the overdue cron, the orchestrator, `LateFeeSettingsCard`, or `RecordPaymentWizard`.
- Late-fee gross base is `payment.amountDue` (installment principal+interest+VAT; excludes late fee by schema). This matches the orchestrator and seed.
- Do NOT recompute `getDailySummary.totalLateFees` — those are PAID installments whose fee is the actual charged amount.
- Tests are mock-based unit tests (construct `PaymentQueryService`/call the pure helper with a fake `prisma`). No real DB — the "Test API" gate is red on an unrelated payments spec and DB specs are flaky under parallel runs.
- API jest run pattern: `cd apps/api && npx jest <path> --runInBand`.

---

### Task 1: `resolveLivePaymentLateFee` helper

**Files:**
- Modify: `apps/api/src/utils/late-fee.util.ts` (append after `resolveLateFee`, currently ends ~line 117)
- Test: `apps/api/src/utils/late-fee.util.spec.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `resolveLateFee(cfg: LateFeeConfig, daysOverdue: number, installmentGross: Prisma.Decimal | number | string): Prisma.Decimal` and `LateFeeConfig` (both already exported from this file).
- Produces: `resolveLivePaymentLateFee(payment: { dueDate: Date; amountDue: Prisma.Decimal | number | string; lateFeeWaived: boolean }, cfg: LateFeeConfig, asOf: Date): Prisma.Decimal`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/utils/late-fee.util.spec.ts`:

```ts
describe('resolveLivePaymentLateFee — display-side live late fee', () => {
  const perDay: LateFeeConfig = {
    mode: 'PER_DAY',
    tier1Amount: 50,
    tier2Amount: 100,
    tier2MinDays: 3,
    perDayRate: 20,
    maxAmount: 500,
    capPct: 5,
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const now = () => new Date();

  it('waived installment → 0 regardless of days overdue', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(30), amountDue: 3671, lateFeeWaived: true },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(0);
  });

  it('future due date (not yet overdue) → 0', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(-2), amountDue: 3671, lateFeeWaived: false },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(0);
  });

  it('due today (0 whole days overdue) → 0', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: now(), amountDue: 3671, lateFeeWaived: false },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(0);
  });

  it('PER_DAY ramp: 5 days × 20 = 100 (below the 5% cap of 183.55)', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(5), amountDue: 3671, lateFeeWaived: false },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(100);
  });

  it('PER_DAY cap binds: 30 days → 5% × 3671 = 183.55', () => {
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(30), amountDue: 3671, lateFeeWaived: false },
        perDay,
        now(),
      ).toNumber(),
    ).toBe(183.55);
  });

  it('BRACKET mode: 30 days → flat tier2 (100)', () => {
    const bracket: LateFeeConfig = { ...perDay, mode: 'BRACKET' };
    expect(
      resolveLivePaymentLateFee(
        { dueDate: daysAgo(30), amountDue: 3671, lateFeeWaived: false },
        bracket,
        now(),
      ).toNumber(),
    ).toBe(100);
  });
});
```

Also add `resolveLivePaymentLateFee` to the import at the top of the spec — change the first line from:

```ts
import { computeBracketLateFee, computePerDayLateFee, resolveLateFee, type LateFeeConfig } from './late-fee.util';
```

to:

```ts
import { computeBracketLateFee, computePerDayLateFee, resolveLateFee, resolveLivePaymentLateFee, type LateFeeConfig } from './late-fee.util';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx jest src/utils/late-fee.util.spec.ts -t "resolveLivePaymentLateFee" --runInBand`
Expected: FAIL — `resolveLivePaymentLateFee is not a function` (not yet exported).

- [ ] **Step 3: Write the implementation**

Append to `apps/api/src/utils/late-fee.util.ts` (after `resolveLateFee`, at end of file):

```ts
/**
 * Display-side live late fee for an UNPAID installment as of `asOf`. The twin of
 * the record-time recompute in PaymentReceiptOrchestrator — call this wherever a
 * pending/overdue installment's late fee is SHOWN, so the figure tracks the
 * current config instead of the stored `Payment.lateFee` stamp (refreshed only at
 * record time / by the overdue cron).
 *
 *   waived                    → 0
 *   dueDate >= asOf (≥ today) → 0  (resolveLateFee returns 0 for < 1 whole day)
 *   otherwise                 → resolveLateFee(cfg, whole days overdue, amountDue)
 *
 * Base = amountDue (installment gross, excl. late fee) — matches the orchestrator.
 * Do NOT use this for PAID installments: their stored lateFee is the actual charge.
 */
export function resolveLivePaymentLateFee(
  payment: { dueDate: Date; amountDue: Prisma.Decimal | number | string; lateFeeWaived: boolean },
  cfg: LateFeeConfig,
  asOf: Date,
): Prisma.Decimal {
  if (payment.lateFeeWaived) return new Prisma.Decimal(0);
  const daysOverdue = Math.max(
    0,
    Math.floor((asOf.getTime() - new Date(payment.dueDate).getTime()) / 86_400_000),
  );
  return resolveLateFee(cfg, daysOverdue, payment.amountDue);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/utils/late-fee.util.spec.ts --runInBand`
Expected: PASS — the new `resolveLivePaymentLateFee` suite is green and the existing suites still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/late-fee.util.ts apps/api/src/utils/late-fee.util.spec.ts
git commit -m "feat(late-fee): resolveLivePaymentLateFee helper for display-side live fee

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `getPendingPayments` recomputes late fee on read

**Files:**
- Modify: `apps/api/src/modules/payments/services/payment-query.service.ts` (import line 1-5; `getPendingPayments` return at ~line 154-177)
- Test: `apps/api/src/modules/payments/payments.pending-live-fee.spec.ts` (new file)

**Interfaces:**
- Consumes: `resolveLivePaymentLateFee` and `loadLateFeeConfig` from `../../../utils/late-fee.util`. `loadLateFeeConfig(prisma: { systemConfig: { findUnique } }): Promise<LateFeeConfig>`.
- Produces: `getPendingPayments` still returns `paginatedResponse(data, total, page, limit)` — same shape `{ data, total, page, limit }` — but each `data[i].lateFee` is now the live `Prisma.Decimal`, not the stored stamp.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/payments/payments.pending-live-fee.spec.ts`:

```ts
import { Prisma } from '@prisma/client';
import { PaymentQueryService } from './services/payment-query.service';

/**
 * getPendingPayments feeds the payment queue + RecordPaymentWizard. The stored
 * Payment.lateFee is a stamp refreshed only at record time / by the overdue cron,
 * so the read path must recompute it from current config to reflect settings edits.
 */
describe('PaymentQueryService — getPendingPayments live late fee', () => {
  const PER_DAY = ({ where: { key } }: { where: { key: string } }) => {
    const map: Record<string, string> = {
      late_fee_mode: 'PER_DAY',
      late_fee_per_day_rate: '20',
      late_fee_max_amount: '500',
      late_fee_cap_pct: '5',
    };
    return Promise.resolve(map[key] ? { value: map[key] } : null);
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  function makeService(rows: Record<string, unknown>[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const count = jest.fn().mockResolvedValue(rows.length);
    const systemConfig = { findUnique: jest.fn(PER_DAY) };
    const prisma = { payment: { findMany, count }, systemConfig };
    return new PaymentQueryService(prisma as unknown as never);
  }

  const D = (v: string) => new Prisma.Decimal(v);
  const lateFeeNum = (row: { lateFee: { toString(): string } }) =>
    new Prisma.Decimal(row.lateFee.toString()).toNumber();

  it('overrides the stale stored stamp with the live PER_DAY 5% cap', async () => {
    const service = makeService([
      { id: 'p1', status: 'OVERDUE', dueDate: daysAgo(30), amountDue: D('3671'), amountPaid: D('0'), lateFeeWaived: false, lateFee: D('999'), contract: {} },
    ]);
    const res = await service.getPendingPayments({});
    expect(lateFeeNum(res.data[0])).toBe(183.55);
  });

  it('waived installment → 0 even when the stored stamp is non-zero', async () => {
    const service = makeService([
      { id: 'p2', status: 'OVERDUE', dueDate: daysAgo(30), amountDue: D('3671'), amountPaid: D('0'), lateFeeWaived: true, lateFee: D('183.55'), contract: {} },
    ]);
    const res = await service.getPendingPayments({});
    expect(lateFeeNum(res.data[0])).toBe(0);
  });

  it('not-yet-due installment → 0', async () => {
    const service = makeService([
      { id: 'p3', status: 'PENDING', dueDate: daysAgo(-5), amountDue: D('3671'), amountPaid: D('0'), lateFeeWaived: false, lateFee: D('0'), contract: {} },
    ]);
    const res = await service.getPendingPayments({});
    expect(lateFeeNum(res.data[0])).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx jest src/modules/payments/payments.pending-live-fee.spec.ts --runInBand`
Expected: FAIL — first test gets `999` (stored stamp passed through), not `183.55`.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/modules/payments/services/payment-query.service.ts`, add the import. Current top of file:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { roundBaht } from '../../../utils/installment.util';
```

Add after the `roundBaht` import:

```ts
import { loadLateFeeConfig, resolveLivePaymentLateFee } from '../../../utils/late-fee.util';
```

Then change the END of `getPendingPayments`. Current (~line 154-177):

```ts
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { installmentNo: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          contract: {
            select: {
              id: true,
              contractNumber: true,
              totalMonths: true,
              monthlyPayment: true,
              advanceBalance: true,
              customer: { select: { id: true, name: true, phone: true } },
              branch: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }
```

Replace the `return paginatedResponse(...)` line (keep everything above it) with:

```ts
    // Live late fee: Payment.lateFee is a stamp refreshed only at record time /
    // by the overdue cron, so recompute it from current config on read. This keeps
    // the queue + RecordPaymentWizard in step with settings edits and matches what
    // the orchestrator will actually charge. (getDailySummary keeps the stored
    // value — that is the real charged fee on PAID installments.)
    const cfg = await loadLateFeeConfig(this.prisma);
    const now = new Date();
    const withLiveFee = data.map((p) => ({
      ...p,
      lateFee: resolveLivePaymentLateFee(p, cfg, now),
    }));

    return paginatedResponse(withLiveFee, total, page, limit);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && npx jest src/modules/payments/payments.pending-live-fee.spec.ts --runInBand`
Expected: PASS — all three cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payments/services/payment-query.service.ts apps/api/src/modules/payments/payments.pending-live-fee.spec.ts
git commit -m "fix(payments): recompute late fee live in getPendingPayments

Payment.lateFee is a stored stamp; the payment queue + RecordPaymentWizard now
recompute it from current config on read so settings edits show immediately.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `getPendingSummary` KPI reflects live late fee

**Files:**
- Modify: `apps/api/src/modules/payments/services/payment-query.service.ts` (`getPendingSummary`, ~line 189-266)
- Test: `apps/api/src/modules/payments/payments.pending-summary.spec.ts` (update `makeService` harness + 2 assertions)

**Interfaces:**
- Consumes: `resolveLivePaymentLateFee`, `loadLateFeeConfig` (imported in Task 2).
- Produces: `getPendingSummary` return shape unchanged; `outstandingLateFee` is now the sum of live per-row fees for the pending bucket, not `_sum.lateFee`.

- [ ] **Step 1: Update the test harness + failing assertions**

In `apps/api/src/modules/payments/payments.pending-summary.spec.ts`, update `makeService` so the fake `prisma` also answers `payment.findMany` and `systemConfig.findUnique`, and accepts `pendingRows`.

Change the `makeService` signature block (currently starts ~line 17) — add `pendingRows` to the `buckets` type:

```ts
  function makeService(buckets: {
    pending?: { _count: number; _sum: { amountDue: unknown; amountPaid: unknown; lateFee: unknown } };
    waived?: { _sum: { waivedAmount: unknown } };
    collected?: { _count: number; _sum: { amountPaid: unknown } };
    overdue60?: number;
    pendingRows?: Array<{ dueDate: Date; amountDue: Prisma.Decimal; lateFeeWaived: boolean }>;
  }) {
```

Then, just before `const prisma = { payment: { aggregate, count } };`, add the `findMany` + `systemConfig` mocks and capture the findMany where:

```ts
    const findMany = jest.fn((args: any) => {
      calls.pendingRows = args.where;
      return Promise.resolve(buckets.pendingRows ?? []);
    });

    const systemConfig = {
      findUnique: jest.fn(({ where: { key } }: { where: { key: string } }) => {
        const map: Record<string, string> = {
          late_fee_mode: 'PER_DAY',
          late_fee_per_day_rate: '20',
          late_fee_max_amount: '500',
          late_fee_cap_pct: '5',
        };
        return Promise.resolve(map[key] ? { value: map[key] } : null);
      }),
    };
```

Change the prisma construction line from:

```ts
    const prisma = { payment: { aggregate, count } };
```

to:

```ts
    const prisma = { payment: { aggregate, count, findMany }, systemConfig };
```

And widen the `calls` type (currently `const calls: { pending?: any; waived?: any; collected?: any; overdue60?: any } = {};`) to include `pendingRows`:

```ts
    const calls: { pending?: any; waived?: any; collected?: any; overdue60?: any; pendingRows?: any } = {};
```

Now update the two tests that assert `outstandingLateFee`.

Test 1 — "computes all 6 KPI figures" (~line 52). Add `pendingRows` to its `makeService({...})` call and change the expected `outstandingLateFee`. Replace the `makeService({...})` object with:

```ts
    const { service } = makeService({
      pending: { _count: 50, _sum: { amountDue: D('60000.00'), amountPaid: D('3624.00'), lateFee: D('2150.00') } },
      waived: { _sum: { waivedAmount: D('675.00') } },
      overdue60: 3,
      collected: { _count: 8, _sum: { amountPaid: D('12580.00') } },
      // one 30-day-overdue installment; PER_DAY min(30×20=600, 500, 5%×6000=300) = 300
      pendingRows: [{ dueDate: new Date(Date.now() - 30 * 86_400_000), amountDue: D('6000'), lateFeeWaived: false }],
    });
```

And in that test's `expect(result).toEqual({ ... })`, change the `outstandingLateFee` line from `outstandingLateFee: 2150,` to:

```ts
      outstandingLateFee: 300, // live: 5% × 6000 (cap binds)
```

Test 2 — "keeps satang precision" (~line 74). Add `pendingRows` producing 99.17 and keep the assertion. Replace its `makeService({...})` with:

```ts
    const { service } = makeService({
      pending: { _count: 3, _sum: { amountDue: D('4547.49'), amountPaid: D('1515.83'), lateFee: D('99.17') } },
      // 30 days overdue, PER_DAY cap binds: 5% × 1983.40 = 99.17
      pendingRows: [{ dueDate: new Date(Date.now() - 30 * 86_400_000), amountDue: D('1983.40'), lateFeeWaived: false }],
    });
```

(The `expect(result.outstandingLateFee).toBe(99.17)` assertion stays as-is.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest src/modules/payments/payments.pending-summary.spec.ts --runInBand`
Expected: FAIL — `getPendingSummary` still reads `_sum.lateFee`, so test 1 sees `2150` (not `300`) and test 2 sees `99.17` from the aggregate; but once the harness adds `findMany`, the service also throws until the implementation calls it. Either way the suite is red.

- [ ] **Step 3: Write the implementation**

In `getPendingSummary` (`payment-query.service.ts`), factor out the pending where-clause, add a `findMany` + config load to the parallel batch, and compute `outstandingLateFee` from live per-row fees.

Find this block (~line 224-246):

```ts
    const [pending, waived, overdue60Count, collected] = await Promise.all([
      // Pending bucket: count + outstanding principal + outstanding late fee
      this.prisma.payment.aggregate({
        where: { deletedAt: null, status: { in: PENDING_STATUSES }, contract: contractWhere, ...(dueDate ? { dueDate } : {}) },
        _count: true,
        _sum: { amountDue: true, amountPaid: true, lateFee: true },
      }),
      // Waived bucket: late fees written down (อนุโลม) — any status
      this.prisma.payment.aggregate({
        where: { deletedAt: null, lateFeeWaived: true, contract: contractWhere, ...(dueDate ? { dueDate } : {}) },
        _sum: { waivedAmount: true },
      }),
      // Overdue ≥ 60 days bucket: still-unpaid installments past the cutoff
      this.prisma.payment.count({
        where: { deletedAt: null, status: { in: UNPAID_OVERDUE_STATUSES }, contract: contractWhere, dueDate: overdueDueDate },
      }),
      // Collected bucket: money actually received for installments due in range
      this.prisma.payment.aggregate({
        where: { deletedAt: null, amountPaid: { gt: 0 }, contract: contractWhere, ...(dueDate ? { dueDate } : {}) },
        _count: true,
        _sum: { amountPaid: true },
      }),
    ]);
```

Replace it with (adds `pendingWhere`, `pendingRows`, `cfg`):

```ts
    const pendingWhere = { deletedAt: null, status: { in: PENDING_STATUSES }, contract: contractWhere, ...(dueDate ? { dueDate } : {}) };

    const [pending, waived, overdue60Count, collected, pendingRows, cfg] = await Promise.all([
      // Pending bucket: count + outstanding principal (late fee computed live below)
      this.prisma.payment.aggregate({
        where: pendingWhere,
        _count: true,
        _sum: { amountDue: true, amountPaid: true },
      }),
      // Waived bucket: late fees written down (อนุโลม) — any status
      this.prisma.payment.aggregate({
        where: { deletedAt: null, lateFeeWaived: true, contract: contractWhere, ...(dueDate ? { dueDate } : {}) },
        _sum: { waivedAmount: true },
      }),
      // Overdue ≥ 60 days bucket: still-unpaid installments past the cutoff
      this.prisma.payment.count({
        where: { deletedAt: null, status: { in: UNPAID_OVERDUE_STATUSES }, contract: contractWhere, dueDate: overdueDueDate },
      }),
      // Collected bucket: money actually received for installments due in range
      this.prisma.payment.aggregate({
        where: { deletedAt: null, amountPaid: { gt: 0 }, contract: contractWhere, ...(dueDate ? { dueDate } : {}) },
        _count: true,
        _sum: { amountPaid: true },
      }),
      // Pending-bucket rows for the LIVE late-fee total (Payment.lateFee is a stale
      // stamp — recompute from current config so the KPI matches the queue rows).
      this.prisma.payment.findMany({
        where: pendingWhere,
        select: { dueDate: true, amountDue: true, lateFeeWaived: true },
      }),
      loadLateFeeConfig(this.prisma),
    ]);

    const now = new Date();
    const outstandingLateFee = pendingRows
      .reduce(
        (sum, p) => sum.add(resolveLivePaymentLateFee(p, cfg, now)),
        new Prisma.Decimal(0),
      )
      .toDecimalPlaces(2)
      .toNumber();
```

Then change the `outstandingLateFee` line in the `return {...}` (currently `outstandingLateFee: dec(pending._sum?.lateFee).toDecimalPlaces(2).toNumber(),`) to:

```ts
      outstandingLateFee,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/payments/payments.pending-summary.spec.ts --runInBand`
Expected: PASS — all 6 cases green (test 1 → `outstandingLateFee: 300`, test 2 → `99.17`, the 4 filter/scoping cases unaffected).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/payments/services/payment-query.service.ts apps/api/src/modules/payments/payments.pending-summary.spec.ts
git commit -m "fix(payments): getPendingSummary late-fee KPI reflects live config

Sum resolveLivePaymentLateFee over the pending bucket instead of the stored
_sum.lateFee, so the KPI card agrees with the live per-row values in the queue.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Full type-check + payments/late-fee suite green

**Files:** none (verification only)

- [ ] **Step 1: Type-check the API**

Run: `cd apps/api && npx tsc --noEmit`
Expected: exits 0 (no type errors from the new helper, the import, or the `.map`/`.reduce`).

- [ ] **Step 2: Run the affected suites together**

Run: `cd apps/api && npx jest src/utils/late-fee.util.spec.ts src/modules/payments/payments.pending-live-fee.spec.ts src/modules/payments/payments.pending-summary.spec.ts --runInBand`
Expected: PASS — all three specs green.

- [ ] **Step 3: Guard against regressions in the payments read path**

Run: `cd apps/api && npx jest src/modules/payments --runInBand`
Expected: PASS, OR the only failures are the pre-existing unrelated red spec noted in project memory (`payments.service.spec › recordPayment › should throw if amount exceeds remaining`). If any NEW failure appears in a spec this plan touched, stop and fix before proceeding.

- [ ] **Step 4: Commit (only if Step 1-3 required a fix)**

```bash
git add -A
git commit -m "test(payments): green late-fee live-display suites + tsc

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- The manual verification the owner wants (change late-fee settings → reopen the payment modal → see the fee change) needs a running app + DB and is out of scope for this test-only plan. After merge, the owner should confirm it against the running `origin/main` build.
- The collections page and LIFF customer history still read the stored `Payment.lateFee` and will lag config edits until the overdue cron / next record. Documented in the spec as out of scope.
