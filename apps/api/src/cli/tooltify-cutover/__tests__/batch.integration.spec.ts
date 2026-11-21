import { PrismaClient } from '@prisma/client';
import { afterAll, expect, it, vi } from 'vitest';
import { applyBatch } from '../batch';
import { buildImportPlan, stockTargetFingerprint } from '../plan';
import { hashSourceDecisions } from '../canonicalize';
import type { CanonicalInput } from '../types';
import { createFixtureTarget, productData, stockInput } from './preflight-fixtures';

const db = new PrismaClient();
afterAll(() => db.$disconnect());

it('rolls back target and item together when the callback fails', async () => {
  const input = await stockInput(db);
  const plan = await buildImportPlan(db, input);
  await expect(
    applyBatch(db, plan, async (tx, item) => {
      await createFixtureTarget(tx, item);
      throw Error('injected crash');
    }),
  ).rejects.toThrow('injected crash');
  expect(await db.product.count({ where: { imeiSerial: input.rows[0].barcode } })).toBe(0);
  expect(await db.tooltifyImportItem.count({ where: { batchId: plan.batchId } })).toBe(0);
});
it('rejects a callback that claims a target without the durable batch ownership marker', async () => {
  const input = await stockInput(db);
  const plan = await buildImportPlan(db, input);
  await expect(
    applyBatch(db, plan, async (tx, item) => {
      const target = await createFixtureTarget(tx, item);
      await tx.product.update({
        where: { id: target.targetId },
        data: { legacyProductCode: null },
      });

      return { ...target, afterFingerprint: await stockTargetFingerprint(tx, target.targetId) };
    }),
  ).rejects.toThrow('IMPORT_TARGET_OWNERSHIP_MISMATCH');
  expect(await db.product.count({ where: { imeiSerial: input.rows[0].barcode } })).toBe(0);
});
it('resumes a committed item using its receipt after a later callback crashes', async () => {
  const input = await stockInput(db, 2);
  const plan = await buildImportPlan(db, input);
  let calls = 0;
  await expect(
    applyBatch(db, plan, async (tx, item) => {
      if (++calls === 2) throw Error('crash');
      return createFixtureTarget(tx, item);
    }),
  ).rejects.toThrow('crash');
  const resumed = await buildImportPlan(db, input);
  expect(resumed.planHash).toBe(plan.planHash);
  const write = vi.fn(createFixtureTarget);
  expect(await applyBatch(db, resumed, write)).toMatchObject({ created: 2, status: 'APPLIED' });
  expect(write).toHaveBeenCalledTimes(1);
  await applyBatch(db, plan, write);
  expect(write).toHaveBeenCalledTimes(1);
});
it('rejects changed input on the same canonical set', async () => {
  const input = await stockInput(db);
  const plan = await buildImportPlan(db, input);
  await applyBatch(db, plan, createFixtureTarget);
  input.rows[0].cost = '250.00';
  await expect(buildImportPlan(db, input)).rejects.toThrow();
});
it('serializes independent dry-runs and binds both to one batch', async () => {
  const input = await stockInput(db);
  const plans = await Promise.all([buildImportPlan(db, input), buildImportPlan(db, input)]);
  const write = vi.fn(createFixtureTarget);
  const receipts = await Promise.all(plans.map((plan) => applyBatch(db, plan, write)));
  expect(receipts[0]).toEqual(receipts[1]);
  expect(write).toHaveBeenCalledTimes(1);
});
it('refuses a changed committed target and keeps status history on crash and resume', async () => {
  const input = await stockInput(db, 2);
  const plan = await buildImportPlan(db, input);
  let calls = 0;
  await expect(
    applyBatch(db, plan, async (tx, item) => {
      if (++calls === 2) throw Error('crash');
      return createFixtureTarget(tx, item);
    }),
  ).rejects.toThrow('crash');
  await applyBatch(db, plan, createFixtureTarget);
  const history = await db.tooltifyImportStatusEvent.findMany({
    where: { batchId: plan.batchId },
    orderBy: { createdAt: 'asc' },
  });
  expect(history.map((e) => e.status)).toEqual(['APPLYING', 'FAILED', 'APPLYING', 'APPLIED']);
  await db.product.updateMany({
    where: { imeiSerial: input.rows[0].barcode },
    data: { cashPrice: '999.00' },
  });
  await expect(buildImportPlan(db, input)).rejects.toThrow('IMPORT_ITEM_TARGET_CHANGED');
  await expect(applyBatch(db, plan, createFixtureTarget)).rejects.toThrow(
    'IMPORT_ITEM_TARGET_CHANGED',
  );
});
it('persists excluded source evidence once across concurrent apply attempts', async () => {
  const input: CanonicalInput = await stockInput(db, 2);
  const row = input.rows.pop()!;
  input.decisions.entries.push({
    fileSha256: row.source.fileSha256,
    sourceRows: [row.source.row],
    action: 'EXCLUDE_ROW',
    reason: 'fixture service row',
    evidenceRef: 'fixture-count',
  });
  input.excluded.push({ source: row.source, sourceKey: null, reason: 'EXCLUDE_ROW' });
  input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
  const plan = await buildImportPlan(db, input);
  const receipts = await Promise.all([
    applyBatch(db, plan, createFixtureTarget),
    applyBatch(db, plan, createFixtureTarget),
  ]);
  expect(receipts[0]).toMatchObject({ excluded: 1, created: 1 });
  const exclusion = await db.tooltifyImportItem.findFirstOrThrow({
    where: { batchId: plan.batchId, disposition: 'EXCLUDE' },
  });
  expect(exclusion.targetId).toBeNull();
  expect(exclusion.sourceRefs).toEqual([
    { ...row.source, reason: 'EXCLUDE_ROW', canonicalSourceKey: null },
  ]);
});
it('does not swallow a new conflicting identity', async () => {
  const input = await stockInput(db);
  const plan = await buildImportPlan(db, input);
  await db.product.create({ data: { ...productData(input.rows[0]), costPrice: '3.00' } });
  await expect(applyBatch(db, plan, createFixtureTarget)).rejects.toThrow();
  expect(await db.tooltifyImportItem.count({ where: { batchId: plan.batchId } })).toBe(0);
});
