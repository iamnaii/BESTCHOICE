import { Prisma } from '@prisma/client';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { getBranchScope } from '../../auth/branch-access.util';
import { roomWorkWhere, WORK_CHANNELS } from './chat-work-access.service';
import { commentWorkWhere } from './facebook-comment-scope';

// Fixed SQL aliases only. Keep these predicates paired with the canonical Prisma
// readers; mixed queue IDs are paginated in the database, never in an unbounded JS merge.
export function roomWorkSql(actor: ChatWorkActor, scope: WorkScope): Prisma.Sql {
  roomWorkWhere(actor, scope);
  const branch = getBranchScope(actor);
  const branchId = branch.all ? scope.branchId : branch.branchId;
  return Prisma.sql`r.deleted_at IS NULL AND r.channel::text IN (${Prisma.join(WORK_CHANNELS[scope.company])})
    AND ${actor.role === 'SALES' ? Prisma.sql`(r.assigned_to_id IS NULL OR r.assigned_to_id = ${actor.id})` : Prisma.sql`TRUE`}
    AND ${branchId ? Prisma.sql`(r.assigned_to_id IS NULL OR room_owner.branch_id = ${branchId})` : Prisma.sql`TRUE`}`;
}
export function commentWorkSql(actor: ChatWorkActor, scope: WorkScope): Prisma.Sql {
  commentWorkWhere(actor, scope);
  const branch = getBranchScope(actor);
  const branchId = branch.all ? scope.branchId : branch.branchId;
  return Prisma.sql`c.company = ${scope.company}
    AND ${branchId ? Prisma.sql`c.branch_id = ${branchId}` : Prisma.sql`TRUE`}
    AND ${actor.role === 'SALES' ? Prisma.sql`(c.assignee_id IS NULL OR c.assignee_id = ${actor.id})` : Prisma.sql`TRUE`}`;
}
