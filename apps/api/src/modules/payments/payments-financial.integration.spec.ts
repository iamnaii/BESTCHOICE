import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ProductsService } from '../products/products.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { WarrantyService } from '../warranty/warranty.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Integration tests for financial flows.
 * Validates payment recording, allocation, and edge cases.
 */
describe('PaymentsService — Financial Integration', () => {
  let service: PaymentsService;

  const makePayment = (no: number, amountDue = 1000) => ({
    id: `pay-${no}`,
    contractId: 'c1',
    installmentNo: no,
    amountDue,
    amountPaid: 0,
    lateFee: 0,
    lateFeeWaived: false,
    status: 'PENDING',
    dueDate: new Date(2027, no, 15), // future dates → no late fee
    paidDate: null,
    paymentMethod: null,
    recordedById: null,
    evidenceUrl: null,
    notes: null,
  });

  const payments = Array.from({ length: 12 }, (_, i) => makePayment(i + 1));

  const contract = {
    id: 'c1', contractNumber: 'CNT-001', status: 'ACTIVE',
    financedAmount: 12000, totalMonths: 12, creditBalance: 0,
    deletedAt: null, branchId: 'b1',
    payments: [...payments],
  };

  beforeEach(async () => {
    // Reset state
    payments.forEach(p => { p.amountPaid = 0; p.status = 'PENDING'; p.paidDate = null; p.lateFee = 0; });
    contract.creditBalance = 0;
    contract.status = 'ACTIVE';

    const tx = {
      contract: {
        findUnique: jest.fn().mockReturnValue({ ...contract, payments: [...payments] }),
        update: jest.fn().mockImplementation(({ data }) => ({ ...contract, ...data })),
      },
      payment: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (where.installmentNo != null) return payments.find(p => p.installmentNo === where.installmentNo) ?? null;
          return null;
        }),
        findMany: jest.fn().mockResolvedValue([]), // idempotency check → no duplicate
        update: jest.fn().mockImplementation(({ where, data }) => {
          const p = payments.find(pp => pp.id === where.id);
          if (p) Object.assign(p, data);
          return { ...p, ...data };
        }),
        count: jest.fn().mockImplementation(() => payments.filter(p => p.status !== 'PAID').length),
      },
      systemConfig: {
        findUnique: jest.fn().mockReturnValue(null), // no late fee config needed (future dates)
      },
      callLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: { $transaction: jest.fn(fn => fn(tx)), systemConfig: { findUnique: jest.fn().mockResolvedValue(null) } } },
        { provide: ReceiptsService, useValue: { generateReceipt: jest.fn().mockResolvedValue({}) } },
        { provide: AuditService, useValue: { logPaymentEvent: jest.fn().mockResolvedValue(undefined) } },
        { provide: JournalAutoService, useValue: { createPaymentJournal: jest.fn().mockResolvedValue('je-1'), createExpenseJournal: jest.fn(), createContractActivationJournal: jest.fn(), createBadDebtWriteOffJournal: jest.fn() } },
        { provide: ProductsService, useValue: { transferOwnership: jest.fn() } },
        { provide: LineOaService, useValue: { buildPaymentSuccess: jest.fn().mockReturnValue({}), sendFlexMessage: jest.fn() } },
        { provide: FlexTemplatesService, useValue: { paymentReceipt: jest.fn().mockReturnValue({ type: 'flex', altText: 'test', contents: {} }) } },
        { provide: QuickReplyService, useValue: { afterPayment: jest.fn().mockReturnValue([]) } },
        { provide: WarrantyService, useValue: { setShopWarranty: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('recordPayment', () => {
    it('should succeed for valid payment', async () => {
      const result = await service.recordPayment('c1', 1, 1000, 'CASH', 'u1', 'https://s3.example.com/slip.jpg', 'test', 'TXN-1');
      expect(result).toBeDefined();
      expect(payments[0].status).toBe('PAID');
    });

    it('should handle partial payment', async () => {
      await service.recordPayment('c1', 1, 500, 'CASH', 'u1', 'https://s3.example.com/slip.jpg', undefined, 'TXN-2');
      expect(payments[0].status).toBe('PARTIALLY_PAID');
      // amountPaid is now stored as Prisma.Decimal — compare numeric value
      expect(Number(payments[0].amountPaid)).toBe(500);
    });

    it('should reject overpayment', async () => {
      await expect(
        service.recordPayment('c1', 1, 1500, 'CASH', 'u1', 'https://s3.example.com/slip.jpg', undefined, 'TXN-3'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject zero amount', async () => {
      await expect(
        service.recordPayment('c1', 1, 0, 'CASH', 'u1', 'https://s3.example.com/slip.jpg'),
      ).rejects.toThrow('จำนวนเงินต้องมากกว่า 0');
    });

    it('should reject missing evidence', async () => {
      await expect(
        service.recordPayment('c1', 1, 1000, 'CASH', 'u1'),
      ).rejects.toThrow('ต้อง upload หลักฐาน');
    });

    it('should reject negative amount', async () => {
      await expect(
        service.recordPayment('c1', 1, -100, 'CASH', 'u1', 'https://s3.example.com/slip.jpg'),
      ).rejects.toThrow('จำนวนเงินต้องมากกว่า 0');
    });
  });

  describe('autoAllocatePayment', () => {
    it('should allocate across installments', async () => {
      const result = await service.autoAllocatePayment('c1', 2500, 'CASH', 'u1', 'bulk');
      expect(result.allocatedPayments.length).toBeGreaterThanOrEqual(2);
      expect(result.totalAllocated).toBe(2500);
      expect(result.overpayment).toBe(0);
    });

    it('should credit overpayment', async () => {
      const result = await service.autoAllocatePayment('c1', 13000, 'CASH', 'u1');
      expect(result.totalAllocated).toBe(12000);
      expect(result.overpayment).toBe(1000);
      expect(result.overpaymentMessage).toBeTruthy();
    });

    it('should reject zero amount', async () => {
      await expect(service.autoAllocatePayment('c1', 0, 'CASH', 'u1')).rejects.toThrow();
    });
  });

  describe('financial accuracy', () => {
    it('all installments sum to financedAmount', () => {
      expect(payments.reduce((s, p) => s + p.amountDue, 0)).toBe(12000);
    });

    it('no negative installment amounts', () => {
      payments.forEach(p => expect(p.amountDue).toBeGreaterThan(0));
    });
  });
});
