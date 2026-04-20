import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
    const product = await this.prisma.product.findUnique({ where: { id: input.productId } });
    if (!product || product.isOnlineVisible === false) throw new NotFoundException('สินค้านี้ไม่พบ');
    if (product.status !== 'IN_STOCK') throw new ConflictException('สินค้านี้ไม่อยู่ในสต็อกแล้ว');

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

    return this.prisma.productReservation.create({
      data: {
        productId: input.productId,
        customerId: input.customerId,
        sessionId: input.sessionId,
        expiresAt,
        status: 'ACTIVE',
      },
    });
  }

  async cancel(reservationId: string, sessionId: string) {
    return this.prisma.productReservation.update({
      where: { id: reservationId },
      data: { status: 'CANCELLED' },
    });
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
