import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BookingsService } from '../bookings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShopBookingDepositTemplate } from '../../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopBookingRefundTemplate } from '../../journal/cpa-templates/shop-booking-refund.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

jest.mock('../../../utils/sequence.util', () => ({
  generateBookingNumber: jest.fn(), generateSaleNumber: jest.fn(),
}));

const OWNER = { id: 'u-owner', role: 'OWNER', branchId: null as string | null };
const SALES_NO_BRANCH = { id: 'u-sales', role: 'SALES', branchId: null as string | null };
const SALES_BR1 = { id: 'u-sales', role: 'SALES', branchId: 'br-1' };

describe('BookingsService.summary', () => {
  let service: BookingsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      booking: {
        // ลำดับเดียวกับ Promise.all ใน summary(): total, open, pending, paid, expiring, converted, canceled, expired
        count: jest.fn()
          .mockResolvedValueOnce(8).mockResolvedValueOnce(5).mockResolvedValueOnce(1).mockResolvedValueOnce(4)
          .mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(1),
        aggregate: jest.fn()
          .mockResolvedValueOnce({ _sum: { depositAmount: new Prisma.Decimal('33900') } })
          .mockResolvedValueOnce({ _sum: { depositAmount: new Prisma.Decimal('3000') } }),
      },
    };
    const stub = { execute: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopBookingDepositTemplate, useValue: stub },
        { provide: ShopBookingForfeitTemplate, useValue: stub },
        { provide: ShopBookingDepositAppliedTemplate, useValue: stub },
        { provide: ShopCashSaleTemplate, useValue: stub },
        { provide: ShopBookingRefundTemplate, useValue: stub },
        { provide: ShopAccountResolver, useValue: { resolveInflowCashAccount: jest.fn() } },
      ],
    }).compile();
    service = mod.get(BookingsService);
  });

  it('รวมตัวเลขทุกการ์ดในรอบเดียว และยอดเงินเป็น string 2 ตำแหน่ง', async () => {
    const result = await service.summary({}, OWNER);
    expect(result).toEqual({
      total: 8, open: 5, pendingDeposit: 1, paid: 4, paidDepositHeld: '33900.00', expiringWithin3Days: 3,
      closed: { converted: 1, canceled: 1, expired: 1, total: 3 }, forfeitedThisMonth: '3000.00',
    });
    expect(prisma.booking.count).toHaveBeenCalledTimes(8);
    expect(prisma.booking.aggregate).toHaveBeenCalledTimes(2);
  });

  it('การ์ดกับตารางอ่านเงื่อนไขเดียวกัน: "ใกล้หมดอายุ" = สถานะเปิด + expireDate lte เที่ยงคืนไทยอีก 4 วัน', async () => {
    await service.summary({}, OWNER);
    const expiringCall = prisma.booking.count.mock.calls[4][0].where;
    expect(expiringCall.status).toEqual({ in: ['PENDING_DEPOSIT', 'PAID'] });
    expect(expiringCall.expireDate.lte).toBeInstanceOf(Date);
    expect(expiringCall.expireDate.gt).toBeUndefined();
  });

  it('ริบมัดจำเดือนนี้: EXPIRED ที่เคยรับมัดจำ และ expireDate อยู่ในเดือนไทยนี้ — ไม่สนช่วงวันที่ที่กรอง', async () => {
    await service.summary({ from: '2026-01-01', to: '2026-01-31' }, OWNER);
    const forfeit = prisma.booking.aggregate.mock.calls[1][0].where;
    expect(forfeit.status).toBe('EXPIRED');
    expect(forfeit.depositPaidAt).toEqual({ not: null });
    expect(forfeit.createdAt).toBeUndefined();
    expect(forfeit.expireDate.gte).toBeInstanceOf(Date);
    expect(forfeit.expireDate.lt).toBeInstanceOf(Date);
    // ส่วนการ์ดอื่นเคารพช่วงวันที่
    expect(prisma.booking.count.mock.calls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
  });

  it('SALES ไม่มีสาขา → ศูนย์ทั้งชุด ไม่ยิง query', async () => {
    const result = await service.summary({}, SALES_NO_BRANCH);
    expect(result.total).toBe(0);
    expect(result.paidDepositHeld).toBe('0.00');
    expect(prisma.booking.count).not.toHaveBeenCalled();
  });

  it('SALES ถูกบังคับสาขาตัวเองทุก query', async () => {
    await service.summary({}, SALES_BR1);
    for (const call of prisma.booking.count.mock.calls) expect(call[0].where.branchId).toBe('br-1');
    for (const call of prisma.booking.aggregate.mock.calls) expect(call[0].where.branchId).toBe('br-1');
  });
});
