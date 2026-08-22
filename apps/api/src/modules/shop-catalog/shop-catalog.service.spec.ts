import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ShopCatalogService } from './shop-catalog.service';
import { PrismaService } from '../../prisma/prisma.service';
import { productReadinessWhere } from '../../utils/product-readiness.util';

describe('ShopCatalogService', () => {
  let service: ShopCatalogService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: {
        // Second-hand now lists one card per device, so listGroupedByModel
        // always issues a findMany for PHONE_USED alongside the NEW groupBy.
        // Tests that only care about the grouped half leave this empty.
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
      },
      // readBoolFlag('shop_hide_demo_products') reads this — most tests don't care and leave it
      // unmocked (undefined return → readRawValue catches → default false, matches prod day-1).
      systemConfig: { findFirst: jest.fn() },
      // resolveBcConfigForCategory (B3 util) reads this — default null (no config found) so
      // existing tests that don't care about ผ่อนเริ่มต้น keep getting monthlyPaymentFrom: null.
      interestConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const module = await Test.createTestingModule({
      providers: [ShopCatalogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopCatalogService);
  });

  describe('listGroupedByModel', () => {
    it('hard-filters ผ่าน readiness fragment (brand/category/สถานะ/ราคา/รูป) และกรอง [DEMO] เมื่อเปิด flag shop_hide_demo_products', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      prisma.product.groupBy.mockResolvedValue([]);

      await service.listGroupedByModel({});

      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { brand: 'Apple' },
          { category: { in: ['PHONE_NEW', 'PHONE_USED'] } },
          { isOnlineVisible: true },
          { status: 'IN_STOCK' },
          { deletedAt: null },
          { cashPrice: { gt: 0 } },
          { gallery: { isEmpty: false } },
          { NOT: { name: { startsWith: '[DEMO]' } } },
        ]),
      );
    });

    it('ไม่กรอง [DEMO] เมื่อไม่ได้เปิด flag shop_hide_demo_products (default — เว็บยังโชว์สินค้าตัวอย่างจนกว่า owner จะกรอกของจริง)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);

      await service.listGroupedByModel({});

      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { brand: 'Apple' },
          { category: { in: ['PHONE_NEW', 'PHONE_USED'] } },
          { isOnlineVisible: true },
          { status: 'IN_STOCK' },
          { deletedAt: null },
          { cashPrice: { gt: 0 } },
          { gallery: { isEmpty: false } },
        ]),
      );
      expect(where.AND).not.toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
    });

    it('narrows category to PHONE_NEW when condition=NEW', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ condition: 'NEW' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.category).toBe('PHONE_NEW');
    });

    it('condition=USED ไม่แตะ groupBy เลย — ดึงรายเครื่องผ่าน findMany(PHONE_USED)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ condition: 'USED' });
      // มือสองไม่จับกลุ่มอีกแล้ว (คำสั่งเจ้าของ 2026-08-21) — groupBy เป็นเส้นทางของมือ 1 เท่านั้น
      expect(prisma.product.groupBy).not.toHaveBeenCalled();
      const where = prisma.product.findMany.mock.calls[0][0].where;
      expect(where.category).toBe('PHONE_USED');
    });

    it('condition=NEW ไม่แตะ findMany เลย — มือ 1 ยังจับกลุ่มตามรุ่น', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ condition: 'NEW' });
      expect(prisma.product.findMany).not.toHaveBeenCalled();
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.category).toBe('PHONE_NEW');
    });

    it('เรียงตามรุ่นใหม่→เก่าเป็นค่าเริ่มต้น — เครื่องเข้าใหม่ของรุ่นเก่าไม่แซงรุ่นใหม่กว่า', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'old-but-fresh',
          brand: 'Apple',
          model: 'iPhone 12',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 7900,
          installmentPrice: 9900,
          conditionGrade: 'A',
          batteryHealth: null,
          hasBox: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: null,
          gallery: ['g'],
          createdAt: new Date('2026-08-20T00:00:00Z'),
        },
        {
          id: 'newer-model',
          brand: 'Apple',
          model: 'iPhone 16 Pro Max',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 39900,
          installmentPrice: 41900,
          conditionGrade: 'B',
          batteryHealth: null,
          hasBox: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: null,
          gallery: ['g'],
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'mid',
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 15500,
          installmentPrice: 17500,
          conditionGrade: 'A',
          batteryHealth: null,
          hasBox: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: null,
          gallery: ['g'],
          createdAt: new Date('2026-05-01T00:00:00Z'),
        },
      ]);

      const result = await service.listGroupedByModel({});

      // เข้าสต๊อกล่าสุดคือ iPhone 12 แต่ต้องอยู่ท้ายสุด เพราะเรียงตามรุ่น
      expect(result.data.map((d) => d.model)).toEqual([
        'iPhone 16 Pro Max',
        'iPhone 15',
        'iPhone 12',
      ]);
    });

    it('sort=newest ยังเรียงตามวันที่เข้าสต๊อกเหมือนเดิม (ไม่โดนกฎเรียงตามรุ่นทับ)', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'old-but-fresh',
          brand: 'Apple',
          model: 'iPhone 12',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 7900,
          installmentPrice: 9900,
          conditionGrade: 'A',
          batteryHealth: null,
          hasBox: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: null,
          gallery: ['g'],
          createdAt: new Date('2026-08-20T00:00:00Z'),
        },
        {
          id: 'newer-model',
          brand: 'Apple',
          model: 'iPhone 16 Pro Max',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 39900,
          installmentPrice: 41900,
          conditionGrade: 'B',
          batteryHealth: null,
          hasBox: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: null,
          gallery: ['g'],
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.listGroupedByModel({ sort: 'newest' });
      expect(result.data.map((d) => d.model)).toEqual(['iPhone 12', 'iPhone 16 Pro Max']);
    });

    it('รุ่นเดียวกัน: เกรดดีกว่ามาก่อน แล้วราคาสูงกว่ามาก่อน', async () => {
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'c-grade',
          brand: 'Apple',
          model: 'iPhone 15 Pro Max',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 21500,
          installmentPrice: 23500,
          conditionGrade: 'C',
          batteryHealth: null,
          hasBox: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: null,
          gallery: ['g'],
          createdAt: new Date('2026-03-01T00:00:00Z'),
        },
        {
          id: 'a-cheap',
          brand: 'Apple',
          model: 'iPhone 15 Pro Max',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 23000,
          installmentPrice: 25000,
          conditionGrade: 'A',
          batteryHealth: null,
          hasBox: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: null,
          gallery: ['g'],
          createdAt: new Date('2026-03-01T00:00:00Z'),
        },
        {
          id: 'a-dear',
          brand: 'Apple',
          model: 'iPhone 15 Pro Max',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 24900,
          installmentPrice: 26900,
          conditionGrade: 'A',
          batteryHealth: null,
          hasBox: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: null,
          gallery: ['g'],
          createdAt: new Date('2026-03-01T00:00:00Z'),
        },
      ]);

      const result = await service.listGroupedByModel({});
      expect(result.data.map((d) => d.id)).toEqual(['a-dear', 'a-cheap', 'c-grade']);
    });

    describe('เงินดาวน์ที่ลูกค้าขยับเอง', () => {
      const CONFIG = {
        id: 'c1',
        minDownPaymentPct: new Prisma.Decimal('0.15'),
        storeCommissionPct: new Prisma.Decimal('0.10'),
        vatPct: new Prisma.Decimal('0.07'),
        minInstallmentMonths: 12,
        maxInstallmentMonths: 12,
        interestRate: new Prisma.Decimal('0.0417'),
        rates: [{ months: 12, ratePct: new Prisma.Decimal('0.50'), deletedAt: null }],
      };

      beforeEach(() => {
        prisma.interestConfig.findFirst.mockResolvedValue(CONFIG);
        prisma.product.findMany.mockResolvedValue([
        {
          id: 'u1',
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 20000,
          installmentPrice: 22000,
          conditionGrade: 'A',
          batteryHealth: null,
          hasBox: null,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: null,
          gallery: ['g'],
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        ]);
      });

      it('ดาวน์เยอะขึ้น → ค่างวดลดลง และคืนยอดดาวน์เป็นบาทมาด้วย', async () => {
        const low = await service.listGroupedByModel({ downPct: 15 });
        const high = await service.listGroupedByModel({ downPct: 40 });

        // installmentPrice = 22000 → ดาวน์ 15% = 3300, 40% = 8800
        expect(low.data[0].downAmount).toBe(3300);
        expect(high.data[0].downAmount).toBe(8800);
        expect(high.data[0].monthlyPaymentFrom!).toBeLessThan(low.data[0].monthlyPaymentFrom!);
        expect(low.data[0].installmentMonths).toBe(12);
      });

      it('ขอดาวน์ต่ำกว่าขั้นต่ำ → ดันขึ้นเป็นขั้นต่ำ ไม่เสนอแผนที่ไฟแนนซ์ไม่รับ', async () => {
        const asked = await service.listGroupedByModel({ downPct: 5 });
        const floor = await service.listGroupedByModel({ downPct: 15 });
        expect(asked.data[0].downAmount).toBe(floor.data[0].downAmount);
        expect(asked.data[0].monthlyPaymentFrom).toBe(floor.data[0].monthlyPaymentFrom);
      });

      it('คืนดาวน์ขั้นต่ำของหน้านั้นมาให้ UI ใช้ตั้ง min ของสไลเดอร์ (ไม่ต้อง hardcode)', async () => {
        const res = await service.listGroupedByModel({});
        expect(res.minDownPct).toBe(15);
      });

      it('ขอจำนวนงวดที่ไม่มีในตารางเรต → ตกไปใช้งวดยาวสุด ไม่พัง', async () => {
        const res = await service.listGroupedByModel({ months: 99 });
        expect(res.data[0].installmentMonths).toBe(12);
        expect(res.data[0].monthlyPaymentFrom).not.toBeNull();
      });
    });

    it('มือ 1 ได้การ์ดต่อรุ่น มือสองได้การ์ดต่อเครื่อง — รุ่นเดียวกันก็ไม่ยุบรวมกัน', async () => {
      // มือ 1 สองเครื่องเหมือนกันเป๊ะ = การ์ดเดียว บอกว่ามี 3 เครื่อง
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 16',
          storage: '128GB',
          category: 'PHONE_NEW',
          _min: { cashPrice: 29900, installmentPrice: null },
          _count: { id: 3 },
          _max: { createdAt: new Date('2026-02-01T00:00:00Z') },
        },
      ]);
      // มือสองสองเครื่องรุ่นเดียวกัน แต่คนละเกรด คนละแบต คนละราคา = สองการ์ด
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'u-new',
          brand: 'Apple',
          model: 'iPhone 16',
          storage: '128GB',
          color: 'ดำ',
          category: 'PHONE_USED',
          cashPrice: 19900,
          installmentPrice: null,
          conditionGrade: 'A',
          batteryHealth: 95,
          hasBox: true,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: '350000000004218',
          gallery: ['a'],
          createdAt: new Date('2026-01-20T00:00:00Z'),
        },
        {
          id: 'u-old',
          brand: 'Apple',
          model: 'iPhone 16',
          storage: '128GB',
          color: 'ขาว',
          category: 'PHONE_USED',
          cashPrice: 17900,
          installmentPrice: null,
          conditionGrade: 'C',
          batteryHealth: 79,
          hasBox: false,
          warrantyExpireDate: null,
          warrantyExpired: null,
          stockInDate: null,
          imeiSerial: '350000000009999',
          gallery: ['b'],
          createdAt: new Date('2026-01-10T00:00:00Z'),
        },
      ]);
      prisma.product.findFirst.mockResolvedValue({
        id: 'rep',
        gallery: ['u'],
        conditionGrade: null,
      });

      const result = await service.listGroupedByModel({});

      expect(result.total).toBe(3);
      // เรียงใหม่สุดก่อน: กลุ่มมือ 1 (ก.พ.) → เครื่องมือสองสองใบ (20 ม.ค., 10 ม.ค.)
      expect(result.data.map((d) => d.kind)).toEqual(['GROUP', 'UNIT', 'UNIT']);

      const [group, newer, older] = result.data;
      expect(group.condition).toBe('NEW');
      expect(group.stockCount).toBe(3);
      expect(group.minPrice).toBe(29900);

      // สองเครื่องนี้คือรุ่น/ความจุเดียวกัน แต่ต้องไม่ถูกยุบเป็นการ์ดเดียว
      expect(newer.id).toBe('u-new');
      expect(newer.stockCount).toBe(1);
      expect(newer.displayNo).toBe('4218');
      expect(newer.conditionGrade).toBe('A');
      expect(newer.color).toBe('ดำ');
      expect(newer.minPrice).toBe(19900);
      expect(newer.tags).toEqual(expect.arrayContaining(['แบต 95%', 'ครบกล่อง']));

      expect(older.id).toBe('u-old');
      expect(older.displayNo).toBe('9999');
      expect(older.conditionGrade).toBe('C');
      expect(older.minPrice).toBe(17900);
      // แบตต่ำกว่าเกณฑ์ + ไม่มีกล่อง → ไม่มีแท็กมาอวด
      expect(older.tags).toEqual([]);

      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'PHONE_NEW' }),
        }),
      );
    });

    it('uses cashPrice (not costPrice) for min/sort and never leaks costPrice', async () => {
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 15',
          storage: null,
          category: 'PHONE_USED',
          _min: { cashPrice: 16900, installmentPrice: null },
          _count: { id: 1 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'A' });

      const result = await service.listGroupedByModel({ sort: 'price_asc' });

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ _min: { cashPrice: true, installmentPrice: true } }),
      );
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { cashPrice: 'asc' } }),
      );
      expect(JSON.stringify(result.data)).not.toContain('costPrice');
    });

    it('returns minPrice=null (no costPrice fallback) when cashPrice unset', async () => {
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 12',
          storage: '64GB',
          category: 'PHONE_USED',
          _min: { cashPrice: null, installmentPrice: null },
          _count: { id: 1 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValue({ id: 'rep', gallery: [], conditionGrade: 'B' });

      const result = await service.listGroupedByModel({});

      expect(result.data[0].minPrice).toBeNull();
      expect(result.data[0].monthlyPaymentFrom).toBeNull();
    });

    it('แปลงคำค้นไทยเป็นเงื่อนไข AND (ไม่ assign where.OR ทับ fragment อื่น)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: ' ไอโฟน 15 โปรแม็กซ์ 256gb ' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { model: { contains: 'iPhone 15 Pro Max', mode: 'insensitive' } },
          { storage: { equals: '256GB', mode: 'insensitive' } },
        ]),
      );
    });

    it('ถอยไป contains ธรรมดาเมื่อ util แปลงคำค้นไม่ออก', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: 'zzzz' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
      // arrayContaining, not exact equality: where.AND already carries the B0 readiness
      // fragment (brand/category/status/etc — see the "hard-filters" test above) BEFORE the
      // search block appends anything, so the fallback OR clause is one element AMONG those,
      // not the sole element of the array.
      expect(where.AND).toEqual(
        expect.arrayContaining([
          {
            OR: [
              { brand: { contains: 'zzzz', mode: 'insensitive' } },
              { model: { contains: 'zzzz', mode: 'insensitive' } },
            ],
          },
        ]),
      );
    });

    it('ต่อท้าย where.AND ที่มีอยู่แล้วแทนที่จะเขียนทับ', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: 'zzzz', model: 'iPhone 16' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.model).toBe('iPhone 16');
      expect(Array.isArray(where.AND)).toBe(true);
    });

    // สีที่ util คืนเป็นคำไทย แต่ Product.color เก็บอังกฤษ ('Black'/'Blue'/'Gold')
    // ถ้าเผลอเอา parsed.color ไปใส่ where จะได้ 0 ผลลัพธ์ทันที — เทสต์นี้ตรึงไว้
    it('ไม่เอาสี (คำไทย) ไปเป็นเงื่อนไข where — ไม่งั้นค้น "สีดำ" จะได้ 0 ผลลัพธ์', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: 'ไอโฟน 15 สีดำ' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(JSON.stringify(where)).not.toContain('color');
      expect(where.AND).toEqual(
        expect.arrayContaining([{ model: { contains: 'iPhone 15', mode: 'insensitive' } }]),
      );
    });

    it('ignores a blank search string', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: '   ' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      // where.AND is never `undefined` — the B0 readiness fragment always populates it,
      // even with zero filters (see the "hard-filters ผ่าน readiness fragment" test above).
      // A blank search must add NOTHING on top of that base — assert exact equality with
      // the real util's output rather than a hand-copied literal (can't drift out of sync).
      expect(where.AND).toEqual(productReadinessWhere({ excludeDemo: false }).AND);
    });

    it('filters by exact model while keeping the iPhone-only base', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ model: 'iPhone 16' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.model).toBe('iPhone 16');
      expect(where.AND).toEqual(
        expect.arrayContaining([{ brand: 'Apple' }, { status: 'IN_STOCK' }]),
      );
    });

    it('search ต่อเข้า where.AND แล้ว readiness fragment ยังอยู่ครบ (ไม่โดนทับ)', async () => {
      prisma.product.groupBy.mockResolvedValue([]);
      await service.listGroupedByModel({ search: 'iphone 15' });
      const where = prisma.product.groupBy.mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { cashPrice: { gt: 0 } },
          { model: { contains: 'iPhone 15', mode: 'insensitive' } },
        ]),
      );
    });
  });

  describe('listAvailableModels', () => {
    it('returns distinct models with counts, iPhone-only base, sorted by count desc', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { model: 'iPhone 16', _count: { id: 5 } },
        { model: 'iPhone 15', _count: { id: 2 } },
      ]);

      const result = await service.listAvailableModels();

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['model'],
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              { brand: 'Apple' },
              { status: 'IN_STOCK' },
              { deletedAt: null },
            ]),
          }),
          orderBy: [{ _count: { id: 'desc' } }],
        }),
      );
      expect(result).toEqual([
        { model: 'iPhone 16', count: 5 },
        { model: 'iPhone 15', count: 2 },
      ]);
    });
  });

  describe('getProductDetail', () => {
    it('scopes units to the SAME category as the clicked card (no new/used mix)', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        category: 'PHONE_USED',
        cashPrice: 13900,
        costPrice: 9999,
        conditionGrade: 'A',
        gallery: [],
        gallery360: [],
        isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'u1',
          conditionGrade: 'A',
          batteryHealth: 92,
          cashPrice: 13900,
          costPrice: 9999,
          gallery: [],
          gallery360: [],
          imeiSerial: null,
        },
        {
          id: 'u2',
          conditionGrade: 'B',
          batteryHealth: 87,
          cashPrice: 12800,
          costPrice: 9999,
          gallery: [],
          gallery360: [],
          imeiSerial: null,
        },
      ]);

      const result = await service.getProductDetail('p1');

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: 'PHONE_USED' }) }),
      );
      expect(result!.condition).toBe('USED');
      expect(result!.tiers.A.units).toHaveLength(1);
      expect(result!.tiers.A.minPrice).toBe(13900);
      expect(JSON.stringify(result)).not.toContain('costPrice');

      // Fix round 1/5 (Minor): pin the permalink invariant on BOTH halves — head query
      // (requireInStock:false) must NOT force IN_STOCK, units query (default) MUST.
      // Without this a regression that flips either half silently breaks the permalink
      // (sold unit's page 404s) or breaks the catalog gate (sold units listed as buyable).
      const headWhere = prisma.product.findFirst.mock.calls[0][0].where;
      expect(headWhere.AND).not.toContainEqual({ status: 'IN_STOCK' });
      const unitsWhere = prisma.product.findMany.mock.calls[0][0].where;
      expect(unitsWhere.AND).toContainEqual({ status: 'IN_STOCK' });
    });

    it('returns null when the resolved id is not an iPhone (brand/category guard on the initial lookup)', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      const result = await service.getProductDetail('non-iphone-id');

      expect(result).toBeNull();
      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.id).toBe('non-iphone-id');
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { brand: 'Apple' },
          { category: { in: ['PHONE_NEW', 'PHONE_USED'] } },
        ]),
      );
      // permalink: ไม่บังคับ IN_STOCK ที่ head query
      expect(where.AND).not.toContainEqual({ status: 'IN_STOCK' });
    });

    it('reports condition=NEW for a brand-new phone', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p2',
        brand: 'Apple',
        model: 'iPhone 16',
        storage: '128GB',
        category: 'PHONE_NEW',
        cashPrice: 29900,
        conditionGrade: null,
        gallery: [],
        gallery360: [],
        isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'n1',
          conditionGrade: null,
          cashPrice: 29900,
          gallery: [],
          gallery360: [],
          imeiSerial: null,
        },
      ]);

      const result = await service.getProductDetail('p2');
      expect(result!.condition).toBe('NEW');
    });

    it('returns per-unit color and installmentPrice', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '128GB',
        color: 'Black',
        category: 'PHONE_USED',
        cashPrice: 15900,
        conditionGrade: 'A',
        gallery: [],
        gallery360: [],
        isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'u1',
          conditionGrade: 'A',
          batteryHealth: 92,
          hasBox: true,
          shopWarrantyDays: 30,
          color: 'Blue',
          cashPrice: 15900,
          installmentPrice: 17500,
          imeiSerial: '111122223333',
          gallery: [],
          gallery360: [],
        },
      ]);
      const result = await service.getProductDetail('p1');
      const u = result!.tiers.A.units[0];
      expect(u.color).toBe('Blue');
      expect(u.installmentPrice).toBe(17500);
      expect(JSON.stringify(result)).not.toContain('costPrice');
    });

    describe('getProductDetail — ราคา null (B0)', () => {
      it('ตัด unit ที่ไม่มี cashPrice ออกแทนการโชว์ 0', async () => {
        prisma.product.findFirst.mockResolvedValue({
          id: 'p1',
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          category: 'PHONE_NEW',
          color: null,
          onlineDescription: null,
          gallery: ['g'],
          gallery360: [],
          cashPrice: '28900',
          installmentPrice: null,
        });
        prisma.product.findMany.mockResolvedValue([
          {
            id: 'u1',
            conditionGrade: null,
            cashPrice: '28900',
            installmentPrice: null,
            gallery: [],
            gallery360: [],
            imeiSerial: null,
            batteryHealth: null,
            hasBox: null,
            color: null,
            shopWarrantyDays: null,
          },
          {
            id: 'u2',
            conditionGrade: null,
            cashPrice: null,
            installmentPrice: null,
            gallery: [],
            gallery360: [],
            imeiSerial: null,
            batteryHealth: null,
            hasBox: null,
            color: null,
            shopWarrantyDays: null,
          },
        ]);

        const detail = await service.getProductDetail('p1');
        const units = Object.values(detail!.tiers).flatMap((t) => t.units);
        expect(units.map((u) => u.id)).toEqual(['u1']);
      });
    });

    it('exposes per-unit branch, accessories, cosmetic notes and QC checklist', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        category: 'PHONE_USED',
        cashPrice: 13900,
        conditionGrade: 'A',
        gallery: [],
        gallery360: [],
        isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'u1',
          conditionGrade: 'A',
          batteryHealth: 92,
          hasBox: true,
          shopWarrantyDays: 45,
          cashPrice: 13900,
          installmentPrice: 15900,
          imeiSerial: '111122223333',
          gallery: [],
          gallery360: [],
          accessoriesIncluded: ['สายชาร์จ'],
          cosmeticNotes: 'มีรอยขีดมุมล่างซ้าย',
          checklistResults: [
            { item: 'หน้าจอ', category: 'display', passed: true },
            { item: 'ลำโพง', category: 'audio', passed: false },
          ],
          branch: { name: 'สาขาลพบุรี' },
        },
      ]);

      const result = await service.getProductDetail('p1');
      const u = result!.tiers.A.units[0];

      expect(u.branchName).toBe('สาขาลพบุรี');
      expect(u.accessories).toEqual(['กล่อง', 'สายชาร์จ']);
      expect(u.cosmeticNotes).toBe('มีรอยขีดมุมล่างซ้าย');
      expect(u.qcChecklist).toEqual([
        { item: 'หน้าจอ', passed: true },
        { item: 'ลำโพง', passed: false },
      ]);
      expect(u.shopWarrantyDays).toBe(45);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: { branch: { select: { name: true } } } }),
      );
    });

    it('degrades to empty lists when the unit has no accessories/QC data', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        brand: 'Apple',
        model: 'iPhone 13',
        storage: '128GB',
        category: 'PHONE_USED',
        cashPrice: 13900,
        conditionGrade: 'A',
        gallery: [],
        gallery360: [],
        isOnlineVisible: true,
      });
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'u1',
          conditionGrade: 'A',
          cashPrice: 13900,
          gallery: [],
          gallery360: [],
          imeiSerial: null,
          checklistResults: { source: 'trade-in', tradeInId: 't1' },
        },
      ]);

      const u = (await service.getProductDetail('p1'))!.tiers.A.units[0];
      expect(u.accessories).toEqual([]);
      expect(u.qcChecklist).toEqual([]);
      expect(u.branchName).toBeUndefined();
      expect(u.cosmeticNotes).toBeUndefined();
    });
  });

  describe('listRelated', () => {
    it('returns other models (iPhone-only base, excludes current model, limit 6)', async () => {
      prisma.product.findFirst.mockResolvedValueOnce({ id: 'p1', model: 'iPhone 16' });
      prisma.product.groupBy.mockResolvedValue([
        {
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          category: 'PHONE_USED',
          _min: { cashPrice: 14000, installmentPrice: null },
          _count: { id: 2 },
        },
      ]);
      prisma.product.findFirst.mockResolvedValueOnce({
        id: 'rep',
        gallery: [],
        conditionGrade: 'A',
      });

      const result = await service.listRelated('p1');

      expect(prisma.product.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['brand', 'model', 'storage', 'category'],
          where: expect.objectContaining({
            model: { not: 'iPhone 16' },
            AND: expect.arrayContaining([{ brand: 'Apple' }]),
          }),
          take: 6,
        }),
      );
      expect(result[0].model).toBe('iPhone 15');
      // head lookup ของ listRelated ไม่บังคับ IN_STOCK (permalink ของเครื่องที่ขายแล้ว)
      expect(prisma.product.findFirst.mock.calls[0][0].where.AND).not.toContainEqual({
        status: 'IN_STOCK',
      });
    });

    it('returns [] when product not found', async () => {
      prisma.product.findFirst.mockResolvedValueOnce(null);
      expect(await service.listRelated('missing')).toEqual([]);
    });
  });

  describe('smartStockCount', () => {
    it('returns LOW_URGENT for 1-3 stock', () => {
      expect(service.smartStockCount(2)).toEqual({
        display: 'เหลือ 2 เครื่อง — ใกล้หมด',
        tone: 'urgent',
      });
    });
    it('returns LOW for 4-10 stock', () => {
      expect(service.smartStockCount(7)).toEqual({ display: 'เหลือ 7 เครื่อง', tone: 'low' });
    });
    it('returns AVAILABLE for 10+ stock', () => {
      expect(service.smartStockCount(15)).toEqual({
        display: 'ในสต็อก พร้อมส่ง',
        tone: 'available',
      });
    });
    it('returns OUT for 0 stock', () => {
      expect(service.smartStockCount(0)).toEqual({
        display: 'หมดสต็อก — ทักแชทเช็ครอบเข้าใหม่',
        tone: 'out',
      });
    });
  });
});
