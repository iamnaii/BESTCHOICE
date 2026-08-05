import { Prisma } from '@prisma/client';

export interface ConsumeOrderHoldResult {
  /** true = ส่งของได้จริง → เดินต่อไปสร้าง Sale; false = เงินเข้าแล้วแต่ของไม่มี → คิวคืนเงิน */
  fulfillable: boolean;
  productStatus: string | null;
  consumedCount: number;
  /** true = มี hold อื่นบนเครื่องเดียวกันถูก CONSUMED ไปแล้ว = เครื่องขายให้คนอื่นแล้ว */
  alreadyConsumedElsewhere: boolean;
}

/**
 * จุดเงินเข้าจริงของออเดอร์ออนไลน์ (PaySolutions webhook + แอดมินยืนยันสลิป) ต้องเรียกตัวนี้
 * ใน tx เดียวกับที่เปลี่ยนสถานะออเดอร์
 *
 * มี 2 เงื่อนไข ต้องผ่านทั้งคู่:
 *
 * (1) `product.status === 'IN_STOCK'` — ทุกทางที่ flip เครื่องออกจาก IN_STOCK จะ preempt
 *     hold ใน tx เดียวกันอยู่แล้ว (`preemptReservationsInTx`) → เครื่องไม่ IN_STOCK = ของหายแน่
 *
 * (2) ไม่มี hold **อื่น** บนเครื่องเดียวกันที่สถานะ CONSUMED — ปิดเคสที่ (1) จับไม่ได้:
 *     `saleAdapter.createForOnlineOrder` อยู่นอก tx และ error ถูก swallow แต่ตัวที่ flip
 *     เครื่องเป็น SOLD_CASH คือ adapter นั้นเอง (online-order-sale.adapter.ts:44-68).
 *     ถ้ามันพัง → ลูกค้า A จ่ายแล้ว (hold=CONSUMED) แต่เครื่องยัง IN_STOCK → B จองได้
 *     (reserve บล็อกเฉพาะ hold ที่ยัง ACTIVE) → B จ่าย → (1) ผ่าน = เก็บเงิน 2 รายบน
 *     เครื่องเดียวโดยไม่มีใครเข้าคิวคืนเงิน. `count` เป็น point read บน index
 *     (product_id, status) ที่มีอยู่แล้ว และ tx นี้เป็น default isolation ไม่ใช่ Serializable
 *     จึงไม่มีปัญหา predicate lock แบบ preemptReservationsInTx
 *
 * consume แบบ conditional (`updateMany` + where status) เท่านั้น — **ห้าม** `update({where:{id}})`
 * เฉยๆ เพราะจะทับ hold ที่เป็น PREEMPTED ให้กลายเป็น CONSUMED และกลบร่องรอยการตัดหน้า
 * ยอมรับ EXPIRED ด้วย เพราะ hold หมดอายุแต่เครื่องยังอยู่ = ส่งของได้ ไม่ต้องคืนเงิน
 */
export async function consumeOrderHoldInTx(
  tx: Prisma.TransactionClient,
  input: { orderId: string; productId: string; reservationId: string },
): Promise<ConsumeOrderHoldResult> {
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { status: true },
  });
  const productStatus = product?.status ?? null;
  if (productStatus !== 'IN_STOCK') {
    return {
      fulfillable: false,
      productStatus,
      consumedCount: 0,
      alreadyConsumedElsewhere: false,
    };
  }

  // `id: { not }` สำคัญ — webhook ที่ retry บนออเดอร์เดิมต้องไม่นับ hold ของตัวเอง
  const consumedElsewhere = await tx.productReservation.count({
    where: { productId: input.productId, status: 'CONSUMED', id: { not: input.reservationId } },
  });
  if (consumedElsewhere > 0) {
    return {
      fulfillable: false,
      productStatus,
      consumedCount: 0,
      alreadyConsumedElsewhere: true,
    };
  }

  const consumed = await tx.productReservation.updateMany({
    where: { id: input.reservationId, status: { in: ['ACTIVE', 'EXPIRED'] } },
    data: { status: 'CONSUMED', consumedById: input.orderId },
  });

  return {
    fulfillable: consumed.count === 1,
    productStatus,
    consumedCount: consumed.count,
    alreadyConsumedElsewhere: false,
  };
}
