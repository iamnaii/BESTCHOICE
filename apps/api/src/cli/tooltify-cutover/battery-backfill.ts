import { Prisma } from '@prisma/client';
import { hashImportValue } from './canonicalize';

export type BatteryBackfillPlan = {
  operation: string;
  actorId: string;
  branchId: string;
  sourceSha256: string;
  rows: {
    id: string;
    imei: string;
    stockInDate: string;
    batteryHealth: number;
    sourceRow: number;
  }[];
};
const action = 'TOOLTIFY_BATTERY_HEALTH_IMPORTED';

/** Caller owns the transaction. Only batteryHealth is updated; audit is atomic with the patch. */
export async function backfillBatteryHealth(
  tx: Prisma.TransactionClient,
  plan: BatteryBackfillPlan,
  apply = false,
) {
  if (
    !plan.operation.trim() ||
    !/^[a-f0-9]{64}$/.test(plan.sourceSha256) ||
    !plan.rows.length ||
    new Set(plan.rows.map((r) => r.id)).size !== plan.rows.length ||
    new Set(plan.rows.map((r) => r.imei)).size !== plan.rows.length ||
    plan.rows.some(
      (r) =>
        !/^\d{15}$/.test(r.imei) ||
        !Number.isInteger(r.batteryHealth) ||
        r.batteryHealth < 0 ||
        r.batteryHealth > 100 ||
        !Number.isSafeInteger(r.sourceRow) ||
        r.sourceRow < 1 ||
        !Number.isFinite(new Date(r.stockInDate).getTime()),
    )
  )
    throw Error('INVALID_BATTERY_BACKFILL_PLAN');
  const branch = await tx.branch.findUniqueOrThrow({
    where: { id: plan.branchId },
    include: { company: true },
  });
  if (branch.deletedAt || !branch.isActive || branch.company?.companyCode !== 'SHOP')
    throw Error('INVALID_SHOP_BRANCH');
  const actor = await tx.user.findUniqueOrThrow({ where: { id: plan.actorId } });
  if (actor.deletedAt || !(actor.isSystemUser || actor.role === 'OWNER'))
    throw Error('INVALID_BACKFILL_ACTOR');
  const planHash = hashImportValue(plan);
  const rows = [...plan.rows].sort((a, b) => a.id.localeCompare(b.id));
  if (apply)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(rows.map((r) => r.id))}) ORDER BY id FOR UPDATE`,
    );
  let changed = 0,
    matched = 0;
  for (const r of rows) {
    const p = await tx.product.findUniqueOrThrow({
      where: { id: r.id },
      select: {
        id: true,
        imeiSerial: true,
        batteryHealth: true,
        stockInDate: true,
        branchId: true,
        deletedAt: true,
        status: true,
        category: true,
        legacyProductCode: true,
      },
    });
    if (
      p.deletedAt ||
      p.branchId !== plan.branchId ||
      p.imeiSerial !== r.imei ||
      !['IN_STOCK', 'QC_PENDING'].includes(p.status) ||
      !['PHONE_NEW', 'PHONE_USED', 'TABLET'].includes(p.category) ||
      !p.legacyProductCode?.startsWith('TTFY-CUTOVER:') ||
      p.stockInDate?.getTime() !== new Date(r.stockInDate).getTime()
    )
      throw Error('BATTERY_SOURCE_TARGET_MISMATCH:' + r.id);
    const audits = await tx.auditLog.findMany({
      where: {
        entity: 'products',
        entityId: r.id,
        action,
        newValue: { path: ['operation'], equals: plan.operation },
      },
    });
    if (audits.length) {
      const evidence = audits[0].newValue as Record<string, unknown>;
      if (
        audits.length !== 1 ||
        evidence.planHash !== planHash ||
        p.batteryHealth !== r.batteryHealth
      )
        throw Error('BATTERY_BACKFILL_REPLAY_CONFLICT');
      matched++;
      continue;
    }
    if (p.batteryHealth !== null) throw Error('BATTERY_ALREADY_RECORDED:' + r.id);
    if (apply) {
      const result = await tx.product.updateMany({
        where: { id: r.id, batteryHealth: null, deletedAt: null, status: p.status },
        data: { batteryHealth: r.batteryHealth },
      });
      if (result.count !== 1) throw Error('BATTERY_TARGET_CHANGED');
      await tx.auditLog.create({
        data: {
          userId: plan.actorId,
          action,
          entity: 'products',
          entityId: r.id,
          oldValue: { batteryHealth: null },
          newValue: {
            batteryHealth: r.batteryHealth,
            operation: plan.operation,
            planHash,
            sourceSha256: plan.sourceSha256,
            sourceRow: r.sourceRow,
          },
        },
      });
    }
    changed++;
  }
  return { planHash, changed, matched, applied: apply };
}
