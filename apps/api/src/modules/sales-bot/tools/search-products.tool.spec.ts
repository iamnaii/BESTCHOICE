import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SearchProductsTool } from './search-products.tool';

const D = (v: string) => new Prisma.Decimal(v);

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'prd-1',
  name: 'iPhone 15 Pro Max 256GB',
  brand: 'Apple',
  model: 'iPhone 15 Pro Max',
  storage: '256GB',
  color: 'ดำ',
  category: 'PHONE_USED',
  status: 'IN_STOCK',
  conditionGrade: 'A',
  cashPrice: D('32900'),
  installmentPrice: D('35900'),
  batteryHealth: 92,
  shopWarrantyDays: 30,
  accessoriesIncluded: ['สายชาร์จ', 'กล่อง'],
  cosmeticNotes: 'มีรอยขนแมวที่ขอบซ้าย',
  gallery: ['https://cdn.example.com/p1.jpg'],
  branch: { name: 'ลาดพร้าว' },
  ...over,
});

const makePrisma = (rows: unknown[]) =>
  ({ product: { findMany: jest.fn().mockResolvedValue(rows) } }) as unknown as PrismaService;

describe('SearchProductsTool.run', () => {
  const prevBase = process.env.SHOP_BASE_URL;
  beforeEach(() => {
    process.env.SHOP_BASE_URL = 'https://shop.example.com';
  });
  afterEach(() => {
    if (prevBase === undefined) delete process.env.SHOP_BASE_URL;
    else process.env.SHOP_BASE_URL = prevBase;
  });

  it('คืนคีย์ครบตามสัญญา (query/totalMatches/priceMissingCount/groups)', async () => {
    const tool = new SearchProductsTool(makePrisma([row()]));
    const r = await tool.run({ query: 'ไอโฟน 15 โปรแม็กซ์ 256gb' });
    expect(Object.keys(r).sort()).toEqual(
      ['groups', 'priceMissingCount', 'query', 'totalMatches'].sort(),
    );
  });

  it('parse คำไทยเป็น brand/model/storage แล้วส่งกลับใน query', async () => {
    const tool = new SearchProductsTool(makePrisma([row()]));
    const r = await tool.run({ query: 'ไอโฟน 15 โปรแม็กซ์ 256gb สีดำ' });
    expect(r.query).toEqual({
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      storage: '256GB',
      color: 'ดำ',
    });
  });

  it('จัดกลุ่มตาม รุ่น+ความจุ+สภาพ พร้อม count และช่วงราคา', async () => {
    const tool = new SearchProductsTool(
      makePrisma([
        row({ id: 'a', cashPrice: D('32900') }),
        row({ id: 'b', cashPrice: D('34900'), color: 'ขาว' }),
        row({ id: 'c', cashPrice: D('30900'), conditionGrade: 'B' }),
      ]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    const gradeA = r.groups.find((g) => g.condition === 'A')!;
    expect(gradeA.unitCount).toBe(2);
    expect(gradeA.minPrice).toBe(32900);
    expect(gradeA.maxPrice).toBe(34900);
    expect(r.groups.find((g) => g.condition === 'B')!.unitCount).toBe(1);
  });

  it('เครื่องใหม่ (ไม่มีเกรด) แสดง condition = NEW', async () => {
    const tool = new SearchProductsTool(
      makePrisma([row({ category: 'PHONE_NEW', conditionGrade: null })]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].condition).toBe('NEW');
  });

  it('ส่งรายละเอียดต่อเครื่องครบ (แบต/สี/ประกัน/อุปกรณ์/ตำหนิ/สาขา/รูป/ลิงก์)', async () => {
    const tool = new SearchProductsTool(makePrisma([row()]));
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].units[0]).toEqual({
      id: 'prd-1',
      priceThb: 32900,
      installmentPriceThb: 35900,
      color: 'ดำ',
      batteryHealth: 92,
      shopWarrantyDays: 30,
      accessories: ['สายชาร์จ', 'กล่อง'],
      cosmeticNotes: 'มีรอยขนแมวที่ขอบซ้าย',
      branchName: 'ลาดพร้าว',
      photoAvailable: true,
      photoUrl: 'https://cdn.example.com/p1.jpg',
      webUrl: 'https://shop.example.com/products/prd-1',
      reserved: false,
    });
  });

  it('เครื่องไม่มีรูปยังถูกเสนอ (photoAvailable=false) — ไม่บังคับรูปแบบเว็บ', async () => {
    const tool = new SearchProductsTool(makePrisma([row({ gallery: [] })]));
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].units[0].photoAvailable).toBe(false);
    expect(r.groups[0].units[0].photoUrl).toBeNull();
  });

  it('RESERVED ติดธง ติดจองชั่วคราว และเรียงไว้หลังเครื่องพร้อมขาย', async () => {
    const tool = new SearchProductsTool(
      makePrisma([
        row({ id: 'res', status: 'RESERVED', cashPrice: D('30000') }),
        row({ id: 'ok', status: 'IN_STOCK', cashPrice: D('32900') }),
      ]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].units.map((u) => u.id)).toEqual(['ok', 'res']);
    expect(r.groups[0].units[1]).toMatchObject({
      reserved: true,
      reservedNote: 'ติดจองชั่วคราว',
    });
  });

  it('เครื่องที่ไม่มีราคาเงินสด → ไม่เข้ากลุ่ม แต่ถูกนับใน priceMissingCount (คง flow handoff/#1332)', async () => {
    const tool = new SearchProductsTool(
      makePrisma([row({ id: 'no-price', cashPrice: null }), row({ id: 'ok' })]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.priceMissingCount).toBe(1);
    expect(r.groups.flatMap((g) => g.units).map((u) => u.id)).toEqual(['ok']);
  });

  it('ทุกเครื่องไม่มีราคา → groups ว่าง + priceMissingCount > 0 (บอทต้องไปทาง get_installment_rates)', async () => {
    const tool = new SearchProductsTool(makePrisma([row({ cashPrice: null })]));
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups).toEqual([]);
    expect(r.priceMissingCount).toBe(1);
  });

  it('maxPriceThb ตัดเครื่องที่แพงเกินงบ', async () => {
    const tool = new SearchProductsTool(
      makePrisma([row({ id: 'cheap', cashPrice: D('20000') }), row({ id: 'pricey', cashPrice: D('50000') })]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max', maxPriceThb: 30000 });
    expect(r.groups.flatMap((g) => g.units).map((u) => u.id)).toEqual(['cheap']);
  });

  it('where ที่ยิงเข้า Prisma: กรอง [DEMO] + RESERVED/IN_STOCK + มือสองต้องมีเกรด + ไม่บังคับรูป', async () => {
    const prisma = makePrisma([]);
    const tool = new SearchProductsTool(prisma);
    await tool.run({ query: 'iPhone 15' });
    const where = (prisma.product.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.isOnlineVisible).toBe(true);
    expect(where.status).toEqual({ in: ['IN_STOCK', 'RESERVED'] });
    expect(where.NOT).toEqual({ name: { startsWith: '[DEMO]' } });
    expect(where.AND).toContainEqual({
      OR: [
        { category: { not: 'PHONE_USED' } },
        { AND: [{ conditionGrade: { not: null } }, { conditionGrade: { not: '' } }] },
      ],
    });
    // ไม่มีเงื่อนไข gallery ที่ไหนเลย — บอทต้องเห็นเครื่องที่ยังไม่มีรูป
    expect(JSON.stringify(where)).not.toContain('gallery');
  });

  it('SHOP_BASE_URL ไม่ได้ตั้ง → webUrl เป็น null (ไม่ throw)', async () => {
    delete process.env.SHOP_BASE_URL;
    const tool = new SearchProductsTool(makePrisma([row()]));
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].units[0].webUrl).toBeNull();
  });

  it('คำค้นว่าง → คืนผลว่างโดยไม่ยิง DB', async () => {
    const prisma = makePrisma([]);
    const tool = new SearchProductsTool(prisma);
    const r = await tool.run({ query: '   ' });
    expect(r.totalMatches).toBe(0);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
