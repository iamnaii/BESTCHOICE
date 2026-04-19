import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Raw line parsed from a bank statement (CSV / API). Source-format-specific
 * parsers (Kasikorn / SCB / Bangkok Bank) must normalise into this shape
 * before calling the reconciliation service.
 */
export interface BankLine {
  amount: number;           // THB, positive for credits (incoming transfers)
  valueDate: Date;          // Date the bank posted the transaction
  reference?: string | null; // Bank's transaction reference (varies by bank)
  description?: string | null;
}

export type BankLineMatchStatus =
  | 'MATCHED'           // single unambiguous payment row matches
  | 'UNMATCHED'         // no payment row matches this bank line
  | 'AMBIGUOUS'         // more than one payment matches — needs human review
  | 'AMOUNT_MISMATCH'   // reference matches but amount differs > tolerance
  | 'DUPLICATE';        // bank reference seen twice in the same file

export interface MatchedBankLine {
  line: BankLine;
  status: BankLineMatchStatus;
  paymentId?: string | null;
  reason?: string;
}

export interface ReconciliationSummary {
  totalLines: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  amountMismatches: number;
  duplicates: number;
  unmatchedAmount: number;
  details: MatchedBankLine[];
}

/**
 * T1-C3 — Bank reconciliation core.
 *
 * Detects:
 *   - Payments recorded in our DB but missing from the bank statement
 *     (potential cash skim — we think the customer paid but the bank
 *      never saw the money)
 *   - Bank credits that don't map to a Payment row (orphan deposit — may
 *     indicate a miskeyed record or a customer paying the wrong account)
 *   - Duplicate references within the same statement file (bank issue or
 *     accidental re-import)
 *
 * This file contains the matching logic only. The CSV parser + daily cron
 * are tracked separately and will call `reconcileLines` once the raw lines
 * are normalised to `BankLine[]`.
 */
