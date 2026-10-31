import { Prisma, PrismaClient } from '@prisma/client';
import {
  activatedBeforeShopWiring,
  isLegacyNoShop,
  loadShopFinanceReceivableLens,
} from './legacy-no-shop';

const D = (v: string) => new Prisma.Decimal(v);

describe('legacyNoShop — one definition (pending queue + data-audit)', () => {
  it('both S11-3001 and S11-3002 lenses exactly 0 (or no lens row at all) = legacyNoShop', () => {
    expect(isLegacyNoShop(undefined)).toBe(true);
    expect(isLegacyNoShop({ shopFinancedGl: D('0'), shopCommissionGl: D('0') })).toBe(true);
    expect(isLegacyNoShop({ shopFinancedGl: D('10000'), shopCommissionGl: D('0') })).toBe(false);
    expect(isLegacyNoShop({ shopFinancedGl: D('0'), shopCommissionGl: D('0.01') })).toBe(false);
  });

  it('the SHOP wiring cut-off covers the whole wiring day (Bangkok) — the deploy came after the 16:08 merge', () => {
    expect(activatedBeforeShopWiring(new Date('2026-06-23T23:59:59+07:00'))).toBe(true);
    expect(activatedBeforeShopWiring(new Date('2026-06-24T00:00:00+07:00'))).toBe(false);
    expect(activatedBeforeShopWiring(null)).toBe(false); // unknown activation = not exempt
  });

  it('lens loader: scoped by contractIds when given (none = every contract · empty = no query)', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { contract_id: 'c-1', financed: '10000.00', commission: '1000.00' },
      { contract_id: null, financed: '5', commission: '5' },
    ]);
    const client = { $queryRaw: queryRaw } as unknown as PrismaClient;

    const lens = await loadShopFinanceReceivableLens(client, ['c-1', 'c-2']);
    expect([...lens.keys()]).toEqual(['c-1']);
    expect(lens.get('c-1')?.shopFinancedGl.toFixed(2)).toBe('10000.00');
    const scoped = JSON.stringify(queryRaw.mock.calls[0]);
    expect(scoped).toContain("je.metadata->>'contractId' IN (");
    expect(scoped).toContain('S11-3001');
    expect(scoped).toContain('S11-3002');

    await loadShopFinanceReceivableLens(client);
    expect(JSON.stringify(queryRaw.mock.calls[1])).not.toContain("je.metadata->>'contractId' IN (");

    expect((await loadShopFinanceReceivableLens(client, [])).size).toBe(0);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});
