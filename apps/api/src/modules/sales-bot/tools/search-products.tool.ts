import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const SEARCH_PRODUCTS_TOOL = {
  name: 'search_products',
  description:
    'Search BESTCHOICE phone catalog by brand, model keyword, or price range. Returns up to 5 matches.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Brand or model keyword, e.g. "iPhone 15"' },
      maxPriceThb: { type: 'number', description: 'Optional budget cap' },
    },
    required: ['query'],
  },
};

@Injectable()
export class SearchProductsTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { query: string; maxPriceThb?: number }) {
    // NOTE: Product has no direct `sellingPrice` column. We use `costPrice`
    // as the canonical price proxy here to match the shop-catalog pattern.
    // TODO Week 2: Replace with default ProductPrice (label='ราคาเงินสด')
    // via the related `prices` table once the catalog price contract is
    // finalized.
    const rows = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        isOnlineVisible: true,
        OR: [
          { name: { contains: input.query, mode: 'insensitive' } },
          { brand: { contains: input.query, mode: 'insensitive' } },
          { model: { contains: input.query, mode: 'insensitive' } },
        ],
        ...(input.maxPriceThb ? { costPrice: { lte: input.maxPriceThb } } : {}),
      },
      take: 5,
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        costPrice: true,
        conditionGrade: true,
      },
      orderBy: { costPrice: 'asc' },
    });
    return {
      products: rows.map((r) => ({
        id: r.id,
        name: r.name,
        brand: r.brand,
        model: r.model,
        priceThb: Number(r.costPrice),
        condition: r.conditionGrade ?? 'NEW',
      })),
    };
  }
}
