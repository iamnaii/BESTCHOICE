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
import { PaymentReceipt2BTemplate } from '../journal/cpa-templates/payment-receipt-2b.template';
import { AccountRoleService } from '../journal/account-role.service';
import { BadDebtService } from '../accounting/bad-debt.service';

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
      installmentSchedule: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      partialPaymentLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // W3 fix: bulk-allocate + credit-allocate paths emit AuditLog rows
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: { $transaction: jest.fn(fn => fn(tx)), systemConfig: { findUnique: jest.fn().mockResolvedValue(null) }, companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'co-FINANCE' }) }, user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', defaultCashAccountCode: '11-1101', role: 'OWNER', deletedAt: null }) } } },
        { provide: ReceiptsService, useValue: { generateReceipt: jest.fn().mockResolvedValue({}) } },
        { provide: AuditService, useValue: { logPaymentEvent: jest.fn().mockResolvedValue(undefined), log: jest.fn().mockResolvedValue(undefined) } },
        { provide: JournalAutoService, useValue: { createPaymentJournal: jest.fn().mockResolvedValue('je-1'), createExpenseJournal: jest.fn(), createContractActivationJournal: jest.fn(), createBadDebtWriteOffJournal: jest.fn(), createCustomerCreditOverpaymentJournal: jest.fn().mockResolvedValue('je-overpay'), createCreditAllocationJournal: jest.fn().mockResolvedValue('je-credit-alloc'), createAndPost: jest.fn().mockResolvedValue({ id: 'je-mock-id', entryNo: 'JE-MOCK' }) } },
        { provide: ProductsService, useValue: { transferOwnership: jest.fn() } },
        { provide: LineOaService, useValue: { buildPaymentSuccess: jest.fn().mockReturnValue({}), sendFlexMessage: jest.fn() } },
        { provide: FlexTemplatesService, useValue: { paymentReceipt: jest.fn().mockReturnValue({ type: 'flex', altText: 'test', contents: {} }) } },
        { provide: QuickReplyService, useValue: { afterPayment: jest.fn().mockReturnValue([]) } },
        { provide: WarrantyService, useValue: { setShopWarranty: jest.fn().mockResolvedValue(undefined) } },
        { provide: PaymentReceipt2BTemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
        { provide: BadDebtService, useValue: { reverseStageOnPayment: jest.fn().mockResolvedValue(null) } },
        {
          provide: AccountRoleService,
          useValue: {
            code: jest.fn((role: string) => {
              if (role === 'adj_underpay') return '52-1104';
              if (role === 'adj_overpay') return '53-1503';
              throw new Error(`AccountRoleService stub: unmapped role "${role}"`);
            }),
          },
        },
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
      await service.recordPayment('c1', 1, 500, 'CASH', 'u1', 'https://s3.example.com/slip.jpg', undefined, 'TXN-2', undefined, undefined, 'PARTIAL');
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

    // T16: Tolerance approval tests
    it('T16 — succeeds with toleranceApproverId when diff is within 1 ฿', async () => {
      // Amount 999.50 vs outstanding 1000 — diff 0.50 ฿, within tolerance
      const result = await service.recordPayment('c1', 1, 999.5, 'CASH', 'u1', 'https://s3.example.com/slip.jpg', undefined, 'TXN-TOL1', undefined, 'u1');
      expect(result).toBeDefined();
    });

    it('T16 — rejects toleranceApproverId with SALES role', async () => {
      // Mock user.findUnique to return a SALES user for this test
      const prisma = (service['prisma'] as unknown) as { user: { findUnique: jest.Mock } };
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'u-sales', role: 'SALES', deletedAt: null });
      await expect(
        service.recordPayment('c1', 1, 999.5, 'CASH', 'u1', 'https://s3.example.com/slip.jpg', undefined, 'TXN-TOL2', undefined, 'u-sales'),
      ).rejects.toThrow('ผู้อนุมัติต้องมีบทบาท OWNER');
    });

    it('T16 — no AuditLog written when payment is exact (no toleranceApproverId)', async () => {
      const auditService = (service['auditService'] as unknown) as { log: jest.Mock };
      auditService.log.mockClear();
      await service.recordPayment('c1', 1, 1000, 'CASH', 'u1', 'https://s3.example.com/slip.jpg', undefined, 'TXN-TOL3');
      expect(auditService.log).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'TOLERANCE_APPROVED' }));
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
