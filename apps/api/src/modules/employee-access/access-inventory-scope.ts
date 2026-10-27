import { Prisma } from '@prisma/client';
import { CollectionScope } from './access-policy.registry';
import { productScopeWhere, scopeWhere } from './access-query-scope';

type BranchInventoryWhere = Prisma.ReorderPointWhereInput & Prisma.StockCountWhereInput & Prisma.StockAlertWhereInput;

/** Branch-owned inventory records have no employee assignment. */
export function inventoryBranchWhere(scope: CollectionScope): BranchInventoryWhere {
  if (!scope.tuples.some(t => t.userId === scope.userId && (t.scope === 'COMPANY' || t.scope === 'BRANCHES' && t.branchIds.length))) return { id: { in: [] } };
  return scopeWhere<Prisma.ReorderPointWhereInput>(scope, {
    company: company => ({ deletedAt: null, branch: { isActive: true, deletedAt: null, company: { companyCode: company, isActive: true, deletedAt: null } } }),
    branch: ids => ({ branchId: { in: [...ids] } }),
  }) as BranchInventoryWhere;
}
export function stockCountScopeWhere(scope: CollectionScope): Prisma.StockCountWhereInput {
  return { AND: [inventoryBranchWhere(scope), { items: { every: { product: { AND: [{ deletedAt: null }, productScopeWhere(scope)] } } } }] };
}
/** The Sale entity is SHOP activity. Its persisted branch/salesperson are its
 * source, even after the product is transferred to FINANCE or another branch. */
export function inventorySaleScopeWhere(scope: CollectionScope): Prisma.SaleWhereInput {
  if (scope.company !== 'SHOP') return { id: { in: [] } };
  return scopeWhere<Prisma.SaleWhereInput>(scope, {
    company: () => ({ deletedAt: null, branch: { isActive: true, deletedAt: null, company: { companyCode: 'SHOP', isActive: true, deletedAt: null } } }),
    branch: ids => ({ branchId: { in: [...ids] } }),
    assigned: userId => ({ salespersonId: userId }),
  }) as Prisma.SaleWhereInput;
}
export function inventoryTransferWhere(scope: CollectionScope): Prisma.StockTransferWhereInput {
  if (scope.company !== 'SHOP' || !scope.tuples.some(t => t.userId === scope.userId && (t.scope === 'COMPANY' || t.scope === 'BRANCHES' && t.branchIds.length))) return { id: { in: [] } };
  return { AND: [
    { deletedAt: null, fromBranch: { isActive: true, deletedAt: null, company: { companyCode: 'SHOP', isActive: true, deletedAt: null } }, product: { AND: [{ deletedAt: null }, productScopeWhere({ ...scope, tuples: [{ scope: 'COMPANY', branchIds: [], userId: scope.userId }] })] }, toBranch: { isActive: true, deletedAt: null, company: { companyCode: 'SHOP', isActive: true, deletedAt: null } } },
    scopeWhere<Prisma.StockTransferWhereInput>(scope, { company: () => ({ deletedAt: null }), branch: ids => scope.permission === 'stock-receiving.read' ? ({ OR: [{ fromBranchId: { in: [...ids] } }, { toBranchId: { in: [...ids] } }] }) : ({ toBranchId: { in: [...ids] } }) }) as Prisma.StockTransferWhereInput,
  ] };
}
