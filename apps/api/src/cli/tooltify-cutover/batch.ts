import { Prisma, PrismaClient, type TooltifyImportBatch } from '@prisma/client';
import { assertImportDatabase, computePlanHash, replayItem } from './plan';
import {
  assertCreatedTarget,
  evaluateItem,
  identityHash,
  sourceRefJson,
  salesTargetFingerprint,
  stockTargetFingerprint,
} from './plan-targets';
import { hashImportValue as hash } from './canonicalize';
import type {
  ApplyReceipt,
  ImportPlan,
  PlannedExclusion,
  PlannedItem,
  TargetWriteResult,
} from './types';

type Db = Prisma.TransactionClient;
type Writer = (tx: Db, item: PlannedItem) => Promise<TargetWriteResult>;
async function lock(tx: Db, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
}
function setKey(plan: ImportPlan) {
  return { canonicalSetId_kind: { canonicalSetId: plan.canonicalSetId, kind: plan.kind } };
}
async function lockBatch(tx: Db, plan: ImportPlan) {
  await lock(tx, 'tooltify-set:' + hash(setKey(plan)));
  const batch = await tx.tooltifyImportBatch.findUnique({ where: setKey(plan) });
  if (
    batch &&
    (batch.planHash !== plan.planHash ||
      batch.manifestHash !== plan.manifestHash ||
      batch.deletedAt ||
      batch.status === 'ROLLED_BACK')
  )
    throw Error('IMPORT_BATCH_INPUT_CHANGED');
  return batch;
}

async function checkItem(tx: Db, item: PlannedItem) {
  const receipt = await tx.tooltifyImportItem.findUnique({
    where: { batchId_sourceKey: { batchId: item.batchId, sourceKey: item.sourceKey } },
  });
  const current = receipt ? await replayItem(tx, item, receipt) : await evaluateItem(tx, item);
  if (current.reason || hash(current) !== hash(item)) throw Error('IMPORT_DEPENDENCY_CHANGED');
  return receipt;
}

async function persistItem(tx: Db, item: PlannedItem, applyItem: Writer) {
  // The legacy bill uniqueness decision spans all lines in a bill, even with different barcodes.
  await lock(
    tx,
    item.kind === 'SALES'
      ? 'tooltify-bill:' + hash(item.payload.orderNumber)
      : 'tooltify-unit:' + identityHash(item),
  );
  // A competing importer may have committed while this SERIALIZABLE transaction waited for
  // the advisory lock. Locking the versioned progress row forces a retry before the callback.
  await tx.$queryRaw`SELECT id FROM tooltify_import_batches WHERE id=${item.batchId} FOR UPDATE`;
  if (await checkItem(tx, item)) return;
  const targetType = item.kind === 'STOCK' ? 'PRODUCT' : 'IMPORTED_SALE';
  const fingerprint = item.kind === 'STOCK' ? stockTargetFingerprint : salesTargetFingerprint;
  // MATCH never calls a writer and never owns the target for a later reversal.
  const result =
    item.disposition === 'MATCH' && item.targetId
      ? {
          targetId: item.targetId,
          targetType,
          created: false,
          afterFingerprint: await fingerprint(tx, item.targetId),
        }
      : await applyItem(tx, item);
  if (
    result.targetType !== targetType ||
    result.created !== (item.disposition === 'CREATE') ||
    !result.targetId ||
    result.afterFingerprint !== (await fingerprint(tx, result.targetId))
  )
    throw Error('IMPORT_WRITER_RECEIPT_MISMATCH');
  if (result.created) await assertCreatedTarget(tx, item, result.targetId);
  await tx.tooltifyImportItem.create({
    data: {
      batchId: item.batchId,
      sourceKey: item.sourceKey,
      sourceRefs: [sourceRefJson(item.payload.source)],
      identityHash: identityHash(item),
      payloadHash: item.payloadHash,
      dependencyFingerprint: item.dependencyFingerprint,
      ...(item.kind === 'STOCK' ? { stockResolution: item.resolution } : {}),
      disposition: item.disposition,
      targetType,
      targetId: result.targetId,
      afterFingerprint: result.afterFingerprint,
    },
  });
  await tx.tooltifyImportBatch.update({
    where: { id: item.batchId },
    data: { updatedAt: new Date() },
  });
}

async function persistExclusion(tx: Db, batch: TooltifyImportBatch, e: PlannedExclusion) {
  await tx.$queryRaw`SELECT id FROM tooltify_import_batches WHERE id=${batch.id} FOR UPDATE`;
  const refs = [{ ...sourceRefJson(e.source), reason: e.reason, canonicalSourceKey: e.sourceKey }];
  const where = { batchId_sourceKey: { batchId: batch.id, sourceKey: e.receiptKey } };
  const receipt = await tx.tooltifyImportItem.findUnique({ where });
  if (receipt) {
    if (
      receipt.deletedAt ||
      receipt.reversedAt ||
      receipt.disposition !== 'EXCLUDE' ||
      receipt.payloadHash !== e.payloadHash ||
      hash(receipt.sourceRefs) !== hash(refs)
    )
      throw Error('IMPORT_EXCLUSION_CHANGED');
    return;
  }
  if (batch.status === 'APPLIED' || batch.status === 'VERIFIED')
    throw Error('IMPORT_EXCLUSION_RECEIPT_MISSING');
  await tx.tooltifyImportBatch.update({ where: { id: batch.id }, data: { updatedAt: new Date() } });
  await tx.tooltifyImportItem.create({
    data: {
      batchId: batch.id,
      sourceKey: e.receiptKey,
      sourceRefs: refs,
      payloadHash: e.payloadHash,
      dependencyFingerprint: e.payloadHash,
      identityHash: e.receiptKey,
      disposition: 'EXCLUDE',
      targetType: batch.kind === 'STOCK' ? 'PRODUCT' : 'IMPORTED_SALE',
    },
  });
}

