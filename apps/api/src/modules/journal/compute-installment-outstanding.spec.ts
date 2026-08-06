import { Prisma } from '@prisma/client';
import { computeInstallmentOutstanding } from './compute-cn-breakdown';

/**
 * Golden fixture for the central installment-outstanding engine (spec §2.1,
 * docs/superpowers/specs/2026-07-26-ecl-per-installment-design.md) — same
 * 17k/12 contract as compute-cn-breakdown.spec.ts: financedAmount 10000,
 * storeCommission 1000, interestTotal 6000, vatAmount 1190, totalMonths 12
 * → vatPerInst 99.17, installmentTotal 1515.83.
 */
const FIXTURE_17K_12M = {
  id: 'contract-1',
  totalMonths: 12,
  financedAmount: '10000',
  storeCommission: '1000',
  interestTotal: '6000',
  vatAmount: '1190',
};

/** Mock Prisma client — only the two delegates the engine touches. */
function mockClient(overrides?: { installmentSchedule?: jest.Mock; payment?: jest.Mock }) {
  return {
    installmentSchedule: { findMany: overrides?.installmentSchedule ?? jest.fn() },
    payment: { findMany: overrides?.payment ?? jest.fn() },
  } as unknown as Prisma.TransactionClient;
}

const ASOF = new Date('2026-08-01T00:00:00.000Z');
const TEN_DAYS_BEFORE = new Date('2026-07-22T00:00:00.000Z'); // ASOF − 10 days

