import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentApprovalController } from './payment-approval.controller';
import { getPaymentApprovalPermissions } from './services/payment-approval-permissions';

jest.mock('./services/payment-approval-permissions', () => ({
  ...jest.requireActual('./services/payment-approval-permissions'),
  getPaymentApprovalPermissions: jest.fn(),
}));

/**
 * Task 36 review I-2 (2026-11-01): earlyPayoff now takes the contract row lock with raw SQL (`$queryRaw … FOR UPDATE`, #24) —
 * PostgreSQL serialization failures / deadlocks on a raw statement arrive as **P2010** (`meta.code` 40001 / 40P01), not
 * P2034. The approval queue must keep answering them with its 409 "โหลดรายการรออนุมัติใหม่" instead of a 500.
 */
describe('PaymentApprovalController.approve — concurrency errors become the 409', () => {
  const known = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError('conflict', { code, clientVersion: 'test', meta });

  function build(error: unknown) {
    const prisma = {
      paymentApprovalRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'req-1',
          status: 'PENDING',
          action: 'EARLY_PAYOFF',
          targetId: 'contract-1',
          contractId: 'contract-1',
          requestedById: 'requester',
          requiredPermissions: ['EARLY_PAYOFF'],
          payload: { paymentMethod: 'BANK_TRANSFER' },
        }),
      },
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ branchId: 'branch-1' }) },
    };
    (getPaymentApprovalPermissions as jest.Mock).mockResolvedValue({
      user: { id: 'approver', role: 'OWNER', branchId: null },
      permissions: ['EARLY_PAYOFF'],
    });
    const contractPayment = { earlyPayoff: jest.fn().mockRejectedValue(error) };
    return new PaymentApprovalController(
      prisma as never,
      {} as never,
      {} as never,
      contractPayment as never,
    );
  }

  it.each([
    ['P2010 / 40001 (row lock serialization failure)', known('P2010', { code: '40001' })],
    ['P2010 / 40P01 (row lock deadlock)', known('P2010', { code: '40P01' })],
    ['P2034 (typed write conflict — unchanged)', known('P2034')],
    ['P2002 (unique — unchanged)', known('P2002')],
  ])('%s → 409', async (_label, error) => {
    const attempt = build(error).approve('11111111-1111-4111-8111-111111111111', 'approver', {
      reason: 'ok',
    } as never);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('รายการถูกเปลี่ยนแปลงระหว่างดำเนินการ');
  });

  it('other database errors still propagate (not swallowed as 409)', async () => {
    const other = known('P2010', { code: '23514' });
    await expect(
      build(other).approve('11111111-1111-4111-8111-111111111111', 'approver', {
        reason: 'ok',
      } as never),
    ).rejects.toBe(other);
  });
});
