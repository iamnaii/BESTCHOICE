import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { bangkokDateString } from '../../utils/date.util';

const certifiedSalesHistory = z.object({
  version: z.literal(1),
  cannotVerifySource: z.literal(false),
  history: z.array(
    z.object({
      branchId: z.string().min(1),
      reportFrom: z.string().date(),
      reportTo: z.string().date(),
    }),
  ),
});

export interface ImportedSalesCoverage {
  firstSoldAt: string | null;
  lastSoldAt: string | null;
  verifiedThrough: string | null;
}

interface HistoryLine {
  id: string;
  soldAt: Date;
  source: string;
  importBatch: string | null;
}

export async function importedSalesCoverage(
  db: Prisma.TransactionClient,
  rows: HistoryLine[],
  origins: ReadonlyMap<string, { branchId: string }>,
  start?: Date,
) {
  let first: Date | null = null;
  let last: Date | null = null;
  for (const { soldAt } of rows) {
    if (!first || soldAt < first) first = soldAt;
    if (!last || soldAt > last) last = soldAt;
  }
  const observed: ImportedSalesCoverage = {
    firstSoldAt: first?.toISOString() ?? null,
    lastSoldAt: last?.toISOString() ?? null,
    verifiedThrough: null,
  };
  const batchId = rows[0]?.importBatch;
  if (
    !start ||
    !batchId ||
    rows.some(
      (row) => row.source !== 'TOOLTIFY' || row.importBatch !== batchId || !origins.has(row.id),
    )
  )
    return observed;
  // History search is company-wide. A matching IMEI/bill cannot narrow the set of
  // shops in which an unimported sale might have taken place.
  const batch = await db.tooltifyImportBatch.findFirst({
    where: { id: batchId, kind: 'SALES', status: 'VERIFIED', deletedAt: null },
    select: { sourceCutoverAt: true, reconciliationSnapshot: true },
  });
  if (!batch || start > batch.sourceCutoverAt || (last && last > batch.sourceCutoverAt))
    return observed;
  const snapshot = certifiedSalesHistory.safeParse(batch.reconciliationSnapshot);
  if (!snapshot.success) return observed;
  const scope = new Set<string>();
  const from = bangkokDateString(start);
  const cutoff = bangkokDateString(batch.sourceCutoverAt);
  for (const window of snapshot.data.history) {
    if (scope.has(window.branchId) || window.reportFrom > from || window.reportTo !== cutoff)
      return observed;
    scope.add(window.branchId);
  }
  const branches = await db.branch.findMany({
    // Include retired branches and legacy branches with no company assignment.
    where: { OR: [{ company: { companyCode: 'SHOP' } }, { companyId: null }] },
    select: { id: true, companyId: true },
  });
  if (
    !branches.length ||
    scope.size !== branches.length ||
    branches.some((branch) => !branch.companyId || !scope.has(branch.id)) ||
    rows.some((row) => !scope.has(origins.get(row.id)!.branchId))
  )
    return observed;
  return { ...observed, verifiedThrough: batch.sourceCutoverAt.toISOString() };
}
