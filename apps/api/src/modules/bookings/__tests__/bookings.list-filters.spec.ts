import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BookingsService, expiringBefore, buildBookingSearchWhere } from '../bookings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShopBookingDepositTemplate } from '../../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopBookingDepositAppliedTemplate } from '../../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopBookingRefundTemplate } from '../../journal/cpa-templates/shop-booking-refund.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';

jest.mock('../../../utils/sequence.util', () => ({
  generateBookingNumber: jest.fn().mockResolvedValue('BK-20261005-0001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000001'),
}));

const OWNER = { id: 'u-owner', role: 'OWNER', branchId: null as string | null };
const SALES_BR1 = { id: 'u-sales', role: 'SALES', branchId: 'br-1' };

describe('BookingsService.findAll — ตัวกรองหน้ารายการใหม่', () => {
  let service: BookingsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
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

  const whereOf = () => prisma.booking.findMany.mock.calls[0][0].where;
  const orderOf = () => prisma.booking.findMany.mock.calls[0][0].orderBy;

  it('open=true → เฉพาะใบที่ยังเปิดอยู่ และเรียงใกล้หมดอายุก่อน', async () => {
    await service.findAll({ open: true }, OWNER);
    expect(whereOf().status).toEqual({ in: ['PENDING_DEPOSIT', 'PAID'] });
    expect(orderOf()).toEqual([{ expireDate: 'asc' }, { id: 'desc' }]);
  });

  it('status=CLOSED → ขายแล้ว/ยกเลิก/หมดอายุ และเรียงใบใหม่สุดก่อน', async () => {
    await service.findAll({ status: 'CLOSED' }, OWNER);
    expect(whereOf().status).toEqual({ in: ['CONVERTED', 'CANCELED', 'EXPIRED'] });
    expect(orderOf()).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('status เดี่ยวยังใช้ได้เหมือนเดิม (หน้าเว็บเก่า)', async () => {
    await service.findAll({ status: 'PAID' }, OWNER);
    expect(whereOf().status).toBe('PAID');
    expect(orderOf()[0]).toEqual({ createdAt: 'desc' });
  });

  it('status ที่ไม่รู้จัก → BadRequest ไม่ยิง query', async () => {
    await expect(service.findAll({ status: 'HELLO' }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it('expiringDays=3 → ใบเปิดที่ expireDate ≤ เที่ยงคืนไทยของอีก 4 วัน (= ใช้ได้ถึงสิ้นวันที่ +3 · รวมใบที่เลยกำหนดแล้วแต่ยังไม่ปิด)', async () => {
    const before = Date.now();
    await service.findAll({ expiringDays: 3 }, OWNER);
    const where = whereOf();
    expect(where.status).toEqual({ in: ['PENDING_DEPOSIT', 'PAID'] });
    expect(where.expireDate.gt).toBeUndefined();
    expect(where.expireDate.lt).toBeUndefined();
    const lte: Date = where.expireDate.lte;
    const expected = expiringBefore(new Date(before), 3);
    expect(Math.abs(lte.getTime() - expected.getTime())).toBeLessThan(5_000);
  });

  it('search เบอร์ที่มีขีด/เว้นวรรค → ค้น phone แบบ normalize + เลขที่ + ชื่อ + IMEI', async () => {
    await service.findAll({ search: '081-234 5678' }, OWNER);
    const or = whereOf().OR;
    expect(or).toEqual(expect.arrayContaining([
      { bookingNumber: { contains: '081-234 5678', mode: 'insensitive' } },
      { customer: { name: { contains: '081-234 5678', mode: 'insensitive' } } },
      { items: { some: { product: { imeiSerial: { contains: '081-234 5678', mode: 'insensitive' } } } } },
      { customer: { phone: { contains: '0812345678' } } },
    ]));
  });

  it('search ที่เป็นข้อความ → ไม่เพิ่มเงื่อนไขเบอร์โทร', () => {
    const or = buildBookingSearchWhere('สมชาย');
    expect(or.some((w) => 'customer' in w && (w.customer as { phone?: unknown }).phone)).toBe(false);
    expect(or).toHaveLength(3);
  });

  it('sort/order ที่ส่งมาชนะค่าเริ่มต้น', async () => {
    await service.findAll({ open: true, sort: 'createdAt', order: 'asc' }, OWNER);
    expect(orderOf()).toEqual([{ createdAt: 'asc' }, { id: 'desc' }]);
  });

  it('from/to เป็นวันไทย YYYY-MM-DD → createdAt [gte, lt) และรูปแบบผิด → BadRequest', async () => {
    await service.findAll({ from: '2026-10-01', to: '2026-10-05' }, OWNER);
    const createdAt = whereOf().createdAt;
    expect(createdAt.gte.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(createdAt.lt.toISOString()).toBe('2026-10-05T17:00:00.000Z');
    await expect(service.findAll({ from: '1/10/2026' }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('SALES ถูกบังคับสาขาตัวเองเสมอ', async () => {
    await service.findAll({ open: true, branchId: 'br-1' }, SALES_BR1);
    expect(whereOf().branchId).toBe('br-1');
  });

  it('expiringBefore — เที่ยงคืนไทยของ (วันนี้ + days + 1)', () => {
    // 2026-10-05 10:00 เวลาไทย = 03:00Z → อีก 3 วัน = ใช้ได้ถึงสิ้นวัน 8 ต.ค. ซึ่งเก็บเป็น 9 ต.ค. 00:00 ไทย = 8 ต.ค. 17:00Z ⇒ เทียบด้วย lte
    expect(expiringBefore(new Date('2026-10-05T03:00:00.000Z'), 3).toISOString()).toBe('2026-10-08T17:00:00.000Z');
  });
});