@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger(BankReconciliationService.name);
  /** Satang-level tolerance — payments recorded in different currency code
   *  precision occasionally differ by a single satang. 0.50฿ is generous. */
  static readonly AMOUNT_TOLERANCE_BAHT = 0.5;
  /** Alert the team when the unmatched daily total exceeds this amount. */
  static readonly UNMATCHED_ALERT_THRESHOLD_BAHT = 100;
  /** Bank value-date vs our paidDate may differ by ≤ 2 days (weekends +
   *  bank settlement). Anything further usually means a different tx. */
  static readonly DATE_TOLERANCE_DAYS = 2;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Match a set of bank lines against our Payment records. Does NOT
   * persist anything — callers handle follow-up writes (marking payments
   * reconciled, opening investigation tasks, etc.).
   */
  async reconcileLines(lines: BankLine[], userId: string): Promise<ReconciliationSummary> {
    if (lines.length === 0) {
      return this.emptySummary();
    }

    // Detect duplicate references inside the imported file first. A bank
    // shouldn't emit the same reference twice, but some re-imports have
    // caused double-credit bugs in the past.
    const refCounts = new Map<string, number>();
    for (const l of lines) {
      if (l.reference) {
        refCounts.set(l.reference, (refCounts.get(l.reference) ?? 0) + 1);
      }
    }

    // Fetch candidate payments once. We narrow by the date window of the
    // import so the query stays bounded even with years of history.
    const dateMin = new Date(Math.min(...lines.map((l) => l.valueDate.getTime())));
    dateMin.setDate(dateMin.getDate() - BankReconciliationService.DATE_TOLERANCE_DAYS);
    const dateMax = new Date(Math.max(...lines.map((l) => l.valueDate.getTime())));
    dateMax.setDate(dateMax.getDate() + BankReconciliationService.DATE_TOLERANCE_DAYS);

    const candidatePayments = await this.prisma.payment.findMany({
      where: {
        deletedAt: null,
        paidDate: { gte: dateMin, lte: dateMax },
        status: { in: ['PAID', 'PARTIALLY_PAID'] },
      },
      select: {
        id: true,
        amountPaid: true,
        paidDate: true,
        gatewayRef: true,
        paymentMethod: true,
      },
    });

    const details: MatchedBankLine[] = lines.map((line) => {
      if (line.reference && (refCounts.get(line.reference) ?? 0) > 1) {
        return {
          line,
          status: 'DUPLICATE',
          reason: `reference ${line.reference} repeats in this file`,
        };
      }

      const candidates = candidatePayments.filter(
        (p) =>
          p.paidDate !== null &&
          this.amountMatches(Number(p.amountPaid), line.amount) &&
          this.dateMatches(p.paidDate, line.valueDate),
      );

      // Prefer exact gatewayRef match when available
      let winner: typeof candidates[number] | undefined;
      if (line.reference) {
        winner = candidates.find((p) => p.gatewayRef === line.reference);
        if (!winner) {
          const refMatchNoAmount = candidatePayments.find(
            (p) => p.gatewayRef === line.reference,
          );
          if (
            refMatchNoAmount &&
            !this.amountMatches(Number(refMatchNoAmount.amountPaid), line.amount)
          ) {
            return {
              line,
              status: 'AMOUNT_MISMATCH',
              paymentId: refMatchNoAmount.id,
              reason: `ref matched but amount ${refMatchNoAmount.amountPaid} vs ${line.amount}`,
            };
          }
        }
      }
      if (!winner && candidates.length === 1) {
        winner = candidates[0];
      }

      if (winner) {
        return { line, status: 'MATCHED', paymentId: winner.id };
      }
      if (candidates.length > 1) {
        return {
          line,
          status: 'AMBIGUOUS',
          reason: `${candidates.length} candidate payments match amount+date`,
        };
      }
      return { line, status: 'UNMATCHED' };
    });

    const summary: ReconciliationSummary = {
      totalLines: details.length,
      matched: details.filter((d) => d.status === 'MATCHED').length,
      unmatched: details.filter((d) => d.status === 'UNMATCHED').length,
      ambiguous: details.filter((d) => d.status === 'AMBIGUOUS').length,
      amountMismatches: details.filter((d) => d.status === 'AMOUNT_MISMATCH').length,
      duplicates: details.filter((d) => d.status === 'DUPLICATE').length,
      unmatchedAmount: details
        .filter(
          (d) =>
            d.status === 'UNMATCHED' ||
            d.status === 'AMOUNT_MISMATCH' ||
            d.status === 'DUPLICATE',
        )
        .reduce((sum, d) => sum + d.line.amount, 0),
      details,
    };

    this.logger.log(
      `Bank reconciliation by ${userId}: ${summary.matched}/${summary.totalLines} matched, ` +
        `unmatched total ${summary.unmatchedAmount.toFixed(2)}฿`,
    );

    if (summary.unmatchedAmount > BankReconciliationService.UNMATCHED_ALERT_THRESHOLD_BAHT) {
      Sentry.captureMessage(
        `Bank reconciliation mismatch exceeds threshold: ${summary.unmatchedAmount.toFixed(2)}฿`,
        {
          level: 'warning',
          tags: { kind: 'bank-reconciliation' },
          extra: {
            userId,
            unmatched: summary.unmatched,
            ambiguous: summary.ambiguous,
            amountMismatches: summary.amountMismatches,
            duplicates: summary.duplicates,
          },
        },
      );
    }

    return summary;
  }

  private amountMatches(a: number, b: number): boolean {
    return Math.abs(a - b) <= BankReconciliationService.AMOUNT_TOLERANCE_BAHT;
  }

  private dateMatches(a: Date, b: Date): boolean {
    const diffMs = Math.abs(a.getTime() - b.getTime());
    const diffDays = diffMs / 86_400_000;
    return diffDays <= BankReconciliationService.DATE_TOLERANCE_DAYS;
  }

  private emptySummary(): ReconciliationSummary {
    return {
      totalLines: 0,
      matched: 0,
      unmatched: 0,
      ambiguous: 0,
      amountMismatches: 0,
      duplicates: 0,
      unmatchedAmount: 0,
      details: [],
    };
  }
}
