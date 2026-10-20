import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentDomainAccess, isCurrentDomainClient } from './access-execution-context';
import { partyRoomReadWhere } from './access-party-scope';
import { preparationScope } from './access-contract-preparation-source';

/** R113: affordability belongs to the exact Customer and genuine branchless room.
 * Never bootstrap pre-parent authority from the Contract being created. */
export function preparationCreditWhere(customerId: string): Prisma.CreditCheckWhereInput {
  const ctx = currentDomainAccess();
  if (!ctx || ctx.scopeReads || ctx.isolationLevel !== 'Serializable')
    throw new ForbiddenException('ต้องตรวจสิทธิ์เครดิตในธุรกรรมเดียวกัน');
  return {
    customerId,
    deletedAt: null,
    roomAnalysis: {
      is: {
        status: 'COMPLETED',
        deletedAt: null,
        room: {
          is: {
            customerId,
            deletedAt: null,
            OR: (['SHOP', 'FINANCE'] as const).map((company) => ({
              AND: [
                partyRoomReadWhere(preparationScope(ctx.snapshot, 'credit-checks.read', company)),
                partyRoomReadWhere(preparationScope(ctx.snapshot, 'chat.read', company)),
              ],
            })),
          },
        },
      },
    },
  };
}
export async function assertPreparationCredit(
  tx: Prisma.TransactionClient,
  id: string,
  customerId: string,
) {
  const ctx = currentDomainAccess();
  if (!ctx || !isCurrentDomainClient(tx))
    throw new ForbiddenException('ต้องตรวจแหล่งเครดิตปัจจุบัน');
  await tx.$queryRaw`SELECT id FROM credit_checks WHERE id=${id} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM room_credit_analyses WHERE credit_check_id=${id} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT r.id FROM chat_rooms r JOIN room_credit_analyses a ON a.room_id=r.id WHERE a.credit_check_id=${id} ORDER BY r.id FOR SHARE OF r`;
  const check = await tx.creditCheck.findFirst({
    where: { id, AND: preparationCreditWhere(customerId) },
    select: { roomAnalysis: { select: { room: { select: { channel: true } } } } },
  });
  if (!check?.roomAnalysis) throw new ForbiddenException('ไม่มีสิทธิ์ใช้ผลอนุมัติเครดิตนี้');
  const company = check.roomAnalysis.room.channel === 'LINE_FINANCE' ? 'FINANCE' : 'SHOP';
  if (
    !(await tx.companyInfo.count({
      where: { companyCode: company, isActive: true, deletedAt: null },
    }))
  )
    throw new ForbiddenException('ไม่มีสิทธิ์ใช้ผลอนุมัติเครดิตนี้');
}