async function itemTransaction<T>(db: PrismaClient, operation: (tx: Db) => Promise<T>): Promise<T> {
  // A waiter can take its serializable snapshot before the preceding advisory-lock holder commits.
  // Re-run only database serialization failures; business conflicts and callback errors remain visible.
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(operation, { isolationLevel: 'Serializable', timeout: 30000 });
    } catch (e) {
      if (
        attempt >= 4 ||
        !(e instanceof Prisma.PrismaClientKnownRequestError) ||
        !(e.code === 'P2034' || (e.code === 'P2010' && e.meta?.code === '40001'))
      )
        throw e;
    }
  }
}

export async function applyBatch(
  db: PrismaClient,
  plan: ImportPlan,
  applyItem: Writer,
): Promise<ApplyReceipt> {
  if (
    plan.issues.length ||
    plan.items.some((i) => !['CREATE', 'MATCH'].includes(i.disposition)) ||
    computePlanHash(plan) !== plan.planHash
  )
    throw Error('IMPORT_PLAN_BLOCKED_OR_CHANGED');
  const batch = await db.$transaction(
    async (tx) => {
      await assertImportDatabase(tx, plan.dbIdentity);
      const existing = await lockBatch(tx, plan);
      // Reject a stale dry-run before allocating a durable batch or writing any targets.
      for (const item of plan.items) {
        const receipt = await checkItem(tx, { ...item, batchId: existing?.id ?? plan.batchId });
        if (!receipt && (existing?.status === 'APPLIED' || existing?.status === 'VERIFIED'))
          throw Error('IMPORT_ITEM_RECEIPT_MISSING');
      }
      if (existing) {
        if (existing.status === 'FAILED')
          return tx.tooltifyImportBatch.update({
            where: { id: existing.id },
            data: { status: 'APPLYING' },
          });
        return existing;
      }
      return tx.tooltifyImportBatch.create({
        data: {
          id: plan.batchId,
          kind: plan.kind,
          canonicalSetId: plan.canonicalSetId,
          manifestHash: plan.manifestHash,
          planHash: plan.planHash,
          reconciliationSnapshot: plan.reconciliationSnapshot,
          status: 'APPLYING',
          codeRevision: plan.codeRevision,
          sourceCutoverAt: new Date(plan.sourceCutoverAt),
        },
      });
    },
    { timeout: 600000 },
  );
  try {
    for (const item of plan.items)
      await itemTransaction(db, async (tx) => {
        const current = await lockBatch(tx, plan);
        if (!current || current.id !== batch.id) throw Error('IMPORT_BATCH_MISSING');
        await persistItem(tx, { ...item, batchId: batch.id }, applyItem);
      });
    for (const excluded of plan.excluded)
      await itemTransaction(db, async (tx) => {
        const current = await lockBatch(tx, plan);
        if (!current || current.id !== batch.id) throw Error('IMPORT_BATCH_MISSING');
        await persistExclusion(tx, current, excluded);
      });
    return await db.$transaction(async (tx) => {
      const current = await lockBatch(tx, plan);
      if (!current || current.id !== batch.id) throw Error('IMPORT_BATCH_MISSING');
      const items = await tx.tooltifyImportItem.groupBy({
        by: ['disposition'],
        where: { batchId: batch.id, deletedAt: null, reversedAt: null },
        _count: true,
      });
      const count = (d: string) => items.find((i) => i.disposition === d)?._count ?? 0;
      const created = count('CREATE'),
        matched = count('MATCH'),
        excluded = count('EXCLUDE');
      if (
        created !== plan.totals.created ||
        matched !== plan.totals.matched ||
        excluded !== plan.totals.excluded
      )
        throw Error('IMPORT_BATCH_COUNTS_CHANGED');
      if (current.status !== 'VERIFIED' && current.status !== 'APPLIED')
        await tx.tooltifyImportBatch.update({
          where: { id: batch.id },
          data: { status: 'APPLIED' },
        });
      return { batchId: batch.id, created, matched, excluded, status: 'APPLIED' as const };
    });
  } catch (error) {
    await db.$transaction(async (tx) => {
      const current = await lockBatch(tx, plan);
      if (current?.status === 'APPLYING')
        await tx.tooltifyImportBatch.update({
          where: { id: current.id },
          data: { status: 'FAILED' },
        });
    });
    throw error;
  }
}
