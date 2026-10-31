import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FINANCE_LINE_RECIPIENT_SELECT,
  financeLineRecipient,
} from '../line-oa/services/otp-verified-customer';
import { MdmLockService } from './mdm-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/notification-category.enum';
import { LINE_FINANCE_NOT_VERIFIED_MESSAGE } from '../line-oa/services/finance-line-link';
import { BulkAssignDto, BulkProposeLockDto, BulkSendLineDto } from './dto/bulk.dto';
import { SendLineAdHocDto } from './dto/send-line-adhoc.dto';

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
   * ปุ่ม "ส่ง LINE" ของคิวทวงถาม (สัญญาเดียว) — Task 24 RR-M2: ลูกค้าที่ไม่มีแถว OTP ที่ยังผูก (ผู้ส่งไม่มีปลายทาง) = 400 ข้อความบอกเหตุ +
   * ทางที่มีจริง แทนผล `{ sent: 0 }` ที่หน้าเว็บเดาเหตุไม่ได้ · เกณฑ์เดียวกับ `bulkSendLine` (`financeLineRecipient`) · ไม่พบสัญญา = ส่งต่อตามเดิม
   */
  async sendLineAdhoc(contractId: string, dto: SendLineAdHocDto, actorId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { customer: { select: FINANCE_LINE_RECIPIENT_SELECT } },
    });
    if (contract && financeLineRecipient(contract.customer) === null) {
      throw new BadRequestException(LINE_FINANCE_NOT_VERIFIED_MESSAGE);
    }
    return this.bulkSendLine(
      { contractIds: [contractId], templateId: dto.templateId, customMessage: dto.customMessage },
      actorId,
    );
  }

  async bulkSendLine(dto: BulkSendLineDto, actorId: string) {
    if (!dto.templateId && !dto.customMessage) {
      throw new BadRequestException('ต้องระบุ templateId หรือ customMessage');
    }

    // Load contracts with customer LINE info
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: dto.contractIds }, deletedAt: null },
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
    let failed = 0;
    const auditEntries: Prisma.AuditLogCreateManyInput[] = [];
    for (const c of contracts) {
      // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
      const financeLineId = financeLineRecipient(c.customer);
      if (!financeLineId) {
        failed++;
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

      try {
        await this.notifications.send({
          channel: 'LINE',
          channelKey: 'line-finance',
          recipient: financeLineId,
          message,
          relatedId: c.id,
          fallbackPhone: c.customer.phone ?? undefined,
          customerId: c.customer.id,
          category: NotificationCategory.DUNNING,
        });
        sent++;
        auditEntries.push({
          userId: actorId,
          action: 'BULK_SEND_LINE',
          entity: 'contract',
          entityId: c.id,
          newValue: {
            templateId: dto.templateId ?? null,
            hasCustomMessage: Boolean(dto.customMessage),
          },
        });
      } catch {
        failed++;
      }
    }

    if (auditEntries.length > 0) {
      await this.prisma.auditLog.createMany({ data: auditEntries });
    }

    return { sent, failed, total: contracts.length };
  }
}
