import { Decimal } from '@prisma/client/runtime/library';
import { Vat60dayMandatoryTemplate } from './cpa-templates/vat-60day-mandatory.template';

/**
 * Fast (mock-based, NO DB) golden for Vat60dayMandatoryTemplate — pins that the
 * vatPerInst it remits (Dr 11-2104 / Cr 21-2103) comes from the shared
 * computeInstallmentBreakdown and equals 99.17 for 17K/12M.
 * Mirrors the DB-backed vitest golden vat-60day-mandatory.template.spec.ts.
 */
describe('Vat60dayMandatoryTemplate.execute (golden · mock-based)', () => {
  const dec = (v: string | number) => new Decimal(v);

  const contract = {
    id: 'contract-v60m-1',
    contractNumber: 'CT-V60M-001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
  };
  const inst = {
    id: 'inst-v60m-1',
    installmentNo: 3,
    contractId: contract.id,
    vat60dayJournalEntryId: null as string | null,
  };

  it('posts Dr 11-2104 99.17 / Cr 21-2103 99.17 (vatPerInst from helper), metadata.vatPerInst 99.17', async () => {
    const createAndPost = jest.fn().mockResolvedValue({ id: 'je', entryNumber: 'JE-V60M-0001' });
    const tx = {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(inst),
        update: jest.fn().mockResolvedValue({}),
      },
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
    };
    const prisma = { $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)) };
    const tmpl = new Vat60dayMandatoryTemplate({ createAndPost } as never, prisma as never);

    await tmpl.execute(inst.id);
    const je = createAndPost.mock.calls[0][0] as {
      metadata: Record<string, unknown>;
      lines: Array<{ accountCode: string; dr: Decimal; cr: Decimal }>;
    };
    const dr11_2104 = je.lines.find((l) => l.accountCode === '11-2104')!;
    const cr21_2103 = je.lines.find((l) => l.accountCode === '21-2103')!;
    expect(dr11_2104.dr.toFixed(2)).toBe('99.17');
    expect(cr21_2103.cr.toFixed(2)).toBe('99.17');
    expect(je.metadata.vatPerInst).toBe('99.17');
    expect(je.metadata.tag).toBe('VAT60-MANDATORY');
  });
});
