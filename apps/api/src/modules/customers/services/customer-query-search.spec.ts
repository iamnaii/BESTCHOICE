import { buildQueryService } from './__tests__/mock-customer-db';

/**
 * A8 — ผลค้นหา (GET /customers/search · "ผูกกับลูกค้าเดิม" ในอินบ็อกซ์) ติดธง chatPlaceholder
 * นิยามเดียวกับทุกที่ (isChatPlaceholder บนเบอร์/เลขบัตรที่ถอดรหัสแล้ว) — เว็บห้ามอนุมานเอง
 * และห้ามคืน acquisitionSource ดิบเพิ่ม (ไม่ใช่ข้อมูลที่ช่องค้นหาต้องใช้)
 */
describe('CustomerQueryService.search — chatPlaceholder (A8)', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'c',
    name: 'สมชาย',
    phone: null,
    phoneEncrypted: null,
    nationalId: null,
    nationalIdEncrypted: null,
    acquisitionSource: null,
    deletedAt: null,
    _count: { contracts: 0 },
    contracts: [],
    ...over,
  });

  function fixture(rows: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const service = buildQueryService({ customer: { findMany } }, {});
    return { findMany, service };
  }

  it('ผู้สนใจจากแชทที่ยังไม่มีเบอร์และเลขบัตร → chatPlaceholder: true · มีเบอร์/เลขบัตร/ไม่ใช่ที่มาแชท → false', async () => {
    const { service } = fixture([
      row({ id: 'p1', name: 'Facebook #1234', acquisitionSource: 'CHAT_FACEBOOK' }),
      row({ id: 'p2', acquisitionSource: 'CHAT_LINE_SHOP', phone: '0812345678' }),
      row({ id: 'p3', acquisitionSource: 'CHAT_FACEBOOK', nationalId: '1103700012345' }),
      row({ id: 'w1', acquisitionSource: 'WALK_IN' }),
      row({ id: 'n1' }),
    ]);
    const res = await service.search('ส');
    expect(res.map((r) => [r.id, r.chatPlaceholder])).toEqual([
      ['p1', true],
      ['p2', false],
      ['p3', false],
      ['w1', false],
      ['n1', false],
    ]);
  });

  it('select ใช้ PLACEHOLDER_FIELDS_SELECT (มี acquisitionSource) แต่คำตอบไม่มี acquisitionSource/deletedAt ดิบ · คีย์เดิมอยู่ครบ', async () => {
    const { service, findMany } = fixture([
      row({ id: 'p1', name: 'Facebook #1234', acquisitionSource: 'CHAT_FACEBOOK', contracts: [{ id: 'k1' }], _count: { contracts: 2 } }),
    ]);
    const [res] = await service.search('Facebook');
    expect(findMany.mock.calls[0][0].select).toMatchObject({
      acquisitionSource: true,
      phone: true,
      nationalId: true,
      deletedAt: true,
    });
    expect(res).toEqual({
      id: 'p1',
      name: 'Facebook #1234',
      phone: null,
      nationalId: null,
      _count: { contracts: 2 },
      activeContractCount: 1,
      chatPlaceholder: true,
    });
  });
});
