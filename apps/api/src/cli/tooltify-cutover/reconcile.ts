import { Prisma, PrismaClient } from '@prisma/client';
import { hashImportValue as hash, orderedDigest, receiptDigest } from './canonicalize';
import { readSaleOrigins, saleContent } from './plan-targets';
import { aggregateSales, aggregateStock } from './reconciliation-snapshot';
import type {
  EconomicAggregate,
  MetricDelta,
  ReconciliationReport,
  ReconciliationSnapshot,
} from './types';

type Totals = Record<string, string | number | null>;
type Dimensions = Record<string, string | null>;
type Stage = { totals: Totals; groups: ({ totals: Totals } & object)[] };
function indexed(stage: Stage) {
  const rows = new Map<string, { dimensions: Dimensions; totals: Totals }>();
  rows.set('overall', { dimensions: {}, totals: stage.totals });
  for (const { totals, ...dimensions } of stage.groups)
    rows.set(hash(dimensions), { dimensions, totals });
  return rows;
}
// left minus right minus independently counted exclusions, including groups fully removed.
function subtract(left: Stage, right: Stage, adjustments?: Stage): MetricDelta[] {
  const stages = [indexed(left), indexed(right), ...(adjustments ? [indexed(adjustments)] : [])];
  const ids = new Set(stages.flatMap((s) => [...s.keys()]));
  return [...ids].sort().map((id) => {
    const rows = stages.map((s) => s.get(id)),
      dimensions = rows.find((r) => r)?.dimensions ?? {};
    const values: MetricDelta['values'] = {};
    for (const key of Object.keys(left.totals)) {
      const amounts = rows.map((r) => (r ? r.totals[key] : 0));
      if (amounts.some((a) => a == null)) values[key] = null;
      else {
        const difference = new Prisma.Decimal(amounts[0]!)
          .minus(amounts[1]!)
          .minus(amounts[2] ?? 0);
        values[key] = ['lines', 'bills', 'units'].includes(key)
          ? difference.toNumber()
          : difference.toFixed(2);
      }
    }
    return { dimensions, values };
  });
}
export function sourceDeltas(s: ReconciliationSnapshot) {
  if (
    !s.source?.detail ||
    !s.source.groups ||
    !s.adjustments ||
    s.source.kind !== s.canonical.kind ||
    s.adjustments.kind !== s.canonical.kind
  )
    return null;
  return subtract({ totals: s.source.detail, groups: s.source.groups }, s.canonical, s.adjustments);
}
function balanced(deltas: MetricDelta[] | null) {
  return (
    !!deltas?.length &&
    deltas.every((row) =>
      Object.values(row.values).every((v) => v !== null && new Prisma.Decimal(v).isZero()),
    )
  );
}
export function hasVerifiedSource(s: ReconciliationSnapshot) {
  const canonical = s.canonical,
    adjustments = s.adjustments;
  const accounted =
    canonical.kind === 'SALES' && adjustments?.kind === 'SALES'
      ? canonical.totals.lines + adjustments.totals.lines
      : canonical.kind === 'STOCK' && adjustments?.kind === 'STOCK'
        ? canonical.totals.units + adjustments.totals.units
        : null;
  return (
    !s.cannotVerifySource &&
    accounted !== null &&
    s.uniquePhysicalRows === accounted &&
    balanced(sourceDeltas(s))
  );
}
async function sideEffects(
  tx: Prisma.TransactionClient,
  batchId: string,
  createdProducts: string[],
  targetIds: string[],
) {
  const productId = { in: createdProducts };
  const productScope = { OR: [{ productId }, { bundleProductIds: { hasSome: createdProducts } }] };
  const sales = await tx.sale.findMany({
    where: { OR: [productScope, { contract: productScope }] },
    select: { id: true, contractId: true },
  });
  const contracts = await tx.contract.findMany({
    where: {
      OR: [
        productScope,
        { id: { in: sales.flatMap((s) => (s.contractId ? [s.contractId] : [])) } },
      ],
    },
    select: { id: true },
  });
  const contractId = { in: contracts.map((c) => c.id) },
    saleId = { in: sales.map((s) => s.id) };
  const payments = await tx.payment.findMany({ where: { contractId }, select: { id: true } });
  const refs = {
    in: [batchId, ...targetIds, ...saleId.in, ...contractId.in, ...payments.map((p) => p.id)],
  };
  const commissions = await tx.salesCommission.findMany({
    where: { OR: [{ saleId }, { contractId }] },
    select: { id: true },
  });
  const external = await tx.externalFinanceCommission.findMany({
    where: { saleReferenceId: refs },
    select: { id: true, journalEntryId: true },
  });
  const receiving = await tx.goodsReceivingItem.findMany({
    where: { productId },
    select: { id: true, journalEntryId: true, receivingId: true },
  });
  const journalLinks = [...external, ...receiving].flatMap((row) =>
    row.journalEntryId ? [row.journalEntryId] : [],
  );
  const referenceIds = [
    ...refs.in,
    ...commissions.map((c) => c.id),
    ...external.map((c) => c.id),
    ...receiving.flatMap((r) => [r.id, r.receivingId]),
  ];
  return {
    sales: sales.length,
    contracts: contracts.length,
    payments: payments.length,
    commissions: commissions.length,
    externalCommissions: external.length,
    receipts: receiving.length,
    journalEntries: await tx.journalEntry.count({
      where: { OR: [{ id: { in: journalLinks } }, { referenceId: { in: referenceIds } }] },
    }),
  };
}
async function readReconciliation(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<ReconciliationReport> {
  const batch = await tx.tooltifyImportBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { items: { where: { deletedAt: null, reversedAt: null } } },
  });
  const snapshot = batch.reconciliationSnapshot as unknown as ReconciliationSnapshot;
  const issues = new Set<string>();
  if (batch.deletedAt || !['APPLIED', 'VERIFIED'].includes(batch.status))
    issues.add('INCOMPLETE_BATCH');
  if (!hasVerifiedSource(snapshot)) issues.add('SOURCE_NOT_RECONCILED');
  const { items } = batch,
    live = items.filter((i) => i.disposition !== 'EXCLUDE');
  const refs = (i: (typeof items)[number]) => {
    const ref = Array.isArray(i.sourceRefs) ? i.sourceRefs[0] : null;
    return ref && typeof ref === 'object' && !Array.isArray(ref) ? ref : {};
  };
  const copyCount = snapshot.exclusions.find((e) => e.reason === 'IDENTICAL_FILE_COPY')?.lines ?? 0;
  const counts = {
    uniquePhysicalRows: snapshot.uniquePhysicalRows ?? null,
    inputOccurrences:
      snapshot.uniquePhysicalRows == null ? null : snapshot.uniquePhysicalRows + copyCount,
    created: live.filter((i) => i.disposition === 'CREATE').length,
    matched: live.filter((i) => i.disposition === 'MATCH').length,
    excluded: items.length - live.length,
    identicalFileCopies: items.filter(
      (i) => i.disposition === 'EXCLUDE' && refs(i).reason === 'IDENTICAL_FILE_COPY',
    ).length,
  };
  if (
    counts.inputOccurrences !== counts.created + counts.matched + counts.excluded ||
    counts.identicalFileCopies !== copyCount
  )
    issues.add('SOURCE_DISPOSITION_COUNT_MISMATCH');
  if (receiptDigest(items) !== snapshot.expectedReceiptsHash) issues.add('RECEIPT_SET_MISMATCH');
  const ids = live.flatMap((i) => (i.targetId ? [i.targetId] : []));
  if (new Set(ids).size !== live.length) issues.add('AMBIGUOUS_TARGETS');
  const sales = await tx.importedSale.findMany({
    where: { OR: [{ id: { in: batch.kind === 'SALES' ? ids : [] } }, { importBatch: batch.id }] },
  });
  const products = await tx.product.findMany({
    where: {
      OR: [
        { id: { in: batch.kind === 'STOCK' ? ids : [] } },
        { legacyProductCode: { startsWith: 'TTFY-CUTOVER:' + batch.id + ':' } },
      ],
    },
    include: { prices: { orderBy: { id: 'asc' } } },
  });
  const saleMap = new Map(sales.map((s) => [s.id, s])),
    productMap = new Map(products.map((p) => [p.id, p]));
  if (
    (batch.kind === 'SALES' ? saleMap.size : productMap.size) !== live.length ||
    (batch.kind === 'SALES' ? productMap.size : saleMap.size) !== 0
  )
    issues.add('TARGET_SET_MISMATCH');
  const origins = await readSaleOrigins(tx, sales);
  const branches = new Map(snapshot.files.map((f) => [f.fileSha256, f.branchId]));
  const stockRows: Parameters<typeof aggregateStock>[0] = [],
    saleRows: Parameters<typeof aggregateSales>[0] = [],
    targetValues: unknown[] = [];
  for (const i of live) {
    const ref = refs(i),
      id = i.targetId ?? '';
    if (batch.kind === 'SALES') {
      const s = saleMap.get(id);
      if (!s) {
        issues.add('MISSING_TARGET');
        continue;
      }
      const origin = origins.get(id);
      if (!origin) issues.add('UNPROVEN_SALE_ORIGIN');
      else if (
        origin.branchId !== branches.get(String(ref.fileSha256)) ||
        origin.storeKey !== ref.storeKey
      )
        issues.add('SALE_ORIGIN_BRANCH_CONFLICT');
      const branchId = origin?.branchId;
      if (
        !branchId ||
        typeof ref.storeKey !== 'string' ||
        !s.orderNumber.trim() ||
        s.source !== 'TOOLTIFY' ||
        (s.importBatch === batch.id) !== (i.disposition === 'CREATE') ||
        i.targetType !== 'IMPORTED_SALE' ||
        hash(s) !== i.afterFingerprint
      )
        issues.add('SALE_TARGET_MISMATCH');
      targetValues.push([i.sourceKey, saleContent(s)]);
      saleRows.push({
        ...s,
        sourceStoreKey: origin?.storeKey ?? '',
        branchId: branchId ?? '',
        costTotal: s.costTotal.toFixed(2),
        listPrice: s.listPrice.toFixed(2),
        salePrice: s.salePrice.toFixed(2),
        profit: s.profit.toFixed(2),
      });
    } else {
      const p = productMap.get(id);
      if (!p) {
        issues.add('MISSING_TARGET');
        continue;
      }
      const owned = p.legacyProductCode === 'TTFY-CUTOVER:' + batch.id + ':' + i.sourceKey;
      if (
        owned !== (i.disposition === 'CREATE') ||
        i.targetType !== 'PRODUCT' ||
        hash(p) !== i.afterFingerprint
      )
        issues.add('STOCK_TARGET_MISMATCH');
      const accessory = p.category === 'ACCESSORY',
        legacySku = /^TTFY-(.+)-[0-9]+$/.exec(p.legacyProductCode ?? '')?.[1];
      const identity = accessory
        ? legacySku
          ? hash(['ACCESSORY', p.branchId, legacySku])
          : i.identityHash
        : hash(['DEVICE', p.imeiSerial]);
      targetValues.push([
        i.sourceKey,
        identity,
        p.branchId,
        p.category,
        p.status,
        p.costPrice.toFixed(2),
        p.cashPrice?.toFixed(2) ?? null,
        p.installmentPrice?.toFixed(2) ?? null,
        p.financePrice?.toFixed(2) ?? null,
        owned ? p.stockInDate : null,
      ]);
      stockRows.push({
        branchId: p.branchId,
        kind: accessory ? 'ACCESSORY' : 'DEVICE',
        skuHash: accessory ? identity : null,
        cost: p.costPrice.toFixed(2),
      });
    }
  }
  if (orderedDigest(targetValues) !== snapshot.expectedTargetsHash)
    issues.add('CANONICAL_TARGET_MISMATCH');
  const target: EconomicAggregate =
    batch.kind === 'SALES' ? aggregateSales(saleRows) : aggregateStock(stockRows);
  const deltas = {
    sourceToCanonical: sourceDeltas(snapshot),
    canonicalToTarget: subtract(snapshot.canonical, target),
  };
  if (!balanced(deltas.canonicalToTarget)) issues.add('TARGET_TOTALS_MISMATCH');
  const effects = await sideEffects(
    tx,
    batch.id,
    products
      .filter((p) => p.legacyProductCode?.startsWith('TTFY-CUTOVER:' + batch.id + ':'))
      .map((p) => p.id),
    ids,
  );
  if (Object.values(effects).some((n) => n > 0)) issues.add('FORBIDDEN_SIDE_EFFECTS');
  return {
    batchId,
    kind: batch.kind,
    status: batch.status,
    canOpen: issues.size === 0,
    issues: [...issues],
    counts,
    source: snapshot.source,
    canonical: snapshot.canonical,
    adjustments: snapshot.adjustments ?? null,
    target,
    deltas,
    sideEffects: effects,
  };
}
export async function reconcileBatch(
  db: PrismaClient,
  batchId: string,
): Promise<ReconciliationReport> {
  return db.$transaction((tx) => readReconciliation(tx, batchId), {
    isolationLevel: 'RepeatableRead',
    timeout: 600000,
  });
}

