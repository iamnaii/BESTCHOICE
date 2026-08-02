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
 * Posts UP TO 4 JournalEntry rows, all linked through metadata.batchId:
 *
 *   Step 1 — Close revenue
 *     Dr 41-XXXX, 42-XXXX (each non-zero net)
 *       Cr 39-9999 Income Summary
 *
 *   Step 2 — Close expenses
 *     Dr 39-9999 Income Summary
 *       Cr 51-XXXX, 52-XXXX, 53-XXXX, 54-XXXX (each non-zero net)
 *
 *   Step 3 — Transfer to retained earnings (current year)
 *     If net income > 0:  Dr 39-9999 / Cr 33-1101 [netIncome]
 *     If net loss   < 0:  Dr 33-1101 / Cr 39-9999 [absLoss]
 *     If exactly 0:        no Step 3 emitted (returns step3 = null)
 *
 *   Step 4 — Sweep 33-1101 into 32-1101 (CPA CSV instruction, C3 owner
 *   approval 2026-08-01 — finance-coa.csv:80,82: 33-1101 "กำไรปีปัจจุบัน —
 *   ปิดเข้า 32-1101 สิ้นปี", 32-1101 "ยกยอดจากปีก่อน ปิดบัญชีเข้านี้สิ้นปี").
 *     Reads the LIVE GL balance of 33-1101 (not just `netIncome` passed
 *     through from Step 3) so any PRIOR-YEAR residue already sitting in
 *     33-1101 (e.g. an earlier year closed before this Step existed, or a
 *     manual correcting JE) also sweeps into 32-1101 — not only this year's
 *     net. Read AFTER Step 3 has been posted, inside the SAME $transaction,
 *     so it picks up Step 3's own contribution for free (Postgres sees a
 *     transaction's own uncommitted writes in later statements of that same
 *     transaction) instead of re-deriving `priorBalance + netIncome`
 *     independently, which could drift from the ledger.
 *     If GL balance (Cr-normal) > 0:  Dr 33-1101 / Cr 32-1101 [balance]
 *     If GL balance (Dr-normal) < 0:  Dr 32-1101 / Cr 33-1101 [|balance|]
 *     If effectively 0 (< 0.005):      no Step 4 emitted (returns step4 = null)
 *
 * Balances for Steps 1-3 are computed from posted JournalLine rows whose
 * JournalEntry.entryDate falls in the Asia/Bangkok local year [Jan 1 00:00,
 * Dec 31 23:59:59.999]. Step 4's GL balance is NOT year-scoped — 33-1101 is
 * a carry-forward equity account, so its live balance may include activity
 * from before the year window (that's the whole point of the residue-sweep).
 *
 * Accounts with zero net (within 0.005 tolerance) are SKIPPED — no no-op lines.
 *
 * Idempotency: callers (AccountingClosingService.postYearEndClosing) are
 * responsible for checking that no prior YEAR_END_CLOSING JE exists for the
 * year. Template itself does not gate — wrap in $transaction so all entries
 * commit together or roll back together.
 */
@Injectable()
export class YearEndClosingTemplate {
  private readonly logger = new Logger(YearEndClosingTemplate.name);

  // Income Summary + Retained Earnings codes (FINANCE chart)
  static readonly INCOME_SUMMARY_CODE = '39-9999';
  static readonly RETAINED_EARNINGS_CODE = '33-1101'; // กำไร(ขาดทุน)สุทธิประจำปี (current year)
  static readonly RETAINED_EARNINGS_ACCUM_CODE = '32-1101'; // กำไร(ขาดทุน)สะสม (accumulated)
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
   * Live GL balance (Cr-normal) for a single equity account — the TRUE
   * current running balance, summed across ALL POSTED JournalLine rows for
   * that account code with NO date restriction. NOT year-scoped, because
   * 33-1101/32-1101 are carry-forward equity accounts (unlike the
   * year-windowed revenue/expense query in `getYearAccountActivity`). Used
   * by Step 4 to sweep whatever is ACTUALLY sitting in 33-1101 (including
   * prior-year residue), not a separately re-derived
   * `priorBalance + netIncome` figure.
   *
   * Mirrors the style of the contract-scoped `glContractBalance` helper
   * (`apps/api/src/modules/journal/gl-contract-balance.ts`) — findMany +
   * manual sum rather than `groupBy`/`aggregate`, AND no date parameter, for
   * the same reason `glContractBalance` has none: a POSTED JournalLine is
   * permanent, so "the balance" is unambiguous without a cutoff.
   *
   * An earlier revision of this method took an `asOf` cutoff (filtering
   * `entryDate <= asOf`, meant to be `yearEndAt`). That broke the
   * reverse→re-close escape hatch: `reverseYearEndClosing` posts its mirror
   * JEs dated TODAY (real wall-clock time), which is always AFTER the
   * closed year's Dec 31 — so an `asOf = yearEndAt` cutoff silently EXCLUDED
   * the reversal from Step 4's balance on the next close, underswept
   * 33-1101, and left a stale residue behind. Discovered via the real-DB
   * integration spec `year-end-step4.spec.ts` (review W2, reverse→correct→
   * re-close scenario). Since Step 4 always runs inside the SAME
   * transaction right after Step 3 posts, "the current balance" (no
   * date filter) is exactly what we want — this is the "as of right now"
   * reading, not "as of some past instant".
   *
   * PUBLIC (not just an `execute()` internal): `AccountingClosingService.
   * previewYearEndClosing` also calls this — passing the root `PrismaService`
   * (no tx, since preview never posts) — to project what Step 4 WOULD sweep
   * before the user commits to `postYearEndClosing`. Without this, preview
   * would under-report `totalSteps` whenever 33-1101 already carries residue,
   * and Step 4 would post as an unannounced surprise (review W1).
   */
  async getEquityAccountBalance(
    client: Prisma.TransactionClient | PrismaService,
    accountCode: string,
  ): Promise<Prisma.Decimal> {
    const lines = await client.journalLine.findMany({
      where: {
        accountCode,
        journalEntry: { status: 'POSTED', deletedAt: null },
        deletedAt: null,
      },
      select: { debit: true, credit: true },
    });
    let bal = new Prisma.Decimal(0);
    for (const l of lines) {
      bal = bal.add(l.credit.toString()).sub(l.debit.toString());
    }
    return bal;
  }

  /**
   * Post the closing JEs (step 1 + 2, plus step 3 if net != 0, plus step 4
   * if the LIVE 33-1101 GL balance is non-zero after step 3).
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
    step4: { entryNo: string; journalEntryId: string } | null;
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
      //
      // Revenue is Cr-normal. Closing entry Dr's the revenue account to
      // zero it out, Cr's Income Summary by the same total.
      //
      // If a revenue account ends the year with a NET DEBIT balance (e.g.
      // refunds exceed sales), `balance` from getYearAccountActivity is
      // negative. Posting `dr: <negative>` is mathematically balanced but
      // not standard accounting practice — we flip the side so a negative
      // revenue posts as `Cr <abs>` on the revenue account (effectively
      // unwinding the abnormal Dr balance). The matching Income Summary
      // contribution flips too, but the net impact on the ISC side is
      // already captured in `revenueTotal` (it nets the negatives), so
      // the contra line stays uniform on the Cr side.
      const step1Lines = revenues.map((r) => {
        const isAbnormal = r.balance.isNegative();
        return {
          accountCode: r.code,
          dr: isAbnormal ? ZERO : r.balance,
          cr: isAbnormal ? r.balance.abs() : ZERO,
          description: `ปิดบัญชี ${r.name} ปี ${year}`,
        };
      });
      // Revenue contra into Income Summary. `revenueTotal` already nets
      // any negative balances. If the overall net is negative (highly
      // unusual — all revenue accounts net-debit), post the opposite side.
      const revenueTotalAbnormal = revenueTotal.isNegative();
      step1Lines.push({
        accountCode: ISC,
        dr: revenueTotalAbnormal ? revenueTotal.abs() : ZERO,
        cr: revenueTotalAbnormal ? ZERO : revenueTotal,
        description: `รวมรายได้เข้า Income Summary ปี ${year}`,
      });

      const step1 = await this.journal.createAndPost(
        {
          description: `ปิดบัญชีรายได้ ปี ${year}`,
          // `batchId` suffix (not just `${year}:...:step1`) is REQUIRED for the
          // reverse→re-close escape hatch to work at all: `reference` maps to
          // `referenceId`, which carries a partial UNIQUE index
          // (`journal_entries_ref_unique`, scoped `WHERE deleted_at IS NULL`).
          // Reversal does NOT soft-delete the original entries (by design —
          // they stay POSTED for audit trail), so a re-close for the SAME
          // year would try to reuse the exact same reference string and hit
          // that unique constraint. Discovered via the real-DB integration
          // spec `year-end-step4.spec.ts` (review W2) — re-close had never
          // been exercised against a real Postgres instance before.
          reference: `${year}:year-end-closing:step1:${batchId}`,
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
      //
      // Expense is Dr-normal. Closing entry Cr's the expense account to
      // zero it out, Dr's Income Summary by the same total.
      //
      // If an expense account ends the year with a NET CREDIT (e.g.
      // refunds/recoveries exceed billed expense), `balance` is negative.
      // We flip the side: post `Dr <abs>` on the expense account to
      // unwind the abnormal Cr position, with matching adjustment on ISC.
      const expenseTotalAbnormal = expenseTotal.isNegative();
      const step2Lines: {
        accountCode: string;
        dr: Prisma.Decimal;
        cr: Prisma.Decimal;
        description: string;
      }[] = [
        {
          accountCode: ISC,
          dr: expenseTotalAbnormal ? ZERO : expenseTotal,
          cr: expenseTotalAbnormal ? expenseTotal.abs() : ZERO,
          description: `รวมค่าใช้จ่ายจาก Income Summary ปี ${year}`,
        },
        ...expenses.map((e) => {
          const isAbnormal = e.balance.isNegative();
          return {
            accountCode: e.code,
            dr: isAbnormal ? e.balance.abs() : ZERO,
            cr: isAbnormal ? ZERO : e.balance,
            description: `ปิดบัญชี ${e.name} ปี ${year}`,
          };
        }),
      ];

      const step2 = await this.journal.createAndPost(
        {
          description: `ปิดบัญชีค่าใช้จ่าย ปี ${year}`,
          // batchId suffix — see step1's comment above (unique-index / re-close fix).
          reference: `${year}:year-end-closing:step2:${batchId}`,
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
            // batchId suffix — see step1's comment above (unique-index / re-close fix).
            reference: `${year}:year-end-closing:step3:${batchId}`,
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

      // ── Step 4: Sweep 33-1101 → 32-1101 (skip if effectively zero) ────
      //
      // GL-BASED, not a plain `netIncome` pass-through: read the LIVE
      // (no date cutoff — see `getEquityAccountBalance` jsdoc) balance of
      // 33-1101 AFTER step 3 has been posted, inside this same
      // $transaction. Postgres statements within one transaction see that
      // transaction's own earlier (uncommitted) writes, so this picks up
      // step 3's contribution automatically — and, because the query has NO
      // date restriction at all, it ALSO picks up any prior-year residue
      // that was never swept (e.g. a year closed before Step 4 existed) AND
      // any reversal of a PRIOR closing attempt for this same year (which
      // posts dated today, not Dec 31 — an `entryDate <= yearEndAt` cutoff
      // would have silently excluded it; see the jsdoc history above). That
      // is the entire point of reading the ledger here instead of computing
      // `priorBalance + netIncome` as two independently-tracked numbers
      // that could drift apart.
      const balance33 = await this.getEquityAccountBalance(tx, REC);
      const REAC = YearEndClosingTemplate.RETAINED_EARNINGS_ACCUM_CODE;
      let step4: { entryNo: string; journalEntryId: string } | null = null;

      if (!this.isEffectivelyZero(balance33)) {
        const isCrBalance = balance33.gt(0); // Cr-normal 33-1101: positive = กำไร
        const absAmount = balance33.abs();

        const step4Lines = isCrBalance
          ? [
              {
                accountCode: REC,
                dr: absAmount,
                cr: ZERO,
                description: `ปิดกำไร(ขาดทุน)สุทธิประจำปี เข้ากำไรสะสม ปี ${year} (Step 4)`,
              },
              {
                accountCode: REAC,
                dr: ZERO,
                cr: absAmount,
                description: `ปิดกำไร(ขาดทุน)สุทธิประจำปี เข้ากำไรสะสม ปี ${year} (Step 4)`,
              },
            ]
          : [
              {
                accountCode: REAC,
                dr: absAmount,
                cr: ZERO,
                description: `ปิดกำไร(ขาดทุน)สุทธิประจำปี เข้ากำไรสะสม ปี ${year} (Step 4)`,
              },
              {
                accountCode: REC,
                dr: ZERO,
                cr: absAmount,
                description: `ปิดกำไร(ขาดทุน)สุทธิประจำปี เข้ากำไรสะสม ปี ${year} (Step 4)`,
              },
            ];

        const step4Result = await this.journal.createAndPost(
          {
            description: 'ปิดกำไร(ขาดทุน)สุทธิประจำปี เข้ากำไรสะสม (Step 4)',
            // batchId suffix — see step1's comment above (unique-index / re-close fix).
            reference: `${year}:year-end-closing:step4:${batchId}`,
            postedAt: yearEndAt,
            metadata: {
              flow: 'year-end-closing',
              year,
              step: 4,
              batchId,
              tag: 'YEAR_END_CLOSING',
              sweptBalance: balance33.toFixed(2),
            },
            lines: step4Lines,
          },
          tx,
        );

        step4 = {
          entryNo: step4Result.entryNumber,
          journalEntryId: step4Result.id,
        };
      }

      return {
        batchId,
        step1: { entryNo: step1.entryNumber, journalEntryId: step1.id },
        step2: { entryNo: step2.entryNumber, journalEntryId: step2.id },
        step3,
        step4,
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
        `step4=${out.step4?.entryNo ?? '(none — 33-1101 balance=0)'} ` +
        `netIncome=${out.netIncome.toFixed(2)}`,
    );

    return out;
  }
}
