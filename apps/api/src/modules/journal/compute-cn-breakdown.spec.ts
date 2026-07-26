import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { computeCnBreakdown } from './compute-cn-breakdown';

/**
 * Golden for the shared CN (ใบลดหนี้ ม.82/5) pro-rate util — CPA ruling
 * 2026-07-26 (docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md).
 *
 * All cases use the standard 17k/12 fixture: financedAmount 10000,
 * storeCommission 1000, interestTotal 6000, vatAmount 1190, totalMonths 12
 * → vatPerInst 99.17, installmentTotal 1515.83 (same fixture as
 * compute-installment-breakdown.spec.ts CPA case-4).
 */
const FIXTURE_17K_12M = {
  id: 'contract-1',
  totalMonths: 12,
  financedAmount: '10000',
  storeCommission: '1000',
  interestTotal: '6000',
  vatAmount: '1190',
};

/** Mock Prisma client — only the two delegates computeCnBreakdown touches. */
function mockClient(overrides?: {
  installmentSchedule?: jest.Mock;
  payment?: jest.Mock;
}) {
  return {
    installmentSchedule: { findMany: overrides?.installmentSchedule ?? jest.fn() },
    payment: { findMany: overrides?.payment ?? jest.fn() },
  } as unknown as Prisma.TransactionClient;
}

