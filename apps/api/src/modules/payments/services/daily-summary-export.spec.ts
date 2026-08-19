/**
 * สรุปรายวัน — ส่งออก Excel แบบช่วงวัน (owner 2026-08-19: "ส่งออกเป็น EXCEL ได้
 * แต่ต้องเลือกช่วงวันก่อน"). The per-day endpoint paginates at 200 rows and takes
 * ONE date; the export needs every receipt of a from–to window in one call, so
 * the client can hand the rows to exceljs.
 *
 * Same universe as getDailySummary by construction: non-voided, non-CREDIT_NOTE
 * receipts by paidDate — Σ of the exported rows always reconciles with the
 * on-screen daily totals of the covered days.
 */
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentQueryService } from './payment-query.service';

const D = (n: number) => new Prisma.Decimal(n);

const rcpt = (over: Record<string, unknown>) => ({
  id: `r-${over.receiptNumber ?? 'x'}`,
  receiptNumber: 'RT-202608-00001',
  receiptType: 'INSTALLMENT',
  amount: D(3771),
  installmentNo: 1,
  paymentId: 'pay-1',
  paymentMethod: 'CASH',
  paidDate: new Date('2026-08-16T07:00:00'),
  issuedById: 'user-1',
  contract: {
    contractNumber: 'TEST-20260809-004',
    customer: { name: 'ทดสอบ' },
    branch: { name: 'ลพบุรี' },
  },
  ...over,
});

function setup(rows: ReturnType<typeof rcpt>[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = {
    receipt: { findMany },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-1', name: 'เอกนรินทร์ คงเดช' }]) },
  } as unknown as PrismaService;
  return { service: new PaymentQueryService(prisma), findMany };
}

describe('getDailySummaryExport — ช่วงวันสำหรับส่งออก Excel', () => {
  it('returns every receipt of the window with issuer names resolved', async () => {
    const { service } = setup([
      rcpt({ receiptNumber: 'RT-202608-00003' }),
      rcpt({ receiptNumber: 'RT-202608-00010', receiptType: 'RESCHEDULE_FEE', amount: D(857) }),
    ]);

    const res = await service.getDailySummaryExport('2026-08-16', '2026-08-18');

    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].issuedByName).toBe('เอกนรินทร์ คงเดช');
    expect(res.total).toBe(2);
    expect(res.truncated).toBe(false);
  });

  it('uses the getDailySummary universe over an INCLUSIVE from–to window', async () => {
    const { service, findMany } = setup([]);

    await service.getDailySummaryExport('2026-08-16', '2026-08-18', 'branch-1');

    const call = findMany.mock.calls[0][0];
    expect(call.where.isVoided).toBe(false);
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.receiptType).toEqual({ not: 'CREDIT_NOTE' });
    expect(call.where.contract).toEqual({ branchId: 'branch-1' });
    // Inclusive end → start of the NEXT day, same boundary math as the day view.
    expect(call.where.paidDate.gte).toEqual(new Date(2026, 7, 16));
    expect(call.where.paidDate.lt).toEqual(new Date(2026, 7, 19));
    expect(call.orderBy).toEqual({ paidDate: 'asc' });
  });

  it('a single-day range (from == to) is valid', async () => {
    const { service, findMany } = setup([]);

    await service.getDailySummaryExport('2026-08-16', '2026-08-16');

    const where = findMany.mock.calls[0][0].where;
    expect(where.paidDate.gte).toEqual(new Date(2026, 7, 16));
    expect(where.paidDate.lt).toEqual(new Date(2026, 7, 17));
  });

  it('rejects from > to in Thai', async () => {
    const { service } = setup([]);

    await expect(service.getDailySummaryExport('2026-08-18', '2026-08-16')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a malformed date', async () => {
    const { service } = setup([]);

    await expect(service.getDailySummaryExport('16/08/2569', '2026-08-18')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a window longer than 186 days (same cap as the PEAK export)', async () => {
    const { service } = setup([]);

    await expect(service.getDailySummaryExport('2026-01-01', '2026-08-16')).rejects.toThrow(
      /186/,
    );
  });

  it('caps at 10,000 rows and flags truncation instead of hanging the browser', async () => {
    const many = Array.from({ length: 10_001 }, (_, i) =>
      rcpt({ receiptNumber: `RT-202608-${String(i).padStart(5, '0')}` }),
    );
    const { service, findMany } = setup(many);

    const res = await service.getDailySummaryExport('2026-08-01', '2026-08-31');

    expect(findMany.mock.calls[0][0].take).toBe(10_001);
    expect(res.rows).toHaveLength(10_000);
    expect(res.truncated).toBe(true);
  });
});
