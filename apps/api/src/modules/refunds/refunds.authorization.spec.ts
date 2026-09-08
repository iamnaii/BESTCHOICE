import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RefundsService } from './refunds.service';

jest.mock('../../utils/period-lock.util', () => ({ validatePeriodOpen: jest.fn() }));

function fixture(role = 'SALES', branchId: string | null = 'branch-a') {
  const user = { id: 'actor', name: 'Actor', role, branchId };
  const refund = {
    id: 'refund',
    paymentId: 'payment',
    contractId: 'contract',
    requestedAt: new Date('2026-09-08T00:00:00Z'),
    status: 'REQUESTED',
    amount: new Prisma.Decimal(1000),
    requestedById: 'maker',
    deletedAt: null,
    bankReversalLockedAt: null,
    bankReversalRef: null,
  };
  const tx = {
    user: { findFirst: jest.fn().mockResolvedValue(user) },
    systemConfig: {
      findFirst: jest.fn().mockResolvedValue({ value: JSON.stringify({ actor: ['REFUND'] }) }),
    },
    contract: { findFirst: jest.fn().mockResolvedValue({ branchId: 'branch-a' }) },
    payment: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: 'payment',
          contractId: 'contract',
          amountPaid: new Prisma.Decimal(1000),
          status: 'PAID',
          refunds: [],
          deletedAt: null,
        }),
      update: jest.fn().mockResolvedValue({}),
    },
    refund: {
      findUnique: jest.fn().mockResolvedValue(refund),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue(refund),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    journalEntry: { findMany: jest.fn().mockResolvedValue([{ id: 'je', companyId: 'company', lines: [] }]) },
    receipt: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const reversal = { voidReceipt: jest.fn().mockResolvedValue({ entryNo: 'REV-1' }) };
  const service = new RefundsService(prisma as never, {} as never, reversal as never);
  return { user, refund, tx, prisma, service, reversal };
}

