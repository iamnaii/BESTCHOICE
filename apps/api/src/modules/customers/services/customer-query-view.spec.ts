import { buildQueryService, enrichmentMocks } from './__tests__/mock-customer-db';

const BOUGHT_CONTRACTS = ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF', 'CANCELED', 'TERMINATED', 'CLOSED_BAD_DEBT'];
const BOUGHT_PREDICATE = { OR: [
  { contracts: { some: { deletedAt: null, status: { in: BOUGHT_CONTRACTS } } } },
  { sales: { some: { deletedAt: null, saleType: { in: ['CASH', 'EXTERNAL_FINANCE'] } } } },
] };
const PROSPECT_PREDICATE = { AND: [
  { contracts: { none: { deletedAt: null, status: { in: BOUGHT_CONTRACTS } } } },
  { sales: { none: { deletedAt: null, saleType: { in: ['CASH', 'EXTERNAL_FINANCE'] } } } },
] };

function fixture() {
  const findMany = jest.fn(async () => [
    { id: 'c1', name: 'ทดสอบ', nickname: 'เล็ก', nationalId: null, createdAt: new Date('2026-01-01T00:00:00Z'),
      contracts: [], _count: { contracts: 0 }, creditChecks: [], creditCheckStatus: 'NONE',
      acquisitionSource: null, referredById: null, tags: [] },
  ]);
  const count = jest.fn().mockResolvedValue(7);
  const db = { customer: { findMany, count }, ...enrichmentMocks() };
  const tier = { getCustomerTiers: jest.fn(async (ids: string[]) => new Map(ids.map(id => [id, { tier: 'NEW' }]))) };
  return { db, findMany, count, tier, service: buildQueryService(db, tier) };
}

const whereAt = (findMany: jest.Mock, index: number) => findMany.mock.calls[index][0].where;
const whereOf = (findMany: jest.Mock) => whereAt(findMany, 0);

