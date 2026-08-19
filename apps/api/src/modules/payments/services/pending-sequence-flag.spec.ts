/**
 * ห้ามข้ามงวด (owner 2026-08-19) — the pending queue tells the UI which rows are
 * out-of-order via `hasEarlierUnpaid`, so the รับชำระ button can be disabled
 * BEFORE the server guard fires. Computed against the DATABASE, not the page:
 * a due-date window can show a contract's งวด 3 while its unpaid งวด 2 sits
 * outside the filter — the flag must still be true.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentQueryService } from './payment-query.service';

const D = (n: number) => new Prisma.Decimal(n);

const row = (over: Record<string, unknown>) => ({
  id: `pay-${over.installmentNo}-${(over.contract as { id?: string })?.id ?? 'c1'}`,
  installmentNo: 1,
  dueDate: new Date('2026-08-01'),
  amountDue: D(3671),
  amountPaid: D(0),
  lateFee: D(0),
  lateFeeWaived: false,
  waivedAmount: null,
  status: 'OVERDUE',
  contract: { id: 'c1', contractNumber: 'TEST-1' },
  ...over,
});

function setup(rows: ReturnType<typeof row>[], minUnpaidByContract: Record<string, number>) {
  const groupBy = jest.fn().mockResolvedValue(
    Object.entries(minUnpaidByContract).map(([contractId, min]) => ({
      contractId,
      _min: { installmentNo: min },
    })),
  );
  const prisma = {
    payment: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
      groupBy,
    },
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;
  return { service: new PaymentQueryService(prisma), groupBy };
}

describe('getPendingPayments — hasEarlierUnpaid (ห้ามข้ามงวด)', () => {
  it('flags a row whose contract has an earlier unpaid installment', async () => {
    const { service } = setup(
      [
        row({ installmentNo: 2, contract: { id: 'c1', contractNumber: 'TEST-1' } }),
        row({ installmentNo: 3, contract: { id: 'c1', contractNumber: 'TEST-1' } }),
      ],
      { c1: 2 },
    );

    const res = await service.getPendingPayments({});

    expect(res.data[0].hasEarlierUnpaid).toBe(false); // งวด 2 = earliest unpaid
    expect(res.data[1].hasEarlierUnpaid).toBe(true); // งวด 3 must wait for 2
  });

  it('uses the DB-wide earliest unpaid, not just rows visible on the page', async () => {
    // Page shows only งวด 5 (due-date window hid 2-4) — DB says earliest unpaid = 2.
    const { service } = setup(
      [row({ installmentNo: 5, contract: { id: 'c1', contractNumber: 'TEST-1' } })],
      { c1: 2 },
    );

    const res = await service.getPendingPayments({});

    expect(res.data[0].hasEarlierUnpaid).toBe(true);
  });

  it('independent contracts are flagged independently', async () => {
    const { service } = setup(
      [
        row({ installmentNo: 4, contract: { id: 'c1', contractNumber: 'TEST-1' } }),
        row({ installmentNo: 1, contract: { id: 'c2', contractNumber: 'TEST-2' } }),
      ],
      { c1: 4, c2: 1 },
    );

    const res = await service.getPendingPayments({});

    expect(res.data.map((p: { hasEarlierUnpaid: boolean }) => p.hasEarlierUnpaid)).toEqual([
      false,
      false,
    ]);
  });

  it('empty page skips the groupBy entirely', async () => {
    const { service, groupBy } = setup([], {});

    await service.getPendingPayments({});

    expect(groupBy).not.toHaveBeenCalled();
  });
});
