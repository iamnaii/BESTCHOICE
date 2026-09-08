import { Prisma } from '@prisma/client';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { ReceiptVoidService } from '../../receipts/services/receipt-void.service';
import { LateFeeWaiverService } from './late-fee-waiver.service';
import { RefundsService } from '../../refunds/refunds.service';
import { consumePaymentApproval } from './payment-approval-request.util';
import { assertPaymentApprovalPermission } from './payment-approval-permissions';

jest.mock('./payment-approval-request.util', () => ({ consumePaymentApproval: jest.fn() }));
jest.mock('./payment-approval-permissions', () => ({ ...jest.requireActual('./payment-approval-permissions'), assertPaymentApprovalPermission: jest.fn() }));
jest.mock('../../../utils/period-lock.util', () => ({ validatePeriodOpen: jest.fn() }));

const context = { requestId: 'req-1', actorId: 'actual-approver' };
const consume = consumePaymentApproval as jest.Mock;
const assertPermission = assertPaymentApprovalPermission as jest.Mock;

function mockDb() {
  const payment = { id: 'p1', contractId: 'c1', installmentNo: 2, deletedAt: null,
    lateFee: new Prisma.Decimal(100), lateFeeWaived: false, amountDue: new Prisma.Decimal(1000),
    amountPaid: new Prisma.Decimal(0), status: 'OVERDUE', notes: null };
  const tx = {
    companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'finance' }) },
    receipt: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ id: 'r1', deletedAt: null, isVoided: false }), create: jest.fn() },
    payment: { findUnique: jest.fn().mockResolvedValue(payment), update: jest.fn().mockResolvedValue(payment) },
    feeWaiverApproval: { create: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'FINANCE_MANAGER', isActive: true, deletedAt: null }) },
    journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
    contract: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch-a' }) },
    refund: { findUnique: jest.fn().mockResolvedValue({ id: 'rf1', paymentId: 'p1', contractId: 'c1', amount: new Prisma.Decimal(1000), requestedAt: new Date(), status: 'REQUESTED', requestedById: 'maker', deletedAt: null }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  return { ...tx, $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)), tx };
}

beforeEach(() => {
  jest.clearAllMocks();
  consume.mockResolvedValue({ requestedById: 'maker', approverId: context.actorId, payload: {} });
  assertPermission.mockResolvedValue({ user: { id: 'actual-approver', name: 'Approver', role: 'FINANCE_MANAGER', branchId: 'branch-a' }, permissions: ['REFUND'] });
});

describe('protected payment actions require an actual approval', () => {
  it('rejects a nominated approver on the legacy void call before opening a transaction', async () => {
    const db = mockDb();
    const svc = new ReceiptVoidService(db as never, {} as never, {} as never);
    await expect(svc.voidReceipt('r1', 'wrong entry', 'maker', 'nominated', 'OWNER')).rejects.toThrow(ForbiddenException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a nominated approver on the legacy standalone waiver call', async () => {
    const db = mockDb();
    const svc = new LateFeeWaiverService(db as never, {} as never, {} as never);
    await expect(svc.waiveLateFee('p1', 'goodwill', 'maker', 'nominated')).rejects.toThrow(ForbiddenException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('checks the request in the same void transaction before creating a credit note', async () => {
    const db = mockDb();
    consume.mockRejectedValue(new ConflictException('snapshot changed'));
    const svc = new ReceiptVoidService(db as never, {} as never, {} as never);
    await expect(svc.voidReceipt('r1', 'wrong entry', 'maker', 'nominated', 'OWNER', context)).rejects.toThrow('snapshot changed');
    expect(consume).toHaveBeenCalledWith(db.tx, context, 'VOID_RECEIPT', 'r1');
    expect(db.tx.receipt.create).not.toHaveBeenCalled();
  });

  it('does not let an approved waiver request be executed under another requester', async () => {
    const db = mockDb();
    const svc = new LateFeeWaiverService(db as never, {} as never, {} as never);
    await expect(svc.waiveLateFee('p1', 'goodwill', 'other-maker', 'nominated', undefined, context)).rejects.toThrow(ForbiddenException);
    expect(db.tx.payment.update).not.toHaveBeenCalled();
  });

  it('records the authenticated approver rather than the nominated approver', async () => {
    const db = mockDb();
    const svc = new LateFeeWaiverService(db as never, { logPaymentEvent: jest.fn() } as never, {} as never);
    await svc.waiveLateFee('p1', 'goodwill', 'maker', 'nominated', undefined, context);
    expect(consume).toHaveBeenCalledWith(db.tx, context, 'WAIVE_LATE_FEE', 'p1');
    expect(db.tx.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      waivedById: 'maker', waivedApprovedById: context.actorId,
    }) }));
    expect(db.tx.feeWaiverApproval.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approverId: context.actorId }) }));
  });
});

