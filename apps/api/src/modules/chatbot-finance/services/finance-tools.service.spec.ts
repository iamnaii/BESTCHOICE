import { Test, TestingModule } from '@nestjs/testing';
import { FinanceToolsService } from './finance-tools.service';
import { FinanceConfigService } from './finance-config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LATE_FEE_PER_DAY } from '../constants/finance-rules';

/**
 * CHARACTERIZATION (golden) spec for FinanceToolsService money math.
 *
 * tool-executor.spec.ts only tests ROUTING (it stubs this service). This spec
 * pins the actual balance/fine arithmetic that the LIFF chatbot quotes to
 * customers:
 *   - getCurrentBalance: daysOverdue, totalAmount = remainingBase + lateFee,
 *     and the lateFeeWaived=true branch (fine zeroed).
 *   - calculateFine: rule-based daysOverdue floor/clamp + LATE_FEE_PER_DAY rate.
 *
 * Mock-only — PrismaService is a jest mock, no real DB. Money is read off the
 * Payment as Prisma.Decimal in production; here we feed Decimal-like values and
 * compare numbers/strings exactly as the service emits them.
 *
 * IMPORTANT (consistency note, asserted below): the payments collection path
 * (payments.service.ts ~L270-285) CAPS the fee at
 *   min(feePerDay * days, late_fee_cap(=1500), amountDue * LATE_FEE_CAP_PCT(=5%)).
 * This chatbot service applies NO cap — it quotes daysOverdue * LATE_FEE_PER_DAY
 * straight. We characterize the CURRENT (uncapped) bot behavior. See `bugFound`.
 */
