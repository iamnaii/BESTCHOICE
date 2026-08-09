import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export const LIST_PROMOTIONS_TOOL = {
  name: 'list_promotions',
  description:
    'ดูโปรโมชั่นที่ยังไม่หมดอายุ ถ้าส่ง productId มาด้วยจะกรองให้เหลือเฉพาะโปรที่ใช้กับเครื่องนั้นได้จริง. ' +
    'appliesTo=ALL คือใช้ได้ทุกสินค้า, SELECTED คือเจาะจงรุ่น/หมวด. ' +
    'ห้ามสัญญาส่วนลดที่ไม่ได้อยู่ในผลลัพธ์นี้.',
  input_schema: {
    type: 'object',
    properties: {
      productId: {
        type: 'string',
        description: 'id เครื่องจาก search_products — ใส่เมื่อลูกค้าถามโปรของรุ่นที่คุยกันอยู่',
      },
    },
  },
};

interface PromotionConditions {
  minPurchase?: number;
  productIds?: string[];
  categories?: string[];
}

/**
 * B3 Task 6 review [C1]: this parser is forward-compatible, not active yet against
 * today's real producer. `PromotionsPage.tsx`'s only "เงื่อนไข / หมายเหตุ" input is a
 * free-text `<textarea>` (`form.conditions: string`) — the admin UI has no structured
 * productIds/categories picker. Whatever the admin types there arrives here as a plain
 * string, `typeof raw !== 'object'` is true, and this function returns `null` — which
 * makes every existing promotion resolve to `appliesTo: 'ALL'` unconditionally. That is
 * CORRECT behavior (matches "conditions ว่าง/พัง → ใช้ได้ทุกสินค้า" in the brief), not a
 * bug — but don't read the productIds/categories filter logic below as "already filtering
 * promotions in production today." It activates only once a structured producer exists
 * (e.g. an admin UI that writes `{ productIds, categories, minPurchase }` as real JSON
 * instead of prose) — building that UI is an owner decision, out of scope for this task.
 */
function parseConditions(raw: unknown): PromotionConditions | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  return {
    minPurchase: typeof c.minPurchase === 'number' ? c.minPurchase : undefined,
    productIds: Array.isArray(c.productIds) ? c.productIds.map((v) => String(v)) : undefined,
    categories: Array.isArray(c.categories) ? c.categories.map((v) => String(v)) : undefined,
  };
}

@Injectable()
export class ListPromotionsTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { productId?: string } = {}) {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: { deletedAt: null, isActive: true, startDate: { lte: now }, endDate: { gte: now } },
      take: 10,
      select: { id: true, name: true, description: true, endDate: true, conditions: true },
      orderBy: { endDate: 'asc' },
    });

    const productId = input?.productId?.trim();
    // หาหมวดของเครื่องเพื่อจับคู่ conditions.categories — เครื่องหาไม่เจอ = null
    const product = productId
      ? await this.prisma.product.findFirst({
          where: { id: productId, deletedAt: null },
          select: { id: true, category: true },
        })
      : null;

    const mapped = rows.map((r) => {
      const c = parseConditions(r.conditions);
      const scoped = !!(c?.productIds?.length || c?.categories?.length);
      return {
        row: r,
        conditions: c,
        appliesTo: (scoped ? 'SELECTED' : 'ALL') as 'SELECTED' | 'ALL',
      };
    });

    const filtered = productId
      ? mapped.filter((m) => {
          if (m.appliesTo === 'ALL') return true;
          if (!product) return false; // ระบุเครื่องแต่หาไม่เจอ → เก็บเฉพาะโปรกลาง
          if (m.conditions?.productIds?.includes(product.id)) return true;
          if (m.conditions?.categories?.includes(product.category)) return true;
          return false;
        })
      : mapped;

    return {
      promotions: filtered.slice(0, 5).map((m) => ({
        id: m.row.id,
        name: m.row.name,
        description: m.row.description,
        endsAt: m.row.endDate.toISOString(),
        appliesTo: m.appliesTo,
        minPurchaseThb: m.conditions?.minPurchase ?? null,
      })),
    };
  }
}
