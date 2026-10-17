import { ForbiddenException } from '@nestjs/common';
import { AccessResource, canAccess } from '@installment/shared';
import { currentDomainAccess, isCurrentDomainClient } from './access-execution-context';
import { AccessResourceService } from './access-resource.service';
import { AccessClient } from './access-snapshot.service';
import { contractWarrantySource } from './access-repair-scope';
import { saleSource } from './access-sales-scope';
import { WORK_CHANNELS } from '../staff-chat/services/chat-work-access.service';

/** Narrow request action only, never a room/history read capability. Call after
 * locking room and request. Each actual origin retains its original tuple. */
export async function authorizeChatServiceRequest(
  tx: AccessClient,
  id: string,
  userId: string,
  resources: AccessResourceService,
) {
  const ctx = currentDomainAccess();
  if (!ctx || !isCurrentDomainClient(tx) || ctx.snapshot.userId !== userId)
    throw new ForbiddenException('ต้องตรวจแหล่งใบรับเรื่องปัจจุบัน');
  await tx.$queryRaw`SELECT t.id FROM todos t JOIN chat_service_requests r ON r.todo_id=t.id WHERE r.id=${id} FOR UPDATE OF t`;
  const request = await tx.chatServiceRequest.findFirst({
    where: { id, deletedAt: null, todo: { deletedAt: null }, room: { deletedAt: null } },
    include: {
      todo: { select: { assigneeId: true, roomId: true } },
      room: { select: { channel: true } },
    },
  });
  if (!request || request.todo.roomId !== request.roomId)
    throw new ForbiddenException('ไม่พบแหล่งใบรับเรื่อง');
  const company = (['SHOP', 'FINANCE'] as const).find((c) =>
    WORK_CHANNELS[c].includes(request.room.channel),
  );
  if (
    !company ||
    !(await tx.companyInfo.count({
      where: { companyCode: company, isActive: true, deletedAt: null },
    }))
  )
    throw new ForbiddenException('ไม่พบบริษัทใบรับเรื่อง');
  const assignedUserIds = request.todo.assigneeId ? [request.todo.assigneeId] : [];
  const sources: AccessResource[] = [];
  if (request.requestedProductId)
    sources.push(await resources.product(tx, request.requestedProductId, true));
  if (request.contractId) sources.push(await contractWarrantySource(tx, request.contractId, true));
  if (request.saleId) {
    const source = await saleSource(tx, request.saleId, true);
    if (!(await tx.sale.count({ where: { id: request.saleId, deletedAt: null } })))
      throw new ForbiddenException('ไม่พบแหล่งใบขายปัจจุบัน');
    sources.push(source);
  }
  // Room company and every real source are independent; no prospective-case origin.
  const roomSources: AccessResource[] = sources.length
    ? sources.map((source) => ({ company, branchId: source.branchId, assignedUserIds }))
    : [{ company, assignedUserIds }];
  if (
    [...roomSources, ...sources.map((source) => ({ ...source, assignedUserIds }))].some(
      (source) => !canAccess(ctx.snapshot, 'chat.update', source),
    )
  )
    throw new ForbiddenException('ไม่มีสิทธิ์เชื่อมใบรับเรื่อง');
  return {
    company,
    requestId: request.id,
    revision: request.revision,
    fingerprint: request.requestFingerprint,
    roomId: request.roomId,
    requestedProductId: request.requestedProductId,
    contractId: request.contractId,
    saleId: request.saleId,
    customerId: request.customerId,
    todoId: request.todoId,
    assigneeId: request.todo.assigneeId,
  };
}