describe('computeInstallmentOutstanding (DUE vs ACCRUED engine)', () => {
  it('divergence case: DUE sees a past-due installment whose 2A never ran; ACCRUED does not', async () => {
    const client = mockClient();
    const payment = {
      installmentNo: 1,
      status: 'PENDING',
      amountDue: '1515.83',
      amountPaid: '0',
      dueDate: TEN_DAYS_BEFORE,
    };

    // 2A never ran — no InstallmentSchedule row with accrualJournalEntryId at all.
    const accrued = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'ACCRUED',
      asOf: ASOF,
      preloaded: { installments: [], payments: [payment] },
    });
    expect(accrued.rows).toHaveLength(0);

    const due = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf: ASOF,
      preloaded: { payments: [payment] },
    });
    expect(due.rows).toHaveLength(1);
    expect(due.rows[0].installmentNo).toBe(1);
    expect(due.rows[0].outstanding.toFixed(2)).toBe('1515.83');
    expect(due.rows[0].dueDate).toEqual(TEN_DAYS_BEFORE);
    expect(due.rows[0].daysOverdue).toBe(10);
  });

  it('DUE applies fee-netting (FEE-FIRST, same formula as CN): partial 1,000 + fee 75.79 → outstanding 591.62', async () => {
    const client = mockClient();
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf: ASOF,
      preloaded: {
        payments: [
          {
            installmentNo: 1,
            status: 'PARTIALLY_PAID',
            amountDue: '1515.83',
            amountPaid: '1000',
            lateFee: '75.79',
            lateFeeWaived: false,
            dueDate: TEN_DAYS_BEFORE,
          },
        ],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].outstanding.toFixed(2)).toBe('591.62');
    expect(result.rows[0].daysOverdue).toBe(10);
  });

  it('DUE asOf boundary: dueDate >= asOf is excluded, dueDate < asOf is included', async () => {
    const client = mockClient();
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf: ASOF,
      preloaded: {
        payments: [
          {
            // Exactly on asOf — NOT overdue yet, must be excluded.
            installmentNo: 1,
            status: 'PENDING',
            amountDue: '1515.83',
            amountPaid: '0',
            dueDate: ASOF,
          },
          {
            // 1ms before asOf — overdue, must be included.
            installmentNo: 2,
            status: 'PENDING',
            amountDue: '1515.83',
            amountPaid: '0',
            dueDate: new Date(ASOF.getTime() - 1),
          },
        ],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].installmentNo).toBe(2);
  });

  it('PAID installments are excluded from DUE even when present in a preloaded (unfiltered) array', async () => {
    const client = mockClient();
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf: ASOF,
      preloaded: {
        payments: [
          {
            installmentNo: 1,
            status: 'PAID',
            amountDue: '1515.83',
            amountPaid: '1515.83',
            dueDate: TEN_DAYS_BEFORE,
          },
          {
            installmentNo: 2,
            status: 'OVERDUE',
            amountDue: '1515.83',
            amountPaid: '0',
            dueDate: TEN_DAYS_BEFORE,
          },
        ],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].installmentNo).toBe(2);
  });

  it('preloaded rows skip both client queries entirely (ACCRUED)', async () => {
    const findManyInstallments = jest.fn();
    const findManyPayments = jest.fn();
    const client = mockClient({ installmentSchedule: findManyInstallments, payment: findManyPayments });

    await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'ACCRUED',
      preloaded: {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
        payments: [],
      },
    });

    expect(findManyInstallments).not.toHaveBeenCalled();
    expect(findManyPayments).not.toHaveBeenCalled();
  });

  it('preloaded rows skip both client queries entirely (DUE)', async () => {
    const findManyInstallments = jest.fn();
    const findManyPayments = jest.fn();
    const client = mockClient({ installmentSchedule: findManyInstallments, payment: findManyPayments });

    await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf: ASOF,
      preloaded: {
        payments: [
          {
            installmentNo: 1,
            status: 'OVERDUE',
            amountDue: '1515.83',
            amountPaid: '0',
            dueDate: TEN_DAYS_BEFORE,
          },
        ],
      },
    });

    expect(findManyInstallments).not.toHaveBeenCalled();
    expect(findManyPayments).not.toHaveBeenCalled();
  });

  it('ACCRUED still returns dueDate/daysOverdue when a Payment row is present (informational — CN ignores them)', async () => {
    const client = mockClient();
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'ACCRUED',
      asOf: ASOF,
      preloaded: {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
        payments: [
          {
            installmentNo: 1,
            status: 'PARTIALLY_PAID',
            amountDue: '1515.83',
            amountPaid: '1000',
            dueDate: TEN_DAYS_BEFORE,
          },
        ],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].outstanding.toFixed(2)).toBe('515.83');
    expect(result.rows[0].dueDate).toEqual(TEN_DAYS_BEFORE);
    expect(result.rows[0].daysOverdue).toBe(10);
  });

  it('ACCRUED returns dueDate/daysOverdue as null when no Payment row exists', async () => {
    const client = mockClient();
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'ACCRUED',
      asOf: ASOF,
      preloaded: {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
        payments: [],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].outstanding.toFixed(2)).toBe('1515.83');
    expect(result.rows[0].dueDate).toBeNull();
    expect(result.rows[0].daysOverdue).toBeNull();
  });

  it('I1: DUE self-query (no preload) filters out soft-deleted payments — deletedAt: null in the where clause', async () => {
    const findManyPayments = jest.fn().mockResolvedValue([]);
    const client = mockClient({ payment: findManyPayments });

    await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf: ASOF,
    });

    expect(findManyPayments).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  it('I1: ACCRUED self-query (no preload) filters out soft-deleted payments — deletedAt: null in the where clause', async () => {
    const findManyPayments = jest.fn().mockResolvedValue([]);
    const findManyInstallments = jest
      .fn()
      .mockResolvedValue([{ installmentNo: 1, accrualJournalEntryId: 'je-1' }]);
    const client = mockClient({ installmentSchedule: findManyInstallments, payment: findManyPayments });

    await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'ACCRUED',
      asOf: ASOF,
    });

    expect(findManyPayments).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  it('I1: ACCRUED drops a soft-deleted payment from a PRELOADED array (defensive map-level filter, not just the DB-level where clause) — treated as "no payment row" (fully outstanding)', async () => {
    const client = mockClient();
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'ACCRUED',
      asOf: ASOF,
      preloaded: {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
        payments: [
          {
            // A real partial payment, but soft-deleted — must be excluded
            // from paymentByInst, falling back to the "no payment row"
            // branch (fully outstanding), NOT the partial-payment math.
            installmentNo: 1,
            status: 'PARTIALLY_PAID',
            amountDue: '1515.83',
            amountPaid: '1000',
            dueDate: TEN_DAYS_BEFORE,
            deletedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].outstanding.toFixed(2)).toBe('1515.83');
    // No live payment row → dueDate/daysOverdue fall back to null (no
    // InstallmentSchedule.dueDate preloaded on this fixture either).
    expect(result.rows[0].dueDate).toBeNull();
  });

  it('I1: ACCRUED dueDate falls back to InstallmentSchedule.dueDate when no live Payment row exists', async () => {
    const client = mockClient();
    const instDueDate = new Date('2026-06-01T00:00:00.000Z');
    const result = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'ACCRUED',
      asOf: ASOF,
      preloaded: {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1', dueDate: instDueDate }],
        payments: [],
      },
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].dueDate).toEqual(instDueDate);
    expect(result.rows[0].daysOverdue).toBe(
      Math.floor((ASOF.getTime() - instDueDate.getTime()) / (24 * 60 * 60 * 1000)),
    );
  });

  it('rows expose installmentTotal + vatPerInst for both selections', async () => {
    const client = mockClient();
    const due = await computeInstallmentOutstanding(client, FIXTURE_17K_12M, {
      selection: 'DUE',
      asOf: ASOF,
      preloaded: {
        payments: [
          {
            installmentNo: 1,
            status: 'PENDING',
            amountDue: '1515.83',
            amountPaid: '0',
            dueDate: TEN_DAYS_BEFORE,
          },
        ],
      },
    });

    expect(due.rows[0].installmentTotal.toFixed(2)).toBe('1515.83');
    expect(due.rows[0].vatPerInst.toFixed(2)).toBe('99.17');
  });
});
