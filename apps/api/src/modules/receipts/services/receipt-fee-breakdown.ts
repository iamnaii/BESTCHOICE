import { Prisma, Receipt } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';

type ReceiptFeeSource = Pick<Receipt,
  'id' | 'paymentId' | 'contractId' | 'receiptType' | 'amount' | 'paidDate' |
  'isVoided' | 'sourceJournalEntryId'>;

export interface ReceiptFeeBreakdown {
  /** Actual net fee collected by this receipt, excluding its waiver. */
  lateFeeCollected: string | null;
  lateFeeWaivedThisReceipt: string | null;
  /** Prevent a cumulative Payment fee being assigned to an unknown sibling. */
  hasReceiptFeeHistory: boolean;
}

const moneyTypes: readonly string[] = INSTALLMENT_MONEY_RECEIPT_TYPES;
const businessDate = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(date);
const metadataObject = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const decimal = (value: unknown): Prisma.Decimal | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const result = new Prisma.Decimal(value);
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
};

/**
 * Read the immutable receipt JE, never the mutable cumulative Payment.lateFee.
 * Old rows without a source link are matched only when payment + cash delta +
 * Bangkok paid day identify exactly one receipt AND exactly one forward JE.
 * Missing/ambiguous history remains null; no positional matching or backfill.
 */
export async function attachReceiptFeeBreakdowns<T extends ReceiptFeeSource>(
  prisma: PrismaService,
  receipts: T[],
): Promise<Array<T & ReceiptFeeBreakdown>> {
  const eligible = receipts.filter((r) => r.paymentId && moneyTypes.includes(r.receiptType));
  const paymentIds = [...new Set(eligible.map((r) => r.paymentId!))];
  const byId = new Map<string, Omit<ReceiptFeeBreakdown, 'hasReceiptFeeHistory'>>();
  const paymentsWithHistory = new Set<string>();
  if (paymentIds.length) {
    // Include every sibling, even when the caller requested a single receipt
    // or a paginated list: otherwise a repeated amount would look unique.
    const siblings = await prisma.receipt.findMany({
      where: {
        paymentId: { in: paymentIds },
        receiptType: { in: [...INSTALLMENT_MONEY_RECEIPT_TYPES] },
        deletedAt: null,
      },
      select: {
        id: true, paymentId: true, contractId: true, receiptType: true,
        amount: true, paidDate: true, isVoided: true, sourceJournalEntryId: true,
      },
    });
    const sourceIds = siblings.flatMap((r) => r.sourceJournalEntryId ? [r.sourceJournalEntryId] : []);
    const entries = await prisma.journalEntry.findMany({
      where: {
        status: 'POSTED', deletedAt: null,
        OR: [
          ...(sourceIds.length ? [{ id: { in: sourceIds } }] : []),
          ...paymentIds.map((paymentId) => ({ metadata: { path: ['paymentId'], equals: paymentId } })),
        ],
      },
      select: {
        id: true, postedAt: true, metadata: true,
        lines: { where: { deletedAt: null }, select: { accountCode: true, debit: true, credit: true } },
      },
    });
    const forwardEntries = entries.filter((entry) => {
      const meta = metadataObject(entry.metadata);
      return (meta.tag === 'receipt' || meta.tag === '2B') && !meta.originalEntryId;
    });
    const samePayment = (receipt: ReceiptFeeSource, entry: typeof entries[number]) => {
      const meta = metadataObject(entry.metadata);
      return meta.paymentId === receipt.paymentId && meta.contractId === receipt.contractId;
    };
    const attribute = (receipt: ReceiptFeeSource, entry: typeof entries[number]) => {
      const sum = (account: string, side: 'debit' | 'credit') => entry.lines
        .filter((line) => line.accountCode === account)
        .reduce((total, line) => total.plus(line[side]), new Prisma.Decimal(0));
      const gross = sum('42-1103', 'credit');
      const waived = sum('52-1105', 'debit');
      const collected = gross.minus(waived);
      if (collected.lt(0) || waived.lt(0)) return;
      byId.set(receipt.id, {
        lateFeeCollected: collected.toFixed(2),
        lateFeeWaivedThisReceipt: waived.toFixed(2),
      });
      paymentsWithHistory.add(receipt.paymentId!);
    };
    // A linked JE cannot be borrowed by an unlinked legacy receipt.
    const reservedIds = new Set(sourceIds);
    for (const receipt of siblings) {
      if (!receipt.sourceJournalEntryId) continue;
      const entry = forwardEntries.find((e) =>
        e.id === receipt.sourceJournalEntryId && samePayment(receipt, e));
      // Duplicate explicit links are corrupt history, not two fee collections.
      if (entry && siblings.filter((r) => r.sourceJournalEntryId === entry.id).length === 1) {
        attribute(receipt, entry);
      }
    }
    const unlinked = siblings.filter((r) => !r.sourceJournalEntryId);
    const candidates = new Map<string, typeof entries>();
    for (const receipt of unlinked) {
      candidates.set(receipt.id, forwardEntries.filter((entry) => {
        const meta = metadataObject(entry.metadata);
        const delta = decimal(meta.deltaApplied);
        return !reservedIds.has(entry.id) && samePayment(receipt, entry) &&
          (meta.reversed === true) === receipt.isVoided && delta?.eq(receipt.amount) &&
          entry.postedAt != null && businessDate(entry.postedAt) === businessDate(receipt.paidDate);
      }));
    }
    for (const receipt of unlinked) {
      const matches = candidates.get(receipt.id)!;
      if (matches.length !== 1) continue;
      const entry = matches[0];
      const matchingReceiptCount = [...candidates.values()]
        .filter((group) => group.some((candidate) => candidate.id === entry.id)).length;
      if (matchingReceiptCount === 1) attribute(receipt, entry);
    }
  }
  return receipts.map((receipt) => ({
    ...receipt,
    ...(byId.get(receipt.id) ?? { lateFeeCollected: null, lateFeeWaivedThisReceipt: null }),
    hasReceiptFeeHistory: !!receipt.paymentId && paymentsWithHistory.has(receipt.paymentId),
  }));
}
