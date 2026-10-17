import {
  currentDomainAccess,
  domainAccessClient,
} from '../employee-access/access-execution-context';
import {
  promotionUsageVisible,
  visiblePromotionUsageWhere,
} from '../employee-access/access-promotions-source';
import { promotionProjection, validatePromotion } from './promotion-policy';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, PromotionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotions.dto';

@Injectable()
export class PromotionsService {
  constructor(private readonly basePrisma: PrismaService) {}
  private get prisma(): PrismaService {
    return domainAccessClient(this.basePrisma);
  }

  private async project(p: Parameters<typeof promotionProjection>[0]) {
    const safe = promotionProjection(p);
    if (!currentDomainAccess()) return safe;
    const usages = await this.prisma.promotionUsage.findMany({
      where: { promotionId: p.id, AND: visiblePromotionUsageWhere() },
      include: { sale: true, benefit: true },
    });
    let visibleUsageCount = 0;
    for (const usage of usages) if (await promotionUsageVisible(usage)) visibleUsageCount++;
    return { ...safe, visibleUsageCount, usageCountScope: 'CURRENT_AUTHORIZED_COMPLETE_SOURCES' };
  }
  private async audit(id: string, action: string) {
    const ctx = currentDomainAccess();
    if (ctx)
      await ctx.client.auditLog.create({
        data: { userId: ctx.snapshot.userId, action, entity: 'promotion', entityId: id },
      });
  }

  async create(dto: CreatePromotionDto) {
    validatePromotion({
      ...dto,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    });
    const row = await this.prisma.promotion.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type as PromotionType,
        discountValue: dto.discountValue,
        specialInterestRate: dto.specialInterestRate,
        conditions:
          dto.conditions === null ? Prisma.DbNull : (dto.conditions as Prisma.InputJsonValue),
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        maxUsageCount: dto.maxUsageCount,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit(row.id, 'PROMOTION_CREATED');
    return this.project(row);
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
      }),
      this.prisma.promotion.count({ where }),
    ]);

    return paginatedResponse(
      await Promise.all(data.map((p) => this.project(p))),
      total,
      page,
      limit,
    );
  }

  private async activeRows() {
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

  async findActivePromotions() {
    return Promise.all((await this.activeRows()).map((p) => this.project(p)));
  }

  /**
   * Public (web-shop) view of active promotions — display-safe fields only.
   * Usage counters stay internal: exposing remaining quota invites quota-sniping
   * and leaks campaign performance to competitors.
   */
  async findActivePublic() {
    const promotions = await this.activeRows();
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
    });
    if (!promotion || promotion.deletedAt) {
      throw new NotFoundException('ไม่พบโปรโมชัน');
    }
    return this.project(promotion);
  }

  async update(id: string, dto: UpdatePromotionDto) {
    await this.prisma.$queryRaw`SELECT id FROM promotions WHERE id = ${id} FOR UPDATE`;
    const current = await this.prisma.promotion.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException('ไม่พบโปรโมชัน');
    validatePromotion({
      ...current,
      ...dto,
      startDate: dto.startDate === undefined ? current.startDate : new Date(dto.startDate),
      endDate: dto.endDate === undefined ? current.endDate : new Date(dto.endDate),
    });

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.discountValue !== undefined) data.discountValue = dto.discountValue;
    if (dto.specialInterestRate !== undefined) data.specialInterestRate = dto.specialInterestRate;
    if (dto.conditions !== undefined)
      data.conditions =
        dto.conditions === null ? Prisma.DbNull : (dto.conditions as Prisma.InputJsonValue);
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.maxUsageCount !== undefined) data.maxUsageCount = dto.maxUsageCount;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const row = await this.prisma.promotion.update({ where: { id }, data });
    await this.audit(id, 'PROMOTION_UPDATED');
    return this.project(row);
  }

  async applyToSale(
    promotionId: string,
    saleId: string,
    customerId: string,
    discountAmount?: number,
  ) {
    if (!currentDomainAccess()) throw new ForbiddenException('ต้องตรวจสอบสิทธิ์การขายปัจจุบัน');
    // Lock/re-read the actual Sale before reading evidence; campaign edits cannot invalidate a committed benefit.
    await this.prisma.$queryRaw`SELECT id FROM sales WHERE id = ${saleId} FOR UPDATE`;
    const usage = await this.prisma.promotionUsage.findFirst({
      where: { promotionId, saleId, customerId, deletedAt: null, benefitId: { not: null } },
      include: { sale: true, benefit: true },
    });
    if (!usage || !usage.benefit || !(await promotionUsageVisible(usage, true)))
      throw new ForbiddenException('ไม่พบหลักฐานโปรโมชันที่มีสิทธิ์');
    if (discountAmount !== undefined && !usage.discountApplied.eq(discountAmount))
      throw new BadRequestException('ยอดส่วนลดไม่ตรงหลักฐาน');
    return {
      id: usage.id,
      benefitId: usage.benefitId,
      saleId: usage.saleId,
      promotionId: usage.promotionId,
      discountApplied: usage.discountApplied,
      status: 'RECORDED',
    };
  }

  async remove(id: string) {
    await this.prisma.$queryRaw`SELECT id FROM promotions WHERE id = ${id} FOR UPDATE`;
    const row = await this.prisma.promotion.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('ไม่พบโปรโมชัน');
    await this.prisma.promotion.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit(id, 'PROMOTION_REMOVED');
    return { id };
  }
}
