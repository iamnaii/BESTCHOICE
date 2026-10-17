import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Company } from '@installment/shared';
import { CollectionScope } from './access-policy.registry';

/** Domain adapters supply persisted company/assignment semantics; absent semantics deny. */
export interface ScopePredicates<W> {
  company(company: Company): W | null;
  branch(ids: readonly string[]): W;
  assigned?(userId: string): W;
}
export function scopeWhere<W>(scope: CollectionScope, source: ScopePredicates<W>): { AND: [W, { OR: unknown[] }] } {
  const company = source.company(scope.company);
  if (!company || !Object.keys(company).length) throw new ForbiddenException('ไม่ทราบบริษัทเจ้าของข้อมูล');
  const alternatives = scope.tuples.flatMap<unknown>(tuple => {
    if (tuple.userId !== scope.userId) return [];
    // Prisma drops empty objects inside OR; use the real company predicate.
    if (tuple.scope === 'COMPANY') return [company];
    if (tuple.scope === 'BRANCHES') return tuple.branchIds.length ? [source.branch(tuple.branchIds)] : [];
    if (tuple.scope !== 'ASSIGNED' || !source.assigned) return [];
    const assigned = source.assigned(scope.userId);
    return [tuple.branchIds.length ? { AND: [assigned, source.branch(tuple.branchIds)] } : assigned];
  });
  return { AND: [company, { OR: alternatives }] };
}
export function productCompanyWhere(company: Company): Prisma.ProductWhereInput {
  const liveCompany = { companyCode: company, isActive: true, deletedAt: null };
  return { AND: [{ branch: { isActive: true, deletedAt: null } }, { OR: [
    { ownedBy: liveCompany },
    { ownedByCompanyId: null, branch: { isActive: true, deletedAt: null, company: liveCompany } },
  ] }] };
}
/** Products have no persisted employee assignment; ASSIGNED deliberately contributes no rows. */
export function productScopeWhere(scope: CollectionScope): Prisma.ProductWhereInput {
  return scopeWhere<Prisma.ProductWhereInput>(scope, {
    company: productCompanyWhere,
    branch: ids => ({ branchId: { in: [...ids] } }),
  }) as Prisma.ProductWhereInput;
}
/** Only fixed aliases are accepted; all values remain bound SQL parameters. */
export function productScopeSql(scope: CollectionScope, alias: 'p' | 'p2' = 'p'): Prisma.Sql {
  if (alias !== 'p' && alias !== 'p2') throw new ForbiddenException('ไม่รองรับชื่อแหล่งข้อมูล');
  const p = alias === 'p' ? Prisma.sql`p` : Prisma.sql`p2`;
  const branches = scope.tuples.filter(t => t.userId === scope.userId && t.scope === 'BRANCHES').flatMap(t => [...t.branchIds]);
  const companyWide = scope.tuples.some(t => t.userId === scope.userId && t.scope === 'COMPANY');
  const branch = companyWide ? Prisma.sql`TRUE` : branches.length ? Prisma.sql`${p}.branch_id IN (${Prisma.join(branches)})` : Prisma.sql`FALSE`;
  return Prisma.sql`(${branch} AND EXISTS (SELECT 1 FROM branches active_branch WHERE active_branch.id = ${p}.branch_id AND active_branch.is_active = TRUE AND active_branch.deleted_at IS NULL) AND EXISTS (
    SELECT 1 FROM company_info ac
    WHERE ac.id = COALESCE(${p}.owned_by_company_id, (SELECT ab.company_id FROM branches ab WHERE ab.id = ${p}.branch_id AND ab.is_active = TRUE AND ab.deleted_at IS NULL))
      AND ac.company_code = ${scope.company} AND ac.is_active = TRUE AND ac.deleted_at IS NULL
  ))`;
}

/** Templates are reference definitions, not case results. Historical null-origin
 * definitions remain safely readable; application and editing have separate checks. */
export function inspectionTemplateScopeWhere(scope: CollectionScope): Prisma.InspectionTemplateWhereInput {
  return { deletedAt: null, OR: [
    { accessCompanyCode: scope.company, accessCompany: { isActive: true, deletedAt: null } },
    { accessCompanyCode: null },
  ] };
}

/** Stable original source plus every additional currently linked product. A later
 * inspection may replace Product.inspectionId without deleting historical access. */
export function inspectionScopeWhere(scope: CollectionScope, product = productScopeWhere(scope)): Prisma.InspectionWhereInput {
  const liveProduct: Prisma.ProductWhereInput = { AND: [{ deletedAt: null }, product] };
  return { deletedAt: null, sourceProduct: { is: liveProduct }, products: { every: liveProduct } };
}