describe('FinanceToolsService — money math (characterization)', () => {
  let service: FinanceToolsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let financeConfig: any;

  // Pinned "now" so daysOverdue is deterministic. UTC noon to avoid TZ edge.
  const NOW = new Date('2026-06-08T12:00:00.000Z');

  const CONTRACT = {
    id: 'contract-1',
    contractNumber: 'C-0001',
    product: { model: 'iPhone 15', color: 'Black' },
  };

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    prisma = {
      contract: {
        findMany: jest.fn().mockResolvedValue([CONTRACT]),
      },
      payment: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };
    financeConfig = {
      bankInfoBlock: 'BANK_BLOCK',
      bankName: 'KBank',
      accountNumber: '203-1-16520-5',
      accountName: 'บจก. เบสท์ช้อยส์โฟน',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceToolsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinanceConfigService, useValue: financeConfig },
      ],
    }).compile();

    service = module.get(FinanceToolsService);
  });

  // daysOverdue ago at exactly NOW - n days (so floor((now-due)/86400000) === n)
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  describe('getCurrentBalance', () => {
    it('NOT overdue (dueDate in the future): no late fee, totalAmount = remainingBase', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        installmentNo: 3,
        dueDate: new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000), // +5 days
        amountDue: 2000,
        amountPaid: 0,
        lateFeeWaived: false,
      });

      const r = await service.getCurrentBalance('cust-1');

      expect(r.found).toBe(true);
      expect(r.contractNumber).toBe('C-0001');
      expect(r.installmentNumber).toBe(3);
      expect(r.amountDue).toBe(2000); // remainingBase = 2000 - 0
      expect(r.daysOverdue).toBe(0);
      expect(r.isOverdue).toBe(false);
      expect(r.lateFee).toBe(0);
      expect(r.totalAmount).toBe(2000);
      expect(r.bankInfo).toBe('BANK_BLOCK');
    });

    it('overdue 10 days: daysOverdue=10, lateFee=10*LATE_FEE_PER_DAY, totalAmount = remainingBase + lateFee', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        installmentNo: 2,
        dueDate: daysAgo(10),
        amountDue: 2000,
        amountPaid: 500,
        lateFeeWaived: false,
      });

      const r = await service.getCurrentBalance('cust-1');

      const expectedDays = 10;
      const expectedBase = 2000 - 500; // 1500
      const expectedFee = expectedDays * LATE_FEE_PER_DAY; // 10 * 50 = 500
      expect(r.daysOverdue).toBe(expectedDays);
      expect(r.isOverdue).toBe(true);
      expect(r.amountDue).toBe(expectedBase); // 1500 — note: this is the *remaining* base, not original amountDue
      expect(r.lateFee).toBe(expectedFee); // 500
      expect(r.totalAmount).toBe(expectedBase + expectedFee); // 2000
    });

    it('lateFeeWaived=true zeroes the fine even when overdue', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        installmentNo: 4,
        dueDate: daysAgo(30),
        amountDue: 1800,
        amountPaid: 0,
        lateFeeWaived: true,
      });

      const r = await service.getCurrentBalance('cust-1');

      expect(r.daysOverdue).toBe(30); // daysOverdue still computed
      expect(r.isOverdue).toBe(true); // ...and still flagged overdue
      expect(r.lateFee).toBe(0); // but fee zeroed by the waive branch
      expect(r.totalAmount).toBe(1800); // == remainingBase, no fee added
    });

    it('UNCAPPED: 60 days overdue quotes 60*50=3000, with NO cap (payments path would cap at 5% of amountDue / 1500)', async () => {
      const amountDue = 2000;
      prisma.payment.findFirst.mockResolvedValue({
        installmentNo: 1,
        dueDate: daysAgo(60),
        amountDue,
        amountPaid: 0,
        lateFeeWaived: false,
      });

      const r = await service.getCurrentBalance('cust-1');

      // Bot's uncapped quote:
      expect(r.daysOverdue).toBe(60);
      expect(r.lateFee).toBe(60 * LATE_FEE_PER_DAY); // 3000
      expect(r.totalAmount).toBe(amountDue + 60 * LATE_FEE_PER_DAY); // 5000

      // Pin the DIVERGENCE from payments.service.ts cap behaviour:
      //   cap = min(feePerDay*days, 1500, amountDue * 0.05)
      //       = min(3000, 1500, 100) = 100
      // The collection path would charge 100, the bot quotes 3000.
      const LATE_FEE_CAP_PCT = 0.05;
      const FLAT_CAP = 1500;
      const cappedFee = Math.min(60 * LATE_FEE_PER_DAY, FLAT_CAP, amountDue * LATE_FEE_CAP_PCT);
      expect(cappedFee).toBe(100);
      expect(r.lateFee).not.toBe(cappedFee); // bot != collection path
    });

    it('returns found=false when no active contract', async () => {
      prisma.contract.findMany.mockResolvedValue([]);
      const r = await service.getCurrentBalance('cust-1');
      expect(r.found).toBe(false);
      expect(r.message).toContain('ไม่พบสัญญา');
    });

    it('returns "all paid" message when no unpaid payment found', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);
      const r = await service.getCurrentBalance('cust-1');
      expect(r.found).toBe(true);
      expect(r.contractNumber).toBe('C-0001');
      expect(r.message).toContain('ชำระครบ');
      // No money fields when fully paid
      expect(r.totalAmount).toBeUndefined();
    });

    it('Prisma.Decimal money values: Number() conversion yields exact numeric output', async () => {
      // Simulate Prisma.Decimal-like values (objects whose Number() coerces).
      prisma.payment.findFirst.mockResolvedValue({
        installmentNo: 5,
        dueDate: daysAgo(3),
        amountDue: { toString: () => '1515.83', valueOf: () => 1515.83 },
        amountPaid: { toString: () => '0', valueOf: () => 0 },
        lateFeeWaived: false,
      });

      const r = await service.getCurrentBalance('cust-1');
      expect(r.daysOverdue).toBe(3);
      expect(r.amountDue).toBe(1515.83);
      expect(r.lateFee).toBe(3 * LATE_FEE_PER_DAY); // 150
      expect(r.totalAmount).toBe(1515.83 + 150); // 1665.83
    });
  });

  describe('calculateFine (rule-based, no DB)', () => {
    it('computes totalFine = days * LATE_FEE_PER_DAY for a whole number of days', () => {
      const r = service.calculateFine(7);
      expect(r.daysOverdue).toBe(7);
      expect(r.ratePerDay).toBe(LATE_FEE_PER_DAY); // 50
      expect(r.totalFine).toBe(7 * LATE_FEE_PER_DAY); // 350
      expect(r.explanation).toBe(
        `ค่าปรับ ${LATE_FEE_PER_DAY} บาท/วัน × 7 วัน = ${7 * LATE_FEE_PER_DAY} บาท`,
      );
    });

    it('floors fractional days', () => {
      const r = service.calculateFine(3.9);
      expect(r.daysOverdue).toBe(3); // Math.floor(3.9)
      expect(r.totalFine).toBe(3 * LATE_FEE_PER_DAY); // 150
    });

    it('clamps negative days to 0 (totalFine = 0)', () => {
      const r = service.calculateFine(-5);
      expect(r.daysOverdue).toBe(0); // Math.max(0, ...)
      expect(r.totalFine).toBe(0);
      expect(r.explanation).toBe(`ค่าปรับ ${LATE_FEE_PER_DAY} บาท/วัน × 0 วัน = 0 บาท`);
    });

    it('zero days yields zero fine', () => {
      const r = service.calculateFine(0);
      expect(r.daysOverdue).toBe(0);
      expect(r.totalFine).toBe(0);
    });

    it('UNCAPPED: large overdue (100 days) quotes 100*50=5000 with no cap', () => {
      const r = service.calculateFine(100);
      expect(r.totalFine).toBe(100 * LATE_FEE_PER_DAY); // 5000 — no min() applied
    });
  });
});
