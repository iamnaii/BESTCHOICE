import { Prisma } from '@prisma/client';

import { TEST_DOC_PREFIX } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const DAY = 24 * 60 * 60 * 1000;

/** R2 — หยุดก่อน PAID เพราะ PAID เดินต่อไปสร้าง Sale ซึ่งโพสต์ JE */
const ROWS: Array<{
  key: string;
  status: 'PENDING_PAYMENT' | 'PENDING_BANK_REVIEW';
  shipping: 'BRANCH_PICKUP' | 'KERRY';
  channel: 'PROMPTPAY_QR' | 'BANK_TRANSFER';
  note: string;
}> = [
  {
    key: 'await-pay',
    status: 'PENDING_PAYMENT',
    shipping: 'BRANCH_PICKUP',
    channel: 'PROMPTPAY_QR',
    note: 'รอลูกค้าชำระ (รับที่สาขา)',
  },
  {
    key: 'slip-review',
    status: 'PENDING_BANK_REVIEW',
    shipping: 'KERRY',
    channel: 'BANK_TRANSFER',
    note: 'แนบสลิปแล้ว รอตรวจสลิป — ใช้ทดสอบ /slip-review',
  },
];

/** สถานะที่กู้คืนออเดอร์ที่ถูกล้างได้อย่างปลอดภัย — ยังไม่มีเงินขยับ/ยังไม่มีใบขาย */
const RESTORABLE_STATUSES = ['PENDING_PAYMENT', 'PENDING_BANK_REVIEW', 'CANCELLED', 'DRAFT'];

/**
 * prefix จริงของออเดอร์/การจองทดสอบ — ค่าคงที่เดียวใช้ทั้ง `markerDoc` และ query ของ
 * seed/cleanup ⇒ เอกสารกับโค้ด drift กันไม่ได้อีก (S1, 2026-08-26)
 */
const ORDER_NO_PREFIX = `${TEST_DOC_PREFIX}ORD-`;
const SESSION_ID_PREFIX = `${TEST_DOC_PREFIX}SESSION-`;

export const onlineOrdersSeeder: DomainSeeder = {
  key: 'online-orders',
  label: 'ออเดอร์ออนไลน์ + การจองเครื่อง',
  routes: ['/online-orders', '/product-holds', '/slip-review'],
  markerDoc: `OnlineOrder.orderNumber ขึ้นต้น "${ORDER_NO_PREFIX}" · ProductReservation.sessionId ขึ้นต้น "${SESSION_ID_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: `${TEST_DOC_PREFIX}ORD ${r.key}`,
      detail: `${r.status} · ${r.shipping} · ${r.channel} · ${r.note}`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const [customer, products] = await Promise.all([
      ctx.prisma.customer.findFirst({
        where: { name: { startsWith: 'ทดสอบระบบ ลูกค้าใหม่' }, deletedAt: null },
        select: { id: true },
      }),
      ctx.prisma.product.findMany({
        where: { imeiSerial: { startsWith: 'TEST-' }, status: 'IN_STOCK', deletedAt: null },
        select: { id: true, cashPrice: true },
        take: 2,
      }),
    ]);
    if (!customer || products.length < ROWS.length) {
      stat.notes.push(
        `ข้ามทั้งโดเมน — ต้องมีลูกค้าทดสอบ 1 คน + เครื่องทดสอบ IN_STOCK ${ROWS.length} เครื่อง (รันโดเมน contracts ก่อน)`,
      );
      return stat;
    }

    for (const [i, r] of ROWS.entries()) {
      const orderNumber = `${ORDER_NO_PREFIX}${ctx.dateStr}-${r.key}`;
      // orderNumber เป็น @unique เต็มตาราง — probe โดยไม่กรอง deletedAt แล้ว "กู้คืน"
      // แทนการสร้างซ้ำ (restore-instead-of-recreate ตาม stock-ops) ไม่งั้น
      // seed → cleanup → seed จะชน P2002 หรือข้ามเงียบจนผู้ทดสอบไม่มีออเดอร์ให้ใช้
      const exists = await ctx.prisma.onlineOrder.findFirst({
        where: { orderNumber },
        select: {
          id: true,
          deletedAt: true,
          status: true,
          saleId: true,
          reservationId: true,
          productId: true,
        },
      });
      if (exists && !exists.deletedAt) {
        stat.skipped += 1;
        continue;
      }
      if (exists) {
        // แถวถูก cleanup ล้างไปแล้ว — กู้คืนเฉพาะเมื่อยังไม่มีเงินขยับ (ไม่มีใบขาย +
        // สถานะยัง restorable) และเครื่องเดิมยังพร้อมขาย ไม่งั้นการปลุก hold กลับมา
        // จะไปบล็อกเครื่องที่ถูกรายการอื่นถือครองอยู่
        const product = await ctx.prisma.product.findFirst({
          where: { id: exists.productId, status: 'IN_STOCK', deletedAt: null },
          select: { id: true },
        });
        if (exists.saleId || !RESTORABLE_STATUSES.includes(exists.status) || !product) {
          stat.skipped += 1;
          stat.notes.push(
            `ข้าม ${orderNumber} — ออเดอร์เดิมถูกล้างหลังมีใบขาย/เครื่องไม่พร้อมขายแล้ว จึงกู้คืนไม่ได้ (เลขนี้ถูกถือถาวร)`,
          );
          continue;
        }
        await ctx.prisma.$transaction(async (tx) => {
          await tx.onlineOrder.update({
            where: { id: exists.id },
            data: { deletedAt: null, status: r.status, cancelReason: null, cancelledAt: null },
          });
          // cleanup ปล่อย hold ด้วย status CANCELLED (hard delete ไม่ได้ — FK RESTRICT
          // จาก online_orders.reservation_id) ⇒ ปลุกแถวเดิมกลับมา ACTIVE พร้อมวันหมดอายุใหม่
          await tx.productReservation.update({
            where: { id: exists.reservationId },
            data: { status: 'ACTIVE', expiresAt: new Date(ctx.today.getTime() + 2 * DAY) },
          });
        });
        stat.skipped += 1;
        stat.notes.push(
          `กู้คืน ${orderNumber} + การจองเครื่องของมันที่เคยถูกล้าง (แถวกู้คืนนับเป็น skipped ไม่ใช่ created)`,
        );
        continue;
      }
      // ส่ง Decimal ผ่านตรง ๆ — Prisma รับ Decimal ให้คอลัมน์ Decimal อยู่แล้ว
      // ห้ามแปลงเป็น number (Global Constraints: Money = Decimal)
      const price = products[i].cashPrice ?? new Prisma.Decimal(0);
      await ctx.prisma.$transaction(async (tx) => {
        const reservation = await tx.productReservation.create({
          data: {
            productId: products[i].id,
            customerId: customer.id,
            sessionId: `${SESSION_ID_PREFIX}${ctx.dateStr}-${r.key}`,
            expiresAt: new Date(ctx.today.getTime() + 2 * DAY),
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        await tx.onlineOrder.create({
          data: {
            orderNumber,
            customerId: customer.id,
            productId: products[i].id,
            reservationId: reservation.id,
            productPrice: price,
            totalAmount: price,
            shippingMethod: r.shipping,
            paymentChannel: r.channel,
            status: r.status,
            ...(r.status === 'PENDING_BANK_REVIEW'
              ? { bankSlipUrl: 'https://example.invalid/test-slip.jpg' }
              : {}),
          },
        });
      });
      stat.created += 1;
    }
    return stat;
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
