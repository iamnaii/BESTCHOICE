import {
  namedCustomerWhere,
  namedProductWhere,
  namedContractReadWhere,
} from '../promotions/contract-promotion-source';
import { ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { currentDomainAccess, currentPermissionScope } from './access-execution-context';
import { saleSource, saleScopeWhere } from './access-sales-scope';

/** Restrict candidates at the database before reading usage history or counting. */
export function visiblePromotionUsageWhere(apply = false): Prisma.PromotionUsageWhereInput {
  if (!currentDomainAccess()) return { id: { in: [] } };
  return {
    deletedAt: null,
    OR: [
      { benefit: { is: { type: { not: 'SPECIAL_RATE' } } } },
      { benefitId: null },
      {
        benefit: {
          is: {
            type: 'SPECIAL_RATE',
            contractTerms: { is: { contract: namedContractReadWhere() } },
          },
        },
      },
    ],
    sale: {
      is: {
        deletedAt: null,
        AND: [
          saleScopeWhere(currentPermissionScope(apply ? 'promotions.apply' : 'promotions.read')!),
          saleScopeWhere(currentPermissionScope('sales.read')!),
        ],
        customer: namedCustomerWhere(),
        product: {
          deletedAt: null,
          AND: namedProductWhere(),
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
        AND: namedCustomerWhere(),
      },
    }))
  )
    return false;
  const productIds = [
    ...new Set([
      sale.productId,
      ...(usage.benefit?.accessoryProductIds ?? []),
      ...(usage.benefit?.type === 'SPECIAL_RATE' ? sale.bundleProductIds : []),
    ]),
  ].sort();
  if (apply)
    for (const id of productIds)
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} FOR SHARE`;
  const products = await tx.product.count({
    where: {
      id: { in: productIds },
      branchId: sale.branchId,
      deletedAt: null,
      AND: namedProductWhere(),
    },
  });
  if (products !== productIds.length) return false;
  if (usage.benefit?.type === 'SPECIAL_RATE') {
    const b = usage.benefit;
    if (
      !b.contractTermsId ||
      !sale.contractId ||
      sale.saleType !== 'INSTALLMENT' ||
      !b.discountAmount.isZero()
    )
      return false;
    const terms = await tx.contractPromotionTerms.findFirst({
      where: {
        id: b.contractTermsId,
        contractId: sale.contractId,
        promotionId: usage.promotionId,
        contract: namedContractReadWhere(),
      },
      include: { contract: true, reservation: true },
    });
    const finance = await tx.companyInfo.count({
      where: { companyCode: 'FINANCE', isActive: true, deletedAt: null },
    });
    if (
      !terms ||
      !finance ||
      terms.reservation?.state !== 'CONSUMED' ||
      terms.fingerprint !== b.fingerprint ||
      terms.contract.promotionFingerprint !== b.fingerprint ||
      terms.contract.customerId !== sale.customerId ||
      terms.contract.productId !== sale.productId ||
      terms.contract.branchId !== sale.branchId ||
      !terms.sellingPrice.eq(sale.sellingPrice) ||
      !terms.downPayment.eq(sale.downPaymentAmount ?? 0) ||
      [...terms.bundleProductIds].sort().join(',') !== [...sale.bundleProductIds].sort().join(',')
    )
      return false;
  }
  if (usage.benefit) {
    const b = usage.benefit;
    if (
      b.saleId !== sale.id ||
      b.promotionId !== usage.promotionId ||
      b.customerId !== sale.customerId ||
      b.productId !== sale.productId ||
      b.branchId !== sale.branchId ||
      !b.discountAmount.eq(usage.discountApplied) ||
      (b.type !== 'SPECIAL_RATE' && !b.baselineAmount.eq(sale.sellingPrice)) ||
      b.discountAmount.gt(sale.discount) ||
      !sale.sellingPrice.minus(sale.discount).eq(sale.netAmount) ||
      b.accessoryProductIds.some((id) => !sale.bundleProductIds.includes(id))
    )
      return false;
  }
  return true;
}
