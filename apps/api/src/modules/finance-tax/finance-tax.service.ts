import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// VAT accounts used across tasks
const VAT_OUTPUT_ACCOUNTS = ['21-2101'];
const VAT_DEFERRED_ACCOUNTS = ['21-2102'];
const VAT_INPUT_ACCOUNTS = ['11-4101'];
const VAT_INPUT_BEHALF_ACCOUNTS = ['11-2104'];

// All VAT-related accounts (for auto-journal history — includes 11-2105 accrual VAT)
const ALL_VAT_ACCOUNTS = ['21-2101', '21-2102', '11-4101', '11-2104', '11-2105'];

// WHT accounts
const WHT_PND1_ACCOUNTS = ['21-3101'];
const WHT_PND3_ACCOUNTS = ['21-3102'];
const WHT_PND53_ACCOUNTS = ['21-3103'];
const ALL_WHT_ACCOUNTS = [...WHT_PND1_ACCOUNTS, ...WHT_PND3_ACCOUNTS, ...WHT_PND53_ACCOUNTS];

interface PeriodBounds {
  year: number;
  month: number;
  start: Date;
  end: Date;
}

function buildPeriod(year: number, month: number): PeriodBounds {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0); // exclusive upper bound
  return { year, month, start, end };
}

interface VatLine {
  accountCode: string;
  documentNumber: string;
  postedAt: Date | null;
  description: string | null;
  debit: number;
  credit: number;
}

interface WhtLine {
  documentNumber: string;
  postedAt: Date | null;
  description: string | null;
  amount: number; // credit - debit (positive = payable accrual, negative = settlement)
}

interface VatAutoJournalVatLine {
  accountCode: string;
  debit: number;
  credit: number;
}

@Injectable()
export class FinanceTaxService {
  constructor(private prisma: PrismaService) {}

