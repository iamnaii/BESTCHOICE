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

  /**
   * Service $queryRaw order in getPendingContracts: FINANCE lens → SHOP lens
   * → SWAP_CREDIT lens (11-2107) → shop-buyback lens (S21-3001, Phase 2).
   */
  const queueLenses = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    financeRows: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shopRows: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    swapCreditRows: any[] = [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shopBuybackRows: any[] = [],
  ) => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw
      .mockResolvedValueOnce(financeRows)
      .mockResolvedValueOnce(shopRows)
      .mockResolvedValueOnce(swapCreditRows)
      .mockResolvedValueOnce(shopBuybackRows);
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

  describe('swapCreditGl / shopBuybackPayableGl / swapCreditEligible (Phase 2)', () => {
    const financeRow = [
      { contract_id: 'c-1', activated_at: new Date(), financed: 10000, commission: 1000 },
    ];
    const lookupC1 = () =>
      prisma.contract.findMany.mockResolvedValue([
        { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
      ]);

    it('eligible เมื่อทั้งสองสมุดมียอดและเท่ากัน', async () => {
      queueLenses(financeRow, [], [{ contract_id: 'c-1', credit: 8000 }], [
        { contract_id: 'c-1', payable: 8000 },
      ]);
      lookupC1();
      const [row] = await service.getPendingContracts();
      expect(row.swapCreditGl.toNumber()).toBe(8000);
      expect(row.shopBuybackPayableGl.toNumber()).toBe(8000);
      expect(row.swapCreditEligible).toBe(true);
    });

    it('ไม่ eligible เมื่อฝั่ง SHOP ไม่มียอด (swap ยุคก่อน Phase 1 — mixed-era spec §11.4)', async () => {
      queueLenses(financeRow, [], [{ contract_id: 'c-1', credit: 8000 }], []);
      lookupC1();
      const [row] = await service.getPendingContracts();
      expect(row.swapCreditGl.toNumber()).toBe(8000);
      expect(row.shopBuybackPayableGl.toNumber()).toBe(0);
      expect(row.swapCreditEligible).toBe(false);
    });

    it('tolerance ±0.01: ต่างกัน 0.01 พอดียัง eligible, เกินนั้นไม่', async () => {
      queueLenses(financeRow, [], [{ contract_id: 'c-1', credit: 8000 }], [
        { contract_id: 'c-1', payable: 7999.99 },
      ]);
      lookupC1();
      const [within] = await service.getPendingContracts();
      expect(within.swapCreditEligible).toBe(true);

      queueLenses(financeRow, [], [{ contract_id: 'c-1', credit: 8000 }], [
        { contract_id: 'c-1', payable: 7999.98 },
      ]);
      lookupC1();
      const [beyond] = await service.getPendingContracts();
      expect(beyond.swapCreditEligible).toBe(false);
    });

    it('เงื่อนไข SQL ของสองเลนส์ใหม่สอดคล้อง classifyShopReceivable (explicit stamp / flow fallback / newContractId key)', async () => {
      queueLenses(financeRow, [], [], []);
      lookupC1();
      await service.getPendingContracts();

      const swapSql = (prisma.$queryRaw.mock.calls[2][0] as unknown as string[]).join('');
      expect(swapSql).toContain('11-2107');
      expect(swapSql).toContain("je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'");
      expect(swapSql).toContain("je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107'");

      const buybackSql = (prisma.$queryRaw.mock.calls[3][0] as unknown as string[]).join('');
      expect(buybackSql).toContain('S21-3001');
      expect(buybackSql).toContain("je.metadata->>'newContractId'");
      expect(buybackSql).toContain("je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'");
      // ขา SWAP_CREDIT ฝั่ง SHOP ห้าม fallback ตาม flow (มี stamp ตั้งแต่ Phase 2 Task 1)
      expect(buybackSql).not.toContain("'shop-exchange-return'");
    });
  });
});

