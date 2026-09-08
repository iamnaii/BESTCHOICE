import { Prisma } from '@prisma/client';

/**
 * Fee actually settled by posted receipts for each Payment, excluding waiver
 * expense. Payment.amountPaid mixes principal and fees, so never infer this
 * amount from the payment's cumulative balance or current configured charge.
 *
 * Current receipts and legacy 2B entries identify their Payment by the exact
 * metadata.paymentId. Reversed originals no longer represent a settled fee.
 * Batch the lookup to keep page reads to one query and large summaries bounded.
 */
export async function loadLateFeePaidByPaymentIds(
  readClient: Pick<Prisma.TransactionClient, 'journalEntry'>,
  paymentIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  return (await loadPostedPaymentReceiptTotals(readClient, paymentIds)).lateFeePaid;
}

/** Reuse the fee lookup to detect receipt issuance missing after a cash commit. */
export async function loadPostedPaymentReceiptTotals(
  readClient: Pick<Prisma.TransactionClient, 'journalEntry'>,
  paymentIds: string[],
): Promise<{
  lateFeePaid: Map<string, Prisma.Decimal>;
  knownReceiptCash: Map<string, Prisma.Decimal>;
}> {
  const ids = [...new Set(paymentIds)];
  const paid = new Map(ids.map(id => [id, new Prisma.Decimal(0)]));
  const knownReceiptCash = new Map<string, Prisma.Decimal>();
  const batchSize = 500;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    const entries = await readClient.journalEntry.findMany({
      where: {
        status: 'POSTED',
        deletedAt: null,
        AND: [
          { OR: batch.map(id => ({ metadata: { path: ['paymentId'], equals: id } })) },
          { OR: ['receipt', '2B'].map(tag => ({ metadata: { path: ['tag'], equals: tag } })) },
        ],
      },
      select: {
        metadata: true,
        status: true,
        deletedAt: true,
        lines: {
          where: { deletedAt: null, accountCode: { in: ['42-1103', '52-1105'] } },
          select: { accountCode: true, debit: true, credit: true, deletedAt: true },
        },
      },
    });
    for (const entry of entries) {
      const meta = entry.metadata as Record<string, unknown> | null;
      const paymentId = meta?.paymentId;
      if (
        entry.status !== 'POSTED' || entry.deletedAt !== null ||
        meta?.reversed === true || (meta?.tag !== 'receipt' && meta?.tag !== '2B') ||
        typeof paymentId !== 'string' || !batch.includes(paymentId)
      ) continue;
      // Modern receipt JEs stamp the exact cash passed to receipt issuance.
      // A missing/legacy delta is unknown; advance consumption has no cash delta.
      if (typeof meta.deltaApplied === 'string' || typeof meta.deltaApplied === 'number') {
        try {
          const delta = new Prisma.Decimal(meta.deltaApplied);
          if (delta.isFinite() && delta.gte(0)) {
            knownReceiptCash.set(paymentId, (knownReceiptCash.get(paymentId) ?? new Prisma.Decimal(0)).plus(delta));
          }
        } catch { /* Invalid legacy metadata cannot prove cash completeness. */ }
      }
      let grossFee = new Prisma.Decimal(0);
      let waivedFee = new Prisma.Decimal(0);
      for (const line of entry.lines) {
        if (line.deletedAt !== null) continue;
        if (line.accountCode === '42-1103') grossFee = grossFee.plus(line.credit);
        if (line.accountCode === '52-1105') waivedFee = waivedFee.plus(line.debit);
      }
      // Gross-waiver receipts credit the whole fee and debit the discount.
      // Only their net represents a fee paid by cash/credit on this receipt.
      const netFee = Prisma.Decimal.max(grossFee.minus(waivedFee), 0);
      paid.set(paymentId, paid.get(paymentId)!.plus(netFee));
    }
  }
  return { lateFeePaid: paid, knownReceiptCash };
}
