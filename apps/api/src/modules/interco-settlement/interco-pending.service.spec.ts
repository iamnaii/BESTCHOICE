import { Test, TestingModule } from '@nestjs/testing';
import { IntercoPendingService } from './interco-pending.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('IntercoPendingService.getPendingContracts', () => {
  let service: IntercoPendingService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      interCoSettlementItem: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [IntercoPendingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(IntercoPendingService);
  });

  /** Service calls $queryRaw twice: FINANCE lens first, SHOP lens second. */
  const queueLenses = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    financeRows: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shopRows: any[],
  ) => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValueOnce(financeRows).mockResolvedValueOnce(shopRows);
  };

  it('returns [] when the FINANCE lens has no rows at all', async () => {
    queueLenses([], []);
    const result = await service.getPendingContracts();
    expect(result).toEqual([]);
    // No point hitting the SHOP lens / settled-gate / contract lookup once
    // the FINANCE lens is empty.
    expect(prisma.interCoSettlementItem.findMany).not.toHaveBeenCalled();
  });

  it('(ก) SQL WHERE excludes JEs without metadata.contractId — and the mapper defensively drops any null contract_id row that slips through', async () => {
    queueLenses(
      [
        // Should never legitimately occur (the SQL WHERE filters it), but
        // prove the mapper is defensive regardless of what the query returns.
        { contract_id: null, activated_at: new Date(), financed: 999, commission: 999 },
        {
          contract_id: 'c-1',
          activated_at: new Date('2026-06-01T00:00:00Z'),
          financed: 10000,
          commission: 1000,
        },
      ],
      [],
    );
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);

    const result = await service.getPendingContracts();

    expect(result).toHaveLength(1);
    expect(result[0].contractId).toBe('c-1');

    // Assert the actual SQL text sent for the FINANCE lens carries the
    // metadata.contractId IS NOT NULL guard — this is the primary defense,
    // the mapper filter above is belt-and-suspenders.
    const financeSql = (prisma.$queryRaw.mock.calls[0][0] as unknown as string[]).join('');
    expect(financeSql).toContain("metadata->>'contractId' IS NOT NULL");
    expect(financeSql).toContain('21-1101');
    expect(financeSql).toContain('21-1102');
  });

  it('(ข) excludes contracts settled in a PENDING_APPROVAL/POSTED batch — REVERSED/CANCELLED do NOT exclude', async () => {
    queueLenses(
      [
        { contract_id: 'c-1', activated_at: new Date(), financed: 10000, commission: 1000 },
        { contract_id: 'c-2', activated_at: new Date(), financed: 5000, commission: 500 },
      ],
      [],
    );
    // Simulates the real WHERE clause (status IN ['PENDING_APPROVAL','POSTED'])
    // only ever returning c-1 — c-2 has an item too, but it lives in a
    // REVERSED batch, which that WHERE clause would never match, so it's
    // correctly absent here.
    prisma.interCoSettlementItem.findMany.mockResolvedValue([{ contractId: 'c-1' }]);
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-2', contractNumber: 'CT-0002', customer: { name: 'ลูกค้า B' } },
    ]);

    const result = await service.getPendingContracts();

    expect(result.map((r) => r.contractId)).toEqual(['c-2']);

    const where = prisma.interCoSettlementItem.findMany.mock.calls[0][0].where;
    expect(where.batch.status.in).toEqual(['PENDING_APPROVAL', 'POSTED']);
    expect(where.batch.status.in).not.toContain('REVERSED');
    expect(where.batch.status.in).not.toContain('CANCELLED');

    // Contract lookup must only be attempted for the still-pending id.
    const contractWhereIn = prisma.contract.findMany.mock.calls[0][0].where.id.in;
    expect(contractWhereIn).toEqual(['c-2']);
  });

  it('(ค) legacyNoShop=true when SHOP GL (S11-3001/S11-3002) sums to 0 for both accounts', async () => {
    queueLenses(
      [{ contract_id: 'c-1', activated_at: new Date(), financed: 10000, commission: 1000 }],
      [], // no SHOP rows at all for c-1 → both default to 0
    );
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);

    const [result] = await service.getPendingContracts();
    expect(result.legacyNoShop).toBe(true);
    expect(result.shopFinancedGl.toNumber()).toBe(0);
    expect(result.shopCommissionGl.toNumber()).toBe(0);
  });

  it('legacyNoShop=false when SHOP GL carries a real balance', async () => {
    queueLenses(
      [{ contract_id: 'c-1', activated_at: new Date(), financed: 10000, commission: 1000 }],
      [{ contract_id: 'c-1', financed: 10000, commission: 1000 }],
    );
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);

    const [result] = await service.getPendingContracts();
    expect(result.legacyNoShop).toBe(false);
    expect(result.shopFinancedGl.toNumber()).toBe(10000);
    expect(result.shopCommissionGl.toNumber()).toBe(1000);
  });

  it('(ง) amounts always come from GL rows — never from contract.financedAmount/storeCommission, even when they differ', async () => {
    queueLenses(
      [{ contract_id: 'c-1', activated_at: new Date('2026-06-01T00:00:00Z'), financed: 10000, commission: 1000 }],
      [],
    );
    // Decoy fields that would NEVER be selected by the service — if the
    // mapper somehow read these instead of the GL rows, the assertions below
    // would fail.
    prisma.contract.findMany.mockResolvedValue([
      {
        id: 'c-1',
        contractNumber: 'CT-0001',
        customer: { name: 'ลูกค้า A' },
        financedAmount: 99999,
        storeCommission: 55555,
      },
    ]);

    const [result] = await service.getPendingContracts();
    expect(result.financedGl.toNumber()).toBe(10000);
    expect(result.commissionGl.toNumber()).toBe(1000);

    // The select shape itself must never even ask for these fields.
    const select = prisma.contract.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('financedAmount');
    expect(select).not.toHaveProperty('storeCommission');
  });

  it('maps activatedAt straight through from MIN(je.posted_at)', async () => {
    const activatedAt = new Date('2026-06-01T00:00:00Z');
    queueLenses(
      [{ contract_id: 'c-1', activated_at: activatedAt, financed: 10000, commission: 1000 }],
      [],
    );
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);

    const [result] = await service.getPendingContracts();
    expect(result.activatedAt).toBe(activatedAt);
  });

  it('skips a contract whose row is missing from the contract lookup (soft-deleted or otherwise gone)', async () => {
    queueLenses(
      [{ contract_id: 'c-1', activated_at: new Date(), financed: 10000, commission: 1000 }],
      [],
    );
    prisma.contract.findMany.mockResolvedValue([]); // e.g. deletedAt filter excluded it
    const result = await service.getPendingContracts();
    expect(result).toEqual([]);
  });
});

