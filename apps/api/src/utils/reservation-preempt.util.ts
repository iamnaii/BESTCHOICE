import { Prisma } from '@prisma/client';

/**
 * ตัด hold (การจองจากเว็บ) ของสินค้าที่กำลังถูก flip ออกจาก IN_STOCK — ต้องอยู่ใน
 * transaction เดียวกับที่เปลี่ยนสถานะเครื่อง ไม่งั้นจะเกิดช่องว่างที่ลูกค้าเว็บยังจ่ายเงิน
 * เข้ามาบนเครื่องที่ขายไปแล้ว (หรือถ้า caller rollback แล้ว hold ถูกตัดทิ้งฟรี)
 *
 * เหตุที่เป็น util ไม่ใช่ service: `ShopReservationService` ผูกกับ `this.prisma` จึงเข้า
 * tx ของ caller ไม่ได้ และการ inject service ข้าม module (sales/contracts → shop-reservation)
 * จะลาก dependency graph ของโมดูลเงินไปผูกกับโมดูลร้านค้าโดยไม่จำเป็น
 *
 * **write ล้วน ห้ามเติม read (findMany/findFirst/count) เข้ามาเด็ดขาด** — `createCashSale`
 * และ `createExternalFinanceSale` เปิด tx ด้วย `isolationLevel: 'Serializable'`
 * (sale-writer.service.ts:212 / :471) และ **ไม่มี retry loop**; range read บนตารางนี้จะ
 * สร้าง predicate lock ที่ชนกับ INSERT hold ใหม่จาก shop-checkout แล้วโยน P2034 ออกหน้า
 * แคชเชียร์เป็น 500 หลังขายเสร็จ. การแจ้งลูกค้าทำโดย cron
 * `ShopReservationService.notifyPreemptedHolds` ซึ่งค้นเองจาก
 * `status='PREEMPTED' AND preemptNotifiedAt IS NULL` — ไม่ต้องรู้ id จากที่นี่
 *
 * กรอง `expiresAt > now` ด้วย: hold ที่หมดเวลาไปแล้วแต่ cron (ทุก 5 นาที) ยังไม่กวาด
 * ไม่ใช่ "ถูกตัดหน้า" — ถ้าตีตรา PREEMPTED จะไปส่ง LINE บอกลูกค้าผิดเหตุ
 *
 * คืนจำนวนแถวที่ตัด (ใช้ log ได้ ไม่มีใครพึ่งค่านี้เชิงตรรกะ)
 */
export async function preemptReservationsInTx(
  tx: Prisma.TransactionClient,
  productIds: (string | null | undefined)[],
): Promise<number> {
  const ids = Array.from(new Set(productIds.filter((v): v is string => !!v)));
  if (ids.length === 0) return 0;

  const result = await tx.productReservation.updateMany({
    where: {
      productId: { in: ids },
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    },
    data: { status: 'PREEMPTED' },
  });
  return result.count;
}
