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
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = {
    payment: {
      findMany,
      count: jest.fn().mockResolvedValue(rows.length),
      groupBy,
    },
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;
  return { service: new PaymentQueryService(prisma), groupBy, findMany };
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

/**
 * Contract-status scope (owner 2026-09-05): the queue only lists installments the
 * orchestrator will actually accept — contract ACTIVE/OVERDUE/DEFAULT (its guard
 * rejects anything else with "สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT").
 * TERMINATED (บอกเลิกแล้ว — ยึดเครื่องจากหน้ายึดคืน), CLOSED_BAD_DEBT, EXCHANGED
 * leave their unpaid rows behind, so without this filter they sat in the queue
 * as dead rows nobody could act on. The PAID history tab (status=PAID) is NOT
 * scoped — a COMPLETED/TERMINATED contract's paid installments must stay visible.
 */
describe('getPendingPayments — contract-status scope (เฉพาะสัญญาที่รับชำระได้จริง)', () => {
  const PAYABLE = ['ACTIVE', 'OVERDUE', 'DEFAULT'];

  it('default (unpaid) listing scopes to ACTIVE/OVERDUE/DEFAULT contracts', async () => {
    const { service, findMany } = setup([], {});

    await service.getPendingPayments({});

    const where = findMany.mock.calls[0][0].where;
    expect(where.contract.status).toEqual({ in: PAYABLE });
    expect(where.contract.workflowStatus).toBe('APPROVED');
  });

  it('an explicit unpaid status filter (OVERDUE) is still scoped', async () => {
    const { service, findMany } = setup([], {});

    await service.getPendingPayments({ status: 'OVERDUE' });

    expect(findMany.mock.calls[0][0].where.contract.status).toEqual({ in: PAYABLE });
  });

  it('status=PAID (ชำระครบ tab) is NOT scoped — paid history of closed contracts stays', async () => {
    const { service, findMany } = setup([], {});

    await service.getPendingPayments({ status: 'PAID' });

    const where = findMany.mock.calls[0][0].where;
    expect(where.contract.status).toBeUndefined();
    expect(where.contract.workflowStatus).toBe('APPROVED');
  });
});
