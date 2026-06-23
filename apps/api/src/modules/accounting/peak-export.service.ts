import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from '../journal/company-resolver.service';

// ============================================================
// P3-SP3: PEAK CSV export (journal lines tagged with PEAK code)
// ============================================================

@Injectable()
export class PeakExportService {
  constructor(
    private prisma: PrismaService,
    private companyResolver: CompanyResolverService,
  ) {}

  /**
   * Build a CSV of POSTED journal lines within `[periodStart, periodEnd]`
   * joined with their `ChartOfAccount.peakCode`. Lines whose account has no
   * PEAK mapping are SKIPPED (returned `skippedLineCount`) so the caller can
   * surface a warning. Date range is capped at ~6 months (186 days) so accidental
   * "give me everything" queries don't dump millions of rows.
   *
   * Output columns:
   *   entryDate, entryNumber, peakCode, accountCode, accountName,
   *   debit, credit, description, reference
   *
   * Money values are emitted via `.toString()` to preserve Decimal precision
   * (matches the "DO NOT Number() on Prisma.Decimal in export" rule).
   */
  async exportJournalWithPeakCodes(
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ csv: string; rowCount: number; skippedLineCount: number }> {
    // Guard: max 186 days (~6 months) per spec — protects DB + filesystem.
    const ms = periodEnd.getTime() - periodStart.getTime();
    const MAX_DAYS = 186;
    if (ms < 0) {
      throw new BadRequestException('วันที่สิ้นสุดต้องไม่อยู่ก่อนวันเริ่มต้น');
    }
    if (ms > MAX_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('ช่วงเวลาส่งออกต้องไม่เกิน 6 เดือนต่อครั้ง');
    }

    // 1) Build a peakCode lookup for every account that has one. Single query
    //    is cheaper than joining inline because there are ~99 accounts total.
    const mappedAccounts = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null, peakCode: { not: null } },
      select: { code: true, name: true, peakCode: true },
    });
    const peakByCode = new Map(
      mappedAccounts.map((a) => [a.code, { name: a.name, peakCode: a.peakCode! }]),
    );

    // Also load account names for un-mapped lines so we can report what was skipped.
    const allAccounts = await this.prisma.chartOfAccount.findMany({
      where: { deletedAt: null },
      select: { code: true, name: true },
    });
    const nameByCode = new Map(allAccounts.map((a) => [a.code, a.name]));

    // 2) Fetch journal lines in range. Order by entryDate then entryNumber so
    //    the CSV is deterministic for reconciliation diffs.
    // X5: scope to FINANCE company so SHOP (S-prefix) entries never leak into
    //     the PEAK CSV that the CPA uploads to peakaccount.com.
    const financeCompanyId = await this.companyResolver.getFinanceCompanyId();
    const lines = await this.prisma.journalLine.findMany({
      where: {
        deletedAt: null,
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
          companyId: financeCompanyId,
        },
      },
      select: {
        accountCode: true,
        debit: true,
        credit: true,
        description: true,
        journalEntry: {
          select: {
            entryNumber: true,
            entryDate: true,
            description: true,
            referenceType: true,
            referenceId: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { journalEntry: { entryNumber: 'asc' } },
      ],
    });

    // 3) Render rows; skip un-mapped accounts.
    const escape = (v: string | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = [
      'entryDate',
      'entryNumber',
      'peakCode',
      'accountCode',
      'accountName',
      'debit',
      'credit',
      'description',
      'reference',
    ].join(',');

    const body: string[] = [];
    let skipped = 0;
    for (const ln of lines) {
      const mapping = peakByCode.get(ln.accountCode);
      if (!mapping) {
        skipped++;
        continue;
      }
      const ref = ln.journalEntry.referenceType
        ? `${ln.journalEntry.referenceType}:${ln.journalEntry.referenceId ?? ''}`
        : '';
      body.push(
        [
          ln.journalEntry.entryDate.toISOString().slice(0, 10),
          escape(ln.journalEntry.entryNumber),
          escape(mapping.peakCode),
          escape(ln.accountCode),
          escape(nameByCode.get(ln.accountCode) ?? mapping.name),
          // String form keeps full Decimal precision — never Number()
          new Prisma.Decimal(ln.debit).toString(),
          new Prisma.Decimal(ln.credit).toString(),
          escape(ln.description ?? ln.journalEntry.description),
          escape(ref),
        ].join(','),
      );
    }

    return {
      // UTF-8 BOM so Excel renders Thai correctly.
      csv: '﻿' + [header, ...body].join('\n'),
      rowCount: body.length,
      skippedLineCount: skipped,
    };
  }
}
