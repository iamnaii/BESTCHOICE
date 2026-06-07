jest.mock('../../utils/period-lock.util', () => ({ validatePeriodOpen: jest.fn() }));

import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ReceiptVoidReversalTemplate } from '../journal/cpa-templates/receipt-void-reversal.template';
import { validatePeriodOpen } from '../../utils/period-lock.util';

describe('RefundsService', () => {
  let service: RefundsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let template: any;

  const paidPayment = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    contractId: 'con-1',
    amountPaid: new Prisma.Decimal(1000),
    status: 'PAID',
    deletedAt: null,
    refunds: [],
    ...overrides,
  });

  const refundRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'rf-1',
    paymentId: 'pay-1',
    contractId: 'con-1',
    amount: new Prisma.Decimal(500),
    reason: 'customer double-paid',
    status: 'REQUESTED',
    requestedById: 'u-staff',
    requestedAt: new Date(),
    approvedById: null,
    approvedAt: null,
    rejectedById: null,
    rejectedAt: null,
    deletedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(paidPayment()),
        update: jest.fn().mockResolvedValue({}),
      },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      receipt: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      refund: {
        create: jest.fn((args) => Promise.resolve({ id: 'rf-1', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ ...refundRecord(), ...args.data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), // CAS: APPROVED → PROCESSED
        findUnique: jest.fn().mockResolvedValue(refundRecord()),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    // $transaction runs the callback against the same mock (tx === prisma here).
    prisma.$transaction = jest
      .fn()
      .mockImplementation(async (cb: (t: typeof prisma) => unknown) => cb(prisma));
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    template = { voidReceipt: jest.fn().mockResolvedValue({ entryNo: 'JE-REV-1' }) };
    (validatePeriodOpen as jest.Mock).mockReset().mockResolvedValue(undefined);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ReceiptVoidReversalTemplate, useValue: template },
      ],
    }).compile();
    service = mod.get(RefundsService);
  });

  describe('requestRefund', () => {
    it('rejects a partial refund (amount < amountPaid) — full refunds only', async () => {
      // paidPayment amountPaid = 1000; a 500 request is partial → rejected up front.
      await expect(
        service.requestRefund({ paymentId: 'pay-1', amount: 500, reason: 'partial xxxxxxxx' }, 'u-staff'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('creates REQUESTED refund + writes audit', async () => {
      const result = await service.requestRefund(
        { paymentId: 'pay-1', amount: 1000, reason: 'customer double-paid ชำระซ้ำ' }, // full = amountPaid
        'u-staff',
      );
      expect(result.id).toBe('rf-1');
      expect(prisma.refund.create).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFUND_REQUESTED', entity: 'Refund' }),
      );
    });

    it('throws NotFound when payment missing', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await expect(
        service.requestRefund({ paymentId: 'missing', amount: 500, reason: 'xxxxxxxxxx' }, 'u-staff'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when payment is PENDING (not paid)', async () => {
      prisma.payment.findUnique.mockResolvedValue(paidPayment({ status: 'PENDING' }));
      await expect(
        service.requestRefund({ paymentId: 'pay-1', amount: 500, reason: 'xxxxxxxxxx' }, 'u-staff'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when open refund already exists (REQUESTED/APPROVED)', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({ refunds: [refundRecord({ status: 'REQUESTED' })] }),
      );
      await expect(
        service.requestRefund({ paymentId: 'pay-1', amount: 500, reason: 'xxxxxxxxxx' }, 'u-staff'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when total refunds would exceed amount paid', async () => {
      prisma.payment.findUnique.mockResolvedValue(
        paidPayment({
          amountPaid: new Prisma.Decimal(1000),
          refunds: [
            { ...refundRecord(), status: 'PROCESSED', amount: new Prisma.Decimal(600) },
          ],
        }),
      );
      await expect(
        service.requestRefund({ paymentId: 'pay-1', amount: 500, reason: 'xxxxxxxxxx' }, 'u-staff'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveRefund', () => {
    it('blocks self-approval', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ requestedById: 'u-same' }));
      await expect(service.approveRefund('rf-1', 'u-same', 'OWNER')).rejects.toThrow(ForbiddenException);
    });

    it('blocks BRANCH_MANAGER role (OWNER/FM only)', async () => {
      await expect(
        service.approveRefund('rf-1', 'u-other', 'BRANCH_MANAGER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects non-REQUESTED status', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      await expect(
        service.approveRefund('rf-1', 'u-fm', 'FINANCE_MANAGER'),
      ).rejects.toThrow(BadRequestException);
    });

    it('OWNER can approve (different user than requester) + audit', async () => {
      await service.approveRefund('rf-1', 'u-owner', 'OWNER');
      expect(prisma.refund.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED', approvedById: 'u-owner' }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFUND_APPROVED' }),
      );
    });
  });

  describe('rejectRefund', () => {
    it('rejects self-rejection', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ requestedById: 'u-same' }));
      await expect(
        service.rejectRefund('rf-1', { reason: 'no basis' }, 'u-same', 'OWNER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates status REJECTED + stores reason', async () => {
      await service.rejectRefund('rf-1', { reason: 'insufficient evidence' }, 'u-fm', 'FINANCE_MANAGER');
      const data = prisma.refund.update.mock.calls[0][0].data;
      expect(data.status).toBe('REJECTED');
      expect(data.rejectedReason).toBe('insufficient evidence');
    });
  });

  describe('markReversed', () => {
    it('requires APPROVED status', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'REQUESTED' }));
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'KBANK-12345', notes: 'confirmed by phone' },
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets PROCESSED with bank ref + audit', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue({ amountPaid: new Prisma.Decimal(500) }); // = refund.amount (full)
      await service.markReversed(
        'rf-1',
        { bankReversalRef: 'KBANK-12345', notes: 'confirmed phone call' },
        'u-fm',
        'FINANCE_MANAGER',
      );
      const data = prisma.refund.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('PROCESSED');
      expect(data.bankReversalRef).toBe('KBANK-12345');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFUND_PROCESSED' }),
      );
    });

    it('rejects a partial refund (amount ≠ amountPaid) — full refunds only', async () => {
      prisma.refund.findUnique.mockResolvedValue(
        refundRecord({ status: 'APPROVED', amount: new Prisma.Decimal(500) }),
      );
      prisma.payment.findUnique.mockResolvedValue({ amountPaid: new Prisma.Decimal(1000) }); // 500 ≠ 1000
      await expect(
        service.markReversed('rf-1', { bankReversalRef: 'KBANK-x', notes: 'partial' }, 'u-owner', 'OWNER'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('markReversed — ledger reversal', () => {
    it('reverses the original payment JE (referenceType AUTO, flow refund-reversal), reverts the payment + voids its receipt', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue({ amountPaid: new Prisma.Decimal(500) }); // = refund.amount
      prisma.journalEntry.findFirst.mockResolvedValue({ id: 'je-1', companyId: 'co-finance' });
      await service.markReversed('rf-1', { bankReversalRef: 'KBANK-1', notes: 'rev' }, 'u-owner', 'OWNER');

      // Payment JEs are referenceType 'AUTO' (not 'PAYMENT'). Asserting the exact
      // where-clause is what catches the no-op the review found — do NOT relax this.
      expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith({
        where: { referenceType: 'AUTO', referenceId: 'pay-1', status: 'POSTED', deletedAt: null },
      });
      expect(template.voidReceipt).toHaveBeenCalledWith('je-1', prisma, { flow: 'refund-reversal' });
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'PENDING', amountPaid: 0, paidDate: null },
      });
      expect(prisma.receipt.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'pay-1', isVoided: false, deletedAt: null },
        data: expect.objectContaining({ isVoided: true, voidApprovedById: 'u-owner' }),
      });
      const data = prisma.refund.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('PROCESSED');
    });

    it('legacy payment with no POSTED JE: skips the reversal but still reverts the payment', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue({ amountPaid: new Prisma.Decimal(500) });
      prisma.journalEntry.findFirst.mockResolvedValue(null);
      await service.markReversed('rf-1', { bankReversalRef: 'KBANK-2', notes: 'rev' }, 'u-owner', 'OWNER');
      expect(template.voidReceipt).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalled();
    });

    it('closed period: throws and reverts nothing', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      prisma.payment.findUnique.mockResolvedValue({ amountPaid: new Prisma.Decimal(500) });
      (validatePeriodOpen as jest.Mock).mockRejectedValue(new Error('period closed'));
      await expect(
        service.markReversed('rf-1', { bankReversalRef: 'KBANK-3', notes: 'rev' }, 'u-owner', 'OWNER'),
      ).rejects.toThrow('period closed');
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  // T1-C8 — bankReversalRef / bankReversalAt are write-once. First write
  // sets bankReversalLockedAt; any subsequent markReversed attempt must
  // reject with a Thai error.
  describe('markReversed — T1-C8 bank reversal lock', () => {
    it('first write sets bankReversalLockedAt', async () => {
      prisma.refund.findUnique.mockResolvedValue(
        refundRecord({ status: 'APPROVED', bankReversalLockedAt: null, bankReversalRef: null }),
      );
      prisma.payment.findUnique.mockResolvedValue({ amountPaid: new Prisma.Decimal(500) }); // = refund.amount (full)
      await service.markReversed(
        'rf-1',
        { bankReversalRef: 'SCB-00001', notes: 'first write' },
        'u-owner',
        'OWNER',
      );
      const data = prisma.refund.updateMany.mock.calls[0][0].data;
      expect(data.bankReversalRef).toBe('SCB-00001');
      expect(data.bankReversalLockedAt).toBeInstanceOf(Date);
    });

    it('rejects a second write once bankReversalLockedAt is set', async () => {
      prisma.refund.findUnique.mockResolvedValue(
        refundRecord({
          status: 'APPROVED',
          bankReversalRef: 'SCB-00001',
          bankReversalAt: new Date('2026-04-01'),
          bankReversalLockedAt: new Date('2026-04-01'),
        }),
      );
      await expect(
        service.markReversed(
          'rf-1',
          { bankReversalRef: 'SCB-99999', notes: 'try to overwrite' },
          'u-owner',
          'OWNER',
        ),
      ).rejects.toThrow(/ถูกล็อคแล้ว/);
      expect(prisma.refund.update).not.toHaveBeenCalled();
    });

    it('reading still works after lock is set (findOne)', async () => {
      const frozen = refundRecord({
        status: 'PROCESSED',
        bankReversalRef: 'SCB-00001',
        bankReversalAt: new Date('2026-04-01'),
        bankReversalLockedAt: new Date('2026-04-01'),
      });
      prisma.refund.findUnique.mockResolvedValue(frozen);
      const result = await service.findOne('rf-1');
      expect(result.bankReversalRef).toBe('SCB-00001');
      expect(result.bankReversalLockedAt).toBeInstanceOf(Date);
    });
  });

  describe('markFailed', () => {
    it('sets FAILED with reason when bank declined', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRecord({ status: 'APPROVED' }));
      await service.markFailed(
        'rf-1',
        { failureReason: 'bank refused reversal after 7 days' },
        'u-owner',
        'OWNER',
      );
      const data = prisma.refund.update.mock.calls[0][0].data;
      expect(data.status).toBe('FAILED');
      expect(data.failureReason).toContain('bank refused');
    });
  });
});
