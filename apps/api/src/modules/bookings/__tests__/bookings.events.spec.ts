import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { BookingsService, BOOKING_EVENT_ACTIONS } from '../bookings.service';
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

describe('BookingsService — ไทม์ไลน์เหตุการณ์ของใบจอง', () => {
  let service: BookingsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  const booking = { id: 'bk-1', bookingNumber: 'BK-20261005-0001', status: 'PAID', branchId: 'br-1', items: [] };

  beforeEach(async () => {
    const txAuditLog = { create: jest.fn().mockResolvedValue({ id: 'al-new' }) };
    prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue(booking) },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'al-1', action: 'BOOKING_CREATED', createdAt: new Date('2026-10-05T03:42:00Z'),
            newValue: { bookingNumber: 'BK-20261005-0001' }, user: { id: 'u-sales', name: 'น้ำ' } },
          { id: 'al-2', action: 'BOOKING_DEPOSIT_PAID', createdAt: new Date('2026-10-05T03:55:00Z'),
            newValue: { depositMethod: 'CASH', depositAmount: '5000.00' }, user: { id: 'u-sales', name: 'น้ำ' } },
        ]),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({
        $queryRaw: jest.fn().mockResolvedValue([]),
        booking: {
          findFirst: jest.fn().mockResolvedValue({ id: 'bk-1', status: 'PAID', branchId: 'br-1',
            totalAmount: new Prisma.Decimal(10000), depositAmount: new Prisma.Decimal(1000),
            expireDate: new Date(Date.now() + 86_400_000) }),
          update: jest.fn().mockResolvedValue({ id: 'bk-1', expireDate: new Date('2026-10-12T17:00:00.000Z'),
            depositAmount: new Prisma.Decimal(1000), totalAmount: new Prisma.Decimal(10000), notes: 'แก้แล้ว' }),
        },
        auditLog: txAuditLog,
      })),
      _txAuditLog: txAuditLog,
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

  it('findOne — แปะ events จาก AuditLog ของใบนี้ เรียงเก่า→ใหม่ พร้อมชื่อผู้ทำ', async () => {
    const result = await service.findOne('bk-1', OWNER);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entity: 'booking', entityId: 'bk-1', action: { in: [...BOOKING_EVENT_ACTIONS] } },
      orderBy: { createdAt: 'asc' },
    }));
    expect(result.events).toEqual([
      { id: 'al-1', kind: 'BOOKING_CREATED', at: '2026-10-05T03:42:00.000Z', actor: { id: 'u-sales', name: 'น้ำ' },
        data: { bookingNumber: 'BK-20261005-0001' } },
      { id: 'al-2', kind: 'BOOKING_DEPOSIT_PAID', at: '2026-10-05T03:55:00.000Z', actor: { id: 'u-sales', name: 'น้ำ' },
        data: { depositMethod: 'CASH', depositAmount: '5000.00' } },
    ]);
    expect(result.bookingNumber).toBe('BK-20261005-0001');
  });

  it('update — เขียน AuditLog BOOKING_UPDATED ในธุรกรรมเดียว บอกว่าแก้ช่องไหน', async () => {
    await service.update('bk-1', { notes: 'แก้แล้ว', expireDate: '2026-10-12T17:00:00.000Z' }, OWNER);
    expect(prisma._txAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'BOOKING_UPDATED', entity: 'booking', entityId: 'bk-1', userId: 'u-owner',
        newValue: expect.objectContaining({ changed: ['notes', 'expireDate'] }),
      }),
    });
  });
});