describe('refund authorization uses current permission and branch', () => {
  it('lets a delegated SALES actor approve within their current branch', async () => {
    const f = fixture();
    await f.service.approveRefund('refund', 'actor', 'SALES');
    expect(f.tx.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'actor', isActive: true, deletedAt: null } }),
    );
    expect(f.tx.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'refund', status: 'REQUESTED', deletedAt: null },
        data: expect.objectContaining({ approvedById: 'actor' }),
      }),
    );
    expect(f.tx.auditLog.create).toHaveBeenCalled();
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it.each(['SALES', 'BRANCH_MANAGER'])(
    'denies %s approval outside the current branch',
    async (role) => {
      const f = fixture(role, 'branch-b');
      await expect(f.service.approveRefund('refund', 'actor', 'OWNER')).rejects.toThrow(
        ForbiddenException,
      );
      expect(f.tx.refund.updateMany).not.toHaveBeenCalled();
    },
  );

  it('denies a revoked grant even with a forged OWNER role parameter', async () => {
    const f = fixture();
    f.tx.systemConfig.findFirst.mockResolvedValue({ value: '{}' });
    await expect(f.service.approveRefund('refund', 'actor', 'OWNER')).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.tx.refund.findUnique).not.toHaveBeenCalled();
  });

  it('denies a deactivated actor before listing or approving', async () => {
    const f = fixture();
    f.tx.user.findFirst.mockResolvedValue(null);
    await expect(f.service.findAll({}, 'actor')).rejects.toThrow(ForbiddenException);
    await expect(f.service.approveRefund('refund', 'actor', 'OWNER')).rejects.toThrow(
      ForbiddenException,
    );
    expect(f.tx.refund.findMany).not.toHaveBeenCalled();
  });

  it('scopes both list and count to the current branch and excludes deleted contracts', async () => {
    const f = fixture();
    await f.service.findAll({ contractId: 'different-contract' }, 'actor');
    const where = {
      deletedAt: null,
      contractId: 'different-contract',
      payment: { contract: { deletedAt: null, branchId: 'branch-a' } },
    };
    expect(f.tx.refund.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(f.tx.refund.count).toHaveBeenCalledWith({ where });
  });

  it('denies branchless detail/request and prevents soft-deleted refund reads', async () => {
    const f = fixture('SALES', null);
    await expect(f.service.findOne('refund', 'actor')).rejects.toThrow(ForbiddenException);
    await expect(
      f.service.requestRefund(
        { paymentId: 'payment', amount: 1000, reason: 'customer duplicated transfer' },
        'actor',
      ),
    ).rejects.toThrow(ForbiddenException);
    f.refund.deletedAt = new Date() as never;
    await expect(f.service.findOne('refund', 'actor')).rejects.toThrow(NotFoundException);
    expect(f.tx.refund.create).not.toHaveBeenCalled();
  });

  it('allows staff to request without an approval grant in their branch', async () => {
    const f = fixture();
    f.tx.systemConfig.findFirst.mockResolvedValue({ value: '{}' });
    await f.service.requestRefund(
      { paymentId: 'payment', amount: 1000, reason: 'customer duplicated transfer' },
      'actor',
    );
    expect(f.tx.refund.create).toHaveBeenCalled();
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REFUND_REQUESTED' }) }),
    );
  });

  it('does not allow non-owner self approval; OWNER requires its own reason', async () => {
    const f = fixture();
    f.refund.requestedById = 'actor';
    await expect(f.service.approveRefund('refund', 'actor', 'OWNER', 'reason')).rejects.toThrow(
      ForbiddenException,
    );
    f.user.role = 'OWNER';
    await expect(f.service.approveRefund('refund', 'actor', 'OWNER')).rejects.toThrow(
      BadRequestException,
    );
    await f.service.approveRefund('refund', 'actor', 'OWNER', 'checked bank evidence');
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({
            ownerSelfApproval: true,
            reason: 'checked bank evidence',
          }),
        }),
      }),
    );
  });

  it('reject uses the REFUND grant, branch check and CAS with atomic audit', async () => {
    const f = fixture();
    await f.service.rejectRefund('refund', { reason: 'invalid bank evidence' }, 'actor', 'SALES');
    expect(f.tx.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'refund', status: 'REQUESTED', deletedAt: null },
        data: expect.objectContaining({
          rejectedById: 'actor',
          rejectedReason: 'invalid bank evidence',
        }),
      }),
    );
    expect(f.tx.auditLog.create).toHaveBeenCalled();
    f.tx.auditLog.create.mockClear();
    f.tx.refund.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      f.service.rejectRefund('refund', { reason: 'invalid bank evidence' }, 'actor', 'OWNER'),
    ).rejects.toThrow(ConflictException);
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('reject denies a revoked grant and another branch', async () => {
    const f = fixture('SALES', 'branch-b');
    await expect(
      f.service.rejectRefund('refund', { reason: 'reason' }, 'actor', 'OWNER'),
    ).rejects.toThrow(ForbiddenException);
    f.user.branchId = 'branch-a';
    f.tx.systemConfig.findFirst.mockResolvedValue({ value: '{}' });
    await expect(
      f.service.rejectRefund('refund', { reason: 'reason' }, 'actor', 'OWNER'),
    ).rejects.toThrow(ForbiddenException);
    expect(f.tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it.each(['markReversed', 'markFailed'] as const)(
    '%s checks the current bank role despite a delegated grant and forged role',
    async (method) => {
      const f = fixture();
      f.refund.status = 'APPROVED';
      const action =
        method === 'markReversed'
          ? f.service.markReversed(
              'refund',
              { bankReversalRef: 'bank-1', notes: 'confirmed' },
              'actor',
              'OWNER',
            )
          : f.service.markFailed('refund', { failureReason: 'bank denied' }, 'actor', 'OWNER');
      await expect(action).rejects.toThrow(ForbiddenException);
      expect(f.tx.refund.updateMany).not.toHaveBeenCalled();
      expect(f.reversal.voidReceipt).not.toHaveBeenCalled();
    },
  );

  it('bank confirmation preserves full-money checks and audit in the reversal transaction', async () => {
    const f = fixture('FINANCE_MANAGER');
    f.refund.status = 'APPROVED';
    await f.service.markReversed(
      'refund',
      { bankReversalRef: 'bank-1', notes: 'confirmed' },
      'actor',
      'OWNER',
    );
    expect(f.reversal.voidReceipt).toHaveBeenCalledWith('je', f.tx, { flow: 'refund-reversal' });
    expect(f.tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'payment' },
      data: { amountPaid: 0, status: 'PENDING', paidDate: null },
    });
    expect(f.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REFUND_PROCESSED' }) }),
    );
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('maps a serialization conflict to a retryable conflict response', async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('write conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    await expect(f.service.approveRefund('refund', 'actor', 'SALES')).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('refund returns cash received, excluding approved settlement relief', () => {
  const cashReceipt = (amount: string, extra: Record<string, unknown> = {}) => ({
    amount: new Prisma.Decimal(amount), isVoided: false, deletedAt: null,
    createdAt: new Date('2026-09-07T00:00:00Z'), ...extra,
  });

  it('requests 999.50 cash when a 0.50 approved shortage settled 1000.00 debt', async () => {
    const f = fixture();
    f.tx.receipt.findMany.mockResolvedValue([cashReceipt('999.50')]);
    await f.service.requestRefund({ paymentId: 'payment', amount: 999.5, reason: 'wrong bank collection' }, 'actor');
    expect(f.tx.refund.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: new Prisma.Decimal('999.50') }) }));
    f.tx.refund.create.mockClear();
    await expect(f.service.requestRefund({ paymentId: 'payment', amount: 1000, reason: 'wrong bank collection' }, 'actor')).rejects.toThrow(BadRequestException);
    expect(f.tx.refund.create).not.toHaveBeenCalled();
  });

  it('sums active partial cash receipts and excludes voided/deleted cash', async () => {
    const f = fixture();
    f.tx.receipt.findMany.mockResolvedValue([cashReceipt('500'), cashReceipt('499.50'), cashReceipt('100', { isVoided: true }), cashReceipt('200', { deletedAt: new Date() })]);
    f.refund.amount = new Prisma.Decimal('999.50');
    await f.service.approveRefund('refund', 'actor', 'SALES');
    expect(f.tx.receipt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { paymentId: 'payment', contractId: 'contract', receiptType: { in: ['INSTALLMENT', 'PAYMENT'] } } }));
    expect(f.tx.refund.updateMany).toHaveBeenCalled();
  });

  it('refuses settled-debt amount at approval when it exceeds actual receipt cash', async () => {
    const f = fixture();
    f.tx.receipt.findMany.mockResolvedValue([cashReceipt('999.50')]);
    await expect(f.service.approveRefund('refund', 'actor', 'SALES')).rejects.toThrow(BadRequestException);
    expect(f.tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('never falls back to settled debt after all receipt history was voided', async () => {
    const f = fixture();
    f.tx.receipt.findMany.mockResolvedValue([cashReceipt('1000', { isVoided: true })]);
    await expect(f.service.requestRefund({ paymentId: 'payment', amount: 1000, reason: 'wrong bank collection' }, 'actor')).rejects.toThrow(BadRequestException);
    await expect(f.service.approveRefund('refund', 'actor', 'SALES')).rejects.toThrow(BadRequestException);
    expect(f.tx.refund.create).not.toHaveBeenCalled();
    expect(f.tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a new receipt after the request even if its cash total is unchanged', async () => {
    const f = fixture();
    f.tx.receipt.findMany.mockResolvedValue([cashReceipt('1000', { createdAt: new Date('2026-09-08T01:00:00Z') })]);
    await expect(f.service.approveRefund('refund', 'actor', 'SALES')).rejects.toThrow(ConflictException);
    expect(f.tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('bank confirmation returns full 999.50 cash and still reverses all payment legs', async () => {
    const f = fixture('FINANCE_MANAGER');
    f.refund.status = 'APPROVED';
    f.refund.amount = new Prisma.Decimal('999.50');
    f.tx.receipt.findMany.mockResolvedValue([cashReceipt('999.50')]);
    await f.service.markReversed('refund', { bankReversalRef: 'bank-1', notes: 'confirmed cash' }, 'actor', 'OWNER');
    expect(f.reversal.voidReceipt).toHaveBeenCalledWith('je', f.tx, { flow: 'refund-reversal' });
    expect(f.tx.payment.update).toHaveBeenCalledWith({ where: { id: 'payment' }, data: { status: 'PENDING', amountPaid: 0, paidDate: null } });
  });

  it('bank confirmation rejects cash history drift before reversal', async () => {
    const f = fixture('FINANCE_MANAGER');
    f.refund.status = 'APPROVED';
    f.tx.receipt.findMany.mockResolvedValue([cashReceipt('999.50')]);
    await expect(f.service.markReversed('refund', { bankReversalRef: 'bank-1', notes: 'confirmed cash' }, 'actor', 'OWNER')).rejects.toThrow(BadRequestException);
    expect(f.reversal.voidReceipt).not.toHaveBeenCalled();
    expect(f.tx.refund.updateMany).not.toHaveBeenCalled();
  });
});

describe('bank refund refuses advance or credit funding', () => {
  const mixedEntry = (accountCode: string, debit: string, credit: string, reversed = false) => ({
    id: 'mixed-je', companyId: 'company', metadata: { tag: 'receipt', reversed },
    lines: [{ accountCode, debit: new Prisma.Decimal(debit), credit: new Prisma.Decimal(credit) }],
  });

  it.each([
    ['21-1103', '100', '0'],
    ['21-1103', '0', '100'],
    ['21-5101', '100', '0'],
    ['21-5101', '0', '100'],
  ])('rejects request with a nonzero %s leg (Dr %s / Cr %s)', async (accountCode, debit, credit) => {
    const f = fixture();
    f.tx.journalEntry.findMany.mockResolvedValue([mixedEntry(accountCode, debit, credit)]);
    await expect(f.service.requestRefund({ paymentId: 'payment', amount: 1000, reason: 'wrong bank collection' }, 'actor')).rejects.toThrow('กรุณาส่งคำขอยกเลิกใบเสร็จ');
    expect(f.tx.refund.create).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses approval if mixed funding is present and leaves the request pending', async () => {
    const f = fixture();
    f.tx.journalEntry.findMany.mockResolvedValue([mixedEntry('21-1103', '100', '0')]);
    await expect(f.service.approveRefund('refund', 'actor', 'SALES')).rejects.toThrow('กรุณาส่งคำขอยกเลิกใบเสร็จ');
    expect(f.tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('rechecks mixed funding before bank confirmation and makes no reversal/write', async () => {
    const f = fixture('FINANCE_MANAGER');
    f.refund.status = 'APPROVED';
    f.tx.journalEntry.findMany.mockResolvedValue([mixedEntry('21-5101', '100', '0')]);
    await expect(f.service.markReversed('refund', { bankReversalRef: 'bank-1', notes: 'confirmed' }, 'actor', 'OWNER')).rejects.toThrow('กรุณาส่งคำขอยกเลิกใบเสร็จ');
    expect(f.reversal.voidReceipt).not.toHaveBeenCalled();
    expect(f.tx.payment.update).not.toHaveBeenCalled();
    expect(f.tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it('ignores already reversed originals and permits zero-valued liability lines', async () => {
    const f = fixture();
    f.tx.journalEntry.findMany.mockResolvedValue([
      mixedEntry('21-1103', '100', '0', true), mixedEntry('21-5101', '0', '0'),
    ]);
    await f.service.approveRefund('refund', 'actor', 'SALES');
    expect(f.tx.refund.updateMany).toHaveBeenCalled();
    expect(f.tx.journalEntry.findMany).toHaveBeenCalledWith({
      where: { AND: [
        { metadata: { path: ['paymentId'], equals: 'payment' } },
        { OR: [
          { metadata: { path: ['tag'], equals: 'receipt' } },
          { metadata: { path: ['tag'], equals: '2B' } },
          { metadata: { path: ['tag'], equals: 'credit-allocation' } },
        ] },
        { status: 'POSTED' }, { deletedAt: null },
      ] },
      select: { metadata: true, lines: {
        where: { deletedAt: null, accountCode: { in: ['21-1103', '21-5101'] } },
        select: { debit: true, credit: true },
      } },
    });
  });
});
