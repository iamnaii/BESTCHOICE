import { buildQueryService, enrichmentMocks } from './__tests__/mock-customer-db';

const baseRow: {
  id: string; name: string; nickname: string | null; nationalId: string | null; phone: string | null;
  createdAt: Date; contracts: Array<{ status: string }>; _count: { contracts: number };
  creditChecks: unknown[]; creditCheckStatus: string; acquisitionSource: string | null;
  referredById: string | null; tags: unknown[];
} = {
  id: 'c1', name: 'สมชาย ใจดี', nickname: null, nationalId: null, phone: null, createdAt: new Date('2026-09-12T07:32:00Z'),
  contracts: [], _count: { contracts: 0 }, creditChecks: [], creditCheckStatus: 'NONE', acquisitionSource: 'CHAT_FACEBOOK', referredById: null, tags: [],
};
function fixture(row: typeof baseRow = baseRow) {
  const findMany = jest.fn(async () => [row]);
  const count = jest.fn().mockResolvedValue(3);
  const db = { customer: { findMany, count }, ...enrichmentMocks() };
  const tier = { getCustomerTiers: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, { tier: 'NEW' }]))) };
  return { db, findMany, count, service: buildQueryService(db, tier) };
}
const whereOf = (findMany: jest.Mock) => findMany.mock.calls[0][0].where;

describe('ผู้สนใจอัตโนมัติในรายชื่อ', () => {
  it('แถวผู้สนใจมี chatPlaceholder=true เมื่อ CHAT_* + ไม่มีเบอร์/เลขบัตร', async () => {
    const { service } = fixture();
    const res = await service.findAll({ view: 'prospects' });
    expect(res.data[0]).toMatchObject({ chatPlaceholder: true, source: 'FACEBOOK', acquisitionSourceRaw: 'CHAT_FACEBOOK' });
  });
  it('เติมเบอร์แล้ว → chatPlaceholder=false แต่ที่มายังเป็น FACEBOOK', async () => {
    const { service } = fixture({ ...baseRow, phone: '0812345678' });
    const res = await service.findAll({ view: 'prospects' });
    expect(res.data[0]).toMatchObject({ chatPlaceholder: false, source: 'FACEBOOK' });
  });
  it('ที่มา CHAT_LINE_SHOP แม้ไม่มีห้องแชทเหลือ → LINE (ไม่ตกเป็น WALK_IN)', async () => {
    const { service } = fixture({ ...baseRow, acquisitionSource: 'CHAT_LINE_SHOP' });
    const res = await service.findAll({ view: 'prospects' });
    expect(res.data[0].source).toBe('LINE');
  });
});

describe('แท็บลูกค้า: ตัวกรองที่มา + KPI มาจากแชท', () => {
  it('view=customers&source=LINE กรองด้วยห้อง LINE หรือที่มา CHAT_LINE_* (และไม่ใช่บอท)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', source: 'LINE' });
    const and = whereOf(findMany).AND as any[];
    expect(and).toEqual(expect.arrayContaining([
      { OR: [{ acquisitionSource: null }, { acquisitionSource: { not: { startsWith: 'AI_CHAT' } } }] },
      { OR: [
        { chatRooms: { some: { deletedAt: null, channel: { in: ['LINE_FINANCE', 'LINE_SHOP'] } } } },
        { acquisitionSource: { in: ['CHAT_LINE_FINANCE', 'CHAT_LINE_SHOP'] } },
      ] },
    ]));
  });
  it('summary แท็บลูกค้ามี fromChat และแถวมี source', async () => {
    const { service, count } = fixture({ ...baseRow, phone: '0812345678', contracts: [{ status: 'ACTIVE' }] });
    const res = await service.findAll({ view: 'customers' });
    expect(res.summary).toMatchObject({ fromChat: 3 });
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: expect.arrayContaining([{ acquisitionSource: { startsWith: 'CHAT_' } }]) } }));
    expect(res.data[0]).toMatchObject({ source: 'FACEBOOK', acquisitionSourceRaw: 'CHAT_FACEBOOK' });
  });
});

// ---- Fix round 1 (review "Needs fixes" — Findings I1/I2/I3, Rulings R15/R16/R17) ----

