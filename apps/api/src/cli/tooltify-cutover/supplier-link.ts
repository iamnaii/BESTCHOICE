import { Prisma } from '@prisma/client';
import { hashImportValue as hash } from './canonicalize';
import { normalizeSupplierAlias } from './supplier-input';
import { supplierPlanHash, supplierTargetFingerprint } from './supplier-plan';
import type { SupplierImportPlan } from './supplier-plan';
import type { CanonicalStockUnit, SourceDecision } from './types';
export type SupplierLinkDecision =
  | { mode: 'NO_SUPPLIER' }
  | { mode: 'LINK'; supplierRef: string; batchId: string; targetId: string };
export type StockSupplierLink = {
  targetId: string | null;
  supplierRef: string | null;
  batchId: string | null;
  fingerprint: string;
};
const selfPurchase = new Set(['', '-', 'รับซื้อเอง', 'รับซื้อ', 'ซื้อเอง']);
export async function resolveStockSupplier(
  tx: Prisma.TransactionClient,
  raw: CanonicalStockUnit,
  decision: Extract<SourceDecision, { action: 'RESOLVE_STOCK' }> | null,
): Promise<StockSupplierLink | undefined> {
  const link = decision?.supplier;
  // Old receipts/fixtures without a source column retain their pre-supplier shape.
  // Every newly parsed source with the column carries an explicit string, including blank.
  if (raw.supplierLabel === undefined && !link) return undefined;
  if (!link || !decision?.evidenceRef?.trim()) throw Error('SUPPLIER_LINK_REQUIRED');
  if (link.mode === 'NO_SUPPLIER') {
    if (!selfPurchase.has(normalizeSupplierAlias(raw.supplierLabel ?? '')))
      throw Error('SUPPLIER_UNKNOWN_SOURCE_LABEL');
    return {
      targetId: null,
      supplierRef: null,
      batchId: null,
      fingerprint: hash({ label: raw.supplierLabel, link, evidence: decision.evidenceRef }),
    };
  }
  if (link.mode !== 'LINK') throw Error('SUPPLIER_LINK_REQUIRED');
  const batch = await tx.tooltifyImportBatch.findUnique({
    where: { id: link.batchId },
    include: { items: true },
  });
  if (
    !batch ||
    batch.kind !== 'SUPPLIER' ||
    batch.deletedAt ||
    !['APPLIED', 'VERIFIED'].includes(batch.status)
  )
    throw Error('SUPPLIER_BATCH_NOT_APPLIED');
  const plan = (batch.reconciliationSnapshot as unknown as { supplierPlan: SupplierImportPlan })
    .supplierPlan;
  if (
    !plan ||
    supplierPlanHash(plan) !== batch.planHash ||
    plan.context.accessCompanyCode !== 'SHOP' ||
    plan.context.accessBranchId !== raw.branchId
  )
    throw Error('SUPPLIER_LINK_SCOPE_MISMATCH');
  const item = plan.items.find((i) => i.supplierRef === link.supplierRef);
  const receipt = batch.items.find((i) => i.sourceKey === link.supplierRef);
  if (
    !item ||
    !receipt ||
    receipt.deletedAt ||
    receipt.reversedAt ||
    receipt.targetType !== 'SUPPLIER' ||
    receipt.targetId !== link.targetId ||
    receipt.payloadHash !== hash(item.payload)
  )
    throw Error('SUPPLIER_RECEIPTS_INCOMPLETE');
  if (
    !item.payload.aliases.some(
      (a) => normalizeSupplierAlias(a) === normalizeSupplierAlias(raw.supplierLabel ?? ''),
    )
  )
    throw Error('SUPPLIER_SOURCE_ALIAS_MISMATCH');
  const current = await supplierTargetFingerprint(tx, link.targetId);
  if (hash({ target: current, sourceRefs: receipt.sourceRefs }) !== receipt.afterFingerprint)
    throw Error('SUPPLIER_TARGET_CHANGED');
  return {
    targetId: link.targetId,
    supplierRef: link.supplierRef,
    batchId: link.batchId,
    fingerprint: hash({
      current,
      receiptId: receipt.id,
      payloadHash: receipt.payloadHash,
      branch: raw.branchId,
    }),
  };
}
