import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const LIST_PROMOTIONS_TOOL = {
  name: 'list_promotions',
  description: 'List active promotions. Week 1: returns all active promotions (no product filter).',
  input_schema: {
    type: 'object',
    properties: {
      productId: {
        type: 'string',
        description: 'Optional product filter (currently ignored — see Week 2 TODO)',
      },
    },
  },
};

@Injectable()
export class ListPromotionsTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(_input: { productId?: string }) {
    const now = new Date();
    // Promotion schema uses `isActive` (not `active`). Per-product filtering
    // lives inside the `conditions` JSON blob (`conditions.productIds`) which
    // isn't indexable as-is. For Week 1 we return all active promotions and
    // let the bot/reader filter in prose.
    // TODO Week 2: parse `conditions.productIds` + `conditions.categories`
    // when `productId` is supplied.
    const rows = await this.prisma.promotion.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      take: 5,
      select: { id: true, name: true, description: true, endDate: true },
      orderBy: { endDate: 'asc' },
    });
    return {
      promotions: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        endsAt: r.endDate.toISOString(),
      })),
    };
  }
}
