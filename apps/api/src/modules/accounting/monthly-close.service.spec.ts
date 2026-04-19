import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MonthlyCloseService } from './monthly-close.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { TaxService } from '../tax/tax.service';
import { AccountingService } from './accounting.service';
import { PeakService } from '../peak/peak.service';

// ─── Minimal mock factories ────────────────────────────────────────────────

const makePrisma = () => ({
  accountingPeriod: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  journalEntry: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  payment: {
    count: jest.fn(),
  },
});

const makeJournalAutoService = () => ({
  getTrialBalance: jest.fn(),
});

const makeTaxService = () => ({
  previewPP30: jest.fn(),
});

const makeAccountingService = () => ({
  getBranchIdsForCompany: jest.fn(),
  getProfitLossReport: jest.fn(),
  getBalanceSheet: jest.fn(),
});

const makePeakService = () => ({
  isConfigured: jest.fn(),
  exportJournalEntries: jest.fn(),
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('MonthlyCloseService', () => {
  let service: MonthlyCloseService;
  let prisma: ReturnType<typeof makePrisma>;
  let journalAutoService: ReturnType<typeof makeJournalAutoService>;
  let taxService: ReturnType<typeof makeTaxService>;
  let accountingService: ReturnType<typeof makeAccountingService>;
  let peakService: ReturnType<typeof makePeakService>;

  beforeEach(async () => {
    prisma = makePrisma();
    journalAutoService = makeJournalAutoService();
    taxService = makeTaxService();
    accountingService = makeAccountingService();
    peakService = makePeakService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlyCloseService,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: journalAutoService },
        { provide: TaxService, useValue: taxService },
        { provide: AccountingService, useValue: accountingService },
        { provide: PeakService, useValue: peakService },
      ],
    }).compile();

    service = module.get<MonthlyCloseService>(MonthlyCloseService);
  });

  // 1. getPeriodStatus — returns OPEN placeholder for non-existent period
  describe('getPeriodStatus', () => {
    it('returns OPEN placeholder when no DB record exists', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue(null);

      const result = await service.getPeriodStatus('company-1', 2025, 3);

      expect(result.status).toBe('OPEN');
      expect(result.companyId).toBe('company-1');
      expect(result.year).toBe(2025);
      expect(result.month).toBe(3);
      expect(result.id).toBeUndefined();
    });

    // 2. getPeriodStatus — returns existing period data
    it('returns existing period data from DB', async () => {
      const existingPeriod = {
        id: 'period-uuid-1',
        companyId: 'company-1',
        year: 2025,
        month: 3,
        status: 'REVIEW',
        reviewStartedAt: new Date('2025-04-01'),
        reviewStartedById: 'user-1',
        closedAt: null,
        closedById: null,
        peakSyncedAt: null,
        peakSyncResult: null,
        reportSnapshot: null,
        auditIssues: { totalJournals: 10, unbalancedJournals: 0 },
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.accountingPeriod.findUnique.mockResolvedValue(existingPeriod);

      const result = await service.getPeriodStatus('company-1', 2025, 3);

      expect(result.status).toBe('REVIEW');
      expect(result.id).toBe('period-uuid-1');
      expect(result.auditIssues).toEqual({ totalJournals: 10, unbalancedJournals: 0 });
    });
  });

  // 3. startReview — moves OPEN to REVIEW
  describe('startReview', () => {
    it('moves an OPEN period to REVIEW with audit data', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue(null); // no existing period (OPEN)
      prisma.journalEntry.count.mockResolvedValue(15);
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          id: 'je-1',
          lines: [
            { debit: '100.00', credit: '0.00' },
            { debit: '0.00', credit: '100.00' },
          ],
        },
      ]);
      prisma.payment.count.mockResolvedValue(0);

      const upsertResult = {
        id: 'period-2',
        companyId: 'company-1',
        year: 2025,
        month: 4,
        status: 'REVIEW',
        reviewStartedAt: new Date(),
        reviewStartedById: 'user-1',
        closedAt: null,
        closedById: null,
        peakSyncedAt: null,
        peakSyncResult: null,
        reportSnapshot: null,
        auditIssues: { totalJournals: 15, unbalancedJournals: 0, paymentsWithoutBreakdown: 0, hasIssues: false },
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.accountingPeriod.upsert.mockResolvedValue(upsertResult);

      const result = await service.startReview('company-1', 2025, 4, 'user-1');

      expect(result.status).toBe('REVIEW');
      expect(prisma.accountingPeriod.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId_year_month: { companyId: 'company-1', year: 2025, month: 4 } },
          create: expect.objectContaining({ status: 'REVIEW', reviewStartedById: 'user-1' }),
          update: expect.objectContaining({ status: 'REVIEW', reviewStartedById: 'user-1' }),
        }),
      );
    });

    // 4. startReview — rejects on CLOSED period
    it('throws BadRequestException when period is already CLOSED', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue({
        id: 'period-3',
        companyId: 'company-1',
        year: 2025,
        month: 1,
        status: 'CLOSED',
      });

      await expect(service.startReview('company-1', 2025, 1, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // 5. closePeriod — moves REVIEW to CLOSED with snapshots
  describe('closePeriod', () => {
    it('moves a REVIEW period to CLOSED with report snapshots', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue({
        id: 'period-4',
        companyId: 'company-1',
        year: 2025,
        month: 2,
        status: 'REVIEW',
      });

      accountingService.getBranchIdsForCompany.mockResolvedValue(['branch-1']);
      journalAutoService.getTrialBalance.mockResolvedValue({
        asOfDate: '2025-02-28T23:59:59.999Z',
        accounts: [],
        totalDebit: 0,
        totalCredit: 0,
        balanced: true,
      });
      accountingService.getProfitLossReport.mockResolvedValue({ totalRevenue: 50000 });
      accountingService.getBalanceSheet.mockResolvedValue({ totalAssets: 200000 });
      taxService.previewPP30.mockResolvedValue({ totalVatOutput: 3500, netVat: 2800 });

      const updateResult = {
        id: 'period-4',
        companyId: 'company-1',
        year: 2025,
        month: 2,
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: 'user-2',
        reportSnapshot: { generatedAt: new Date().toISOString() },
        reviewStartedAt: null,
        reviewStartedById: null,
        peakSyncedAt: null,
        peakSyncResult: null,
        auditIssues: null,
        notes: 'ปิดงวดกุมภาพันธ์',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.accountingPeriod.update.mockResolvedValue(updateResult);

      const result = await service.closePeriod('company-1', 2025, 2, 'user-2', 'ปิดงวดกุมภาพันธ์');

      expect(result.status).toBe('CLOSED');
      expect(prisma.accountingPeriod.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId_year_month: { companyId: 'company-1', year: 2025, month: 2 } },
          data: expect.objectContaining({ status: 'CLOSED', closedById: 'user-2' }),
        }),
      );
    });

    // 6. closePeriod — rejects on OPEN period
    it('throws BadRequestException when period is OPEN (not REVIEW)', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue(null); // no record = OPEN

      await expect(service.closePeriod('company-1', 2025, 5, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // 7. syncToPeak — rejects if PEAK not configured
  describe('syncToPeak', () => {
    it('throws BadRequestException when PEAK is not configured', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue({
        id: 'period-5',
        companyId: 'company-1',
        year: 2025,
        month: 3,
        status: 'CLOSED',
      });
      peakService.isConfigured.mockReturnValue(false);

      await expect(service.syncToPeak('company-1', 2025, 3)).rejects.toThrow(BadRequestException);
      expect(peakService.exportJournalEntries).not.toHaveBeenCalled();
    });
  });

  // T2-C10 — reopenPeriod 90-day lock
  describe('reopenPeriod — T2-C10 90-day lock', () => {
    const base = {
      id: 'period-reopen-1',
      companyId: 'company-1',
      year: 2025,
      month: 2,
      reviewStartedAt: null,
      reviewStartedById: null,
      peakSyncedAt: null,
      peakSyncResult: null,
      reportSnapshot: null,
      auditIssues: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('allows reopen of a fresh CLOSED period (closedAt < 90 days ago)', async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      prisma.accountingPeriod.findUnique.mockResolvedValue({
        ...base,
        status: 'CLOSED',
        closedAt: tenDaysAgo,
        closedById: 'user-1',
      });
      prisma.accountingPeriod.update.mockResolvedValue({
        ...base,
        status: 'OPEN',
        closedAt: null,
        closedById: null,
      });

      const result = await service.reopenPeriod('company-1', 2025, 2);

      expect(result.status).toBe('OPEN');
      expect(prisma.accountingPeriod.update).toHaveBeenCalled();
    });

    it('blocks reopen of a stale CLOSED period (closedAt > 90 days ago) without boardResolutionId', async () => {
      const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      prisma.accountingPeriod.findUnique.mockResolvedValue({
        ...base,
        status: 'CLOSED',
        closedAt: hundredDaysAgo,
        closedById: 'user-1',
      });

      await expect(service.reopenPeriod('company-1', 2025, 2)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.accountingPeriod.update).not.toHaveBeenCalled();
    });

    it('allows reopen of a stale CLOSED period when boardResolutionId is supplied', async () => {
      const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      prisma.accountingPeriod.findUnique.mockResolvedValue({
        ...base,
        status: 'CLOSED',
        closedAt: hundredDaysAgo,
        closedById: 'user-1',
      });
      prisma.accountingPeriod.update.mockResolvedValue({
        ...base,
        status: 'OPEN',
        closedAt: null,
        closedById: null,
      });

      const result = await service.reopenPeriod(
        'company-1',
        2025,
        2,
        'BOARD-RES-2026-04-19',
      );

      expect(result.status).toBe('OPEN');
      expect(prisma.accountingPeriod.update).toHaveBeenCalled();
    });
  });

  // 8. getPeriodsOverview — returns 12-month array
  describe('getPeriodsOverview', () => {
    it('returns a 12-element array filling gaps with OPEN placeholders', async () => {
      prisma.accountingPeriod.findMany.mockResolvedValue([
        {
          id: 'p-1',
          companyId: 'company-1',
          year: 2025,
          month: 1,
          status: 'CLOSED',
          reviewStartedAt: null,
          reviewStartedById: null,
          closedAt: new Date(),
          closedById: 'user-1',
          peakSyncedAt: null,
          peakSyncResult: null,
          reportSnapshot: null,
          auditIssues: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'p-2',
          companyId: 'company-1',
          year: 2025,
          month: 3,
          status: 'REVIEW',
          reviewStartedAt: new Date(),
          reviewStartedById: 'user-1',
          closedAt: null,
          closedById: null,
          peakSyncedAt: null,
          peakSyncResult: null,
          reportSnapshot: null,
          auditIssues: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getPeriodsOverview('company-1', 2025);

      expect(result).toHaveLength(12);
      expect(result[0].month).toBe(1);
      expect(result[0].status).toBe('CLOSED');
      expect(result[1].month).toBe(2);
      expect(result[1].status).toBe('OPEN'); // gap filled with placeholder
      expect(result[1].id).toBeUndefined();
      expect(result[2].month).toBe(3);
      expect(result[2].status).toBe('REVIEW');
      // remaining months are OPEN placeholders
      for (let i = 3; i < 12; i++) {
        expect(result[i].status).toBe('OPEN');
        expect(result[i].id).toBeUndefined();
      }
    });
  });
});
