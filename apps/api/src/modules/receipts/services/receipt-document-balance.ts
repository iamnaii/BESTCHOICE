import { Prisma, Receipt } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  computeInstallmentBreakdown,
  InstallmentBreakdownInput,
} from '../../journal/compute-installment-breakdown';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';

type Client = PrismaService | Prisma.TransactionClient;
type Source = Pick<
  Receipt,
  'id' | 'contractId' | 'receiptType' | 'createdAt' | 'installmentNo' | 'remainingMonths'
>;
export interface ReceiptDocumentBalance {
  /** Gross installment debt less unapplied customer funds, at issuance; excludes late fees. */
  documentRemainingBalance: string | null;
  documentRemainingMonths: number | null;
  documentInstallmentAmountDue: string | null;
  documentInstallmentAmountPaid: string | null;
}
const unknownBalance: ReceiptDocumentBalance = {
  documentRemainingBalance: null,
  documentRemainingMonths: null,
  documentInstallmentAmountDue: null,
  documentInstallmentAmountPaid: null,
};
const sourceTypes = [...INSTALLMENT_MONEY_RECEIPT_TYPES, 'RESCHEDULE_FEE'];
export const RECEIPT_DOCUMENT_BALANCE_ACTION = 'RECEIPT_DOCUMENT_BALANCE_V1';

/** One atomic receipt + document snapshot write; unknown is a value, not a cache miss. */
export async function persistReceiptDocumentBalance(
  tx: Prisma.TransactionClient,
  receipt: Source,
  balance: ReceiptDocumentBalance,
  issuedById: string,
  totalMonths: number,
): Promise<void> {
  if (!sourceTypes.includes(receipt.receiptType)) return;
  await tx.auditLog.create({
    data: {
      userId: issuedById,
      action: RECEIPT_DOCUMENT_BALANCE_ACTION,
      entity: 'receipt',
      entityId: receipt.id,
      newValue: {
        version: 1,
        receiptId: receipt.id,
        contractId: receipt.contractId,
        receiptType: receipt.receiptType,
        contractTotalMonths: totalMonths,
        ...balance,
      },
    },
  });
}

function readSnapshot(value: Prisma.JsonValue | null, receipt: Source): ReceiptDocumentBalance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unknownBalance;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.version !== 1 ||
    snapshot.receiptId !== receipt.id ||
    snapshot.contractId !== receipt.contractId ||
    snapshot.receiptType !== receipt.receiptType ||
    typeof snapshot.contractTotalMonths !== 'number' ||
    !Number.isInteger(snapshot.contractTotalMonths) ||
    snapshot.contractTotalMonths <= 0
  )
    return unknownBalance;
  const fields = [
    'documentRemainingBalance',
    'documentRemainingMonths',
    'documentInstallmentAmountDue',
    'documentInstallmentAmountPaid',
  ] as const;
  if (fields.every((field) => snapshot[field] === null)) return { ...unknownBalance };
  const money = (amount: unknown): amount is string =>
    typeof amount === 'string' && /^(0|[1-9]\d{0,9})\.\d{2}$/.test(amount);
  if (
    !money(snapshot.documentRemainingBalance) ||
    typeof snapshot.documentRemainingMonths !== 'number' ||
    !Number.isInteger(snapshot.documentRemainingMonths) ||
    snapshot.documentRemainingMonths < 0 ||
    snapshot.documentRemainingMonths > snapshot.contractTotalMonths
  )
    return unknownBalance;
  const due = snapshot.documentInstallmentAmountDue;
  const paid = snapshot.documentInstallmentAmountPaid;
  if (
    !(due === null && paid === null) &&
    !(money(due) && money(paid) && new Prisma.Decimal(paid).lte(due))
  )
    return unknownBalance;
  return {
    documentRemainingBalance: snapshot.documentRemainingBalance,
    documentRemainingMonths: snapshot.documentRemainingMonths,
    documentInstallmentAmountDue: due as string | null,
    documentInstallmentAmountPaid: paid as string | null,
  };
}

const collectionTags = new Set([
  'receipt',
  '2B',
  'credit-allocation',
  'reschedule-collect',
  'overpayment-credit',
]);
const relevantCodes = new Set(['11-2103', '21-1103', '21-5101']);
const obj = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const day = (value: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(value);
const cash = (meta: Record<string, unknown>): Prisma.Decimal | null => {
  const value = meta.tag === 'reschedule-collect' ? meta.rescheduleFee : meta.deltaApplied;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const amount = new Prisma.Decimal(value);
    return meta.tag === 'reschedule-collect'
      ? amount.plus(String(meta.lateFeeCollected ?? 0))
      : amount;
  } catch {
    return null;
  }
};

/**
 * Prefer the immutable issuance snapshot, including explicit unknown values.
 * Legacy reconstruction uses the receipt's creation timestamp rather than a
 * backdated paid date; transaction-start timestamps cannot prove commit order.
 * New documents freeze the visible result in the same issuance transaction so
 * a later-committing transaction never changes a previously issued PDF.
 */
