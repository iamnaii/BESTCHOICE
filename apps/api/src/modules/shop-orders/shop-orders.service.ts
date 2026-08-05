import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { OnlineOrderSaleAdapter } from './online-order-sale.adapter';
import { consumeOrderHoldInTx } from './consume-order-hold.util';
import type { OnlineOrderStatus } from '@prisma/client';

@Injectable()
export class ShopOrdersService {
  private readonly logger = new Logger(ShopOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private saleAdapter: OnlineOrderSaleAdapter,
  ) {}

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

  /**
   * B5: เดิมเมธอดนี้ set PAID อย่างเดียว — ไม่ consume hold ไม่สร้าง Sale ไม่ flip
   * สถานะเครื่อง → ขายซ้ำได้ 100% โดยไม่ต้องอาศัย race เลย ตอนนี้วิ่ง path เดียวกับ
   * gateway confirm (`PaySolutionsConfirmationService.confirmOnlineOrderPayment`):
   * re-check IN_STOCK + consume hold ใน tx เดียว แล้วค่อยสร้าง Sale ผ่าน adapter
   */
  async confirmBankTransfer(orderId: string, adminUserId: string) {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        productId: true,
        reservationId: true,
      },
    });
    if (!order) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.status !== 'PENDING_BANK_REVIEW' && order.status !== 'PENDING_PAYMENT') {
      throw new ForbiddenException('คำสั่งซื้อนี้ยืนยันการรับเงินไปแล้ว หรืออยู่ในสถานะที่ยืนยันไม่ได้');
    }

    const { updated, fulfillable } = await this.prisma.$transaction(async (tx) => {
      const hold = await consumeOrderHoldInTx(tx, {
        orderId: order.id,
        productId: order.productId,
        reservationId: order.reservationId,
      });
      const row = await tx.onlineOrder.update({
        where: { id: order.id },
        data: {
          status: hold.fulfillable ? 'PAID' : 'PAYMENT_RECEIVED_UNFULFILLABLE',
          paidAt: new Date(),
          bankConfirmedById: adminUserId,
          ...(hold.fulfillable
            ? {}
            : { cancelReason: 'เครื่องถูกจำหน่ายก่อนยืนยันสลิป — ต้องคืนเงินลูกค้า' }),
        },
      });
      return { updated: row, fulfillable: hold.fulfillable };
    });

    if (!fulfillable) {
      this.logger.error(
        `Bank transfer confirmed for ${order.orderNumber} but product ${order.productId} is gone — refund required`,
      );
      Sentry.captureException(
        new Error(`Online order ${order.orderNumber} bank-confirmed but unfulfillable`),
        {
          level: 'error',
          tags: { critical: 'online-order-unfulfillable', orderNumber: order.orderNumber },
          extra: { orderId: order.id, productId: order.productId, adminUserId },
        },
      );
      return updated;
    }

    // เงินเข้าแล้ว — throw ตรงนี้ rollback ไม่ได้ ทำแบบเดียวกับ gateway path:
    // log + alarm แล้วปล่อยให้แอดมินสร้าง Sale เองถ้าจำเป็น
    try {
      await this.saleAdapter.createForOnlineOrder(order.id);
    } catch (err) {
      this.logger.error(`Failed to create Sale for ${order.orderNumber}: ${err}`);
      Sentry.captureException(err, {
        level: 'error',
        tags: { critical: 'online-order-sale-failed', orderNumber: order.orderNumber },
      });
      // B5: เหมือน gateway path — ห้ามปล่อยค้าง PAID เงียบ. แท็บ "ต้องคืนเงิน" กรองด้วย
      // PAYMENT_RECEIVED_UNFULFILLABLE เท่านั้น ถ้าไม่ย้ายสถานะ staff จะไม่เห็นงานนี้เลย
      try {
        const p = await this.prisma.product.findUnique({
          where: { id: order.productId },
          select: { status: true },
        });
        if (p?.status !== 'IN_STOCK') {
          const requeued = await this.prisma.onlineOrder.update({
            where: { id: order.id },
            data: {
              status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
              cancelReason: 'สร้างรายการขายไม่สำเร็จและเครื่องหลุดมือแล้ว — ต้องคืนเงินลูกค้า',
            },
          });
          Sentry.captureException(
            new Error(`Online order ${order.orderNumber} bank-confirmed but sale failed & product gone`),
            {
              level: 'error',
              tags: {
                critical: 'online-order-unfulfillable',
                orderNumber: order.orderNumber,
              },
            },
          );
          return requeued;
        }
      } catch (e2) {
        this.logger.error(`Failed to queue refund for ${order.orderNumber}: ${e2}`);
        Sentry.captureException(e2);
      }
      return updated;
    }

    const final = await this.prisma.onlineOrder.findUnique({ where: { id: order.id } });
    if (!final) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    return final;
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
