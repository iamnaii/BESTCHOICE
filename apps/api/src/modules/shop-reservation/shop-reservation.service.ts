import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { productReadinessWhere } from '../../utils/product-readiness.util';
import { readBoolFlag } from '../../utils/config.util';

const RESERVATION_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export interface ReserveInput {
  productId: string;
  sessionId: string;
  customerId?: string;
}

@Injectable()
export class ShopReservationService {
  constructor(private prisma: PrismaService) {}

  async reserve(input: ReserveInput) {
    // B0 §2.3: จองได้เฉพาะเครื่องที่ "พร้อมขึ้นเว็บ" จริง — เดิมจองเครื่องไม่มีราคาได้
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, ...productReadinessWhere({ excludeDemo }) },
      select: { id: true, status: true },
    });
    if (!product) throw new NotFoundException('สินค้านี้ไม่พร้อมจำหน่ายบนเว็บ');

    // B5 (1): เครื่องที่ "ขายไปแล้วผ่านออเดอร์เว็บ" อาจยัง IN_STOCK อยู่ได้ ถ้า
    // saleAdapter.createForOnlineOrder พังหลังเงินเข้า (มันอยู่นอก tx และ error ถูก swallow)
    // → ถ้ามี hold CONSUMED ค้างบนเครื่องนี้ ห้ามให้คนถัดไปจองซ้ำ
    const consumed = await this.prisma.productReservation.count({
      where: { productId: input.productId, status: 'CONSUMED' },
    });
    if (consumed > 0) {
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
}
