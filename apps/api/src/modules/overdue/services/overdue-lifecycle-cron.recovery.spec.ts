/**
 * Step 1b of `updateContractStatuses` — OVERDUE → ACTIVE once the customer has
 * caught up, with dunning reset to the start (owner decisions 2026-11-05).
 *
 * Before Step 1b nothing moved a contract back, so a fully caught-up contract
 * stayed OVERDUE forever and every report that filters contracts by status
 * OVERDUE/DEFAULT over-counted it.
 *
 * The prisma double below EVALUATES the `where` clauses the cron sends (instead
 * of returning canned rows), so these tests pin behaviour, not call shapes. It
 * throws on any key it does not understand — a predicate change cannot be
 * silently ignored by the fake.
 *
 * DB-backed counterpart: overdue-lifecycle-cron.recovery.integration.spec.ts
 */
import { ContractStatus, DunningStage, PaymentStatus } from '@prisma/client';
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../consecutive-missed.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { bangkokStartOfDay } from '../../../utils/date.util';

const DAY = 86_400_000;
const SYSTEM_USER = 'sys-user';

interface FakePayment {
  status: PaymentStatus;
  dueDate: Date;
  deletedAt?: Date | null;
}
interface FakeContract {
  id: string;
  status: ContractStatus;
  deletedAt: Date | null;
  blockAutoEscalation: Date | null;
  dunningStage: DunningStage;
  dunningEscalatedAt: Date | null;
  dunningLastActionAt: Date | null;
  pendingDunningStage: DunningStage | null;
  pendingDunningSince: Date | null;
  payments: FakePayment[];
}
type Where = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function assertKeys(where: Where, allowed: string[], scope: string) {
  for (const key of Object.keys(where)) {
    if (where[key] === undefined) continue; // Prisma treats undefined as "no filter"
    if (!allowed.includes(key)) throw new Error(`fake prisma: unsupported ${scope} key "${key}"`);
  }
}

function matchPayment(p: FakePayment, w: Where): boolean {
  assertKeys(w, ['status', 'dueDate', 'deletedAt'], 'payment');
  if (w.status?.in && !w.status.in.includes(p.status)) return false;
  if (w.dueDate) {
    assertKeys(w.dueDate, ['lt', 'lte'], 'payment.dueDate');
    if (w.dueDate.lt && !(p.dueDate.getTime() < w.dueDate.lt.getTime())) return false;
    if (w.dueDate.lte && !(p.dueDate.getTime() <= w.dueDate.lte.getTime())) return false;
  }
  if ('deletedAt' in w && w.deletedAt === null && p.deletedAt) return false;
  return true;
}

function matchContract(c: FakeContract, w: Where): boolean {
  assertKeys(w, ['status', 'deletedAt', 'id', 'OR', 'blockAutoEscalation', 'payments'], 'contract');
  if (typeof w.status === 'string' && c.status !== w.status) return false;
  if (w.status?.in && !w.status.in.includes(c.status)) return false;
  if ('deletedAt' in w && w.deletedAt === null && c.deletedAt !== null) return false;
  if (w.id?.in && !w.id.in.includes(c.id)) return false;
  if (w.id?.notIn && w.id.notIn.includes(c.id)) return false;
  if (w.OR && !(w.OR as Where[]).some((o) => matchContract(c, o))) return false;
  if ('blockAutoEscalation' in w) {
    const b = w.blockAutoEscalation;
    if (b === null && c.blockAutoEscalation !== null) return false;
    if (b?.lt && !(c.blockAutoEscalation && c.blockAutoEscalation < b.lt)) return false;
  }
  if (w.payments) {
    assertKeys(w.payments, ['some', 'none'], 'contract.payments');
    if (w.payments.some && !c.payments.some((p) => matchPayment(p, w.payments.some))) return false;
    if (w.payments.none && c.payments.some((p) => matchPayment(p, w.payments.none))) return false;
  }
  return true;
}

const project = (c: FakeContract, select?: Record<string, boolean>) =>
  select
    ? Object.fromEntries(
        Object.keys(select)
          .filter((k) => select[k])
          .map((k) => [k, c[k as keyof FakeContract]]),
      )
    : { ...c };

