import { Decimal } from '@prisma/client/runtime/library';
import { InstallmentAccrual2ATemplate } from './cpa-templates/installment-accrual-2a.template';

/**
 * Fast (mock-based, NO DB) golden for InstallmentAccrual2ATemplate — pins that
 * the per-installment legs come from the shared computeInstallmentBreakdown
 * (1416.66 / 500.00 / 99.17 for 17K/12M) AND that the LAST-installment residual
 * true-up still absorbs the rounding remainder (1416.74 / 99.13 / 500.00).
 *
 * Mirrors the DB-backed vitest golden installment-accrual-2a.template.spec.ts.
 */
describe('InstallmentAccrual2ATemplate.execute (golden · mock-based)', () => {
  const dec = (v: string | number) => new Decimal(v);

  const contract = {
    id: 'contract-2a-1',
    contractNumber: 'CT-2A-001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
    advanceBalance: dec('0'), // skip the advance-consume sub-flow
  };

  type CapturedLine = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type CapturedJe = { metadata?: Record<string, unknown>; lines: CapturedLine[] };

  let createAndPost: jest.Mock;
  let tmpl: InstallmentAccrual2ATemplate;

  const buildFor = (installmentNo: number) => {
    createAndPost = jest.fn().mockResolvedValue({ id: 'je-2a', entryNumber: 'JE-2A-0001' });
    const inst = {
      id: `inst-2a-${installmentNo}`,
      installmentNo,
      contractId: contract.id,
      dueDate: new Date('2026-01-01'),
      accrualJournalEntryId: null as string | null,
    };
    const prisma = {
      installmentSchedule: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(inst),
        update: jest.fn().mockResolvedValue({}),
      },
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
    };
    const journal = { createAndPost } as unknown;
    tmpl = new InstallmentAccrual2ATemplate(journal as never, prisma as never);
    return inst;
  };

  const run = async (installmentNo: number) => {
    const inst = buildFor(installmentNo);
    await tmpl.execute(inst.id);
    return createAndPost.mock.calls[0][0] as CapturedJe;
  };
  const lineFor = (je: CapturedJe, code: string) => je.lines.find((l) => l.accountCode === code);
  const balanced = (je: CapturedJe) => {
    const dr = je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const cr = je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    return dr.toFixed(2) === cr.toFixed(2);
  };

  it('normal installment → base legs 1416.66 / 500.00 / 99.17 (installmentTotal 1515.83)', async () => {
    const je = await run(1);
    expect(lineFor(je, '11-2103')!.dr.toFixed(2)).toBe('1515.83'); // installmentTotal
    expect(lineFor(je, '21-2102')!.dr.toFixed(2)).toBe('99.17');
    expect(lineFor(je, '11-2106')!.dr.toFixed(2)).toBe('500.00');
    expect(lineFor(je, '11-2101')!.cr.toFixed(2)).toBe('1416.66');
    expect(lineFor(je, '11-2105')!.cr.toFixed(2)).toBe('99.17');
    expect(lineFor(je, '41-1101')!.cr.toFixed(2)).toBe('500.00');
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('99.17');
    expect(balanced(je)).toBe(true);
    expect((je.metadata as Record<string, string>).tag).toBe('2A');
  });

  it('LAST installment → residual true-up: 1416.74 / 99.13 / 500.00 (installmentTotal 1515.87)', async () => {
    const je = await run(12);
    // installmentExclVat = 17000 − 1416.66×11 = 1416.74
    expect(lineFor(je, '11-2101')!.cr.toFixed(2)).toBe('1416.74');
    // vatPerInst = 1190 − 99.17×11 = 99.13
    expect(lineFor(je, '21-2102')!.dr.toFixed(2)).toBe('99.13');
    expect(lineFor(je, '11-2105')!.cr.toFixed(2)).toBe('99.13');
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('99.13');
    // interestPerInst = 6000 − 500×11 = 500.00
    expect(lineFor(je, '41-1101')!.cr.toFixed(2)).toBe('500.00');
    expect(lineFor(je, '11-2106')!.dr.toFixed(2)).toBe('500.00');
    // installmentTotal = 1416.74 + 99.13 = 1515.87
    expect(lineFor(je, '11-2103')!.dr.toFixed(2)).toBe('1515.87');
    expect(balanced(je)).toBe(true);
  });
});
