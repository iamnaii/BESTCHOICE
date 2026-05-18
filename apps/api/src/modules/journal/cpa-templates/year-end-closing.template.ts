import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { JournalAutoService } from '../journal-auto.service';

/**
 * Template — Year-End Closing (P3-SP1).
 *
 * Closes all Revenue (41-XXXX, 42-XXXX) and Expense (51-XXXX, 52-XXXX,
 * 53-XXXX, 54-XXXX) accounts into the Income Summary account (39-9999)
 * for a fiscal year, then transfers the net income/loss from 39-9999
 * to Retained Earnings (33-1101 — กำไร(ขาดทุน)สุทธิประจำปี).
 *
 * Posts EXACTLY 3 JournalEntry rows, all linked through metadata.batchId:
 *
 *   Step 1 — Close revenue
 *     Dr 41-XXXX, 42-XXXX (each non-zero net)
 *       Cr 39-9999 Income Summary
 *
 *   Step 2 — Close expenses
 *     Dr 39-9999 Income Summary
 *       Cr 51-XXXX, 52-XXXX, 53-XXXX, 54-XXXX (each non-zero net)
 *
 *   Step 3 — Transfer to retained earnings
 *     If net income > 0:  Dr 39-9999 / Cr 33-1101 [netIncome]
 *     If net loss   < 0:  Dr 33-1101 / Cr 39-9999 [absLoss]
 *     If exactly 0:        no Step 3 emitted (returns step3 = null)
 *
 * Balances are computed from posted JournalLine rows whose JournalEntry.entryDate
 * falls in the Asia/Bangkok local year [Jan 1 00:00, Dec 31 23:59:59.999].
 *
 * Accounts with zero net (within 0.005 tolerance) are SKIPPED — no no-op lines.
 *
 * Idempotency: callers (AccountingClosingService.postYearEndClosing) are
 * responsible for checking that no prior YEAR_END_CLOSING JE exists for the
 * year. Template itself does not gate — wrap in $transaction so all 3 entries
 * commit together or roll back together.
 */
@Injectable()
export class YearEndClosingTemplate {
  private readonly logger = new Logger(YearEndClosingTemplate.name);

  // Income Summary + Retained Earnings codes (FINANCE chart)
  static readonly INCOME_SUMMARY_CODE = '39-9999';
  static readonly RETAINED_EARNINGS_CODE = '33-1101';
  static readonly REVENUE_PREFIXES = ['41', '42'] as const;
  static readonly EXPENSE_PREFIXES = ['51', '52', '53', '54'] as const;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Calculate Asia/Bangkok local-year boundary as UTC instants.
   * Jan 1, YYYY 00:00:00.000 BKK = Dec 31, YYYY-1 17:00 UTC
   * Dec 31, YYYY 23:59:59.999 BKK = Dec 31, YYYY 16:59:59.999 UTC
   * Bangkok is UTC+7 with no DST.
   */
  static bkkYearBounds(year: number): { start: Date; end: Date } {
    // 00:00 BKK = 17:00 prev day UTC
    const start = new Date(Date.UTC(year - 1, 11, 31, 17, 0, 0, 0));
    // 23:59:59.999 BKK = 16:59:59.999 same day UTC
    const end = new Date(Date.UTC(year, 11, 31, 16, 59, 59, 999));
    return { start, end };
  }

