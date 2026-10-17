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
