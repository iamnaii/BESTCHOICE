import { Prisma } from '@prisma/client';
import { canAccess } from '@installment/shared';
import { currentDomainAccess } from './access-execution-context';
import { PartyQueryPlan } from './access-party-query-plan';

/** The same finite attribution authority governs labels and inference by filter. */
export function contractStaffReadWhere(plan: PartyQueryPlan): Prisma.UserWhereInput {
  const snapshot = currentDomainAccess()!.snapshot;
  const owner = snapshot.isOwner && canAccess(snapshot, 'users.manage', { company: 'FINANCE' });
  const origins: Prisma.UserWhereInput[] = [...plan.live].flatMap((company) =>
    plan.scope('employees.read', company).tuples.flatMap((tuple) => {
      if (tuple.scope === 'ASSIGNED') return [];
      return [
        {
          branch: {
            isActive: true,
            deletedAt: null,
            company: { companyCode: company, isActive: true, deletedAt: null },
            ...(tuple.scope === 'BRANCHES' ? { id: { in: [...tuple.branchIds] } } : {}),
          },
        },
      ];
    }),
  );
  return {
    deletedAt: null,
    isSystemUser: false,
    // Explicit false survives Prisma's nested relation normalization of empty OR.
    ...(owner ? {} : origins.length ? { OR: origins } : { id: { in: [] } }),
  };
}

/** Lock the User and its own actual source; live companies are held by execution. */
export async function lockContractStaffSources(plan: PartyQueryPlan, ids: readonly string[]) {
  const where: Prisma.UserWhereInput = {
    id: { in: [...new Set(ids)] },
    AND: contractStaffReadWhere(plan),
  };
  const staff = ids.length
    ? await plan.db.user.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
      })
    : [];
  if (staff.length) {
    const selected = staff.map((row) => row.id);
    await plan.db.$queryRaw(
      Prisma.sql`SELECT id FROM users WHERE id IN (${Prisma.join(selected)}) ORDER BY id FOR SHARE`,
    );
    await plan.db.$queryRaw(
      Prisma.sql`SELECT id FROM branches WHERE id IN (SELECT branch_id FROM users WHERE id IN (${Prisma.join(selected)})) ORDER BY id FOR SHARE`,
    );
  }
  return where;
}