describe('IntercoPendingService.getPendingRecalls', () => {
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

  /** $queryRaw order: 11-2107 recall lens first, S21-3001 shop recall lens second. */
  const queueRecallLenses = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recallRows: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shopRecallRows: any[] = [],
  ) => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValueOnce(recallRows).mockResolvedValueOnce(shopRecallRows);
  };

  it('returns [] when the recall lens has no rows — no gate/lookup calls', async () => {
    queueRecallLenses([]);
    const result = await service.getPendingRecalls();
    expect(result).toEqual([]);
    expect(prisma.interCoSettlementItem.findMany).not.toHaveBeenCalled();
  });

  it('เงื่อนไข SQL: PAYOUT_RECALL explicit stamp เท่านั้น (ไม่มี flow fallback) ทั้งสองสมุด', async () => {
    queueRecallLenses(
      [{ contract_id: 'c-1', recall: 11000 }],
      [{ contract_id: 'c-1', recall: 11000 }],
    );
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);

    const [row] = await service.getPendingRecalls();
    expect(row.recallGl.toNumber()).toBe(11000);
    expect(row.shopRecallGl.toNumber()).toBe(11000);

    const financeSql = (prisma.$queryRaw.mock.calls[0][0] as unknown as string[]).join('');
    expect(financeSql).toContain('11-2107');
    expect(financeSql).toContain("je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'");
    expect(financeSql).not.toContain("'flow'");
    expect(financeSql).toContain('HAVING SUM(jl.debit - jl.credit) > 0');

    const shopSql = (prisma.$queryRaw.mock.calls[1][0] as unknown as string[]).join('');
    expect(shopSql).toContain('S21-3001');
    expect(shopSql).toContain("je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'");
    // ขา recall ฝั่ง SHOP key ด้วย contractId (ต่างจากขา SWAP_CREDIT ที่ใช้ newContractId)
    expect(shopSql).toContain("je.metadata->>'contractId'");
    expect(shopSql).not.toContain('newContractId');
  });

  it('settled gate กรอง itemType RECALL เท่านั้น — item SETTLEMENT เดิม (สัญญาเคยถูกจ่าย = นิยาม C-2) ต้องไม่บังคิว', async () => {
    queueRecallLenses([{ contract_id: 'c-1', recall: 11000 }], []);
    prisma.interCoSettlementItem.findMany.mockResolvedValue([{ contractId: 'c-1' }]);

    const result = await service.getPendingRecalls();
    expect(result).toEqual([]); // gated out by the mocked RECALL item

    const where = prisma.interCoSettlementItem.findMany.mock.calls[0][0].where;
    expect(where.itemType).toBe('RECALL');
    expect(where.batch.status.in).toEqual(['PENDING_APPROVAL', 'POSTED']);
    expect(where.batch.status.in).not.toContain('REVERSED');
    expect(where.batch.status.in).not.toContain('CANCELLED');
  });

  it('shopRecallGl default 0 เมื่อฝั่ง SHOP ไม่มีแถว (recall ยุคก่อน producer ฝั่ง SHOP)', async () => {
    queueRecallLenses([{ contract_id: 'c-1', recall: 11000 }], []);
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);
    const [row] = await service.getPendingRecalls();
    expect(row.shopRecallGl.toNumber()).toBe(0);
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

  it('computes drift = pendingTotal − glFinanceTotal (+ 3 typed whole-account totals ของ Phase 2)', async () => {
    // Call order: getPendingContracts() → [finance rows, shop rows, swap-credit
    // rows, shop-buyback rows], then getReconcileTotals' own 5 whole-account
    // queries: [finance total, shop total, swap-credit total, recall total,
    // shop-buyback total].
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { contract_id: 'c-1', activated_at: new Date(), financed: 10000, commission: 1000 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // swap-credit lens
      .mockResolvedValueOnce([]) // shop-buyback lens
      .mockResolvedValueOnce([{ balance: 12000 }]) // glFinanceTotal (includes a stray JE the lens missed)
      .mockResolvedValueOnce([{ balance: 9000 }]) // glShopTotal
      .mockResolvedValueOnce([{ balance: 16000 }]) // glSwapCreditTotal
      .mockResolvedValueOnce([{ balance: 22000 }]) // glRecallTotal
      .mockResolvedValueOnce([{ balance: 30000 }]); // glShopBuybackTotal
    prisma.contract.findMany.mockResolvedValue([
      { id: 'c-1', contractNumber: 'CT-0001', customer: { name: 'ลูกค้า A' } },
    ]);

    const totals = await service.getReconcileTotals();
    expect(totals.pendingTotal.toNumber()).toBe(11000);
    expect(totals.glFinanceTotal.toNumber()).toBe(12000);
    expect(totals.glShopTotal.toNumber()).toBe(9000);
    expect(totals.drift.toNumber()).toBe(11000 - 12000);
    expect(totals.glSwapCreditTotal.toNumber()).toBe(16000);
    expect(totals.glRecallTotal.toNumber()).toBe(22000);
    expect(totals.glShopBuybackTotal.toNumber()).toBe(30000);
  });

  it('whole-account GL queries: ยอดเดิมไม่กรอง metadata — ยอด typed ใหม่กรองเฉพาะ type (ไม่กรอง contractId)', async () => {
    // getPendingContracts() short-circuits after an empty FINANCE lens (no
    // further lens calls), so 6 total $queryRaw calls happen here: the empty
    // lens + the 5 whole-account totals.
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // FINANCE lens (pending) — empty
      .mockResolvedValueOnce([{ balance: 0 }]) // glFinanceTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glShopTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glSwapCreditTotal
      .mockResolvedValueOnce([{ balance: 0 }]) // glRecallTotal
      .mockResolvedValueOnce([{ balance: 0 }]); // glShopBuybackTotal

    await service.getReconcileTotals();

    const calls = prisma.$queryRaw.mock.calls;
    expect(calls.length).toBe(6);
    const sqlAt = (i: number) => (calls[i][0] as unknown as string[]).join('');

    // ยอดเดิม 2 ตัว — ไม่กรอง metadata ใดๆ (พฤติกรรมเดิม ห้ามขยับ)
    expect(sqlAt(1)).not.toContain('metadata');
    expect(sqlAt(2)).not.toContain('metadata');

    // ยอด typed ใหม่ — กรอง type แต่ต้องไม่กรอง contractId (ทั้งบัญชี)
    const swapSql = sqlAt(3);
    expect(swapSql).toContain("je.metadata->>'shopReceivableType' = 'SWAP_CREDIT'");
    expect(swapSql).toContain("je.metadata->>'flow' = 'exchange-buyback-receivable-11-2107'");
    expect(swapSql).not.toContain('contractId');
    const recallSql = sqlAt(4);
    expect(recallSql).toContain("je.metadata->>'shopReceivableType' = 'PAYOUT_RECALL'");
    expect(recallSql).not.toContain('contractId');
    // S21-3001 ทั้งบัญชี — ไม่กรอง type เลย
    expect(sqlAt(5)).toContain('S21-3001');
    expect(sqlAt(5)).not.toContain('metadata');
  });
});
