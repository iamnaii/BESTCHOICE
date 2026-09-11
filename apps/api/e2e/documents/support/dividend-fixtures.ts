import { Prisma } from '@prisma/client';
import { ExpectedJournalLine, sortJournalLines } from './other-income-fixtures';

/**
 * DOC-08 (issue #1567) domain fixtures — the independent model of a dividend
 * payment's withholding tax, the journal the equity builder must book for a
 * declaration / payment, and the per-shareholder register a year of payments
 * must add up to.
 *
 * Tax rule mirrored here is the system's own policy: ม.50(2) 10% on dividends
 * paid to individuals (and to foreign juristic recipients by default), nothing
 * withheld from a Thai juristic recipient (ม.65 ทวิ(10)), half-up to satang.
 */

const D = Prisma.Decimal;
const ZERO = new D(0);
const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type ShareholderKind = 'INDIVIDUAL' | 'JURISTIC_TH' | 'JURISTIC_FOREIGN';

export const RETAINED_EARNINGS = '32-1101';
export const DIVIDEND_PAYABLE = '21-4104';
export const WHT_DIVIDEND = '21-3104';

export interface DividendLineSpec {
  shareholderId: string;
  type: ShareholderKind;
  amount: number;
  /** Explicit withholding — otherwise the default rate for the recipient type applies. */
  wht?: number;
}

export function dividendWht(type: ShareholderKind, amount: number, override?: number): Prisma.Decimal {
  if (override != null) return new D(override);
  if (type === 'JURISTIC_TH') return ZERO;
  return round2(new D(amount).times('0.10'));
}

export function dividendTotals(lines: DividendLineSpec[]) {
  const gross = lines.reduce((sum, line) => sum.plus(line.amount), ZERO);
  const wht = lines.reduce((sum, line) => sum.plus(dividendWht(line.type, line.amount, line.wht)), ZERO);
  return { gross, wht, net: gross.minus(wht) };
}

/** Dr retained earnings / Cr dividend payable for the declared total. */
export function expectedDeclarationJournal(lines: DividendLineSpec[]): ExpectedJournalLine[] {
  const { gross } = dividendTotals(lines);
  return sortJournalLines([
    { accountCode: RETAINED_EARNINGS, debit: gross.toFixed(2), credit: '0.00' },
    { accountCode: DIVIDEND_PAYABLE, debit: '0.00', credit: gross.toFixed(2) },
  ]);
}

/** Dr dividend payable (gross) / Cr cash or bank (net) / Cr ภ.ง.ด.2 payable (withheld, when any). */
export function expectedPaymentJournal(lines: DividendLineSpec[], paymentAccountCode: string): ExpectedJournalLine[] {
  const { gross, wht, net } = dividendTotals(lines);
  const journal: ExpectedJournalLine[] = [
    { accountCode: DIVIDEND_PAYABLE, debit: gross.toFixed(2), credit: '0.00' },
    { accountCode: paymentAccountCode, debit: '0.00', credit: net.toFixed(2) },
  ];
  if (wht.gt(0)) journal.push({ accountCode: WHT_DIVIDEND, debit: '0.00', credit: wht.toFixed(2) });
  return sortJournalLines(journal);
}

export interface RegisterRowExpectation { payCount: number; gross: string; wht: string; net: string; docNumbers: string[] }

/** One register row per shareholder over the POSTED payments of a year (a reversed payment is simply left out). */
export function dividendRegisterExpectation(payments: Array<{ docNumber: string; lines: DividendLineSpec[] }>): Record<string, RegisterRowExpectation> {
  const rows: Record<string, { payCount: number; gross: Prisma.Decimal; wht: Prisma.Decimal; docNumbers: string[] }> = {};
  for (const payment of payments) {
    for (const line of payment.lines) {
      const row = (rows[line.shareholderId] ??= { payCount: 0, gross: ZERO, wht: ZERO, docNumbers: [] });
      row.payCount += 1;
      row.gross = row.gross.plus(line.amount);
      row.wht = row.wht.plus(dividendWht(line.type, line.amount, line.wht));
      row.docNumbers.push(payment.docNumber);
    }
  }
  return Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, { payCount: row.payCount, gross: row.gross.toFixed(2), wht: row.wht.toFixed(2), net: row.gross.minus(row.wht).toFixed(2), docNumbers: [...row.docNumbers].sort() }]));
}

export const EQUITY_MAKER_CHECKER_KEY = 'EQUITY_MAKER_CHECKER_ENABLED';