function setup(
  contracts: FakeContract[],
  opts: { afterFindMany?: (where: Where) => void; threshold?: string } = {},
) {
  const auditRows: Record<string, unknown>[] = [];
  const updateCalls: { where: Where; data: Where; count: number }[] = [];
  const update = (where: Where, data: Where) => {
    const hit = contracts.filter((c) => matchContract(c, where));
    for (const c of hit) Object.assign(c, data);
    updateCalls.push({ where, data, count: hit.length });
    return hit;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: Record<string, any> = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: SYSTEM_USER }) },
    systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: opts.threshold ?? '7' }) },
    callLog: { findMany: jest.fn().mockResolvedValue([]) },
    contract: {
      findMany: jest.fn(
        async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
          const rows = contracts
            .filter((c) => matchContract(c, where))
            .map((c) => project(c, select));
          opts.afterFindMany?.(where);
          return rows;
        },
      ),
      updateMany: jest.fn(async ({ where, data }: { where: Where; data: Where }) => ({
        count: update(where, data).length,
      })),
      updateManyAndReturn: jest.fn(
        async ({
          where,
          data,
          select,
        }: {
          where: Where;
          data: Where;
          select?: Record<string, boolean>;
        }) => update(where, data).map((c) => project(c, select)),
      ),
    },
    auditLog: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        auditRows.push(...data);
        return { count: data.length };
      }),
    },
  };
  // Batch form (Step 1, Step 2) and interactive form (Step 1b) — the tx client is
  // the same double.
  prisma.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg as Promise<unknown>[]),
  );
  // Step 2 reads streaks of OVERDUE contracts — simplified (count of unsettled rows due
  // before asOf) but computed from the LIVE fake state, so a contract restored by
  // Step 1b is invisible to it exactly like in the real CTE.
  const consecutive = {
    getStreaks: jest.fn(async (o: { statuses?: string[] }, asOf: Date) => {
      const m = new Map<string, number>();
      for (const c of contracts) {
        if (c.deletedAt || (o.statuses && !o.statuses.includes(c.status))) continue;
        const n = c.payments.filter(
          (p) => !p.deletedAt && p.status !== 'PAID' && p.dueDate.getTime() < asOf.getTime() - DAY, // "after end of due day"
        ).length;
        if (n >= 1) m.set(c.id, n);
      }
      return m;
    }),
  };
  const svc = new OverdueLifecycleCronService(
    prisma as unknown as PrismaService,
    consecutive as unknown as ConsecutiveMissedService,
  );
  const auditFor = (id: string) => auditRows.filter((r) => r.entityId === id);
  return { svc, prisma, auditRows, auditFor, updateCalls };
}

const now = Date.now();
const at = (days: number) => new Date(now + days * DAY);
const pay = (
  status: PaymentStatus,
  dueInDays: number,
  deletedAt: Date | null = null,
): FakePayment => ({
  status,
  dueDate: at(dueInDays),
  deletedAt,
});
const contract = (
  id: string,
  status: ContractStatus,
  payments: FakePayment[],
  over: Partial<FakeContract> = {},
): FakeContract => ({
  id,
  status,
  deletedAt: null,
  blockAutoEscalation: null,
  dunningStage: 'NONE',
  dunningEscalatedAt: null,
  dunningLastActionAt: null,
  pendingDunningStage: null,
  pendingDunningSince: null,
  payments,
  ...over,
});

/** Dunning state of a contract that was escalated and has a final warning waiting for approval. */
const escalated = (): Partial<FakeContract> => ({
  dunningStage: 'NOTICE',
  dunningEscalatedAt: at(-12),
  dunningLastActionAt: at(-3),
  pendingDunningStage: 'FINAL_WARNING',
  pendingDunningSince: at(-1),
});

/** Every installment that has fallen due is PAID; the next one is in the future. */
const caughtUp = () => [pay('PAID', -40), pay('PAID', -10), pay('PENDING', 20)];

