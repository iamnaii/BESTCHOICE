import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FINANCE_LINE_RECIPIENT_SELECT,
  financeLineRecipient,
} from '../line-oa/services/otp-verified-customer';
import { MdmLockService } from './mdm-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/notification-category.enum';
import {
  type NotSentReason,
  type SendOutcome,
  describeSendOutcome,
  notSentOutcome,
} from '../notifications/send-outcome';
import { LINE_FINANCE_NOT_VERIFIED_MESSAGE } from '../line-oa/services/finance-line-link';
import { BulkAssignDto, BulkProposeLockDto, BulkSendLineDto } from './dto/bulk.dto';
import { SendLineAdHocDto } from './dto/send-line-adhoc.dto';
import { type LineSendActor, lineSendContractScope } from './line-send-scope';

/** สัญญาที่ไม่ได้ส่ง LINE พร้อมเหตุผลภาษาไทย (Task 34 ข้อ 2 — `send-outcome.ts`) */
export interface LineSendNotSent {
  contractId: string;
  contractNumber: string;
  reason: NotSentReason;
  reasonText: string;
}

/**
 * ผลของปุ่ม "ส่ง LINE" / ส่งรวด — `sent` = ส่งถึงแล้วเท่านั้น (`SENT`) · `failed` = ไม่ได้ส่งทุกเหตุผล (`sent + failed = total`) ·
 * `notSent` = รายสัญญาพร้อมเหตุผล (ถูกระงับ / รอเวลาทำการ / ส่งไม่ผ่านแล้วเข้าคิวส่งซ้ำ / ไม่มีปลายทาง / ระบบผิดพลาด)
 */
export interface LineSendResult {
  sent: number;
  failed: number;
  total: number;
  notSent: LineSendNotSent[];
}

@Injectable()
export class OverdueBulkService {
  constructor(
    private prisma: PrismaService,
    private mdmLockService: MdmLockService,
    private notifications: NotificationsService,
  ) {}

  async bulkAssign(dto: BulkAssignDto, actorId: string) {
    const [result] = await this.prisma.$transaction([
      this.prisma.contract.updateMany({
        where: { id: { in: dto.contractIds }, deletedAt: null },
        data: { assignedToId: dto.assignedToId, assignedAt: new Date() },
      }),
      this.prisma.auditLog.createMany({
        data: dto.contractIds.map((id) => ({
          userId: actorId,
          action: 'BULK_ASSIGN',
          entity: 'contract',
          entityId: id,
          newValue: { assignedToId: dto.assignedToId },
        })),
      }),
    ]);

    return { updated: result.count, requested: dto.contractIds.length };
  }

  async bulkProposeLock(dto: BulkProposeLockDto, actorId: string) {
    const results = await Promise.allSettled(
      dto.contractIds.map((id) => this.mdmLockService.proposeManual(id, actorId, dto.reason)),
    );
    const proposed = results.filter((r) => r.status === 'fulfilled').length;
    // Z8: surface created request ids so the FE undo can DELETE one of them
    // as a representative reverse (full bulk undo intentionally not supported).
    const requestIds = results.flatMap((r) =>
      r.status === 'fulfilled' && r.value && typeof (r.value as { id?: unknown }).id === 'string'
        ? [(r.value as { id: string }).id]
        : [],
    );
    return {
      proposed,
      failed: results.length - proposed,
      requested: dto.contractIds.length,
      requestIds,
    };
  }

  /**
   * ปุ่ม "ส่ง LINE" ของคิวทวงถาม (สัญญาเดียว):
   * - Task 24 RR-M2 + fix round 1 M-4 — ลูกค้าที่ไม่มีแถว OTP ที่ยังผูก **ณ ตอนส่ง** (ผู้ส่งไม่มีปลายทาง — รวมแถวที่ถูกปิดระหว่างเปิดหน้ากับกดส่ง)
   *   = 400 `LINE_FINANCE_NOT_VERIFIED_MESSAGE` · ไม่พบสัญญา = 404 — ทั้งสองกรณีลองใหม่ไม่ช่วย จึงไม่ตอบ 201 `{ sent: 0 }` ที่หน้าเว็บแปลเป็น
   *   "ระบบส่งข้อความไม่ผ่าน กรุณาลองใหม่" (เหลือไว้เฉพาะส่งไม่ผ่านจริง ซึ่งลองใหม่ได้)
   * - ขอบเขต `lineSendContractScope` (สาขาตัวเอง หรือ มีงานรายวันวันนี้ — fix round 1 M-3 + round 2 I-R1) · นอกขอบเขต = 404 เหมือนไม่พบ
   * - Task 34 ข้อ 2 — ถูกระงับ/ยังไม่ได้ส่ง = 201 `{ sent: 0, notSent: [{ reason, reasonText }] }` (ไม่ใช่ error: ลองใหม่ไม่ช่วย หน้าเว็บแสดงเหตุผล)
   */
  async sendLineAdhoc(
    contractId: string,
    dto: SendLineAdHocDto,
    actor: LineSendActor,
  ): Promise<LineSendResult> {
    const { result, noRecipient } = await this.sendLineToContracts(
      { contractIds: [contractId], templateId: dto.templateId, customMessage: dto.customMessage },
      actor,
    );
    if (result.total === 0) throw new NotFoundException('ไม่พบสัญญา');
    if (noRecipient > 0) throw new BadRequestException(LINE_FINANCE_NOT_VERIFIED_MESSAGE);
    return result;
  }