  /**
   * Task 2 — VAT monthly aggregation
   * Queries JournalLines for VAT accounts within the given month.
   * Maps entryNumber → documentNumber per SP1 convention.
   */
  async getVatMonthly(year: number, month: number, companyId?: string) {
    const period = buildPeriod(year, month);

    const entryWhere: Record<string, unknown> = {
      deletedAt: null,
      status: 'POSTED',
      entryDate: {
        gte: period.start,
        lt: period.end,
      },
    };

    if (companyId) {
      entryWhere.companyId = companyId;
    }

    const allVatAccountCodes = [
      ...VAT_OUTPUT_ACCOUNTS,
      ...VAT_DEFERRED_ACCOUNTS,
      ...VAT_INPUT_ACCOUNTS,
      ...VAT_INPUT_BEHALF_ACCOUNTS,
    ];

    const lines = await this.prisma.journalLine.findMany({
      where: {
        deletedAt: null,
        accountCode: { in: allVatAccountCodes },
        journalEntry: entryWhere,
      },
      include: {
        journalEntry: {
          select: {
            entryNumber: true,
            postedAt: true,
            description: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { accountCode: 'asc' },
      ],
    });

    // Aggregate per-account totals
    let vatOutput = 0; // 21-2101: credit - debit (liability account)
    let vatDeferred = 0; // 21-2102: credit - debit (liability account)
    let vatInput = 0; // 11-4101: debit - credit (asset account)

    const responseLines: VatLine[] = lines.map((l) => {
      const debit = Number(l.debit ?? 0);
      const credit = Number(l.credit ?? 0);

      if (VAT_OUTPUT_ACCOUNTS.includes(l.accountCode)) {
        vatOutput += credit - debit;
      } else if (VAT_DEFERRED_ACCOUNTS.includes(l.accountCode)) {
        vatDeferred += credit - debit;
      } else if (VAT_INPUT_ACCOUNTS.includes(l.accountCode)) {
        vatInput += debit - credit; // asset increases on debit
      }
      // VAT_INPUT_BEHALF_ACCOUNTS (11-2104) tracked in lines but not in netVat
      // per CLAUDE.md: 11-2104 is ม.83/6 cases, not claimable on ภ.พ.30

      return {
        accountCode: l.accountCode,
        documentNumber: l.journalEntry.entryNumber, // entryNumber → documentNumber
        postedAt: l.journalEntry.postedAt,
        description: l.description ?? l.journalEntry.description,
        debit,
        credit,
      };
    });

    // netVat = vatOutput - vatInput (standard ภ.พ.30 calculation)
    const netVat = vatOutput - vatInput;

    return {
      period,
      vatOutput: Math.round(vatOutput * 100) / 100,
      vatDeferred: Math.round(vatDeferred * 100) / 100,
      vatInput: Math.round(vatInput * 100) / 100,
      netVat: Math.round(netVat * 100) / 100,
      lineCount: lines.length,
      lines: responseLines,
    };
  }

  /**
   * Task 3 — WHT monthly aggregation
   * Queries JournalLines for WHT accounts within the given month.
   * Groups by form type: PND1 (21-3101), PND3 (21-3102), PND53 (21-3103).
   */
  async getWhtMonthly(year: number, month: number, companyId?: string) {
    const period = buildPeriod(year, month);

    const entryWhere: Record<string, unknown> = {
      deletedAt: null,
      status: 'POSTED',
      entryDate: {
        gte: period.start,
        lt: period.end,
      },
    };

    if (companyId) {
      entryWhere.companyId = companyId;
    }

    const lines = await this.prisma.journalLine.findMany({
      where: {
        deletedAt: null,
        accountCode: { in: ALL_WHT_ACCOUNTS },
        journalEntry: entryWhere,
      },
      include: {
        journalEntry: {
          select: {
            entryNumber: true,
            postedAt: true,
            description: true,
          },
        },
      },
      orderBy: [
        { journalEntry: { entryDate: 'asc' } },
        { accountCode: 'asc' },
      ],
    });

    const pnd1Lines: WhtLine[] = [];
    const pnd3Lines: WhtLine[] = [];
    const pnd53Lines: WhtLine[] = [];

    for (const l of lines) {
      const debit = Number(l.debit ?? 0);
      const credit = Number(l.credit ?? 0);
      const amount = credit - debit; // positive = payable accrual, negative = settlement

      const whtLine: WhtLine = {
        documentNumber: l.journalEntry.entryNumber,
        postedAt: l.journalEntry.postedAt,
        description: l.description ?? l.journalEntry.description,
        amount: Math.round(amount * 100) / 100,
      };

      if (WHT_PND1_ACCOUNTS.includes(l.accountCode)) {
        pnd1Lines.push(whtLine);
      } else if (WHT_PND3_ACCOUNTS.includes(l.accountCode)) {
        pnd3Lines.push(whtLine);
      } else if (WHT_PND53_ACCOUNTS.includes(l.accountCode)) {
        pnd53Lines.push(whtLine);
      }
    }

    const pnd1Total = pnd1Lines.reduce((s, l) => s + l.amount, 0);
    const pnd3Total = pnd3Lines.reduce((s, l) => s + l.amount, 0);
    const pnd53Total = pnd53Lines.reduce((s, l) => s + l.amount, 0);
    const grandTotal = pnd1Total + pnd3Total + pnd53Total;

    return {
      period,
      PND1: {
        lines: pnd1Lines,
        total: Math.round(pnd1Total * 100) / 100,
      },
      PND3: {
        lines: pnd3Lines,
        total: Math.round(pnd3Total * 100) / 100,
      },
      PND53: {
        lines: pnd53Lines,
        total: Math.round(pnd53Total * 100) / 100,
      },
      grandTotal: Math.round(grandTotal * 100) / 100,
    };
  }

  /**
   * Task 4 — VAT Auto Journal history
   * Returns all JournalEntries where any line touches VAT accounts.
   * Uses nested include.where to filter only VAT lines per entry.
   */
  async getVatAutoJournalHistory(year: number, month: number, companyId?: string) {
    const period = buildPeriod(year, month);

    const entryWhere: Record<string, unknown> = {
      deletedAt: null,
      status: 'POSTED',
      entryDate: {
        gte: period.start,
        lt: period.end,
      },
      lines: {
        some: {
          accountCode: { in: ALL_VAT_ACCOUNTS },
          deletedAt: null,
        },
      },
    };

    if (companyId) {
      entryWhere.companyId = companyId;
    }

    const entries = await this.prisma.journalEntry.findMany({
      where: entryWhere,
      include: {
        lines: {
          where: {
            accountCode: { in: ALL_VAT_ACCOUNTS },
            deletedAt: null,
          },
        },
      },
      orderBy: { entryDate: 'asc' },
    });

    const responseEntries = entries.map((entry) => {
      const vatLines: VatAutoJournalVatLine[] = entry.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: Number(l.debit ?? 0),
        credit: Number(l.credit ?? 0),
      }));

      return {
        id: entry.id,
        documentNumber: entry.entryNumber, // entryNumber → documentNumber
        postedAt: entry.postedAt,
        sourceType: entry.referenceType, // referenceType → sourceType
        description: entry.description,
        vatLines,
      };
    });

    return {
      period,
      entries: responseEntries,
    };
  }
}
