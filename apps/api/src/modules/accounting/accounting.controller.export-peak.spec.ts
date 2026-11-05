import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { AccountingController } from './accounting.controller';
import type { AccountingService } from './accounting.service';
import type { BadDebtService } from './bad-debt.service';
import type { MonthlyCloseService } from './monthly-close.service';
import type { IntercompanyReportService } from './intercompany-report.service';
import { PeakExportService } from './peak-export.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CompanyResolverService } from '../journal/company-resolver.service';

/**
 * GET /expenses/journal/export-peak — `startDate` / `endDate` are Bangkok calendar days (คู่มือคืนตัด 5.3 D7).
 *
 * Before the fix `startDate` was parsed as UTC midnight (07:00 Bangkok) while `endDate` ended 23:59:59.999 in the
 * API's local time, so two adjacent files (1–4 พ.ย. + 5–30 พ.ย.) both missed every entry posted 00:00–06:59 Bangkok
 * — the nightly crons (2A · ค่าเผื่อ · ไล่ VAT 00:05) never reached PEAK.
 */
describe('AccountingController.exportJournalPeak — Bangkok calendar days', () => {
  const emptyResult = {
    csv: '',
    rowCount: 0,
    skippedLineCount: 0,
    unresolvedSubCodeCount: 0,
    excludedEntryCount: 0,
    excludedLegacyInterestLineCount: 0,
    legacyUnbalancedEntryCount: 0,
  };
  let exportJournalWithPeakCodes: jest.Mock;
  let controller: AccountingController;
  const res = { setHeader: jest.fn(), end: jest.fn() } as unknown as Response;

  beforeEach(() => {
    exportJournalWithPeakCodes = jest.fn().mockResolvedValue(emptyResult);
    controller = new AccountingController(
      { exportJournalWithPeakCodes } as unknown as AccountingService,
      {} as BadDebtService,
      {} as MonthlyCloseService,
      {} as IntercompanyReportService,
    );
  });

  async function rangeOf(startDate: string, endDate: string): Promise<[Date, Date]> {
    exportJournalWithPeakCodes.mockClear();
    await controller.exportJournalPeak(startDate, endDate, res);
    expect(exportJournalWithPeakCodes).toHaveBeenCalledTimes(1);
    return exportJournalWithPeakCodes.mock.calls[0] as [Date, Date];
  }

  it('starts at 00:00 Bangkok of startDate and ends at 23:59:59.999 Bangkok of endDate', async () => {
    const [start, end] = await rangeOf('2026-11-01', '2026-11-30');
    expect(start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-30T16:59:59.999Z');
  });

  it('adjacent ranges leave no gap and no overlap (month file + next day file = one file)', async () => {
    const [, endNov] = await rangeOf('2026-11-01', '2026-11-30');
    const [startDec] = await rangeOf('2026-12-01', '2026-12-01');
    expect(startDec.getTime() - endNov.getTime()).toBe(1);
  });

  it('includes the cutover-night entries posted 00:00–06:59 Bangkok on 1 ธ.ค. in the December file', async () => {
    const [start, end] = await rangeOf('2026-12-01', '2026-12-31');
    // ไล่ VAT 00:05 · ค่าเผื่อ 00:30 · 2A 00:01 (Bangkok) of 1 ธ.ค.
    for (const iso of ['2026-11-30T17:01:00.000Z', '2026-11-30T17:05:00.000Z', '2026-11-30T17:30:00.000Z']) {
      const t = new Date(iso).getTime();
      expect(t).toBeGreaterThanOrEqual(start.getTime());
      expect(t).toBeLessThanOrEqual(end.getTime());
    }
    // ยกมา 30 พ.ย. 23:59:59 Bangkok stays in November
    expect(new Date('2026-11-30T16:59:59.000Z').getTime()).toBeLessThan(start.getTime());
  });

  it.each([
    ['2026-11-1', '2026-11-30'],
    ['2026-11-01', '30/11/2026'],
    ['2026-02-30', '2026-03-01'],
  ])('rejects a non-calendar date %s .. %s', async (startDate, endDate) => {
    await expect(controller.exportJournalPeak(startDate, endDate, res)).rejects.toBeInstanceOf(BadRequestException);
    expect(exportJournalWithPeakCodes).not.toHaveBeenCalled();
  });

  it('rejects an end date before the start date', async () => {
    await expect(controller.exportJournalPeak('2026-12-01', '2026-11-30', res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(exportJournalWithPeakCodes).not.toHaveBeenCalled();
  });

  it('still requires both dates', async () => {
    await expect(controller.exportJournalPeak('', '2026-11-30', res)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.exportJournalPeak('2026-11-01', '', res)).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Controller → real PeakExportService (Prisma mocked): pins the exact `entryDate` filter that reaches the DB and
 * the 186-day guard, whose millisecond span grew by 7 h with the Bangkok start bound.
 */
describe('AccountingController.exportJournalPeak → PeakExportService', () => {
  let findMany: jest.Mock;
  let controller: AccountingController;
  const res = { setHeader: jest.fn(), end: jest.fn() } as unknown as Response;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      journalLine: { findMany },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      expenseDocument: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const peak = new PeakExportService(prisma, {
      getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-id'),
    } as unknown as CompanyResolverService);
    controller = new AccountingController(
      { exportJournalWithPeakCodes: (s: Date, e: Date) => peak.exportJournalWithPeakCodes(s, e) } as unknown as AccountingService,
      {} as BadDebtService,
      {} as MonthlyCloseService,
      {} as IntercompanyReportService,
    );
  });

  it('queries entryDate from 00:00 Bangkok to 23:59:59.999 Bangkok', async () => {
    await controller.exportJournalPeak('2026-11-01', '2026-11-30', res);
    const where = findMany.mock.calls[0][0].where.journalEntry.entryDate;
    expect(where.gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(where.lte.toISOString()).toBe('2026-11-30T16:59:59.999Z');
  });

  it('keeps the 186-day limit: 186 calendar days pass, 187 are rejected', async () => {
    await expect(controller.exportJournalPeak('2026-01-01', '2026-07-05', res)).resolves.toBeUndefined();
    await expect(controller.exportJournalPeak('2026-01-01', '2026-07-06', res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
