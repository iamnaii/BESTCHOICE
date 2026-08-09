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

// review round 2 [QA blocker]: `systemConfig.findFirst` เพิ่มเข้ามาเพื่อ mock ค่า
// SystemConfig `shop_hide_demo_products` — `configValue = null` (default) จำลอง "ไม่มีแถว"
// ซึ่งตรงกับ prod จริงวันนี้ (fallback → false → โชว์ [DEMO] เหมือนเว็บ)
const makePrisma = (rows: unknown[], configValue: string | null = null) =>
  ({
    product: { findMany: jest.fn().mockResolvedValue(rows) },
    systemConfig: {
      findFirst: jest.fn().mockResolvedValue(configValue == null ? null : { value: configValue }),
    },
  }) as unknown as PrismaService;

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

  // review round 1 [I2]: กลุ่มที่มีเครื่องพร้อมขาย >= MAX_UNITS_PER_GROUP (3) เครื่อง RESERVED
  // จะโดน .slice(0,3) ตัดออกจาก units[] ไปเงียบ ๆ — ลูกค้าเข้าใจผิดว่า "หมด" ทั้งที่ยังติดจอง
  // อยู่ groups[].reservedCount ต้องนับให้ครบ (นับก่อน slice) แม้ unit นั้นจะไม่ปรากฏใน units[] แล้ว
  it('กลุ่มมี in-stock ครบ 3 + reserved 1 → units ตัดเหลือ 3 (in-stock ล้วน) แต่ reservedCount ยังนับครบ 1', async () => {
    const tool = new SearchProductsTool(
      makePrisma([
        row({ id: 'a', cashPrice: D('30000') }),
        row({ id: 'b', cashPrice: D('31000') }),
        row({ id: 'c', cashPrice: D('32000') }),
        row({ id: 'res', status: 'RESERVED', cashPrice: D('29000') }),
      ]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups[0].unitCount).toBe(4);
    expect(r.groups[0].units.map((u) => u.id)).toEqual(['a', 'b', 'c']);
    expect(r.groups[0].units.some((u) => u.reserved)).toBe(false);
    expect(r.groups[0].reservedCount).toBe(1);
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

  // review round 1 [I1]: boundary ราคา 0/ติดลบ — บั๊ก class ที่โผล่ 6 รอบในเวฟนี้ (guard `> 0`
  // ไม่ใช่ `!= null` เฉย ๆ) mutation ที่เอา `> 0` ออกแล้วเหลือแค่ `!= null` ต้องทำให้เคสนี้ตก
  it('cashPrice = 0 → ไม่อยู่ใน groups แต่นับใน priceMissingCount (boundary กันบั๊กราคา 0)', async () => {
    const tool = new SearchProductsTool(
      makePrisma([row({ id: 'zero-price', cashPrice: D('0') }), row({ id: 'ok' })]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.priceMissingCount).toBe(1);
    expect(r.groups.flatMap((g) => g.units).map((u) => u.id)).toEqual(['ok']);
  });

  it('cashPrice ติดลบ → ไม่อยู่ใน groups แต่นับใน priceMissingCount (boundary กันบั๊กราคาติดลบ)', async () => {
    const tool = new SearchProductsTool(
      makePrisma([row({ id: 'negative-price', cashPrice: D('-500') }), row({ id: 'ok' })]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.priceMissingCount).toBe(1);
    expect(r.groups.flatMap((g) => g.units).map((u) => u.id)).toEqual(['ok']);
  });

  it('maxPriceThb ตัดเครื่องที่แพงเกินงบ', async () => {
    const tool = new SearchProductsTool(
      makePrisma([row({ id: 'cheap', cashPrice: D('20000') }), row({ id: 'pricey', cashPrice: D('50000') })]),
    );
    const r = await tool.run({ query: 'iPhone 15 Pro Max', maxPriceThb: 30000 });
    expect(r.groups.flatMap((g) => g.units).map((u) => u.id)).toEqual(['cheap']);
  });

  it('where ที่ยิงเข้า Prisma: RESERVED/IN_STOCK + มือสองต้องมีเกรด + ไม่บังคับรูป + [DEMO] ไม่ถูกกรองเมื่อ flag ปิด (default)', async () => {
    const prisma = makePrisma([]); // configValue=null → shop_hide_demo_products fallback false (เหมือนเว็บ)
    const tool = new SearchProductsTool(prisma);
    await tool.run({ query: 'iPhone 15' });
    const where = (prisma.product.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.isOnlineVisible).toBe(true);
    expect(where.status).toEqual({ in: ['IN_STOCK', 'RESERVED'] });
    // review round 2 [QA blocker]: flag ปิด/ไม่มีแถว → ต้อง "ไม่กรอง" [DEMO] เหมือนเว็บ
    // (shop-catalog.service.ts default excludeDemo=false) — ห้ามมี NOT ของ [DEMO] เลย
    expect(where.NOT).toBeUndefined();
    expect(where.AND).toContainEqual({
      OR: [
        { category: { not: 'PHONE_USED' } },
        { AND: [{ conditionGrade: { not: null } }, { conditionGrade: { not: '' } }] },
      ],
    });
    // ไม่มีเงื่อนไข gallery ที่ไหนเลย — บอทต้องเห็นเครื่องที่ยังไม่มีรูป
    expect(JSON.stringify(where)).not.toContain('gallery');
  });

  // review round 2 [QA blocker, Task 15]: Gemini + DB จริงพิสูจน์ว่า prod catalog วันนี้
  // เป็น [DEMO] ล้วน — tool เดิมกรอง [DEMO] แบบ unconditional ทำให้บอทตอบ "ของหมด" กับ
  // เครื่องที่ลูกค้าเห็นอยู่บนเว็บจริง ๆ (เว็บอ่าน flag `shop_hide_demo_products` แล้วโชว์
  // [DEMO] ตราบใดที่ยังไม่ตั้งค่าเปิด). ต้องใช้ flag เดียวกับเว็บ — 2 เคสด้านล่างพิสูจน์ทั้ง
  // `where` ที่ยิงจริงและผลลัพธ์ปลายทางใน groups (mockImplementation จำลองพฤติกรรม DB filter
  // จริงตาม where.NOT ที่ tool ส่งไป — ไม่ใช่แค่เช็ค shape เฉย ๆ)
  it('shop_hide_demo_products ปิด/ไม่มีแถว (default) → เครื่อง [DEMO] ยังอยู่ใน groups (เหมือนเว็บ)', async () => {
    const demoRow = row({ id: 'demo-1', name: '[DEMO] iPhone 15 Pro Max 256GB' });
    const prisma = makePrisma([], null);
    (prisma.product.findMany as jest.Mock).mockImplementation((args: { where: { NOT?: unknown } }) =>
      Promise.resolve(args.where.NOT ? [] : [demoRow]),
    );
    const tool = new SearchProductsTool(prisma);
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups.flatMap((g) => g.units).map((u) => u.id)).toEqual(['demo-1']);
  });

  it("shop_hide_demo_products = 'true' → เครื่อง [DEMO] ถูกกรองออก (เหมือนเว็บ)", async () => {
    const demoRow = row({ id: 'demo-1', name: '[DEMO] iPhone 15 Pro Max 256GB' });
    const prisma = makePrisma([], 'true');
    (prisma.product.findMany as jest.Mock).mockImplementation((args: { where: { NOT?: unknown } }) =>
      Promise.resolve(args.where.NOT ? [] : [demoRow]),
    );
    const tool = new SearchProductsTool(prisma);
    const r = await tool.run({ query: 'iPhone 15 Pro Max' });
    expect(r.groups.flatMap((g) => g.units).map((u) => u.id)).toEqual([]);
    expect(r.totalMatches).toBe(0);
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
