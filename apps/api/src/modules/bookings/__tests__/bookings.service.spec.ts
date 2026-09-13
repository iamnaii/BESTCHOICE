import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BookingsService } from '../bookings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShopBookingDepositTemplate } from '../../journal/cpa-templates/shop-booking-deposit.template';
import { ShopBookingForfeitTemplate } from '../../journal/cpa-templates/shop-booking-forfeit.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { ShopBookingDepositAppliedTemplate } from '../../journal/cpa-templates/shop-booking-deposit-applied.template';
import { ShopCashSaleTemplate } from '../../journal/cpa-templates/shop-cash-sale.template';
import { ShopBookingRefundTemplate } from '../../journal/cpa-templates/shop-booking-refund.template';
import { TEST_CUSTOMER_ADDRESS } from '../../../utils/test-data-markers';

// Mock sequence util so tests don't need a real `booking` delegate
jest.mock('../../../utils/sequence.util', () => ({
  generateBookingNumber: jest.fn().mockResolvedValue('BK-20260517-0001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000123'),
}));

const OWNER = { id: 'u-owner', role: 'OWNER', branchId: null as string | null };
const SALES_BR1 = { id: 'u-sales', role: 'SALES', branchId: 'br-1' };
const SALES_BR2 = { id: 'u-sales-other', role: 'SALES', branchId: 'br-2' };