describe('มุมมอง ลูกค้า / ผู้สนใจ', () => {
  it('view=customers ใช้ some และลง where.AND (ไม่ทับ where.contracts / where.OR)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', search: 'ก' });
    const where = whereOf(findMany);
    expect(where.AND).toEqual([
      { OR: [
        { contracts: { some: { deletedAt: null, status: { in: BOUGHT_CONTRACTS } } } },
        { sales: { some: { deletedAt: null, saleType: { in: ['CASH', 'EXTERNAL_FINANCE'] } } } },
      ] },
    ]);
    expect(where.contracts).toBeUndefined();
    expect(where.OR).toHaveLength(8); // search ยังเป็นเจ้าของ where.OR คนเดียว
  });

  it('view=prospects ใช้ none ไม่ใช่ NOT+OR (NOT กับ relation ที่เป็น null ทิ้งแถวเงียบ ๆ)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects' });
    const where = whereOf(findMany);
    expect(where.AND).toEqual([
      { AND: [
        { contracts: { none: { deletedAt: null, status: { in: BOUGHT_CONTRACTS } } } },
        { sales: { none: { deletedAt: null, saleType: { in: ['CASH', 'EXTERNAL_FINANCE'] } } } },
      ] },
    ]);
    expect(JSON.stringify(where)).not.toContain('"NOT"');
  });

  it('DRAFT / EXCHANGED / DEFECT_EXCHANGED ไม่ทำให้ใครเป็นลูกค้า (D1)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers' });
    const statuses = whereOf(findMany).AND[0].OR[0].contracts.some.status.in;
    expect(statuses).not.toContain('DRAFT');
    expect(statuses).not.toContain('EXCHANGED');
    expect(statuses).not.toContain('DEFECT_EXCHANGED');
  });

  it('สาขา OR ข้าม sales ด้วย — ลูกค้าเงินสดไม่มีสัญญาเลย', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', branchId: 'br1' });
    expect(whereOf(findMany).AND).toContainEqual({ OR: [
      { contracts: { some: { deletedAt: null, branchId: 'br1' } } },
      { sales: { some: { deletedAt: null, branchId: 'br1' } } },
    ] });
  });

  it('การซื้อ = เงินสด ยัดสาขาเข้าใบขายใบเดียวกัน', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', purchase: 'CASH', branchId: 'br1' });
    const and = whereOf(findMany).AND;
    expect(and).toContainEqual({ sales: { some: { deletedAt: null, saleType: 'CASH', branchId: 'br1' } } });
    expect(JSON.stringify(and)).not.toContain('"OR":[{"contracts":{"some":{"deletedAt":null,"branchId"');
  });

  it('การซื้อ = ผ่อน + สถานะย่อย ค้างชำระ แปลเป็น OVERDUE + DEFAULT', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', purchase: 'INSTALLMENT', state: 'OVERDUE' });
    expect(whereOf(findMany).AND).toContainEqual(
      { contracts: { some: { deletedAt: null, status: { in: ['OVERDUE', 'DEFAULT'] } } } },
    );
  });

  it('state ถูกมองข้ามเมื่อ purchase ไม่ใช่ INSTALLMENT', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', purchase: 'CASH', state: 'OVERDUE' });
    const and = whereOf(findMany).AND;
    expect(and).toContainEqual({ sales: { some: { deletedAt: null, saleType: 'CASH' } } });
    // ไม่มี clause ของสัญญาที่กรองสถานะย่อยหลุดเข้ามา (เหลือแต่ predicate ของมุมมองที่เป็น OR)
    expect(and.filter((clause: Record<string, unknown>) => 'contracts' in clause)).toHaveLength(0);
  });

  it('ตัวกรองของแท็บตรงข้ามถูกมองข้าม — URL ที่แก้มือกรองแบบมองไม่เห็นไม่ได้', async () => {
    const { service, findMany, tier } = fixture();
    // ตัวกรองของแท็บลูกค้า **ทุกตัว** ไม่ใช่บางตัว
    await service.findAll({
      view: 'prospects', purchase: 'CASH', bought: '30d',
      tier: 'GOLD', branchId: 'br1', contractStatus: 'ACTIVE', hasOverdue: 'true', creditStatus: 'APPROVED',
    });
    const where = whereOf(findMany);
    expect(JSON.stringify(where.AND)).not.toContain('saleType":"CASH');
    expect(where.AND).toHaveLength(1); // เหลือแต่ predicate ของมุมมอง
    // contractStatus / hasOverdue เป็นเจ้าของช่อง where.contracts ช่องเดียว
    expect(where.contracts).toBeUndefined();
    expect(where.creditChecks).toBeUndefined();          // creditStatus
    // ?view=prospects&branchId=X เคยคืนศูนย์แถวเสมอ (ผู้สนใจไม่มีสัญญา/ใบขายให้ join สาขา)
    expect(JSON.stringify(where)).not.toContain('br1');
    // ...และ tier ต้องไม่ลาก request เข้าสาขาสแกนทั้งฐานก่อน paginate เพื่อไม่ได้อะไรเลย
    expect(tier.getCustomerTiers).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('สถานะเครดิตของลูกค้า (precheck) เป็นของแท็บผู้สนใจ — แท็บลูกค้ามองข้าม', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', creditCheckStatus: 'UNDER_REVIEW' });
    expect(whereOf(findMany).creditCheckStatus).toBeUndefined();
    await service.findAll({ view: 'prospects', precheck: 'UNDER_REVIEW' });
    expect(whereAt(findMany, 1).creditCheckStatus).toBe('UNDER_REVIEW');
  });

  it("hasOverdue='false' จาก query string ต้อง **ปิด** ตัวกรอง ไม่ใช่เปิด", async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', hasOverdue: 'false' });
    expect(whereOf(findMany).contracts).toBeUndefined();
    await service.findAll({ view: 'customers', hasOverdue: 'true' });
    expect(whereAt(findMany, 1).contracts).toEqual(
      { some: { deletedAt: null, status: { in: ['OVERDUE', 'DEFAULT'] } } },
    );
  });

  it('ค้นหาขยายเป็นเลขสัญญา / เลขใบขาย / IMEI / ชื่อเล่น ในแท็บลูกค้า', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', search: 'ABC' });
    const keys = whereOf(findMany).OR.map((clause: Record<string, unknown>) => Object.keys(clause)[0]);
    expect(keys).toEqual(['name', 'phone', 'nationalId', 'nickname', 'contracts', 'sales', 'contracts', 'sales']);
  });

  it('ค้นหาในแท็บผู้สนใจหาชื่อในแชทแทนเลขสัญญา', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects', search: 'ABC' });
    const or = whereOf(findMany).OR;
    expect(or).toHaveLength(5);
    expect(or[4]).toEqual({ chatRooms: { some: { deletedAt: null, displayName: { contains: 'ABC', mode: 'insensitive' } } } });
  });

  it('ที่มา = คนแนะนำ ต้องไม่ใช่บอท ไม่มีห้องแชท และมีผู้แนะนำ (ไม่ใช้ NOT เปล่า)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects', source: 'REFERRAL' });
    const and = whereOf(findMany).AND;
    expect(and).toContainEqual({ OR: [{ acquisitionSource: null }, { acquisitionSource: { not: { startsWith: 'AI_CHAT' } } }] });
    expect(and).toContainEqual({ chatRooms: { none: { deletedAt: null } } });
    expect(and).toContainEqual({ referredById: { not: null } });
  });

  it('ที่มา = LINE ครอบทั้ง LINE_FINANCE และ LINE_SHOP (ห้องแชทจริง หรือที่มาติดตัว CHAT_LINE_*)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects', source: 'LINE' });
    expect(whereOf(findMany).AND).toContainEqual({
      OR: [
        { chatRooms: { some: { deletedAt: null, channel: { in: ['LINE_FINANCE', 'LINE_SHOP'] } } } },
        { acquisitionSource: { in: ['CHAT_LINE_FINANCE', 'CHAT_LINE_SHOP'] } },
      ],
    });
  });

  it('ที่มา ใช้ได้กับแท็บลูกค้าด้วย (Task 13 — เดิมเฉพาะผู้สนใจ)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'customers', source: 'FACEBOOK' });
    expect(whereOf(findMany).AND).toContainEqual({
      OR: [
        { chatRooms: { some: { deletedAt: null, channel: { in: ['FACEBOOK'] } } } },
        { acquisitionSource: { in: ['CHAT_FACEBOOK'] } },
      ],
    });
  });

  it('แท็ก comma-joined + deletedAt: null (แท็กที่ถอดแล้วยังเป็นแถวอยู่)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects', tag: 'VIP, LOYAL ,' });
    expect(whereOf(findMany).AND).toContainEqual({ tags: { some: { deletedAt: null, tag: { in: ['VIP', 'LOYAL'] } } } });
  });

  it('ติดต่อล่าสุด = เงียบเกิน 30 วัน ใช้ some+none บน relation เดียว', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects', contacted: 'silent30' });
    const clause = whereOf(findMany).AND.find((c: Record<string, unknown>) => 'chatRooms' in c).chatRooms;
    expect(clause.some).toEqual({ deletedAt: null });
    // ต้องเป็นกติกาเดียวกับคอลัมน์: lastCustomerAt ก่อน แล้วถอยไป lastMessageAt เมื่อลูกค้ายังไม่เคยพิมพ์
    expect(clause.none.OR).toHaveLength(2);
    expect(clause.none.OR[0].lastCustomerAt.gte).toBeInstanceOf(Date);
    expect(clause.none.OR[1].lastCustomerAt).toBeNull();
    expect(clause.none.OR[1].lastMessageAt.gte).toBeInstanceOf(Date);
  });

  /**
   * กันบั๊กที่เห็นจริงบน local preview: แถวโชว์ "ติดต่อล่าสุด = เมื่อวาน"
   * แต่การ์ด "คุยกันใน 7 วัน" นับ 0 เพราะตัวกรองเช็คเฉพาะ lastCustomerAt
   * ส่วนคอลัมน์ถอยไปใช้ lastMessageAt ได้ (CustomerChatRoomsService)
   */
  it('การ์ด "คุยกันใน 7 วัน" ใช้กติกาเดียวกับตัวกรอง ไม่ใช่ lastCustomerAt ล้วน', async () => {
    const { service, count } = fixture();
    await service.findAll({ view: 'prospects' });
    const kpiRoomClauses = count.mock.calls
      .map((call: [{ where?: { AND?: Record<string, unknown>[] } }]) => call[0]?.where?.AND ?? [])
      .flat()
      .filter((clause: Record<string, unknown>) => clause && 'chatRooms' in clause)
      .map(
        (clause: { chatRooms: { some?: { OR?: Array<Record<string, unknown>> }; none?: { OR?: Array<Record<string, unknown>> } } }) =>
          clause.chatRooms,
      );

    expect(kpiRoomClauses.length).toBeGreaterThanOrEqual(2);
    for (const clause of kpiRoomClauses) {
      const arm = clause.some?.OR ?? clause.none?.OR;
      expect(arm).toHaveLength(2);
      expect(arm![1].lastCustomerAt).toBeNull();
      expect(arm![1]).toHaveProperty('lastMessageAt');
    }
  });

  it('ติดต่อล่าสุด = ไม่มีแชทผูกอยู่', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects', contacted: 'none' });
    expect(whereOf(findMany).AND).toContainEqual({ chatRooms: { none: { deletedAt: null } } });
  });

  it('ผู้ดูแล = unassigned อ่านห้องที่ยังไม่มีคนรับ (ไม่มี Customer.assignedToId)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ view: 'prospects', owner: 'unassigned' });
    expect(whereOf(findMany).AND).toContainEqual({ chatRooms: { some: { deletedAt: null, assignedToId: null } } });
  });

  it('view ที่สะกดผิดได้ 400 ไม่ใช่ตกเป็น "ทุกคน" เงียบ ๆ', async () => {
    const { service } = fixture();
    await expect(service.findAll({ view: 'customer' })).rejects.toThrow('มุมมองไม่ถูกต้อง');
  });

  it('ซื้อล่าสุด = 30 วัน ยังเป็นคำถามแบบ "มีใบซื้อในช่วงนี้" (some + ขอบล่าง)', async () => {
    const { service, findMany, db } = fixture();
    await service.findAll({ view: 'customers', bought: '30d', page: 1, limit: 50 },
      db as never, new Date('2026-09-12T00:00:00Z'));
    const clause = whereOf(findMany).AND.find((c: Record<string, unknown>) => Array.isArray(c.OR) && JSON.stringify(c.OR).includes('createdAt'));
    expect(clause.OR[0].contracts.some.createdAt.gte).toBeInstanceOf(Date);
    expect(clause.OR[1].sales.some.createdAt.gte).toBeInstanceOf(Date);
  });

  it('ซื้อล่าสุด = เกิน 1 ปี เป็นการ **ปฏิเสธ** (none) — คนที่ซื้อ 2 ปีก่อนแล้วซื้ออีกเมื่อวานต้องไม่ติดมา', async () => {
    const { service, findMany, db } = fixture();
    await service.findAll({ view: 'customers', bought: 'over1y', page: 1, limit: 50 },
      db as never, new Date('2026-09-12T00:00:00Z'));
    const clause = whereOf(findMany).AND.find((c: Record<string, unknown>) => Array.isArray(c.AND));
    // (1) ยังเป็นลูกค้าอยู่ — ไม่ใช่ผู้สนใจที่ไม่เคยซื้ออะไรเลย
    expect(clause.AND[0]).toEqual(BOUGHT_PREDICATE);
    // (2)+(3) ...แต่ห้ามมีใบซื้อใดตั้งแต่จุดตัดขึ้นไป — ต้นวันถัดจาก "asOf − 365 วัน" (กรุงเทพ)
    const cutoff = new Date('2025-09-12T17:00:00.000Z');
    expect(clause.AND[1]).toEqual(
      { contracts: { none: { deletedAt: null, status: { in: BOUGHT_CONTRACTS }, createdAt: { gte: cutoff } } } },
    );
    expect(clause.AND[2]).toEqual(
      { sales: { none: { deletedAt: null, saleType: { in: ['CASH', 'EXTERNAL_FINANCE'] }, createdAt: { gte: cutoff } } } },
    );
    // ข้อ (2)/(3) ห้ามเป็น some (คนที่ซื้อซ้ำจะผ่าน) และห้ามใช้ NOT เปล่า (3VL ทิ้งแถวเงียบ ๆ)
    expect(JSON.stringify(clause.AND.slice(1))).not.toContain('"some"');
    expect(JSON.stringify(clause)).not.toContain('"NOT"');
  });
});

