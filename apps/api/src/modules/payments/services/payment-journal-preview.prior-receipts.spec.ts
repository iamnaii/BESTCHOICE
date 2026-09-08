import { Prisma } from '@prisma/client';
import { PaymentJournalPreviewService } from './payment-journal-preview.service';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('payment preview after an earlier receipt', () => {
  function makeService(advanceBalance = 0, principalCleared = 3079, amountPaid = 3179) {
    const prisma = {
      installmentSchedule: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'installment-2',
          installmentNo: 2,
          dueDate: new Date('2026-08-26T10:00:00Z'),
          accrualJournalEntryId: 'JE-2A',
          contract: {
            totalMonths: 10,
            financedAmount: D(29900),
            storeCommission: D(2990),
            interestTotal: D(23920),
            vatAmount: D('3976.70'),
            monthlyPayment: D(6079),
            advanceBalance: D(advanceBalance),
            rescheduleAdvanceBalance: D(0),
          },
        }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue({ amountDue: D(6079), amountPaid: D(amountPaid) }),
      },
      journalEntry: {
        findMany: jest.fn().mockImplementation((args) => Promise.resolve(args.where.AND ? [{
          metadata: { tag: 'receipt' },
          lines: [
            { accountCode: '11-1101', debit: D(amountPaid), credit: D(0) },
            { accountCode: '11-2103', debit: D(0), credit: D(principalCleared) },
            { accountCode: '42-1103', debit: D(0), credit: D(100) },
          ],
        }] : [])),
      },
      chartOfAccount: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return new PaymentJournalPreviewService(prisma as never, undefined);
  }

  const input = {
    contractId: 'contract', installmentNo: 2, amountReceived: 3000,
    depositAccountCode: '11-1101', lateFee: 100, case: 'NORMAL',
  };

  it('closes the remaining 3,000 without rebooking the prior 3,179 or its fee', async () => {
    const result = await makeService().previewJournal(input);
    expect(result.lines.map(({ accountCode, debit, credit }) => ({ accountCode, debit, credit })))
      .toEqual([
        { accountCode: '11-1101', debit: '3000.00', credit: '0.00' },
        { accountCode: '11-2103', debit: '0.00', credit: '2999.67' },
        { accountCode: '53-1503', debit: '0.00', credit: '0.33' },
      ]);
    expect(result.subtotals['2B']).toMatchObject({ debit: '3000.00', credit: '3000.00', balanced: true });
    expect(result.isBalanced).toBe(true);
  });

  it('leaves advance untouched when cash covers the billed remainder', async () => {
    const result = await makeService(500).previewJournal(input);
    expect(result.lines.find(l => l.accountCode === '21-1103')).toBeUndefined();
    expect(result.isBalanced).toBe(true);
  });

  it.each(['NORMAL', 'UNDERPAY', 'OVERPAY'])('consumes only the billed gap and keeps rounding (%s)', async (paymentCase) => {
    const result = await makeService(500).previewJournal({ ...input, amountReceived: 2900, case: paymentCase });
    expect(result.lines.find(l => l.accountCode === '21-1103')?.debit).toBe('100.00');
    expect(result.lines.find(l => l.accountCode === '53-1503')?.credit).toBe('0.33');
    expect(result.lines.find(l => l.accountCode === '42-1103')).toBeUndefined();
    expect(result.isBalanced).toBe(true);
  });

  it('parks only the surplus over the billed remainder, with ledger rounding separate', async () => {
    const result = await makeService().previewJournal({ ...input, amountReceived: 3050, case: 'OVERPAY_ADVANCE' });
    expect(result.lines.find(l => l.accountCode === '21-1103')?.credit).toBe('50.00');
    expect(result.lines.find(l => l.accountCode === '53-1503')?.credit).toBe('0.33');
    expect(result.isBalanced).toBe(true);
  });

  it('books only a fee increase after the earlier fee was collected', async () => {
    const result = await makeService().previewJournal({ ...input, amountReceived: 3050, lateFee: 150 });
    expect(result.lines.find(l => l.accountCode === '42-1103')?.credit).toBe('50.00');
    expect(result.isBalanced).toBe(true);
  });

  it('includes the current waiver while netting the previously booked fee', async () => {
    const result = await makeService().previewJournal({ ...input, amountReceived: 3050, lateFee: 200, lateFeeWaived: 50 });
    expect(result.lines.find(l => l.accountCode === '42-1103')?.credit).toBe('100.00');
    expect(result.lines.find(l => l.accountCode === '52-1105')?.debit).toBe('50.00');
    expect(result.totalDebit).toBe('3100.00');
    expect(result.totalCredit).toBe('3100.00');
  });

  it('does not allow a normal receipt with a shortage beyond tolerance', async () => {
    await expect(makeService().previewJournal({ ...input, amountReceived: 2000 }))
      .rejects.toThrow(/PARTIAL/);
  });

  it.each([[2998.80, 0], [2998.30, 0.50]])('rejects a billed shortage over one baht even if the ledger gap is smaller (%s)', async (amountReceived, advance) => {
    await expect(makeService(advance).previewJournal({ ...input, amountReceived }))
      .rejects.toThrow(/PARTIAL/);
  });

  it('uses fee-first allocation when a small final receipt cannot cover all of a new fee', async () => {
    const result = await makeService(0, 6078.57, 6178.57).previewJournal({
      ...input, amountReceived: 99.50, lateFee: 200,
    });
    expect(result.lines.find(l => l.accountCode === '42-1103')?.credit).toBe('99.50');
    expect(result.lines.find(l => l.accountCode === '11-2103')?.credit).toBe('0.10');
    expect(result.lines.find(l => l.accountCode === '52-1104')?.debit).toBe('0.10');
    expect(result.totalDebit).toBe('99.60');
    expect(result.totalCredit).toBe('99.60');
  });

  it('keeps subsequent partial receipts fee-free', async () => {
    const result = await makeService().previewJournal({ ...input, amountReceived: 500, case: 'PARTIAL' });
    expect(result.lines.find(l => l.accountCode === '11-2103')?.credit).toBe('500.00');
    expect(result.lines.find(l => l.accountCode === '42-1103')).toBeUndefined();
    expect(result.isBalanced).toBe(true);
  });
});
