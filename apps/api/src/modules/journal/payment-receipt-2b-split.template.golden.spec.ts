import { Decimal } from '@prisma/client/runtime/library';
import { PaymentReceipt2BSplitTemplate } from './cpa-templates/payment-receipt-2b-split.template';

/**
 * Fast (mock-based, NO DB) golden for PaymentReceipt2BSplitTemplate — pins that
 * the final-partial close-out uses installmentTotal = 1,515.83 (via the shared
 * computeInstallmentBreakdown) for both the remaining-receivable and the
 * tolerance diff. Mirrors the DB-backed vitest golden
 * payment-receipt-2b-split.template.spec.ts (case 3).
 */
describe('PaymentReceipt2BSplitTemplate.executePartial (installment-total golden · mock-based)', () => {
  const dec = (v: string | number) => new Decimal(v);

  // 17K/12M contract → installmentTotal = 1515.83.
  const contract = {
    id: 'contract-split-1',
    contractNumber: 'CT-SPLIT-001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
  };
  const inst = {
    id: 'inst-split-1',
    installmentNo: 1,
    dueDate: new Date('2026-01-01'),
    contract,
  };

  type CapturedLine = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type CapturedJe = { metadata?: Record<string, unknown>; lines: CapturedLine[] };

  let createAndPost: jest.Mock;
  let priorEntries: Array<{ lines: Array<{ debit: string; credit: string }> }>;
  let tmpl: PaymentReceipt2BSplitTemplate;

  const build = () => {
    createAndPost = jest.fn().mockResolvedValue({ id: 'je-split', entryNumber: 'JE-SPLIT-0001' });
    const prisma = {
      installmentSchedule: { findUniqueOrThrow: jest.fn().mockResolvedValue(inst) },
      journalEntry: { findMany: jest.fn().mockResolvedValue(priorEntries) },
      payment: { create: jest.fn().mockResolvedValue({ id: 'pay-split-1' }) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) }, // adj_auto_route → TRUE
      $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(prisma)),
    };
    const journal = { createAndPost } as unknown;
    tmpl = new PaymentReceipt2BSplitTemplate(journal as never, prisma as never);
  };

  const lineFor = (je: CapturedJe, code: string) => je.lines.find((l) => l.accountCode === code);

  it('final partial (no prior) 1515.83 → Cr 11-2103 1515.83 (installmentTotal), balanced', async () => {
    priorEntries = [];
    build();
    await tmpl.executePartial({
      installmentScheduleId: inst.id,
      partialAmount: dec('1515.83'),
      depositAccountCode: '11-1101',
      isFinalPartial: true,
    });
    const je = createAndPost.mock.calls[0][0] as CapturedJe;
    expect(lineFor(je, '11-1101')!.dr.toFixed(2)).toBe('1515.83');
    expect(lineFor(je, '11-2103')!.cr.toFixed(2)).toBe('1515.83');
    const totalDr = je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const totalCr = je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });

  it('final partial after a 1000 prior → remainingReceivable 515.83 = installmentTotal − prior', async () => {
    // Prior non-final partial JE with a 1000.00 cash debit line.
    priorEntries = [{ lines: [{ debit: '1000.00', credit: '0' }, { debit: '0', credit: '1000.00' }] }];
    build();
    await tmpl.executePartial({
      installmentScheduleId: inst.id,
      partialAmount: dec('516.00'), // grandTotal 1516.00 → overpay 0.17
      depositAccountCode: '11-1101',
      isFinalPartial: true,
    });
    const je = createAndPost.mock.calls[0][0] as CapturedJe;
    expect(lineFor(je, '11-1101')!.dr.toFixed(2)).toBe('516.00');
    expect(lineFor(je, '11-2103')!.cr.toFixed(2)).toBe('515.83'); // 1515.83 − 1000.00
    expect(lineFor(je, '53-1503')!.cr.toFixed(2)).toBe('0.17'); // 1516.00 − 1515.83
    const totalDr = je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const totalCr = je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });
});