/** A read-only report is never an approval token. Keep the reviewed batch, receipts and
 * existing targets stable until this transaction's independent reconciliation commits. */
export async function verifyAppliedBatch(
  db: PrismaClient,
  batchId: string,
  reviewedHash: string,
): Promise<ReconciliationReport> {
  return db.$transaction(
    async (tx) => {
      const [batch] = await tx.$queryRaw<
        { id: string; plan_hash: string }[]
      >`SELECT id, plan_hash FROM tooltify_import_batches WHERE id=${batchId} FOR UPDATE`;
      if (!batch || batch.plan_hash !== reviewedHash) throw Error('BATCH_PLAN_HASH_MISMATCH');
      const rows = await tx.$queryRaw<
        { target_id: string | null; target_type: string }[]
      >`SELECT target_id,target_type FROM tooltify_import_items WHERE batch_id=${batchId} ORDER BY id FOR SHARE`;
      const ids = (type: string) =>
        rows.filter((r) => r.target_type === type && r.target_id).map((r) => r.target_id!);
      const products = ids('PRODUCT'),
        sales = ids('IMPORTED_SALE');
      if (products.length) {
        await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(products)}) ORDER BY id FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM product_prices WHERE product_id IN (${Prisma.join(products)}) ORDER BY id FOR SHARE`;
      }
      if (sales.length)
        await tx.$queryRaw`SELECT id FROM imported_sales WHERE id IN (${Prisma.join(sales)}) ORDER BY id FOR SHARE`;
      const report = await readReconciliation(tx, batchId);
      if (report.canOpen && report.status === 'APPLIED') {
        await tx.tooltifyImportBatch.update({
          where: { id: batchId },
          data: { status: 'VERIFIED' },
        });
        return { ...report, status: 'VERIFIED' };
      }
      return report;
    },
    { isolationLevel: 'Serializable', timeout: 600000 },
  );
}
