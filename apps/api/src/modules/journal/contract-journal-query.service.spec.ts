import { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { ContractJournalQueryService } from './contract-journal-query.service';

/**
 * Unit spec for ContractJournalQueryService.listForContract — the read-side
 * query behind "บันทึกบัญชีของสัญญา" (spec 2026-09-05 §4.1).
 *
 * Locks:
 *   - 404 on missing / soft-deleted contract, and on cross-branch access by a
 *     branch-scoped role (same 404-not-403 convention as repossessions.findOne)
 *   - Query 1 is contractId-scoped ONLY — no tag / flow / companyId filter
 *   - Query 2 fetches reversal JEs via BOTH metadata.originalEntryId (receipt
 *     void) and metadata.reversesEntryId (sweep engine), skipped when Query 1
 *     is empty, and de-duplicated by id against Query 1
 *   - companyCode comes from the JE's company relation, unknown → null
 *   - result ordered by postedAt asc, then entryNumber
 */
describe('ContractJournalQueryService.listForContract', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);
  const line = (accountCode: string, debit: string, credit: string) => ({
    accountCode,
    debit: dec(debit),
    credit: dec(credit),
    description: null,
  });
  const entry = (over: Record<string, unknown>) => ({
    id: 'je-1',
    entryNumber: 'JE-202609-0001',
    entryDate: new Date('2026-09-01T00:00:00Z'),
    postedAt: new Date('2026-09-01T01:00:00Z'),
    description: 'x',
    metadata: { contractId: 'c-1', tag: 'JP5', flow: 'repossession' },
    company: { companyCode: 'FINANCE' },
    lines: [line('11-1201', '100', '0'), line('11-2101', '0', '100')],
    ...over,
  });

  const build = (o: {
    contract?: unknown;
    primary?: unknown[];
    reversals?: unknown[];
    coa?: unknown[];
  }) => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(o.primary ?? [])
      .mockResolvedValueOnce(o.reversals ?? []);
    const prisma = {
      contract: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            'contract' in o ? o.contract : { id: 'c-1', branchId: 'b-1', deletedAt: null },
          ),
      },
      journalEntry: { findMany },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue(o.coa ?? []) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { service: new ContractJournalQueryService(prisma as any), prisma, findMany };
  };

  const OWNER = { id: 'u', role: 'OWNER', branchId: null };
  const BM_SAME = { id: 'u', role: 'BRANCH_MANAGER', branchId: 'b-1' };
  const BM_OTHER = { id: 'u', role: 'BRANCH_MANAGER', branchId: 'b-2' };

  it('404 when the contract is missing or soft-deleted', async () => {
    await expect(build({ contract: null }).service.listForContract('c-x', OWNER)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      build({
        contract: { id: 'c-1', branchId: 'b-1', deletedAt: new Date() },
      }).service.listForContract('c-1', OWNER),
    ).rejects.toThrow(NotFoundException);
  });

  it('404 (not 403) for a branch-scoped role on another branch; same branch passes', async () => {
    await expect(build({}).service.listForContract('c-1', BM_OTHER)).rejects.toThrow(
      NotFoundException,
    );
    await expect(build({}).service.listForContract('c-1', BM_SAME)).resolves.toEqual([]);
  });

  it('Query 1 is scoped by metadata.contractId only — no tag/flow/companyId filter', async () => {
    const { service, findMany } = build({ primary: [entry({})] });
    await service.listForContract('c-1', OWNER);
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: 'POSTED',
      deletedAt: null,
      metadata: { path: ['contractId'], equals: 'c-1' },
    });
  });

  it('skips the reversal pass when Query 1 is empty', async () => {
    const { service, findMany } = build({ primary: [] });
    await service.listForContract('c-1', OWNER);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('Query 2 targets both originalEntryId and reversesEntryId of every primary id', async () => {
    const { service, findMany } = build({
      primary: [entry({ id: 'je-1' }), entry({ id: 'je-2', entryNumber: 'JE-202609-0002' })],
    });
    await service.listForContract('c-1', OWNER);
    expect(findMany.mock.calls[1][0].where).toEqual({
      status: 'POSTED',
      deletedAt: null,
      OR: [
        { metadata: { path: ['originalEntryId'], equals: 'je-1' } },
        { metadata: { path: ['reversesEntryId'], equals: 'je-1' } },
        { metadata: { path: ['originalEntryId'], equals: 'je-2' } },
        { metadata: { path: ['reversesEntryId'], equals: 'je-2' } },
      ],
    });
  });

  it('de-duplicates a reversal that also carries contractId, maps companyCode, sorts by postedAt', async () => {
    const primary = [
      entry({
        id: 'je-2',
        entryNumber: 'JE-202609-0002',
        postedAt: new Date('2026-09-03T00:00:00Z'),
      }),
      entry({
        id: 'je-1',
        entryNumber: 'JE-202609-0001',
        postedAt: new Date('2026-09-01T00:00:00Z'),
      }),
      entry({
        id: 'je-3',
        entryNumber: 'JE-202609-0003',
        postedAt: new Date('2026-09-02T00:00:00Z'),
        company: { companyCode: 'SHOP' },
        metadata: { contractId: 'c-1', tag: 'REVERSAL', reversesEntryId: 'je-1' },
      }),
    ];
    // Query 2 returns je-3 again (it carries contractId, so Query 1 already had it)
    const reversals = [
      primary[2],
      entry({
        id: 'je-4',
        entryNumber: 'JE-202609-0004',
        postedAt: new Date('2026-09-04T00:00:00Z'),
        company: null,
        metadata: { originalEntryId: 'je-2' },
      }),
    ];
    const { service } = build({
      primary,
      reversals,
      coa: [{ code: '11-1201', name: 'ธนาคาร KBank' }],
    });
    const rows = await service.listForContract('c-1', OWNER);
    expect(rows.map((r) => r.id)).toEqual(['je-1', 'je-3', 'je-2', 'je-4']);
    expect(rows.map((r) => r.companyCode)).toEqual(['FINANCE', 'SHOP', 'FINANCE', null]);
    expect(rows[0].lines[0]).toEqual({
      accountCode: '11-1201',
      accountName: 'ธนาคาร KBank',
      debit: '100.00',
      credit: '0.00',
      description: '',
    });
    expect(rows[0].isBalanced).toBe(true);
  });
});
