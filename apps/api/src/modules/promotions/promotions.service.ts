import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, PromotionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotions.dto';

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePromotionDto) {
    return this.prisma.promotion.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type as PromotionType,
        discountValue: dto.discountValue,
        specialInterestRate: dto.specialInterestRate,
        conditions: dto.conditions as Prisma.InputJsonValue,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        maxUsageCount: dto.maxUsageCount,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAll(filters: { isActive?: boolean; page?: number; limit?: number }) {
    const { isActive, page = 1, limit = 50 } = filters;
    const where: Record<string, unknown> = { deletedAt: null };

    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { usages: true } },
        },
      }),
      this.prisma.promotion.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async findActivePromotions() {
    const now = new Date();
    const promotions = await this.prisma.promotion.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { endDate: 'asc' },
    });
    return promotions.filter(
      (p) => p.maxUsageCount === null || p.currentUsageCount < p.maxUsageCount,
    );
  }

  /**
   * Public (web-shop) view of active promotions — display-safe fields only.
   * Usage counters stay internal: exposing remaining quota invites quota-sniping
   * and leaks campaign performance to competitors.
   */
  async findActivePublic() {
    const promotions = await this.findActivePromotions();
    return promotions.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      discountValue: p.discountValue,
      specialInterestRate: p.specialInterestRate,
      conditions: p.conditions,
      startDate: p.startDate,
      endDate: p.endDate,
    }));
  }

  async findOne(id: string) {
    const promotion = await this.prisma.promotion.findUnique({
      where: { id },
      include: {
        _count: { select: { usages: true } },
      },
    });
    if (!promotion || promotion.deletedAt) {
      throw new NotFoundException('ไม่พบโปรโมชัน');
    }
    return promotion;
  }

  async update(id: string, dto: UpdatePromotionDto) {
    await this.findOne(id);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.discountValue !== undefined) data.discountValue = dto.discountValue;
    if (dto.specialInterestRate !== undefined) data.specialInterestRate = dto.specialInterestRate;
    if (dto.conditions !== undefined) data.conditions = dto.conditions as Prisma.InputJsonValue;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.maxUsageCount !== undefined) data.maxUsageCount = dto.maxUsageCount;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.promotion.update({
      where: { id },
      data,
    });
  }

  async applyToSale(
    promotionId: string,
    saleId: string,
    customerId: string,
    discountAmount: number,
  ) {
    const promotion = await this.findOne(promotionId);

    // Validate promotion is active and within date range
    const now = new Date();
    if (!promotion.isActive) {
      throw new BadRequestException('โปรโมชันนี้ไม่ได้เปิดใช้งาน');
    }
    if (now < promotion.startDate || now > promotion.endDate) {
      throw new BadRequestException('โปรโมชันนี้ไม่อยู่ในช่วงเวลาที่กำหนด');
    }
    if (
      promotion.maxUsageCount !== null &&
      promotion.currentUsageCount >= promotion.maxUsageCount
    ) {
      throw new BadRequestException('โปรโมชันนี้ถูกใช้งานครบจำนวนแล้ว');
    }

    // Create usage and increment count in a transaction.
    // The check above is a fast-fail only — it reads currentUsageCount OUTSIDE
    // the tx, so two concurrent callers could both pass it. The real cap
    // guarantee is the conditional (CAS) increment below: updateMany only bumps
    // the row while it is still under the cap, so exactly one of two racing
    // callers at (cap-1) succeeds and the other gets count=0 → over-cap reject.
    return this.prisma.$transaction(async (tx) => {
      if (promotion.maxUsageCount !== null) {
        const bumped = await tx.promotion.updateMany({
          where: { id: promotionId, currentUsageCount: { lt: promotion.maxUsageCount } },
          data: { currentUsageCount: { increment: 1 } },
        });
        if (bumped.count !== 1) {
          throw new BadRequestException('โปรโมชันนี้ถูกใช้งานครบจำนวนแล้ว');
        }
      } else {
        await tx.promotion.update({
          where: { id: promotionId },
          data: { currentUsageCount: { increment: 1 } },
        });
      }

      const usage = await tx.promotionUsage.create({
        data: {
          promotionId,
          saleId,
          customerId,
          discountApplied: discountAmount,
        },
      });

      return usage;
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.promotion.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
