import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentMethodConfigDto } from './dto/create-payment-method-config.dto';
import { UpdatePaymentMethodConfigDto } from './dto/update-payment-method-config.dto';

@Injectable()
export class PaymentMethodConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all configs (excludes soft-deleted). Used by:
   *  • Settings page — show all rows
   *  • RecordPaymentWizard — filter cash account selector by method
   */
  list() {
    return this.prisma.paymentMethodConfig.findMany({
      where: { deletedAt: null },
      orderBy: [{ method: 'asc' }, { sortOrder: 'asc' }, { accountCode: 'asc' }],
    });
  }

  /**
   * Filter list by method — convenience for the wizard's account selector.
   * Returns only enabled rows so the UI doesn't need extra filtering.
   */
  listByMethod(method: string) {
    return this.prisma.paymentMethodConfig.findMany({
      where: { method, enabled: true, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { accountCode: 'asc' }],
    });
  }

  async create(dto: CreatePaymentMethodConfigDto) {
    // Reject duplicate (method, accountCode) pairs — DB has unique constraint
    // but checking here gives a Thai error message instead of a Prisma error.
    const existing = await this.prisma.paymentMethodConfig.findUnique({
      where: {
        method_accountCode: { method: dto.method, accountCode: dto.accountCode },
      },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(
        `ผูก ${dto.method} กับ ${dto.accountCode} อยู่แล้ว — แก้ไขแถวเดิมแทนการเพิ่มใหม่`,
      );
    }

    // If user wants this row to be default, demote any other default of the same method.
    if (dto.isDefault) {
      await this.prisma.paymentMethodConfig.updateMany({
        where: { method: dto.method, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
    }

    if (existing) {
      // Soft-deleted row — undelete + overwrite
      return this.prisma.paymentMethodConfig.update({
        where: { id: existing.id },
        data: {
          isDefault: dto.isDefault ?? false,
          enabled: dto.enabled ?? true,
          sortOrder: dto.sortOrder ?? 0,
          deletedAt: null,
        },
      });
    }

    return this.prisma.paymentMethodConfig.create({
      data: {
        method: dto.method,
        accountCode: dto.accountCode,
        isDefault: dto.isDefault ?? false,
        enabled: dto.enabled ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdatePaymentMethodConfigDto) {
    const row = await this.prisma.paymentMethodConfig.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('ไม่พบการผูกช่องทางนี้');

    // Promoting a row to default → demote others of the same method first.
    if (dto.isDefault === true && !row.isDefault) {
      await this.prisma.paymentMethodConfig.updateMany({
        where: {
          method: row.method,
          isDefault: true,
          deletedAt: null,
          id: { not: id },
        },
        data: { isDefault: false },
      });
    }

    return this.prisma.paymentMethodConfig.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    const row = await this.prisma.paymentMethodConfig.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('ไม่พบการผูกช่องทางนี้');

    // Refuse to delete the last enabled row for a method — would brick the
    // wizard. User must add a replacement first.
    const remaining = await this.prisma.paymentMethodConfig.count({
      where: {
        method: row.method,
        enabled: true,
        deletedAt: null,
        id: { not: id },
      },
    });
    if (remaining === 0) {
      throw new BadRequestException(
        `ลบไม่ได้ — เหลือเป็นบัญชีเดียวที่ใช้กับ ${row.method} ได้ · เพิ่มบัญชีใหม่ก่อน`,
      );
    }

    return this.prisma.paymentMethodConfig.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false },
    });
  }
}
