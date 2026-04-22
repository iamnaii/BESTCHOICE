import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const CANCELLABLE_STATUSES = ['PENDING_PAYMENT', 'PAID'] as const;
const REFUNDABLE_STATUSES = ['PAID', 'PACKING', 'SHIPPED', 'DELIVERED'] as const;

@Injectable()
export class ShopCsService {
  constructor(private prisma: PrismaService) {}

  async cancel(orderNumber: string, customerId: string, reason: string) {
    const order = await this.prisma.onlineOrder.findUnique({ where: { orderNumber } });
    if (!order || order.customerId !== customerId || order.deletedAt) {
      throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    }
    if (!CANCELLABLE_STATUSES.includes(order.status as (typeof CANCELLABLE_STATUSES)[number])) {
      throw new BadRequestException('สถานะนี้ยกเลิกไม่ได้');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.onlineOrder.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          cancelReason: reason,
          cancelledAt: new Date(),
        },
      });
      await tx.productReservation.updateMany({
        where: { id: order.reservationId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      return updated;
    });
  }

  async requestRefund(
    orderNumber: string,
    customerId: string,
    type: 'FULL' | 'PARTIAL',
    reason?: string,
  ) {
    const order = await this.prisma.onlineOrder.findUnique({ where: { orderNumber } });
    if (!order || order.customerId !== customerId || order.deletedAt) {
      throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    }
    if (!REFUNDABLE_STATUSES.includes(order.status as (typeof REFUNDABLE_STATUSES)[number])) {
      throw new BadRequestException('สถานะนี้ขอคืนเงินไม่ได้');
    }

    // Mark as REFUNDED — actual gateway refund is performed manually by admin/finance
    return this.prisma.onlineOrder.update({
      where: { id: order.id },
      data: {
        status: 'REFUNDED',
        cancelReason: `[${type}] ${reason ?? ''}`.trim(),
        cancelledAt: new Date(),
      },
    });
  }
}
