import { Prisma } from '@prisma/client';
import {
  getReceiptDocumentBalance,
  persistReceiptDocumentBalance,
  RECEIPT_DOCUMENT_BALANCE_ACTION,
} from './receipt-document-balance';

const d = (value: string | number) => new Prisma.Decimal(value);
const at = (minute: number) => new Date(Date.UTC(2026, 8, 8, 8, minute));
const line = (accountCode: string, debit: number, credit: number) => ({
  accountCode,
  debit: d(debit),
  credit: d(credit),
});
const terms = {
  financedAmount: '22000',
  storeCommission: '2200',
  interestTotal: '17594.40',
  vatAmount: '2925.61',
  totalMonths: 10,
};

function fixture() {
  const payments = Array.from({ length: 10 }, (_, i) => ({
    id: `p${i + 1}`,
    installmentNo: i + 1,
    amountDue: d(4472),
  }));
  const schedules = payments.map((payment) => ({
    id: `s${payment.installmentNo}`,
    installmentNo: payment.installmentNo,
  }));
  const entries: any[] = [];
  const rows: any[] = [];
  const reversals: any[] = [];
  function collect(
    installmentNo: number,
    cash: number,
    cleared: number,
    advance = 0,
    fee = 0,
    minute = installmentNo,
  ) {
    const id = `j${entries.length + 1}`;
    const entry = {
      id,
      referenceType: 'AUTO',
      createdAt: at(minute),
      postedAt: at(minute),
      metadata: {
        tag: 'receipt',
        contractId: 'c1',
        paymentId: `p${installmentNo}`,
        installmentScheduleId: `s${installmentNo}`,
        deltaApplied: String(cash),
      },
      lines: [
        line('11-1101', cash, 0),
        line('11-2103', 0, cleared),
        line('21-1103', 0, advance),
        line('42-1103', 0, fee),
      ],
    };
    entries.push(entry);
    const row = {
      id: `r${rows.length + 1}`,
      contractId: 'c1',
      paymentId: `p${installmentNo}`,
      receiptType: 'INSTALLMENT',
      installmentNo,
      amount: d(cash),
      paidDate: at(minute),
      createdAt: at(minute + 0.5),
      sourceJournalEntryId: id,
      remainingMonths: 10 - installmentNo,
      paymentStatus: 'PAID',
    };
    rows.push(row);
    return row;
  }
  [1, 2, 3].forEach((no) => collect(no, 4472, 4472));
  const receipt = collect(4, 5516, 4472, 1044);
  const client = {
    auditLog: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    payment: { findMany: jest.fn(async () => payments) },
    installmentSchedule: { findMany: jest.fn(async () => schedules) },
    receipt: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((row) => row.createdAt <= where.createdAt.lte),
      ),
    },
    journalEntry: {
      findMany: jest.fn(async ({ where }: any) => (where.metadata ? entries : reversals)),
    },
  };
  return { client, receipt, payments, entries, reversals, rows, collect };
}

