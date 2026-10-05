import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseBooleanFlag } from '../../../utils/config.util';
import { deriveStage } from '../../after-sales/utils/after-sales-stage.util';
import {
  RECONCILE_SELECT,
  type ReconcilableCase,
} from '../../after-sales/services/after-sales-stage-reconcile';
/** Database counterpart of deriveStage's terminal branches. Only terminal candidates
 * are materialized; no complete task/case table is filtered or counted in JavaScript. */
export const terminalServiceCaseWhere: Prisma.AfterSalesCaseWhereInput = {
  deletedAt: null,
  OR: [
    { cancelledAt: { not: null } },
    {
      outcome: 'REPAIR',
      OR: [
        { repairTicket: null },
        { repairTicket: { deletedAt: { not: null } } },
        { repairTicket: { status: { in: ['CLOSED', 'CANCELLED'] } } },
        { repairTicket: { status: 'REPLACED' }, closedAt: { not: null } },
      ],
    },
    {
      outcome: { in: ['SAME_MODEL_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'] },
      closedAt: { not: null },
    },
    {
      outcome: 'PRICED_EXCHANGE',
      exchangeRequest: {
        OR: [
          { status: { in: ['REJECTED', 'CANCELED'] } },
          { status: 'APPROVED', mode: 'MEMO', memoAppliedAt: { not: null } },
          { status: 'APPROVED', mode: 'PRICED', newContract: { status: { not: 'DRAFT' } } },
        ],
      },
    },
  ],
};
export function serviceCaseStage(row: ReconcilableCase) {
  return deriveStage({
    outcome: row.outcome,
    cancelledAt: row.cancelledAt,
    closedAt: row.closedAt,
    repairStatus: row.repairTicket?.status ?? null,
    repairDeleted: !!row.repairTicket?.deletedAt,
    replacementContractId: row.replacementContractId,
    exchange: row.exchangeRequest
      ? {
          status: row.exchangeRequest.status,
          mode: row.exchangeRequest.mode,
          memoAppliedAt: row.exchangeRequest.memoAppliedAt,
          newContractStatus: row.exchangeRequest.newContract?.status ?? null,
        }
      : null,
  });
}
export const serviceCaseSelect = {
  ...RECONCILE_SELECT,
  caseNumber: true,
  deviceImei: true,
  productId: true,
  contractId: true,
  saleId: true,
  repairTicketId: true,
} satisfies Prisma.AfterSalesCaseSelect;
/** Self-heal only follow-up work from canonical lifecycle evidence. Never write a repair,
 * case stage, financial document or notification. A reader is never credited as the closer. */
export async function syncClosedServiceWork(
  prisma: PrismaService,
  room: Prisma.ChatRoomWhereInput,
  requestId?: string,
) {
  const enabled = parseBooleanFlag(
    (
      await prisma.systemConfig.findFirst({
        where: { key: 'chat_service_requests_enabled', deletedAt: null },
      })
    )?.value,
    false,
  );
  if (!enabled) return;
  let afterId: string | undefined;
  for (;;) {
    const candidates = await prisma.chatServiceRequest.findMany({
      where: {
        ...(requestId ? { id: requestId } : afterId ? { id: { gt: afterId } } : {}),
        room,
        deletedAt: null,
        status: 'LINKED',
        todo: { deletedAt: null, status: { in: ['TODO', 'DOING', 'REVIEW'] } },
        afterSalesCase: terminalServiceCaseWhere,
      },
      select: { id: true, roomId: true },
      orderBy: { id: 'asc' },
      take: 50,
    });
    if (!candidates.length) return;
    for (const candidate of candidates)
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${candidate.roomId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM chat_service_requests WHERE id = ${candidate.id} FOR UPDATE`;
        const request = await tx.chatServiceRequest.findFirst({
          where: {
            id: candidate.id,
            deletedAt: null,
            status: 'LINKED',
            room,
            todo: {
              deletedAt: null,
              workKind: 'CHAT_SERVICE',
              status: { in: ['TODO', 'DOING', 'REVIEW'] },
            },
            afterSalesCase: { deletedAt: null },
          },
          include: { todo: true, afterSalesCase: { select: serviceCaseSelect } },
        });
        if (!request?.afterSalesCase) return;
        const c = request.afterSalesCase;
        const stage = serviceCaseStage(c);
        if (stage !== 'CLOSED' && stage !== 'CANCELLED') return;
        const [caseEvent, repairEvent] = await Promise.all([
          tx.afterSalesEvent.findFirst({
            where: {
              caseId: c.id,
              kind: { in: stage === 'CLOSED' ? ['CLOSED', 'DELIVERED'] : ['CANCELLED'] },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          }),
          c.repairTicketId
            ? tx.repairStatusLog.findFirst({
                where: {
                  ticketId: c.repairTicketId,
                  toStatus: stage === 'CLOSED' ? 'CLOSED' : 'CANCELLED',
                },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              })
            : null,
        ]);
        const candidateActor = repairEvent?.changedById ?? caseEvent?.actorId ?? null;
        const actorId =
          candidateActor && (await tx.user.count({ where: { id: candidateActor } }))
            ? candidateActor
            : null;
        const status = stage === 'CLOSED' ? 'DONE' : 'CANCELLED';
        const completedAt =
          stage === 'CLOSED'
            ? (c.closedAt ??
              c.repairTicket?.returnedToCustomerAt ??
              c.exchangeRequest?.memoAppliedAt ??
              repairEvent?.createdAt ??
              caseEvent?.createdAt ??
              null)
            : null;
        const task = request.todo;
        const changed = await tx.todo.updateMany({
          where: { id: task.id, revision: task.revision, deletedAt: null, status: task.status },
          data: { status, completedAt, revision: { increment: 1 } },
        });
        if (!changed.count) return;
        await tx.todoWorkEvent.create({
          data: {
            todoId: task.id,
            actorId,
            kind: stage === 'CLOSED' ? 'CASE_CLOSED' : 'CASE_CANCELLED',
            fromStatus: task.status,
            toStatus: status,
            fromDueAt: task.dueDate,
            toDueAt: task.dueDate,
            fromAssigneeId: task.assigneeId,
            toAssigneeId: task.assigneeId,
          },
        });
        await tx.chatServiceRequest.update({
          where: { id: request.id },
          data: { revision: { increment: 1 } },
        });
        await tx.chatServiceRequestEvent.create({
          data: {
            requestId: request.id,
            actorId,
            kind: 'CASE_TERMINAL_OBSERVED',
            fromStatus: 'LINKED',
            toStatus: 'LINKED',
            reason: stage,
          },
        });
      });
    if (requestId || candidates.length < 50) return;
    afterId = candidates[candidates.length - 1].id;
  }
}
