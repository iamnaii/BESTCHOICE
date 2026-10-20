import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  currentDomainAccess,
  isCurrentDomainClient,
} from '../employee-access/access-execution-context';
import { lockPayoffPeriod } from '../contracts/managed-payoff-execution';
import { validatePeriodOpen } from '../../utils/period-lock.util';
/** Internal opt-in for the cancellation writers; no caller body supplies this proof. */
export async function assertManagedCancellationPosting(
  tx: Prisma.TransactionClient,
  actorId: string | undefined,
  date: Date,
  companyId: string,
) {
  const ctx = currentDomainAccess();
  if (
    !ctx ||
    !ctx.snapshot.isOwner ||
    ctx.snapshot.userId !== actorId ||
    ctx.scopeReads ||
    ctx.isolationLevel !== 'Serializable' ||
    !isCurrentDomainClient(tx)
  )
    throw new ForbiddenException('ต้องตรวจสิทธิ์ในธุรกรรมเดียวกัน');
  const company = await tx.companyInfo.findFirst({
    where: {
      id: companyId,
      companyCode: { in: ['SHOP', 'FINANCE'] },
      isActive: true,
      deletedAt: null,
    },
  });
  if (!company) throw new ForbiddenException('ไม่พบสมุดบัญชีปัจจุบัน');
  await lockPayoffPeriod(tx, date, companyId);
  await validatePeriodOpen(tx, date, companyId);
}
