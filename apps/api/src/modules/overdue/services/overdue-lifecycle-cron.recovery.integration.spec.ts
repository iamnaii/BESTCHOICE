import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ContractStatus, DunningStage, PaymentStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import { OverdueQueriesService } from './overdue-queries.service';
import { ConsecutiveMissedService } from '../consecutive-missed.service';
import { upsertSystemUser } from '../../../../prisma/seeds/collections-foundation.seed';
import { bangkokStartOfDay } from '../../../utils/date.util';

/**
 * DB-backed: Step 1b of updateContractStatuses (OVERDUE → ACTIVE once caught up,
 * dunning reset to the start) against real Postgres — the Prisma `payments: { none }`
 * relation filter, updateManyAndReturn, the audit rows, and the follow-on effects
 * (pending-approval list, re-escalation from REMINDER). Mock-level counterpart:
 * overdue-lifecycle-cron.recovery.spec.ts. Run with TZ=Asia/Bangkok and TZ=UTC.
 *
 * Only asserts on (and only deletes) the rows it seeds — the cron itself runs over
 * the whole test DB, like the sibling consecutive.integration spec.
 */
const prisma = new PrismaClient();
const DAY = 86_400_000;
const AMOUNT = new Decimal('1515.83');

type Inst = {
  status: PaymentStatus;
  dueInDays?: number;
  dueDate?: Date;
  amountPaid?: Decimal;
  lateFee?: Decimal;
};
type Dunning = {
  dunningStage?: DunningStage;
  dunningEscalatedAt?: Date | null;
  dunningLastActionAt?: Date | null;
  pendingDunningStage?: DunningStage | null;
  pendingDunningSince?: Date | null;
};

const ids: Record<string, string> = {};
let ruleId: string | null = null;

async function seedContract(
  key: string,
  status: ContractStatus,
  installments: Inst[],
  opts: { deleted?: boolean; dunning?: Dunning } = {},
) {
  const c = await seedStandard17k12m(prisma);
  const now = Date.now();
  await prisma.contract.update({
    where: { id: c.id },
    data: { status, deletedAt: opts.deleted ? new Date(now - DAY) : null, ...opts.dunning },
  });
  let installmentNo = 0;
  for (const inst of installments) {
    installmentNo += 1;
    const paid = inst.status === 'PAID';
    const partial = inst.status === 'PARTIALLY_PAID';
    await prisma.payment.create({
      data: {
        contractId: c.id,
        installmentNo,
        dueDate: inst.dueDate ?? new Date(now + (inst.dueInDays ?? 0) * DAY),
        amountDue: AMOUNT,
        amountPaid:
          inst.amountPaid ?? (paid ? AMOUNT : partial ? new Decimal('500.00') : new Decimal('0')),
        lateFee: inst.lateFee ?? new Decimal('0'),
        status: inst.status,
      },
    });
  }
  ids[key] = c.id;
}

/** Every installment that has fallen due is PAID; the next one is in the future. */
const CAUGHT_UP: Inst[] = [
  { status: 'PAID', dueInDays: -60 },
  { status: 'PAID', dueInDays: -30 },
  { status: 'PENDING', dueInDays: 20 },
];
/** Escalated to NOTICE earlier, final warning waiting for approval. */
const ESCALATED = (): Dunning => ({
  dunningStage: 'NOTICE',
  dunningEscalatedAt: new Date(Date.now() - 12 * DAY),
  dunningLastActionAt: new Date(Date.now() - 3 * DAY),
  pendingDunningStage: 'FINAL_WARNING',
  pendingDunningSince: new Date(Date.now() - DAY),
});

const contractOf = (key: string) =>
  prisma.contract.findUniqueOrThrow({
    where: { id: ids[key] },
    select: {
      status: true,
      dunningStage: true,
      dunningEscalatedAt: true,
      dunningLastActionAt: true,
      pendingDunningStage: true,
      pendingDunningSince: true,
    },
  });
const statusOf = async (key: string) => (await contractOf(key)).status;

// Seeded contract ids are fresh, so every STATUS_CHANGE row for them came from this spec.
const statusChangesOf = (key: string) =>
  prisma.auditLog.findMany({
    where: { entity: 'contract', entityId: ids[key], action: 'STATUS_CHANGE' },
    select: { userId: true, newValue: true, ipAddress: true },
  });

const newCron = () =>
  new OverdueLifecycleCronService(
    prisma as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    new ConsecutiveMissedService(prisma as any), // eslint-disable-line @typescript-eslint/no-explicit-any
  );

