import { consumeOrderHoldInTx } from './consume-order-hold.util';

describe('consumeOrderHoldInTx', () => {
  let tx: any;
  const input = { orderId: 'oo-1', productId: 'p1', reservationId: 'r1' };

  beforeEach(() => {
    tx = {
      product: {
        // fix round 1/5: IN_STOCK check is now a conditional WRITE (row lock), not a plain
        // read — see doc-comment in consume-order-hold.util.ts for why (TOCTOU race proven
        // on real DB by the reviewer: check-then-act let 2 concurrent webhooks both pass).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        // Only consulted when the lock above misses (count !== 1), purely for reporting the
        // real productStatus back to the caller.
        findUnique: jest.fn().mockResolvedValue({ status: 'IN_STOCK' }),
      },
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
    };
  });

  it('เครื่องยัง IN_STOCK (lock ติด) + ไม่มี hold CONSUMED อื่น + hold consume ได้ → fulfillable', async () => {
    const res = await consumeOrderHoldInTx(tx, input);
    expect(res).toEqual({
      fulfillable: true, productStatus: 'IN_STOCK', consumedCount: 1,
      alreadyConsumedElsewhere: false,
    });
    expect(tx.productReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: { in: ['ACTIVE', 'EXPIRED'] } },
      data: { status: 'CONSUMED', consumedById: 'oo-1' },
    });
    // Happy path never needs the reporting-only read.
    expect(tx.product.findUnique).not.toHaveBeenCalled();
  });

  it('lock เครื่องด้วย conditional updateMany (where id+status IN_STOCK) ไม่ใช่ findUnique เฉยๆ — กัน TOCTOU race', async () => {
    await consumeOrderHoldInTx(tx, input);
    expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
    const call = tx.product.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'p1', status: 'IN_STOCK' });
    expect(call.data.updatedAt).toBeInstanceOf(Date);
  });

  it('เครื่องถูกขายไปแล้ว (SOLD_CASH) — lock ไม่ติด → ไม่ fulfillable และห้ามแตะ hold', async () => {
    tx.product.updateMany.mockResolvedValue({ count: 0 });
    tx.product.findUnique.mockResolvedValue({ status: 'SOLD_CASH' });
    const res = await consumeOrderHoldInTx(tx, input);
    expect(res).toEqual({
      fulfillable: false, productStatus: 'SOLD_CASH', consumedCount: 0,
      alreadyConsumedElsewhere: false,
    });
    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
    expect(tx.productReservation.count).not.toHaveBeenCalled();
  });

  it('เครื่องถูก RESERVED เข้าสัญญาแล้ว — lock ไม่ติด → ไม่ fulfillable', async () => {
    tx.product.updateMany.mockResolvedValue({ count: 0 });
    tx.product.findUnique.mockResolvedValue({ status: 'RESERVED' });
    expect((await consumeOrderHoldInTx(tx, input)).fulfillable).toBe(false);
  });

  it('ไม่พบเครื่อง — lock ไม่ติด → ไม่ fulfillable, productStatus = null', async () => {
    tx.product.updateMany.mockResolvedValue({ count: 0 });
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
  it('มี hold CONSUMED อื่นบนเครื่องเดียวกัน → ไม่ fulfillable แม้เครื่องยัง IN_STOCK (lock ติด)', async () => {
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

  // ── fix round 1/5: simulates the exact race the reviewer proved on real DB ──
  // Webhook B runs its statements strictly AFTER webhook A's product-lock statement
  // resolves (that's what the row lock enforces in real Postgres) — model that here by
  // having B's CONSUMED-count mock reflect A's already-committed write.
  it('จำลอง 2 webhook แข่งกันบนเครื่องเดียว: ตัวที่สองต้องเห็น CONSUMED ของตัวแรกหลัง lock ปลด (ไม่ double-fulfillable)', async () => {
    // Webhook A: consumes cleanly.
    const resA = await consumeOrderHoldInTx(tx, { orderId: 'oo-A', productId: 'p1', reservationId: 'r-A' });
    expect(resA.fulfillable).toBe(true);

    // Webhook B's tx starts AFTER A's lock-holding statement committed (that's the ordering
    // the row lock guarantees) — its CONSUMED-count read now sees A's committed row.
    tx.productReservation.count.mockResolvedValue(1);
    const resB = await consumeOrderHoldInTx(tx, { orderId: 'oo-B', productId: 'p1', reservationId: 'r-B' });

    expect(resB.fulfillable).toBe(false);
    expect(resB.alreadyConsumedElsewhere).toBe(true);
    expect(tx.productReservation.updateMany).toHaveBeenCalledTimes(1); // only A's consume write happened
  });
});
