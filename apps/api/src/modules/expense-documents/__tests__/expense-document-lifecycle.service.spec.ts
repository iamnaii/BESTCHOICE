import { Decimal } from '@prisma/client/runtime/library';
import { makeExpenseDocumentsService } from './support/make-expense-documents-service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Characterization for the private `notifyApprovers` fan-out, pinned THROUGH
 * THE FACADE (`service.submitForApproval` → lifecycle.submitForApproval →
 * lifecycle.notifyApprovers). These branches were NOT covered by the existing
 * submitForApproval specs (which all omit `notifications`, so they only exercise
 * the undefined-early-return path implicitly).
 *
 * Phase 2a decompose — added BEFORE the move and kept GREEN after, so the
 * extracted ExpenseDocumentLifecycleService is byte-behavior-identical to the
 * pre-extraction facade. Asserts on the injected notifications.send mock.
 *
 * Branches pinned:
 *   (a) notification_on_pending=false → early return (no send)
 *   (b) notifications undefined        → early return (no throw)
 *   (c) empty approvers_list           → OWNER fallback (send to owners)
 *   (d) Promise.allSettled             → one failed recipient is swallowed;
 *                                        the others still receive + no rethrow
 */
describe('ExpenseDocumentLifecycleService — notifyApprovers fan-out (via facade)', () => {
  /**
   * Build a prisma double whose systemConfig.findFirst is driven by a per-key
   * map and whose user.findMany is configurable. `approval_enabled` defaults to
   * true so submitForApproval reaches the notify step.
   */
  function makePrisma(opts: {
    configValues?: Record<string, string>;
    users?: Array<{ id: string }>;
  } = {}) {
    const configValues: Record<string, string> = {
      approval_enabled: 'true',
      ...(opts.configValues ?? {}),
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'doc-1', status: 'DRAFT', deletedAt: null }),
        update: jest.fn().mockResolvedValue({
          id: 'doc-1',
          number: 'EX-20260610-0001',
          documentType: 'EXPENSE',
          totalAmount: new Decimal('1234.56'),
          status: 'PENDING_APPROVAL',
          deletedAt: null,
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      systemConfig: {
        findFirst: jest.fn().mockImplementation((args: { where: { key: string } }) => {
          const v = configValues[args.where.key];
          return Promise.resolve(v === undefined ? null : { value: v });
        }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(opts.users ?? []),
      },
    };
    return prisma;
  }

  it('(a) notification_on_pending=false → does NOT send', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const prisma = makePrisma({
      configValues: { notification_on_pending: 'false' },
      users: [{ id: 'owner-1' }],
    });
    const { service } = makeExpenseDocumentsService({ prisma, notifications: { send } });

    await service.submitForApproval('doc-1', 'user-1');

    expect(send).not.toHaveBeenCalled();
  });

  it('(b) notifications undefined → submit still succeeds, no throw', async () => {
    const prisma = makePrisma({ users: [{ id: 'owner-1' }] });
    // notifications omitted → factory default undefined.
    const { service } = makeExpenseDocumentsService({ prisma });

    const result = await service.submitForApproval('doc-1', 'user-1');

    expect(result.status).toBe('PENDING_APPROVAL');
  });

  it('(c) empty approvers_list → falls back to OWNER users', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    // No approvers_list config row → getApproversList returns [] → OWNER fallback.
    const prisma = makePrisma({ users: [{ id: 'owner-1' }, { id: 'owner-2' }] });
    const { service } = makeExpenseDocumentsService({ prisma, notifications: { send } });

    await service.submitForApproval('doc-1', 'user-1');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'OWNER', isActive: true, deletedAt: null }),
      }),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'IN_APP', recipient: 'owner-1' }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'IN_APP', recipient: 'owner-2' }),
    );
  });

  it('(d) one failed recipient is swallowed (allSettled); others still notified; no rethrow', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('recipient blew up'))
      .mockResolvedValue(undefined);
    const prisma = makePrisma({ users: [{ id: 'owner-1' }, { id: 'owner-2' }] });
    const { service } = makeExpenseDocumentsService({ prisma, notifications: { send } });

    // Must resolve (not reject) even though the first send rejects.
    const result = await service.submitForApproval('doc-1', 'user-1');

    expect(result.status).toBe('PENDING_APPROVAL');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
