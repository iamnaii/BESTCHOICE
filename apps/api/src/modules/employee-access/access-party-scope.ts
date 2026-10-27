import { Prisma } from '@prisma/client';
import { CollectionScope } from './access-policy.registry';
import { tradeInScopeWhere } from './access-trade-in-scope';
import { inventorySaleScopeWhere } from './access-inventory-scope';
import { supplierScopeWhere } from './access-procurement-scope';
import { WORK_CHANNELS } from '../staff-chat/services/chat-work-access.service';

const liveShopBranch = {
  isActive: true,
  deletedAt: null,
  company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
};
/** Nullable immutable identity origin. Explicit false is required inside Prisma OR. */
export function partyOriginWhere(scope: CollectionScope): Prisma.CustomerWhereInput {
  const alternatives: Prisma.CustomerWhereInput[] = scope.tuples.flatMap<Prisma.CustomerWhereInput>(
    (t) => {
      if (t.userId !== scope.userId) return [];
      if (t.scope === 'COMPANY') return [{ accessCompanyCode: scope.company }];
      if (t.scope === 'BRANCHES')
        return t.branchIds.length ? [{ accessBranchId: { in: [...t.branchIds] } }] : [];
      return [
        {
          assignedToId: scope.userId,
          assignedTo: { isActive: true, deletedAt: null, isSystemUser: false },
          ...(t.branchIds.length ? { accessBranchId: { in: [...t.branchIds] } } : {}),
        },
      ];
    },
  );
  if (!alternatives.length) return { id: { in: [] } };
  return {
    accessCompanyCode: scope.company,
    accessCompany: { isActive: true, deletedAt: null },
    AND: [
      {
        OR:
          scope.company === 'SHOP'
            ? [{ accessBranch: liveShopBranch }]
            : [{ accessBranchId: null }, { accessBranch: liveShopBranch }],
      },
      { OR: alternatives },
    ],
  };
}
/** Ordinary FINANCE case read, independent from exchange approval and identity mutation. */
export function financeContractReadWhere(scope: CollectionScope): Prisma.ContractWhereInput {
  if (scope.company !== 'FINANCE') return { id: { in: [] } };
  const OR: Prisma.ContractWhereInput[] = scope.tuples.flatMap<Prisma.ContractWhereInput>((t) =>
    t.userId !== scope.userId
      ? []
      : t.scope === 'COMPANY'
        ? [{ deletedAt: null }]
        : t.scope === 'BRANCHES'
          ? t.branchIds.length
            ? [{ branchId: { in: [...t.branchIds] } }]
            : []
          : [
              {
                assignedToId: scope.userId,
                ...(t.branchIds.length ? { branchId: { in: [...t.branchIds] } } : {}),
              },
            ],
  );
  return OR.length ? { deletedAt: null, branch: liveShopBranch, OR } : { id: { in: [] } };
}
/** Branchless room provenance is never inferred from assigned staff or customer aliases.
 * Caller must separately establish the live company and independent room read grant. */
export function partyRoomReadWhere(scope: CollectionScope): Prisma.ChatRoomWhereInput {
  const allowed = scope.tuples.filter(
    (t) =>
      t.userId === scope.userId &&
      (t.scope === 'COMPANY' || (t.scope === 'ASSIGNED' && !t.branchIds.length)),
  );
  if (!allowed.length) return { id: { in: [] } };
  return {
    deletedAt: null,
    channel: { in: WORK_CHANNELS[scope.company] },
    ...(allowed.some((t) => t.scope === 'COMPANY') ? {} : { assignedToId: scope.userId }),
  };
}
/** Party assignment is current identity assignment; historical salesperson/case
 * assignment never becomes identity authority. No Contact traversal for Customer. */
export function customerPartyWhere(scope: CollectionScope): Prisma.CustomerWhereInput {
  const OR: Prisma.CustomerWhereInput[] = [];
  for (const t of scope.tuples) {
    if (t.userId !== scope.userId || (t.scope === 'BRANCHES' && !t.branchIds.length)) continue;
    const sourceScope: CollectionScope = {
      ...scope,
      tuples: [
        {
          ...t,
          scope: t.scope === 'ASSIGNED' ? (t.branchIds.length ? 'BRANCHES' : 'COMPANY') : t.scope,
        },
      ],
    };
    const branch = {
      branch: liveShopBranch,
      ...(t.branchIds.length && t.scope !== 'COMPANY'
        ? { branchId: { in: [...t.branchIds] } }
        : {}),
    };
    const evidence: Prisma.CustomerWhereInput[] = [partyOriginWhere(sourceScope)];
    if (scope.company === 'SHOP')
      evidence.push(
        { tradeIns: { some: tradeInScopeWhere(sourceScope) } },
        { sales: { some: inventorySaleScopeWhere(sourceScope) } },
        { contracts: { some: { deletedAt: null, ...branch } } },
        { repairTickets: { some: { deletedAt: null, ...branch } } },
        { bookings: { some: { deletedAt: null, ...branch } } },
      );
    else evidence.push({ contracts: { some: { deletedAt: null, ...branch } } });
    if (t.scope === 'COMPANY' || (t.scope === 'ASSIGNED' && !t.branchIds.length))
      evidence.push({
        chatRooms: { some: { deletedAt: null, channel: { in: WORK_CHANNELS[scope.company] } } },
      });
    OR.push({
      ...(t.scope === 'ASSIGNED'
        ? {
            assignedToId: scope.userId,
            assignedTo: { isActive: true, deletedAt: null, isSystemUser: false },
          }
        : {}),
      OR: evidence,
    });
  }
  return OR.length ? { deletedAt: null, OR } : { id: { in: [] } };
}
export function contactPartyWhere(scope: CollectionScope): Prisma.ContactWhereInput {
  const OR: Prisma.ContactWhereInput[] = [];
  for (const t of scope.tuples) {
    if (t.userId !== scope.userId || (t.scope === 'BRANCHES' && !t.branchIds.length)) continue;
    const s: CollectionScope = {
      ...scope,
      tuples: [
        {
          ...t,
          scope: t.scope === 'ASSIGNED' ? (t.branchIds.length ? 'BRANCHES' : 'COMPANY') : t.scope,
        },
      ],
    };
    OR.push({
      ...(t.scope === 'ASSIGNED'
        ? {
            assignedToId: scope.userId,
            assignedTo: { isActive: true, deletedAt: null, isSystemUser: false },
          }
        : {}),
      OR: [
        partyOriginWhere(s) as Prisma.ContactWhereInput,
        { customers: { some: customerPartyWhere(s) } },
        { suppliers: { some: supplierScopeWhere(s) } },
        { tradeInsAsSeller: { some: tradeInScopeWhere(s) } },
      ],
    });
  }
  return OR.length ? { deletedAt: null, isActive: true, OR } : { id: { in: [] } };
}
