import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, expect, it } from 'vitest';
import { applyBatch } from '../batch';
import { buildImportPlan } from '../plan';
import { verifyAppliedBatch } from '../reconcile';
import { writeStockItem } from '../stock-writer';
import { stockInput } from './preflight-fixtures';

const db = new PrismaClient();
afterAll(() => db.$disconnect());
const write = (
  tx: Parameters<typeof writeStockItem>[0],
  item: Parameters<typeof applyBatch>[1]['items'][number],
) => {
  if (item.kind !== 'STOCK') throw Error('expected stock');
  return writeStockItem(tx, item);
};

it('persists evidenced health, replays without duplicates and blocks conflicting later values', async () => {
  const input = await stockInput(db);
  input.rows[0].batteryHealth = 81;
  const plan = await buildImportPlan(db, input);
  const receipt = await applyBatch(db, plan, write);
  await verifyAppliedBatch(db, receipt.batchId, plan.planHash);
  await applyBatch(db, plan, write);
  const products = await db.product.findMany({ where: { imeiSerial: input.rows[0].barcode } });
  expect(products).toHaveLength(1);
  expect(products[0].batteryHealth).toBe(81);
  const next = { ...input, manifest: { ...input.manifest, canonicalSetId: randomUUID() } };
  expect((await buildImportPlan(db, next)).items[0].disposition).toBe('MATCH');
  await db.product.update({ where: { id: products[0].id }, data: { batteryHealth: 90 } });
  expect((await buildImportPlan(db, next)).items[0].reason).toBe('STOCK_TARGET_CONFLICT');
  delete next.rows[0].batteryHealth;
  const missing = await buildImportPlan(db, next);
  expect(missing.items[0].disposition).toBe('MATCH');
  await applyBatch(db, missing, write);
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).batteryHealth,
  ).toBe(90);
});

it.each([-1, 101, 81.5, NaN])(
  'rejects invalid canonical health %s before writing',
  async (health) => {
    const input = await stockInput(db);
    input.rows[0].batteryHealth = health;
    const plan = await buildImportPlan(db, input);
    expect(plan.items[0].reason).toBe('INVALID_BATTERY_HEALTH');
    await expect(applyBatch(db, plan, write)).rejects.toThrow('IMPORT_PLAN_BLOCKED_OR_CHANGED');
  },
);
