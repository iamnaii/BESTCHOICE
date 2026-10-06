import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JOURNEY_LOST_REASON_LABELS,
  CUSTOMER_BOUGHT_SALE_TYPES,
  CUSTOMER_BOUGHT_CONTRACT_STATUSES,
  type ChatWorkActor,
  type WorkScope,
} from '@installment/shared';
import { ChatWorkAccessService } from '../staff-chat/services/chat-work-access.service';
import { JourneyStateService } from './journey-state.service';
import { salesBranchWhere } from '../sales/services/sales-read-policy';
import { chatCustomerFamily } from './chat-scoped-summary';
import { parseBooleanFlag } from '../../utils/config.util';
interface ManualDisposition {
  roomId: string;
  action: 'MARK_LOST' | 'REOPEN';
  reason?: string;
  clientRequestId: string;
}
/** Manual facts have a separate writer and request key; the SYSTEM writer remains unchanged. */
@Injectable()
export class ChatSalesDispositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly states: JourneyStateService,
    private readonly access: ChatWorkAccessService,
  ) {}
  async record(input: ManualDisposition, authenticated: ChatWorkActor, scope: WorkScope) {
    if (
      !['MARK_LOST', 'REOPEN'].includes(input.action) ||
      (input.action === 'MARK_LOST' &&
        !Object.prototype.hasOwnProperty.call(JOURNEY_LOST_REASON_LABELS, input.reason ?? ''))
    )
      throw new BadRequestException('กรุณาเลือกเหตุผลมาตรฐาน');
    const result = await this.prisma.$transaction(async (tx) => {
      const actor = await this.access.currentActor(authenticated, tx);
      await this.access.assertRoom(input.roomId, actor, scope, tx);
      await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${input.roomId} FOR UPDATE`;
      const room = await this.access.assertRoom(input.roomId, actor, scope, tx);
      const flag = await tx.systemConfig.findFirst({
        where: { key: 'chat_follow_up_enabled', deletedAt: null },
      });
      if (!parseBooleanFlag(flag?.value, false))
        throw new ForbiddenException('ยังไม่เปิดใช้งานส่วนนี้');
      if (!room.customerId) throw new BadRequestException('กรุณาผูกข้อมูลลูกค้าก่อน');
      let customerId = room.customerId;
      const visited = new Set<string>();
      for (;;) {
        if (visited.has(customerId) || visited.size >= 20)
          throw new ConflictException('ข้อมูลการรวมลูกค้าต้องได้รับการตรวจสอบ');
        visited.add(customerId);
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
          select: { id: true, deletedAt: true, mergedIntoId: true },
        });
        if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
        if (customer.deletedAt && customer.mergedIntoId) {
          customerId = customer.mergedIntoId;
          continue;
        }
        if (customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
        break;
      }
      // Serialize manual decisions across rooms for the same canonical customer.
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;
      const current = await tx.customer.findUnique({ where: { id: customerId } });
      if (!current || current.deletedAt)
        throw new ConflictException('ข้อมูลลูกค้าเปลี่ยนไป กรุณาโหลดใหม่');
      const manualRequestKey = `chat-disposition:${actor.id}:${input.clientRequestId}`;
      const kind = input.action === 'MARK_LOST' ? 'MARKED_LOST' : 'REOPENED';
      const previous = await tx.customerJourneyEntry.findUnique({ where: { manualRequestKey } });
      if (previous) {
        if (
          previous.roomId !== room.id ||
          previous.customerId !== customerId ||
          previous.kind !== kind ||
          (kind === 'MARKED_LOST' && previous.lostReason !== input.reason)
        )
          throw new ConflictException('รหัสคำขอนี้ถูกใช้กับรายการอื่นแล้ว');
        return previous;
      }
      if (input.action === 'MARK_LOST') {
        const customerScope = { in: await chatCustomerFamily(tx, customerId) };
        const branch = salesBranchWhere(actor, scope.branchId);
        const purchased =
          scope.company === 'SHOP'
            ? await tx.sale.count({
                where: {
                  ...branch,
                  customerId: customerScope,
                  deletedAt: null,
                  saleType: { in: [...CUSTOMER_BOUGHT_SALE_TYPES] },
                },
              })
            : await tx.contract.count({
                where: {
                  ...branch,
                  customerId: customerScope,
                  deletedAt: null,
                  status: { in: [...CUSTOMER_BOUGHT_CONTRACT_STATUSES] },
                },
              });
        if (purchased)
          throw new ConflictException('ลูกค้าซื้อแล้ว กรุณาติดตามจากรายการขายหรือบริการหลังการขาย');
      }
      const latest = await tx.customerJourneyEntry.findFirst({
        where: { customerId, kind: { in: ['MARKED_LOST', 'REOPENED'] }, deletedAt: null },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { occurredAt: true },
      });
      // Timestamp precision is milliseconds. Keep server-authored decisions ordered under the customer lock.
      const occurredAt = new Date(Math.max(Date.now(), (latest?.occurredAt.getTime() ?? 0) + 1));
      const entry = await tx.customerJourneyEntry.create({
        data: {
          customerId,
          originCustomerId: customerId,
          roomId: room.id,
          kind,
          origin: 'MANUAL',
          actorType: 'STAFF',
          actorUserId: actor.id,
          occurredAt,
          lostReason: input.action === 'MARK_LOST' ? input.reason : null,
          manualRequestKey,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: `CHAT_SALES_${kind}`,
          entity: 'CustomerJourneyEntry',
          entityId: entry.id,
          newValue: { roomId: room.id, customerId, kind, reason: entry.lostReason },
        },
      });
      return entry;
    });
    await this.states.recompute([result.customerId]);
    return { id: result.id, customerId: result.customerId, kind: result.kind };
  }
}
