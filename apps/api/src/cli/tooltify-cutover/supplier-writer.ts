import { requireFreeze, type Waiting } from './rollback';
import { Prisma, PrismaClient } from '@prisma/client';
import { ContactResolverService } from '../../modules/contacts/contact-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createSupplierInTransaction } from '../../modules/suppliers/create-supplier-in-transaction';
import { hashImportValue as hash } from './canonicalize';
import { itemTransaction } from './batch';
import { validateSupplierInputs } from './supplier-input';
import {
  assertSupplierContext,
  desiredPayments,
  evaluateSupplier,
  supplierBatchId,
  supplierInclude,
  supplierPlanHash,
  supplierTargetFingerprint,
} from './supplier-plan';
import type { PlannedSupplierItem, SupplierImportPlan } from './supplier-plan';
type Tx = Prisma.TransactionClient;
function assertPlan(p: SupplierImportPlan) {
  if (
    p.version !== 1 ||
    p.kind !== 'SUPPLIER' ||
    !p.items?.length ||
    p.issues.length ||
    new Set(p.items.filter((i) => i.disposition === 'MATCH').map((i) => i.targetId)).size !==
      p.items.filter((i) => i.disposition === 'MATCH').length ||
    p.batchId !== supplierBatchId(p.context) ||
    supplierPlanHash(p) !== p.planHash ||
    p.items.some((i) => !['CREATE', 'MATCH'].includes(i.disposition) || i.reason) ||
    validateSupplierInputs(p.items.map((i) => i.payload)).issues.length ||
    hash({ rows: p.items.map((i) => i.payload), context: p.context }) !== p.inputHash
  )
    throw Error('IMPORT_PLAN_BLOCKED_OR_CHANGED');
}
async function lock(tx: Tx, p: SupplierImportPlan) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('tooltify-suppliers',0))`;
  await assertSupplierContext(tx, p.context);
}
function provenance(p: SupplierImportPlan, i: PlannedSupplierItem) {
  return {
    sourceKey: i.supplierRef,
    payloadHash: hash(i.payload),
    identityHash: hash(['TOOLTIFY', p.context.accessBranchId, i.supplierRef]),
    dependencyFingerprint: i.dependencyFingerprint,
  };
}
export async function writeSupplierItem(
  tx: Tx,
  item: PlannedSupplierItem,
  plan: SupplierImportPlan,
) {
  const r = item.payload;
  if (item.disposition !== 'CREATE' || item.targetId || validateSupplierInputs([r]).issues.length)
    throw Error('IMPORT_CREATE_REQUIRED');
  const resolver = new ContactResolverService(tx as unknown as PrismaService);
  const result = await createSupplierInTransaction(
    tx,
    {
      type: r.type!,
      name: r.legalName!,
      phone: r.phone!,
      taxId: r.taxId ?? undefined,
      branchCode: r.branchCode ?? undefined,
      address: r.address ?? undefined,
      lineId: r.lineId ?? undefined,
      contactName: r.contactName ?? undefined,
      hasVat: r.hasVat!,
      nickname: r.displayName,
      notes: [r.notes, 'Tooltify ' + r.supplierRef, 'Aliases: ' + r.aliases.join(' / ')]
        .filter(Boolean)
        .join('\n'),
      paymentMethods: desiredPayments(r).map((p) => ({
        paymentMethod: p.paymentMethod,
        isDefault: p.isDefault,
        creditTermDays: p.creditTermDays!,
        bankName: p.bankName ?? undefined,
        bankAccountName: p.bankAccountName ?? undefined,
        bankAccountNumber: p.bankAccountNumber ?? undefined,
      })),
    },
    {
      resolver,
      accessCompanyCode: 'SHOP',
      accessBranchId: plan.context.accessBranchId,
      contactOrigin: { accessCompanyCode: 'SHOP', accessBranchId: plan.context.accessBranchId },
    },
  );
  return {
    targetType: 'SUPPLIER' as const,
    targetId: result.supplier.id,
    contactId: result.supplier.contactId!,
    contactCreated: result.contactCreated,
    afterFingerprint: await supplierTargetFingerprint(tx, result.supplier.id),
  };
}
async function verifyInTransaction(tx: Tx, p: SupplierImportPlan) {
  const batch = await tx.tooltifyImportBatch.findUniqueOrThrow({
    where: { id: p.batchId },
    include: { items: { orderBy: { sourceKey: 'asc' } } },
  });
  if (
    batch.kind !== 'SUPPLIER' ||
    batch.deletedAt ||
    batch.planHash !== p.planHash ||
    batch.manifestHash !== p.inputHash
  )
    throw Error('IMPORT_BATCH_INPUT_CHANGED');
  if (batch.status === 'ROLLED_BACK') throw Error('ROLLED_BACK_NEW_INSPECTED_RUN_REQUIRED');
  if (!['APPLIED', 'VERIFIED'].includes(batch.status) || batch.items.length !== p.items.length)
    throw Error('SUPPLIER_RECEIPTS_INCOMPLETE');
  for (const i of p.items) {
    const r = batch.items.find((r) => r.sourceKey === i.supplierRef);
    if (
      !r ||
      r.targetType !== 'SUPPLIER' ||
      r.disposition !== i.disposition ||
      r.deletedAt ||
      r.reversedAt ||
      !r.targetId ||
      r.payloadHash !== hash(i.payload) ||
      r.identityHash !== provenance(p, i).identityHash ||
      r.dependencyFingerprint !== i.dependencyFingerprint
    )
      throw Error('SUPPLIER_RECEIPTS_INCOMPLETE');
    if (
      hash({
        target: await supplierTargetFingerprint(tx, r.targetId),
        sourceRefs: r.sourceRefs,
      }) !== r.afterFingerprint
    )
      throw Error('SUPPLIER_TARGET_CHANGED');
  }
  return {
    batch,
    report: {
      batchId: p.batchId,
      created: p.items.filter((i) => i.disposition === 'CREATE').length,
      matched: p.items.filter((i) => i.disposition === 'MATCH').length,
      verified: true as const,
    },
  };
}
export async function applySuppliers(db: PrismaClient, p: SupplierImportPlan) {
  assertPlan(p);
  return itemTransaction(db, async (tx) => {
    await lock(tx, p);
    const existing = await tx.tooltifyImportBatch.findUnique({ where: { id: p.batchId } });
    if (existing) return (await verifyInTransaction(tx, p)).report;
    for (const i of p.items)
      if (hash(await evaluateSupplier(tx, i.payload, p.context)) !== hash(i))
        throw Error('IMPORT_DEPENDENCY_CHANGED');
    await tx.tooltifyImportBatch.create({
      data: {
        id: p.batchId,
        kind: 'SUPPLIER',
        canonicalSetId: p.context.canonicalSetId,
        manifestHash: p.inputHash,
        planHash: p.planHash,
        codeRevision: p.context.codeRevision,
        sourceCutoverAt: new Date(p.context.cutoverAt),
        status: 'APPLYING',
        reconciliationSnapshot: {
          cannotVerifySource: false,
          supplierPlan: JSON.parse(JSON.stringify(p)),
        },
      },
    });
    for (const i of p.items) {
      const result =
        i.disposition === 'MATCH' && i.targetId
          ? {
              targetId: i.targetId,
              afterFingerprint: await supplierTargetFingerprint(tx, i.targetId),
              contactId: null,
              contactCreated: false,
            }
          : await writeSupplierItem(tx, i, p);
      const sourceRefs = [
        ...i.payload.evidenceRefs,
        { contactId: result.contactId, contactCreated: result.contactCreated },
      ];
      await tx.tooltifyImportItem.create({
        data: {
          batchId: p.batchId,
          ...provenance(p, i),
          disposition: i.disposition,
          targetType: 'SUPPLIER',
          targetId: result.targetId,
          afterFingerprint: hash({ target: result.afterFingerprint, sourceRefs }),
          sourceRefs,
        },
      });
    }
    await tx.tooltifyImportBatch.update({ where: { id: p.batchId }, data: { status: 'APPLIED' } });
    return (await verifyInTransaction(tx, p)).report;
  });
}
export async function verifySuppliers(db: PrismaClient, p: SupplierImportPlan) {
  assertPlan(p);
  return itemTransaction(db, async (tx) => {
    await lock(tx, p);
    return (await verifyInTransaction(tx, p)).report;
  });
}
const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
async function hasReferences(tx: Tx, table: string, id: string, ownedSuppliers: string[]) {
  const fks = await tx.$queryRaw<
    { schema: string; table: string; column: string; arity: number }[]
  >`
 SELECT ns.nspname AS schema,c.relname AS table,a.attname AS column,cardinality(k.conkey) AS arity
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.conkey[1]
 WHERE k.contype='f' AND k.confrelid=to_regclass(${table})`;
  for (const fk of fks) {
    if (fk.arity !== 1) throw Error('SUPPLIER_REFERENCE_SCHEMA_CHANGED');
    if (table === 'suppliers' && fk.table === 'supplier_payment_methods') continue;
    const skip =
      table === 'contacts' && fk.table === 'suppliers' && ownedSuppliers.length
        ? Prisma.sql` AND id NOT IN (${Prisma.join(ownedSuppliers)})`
        : Prisma.empty;
    const rows = await tx.$queryRaw<{ found: boolean }[]>(
      Prisma.sql`SELECT EXISTS(SELECT 1 FROM ${Prisma.raw(quote(fk.schema) + '.' + quote(fk.table))} WHERE ${Prisma.raw(quote(fk.column))}=${id}${skip}) AS found`,
    );
    if (rows[0].found) return true;
  }
  return false;
}
export async function rollbackSuppliers(
  db: PrismaClient,
  p: SupplierImportPlan,
  waiting?: Waiting,
) {
  assertPlan(p);
  return db.$transaction(
    async (tx) => {
      await requireFreeze(tx, waiting);
      await lock(tx, p);
      await tx.$executeRaw`SET LOCAL row_security = off`;
      const existing = await tx.tooltifyImportBatch.findUniqueOrThrow({
        where: { id: p.batchId },
        include: { items: true },
      });
      if (existing.kind !== 'SUPPLIER' || existing.planHash !== p.planHash || existing.deletedAt)
        throw Error('IMPORT_BATCH_INPUT_CHANGED');
      if (existing.status === 'ROLLED_BACK') {
        if (existing.rollbackPlanHash !== p.planHash || existing.items.some((i) => !i.reversedAt))
          throw Error('INVALID_ROLLBACK_PROVENANCE');
        for (const r of existing.items.filter((i) => i.disposition === 'CREATE')) {
          const proof = (r.sourceRefs as Prisma.JsonArray).find(
            (v) => v && typeof v === 'object' && !Array.isArray(v) && 'rollbackFingerprint' in v,
          ) as { rollbackFingerprint: string } | undefined;
          if (
            !proof ||
            (await supplierTargetFingerprint(tx, r.targetId!)) !== proof.rollbackFingerprint
          )
            throw Error('SUPPLIER_TARGET_CHANGED');
        }
        return { batchId: p.batchId, rolledBack: true };
      }
      const ids = existing.items.filter((i) => i.disposition === 'CREATE').map((i) => i.targetId!);
      if (ids.length)
        await tx.$queryRaw`SELECT id FROM suppliers WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      const { batch } = await verifyInTransaction(tx, p);
      const ownedContacts: string[] = [];
      for (const r of batch.items.filter((i) => i.disposition === 'CREATE')) {
        if (await hasReferences(tx, 'suppliers', r.targetId!, []))
          throw Error('SUPPLIER_TARGET_IN_USE');
        if (
          await tx.tooltifyImportItem.count({
            where: {
              targetType: 'SUPPLIER',
              targetId: r.targetId,
              batchId: { not: p.batchId },
              reversedAt: null,
              deletedAt: null,
            },
          })
        )
          throw Error('SUPPLIER_TARGET_IN_USE');
        const meta = (r.sourceRefs as Prisma.JsonArray).find(
          (v) => v && typeof v === 'object' && !Array.isArray(v) && 'contactCreated' in v,
        ) as { contactCreated: boolean; contactId: string } | undefined;
        if (!meta) throw Error('INVALID_ROLLBACK_PROVENANCE');
        if (meta.contactCreated) {
          await tx.$queryRaw`SELECT id FROM contacts WHERE id=${meta.contactId} FOR UPDATE`;
          if (await hasReferences(tx, 'contacts', meta.contactId, ids))
            throw Error('SUPPLIER_CONTACT_IN_USE');
          ownedContacts.push(meta.contactId);
        }
      }
      const now = new Date();
      await tx.supplierPaymentMethod.updateMany({
        where: { supplierId: { in: ids } },
        data: { deletedAt: now },
      });
      await tx.supplier.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: now, isActive: false },
      });
      await tx.contact.updateMany({
        where: { id: { in: ownedContacts } },
        data: { deletedAt: now, isActive: false },
      });
      for (const r of batch.items)
        await tx.tooltifyImportItem.update({
          where: { id: r.id },
          data: {
            reversedAt: now,
            ...(r.disposition === 'CREATE'
              ? {
                  sourceRefs: [
                    ...(r.sourceRefs as Prisma.JsonArray),
                    { rollbackFingerprint: await supplierTargetFingerprint(tx, r.targetId!) },
                  ],
                }
              : {}),
          },
        });
      await tx.tooltifyImportBatch.update({
        where: { id: p.batchId },
        data: {
          status: 'ROLLED_BACK',
          rollbackPlanHash: p.planHash,
          rollbackCodeRevision: p.context.codeRevision,
        },
      });
      return { batchId: p.batchId, rolledBack: true };
    },
    { isolationLevel: 'ReadCommitted', timeout: 660000 },
  );
}
