import { customerPartyWhere } from './access-party-scope';
import { ForbiddenException } from '@nestjs/common';
import { AccessResource } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { AccessClient } from './access-snapshot.service';
import { CollectionScope } from './access-policy.registry';
import { currentDomainAccess, currentPermissionScope } from './access-execution-context';

/** Voided Sale history retains its actual SHOP source; callers choose archive filters. */
export function saleScopeWhere(scope: CollectionScope): Prisma.SaleWhereInput {
  if (scope.company !== 'SHOP') return { id: { in: [] } };
  const live = {
    branch: {
      isActive: true,
      deletedAt: null,
      company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
    },
  };
  const alternatives: Prisma.SaleWhereInput[] = scope.tuples.flatMap<Prisma.SaleWhereInput>(
    (tuple) => {
      if (tuple.userId !== scope.userId) return [];
      if (tuple.scope === 'COMPANY') return [live];
      if (tuple.scope === 'BRANCHES')
        return tuple.branchIds.length ? [{ branchId: { in: [...tuple.branchIds] } }] : [];
      return [
        {
          salespersonId: scope.userId,
          ...(tuple.branchIds.length ? { branchId: { in: [...tuple.branchIds] } } : {}),
        },
      ];
    },
  );
  return { AND: [live, { OR: alternatives }] };
}
export function bookingScopeWhere(scope: CollectionScope): Prisma.BookingWhereInput {
  if (scope.company !== 'SHOP') return { id: { in: [] } };
  const alternatives: Prisma.BookingWhereInput[] = scope.tuples.flatMap<Prisma.BookingWhereInput>(
    (tuple) => {
      if (tuple.userId !== scope.userId) return [];
      if (tuple.scope === 'COMPANY') return [{ deletedAt: null }];
      if (tuple.scope === 'BRANCHES' && tuple.branchIds.length)
        return [{ branchId: { in: [...tuple.branchIds] } }];
      return [];
    },
  );
  return alternatives.length
    ? {
        deletedAt: null,
        branch: {
          isActive: true,
          deletedAt: null,
          company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
        },
        OR: alternatives,
      }
    : { id: { in: [] } };
}
export function currentSaleWhere(): Prisma.SaleWhereInput | undefined {
  const ctx = currentDomainAccess();
  return ctx ? saleScopeWhere(ctx.scope) : undefined;
}
export function currentBookingWhere(): Prisma.BookingWhereInput | undefined {
  const ctx = currentDomainAccess();
  return ctx ? bookingScopeWhere(ctx.scope) : undefined;
}
export async function saleSource(
  tx: AccessClient,
  id: string,
  lock = false,
): Promise<AccessResource> {
  if (lock) {
    await tx.$queryRaw`SELECT id FROM sales WHERE id = ${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT b.id FROM branches b JOIN sales s ON s.branch_id = b.id WHERE s.id = ${id} FOR SHARE OF b`;
  }
  const row = await tx.sale.findUnique({
    where: { id },
    include: { branch: { include: { company: true } } },
  });
  if (
    !row ||
    !row.branch.isActive ||
    row.branch.deletedAt ||
    !row.branch.company?.isActive ||
    row.branch.company.deletedAt ||
    row.branch.company.companyCode !== 'SHOP'
  )
    throw new ForbiddenException('ไม่พบแหล่งใบขาย');
  return { company: 'SHOP', branchId: row.branchId, assignedUserIds: [row.salespersonId] };
}
export async function bookingSource(
  tx: AccessClient,
  id: string,
  lock = false,
): Promise<AccessResource> {
  if (lock) {
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`;
    await tx.$queryRaw`SELECT b.id FROM branches b JOIN bookings s ON s.branch_id = b.id WHERE s.id = ${id} FOR SHARE OF b`;
  }
  const row = await tx.booking.findFirst({
    where: { id, deletedAt: null },
    include: { branch: { include: { company: true } } },
  });
  if (
    !row ||
    !row.branch.isActive ||
    row.branch.deletedAt ||
    !row.branch.company?.isActive ||
    row.branch.company.deletedAt ||
    row.branch.company.companyCode !== 'SHOP'
  )
    throw new ForbiddenException('ไม่พบแหล่งใบจอง');
  return { company: 'SHOP', branchId: row.branchId };
}

/** Same-party evidence predicate for searches; apply before counts/pagination. */
export function currentCustomerReadWhere(): Prisma.CustomerWhereInput | undefined {
  return currentDomainAccess() ? customerPartyWhere(currentPermissionScope('customers.read')!) : undefined;
}