describe('receipt document balance at issuance', () => {
  it('uses gross installment debt and this receipt advance: 6 × 4472 − 1044 = 25788', async () => {
    const f = fixture();
    expect(await getReceiptDocumentBalance(f.client as never, f.receipt, terms)).toEqual({
      documentRemainingBalance: '25788.00',
      documentRemainingMonths: 6,
      documentInstallmentAmountDue: '4472.00',
      documentInstallmentAmountPaid: '4472.00',
    });
    expect(f.client.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, installmentNo: true, amountDue: true },
      }),
    );
  });

  it('6a cash 1144 includes fee 100 and only advance 1044 reduces future debt', async () => {
    const f = fixture();
    Object.assign(f.receipt, {
      receiptType: 'RESCHEDULE_FEE',
      amount: d(1144),
      remainingMonths: 7,
    });
    Object.assign(f.entries[3].metadata, {
      tag: 'reschedule-collect',
      rescheduleFee: '1044',
      lateFeeCollected: '100',
    });
    f.entries[3].lines = [
      line('11-1101', 1144, 0),
      line('21-1103', 0, 1044),
      line('42-1103', 0, 100),
    ];
    const result = await getReceiptDocumentBalance(f.client as never, f.receipt, terms);
    expect(result.documentRemainingBalance).toBe('30260.00');
    expect(result.documentInstallmentAmountPaid).toBe('0.00');
  });

  it('partial receipt clears its actual 2900 installment cash, not 3000 including fee', async () => {
    const f = fixture();
    Object.assign(f.receipt, { amount: d(3000), remainingMonths: 7 });
    f.entries[3].metadata.deltaApplied = '3000';
    f.entries[3].lines = [
      line('11-1101', 3000, 0),
      line('11-2103', 0, 2900),
      line('42-1103', 0, 100),
    ];
    const result = await getReceiptDocumentBalance(f.client as never, f.receipt, terms);
    expect(result.documentRemainingBalance).toBe('28404.00');
    expect(result.documentInstallmentAmountPaid).toBe('2900.00');
  });

  it('later installments and final park consumption do not change an earlier PDF', async () => {
    const f = fixture();
    [5, 6, 7, 8, 9].forEach((no) => f.collect(no, 4472, 4472));
    const final = f.collect(10, 3428, 4472);
    f.entries[f.entries.length - 1].lines.push(line('21-1103', 1044, 0));
    expect(
      (await getReceiptDocumentBalance(f.client as never, f.receipt, terms))
        .documentRemainingBalance,
    ).toBe('25788.00');
    expect(
      (await getReceiptDocumentBalance(f.client as never, final, terms)).documentRemainingBalance,
    ).toBe('0.00');
  });

  it('park consumption on accrual cancels debt reduction against its advance debit', async () => {
    const f = fixture();
    f.entries.push({
      id: 'consume',
      referenceType: 'AUTO',
      createdAt: at(4),
      postedAt: at(4),
      metadata: {
        tag: '2B',
        contractId: 'c1',
        installmentScheduleId: 's10',
        flow: 'reschedule-park-consume',
      },
      lines: [line('21-1103', 1044, 0), line('11-2103', 0, 1044)],
    });
    const result = await getReceiptDocumentBalance(f.client as never, f.receipt, terms);
    expect(result.documentRemainingBalance).toBe('25788.00');
    expect(result.documentRemainingMonths).toBe(6);
  });

  it('a later void does not erase the source settlement on its historical PDF', async () => {
    const f = fixture();
    f.entries[3].metadata.reversed = true;
    f.reversals.push({
      id: 'void',
      referenceType: 'AUTO',
      createdAt: at(20),
      postedAt: at(20),
      metadata: { tag: 'REVERSAL', originalEntryId: f.entries[3].id },
      lines: f.entries[3].lines.map((value: any) => ({
        ...value,
        debit: value.credit,
        credit: value.debit,
      })),
    });
    expect(
      (await getReceiptDocumentBalance(f.client as never, f.receipt, terms))
        .documentRemainingBalance,
    ).toBe('25788.00');
  });

  it('a prior void restores its installment before a later receipt is issued', async () => {
    const f = fixture();
    f.entries[1].metadata.reversed = true;
    f.reversals.push({
      id: 'void',
      referenceType: 'AUTO',
      createdAt: at(3),
      postedAt: at(3),
      metadata: { tag: 'REVERSAL', originalEntryId: f.entries[1].id },
      lines: f.entries[1].lines.map((value: any) => ({
        ...value,
        debit: value.credit,
        credit: value.debit,
      })),
    });
    f.receipt.remainingMonths = 7;
    expect(
      (await getReceiptDocumentBalance(f.client as never, f.receipt, terms))
        .documentRemainingBalance,
    ).toBe('30260.00');
  });

  it('uses creation time rather than backdated paid/posted dates', async () => {
    const f = fixture();
    const later = f.collect(5, 4472, 4472, 0, 0, 20);
    later.paidDate = at(1);
    f.entries[4].postedAt = at(1);
    expect(
      (await getReceiptDocumentBalance(f.client as never, f.receipt, terms))
        .documentRemainingBalance,
    ).toBe('25788.00');
  });

  it.each([
    'missing source',
    'missing migrated payment',
    'terms drift',
    'missing reversal',
    'manual adjustment',
  ])('fails closed on %s', async (problem) => {
    const f = fixture();
    if (problem === 'missing source') f.rows[1].sourceJournalEntryId = 'unknown';
    if (problem === 'missing migrated payment') {
      f.entries.shift();
      f.rows.shift();
    }
    if (problem === 'terms drift') f.payments[9].amountDue = d(4500);
    if (problem === 'missing reversal') f.entries[0].metadata.reversed = true;
    if (problem === 'manual adjustment')
      f.entries.push({
        id: 'manual',
        referenceType: 'MANUAL',
        createdAt: at(3),
        metadata: { tag: 'adjustment', contractId: 'c1' },
        lines: [line('11-2103', 0, 100)],
      });
    expect(
      (await getReceiptDocumentBalance(f.client as never, f.receipt, terms))
        .documentRemainingBalance,
    ).toBeNull();
  });

  it('leaves standalone credit notes and early payoff outside this reconstruction', async () => {
    const f = fixture();
    f.receipt.receiptType = 'EARLY_PAYOFF';
    expect(
      (await getReceiptDocumentBalance(f.client as never, f.receipt, terms))
        .documentRemainingBalance,
    ).toBeNull();
    expect(f.client.payment.findMany).not.toHaveBeenCalled();
  });
  it('6079 billed / 6078.67 canonical closes only with immutable PAID receipt evidence', async () => {
    const f = fixture();
    f.payments.forEach((payment) => (payment.amountDue = d(6079)));
    f.entries.forEach(
      (entry) =>
        (entry.lines.find((value: any) => value.accountCode === '11-2103').credit = d('6078.67')),
    );
    const roundedTerms = { ...terms, interestTotal: '32610', vatAmount: '3976.70' };
    const result = await getReceiptDocumentBalance(f.client as never, f.receipt, roundedTerms);
    expect(result.documentRemainingBalance).toBe('35430.00');
    expect(result.documentRemainingMonths).toBe(6);
    f.rows[3].paymentStatus = 'PARTIAL';
    f.receipt.remainingMonths = 7;
    const partial = await getReceiptDocumentBalance(f.client as never, f.receipt, roundedTerms);
    expect(partial.documentRemainingBalance).toBe('35430.33');
    expect(partial.documentInstallmentAmountPaid).toBe('6078.67');
  });

  it('deduplicates a reversal also returned by the contract metadata query', async () => {
    const f = fixture();
    f.entries[1].metadata.reversed = true;
    const reverse = {
      id: 'void-with-contract',
      referenceType: 'AUTO',
      createdAt: at(3),
      postedAt: at(3),
      metadata: { tag: 'REVERSAL', contractId: 'c1', originalEntryId: f.entries[1].id },
      lines: f.entries[1].lines.map((value: any) => ({
        ...value,
        debit: value.credit,
        credit: value.debit,
      })),
    };
    f.entries.push(reverse);
    f.reversals.push(reverse);
    f.receipt.remainingMonths = 7;
    expect(
      (await getReceiptDocumentBalance(f.client as never, f.receipt, terms))
        .documentRemainingBalance,
    ).toBe('30260.00');
  });
  it('a frozen partial ignores a later-visible JE whose transaction started before receipt issuance', async () => {
    const f = fixture();
    Object.assign(f.receipt, { amount: d(3000), remainingMonths: 7, paymentStatus: 'PARTIAL' });
    f.entries[3].metadata.deltaApplied = '3000';
    f.entries[3].lines = [
      line('11-1101', 3000, 0),
      line('11-2103', 0, 2900),
      line('42-1103', 0, 100),
    ];
    const before = await getReceiptDocumentBalance(f.client as never, f.receipt, terms);
    expect(before.documentRemainingBalance).toBe('28404.00');
    await persistReceiptDocumentBalance(
      f.client as never,
      f.receipt,
      before,
      'cashier',
      terms.totalMonths,
    );
    const saved = f.client.auditLog.create.mock.calls[0][0].data;
    expect(saved).toMatchObject({
      userId: 'cashier',
      action: RECEIPT_DOCUMENT_BALANCE_ACTION,
      entity: 'receipt',
      entityId: f.receipt.id,
    });
    f.client.auditLog.findMany.mockResolvedValue([{ newValue: saved.newValue }]);
    f.entries.push({
      id: 'later-visible',
      referenceType: 'AUTO',
      createdAt: at(3),
      postedAt: at(3),
      metadata: {
        tag: 'receipt',
        contractId: 'c1',
        paymentId: 'p4',
        installmentScheduleId: 's4',
        deltaApplied: '100',
      },
      lines: [line('11-1101', 100, 0), line('11-2103', 0, 100)],
    });
    f.client.payment.findMany.mockClear();
    f.client.journalEntry.findMany.mockClear();
    expect(await getReceiptDocumentBalance(f.client as never, f.receipt, terms)).toEqual(before);
    expect(f.client.payment.findMany).not.toHaveBeenCalled();
    expect(f.client.journalEntry.findMany).not.toHaveBeenCalled();
  });

  it('a frozen unknown remains unknown even if legacy evidence becomes available later', async () => {
    const f = fixture();
    const unknown = {
      documentRemainingBalance: null,
      documentRemainingMonths: null,
      documentInstallmentAmountDue: null,
      documentInstallmentAmountPaid: null,
    };
    await persistReceiptDocumentBalance(
      f.client as never,
      f.receipt,
      unknown,
      'cashier',
      terms.totalMonths,
    );
    f.client.auditLog.findMany.mockResolvedValue([
      { newValue: f.client.auditLog.create.mock.calls[0][0].data.newValue },
    ]);
    expect(await getReceiptDocumentBalance(f.client as never, f.receipt, terms)).toEqual(unknown);
    expect(f.client.payment.findMany).not.toHaveBeenCalled();
  });

  it.each([
    'missing field',
    'wrong contract',
    'wrong receipt',
    'wrong version',
    'negative money',
    'NaN',
    'extra decimals',
    'fractional months',
    'too many months',
    'paid above due',
    'duplicate',
  ])('malformed snapshot fails closed without legacy fallback: %s', async (problem) => {
    const f = fixture();
    const value: Record<string, unknown> = {
      version: 1,
      receiptId: f.receipt.id,
      contractId: f.receipt.contractId,
      receiptType: f.receipt.receiptType,
      contractTotalMonths: 10,
      documentRemainingBalance: '25788.00',
      documentRemainingMonths: 6,
      documentInstallmentAmountDue: '4472.00',
      documentInstallmentAmountPaid: '4472.00',
    };
    if (problem === 'missing field') delete value.documentInstallmentAmountPaid;
    if (problem === 'wrong contract') value.contractId = 'other';
    if (problem === 'wrong receipt') value.receiptId = 'other';
    if (problem === 'wrong version') value.version = 2;
    if (problem === 'negative money') value.documentRemainingBalance = '-1.00';
    if (problem === 'NaN') value.documentRemainingBalance = 'NaN';
    if (problem === 'extra decimals') value.documentRemainingBalance = '25788.001';
    if (problem === 'fractional months') value.documentRemainingMonths = 6.5;
    if (problem === 'too many months') value.documentRemainingMonths = 11;
    if (problem === 'paid above due') value.documentInstallmentAmountPaid = '4472.01';
    f.client.auditLog.findMany.mockResolvedValue(
      problem === 'duplicate' ? [{ newValue: value }, { newValue: value }] : [{ newValue: value }],
    );
    expect(
      (await getReceiptDocumentBalance(f.client as never, f.receipt, terms))
        .documentRemainingBalance,
    ).toBeNull();
    expect(f.client.payment.findMany).not.toHaveBeenCalled();
  });

  it('never stamps a non-money document', async () => {
    const f = fixture();
    f.receipt.receiptType = 'EARLY_PAYOFF';
    const balance = await getReceiptDocumentBalance(f.client as never, f.receipt, terms);
    await persistReceiptDocumentBalance(
      f.client as never,
      f.receipt,
      balance,
      'cashier',
      terms.totalMonths,
    );
    expect(f.client.auditLog.create).not.toHaveBeenCalled();
    expect(f.client.auditLog.findMany).not.toHaveBeenCalled();
  });
});
