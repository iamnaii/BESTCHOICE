import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, expect, it } from 'vitest';
import { backfillBatteryHealth, BatteryBackfillPlan } from '../battery-backfill';
import { productData, stockInput } from './preflight-fixtures';
const db = new PrismaClient();
afterAll(() => db.$disconnect());
async function fixture() {
  const input = await stockInput(db, 2);
  const actor = await db.user.create({
    data: {
      name: 'Fixture',
      email: randomUUID() + '@example.invalid',
      password: 'fixture',
      role: 'OWNER',
    },
  });
  const products = await Promise.all(
    input.rows.map((r) =>
      db.product.create({
        data: {
          ...productData(r),
          stockInDate: new Date(r.importedAt),
          legacyProductCode: 'TTFY-CUTOVER:' + r.sourceKey,
        },
      }),
    ),
  );
  const plan: BatteryBackfillPlan = {
    operation: randomUUID(),
    actorId: actor.id,
    branchId: input.rows[0].branchId,
    sourceSha256: 'a'.repeat(64),
    rows: products.map((p, i) => ({
      id: p.id,
      imei: p.imeiSerial!,
      stockInDate: p.stockInDate!.toISOString(),
      batteryHealth: 81 + i,
      sourceRow: i + 100,
    })),
  };
  return { plan, products };
}
function untouched(p: Record<string, unknown>) {
  const { batteryHealth: _battery, updatedAt: _updated, ...rest } = p;
  return rest;
}
it('fills only health with atomic evidence and repeat application writes nothing', async () => {
  const { plan, products } = await fixture();
  expect(await db.$transaction((tx) => backfillBatteryHealth(tx, plan))).toMatchObject({
    changed: 2,
    applied: false,
  });
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: products[0].id } })).batteryHealth,
  ).toBeNull();
  expect(await db.$transaction((tx) => backfillBatteryHealth(tx, plan, true))).toMatchObject({
    changed: 2,
    matched: 0,
  });
  expect(await db.$transaction((tx) => backfillBatteryHealth(tx, plan, true))).toMatchObject({
    changed: 0,
    matched: 2,
  });
  for (let i = 0; i < products.length; i++) {
    const p = await db.product.findUniqueOrThrow({ where: { id: products[i].id } });
    expect(p.batteryHealth).toBe(81 + i);
    expect(untouched(p)).toEqual(untouched(products[i]));
    expect(
      await db.auditLog.count({
        where: { entityId: p.id, action: 'TOOLTIFY_BATTERY_HEALTH_IMPORTED' },
      }),
    ).toBe(1);
  }
});
it('rolls back every patch and audit if a later target already has a recorded value', async () => {
  const { plan, products } = await fixture();
  const sorted = [...products].sort((a, b) => a.id.localeCompare(b.id));
  await db.product.update({ where: { id: sorted[1].id }, data: { batteryHealth: 90 } });
  await expect(db.$transaction((tx) => backfillBatteryHealth(tx, plan, true))).rejects.toThrow(
    'BATTERY_ALREADY_RECORDED',
  );
  expect(
    (await db.product.findUniqueOrThrow({ where: { id: sorted[0].id } })).batteryHealth,
  ).toBeNull();
  expect(await db.auditLog.count({ where: { entityId: { in: products.map((p) => p.id) } } })).toBe(
    0,
  );
});
it('rejects another intake cycle or a sold device before changing it', async () => {
  const { plan, products } = await fixture();
  const differentCycle = structuredClone(plan);
  differentCycle.rows[0].stockInDate = '2025-01-01T00:00:00Z';
  await expect(
    db.$transaction((tx) => backfillBatteryHealth(tx, differentCycle, true)),
  ).rejects.toThrow('BATTERY_SOURCE_TARGET_MISMATCH');
  await db.product.update({ where: { id: products[0].id }, data: { status: 'SOLD_CASH' } });
  await expect(db.$transaction((tx) => backfillBatteryHealth(tx, plan, true))).rejects.toThrow(
    'BATTERY_SOURCE_TARGET_MISMATCH',
  );
});
