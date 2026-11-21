import { Prisma } from '@prisma/client';
import { scopedFinancialReferences } from './reconcile';

// Each predicate identifies an actual Product reference. History remains a use even
// when its document is closed or archived. ProductPrice is part of the owned target.
const productTables = [
  'branch_receiving_items',
  'device_returns',
  'external_finance_applications',
  'goods_receiving_items',
  'inspections',
  'online_installment_applications',
  'online_orders',
  'product_photos',
  'product_reservations',
  'repair_tickets',
  'repossessions',
  'reviews',
  'stock_adjustments',
  'stock_count_items',
  'stock_transfers',
  'trade_ins',
  'booking_items',
];
const contains = (column: string) => column + ' = ANY (scope.ids)';
const overlaps = (column: string) => column + ' && scope.ids';
const predicates: Record<string, string> = {
  ...Object.fromEntries(productTables.map((table) => [table, contains('product_id')])),
  contracts: contains('product_id') + ' OR ' + overlaps('bundle_product_ids'),
  sales: contains('product_id') + ' OR ' + overlaps('bundle_product_ids'),
  contract_exchange_requests: contains('old_product_id') + ' OR ' + contains('new_product_id'),
  chat_service_requests: contains('requested_product_id'),
  bookings: contains('locked_product_id'),
  saving_plans: contains('target_product_id'),
  after_sales_cases: contains('product_id') + ' OR ' + contains('replacement_product_id'),
  signature_capture_identities: overlaps('product_ids'),
  sale_promotion_benefits: contains('product_id') + ' OR ' + overlaps('accessory_product_ids'),
  contract_promotion_terms: overlaps('bundle_product_ids'),
  promotions:
    "(conditions->'productIds') ?| scope.ids OR (conditions->'accessoryProductIds') ?| scope.ids",
  products:
    contains('id') +
    ' AND (po_id IS NOT NULL OR inspection_id IS NOT NULL OR supplier_id IS NOT NULL)',
  audit_logs: contains('entity_id'),
  journal_entries:
    "(metadata->>'productId') = ANY(scope.ids) OR (metadata->>'acceptedProductId') = ANY(scope.ids) OR (metadata->'productIds') ?| scope.ids",
};

export async function rollbackReferences(
  tx: Prisma.TransactionClient,
  batchId: string,
  targetType: 'PRODUCT' | 'IMPORTED_SALE',
  targetIds: string[],
) {
  const productIds = targetType === 'PRODUCT' ? targetIds : [];
  const refs: Record<string, number> = {};
  if (productIds.length) {
    // Only the checked-in table/column expressions enter raw SQL. The UUID array is a bind parameter.
    const queries = Object.entries(predicates).map(
      ([table, predicate]) =>
        Prisma.sql`SELECT ${table}::text AS name, count(*)::int AS n FROM ${Prisma.raw(table)}, scope WHERE ${Prisma.raw(predicate)}`,
    );
    const rows = await tx.$queryRaw<{ name: string; n: number }[]>`
      WITH scope AS (SELECT ${productIds}::text[] AS ids) ${Prisma.join(queries, ' UNION ALL ')}`;
    for (const { name, n } of rows) if (n) refs[name] = n;
  }
  const financial = await scopedFinancialReferences(tx, batchId, productIds, targetIds);
  for (const [name, n] of Object.entries(financial)) if (n) refs[name] = n;
  const other = await tx.tooltifyImportItem.count({
    where: {
      batchId: { not: batchId },
      targetType,
      targetId: { in: targetIds },
      deletedAt: null,
      reversedAt: null,
      disposition: { in: ['CREATE', 'MATCH'] },
      batch: { deletedAt: null, status: { not: 'ROLLED_BACK' } },
    },
  });
  if (other) refs.otherBatchReceipts = other;
  return refs;
}

// All writers are already excluded by admission + sole backend. NOWAIT table locks
// additionally fence the exact inputs/mutations, including logical references with no FK.
export async function lockRollbackTables(tx: Prisma.TransactionClient) {
  const tables = [
    ...new Set([
      ...Object.keys(predicates),
      'tooltify_import_batches',
      'tooltify_import_items',
      'tooltify_import_status_events',
      'product_prices',
      'imported_sales',
      'payments',
      'sales_commissions',
      'external_finance_commissions',
      'journal_entries',
    ]),
  ].sort();
  await tx.$executeRaw(
    Prisma.sql`LOCK TABLE ${Prisma.raw(tables.join(', '))} IN ACCESS EXCLUSIVE MODE NOWAIT`,
  );
}
