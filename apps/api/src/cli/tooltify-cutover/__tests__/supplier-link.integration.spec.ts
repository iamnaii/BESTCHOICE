import { planRollback, applyRollback } from '../rollback';
import { harnessClient, frozen } from './rollback-fixtures';
import { afterAll, expect, it, vi } from 'vitest';
import { supplierFixture } from './supplier-fixtures';
import { planSuppliers } from '../supplier-plan';
import { applySuppliers, rollbackSuppliers } from '../supplier-writer';
import { buildImportPlan } from '../plan';
import { hashSourceDecisions, hashImportValue as hash } from '../canonicalize';
import { applyBatch } from '../batch';
import { writeStockItem } from '../stock-writer';
const db = harnessClient();
vi.mock('../checkout-revision', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../checkout-revision')>()),
  readCheckoutRevision: () => 'c'.repeat(40),
}));
afterAll(() => db.$disconnect());
it('binds stock to the supplier in its source row and blocks stale supplier dependencies', async () => {
  const { row, context, stock } = await supplierFixture(db);
  const sp = await planSuppliers(db, [row], context);
  await applySuppliers(db, sp);
  const receipt = await db.tooltifyImportItem.findFirstOrThrow({ where: { batchId: sp.batchId } });
  Object.assign(stock.rows[0], { supplierLabel: row.displayName });
  const decision = stock.decisions.entries.find((e) => e.action === 'RESOLVE_STOCK')!;
  Object.assign(decision, {
    supplier: {
      mode: 'LINK',
      supplierRef: row.supplierRef,
      batchId: sp.batchId,
      targetId: receipt.targetId,
    },
  });
  stock.manifest.decisionsSha256 = hashSourceDecisions(stock.decisions);
  const plan = await buildImportPlan(db, stock);
  expect(plan.issues).toEqual([]);
  await applyBatch(db, plan, (tx, item) => {
    if (item.kind !== 'STOCK') throw Error('wrong kind');
    return writeStockItem(tx, item);
  });
  const imported = await db.tooltifyImportItem.findFirstOrThrow({
    where: { batchId: plan.batchId, targetType: 'PRODUCT' },
  });
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: imported.targetId! } })).supplierId,
  ).toBe(receipt.targetId);
  await db.supplier.update({ where: { id: receipt.targetId! }, data: { hasVat: true } });
  await expect(
    applyBatch(db, plan, (tx, item) => {
      if (item.kind !== 'STOCK') throw Error('wrong kind');
      return writeStockItem(tx, item);
    }),
  ).rejects.toThrow('IMPORT_DEPENDENCY_CHANGED');
});
it('blocks unknown supplier labels and requires explicit evidence for self-purchases', async () => {
  const { stock } = await supplierFixture(db);
  Object.assign(stock.rows[0], { supplierLabel: 'Unknown vendor' });
  let p = await buildImportPlan(db, stock);
  expect(p.issues.map((i) => i.code)).toContain('SUPPLIER_LINK_REQUIRED');
  Object.assign(stock.rows[0], { supplierLabel: 'รับซื้อเอง' });
  const d = stock.decisions.entries.find((e) => e.action === 'RESOLVE_STOCK')!;
  Object.assign(d, { supplier: { mode: 'NO_SUPPLIER' } });
  stock.manifest.decisionsSha256 = hashSourceDecisions(stock.decisions);
  p = await buildImportPlan(db, stock);
  expect(p.issues).toEqual([]);
});

it('imports an evidenced tablet serial unchanged and rejects a copied mapping on another row', async () => {
  const { stock } = await supplierFixture(db);
  const row = stock.rows[0];
  row.name = 'iPad synthetic';
  row.category = 'TABLET';
  row.barcode = 'SYNTHETIC42';
  row.sourceKey = hash([row.source.storeKey, row.barcode]);
  const mapping = {
    action: 'MAP_STOCK_ITEM' as const,
    fileSha256: row.source.fileSha256,
    sourceRows: [row.source.row],
    expectedBarcode: row.barcode,
    expectedName: row.name,
    expectedCategory: '' as const,
    category: 'TABLET' as const,
    reason: 'Independent synthetic tablet source record',
    evidenceRef: 'fixture-tablet',
  };
  row.sourceMapping = mapping;
  stock.decisions.entries.push(mapping);
  stock.manifest.decisionsSha256 = hashSourceDecisions(stock.decisions);
  const plan = await buildImportPlan(db, stock);
  expect(plan.issues).toEqual([]);
  await applyBatch(db, plan, (tx, item) => {
    if (item.kind !== 'STOCK') throw Error('stock only');
    return writeStockItem(tx, item);
  });
  const receipt = await db.tooltifyImportItem.findFirstOrThrow({
    where: { batchId: plan.batchId },
  });
  expect(await db.product.findUniqueOrThrow({ where: { id: receipt.targetId! } })).toMatchObject({
    imeiSerial: 'SYNTHETIC42',
    category: 'TABLET',
  });
  const altered = structuredClone(stock);
  altered.manifest.canonicalSetId += '-other';
  altered.rows[0].sourceMapping!.expectedBarcode = 'different';
  altered.manifest.decisionsSha256 = hashSourceDecisions(altered.decisions);
  expect((await buildImportPlan(db, altered)).issues.map((i) => i.code)).toContain(
    'INVALID_STOCK_SOURCE_MAPPING',
  );
});

it('reverses owned stock before its supplier, while unrelated archived stock still blocks reversal', async () => {
  const { row, context, stock } = await supplierFixture(db);
  const sp = await planSuppliers(db, [row], context);
  await applySuppliers(db, sp);
  const sr = await db.tooltifyImportItem.findFirstOrThrow({ where: { batchId: sp.batchId } });
  stock.rows[0].supplierLabel = row.displayName;
  Object.assign(stock.decisions.entries.find((d) => d.action === 'RESOLVE_STOCK')!, {
    supplier: {
      mode: 'LINK',
      supplierRef: row.supplierRef,
      batchId: sp.batchId,
      targetId: sr.targetId!,
    },
  });
  stock.manifest.decisionsSha256 = hashSourceDecisions(stock.decisions);
  const plan = await buildImportPlan(db, stock);
  await applyBatch(db, plan, (tx, i) => {
    if (i.kind !== 'STOCK') throw Error('stock');
    return writeStockItem(tx, i);
  });
  const rollback = await planRollback(db, plan.batchId);
  await frozen(() => applyRollback(db, rollback));
  const pr = await db.tooltifyImportItem.findFirstOrThrow({ where: { batchId: plan.batchId } });
  const product = await db.product.findUniqueOrThrow({ where: { id: pr.targetId! } });
  const unrelated = await db.product.create({
    data: {
      name: product.name,
      brand: product.brand,
      model: product.model,
      category: product.category,
      costPrice: product.costPrice,
      branchId: product.branchId,
      supplierId: sr.targetId!,
      imeiSerial: 'UNRELATED42',
      legacyProductCode: 'unrelated-archived',
      deletedAt: new Date(),
    },
  });
  await expect(frozen(() => rollbackSuppliers(db, sp))).rejects.toThrow('SUPPLIER_TARGET_IN_USE');
  await db.product.update({ where: { id: unrelated.id }, data: { supplierId: null } });
  await expect(frozen(() => rollbackSuppliers(db, sp))).resolves.toMatchObject({
    rolledBack: true,
  });
});