describe('computeCnBreakdown (CN pro-rate — single source of truth)', () => {
  it('CPA golden partial: 1 accrued installment paid 1,000 → outstanding 515.83 / cnVat 33.75', async () => {
    const client = mockClient();
    const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
      installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
      payments: [
        { installmentNo: 1, status: 'PARTIALLY_PAID', amountDue: '1515.83', amountPaid: '1000' },
      ],
    });

    expect(result.count).toBe(1);
    expect(result.rows[0].outstanding.toFixed(2)).toBe('515.83');
    expect(result.rows[0].cnVat.toFixed(2)).toBe('33.75');
    expect(result.rows[0].cnBeforeVat.toFixed(2)).toBe('482.08');
    expect(result.totalOutstanding.toFixed(2)).toBe('515.83');
    expect(result.totalCnVat.toFixed(2)).toBe('33.75');
    expect(result.totalBeforeVat.toFixed(2)).toBe('482.08');
  });

  it('3 fully-unpaid accrued installments (no Payment rows) → 297.51 / 4,547.49 / 4,249.98 — clean case must not change', async () => {
    const client = mockClient();
    const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
      installments: [
        { installmentNo: 1, accrualJournalEntryId: 'je-1' },
        { installmentNo: 2, accrualJournalEntryId: 'je-2' },
        { installmentNo: 3, accrualJournalEntryId: 'je-3' },
      ],
      payments: [],
    });

    expect(result.count).toBe(3);
    expect(result.totalCnVat.toFixed(2)).toBe('297.51');
    expect(result.totalOutstanding.toFixed(2)).toBe('4547.49');
    expect(result.totalBeforeVat.toFixed(2)).toBe('4249.98');
    // Each full installment prices at exactly vatPerInst — no pro-rate drift.
    for (const row of result.rows) {
      expect(row.cnVat.toFixed(2)).toBe('99.17');
      expect(row.outstanding.toFixed(2)).toBe('1515.83');
    }
  });

  it('mixed: 2 full + 1 partial (paid 1,000) → totalCnVat 232.09 / totalOutstanding 3,547.49 / totalBeforeVat 3,315.40', async () => {
    const client = mockClient();
    const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
      installments: [
        { installmentNo: 1, accrualJournalEntryId: 'je-1' },
        { installmentNo: 2, accrualJournalEntryId: 'je-2' },
        { installmentNo: 3, accrualJournalEntryId: 'je-3' },
      ],
      payments: [
        { installmentNo: 3, status: 'PARTIALLY_PAID', amountDue: '1515.83', amountPaid: '1000' },
      ],
    });

    expect(result.count).toBe(3);
    expect(result.totalCnVat.toFixed(2)).toBe('232.09');
    expect(result.totalOutstanding.toFixed(2)).toBe('3547.49');
    expect(result.totalBeforeVat.toFixed(2)).toBe('3315.40');
  });

  it('installment with no Payment row at all → treated as fully outstanding', async () => {
    const client = mockClient();
    const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
      installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
      payments: [], // no row for installmentNo 1
    });

    expect(result.count).toBe(1);
    expect(result.rows[0].outstanding.toFixed(2)).toBe('1515.83');
    expect(result.rows[0].cnVat.toFixed(2)).toBe('99.17');
  });

  it('PAID installment is skipped entirely (not counted, no row)', async () => {
    const client = mockClient();
    const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
      installments: [
        { installmentNo: 1, accrualJournalEntryId: 'je-1' },
        { installmentNo: 2, accrualJournalEntryId: 'je-2' },
      ],
      payments: [{ installmentNo: 1, status: 'PAID', amountDue: '1515.83', amountPaid: '1515.83' }],
    });

    expect(result.count).toBe(1);
    expect(result.rows.find((r) => r.installmentNo === 1)).toBeUndefined();
    expect(result.rows[0].installmentNo).toBe(2);
    expect(result.totalCnVat.toFixed(2)).toBe('99.17');
  });

  it('non-accrued installment (accrualJournalEntryId null) is excluded even if passed in opts', async () => {
    const client = mockClient();
    const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
      installments: [
        { installmentNo: 1, accrualJournalEntryId: 'je-1' },
        { installmentNo: 2, accrualJournalEntryId: null },
      ],
      payments: [],
    });

    expect(result.count).toBe(1);
    expect(result.rows[0].installmentNo).toBe(1);
  });

  it('queries installmentSchedule + payment when opts is omitted', async () => {
    const findManyInstallments = jest
      .fn()
      .mockResolvedValue([{ installmentNo: 1, accrualJournalEntryId: 'je-1' }]);
    const findManyPayments = jest
      .fn()
      .mockResolvedValue([
        { installmentNo: 1, status: 'PARTIALLY_PAID', amountDue: '1515.83', amountPaid: '1000' },
      ]);
    const client = mockClient({
      installmentSchedule: findManyInstallments,
      payment: findManyPayments,
    });

    const result = await computeCnBreakdown(client, FIXTURE_17K_12M);

    expect(findManyInstallments).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: FIXTURE_17K_12M.id,
          deletedAt: null,
          accrualJournalEntryId: { not: null },
        }),
      }),
    );
    expect(findManyPayments).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ contractId: FIXTURE_17K_12M.id }) }),
    );
    expect(result.totalCnVat.toFixed(2)).toBe('33.75');
  });

  describe('FEE-FIRST net-out (I1, final-review — Payment.amountPaid is GROSS cash incl. late fee)', () => {
    it('partial payment 1,000 with unwaived lateFee 75.79 nets baseCash 924.21 → outstanding 591.62 / cnVat 38.71', async () => {
      const client = mockClient();
      const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
        payments: [
          {
            installmentNo: 1,
            status: 'PARTIALLY_PAID',
            amountDue: '1515.83',
            amountPaid: '1000',
            lateFee: '75.79',
            lateFeeWaived: false,
          },
        ],
      });

      expect(result.count).toBe(1);
      expect(result.rows[0].outstanding.toFixed(2)).toBe('591.62');
      expect(result.rows[0].cnVat.toFixed(2)).toBe('38.71');
      expect(result.totalCnVat.toFixed(2)).toBe('38.71');
      expect(result.totalOutstanding.toFixed(2)).toBe('591.62');
    });

    it('waived lateFee behaves identically to no-fee at all (outstanding 515.83 / cnVat 33.75)', async () => {
      const client = mockClient();
      const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
        payments: [
          {
            installmentNo: 1,
            status: 'PARTIALLY_PAID',
            amountDue: '1515.83',
            amountPaid: '1000',
            lateFee: '75.79',
            lateFeeWaived: true,
          },
        ],
      });

      expect(result.rows[0].outstanding.toFixed(2)).toBe('515.83');
      expect(result.rows[0].cnVat.toFixed(2)).toBe('33.75');
    });

    it('a Payment row that omits lateFee/lateFeeWaived entirely defaults to no-fee (backward compat)', async () => {
      const client = mockClient();
      const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
        payments: [
          { installmentNo: 1, status: 'PARTIALLY_PAID', amountDue: '1515.83', amountPaid: '1000' },
        ],
      });

      expect(result.rows[0].outstanding.toFixed(2)).toBe('515.83');
      expect(result.rows[0].cnVat.toFixed(2)).toBe('33.75');
    });

    it('overpaid installment (amountPaid > amountDue, net of fee) clamps outstanding to 0 and DROPS the row', async () => {
      const client = mockClient();
      const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
        payments: [
          {
            installmentNo: 1,
            status: 'PARTIALLY_PAID',
            amountDue: '1515.83',
            amountPaid: '2000',
            lateFee: '0',
            lateFeeWaived: false,
          },
        ],
      });

      // count reflects "installments a CN is owed on" — an overpaid
      // installment owes nothing, so it is dropped entirely rather than kept
      // as a zero-contribution row (decided + documented in compute-cn-breakdown.ts jsdoc).
      expect(result.count).toBe(0);
      expect(result.rows).toHaveLength(0);
      expect(result.totalOutstanding.toFixed(2)).toBe('0.00');
      expect(result.totalCnVat.toFixed(2)).toBe('0.00');
      expect(result.totalBeforeVat.toFixed(2)).toBe('0.00');
    });

    it('overpaid + full clean installment mixed — dropped row does not pollute totals for the remaining installment', async () => {
      const client = mockClient();
      const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
        installments: [
          { installmentNo: 1, accrualJournalEntryId: 'je-1' },
          { installmentNo: 2, accrualJournalEntryId: 'je-2' },
        ],
        payments: [
          {
            installmentNo: 1,
            status: 'PARTIALLY_PAID',
            amountDue: '1515.83',
            amountPaid: '2000',
          },
          // installmentNo 2: no Payment row → fully outstanding
        ],
      });

      expect(result.count).toBe(1);
      expect(result.rows[0].installmentNo).toBe(2);
      expect(result.totalOutstanding.toFixed(2)).toBe('1515.83');
      expect(result.totalCnVat.toFixed(2)).toBe('99.17');
    });
  });

  it('exposes installmentTotal on the returned breakdown (M4, final-review)', async () => {
    const client = mockClient();
    const result = await computeCnBreakdown(client, FIXTURE_17K_12M, {
      installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
      payments: [],
    });

    expect(result.installmentTotal.toFixed(2)).toBe('1515.83');
  });

  it('accepts real Decimal instances (not just strings) for contract + payment fields', async () => {
    const client = mockClient();
    const result = await computeCnBreakdown(
      client,
      {
        id: 'contract-2',
        totalMonths: 12,
        financedAmount: new Decimal('10000'),
        storeCommission: new Decimal('1000'),
        interestTotal: new Decimal('6000'),
        vatAmount: new Decimal('1190'),
      },
      {
        installments: [{ installmentNo: 1, accrualJournalEntryId: 'je-1' }],
        payments: [
          {
            installmentNo: 1,
            status: 'PARTIALLY_PAID',
            amountDue: new Decimal('1515.83'),
            amountPaid: new Decimal('1000'),
          },
        ],
      },
    );

    expect(result.totalCnVat.toFixed(2)).toBe('33.75');
  });
});
