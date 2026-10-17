import { partyOriginWhere } from './access-party-scope';
import { Prisma } from '@prisma/client';
import { CollectionScope } from './access-policy.registry';

export const liveShopServiceBranch = {
  isActive: true,
  deletedAt: null,
  company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
};
/** Repair creators and warranty collection actors are not assigned case workers. */
export function shopServiceOriginWhere(scope: CollectionScope) {
  if (scope.company !== 'SHOP') return { id: { in: [] as string[] } };
  const alternatives = scope.tuples.flatMap((t) =>
    t.userId !== scope.userId
      ? []
      : t.scope === 'COMPANY'
        ? [{}]
        : t.scope === 'BRANCHES' && t.branchIds.length
          ? [{ branchId: { in: [...t.branchIds] } }]
          : [],
  );
  return alternatives.length
    ? {
        deletedAt: null,
        branch: liveShopServiceBranch,
        ...(alternatives.some((entry) => Object.keys(entry).length === 0)
          ? {}
          : { OR: alternatives }),
      }
    : { id: { in: [] as string[] } };
}
/** Same-customer evidence only: this does not authorize a Contract/ticket detail.
 * A new unlinked customer cannot gain access by fabricating an intake first. */
export function serviceCustomerEvidenceWhere(scope: CollectionScope): Prisma.CustomerWhereInput {
  const origin = shopServiceOriginWhere(scope);
  return {
    deletedAt: null,
    OR: [partyOriginWhere(scope), { contracts: { some: origin } }, { repairTickets: { some: origin } }],
  };
}