  /** ส่ง LINE รวด (แบนเนอร์ "นัดครบกำหนดวันนี้") — สัญญานอก `lineSendContractScope` ไม่ถูกโหลด ไม่ถูกส่ง ไม่นับ (fix round 1 M-3 · round 2 I-R1) */
  async bulkSendLine(dto: BulkSendLineDto, actor: LineSendActor): Promise<LineSendResult> {
    return (await this.sendLineToContracts(dto, actor)).result;
  }

  private async sendLineToContracts(
    dto: BulkSendLineDto,
    actor: LineSendActor,
  ): Promise<{ result: LineSendResult; noRecipient: number }> {
    if (!dto.templateId && !dto.customMessage) {
      throw new BadRequestException('ต้องระบุ templateId หรือ customMessage');
    }
    const actorId = actor.id;

    // Load contracts with customer LINE info — เฉพาะที่ผู้ใช้เห็นบนหน้าจอที่ปุ่มอยู่ (lineSendContractScope)
    const contracts = await this.prisma.contract.findMany({
      where: {
        id: { in: dto.contractIds },
        deletedAt: null,
        ...lineSendContractScope(actor),
      },
      include: {
        customer: {
          select: { id: true, ...FINANCE_LINE_RECIPIENT_SELECT, phone: true, name: true },
        },
      },
    });

    // Resolve template message if templateId provided
    let templateMessage: string | null = null;
    if (dto.templateId) {
      const rule = await this.prisma.dunningRule.findUnique({
        where: { id: dto.templateId },
      });
      if (!rule) {
        throw new BadRequestException('ไม่พบ template');
      }
      templateMessage = rule.messageTemplate;
    }

    let sent = 0;
    let noRecipient = 0;
    const notSent: LineSendNotSent[] = [];
    const recordNotSent = (c: { id: string; contractNumber: string }, outcome: SendOutcome) => {
      if (outcome.sent) return;
      notSent.push({
        contractId: c.id,
        contractNumber: c.contractNumber,
        reason: outcome.reason,
        reasonText: outcome.reasonText,
      });
    };
    const auditEntries: Prisma.AuditLogCreateManyInput[] = [];
    for (const c of contracts) {
      // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
      const financeLineId = financeLineRecipient(c.customer);
      if (!financeLineId) {
        noRecipient++;
        recordNotSent(c, notSentOutcome('NO_RECIPIENT'));
        continue;
      }

      const message =
        dto.customMessage ??
        (templateMessage ?? '').replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
          const vars: Record<string, string> = {
            customerName: c.customer.name,
            contractNumber: c.contractNumber,
          };
          return vars[key] ?? _match;
        });

      let result: { status: string; blockReason?: string };
      try {
        result = await this.notifications.send(
          {
            channel: 'LINE',
            channelKey: 'line-finance',
            recipient: financeLineId,
            message,
            relatedId: c.id,
            fallbackPhone: c.customer.phone ?? undefined,
            customerId: c.customer.id,
            category: NotificationCategory.DUNNING,
          },
          // พนักงานกดส่งเองจากคิวทวงถาม — ไม่ถูกระงับช่วงผ่อนผันหลังผูก LINE ของสัญญานำเข้า (Task 30 รอบ 2 ข้อ 2)
          { manual: true },
        );
      } catch {
        recordNotSent(c, notSentOutcome('SEND_ERROR'));
        continue;
      }
      // Task 34 ข้อ 2 — ส่งแล้ว = `SENT` เท่านั้น · ถูกระงับ (ไม่มีความยินยอม / เกินวันละครั้ง) · รอเวลาทำการ · เข้าคิวส่งซ้ำ = ไม่ได้ส่ง พร้อมเหตุผล
      const outcome = describeSendOutcome(result);
      if (outcome.sent) sent++;
      else recordNotSent(c, outcome);
      auditEntries.push({
        userId: actorId,
        action: 'BULK_SEND_LINE',
        entity: 'contract',
        entityId: c.id,
        newValue: {
          templateId: dto.templateId ?? null,
          hasCustomMessage: Boolean(dto.customMessage),
          outcome: result.status,
          notSentReason: outcome.sent ? null : outcome.reason,
        },
      });
    }

    if (auditEntries.length > 0) {
      await this.prisma.auditLog.createMany({ data: auditEntries });
    }

    return {
      result: { sent, failed: notSent.length, total: contracts.length, notSent },
      noRecipient,
    };
  }
}
