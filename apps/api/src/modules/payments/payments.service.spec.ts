import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
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
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };

    const mockReceiptsService = {
      generateReceipt: jest.fn().mockResolvedValue({ id: 'receipt-1', receiptNumber: 'RC-2026-03-00001' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ReceiptsService, useValue: mockReceiptsService },
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

      const result = await service.recordPayment('contract-1', 1, 3000, 'TRANSFER', 'user-1', undefined, undefined, 'TXN-12345');
      expect(result.status).toBe('PAID');
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

    it('should not generate receipt on partial payment', async () => {
      const updatedPayment = { ...mockPayment, amountPaid: 1000, status: 'PARTIALLY_PAID', paidDate: null };
      prisma.payment.update.mockResolvedValue(updatedPayment);

      await service.recordPayment('contract-1', 1, 1000, 'CASH', 'user-1', 'http://slip.jpg');
      expect(receiptsService.generateReceipt).not.toHaveBeenCalled();
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

      const result = await service.getContractPayments('contract-1');
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { contractId: 'contract-1' },
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

      const result = await service.getDailySummary('2026-03-11');
      expect(result.totalPayments).toBe(2);
      expect(result.totalAmount).toBe(8000);
      expect(result.totalLateFees).toBe(100);
      expect(result.byMethod).toEqual({ CASH: 3000, TRANSFER: 5000 });
    });
  });
});
