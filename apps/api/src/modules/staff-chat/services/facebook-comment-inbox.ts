import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StaffInboxInput } from '@installment/shared';
import { parseBooleanFlag } from '../../../utils/config.util';
import { commentWorkWhere } from './facebook-comment-scope';
/** Shared transactional enqueue for webhook ingestion and staff actions; no dependency on a chat room. */
export async function enqueueCommentNotice(
  tx: Prisma.TransactionClient,
  input: StaffInboxInput,
  skipIneligible = false,
) {
  if (
    !input.facebookCommentId ||
    input.facebookCommentId !== input.targetId ||
    input.targetType !== 'FACEBOOK_COMMENT' ||
    input.kind !== 'FACEBOOK_COMMENT' ||
    input.roomId ||
    input.todoId ||
    !input.title.trim() ||
    input.title.length > 255
  )
    throw new BadRequestException('ปลายทางคอมเมนต์ไม่ถูกต้อง');
  if (
    !parseBooleanFlag(
      (
        await tx.systemConfig.findFirst({
          where: { key: 'in_app_notifications_enabled', deletedAt: null },
        })
      )?.value,
      true,
    )
  )
    return null;
  const recipient = await tx.user.findFirst({
    where: { id: input.recipientId, deletedAt: null, isActive: true, isSystemUser: false },
  });
  if (!recipient) return null;
  try {
    const where = commentWorkWhere(recipient, { company: 'SHOP' });
    if (
      !(await tx.facebookCommentThread.count({
        where: { AND: [where, { id: input.facebookCommentId }] },
      }))
    )
      throw new ForbiddenException('ผู้รับไม่มีสิทธิ์คอมเมนต์นี้');
  } catch (e) {
    if (skipIneligible && e instanceof ForbiddenException) return null;
    throw e;
  }
  await tx.staffInboxItem.createMany({ data: [input], skipDuplicates: true });
  return tx.staffInboxItem.findFirst({
    where: {
      dedupeKey: input.dedupeKey,
      recipientId: input.recipientId,
      facebookCommentId: input.facebookCommentId,
      targetType: 'FACEBOOK_COMMENT',
      targetId: input.targetId,
      deletedAt: null,
    },
    select: { id: true },
  });
}
