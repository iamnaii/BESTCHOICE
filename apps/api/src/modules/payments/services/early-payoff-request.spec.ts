import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paymentApprovalSnapshot } from './payment-approval-request.util';
import { createEarlyPayoffRequest } from './early-payoff-request';
import type { ContractPaymentService } from '../../contracts/contract-payment.service';

jest.mock('./payment-approval-request.util', () => ({
  ...jest.requireActual('./payment-approval-request.util'),
  paymentApprovalSnapshot: jest.fn(),
}));

/**
 * Owner decision #24 (2026-10-31): an early-payoff approval request is refused at creation while the contract has an
 * approved refund the bank has not confirmed yet — the binding check is inside earlyPayoff's transaction; this one
 * stops a request that could never be executed from entering the approval queue.
 */
describe('createEarlyPayoffRequest — pending bank refund (#24)', () => {
  function makeTx(pending: unknown[]) {
    return {
      $executeRaw: jest.fn().mockResolvedValue(0),
      paymentApprovalRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'req-1' }),
      },
      refund: { findMany: jest.fn().mockResolvedValue(pending) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
  }
  const payment = {
    getEarlyPayoffQuote: jest.fn().mockResolvedValue({ totalPayoff: 11106 }),
  } as unknown as ContractPaymentService;

  beforeEach(() => {
    (paymentApprovalSnapshot as jest.Mock).mockResolvedValue({
      contract: { id: 'contract-1' },
      snapshot: {},
    });
  });

  it('rejects with the staff guidance and creates no request', async () => {
    const tx = makeTx([
      { id: 'refund-1', amount: new Prisma.Decimal('1515.83'), payment: { installmentNo: 3 } },
    ]);
    const attempt = createEarlyPayoffRequest(tx as never, payment, {
      targetId: 'contract-1',
      userId: 'user-1',
      reason: 'ลูกค้าขอปิดยอด',
      payload: { paymentMethod: 'BANK_TRANSFER' },
    });
    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(
      createEarlyPayoffRequest(tx as never, payment, {
        targetId: 'contract-1',
        userId: 'user-1',
        reason: 'ลูกค้าขอปิดยอด',
        payload: { paymentMethod: 'BANK_TRANSFER' },
      }),
    ).rejects.toThrow('(งวดที่ 3 1515.83 บาท) — ปิดยอดก่อนกำหนดตอนนี้ไม่ได้');
    expect(tx.refund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contractId: 'contract-1', status: 'APPROVED', deletedAt: null },
      }),
    );
    expect(tx.paymentApprovalRequest.create).not.toHaveBeenCalled();
  });

  it('creates the request when no refund waits for the bank', async () => {
    const tx = makeTx([]);
    await createEarlyPayoffRequest(tx as never, payment, {
      targetId: 'contract-1',
      userId: 'user-1',
      reason: 'ลูกค้าขอปิดยอด',
      payload: { paymentMethod: 'BANK_TRANSFER' },
    });
    expect(tx.paymentApprovalRequest.create).toHaveBeenCalledTimes(1);
  });
});
