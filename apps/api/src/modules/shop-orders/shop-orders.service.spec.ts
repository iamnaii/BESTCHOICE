import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ShopOrdersService } from './shop-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OnlineOrderSaleAdapter } from './online-order-sale.adapter';
import { LineOaService } from '../line-oa/line-oa.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

describe('ShopOrdersService.confirmBankTransfer', () => {
  let service: ShopOrdersService;
  let prisma: any;
  let tx: any;
  let saleAdapter: { createForOnlineOrder: jest.Mock };
  let lineOaService: { sendFlexMessage: jest.Mock };

  const baseOrder = {
    id: 'oo-1',
    orderNumber: 'OO-2026-0001',
    status: 'PENDING_BANK_REVIEW',
    productId: 'p1',
    reservationId: 'r1',
    customerId: 'cust-1',
    totalAmount: 12500,
    customer: { lineIdShop: 'line-u1' },
    product: { name: 'iPhone 13' },
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
      onlineOrder: {
        // fix round 1/5 [Important+Minor]: CAS claim inside the tx — default = this
        // confirm wins the race (count 1). Race-lost tests override to {count: 0}.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ ...baseOrder, status: 'PAID' }),
      },
    };
    prisma = {
      onlineOrder: {
        findUnique: jest.fn().mockResolvedValue(baseOrder),
        count: jest.fn().mockResolvedValue(0),
        // ใช้ตอน catch ของ adapter → ย้ายออเดอร์เข้าคิวคืนเงินเมื่อเครื่องหลุดมือ
        // (also re-used to re-read current state when the CAS claim loses a race)
        update: jest.fn().mockResolvedValue({
          ...baseOrder, status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
        }),
      },
      // นอก tx: re-read สถานะเครื่องใน catch ของ adapter
      product: { findUnique: jest.fn().mockResolvedValue({ status: 'SOLD_CASH' }) },
      // fix round 1/5 [Critical]: adapter-catch must check for an already-created
      // Sale before deciding to requeue a refund — default = no such Sale exists.
      sale: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };
    saleAdapter = { createForOnlineOrder: jest.fn().mockResolvedValue(undefined) };
    lineOaService = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };

    const mod = await Test.createTestingModule({
      providers: [
        ShopOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: OnlineOrderSaleAdapter, useValue: saleAdapter },
        { provide: LineOaService, useValue: lineOaService },
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

  it('ของยังอยู่ → CAS claim (BANK_TRANSFER only) + consume hold + PAID + สร้าง Sale ผ่าน adapter', async () => {
    await service.confirmBankTransfer('oo-1', 'u1');

    // Minor: CAS claim scopes to BANK_TRANSFER orders only.
    expect(tx.onlineOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'oo-1',
        status: { in: ['PENDING_BANK_REVIEW', 'PENDING_PAYMENT'] },
        paymentChannel: 'BANK_TRANSFER',
      },
      data: { bankConfirmedById: 'u1' },
    });
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

  it('ของถูกขายไปแล้ว → PAYMENT_RECEIVED_UNFULFILLABLE, ไม่สร้าง Sale, alarm + LINE flex', async () => {
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
    // [reversal] customer must hear about the refund via LINE, not just an admin toast.
    expect(lineOaService.sendFlexMessage).toHaveBeenCalledWith(
      'line-u1',
      expect.objectContaining({ type: 'flex' }),
      'line-shop',
    );
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

  it('adapter ล้ม + เครื่องหลุดมือแล้ว → ย้ายออเดอร์เข้าคิวคืนเงิน (ไม่ค้าง PAID เงียบ) + LINE flex', async () => {
    saleAdapter.createForOnlineOrder.mockRejectedValue(new Error('sale failed'));
    prisma.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });

    const res = await service.confirmBankTransfer('oo-1', 'u1');

    expect(prisma.onlineOrder.update).toHaveBeenCalledWith({
      where: { id: 'oo-1' },
      data: expect.objectContaining({ status: 'PAYMENT_RECEIVED_UNFULFILLABLE' }),
    });
    expect(res.status).toBe('PAYMENT_RECEIVED_UNFULFILLABLE');
    expect(lineOaService.sendFlexMessage).toHaveBeenCalledWith(
      'line-u1',
      expect.objectContaining({ type: 'flex' }),
      'line-shop',
    );
  });

  it('adapter ล้ม แต่เครื่องยัง IN_STOCK → คง PAID (แอดมินสร้าง Sale เองได้)', async () => {
    saleAdapter.createForOnlineOrder.mockRejectedValue(new Error('sale failed'));
    prisma.product.findUnique.mockResolvedValue({ status: 'IN_STOCK' });

    await service.confirmBankTransfer('oo-1', 'u1');

    expect(prisma.onlineOrder.update).not.toHaveBeenCalled();
  });

  // ── [Critical] adapter-catch missing the sale.findFirst layer — regression T3 closed ──
  it('adapter ล้ม แต่ Sale ถูกสร้างสำเร็จแล้ว (เฉพาะ post-sale linkback ล้ม) → คง PAID ไม่คืนเงินซ้ำ', async () => {
    saleAdapter.createForOnlineOrder.mockRejectedValue(new Error('linkback failed'));
    prisma.sale.findFirst.mockResolvedValue({ id: 'sale-99' });
    // Even though the product is no longer IN_STOCK (it WAS sold — to this customer),
    // the sale.findFirst hit must short-circuit before the product re-check ever
    // gets a chance to misdiagnose this as "sold to someone else".
    prisma.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });

    const res = await service.confirmBankTransfer('oo-1', 'u1');

    expect(prisma.sale.findFirst).toHaveBeenCalledWith({
      where: { productId: 'p1', customerId: 'cust-1', deletedAt: null },
      select: { id: true },
    });
    // Must NOT requeue a refund for a customer who already has the device.
    expect(prisma.onlineOrder.update).not.toHaveBeenCalled();
    expect(lineOaService.sendFlexMessage).not.toHaveBeenCalled();
    // Order stays PAID (the tx's update result) — alarm is for the linkback, not a refund.
    expect(res.status).toBe('PAID');
    expect(Sentry.captureException as jest.Mock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ critical: 'online-order-post-sale-linkback-failed' }),
      }),
    );
  });

  // ── [Important] CAS status guard — 2 concurrent confirms on the SAME order ──
  it('แข่งกันยืนยัน 2 ครั้งพร้อมกัน (double-click/2 แท็บ) → ผู้แพ้ CAS ไม่แตะ hold ไม่สร้าง Sale คืนสถานะปัจจุบัน', async () => {
    tx.onlineOrder.updateMany.mockResolvedValue({ count: 0 }); // lost the race
    // Initial read (before the tx) still sees the pre-race PENDING_BANK_REVIEW state;
    // the post-race re-read sees whatever the winner already committed (PAID here).
    prisma.onlineOrder.findUnique
      .mockResolvedValueOnce(baseOrder)
      .mockResolvedValueOnce({ ...baseOrder, status: 'PAID' });

    const res = await service.confirmBankTransfer('oo-1', 'u1');

    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
    expect(saleAdapter.createForOnlineOrder).not.toHaveBeenCalled();
    expect(tx.onlineOrder.update).not.toHaveBeenCalled();
    // Re-reads current state via the ordinary (non-tx) findUnique — no alarm, no throw.
    expect(prisma.onlineOrder.findUnique).toHaveBeenCalledTimes(2); // initial read + post-race re-read
    expect(res.status).toBe('PAID');
    expect(Sentry.captureException as jest.Mock).not.toHaveBeenCalled();
  });
});
