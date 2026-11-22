import type { Prisma } from '@prisma/client';
import { saleContent, salesTargetFingerprint, hasMultiplicityEvidence } from './plan-targets';
import type { PlannedSalesItem, TargetWriteResult } from './types';

/** applyBatch supplies the transaction and commits the corresponding provenance receipt. */
export async function writeSalesItem(
  tx: Prisma.TransactionClient,
  item: PlannedSalesItem,
): Promise<TargetWriteResult> {
  if (item.reason) throw Error(item.reason);
  if (item.disposition !== 'CREATE' || item.targetId !== null)
    throw Error('IMPORT_CREATE_REQUIRED');
  const row = item.payload;
  if (!hasMultiplicityEvidence(item)) throw Error('UNSUPPORTED_SALES_MULTIPLICITY');
  if (!row.orderNumber.trim() || !row.barcode.trim()) throw Error('INVALID_CANONICAL_SALE');
  const sale = await tx.importedSale.create({
    data: {
      ...saleContent(row),
      costTotal: row.costTotal,
      listPrice: row.listPrice,
      salePrice: row.salePrice,
      profit: row.profit,
      source: 'TOOLTIFY',
      sourceOccurrence: row.occurrence,
      importBatch: item.batchId,
    },
  });
  return {
    targetType: 'IMPORTED_SALE',
    targetId: sale.id,
    created: true,
    afterFingerprint: await salesTargetFingerprint(tx, sale.id),
  };
}
