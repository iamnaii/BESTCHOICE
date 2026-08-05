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
 * **write ล้วน ห้ามเติม read (findMany/findFirst/count) เข้ามาเด็ดขาด** — เก็บเป็น `updateMany`
 * ล้วนเพื่อความเรียบง่าย/คืน count ให้ log ได้ (ไม่มีใครพึ่ง id เชิงตรรกะ — การแจ้งลูกค้าทำโดย
 * cron `ShopReservationService.notifyPreemptedHolds` ซึ่งค้นเองจาก
 * `status='PREEMPTED' AND preemptNotifiedAt IS NULL`)
 *
 * **⚠️ แก้ doc-comment รอบก่อน (fix round 1/5, reviewer พิสูจน์ด้วย DB จริง) — เวอร์ชันเดิม
 * เขียนผิดว่า "ตัด findMany ออกเพื่อเลี่ยง P2034" ซึ่งไม่จริง:** `updateMany` ตัวนี้เอง
 * **ก็โดน `P2034` ได้เช่นกัน** เมื่อชนกับ transaction อื่นที่กำลังเขียนแถว hold เดียวกันพร้อมกัน
 * (เช่น `consumeOrderHoldInTx` ฝั่ง webhook) — และในทางกลับกัน range read เดี่ยวๆ (ไม่ตามด้วย
 * write ใน tx เดียวกัน) ก็ไม่ trigger SSI (Serializable Snapshot Isolation) ด้วยซ้ำ สาเหตุจริง
 * ของ P2034 คือ **write-write conflict ระหว่าง 2 tx ที่แตะแถวเดียวกันภายใต้ Serializable**
 * ไม่ใช่ read เฉยๆ. `updateMany` ยังคงเป็นทางเลือกที่ถูกต้อง — เรียบง่ายกว่า find-then-update
 * และคืน count ได้โดยไม่ต้อง select เพิ่ม — แต่ **caller ฝั่ง Serializable
 * (`createCashSale`/`createExternalFinanceSale`, sale-writer.service.ts:212/:471) ต้องมี retry
 * loop ครอบ tx ทั้งก้อนเสมอ** (pattern: `contract-lifecycle.service.ts:255-259` — retry บน
 * `P2002`/`P2034`) ไม่ใช่แค่ตอนเรียก util ตัวนี้ — เป็นข้อบังคับที่ยังไม่ได้ implement ในงานนี้
 * (Task 5 ของแผนต้องเป็นคนใส่ retry loop ที่ caller)
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