export async function getReceiptDocumentBalance(
  client: Client,
  receipt: Source,
  terms: InstallmentBreakdownInput,
): Promise<ReceiptDocumentBalance> {
  if (!sourceTypes.includes(receipt.receiptType)) return unknownBalance;
  // Include archived immutable audit rows. Duplicate or malformed stamps fail
  // closed instead of falling through to a mutable historical reconstruction.
  const snapshots = await client.auditLog.findMany({
    where: { action: RECEIPT_DOCUMENT_BALANCE_ACTION, entity: 'receipt', entityId: receipt.id },
    select: { newValue: true },
    take: 2,
  });
  if (snapshots.length)
    return snapshots.length === 1 ? readSnapshot(snapshots[0].newValue, receipt) : unknownBalance;
  if (!receipt.createdAt || !Number.isInteger(terms.totalMonths) || terms.totalMonths <= 0)
    return unknownBalance;
  const [payments, schedules, receipts, entries] = await Promise.all([
    client.payment.findMany({
      where: { contractId: receipt.contractId, deletedAt: null },
      select: { id: true, installmentNo: true, amountDue: true },
      orderBy: { installmentNo: 'asc' },
    }),
    client.installmentSchedule.findMany({
      where: { contractId: receipt.contractId, deletedAt: null },
      select: { id: true, installmentNo: true },
    }),
    client.receipt.findMany({
      where: {
        contractId: receipt.contractId,
        receiptType: { in: sourceTypes },
        createdAt: { lte: receipt.createdAt },
        OR: [{ deletedAt: null }, { deletedAt: { gt: receipt.createdAt } }],
      },
      select: {
        id: true,
        paymentId: true,
        receiptType: true,
        amount: true,
        paidDate: true,
        sourceJournalEntryId: true,
        paymentStatus: true,
      },
    }),
    client.journalEntry.findMany({
      where: {
        status: 'POSTED',
        deletedAt: null,
        metadata: { path: ['contractId'], equals: receipt.contractId },
      },
      select: {
        id: true,
        referenceType: true,
        createdAt: true,
        postedAt: true,
        metadata: true,
        lines: {
          where: { deletedAt: null },
          select: { accountCode: true, debit: true, credit: true },
        },
      },
    }),
  ]);
  if (
    payments.length !== terms.totalMonths ||
    payments.some((payment, index) => payment.installmentNo !== index + 1)
  )
    return unknownBalance;
  // Payment.amountDue is the customer's fixed billed amount. Validate it against
  // the shared commission/interest/VAT derivation, allowing the existing <=1 baht
  // final rounding convention. Schedule.amountDue historically omitted commission.
  if (
    payments.some((payment) =>
      new Prisma.Decimal(payment.amountDue)
        .minus(
          computeInstallmentBreakdown({ ...terms, installmentNo: payment.installmentNo })
            .installmentTotal,
        )
        .abs()
        .gt(1),
    )
  )
    return unknownBalance;
  const originalEntries = entries.filter(
    (entry) => entry.createdAt <= receipt.createdAt && !obj(entry.metadata).originalEntryId,
  );
  const ids = originalEntries.map((entry) => entry.id);
  const queriedReversals = ids.length
    ? await client.journalEntry.findMany({
        where: {
          status: 'POSTED',
          deletedAt: null,
          OR: ids.map((id) => ({ metadata: { path: ['originalEntryId'], equals: id } })),
        },
        select: {
          id: true,
          referenceType: true,
          createdAt: true,
          postedAt: true,
          metadata: true,
          lines: {
            where: { deletedAt: null },
            select: { accountCode: true, debit: true, credit: true },
          },
        },
      })
    : [];
  const reversals = [
    ...new Map(
      [
        ...queriedReversals,
        ...entries.filter((entry) => typeof obj(entry.metadata).originalEntryId === 'string'),
      ].map((entry) => [entry.id, entry]),
    ).values(),
  ];
  const originals = new Map(originalEntries.map((entry) => [entry.id, entry]));
  if (
    reversals.some(
      (entry) =>
        entry.createdAt <= receipt.createdAt &&
        !originals.has(String(obj(entry.metadata).originalEntryId)),
    )
  )
    return unknownBalance;
  // A stamped reversal without its surviving counterpart is incomplete evidence.
  if (
    originalEntries.some(
      (entry) =>
        obj(entry.metadata).reversed === true &&
        !reversals.some((reverse) => obj(reverse.metadata).originalEntryId === entry.id),
    )
  )
    return unknownBalance;
  const financial = originalEntries.filter((entry) =>
    collectionTags.has(String(obj(entry.metadata).tag)),
  );
  const sourceByReceipt = new Map<string, string>();
  for (const row of receipts) {
    const eligible = financial.filter((entry) => {
      const meta = obj(entry.metadata);
      return (
        meta.paymentId === row.paymentId &&
        (row.receiptType === 'RESCHEDULE_FEE'
          ? meta.tag === 'reschedule-collect'
          : ['receipt', '2B'].includes(String(meta.tag))) &&
        (row.sourceJournalEntryId
          ? row.sourceJournalEntryId === entry.id
          : cash(meta)?.eq(row.amount) &&
            entry.postedAt &&
            day(entry.postedAt) === day(row.paidDate))
      );
    });
    if (eligible.length !== 1 || [...sourceByReceipt.values()].includes(eligible[0].id))
      return unknownBalance;
    sourceByReceipt.set(row.id, eligible[0].id);
  }
  if (!sourceByReceipt.has(receipt.id)) return unknownBalance;
  const cleared = new Map(
    payments.map((payment) => [payment.installmentNo, new Prisma.Decimal(0)]),
  );
  let unapplied = new Prisma.Decimal(0);
  for (const entry of [
    ...originalEntries,
    ...reversals.filter((entry) => entry.createdAt <= receipt.createdAt),
  ]) {
    const metadata = obj(entry.metadata);
    const original =
      typeof metadata.originalEntryId === 'string'
        ? originals.get(metadata.originalEntryId)
        : undefined;
    const meta = original ? obj(original.metadata) : metadata;
    const relevant = entry.lines.filter(
      (line) =>
        relevantCodes.has(line.accountCode) && (!line.debit.isZero() || !line.credit.isZero()),
    );
    if (!relevant.length) continue;
    // Accrual creates the receivable already represented in the fixed billed
    // schedule; it is not another customer payment. Other unsupported adjustments
    // must not be silently treated as cash or discarded.
    if (meta.tag === '2A') continue;
    if (!collectionTags.has(String(meta.tag)) || entry.referenceType !== 'AUTO')
      return unknownBalance;
    const installmentNo =
      payments.find((payment) => payment.id === meta.paymentId)?.installmentNo ??
      schedules.find((schedule) => schedule.id === meta.installmentScheduleId)?.installmentNo;
    for (const line of relevant) {
      const net = line.credit.minus(line.debit);
      if (line.accountCode === '11-2103') {
        if (!installmentNo || !cleared.has(installmentNo)) return unknownBalance;
        cleared.set(installmentNo, cleared.get(installmentNo)!.plus(net));
      } else unapplied = unapplied.plus(net);
    }
  }
  if (unapplied.lt(0) || [...cleared.values()].some((amount) => amount.lt(0)))
    return unknownBalance;
  const outstanding = payments.map((payment) => {
    const settled = cleared.get(payment.installmentNo)!;
    let remaining = Prisma.Decimal.max(new Prisma.Decimal(payment.amountDue).minus(settled), 0);
    // A whole-baht bill can exceed the ledger's satang total (6079 vs 6078.67).
    // Close that residual only when the ledger is fully cleared AND an immutable
    // PAID receipt proves completion before this cutoff. A genuine sub-baht
    // partial is not rounded away; a receipt reversed before cutoff proves nothing.
    const canonical = computeInstallmentBreakdown({
      ...terms,
      installmentNo: payment.installmentNo,
    }).installmentTotal;
    const completion = receipts.some(
      (row) =>
        row.paymentId === payment.id &&
        (INSTALLMENT_MONEY_RECEIPT_TYPES as readonly string[]).includes(row.receiptType) &&
        row.paymentStatus === 'PAID' &&
        sourceByReceipt.has(row.id) &&
        !reversals.some(
          (reverse) =>
            reverse.createdAt <= receipt.createdAt &&
            obj(reverse.metadata).originalEntryId === sourceByReceipt.get(row.id),
        ),
    );
    if (remaining.gt(0) && remaining.lte(1) && settled.gte(canonical) && completion)
      remaining = new Prisma.Decimal(0);
    return { ...payment, remaining };
  });
  const remainingMonths = outstanding.filter((payment) => payment.remaining.gt(0)).length;
  // The issuance-time paid count detects missing pre-migration full payments.
  // We cannot infer their value from today's Payment.status/amountPaid.
  if (receipt.remainingMonths != null && remainingMonths !== receipt.remainingMonths)
    return unknownBalance;
  const remainingBalance = Prisma.Decimal.max(
    outstanding
      .reduce((sum, payment) => sum.plus(payment.remaining), new Prisma.Decimal(0))
      .minus(unapplied),
    0,
  );
  const current = outstanding.find((payment) => payment.installmentNo === receipt.installmentNo);
  return {
    documentRemainingBalance: remainingBalance.toFixed(2),
    documentRemainingMonths: remainingMonths,
    documentInstallmentAmountDue: current?.amountDue.toFixed(2) ?? null,
    documentInstallmentAmountPaid: current
      ? current.amountDue.minus(current.remaining).toFixed(2)
      : null,
  };
}
