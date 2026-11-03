import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import { runWithTransactionRetry } from '../../utils/transaction-retry.util';
import {
  isLockOrderRetryable,
  lockFinanceLineCustomers,
  RoomCustomerChangedError,
} from '../line-oa/services/finance-line-link';

/** ทรานแซกชันของการทำเครื่องหมายลองซ้ำสูงสุดกี่ครั้ง (deadlock/serialization หรือลูกค้าของห้องเปลี่ยนระหว่างล็อก — Task 29 fix round 1) */
const DISPOSITION_MAX_ATTEMPTS = 3;
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
    const result = await runWithTransactionRetry(
      () => this.recordInTx(input, authenticated, scope),
      DISPOSITION_MAX_ATTEMPTS,
      isLockOrderRetryable,
    );
    await this.states.recompute([result.customerId]);
    return { id: result.id, customerId: result.customerId, kind: result.kind };
  }

  /**
   * Task 29 fix round 1 — **ลำดับล็อกเดียว ลูกค้า → ห้อง** (เท่า `VerificationService.bind` · ยกเลิกผูก LINE การเงิน · ผูกห้อง · ผลวิเคราะห์สเตทเม้น):
   * เดิมล็อกห้อง `FOR UPDATE` แล้วค่อยล็อกลูกค้าตัวจริง ⇒ ทำเครื่องหมายห้อง LINE การเงินพร้อมลูกค้ายืนยัน OTP ของ LINE ห้องนั้น = deadlock 40P01 ·
   * อ่านลูกค้าตัวจริงของห้อง (ไม่ล็อก) → ล็อกลูกค้า (`lockFinanceLineCustomers` — NO KEY UPDATE ยังเรียงคำตัดสินของลูกค้าคนเดียวกันข้ามห้อง และชนกับการรวมลูกค้า)
   * → ล็อกห้อง → ตรวจทุกอย่างซ้ำตามเดิม · ลูกค้าตัวจริงเปลี่ยนระหว่างนั้น = `RoomCustomerChangedError` (ยังไม่เขียนอะไร — ผู้เรียกลองทั้งก้อนใหม่) ·
   * ทุกขั้นอ่านใหม่ จึงลองซ้ำได้ (คำขอซ้ำ P2002 ของ `manualRequestKey` รอบใหม่ได้แถวเดิม)
   */
  private recordInTx(input: ManualDisposition, authenticated: ChatWorkActor, scope: WorkScope) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await this.access.currentActor(authenticated, tx);
      const seen = await this.access.assertRoom(input.roomId, actor, scope, tx);
      const lockedCustomerId = seen.customerId
        ? await this.peekCanonicalCustomer(tx, seen.customerId)
        : null;
      await lockFinanceLineCustomers(tx, [lockedCustomerId]);
      await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${input.roomId} FOR UPDATE`;
      const room = await this.access.assertRoom(input.roomId, actor, scope, tx);
      const flag = await tx.systemConfig.findFirst({
        where: { key: 'chat_follow_up_enabled', deletedAt: null },
      });
      if (!parseBooleanFlag(flag?.value, false))
        throw new ForbiddenException('ยังไม่เปิดใช้งานส่วนนี้');
      if (!room.customerId) throw new BadRequestException('กรุณาผูกข้อมูลลูกค้าก่อน');
      const customerId = await this.canonicalCustomer(tx, room.customerId);
      // Serialize manual decisions across rooms for the same canonical customer — locked above, before the room.
      if (customerId !== lockedCustomerId)
        throw new RoomCustomerChangedError(
          'ห้องแชทเปลี่ยนลูกค้าระหว่างบันทึก กรุณาโหลดใหม่แล้วลองอีกครั้ง',
        );
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
  }

  /** ลูกค้าตัวจริงของห้อง (ไล่สาย merge) — ข้อผิดพลาดเดิม: วนซ้ำ/ยาวเกิน = 409 · ไม่พบ/ถูกลบโดยไม่มีปลายทาง = 404 */
  private async canonicalCustomer(tx: Prisma.TransactionClient, start: string): Promise<string> {
    let customerId = start;
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
      return customerId;
    }
  }

  /** อ่านลูกค้าตัวจริงก่อนล็อก — ไล่ไม่ได้ = ไม่ล็อกใคร (ข้อผิดพลาดจริงเกิดหลังล็อกห้องตามลำดับการตรวจเดิม) */
  private async peekCanonicalCustomer(tx: Prisma.TransactionClient, start: string) {
    try {
      return await this.canonicalCustomer(tx, start);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) return null;
      throw error;
    }
  }
}
