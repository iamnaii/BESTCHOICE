import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { EarlyPayoffJP4Template } from './cpa-templates/early-payoff-jp4.template';

/**
 * Fast (mock-based, NO DB) golden for EarlyPayoffJP4Template.execute().
 *
 * The canonical CPA golden for JP4 is the DB-backed vitest suite
 * early-payoff-jp4.template.spec.ts (case-4: 17K/12M · 6 unpaid · 50% discount →
 * settlement 7,594.98 · totalDr 12,690.00). That suite needs a live Postgres and
 * cannot run in every environment. This jest spec mirrors its assertions on the
 * SAME case-4 fixture so the template's posted JE is guarded by the standard
 * `npm run test --workspace=apps/api` run too — important now that the template
 * delegates its math to the shared computeEarlyPayoffJE.
 */
describe('EarlyPayoffJP4Template.execute (case-4 golden · mock-based)', () => {
  const dec = (v: string | number) => new Decimal(v);

  // case-4 contract: financed 10000 + commission 1000 + interest 6000 = 17000
  // grossExclVat; vat 1190; totalMonths 12.
  const contract = {
    id: 'contract-jp4-1',
    contractNumber: 'CT-JP4-001',
    totalMonths: 12,
    financedAmount: dec('10000'),
    storeCommission: dec('1000'),
    interestTotal: dec('6000'),
    vatAmount: dec('1190'),
  };

  // 12 installment schedules; first 6 covered by a PAID Payment row → 6 unpaid.
  const installments = Array.from({ length: 12 }, (_, i) => ({
    id: `inst-${i + 1}`,
    installmentNo: i + 1,
    dueDate: new Date('2026-01-01'),
    amountDue: dec('1515.83'),
    vat60dayJournalEntryId: null as string | null,
  }));
  const paidPayments = Array.from({ length: 6 }, (_, i) => ({ installmentNo: i + 1 }));

  type CapturedLine = { accountCode: string; dr: Decimal; cr: Decimal; description?: string };
  type CapturedJe = { description: string; reference?: string; metadata?: Record<string, unknown>; lines: CapturedLine[] };

  let createAndPost: jest.Mock;
  let tmpl: EarlyPayoffJP4Template;

  const build = () => {
    createAndPost = jest.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-JP4-0001' });
    const tx = {
      payment: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
      installmentSchedule: { findMany: jest.fn().mockResolvedValue(installments) },
      payment: { findMany: jest.fn().mockResolvedValue(paidPayments) },
      $transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const journal = { createAndPost } as unknown;
    const vat60Reversal = { execute: jest.fn() } as unknown;
    tmpl = new EarlyPayoffJP4Template(
      journal as never,
      prisma as never,
      vat60Reversal as never,
    );
  };

  const run = async (interestDiscountPercent: string) => {
    await tmpl.execute({
      contractId: contract.id,
      depositAccountCode: '11-1101',
      interestDiscountPercent: new Prisma.Decimal(interestDiscountPercent),
    });
    return createAndPost.mock.calls[0][0] as CapturedJe;
  };
  const lineFor = (je: CapturedJe, code: string) => je.lines.find((l) => l.accountCode === code);

  beforeEach(build);

  it('50% discount → 8 lines, case-4 golden amounts, balanced 12,690.00 (Policy A)', async () => {
    const je = await run('50');

    expect(je.lines.map((l) => l.accountCode)).toEqual([
      '11-1101', '11-2106', '21-2102', '52-1106', '11-2101', '11-2105', '41-1101', '21-2101',
    ]);
    expect(lineFor(je, '11-1101')!.dr.toFixed(2)).toBe('7594.98'); // settlement
    expect(lineFor(je, '11-2106')!.dr.toFixed(2)).toBe('3000.00');
    expect(lineFor(je, '21-2102')!.dr.toFixed(2)).toBe('595.02');
    expect(lineFor(je, '52-1106')!.dr.toFixed(2)).toBe('1500.00');
    expect(lineFor(je, '11-2101')!.cr.toFixed(2)).toBe('8499.96');
    expect(lineFor(je, '11-2105')!.cr.toFixed(2)).toBe('595.02');
    expect(lineFor(je, '41-1101')!.cr.toFixed(2)).toBe('3000.00');
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('595.02'); // Policy A — full deferred VAT

    const totalDr = je.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const totalCr = je.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    expect(totalDr.toFixed(2)).toBe('12690.00');
    expect(totalDr.toFixed(2)).toBe(totalCr.toFixed(2));

    const meta = je.metadata as Record<string, string>;
    expect(meta.policy).toBe('A');
    expect(meta.settleVat).toBe('595.02');
    expect(meta.discount).toBe('1500.00');
    expect(meta.vatCreditBackOnDiscount).toBeUndefined();
  });

  it('zero discount → omits 52-1106 (7 lines), cash 9094.98, Cr 21-2101 still full', async () => {
    const je = await run('0');
    expect(lineFor(je, '52-1106')).toBeUndefined();
    expect(je.lines).toHaveLength(7);
    expect(lineFor(je, '11-1101')!.dr.toFixed(2)).toBe('9094.98'); // 8499.96 + 595.02
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('595.02');
  });

  it('100% discount → discount 3000.00, cash 6094.98, Cr 21-2101 still full (Policy A)', async () => {
    const je = await run('100');
    expect(lineFor(je, '52-1106')!.dr.toFixed(2)).toBe('3000.00');
    expect(lineFor(je, '11-1101')!.dr.toFixed(2)).toBe('6094.98'); // 8499.96 - 3000 + 595.02
    expect(lineFor(je, '21-2101')!.cr.toFixed(2)).toBe('595.02');
  });
});
