import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('RefundsService', () => {
  let service: RefundsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;

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
      payment: { findUnique: jest.fn().mockResolvedValue(paidPayment()) },
      refund: {
        create: jest.fn((args) => Promise.resolve({ id: 'rf-1', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ ...refundRecord(), ...args.data })),
        findUnique: jest.fn().mockResolvedValue(refundRecord()),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = mod.get(RefundsService);
  });

  describe('requestRefund', () => {
    it('creates REQUESTED refund + writes audit', async () => {
      const result = await service.requestRefund(
        { paymentId: 'pay-1', amount: 500, reason: 'customer double-paid ชำระซ้ำ' },
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
      await service.markReversed(
        'rf-1',
        { bankReversalRef: 'KBANK-12345', notes: 'confirmed phone call' },
        'u-fm',
        'FINANCE_MANAGER',
      );
      const data = prisma.refund.update.mock.calls[0][0].data;
      expect(data.status).toBe('PROCESSED');
      expect(data.bankReversalRef).toBe('KBANK-12345');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFUND_PROCESSED' }),
      );
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
