import { Prisma } from '@prisma/client';
import { AccessClient } from './access-snapshot.service';

/** Direct history is a current-correlated workflow view, not a raw audit or file API.
 * Called only after the canonical source helper locks/authorizes both Contracts
 * and their independent current Products and Customer identities. */
export async function directDefectHistory(
  tx: AccessClient,
  row: {
    id: string;
    createdAt: Date;
    entityId: string | null;
    entity?: string;
    newValue: Prisma.JsonValue;
    user: { id: string; name: string } | null;
  },
) {
  if (
    row.entity !== 'contract' ||
    !row.entityId ||
    !row.newValue ||
    typeof row.newValue !== 'object' ||
    Array.isArray(row.newValue)
  )
    return null;
  const value = row.newValue;
  const replacement = await tx.contract.findFirst({
    where: { id: row.entityId, deletedAt: null },
    select: {
      id: true,
      parentContractId: true,
      customerId: true,
      productId: true,
      contractNumber: true,
    },
  });
  if (!replacement?.parentContractId) return null;
  const original = await tx.contract.findFirst({
    where: { id: replacement.parentContractId, deletedAt: null },
    select: { id: true, customerId: true, productId: true, contractNumber: true },
  });
  if (
    !original ||
    original.customerId !== replacement.customerId ||
    value.oldContractId !== original.id ||
    value.newContractId !== replacement.id ||
    value.oldProductId !== original.productId ||
    value.newProductId !== replacement.productId
  )
    return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    entity: 'contract',
    entityId: replacement.id,
    user: row.user ? { id: row.user.id, name: row.user.name } : null,
    coverage: 'VISIBLE_CURRENT_CORRELATED' as const,
    newValue: {
      oldContractId: original.id,
      oldContractNumber: original.contractNumber,
      newContractId: replacement.id,
      newContractNumber: replacement.contractNumber,
      oldProductId: original.productId,
      newProductId: replacement.productId,
      transferredCredit:
        typeof value.transferredCredit === 'number' &&
        Number.isFinite(value.transferredCredit) &&
        value.transferredCredit >= 0
          ? value.transferredCredit
          : null,
      supplierClaimEligible:
        typeof value.supplierClaimEligible === 'boolean' ? value.supplierClaimEligible : null,
      photoUrls: null,
      photosState: 'UNAVAILABLE' as const,
    },
  };
}