describe('bank refund approval keeps its existing queue', () => {
  it('authorizes the actual actor and atomically approves a pending refund', async () => {
    const db = mockDb();
    db.tx.payment.findUnique.mockResolvedValue({ id: 'p1', contractId: 'c1', amountPaid: new Prisma.Decimal(1000), status: 'PAID', deletedAt: null } as never);
    await new RefundsService(db as never, {} as never, {} as never).approveRefund('rf1', 'approver', 'SALES');
    expect(assertPermission).toHaveBeenCalledWith(db.tx, 'approver', 'REFUND');
    expect(db.tx.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'rf1', status: 'REQUESTED', deletedAt: null },
      data: expect.objectContaining({ approvedById: 'approver' }),
    }));
    expect(db.tx.auditLog.create).toHaveBeenCalled();
  });

  it('requires OWNER self-approval to have its own reason', async () => {
    const db = mockDb();
    db.tx.payment.findUnique.mockResolvedValue({ id: 'p1', contractId: 'c1', amountPaid: new Prisma.Decimal(1000), status: 'PAID', deletedAt: null } as never);
    assertPermission.mockResolvedValue({ user: { id: 'maker', name: 'Owner', role: 'OWNER', branchId: 'branch-a' }, permissions: ['REFUND'] });
    const svc = new RefundsService(db as never, {} as never, {} as never);
    await expect(svc.approveRefund('rf1', 'maker', 'OWNER')).rejects.toThrow('เจ้าของต้องระบุเหตุผล');
    expect(db.tx.refund.updateMany).not.toHaveBeenCalled();
    await svc.approveRefund('rf1', 'maker', 'OWNER', 'ตรวจสอบยอดคืนด้วยตนเอง');
    expect(db.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      newValue: expect.objectContaining({ ownerSelfApproval: true, reason: 'ตรวจสอบยอดคืนด้วยตนเอง' }),
    }) }));
  });

  it('rejects self-approval for a non-owner even if the caller supplies an OWNER role string', async () => {
    const db = mockDb();
    db.tx.payment.findUnique.mockResolvedValue({ id: 'p1', contractId: 'c1', amountPaid: new Prisma.Decimal(1000), status: 'PAID', deletedAt: null } as never);
    const svc = new RefundsService(db as never, {} as never, {} as never);
    await expect(svc.approveRefund('rf1', 'maker', 'OWNER', 'reason')).rejects.toThrow(ForbiddenException);
    expect(db.tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('does not record approval audit after a concurrent approval wins', async () => {
    const db = mockDb();
    db.tx.payment.findUnique.mockResolvedValue({ id: 'p1', contractId: 'c1', amountPaid: new Prisma.Decimal(1000), status: 'PAID', deletedAt: null } as never);
    db.tx.refund.updateMany.mockResolvedValue({ count: 0 });
    const svc = new RefundsService(db as never, {} as never, {} as never);
    await expect(svc.approveRefund('rf1', 'approver', 'FINANCE_MANAGER')).rejects.toThrow(ConflictException);
    expect(db.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
