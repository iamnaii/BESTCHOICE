import { PrismaService } from '../../../prisma/prisma.service';
import { ListPromotionsTool } from './list-promotions.tool';

const promo = (over: Record<string, unknown> = {}) => ({
  id: 'promo-1',
  name: 'ลดพิเศษเดือนนี้',
  description: 'ลดทันที 1,000 บาท',
  endDate: new Date('2026-12-31T00:00:00.000Z'),
  conditions: null as unknown,
  ...over,
});

const makePrisma = (promos: unknown[], product: unknown = null) =>
  ({
    promotion: { findMany: jest.fn().mockResolvedValue(promos) },
    product: { findFirst: jest.fn().mockResolvedValue(product) },
  }) as unknown as PrismaService;

describe('ListPromotionsTool.run', () => {
  it('ไม่ส่ง productId → คืนทุกโปรที่ active (พฤติกรรมเดิม)', async () => {
    const tool = new ListPromotionsTool(makePrisma([promo(), promo({ id: 'promo-2' })]));
    const r = await tool.run({});
    expect(r.promotions.map((p) => p.id)).toEqual(['promo-1', 'promo-2']);
  });

  it('conditions ว่าง → appliesTo = ALL และผ่านทุกสินค้า', async () => {
    const tool = new ListPromotionsTool(
      makePrisma([promo()], { id: 'prd-1', category: 'PHONE_NEW' }),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions).toHaveLength(1);
    expect(r.promotions[0].appliesTo).toBe('ALL');
  });

  it('กรองด้วย conditions.productIds', async () => {
    const tool = new ListPromotionsTool(
      makePrisma(
        [
          promo({ id: 'hit', conditions: { productIds: ['prd-1'] } }),
          promo({ id: 'miss', conditions: { productIds: ['prd-9'] } }),
        ],
        { id: 'prd-1', category: 'PHONE_NEW' },
      ),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions.map((p) => p.id)).toEqual(['hit']);
    expect(r.promotions[0].appliesTo).toBe('SELECTED');
  });

  it('กรองด้วย conditions.categories ตามหมวดของเครื่อง', async () => {
    const tool = new ListPromotionsTool(
      makePrisma(
        [
          promo({ id: 'used-only', conditions: { categories: ['PHONE_USED'] } }),
          promo({ id: 'new-only', conditions: { categories: ['PHONE_NEW'] } }),
        ],
        { id: 'prd-1', category: 'PHONE_USED' },
      ),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions.map((p) => p.id)).toEqual(['used-only']);
  });

  it('ส่ง productId แต่หาเครื่องไม่เจอ → เหลือเฉพาะโปรที่ใช้ได้ทุกสินค้า', async () => {
    const tool = new ListPromotionsTool(
      makePrisma(
        [promo({ id: 'all' }), promo({ id: 'scoped', conditions: { productIds: ['prd-1'] } })],
        null,
      ),
    );
    const r = await tool.run({ productId: 'ไม่มีจริง' });
    expect(r.promotions.map((p) => p.id)).toEqual(['all']);
  });

  it('conditions เป็นสตริง/พัง → ไม่ throw และถือว่าใช้ได้ทุกสินค้า', async () => {
    const tool = new ListPromotionsTool(
      makePrisma([promo({ conditions: 'not-an-object' })], { id: 'prd-1', category: 'PHONE_NEW' }),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions).toHaveLength(1);
    expect(r.promotions[0].appliesTo).toBe('ALL');
  });

  it('ส่ง minPurchaseThb ต่อออกมาเมื่อมี', async () => {
    const tool = new ListPromotionsTool(
      makePrisma([promo({ conditions: { minPurchase: 15000 } })], {
        id: 'prd-1',
        category: 'PHONE_NEW',
      }),
    );
    const r = await tool.run({ productId: 'prd-1' });
    expect(r.promotions[0].minPurchaseThb).toBe(15000);
  });
});
