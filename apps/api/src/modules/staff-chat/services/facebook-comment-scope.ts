import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hasCompanyAccess, type ChatWorkActor, type WorkScope } from '@installment/shared';
import { getBranchScope } from '../../auth/branch-access.util';
import { WORK_ROLES } from './chat-work-access.service';
export function commentWorkWhere(
  actor: ChatWorkActor,
  scope: WorkScope,
): Prisma.FacebookCommentThreadWhereInput {
  if (
    !WORK_ROLES.some((role) => role === actor.role) ||
    !hasCompanyAccess(actor.role, actor.accessibleCompanies, scope.company)
  )
    throw new ForbiddenException('ไม่มีสิทธิ์คอมเมนต์ของบริษัทนี้');
  const branch = getBranchScope(actor);
  if (!branch.all && (!branch.branchId || (scope.branchId && scope.branchId !== branch.branchId)))
    throw new ForbiddenException('ไม่มีสิทธิ์คอมเมนต์ของสาขานี้');
  return {
    company: scope.company,
    ...(branch.all
      ? scope.branchId
        ? { branchId: scope.branchId }
        : {}
      : { branchId: branch.branchId! }),
    ...(actor.role === 'SALES' ? { OR: [{ assigneeId: null }, { assigneeId: actor.id }] } : {}),
  };
}
