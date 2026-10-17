import { ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { currentDomainAccess, currentPermissionScope } from './access-execution-context';
import { customerPartyWhere } from './access-party-scope';
import { productScopeWhere } from './access-query-scope';
import { saleSource, saleScopeWhere } from './access-sales-scope';

/** Restrict candidates at the database before reading usage history or counting. */
export function visiblePromotionUsageWhere(): Prisma.PromotionUsageWhereInput {
  if (!currentDomainAccess()) return { id: { in: [] } };
  return {
    deletedAt: null,
    sale: {
      is: {
        deletedAt: null,
        AND: [
          saleScopeWhere(currentPermissionScope('promotions.read')!),
          saleScopeWhere(currentPermissionScope('sales.read')!),
        ],
        customer: customerPartyWhere(currentPermissionScope('customers.read')!),
        product: {
          deletedAt: null,
          AND: productScopeWhere(currentPermissionScope('products.read')!),
        },
      },
    },
  };
}

type Usage = Prisma.PromotionUsageGetPayload<{ include: { sale: true; benefit: true } }>;
/** Do not infer source completeness from a global campaign or copy Sale assignment to parties. */
export async function promotionUsageVisible(usage: Usage, apply = false) {
  const ctx = currentDomainAccess();
  if (!ctx) return false;
  const tx = ctx.client,
    sale = usage.sale;
  if (!sale || sale.deletedAt || usage.deletedAt || usage.customerId !== sale.customerId)
    return false;
  if (apply) {
    await tx.$queryRaw`SELECT id FROM sales WHERE id = ${sale.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${sale.customerId} FOR SHARE`;
  }
  const source = await saleSource(tx, sale.id, apply).catch((error: unknown) => {
    if (error instanceof ForbiddenException) return null;
    throw error;
  });
  if (
    !source ||
    !canAccess(ctx.snapshot, apply ? 'promotions.apply' : 'promotions.read', source) ||
    !canAccess(ctx.snapshot, 'sales.read', source)
  )
    return false;
  if (
    !(await tx.customer.count({
      where: {
        id: sale.customerId,
        AND: customerPartyWhere(currentPermissionScope('customers.read')!),
      },
    }))
  )
    return false;
  const productIds = [
    ...new Set([sale.productId, ...(usage.benefit?.accessoryProductIds ?? [])]),
  ].sort();
  if (apply)
    for (const id of productIds)
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} FOR SHARE`;
  const products = await tx.product.count({
    where: {
      id: { in: productIds },
      branchId: sale.branchId,
      deletedAt: null,
      AND: productScopeWhere(currentPermissionScope('products.read')!),
    },
  });
  if (products !== productIds.length) return false;
  if (usage.benefit) {
    const b = usage.benefit;
    if (
      b.saleId !== sale.id ||
      b.promotionId !== usage.promotionId ||
      b.customerId !== sale.customerId ||
      b.productId !== sale.productId ||
      b.branchId !== sale.branchId ||
      !b.discountAmount.eq(usage.discountApplied) ||
      !b.baselineAmount.eq(sale.sellingPrice) ||
      b.discountAmount.gt(sale.discount) ||
      !sale.sellingPrice.minus(sale.discount).eq(sale.netAmount) ||
      b.accessoryProductIds.some((id) => !sale.bundleProductIds.includes(id))
    )
      return false;
  }
  return true;
}
