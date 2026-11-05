import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ContractStatus, PaymentStatus, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedStandard17k12m } from '../../journal/__tests__/scenario-helpers';
import { OverdueLifecycleCronService } from './overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../consecutive-missed.service';
import { upsertSystemUser } from '../../../../prisma/seeds/collections-foundation.seed';

/**
 * DB-backed: Step 1b of updateContractStatuses (OVERDUE → ACTIVE once caught up)
 * against real Postgres — the Prisma `payments: { none: … }` relation filter, the
 * atomic updateMany and the audit rows, end to end. Mock-level counterpart:
 * overdue-lifecycle-cron.recovery.spec.ts. Run with TZ=Asia/Bangkok and TZ=UTC.
 *
 * Only asserts on (and only deletes) the contracts it seeds — the cron itself runs
 * over the whole test DB, like the sibling consecutive.integration spec.
 */
const prisma = new PrismaClient();
const DAY = 86_400_000;
const AMOUNT = new Decimal('1515.83');

type Inst = { status: PaymentStatus; dueInDays: number };

const ids: Record<string, string> = {};

async function seedContract(
  key: string,
  status: ContractStatus,
  installments: Inst[],
  opts: { deleted?: boolean } = {},
) {
  const c = await seedStandard17k12m(prisma);
  const now = Date.now();
  await prisma.contract.update({
    where: { id: c.id },
    data: { status, deletedAt: opts.deleted ? new Date(now - DAY) : null },
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
        dueDate: new Date(now + inst.dueInDays * DAY),
        amountDue: AMOUNT,
        amountPaid: paid ? AMOUNT : partial ? new Decimal('500.00') : new Decimal('0'),
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

const statusOf = async (key: string) =>
  (await prisma.contract.findUnique({ where: { id: ids[key] }, select: { status: true } }))!.status;

// Seeded contract ids are fresh, so every STATUS_CHANGE row for them came from this spec.
const statusChangesOf = (key: string) =>
  prisma.auditLog.findMany({
    where: { entity: 'contract', entityId: ids[key], action: 'STATUS_CHANGE' },
    select: { userId: true, newValue: true, ipAddress: true },
  });

describe('OverdueLifecycleCronService — OVERDUE→ACTIVE once caught up (DB)', () => {
  beforeAll(async () => {
    // The cron calls getSystemUserIdOrThrow. Reuse whatever system user the DB already
    // has (a sibling spec may have created one) — adding a second would make the cron's
    // findFirst ambiguous for other suites sharing the DB.
    if (!(await prisma.user.findFirst({ where: { isSystemUser: true } }))) {
      await upsertSystemUser(prisma);
    }

    await seedContract('caughtUp', 'OVERDUE', CAUGHT_UP);
    // Past due but inside the 7-day threshold — the customer is late again: no flapping.
    await seedContract('lateInsideThreshold', 'OVERDUE', [
      { status: 'PAID', dueInDays: -60 },
      { status: 'PENDING', dueInDays: -2 },
      { status: 'PENDING', dueInDays: 28 },
    ]);
    await seedContract('partialPastDue', 'OVERDUE', [
      { status: 'PAID', dueInDays: -60 },
      { status: 'PARTIALLY_PAID', dueInDays: -1 },
    ]);
    await seedContract('defaultCaughtUp', 'DEFAULT', CAUGHT_UP);
    await seedContract('deletedCaughtUp', 'OVERDUE', CAUGHT_UP, { deleted: true });
    await seedContract('completedCaughtUp', 'COMPLETED', CAUGHT_UP);
    // Step 1 flips this one ACTIVE → OVERDUE in the same run — must not be undone.
    await seedContract('activeLate', 'ACTIVE', [
      { status: 'PAID', dueInDays: -40 },
      { status: 'PENDING', dueInDays: -10 },
    ]);
  });

  afterAll(async () => {
    const mine = Object.values(ids);
    await prisma.payment.deleteMany({ where: { contractId: { in: mine } } });
    await prisma.installmentSchedule.deleteMany({ where: { contractId: { in: mine } } });
    await prisma.contract.deleteMany({ where: { id: { in: mine } } });
    await prisma.$disconnect();
  });

  it('restores only the caught-up OVERDUE contract, with no flip-flop in the run or on a re-run', async () => {
    const svc = new OverdueLifecycleCronService(
      prisma as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      new ConsecutiveMissedService(prisma as any), // eslint-disable-line @typescript-eslint/no-explicit-any
    );

    const first = await svc.updateContractStatuses();

    expect(first.recoveredIds).toContain(ids.caughtUp);
    for (const k of [
      'lateInsideThreshold',
      'partialPastDue',
      'defaultCaughtUp',
      'deletedCaughtUp',
      'completedCaughtUp',
      'activeLate',
    ]) {
      expect(first.recoveredIds).not.toContain(ids[k]);
    }
    expect(first.overdueIds).toContain(ids.activeLate);

    expect(await statusOf('caughtUp')).toBe('ACTIVE');
    expect(await statusOf('lateInsideThreshold')).toBe('OVERDUE');
    expect(await statusOf('partialPastDue')).toBe('OVERDUE');
    expect(await statusOf('defaultCaughtUp')).toBe('DEFAULT');
    expect(await statusOf('deletedCaughtUp')).toBe('OVERDUE');
    expect(await statusOf('completedCaughtUp')).toBe('COMPLETED');
    expect(await statusOf('activeLate')).toBe('OVERDUE');

    const restored = await statusChangesOf('caughtUp');
    expect(restored).toEqual([
      {
        userId: expect.any(String),
        ipAddress: 'system-cron',
        newValue: { from: 'OVERDUE', to: 'ACTIVE', reason: expect.any(String) },
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
      'defaultCaughtUp',
      'deletedCaughtUp',
      'completedCaughtUp',
    ]) {
      expect(await statusChangesOf(k)).toEqual([]);
    }

    // Same night, run again (e.g. the OWNER "run-daily" button): nothing moves back.
    const second = await svc.updateContractStatuses();

    expect(second.recoveredIds).not.toContain(ids.caughtUp);
    expect(second.recoveredIds).not.toContain(ids.activeLate);
    expect(await statusOf('caughtUp')).toBe('ACTIVE');
    expect(await statusOf('activeLate')).toBe('OVERDUE');
    expect(await statusChangesOf('caughtUp')).toHaveLength(1);
    expect(await statusChangesOf('activeLate')).toHaveLength(1);
  });
});
