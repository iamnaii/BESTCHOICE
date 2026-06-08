jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));

import { Decimal } from '@prisma/client/runtime/library';
import { Vat60dayReversalTemplate } from './cpa-templates/vat-60day-reversal.template';

/**
 * Fast (mock-based, NO DB) golden for Vat60dayReversalTemplate's LEGACY FALLBACK
 * path — when the mandatory JE has no persisted vatPerInst, the reversal
 * recomputes it via the shared computeInstallmentBreakdown (99.17 for 17K/12M)
 * and posts Dr 21-2103 / Cr 11-2104. Mirrors the DB-backed vitest golden.
 */
describe('Vat60dayReversalTemplate.execute (legacy-fallback golden · mock-based)', () => {
  const dec = (v: string | number) => new Decimal(v);

  const contract = {
    id: 'contract-v60r-1',
    contractNumber: 'CT-V60R-001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
  };
  const inst = {
    id: 'inst-v60r-1',
    installmentNo: 3,
    contractId: contract.id,
    vat60dayJournalEntryId: 'JE-MAND-1',
  };

  it('fallback (no persisted vatPerInst) → recompute 99.17 via helper; Dr 21-2103 / Cr 11-2104', async () => {
    const createAndPost = jest.fn().mockResolvedValue({ id: 'je', entryNumber: 'JE-V60R-0001' });
    const tx = {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(inst),
        update: jest.fn().mockResolvedValue({}),
      },
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
      // mandatory JE metadata WITHOUT vatPerInst → triggers the recompute fallback
      journalEntry: { findUnique: jest.fn().mockResolvedValue({ metadata: {} }) },
    };
    const prisma = { $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)) };
    const tmpl = new Vat60dayReversalTemplate({ createAndPost } as never, prisma as never);

    await tmpl.execute(inst.id);
    const je = createAndPost.mock.calls[0][0] as {
      metadata: Record<string, unknown>;
      lines: Array<{ accountCode: string; dr: Decimal; cr: Decimal }>;
    };
    expect(je.lines.find((l) => l.accountCode === '21-2103')!.dr.toFixed(2)).toBe('99.17');
    expect(je.lines.find((l) => l.accountCode === '11-2104')!.cr.toFixed(2)).toBe('99.17');
    expect(je.metadata.tag).toBe('VAT60-REVERSAL');
  });
});
