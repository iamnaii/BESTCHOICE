import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { IntercompanyReportService } from './intercompany-report.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('IntercompanyReportService', () => {
  let service: IntercompanyReportService;
  let prisma: any;

  const periodStart = new Date('2026-01-01T00:00:00Z');
  const periodEnd = new Date('2026-01-31T23:59:59Z');

  beforeEach(async () => {
    prisma = {
      journalLine: {
        groupBy: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntercompanyReportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<IntercompanyReportService>(IntercompanyReportService);
  });

  // ─── Test 1: zero activity → all zeros ───────────────────────────────────

  it('returns zero balances when no journal lines exist for the period', async () => {
    prisma.journalLine.groupBy.mockResolvedValue([]);

    const report = await service.getReport(periodStart, periodEnd);

    expect(report.lines).toHaveLength(2);
    expect(report.total.openingBalance).toBe(0);
    expect(report.total.accruals).toBe(0);
    expect(report.total.settlements).toBe(0);
    expect(report.total.closingBalance).toBe(0);
  });

  // ─── Test 2: correct opening + period aggregation ────────────────────────

  it('computes opening, accruals, settlements, closing correctly', async () => {
    // First groupBy call: opening (before periodStart)
    // 21-1101: Cr 17000, Dr 0 → opening = 17000
    // 21-1102: Cr 1700, Dr 0  → opening = 1700
    prisma.journalLine.groupBy
      .mockResolvedValueOnce([
        { accountCode: '21-1101', _sum: { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(17000) } },
        { accountCode: '21-1102', _sum: { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(1700) } },
      ])
      // Second groupBy call: period movements
      // 21-1101: Cr 5000 (new contract), Dr 17000 (settlement) → accruals=5000, settlements=17000
      // 21-1102: Cr 500, Dr 1700 → accruals=500, settlements=1700
      .mockResolvedValueOnce([
        { accountCode: '21-1101', _sum: { debit: new Prisma.Decimal(17000), credit: new Prisma.Decimal(5000) } },
        { accountCode: '21-1102', _sum: { debit: new Prisma.Decimal(1700), credit: new Prisma.Decimal(500) } },
      ]);

    const report = await service.getReport(periodStart, periodEnd);

    const line1101 = report.lines.find((l) => l.accountCode === '21-1101')!;
    expect(line1101.openingBalance).toBe(17000);
    expect(line1101.accruals).toBe(5000);
    expect(line1101.settlements).toBe(17000);
    expect(line1101.closingBalance).toBe(5000); // 17000 + 5000 - 17000

    const line1102 = report.lines.find((l) => l.accountCode === '21-1102')!;
    expect(line1102.openingBalance).toBe(1700);
    expect(line1102.accruals).toBe(500);
    expect(line1102.settlements).toBe(1700);
    expect(line1102.closingBalance).toBe(500);

    // Total
    expect(report.total.openingBalance).toBe(18700);
    expect(report.total.accruals).toBe(5500);
    expect(report.total.settlements).toBe(18700);
    expect(report.total.closingBalance).toBe(5500);
  });

  // ─── Test 3: correct query parameters ────────────────────────────────────

  it('queries opening balance with entryDate.lt = periodStart', async () => {
    prisma.journalLine.groupBy.mockResolvedValue([]);

    await service.getReport(periodStart, periodEnd);

    const [openingCall, periodCall] = prisma.journalLine.groupBy.mock.calls;

    // Opening balance query: lt periodStart
    expect(openingCall[0].where.journalEntry.entryDate).toEqual({ lt: periodStart });

    // Period query: gte periodStart, lte periodEnd
    expect(periodCall[0].where.journalEntry.entryDate).toEqual({
      gte: periodStart,
      lte: periodEnd,
    });
  });

  // ─── Test 4: both INTERCO_AP_CODES are included in lines output ──────────

  it('always returns both 21-1101 and 21-1102 even with partial data', async () => {
    // Only 21-1101 has data
    prisma.journalLine.groupBy
      .mockResolvedValueOnce([
        { accountCode: '21-1101', _sum: { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(10000) } },
      ])
      .mockResolvedValueOnce([]);

    const report = await service.getReport(periodStart, periodEnd);

    expect(report.lines).toHaveLength(2);
    const codes = report.lines.map((l) => l.accountCode);
    expect(codes).toContain('21-1101');
    expect(codes).toContain('21-1102');

    const line1102 = report.lines.find((l) => l.accountCode === '21-1102')!;
    expect(line1102.openingBalance).toBe(0);
    expect(line1102.closingBalance).toBe(0);
  });
});
