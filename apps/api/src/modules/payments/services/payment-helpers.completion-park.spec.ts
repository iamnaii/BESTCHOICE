/**
 * I-5 (review 2026-08-16) — เงินพักปรับดิวค้างตอนสัญญาปิดครบงวด.
 *
 * `checkContractCompletion` flips a fully-paid contract to COMPLETED and used to
 * read NO balances at all. The park bucket (ค่าปรับดิวพักงวดสุดท้าย) is relieved
 * only at the LAST installment and is capped there at that installment's total,
 * so with several reschedules it routinely exceeds one installment — a contract
 * that simply runs to term would strand real customer money as a permanent
 * 21-1103 credit that JP4 never sweeps (running to term never touches JP4).
 *
 * No refund/income JE is invented here — which of the two it is, is a CPA call.
 * The contract locked below is: Sentry warning + ONE deduped MEDIUM Todo.
 */
jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { checkContractCompletion, RESIDUAL_PARK_TODO_TAG } from './payment-helpers';

const D = (v: string) => new Prisma.Decimal(v);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

describe('checkContractCompletion — residual park balance alarm (I-5)', () => {
  let prisma: AnyObj;
  let productsService: AnyObj;
  let logger: AnyObj;

  const buildPrisma = (opts: {
    unpaid?: number;
    park?: string;
    systemUser?: { id: string } | null;
    existingTodo?: { id: string } | null;
  }) => ({
    payment: { count: jest.fn().mockResolvedValue(opts.unpaid ?? 0) },
    contract: {
      update: jest.fn().mockResolvedValue({
        productId: 'prod-1',
        contractNumber: 'BC-PARK-001',
        rescheduleAdvanceBalance: D(opts.park ?? '0'),
      }),
    },
    callLog: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.systemUser === undefined ? { id: 'sys-1' } : opts.systemUser),
    },
    todo: {
      findFirst: jest.fn().mockResolvedValue(opts.existingTodo ?? null),
      create: jest.fn().mockResolvedValue({ id: 'todo-1' }),
    },
  });

  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
    productsService = { transferOwnership: jest.fn().mockResolvedValue(undefined) };
    logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as Logger;
  });

  /**
   * R-1: the alarm is fired UN-AWAITED (`void alarm(...)`) so it can never roll
   * back the caller's money tx, which means its Todo I/O lands a few microtasks
   * after `checkContractCompletion` resolves. Tests that assert on that I/O must
   * drain the queue first. `setImmediate` clears both the microtask queue and the
   * current macrotask, covering all three awaits inside the alarm.
   */
  const flushAlarm = () => new Promise((resolve) => setImmediate(resolve));

  it('residual park > 0 on completion → Sentry warning + ONE MEDIUM Todo (no JE invented)', async () => {
    prisma = buildPrisma({ park: '484.13' });

    await checkContractCompletion(prisma, productsService, logger, 'ct-1');
    await flushAlarm();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Contract completed with residual reschedule park balance',
      expect.objectContaining({
        level: 'warning',
        tags: { subsystem: 'reschedule-park' },
        extra: expect.objectContaining({
          contractId: 'ct-1',
          contractNumber: 'BC-PARK-001',
          rescheduleAdvanceBalance: '484.13',
        }),
      }),
    );

    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
    const todo = prisma.todo.create.mock.calls[0][0].data;
    expect(todo.priority).toBe('MEDIUM');
    expect(todo.tags).toEqual([RESIDUAL_PARK_TODO_TAG]);
    expect(todo.createdById).toBe('sys-1');
    // Thai, and carries the two facts staff needs to act: which contract, how much.
    expect(todo.title).toContain('BC-PARK-001');
    expect(todo.title).toContain('484.13');
    expect(todo.description).toContain('21-1103');
  });

  it('park = 0 on completion → no alarm, no Todo (the normal case must stay silent)', async () => {
    prisma = buildPrisma({ park: '0' });

    await checkContractCompletion(prisma, productsService, logger, 'ct-1');
    await flushAlarm();

    expect(prisma.contract.update).toHaveBeenCalled(); // completion still happens
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('an OPEN Todo already covering this contract → no duplicate (void → re-pay completes twice)', async () => {
    prisma = buildPrisma({ park: '484.13', existingTodo: { id: 'todo-existing' } });

    await checkContractCompletion(prisma, productsService, logger, 'ct-1');
    await flushAlarm();

    expect(prisma.todo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tags: { has: RESIDUAL_PARK_TODO_TAG },
          title: { contains: 'BC-PARK-001' },
          status: { not: 'DONE' },
          deletedAt: null,
        }),
      }),
    );
    expect(prisma.todo.create).not.toHaveBeenCalled();
    // The alarm still fires — a suppressed Todo must not suppress the signal.
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('no SYSTEM user → Todo skipped + logged, never throws (must not roll back a committed payment)', async () => {
    prisma = buildPrisma({ park: '484.13', systemUser: null });

    await expect(
      checkContractCompletion(prisma, productsService, logger, 'ct-1'),
    ).resolves.toBeUndefined();
    await flushAlarm();

    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('484.13'));
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  /**
   * R-1 (re-review 2026-08-18) — THE regression pin.
   *
   * The alarm used to run on `db = tx ?? prisma` and was awaited, so a failing
   * Todo insert aborted the customer's payment. Postgres poisons a transaction as
   * soon as any statement in it errors, so a late try/catch cannot rescue it — the
   * alarm has to be off the tx connection entirely. This test fails if anyone ever
   * routes it back onto `tx`.
   */
  it('R-1: alarm runs on the ROOT client and never touches the money tx — a failing Todo cannot roll back the payment', async () => {
    prisma = buildPrisma({ park: '484.13' });
    prisma.todo.create.mockRejectedValue(new Error('FK violation on createdById'));

    // A tx client that detonates if the alarm ever reaches for it.
    const boom = () => {
      throw new Error('alarm touched the money tx — R-1 regression');
    };
    const tx: AnyObj = {
      payment: { count: jest.fn().mockResolvedValue(0) },
      contract: {
        update: jest.fn().mockResolvedValue({
          productId: 'prod-1',
          contractNumber: 'BC-PARK-001',
          rescheduleAdvanceBalance: D('484.13'),
        }),
      },
      callLog: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      user: { findFirst: boom },
      todo: { findFirst: boom, create: boom },
    };

    // Completion must succeed even though the Todo insert rejects.
    await expect(
      checkContractCompletion(prisma, productsService, logger, 'ct-1', tx),
    ).resolves.toBeUndefined();
    await flushAlarm();

    // Completion work itself ran on the tx (unchanged behaviour) …
    expect(tx.contract.update).toHaveBeenCalled();
    // … while the alarm ran on the ROOT client only.
    expect(prisma.user.findFirst).toHaveBeenCalled();
    expect(prisma.todo.create).toHaveBeenCalled();
    // The rejection was swallowed and reported, not propagated.
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('484.13'));
  });

  it('contract not fully paid → returns before any completion work (no alarm, no status flip)', async () => {
    prisma = buildPrisma({ unpaid: 3, park: '484.13' });

    await checkContractCompletion(prisma, productsService, logger, 'ct-1');
    await flushAlarm();

    expect(prisma.contract.update).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });
});
