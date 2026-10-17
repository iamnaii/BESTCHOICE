import { liveShopServiceBranch, shopServiceOriginWhere } from './access-service-origin';
import { saleScopeWhere, currentCustomerReadWhere } from './access-sales-scope';
import { ForbiddenException } from '@nestjs/common';
import { AccessResource } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { AccessClient } from './access-snapshot.service';
import { CollectionScope } from './access-policy.registry';
import { currentDomainAccess, currentPermissionScope } from './access-execution-context';
import { permissionScopes } from './access-context';
import { productScopeWhere } from './access-query-scope';

export function repairScopeWhere(scope: CollectionScope): Prisma.RepairTicketWhereInput {
  return shopServiceOriginWhere(scope);
}
/** Only service/warranty identity and dates; NEVER a FINANCE Contract authority. */
export function warrantyContractScopeWhere(scope: CollectionScope): Prisma.ContractWhereInput {
  return shopServiceOriginWhere(scope);
}
export function currentRepairWhere(): Prisma.RepairTicketWhereInput | undefined {
  const ctx = currentDomainAccess();
  return ctx ? repairScopeWhere(currentPermissionScope('repair-tickets.read')!) : undefined;
}
export function currentWarrantyContractWhere(): Prisma.ContractWhereInput | undefined {
  const ctx = currentDomainAccess();
  return ctx
    ? {
        AND: [
          warrantyContractScopeWhere(currentPermissionScope('repair-tickets.read')!),
          warrantyContractScopeWhere(currentPermissionScope('contracts.read')!),
          { customer: currentCustomerReadWhere(), product: currentRepairProductWhere() },
        ],
      }
    : undefined;
}
/** Current ownership can be FINANCE while the historical service origin is SHOP. */
export function currentRepairProductWhere(): Prisma.ProductWhereInput | undefined {
  const ctx = currentDomainAccess();
  if (!ctx) return undefined;
  return {
    deletedAt: null,
    OR: (['SHOP', 'FINANCE'] as const).map((company) => {
      const tuples = permissionScopes(
        { id: ctx.snapshot.userId, access: ctx.snapshot },
        'products.read',
        company,
      );
      return tuples.some(
        (t) => t.scope === 'COMPANY' || (t.scope === 'BRANCHES' && t.branchIds.length),
      )
        ? productScopeWhere({
            userId: ctx.snapshot.userId,
            company,
            permission: 'products.read',
            tuples,
          })
        : { id: { in: [] } };
    }),
  };
}
export async function repairSource(
  tx: AccessClient,
  id: string,
  lock = false,
): Promise<AccessResource> {
  if (lock) {
    await tx.$queryRaw`SELECT id FROM repair_tickets WHERE id = ${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT b.id FROM branches b JOIN repair_tickets r ON r.branch_id = b.id WHERE r.id = ${id} FOR SHARE OF b`;
  }
  const r = await tx.repairTicket.findFirst({
    where: { id, deletedAt: null, branch: liveShopServiceBranch },
    select: { branchId: true },
  });
  if (!r) throw new ForbiddenException('ไม่พบแหล่งใบซ่อม');
  return { company: 'SHOP', branchId: r.branchId };
}
/** Root ruling: SHOP warranty provenance comes from persisted SHOP origin, not
 * current Product owner, UI selector, salesperson or collections assignment.
 * FINANCE must resolve its own financial source in Task 4.2. */
export interface ContractWarrantyAccessSource {
  readonly company: 'SHOP';
  readonly branchId: string;
}
export async function contractWarrantySource(
  tx: AccessClient,
  id: string,
  lock = false,
): Promise<ContractWarrantyAccessSource> {
  if (lock) {
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT b.id FROM branches b JOIN contracts c ON c.branch_id = b.id WHERE c.id = ${id} FOR SHARE OF b`;
  }
  const c = await tx.contract.findFirst({
    where: { id, deletedAt: null, branch: liveShopServiceBranch },
    select: { branchId: true },
  });
  if (!c) throw new ForbiddenException('ไม่พบแหล่งประกันของสัญญา');
  return { company: 'SHOP', branchId: c.branchId };
}
export const contractWarrantySelect = {
  id: true,
  contractNumber: true,
  status: true,
  deviceReceivedAt: true,
  shopWarrantyEndDate: true,
} satisfies Prisma.ContractSelect;
export type ContractWarrantyView = Prisma.ContractGetPayload<{
  select: typeof contractWarrantySelect;
}>;

export function currentRepairSaleWhere(): Prisma.SaleWhereInput | undefined {
  const ctx = currentDomainAccess();
  return ctx
    ? {
        AND: [
          saleScopeWhere(currentPermissionScope('repair-tickets.read')!),
          saleScopeWhere(currentPermissionScope('sales.read')!),
          { customer: currentCustomerReadWhere() },
        ],
      }
    : undefined;
}
export function currentRepairLookupProductWhere(): Prisma.ProductWhereInput | undefined {
  const ctx = currentDomainAccess();
  return ctx
    ? {
        AND: [
          currentRepairProductWhere()!,
          shopServiceOriginWhere(currentPermissionScope('repair-tickets.read')!),
        ],
      }
    : undefined;
}
