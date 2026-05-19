import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * P4-SP4 Task 5 — IntercompanyReportService
 *
 * Aggregates FINANCE-side inter-company balances for accounts:
 *   21-1101  เจ้าหนี้-หน้าร้าน (ยอดจัด)        ← payable to SHOP for financed amount
 *   21-1102  เจ้าหนี้ค่าคอม-หน้าร้าน             ← payable to SHOP for commission
 *
 * Both are Cr-normal (liability) accounts. Per period:
 *   - Opening balance  = cumulative net (Cr − Dr) on all POSTED lines before periodStart
 *   - Accruals         = Cr movements within period (liability increases — new contracts)
 *   - Settlements      = Dr movements within period (liability decreases — vendor clearance)
 *   - Closing balance  = opening + accruals − settlements
 *
 * Report structure per account + combined total.
 */

export interface InterCoAccountLine {
  accountCode: string;
  accountName: string;
  openingBalance: number;
  accruals: number;
  settlements: number;
  closingBalance: number;
}

export interface InterCoReport {
  periodStart: string;
  periodEnd: string;
  lines: InterCoAccountLine[];
  total: {
    openingBalance: number;
    accruals: number;
    settlements: number;
    closingBalance: number;
  };
}

const INTERCO_AP_CODES = ['21-1101', '21-1102'] as const;

const ACCOUNT_NAMES: Record<string, string> = {
  '21-1101': 'เจ้าหนี้-หน้าร้าน (ยอดจัด)',
  '21-1102': 'เจ้าหนี้ค่าคอม-หน้าร้าน',
};

@Injectable()
export class IntercompanyReportService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(periodStart: Date, periodEnd: Date): Promise<InterCoReport> {
    // Opening balance: sum of all Cr − Dr on these accounts BEFORE periodStart
    const openingLines = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        accountCode: { in: [...INTERCO_AP_CODES] },
        journalEntry: {
          status: 'POSTED',
          entryDate: { lt: periodStart },
          deletedAt: null,
        },
        deletedAt: null,
      },
      _sum: { debit: true, credit: true },
    });

    // Period movements: Cr = accruals, Dr = settlements
    const periodLines = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        accountCode: { in: [...INTERCO_AP_CODES] },
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: periodStart, lte: periodEnd },
          deletedAt: null,
        },
        deletedAt: null,
      },
      _sum: { debit: true, credit: true },
    });

    const makeMap = (
      rows: { accountCode: string; _sum: { debit: Prisma.Decimal | null; credit: Prisma.Decimal | null } }[],
    ) => {
      const m = new Map<string, { dr: number; cr: number }>();
      for (const r of rows) {
        m.set(r.accountCode, {
          dr: Number(r._sum.debit ?? 0),
          cr: Number(r._sum.credit ?? 0),
        });
      }
      return m;
    };

    const openingMap = makeMap(openingLines);
    const periodMap = makeMap(periodLines);

    const lines: InterCoAccountLine[] = INTERCO_AP_CODES.map((code) => {
      const opening = openingMap.get(code) ?? { dr: 0, cr: 0 };
      const period = periodMap.get(code) ?? { dr: 0, cr: 0 };

      // Liability accounts: normal balance = Cr. Opening = cumulative Cr − Dr.
      const openingBalance = opening.cr - opening.dr;
      const accruals = period.cr;       // new Cr → liability increases
      const settlements = period.dr;    // new Dr → liability decreases
      const closingBalance = openingBalance + accruals - settlements;

      return {
        accountCode: code,
        accountName: ACCOUNT_NAMES[code] ?? code,
        openingBalance: round2(openingBalance),
        accruals: round2(accruals),
        settlements: round2(settlements),
        closingBalance: round2(closingBalance),
      };
    });

    const total = lines.reduce(
      (acc, l) => ({
        openingBalance: round2(acc.openingBalance + l.openingBalance),
        accruals: round2(acc.accruals + l.accruals),
        settlements: round2(acc.settlements + l.settlements),
        closingBalance: round2(acc.closingBalance + l.closingBalance),
      }),
      { openingBalance: 0, accruals: 0, settlements: 0, closingBalance: 0 },
    );

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      lines,
      total,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
