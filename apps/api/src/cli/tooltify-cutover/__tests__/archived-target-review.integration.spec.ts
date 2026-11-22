import { afterAll, expect, it } from 'vitest';
import { harnessClient } from './rollback-fixtures';
import { stockInput, productData } from './preflight-fixtures';
import { supplierFixture } from './supplier-fixtures';
import { buildImportPlan } from '../plan';
import { hashSourceDecisions } from '../canonicalize';
import { applyBatch } from '../batch';
import { writeStockItem } from '../stock-writer';
import { planSuppliers } from '../supplier-plan';
import { applySuppliers } from '../supplier-writer';
const db = harnessClient();
afterAll(() => db.$disconnect());
it('retains hold checks for an archived identity and detects a hold appearing after review', async () => {
  const input = await stockInput(db);
  const old = await db.product.create({
    data: { ...productData(input.rows[0]), deletedAt: new Date(), status: 'RESERVED' },
  });
  Object.assign(input.decisions.entries.find((d) => d.action === 'RESOLVE_STOCK')!, {
    reviewedArchivedTargetIds: [old.id],
  });
  input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
  expect((await buildImportPlan(db, input)).issues.map((i) => i.code)).toContain(
    'HELD_STOCK_TARGET',
  );
  await db.product.update({ where: { id: old.id }, data: { status: 'IN_STOCK' } });
  const plan = await buildImportPlan(db, input);
  expect(plan.issues).toEqual([]);
  await db.product.update({ where: { id: old.id }, data: { status: 'RESERVED' } });
  await expect(
    applyBatch(db, plan, (tx, item) => {
      if (item.kind !== 'STOCK') throw Error('stock');
      return writeStockItem(tx, item);
    }),
  ).rejects.toThrow();
  expect(await db.product.count({ where: { imeiSerial: input.rows[0].barcode } })).toBe(1);
});
it('creates a fresh stock unit only after explicit review of the archived identity, retaining old data', async () => {
  const input = await stockInput(db);
  const row = input.rows[0];
  const old = await db.product.create({
    data: { ...productData(row), deletedAt: new Date('2026-01-01') },
  });
  expect((await buildImportPlan(db, input)).issues.length).toBeGreaterThan(0);
  const d = input.decisions.entries.find((d) => d.action === 'RESOLVE_STOCK')!;
  Object.assign(d, { reviewedArchivedTargetIds: [old.id] });
  input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
  const plan = await buildImportPlan(db, input);
  expect(plan.issues).toEqual([]);
  const result = await applyBatch(db, plan, (tx, item) => {
    if (item.kind !== 'STOCK') throw Error('stock');
    return writeStockItem(tx, item);
  });
  expect(result.created).toBe(1);
  expect(await db.product.findUnique({ where: { id: old.id } })).toEqual(old);
  expect(await db.product.count({ where: { imeiSerial: row.barcode, deletedAt: null } })).toBe(1);
});
it('blocks a reviewed archived stock target becoming active before apply', async () => {
  const input = await stockInput(db);
  const old = await db.product.create({
    data: { ...productData(input.rows[0]), deletedAt: new Date() },
  });
  Object.assign(input.decisions.entries.find((d) => d.action === 'RESOLVE_STOCK')!, {
    reviewedArchivedTargetIds: [old.id],
  });
  input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
  const plan = await buildImportPlan(db, input);
  expect(plan.issues).toEqual([]);
  await db.product.update({ where: { id: old.id }, data: { deletedAt: null } });
  await expect(
    applyBatch(db, plan, (tx, item) => {
      if (item.kind !== 'STOCK') throw Error('stock');
      return writeStockItem(tx, item);
    }),
  ).rejects.toThrow();
  expect(await db.product.count({ where: { imeiSerial: input.rows[0].barcode } })).toBe(1);
});
it('creates a reviewed supplier without resurrecting its archived record and rejects an active-target exemption', async () => {
  const { row, context } = await supplierFixture(db);
  const old = await db.supplier.create({
    data: { name: row.legalName!, phone: '020000000', deletedAt: new Date(), isActive: false },
  });
  expect((await planSuppliers(db, [row], context)).issues.length).toBeGreaterThan(0);
  Object.assign(context, { reviewedArchivedTargets: { [row.supplierRef]: [old.id] } });
  const plan = await planSuppliers(db, [row], context);
  expect(plan.issues).toEqual([]);
  const result = await applySuppliers(db, plan);
  expect(result.created).toBe(1);
  expect(await db.supplier.findUnique({ where: { id: old.id } })).toEqual(old);
  const other = await supplierFixture(db);
  const active = await db.supplier.create({
    data: { name: other.row.legalName!, phone: '020000000' },
  });
  Object.assign(other.context, {
    reviewedArchivedTargets: { [other.row.supplierRef]: [active.id] },
  });
  expect((await planSuppliers(db, [other.row], other.context)).issues.length).toBeGreaterThan(0);
});
