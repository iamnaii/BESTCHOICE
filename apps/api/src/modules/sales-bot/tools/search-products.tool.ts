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
    // Match shop-catalog filtering: customer-facing surfaces never show
    // products that aren't IN_STOCK. Without this filter, search_products
    // was recommending sold/holding units — and worse, leaking their
    // wholesale `costPrice` as the asking price (Nai bug 2026-05-21:
    // tool returned iPhone 15 Blue 128GB at priceThb=7000 — that's the
    // wholesale, plus the unit wasn't actually in stock).
    const rows = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        isOnlineVisible: true,
        status: 'IN_STOCK',
        OR: [
          { name: { contains: input.query, mode: 'insensitive' } },
          { brand: { contains: input.query, mode: 'insensitive' } },
          { model: { contains: input.query, mode: 'insensitive' } },
        ],
      },
      take: 10,
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        conditionGrade: true,
        prices: {
          where: { deletedAt: null, isDefault: true },
          select: { amount: true, label: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Use the default ProductPrice (selling price) when available. Products
    // without a default ProductPrice row come back with `priceMissing: true`
    // and NO priceThb field — the persona's "no-data → handoff" rule then
    // takes over instead of the bot inventing a price. (Earlier draft of
    // this fix dropped them silently — too aggressive when owner hasn't
    // backfilled ProductPrice rows yet, would have nuked all bot quotes.)
    type Hit =
      | { id: string; name: string; brand: string; model: string; condition: string; priceThb: number }
      | { id: string; name: string; brand: string; model: string; condition: string; priceMissing: true };

    let products: Hit[] = rows.map((r): Hit => {
      const base = {
        id: r.id,
        name: r.name,
        brand: r.brand,
        model: r.model,
        condition: r.conditionGrade ?? 'NEW',
      };
      const price = r.prices[0]?.amount;
      if (price == null) return { ...base, priceMissing: true };
      return { ...base, priceThb: Number(price) };
    });

    if (input.maxPriceThb !== undefined) {
      const cap = input.maxPriceThb;
      products = products.filter((p) => !('priceThb' in p) || p.priceThb <= cap);
    }
    // Sort: priced items by price ascending, missing-price items at the end.
    products.sort((a, b) => {
      const aP = 'priceThb' in a ? a.priceThb : Number.MAX_SAFE_INTEGER;
      const bP = 'priceThb' in b ? b.priceThb : Number.MAX_SAFE_INTEGER;
      return aP - bP;
    });
    return { products: products.slice(0, 5) };
  }
}