describe('KPI / viewCounts กับตัวกรองที่คลี่ในหน่วยความจำ (tier)', () => {
  /** id ทุกชุดที่ถูกบีบด้วย `{ id: { in: [...] } }` ที่ไหนก็ได้ใน where */
  function idScopeOf(node: unknown): string[] | null {
    if (!node || typeof node !== 'object') return null;
    const record = node as Record<string, unknown>;
    const id = record.id as { in?: string[] } | undefined;
    if (id?.in) return id.in;
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          const found = idScopeOf(child);
          if (found) return found;
        }
      }
    }
    return null;
  }

  const GOLD = ['c00', 'c01'];

  function tierFixture() {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      id: `c${String(index).padStart(2, '0')}`, name: `ลูกค้า ${index}`, nickname: null, nationalId: null,
      createdAt: new Date('2026-01-01T00:00:00Z'), contracts: [], _count: { contracts: 0 },
      creditChecks: [], creditCheckStatus: 'NONE', acquisitionSource: null, referredById: null, tags: [],
    }));
    const findMany = jest.fn(async (args: Record<string, any>) => {
      if (!args.select.name) return rows.map(row => ({ id: row.id, creditChecks: [] }));
      const ids = idScopeOf(args.where);
      const matching = ids ? rows.filter(row => ids.includes(row.id)) : rows;
      return matching.slice(args.skip ?? 0, (args.skip ?? 0) + args.take);
    });
    // 🔴 fake count รู้จักเงื่อนไขเดียว: ชุด id ที่ถูกบีบมา — predicate อื่นทั้งหมด "ตรงทุกคน"
    // ⇒ ถ้า KPI/viewCounts ไม่พก id scope ของ tier มาด้วย ตัวเลขจะเป็น 50 (ฐานทั้งก้อน)
    const count = jest.fn(async (args: Record<string, any>) => (idScopeOf(args.where) ?? rows).length);
    const db = { customer: { findMany, count }, ...enrichmentMocks() };
    const tier = { getCustomerTiers: jest.fn(async (ids: string[]) =>
      new Map(ids.map(id => [id, { tier: GOLD.includes(id) ? 'GOLD' : 'NEW' }]))) };
    return { db, findMany, count, tier, service: buildQueryService(db, tier) };
  }

  it('?tier=GOLD: KPI และ viewCounts ต้องไม่โตเกิน total', async () => {
    const { service } = tierFixture();
    const result = await service.findAll({ view: 'customers', tier: 'GOLD', page: 1, limit: 50 });
    expect(result.total).toBe(GOLD.length);
    expect(result.data.map(row => row.id)).toEqual(GOLD);
    for (const value of Object.values(result.summary)) expect(value).toBeLessThanOrEqual(result.total);
    expect(result.summary).toEqual({ total: 2, installment: 2, cash: 2, externalFinance: 2, overdue: 2, fromChat: 2 });
    expect(Object.values(result.viewCounts).every(value => value <= result.total)).toBe(true);
    expect(result.viewCounts).toEqual({ customers: 2, prospects: 2 });
  });

  it('เรียงด้วยคะแนนเครดิตไม่ใช่ตัวกรอง — ต้องไม่บีบ viewCounts ให้เหลือแค่แท็บที่เปิดอยู่', async () => {
    const { service } = tierFixture();
    const result = await service.findAll({ view: 'customers', sortBy: 'creditScore', page: 1, limit: 50 });
    expect(result.total).toBe(50);
    expect(result.viewCounts).toEqual({ customers: 50, prospects: 50 });
  });
});

