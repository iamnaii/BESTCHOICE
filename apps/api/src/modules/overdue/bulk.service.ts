import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MdmLockService } from './mdm-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BulkAssignDto, BulkProposeLockDto, BulkSendLineDto } from './dto/bulk.dto';

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

  async bulkSendLine(dto: BulkSendLineDto, actorId: string) {
    if (!dto.templateId && !dto.customMessage) {
      throw new BadRequestException('ต้องระบุ templateId หรือ customMessage');
    }

    // Load contracts with customer LINE info
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: dto.contractIds }, deletedAt: null },
      include: {
        customer: { select: { lineIdFinance: true, phone: true, name: true } },
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
      if (!c.customer.lineIdFinance) {
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
          recipient: c.customer.lineIdFinance,
          message,
          relatedId: c.id,
          fallbackPhone: c.customer.phone ?? undefined,
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