describe('BookingsService', () => {
  let service: BookingsService;
  let shopBookingDepositTemplate: { execute: jest.Mock };
  let shopBookingForfeitTemplate: { execute: jest.Mock };
  let shopAccountResolver: { resolveInflowCashAccount: jest.Mock; resolveProductAccounts: jest.Mock };
  let shopBookingDepositAppliedTemplate: { execute: jest.Mock };
  let shopCashSaleTemplate: { execute: jest.Mock };
  let shopBookingRefundTemplate: { execute: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const paidBooking = () => ({ id: 'bk-1', bookingNumber: 'BK-TEST', status: 'PAID', branchId: 'br-1',
    customerId: 'cust-1', customer: { name: 'Synthetic', phone: '0000000000', addressCurrent: null },
    convertedToSaleId: null, expireDate: new Date(Date.now() + 86400000),
    depositAmount: new Prisma.Decimal(1000), totalAmount: new Prisma.Decimal(10000), depositMethod: 'CASH',
    items: [{ productId: 'prod-1', quantity: 1, unitPrice: 10000, amount: 10000 }],
  });

  it.each(['multiple items', 'quantity greater than one'])('does not discard booking value during conversion: %s', async scenario => {
    const booking = paidBooking();
    if (scenario === 'multiple items') booking.items.push({ ...booking.items[0], productId: 'prod-2' });
    else booking.items[0].quantity = 2;
    prisma.booking.findFirst.mockResolvedValue(booking);
    await expect(service.convertToSale('bk-1', { collectBalance: true }, SALES_BR1.id, SALES_BR1)).rejects.toThrow(/1 เครื่อง/);
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
  });

  it.each(['foreign branch', 'previously damaged'])('applies the normal sale product policy to bookings: %s', async scenario => {
    prisma.booking.findFirst.mockResolvedValue(paidBooking());
    prisma._tx.product.findUnique.mockResolvedValue({ id: 'prod-1', status: 'IN_STOCK', deletedAt: null,
      name: 'Synthetic device', imeiSerial: 'SYNTHETIC', po: null,
      branchId: scenario === 'foreign branch' ? 'br-2' : 'br-1', wasPreviouslyDamaged: scenario === 'previously damaged' });
    await expect(service.convertToSale('bk-1', { collectBalance: true, paymentMethod: 'CASH' }, SALES_BR1.id, SALES_BR1)).rejects.toThrow();
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
  });

  it.each([
    { depositAmount: 2000 }, { customerId: 'cust-2' }, { branchId: 'br-2' },
    { items: [{ description: 'changed device', quantity: 1, unitPrice: 9000 }] },
  ])('does not silently edit received money or its owner/product: %j', async patch => {
    prisma.booking.findFirst.mockResolvedValue({ id: 'bk-1', status: 'PAID', branchId: 'br-1',
      depositAmount: new Prisma.Decimal(1000), totalAmount: new Prisma.Decimal(10000),
      expireDate: new Date(Date.now() + 86400000) });
    await expect(service.update('bk-1', patch, OWNER)).rejects.toThrow(/รับมัดจำแล้ว/);
    expect(prisma._tx.booking.update).not.toHaveBeenCalled();
    expect(prisma._tx.bookingItem.deleteMany).not.toHaveBeenCalled();
  });

  it('checks the original deposit when an unpaid booking total is reduced', async () => {
    prisma.booking.findFirst.mockResolvedValue({ id: 'bk-1', status: 'PENDING_DEPOSIT', branchId: 'br-1',
      depositAmount: new Prisma.Decimal(5000), totalAmount: new Prisma.Decimal(10000),
      expireDate: new Date(Date.now() + 86400000) });
    await expect(service.update('bk-1', { items: [{ description: 'cheaper', quantity: 1, unitPrice: 1000 }] }, SALES_BR1))
      .rejects.toThrow(/มัดจำ/);
    expect(prisma._tx.bookingItem.deleteMany).not.toHaveBeenCalled();
  });


  afterEach(() => jest.useRealTimers());

  it('stores the resolved SHOP receipt account when compatibility code is omitted', async () => {
    prisma.booking.findFirst.mockResolvedValue({ ...paidBooking(), status: 'PENDING_DEPOSIT' });
    await service.payDeposit('bk-1', { depositMethod: 'CASH' } as Parameters<typeof service.payDeposit>[1], SALES_BR1);
    expect(prisma._tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ depositAccountCode: 'S11-1101' }),
    }));
  });
  it('rejects a misleading FINANCE receipt account before recording payment', async () => {
    prisma.booking.findFirst.mockResolvedValue({ ...paidBooking(), status: 'PENDING_DEPOSIT' });
    await expect(service.payDeposit('bk-1', { depositMethod: 'CASH', depositAccountCode: '11-1101' }, SALES_BR1)).rejects.toThrow(/บัญชี/);
    expect(shopBookingDepositTemplate.execute).not.toHaveBeenCalled();
  });
  it('requires the method of newly collected balance', async () => {
    prisma.booking.findFirst.mockResolvedValue(paidBooking());
    await expect(service.convertToSale('bk-1', { collectBalance: true }, SALES_BR1.id, SALES_BR1)).rejects.toThrow(/วิธีรับ/);
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
  });
  it.each(['pay', 'convert', 'extend', 'cancel'])('blocks %s at the exact expiry instant', async action => {
    const cutoff = new Date('2026-09-11T17:00:00.000Z');
    jest.useFakeTimers().setSystemTime(cutoff);
    prisma.booking.findFirst.mockResolvedValue({ ...paidBooking(), expireDate: cutoff,
      status: action === 'pay' ? 'PENDING_DEPOSIT' : 'PAID' });
    const mutation = action === 'pay' ? service.payDeposit('bk-1', { depositMethod: 'CASH', depositAccountCode: 'S11-1101' }, SALES_BR1)
      : action === 'convert' ? service.convertToSale('bk-1', { collectBalance: true, paymentMethod: 'CASH' }, SALES_BR1.id, SALES_BR1)
      : action === 'extend' ? service.update('bk-1', { expireDate: '2026-09-15T17:00:00.000Z' }, SALES_BR1)
      : service.cancel('bk-1', {}, SALES_BR1);
    await expect(mutation).rejects.toThrow(/หมดอายุ/);
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
    expect(prisma._tx.booking.updateMany).not.toHaveBeenCalled();
  });
  it('expires an unpaid booking without forfeiting money that was never received', async () => {
    const cutoff = new Date('2026-09-11T17:00:00.000Z');
    prisma.booking.findMany.mockResolvedValue([{ id: 'bk-1' }]);
    prisma.booking.findFirst.mockResolvedValue({ ...paidBooking(), status: 'PENDING_DEPOSIT', expireDate: cutoff });
    expect(await service.autoExpire(cutoff)).toBe(1);
    expect(shopBookingForfeitTemplate.execute).not.toHaveBeenCalled();
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ newValue: expect.objectContaining({ forfeitAmount: '0.00' }) }),
    }));
  });

  beforeEach(async () => {
    const txAuditLog = { create: jest.fn().mockResolvedValue({ id: 'log-1' }) };

    const txBooking = {
      create: jest.fn((args) =>
        Promise.resolve({
          id: 'bk-new',
          bookingNumber: 'BK-20260517-0001',
          status: 'PENDING_DEPOSIT',
          depositAmount: args.data.depositAmount,
          totalAmount: args.data.totalAmount,
          expireDate: args.data.expireDate,
          branchId: args.data.branchId,
          ...args.data,
          items: [{ id: 'bki-1', quantity: 1 }],
        }),
      ),
      update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(args => prisma.booking.findFirst(args)),
    };

    const txBookingItem = {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    };

    const txSale = {
      create: jest.fn((args) =>
        Promise.resolve({ id: 'sale-new', saleNumber: 'SL000123', ...args.data }),
      ),
    };

    const txProduct = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({
        branchId: 'br-1', wasPreviouslyDamaged: false, id: 'prod-1',
        status: 'IN_STOCK',
        deletedAt: null,
        imeiSerial: '356789012345678',
        name: 'iPhone 15',
        po: null,
      }),
      update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
    };

    const txCommissionRule = {
      findFirst: jest.fn().mockResolvedValue({ rate: 0.03 }),
    };

    const txSalesCommission = {
      create: jest.fn((args) => Promise.resolve({ id: 'cm-1', ...args.data })),
    };

    const txProductReservation = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    prisma = {
      booking: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'cust-1',
          name: 'ลูกค้าจริง',
          phone: '0891234567',
          addressCurrent: 'กรุงเทพ',
        }),
      },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'br-1' }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u-admin' }) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (fn: any) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([]),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          customer: { findFirst: jest.fn((args: any) => prisma.customer.findFirst(args)) },
          booking: txBooking,
          bookingItem: txBookingItem,
          sale: txSale,
          product: txProduct,
          commissionRule: txCommissionRule,
          salesCommission: txSalesCommission,
          auditLog: txAuditLog,
          productReservation: txProductReservation,
        }),
      ),
      _tx: {
        booking: txBooking,
        bookingItem: txBookingItem,
        sale: txSale,
        product: txProduct,
        commissionRule: txCommissionRule,
        salesCommission: txSalesCommission,
        auditLog: txAuditLog,
        productReservation: txProductReservation,
      },
    };

    // A5 (ผู้สอบ 2026-08-25): payDeposit/autoExpire โพสต์ JE ฝั่ง SHOP แล้ว
    // เทสชุดนี้ตรวจ logic ใบจอง ไม่ใช่ตัว JE (มี spec แยกที่
    // journal/cpa-templates/__tests__/shop-booking-deposit-forfeit.spec.ts)
    // จึง mock ให้ผ่าน ๆ แต่ยัง assert ได้ว่าถูกเรียกด้วยยอดที่ถูกต้อง
    shopBookingDepositTemplate = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-D', journalEntryId: 'je-d' }) };
    shopBookingForfeitTemplate = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-F', journalEntryId: 'je-f' }) };
    shopAccountResolver = {
      resolveInflowCashAccount: jest.fn().mockResolvedValue('S11-1101'),
      resolveProductAccounts: jest.fn().mockReturnValue({
        inventoryAccountCode: 'S11-2001',
        cogsAccountCode: 'S50-1101',
        revenueAccountCode: 'S41-1101',
      }),
    };
    shopBookingDepositAppliedTemplate = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-A', journalEntryId: 'je-a' }) };
    shopCashSaleTemplate = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-S', journalEntryId: 'je-s' }) };
    shopBookingRefundTemplate = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-R', journalEntryId: 'je-r' }) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ShopBookingDepositTemplate, useValue: shopBookingDepositTemplate },
        { provide: ShopBookingForfeitTemplate, useValue: shopBookingForfeitTemplate },
        { provide: ShopAccountResolver, useValue: shopAccountResolver },
        { provide: ShopBookingDepositAppliedTemplate, useValue: shopBookingDepositAppliedTemplate },
        { provide: ShopCashSaleTemplate, useValue: shopCashSaleTemplate },
        { provide: ShopBookingRefundTemplate, useValue: shopBookingRefundTemplate },
      ],
    }).compile();
    service = mod.get(BookingsService);
  });

  // 1. create — happy path
  it('create — computes totalAmount, defaults expireDate +7d, persists PENDING_DEPOSIT + audit', async () => {
    const result = await service.create(
      {
        customerId: 'cust-1',
        branchId: 'br-1',
        items: [
          { description: 'iPhone 15', quantity: 1, unitPrice: 35000 },
          { description: 'AirPods', quantity: 1, unitPrice: 5990 },
        ],
        depositAmount: 5000,
      },
      'user-1',
      OWNER,
    );

    expect(prisma.$transaction).toHaveBeenCalled();
    const createArgs = prisma._tx.booking.create.mock.calls[0][0];
    expect(Number(createArgs.data.totalAmount)).toBe(40990);
    expect(Number(createArgs.data.depositAmount)).toBe(5000);
    expect(createArgs.data.status).toBe('PENDING_DEPOSIT');
    expect(createArgs.data.bookingNumber).toBe('BK-20260517-0001');
    // Default expireDate roughly +7d (allow ±2d slack so test isn't flaky)
    const days =
      (new Date(createArgs.data.expireDate).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(5);
    expect(days).toBeLessThan(9);
    expect(result.id).toBe('bk-new');
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BOOKING_CREATED',
          entity: 'booking',
        }),
      }),
    );
  });

  it('create — uses Prisma.Decimal for totals (0.1+0.2 precision)', async () => {
    await service.create(
      {
        customerId: 'cust-1',
        branchId: 'br-1',
        items: [{ description: 'penny test', quantity: 3, unitPrice: 0.1 }],
        depositAmount: 0.1,
      },
      'user-1',
      OWNER,
    );
    const createArgs = prisma._tx.booking.create.mock.calls[0][0];
    expect(createArgs.data.totalAmount).toBeInstanceOf(Prisma.Decimal);
    expect(createArgs.data.depositAmount).toBeInstanceOf(Prisma.Decimal);
    expect(createArgs.data.totalAmount.toFixed(2)).toBe('0.30');
  });

  it('create — rejects depositAmount > totalAmount', async () => {
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          branchId: 'br-1',
          items: [{ description: 'X', quantity: 1, unitPrice: 1000 }],
          depositAmount: 5000, // > totalAmount 1000
        },
        'user-1',
        OWNER,
      ),
    ).rejects.toThrow(/มัดจำ.*ห้ามมากกว่า/);
  });

  it('create — SALES cannot create against another branch', async () => {
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          branchId: 'br-1',
          items: [{ description: 'X', quantity: 1, unitPrice: 1000 }],
          depositAmount: 500,
        },
        'user-1',
        SALES_BR2,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // 2. payDeposit — happy path + race protection
  it('payDeposit — PENDING_DEPOSIT → PAID with updateMany race claim + audit + persists depositAccountCode (C3)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PENDING_DEPOSIT',
      branchId: 'br-1',
      expireDate: new Date(Date.now() + 86400000),
    });
    await service.payDeposit(
      'bk-1',
      { depositMethod: 'CASH', depositAccountCode: 'S11-1101' },
      OWNER,
    );
    expect(prisma._tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bk-1',
          status: 'PENDING_DEPOSIT',
          // C6 — expireDate enforced atomically in the filter
          expireDate: expect.objectContaining({ gt: expect.any(Date) }),
        }),
        data: expect.objectContaining({
          status: 'PAID',
          depositMethod: 'CASH',
          depositAccountCode: 'S11-1101',
          depositReceivedById: OWNER.id,
        }),
      }),
    );
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BOOKING_DEPOSIT_PAID',
          newValue: expect.objectContaining({ depositAccountCode: 'S11-1101' }),
        }),
      }),
    );
  });

  it('payDeposit — race: second concurrent caller throws Conflict (updateMany count=0)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PENDING_DEPOSIT',
      branchId: 'br-1',
      expireDate: new Date(Date.now() + 86400000),
    });
    prisma._tx.booking.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.payDeposit(
        'bk-1',
        { depositMethod: 'CASH', depositAccountCode: 'S11-1101' },
        OWNER,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('payDeposit — rejects expired booking (pre-tx guard)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PENDING_DEPOSIT',
      branchId: 'br-1',
      expireDate: new Date(Date.now() - 86400000),
    });
    await expect(
      service.payDeposit(
        'bk-1',
        { depositMethod: 'CASH', depositAccountCode: 'S11-1101' },
        OWNER,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // 3. cancel — before expire only
  it('cancel — PAID booking before expire → CANCELED + refund noted', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      branchId: 'br-1',
      expireDate: new Date(Date.now() + 86400000),
      depositAmount: new Prisma.Decimal(1000),
      depositPaidAt: new Date(),
    });
    await service.cancel('bk-1', { cancelReason: 'ลูกค้าเปลี่ยนใจ' }, OWNER);
    expect(prisma._tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bk-1',
          status: { in: ['PENDING_DEPOSIT', 'PAID'] },
        }),
        data: expect.objectContaining({
          status: 'CANCELED',
          canceledById: OWNER.id,
          cancelReason: 'ลูกค้าเปลี่ยนใจ',
        }),
      }),
    );
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BOOKING_CANCELED',
          newValue: expect.objectContaining({ refundAmount: '1000.00' }),
        }),
      }),
    );
  });

  it('cancel — rejects when expireDate already past (use cron instead)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      branchId: 'br-1',
      expireDate: new Date(Date.now() - 86400000),
      depositAmount: new Prisma.Decimal(1000),
    });
    await expect(service.cancel('bk-1', {}, OWNER)).rejects.toThrow(/หมดอายุ/);
  });

  // 4. convertToSale — happy path + idempotency
  it('convertToSale — full-prepay (deposit==total) → CONVERTED + Sale.amountReceived=total + Product SOLD_CASH + commission (C1, C2)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      convertedToSaleId: null,
      bookingNumber: 'BK-20260517-0001',
      customerId: 'cust-1',
      customer: {
        id: 'cust-1',
        name: 'ลูกค้าจริง',
        phone: '0891234567',
        addressCurrent: 'กรุงเทพ',
      },
      branchId: 'br-1',
      totalAmount: new Prisma.Decimal(40990),
      depositAmount: new Prisma.Decimal(40990),
      depositMethod: 'CASH',
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 40990, amount: 40990 }],
    });
    const result = await service.convertToSale('bk-1', {}, 'user-1', OWNER);
    expect(prisma._tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bk-1',
          status: 'PAID',
          convertedToSaleId: null,
        }),
        data: expect.objectContaining({ status: 'CONVERTED' }),
      }),
    );
    const saleArgs = prisma._tx.sale.create.mock.calls[0][0];
    expect(Number(saleArgs.data.downPaymentAmount)).toBe(40990);
    expect(Number(saleArgs.data.sellingPrice)).toBe(40990);
    // C2 — amountReceived = totalAmount because the whole sale was prepaid
    expect(Number(saleArgs.data.amountReceived)).toBe(40990);
    // C1 — product flipped to SOLD_CASH
    expect(prisma._tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod-1', status: 'IN_STOCK', branchId: 'br-1', deletedAt: null },
        data: { status: 'SOLD_CASH' },
      }),
    );
    // C1 — SalesCommission row created
    expect(prisma._tx.salesCommission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          saleId: 'sale-new',
          salespersonId: 'user-1',
          commissionRate: 0.03,
        }),
      }),
    );
    expect(result.sale.id).toBe('sale-new');
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BOOKING_CONVERTED',
          newValue: expect.objectContaining({
            depositTransferred: '40990.00',
            amountReceived: '40990.00',
          }),
        }),
      }),
    );
  });

  it('convertToSale — B5: ตัด hold ของเว็บใน tx เดียวกับที่เครื่องออกจาก IN_STOCK', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      convertedToSaleId: null,
      bookingNumber: 'BK-20260517-0001',
      customerId: 'cust-1',
      customer: {
        id: 'cust-1',
        name: 'ลูกค้าจริง',
        phone: '0891234567',
        addressCurrent: 'กรุงเทพ',
      },
      branchId: 'br-1',
      totalAmount: new Prisma.Decimal(40990),
      depositAmount: new Prisma.Decimal(40990),
      depositMethod: 'CASH',
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 40990, amount: 40990 }],
    });
    prisma._tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await service.convertToSale('bk-1', {}, 'user-1', OWNER);

    const call = prisma._tx.productReservation.updateMany.mock.calls.at(-1)[0];
    expect(call.where.productId.in).toContain('prod-1');
    expect(call.where.status).toBe('ACTIVE');
    expect(call.data).toEqual({ status: 'PREEMPTED' });
  });

  it('convertToSale — partial deposit without collectBalance → BadRequest (C2 — no revenue overstatement)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      convertedToSaleId: null,
      bookingNumber: 'BK-20260517-0001',
      customerId: 'cust-1',
      branchId: 'br-1',
      totalAmount: new Prisma.Decimal(40990),
      depositAmount: new Prisma.Decimal(5000),
      depositMethod: 'CASH',
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 40990, amount: 40990 }],
    });
    await expect(service.convertToSale('bk-1', {}, 'user-1', OWNER)).rejects.toThrow(
      /เรียกเก็บยอดส่วนต่าง 35990\.00/,
    );
    // Sale must NOT be created — guard fires before tx
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
    expect(prisma._tx.product.update).not.toHaveBeenCalled();
  });

  it('convertToSale — partial deposit + collectBalance=true → amountReceived=totalAmount (C2)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      convertedToSaleId: null,
      bookingNumber: 'BK-20260517-0001',
      customerId: 'cust-1',
      customer: {
        id: 'cust-1',
        name: 'ลูกค้าจริง',
        phone: '0891234567',
        addressCurrent: 'กรุงเทพ',
      },
      branchId: 'br-1',
      totalAmount: new Prisma.Decimal(40990),
      depositAmount: new Prisma.Decimal(5000),
      depositMethod: 'CASH',
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 40990, amount: 40990 }],
    });
    await service.convertToSale('bk-1', { collectBalance: true, paymentMethod: 'CASH' }, 'user-1', OWNER);
    const saleArgs = prisma._tx.sale.create.mock.calls[0][0];
    expect(Number(saleArgs.data.amountReceived)).toBe(40990);
    expect(Number(saleArgs.data.downPaymentAmount)).toBe(5000);
  });

  it('convertToSale — race: second concurrent caller throws Conflict (no Sale created)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      convertedToSaleId: null,
      bookingNumber: 'BK-20260517-0001',
      customerId: 'cust-1',
      branchId: 'br-1',
      totalAmount: new Prisma.Decimal(40990),
      depositAmount: new Prisma.Decimal(40990),
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 40990, amount: 40990 }],
    });
    prisma._tx.booking.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.convertToSale('bk-1', {}, 'user-1', OWNER)).rejects.toThrow(
      ConflictException,
    );
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
  });

  it('convertToSale — rejects double-convert (already linked)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      convertedToSaleId: 'sale-existing',
      branchId: 'br-1',
      items: [{ productId: 'prod-1' }],
    });
    await expect(service.convertToSale('bk-1', {}, 'user-1', OWNER)).rejects.toThrow(
      ConflictException,
    );
  });

  it('convertToSale — rejects when product no longer IN_STOCK (C1 — double-sell guard)', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      convertedToSaleId: null,
      bookingNumber: 'BK-20260517-0001',
      customerId: 'cust-1',
      branchId: 'br-1',
      totalAmount: new Prisma.Decimal(40990),
      depositAmount: new Prisma.Decimal(40990),
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 40990, amount: 40990 }],
    });
    prisma._tx.product.findUnique.mockResolvedValueOnce({
      id: 'prod-1',
      status: 'SOLD_CASH',
      deletedAt: null,
    });
    await expect(service.convertToSale('bk-1', {}, 'user-1', OWNER)).rejects.toThrow(
      /ไม่พร้อมขาย/,
    );
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
  });

  // 5. autoExpire — cron path
  it('autoExpire — flips PAID + past-expireDate rows to EXPIRED and writes audit', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([
      {
        id: 'bk-late-1',
        depositAmount: new Prisma.Decimal(1000),
        bookingNumber: 'BK-20260510-0001',
      },
      {
        id: 'bk-late-2',
        depositAmount: new Prisma.Decimal(2500),
        bookingNumber: 'BK-20260510-0002',
      },
    ]);
    prisma.booking.findFirst
      .mockResolvedValueOnce({ id: 'bk-late-1', status: 'PAID', expireDate: new Date(0), depositAmount: new Prisma.Decimal(1000), bookingNumber: 'BK-20260510-0001' })
      .mockResolvedValueOnce({ id: 'bk-late-2', status: 'PAID', expireDate: new Date(0), depositAmount: new Prisma.Decimal(2500), bookingNumber: 'BK-20260510-0002' });
    const count = await service.autoExpire();
    expect(count).toBe(2);
    const auditCalls = prisma._tx.auditLog.create.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call: any) => call[0].data,
    );
    expect(
      auditCalls.every(
        (data: { action: string; entity: string }) =>
          data.action === 'BOOKING_AUTO_EXPIRED' && data.entity === 'booking',
      ),
    ).toBe(true);
  });

  it('autoExpire — returns 0 when no candidates (and skips audit writes)', async () => {
    prisma.booking.findMany.mockResolvedValueOnce([]);
    const count = await service.autoExpire();
    expect(count).toBe(0);
    expect(prisma._tx.auditLog.create).not.toHaveBeenCalled();
  });

  // 6. Branch scoping — findAll + findOne
  it('findAll — SALES is forced to own branchId regardless of query param', async () => {
    await service.findAll({}, SALES_BR1);
    const findArgs = prisma.booking.findMany.mock.calls[0][0];
    expect(findArgs.where.branchId).toBe('br-1');
  });

  it('findAll — SALES requesting another branchId is forbidden', async () => {
    await expect(service.findAll({ branchId: 'br-2' }, SALES_BR1)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('findOne — throws NotFound when row missing OR scope forbids', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne('bk-missing', OWNER)).rejects.toThrow(NotFoundException);
  });

  // 7. soft delete — DRAFT-equivalent only
  it('remove — soft-deletes PENDING_DEPOSIT booking + audit', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PENDING_DEPOSIT',
      branchId: 'br-1',
    });
    await service.remove('bk-1', OWNER);
    expect(prisma._tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bk-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'BOOKING_DELETED' }),
      }),
    );
  });

  it('remove — rejects non-PENDING_DEPOSIT (e.g. PAID) booking', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      branchId: 'br-1',
    });
    await expect(service.remove('bk-1', OWNER)).rejects.toThrow(BadRequestException);
  });

  // ─── test-data fence (spec 2026-09-05 §5.1) ────────────────────────────────

  it('create — รายการที่ผูกเครื่อง TEST- กับลูกค้าจริง → BadRequest ก่อนเปิด tx', async () => {
    prisma.product.findMany.mockResolvedValueOnce([
      { id: 'prod-t', imeiSerial: 'TEST-0001', name: 'ทดสอบระบบ มือถือ', po: null },
    ]);
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          branchId: 'br-1',
          items: [{ productId: 'prod-t', description: 'X', quantity: 1, unitPrice: 1000 }],
          depositAmount: 100,
        },
        'user-1',
        OWNER,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['prod-t'] }, deletedAt: null } }),
    );
  });

  it('create — รายการไม่ผูกเครื่อง (description อย่างเดียว) ไม่ query สินค้า', async () => {
    await service.create(
      {
        customerId: 'cust-1',
        branchId: 'br-1',
        items: [{ description: 'จองรุ่นที่ยังไม่มีของ', quantity: 1, unitPrice: 1000 }],
        depositAmount: 100,
      },
      'user-1',
      OWNER,
    );
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('convertToSale — ลูกค้าทดสอบ + เครื่องจริง → BadRequest, ไม่สร้าง Sale', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      convertedToSaleId: null,
      bookingNumber: 'BK-20260517-0001',
      customerId: 'cust-t',
      customer: {
        id: 'cust-t',
        name: 'ทดสอบระบบ ลูกค้า',
        phone: 'TEST-0000001',
        addressCurrent: TEST_CUSTOMER_ADDRESS,
      },
      branchId: 'br-1',
      totalAmount: new Prisma.Decimal(40990),
      depositAmount: new Prisma.Decimal(40990),
      depositMethod: 'CASH',
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 40990, amount: 40990 }],
    });
    await expect(service.convertToSale('bk-1', {}, 'user-1', OWNER)).rejects.toThrow(
      /ลูกค้าทดสอบระบบ/,
    );
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
    expect(prisma._tx.product.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ include: { po: { select: { poNumber: true } } } }),
    );
  });

  // ─── ด่านเบอร์ (spec 2026-09-13-chat-prospects) ──────────────────────────────

  const chatProspect = { id: 'cust-chat', name: 'Facebook #a1b2', phone: null, addressCurrent: null };

  it('create — ผู้สนใจจากแชทที่ยังไม่มีเบอร์ → BadRequest ก่อนเปิด tx', async () => {
    prisma.customer.findFirst.mockResolvedValueOnce(chatProspect);
    await expect(
      service.create(
        {
          customerId: 'cust-chat',
          branchId: 'br-1',
          items: [{ description: 'iPhone 15', quantity: 1, unitPrice: 35000 }],
          depositAmount: 1000,
        },
        'user-1',
        OWNER,
      ),
    ).rejects.toThrow('ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมเบอร์ก่อนจองสินค้า');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('update — เปลี่ยนลูกค้าในใบจองเป็นผู้สนใจที่ยังไม่มีเบอร์ → BadRequest ไม่แก้ใบจอง', async () => {
    prisma.booking.findFirst.mockResolvedValue({ id: 'bk-1', status: 'PENDING_DEPOSIT', branchId: 'br-1',
      depositAmount: new Prisma.Decimal(1000), totalAmount: new Prisma.Decimal(10000),
      expireDate: new Date(Date.now() + 86400000) });
    prisma.customer.findFirst.mockResolvedValueOnce(chatProspect);
    await expect(service.update('bk-1', { customerId: 'cust-chat' }, OWNER)).rejects.toThrow(
      'ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมเบอร์ก่อนจองสินค้า',
    );
    expect(prisma._tx.booking.update).not.toHaveBeenCalled();
  });

  it('update — เปลี่ยนลูกค้าเป็นคนที่มีเบอร์ → แก้ใบจองได้ตามเดิม', async () => {
    prisma.booking.findFirst.mockResolvedValue({ id: 'bk-1', status: 'PENDING_DEPOSIT', branchId: 'br-1',
      depositAmount: new Prisma.Decimal(1000), totalAmount: new Prisma.Decimal(10000),
      expireDate: new Date(Date.now() + 86400000) });
    await service.update('bk-1', { customerId: 'cust-1' }, OWNER);
    expect(prisma._tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customer: { connect: { id: 'cust-1' } } }) }),
    );
  });

  it('convertToSale — ลูกค้าในใบจองไม่มีเบอร์ → BadRequest ไม่สร้าง Sale ไม่ตัดสต็อก', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({ ...paidBooking(), customer: chatProspect });
    await expect(
      service.convertToSale('bk-1', { collectBalance: true, paymentMethod: 'CASH' }, SALES_BR1.id, SALES_BR1),
    ).rejects.toThrow('ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมเบอร์ก่อนเปิดใบขาย');
    expect(prisma._tx.product.updateMany).not.toHaveBeenCalled();
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
  });
});
