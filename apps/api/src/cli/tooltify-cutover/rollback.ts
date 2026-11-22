import { z } from 'zod';
import { saleIdentity, saleTargetSnapshot } from './plan-targets';
import { bindWriterRevision, readCheckoutRevision } from './checkout-revision';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { hashImportValue as hash, receiptDigest } from './canonicalize';
import { assertImportDatabase, readImportDatabaseIdentity } from './plan';
import { lockRollbackTables, rollbackReferences } from './rollback-references';
import type { ReconciliationSnapshot, RollbackPlan, RollbackReceipt } from './types';

type Db = Prisma.TransactionClient;
function planHash(plan: Omit<RollbackPlan, 'planHash'> | RollbackPlan) {
  return hash({ ...plan, planHash: undefined });
}

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{40}(-dirty)?$/);
const reviewedSchema = z
  .object({
    operation: z.literal('ROLLBACK'),
    batchId: z.string().uuid(),
    kind: z.enum(['STOCK', 'SALES']),
    status: z.enum(['APPLYING', 'APPLIED', 'FAILED', 'VERIFIED']),
    manifestHash: digest,
    importPlanHash: digest,
    importRevision: z.string().min(1),
    codeRevision: revision,
    dbIdentity: digest,
    receiptHash: digest,
    targets: z.array(
      z
        .object({
          itemId: z.string().uuid(),
          targetId: z.string().uuid(),
          expectedFingerprint: digest,
          currentFingerprint: digest,
        })
        .strict(),
    ),
    references: z.record(z.number().int().positive()),
    blockers: z.array(z.string()),
    planHash: digest,
  })
  .strict();
export function parseReviewedRollback(value: unknown): RollbackPlan {
  const parsed = reviewedSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.planHash !== planHash(parsed.data) ||
    parsed.data.blockers.length ||
    Object.keys(parsed.data.references).length
  )
    throw Error('REVIEWED_ROLLBACK_PLAN_CHANGED');
  return parsed.data;
}

