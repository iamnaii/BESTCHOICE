import { Test, TestingModule } from '@nestjs/testing';
import { MonthlyCloseService } from './monthly-close.service';
import { TransactionalReportService } from './transactional-report.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { TaxService } from '../tax/tax.service';
import { AccountingService } from './accounting.service';
import { PeakService } from '../peak/peak.service';
import { AuditService } from '../audit/audit.service';

/**
 * สแนปช็อตตอนปิดงวด (reportSnapshot) ต้องนับเต็มเดือนตามปฏิทินไทย (2026-11-18)
 *
 * เดิม: งบทดลองตัดยอดที่ new Date('YYYY-MM-30') = 07:00 น. ไทยของวันสุดท้าย ⇒ ทุกรายการหลัง 07:00 น. ของวันสุดท้าย
 * หายจาก trialBalance ที่เก็บ · P&L เริ่มนับที่ 07:00 น. ของวันที่ 1 ⇒ ใบขาย/รับชำระ 00:00–06:59 น. ของวันที่ 1 หาย
 *
 * ส่วน P&L: monthly-close ยังส่งสตริงวันที่ 'YYYY-MM-01' / 'YYYY-MM-DD' เหมือนเดิม — การแปลงเป็นขอบวันไทยอยู่ใน
 * TransactionalReportService.getProfitLossReport (Task 3) · เทสต์นี้ต่อสายจริงเพื่อปักผลปลายทาง
 */
describe('MonthlyCloseService.closePeriod — วันที่ของสแนปช็อต', () => {
  let service: MonthlyCloseService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let accountingService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reportPrisma: any;

  beforeEach(async () => {
    prisma = {
      accountingPeriod: { findUnique: jest.fn(), update: jest.fn() },
      companyInfo: { findUnique: jest.fn().mockResolvedValue({ companyCode: 'FINANCE' }) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    reportPrisma = {
      sale: {
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      financeReceivable: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      journalLine: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const transactional = new TransactionalReportService(
      reportPrisma as never,
      { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1') } as never,
    );
    accountingService = {
      getBranchIdsForCompany: jest.fn().mockResolvedValue(['branch-1']),
      getTrialBalance: jest.fn().mockResolvedValue({ accounts: [], isBalanced: true }),
      getProfitLossReport: jest.fn((...args: unknown[]) =>
        (transactional.getProfitLossReport as (...a: unknown[]) => unknown)(...args),
      ),
      getBalanceSheet: jest.fn().mockResolvedValue({ totalAssets: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonthlyCloseService,
        { provide: PrismaService, useValue: prisma },
        { provide: JournalAutoService, useValue: { getTrialBalance: jest.fn() } },
        { provide: TaxService, useValue: { previewPP30: jest.fn().mockResolvedValue({}) } },
        { provide: AccountingService, useValue: accountingService },
        { provide: PeakService, useValue: { isConfigured: jest.fn(), exportJournalEntries: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(MonthlyCloseService);
  });

  const closeMonth = async (year: number, month: number) => {
    prisma.accountingPeriod.findUnique.mockResolvedValue({
      id: 'period-1',
      companyId: 'company-1',
      year,
      month,
      status: 'REVIEW',
    });
    prisma.accountingPeriod.update.mockResolvedValue({ id: 'period-1', status: 'CLOSED' });
    await service.closePeriod('company-1', year, month, 'user-1');
  };

  it('พ.ย. 2026: งบทดลอง ณ สิ้นเดือนไทย (30 พ.ย. 23:59:59.999 น.) ขอบเขต ALL', async () => {
    await closeMonth(2026, 11);
    const [asOf, scope] = accountingService.getTrialBalance.mock.calls[0];
    expect(asOf.toISOString()).toBe('2026-11-30T16:59:59.999Z');
    expect(scope).toBe('ALL');
  });

  it('ธ.ค. 2026: งบทดลอง ณ 31 ธ.ค. 23:59:59.999 น. ไทย (เดือนสุดท้ายของปี)', async () => {
    await closeMonth(2026, 12);
    expect(accountingService.getTrialBalance.mock.calls[0][0].toISOString()).toBe('2026-12-31T16:59:59.999Z');
  });

  it('P&L: ยังส่งสตริงวันที่ YYYY-MM-01 ถึงวันสุดท้ายของเดือนให้ getProfitLossReport', async () => {
    await closeMonth(2026, 11);
    expect(accountingService.getProfitLossReport).toHaveBeenCalledWith(
      '2026-11-01',
      '2026-11-30',
      undefined,
      ['branch-1'],
      true,
    );
  });

  it('P&L ต่อสายจริง: ทุก query นับ 00:00 น. วันที่ 1 ถึง 23:59:59.999 น. วันสุดท้ายของเดือน (เวลาไทย)', async () => {
    await closeMonth(2026, 11);
    const range = { gte: new Date('2026-10-31T17:00:00.000Z'), lte: new Date('2026-11-30T16:59:59.999Z') };
    expect(reportPrisma.sale.aggregate.mock.calls[0][0].where.createdAt).toEqual(range);
    expect(reportPrisma.payment.findMany.mock.calls[0][0].where.paidDate).toEqual(range);
    expect(reportPrisma.journalLine.groupBy.mock.calls[0][0].where.journalEntry.entryDate).toEqual(range);
  });
});
