import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { OnlineOrderStatus } from '@prisma/client';

@Injectable()
export class ShopOrdersService {
  constructor(private prisma: PrismaService) {}

  async listMine(customerId: string) {
    return this.prisma.onlineOrder.findMany({
      where: { customerId, deletedAt: null },
      include: { product: { select: { id: true, name: true, gallery: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByOrderNumber(orderNumber: string, customerId: string) {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { orderNumber },
      include: { product: true },
    });
    if (!order) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.customerId !== customerId) throw new ForbiddenException('คำสั่งซื้อนี้ไม่ใช่ของคุณ');
    return order;
  }

  async uploadBankSlip(orderNumber: string, customerId: string, slipUrl: string) {
    const order = await this.getByOrderNumber(orderNumber, customerId);
    if (order.paymentChannel !== 'BANK_TRANSFER') {
      throw new ForbiddenException('คำสั่งซื้อนี้ไม่ได้เลือกโอนธนาคาร');
    }
    return this.prisma.onlineOrder.update({
      where: { id: order.id },
      data: { bankSlipUrl: slipUrl, status: 'PENDING_BANK_REVIEW' },
    });
  }

  // Admin methods — used by Task 10 controller
  async listAdminQueue(status?: string) {
    return this.prisma.onlineOrder.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status: status as OnlineOrderStatus } : {}),
      },
      include: {
        product: { select: { name: true, gallery: true, conditionGrade: true } },
        customer: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async confirmBankTransfer(orderId: string, adminUserId: string) {
    return this.prisma.onlineOrder.update({
      where: { id: orderId },
      data: { status: 'PAID', paidAt: new Date(), bankConfirmedById: adminUserId },
    });
  }

  async markShipped(orderId: string, trackingNumber: string) {
    return this.prisma.onlineOrder.update({
      where: { id: orderId },
      data: { status: 'SHIPPED', trackingNumber, shippedAt: new Date() },
    });
  }

  async markDelivered(orderId: string) {
    return this.prisma.onlineOrder.update({
      where: { id: orderId },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });
  }

  async cancelOrder(orderId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.onlineOrder.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
      });
      await tx.productReservation.updateMany({
        where: { id: order.reservationId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      return order;
    });
  }
}
