import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessSnapshot, Company, PermissionKey } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { AccessClient } from './access-snapshot.service';
import { permissionScopes } from './access-context';
import { shopServiceOriginWhere } from './access-service-origin';
import { currentDomainAccess, isCurrentDomainClient } from './access-execution-context';

export const PREPARATION_CONTRIBUTOR_LIMIT = 10000;
export function preparationScope(
  snapshot: AccessSnapshot,
  permission: PermissionKey,
  company: Company,
) {
  return {
    userId: snapshot.userId,
    company,
    permission,
    tuples: permissionScopes({ id: snapshot.userId, access: snapshot }, permission, company),
  };
}
/** Current maker is a workflow condition, not an ASSIGNED grant. Callers name
 * their own actions: a successful read never confers mutation authority. */
export function preparationSourceWhere(
  snapshot: AccessSnapshot,
  permissions: readonly ('contracts.read' | 'contracts.update')[],
): Prisma.ContractWhereInput {
  if (!permissions.length) throw new ForbiddenException('ต้องระบุสิทธิ์สำหรับงานนี้');
  return {
    status: 'DRAFT',
    ...(snapshot.isOwner ? {} : { salespersonId: snapshot.userId }),
    AND: permissions.map((permission) =>
      shopServiceOriginWhere(preparationScope(snapshot, permission, 'SHOP')),
    ),
  };
}
/** Same supported envelope as ordinary reads, but only actual SHOP dependencies.
 * SQL-proven IDs must include every contributing row, not only the visible page. */
export async function lockPreparationSources(tx: AccessClient, contractIds: readonly string[]) {
  const ids = [...new Set(contractIds)].sort();
  if (ids.length > PREPARATION_CONTRIBUTOR_LIMIT)
    throw new BadRequestException('กรุณาระบุตัวกรองให้แคบลงแล้วลองอีกครั้ง');
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM contracts WHERE id=ANY(${ids}::text[]) ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT b.id FROM branches b WHERE b.id IN (
    SELECT branch_id FROM contracts WHERE id=ANY(${ids}::text[])
  ) ORDER BY b.id FOR SHARE OF b`;
  await tx.$queryRaw`SELECT ci.id FROM company_info ci WHERE ci.id IN (
    SELECT b.company_id FROM branches b WHERE b.id IN (
      SELECT branch_id FROM contracts WHERE id=ANY(${ids}::text[])
    )
  ) ORDER BY ci.id FOR SHARE OF ci`;
}
/** Reusable exact-source proof for the next preparation action adapters. Only
 * callable in the current owned Serializable execution, with explicit actions. */
export async function currentPreparationSource(
  id: string,
  permissions: readonly ('contracts.read' | 'contracts.update')[],
) {
  const ctx = currentDomainAccess();
  if (
    !ctx ||
    ctx.scopeReads ||
    ctx.scope.company !== 'SHOP' ||
    ctx.isolationLevel !== 'Serializable' ||
    !isCurrentDomainClient(ctx.client)
  )
    throw new ForbiddenException('ต้องตรวจสิทธิ์ปัจจุบันในธุรกรรมเดียวกัน');
  await lockPreparationSources(ctx.client, [id]);
  const row = await ctx.client.contract.findFirst({
    where: { id, AND: preparationSourceWhere(ctx.snapshot, permissions) },
    select: {
      id: true,
      branchId: true,
      salespersonId: true,
      customerId: true,
      productId: true,
      bundleProductIds: true,
      workflowStatus: true,
    },
  });
  if (!row) throw new ForbiddenException('ไม่มีสิทธิ์อ่านคำขอนี้');
  return { ...row, source: { company: 'SHOP' as const, branchId: row.branchId } };
}
