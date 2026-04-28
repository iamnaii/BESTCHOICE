jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
  SentryModule: class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { AuditService } from '../audit/audit.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ProductsService } from '../products/products.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { WarrantyService } from '../warranty/warranty.service';
import { PromiseService } from '../overdue/promise.service';
import { MdmLockService } from '../overdue/mdm-lock.service';
import * as Sentry from '@sentry/node';

describe('PaymentsService', () => {
  let service: PaymentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let receiptsService: any;

  const mockContract = {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    status: 'ACTIVE',
    deletedAt: null,
    branchId: 'branch-1',
  };

  const mockPayment = {
    id: 'payment-1',
    contractId: 'contract-1',
    installmentNo: 1,
    amountDue: 3000,
    amountPaid: 0,
    lateFee: 0,
    status: 'PENDING',
    evidenceUrl: null,
    notes: null,
  };

  beforeEach(async () => {
    const mockPrisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(mockContract),
        update: jest.fn().mockResolvedValue(mockContract),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(mockPayment),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(mockPayment),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: 0, lateFee: 0 } }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'approver-1',
          role: 'FINANCE_MANAGER',
          isActive: true,
          deletedAt: null,
        }),
      },
      systemConfig: {
        findUnique: jest.fn().mockResolvedValue(null), // CR-7: period lock check
      },
      // T3-C4: immutable approval audit row written alongside the waiver
      feeWaiverApproval: {
        create: jest.fn().mockResolvedValue({ id: 'waiver-approval-1' }),
      },
      // Yeastar W3: recording lifecycle bumped on contract completion
      callLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };

    const mockReceiptsService = {
      generateReceipt: jest.fn().mockResolvedValue({ id: 'receipt-1', receiptNumber: 'RC-2026-03-00001' }),
    };

    const mockAuditService = {
      log: jest.fn().mockResolvedValue(undefined),
      logPaymentEvent: jest.fn().mockResolvedValue(undefined),
      logReceiptEvent: jest.fn().mockResolvedValue(undefined),
      logContractFinancialEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ReceiptsService, useValue: mockReceiptsService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: JournalAutoService, useValue: { createPaymentJournal: jest.fn().mockResolvedValue('je-1'), createExpenseJournal: jest.fn(), createContractActivationJournal: jest.fn(), createBadDebtWriteOffJournal: jest.fn() } },
        { provide: ProductsService, useValue: { transferOwnership: jest.fn() } },
        { provide: LineOaService, useValue: { buildPaymentSuccess: jest.fn().mockReturnValue({}), sendFlexMessage: jest.fn() } },
        {
          provide: FlexTemplatesService,
          useValue: {
            paymentReceipt: jest.fn().mockReturnValue({ type: 'flex', altText: 'test', contents: {} }),
          },
        },
        {
          provide: QuickReplyService,
          useValue: {
            afterPayment: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: WarrantyService,
          useValue: {
            setShopWarranty: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PromiseService,
          useValue: {
            findActivePromise: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: MdmLockService,
          useValue: {
            autoUnlock: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    prisma = module.get<PrismaService>(PrismaService);
    receiptsService = module.get<ReceiptsService>(ReceiptsService);
  });

  describe('recordPayment', () => {
    it('should throw if amount is 0', async () => {
      await expect(
        service.recordPayment('contract-1', 1, 0, 'CASH', 'user-1', 'http://slip.jpg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if amount is negative', async () => {
      await expect(
        service.recordPayment('contract-1', 1, -100, 'CASH', 'user-1', 'http://slip.jpg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if no evidence and no transaction ref', async () => {
      await expect(
        service.recordPayment('contract-1', 1, 1000, 'CASH', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if contract not found', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      await expect(
        service.recordPayment('contract-x', 1, 1000, 'CASH', 'user-1', 'http://slip.jpg'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if contract is deleted', async () => {
      prisma.contract.findUnique.mockResolvedValue({ ...mockContract, deletedAt: new Date() });
      await expect(
        service.recordPayment('contract-1', 1, 1000, 'CASH', 'user-1', 'http://slip.jpg'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if contract status is COMPLETED', async () => {
      prisma.contract.findUnique.mockResolvedValue({ ...mockContract, status: 'COMPLETED' });
      await expect(
        service.recordPayment('contract-1', 1, 1000, 'CASH', 'user-1', 'http://slip.jpg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if payment not found', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);
      await expect(
        service.recordPayment('contract-1', 99, 1000, 'CASH', 'user-1', 'http://slip.jpg'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if payment already paid', async () => {
      prisma.payment.findFirst.mockResolvedValue({ ...mockPayment, status: 'PAID' });
      await expect(
        service.recordPayment('contract-1', 1, 1000, 'CASH', 'user-1', 'http://slip.jpg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if amount exceeds remaining', async () => {
      await expect(
        service.recordPayment('contract-1', 1, 5000, 'CASH', 'user-1', 'http://slip.jpg'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept payment with evidence URL', async () => {
      const updatedPayment = { ...mockPayment, amountPaid: 3000, status: 'PAID', paidDate: new Date() };
      prisma.payment.update.mockResolvedValue(updatedPayment);

      const result = await service.recordPayment('contract-1', 1, 3000, 'CASH', 'user-1', 'http://slip.jpg');
      expect(result.status).toBe('PAID');
      expect(result.amountPaid).toBe(3000);
    });

    it('should accept payment with transaction ref instead of evidence URL', async () => {
      const updatedPayment = { ...mockPayment, amountPaid: 3000, status: 'PAID', paidDate: new Date() };
      prisma.payment.update.mockResolvedValue(updatedPayment);
      prisma.payment.findMany.mockResolvedValueOnce([]); // idempotency check - no duplicate

      const result = await service.recordPayment('contract-1', 1, 3000, 'TRANSFER', 'user-1', undefined, undefined, 'TXN-12345');
      expect(result.status).toBe('PAID');
    });

    it('should reject duplicate transactionRef (idempotency)', async () => {
      // findMany returns a candidate with exact matching ref tag
      prisma.payment.findMany.mockResolvedValueOnce([{
        id: 'payment-dup',
        notes: 'ref:TXN-DUPLICATE',
      }]);

      await expect(
        service.recordPayment('contract-1', 1, 3000, 'TRANSFER', 'user-1', undefined, undefined, 'TXN-DUPLICATE'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should append transactionRef to notes for tracking', async () => {
      const updatedPayment = { ...mockPayment, amountPaid: 3000, status: 'PAID', paidDate: new Date() };
      prisma.payment.update.mockResolvedValue(updatedPayment);
      prisma.payment.findMany.mockResolvedValueOnce([]); // idempotency check - no dup

      await service.recordPayment('contract-1', 1, 3000, 'TRANSFER', 'user-1', undefined, 'customer note', 'TXN-99');
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notes: 'customer note | ref:TXN-99',
          }),
        }),
      );
    });

    it('should mark as PARTIALLY_PAID for partial payment', async () => {
      const updatedPayment = { ...mockPayment, amountPaid: 1000, status: 'PARTIALLY_PAID', paidDate: null };
      prisma.payment.update.mockResolvedValue(updatedPayment);

      const result = await service.recordPayment('contract-1', 1, 1000, 'CASH', 'user-1', 'http://slip.jpg');
      expect(result.status).toBe('PARTIALLY_PAID');
    });

    it('should generate receipt on full payment', async () => {
      const updatedPayment = { ...mockPayment, id: 'payment-1', amountPaid: 3000, status: 'PAID', paidDate: new Date() };
      prisma.payment.update.mockResolvedValue(updatedPayment);

      await service.recordPayment('contract-1', 1, 3000, 'CASH', 'user-1', 'http://slip.jpg');
      expect(receiptsService.generateReceipt).toHaveBeenCalledWith(
        'contract-1', 'payment-1', 'INSTALLMENT', 3000, 1, 'CASH', null, 'user-1',
      );
    });

    it('should generate receipt on partial payment too (TFRS: receipt per cash event)', async () => {
      const updatedPayment = { ...mockPayment, id: 'payment-1', amountPaid: 1000, status: 'PARTIALLY_PAID', paidDate: null };
      prisma.payment.update.mockResolvedValue(updatedPayment);

      await service.recordPayment('contract-1', 1, 1000, 'CASH', 'user-1', 'http://slip.jpg');
      expect(receiptsService.generateReceipt).toHaveBeenCalledWith(
        'contract-1', 'payment-1', 'INSTALLMENT', 1000, 1, 'CASH', null, 'user-1',
      );
    });
  });

  describe('autoAllocatePayment', () => {
    it('should throw if amount is 0', async () => {
      await expect(
        service.autoAllocatePayment('contract-1', 0, 'CASH', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if no unpaid installments', async () => {
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        payments: [{ ...mockPayment, status: 'PAID' }],
      });
      await expect(
        service.autoAllocatePayment('contract-1', 1000, 'CASH', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allocate across multiple installments', async () => {
      const payments = [
        { ...mockPayment, id: 'p-1', installmentNo: 1, amountDue: 3000, amountPaid: 0, lateFee: 0, status: 'PENDING' },
        { ...mockPayment, id: 'p-2', installmentNo: 2, amountDue: 3000, amountPaid: 0, lateFee: 0, status: 'PENDING' },
      ];
      prisma.contract.findUnique.mockResolvedValue({
        ...mockContract,
        payments,
      });

      prisma.payment.update
        .mockResolvedValueOnce({ ...payments[0], amountPaid: 3000, status: 'PAID', paidDate: new Date() })
        .mockResolvedValueOnce({ ...payments[1], amountPaid: 2000, status: 'PARTIALLY_PAID', paidDate: null });

      const result = await service.autoAllocatePayment('contract-1', 5000, 'CASH', 'user-1');
      expect(result.allocatedPayments).toHaveLength(2);
      expect(result.totalAllocated).toBe(5000);
      expect(result.overpayment).toBe(0);
    });

    it('should attach evidenceUrl to the first payment only', async () => {
      const payments = [
        { ...mockPayment, id: 'p-1', installmentNo: 1, amountDue: 3000, amountPaid: 0, lateFee: 0, status: 'PENDING' },
        { ...mockPayment, id: 'p-2', installmentNo: 2, amountDue: 3000, amountPaid: 0, lateFee: 0, status: 'PENDING' },
      ];
      prisma.contract.findUnique.mockResolvedValue({ ...mockContract, payments });
      prisma.payment.update
        .mockResolvedValueOnce({ ...payments[0], amountPaid: 3000, status: 'PAID', paidDate: new Date() })
        .mockResolvedValueOnce({ ...payments[1], amountPaid: 2000, status: 'PARTIALLY_PAID', paidDate: null });

      await service.autoAllocatePayment(
        'contract-1', 5000, 'BANK_TRANSFER', 'user-1', undefined, 'https://slip.example.com/transfer.jpg',
      );

      const firstCall = prisma.payment.update.mock.calls[0][0];
      const secondCall = prisma.payment.update.mock.calls[1][0];
      expect(firstCall.data.evidenceUrl).toBe('https://slip.example.com/transfer.jpg');
      expect(secondCall.data.evidenceUrl).toBeUndefined();
    });
  });

  describe('getContractPayments', () => {
    it('should throw if contract not found', async () => {
      prisma.contract.findUnique.mockResolvedValue(null);
      await expect(service.getContractPayments('contract-x')).rejects.toThrow(NotFoundException);
    });

    it('should throw if contract is deleted', async () => {
      prisma.contract.findUnique.mockResolvedValue({ ...mockContract, deletedAt: new Date() });
      await expect(service.getContractPayments('contract-1')).rejects.toThrow(NotFoundException);
    });

    it('should return payments list', async () => {
      const payments = [mockPayment];
      prisma.payment.findMany.mockResolvedValue(payments);

      await service.getContractPayments('contract-1');
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ contractId: 'contract-1' }),
          orderBy: { installmentNo: 'asc' },
        }),
      );
    });
  });

  describe('getDailySummary', () => {
    it('should return summary with correct totals', async () => {
      const payments = [
        { amountPaid: 3000, lateFee: 100, paymentMethod: 'CASH', paidDate: new Date(), contract: { contractNumber: 'BC-001', customer: { name: 'A' }, branch: { name: 'B1' } }, recordedBy: { name: 'Staff' } },
        { amountPaid: 5000, lateFee: 0, paymentMethod: 'TRANSFER', paidDate: new Date(), contract: { contractNumber: 'BC-002', customer: { name: 'B' }, branch: { name: 'B1' } }, recordedBy: { name: 'Staff' } },
      ];
      prisma.payment.findMany.mockResolvedValue(payments);
      prisma.payment.count.mockResolvedValue(2);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amountPaid: 8000, lateFee: 100 } });

      const result = await service.getDailySummary('2026-03-11');
      expect(result.totalPayments).toBe(2);
      expect(result.totalAmount).toBe(8000);
      expect(result.totalLateFees).toBe(100);
      expect(result.byMethod).toEqual({ CASH: 3000, TRANSFER: 5000 });
    });
  });

  // T1-C2 — every late fee waiver must be 4-eyes: a different manager must
  // approve. Self-approval was the previous attack surface (~60k/day worst
  // case at full branch density).
  describe('waiveLateFee — T1-C2 4-eyes', () => {
    const payableWithFee = { ...mockPayment, lateFee: 200, lateFeeWaived: false };

    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue(payableWithFee);
    });

    it('rejects self-approval (requester === approver)', async () => {
      await expect(
        service.waiveLateFee('payment-1', 'goodwill', 'user-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('rejects when approverId is missing/empty', async () => {
      await expect(
        service.waiveLateFee('payment-1', 'goodwill', 'user-1', ''),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('rejects when approver does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.waiveLateFee('payment-1', 'goodwill', 'user-1', 'ghost'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when approver is deactivated', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'approver-1',
        role: 'FINANCE_MANAGER',
        isActive: false,
        deletedAt: null,
      });
      await expect(
        service.waiveLateFee('payment-1', 'goodwill', 'user-1', 'approver-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when approver is not manager-tier (e.g. SALES)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'sales-1',
        role: 'SALES',
        isActive: true,
        deletedAt: null,
      });
      await expect(
        service.waiveLateFee('payment-1', 'goodwill', 'user-1', 'sales-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows waiver when requester ≠ manager-tier approver', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'approver-1',
        role: 'FINANCE_MANAGER',
        isActive: true,
        deletedAt: null,
      });
      prisma.payment.update.mockResolvedValue({
        ...payableWithFee,
        lateFee: 0,
        lateFeeWaived: true,
      });

      const res = await service.waiveLateFee(
        'payment-1',
        'customer hardship',
        'user-1',
        'approver-1',
      );
      expect(res.lateFeeWaived).toBe(true);
      expect(prisma.payment.update).toHaveBeenCalled();
    });

    // T3-C4: FeeWaiverApproval immutable row MUST be written for every
    // approved waiver, so auditors have a log independent of the mutable
    // Payment.waived* columns. IP + UA are passed through from the
    // controller @Req() so we can detect anomalies later.
    it('writes a FeeWaiverApproval audit row with ip + userAgent', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'approver-1',
        role: 'FINANCE_MANAGER',
        isActive: true,
        deletedAt: null,
      });
      prisma.payment.update.mockResolvedValue({
        ...payableWithFee,
        lateFee: 0,
        lateFeeWaived: true,
      });

      await service.waiveLateFee(
        'payment-1',
        'customer hardship',
        'user-1',
        'approver-1',
        { ipAddress: '10.0.0.42', userAgent: 'Mozilla/5.0 Test' },
      );

      expect(prisma.feeWaiverApproval.create).toHaveBeenCalledWith({
        data: {
          waiverPaymentId: 'payment-1',
          approverId: 'approver-1',
          ipAddress: '10.0.0.42',
          userAgent: 'Mozilla/5.0 Test',
        },
      });
    });

    it('does NOT write the approval row when the waiver is rejected upstream', async () => {
      // Self-approval — rejection happens before the tx even starts.
      await expect(
        service.waiveLateFee('payment-1', 'reason', 'user-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.feeWaiverApproval.create).not.toHaveBeenCalled();
    });
  });

  // ─── Task 16+17: Promise-to-pay kept-detection hook ───────────────────────
  describe('checkPromiseAfterPayment', () => {
    let promiseService: any;
    let mdmLockService: any;
    const contractId = 'c-1';

    beforeEach(() => {
      promiseService = service['promiseService'];
      mdmLockService = service['mdmLockService'];
      // Add table mocks not present in the outer beforeEach
      prisma.auditLog = { create: jest.fn().mockResolvedValue({}) };
      prisma.promiseSlot = { update: jest.fn().mockResolvedValue({}) };
      // checkPromiseAfterPayment now uses tx.callLog.updateMany as a guarded
      // promotion (only one concurrent caller can flip keptAt). Default to
      // count=1 so the happy-path test promotes; the underpaid tests don't
      // reach this call.
      prisma.callLog.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      // user.findFirst for getSystemUserId
      prisma.user.findFirst = jest.fn().mockResolvedValue({ id: 'sys-uid' });
    });

    it('marks all slots kept + auto-unlocks when full cycle paid', async () => {
      (promiseService as any).findActivePromise.mockResolvedValue({
        id: 'cl-1',
        contractId,
        slots: [
          {
            id: 's-1',
            slotIndex: 1,
            settlementDate: new Date(Date.now() - 86400 * 1000),
            settlementAmount: { toNumber: () => 1000 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      });
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountPaid: { toNumber: () => 1500 } },
      });

      // @ts-expect-error access private for test
      await service.checkPromiseAfterPayment(contractId);

      expect(prisma.promiseSlot.update).toHaveBeenCalled();
      expect(prisma.callLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'cl-1', keptAt: null }),
          data: expect.objectContaining({ keptAt: expect.any(Date) }),
        }),
      );
      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { keptPromiseCount: { increment: 1 } } }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'KEPT_PROMISE' }),
        }),
      );
      expect((mdmLockService as any).autoUnlock).toHaveBeenCalledWith(contractId, 'CYCLE_KEPT', 'sys-uid');
    });

    it('does NOT mark kept when slot underpaid', async () => {
      (promiseService as any).findActivePromise.mockResolvedValue({
        id: 'cl-1',
        contractId,
        slots: [
          {
            id: 's-1',
            slotIndex: 1,
            settlementDate: new Date(Date.now() - 86400 * 1000),
            settlementAmount: { toNumber: () => 1000 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      });
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountPaid: { toNumber: () => 500 } },
      });

      // @ts-expect-error access private for test
      await service.checkPromiseAfterPayment(contractId);

      expect(prisma.callLog.updateMany).not.toHaveBeenCalled();
      expect((mdmLockService as any).autoUnlock).not.toHaveBeenCalled();
    });

    it('skips when no active promise exists', async () => {
      (promiseService as any).findActivePromise.mockResolvedValue(null);

      // @ts-expect-error access private for test
      await service.checkPromiseAfterPayment(contractId);

      expect(prisma.promiseSlot.update).not.toHaveBeenCalled();
      expect((mdmLockService as any).autoUnlock).not.toHaveBeenCalled();
    });

    it('C1: aggregate uses OR(paidAt/paidDate) so manual payments are counted', async () => {
      // Both paidAt (PaySolutions) and paidDate (manual recordPayment) must be checked.
      (promiseService as any).findActivePromise.mockResolvedValue({
        id: 'cl-1',
        contractId,
        slots: [
          {
            id: 's-1',
            slotIndex: 1,
            settlementDate: new Date(Date.now() - 86400 * 1000),
            settlementAmount: { toNumber: () => 1000 },
            keptAt: null,
            brokenAt: null,
          },
        ],
      });
      prisma.payment.aggregate.mockResolvedValue({
        _sum: { amountPaid: { toNumber: () => 1000 } },
      });

      // @ts-expect-error access private for test
      await service.checkPromiseAfterPayment(contractId);

      const aggregateArgs = prisma.payment.aggregate.mock.calls[0][0];
      expect(aggregateArgs.where.OR).toBeDefined();
      expect(aggregateArgs.where.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ paidAt: expect.anything() }),
          expect.objectContaining({ paidDate: expect.anything() }),
        ]),
      );
      // No bare paidAt at top level any more
      expect(aggregateArgs.where.paidAt).toBeUndefined();
    });
  });

  // T3-C5: Preventive rule — no direct mutation of Payment.amountPaid and
  // friends. The method exists specifically to raise on any future caller
  // that tries to hot-patch a financial field instead of writing a reversal.
  describe('updatePayment — T3-C5 immutability guard', () => {
    it('rejects direct mutation of amountPaid with a clear Thai reversal hint', async () => {
      await expect(
        service.updatePayment('payment-1', { amountPaid: 9999 }),
      ).rejects.toThrow(ForbiddenException);

      try {
        await service.updatePayment('payment-1', { amountPaid: 9999 });
      } catch (err) {
        // Message must reference reversePayment so the offending dev knows
        // the correct remediation path.
        expect((err as Error).message).toContain('reversePayment');
        expect((err as Error).message).toContain('amountPaid');
      }
    });
  });

  // T1-C9 — large waiver Sentry alarm. A 200-baht goodwill waiver is
  // routine; a 6,000-baht waiver probably deserves a second set of eyes
  // from finance. Sentry fires at the >5,000 THB threshold so waves of
  // abuse show up before they drain margin.
  describe('waiveLateFee — T1-C9 large-amount Sentry alarm', () => {
    beforeEach(() => {
      (Sentry.captureMessage as jest.Mock).mockClear();
      prisma.user.findUnique.mockResolvedValue({
        id: 'approver-1',
        role: 'FINANCE_MANAGER',
        isActive: true,
        deletedAt: null,
      });
    });

    it('does NOT call Sentry.captureMessage when waivedAmount ≤ 5,000', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        lateFee: 5000, // exactly at threshold — not >
        lateFeeWaived: false,
      });
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        lateFee: 0,
        lateFeeWaived: true,
      });

      await service.waiveLateFee('payment-1', 'goodwill', 'user-1', 'approver-1');
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('calls Sentry.captureMessage with level=warning when waivedAmount > 5,000', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        contractId: 'contract-1',
        lateFee: 7500,
        lateFeeWaived: false,
      });
      prisma.payment.update.mockResolvedValue({
        ...mockPayment,
        lateFee: 0,
        lateFeeWaived: true,
      });

      await service.waiveLateFee('payment-1', 'goodwill', 'user-1', 'approver-1');
      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      const [message, opts] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
      expect(message).toBe('Large late-fee waiver');
      expect(opts.level).toBe('warning');
      expect(opts.tags).toMatchObject({ kind: 'finance' });
      expect(opts.extra).toMatchObject({
        waivedBy: 'user-1',
        contractId: 'contract-1',
        amount: 7500,
      });
    });
  });
});
