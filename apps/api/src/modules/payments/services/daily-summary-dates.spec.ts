/**
 * สรุปรายวัน — "วันไหนมีสมุดบ้าง" (owner 2026-08-19). The date picker was a bare
 * input: the cashier had to GUESS which days held receipts. This endpoint lists
 * the days of one month that actually have money receipts, so the UI can render
 * clickable chips under the picker.
 *
 * Same universe as getDailySummary by construction: non-voided, non-CREDIT_NOTE
 * receipts, bucketed by the SAME server-local day boundary the per-day filter
 * uses — a day listed here always renders a non-empty summary when clicked.
 */
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentQueryService } from './payment-query.service';

const D = (n: number) => new Prisma.Decimal(n);

const rcpt = (paidDate: string, amount: number) => ({
  paidDate: new Date(paidDate),
  amount: D(amount),
});

function setup(rows: ReturnType<typeof rcpt>[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = { receipt: { findMany } } as unknown as PrismaService;
  return { service: new PaymentQueryService(prisma), findMany };
}

describe('getDailySummaryDates — วันที่มีรายการในเดือน', () => {
  it('buckets receipts into per-day count + total', async () => {
    const { service } = setup([
      rcpt('2026-08-16T03:00:00', 3771),
      rcpt('2026-08-16T09:30:00', 3800),
      rcpt('2026-08-18T10:00:00', 2000),
    ]);

    const res = await service.getDailySummaryDates('2026-08');

    expect(res.days).toEqual([
      { date: '2026-08-16', count: 2, total: 7571 },
      { date: '2026-08-18', count: 1, total: 2000 },
    ]);
  });

  it('uses the same receipt universe as getDailySummary (no voided, no CN)', async () => {
    const { service, findMany } = setup([]);

    await service.getDailySummaryDates('2026-08');

    const where = findMany.mock.calls[0][0].where;
    expect(where.isVoided).toBe(false);
    expect(where.deletedAt).toBeNull();
    expect(where.receiptType).toEqual({ not: 'CREDIT_NOTE' });
    // Whole-month window, server-local boundaries (same math as the day filter).
    expect(where.paidDate.gte).toEqual(new Date(2026, 7, 1));
    expect(where.paidDate.lt).toEqual(new Date(2026, 8, 1));
  });

  it('scopes to a branch through the contract relation', async () => {
    const { service, findMany } = setup([]);

    await service.getDailySummaryDates('2026-08', 'branch-1');

    expect(findMany.mock.calls[0][0].where.contract).toEqual({ branchId: 'branch-1' });
  });

  it('empty month → empty list, not an error', async () => {
    const { service } = setup([]);

    const res = await service.getDailySummaryDates('2026-08');

    expect(res).toEqual({ month: '2026-08', days: [] });
  });

  it('rejects a malformed month string', async () => {
    const { service } = setup([]);

    await expect(service.getDailySummaryDates('16/08/2569')).rejects.toThrow(BadRequestException);
    await expect(service.getDailySummaryDates('2026-13')).rejects.toThrow(BadRequestException);
  });

  it('days come back sorted ascending regardless of receipt order', async () => {
    const { service } = setup([
      rcpt('2026-08-18T10:00:00', 100),
      rcpt('2026-08-02T10:00:00', 200),
      rcpt('2026-08-16T10:00:00', 300),
    ]);

    const res = await service.getDailySummaryDates('2026-08');

    expect(res.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-08-02',
      '2026-08-16',
      '2026-08-18',
    ]);
  });
});