describe('KPI และ viewCounts', () => {
  it('KPI ทั้ง 6 ใบผูกกับตัวกรองของหน้านี้ (filter-scoped) — รวม "มาจากแชท" (Task 13)', async () => {
    const { service, count } = fixture();
    const result = await service.findAll({ view: 'customers', search: 'ก' });
    expect(result.summary).toEqual({ total: 7, installment: 7, cash: 7, externalFinance: 7, overdue: 7, fromChat: 7 });
    // นัดแรกที่ไม่ใช่ total ต้องถือ scopedWhere (มี search + predicate ของมุมมอง) ไว้ด้วย
    const kpiCall = count.mock.calls.find(call => call[0].where.AND?.[1]?.contracts);
    expect(kpiCall[0].where.AND[0].OR).toHaveLength(8);
  });

  it('KPI ของแท็บผู้สนใจนับ PRE_CHECK_PASSED รวมกับ FULL_CHECK_PASSED', async () => {
    const { service, count } = fixture();
    const result = await service.findAll({ view: 'prospects' });
    expect(Object.keys(result.summary)).toEqual(['total', 'contacted7d', 'checkingCredit', 'prechecked', 'silent30d']);
    expect(count.mock.calls.some(call =>
      JSON.stringify(call[0].where).includes('["PRE_CHECK_PASSED","FULL_CHECK_PASSED"]'))).toBe(true);
  });

  it('viewCounts ไม่สน predicate ของมุมมอง แต่สน search/สาขา', async () => {
    const { service, count } = fixture();
    const result = await service.findAll({ view: 'customers', search: 'ก', branchId: 'br1' });
    expect(result.viewCounts).toEqual({ customers: 7, prospects: 7 });
    // สองนัดท้ายของ count คือ viewCounts (ลูกค้า, ผู้สนใจ) ตามลำดับใน Promise.all
    const [boughtCall, prospectCall] = count.mock.calls.slice(-2).map(call => call[0].where);
    // predicate ของมุมมองอยู่ที่ AND[1] — ใบละอัน ไม่ใช่แท็บที่กำลังเปิดทั้งสองใบ
    expect(boughtCall.AND[1]).toEqual(BOUGHT_PREDICATE);
    expect(prospectCall.AND[1]).toEqual(PROSPECT_PREDICATE);
    // ฐาน (AND[0]) เหมือนกันทั้งสองใบและเคารพ search + สาขา แต่ไม่มี predicate ของมุมมอง
    expect(prospectCall.AND[0]).toEqual(boughtCall.AND[0]);
    expect(JSON.stringify(boughtCall.AND[0])).toContain('br1');
    expect(JSON.stringify(boughtCall.AND[0])).not.toContain('"none"');
  });

  it('export ไม่ยิง count ของ KPI/viewCounts (ซองตอบของ export ทิ้งทั้งสองอย่าง)', async () => {
    const { service, count } = fixture();
    await service.findAll({ limit: 10_001 });
    // 1 นัดสำหรับ assertExportRowCount + 1 นัดสำหรับ total เท่านั้น
    expect(count).toHaveBeenCalledTimes(2);
  });
});

