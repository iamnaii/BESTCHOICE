import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ShopOrdersService } from './shop-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OnlineOrderSaleAdapter } from './online-order-sale.adapter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

describe('ShopOrdersService.confirmBankTransfer', () => {
  let service: ShopOrdersService;
  let prisma: any;
  let tx: any;
  let saleAdapter: { createForOnlineOrder: jest.Mock };

  const baseOrder = {
    id: 'oo-1',
    orderNumber: 'OO-2026-0001',
    status: 'PENDING_BANK_REVIEW',
    productId: 'p1',
    reservationId: 'r1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tx = {
      product: {
        // consumeOrderHoldInTx (T2/T3) takes the IN_STOCK row lock via a conditional
        // updateMany (not a plain findUnique) — default here = lock succeeds.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // Only consulted by consumeOrderHoldInTx when the lock above misses — reporting only.
        findUnique: jest.fn().mockResolvedValue({ status: 'IN_STOCK' }),
      },
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),   // hold CONSUMED อื่นบนเครื่องเดียวกัน
      },
      onlineOrder: { update: jest.fn().mockResolvedValue({ ...baseOrder, status: 'PAID' }) },
    };
    prisma = {
      onlineOrder: {
        findUnique: jest.fn().mockResolvedValue(baseOrder),
        count: jest.fn().mockResolvedValue(0),
        // ใช้ตอน catch ของ adapter → ย้ายออเดอร์เข้าคิวคืนเงินเมื่อเครื่องหลุดมือ
        update: jest.fn().mockResolvedValue({
          ...baseOrder, status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
        }),
      },
      // นอก tx: re-read สถานะเครื่องใน catch ของ adapter
      product: { findUnique: jest.fn().mockResolvedValue({ status: 'SOLD_CASH' }) },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };
    saleAdapter = { createForOnlineOrder: jest.fn().mockResolvedValue(undefined) };

    const mod = await Test.createTestingModule({
      providers: [
        ShopOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: OnlineOrderSaleAdapter, useValue: saleAdapter },
      ],
    }).compile();
    service = mod.get(ShopOrdersService);
  });

  it('ไม่พบออเดอร์ → NotFound', async () => {
    prisma.onlineOrder.findUnique.mockResolvedValue(null);
    await expect(service.confirmBankTransfer('oo-x', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('ยืนยันซ้ำ (status=PAID) → Forbidden, ไม่เปิด tx', async () => {
    prisma.onlineOrder.findUnique.mockResolvedValue({ ...baseOrder, status: 'PAID' });
    await expect(service.confirmBankTransfer('oo-1', 'u1')).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ของยังอยู่ → consume hold + PAID + สร้าง Sale ผ่าน adapter', async () => {
    await service.confirmBankTransfer('oo-1', 'u1');

    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: { in: ['ACTIVE', 'EXPIRED'] } },
      data: { status: 'CONSUMED', consumedById: 'oo-1' },
    });
    expect(tx.onlineOrder.update).toHaveBeenCalledWith({
      where: { id: 'oo-1' },
      data: expect.objectContaining({
        status: 'PAID',
        paidAt: expect.any(Date),
        bankConfirmedById: 'u1',
      }),
    });
    expect(saleAdapter.createForOnlineOrder).toHaveBeenCalledWith('oo-1');
  });

  it('ของถูกขายไปแล้ว → PAYMENT_RECEIVED_UNFULFILLABLE, ไม่สร้าง Sale, alarm', async () => {
    // lock ไม่ติด (เครื่องไม่ IN_STOCK แล้ว) → consumeOrderHoldInTx อ่าน findUnique เพื่อ report
    tx.product.updateMany.mockResolvedValue({ count: 0 });
    tx.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });
    tx.onlineOrder.update.mockResolvedValue({
      ...baseOrder, status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
    });

    const res = await service.confirmBankTransfer('oo-1', 'u1');

    expect(tx.onlineOrder.update).toHaveBeenCalledWith({
      where: { id: 'oo-1' },
      data: expect.objectContaining({ status: 'PAYMENT_RECEIVED_UNFULFILLABLE' }),
    });
    expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
    expect(Sentry.captureException as jest.Mock).toHaveBeenCalled();
    expect(res.status).toBe('PAYMENT_RECEIVED_UNFULFILLABLE');
  });

  it('มี hold CONSUMED ของออเดอร์อื่นบนเครื่องเดียวกัน → คิวคืนเงิน แม้เครื่องยัง IN_STOCK', async () => {
    tx.productReservation.count.mockResolvedValue(1);
    tx.onlineOrder.update.mockResolvedValue({
      ...baseOrder, status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
    });

    const res = await service.confirmBankTransfer('oo-1', 'u1');

    expect(res.status).toBe('PAYMENT_RECEIVED_UNFULFILLABLE');
    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
    expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
  });

  it('adapter ล้ม → ไม่ throw (เงินเข้าแล้ว rollback ไม่ได้) แต่ alarm', async () => {
    saleAdapter.createForOnlineOrder.mockRejectedValue(new Error('sale failed'));
    await expect(service.confirmBankTransfer('oo-1', 'u1')).resolves.toBeDefined();
    expect(Sentry.captureException as jest.Mock).toHaveBeenCalled();
  });

  it('adapter ล้ม + เครื่องหลุดมือแล้ว → ย้ายออเดอร์เข้าคิวคืนเงิน (ไม่ค้าง PAID เงียบ)', async () => {
    saleAdapter.createForOnlineOrder.mockRejectedValue(new Error('sale failed'));
    prisma.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });

    const res = await service.confirmBankTransfer('oo-1', 'u1');

    expect(prisma.onlineOrder.update).toHaveBeenCalledWith({
      where: { id: 'oo-1' },
      data: expect.objectContaining({ status: 'PAYMENT_RECEIVED_UNFULFILLABLE' }),
    });
    expect(res.status).toBe('PAYMENT_RECEIVED_UNFULFILLABLE');
  });

  it('adapter ล้ม แต่เครื่องยัง IN_STOCK → คง PAID (แอดมินสร้าง Sale เองได้)', async () => {
    saleAdapter.createForOnlineOrder.mockRejectedValue(new Error('sale failed'));
    prisma.product.findUnique.mockResolvedValue({ status: 'IN_STOCK' });

    await service.confirmBankTransfer('oo-1', 'u1');

    expect(prisma.onlineOrder.update).not.toHaveBeenCalled();
  });
});