  /**
   * Compute net balance per account for the BKK year window.
   * Returns Map<accountCode, { name, netDr, netCr }> for accounts touched
   * by at least one POSTED JournalLine in window.
   */
  async getYearAccountActivity(
    year: number,
  ): Promise<{
    revenues: Array<{ code: string; name: string; balance: Prisma.Decimal }>;
    expenses: Array<{ code: string; name: string; balance: Prisma.Decimal }>;
    revenueTotal: Prisma.Decimal;
    expenseTotal: Prisma.Decimal;
    netIncome: Prisma.Decimal;
  }> {
    const { start, end } = YearEndClosingTemplate.bkkYearBounds(year);

    const lineSums = await this.prisma.journalLine.groupBy({
      by: ['accountCode'],
      where: {
        journalEntry: {
          status: 'POSTED',
          entryDate: { gte: start, lte: end },
          deletedAt: null,
        },
        deletedAt: null,
      },
      _sum: { debit: true, credit: true },
    });

    const codes = lineSums.map((r) => r.accountCode);
    const coa =
      codes.length > 0
        ? await this.prisma.chartOfAccount.findMany({
            where: { code: { in: codes }, deletedAt: null },
            select: { code: true, name: true },
          })
        : [];
    const nameMap = new Map(coa.map((c) => [c.code, c.name]));

    const revenues: Array<{ code: string; name: string; balance: Prisma.Decimal }> = [];
    const expenses: Array<{ code: string; name: string; balance: Prisma.Decimal }> = [];
    let revenueTotal = new Prisma.Decimal(0);
    let expenseTotal = new Prisma.Decimal(0);

    for (const row of lineSums) {
      const prefix = row.accountCode.slice(0, 2);
      const dr = new Prisma.Decimal((row._sum.debit ?? 0).toString());
      const cr = new Prisma.Decimal((row._sum.credit ?? 0).toString());
      const name = nameMap.get(row.accountCode) ?? row.accountCode;

      if ((YearEndClosingTemplate.REVENUE_PREFIXES as readonly string[]).includes(prefix)) {
        // Revenue is Cr-normal: net credit balance = cr - dr
        const balance = cr.sub(dr);
        if (!this.isEffectivelyZero(balance)) {
          revenues.push({ code: row.accountCode, name, balance });
          revenueTotal = revenueTotal.add(balance);
        }
      } else if ((YearEndClosingTemplate.EXPENSE_PREFIXES as readonly string[]).includes(prefix)) {
        // Expense is Dr-normal: net debit balance = dr - cr
        const balance = dr.sub(cr);
        if (!this.isEffectivelyZero(balance)) {
          expenses.push({ code: row.accountCode, name, balance });
          expenseTotal = expenseTotal.add(balance);
        }
      }
      // 55-XXXX or other prefixes (assets/liabilities/equity): skipped
    }

    revenues.sort((a, b) => a.code.localeCompare(b.code));
    expenses.sort((a, b) => a.code.localeCompare(b.code));

    return {
      revenues,
      expenses,
      revenueTotal,
      expenseTotal,
      netIncome: revenueTotal.sub(expenseTotal),
    };
  }

  private isEffectivelyZero(d: Prisma.Decimal): boolean {
    // <0.005 absolute is treated as zero (rounding noise below 0.01 cent)
    return d.abs().lessThan(new Prisma.Decimal('0.005'));
  }

