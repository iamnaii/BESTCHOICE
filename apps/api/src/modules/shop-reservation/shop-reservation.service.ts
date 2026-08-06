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
      throw new ConflictException('เครื่องนี้ถูกจองโดยลูกค้ารายอื่นอยู่ — รอ 15 นาที');
    }

    try {
      return await this.prisma.productReservation.create({
        data: {
          productId: input.productId,
          customerId: input.customerId,
          sessionId: input.sessionId,
          expiresAt,
          status: 'ACTIVE',
        },
      });
    } catch (err) {
      // เข็มขัดกันเรซ: สอง request พร้อมกันผ่าน findFirst ด้านบนพร้อมกันได้ (check-then-act) —
      // ผู้แพ้ชน partial unique index ที่ DB เป็น P2002 ดิบ แปลงเป็น 409 ที่อ่านออกแทน 500
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('เครื่องนี้ถูกจองโดยลูกค้ารายอื่นอยู่ กรุณาลองใหม่อีกครั้ง');
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

  async preemptByInStoreSale(productId: string): Promise<void> {
    await this.prisma.productReservation.updateMany({
      where: { productId, status: 'ACTIVE' },
      data: { status: 'PREEMPTED' },
    });
  }
}
