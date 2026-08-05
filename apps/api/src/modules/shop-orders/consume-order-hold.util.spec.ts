import { consumeOrderHoldInTx } from './consume-order-hold.util';

describe('consumeOrderHoldInTx', () => {
  let tx: any;
  const input = { orderId: 'oo-1', productId: 'p1', reservationId: 'r1' };

  beforeEach(() => {
    tx = {
      product: { findUnique: jest.fn().mockResolvedValue({ status: 'IN_STOCK' }) },
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
    };
  });

  it('เครื่องยัง IN_STOCK + ไม่มี hold CONSUMED อื่น + hold consume ได้ → fulfillable', async () => {
    const res = await consumeOrderHoldInTx(tx, input);
    expect(res).toEqual({
      fulfillable: true, productStatus: 'IN_STOCK', consumedCount: 1,
      alreadyConsumedElsewhere: false,
    });
    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: { in: ['ACTIVE', 'EXPIRED'] } },
      data: { status: 'CONSUMED', consumedById: 'oo-1' },
    });
  });

  it('เครื่องถูกขายไปแล้ว (SOLD_CASH) → ไม่ fulfillable และห้ามแตะ hold', async () => {
    tx.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });
    const res = await consumeOrderHoldInTx(tx, input);
    expect(res).toEqual({
      fulfillable: false, productStatus: 'SOLD_CASH', consumedCount: 0,
      alreadyConsumedElsewhere: false,
    });
    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
  });

  it('เครื่องถูก RESERVED เข้าสัญญาแล้ว → ไม่ fulfillable', async () => {
    tx.product.findUnique.mockResolvedValue({ status: 'RESERVED' });
    expect((await consumeOrderHoldInTx(tx, input)).fulfillable).toBe(false);
  });

  it('ไม่พบเครื่อง → ไม่ fulfillable, productStatus = null', async () => {
    tx.product.findUnique.mockResolvedValue(null);
    expect(await consumeOrderHoldInTx(tx, input)).toEqual({
      fulfillable: false, productStatus: null, consumedCount: 0,
      alreadyConsumedElsewhere: false,
    });
  });

  it('hold โดน PREEMPTED ไปแล้ว (count=0) → ไม่ fulfillable และไม่ทับสถานะเดิม', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 0 });
    const res = await consumeOrderHoldInTx(tx, input);
    expect(res.fulfillable).toBe(false);
    expect(res.consumedCount).toBe(0);
  });

  it('hold EXPIRED แต่เครื่องยังอยู่ → consume ได้ (ไม่บังคับให้คืนเงินโดยไม่จำเป็น)', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });
    expect((await consumeOrderHoldInTx(tx, input)).fulfillable).toBe(true);
    expect(tx.productReservation.updateMany.mock.calls[0][0].where.status).toEqual({
      in: ['ACTIVE', 'EXPIRED'],
    });
  });

  // ── เงื่อนไขที่ 2: กันเคส "adapter พัง เครื่องยัง IN_STOCK แต่ขายไปแล้ว" ──
  it('มี hold CONSUMED อื่นบนเครื่องเดียวกัน → ไม่ fulfillable แม้เครื่องยัง IN_STOCK', async () => {
    tx.productReservation.count.mockResolvedValue(1);

    const res = await consumeOrderHoldInTx(tx, input);

    expect(res).toEqual({
      fulfillable: false, productStatus: 'IN_STOCK', consumedCount: 0,
      alreadyConsumedElsewhere: true,
    });
    expect(tx.productReservation.count).toHaveBeenCalledWith({
      where: { productId: 'p1', status: 'CONSUMED', id: { not: 'r1' } },
    });
    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
  });

  it('hold CONSUMED ที่นับได้ต้องไม่รวมตัวเอง (retry webhook ของออเดอร์เดิม)', async () => {
    tx.productReservation.count.mockResolvedValue(0);
    await consumeOrderHoldInTx(tx, input);
    expect(tx.productReservation.count.mock.calls[0][0].where.id).toEqual({ not: 'r1' });
  });
});
