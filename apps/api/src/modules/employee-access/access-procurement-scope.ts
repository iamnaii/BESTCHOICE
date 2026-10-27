import { Prisma } from '@prisma/client';
import { CollectionScope } from './access-policy.registry';
import { productScopeWhere, scopeWhere } from './access-query-scope';

function hasSourceTuple(scope: CollectionScope): boolean {
  return scope.tuples.some(tuple => tuple.userId === scope.userId && (tuple.scope === 'COMPANY' || tuple.scope === 'BRANCHES' && tuple.branchIds.length > 0));
}

/** Origin is authenticated when written, never inferred from a creator's current
 * branch. FINANCE may refer to a SHOP-origin branch without changing company. */
export function procurementOriginWhere(scope: CollectionScope): Prisma.PurchaseOrderWhereInput {
  // An explicit false scalar survives nested Prisma OR/relation normalization.
  if (!hasSourceTuple(scope)) return { id: { in: [] } };
  return scopeWhere<Prisma.PurchaseOrderWhereInput>(scope, {
    company: company => ({
      accessCompanyCode: company,
      accessCompany: { isActive: true, deletedAt: null },
      OR: [
        { accessBranchId: null },
        { accessBranch: { isActive: true, deletedAt: null, company: { isActive: true, deletedAt: null, companyCode: { in: company === 'FINANCE' ? ['SHOP', 'FINANCE'] : ['SHOP'] } } } },
      ],
    }),
    branch: ids => ({ accessBranchId: { in: [...ids] } }),
  }) as Prisma.PurchaseOrderWhereInput;
}

export function purchaseOrderScopeWhere(scope: CollectionScope): Prisma.PurchaseOrderWhereInput {
  // An explicit false scalar survives nested Prisma OR/relation normalization.
  if (!hasSourceTuple(scope)) return { id: { in: [] } };
  const product = { AND: [{ deletedAt: null }, productScopeWhere(scope)] };
  return { deletedAt: null, OR: [
    procurementOriginWhere(scope),
    // Legacy rows are usable only when every contributing source is resolvable.
    // Empty drafts and productless rejected receipts do not establish ownership.
    { accessCompanyCode: null, products: { some: product, every: product }, goodsReceivings: { every: { items: { every: { product: { is: product } } } } } },
  ] };
}

export function supplierScopeWhere(scope: CollectionScope): Prisma.SupplierWhereInput {
  // An explicit false scalar survives nested Prisma OR/relation normalization.
  if (!hasSourceTuple(scope)) return { id: { in: [] } };
  const origin = procurementOriginWhere(scope) as Prisma.SupplierWhereInput;
  return { deletedAt: null, OR: [
    origin,
    { products: { some: { AND: [{ deletedAt: null }, productScopeWhere(scope)] } } },
    { purchaseOrders: { some: purchaseOrderScopeWhere(scope) } },
  ] };
}
