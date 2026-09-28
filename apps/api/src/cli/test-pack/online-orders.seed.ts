import { TEST_DOC_PREFIX } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * prefix จริงของออเดอร์/การจองทดสอบ — ค่าคงที่เดียวใช้ทั้ง `markerDoc` และ query ของ
 * cleanup ⇒ เอกสารกับโค้ด drift กันไม่ได้อีก (S1, 2026-08-26)
 */
const ORDER_NO_PREFIX = `${TEST_DOC_PREFIX}ORD-`;
const SESSION_ID_PREFIX = `${TEST_DOC_PREFIX}SESSION-`;

/**
 * ระบบสั่งซื้อออนไลน์ถูกถอด 2026-09-28 (ร้านขายผ่านแชท/โทร — หน้า /online-orders กับ
 * /product-holds และ API ฝั่งแอดมินไม่มีแล้ว) โดเมนนี้จึง **ไม่ seed อีก เหลือแค่ cleanup**
 * ไว้ล้างแถวทดสอบที่ seed ไปก่อนหน้า — ต้องล้างให้ได้ เพราะออเดอร์ทดสอบสถานะ
 * PENDING_BANK_REVIEW ยังถือเครื่องทดสอบอยู่ (`product-hold.util` ชั้น 4) และไม่มีหน้าไหน
 * ให้กดปล่อยแล้ว · ตาราง online_orders / product_reservations ยังอยู่ในฐานข้อมูล
 */
export const onlineOrdersSeeder: DomainSeeder = {
  key: 'online-orders',
  label: 'ออเดอร์ออนไลน์ + การจองเครื่อง (ถอดแล้ว — ล้างอย่างเดียว)',
  routes: [],
  markerDoc: `OnlineOrder.orderNumber ขึ้นต้น "${ORDER_NO_PREFIX}" · ProductReservation.sessionId ขึ้นต้น "${SESSION_ID_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return [];
  },

  async seed(): Promise<SeedStat> {
    return {
      created: 0,
      skipped: 0,
      notes: ['ไม่ seed — ระบบสั่งซื้อออนไลน์ถูกถอด 2026-09-28 (โดเมนนี้เหลือแค่ cleanup)'],
    };
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const orders = await ctx.prisma.onlineOrder.findMany({
      where: { orderNumber: { startsWith: ORDER_NO_PREFIX }, deletedAt: null },
      select: { id: true, orderNumber: true, reservationId: true, saleId: true },
    });
    const reservations = await ctx.prisma.productReservation.findMany({
      where: { sessionId: { startsWith: SESSION_ID_PREFIX } },
      select: { id: true, status: true },
    });
    for (const o of orders)
      console.log(`     ${o.orderNumber}${o.saleId ? ' ⚠️ มีใบขายแล้ว' : ''}`);

    // ProductReservation ไม่มี deletedAt และแถวที่ค้าง ACTIVE ทำให้ assertProductNotHeld
    // ชั้น 3 บล็อกเครื่องนั้นตลอดไป — แต่ hard delete ได้เฉพาะแถวที่ไม่มีออเดอร์อ้างถึง:
    // online_orders.reservation_id เป็น FK ON DELETE RESTRICT (migration 20260529200000)
    // และตัวออเดอร์เป็น soft delete ⇒ แถวออเดอร์ยังอยู่จริงในตาราง ลบการจองที่ถูกอ้างจะชน
    // P2003. แถวที่ถูกอ้างจึง "ปล่อย hold" ด้วย status CANCELLED แทน — ชั้น 3 กรองเฉพาะ
    // status ACTIVE + ยังไม่หมดอายุ จึงปลดล็อกเครื่องได้จริงเท่ากัน
    const resIds = reservations.map((r) => r.id);
    const referencedRows = resIds.length
      ? await ctx.prisma.onlineOrder.findMany({
          where: { reservationId: { in: resIds } },
          select: { reservationId: true },
        })
      : [];
    const referenced = new Set(referencedRows.map((o) => o.reservationId));
    const toHardDelete = reservations.filter((r) => !referenced.has(r.id));
    const toRelease = reservations.filter((r) => referenced.has(r.id) && r.status === 'ACTIVE');

    if (!dryRun && (orders.length || reservations.length)) {
      await ctx.prisma.$transaction(async (tx) => {
        // OnlineOrder มี deletedAt ⇒ soft delete
        if (orders.length) {
          await tx.onlineOrder.updateMany({
            where: { id: { in: orders.map((o) => o.id) } },
            data: { deletedAt: new Date() },
          });
        }
        if (toRelease.length) {
          await tx.productReservation.updateMany({
            where: { id: { in: toRelease.map((r) => r.id) } },
            data: { status: 'CANCELLED' },
          });
        }
        if (toHardDelete.length) {
          await tx.productReservation.deleteMany({
            where: { id: { in: toHardDelete.map((r) => r.id) } },
          });
        }
      });
    }
    return {
      removed: {
        ออเดอร์ออนไลน์: orders.length,
        'การจองเครื่อง (ลบถาวร)': toHardDelete.length,
        'การจองเครื่อง (ปล่อย hold เป็น CANCELLED)': toRelease.length,
      },
      warnings: orders.some((o) => o.saleId)
        ? [
            'มีออเดอร์ทดสอบที่ถูกยืนยันเป็นใบขายแล้ว — ใบขายนั้นเลขจริง (ไม่มี marker) ต้องยกเลิกใบขาย/ล้างผ่านโดเมน contracts เอง',
          ]
        : [],
    };
  },
};
