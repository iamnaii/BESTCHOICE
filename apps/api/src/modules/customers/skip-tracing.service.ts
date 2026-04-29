import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCustomerContactDto } from './dto/skip-tracing.dto';

/**
 * Skip-tracing service (P2 Collections — D6).
 *
 * Updates a customer's reachability data when collectors locate a new phone
 * number / LINE ID, or flags them as LOST when all leads are exhausted.
 *
 * Each call writes a `SKIP_TRACING_UPDATE` audit log entry capturing the old
 * + new contact values + the collector-supplied reason. Audit log uses the
 * append-only chain in `AuditService` so the trail is tamper-evident.
 */
@Injectable()
export class SkipTracingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async updateContact(
    customerId: string,
    dto: UpdateCustomerContactDto,
    actor: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (
      dto.newPhone === undefined &&
      dto.newLineId === undefined &&
      !dto.markAsLost
    ) {
      throw new BadRequestException(
        'ต้องระบุเบอร์ใหม่ LINE ID ใหม่ หรือทำเครื่องหมาย "สูญหาย" อย่างน้อยหนึ่งอย่าง',
      );
    }

    const existing = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: {
        id: true,
        phone: true,
        lineIdFinance: true,
        status: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }

    const data: {
      phone?: string;
      lineIdFinance?: string;
      status?: 'LOST';
    } = {};

    if (dto.newPhone !== undefined) data.phone = dto.newPhone;
    if (dto.newLineId !== undefined) data.lineIdFinance = dto.newLineId;
    if (dto.markAsLost) data.status = 'LOST';

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data,
      select: {
        id: true,
        phone: true,
        lineIdFinance: true,
        status: true,
      },
    });

    // Audit trail — old + new values for tamper-evident review.
    await this.audit.log({
      userId: actor.userId,
      action: 'SKIP_TRACING_UPDATE',
      entity: 'customer',
      entityId: customerId,
      oldValue: {
        phone: existing.phone,
        lineIdFinance: existing.lineIdFinance,
        status: existing.status,
      },
      newValue: {
        phone: updated.phone,
        lineIdFinance: updated.lineIdFinance,
        status: updated.status,
        reason: dto.reason,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return updated;
  }
}
