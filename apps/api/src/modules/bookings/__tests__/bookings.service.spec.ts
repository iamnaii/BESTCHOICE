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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

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
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'bk-1', items: [], depositAmount: new Prisma.Decimal(1000) }),
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

    prisma = {
      booking: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'br-1' }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u-admin' }) },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (fn: any) =>
        fn({
          booking: txBooking,
          bookingItem: txBookingItem,
          sale: txSale,
          auditLog: txAuditLog,
        }),
      ),
      _tx: { booking: txBooking, bookingItem: txBookingItem, sale: txSale, auditLog: txAuditLog },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [BookingsService, { provide: PrismaService, useValue: prisma }],
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
  it('payDeposit — PENDING_DEPOSIT → PAID with updateMany race claim + audit', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PENDING_DEPOSIT',
      branchId: 'br-1',
      expireDate: new Date(Date.now() + 86400000),
    });
    await service.payDeposit('bk-1', { depositMethod: 'CASH' }, OWNER);
    expect(prisma._tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'bk-1',
          status: 'PENDING_DEPOSIT',
        }),
        data: expect.objectContaining({
          status: 'PAID',
          depositMethod: 'CASH',
          depositReceivedById: OWNER.id,
        }),
      }),
    );
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'BOOKING_DEPOSIT_PAID' }),
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
      service.payDeposit('bk-1', { depositMethod: 'CASH' }, OWNER),
    ).rejects.toThrow(ConflictException);
  });

  it('payDeposit — rejects expired booking', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PENDING_DEPOSIT',
      branchId: 'br-1',
      expireDate: new Date(Date.now() - 86400000),
    });
    await expect(service.payDeposit('bk-1', {}, OWNER)).rejects.toThrow(BadRequestException);
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
  it('convertToSale — PAID → CONVERTED + Sale row with downPaymentAmount + audit', async () => {
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
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 35000, amount: 35000 }],
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
    expect(Number(saleArgs.data.downPaymentAmount)).toBe(5000);
    expect(Number(saleArgs.data.sellingPrice)).toBe(40990);
    expect(result.sale.id).toBe('sale-new');
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BOOKING_CONVERTED',
          newValue: expect.objectContaining({ depositTransferred: '5000.00' }),
        }),
      }),
    );
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
      depositAmount: new Prisma.Decimal(5000),
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 35000, amount: 35000 }],
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
});
