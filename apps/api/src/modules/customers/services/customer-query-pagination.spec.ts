import { CustomerQueryService } from './customer-query.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustomerTierService } from '../customer-tier.service';

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
    const db = { customer: { findMany, count: jest.fn().mockResolvedValue(201) } };
    const tier = { getCustomerTiers: jest.fn(async (ids: string[]) => new Map(ids.map(id => [id, { tier: id === '200' ? 'GOLD' : 'NEW' }]))) };
    return { findMany, tier, service: new CustomerQueryService(db as unknown as PrismaService, tier as unknown as CustomerTierService) };
  }
  it('finds the matching tier beyond the first200 rows and returns a matching total', async () => {
    const { service, tier } = fixture();
    const result = await service.findAll(undefined, 1, 50, undefined, undefined, undefined, undefined, 'name', 'asc', 'GOLD');
    expect(result.total).toBe(1);
    expect(result.data.map(row => row.id)).toEqual(['200']);
    expect(result.data[0].tier).toBe('GOLD');
    expect(tier.getCustomerTiers.mock.calls[0][0]).toHaveLength(201);
  });
  it('sorts scores globally, keeps a real zero and places null last', async () => {
    const { service } = fixture();
    const high = await service.findAll(undefined, 1, 1, undefined, undefined, undefined, undefined, 'creditScore', 'desc');
    expect(high.data[0]).toMatchObject({ id: '199', latestCreditScore: 199 });
    const zero = await service.findAll(undefined, 1, 1, undefined, undefined, undefined, undefined, 'creditScore', 'asc');
    expect(zero.data[0]).toMatchObject({ id: '000', latestCreditScore: 0 });
    const missing = await service.findAll(undefined, 201, 1, undefined, undefined, undefined, undefined, 'creditScore', 'asc');
    expect(missing.data[0]).toMatchObject({ id: '200', latestCreditScore: null });
  });
  it('combines branch and contract status instead of dropping the branch', async () => {
    const { service, findMany } = fixture();
    await service.findAll('search', 1, 50, 'ACTIVE', false, undefined, 'branch');
    expect(findMany.mock.calls[0][0].where.contracts).toEqual({ some: { deletedAt: null, branchId: 'branch', status: 'ACTIVE' } });
  });
  it('fails the request when tier history cannot be read rather than classifying everyone NEW', async () => {
    const { service, tier } = fixture();
    tier.getCustomerTiers.mockRejectedValue(new Error('database unavailable'));
    await expect(service.findAll()).rejects.toThrow('database unavailable');
  });
});
