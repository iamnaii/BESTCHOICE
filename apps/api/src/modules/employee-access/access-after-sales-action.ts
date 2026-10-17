import { ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { AfterSalesStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { afterSalesActor, afterSalesSource } from './access-after-sales-source.service';
import { currentDomainAccess } from './access-execution-context';
import { repairSource } from './access-repair-scope';

const actionRows = new WeakMap<object, { client: object; id: string }>();

export type AfterSalesCaseAction = 'after-sales.update' | 'after-sales.create';
/** Business input only: never serialize this row as a managed HTTP view. Reload
 * after pointer changes; this function neither reconciles stages nor grants read. */
export async function loadAfterSalesActionCase(
  base: PrismaService,
  id: string,
  userId: string,
  permission: AfterSalesCaseAction,
) {
  const ctx = await afterSalesActor(base, userId, base);
  if (!ctx || ctx.scope.permission !== permission)
    throw new ForbiddenException('ต้องมีธุรกรรมของการกระทำนี้');
  const source = await afterSalesSource(ctx.client, id, true);
  if (!canAccess(ctx.snapshot, permission, source))
    throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับเคส');
  const row = await ctx.client.afterSalesCase.findUniqueOrThrow({ where: { id } });
  actionRows.set(row, { client: ctx.client, id });
  return row;
}
export type AfterSalesActionCase = Awaited<ReturnType<typeof loadAfterSalesActionCase>>;
/** Independent repair action and exact persisted identity precede raw child state.
 * The canonical repair facade additionally checks all sources actually used. */
export async function loadAfterSalesRepairBusiness(row: AfterSalesActionCase) {
  const ctx = currentDomainAccess();
  const origin = actionRows.get(row);
  if (
    !ctx ||
    origin?.client !== ctx.client ||
    origin.id !== row.id ||
    ctx.scope.permission !== 'after-sales.update'
  )
    throw new ForbiddenException('ต้องมีแหล่งเคสของธุรกรรมปัจจุบัน');
  const sourceCase = await afterSalesSource(ctx.client, row.id, true);
  if (!canAccess(ctx.snapshot, 'after-sales.update', sourceCase))
    throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับเคส');
  const current = await ctx.client.afterSalesCase.findUniqueOrThrow({ where: { id: row.id } });
  if (
    current.repairTicketId !== row.repairTicketId ||
    current.customerId !== row.customerId ||
    current.productId !== row.productId ||
    current.contractId !== row.contractId ||
    current.branchId !== row.branchId
  )
    throw new ForbiddenException('ต้องอ่านแหล่งเคสใหม่');
  if (!row.repairTicketId) return null;
  const source = await repairSource(ctx.client, row.repairTicketId, true);
  if (!canAccess(ctx.snapshot, 'repair-tickets.update', source))
    throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับใบซ่อม');
  const ticket = await ctx.client.repairTicket.findUniqueOrThrow({
    where: { id: row.repairTicketId },
  });
  if (
    ticket.customerId !== row.customerId ||
    ticket.productId !== row.productId ||
    ticket.contractId !== row.contractId
  )
    throw new ForbiddenException('ใบซ่อมไม่ตรงกับแหล่งเคส');
  return ticket;
}
/** Only metadata established by this operation. Full views independently require
 * after-sales.read through AccessAfterSalesQueryService; child IDs are never acks. */
export interface AfterSalesMutationAcknowledgement {
  id: string;
  stage: AfterSalesStage;
}

export interface AfterSalesPhotoAcknowledgement {
  photoCount: number;
  stage: AfterSalesStage;
}