describe('OverdueLifecycleCronService — OVERDUE→ACTIVE once caught up (DB)', () => {
  beforeAll(async () => {
    // The cron calls getSystemUserIdOrThrow. Reuse whatever system user the DB already
    // has (a sibling spec may have created one) — adding a second would make the cron's
    // findFirst ambiguous for other suites sharing the DB.
    if (!(await prisma.user.findFirst({ where: { isSystemUser: true } }))) {
      await upsertSystemUser(prisma);
    }

    await seedContract('caughtUp', 'OVERDUE', CAUGHT_UP, { dunning: ESCALATED() });
    // Past due but inside the 7-day threshold — the customer is late again: no flapping.
    await seedContract(
      'lateInsideThreshold',
      'OVERDUE',
      [
        { status: 'PAID', dueInDays: -60 },
        { status: 'PENDING', dueInDays: -2 },
        { status: 'PENDING', dueInDays: 28 },
      ],
      { dunning: ESCALATED() },
    );
    await seedContract('partialPastDue', 'OVERDUE', [
      { status: 'PAID', dueInDays: -60 },
      { status: 'PARTIALLY_PAID', dueInDays: -1 },
    ]);
    // Base fully paid, only the late fee still owed — the row stays PARTIALLY_PAID.
    await seedContract('feeOnlyPastDue', 'OVERDUE', [
      { status: 'PAID', dueInDays: -60 },
      { status: 'PARTIALLY_PAID', dueInDays: -3, amountPaid: AMOUNT, lateFee: new Decimal('100') },
      { status: 'PENDING', dueInDays: 27 },
    ]);
    await seedContract('defaultCaughtUp', 'DEFAULT', CAUGHT_UP, { dunning: ESCALATED() });
    await seedContract('deletedCaughtUp', 'OVERDUE', CAUGHT_UP, { deleted: true });
    await seedContract('completedCaughtUp', 'COMPLETED', CAUGHT_UP);
    // Step 1 flips this one ACTIVE → OVERDUE in the same run — must not be undone.
    await seedContract('activeLate', 'ACTIVE', [
      { status: 'PAID', dueInDays: -40 },
      { status: 'PENDING', dueInDays: -10 },
    ]);

    // Dunning HISTORY on the caught-up contract — must survive the reset. Inactive rule
    // so no dunning-engine run in a sibling suite ever fires it.
    ruleId = (
      await prisma.dunningRule.create({
        data: {
          name: `recovery-spec-${Date.now()}`,
          channel: 'LINE',
          messageTemplate: 'x',
          isActive: false,
          triggerDay: 9_999,
        },
      })
    ).id;
    await prisma.dunningAction.create({
      data: { dunningRuleId: ruleId, contractId: ids.caughtUp, channel: 'LINE', status: 'SENT' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    const mine = Object.values(ids);
    await prisma.dunningAction.deleteMany({ where: { contractId: { in: mine } } });
    if (ruleId) await prisma.dunningRule.deleteMany({ where: { id: ruleId } });
    await prisma.payment.deleteMany({ where: { contractId: { in: mine } } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: mine } } });
    await prisma.contract.deleteMany({ where: { id: { in: mine } } });
    await prisma.$disconnect();
  });

  it('restores only the caught-up OVERDUE contract, resets its dunning, and never flip-flops in the run or on a re-run', async () => {
    const svc = newCron();

    const first = await svc.updateContractStatuses();

    expect(first.recoveredIds).toContain(ids.caughtUp);
    for (const k of [
      'lateInsideThreshold',
      'partialPastDue',
      'feeOnlyPastDue',
      'defaultCaughtUp',
      'deletedCaughtUp',
      'completedCaughtUp',
      'activeLate',
    ]) {
      expect(first.recoveredIds).not.toContain(ids[k]);
    }
    expect(first.overdueIds).toContain(ids.activeLate);

    expect(await contractOf('caughtUp')).toEqual({
      status: 'ACTIVE',
      dunningStage: 'NONE',
      dunningEscalatedAt: null,
      dunningLastActionAt: null,
      pendingDunningStage: null,
      pendingDunningSince: null,
    });
    expect(await statusOf('lateInsideThreshold')).toBe('OVERDUE');
    expect(await statusOf('partialPastDue')).toBe('OVERDUE');
    expect(await statusOf('feeOnlyPastDue')).toBe('OVERDUE');
    expect(await statusOf('defaultCaughtUp')).toBe('DEFAULT');
    expect(await statusOf('deletedCaughtUp')).toBe('OVERDUE');
    expect(await statusOf('completedCaughtUp')).toBe('COMPLETED');
    expect(await statusOf('activeLate')).toBe('OVERDUE');
    // Not restored ⇒ dunning untouched.
    expect(await contractOf('lateInsideThreshold')).toMatchObject({
      dunningStage: 'NOTICE',
      pendingDunningStage: 'FINAL_WARNING',
    });
    expect(await contractOf('defaultCaughtUp')).toMatchObject({
      dunningStage: 'NOTICE',
      pendingDunningStage: 'FINAL_WARNING',
    });

    const restored = await statusChangesOf('caughtUp');
    expect(restored).toEqual([
      {
        userId: expect.any(String),
        ipAddress: 'system-cron',
        newValue: {
          from: 'OVERDUE',
          to: 'ACTIVE',
          reason: expect.any(String),
          dunningReset: { previousStage: 'NOTICE', previousPendingStage: 'FINAL_WARNING' },
        },
      },
    ]);
    const author = await prisma.user.findUnique({
      where: { id: restored[0].userId! },
      select: { isSystemUser: true },
    });
    expect(author?.isSystemUser).toBe(true);
    const flipped = await statusChangesOf('activeLate');
    expect(flipped).toHaveLength(1);
    expect(flipped[0].newValue).toMatchObject({ from: 'ACTIVE', to: 'OVERDUE' });
    for (const k of [
      'lateInsideThreshold',
      'partialPastDue',
      'feeOnlyPastDue',
      'defaultCaughtUp',
      'deletedCaughtUp',
      'completedCaughtUp',
    ]) {
      expect(await statusChangesOf(k)).toEqual([]);
    }

    // History is kept; the pending approval is gone from the approver's list.
    expect(await prisma.dunningAction.count({ where: { contractId: ids.caughtUp } })).toBe(1);
    const pending = await new OverdueQueriesService(
      prisma as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      {} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ).getPendingEscalations();
    const pendingIds = pending.map((p) => p.id);
    expect(pendingIds).not.toContain(ids.caughtUp);
    expect(pendingIds).toContain(ids.lateInsideThreshold);

    // Same night, run again (e.g. the OWNER "run-daily" button): nothing moves back.
    const second = await svc.updateContractStatuses();

    expect(second.recoveredIds).not.toContain(ids.caughtUp);
    expect(second.recoveredIds).not.toContain(ids.activeLate);
    expect(await statusOf('caughtUp')).toBe('ACTIVE');
    expect(await statusOf('activeLate')).toBe('OVERDUE');
    expect(await statusChangesOf('caughtUp')).toHaveLength(1);
    expect(await statusChangesOf('activeLate')).toHaveLength(1);
  });

  it('a restored contract that falls behind again escalates from the first stage, like a fresh customer', async () => {
    // Runs after the first test: caughtUp is ACTIVE with dunning NONE. It misses the
    // next installment (3 days late) and Step 1 has flipped it OVERDUE.
    await prisma.payment.update({
      where: { contractId_installmentNo: { contractId: ids.caughtUp, installmentNo: 3 } },
      data: { dueDate: new Date(Date.now() - 3 * DAY) },
    });
    await prisma.contract.update({ where: { id: ids.caughtUp }, data: { status: 'OVERDUE' } });

    const { escalated } = await newCron().escalateDunningStages();

    expect(escalated.find((e) => e.contractId === ids.caughtUp)).toMatchObject({
      from: 'NONE',
      to: 'REMINDER',
    });
    expect((await contractOf('caughtUp')).dunningStage).toBe('REMINDER');
  });

  it('due-today boundary: at 00:30 Bangkok an installment due today keeps the contract OVERDUE; one due tomorrow does not', async () => {
    const todayBkk = bangkokStartOfDay(new Date());
    // Seed on the real clock (fixture contract numbers come from Date.now()), then run
    // the cron with Date frozen at 00:30 Bangkok of the same day.
    await seedContract('dueToday', 'OVERDUE', [
      { status: 'PAID', dueDate: new Date(todayBkk.getTime() - 30 * DAY) },
      { status: 'PENDING', dueDate: todayBkk },
    ]);
    await seedContract('dueTomorrow', 'OVERDUE', [
      { status: 'PAID', dueDate: new Date(todayBkk.getTime() - 30 * DAY) },
      { status: 'PENDING', dueDate: new Date(todayBkk.getTime() + DAY) },
    ]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(todayBkk.getTime() + 30 * 60 * 1000)); // 00:30 Bangkok

    const result = await newCron().updateContractStatuses();
    vi.useRealTimers();

    expect(result.recoveredIds).not.toContain(ids.dueToday);
    expect(result.recoveredIds).toContain(ids.dueTomorrow);
    expect(await statusOf('dueToday')).toBe('OVERDUE');
    expect(await statusOf('dueTomorrow')).toBe('ACTIVE');
  });
});