describe('Fix round 1 — I1/R15: chatPlaceholder ต้องคำนวณทุกแขนของ findAll/findOne', () => {
  it('findAll({}) (ไม่ส่ง view เลย) คืน chatPlaceholder=true สำหรับแถวที่เข้าเกณฑ์ — เดิมแขนนี้ไม่มี flag นี้เลย', async () => {
    const { service } = fixture();
    const res = await service.findAll({});
    expect(res.data[0]).toMatchObject({ chatPlaceholder: true, acquisitionSourceRaw: 'CHAT_FACEBOOK' });
  });

  it('findAll({}) คืน chatPlaceholder=false เมื่อมีเบอร์โทรจริงแล้ว', async () => {
    const { service } = fixture({ ...baseRow, phone: '0812345678' });
    const res = await service.findAll({});
    expect(res.data[0].chatPlaceholder).toBe(false);
  });

  it('view=customers คืน chatPlaceholder=true สำหรับแถวที่เข้าเกณฑ์ (picker เช่น BookingsPage/useCreditCheckCreate เรียกทางนี้)', async () => {
    const { service } = fixture();
    const res = await service.findAll({ view: 'customers' });
    expect(res.data[0]).toMatchObject({ chatPlaceholder: true });
  });

  it('view=customers คืน chatPlaceholder=false สำหรับลูกค้าที่มีเบอร์/เลขบัตรจริงแล้ว', async () => {
    const { service } = fixture({ ...baseRow, phone: '0812345678', nationalId: '1234567890123' });
    const res = await service.findAll({ view: 'customers' });
    expect(res.data[0].chatPlaceholder).toBe(false);
  });

  it('findOne คืน chatPlaceholder=true สำหรับลูกค้าที่เข้าเกณฑ์ placeholder (ก่อนหน้านี้ไม่มีเทสต์ path นี้เลย)', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'c1',
      name: 'สมชาย ใจดี',
      nickname: null,
      phone: null,
      nationalId: null,
      acquisitionSource: 'CHAT_FACEBOOK',
      deletedAt: null,
      contracts: [],
      sales: [],
      _count: { contracts: 0, referrals: 0 },
      referredBy: null,
    });
    const db = { customer: { findUnique } };
    const service = buildQueryService(db, {});
    const res = await service.findOne('c1');
    expect(res.chatPlaceholder).toBe(true);
  });

  it('findOne คืน chatPlaceholder=false สำหรับลูกค้าที่มีเบอร์จริง', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'c2',
      name: 'สมหญิง',
      nickname: null,
      phone: '0899999999',
      nationalId: null,
      acquisitionSource: 'CHAT_FACEBOOK',
      deletedAt: null,
      contracts: [],
      sales: [],
      _count: { contracts: 0, referrals: 0 },
      referredBy: null,
    });
    const db = { customer: { findUnique } };
    const service = buildQueryService(db, {});
    const res = await service.findOne('c2');
    expect(res.chatPlaceholder).toBe(false);
  });
});

describe('Fix round 1 — I2/R16: fromChat ใช้ constant เดียวกับ KPI "มาจากแชท" (กดแล้วกรอง)', () => {
  it('fromChat=true บนแท็บลูกค้า push predicate รูปเดียวกับที่ KPI ใช้ (startsWith CHAT_)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', fromChat: 'true' });
    const and = whereOf(findMany).AND as any[];
    expect(and).toEqual(expect.arrayContaining([{ acquisitionSource: { startsWith: 'CHAT_' } }]));
  });

  it('fromChat=false บนแท็บลูกค้า push ฟอร์ม NOT ที่กัน 3VL เหมือน NOT_BOT_WHERE', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', fromChat: 'false' });
    const and = whereOf(findMany).AND as any[];
    expect(and).toEqual(expect.arrayContaining([
      { OR: [{ acquisitionSource: null }, { acquisitionSource: { not: { startsWith: 'CHAT_' } } }] },
    ]));
  });

  it('fromChat=true ใช้ได้บนแท็บผู้สนใจด้วย — cross-tab ตาม R16 ไม่ใช่ตัวกรองเฉพาะแท็บลูกค้า', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects', fromChat: 'true' });
    const and = whereOf(findMany).AND as any[];
    expect(and).toEqual(expect.arrayContaining([{ acquisitionSource: { startsWith: 'CHAT_' } }]));
  });

  it('fromChat=false ใช้ได้บนแท็บผู้สนใจด้วยเช่นกัน', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects', fromChat: 'false' });
    const and = whereOf(findMany).AND as any[];
    expect(and).toEqual(expect.arrayContaining([
      { OR: [{ acquisitionSource: null }, { acquisitionSource: { not: { startsWith: 'CHAT_' } } }] },
    ]));
  });

  it('ไม่ส่ง fromChat มา ต้องไม่ push predicate ใดๆ เพิ่ม (undefined ≠ "false")', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers' });
    const and = whereOf(findMany).AND as any[];
    expect(and).not.toEqual(expect.arrayContaining([{ acquisitionSource: { startsWith: 'CHAT_' } }]));
    expect(and).not.toEqual(expect.arrayContaining([
      { OR: [{ acquisitionSource: null }, { acquisitionSource: { not: { startsWith: 'CHAT_' } } }] },
    ]));
  });

  it('KPI "มาจากแชท" ยังใช้ predicate รูปเดียวกับตัวกรอง fromChat=true — ห้าม drift', async () => {
    const { service, count } = fixture({ ...baseRow, phone: '0812345678', contracts: [{ status: 'ACTIVE' }] });
    await service.findAll({ view: 'customers' });
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: expect.arrayContaining([{ acquisitionSource: { startsWith: 'CHAT_' } }]) },
    }));
  });
});

describe('Fix round 1 — I3/R17: SOURCE_CHAT_VALUES derive จาก SOURCE_CHANNELS ผ่าน chatSourceOf', () => {
  it.each([
    ['FACEBOOK', ['CHAT_FACEBOOK']],
    ['TIKTOK', ['CHAT_TIKTOK']],
    ['WEB', ['CHAT_WEB']],
    ['LINE', ['CHAT_LINE_FINANCE', 'CHAT_LINE_SHOP']],
  ])('source=%s ให้ acquisitionSource.in ที่นิยามแล้วและไม่ว่าง (กันดริฟต์ always-true จาก SOURCE_CHAT_VALUES[key]===undefined)', async (source, expected) => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', source });
    const and = whereOf(findMany).AND as any[];
    const orBlock = and.find((clause: any) => Array.isArray(clause?.OR) && clause.OR.some((c: any) => c?.acquisitionSource?.in));
    expect(orBlock).toBeDefined();
    const inClause = orBlock.OR.find((c: any) => c?.acquisitionSource?.in);
    expect(inClause.acquisitionSource.in).toBeDefined();
    expect(Array.isArray(inClause.acquisitionSource.in)).toBe(true);
    expect(inClause.acquisitionSource.in.length).toBeGreaterThan(0);
    expect(inClause.acquisitionSource.in).toEqual(expected);
  });
});