async function inspectRollback(
  tx: Db,
  batchId: string,
  codeRevision: string,
): Promise<RollbackPlan> {
  // PostgreSQL must error if a row-security policy would hide a reference.
  await tx.$executeRaw`SET LOCAL row_security = off`;
  const batch = await tx.tooltifyImportBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { items: { orderBy: { id: 'asc' } } },
  });
  if (batch.kind !== 'STOCK' && batch.kind !== 'SALES') throw Error('SUPPLIER_COMMAND_REQUIRED');
  if (batch.deletedAt) throw Error('BATCH_DELETED');
  const { items } = batch;
  const dbIdentity = (await readImportDatabaseIdentity(tx)).fingerprint;
  const targets: RollbackPlan['targets'] = [],
    blockers = new Set<string>();
  const done = batch.status === 'ROLLED_BACK';
  if (done && (!batch.rollbackPlanHash || !batch.rollbackCodeRevision))
    blockers.add('ROLLBACK_REPLAY_PROOF_MISSING');
  if (items.some((i) => i.deletedAt || !!i.reversedAt !== done))
    blockers.add('INVALID_ROLLBACK_PROVENANCE');
  const snapshot = batch.reconciliationSnapshot as unknown as ReconciliationSnapshot;
  if (
    ['VERIFIED', 'APPLIED'].includes(batch.status) &&
    receiptDigest(items) !== snapshot.expectedReceiptsHash
  )
    blockers.add('INVALID_ROLLBACK_PROVENANCE');
  const owned = items.filter((i) => i.disposition === 'CREATE');
  const ids = owned.flatMap((i) => (i.targetId ? [i.targetId] : []));
  const type = batch.kind === 'STOCK' ? 'PRODUCT' : 'IMPORTED_SALE';
  const liveIds = items.filter((i) => i.disposition !== 'EXCLUDE').map((i) => i.targetId);
  if (
    items.some((i) => i.targetType !== type) ||
    new Set(liveIds).size !== liveIds.length ||
    ids.length !== owned.length
  )
    blockers.add('INVALID_ROLLBACK_PROVENANCE');
  let references: RollbackPlan['references'] = {};
  if (!done) {
    // Include the ownership marker in the read to detect lost or misdirected receipts;
    // mutation below uses only revalidated receipt IDs, never this marker/prefix.
    const prefix = 'TTFY-CUTOVER:' + batch.id + ':';
    const products = await tx.product.findMany({
      where: {
        OR: [
          { legacyProductCode: { startsWith: prefix } },
          { id: { in: batch.kind === 'STOCK' ? ids : [] } },
        ],
      },
      include: { prices: { orderBy: { id: 'asc' } } },
    });
    const sales = await tx.importedSale.findMany({
      where: { OR: [{ importBatch: batch.id }, { id: { in: batch.kind === 'SALES' ? ids : [] } }] },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const saleById = new Map(sales.map((s) => [s.id, s]));
    if (
      (batch.kind === 'STOCK' ? products.length : sales.length) !== ids.length ||
      (batch.kind === 'STOCK' ? sales.length : products.length)
    )
      blockers.add('INVALID_ROLLBACK_PROVENANCE');
    for (const item of owned) {
      const id = item.targetId ?? '';
      const product = productById.get(id),
        sale = saleById.get(id);
      if (
        batch.kind === 'STOCK'
          ? !product || product.legacyProductCode !== prefix + item.sourceKey
          : !sale ||
            sale.importBatch !== batch.id ||
            sale.source !== 'TOOLTIFY' ||
            saleIdentity(sale, sale.sourceOccurrence) !== item.identityHash
      )
        blockers.add('INVALID_ROLLBACK_PROVENANCE');
      const currentFingerprint = product
        ? hash(product)
        : sale
          ? hash(saleTargetSnapshot(sale))
          : null;
      if (
        !item.afterFingerprint ||
        currentFingerprint !== item.afterFingerprint ||
        product?.deletedAt
      )
        blockers.add('TARGET_CHANGED');
      targets.push({
        itemId: item.id,
        targetId: id,
        expectedFingerprint: item.afterFingerprint ?? '',
        currentFingerprint,
      });
    }
    references = await rollbackReferences(tx, batch.id, type, ids);
    if (Object.keys(references).length) blockers.add('TARGET_IN_USE');
  }
  targets.sort((a, b) => a.targetId.localeCompare(b.targetId));
  const body: Omit<RollbackPlan, 'planHash'> = {
    operation: 'ROLLBACK',
    ...(done && batch.rollbackPlanHash && batch.rollbackCodeRevision
      ? {
          completedRollback: {
            planHash: batch.rollbackPlanHash,
            codeRevision: batch.rollbackCodeRevision,
          },
        }
      : {}),
    batchId,
    kind: batch.kind,
    status: batch.status,
    manifestHash: batch.manifestHash,
    importPlanHash: batch.planHash,
    importRevision: batch.codeRevision,
    codeRevision,
    dbIdentity,
    receiptHash: hash(items.map((i) => ({ ...i, reversedAt: undefined, updatedAt: undefined }))),
    targets,
    references,
    blockers: [...blockers].sort(),
  };
  return { ...body, planHash: planHash(body) };
}

export function planRollback(
  db: PrismaClient,
  batchId: string,
  codeRevision = readCheckoutRevision(false, __dirname),
) {
  return db.$transaction((tx) => inspectRollback(tx, batchId, codeRevision), {
    isolationLevel: 'RepeatableRead',
    timeout: 600000,
  });
}

export type Waiting = (state: {
  event: 'AWAITING_DATABASE_FREEZE';
  backendPid: number;
  waitSeconds: number;
}) => void;
export async function requireFreeze(tx: Db, waiting?: Waiting) {
  const [{ pid, visible, canPin }] = await tx.$queryRaw<
    { pid: number; visible: boolean; canPin: boolean }[]
  >`
    SELECT pg_backend_pid() AS pid, pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS visible,
      has_table_privilege(current_user,'pg_catalog.pg_database','UPDATE') AS "canPin"`;
  if (!visible) throw Error('ROLLBACK_FREEZE_VISIBILITY_REQUIRED');
  if (!canPin) throw Error('ROLLBACK_CATALOG_ROW_LOCK_PRIVILEGE_REQUIRED');
  const deadline = Date.now() + (waiting ? 60000 : 0);
  let announced = false;
  for (;;) {
    // Only lock an already-closed catalog row; the maintenance operator must be
    // able to close admission. A row lock holds that decision through commit.
    const closed = await tx.$queryRaw<{ oid: string }[]>`
      SELECT oid::text FROM pg_catalog.pg_database
      WHERE datname=current_database() AND NOT datallowconn FOR SHARE NOWAIT`;
    if (closed.length === 1) break;
    if (Date.now() >= deadline) throw Error('ROLLBACK_FREEZE_REQUIRED');
    if (!announced) {
      waiting?.({ event: 'AWAITING_DATABASE_FREEZE', backendPid: pid, waitSeconds: 60 });
      announced = true;
    }
    await delay(250);
  }
  await tx.$executeRaw`SELECT pg_catalog.pg_stat_clear_snapshot()`;
  const [proof] = await tx.$queryRaw<{ exclusive: boolean }[]>`
    WITH target AS (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
    SELECT NOT EXISTS (SELECT FROM pg_catalog.pg_stat_activity, target
      WHERE pid <> pg_backend_pid() AND (datid=target.oid OR (datid IS NULL AND backend_type='client backend')))
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_locks, target
        WHERE pid <> pg_backend_pid() AND locktype='object' AND classid='pg_catalog.pg_database'::regclass AND objid=target.oid)
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_prepared_xacts WHERE database=current_database())
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_subscription, target WHERE subdbid=target.oid AND subenabled)
      AS exclusive`;
  if (!proof.exclusive) throw Error('ROLLBACK_FREEZE_REQUIRED');
}

function rollbackCheckoutRevision() {
  return readCheckoutRevision(
    true,
    __dirname,
    __filename,
    'apps/api/src/cli/tooltify-cutover/rollback.ts',
  );
}

const attestRollbackRevision = bindWriterRevision(rollbackCheckoutRevision);

export async function applyRollback(
  db: PrismaClient,
  reviewed: RollbackPlan,
  waiting?: Waiting,
): Promise<RollbackReceipt> {
  reviewed = parseReviewedRollback(reviewed);
  const runningRevision = attestRollbackRevision(reviewed.codeRevision);
  return db.$transaction(
    async (tx) => {
      await assertImportDatabase(tx, reviewed.dbIdentity);
      await requireFreeze(tx, waiting);
      await lockRollbackTables(tx);
      const ids = reviewed.targets.map((t) => t.targetId);
      // Same order across plans. Table names come only from the two target kinds.
      const table = reviewed.kind === 'STOCK' ? Prisma.sql`products` : Prisma.sql`imported_sales`;
      await tx.$queryRaw`SELECT id FROM ${table} WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE NOWAIT`;
      const current = await inspectRollback(tx, reviewed.batchId, runningRevision);
      if (current.blockers.includes('TARGET_IN_USE')) throw Error('TARGET_IN_USE');
      if (current.blockers.length) throw Error(current.blockers[0]);
      if (
        reviewed.manifestHash !== current.manifestHash ||
        reviewed.importPlanHash !== current.importPlanHash ||
        reviewed.importRevision !== current.importRevision ||
        reviewed.kind !== current.kind
      )
        throw Error('REVIEWED_ROLLBACK_PLAN_CHANGED');
      // The operator handshake and the reference scan can outlast a checkout change.
      attestRollbackRevision(runningRevision);
      const receipt: RollbackReceipt = {
        operation: 'ROLLBACK',
        batchId: current.batchId,
        planHash: reviewed.planHash,
        importPlanHash: current.importPlanHash,
        dbIdentity: current.dbIdentity,
        codeRevision: runningRevision,
        status: 'ROLLED_BACK',
        products: 0,
        prices: 0,
        importedSales: 0,
        reversedItems: 0,
      };
      if (current.status === 'ROLLED_BACK') {
        const proof = current.completedRollback;
        if (
          proof?.planHash !== reviewed.planHash ||
          proof.codeRevision !== runningRevision ||
          current.receiptHash !== reviewed.receiptHash
        )
          throw Error('ROLLBACK_REPLAY_PROOF_MISMATCH');
        return receipt;
      }
      if (current.planHash !== reviewed.planHash) throw Error('REVIEWED_ROLLBACK_PLAN_CHANGED');
      const reversedAt = new Date();
      if (current.kind === 'STOCK') {
        receipt.prices = (
          await tx.productPrice.updateMany({
            where: { productId: { in: ids }, deletedAt: null },
            data: { deletedAt: reversedAt },
          })
        ).count;
        receipt.products = (
          await tx.product.updateMany({
            where: { id: { in: ids }, deletedAt: null },
            // The immutable stock receipt retains the original supplier link.
            // Release only the owned, fingerprint-verified product's live FK on reversal.
            data: { deletedAt: reversedAt, supplierId: null },
          })
        ).count;
      } else {
        receipt.importedSales = (
          await tx.importedSale.deleteMany({
            where: { id: { in: ids }, importBatch: current.batchId, source: 'TOOLTIFY' },
          })
        ).count;
      }
      if (receipt.products + receipt.importedSales !== ids.length)
        throw Error('ROLLBACK_COUNT_MISMATCH');
      receipt.reversedItems = (
        await tx.tooltifyImportItem.updateMany({
          where: { batchId: current.batchId, reversedAt: null, deletedAt: null },
          data: { reversedAt },
        })
      ).count;
      const pendingItems = await tx.tooltifyImportItem.count({
        where: { batchId: current.batchId, reversedAt: null },
      });
      const activePrices =
        current.kind === 'STOCK'
          ? await tx.productPrice.count({ where: { productId: { in: ids }, deletedAt: null } })
          : 0;
      if (pendingItems || activePrices) throw Error('ROLLBACK_COUNT_MISMATCH');
      await tx.tooltifyImportBatch.update({
        where: { id: current.batchId },
        data: {
          status: 'ROLLED_BACK',
          rollbackPlanHash: reviewed.planHash,
          rollbackCodeRevision: runningRevision,
        },
      });
      return receipt;
    },
    { isolationLevel: 'ReadCommitted', timeout: 660000 },
  );
}