describe.each([undefined, 'a'.repeat(64)])('รูปร่างแถวที่ตอบกลับ (สัญญาที่ฝั่งเว็บอ่าน), PII key=%s', (piiKey) => {
  let originalPiiKey: string | undefined;
  beforeEach(() => {
    originalPiiKey = process.env.PII_ENCRYPTION_KEY;
    if (piiKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = piiKey;
  });
  afterEach(() => {
    if (originalPiiKey === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = originalPiiKey;
  });
  const excludedPii = Object.fromEntries([
    'phoneSecondary', 'email', 'addressIdCard', 'addressCurrent', 'addressWork',
    'guardianNationalId', 'guardianPhone', 'guardianAddress', 'references',
  ].flatMap(field => [
    [field, `sensitive-canary-${field}`],
    [`${field}Encrypted`, `sensitive-canary-${field}-ciphertext`],
  ]));
  const device = { brand: 'Apple', model: 'iPhone 15', storage: '256GB', imeiSerial: 'IMEI-9', warrantyExpireDate: new Date('2027-06-01T00:00:00Z') };

  function richFixture(over: { prospect?: boolean } = {}) {
    const row = {
      ...excludedPii,
      id: 'cu1', name: 'สมชาย', nickname: 'ชาย', nationalId: '1234567890123',
      nationalIdEncrypted: 'enc:nid', phone: '0812345678', phoneEncrypted: 'enc:phone',
      occupation: 'ค้าขาย', salary: 25000, lineIdFinance: 'Lfin', lineIdShop: 'Lshop',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      _count: { contracts: 2 },
      contracts: [{ status: 'ACTIVE' }, { status: 'OVERDUE' }],
      creditChecks: [{ status: 'APPROVED', aiScore: 72 }],
      creditCheckStatus: 'UNDER_REVIEW', acquisitionSource: 'AI_CHAT_RETURN', referredById: null,
      tags: [{ tag: 'VIP' }],
    };
    const db = {
      // ฉายเฉพาะคีย์ที่ select ระบุ — ถ้า CUSTOMER_SELECT เผลอ select คอลัมน์เกิน เทสนี้จะจับได้
      customer: {
        findMany: jest.fn(async (args: any) => [Object.fromEntries(
          Object.keys(args.select).filter(key => key in row).map(key => [key, (row as Record<string, unknown>)[key]]),
        )]),
        count: jest.fn().mockResolvedValue(1),
      },
      sale: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
      contract: {
        groupBy: jest.fn(async () => [{ customerId: 'cu1', status: 'ACTIVE', _count: { _all: 1 } }]),
        findMany: jest.fn(async (args: any) => args.distinct
          ? [{ customerId: 'cu1', contractNumber: 'BC-1', createdAt: new Date('2026-09-01T00:00:00Z'),
              branchId: 'br1', deviceReceivedAt: null, shopWarrantyEndDate: new Date('2026-12-01T00:00:00Z'),
              branch: { id: 'br1', name: 'สาขาหลัก' }, product: device }]
          : [{ id: 'ct1', customerId: 'cu1' }]),
      },
      payment: {
        groupBy: jest.fn(async () => [{ contractId: 'ct1', _sum: { amountDue: 9600, amountPaid: 0 } }]),
        findMany: jest.fn(async () => [{ contractId: 'ct1', dueDate: new Date('2026-09-25T00:00:00Z'), amountDue: 9600, amountPaid: 0, installmentNo: 1 }]),
      },
      chatRoom: { findMany: jest.fn(async () => [
        { id: 'r1', customerId: 'cu1', channel: 'LINE_SHOP', lastMessageAt: new Date('2026-09-11T00:00:00Z'),
          lastCustomerAt: new Date('2026-09-10T00:00:00Z'), assignedTo: { id: 'u1', name: 'พนักงาน' } },
      ]) },
    };
    const tier = { getCustomerTiers: jest.fn(async (ids: string[]) => new Map(ids.map(id => [id, { tier: 'GOOD' }]))) };
    return { db, service: buildQueryService(db, tier), prospect: over.prospect };
  }

  it('แท็บลูกค้า: ฟิลด์เดิมครบ + ฟิลด์ใหม่ (รวม source/acquisitionSourceRaw — Task 13) และไม่มีคอลัมน์ ciphertext หลุด', async () => {
    const { service } = richFixture();
    const result = await service.findAll({ view: 'customers' });
    const row = result.data[0] as Record<string, unknown>;
    // The HTTP contract is JSON; unselected PII may be own properties set to undefined.
    const jsonRow = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
    expect(JSON.stringify(jsonRow)).not.toContain('sensitive-canary-');
    expect(Object.keys(jsonRow).sort()).toEqual([
      '_count', 'acquisitionSourceRaw', 'activeContracts', 'chatPlaceholder', 'chatRooms', 'createdAt', 'creditCheckStatus', 'id',
      'installmentBalance', 'latestCreditScore', 'latestCreditStatus', 'latestPurchase', 'lineIdFinance',
      'lineIdShop', 'name', 'nationalId', 'nickname', 'occupation', 'overdueContracts', 'phone', 'purchase',
      'salary', 'source', 'tier', 'warranty',
    ]);
    // 🔴 สอง enum คนละใบ ต้องมาทั้งคู่: คอลัมน์ "เครดิต" ของแท็บลูกค้าอ่าน creditCheckStatus
    // (CustomerCreditCheckStatus) ส่วน latestCreditStatus เป็นสถานะของใบตรวจ (CreditCheckStatus)
    // เดิมแถวพกมาแต่ใบตรวจ ⇒ ฝั่งเว็บ map ผ่านแผนที่ของลูกค้าแล้วพิมพ์อังกฤษดิบ 3 ใน 4 ค่า
    expect(row.creditCheckStatus).toBe('UNDER_REVIEW');
    expect(row.latestCreditStatus).toBe('APPROVED');
    expect(Object.keys(row).some(key => key.endsWith('Encrypted'))).toBe(false);
    // ไม่มี acquisitionSource/referredById ดิบหลุดมาด้วย — เหลือแค่ที่มาที่อนุมานแล้ว + ค่าดิบ
    // ที่ตั้งใจเปิด (acquisitionSourceRaw) เท่านั้น (Task 13, ดู owner rule: ไม่มีคอลัมน์ใหม่)
    expect(row).not.toHaveProperty('acquisitionSource');
    expect(row).not.toHaveProperty('referredById');
    // ที่มา (Task 13): AI_CHAT_RETURN ชนะช่องทางห้องแชท (LINE_SHOP) เหมือนแท็บผู้สนใจ
    expect(row.source).toBe('BOT');
    expect(row.acquisitionSourceRaw).toBe('AI_CHAT_RETURN');
    // แท็บลูกค้ามีเบอร์/เลขบัตรจริง + ที่มาไม่ใช่ CHAT_* (เป็น AI_CHAT_RETURN) ⇒ ไม่ใช่ placeholder
    // (Task 13 fix round, I1/R15 — เดิมแขนนี้ของ findAll ไม่เคยคำนวณ flag นี้เลย)
    expect(row.chatPlaceholder).toBe(false);
    expect(row.activeContracts).toBe(1);
    expect(row.overdueContracts).toBe(1);
    expect(row.tier).toBe('GOOD');
    expect(row.purchase).toEqual({
      installmentTotal: 1,
      installmentByState: { ACTIVE: 1, OVERDUE: 0, CLOSED: 0, BAD_DEBT: 0, OTHER: 0 },
      cashCount: 0, externalFinanceCount: 0,
    });
    expect(row.latestPurchase).toEqual({
      at: '2026-09-01T00:00:00.000Z', kind: 'INSTALLMENT', number: 'BC-1',
      productLabel: 'Apple iPhone 15 256GB', imeiSerial: 'IMEI-9',
      branchId: 'br1', branchName: 'สาขาหลัก',
    });
    expect(row.warranty).toEqual({
      endDate: '2027-06-01T00:00:00.000Z', source: 'CENTER',
      shopEndDate: '2026-12-01T00:00:00.000Z', centerEndDate: '2027-06-01T00:00:00.000Z',
      status: 'IN_SHOP_WARRANTY',
    });
    expect(row.installmentBalance).toEqual({
      outstanding: 9600, nextDueDate: '2026-09-25T00:00:00.000Z', nextAmountDue: 9600, openContracts: 1,
    });
    expect(row.chatRooms).toEqual([{ roomId: 'r1', channel: 'LINE_SHOP', logo: 'LINE' }]);
  });

  it('แท็บผู้สนใจ: ไม่มี tier / purchase / warranty / _count และมีที่มา+ผู้ดูแล+ติดต่อล่าสุด+ธง chatPlaceholder', async () => {
    const { service } = richFixture();
    const result = await service.findAll({ view: 'prospects' });
    const row = result.data[0] as Record<string, unknown>;
    const jsonRow = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
    expect(JSON.stringify(jsonRow)).not.toContain('sensitive-canary-');
    expect(Object.keys(row).some(key => key.endsWith('Encrypted'))).toBe(false);
    expect(Object.keys(jsonRow).sort()).toEqual([
      'acquisitionSourceRaw', 'assignedTo', 'chatPlaceholder', 'chatRooms', 'createdAt', 'creditCheckStatus', 'id',
      'lastContactAt', 'lastContactSource', 'latestCreditScore', 'name', 'nationalId', 'nickname',
      'phone', 'source', 'tags',
    ]);
    expect(row.source).toBe('BOT'); // acquisitionSource = AI_CHAT_RETURN ชนะช่องทางห้องแชท
    expect(row.acquisitionSourceRaw).toBe('AI_CHAT_RETURN');
    // มีทั้งเบอร์และเลขบัตรอยู่แล้ว (และที่มาไม่ใช่ CHAT_*) ⇒ ไม่ใช่ผู้สนใจอัตโนมัติ (Task 13)
    expect(row.chatPlaceholder).toBe(false);
    expect(row.tags).toEqual([{ tag: 'VIP' }]);
    expect(row.creditCheckStatus).toBe('UNDER_REVIEW');
    expect(row.latestCreditScore).toBe(72);
    expect(row.lastContactAt).toBe('2026-09-10T00:00:00.000Z');
    expect(row.lastContactSource).toBe('CUSTOMER');
    expect(row.assignedTo).toEqual({ id: 'u1', name: 'พนักงาน' });
  });

  it('แท็บผู้สนใจไม่ยิงการคำนวณระดับลูกค้าและสรุปการซื้อเลย (ค่าคงที่ทั้งหมด)', async () => {
    const { db, service } = richFixture();
    await service.findAll({ view: 'prospects' });
    expect(db.sale.groupBy).not.toHaveBeenCalled();
    expect(db.contract.groupBy).not.toHaveBeenCalled();
    expect(db.payment.groupBy).not.toHaveBeenCalled();
    expect(db.chatRoom.findMany).toHaveBeenCalledTimes(1);
  });
});
