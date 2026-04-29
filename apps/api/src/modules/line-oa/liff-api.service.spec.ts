import { Test, TestingModule } from '@nestjs/testing';
import { LiffApiService } from './liff-api.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

describe('LiffApiService', () => {
  let service: LiffApiService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      loyaltyPoint: {
        aggregate: jest.fn(),
      },
      paymentLink: {
        count: jest.fn(),
      },
      contract: {
        findFirst: jest.fn(),
      },
      receipt: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiffApiService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LiffApiService>(LiffApiService);
  });

  // ─── findCustomerContractsFull ───────────────────────

  describe('findCustomerContractsFull', () => {
    it('returns null when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      const result = await service.findCustomerContractsFull('U_nonexistent');
      expect(result).toBeNull();
    });

    it('returns formatted contracts with payment summaries', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1',
        name: 'สมชาย',
        contracts: [
          {
            id: 'con1',
            contractNumber: 'BC-2026-0001',
            status: 'ACTIVE',
            sellingPrice: new Prisma.Decimal('15000.00'),
            downPayment: new Prisma.Decimal('3000.00'),
            monthlyPayment: new Prisma.Decimal('2000.00'),
            totalMonths: 6,
            createdAt: new Date('2026-01-15'),
            product: { name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15' },
            payments: [
              {
                id: 'p1', installmentNo: 1, dueDate: new Date('2026-02-15'),
                amountDue: new Prisma.Decimal('2000'), amountPaid: new Prisma.Decimal('2000'),
                lateFee: new Prisma.Decimal('0'), status: 'PAID',
                paidDate: new Date('2026-02-14'), paymentMethod: 'BANK_TRANSFER',
              },
              {
                id: 'p2', installmentNo: 2, dueDate: new Date('2026-03-15'),
                amountDue: new Prisma.Decimal('2000'), amountPaid: new Prisma.Decimal('0'),
                lateFee: new Prisma.Decimal('100'), status: 'OVERDUE',
                paidDate: null, paymentMethod: null,
              },
            ],
          },
        ],
      });

      const result = await service.findCustomerContractsFull('U_line123');
      expect(result).not.toBeNull();
      expect(result!.customer.name).toBe('สมชาย');
      expect(result!.contracts).toHaveLength(1);

      const c = result!.contracts[0];
      expect(c.contractNumber).toBe('BC-2026-0001');
      expect(c.product).toBe('Apple iPhone 15');
      expect(c.sellingPrice).toBe(15000);
      expect(c.paidInstallments).toBe(1);
      // Outstanding: 2000 + 100 - 0 = 2100
      expect(c.totalOutstanding).toBe(2100);
      expect(c.payments).toHaveLength(2);
      expect(c.payments[0].status).toBe('PAID');
      expect(c.payments[1].lateFee).toBe(100);
    });

    it('handles product with no brand (falls back to name)', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1',
        name: 'ทดสอบ',
        contracts: [
          {
            id: 'con1', contractNumber: 'BC-0001', status: 'ACTIVE',
            sellingPrice: new Prisma.Decimal('5000'), downPayment: new Prisma.Decimal('1000'),
            monthlyPayment: new Prisma.Decimal('500'), totalMonths: 8,
            createdAt: new Date(), product: { name: 'มือถือมือสอง', brand: null, model: null },
            payments: [],
          },
        ],
      });

      const result = await service.findCustomerContractsFull('U_line');
      expect(result!.contracts[0].product).toBe('มือถือมือสอง');
    });

    it('handles null product gracefully', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1', name: 'ทดสอบ',
        contracts: [{
          id: 'con1', contractNumber: 'BC-0001', status: 'ACTIVE',
          sellingPrice: new Prisma.Decimal('5000'), downPayment: new Prisma.Decimal('1000'),
          monthlyPayment: new Prisma.Decimal('500'), totalMonths: 8,
          createdAt: new Date(), product: null, payments: [],
        }],
      });

      const result = await service.findCustomerContractsFull('U_line');
      expect(result!.contracts[0].product).toBe('-');
    });
  });

  // ─── lookupCustomerByPhone ──────────────────────────

  describe('lookupCustomerByPhone', () => {
    it('returns null if lineId is already linked', async () => {
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: 'existing' }) // already linked check
        .mockResolvedValueOnce(null); // phone lookup (not called)

      const result = await service.lookupCustomerByPhone('0812345678', 'U_line');
      expect(result).toBeNull();
    });

    it('returns null if phone not found', async () => {
      prisma.customer.findFirst
        .mockResolvedValueOnce(null) // not linked
        .mockResolvedValueOnce(null); // no phone match

      const result = await service.lookupCustomerByPhone('0899999999', 'U_line');
      expect(result).toBeNull();
    });

    it('returns masked name when phone matches', async () => {
      prisma.customer.findFirst
        .mockResolvedValueOnce(null) // not linked
        .mockResolvedValueOnce({ id: 'cust1', name: 'สมชาย จันทร์ดี' });

      const result = await service.lookupCustomerByPhone('0812345678', 'U_line');
      expect(result).toEqual({
        customerId: 'cust1',
        maskedName: 'สม*** จั***',
      });
    });

    it('normalizes phone with dashes for lookup', async () => {
      prisma.customer.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'cust1', name: 'ทดสอบ' });

      await service.lookupCustomerByPhone('081-234-5678', 'U_line');

      // Second call should search with normalized variants
      const whereArg = prisma.customer.findFirst.mock.calls[1][0].where;
      expect(whereArg.phone.in).toContain('0812345678');
      expect(whereArg.phone.in).toContain('081-234-5678');
    });
  });

  // ─── confirmLinkLine ────────────────────────────────

  describe('confirmLinkLine', () => {
    it('returns error if lineId already linked to another customer', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'other_customer' });

      const result = await service.confirmLinkLine('target_cust', 'U_line');
      expect(result.success).toBe(false);
      expect(result.error).toContain('เชื่อมต่อกับลูกค้ารายอื่นแล้ว');
    });

    it('returns error if customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue(null);

      const result = await service.confirmLinkLine('nonexistent', 'U_line');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ไม่พบข้อมูลลูกค้า');
    });

    it('returns error if customer soft-deleted', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust1', deletedAt: new Date(), lineIdShop: null });

      const result = await service.confirmLinkLine('cust1', 'U_line');
      expect(result.success).toBe(false);
    });

    it('returns error if customer linked to different LINE', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust1', deletedAt: null, lineIdShop: 'U_other' });

      const result = await service.confirmLinkLine('cust1', 'U_line');
      expect(result.success).toBe(false);
      expect(result.error).toContain('เชื่อมต่อกับบัญชี LINE อื่นแล้ว');
    });

    it('links successfully and updates customer', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust1', name: 'สมชาย', deletedAt: null, lineIdShop: null });
      prisma.customer.update.mockResolvedValue({});

      const result = await service.confirmLinkLine('cust1', 'U_line');
      expect(result.success).toBe(true);
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust1' },
        data: { lineIdShop: 'U_line' },
      });
    });

    it('allows re-linking same LINE to same customer', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.customer.findUnique.mockResolvedValue({ id: 'cust1', name: 'สมชาย', deletedAt: null, lineIdShop: 'U_line' });
      prisma.customer.update.mockResolvedValue({});

      const result = await service.confirmLinkLine('cust1', 'U_line');
      expect(result.success).toBe(true);
    });
  });

  // ─── isLineIdLinked ─────────────────────────────────

  describe('isLineIdLinked', () => {
    it('returns true if customer found with lineId', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1' });
      expect(await service.isLineIdLinked('U_line')).toBe(true);
    });

    it('returns false if no customer with lineId', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      expect(await service.isLineIdLinked('U_line')).toBe(false);
    });
  });

  // ─── findCustomerPaymentHistory ─────────────────────

  describe('findCustomerPaymentHistory', () => {
    it('returns null when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      expect(await service.findCustomerPaymentHistory('U_line')).toBeNull();
    });

    it('returns sorted payment history across contracts', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        name: 'สมชาย',
        contracts: [
          {
            contractNumber: 'BC-001',
            payments: [
              { id: 'pay-1', installmentNo: 1, amountPaid: new Prisma.Decimal('2000'), paidDate: new Date('2026-02-01'), paymentMethod: 'CASH', lateFee: new Prisma.Decimal('0') },
              { id: 'pay-2', installmentNo: 2, amountPaid: new Prisma.Decimal('2000'), paidDate: new Date('2026-03-01'), paymentMethod: 'BANK_TRANSFER', lateFee: new Prisma.Decimal('50') },
            ],
          },
          {
            contractNumber: 'BC-002',
            payments: [
              { id: 'pay-3', installmentNo: 1, amountPaid: new Prisma.Decimal('1500'), paidDate: new Date('2026-02-15'), paymentMethod: 'PROMPTPAY', lateFee: new Prisma.Decimal('0') },
            ],
          },
        ],
      });
      // Receipts issued for pay-1 and pay-3 only
      prisma.receipt.findMany.mockResolvedValue([
        { id: 'rc-a', paymentId: 'pay-1' },
        { id: 'rc-c', paymentId: 'pay-3' },
      ]);

      const result = await service.findCustomerPaymentHistory('U_line');
      expect(result).not.toBeNull();
      expect(result!.payments).toHaveLength(3);
      // Sorted descending by paidDate
      expect(result!.payments[0].contractNumber).toBe('BC-001'); // Mar 1
      expect(result!.payments[0].installmentNo).toBe(2);
      expect(result!.payments[1].contractNumber).toBe('BC-002'); // Feb 15
      expect(result!.payments[2].contractNumber).toBe('BC-001'); // Feb 1
      // Decimal → number conversion
      expect(result!.payments[2].amountPaid).toBe(2000);
      expect(result!.payments[0].lateFee).toBe(50);
      // Receipt IDs joined: pay-1 → rc-a, pay-3 → rc-c, pay-2 → null (no receipt)
      expect(result!.payments[0].receiptId).toBeNull(); // pay-2 (Mar 1)
      expect(result!.payments[1].receiptId).toBe('rc-c'); // pay-3 (Feb 15)
      expect(result!.payments[2].receiptId).toBe('rc-a'); // pay-1 (Feb 1)
    });
  });

  // ─── findCustomerProfile ────────────────────────────

  describe('findCustomerProfile', () => {
    it('returns null when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      expect(await service.findCustomerProfile('U_line')).toBeNull();
    });

    it('returns profile with contract count and loyalty points', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1',
        name: 'สมชาย',
        phone: '0812345678',
        _count: { contracts: 3 },
      });
      prisma.loyaltyPoint.aggregate.mockResolvedValue({
        _sum: { points: 150 },
      });

      const result = await service.findCustomerProfile('U_line');
      expect(result).toEqual({
        name: 'สมชาย',
        phone: '0812345678',
        lineDisplayName: '-',
        contractCount: 3,
        totalPoints: 150,
      });
    });

    it('handles null phone and zero points', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust1', name: 'ทดสอบ', phone: null,
        _count: { contracts: 0 },
      });
      prisma.loyaltyPoint.aggregate.mockResolvedValue({ _sum: { points: null } });

      const result = await service.findCustomerProfile('U_line');
      expect(result!.phone).toBe('-');
      expect(result!.totalPoints).toBe(0);
    });
  });

  // ─── unlinkLineAccount ──────────────────────────────

  describe('unlinkLineAccount', () => {
    it('returns error if no customer linked', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      const result = await service.unlinkLineAccount('U_line');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ไม่พบบัญชี');
    });

    it('unlinks customer by setting lineId to null', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', name: 'สมชาย' });
      prisma.customer.update.mockResolvedValue({});

      const result = await service.unlinkLineAccount('U_line');
      expect(result.success).toBe(true);
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust1' },
        data: { lineIdShop: null },
      });
    });
  });

  // ─── getConsentStatus ────────────────────────────────

  describe('getConsentStatus', () => {
    it('returns null when customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      expect(await service.getConsentStatus('U_line')).toBeNull();
    });

    it('returns consent status', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        chatConsent: true,
        chatConsentAt: new Date('2026-04-10'),
      });
      const result = await service.getConsentStatus('U_line');
      expect(result!.consent).toBe(true);
      expect(result!.consentAt).toBeTruthy();
    });
  });

  // ─── updateConsent ──────────────────────────────────

  describe('updateConsent', () => {
    it('returns error if customer not found', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      const result = await service.updateConsent('U_line', true);
      expect(result.success).toBe(false);
    });

    it('grants consent with timestamp', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1' });
      prisma.customer.update.mockResolvedValue({});

      const result = await service.updateConsent('U_line', true);
      expect(result.success).toBe(true);
      const updateArg = prisma.customer.update.mock.calls[0][0];
      expect(updateArg.data.chatConsent).toBe(true);
      expect(updateArg.data.chatConsentAt).toBeInstanceOf(Date);
    });

    it('revokes consent but preserves timestamp (PDPA audit trail)', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1' });
      prisma.customer.update.mockResolvedValue({});

      const result = await service.updateConsent('U_line', false);
      expect(result.success).toBe(true);
      const updateArg = prisma.customer.update.mock.calls[0][0];
      expect(updateArg.data.chatConsent).toBe(false);
      // chatConsentAt should be a Date, NOT null — preserves audit trail
      expect(updateArg.data.chatConsentAt).toBeInstanceOf(Date);
    });
  });

  // ─── Payment helpers ────────────────────────────────

  describe('findCustomerByLineId', () => {
    it('returns customer id and name', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust1', name: 'สมชาย' });
      const result = await service.findCustomerByLineId('U_line');
      expect(result).toEqual({ id: 'cust1', name: 'สมชาย' });
    });
  });

  describe('findContractForCustomer', () => {
    it('finds contract owned by customer', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'con1', contractNumber: 'BC-001' });
      const result = await service.findContractForCustomer('con1', 'cust1');
      expect(result).toBeTruthy();
      expect(prisma.contract.findFirst).toHaveBeenCalledWith({
        where: { id: 'con1', customerId: 'cust1', deletedAt: null },
      });
    });
  });

  describe('countRecentPaymentLinks', () => {
    it('counts links created in last 24 hours', async () => {
      prisma.paymentLink.count.mockResolvedValue(3);
      const result = await service.countRecentPaymentLinks('con1');
      expect(result).toBe(3);
    });
  });
});
