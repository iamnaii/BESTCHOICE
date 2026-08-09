import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { productReadinessWhere } from '../../utils/product-readiness.util';
import { readBoolFlag } from '../../utils/config.util';
import { LineOaService } from '../line-oa/line-oa.service';
import { FlexMessagePayload } from '../line-oa/flex-messages/base-template';
import { AuditService } from '../audit/audit.service';

const RESERVATION_DURATION_MS = 15 * 60 * 1000; // 15 minutes
/** หน้าต่างเวลาที่ยังคุ้มจะแจ้ง — เกินนี้ลูกค้าน่าจะรู้เองแล้ว (และกันยิงย้อนหลังตอน deploy) */
const PREEMPT_NOTIFY_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const PREEMPT_NOTIFY_BATCH = 50;

export interface ReserveInput {
  productId: string;
  sessionId: string;
  customerId?: string;
}

@Injectable()
export class ShopReservationService {
  private readonly logger = new Logger(ShopReservationService.name);

  constructor(
    private prisma: PrismaService,
    private lineOa: LineOaService,
    private audit: AuditService,
  ) {}

  async reserve(input: ReserveInput) {
    // B0 §2.3: จองได้เฉพาะเครื่องที่ "พร้อมขึ้นเว็บ" จริง — เดิมจองเครื่องไม่มีราคาได้
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, ...productReadinessWhere({ excludeDemo }) },
      select: { id: true, status: true },
    });
    if (!product) throw new NotFoundException('สินค้านี้ไม่พร้อมจำหน่ายบนเว็บ');

    // B5 fix round 1 (reviewer Major, was: raw CONSUMED-hold count — that check never
    // clears, because CONSUMED is a terminal audit state on the ProductReservation row,
    // so a product id that was EVER sold once through the web-shop stayed permanently
    // 409'd here even after legitimately returning to IN_STOCK, e.g. via repossession +
    // manual restock through the generic product-status editor). Guard the actual
    // dangerous window instead: "เงินเข้าแล้ว (hold CONSUMED) แต่ saleAdapter พังหลัง
    // commit → order ค้าง PAID ขณะเครื่องยัง IN_STOCK" (saleAdapter.createForOnlineOrder
    // runs OUTSIDE the payment tx and its error is swallowed). An unresolved PAID
    // OnlineOrder on THIS productId means fulfillment is genuinely still open — every
    // resolution path (saleAdapter retry → PACKING, ShopCsService.cancel → CANCELLED,
    // ShopCsService.requestRefund → REFUNDED) moves the order OFF PAID, so this guard
    // self-clears once staff resolve the stuck order — unlike the old CONSUMED count.
    const unresolvedPaidOrder = await this.prisma.onlineOrder.count({
      where: { productId: input.productId, status: 'PAID' },
    });
    if (unresolvedPaidOrder > 0) {
      throw new ConflictException('เครื่องนี้ถูกจำหน่ายไปแล้ว — กรุณาเลือกเครื่องอื่น');
    }

    // Fix round: migration 20260986000000 ใส่ partial unique index `product_reservations_active_product_idx`
    // (UNIQUE product_id WHERE status='ACTIVE') แต่ cron กวาด hold หมดอายุทุก 5 นาที (reservation-cleanup.cron.ts)
    // — ในหน้าต่างระหว่างนั้น แถวหมดอายุยัง status='ACTIVE' ค้างอยู่ ขณะที่ findFirst ด้านล่างกรอง
    // expiresAt:{gt:now} เลยมองไม่เห็นแถวนี้ ตกไป create() ชน index ดิบ (P2002 → 500) sweep แบบ inline
    // นี้ปล่อยแถวหมดอายุค้างให้พ้นทางก่อนเช็ค/สร้าง — cron ยังทำหน้าที่กวาดใหญ่เหมือนเดิม ไม่ได้แทนที่กัน
    await this.prisma.productReservation.updateMany({
      where: { productId: input.productId, status: 'ACTIVE', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });

    const existing = await this.prisma.productReservation.findFirst({
      where: {
        productId: input.productId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
    });

    const expiresAt = new Date(Date.now() + RESERVATION_DURATION_MS);

    if (existing) {
      if (existing.sessionId === input.sessionId) {
        return this.prisma.productReservation.update({
          where: { id: existing.id },
          data: { expiresAt },
        });
      }
      throw new ConflictException('เครื่องนี้ถูกจองโดยลูกค้ารายอื่นอยู่ — กรุณาลองใหม่ภายหลัง');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const reservation = await tx.productReservation.create({
          data: {
            productId: input.productId,
            customerId: input.customerId,
            sessionId: input.sessionId,
            expiresAt,
            status: 'ACTIVE',
          },
        });

        // Fix 2 (F2, final-review forward-flag, closed here — proven with a
        // 554ms-block experiment): `product` above was read via a plain findFirst
        // with NO tx and NO lock. The create() above can BLOCK on the partial unique
        // index (`product_reservations_active_product_idx`) while a competing
        // checkout holds the same product's hold slot — and while we're blocked, the
        // in-store sale flow can sell the very same device out from under us (its
        // in-store-sale preemption sweep only flips holds that already EXIST at
        // the moment it runs; a hold created AFTER the sale committed is invisible to
        // it). Re-reading status INSIDE this tx, AFTER the create resolves, closes
        // the gap: at READ COMMITTED (Prisma's default isolation, unchanged here) every
        // statement sees the latest committed data, so a sale that committed WHILE our
        // INSERT was blocked is guaranteed visible to this SELECT once the INSERT
        // unblocks. The other interleaving — our hold commits BEFORE the sale's own
        // preemption sweep runs — is handled the existing way (preempt
        // flips this row PREEMPTED afterward, unrelated to this method). Both
        // orderings end safe; only the third interleaving (an ACTIVE hold surviving on
        // a device that's already SOLD) was the bug, and this closes it by rolling the
        // whole tx (including the INSERT) back via the throw below.
        const recheck = await tx.product.findUnique({
          where: { id: input.productId },
          select: { status: true },
        });
        if (recheck?.status !== 'IN_STOCK') {
          throw new ConflictException('เครื่องนี้เพิ่งถูกจำหน่าย กรุณาเลือกเครื่องอื่น');
        }

        return reservation;
      });
    } catch (err) {
      // เข็มขัดกันเรซ: สอง request พร้อมกันผ่าน findFirst ด้านบนพร้อมกันได้ (check-then-act) —
      // ผู้แพ้ชน partial unique index ที่ DB เป็น P2002 ดิบ แปลงเป็น 409 ที่อ่านออกแทน 500
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('เครื่องนี้ถูกจองโดยลูกค้ารายอื่นอยู่ — กรุณาลองใหม่ภายหลัง');
      }
      throw err;
    }
  }

  async cancel(reservationId: string, sessionId: string) {
    // sessionId is the capability token for the anonymous shop session — without it,
    // anyone who learns a reservation UUID could cancel another shopper's hold (grief/DoS).
    if (!sessionId) throw new BadRequestException('ต้องระบุ sessionId');
    const result = await this.prisma.productReservation.updateMany({
      where: { id: reservationId, sessionId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    if (result.count === 0) {
      throw new NotFoundException('ไม่พบการจองที่ยกเลิกได้ หรือไม่มีสิทธิ์ยกเลิก');
    }
    return { cancelled: true };
  }

  async expireOldReservations(): Promise<number> {
    const result = await this.prisma.productReservation.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  /**
   * แจ้งลูกค้าที่ hold โดนตัดหน้า (PREEMPTED) — best-effort ทาง LINE
   *
   * ทำเป็น cron แทนการยิงหลัง commit ใน sale-writer/contract-lifecycle เพราะ
   * (ก) โมดูลเงินไม่ควรผูกกับ LineOaService และ (ข) `preemptNotifiedAt` ทำให้ retry
   * ปลอดภัย — ยิงพลาดครั้งเดียวไม่วนซ้ำ และ deploy ใหม่ไม่ยิงย้อนหลังทั้งกอง
   *
   * ลูกค้าที่จองแบบ anonymous (ไม่มีออเดอร์) ไม่มีช่องทางติดต่อ — ตะกร้าฝั่งเว็บ
   * self-correct เองจาก poll 5 วินาที (`apps/web-shop/src/hooks/useCart.ts:32`)
   */
  async notifyPreemptedHolds(): Promise<number> {
    const holds = await this.prisma.productReservation.findMany({
      where: {
        status: 'PREEMPTED',
        preemptNotifiedAt: null,
        updatedAt: { gt: new Date(Date.now() - PREEMPT_NOTIFY_LOOKBACK_MS) },
      },
      select: {
        id: true,
        product: { select: { name: true } },
        onlineOrder: {
          select: {
            id: true,
            orderNumber: true,
            customer: { select: { lineIdShop: true } },
          },
        },
      },
      take: PREEMPT_NOTIFY_BATCH,
    });

    let sent = 0;
    for (const hold of holds) {
      const lineId = hold.onlineOrder?.customer?.lineIdShop;
      if (lineId) {
        try {
          await this.lineOa.sendFlexMessage(
            lineId,
            this.buildHoldPreemptedFlex({
              productName: hold.product?.name ?? 'สินค้าที่จองไว้',
              orderNumber: hold.onlineOrder?.orderNumber ?? null,
            }),
            'line-shop',
          );
          sent++;
        } catch (err) {
          this.logger.warn(`Failed to notify preempted hold ${hold.id}: ${err}`);
          Sentry.captureException(err, {
            level: 'warning',
            tags: { critical: 'hold-preempt-notify-failed' },
            extra: { reservationId: hold.id },
          });
        }
      }
      // สตางค์เสมอ แม้ไม่มีช่องทางส่ง/ส่งไม่สำเร็จ — ไม่งั้น cron จะวน scan แถวเดิมทุกนาที
      await this.prisma.productReservation.update({
        where: { id: hold.id },
        data: { preemptNotifiedAt: new Date() },
      });
    }
    return sent;
  }

  private buildHoldPreemptedFlex(input: {
    productName: string;
    orderNumber: string | null;
  }): FlexMessagePayload {
    return {
      type: 'flex',
      altText: `${input.productName} ถูกจำหน่ายไปก่อน — กรุณาเลือกเครื่องอื่น`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'เครื่องที่จองไว้ถูกจำหน่ายแล้ว', weight: 'bold', size: 'lg', wrap: true },
            { type: 'text', text: input.productName, size: 'sm', color: '#666666', margin: 'md', wrap: true },
            ...(input.orderNumber
              ? [{ type: 'text' as const, text: `คำสั่งซื้อ ${input.orderNumber}`, size: 'sm' as const, margin: 'sm' as const }]
              : []),
            { type: 'separator', margin: 'md' },
            {
              type: 'text',
              text: 'มีลูกค้าซื้อที่หน้าร้านก่อนพอดี ขออภัยจริงๆ ครับ/ค่ะ — ยังมีเครื่องรุ่นเดียวกันเครื่องอื่นอยู่ ทักแชทมาได้เลย',
              size: 'sm',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }

  /**
   * รายการ hold สำหรับแอดมิน — แสดงเท่าที่มีข้อมูลจริง: hold ของเว็บเป็น anonymous
   * (DTO มีแค่ productId + sessionId) ชื่อลูกค้าจึงโผล่เฉพาะเมื่อ hold ถูกผูกกับ
   * ออเดอร์หรือใบสมัครผ่อนแล้วเท่านั้น — ห้ามเดา/ห้ามโชว์ sessionId เป็นตัวแทนคน
   */
  async listAdminHolds(filter: { status?: string; productId?: string }) {
    const rows = await this.prisma.productReservation.findMany({
      where: {
        ...(filter.status ? { status: filter.status as never } : { status: 'ACTIVE' }),
        ...(filter.productId ? { productId: filter.productId } : {}),
      },
      select: {
        id: true,
        productId: true,
        status: true,
        reservedAt: true,
        expiresAt: true,
        product: {
          select: { name: true, imeiSerial: true, branch: { select: { name: true } } },
        },
        onlineOrder: { select: { orderNumber: true, customer: { select: { name: true } } } },
        onlineApplication: { select: { applicationNumber: true, fullName: true } },
      },
      orderBy: { reservedAt: 'desc' },
      take: 200,
    });

    const now = Date.now();
    return rows.map((r) => {
      const source: 'ORDER' | 'APPLICATION' | 'UNLINKED' = r.onlineOrder
        ? 'ORDER'
        : r.onlineApplication
          ? 'APPLICATION'
          : 'UNLINKED';
      return {
        id: r.id,
        productId: r.productId,
        productName: r.product?.name ?? '-',
        imeiLast4: r.product?.imeiSerial ? r.product.imeiSerial.slice(-4) : null,
        branchName: r.product?.branch?.name ?? null,
        status: r.status,
        reservedAt: r.reservedAt,
        expiresAt: r.expiresAt,
        secondsRemaining: Math.max(0, Math.floor((r.expiresAt.getTime() - now) / 1000)),
        source,
        orderNumber: r.onlineOrder?.orderNumber ?? null,
        applicationNumber: r.onlineApplication?.applicationNumber ?? null,
        customerName: r.onlineOrder?.customer?.name ?? r.onlineApplication?.fullName ?? null,
      };
    });
  }

  /** ปลด hold ด้วยมือ (OWNER/BM) — ใช้เมื่อลูกค้าหน้าร้านยืนรออยู่และ hold เว็บค้างอยู่ */
  async releaseHold(reservationId: string, adminUserId: string) {
    const hold = await this.prisma.productReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        status: true,
        productId: true,
        onlineOrder: { select: { orderNumber: true, status: true } },
      },
    });
    if (!hold || hold.status !== 'ACTIVE') {
      throw new NotFoundException('ไม่พบการจองที่ปลดได้ (อาจถูกใช้/หมดอายุไปแล้ว)');
    }
    if (hold.onlineOrder && hold.onlineOrder.status !== 'CANCELLED') {
      throw new ConflictException(
        `การจองนี้ผูกกับคำสั่งซื้อ ${hold.onlineOrder.orderNumber} ที่ยังไม่ถูกยกเลิก — ยกเลิกคำสั่งซื้อก่อน`,
      );
    }

    const result = await this.prisma.productReservation.updateMany({
      where: { id: reservationId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    if (result.count === 0) {
      throw new NotFoundException('ไม่พบการจองที่ปลดได้ (อาจถูกใช้/หมดอายุไปแล้ว)');
    }

    await this.audit.log({
      userId: adminUserId,
      action: 'HOLD_RELEASED',
      entity: 'product_reservation',
      entityId: reservationId,
      newValue: { productId: hold.productId, status: 'CANCELLED' },
    });
    return { released: true as const };
  }
}
