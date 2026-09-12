import { buildQueryService, enrichmentMocks } from './__tests__/mock-customer-db';

describe('Customer derived filters run before pagination', () => {
  function fixture() {
    const rows = Array.from({ length: 201 }, (_, index) => ({
      id: String(index).padStart(3, '0'), name: `Customer ${index}`, nationalId: null,
      contracts: [], _count: { contracts: 0 },
      creditChecks: index === 200 ? [] : [{ status: 'APPROVED', aiScore: index }],
    }));
    const findMany = jest.fn(async (args: any) => {
      if (!args.select.name) return rows.map(row => ({ id: row.id, creditChecks: row.creditChecks }));
      const ids = args.where.AND?.[1]?.id?.in;
      const matching = ids ? rows.filter(row => ids.includes(row.id)) : rows;
      return matching.slice(args.skip, args.skip + args.take);
    });
    const db = { customer: { findMany, count: jest.fn().mockResolvedValue(201) }, ...enrichmentMocks() };
    const tier = { getCustomerTiers: jest.fn(async (ids: string[]) => new Map(ids.map(id => [id, { tier: id === '200' ? 'GOLD' : 'NEW' }]))) };
    return { findMany, tier, db, service: buildQueryService(db, tier) };
  }
  it('finds the matching tier beyond the first200 rows and returns a matching total', async () => {
    const { service, tier } = fixture();
    const result = await service.findAll({ page: 1, limit: 50, sortBy: 'name', sortOrder: 'asc', tier: 'GOLD' });
    expect(result.total).toBe(1);
    expect(result.data.map(row => row.id)).toEqual(['200']);
    expect((result.data[0] as { tier?: string }).tier).toBe('GOLD');
    expect(tier.getCustomerTiers.mock.calls[0][0]).toHaveLength(201);
    // ระดับลูกค้าต้องถูกคำนวณรอบเดียวต่อหน้า — ห้ามเรียกซ้ำเพื่อเติมคอลัมน์ tier
    expect(tier.getCustomerTiers).toHaveBeenCalledTimes(1);
  });
  it('sorts scores globally, keeps a real zero and places null last', async () => {
    const { service } = fixture();
    const high = await service.findAll({ page: 1, limit: 1, sortBy: 'creditScore', sortOrder: 'desc' });
    expect(high.data[0]).toMatchObject({ id: '199', latestCreditScore: 199 });
    const zero = await service.findAll({ page: 1, limit: 1, sortBy: 'creditScore', sortOrder: 'asc' });
    expect(zero.data[0]).toMatchObject({ id: '000', latestCreditScore: 0 });
    const missing = await service.findAll({ page: 201, limit: 1, sortBy: 'creditScore', sortOrder: 'asc' });
    expect(missing.data[0]).toMatchObject({ id: '200', latestCreditScore: null });
  });
  it('combines branch and contract status instead of dropping the branch', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ search: 'search', page: 1, limit: 50, contractStatus: 'ACTIVE', hasOverdue: false, branchId: 'branch' });
    expect(findMany.mock.calls[0][0].where.contracts).toEqual({ some: { deletedAt: null, branchId: 'branch', status: 'ACTIVE' } });
    // ตัวกรองใหม่ลง AND ทั้งหมด ⇒ ช่อง contracts กับ OR ของ search รอดทั้งคู่
    expect(findMany.mock.calls[0][0].where.OR).toHaveLength(8);
  });
  it('fails the request when tier history cannot be read rather than classifying everyone NEW', async () => {
    const { service, tier } = fixture();
    tier.getCustomerTiers.mockRejectedValue(new Error('database unavailable'));
    await expect(service.findAll()).rejects.toThrow('database unavailable');
  });
  it('ไม่ส่ง view = ทุกคน — หน้าอื่นที่ใช้ endpoint นี้เป็นตัวเลือกคนต้องยังเจอคนที่ไม่เคยซื้อ', async () => {
    const { service, findMany } = fixture();
    await service.findAll();
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });
  it('คีย์เรียงที่ฐานข้อมูลเรียงไม่ได้ตกไปที่ createdAt desc (ฝั่งเว็บห้ามทำหัวคอลัมน์ให้กดได้)', async () => {
    const { service, findMany } = fixture();
    await service.findAll({ sortBy: 'lastPurchaseAt', sortOrder: 'asc' });
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    await service.findAll({ view: 'prospects', sortBy: 'lastContactAt', sortOrder: 'asc' });
    expect(findMany.mock.calls[1][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });
});
