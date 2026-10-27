import { ForbiddenException } from '@nestjs/common';
import { AccessResource, PermissionKey, canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { AccessClient } from './access-snapshot.service';
import { CollectionScope } from './access-policy.registry';
import { currentDomainAccess, currentPermissionScope } from './access-execution-context';

/** ONLINE is server-owned: only ShopBuybackService.submit writes it. Historical
 * ONLINE rows retain SHOP provenance across status changes. OFFLINE null branch
 * has no proven origin. Appraiser, verifier and retry initiator are not assignees. */
export function tradeInScopeWhere(scope: CollectionScope): Prisma.TradeInWhereInput {
  if (scope.company !== 'SHOP') return { id: { in: [] } };
  const live = {
    isActive: true,
    deletedAt: null,
    company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
  };
  const alternatives: Prisma.TradeInWhereInput[] = scope.tuples.flatMap<Prisma.TradeInWhereInput>(
    (tuple) => {
      if (tuple.userId !== scope.userId) return [];
      if (tuple.scope === 'COMPANY')
        return [{ OR: [{ branch: live }, { branchId: null, submissionSource: 'ONLINE' }] }];
      if (tuple.scope === 'BRANCHES' && tuple.branchIds.length)
        return [{ branchId: { in: [...tuple.branchIds] }, branch: live }];
      return [];
    },
  );
  return alternatives.length ? { deletedAt: null, OR: alternatives } : { id: { in: [] } };
}
export function currentTradeInWhere(
  permission?: PermissionKey,
): Prisma.TradeInWhereInput | undefined {
  const ctx = currentDomainAccess();
  if (!ctx) return undefined;
  return tradeInScopeWhere(permission ? currentPermissionScope(permission)! : ctx.scope);
}
export async function tradeInSource(
  tx: AccessClient,
  id: string,
  lock = false,
): Promise<AccessResource> {
  if (lock) await tx.$queryRaw`SELECT id FROM trade_ins WHERE id = ${id} FOR UPDATE`;
  const row = await tx.tradeIn.findFirst({
    where: { id, deletedAt: null },
    include: { branch: { include: { company: true } } },
  });
  const shop = await tx.companyInfo.findFirst({
    where: { companyCode: 'SHOP', isActive: true, deletedAt: null },
  });
  if (!row || !shop) throw new ForbiddenException('ไม่พบแหล่งรายการรับซื้อ');
  if (row.branchId) {
    if (lock) await tx.$queryRaw`SELECT id FROM branches WHERE id = ${row.branchId} FOR SHARE`;
    if (!row.branch?.isActive || row.branch.deletedAt || row.branch.companyId !== shop.id)
      throw new ForbiddenException('สาขารับซื้อไม่อยู่ใน SHOP');
    return { company: 'SHOP', branchId: row.branchId };
  }
  if (row.submissionSource !== 'ONLINE') throw new ForbiddenException('ไม่ทราบแหล่งรายการรับซื้อ');
  return { company: 'SHOP' };
}
export async function tradeInAllows(id: string, permission: PermissionKey): Promise<boolean> {
  const ctx = currentDomainAccess();
  if (!ctx) return false;
  try {
    return canAccess(ctx.snapshot, permission, await tradeInSource(ctx.client, id));
  } catch {
    return false;
  }
}

/** Credit issue navigation is a separate journal source. Its canonical AUTO
 * reference is written by TradeInCreditService.issue/JournalAutoService, not
 * caller metadata. No posting branch is persisted, so require COMPANY authority. */
export async function tradeInCreditJournalSource(
  tx: AccessClient,
  tradeInId: string,
  journalId: string,
): Promise<AccessResource | null> {
  const issued = await tx.tradeIn.findFirst({
    where: {
      id: tradeInId,
      deletedAt: null,
      flow: 'EXCHANGE',
      status: { in: ['ACCEPTED', 'COMPLETED'] },
      creditIssuedAt: { not: null },
      creditIssueJournalId: journalId,
    },
    select: { id: true },
  });
  if (!issued) return null;
  const journal = await tx.journalEntry.findFirst({
    where: {
      id: journalId,
      deletedAt: null,
      status: 'POSTED',
      referenceType: 'AUTO',
      referenceId: `tradein:${issued.id}`,
      company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
    },
    select: { id: true },
  });
  return journal ? { company: 'SHOP' } : null;
}
