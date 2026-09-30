/**
 * สรุปรายวัน = เงินสดที่รับจริงในวันนั้น (receipt-based), not "งวดที่ตัดหนี้ได้".
 *
 * Reported on prod contract TEST-20260809-004 (2026-08-18): งวด 2 showed 3,771
 * in สรุปรายวัน while ประวัติการชำระ showed 3,800. Both were "right" — the daily
 * tab read `Payment.amountPaid` (the obligation cleared: cash 3,800 capped at
 * remaining 3,771, the 29฿ overage parked as a 21-1103 advance) while the
 * history read `Receipt.amount` (the cash). A tab whose KPI card says
 * "แยกตามวิธี → เงินสด" must report CASH, so it is now sourced from Receipt.
 *
 * Three defects fall out of the old source and are pinned below:
 *   1. per-row amount ≠ cash (advance credit created/consumed shifts it);
 *   2. `Payment.paidDate` is only set when the installment CLOSES, so a partial
 *      payment's cash was invisible on the day it was received, then landed in
 *      full on the closing day;
 *   3. N receipts on one installment collapsed into ONE row (จำนวนรายการ lied).
 * Plus the byMethod card, which summed the current PAGE while ยอดรวม summed the
 * whole day — the two cards disagreed on any day past `limit` rows.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentQueryService } from './payment-query.service';

const D = (n: number) => new Prisma.Decimal(n);

const CONTRACT = { contractNumber: 'TEST-20260809-004', customer: { name: 'ทดสอบ ค้าง 3 งวด' } };

const rcpt = (over: Record<string, unknown>) => ({
  id: `r-${over.receiptNumber}`,
  receiptNumber: 'RT-202608-00000',
  receiptType: 'INSTALLMENT',
  amount: D(0),
  installmentNo: 1,
  paymentId: 'pay-1',
  paymentMethod: 'CASH',
  paidDate: new Date('2026-08-16T07:00:00.000Z'),
  issuedById: 'user-1',
  contract: CONTRACT,
  ...over,
});

function setup(rows: ReturnType<typeof rcpt>[], groupRows?: unknown[]) {
  const receiptFindMany = jest.fn().mockResolvedValue(rows);
  const prisma = {
    receipt: {
      findMany: receiptFindMany,
      count: jest.fn().mockResolvedValue(rows.length),
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          amount: rows.reduce((a, r) => a.plus(r.amount as Prisma.Decimal), D(0)),
        },
      }),
      groupBy: jest.fn().mockResolvedValue(
        groupRows ?? [{ paymentMethod: 'CASH', _sum: { amount: rows.reduce((a, r) => a.plus(r.amount as Prisma.Decimal), D(0)) } }],
      ),
    },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-1', name: 'เอกนรินทร์ คงเดช' }]) },
  } as unknown as PrismaService;
  return { service: new PaymentQueryService(prisma), prisma, receiptFindMany };
}

describe('getDailySummary — receipt-based (เงินสดที่รับจริง)', () => {
  it('reports the CASH on the receipt, not the obligation cleared (งวด 2 = 3,800)', async () => {
    const { service } = setup([
      rcpt({ receiptNumber: 'RT-202608-00004', installmentNo: 2, amount: D(3800), paymentId: 'pay-2' }),
    ]);

    const summary = await service.getDailySummary('2026-08-16');

    expect(summary.data).toHaveLength(1);
    expect(Number(summary.data[0].amount)).toBe(3800);
    expect(summary.totalAmount).toBe(3800);
  });

  it('keeps an installment paid in two receipts as TWO rows (จำนวนรายการ tells the truth)', async () => {
    const { service } = setup([
      rcpt({ receiptNumber: 'RT-202608-00016', installmentNo: 4, amount: D(1771), paymentId: 'pay-4' }),
      rcpt({ receiptNumber: 'RT-202608-00015', installmentNo: 4, amount: D(2000), paymentId: 'pay-4' }),
    ]);

    const summary = await service.getDailySummary('2026-08-16');

    expect(summary.data).toHaveLength(2);
    expect(summary.totalPayments).toBe(2);
    expect(summary.totalAmount).toBe(3771);
  });

  it('excludes voided receipts and credit notes from the query', async () => {
    const { service, receiptFindMany } = setup([]);

    await service.getDailySummary('2026-08-16');

    const where = receiptFindMany.mock.calls[0][0].where;
    expect(where.isVoided).toBe(false);
    expect(where.deletedAt).toBeNull();
    expect(where.receiptType).toEqual({ not: 'CREDIT_NOTE' });
  });

  it('byMethod is grouped over the WHOLE day, not just the current page', async () => {
    const { service, prisma } = setup(
      [rcpt({ receiptNumber: 'RT-202608-00004', amount: D(3800) })],
      [
        { paymentMethod: 'CASH', _sum: { amount: D(20000) } },
        { paymentMethod: 'TRANSFER', _sum: { amount: D(2666) } },
      ],
    );

    const summary = await service.getDailySummary('2026-08-16', undefined, 1, 1);

    expect(summary.byMethod).toEqual({ CASH: 20000, TRANSFER: 2666 });
    expect((prisma.receipt.groupBy as jest.Mock)).toHaveBeenCalled();
  });

  it('PR3: ใบใช้เครดิตชำระ (CREDIT_BALANCE) ยังเป็นรายการ แต่ยอดรวม / แยกตามวิธี / ค่าปรับรวม นับเฉพาะเงินรับเข้า', async () => {
    const { service, prisma, receiptFindMany } = setup([
      rcpt({ receiptNumber: 'RT-202610-00001', amount: D(1515.83), paymentMethod: 'ONLINE_GATEWAY' }),
      rcpt({ receiptNumber: 'RT-202610-00002', amount: D(2000), paymentMethod: 'CREDIT_BALANCE' }),
    ]);

    const summary = await service.getDailySummary('2026-10-02');

    // รายการและจำนวนรายการแสดงครบทุกใบ (ไม่มีเงื่อนไขช่องทาง)
    expect(summary.data).toHaveLength(2);
    expect(receiptFindMany.mock.calls[0][0].where.OR).toBeUndefined();
    expect((prisma.receipt.count as jest.Mock).mock.calls[0][0].where.OR).toBeUndefined();
    // ยอดเงิน: ใบใช้เครดิตไม่ใช่เงินที่รับวันนั้น · ช่องทางว่าง (ใบเก่า) ยังนับ — OR คู่กับ null (NOT ของ SQL ตัด null ทิ้ง)
    const moneyIn = [{ paymentMethod: null }, { paymentMethod: { not: 'CREDIT_BALANCE' } }];
    expect((prisma.receipt.aggregate as jest.Mock).mock.calls[0][0].where.OR).toEqual(moneyIn);
    expect((prisma.receipt.groupBy as jest.Mock).mock.calls[0][0].where.OR).toEqual(moneyIn);
    expect(receiptFindMany.mock.calls[1][0].where.OR).toEqual(moneyIn); // งวดที่นับค่าปรับ
  });

  it('scopes to a branch through the contract relation', async () => {
    const { service, receiptFindMany } = setup([]);

    await service.getDailySummary('2026-08-16', 'branch-1');

    expect(receiptFindMany.mock.calls[0][0].where.contract).toEqual({ branchId: 'branch-1' });
  });

  it('empty day → zeros, not nulls', async () => {
    const { service, prisma } = setup([], []);
    (prisma.receipt.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } });

    const summary = await service.getDailySummary('2026-08-16');

    expect(summary.totalAmount).toBe(0);
    expect(summary.totalLateFees).toBe(0);
    expect(summary.byMethod).toEqual({});
  });

  it('late fee is the NET of the distinct installments settled that day', async () => {
    const { service, prisma } = setup([
      rcpt({ receiptNumber: 'RT-202608-00016', installmentNo: 4, amount: D(1771), paymentId: 'pay-4' }),
      rcpt({ receiptNumber: 'RT-202608-00015', installmentNo: 4, amount: D(2000), paymentId: 'pay-4' }),
    ]);
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([
      { lateFee: D(100), lateFeeWaived: false, waivedAmount: D(40) },
    ]);

    const summary = await service.getDailySummary('2026-08-16');

    // ONE installment settled by two receipts → its fee counted once, net of waiver.
    expect(summary.totalLateFees).toBe(60);
    const feeWhere = (prisma.payment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(feeWhere.id).toEqual({ in: ['pay-4'] });
  });

  it('legacy full waiver (lateFeeWaived with no waivedAmount) nets to zero', async () => {
    const { service, prisma } = setup([
      rcpt({ receiptNumber: 'RT-202608-00003', installmentNo: 1, amount: D(3771), paymentId: 'pay-1' }),
    ]);
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([
      { lateFee: D(100), lateFeeWaived: true, waivedAmount: null },
    ]);

    const summary = await service.getDailySummary('2026-08-16');

    expect(summary.totalLateFees).toBe(0);
  });

  it('attaches the issuer name via the batch user lookup (no Receipt→User relation)', async () => {
    const { service } = setup([rcpt({ receiptNumber: 'RT-202608-00004', amount: D(3800) })]);

    const summary = await service.getDailySummary('2026-08-16');

    expect(summary.data[0].issuedByName).toBe('เอกนรินทร์ คงเดช');
  });
});