describe('IntercoPendingService.getReconcileTotals', () => {
  let service: IntercoPendingService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      interCoSettlementItem: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [IntercoPendingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(IntercoPendingService);
  });

  it('computes drift = pendingTotal − glFinanceTotal', async () => {
    // Call order: getPendingContracts() → [finance rows, shop rows], then
    // getReconcileTotals' own 2 whole-account queries: [finance total, shop total].
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { contract_id: 'c-1', activated_at: new Date(), financed: 10000, commission: 1000 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ balance: 12000 }]) // glFinanceTotal (includes a stray JE the lens missed)
      .mockResolvedValueOnce([{ balance: 9000 }]); // glShopTotal
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);

    const totals = await service.getReconcileTotals();
    expect(totals.pendingTotal.toNumber()).toBe(11000);
    expect(totals.glFinanceTotal.toNumber()).toBe(12000);
    expect(totals.glShopTotal.toNumber()).toBe(9000);
    expect(totals.drift.toNumber()).toBe(11000 - 12000);
  });

  it('whole-account GL queries do not filter by metadata.contractId (unlike the pending lens)', async () => {
    // getPendingContracts() short-circuits after an empty FINANCE lens (no
    // SHOP-lens call), so only 3 total $queryRaw calls happen here — grab the
    // LAST TWO (the whole-account totals) rather than hardcoding an index,
    // since that count is an internal implementation detail of
    // getPendingContracts, not part of this test's contract.
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // FINANCE lens (pending) — empty
      .mockResolvedValueOnce([{ balance: 0 }]) // glFinanceTotal
      .mockResolvedValueOnce([{ balance: 0 }]); // glShopTotal

    await service.getReconcileTotals();

    const calls = prisma.$queryRaw.mock.calls;
    expect(calls.length).toBe(3);
    const financeTotalSql = (calls[calls.length - 2][0] as unknown as string[]).join('');
    const shopTotalSql = (calls[calls.length - 1][0] as unknown as string[]).join('');
    expect(financeTotalSql).not.toContain('metadata');
    expect(shopTotalSql).not.toContain('metadata');
  });
});
