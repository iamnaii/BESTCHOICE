import { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { PaymentQueryService } from './payment-query.service';

/**
 * Unit spec for PaymentQueryService.getContractJournalEntries — the read-side
 * query behind the payment-history modal's per-receipt JE expansion.
 *
 * Locks:
 *   - 404 on missing/deleted contract
 *   - metadata soft-link extraction (paymentId / tag / flow / deltaApplied /
 *     lateFeePortion / reversed / reversedByEntryNumber / originalEntryId)
 *     with non-string values coerced to null
 *   - CoA name join with fallback-to-code for unmapped accounts
 *   - money emitted as .toFixed(2) STRINGS (never Number()) + Decimal-summed
 *     totals + isBalanced
 *   - where clause targets POSTED, non-deleted entries, contractId-scoped
 *     across five tags/flows (receipt / 2B / credit-allocation /
 *     overpayment-credit / early-payoff)
 *   - second-pass fetch of receipt-void REVERSAL JEs via metadata.originalEntryId
 *     (they carry NO contractId — unreachable through the first query)
 *   - deterministic Dr-before-Cr line order (JournalLine has no lineNo and a
 *     random-UUID id, so DB order is arbitrary)
 */
describe('PaymentQueryService.getContractJournalEntries', () => {
  const dec = (v: string | number) => new Prisma.Decimal(v);

  const buildService = (overrides: {
    contract?: unknown;
    entries?: unknown[];
    reversals?: unknown[];
    coa?: unknown[];
  }) => {
    const findMany = jest.fn();
    // First call = main contract-scoped query; second (when the first returned
    // rows) = the reversal pass keyed by originalEntryId.
    findMany
      .mockResolvedValueOnce(overrides.entries ?? [])
      .mockResolvedValueOnce(overrides.reversals ?? []);
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue(
          'contract' in overrides ? overrides.contract : { id: 'c-1', deletedAt: null },
        ),
      },
      journalEntry: { findMany },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue(overrides.coa ?? []) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { service: new PaymentQueryService(prisma as any), prisma };
  };

  it('throws NotFoundException when contract is missing or soft-deleted', async () => {
    const missing = buildService({ contract: null });
    await expect(missing.service.getContractJournalEntries('nope')).rejects.toThrow(
      NotFoundException,
    );

    const deleted = buildService({ contract: { id: 'c-1', deletedAt: new Date() } });
    await expect(deleted.service.getContractJournalEntries('c-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('scopes the query to POSTED non-deleted entries with contractId + tag/flow OR filters (and skips the reversal pass when empty)', async () => {
    const { service, prisma } = buildService({ entries: [] });
    await service.getContractJournalEntries('c-1');

    const where = prisma.journalEntry.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('POSTED');
    expect(where.deletedAt).toBeNull();
    // 5 OR branches: receipt / 2B / credit-allocation / overpayment-credit tags
    // + early-payoff flow, each ANDed with metadata.contractId.
    expect(where.OR).toHaveLength(5);
    for (const branch of where.OR) {
      expect(branch.AND[0]).toEqual({
        metadata: { path: ['contractId'], equals: 'c-1' },
      });
    }
    const keys = where.OR.map(
      (b: { AND: Array<{ metadata: { path: string[]; equals: string } }> }) =>
        `${b.AND[1].metadata.path[0]}:${b.AND[1].metadata.equals}`,
    );
    expect(keys).toEqual([
      'tag:receipt',
      'tag:2B',
      'tag:credit-allocation',
      'tag:overpayment-credit',
      'flow:early-payoff',
    ]);
    // No rows → no reversal query (only ONE findMany call).
    expect(prisma.journalEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('maps a receipt JE: metadata extraction, CoA names (fallback = code), string money, isBalanced', async () => {
    const { service } = buildService({
      entries: [
        {
          id: 'je-1',
          entryNumber: 'JE-202607-00001',
          entryDate: new Date('2026-07-01'),
          postedAt: new Date('2026-07-01'),
          description: 'รับชำระงวด #1',
          metadata: {
            tag: 'receipt',
            flow: 'payment-receipt',
            contractId: 'c-1',
            paymentId: 'pay-1',
            deltaApplied: '1854.55',
            lateFeePortion: '100.00',
          },
          lines: [
            { accountCode: '11-1101', debit: dec('1854.55'), credit: dec(0), description: 'รับเงิน' },
            { accountCode: '11-2101', debit: dec(0), credit: dec('1754.55'), description: null },
            { accountCode: '42-1103', debit: dec(0), credit: dec('100.00'), description: 'ค่าปรับ' },
          ],
        },
      ],
      coa: [
        { code: '11-1101', name: 'เงินสด — สุทธินีย์ คงเดช' },
        { code: '11-2101', name: 'ลูกหนี้ผ่อนชำระ' },
        // 42-1103 intentionally unmapped → fallback to code
      ],
    });

    const [je] = await service.getContractJournalEntries('c-1');

    expect(je.paymentId).toBe('pay-1');
    expect(je.tag).toBe('receipt');
    expect(je.flow).toBe('payment-receipt');
    expect(je.deltaApplied).toBe('1854.55');
    expect(je.lateFeePortion).toBe('100.00');
    expect(je.reversed).toBe(false);
    expect(je.reversedByEntryNumber).toBeNull();
    expect(je.originalEntryId).toBeNull();

    expect(je.lines[0]).toEqual({
      accountCode: '11-1101',
      accountName: 'เงินสด — สุทธินีย์ คงเดช',
      debit: '1854.55',
      credit: '0.00',
      description: 'รับเงิน',
    });
    // Unmapped CoA code falls back to the code itself; null description → ''.
    expect(je.lines[2].accountName).toBe('42-1103');
    expect(je.lines[1].description).toBe('');

    // Totals are Decimal-summed strings; 1854.55 = 1754.55 + 100.00 → balanced.
    expect(je.totalDebit).toBe('1854.55');
    expect(je.totalCredit).toBe('1854.55');
    expect(je.isBalanced).toBe(true);
  });

  it('orders lines Dr-before-Cr regardless of DB order (stable within each side)', async () => {
    const { service } = buildService({
      entries: [
        {
          id: 'je-order',
          entryNumber: 'JE-202607-00009',
          entryDate: new Date('2026-07-01'),
          postedAt: new Date('2026-07-01'),
          description: 'ordering',
          metadata: { tag: 'receipt', contractId: 'c-1', paymentId: 'pay-9' },
          // DB returns Cr lines FIRST (random UUID order) — mapper must flip.
          lines: [
            { accountCode: '11-2103', debit: dec(0), credit: dec('1416.66'), description: null },
            { accountCode: '42-1103', debit: dec(0), credit: dec('100.00'), description: null },
            { accountCode: '11-1101', debit: dec('1516.66'), credit: dec(0), description: null },
          ],
        },
      ],
      coa: [],
    });

    const [je] = await service.getContractJournalEntries('c-1');
    expect(je.lines.map((l: { accountCode: string }) => l.accountCode)).toEqual([
      '11-1101', // the Dr line surfaces first
      '11-2103', // Cr lines keep their relative order
      '42-1103',
    ]);
  });

  it('fetches receipt-void REVERSAL JEs by originalEntryId and surfaces the reversal trail', async () => {
    const { service, prisma } = buildService({
      entries: [
        {
          id: 'je-orig',
          entryNumber: 'JE-202607-00001',
          entryDate: new Date('2026-07-01'),
          postedAt: new Date('2026-07-01'),
          description: 'รับชำระงวด #1',
          metadata: {
            tag: 'receipt',
            contractId: 'c-1',
            paymentId: 'pay-1',
            reversed: true,
            reversedByEntryNumber: 'JE-202607-00002',
          },
          lines: [
            { accountCode: '11-1101', debit: dec('1000.00'), credit: dec(0), description: null },
            { accountCode: '11-2103', debit: dec(0), credit: dec('1000.00'), description: null },
          ],
        },
      ],
      reversals: [
        {
          id: 'je-rev',
          entryNumber: 'JE-202607-00002',
          entryDate: new Date('2026-07-02'),
          postedAt: new Date('2026-07-02'),
          description: '[VOID] รับชำระงวด #1',
          metadata: {
            tag: 'REVERSAL',
            flow: 'receipt-void',
            originalEntryId: 'je-orig',
            originalEntryNumber: 'JE-202607-00001',
          },
          lines: [
            { accountCode: '11-2103', debit: dec('1000.00'), credit: dec(0), description: null },
            { accountCode: '11-1101', debit: dec(0), credit: dec('1000.00'), description: null },
          ],
        },
      ],
      coa: [],
    });

    const jes = await service.getContractJournalEntries('c-1');
    expect(jes).toHaveLength(2);

    // Second query keyed by the first pass's entry ids.
    const revWhere = prisma.journalEntry.findMany.mock.calls[1][0].where;
    expect(revWhere.OR).toEqual([
      { metadata: { path: ['originalEntryId'], equals: 'je-orig' } },
    ]);

    const orig = jes.find((j: { id: string }) => j.id === 'je-orig');
    const rev = jes.find((j: { id: string }) => j.id === 'je-rev');
    // Original carries the reversed trail for the frontend badge.
    expect(orig?.reversed).toBe(true);
    expect(orig?.reversedByEntryNumber).toBe('JE-202607-00002');
    // Reversal points back for CREDIT_NOTE row matching; no paymentId of its own.
    expect(rev?.originalEntryId).toBe('je-orig');
    expect(rev?.flow).toBe('receipt-void');
    expect(rev?.paymentId).toBeNull();
  });

  it('maps an early-payoff JE (paymentId null via missing metadata key) and flags unbalanced totals', async () => {
    const { service } = buildService({
      entries: [
        {
          id: 'je-2',
          entryNumber: 'JE-202607-00002',
          entryDate: new Date('2026-07-02'),
          postedAt: null,
          description: 'ปิดยอดก่อนกำหนด',
          metadata: { tag: 'JP4', flow: 'early-payoff', contractId: 'c-1', discount: '50.00' },
          lines: [
            { accountCode: '11-1101', debit: dec('100.00'), credit: dec(0), description: null },
            { accountCode: '11-2101', debit: dec(0), credit: dec('99.99'), description: null },
          ],
        },
      ],
      coa: [],
    });

    const [je] = await service.getContractJournalEntries('c-1');

    expect(je.paymentId).toBeNull();
    expect(je.flow).toBe('early-payoff');
    expect(je.deltaApplied).toBeNull(); // absent key → null, not undefined/crash
    expect(je.totalDebit).toBe('100.00');
    expect(je.totalCredit).toBe('99.99');
    expect(je.isBalanced).toBe(false);
  });

  it('handles null metadata without crashing (all soft-link fields null)', async () => {
    const { service } = buildService({
      entries: [
        {
          id: 'je-3',
          entryNumber: 'JE-202607-00003',
          entryDate: new Date('2026-07-03'),
          postedAt: new Date('2026-07-03'),
          description: 'legacy row',
          metadata: null,
          lines: [],
        },
      ],
      coa: [],
    });

    const [je] = await service.getContractJournalEntries('c-1');
    expect(je.paymentId).toBeNull();
    expect(je.tag).toBeNull();
    expect(je.flow).toBeNull();
    expect(je.reversed).toBe(false);
    expect(je.lines).toEqual([]);
    expect(je.totalDebit).toBe('0.00');
    expect(je.isBalanced).toBe(true);
  });
});
