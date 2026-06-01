import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReverseReasonDto } from './dto/create-reverse-reason.dto';
import { UpdateReverseReasonDto } from './dto/update-reverse-reason.dto';
import { ReorderReverseReasonsDto } from './dto/reorder-reverse-reasons.dto';

/**
 * InternalControlActionBar — admin-managed dropdown of reverse reasons.
 * Shared across the three accounting modules (Other Income, Expense, Asset).
 *
 * - `listActive()` is the read-path consumed by the ReverseConfirmDialog UI
 *   and by `useUiFlags().reverseReasons` (replaces the hard-coded SystemConfig
 *   JSON defaults).
 * - `listAll()` is the read-path for the Settings management UI (includes
 *   disabled rows so OWNER can re-enable them).
 * - Mutations are soft-deletes — historical audit logs that reference an
 *   inactive/removed reason still resolve to the original label.
 */
@Injectable()
export class ReverseReasonsService {
  constructor(private readonly prisma: PrismaService) {}

  listActive() {
    return this.prisma.reverseReason.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  listAll() {
    return this.prisma.reverseReason.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(dto: CreateReverseReasonDto) {
    const nextOrder =
      dto.sortOrder ??
      ((
        await this.prisma.reverseReason.aggregate({
          where: { deletedAt: null },
          _max: { sortOrder: true },
        })
      )._max.sortOrder ?? 0) + 10;

    return this.prisma.reverseReason.create({
      data: {
        label: dto.label.trim(),
        sortOrder: nextOrder,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateReverseReasonDto) {
    const existing = await this.prisma.reverseReason.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('ไม่พบเหตุผลที่ระบุ');
    }

    return this.prisma.reverseReason.update({
      where: { id },
      data: {
        label: dto.label?.trim() ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.reverseReason.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('ไม่พบเหตุผลที่ระบุ');
    }
    return this.prisma.reverseReason.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /**
   * Bulk reorder — accepts a list of `{id, sortOrder}` rows and writes them
   * in a single transaction. Used by the drag-to-sort affordance in Settings.
   */
  async reorder(dto: ReorderReverseReasonsDto) {
    const ids = dto.rows.map((r) => r.id);
    const existing = await this.prisma.reverseReason.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new NotFoundException('พบบาง id ที่ไม่อยู่ในระบบ');
    }
    await this.prisma.$transaction(
      dto.rows.map((r) =>
        this.prisma.reverseReason.update({
          where: { id: r.id },
          data: { sortOrder: r.sortOrder },
        }),
      ),
    );
    return this.listAll();
  }
}
