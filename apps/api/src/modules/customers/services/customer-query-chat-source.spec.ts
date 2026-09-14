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
