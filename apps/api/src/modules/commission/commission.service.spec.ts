import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommissionService } from './commission.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CommissionService', () => {
  let service: CommissionService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      salesCommission: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      commissionRule: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      commissionPayout: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      // Simple pass-through — callers supply their own tx mock via closure
      // in describe blocks that need it. Default echoes the parent prisma so
      // tests that don't inspect tx work unchanged.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CommissionService>(CommissionService);
  });

  describe('createCommissionForSale', () => {
    it('uses Decimal arithmetic so 2.5% of 19999.99 lands exactly', async () => {
      prisma.salesCommission.create.mockImplementation(({ data }: { data: { commissionAmount: Prisma.Decimal } }) => ({
        id: 'c1',
        ...data,
      }));

      await service.createCommissionForSale('s1', 'sp1', 19999.99, 0.025);

      const arg = prisma.salesCommission.create.mock.calls[0][0];
      // 19999.99 * 0.025 = 499.99975 → ROUND_HALF_UP at 2dp = 500.00
      expect(arg.data.commissionAmount).toBeInstanceOf(Prisma.Decimal);
      expect((arg.data.commissionAmount as Prisma.Decimal).toString()).toBe('500');
    });

    it('handles a tiny rate × small amount without float drift', async () => {
      prisma.salesCommission.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }),
      );

      // Classic float problem: 0.1 * 0.1 in JS = 0.010000000000000002
      await service.createCommissionForSale('s1', 'sp1', 0.1, 0.1);

      const arg = prisma.salesCommission.create.mock.calls[0][0];
      // 0.1 * 0.1 = 0.01 → at 2dp = 0.01
      expect((arg.data.commissionAmount as Prisma.Decimal).toString()).toBe('0.01');
    });

    it('rounds half-up at 2 decimal places (not banker\'s rounding)', async () => {
      prisma.salesCommission.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }),
      );

      // 100 * 0.045 = 4.5 → ROUND_HALF_UP gives 4.5 (no rounding needed)
      // 100 * 0.0455 = 4.55 → exact, no rounding
      // 100 * 0.04555 = 4.555 → ROUND_HALF_UP gives 4.56
      await service.createCommissionForSale('s1', 'sp1', 100, 0.04555);

      const arg = prisma.salesCommission.create.mock.calls[0][0];
      expect((arg.data.commissionAmount as Prisma.Decimal).toString()).toBe('4.56');
    });

    it('persists period as YYYY-MM of the current month', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 3, 9)); // April 2026
      prisma.salesCommission.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }),
      );

      await service.createCommissionForSale('s1', 'sp1', 1000, 0.05);

      const arg = prisma.salesCommission.create.mock.calls[0][0];
      expect(arg.data.period).toBe('2026-04');
      jest.useRealTimers();
    });

    it('starts every commission as PENDING', async () => {
      prisma.salesCommission.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }),
      );

      await service.createCommissionForSale('s1', 'sp1', 1000, 0.05);
      const arg = prisma.salesCommission.create.mock.calls[0][0];
      expect(arg.data.status).toBe('PENDING');
    });
  });

  describe('getSummary', () => {
    it('filters out soft-deleted commissions', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([]);
      await service.getSummary();
      expect(prisma.salesCommission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    });

    it('groups by salesperson with Decimal-precise totals (no float drift)', async () => {
      // 1000 satang-level commissions of 0.999 baht each.
      // Number() accumulation would drift; Decimal must land at exactly 999.
      const rows = Array.from({ length: 1000 }, (_, i) => ({
        id: `c${i}`,
        salespersonId: 'sp1',
        salesperson: { id: 'sp1', name: 'Test Sales' },
        saleAmount: new Prisma.Decimal('100'),
        commissionAmount: new Prisma.Decimal('0.999'),
        status: 'APPROVED',
      }));
      prisma.salesCommission.findMany.mockResolvedValue(rows);

      const summary = await service.getSummary();

      expect(summary).toHaveLength(1);
      // 100 × 1000 = 100000 (totalSales)
      expect(summary[0].totalSales).toBe('100000');
      // 0.999 × 1000 = 999 — exact, no drift
      expect(summary[0].totalCommission).toBe('999');
      expect(summary[0].count).toBe(1000);
      expect(summary[0].approved).toBe(1000);
      expect(summary[0].pending).toBe(0);
    });

    it('counts APPROVED and PAID together as approved', async () => {
      const rows = [
        {
          id: 'c1',
          salespersonId: 'sp1',
          salesperson: { id: 'sp1', name: 'A' },
          saleAmount: new Prisma.Decimal('100'),
          commissionAmount: new Prisma.Decimal('5'),
          status: 'APPROVED',
        },
        {
          id: 'c2',
          salespersonId: 'sp1',
          salesperson: { id: 'sp1', name: 'A' },
          saleAmount: new Prisma.Decimal('200'),
          commissionAmount: new Prisma.Decimal('10'),
          status: 'PAID',
        },
        {
          id: 'c3',
          salespersonId: 'sp1',
          salesperson: { id: 'sp1', name: 'A' },
          saleAmount: new Prisma.Decimal('50'),
          commissionAmount: new Prisma.Decimal('2.5'),
          status: 'PENDING',
        },
      ];
      prisma.salesCommission.findMany.mockResolvedValue(rows);
      const summary = await service.getSummary();

      expect(summary[0].approved).toBe(2);
      expect(summary[0].pending).toBe(1);
      expect(summary[0].count).toBe(3);
      expect(summary[0].totalSales).toBe('350');
      expect(summary[0].totalCommission).toBe('17.5');
    });

    it('groups separately when there are multiple salespeople', async () => {
      const rows = [
        { id: 'c1', salespersonId: 'sp1', salesperson: { id: 'sp1', name: 'A' }, saleAmount: new Prisma.Decimal('100'), commissionAmount: new Prisma.Decimal('5'), status: 'APPROVED' },
        { id: 'c2', salespersonId: 'sp2', salesperson: { id: 'sp2', name: 'B' }, saleAmount: new Prisma.Decimal('200'), commissionAmount: new Prisma.Decimal('10'), status: 'APPROVED' },
      ];
      prisma.salesCommission.findMany.mockResolvedValue(rows);
      const summary = await service.getSummary();

      expect(summary).toHaveLength(2);
      const a = summary.find((s) => s.salesperson.id === 'sp1')!;
      const b = summary.find((s) => s.salesperson.id === 'sp2')!;
      expect(a.totalCommission).toBe('5');
      expect(b.totalCommission).toBe('10');
    });

    it('serializes Decimal totals as strings (frontend uses parseFloat)', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([
        { id: 'c1', salespersonId: 'sp1', salesperson: { id: 'sp1', name: 'A' }, saleAmount: new Prisma.Decimal('123.45'), commissionAmount: new Prisma.Decimal('6.17'), status: 'APPROVED' },
      ]);
      const summary = await service.getSummary();
      expect(typeof summary[0].totalSales).toBe('string');
      expect(typeof summary[0].totalCommission).toBe('string');
    });
  });

  describe('approve', () => {
    it('throws NotFoundException when commission missing', async () => {
      prisma.salesCommission.findFirst.mockResolvedValue(null);
      await expect(service.approve('missing', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to approve a non-PENDING commission', async () => {
      prisma.salesCommission.findFirst.mockResolvedValue({ id: 'c1', status: 'APPROVED' });
      await expect(service.approve('c1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses self-approval (Segregation of Duties — salesperson cannot approve own commission)', async () => {
      prisma.salesCommission.findFirst.mockResolvedValue({
        id: 'c1',
        status: 'PENDING',
        salespersonId: 'salesperson-1',
      });

      await expect(service.approve('c1', 'salesperson-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.salesCommission.update).not.toHaveBeenCalled();
    });

    it('flips PENDING to APPROVED with approver and timestamp', async () => {
      prisma.salesCommission.findFirst.mockResolvedValue({ id: 'c1', status: 'PENDING' });
      prisma.salesCommission.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }),
      );

      const result = await service.approve('c1', 'manager1');

      expect(prisma.salesCommission.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedById: 'manager1',
          approvedAt: expect.any(Date),
        }),
      });
      expect(result.status).toBe('APPROVED');
    });

    it('does NOT filter soft-deleted in update (only in lookup)', async () => {
      prisma.salesCommission.findFirst.mockResolvedValue({ id: 'c1', status: 'PENDING' });
      prisma.salesCommission.update.mockResolvedValue({ id: 'c1', status: 'APPROVED' });

      await service.approve('c1', 'manager1');

      // Lookup must filter
      expect(prisma.salesCommission.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', deletedAt: null },
      });
    });
  });

  describe('markPaid', () => {
    it('throws NotFoundException when commission missing', async () => {
      prisma.salesCommission.findFirst.mockResolvedValue(null);
      await expect(service.markPaid('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to pay a non-APPROVED commission', async () => {
      prisma.salesCommission.findFirst.mockResolvedValue({ id: 'c1', status: 'PENDING' });
      await expect(service.markPaid('c1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the original commissionAmount for paidAmount', async () => {
      const original = new Prisma.Decimal('123.45');
      prisma.salesCommission.findFirst.mockResolvedValue({
        id: 'c1',
        status: 'APPROVED',
        commissionAmount: original,
      });
      prisma.salesCommission.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ id: 'c1', ...data }),
      );

      await service.markPaid('c1');

      const callArg = prisma.salesCommission.update.mock.calls[0][0];
      expect(callArg.data.status).toBe('PAID');
      expect(callArg.data.paidAmount).toBe(original);
    });
  });

  describe('findAll', () => {
    it('filters out soft-deleted commissions', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([]);
      prisma.salesCommission.count.mockResolvedValue(0);

      await service.findAll({});

      expect(prisma.salesCommission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    });

    it('caps page size to 100 even when caller asks for more', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([]);
      prisma.salesCommission.count.mockResolvedValue(0);

      const result = await service.findAll({ limit: 1000 });
      expect(result.limit).toBe(100);
    });

    it('returns shape { data, total, page, limit, totalPages }', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([]);
      prisma.salesCommission.count.mockResolvedValue(0);

      const result = await service.findAll({ page: 1, limit: 50 });
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 });
    });
  });

  // Segregation of Duties on commission payout approval.
  // Prevents the salesperson who earns a payout from self-approving it.
  describe('approvePayout — Segregation of Duties', () => {
    const draftPayout = {
      id: 'payout-1',
      salespersonId: 'salesperson-1',
      status: 'DRAFT',
      deletedAt: null,
    };

    it('throws ForbiddenException if approver is the salesperson (SoD violation)', async () => {
      prisma.commissionPayout.findFirst.mockResolvedValue(draftPayout);

      await expect(
        service.approvePayout('payout-1', 'salesperson-1', { notes: 'self-approve attempt' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.approvePayout('payout-1', 'salesperson-1', { notes: 'self-approve attempt' }),
      ).rejects.toThrow(/Segregation of Duties|ห้ามอนุมัติ/);

      // Must not call update when SoD violated
      expect(prisma.commissionPayout.update).not.toHaveBeenCalled();
    });

    it('allows approval when approver is a different user from the salesperson', async () => {
      prisma.commissionPayout.findFirst.mockResolvedValue(draftPayout);
      prisma.commissionPayout.update.mockResolvedValue({
        ...draftPayout,
        status: 'APPROVED',
        approvedById: 'manager-1',
        approvedAt: new Date(),
      });

      const result = await service.approvePayout('payout-1', 'manager-1', { notes: 'ok' });

      expect(result.status).toBe('APPROVED');
      expect(prisma.commissionPayout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payout-1' },
          data: expect.objectContaining({
            status: 'APPROVED',
            approvedById: 'manager-1',
          }),
        }),
      );
    });

    it('throws NotFoundException when payout does not exist', async () => {
      prisma.commissionPayout.findFirst.mockResolvedValue(null);

      await expect(
        service.approvePayout('missing', 'manager-1', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when payout is not in DRAFT status', async () => {
      prisma.commissionPayout.findFirst.mockResolvedValue({
        ...draftPayout,
        status: 'APPROVED',
      });

      await expect(
        service.approvePayout('payout-1', 'manager-1', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // Prevent the master commission rate from drifting mid-cycle. If a rate
  // change were allowed while PENDING commissions exist in the current
  // period, the per-commission snapshot on SalesCommission would be fine
  // for already-created rows, but the PENDING queue would become ambiguous
  // to auditors about which rate was in force when.
  describe('updateRule — period lock on rate changes', () => {
    it('rejects rate change while PENDING commissions exist in current period', async () => {
      prisma.commissionRule.findFirst.mockResolvedValue({
        id: 'rule-1',
        rate: new Prisma.Decimal('0.03'),
      });
      prisma.salesCommission.count.mockResolvedValue(4);

      await expect(
        service.updateRule('rule-1', { rate: 0.05 }),
      ).rejects.toThrow(/มี commission ที่รอดำเนินการ/);
      expect(prisma.commissionRule.update).not.toHaveBeenCalled();
    });

    it('allows rate change when no PENDING commissions exist in the current period', async () => {
      prisma.commissionRule.findFirst.mockResolvedValue({
        id: 'rule-1',
        rate: new Prisma.Decimal('0.03'),
      });
      prisma.salesCommission.count.mockResolvedValue(0);
      prisma.commissionRule.update.mockResolvedValue({ id: 'rule-1' });

      await expect(service.updateRule('rule-1', { rate: 0.05 })).resolves.toBeDefined();
      expect(prisma.commissionRule.update).toHaveBeenCalled();
    });

    it('allows non-rate updates even when PENDING commissions exist', async () => {
      prisma.commissionRule.findFirst.mockResolvedValue({
        id: 'rule-1',
        rate: new Prisma.Decimal('0.03'),
      });
      prisma.salesCommission.count.mockResolvedValue(10);
      prisma.commissionRule.update.mockResolvedValue({ id: 'rule-1' });

      await expect(service.updateRule('rule-1', { name: 'renamed' })).resolves.toBeDefined();
      expect(prisma.commissionRule.update).toHaveBeenCalled();
    });

    it('allows rate update that equals existing rate (no-op)', async () => {
      prisma.commissionRule.findFirst.mockResolvedValue({
        id: 'rule-1',
        rate: new Prisma.Decimal('0.03'),
      });
      prisma.commissionRule.update.mockResolvedValue({ id: 'rule-1' });
      // count should not be queried when the rate value is unchanged
      prisma.salesCommission.count.mockResolvedValue(999);

      await expect(service.updateRule('rule-1', { rate: 0.03 })).resolves.toBeDefined();
    });
  });

  // T2-C6 — clawback policy on defaulted contracts. The schedule encodes
  // risk appetite: the earlier a contract defaults, the more of the
  // commission should be reversed.
  describe('applyClawbackForContract — tiered clawback', () => {
    const mkCommission = (overrides = {}) => ({
      id: 'sc-1',
      contractId: 'contract-1',
      salespersonId: 'sp-1',
      commissionAmount: new Prisma.Decimal('500'),
      status: 'PAID',
      clawbackAt: null,
      deletedAt: null,
      ...overrides,
    });

    it('claws back 100% on first-payment default (monthsPaid = 0 or 1)', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([mkCommission()]);

      const res = await service.applyClawbackForContract('contract-1', 0, 'FPD');

      expect(res.percent).toBe(100);
      expect(res.clawedBackCount).toBe(1);
      expect(res.totalAmount).toBe('500');
      expect(prisma.salesCommission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CLAWED_BACK',
            clawbackAmount: expect.any(Prisma.Decimal),
            clawbackPercent: 100,
            monthsPaidBeforeDefault: 0,
          }),
        }),
      );
    });

    it('claws back 75% at 2-3 months paid', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([mkCommission()]);
      const res = await service.applyClawbackForContract('contract-1', 3, 'early default');

      expect(res.percent).toBe(75);
      expect(res.totalAmount).toBe('375');
      expect(prisma.salesCommission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PARTIALLY_CLAWED_BACK',
            clawbackPercent: 75,
          }),
        }),
      );
    });

    it('claws back 50% at 4-6 months paid', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([mkCommission()]);
      const res = await service.applyClawbackForContract('contract-1', 5, 'mid default');
      expect(res.percent).toBe(50);
      expect(res.totalAmount).toBe('250');
    });

    it('claws back 25% at 7-12 months paid', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([mkCommission()]);
      const res = await service.applyClawbackForContract('contract-1', 10, 'late default');
      expect(res.percent).toBe(25);
      expect(res.totalAmount).toBe('125');
    });

    it('does nothing (0%) when the contract paid >12 months', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([mkCommission()]);
      const res = await service.applyClawbackForContract('contract-1', 18, 'very late');
      expect(res.percent).toBe(0);
      expect(res.clawedBackCount).toBe(0);
      expect(prisma.salesCommission.findMany).not.toHaveBeenCalled();
      expect(prisma.salesCommission.update).not.toHaveBeenCalled();
    });

    it('is idempotent: already-clawed rows are filtered out via clawbackAt IS NULL', async () => {
      prisma.salesCommission.findMany.mockResolvedValue([]); // no rows match the where clause
      const res = await service.applyClawbackForContract('contract-1', 0, 'retry');
      expect(res.clawedBackCount).toBe(0);
      expect(prisma.salesCommission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contractId: 'contract-1',
            clawbackAt: null,
            status: { in: ['APPROVED', 'PAID'] },
          }),
        }),
      );
      expect(prisma.salesCommission.update).not.toHaveBeenCalled();
    });

    it('rejects negative or non-finite monthsPaid', async () => {
      await expect(service.applyClawbackForContract('c', -1, 'bad')).rejects.toThrow(BadRequestException);
      await expect(service.applyClawbackForContract('c', Number.NaN, 'bad')).rejects.toThrow(BadRequestException);
    });
  });
});
