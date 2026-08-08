import { ProductDetectService } from './product-detect.service';

function makeService(products: any[], counts: number[]) {
  let countCall = 0;
  const prisma = {
    product: {
      findMany: jest.fn().mockResolvedValue(products),
      count: jest.fn(async () => counts[countCall++] ?? 0),
    },
    promotion: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const productQuote = {
    getQuotes: jest.fn().mockResolvedValue([
      { cashPrice: 19500, installmentPrice: 20000, months: 12, monthlyPayment: 1926, downAmount: 4000 },
    ]),
  };
  return {
    svc: new ProductDetectService(prisma as any, productQuote as any),
    prisma,
  };
}

const ROW = {
  id: 'p1',
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  storage: '128GB',
  category: 'PHONE_USED',
  conditionGrade: 'A',
  cashPrice: '19500',
  installmentPrice: '20000',
  gallery: ['https://cdn.example/p1.jpg'],
  prices: [],
};

describe('ProductDetectService.detectProducts', () => {
  it('ห้าม select photos[] (base64) — ใช้ gallery[0] เป็นรูป', async () => {
    const { svc, prisma } = makeService([ROW], [3]);
    const out = await svc.detectProducts(['สนใจ iPhone 13 ครับ']);

    const select = prisma.product.findMany.mock.calls[0][0].select;
    expect(select.photos).toBeUndefined();
    expect(select.gallery).toBe(true);
    expect(out[0].imageUrl).toBe('https://cdn.example/p1.jpg');
  });

  it('stock = จำนวนเครื่องจริงในสต็อกรุ่น+ความจุเดียวกัน (ไม่ใช่ 1 ตายตัว)', async () => {
    const { svc, prisma } = makeService([ROW], [3]);
    const out = await svc.detectProducts(['iPhone 13']);

    expect(out[0].stock).toBe(3);
    expect(prisma.product.count).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        status: 'IN_STOCK',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
      },
    });
  });

  it('ค่างวดมาจาก ProductQuoteService ไม่ใช่สูตรมือ', async () => {
    const { svc } = makeService([ROW], [1]);
    const out = await svc.detectProducts(['iPhone 13']);

    expect(out[0].price).toBe(19500);
    expect(out[0].pricingOptions).toEqual([
      { downPaymentMin: 4000, monthlyPayment: 1926, installments: 12, interestRate: 0 },
    ]);
  });

  it('ไม่มีคำที่จับได้ → คืน [] โดยไม่ยิง DB', async () => {
    const { svc, prisma } = makeService([ROW], [1]);
    expect(await svc.detectProducts(['สวัสดีครับ'])).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
