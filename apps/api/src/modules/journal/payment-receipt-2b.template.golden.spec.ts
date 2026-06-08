import { Decimal } from '@prisma/client/runtime/library';
import { PaymentReceipt2BTemplate } from './cpa-templates/payment-receipt-2b.template';

/**
 * Fast (mock-based, NO DB) golden for PaymentReceipt2BTemplate — pins that the
 * per-installment amount it clears (installmentTotal) is computed via the shared
 * computeInstallmentBreakdown and equals 1,515.83 for the 17K/12M contract.
 *
 * The canonical CPA golden is the DB-backed vitest suite
 * payment-receipt-2b.template.spec.ts (cases 1/2). That needs live Postgres;
 * this mirrors its installment-total assertion under plain `npm run test`.
 */
describe('PaymentReceipt2BTemplate.execute (installment-total golden · mock-based)', () => {
  const dec = (v: string | number) => new Decimal(v);

  // 17K/12M contract → installmentTotal = 1416.66 + 99.17 = 1515.83.
  const contract = {
    id: 'contract-2b-1',
    contractNumber: 'CT-2B-001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
  };
  const inst = {
    id: 'inst-2b-1',
    installmentNo: 1,
    dueDate: new Date('2026-01-01'),
    vat60dayJournalEntryId: null as string | null,
    contract,
  };

  type CapturedLine = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type CapturedJe = { metadata?: Record<string, unknown>; lines: CapturedLine[] };

  let createAndPost: jest.Mock;
  let tmpl: PaymentReceipt2BTemplate;

  const build = () => {
    createAndPost = jest.fn().mockResolvedValue({ id: 'je-2b', entryNumber: 'JE-2B-0001' });
    const tx = { payment: { create: jest.fn().mockResolvedValue({ id: 'pay-2b-1' }) } };
    const prisma = {
      installmentSchedule: { findUniqueOrThrow: jest.fn().mockResolvedValue(inst) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) }, // adj_auto_route → default TRUE
      $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const journal = { createAndPost } as unknown;
    tmpl = new PaymentReceipt2BTemplate(journal as never, prisma as never);
  };

  const lineFor = (je: CapturedJe, code: string) => je.lines.find((l) => l.accountCode === code);

  beforeEach(build);

  it('exact payment 1515.83 → Dr cash 1515.83 / Cr 11-2103 1515.83 (installmentTotal), balanced', async () => {
    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: dec('1515.83'),
      depositAccountCode: '11-1101',
    });
    const je = createAndPost.mock.calls[0][0] as CapturedJe;
    expect(lineFor(je, '11-1101')!.dr.toFixed(2)).toBe('1515.83');
    expect(lineFor(je, '11-2103')!.cr.toFixed(2)).toBe('1515.83'); // installmentTotal from helper
    const totalDr = je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const totalCr = je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
    expect((je.metadata as Record<string, string>).tag).toBe('2B');
  });

  it('overpay within tolerance 1516.00 → Cr 11-2103 1515.83 + Cr 53-1503 0.17', async () => {
    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: dec('1516.00'),
      depositAccountCode: '11-1101',
    });
    const je = createAndPost.mock.calls[0][0] as CapturedJe;
    expect(lineFor(je, '11-2103')!.cr.toFixed(2)).toBe('1515.83'); // still installmentTotal
    expect(lineFor(je, '53-1503')!.cr.toFixed(2)).toBe('0.17'); // rounding gain
    const totalDr = je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const totalCr = je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));
  });
});
