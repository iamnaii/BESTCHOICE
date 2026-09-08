import { Prisma } from '@prisma/client';
import { attachReceiptPaymentHistory } from './receipt-payment-history';
const dec = (value: string) => new Prisma.Decimal(value);
const date = new Date('2026-09-08T08:00:00Z');
function fixture(options: { variant?: '6a' | '6b'; fee?: string; source?: boolean } = {}) {
  const variant = options.variant ?? '6b',
    fee = options.fee ?? '0';
  const amount = dec(variant === '6a' ? '1044' : '5516').plus(fee);
  const receipt = {
    id: 'r1',
    paymentId: 'p1',
    contractId: 'c1',
    receiptType: variant === '6a' ? 'RESCHEDULE_FEE' : 'INSTALLMENT',
    amount,
    paidDate: date,
    createdAt: date,
    isVoided: false,
    sourceJournalEntryId: options.source === false ? null : 'j1',
    installmentNo: 4,
    transactionRef: null,
    issuedById: 'staff',
    paymentStatus: 'PAID',
    installmentPartialSeq: null,
    cnSource: null,
  };
  const entry = {
    id: 'j1',
    entryNumber: 'JE-1',
    postedAt: date,
    metadata: {
      paymentId: 'p1',
      contractId: 'c1',
      tag: variant === '6a' ? 'reschedule-collect' : 'receipt',
      deltaApplied: amount.toString(),
      rescheduleFee: '1044',
      lateFeeCollected: fee,
    },
    lines: [
      { accountCode: '11-1101', debit: amount, credit: dec('0') },
      { accountCode: '11-2103', debit: dec('0'), credit: dec(variant === '6a' ? '0' : '4472') },
      { accountCode: '21-1103', debit: dec('0'), credit: dec('1044') },
      { accountCode: '42-1103', debit: dec('0'), credit: dec(fee) },
    ],
  };
  const audit = (
    id: string,
    action: string,
    entityId: string,
    newValue: Record<string, unknown>,
  ) => ({ id, action, entityId, userId: 'staff', createdAt: date, newValue });
  const audits = [
    audit('collect', 'RESCHEDULE_COLLECT', 'p1', {
      contractId: 'c1',
      installmentNo: 4,
      variant,
      bundledPaid: variant === '6b',
      collectAmount: amount.toString(),
      rescheduleFee: '1044',
      daysToShift: 7,
      transactionRef: null,
      journalEntryNo: variant === '6a' ? 'JE-1' : null,
    }),
    audit(
      'park',
      variant === '6a' ? 'OVERPAY_ADVANCE_RECORDED' : 'RESCHEDULE_ADVANCE_PARKED',
      'c1',
      {
        paymentId: 'p1',
        sweptAmount: '1044',
        advanceCredit: '1044',
        source: variant === '6a' ? 'RESCHEDULE_COLLECT_6A_FEE' : 'RESCHEDULE_COLLECT_6B_FEE_SWEEP',
      },
    ),
    audit('shift', 'RESCHEDULE', 'c1', {
      variant,
      rescheduleFee: '1044.00',
      daysToShift: 7,
      fromInstallmentNo: variant === '6a' ? 4 : 5,
      firstShiftedInstallmentNo: variant === '6a' ? 4 : 5,
      shiftedInstallmentCount: variant === '6a' ? 7 : 6,
    }),
  ];
  const db = {
    contract: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', totalMonths: 10 }]) },
    installmentSchedule: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          Array.from({ length: 10 }, (_, i) => ({ contractId: 'c1', installmentNo: i + 1 })),
        ),
    },
    receipt: { findMany: jest.fn().mockResolvedValue([receipt]) },
    journalEntry: { findMany: jest.fn().mockResolvedValue([entry]) },
    auditLog: { findMany: jest.fn().mockResolvedValue(audits) },
  };
  return { receipt, entry, audits, db };
}
const read = (f: ReturnType<typeof fixture>) =>
  attachReceiptPaymentHistory(f.db as never, [f.receipt]);

