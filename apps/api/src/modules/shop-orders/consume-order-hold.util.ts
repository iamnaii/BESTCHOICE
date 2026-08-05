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
 *     เครื่องเดียวโดยไม่มีใครเข้าคิวคืนเงิน
 *
 * **⚠️ เบี่ยงจาก brief เดิม — fix round 1/5 (reviewer พิสูจน์ด้วย DB จริง 105 รอบ):**
 * brief เดิมเช็ค (1) ด้วย `tx.product.findUnique` (อ่านเฉยๆ ไม่ lock แถว) แล้วค่อยเช็ค (2)
 * ด้วย `tx.productReservation.count`. นี่คือ **check-then-act แบบ TOCTOU** — เว็บฮุค 2 ตัว
 * พร้อมกันบนเครื่องเดียวกัน (hold คู่ {EXPIRED,ACTIVE} หรือ {EXPIRED,EXPIRED} — partial unique
 * กันแค่ ACTIVE ซ้อน ไม่กัน EXPIRED ซ้อน) ทั้งคู่จะเห็น (1) ผ่านและ (2) count=0 พร้อมกัน (READ
 * COMMITTED ไม่เห็น uncommitted ของกันและกัน) แล้วแตะคนละแถว hold (`updateMany` ผูกกับ
 * `reservationId` คนละตัว) → ทั้งคู่ commit สำเร็จ = double-fulfillable วัดได้ 24/25 รอบใน
 * benchmark จริง. ปิดด้วยการเปลี่ยน (1) จาก read เป็น **conditional write ที่ยึด row lock**:
 * `tx.product.updateMany({ where: { id, status: 'IN_STOCK' }, data: { updatedAt: now } })`.
 * แม้ util นี้จะไม่เปลี่ยนคอลัมน์ `status` เอง แต่ row lock ที่ `updateMany` ถืออยู่บังคับให้
 * webhook ตัวที่สองรอจน webhook ตัวแรก commit ก่อน — พอปลดล็อกแล้ว statement ถัดไปของตัวที่สอง
 * (การนับ CONSUMED ในเงื่อนไข (2)) จะเริ่ม snapshot ใหม่ใน READ COMMITTED ซึ่งเห็นแถว CONSUMED
 * ที่ตัวแรก commit ไปแล้วแน่นอน — ปิด race ทั้งสองแบบโดยไม่ต้องใช้ Serializable/advisory lock
 * (พิสูจน์แล้ว 0/25 double-fulfillable). ไม่มี P2034 เพิ่มเพราะ tx นี้เป็น default isolation
 * (ไม่ใช่ Serializable แบบ sale-writer) — lock wait ธรรมดา ไม่ใช่ serialization failure.
 *
 * เมื่อ `locked.count !== 1` (เครื่องไม่ IN_STOCK หรือไม่มีเครื่องเลย) จะอ่าน `status` แยกอีก
 * ครั้งเพื่อ **reporting เท่านั้น** (ไม่ใช่เงื่อนไขตัดสินใจ — ตัดสินไปแล้วจาก count) เพื่อคืน
 * `productStatus` ที่ตรงจริงให้ caller แจ้งเหตุผลได้ (SOLD_CASH vs RESERVED vs ไม่พบเครื่อง)
 *
 * consume แบบ conditional (`updateMany` + where status) เท่านั้น — **ห้าม** `update({where:{id}})`
 * เฉยๆ เพราะจะทับ hold ที่เป็น PREEMPTED ให้กลายเป็น CONSUMED และกลบร่องรอยการตัดหน้า
 * ยอมรับ EXPIRED ด้วย เพราะ hold หมดอายุแต่เครื่องยังอยู่ = ส่งของได้ ไม่ต้องคืนเงิน
 */
export async function consumeOrderHoldInTx(
  tx: Prisma.TransactionClient,
  input: { orderId: string; productId: string; reservationId: string },
): Promise<ConsumeOrderHoldResult> {
  // Conditional write, not a plain read — the row lock this holds is what serializes
  // 2 concurrent webhooks against the same product (see doc-comment above).
  const locked = await tx.product.updateMany({
    where: { id: input.productId, status: 'IN_STOCK' },
    data: { updatedAt: new Date() },
  });

  if (locked.count !== 1) {
    // Lock didn't land — read status separately purely for reporting to the caller.
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { status: true },
    });
    return {
      fulfillable: false,
      productStatus: product?.status ?? null,
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
      productStatus: 'IN_STOCK',
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
    productStatus: 'IN_STOCK',
    consumedCount: consumed.count,
    alreadyConsumedElsewhere: false,
  };
}
