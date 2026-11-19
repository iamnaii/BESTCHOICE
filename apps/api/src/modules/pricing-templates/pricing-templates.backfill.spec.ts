import { Prisma } from '@prisma/client';
import { PricingTemplatesService } from './pricing-templates.service';

const D = (v: string) => new Prisma.Decimal(v);
const TEMPLATE = (over: Record<string, unknown> = {}) => ({
  id: 't15', brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW',
  hasWarranty: false, deviceOrigin: 'UNSPECIFIED',
  cashPrice: D('25900'), installmentBestchoicePrice: D('25900'), installmentFinancePrice: D('26500'),
  ...over,
});
const UNIT = (id: string, over: Record<string, unknown> = {}) => ({
  id, brand: 'Apple', model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW',
  deviceOrigin: 'THAI', warrantyExpired: null, warrantyExpireDate: null,
  ...over,
});

describe('PricingTemplatesService.backfillFinancePrice — เติมราคาขาย GFIN ให้เครื่องในสต๊อก (สเปค 2026-11-19 ข้อ 3.2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let service: PricingTemplatesService;

  beforeEach(() => {
    db = {
      product: {
        findMany: jest.fn().mockResolvedValue([
          UNIT('p15'),
          UNIT('p12', { model: 'iPhone 12' }),
          UNIT('pX', { brand: 'Samsung', model: 'Galaxy S24' }),
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pricingTemplate: {
        findMany: jest.fn().mockResolvedValue([
          TEMPLATE(),
          TEMPLATE({ id: 't12', model: 'iPhone 12', installmentFinancePrice: D('0') }),
        ]),
      },
      productPrice: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'row-f' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (work: (tx: unknown) => unknown) => work(db)),
    };
    service = new PricingTemplatesService(db as never);
  });

  it('อ่านเฉพาะเครื่องพร้อมขายที่ช่องว่าง', async () => {
    await service.backfillFinancePrice({ dryRun: true, userId: 'owner-1' });
    expect(db.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          financePrice: null,
          status: { in: ['IN_STOCK', 'RESERVED', 'PHOTO_PENDING'] },
        }),
      }),
    );
  });

  it('dryRun นับเฉพาะเครื่องที่รุ่นมีราคาขาย GFIN ในราคากลาง และไม่เขียนอะไร', async () => {
    await expect(service.backfillFinancePrice({ dryRun: true, userId: 'owner-1' })).resolves.toEqual({ count: 1 });
    expect(db.product.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('เติม: เขียนคอลัมน์โดยมีเงื่อนไข financePrice: null (ไม่ทับค่าที่มี) + แถวไฟแนนซ์ + audit', async () => {
    await expect(service.backfillFinancePrice({ dryRun: false, userId: 'owner-1' })).resolves.toEqual({ count: 1 });
    expect(db.product.updateMany).toHaveBeenCalledTimes(1);
    const args = db.product.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'p15', financePrice: null, deletedAt: null });
    expect(args.data.financePrice.toString()).toBe('26500');
    expect(db.productPrice.create).toHaveBeenCalledWith({
      data: { productId: 'p15', label: 'ราคาผ่อนไฟแนนซ์', amount: D('26500'), isDefault: false },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'owner-1',
        action: 'PRODUCT_FINANCE_PRICE_BACKFILLED',
        entity: 'product',
        entityId: 'batch',
        newValue: { count: 1, productIds: ['p15'] },
      }),
    });
  });

  it('มีคนตั้งราคาระหว่างนั้น (updateMany ได้ 0 แถว) → ไม่ทับ ไม่นับ', async () => {
    db.product.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.backfillFinancePrice({ dryRun: false, userId: 'owner-1' })).resolves.toEqual({ count: 0 });
    expect(db.productPrice.create).not.toHaveBeenCalled();
  });

  it('เลือกแถวราคากลางด้วยที่มาเครื่องและประกันของเครื่องนั้นเอง (ไม่ใช้แถวเดียวทั้งรุ่น)', async () => {
    db.product.findMany.mockResolvedValue([
      UNIT('thai'),
      UNIT('imp', { deviceOrigin: 'IMPORTED' }),
      UNIT('used-w', { category: 'PHONE_USED', warrantyExpired: false }),
      UNIT('used-n', { category: 'PHONE_USED', warrantyExpired: true }),
    ]);
    db.pricingTemplate.findMany.mockResolvedValue([
      TEMPLATE({ id: 'unspec' }),
      TEMPLATE({ id: 'imp', deviceOrigin: 'IMPORTED', installmentFinancePrice: D('24000') }),
      TEMPLATE({ id: 'u-no', category: 'PHONE_USED', hasWarranty: false, installmentFinancePrice: D('15000') }),
      TEMPLATE({ id: 'u-w', category: 'PHONE_USED', hasWarranty: true, installmentFinancePrice: D('17000') }),
    ]);
    await expect(service.backfillFinancePrice({ dryRun: false, userId: 'owner-1' })).resolves.toEqual({ count: 4 });
    const priceOf = (id: string) =>
      db.product.updateMany.mock.calls.find((c: any) => c[0].where.id === id)[0].data.financePrice.toString();
    expect(priceOf('thai')).toBe('26500'); // ถอยไปแถว "ไม่ระบุ"
    expect(priceOf('imp')).toBe('24000');
    expect(priceOf('used-w')).toBe('17000');
    expect(priceOf('used-n')).toBe('15000');
  });

  it('เขียนเป็นชุด ๆ (หลาย transaction) และ audit ครั้งเดียวรวมทุกเครื่อง', async () => {
    db.product.findMany.mockResolvedValue(Array.from({ length: 120 }, (_, i) => UNIT(`p${i}`)));
    await expect(service.backfillFinancePrice({ dryRun: false, userId: 'owner-1' })).resolves.toEqual({ count: 120 });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
