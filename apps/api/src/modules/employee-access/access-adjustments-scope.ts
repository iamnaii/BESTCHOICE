import { Prisma } from '@prisma/client';
import { AccessResource, PermissionKey, canAccess } from '@installment/shared';
import { currentDomainAccess } from './access-execution-context';
import { CollectionScope } from './access-policy.registry';
import { productScopeWhere } from './access-query-scope';

const liveHistoricalBranch: Prisma.BranchWhereInput = {
  isActive: true,
  deletedAt: null,
  company: { isActive: true, deletedAt: null, companyCode: { in: ['SHOP', 'FINANCE'] } },
};

/** Both the historical request branch and current product location are required.
 * There is no employee assignment relation on adjustments. Requester is not assignment. */
export function adjustmentScopeWhere(scope: CollectionScope): Prisma.StockAdjustmentWhereInput {
  const tuples = scope.tuples.filter(
    (t) =>
      t.userId === scope.userId &&
      (t.scope === 'COMPANY' || (t.scope === 'BRANCHES' && t.branchIds.length)),
  );
  if (!tuples.length) return { id: { in: [] } };
  const company = tuples.some((t) => t.scope === 'COMPANY');
  return {
    deletedAt: null,
    branch: liveHistoricalBranch,
    ...(company ? {} : { branchId: { in: tuples.flatMap((t) => [...t.branchIds]) } }),
    product: productScopeWhere({ ...scope, tuples }),
  };
}
export function currentAdjustmentWhere(): Prisma.StockAdjustmentWhereInput {
  const ctx = currentDomainAccess();
  return ctx ? adjustmentScopeWhere(ctx.scope) : {};
}
export function currentAdjustmentProductWhere(): Prisma.ProductWhereInput {
  const ctx = currentDomainAccess();
  if (!ctx) return {};
  const usable = ctx.scope.tuples.some(
    (t) =>
      t.userId === ctx.scope.userId &&
      (t.scope === 'COMPANY' || (t.scope === 'BRANCHES' && t.branchIds.length)),
  );
  return usable ? productScopeWhere(ctx.scope) : { id: { in: [] } };
}
/** Deliberately supports deleted products: adjustment evidence and FOUND recovery
 * retain their source, while company/branch must still be active. */
export async function adjustmentAllows(
  productId: string,
  permission: PermissionKey,
  originalBranchId?: string,
): Promise<boolean> {
  const ctx = currentDomainAccess();
  if (!ctx) return false;
  if (
    originalBranchId &&
    !(await ctx.client.branch.findFirst({
      where: { id: originalBranchId, ...liveHistoricalBranch },
    }))
  )
    return false;
  const p = await ctx.client.product.findUnique({
    where: { id: productId },
    include: { ownedBy: true, branch: { include: { company: true } } },
  });
  if (!p || !p.branch.isActive || p.branch.deletedAt) return false;
  const company = p.ownedByCompanyId ? p.ownedBy : p.branch.company;
  if (
    !company?.isActive ||
    company.deletedAt ||
    (company.companyCode !== 'SHOP' && company.companyCode !== 'FINANCE')
  )
    return false;
  const resource: AccessResource = { company: company.companyCode, branchId: p.branchId };
  return (
    canAccess(ctx.snapshot, permission, resource) &&
    (!originalBranchId ||
      canAccess(ctx.snapshot, permission, { ...resource, branchId: originalBranchId }))
  );
}

/** A stamped journal source is independent of the product's later location.
 * Missing historical branch is company-only, never inferred from today's product. */
export async function adjustmentJournalAllows(
  reference: { id?: string; number?: string },
  permission: PermissionKey,
): Promise<boolean> {
  const ctx = currentDomainAccess();
  if (!ctx || (!reference.id && !reference.number)) return false;
  const entry = await ctx.client.journalEntry.findUnique({
    where: reference.id ? { id: reference.id } : { entryNumber: reference.number! },
    include: { company: true },
  });
  if (!entry || entry.deletedAt || !entry.company.isActive || entry.company.deletedAt) return false;
  const company = entry.company.companyCode;
  if (company !== 'SHOP' && company !== 'FINANCE') return false;
  const meta = entry.metadata as Record<string, unknown> | null;
  const branchId = typeof meta?.branchId === 'string' ? meta.branchId : undefined;
  if (
    branchId &&
    !(await ctx.client.branch.findFirst({
      where: { id: branchId, ...liveHistoricalBranch },
    }))
  )
    return false;
  return canAccess(ctx.snapshot, permission, { company, branchId });
}