  /**
   * Post the 3 closing JEs (step 1 + 2, plus step 3 if net != 0).
   * MUST be invoked from inside a $transaction by the caller, OR pass no
   * outerTx and the template will manage its own $transaction.
   */
  async execute(
    year: number,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{
    batchId: string;
    step1: { entryNo: string; journalEntryId: string };
    step2: { entryNo: string; journalEntryId: string };
    step3: { entryNo: string; journalEntryId: string } | null;
    netIncome: Prisma.Decimal;
    revenueTotal: Prisma.Decimal;
    expenseTotal: Prisma.Decimal;
  }> {
    const activity = await this.getYearAccountActivity(year);
    const { revenues, expenses, revenueTotal, expenseTotal, netIncome } = activity;

    if (revenues.length === 0 && expenses.length === 0) {
      throw new BadRequestException(
        `ปี ${year} ไม่มี Journal Entry รายได้/ค่าใช้จ่าย — ไม่จำเป็นต้องปิดบัญชี`,
      );
    }

    // postedAt = Dec 31 23:59:59.999 BKK — keeps year-end JE inside the year
    const { end: yearEndAt } = YearEndClosingTemplate.bkkYearBounds(year);
    const batchId = randomUUID();

    const ZERO = new Prisma.Decimal(0);
    const ISC = YearEndClosingTemplate.INCOME_SUMMARY_CODE;
    const REC = YearEndClosingTemplate.RETAINED_EARNINGS_CODE;

    const run = async (tx: Prisma.TransactionClient) => {
      // ── Step 1: Close revenue → 39-9999 ───────────────────────────────
      const step1Lines = revenues.map((r) => ({
        accountCode: r.code,
        dr: r.balance,
        cr: ZERO,
        description: `ปิดบัญชี ${r.name} ปี ${year}`,
      }));
      step1Lines.push({
        accountCode: ISC,
        dr: ZERO,
        cr: revenueTotal,
        description: `รวมรายได้เข้า Income Summary ปี ${year}`,
      });

      const step1 = await this.journal.createAndPost(
        {
          description: `ปิดบัญชีรายได้ ปี ${year}`,
          reference: `${year}:year-end-closing:step1`,
          postedAt: yearEndAt,
          metadata: {
            flow: 'year-end-closing',
            year,
            step: 1,
            batchId,
            tag: 'YEAR_END_CLOSING',
          },
          lines: step1Lines,
        },
        tx,
      );

      // ── Step 2: Close expenses ← 39-9999 ──────────────────────────────
      const step2Lines: {
        accountCode: string;
        dr: Prisma.Decimal;
        cr: Prisma.Decimal;
        description: string;
      }[] = [
        {
          accountCode: ISC,
          dr: expenseTotal,
          cr: ZERO,
          description: `รวมค่าใช้จ่ายจาก Income Summary ปี ${year}`,
        },
        ...expenses.map((e) => ({
          accountCode: e.code,
          dr: ZERO,
          cr: e.balance,
          description: `ปิดบัญชี ${e.name} ปี ${year}`,
        })),
      ];

      const step2 = await this.journal.createAndPost(
        {
          description: `ปิดบัญชีค่าใช้จ่าย ปี ${year}`,
          reference: `${year}:year-end-closing:step2`,
          postedAt: yearEndAt,
          metadata: {
            flow: 'year-end-closing',
            year,
            step: 2,
            batchId,
            tag: 'YEAR_END_CLOSING',
          },
          lines: step2Lines,
        },
        tx,
      );

      // ── Step 3: Transfer net to 33-1101 (skip if exactly zero) ────────
      let step3: { entryNo: string; journalEntryId: string } | null = null;

      if (!this.isEffectivelyZero(netIncome)) {
        const isProfit = netIncome.gt(0);
        const absAmount = netIncome.abs();

        const step3Lines = isProfit
          ? [
              {
                accountCode: ISC,
                dr: absAmount,
                cr: ZERO,
                description: `โอนกำไรสุทธิเข้า กำไรสะสม ปี ${year}`,
              },
              {
                accountCode: REC,
                dr: ZERO,
                cr: absAmount,
                description: `กำไรสุทธิประจำปี ${year}`,
              },
            ]
          : [
              {
                accountCode: REC,
                dr: absAmount,
                cr: ZERO,
                description: `รับโอนขาดทุนสุทธิประจำปี ${year}`,
              },
              {
                accountCode: ISC,
                dr: ZERO,
                cr: absAmount,
                description: `โอนขาดทุนสุทธิจาก Income Summary ปี ${year}`,
              },
            ];

        const step3Result = await this.journal.createAndPost(
          {
            description: isProfit
              ? `โอนกำไรสุทธิเข้ากำไรสะสม ปี ${year}`
              : `โอนขาดทุนสุทธิเข้ากำไรสะสม ปี ${year}`,
            reference: `${year}:year-end-closing:step3`,
            postedAt: yearEndAt,
            metadata: {
              flow: 'year-end-closing',
              year,
              step: 3,
              batchId,
              tag: 'YEAR_END_CLOSING',
              netIncome: netIncome.toFixed(2),
            },
            lines: step3Lines,
          },
          tx,
        );

        step3 = {
          entryNo: step3Result.entryNumber,
          journalEntryId: step3Result.id,
        };
      }

      return {
        batchId,
        step1: { entryNo: step1.entryNumber, journalEntryId: step1.id },
        step2: { entryNo: step2.entryNumber, journalEntryId: step2.id },
        step3,
        netIncome,
        revenueTotal,
        expenseTotal,
      };
    };

    const out = outerTx ? await run(outerTx) : await this.prisma.$transaction(run);

    this.logger.log(
      `YearEndClosingTemplate posted batch ${batchId} for ${year}: ` +
        `step1=${out.step1.entryNo} step2=${out.step2.entryNo} ` +
        `step3=${out.step3?.entryNo ?? '(none — net=0)'} ` +
        `netIncome=${out.netIncome.toFixed(2)}`,
    );

    return out;
  }
}