describe('receipt action and installment allocation history', () => {
  it('legacy 6a on installment 5 of 12 points its 1714 advance to installment 12', async () => {
    const f = fixture({ variant: '6a', source: false });
    f.receipt.installmentNo = 5;
    f.receipt.amount = dec('1714');
    f.entry.metadata.rescheduleFee = '1714';
    f.entry.lines = [
      { accountCode: '11-1101', debit: dec('1714'), credit: dec('0') },
      { accountCode: '21-1103', debit: dec('0'), credit: dec('1714') },
    ];
    Object.assign(f.audits[0].newValue, { installmentNo: 5, collectAmount: '1714', rescheduleFee: '1714', daysToShift: 14 });
    Object.assign(f.audits[1].newValue, { advanceCredit: '1714' });
    Object.assign(f.audits[2].newValue, { fromInstallmentNo: 5, firstShiftedInstallmentNo: 5, shiftedInstallmentCount: 8, rescheduleFee: '1714', daysToShift: 14 });
    f.db.contract.findMany.mockResolvedValue([{ id: 'c1', totalMonths: 12 }]);
    f.db.installmentSchedule.findMany.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ contractId: 'c1', installmentNo: i + 1 })));
    expect((await read(f))[0]).toMatchObject({
      paymentCase: 'RESCHEDULE',
      installmentAllocations: [{ installmentNo: 12, amount: '1714.00', kind: 'RESCHEDULE_ADVANCE' }],
    });
  });

  it('6b: allocates only this 5516 receipt as current installment 4=4472 and last installment 10=1044', async () => {
    const f = fixture();
    expect((await read(f))[0]).toMatchObject({
      amount: dec('5516'),
      paymentCase: 'RESCHEDULE',
      installmentAllocations: [
        { installmentNo: 4, amount: '4472.00', kind: 'INSTALLMENT' },
        { installmentNo: 10, amount: '1044.00', kind: 'RESCHEDULE_ADVANCE' },
      ],
    });
  });
  it('subtracts actual bundled late fee from the installment allocation', async () => {
    const f = fixture({ fee: '100' });
    expect((await read(f))[0]).toMatchObject({
      amount: dec('5616'),
      installmentAllocations: [
        { installmentNo: 4, amount: '4472.00', kind: 'INSTALLMENT' },
        { installmentNo: 10, amount: '1044.00', kind: 'RESCHEDULE_ADVANCE' },
      ],
    });
  });
  it('6a: a fee-first receipt allocates its advance only to the last installment, excluding the late fee', async () => {
    const f = fixture({ variant: '6a', fee: '100' });
    expect((await read(f))[0]).toMatchObject({
      paymentCase: 'RESCHEDULE',
      installmentAllocations: [
        { installmentNo: 10, amount: '1044.00', kind: 'RESCHEDULE_ADVANCE' },
      ],
    });
  });
  it.each(['6a', '6b'] as const)(
    'matches a unique legacy %s source without assigning a contract balance',
    async (variant) => {
      const f = fixture({ variant, source: false });
      expect((await read(f))[0].installmentAllocations?.at(-1)).toEqual({
        installmentNo: 10,
        amount: '1044.00',
        kind: 'RESCHEDULE_ADVANCE',
      });
    },
  );
  it('leaves repeated legacy receipt/source amounts unresolved even when reading one receipt', async () => {
    const f = fixture({ source: false });
    f.db.receipt.findMany.mockResolvedValue([f.receipt, { ...f.receipt, id: 'r2' }]);
    expect((await read(f))[0]).toMatchObject({ paymentCase: null, installmentAllocations: null });
  });
  it('matches a uniquely identified 6b phase-2 retry on another day by another cashier', async () => {
    const f = fixture();
    for (const audit of f.audits) {
      audit.userId = 'retry-cashier';
      audit.createdAt = new Date('2026-09-09T01:00:00Z');
    }
    expect((await read(f))[0]).toMatchObject({
      paymentCase: 'RESCHEDULE',
      installmentAllocations: [
        { installmentNo: 4, amount: '4472.00', kind: 'INSTALLMENT' },
        { installmentNo: 10, amount: '1044.00', kind: 'RESCHEDULE_ADVANCE' },
      ],
    });
  });
  it('does not label unmatched reschedule evidence as a generic overpayment', async () => {
    const f = fixture();
    f.audits[0].newValue.transactionRef = 'unmatched-reference';
    expect((await read(f))[0]).toMatchObject({ paymentCase: null, installmentAllocations: null });
  });
  it('reports the matched 6a late fee separately so allocations plus fees equal receipt cash', async () => {
    const f = fixture({ variant: '6a', fee: '100' });
    const [row] = await read(f);
    expect(row.lateFeeCollected).toBe('100.00');
    expect(row.lateFeeWaivedThisReceipt).toBe('0.00');
    const allocated = row.installmentAllocations!.reduce(
      (sum, item) => sum.plus(item.amount),
      dec('0'),
    );
    expect(allocated.plus(row.lateFeeCollected!).eq(row.amount)).toBe(true);
  });
  it('does not treat a generic overpayment as rescheduling without collect audit evidence', async () => {
    const f = fixture();
    f.db.auditLog.findMany.mockResolvedValue([]);
    expect((await read(f))[0]).toMatchObject({
      paymentCase: 'OVERPAY_ADVANCE',
      receiptAdvanceAmount: '1044.00',
      installmentAllocations: null,
    });
  });
  it('returns unknown for duplicate reschedule collect evidence and does not borrow one event twice', async () => {
    const f = fixture();
    f.audits.push({ ...f.audits[0], id: 'another-collect' });
    expect((await read(f))[0]).toMatchObject({ paymentCase: null, installmentAllocations: null });
  });
  it('keeps the reschedule action but refuses allocation if actual park sweep differs or last target is ambiguous', async () => {
    const f = fixture();
    f.audits[1].newValue.sweptAmount = '500';
    expect((await read(f))[0]).toMatchObject({
      paymentCase: 'RESCHEDULE',
      installmentAllocations: null,
    });
    f.audits[1].newValue.sweptAmount = '1044';
    f.audits.push({ ...f.audits[2], id: 'second-shift' });
    expect((await read(f))[0].installmentAllocations).toBeNull();
  });
  it('uses the exact frozen park target when available', async () => {
    const f = fixture();
    f.audits[0].newValue.parkTargetInstallmentNo = 12;
    f.audits[1].newValue.parkTargetInstallmentNo = 12;
    expect((await read(f))[0].installmentAllocations?.at(-1)?.installmentNo).toBe(12);
  });
  it('refuses legacy target inference after a gap/deletion or changed contract term', async () => {
    const f = fixture();
    f.db.installmentSchedule.findMany.mockResolvedValue([
      { contractId: 'c1', installmentNo: 5 },
      { contractId: 'c1', installmentNo: 10 },
    ]);
    expect((await read(f))[0]).toMatchObject({
      paymentCase: 'RESCHEDULE',
      installmentAllocations: null,
    });
    const changed = fixture();
    changed.db.contract.findMany.mockResolvedValue([{ id: 'c1', totalMonths: 12 }]);
    expect((await read(changed))[0].installmentAllocations).toBeNull();
  });
  it('does not match a source JE for another payment', async () => {
    const f = fixture();
    f.entry.metadata.paymentId = 'another';
    expect((await read(f))[0]).toMatchObject({ paymentCase: null, installmentAllocations: null });
  });
  it('uses receipt snapshots for normal/partial-final history without comparing mutable Payment totals', async () => {
    const f = fixture();
    f.entry.lines = f.entry.lines.filter((line) => line.accountCode !== '21-1103');
    f.receipt.amount = dec('4472');
    expect((await read(f))[0].paymentCase).toBe('NORMAL');
    f.db.receipt.findMany.mockResolvedValue([
      f.receipt,
      {
        ...f.receipt,
        id: 'prior',
        sourceJournalEntryId: 'prior-je',
        paymentStatus: 'PARTIAL',
        installmentPartialSeq: 1,
        createdAt: new Date('2026-09-07T00:00:00Z'),
      },
    ]);
    expect((await read(f))[0].paymentCase).toBe('PARTIAL');
  });
  it('keeps early payoff / repossession explicit and ordinary credit notes unclassified', async () => {
    const f = fixture();
    const rows = await attachReceiptPaymentHistory(f.db as never, [
      { ...f.receipt, id: 'ep', paymentId: null, receiptType: 'EARLY_PAYOFF' },
      { ...f.receipt, id: 'repo', receiptType: 'CREDIT_NOTE', cnSource: 'REPOSSESSION' },
      { ...f.receipt, id: 'void-cn', receiptType: 'CREDIT_NOTE', cnSource: null },
    ]);
    expect(rows.map((r) => r.paymentCase)).toEqual(['EARLY_PAYOFF', 'REPOSSESSION', null]);
    expect(rows.every((r) => r.installmentAllocations === null)).toBe(true);
    expect(f.db.receipt.findMany).not.toHaveBeenCalled();
  });
});