/** Fake only `Date` (promises / timers stay real). */
function freezeDate(instant: Date) {
  jest.useFakeTimers({
    now: instant,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

afterEach(() => jest.useRealTimers());

describe('OverdueLifecycleCronService.updateContractStatuses — Step 1b OVERDUE → ACTIVE (caught up)', () => {
  it('restores a caught-up OVERDUE contract to ACTIVE with one STATUS_CHANGE audit row from the system user', async () => {
    const c = contract('c-caught-up', 'OVERDUE', caughtUp());
    const { svc, auditFor } = setup([c]);

    const result = await svc.updateContractStatuses();

    expect(c.status).toBe('ACTIVE');
    expect(result.recoveredUpdated).toBe(1);
    expect(result.recoveredIds).toEqual(['c-caught-up']);
    expect(auditFor('c-caught-up')).toEqual([
      {
        userId: SYSTEM_USER,
        action: 'STATUS_CHANGE',
        entity: 'contract',
        entityId: 'c-caught-up',
        newValue: {
          from: 'OVERDUE',
          to: 'ACTIVE',
          reason: expect.any(String),
          dunningReset: { previousStage: 'NONE', previousPendingStage: null },
        },
        ipAddress: 'system-cron',
      },
    ]);
  });

  it('resets dunning to the start — stage NONE, timestamps and the pending approval cleared — and records what was reset', async () => {
    const c = contract('c-escalated', 'OVERDUE', caughtUp(), escalated());
    const { svc, auditFor } = setup([c]);

    await svc.updateContractStatuses();

    expect(c).toMatchObject({
      status: 'ACTIVE',
      dunningStage: 'NONE',
      dunningEscalatedAt: null,
      dunningLastActionAt: null,
      pendingDunningStage: null,
      pendingDunningSince: null,
    });
    expect(auditFor('c-escalated')).toEqual([
      expect.objectContaining({
        newValue: expect.objectContaining({
          dunningReset: { previousStage: 'NOTICE', previousPendingStage: 'FINAL_WARNING' },
        }),
      }),
    ]);
  });

  it.each<PaymentStatus>(['PENDING', 'OVERDUE', 'PARTIALLY_PAID'])(
    'an installment already past due but still inside the threshold (%s, 2 days late) keeps the contract OVERDUE and its dunning untouched',
    async (status) => {
      const c = contract(
        'c-late',
        'OVERDUE',
        [pay('PAID', -40), pay(status, -2), pay('PENDING', 28)],
        escalated(),
      );
      const { svc, auditFor } = setup([c]);

      const result = await svc.updateContractStatuses();

      expect(c.status).toBe('OVERDUE');
      expect(c.dunningStage).toBe('NOTICE');
      expect(c.pendingDunningStage).toBe('FINAL_WARNING');
      expect(result.recoveredUpdated).toBe(0);
      expect(auditFor('c-late')).toEqual([]);
    },
  );

  it('due-today boundary: at 00:30 Bangkok an installment due today (Bangkok midnight) keeps the contract OVERDUE; due tomorrow does not', async () => {
    const todayBkk = bangkokStartOfDay(new Date());
    const runAt = new Date(todayBkk.getTime() + 30 * 60 * 1000); // 00:30 Bangkok
    const dueToday = contract('c-due-today', 'OVERDUE', [
      { status: 'PAID', dueDate: new Date(todayBkk.getTime() - 30 * DAY) },
      { status: 'PENDING', dueDate: todayBkk },
    ]);
    const dueTomorrow = contract('c-due-tomorrow', 'OVERDUE', [
      { status: 'PAID', dueDate: new Date(todayBkk.getTime() - 30 * DAY) },
      { status: 'PENDING', dueDate: new Date(todayBkk.getTime() + DAY) },
    ]);
    const { svc } = setup([dueToday, dueTomorrow]);
    freezeDate(runAt);

    await svc.updateContractStatuses();

    expect(dueToday.status).toBe('OVERDUE');
    expect(dueTomorrow.status).toBe('ACTIVE');
  });

  it('DEFAULT is never auto-restored, even when fully caught up (stays a manual staff action)', async () => {
    const c = contract('c-default', 'DEFAULT', caughtUp(), escalated());
    const { svc, auditFor } = setup([c]);

    await svc.updateContractStatuses();

    expect(c.status).toBe('DEFAULT');
    expect(c.dunningStage).toBe('NOTICE');
    expect(auditFor('c-default')).toEqual([]);
  });

  it('a soft-deleted OVERDUE contract is untouched', async () => {
    const c = contract('c-deleted', 'OVERDUE', caughtUp(), { deletedAt: at(-1) });
    const { svc, auditFor } = setup([c]);

    await svc.updateContractStatuses();

    expect(c.status).toBe('OVERDUE');
    expect(auditFor('c-deleted')).toEqual([]);
  });

  it('only OVERDUE moves — COMPLETED / TERMINATED / EARLY_PAYOFF / CLOSED_BAD_DEBT / CANCELED / ACTIVE are never touched', async () => {
    const others: ContractStatus[] = [
      'COMPLETED',
      'TERMINATED',
      'EARLY_PAYOFF',
      'CLOSED_BAD_DEBT',
      'CANCELED',
      'ACTIVE',
    ];
    const contracts = others.map((s) => contract(`c-${s}`, s, caughtUp()));
    const { svc, auditRows } = setup(contracts);

    await svc.updateContractStatuses();

    expect(contracts.map((c) => c.status)).toEqual(others);
    expect(auditRows).toEqual([]);
  });

  it('ignores the manual hold and recent PROMISED call logs — those guard escalation, not recovery', async () => {
    const held = contract('c-held', 'OVERDUE', caughtUp(), { blockAutoEscalation: at(2) });
    const promised = contract('c-promised', 'OVERDUE', caughtUp());
    const { svc, prisma } = setup([held, promised]);
    prisma.callLog.findMany.mockResolvedValue([{ contractId: 'c-promised' }]);

    await svc.updateContractStatuses();

    expect(held.status).toBe('ACTIVE');
    expect(promised.status).toBe('ACTIVE');
  });

  it('no flip-flop in one run, and a second run of the same night changes nothing', async () => {
    // A: ACTIVE, 10 days late (> 7-day threshold) → Step 1 flips to OVERDUE.
    // B: OVERDUE, caught up → Step 1b restores to ACTIVE.
    const a = contract('c-a', 'ACTIVE', [pay('PAID', -40), pay('PENDING', -10)]);
    const b = contract('c-b', 'OVERDUE', caughtUp());
    const { svc, auditFor, updateCalls } = setup([a, b]);

    await svc.updateContractStatuses();

    expect(a.status).toBe('OVERDUE');
    expect(b.status).toBe('ACTIVE');
    expect(auditFor('c-a')).toEqual([
      expect.objectContaining({
        newValue: expect.objectContaining({ from: 'ACTIVE', to: 'OVERDUE' }),
      }),
    ]);
    expect(auditFor('c-b')).toEqual([
      expect.objectContaining({
        newValue: expect.objectContaining({ from: 'OVERDUE', to: 'ACTIVE' }),
      }),
    ]);
    // Step 1 and Step 1b decide "unsettled" with the same status set.
    const [step1, step1b] = updateCalls;
    expect(step1.data).toEqual({ status: 'OVERDUE' });
    expect(step1b.data).toMatchObject({ status: 'ACTIVE' });
    expect(step1b.where.payments.none.status.in).toEqual(step1.where.payments.some.status.in);

    await svc.updateContractStatuses();

    expect(a.status).toBe('OVERDUE');
    expect(b.status).toBe('ACTIVE');
    expect(auditFor('c-a')).toHaveLength(1);
    expect(auditFor('c-b')).toHaveLength(1);
  });

  it('a negative overdue_days_threshold is floored at 0 — Step 1 cannot flip a contract whose installment is not due yet', async () => {
    // Unfloored, -5 puts thresholdDate 5 days in the FUTURE: Step 1 would flip this
    // contract (installment due in 2 days) and Step 1b would restore it in the same run.
    const notDueYet = contract('c-not-due', 'ACTIVE', [pay('PAID', -40), pay('PENDING', 2)]);
    const caught = contract('c-caught', 'OVERDUE', caughtUp());
    const { svc, auditFor } = setup([notDueYet, caught], { threshold: '-5' });

    await svc.updateContractStatuses();

    expect(notDueYet.status).toBe('ACTIVE');
    expect(auditFor('c-not-due')).toEqual([]);
    expect(caught.status).toBe('ACTIVE');
  });

  it('a soft-deleted unpaid row blocks recovery exactly as it triggers Step 1 — shared predicate, so no nightly flip-flop', async () => {
    // Step 1 does not filter payments.deletedAt, so neither does Step 1b: otherwise this
    // contract would go ACTIVE (1b) and straight back to OVERDUE (Step 1) every night.
    const shape = () => [pay('PAID', -40), pay('PENDING', -10, at(-5)), pay('PENDING', 20)];
    const overdue = contract('c-del-overdue', 'OVERDUE', shape());
    const active = contract('c-del-active', 'ACTIVE', shape());
    const { svc } = setup([overdue, active]);

    await svc.updateContractStatuses();
    await svc.updateContractStatuses();

    expect(overdue.status).toBe('OVERDUE');
    expect(active.status).toBe('OVERDUE');
  });

  it('race: an installment re-opened between snapshot and update keeps the contract OVERDUE, and NO audit row is written for it', async () => {
    const c = contract('c-race', 'OVERDUE', caughtUp(), escalated());
    const other = contract('c-other', 'OVERDUE', caughtUp());
    const { svc, auditFor } = setup([c, other], {
      afterFindMany: (where) => {
        // Step 1b snapshot just saw the contract as caught up — a receipt void now
        // re-opens the installment that fell due 10 days ago.
        if (where.status === 'OVERDUE' && where.payments?.none) c.payments[1].status = 'PENDING';
      },
    });
    const warn = jest
      .spyOn((svc as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await svc.updateContractStatuses();

    expect(c.status).toBe('OVERDUE');
    expect(c.dunningStage).toBe('NOTICE');
    expect(auditFor('c-race')).toEqual([]);
    expect(other.status).toBe('ACTIVE');
    expect(auditFor('c-other')).toHaveLength(1);
    expect(result.recoveredIds).toEqual(['c-other']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('OVERDUE→ACTIVE'));
  });

  it('a contract restored in Step 1b is never a DEFAULT candidate in the same run', async () => {
    const restored = contract('c-restored', 'OVERDUE', caughtUp());
    const missedTwo = contract('c-missed-two', 'OVERDUE', [
      pay('OVERDUE', -40),
      pay('OVERDUE', -10),
    ]);
    const { svc } = setup([restored, missedTwo]);

    const result = await svc.updateContractStatuses();

    expect(restored.status).toBe('ACTIVE');
    expect(missedTwo.status).toBe('DEFAULT');
    expect(result.defaultIds).toEqual(['c-missed-two']);
  });
});
