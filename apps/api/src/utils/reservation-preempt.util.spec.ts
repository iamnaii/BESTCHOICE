import { preemptReservationsInTx } from './reservation-preempt.util';

describe('preemptReservationsInTx', () => {
  let tx: any;

  beforeEach(() => {
    tx = {
      productReservation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
  });

  it('ไม่ยิง query เลยเมื่อไม่มี productId', async () => {
    expect(await preemptReservationsInTx(tx, [])).toBe(0);
    expect(await preemptReservationsInTx(tx, [null, undefined])).toBe(0);
    expect(tx.productReservation.updateMany).not.toHaveBeenCalled();
  });

  it('ตัด hold ACTIVE เป็น PREEMPTED ด้วย updateMany ตัวเดียว (ห้ามมี read นำ)', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 2 });

    expect(await preemptReservationsInTx(tx, ['p1', 'p2'])).toBe(2);

    expect(tx.productReservation.updateMany).toHaveBeenCalledTimes(1);
    const call = tx.productReservation.updateMany.mock.calls[0][0];
    expect(call.where.productId).toEqual({ in: ['p1', 'p2'] });
    expect(call.where.status).toBe('ACTIVE');
    expect(call.data).toEqual({ status: 'PREEMPTED' });
    // ห้ามมี findMany/findFirst บน tx เลย — range read ใน tx Serializable ของ
    // sale-writer จะทำให้เกิด P2034 ที่ไม่มีใคร retry (ดูหมายเหตุใน Interfaces)
    expect(tx.productReservation.findMany).toBeUndefined();
  });

  it('dedupe productId ซ้ำ และคัด null/undefined ทิ้ง', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 1 });

    await preemptReservationsInTx(tx, ['p1', 'p1', null, 'p2', undefined]);

    expect(tx.productReservation.updateMany.mock.calls[0][0].where.productId).toEqual({
      in: ['p1', 'p2'],
    });
  });

  it('เงื่อนไข status ACTIVE ยังอยู่ (ห้ามทับ CONSUMED/PREEMPTED/CANCELLED)', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 0 });
    expect(await preemptReservationsInTx(tx, ['p1'])).toBe(0);
    expect(tx.productReservation.updateMany.mock.calls[0][0].where.status).toBe('ACTIVE');
  });

  it('ไม่แตะ hold ที่หมดอายุแล้ว — where ต้องมี expiresAt > now', async () => {
    tx.productReservation.updateMany.mockResolvedValue({ count: 0 });
    const before = Date.now();
    await preemptReservationsInTx(tx, ['p1']);
    const gt = tx.productReservation.updateMany.mock.calls[0][0].where.expiresAt.gt;
    expect(gt).toBeInstanceOf(Date);
    expect(gt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
