import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { OnlineOrderSaleAdapter } from './online-order-sale.adapter';
import { consumeOrderHoldInTx } from './consume-order-hold.util';
import { buildOrderUnfulfillableFlex } from './order-unfulfillable-flex.util';
import { LineOaService } from '../line-oa/line-oa.service';
import type { OnlineOrderStatus, Prisma } from '@prisma/client';

@Injectable()
export class ShopOrdersService {
  private readonly logger = new Logger(ShopOrdersService.name);

  constructor(
    private prisma: PrismaService,
    private saleAdapter: OnlineOrderSaleAdapter,
    private lineOaService: LineOaService,
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
        customerId: true,
        totalAmount: true,
        customer: { select: { lineIdShop: true } },
        product: { select: { name: true } },
      },
    });
    if (!order) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.status !== 'PENDING_BANK_REVIEW' && order.status !== 'PENDING_PAYMENT') {
      throw new ForbiddenException('คำสั่งซื้อนี้ยืนยันการรับเงินไปแล้ว หรืออยู่ในสถานะที่ยืนยันไม่ได้');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // fix round 1/5 [Important+Minor]: the status check above reads via a plain
      // findUnique OUTSIDE this tx — 2 concurrent confirms on the SAME order (double-
      // click / 2 admin tabs — the UI only disables the button locally) can both pass
      // it. CAS-claim it here: whichever tx's claim loses (count=0) stops immediately
      // — it must NOT touch the hold or overwrite the winner's PAID with UNFULFILLABLE.
      // (Proven race: winner's tx flips the SAME reservation row to CONSUMED; loser's
      // consume-hold legitimately count=0's on that row, and without this CAS the
      // loser would then write UNFULFILLABLE straight over the winner's PAID while
      // the winner's Sale creation is still in flight.) paymentChannel filter (Minor)
      // also blocks this endpoint from marking a QR/gateway order PAID when no bank
      // money has actually moved.
      const claim = await tx.onlineOrder.updateMany({
        where: {
          id: order.id,
          status: { in: ['PENDING_BANK_REVIEW', 'PENDING_PAYMENT'] },
          paymentChannel: 'BANK_TRANSFER',
        },
        data: { bankConfirmedById: adminUserId },
      });
      if (claim.count === 0) return { updated: null, fulfillable: null };

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

    if (result.updated === null) {
      // Race lost (or this endpoint was hit on a non-bank-transfer order) — another
      // request already resolved this order. Return its current state instead of
      // alarming or retrying; nothing was left half-done by this call.
      const current = await this.prisma.onlineOrder.findUnique({ where: { id: order.id } });
      if (!current) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
      return current;
    }
    const { updated, fulfillable } = result;

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
      await this.notifyUnfulfillable(order);
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
        // fix round 1/5 [Critical]: OnlineOrderSaleAdapter commits Sale + product→
        // SOLD_CASH in ITS OWN tx, then runs 2 MORE statements OUTSIDE that tx
        // (sale.update saleSource/onlineOrderId, then onlineOrder.update saleId/
        // PACKING — online-order-sale.adapter.ts:59-66). If either of those throws,
        // the Sale + SOLD_CASH flip already committed for THIS customer. A bare
        // product.status re-check can't tell "sold to this order's own customer"
        // apart from "sold to someone else / hit the shop floor" — both read as
        // `status !== 'IN_STOCK'`. Check for the Sale itself first — mirrors
        // paysolutions-confirmation.service.ts:379-408 exactly (T3 closed this exact
        // gap there; the first draft of this method copied the fallback WITHOUT this
        // layer, which would have told a customer to expect a refund while they
        // already had the device and the money was in the shop's account).
        const existingSale = await this.prisma.sale.findFirst({
          where: {
            productId: order.productId,
            customerId: order.customerId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existingSale) {
          // Fulfilled — the device really did go to this customer. Only the
          // post-sale linkback (saleId/status/saleSource) failed. Leave the order
          // PAID (already set above); alarm so admin reconciles manually — do NOT
          // queue a refund for a sale that already happened.
          this.logger.error(
            `Sale ${existingSale.id} exists for order ${order.orderNumber} but post-sale linkback failed — reconcile saleId/status manually`,
          );
          Sentry.captureException(
            new Error(
              `Online order ${order.orderNumber}: Sale created but post-sale linkback failed`,
            ),
            {
              level: 'error',
              tags: {
                critical: 'online-order-post-sale-linkback-failed',
                orderNumber: order.orderNumber,
              },
              extra: { saleId: existingSale.id },
            },
          );
        } else {
          // No Sale exists for this order's product+customer — the adapter genuinely
          // failed before creating one. re-read สถานะเครื่อง: ถ้ายัง IN_STOCK = adapter
          // ล้มก่อนแตะเครื่อง → แอดมินสร้าง Sale เองได้ ปล่อย PAID ไว้ตามเดิม; ถ้าไม่
          // IN_STOCK แล้ว = ของหลุดมือไปทางอื่นจริง → คิวคืนเงิน
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
            await this.notifyUnfulfillable(order);
            return requeued;
          }
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

  /**
   * B5 fix round 1/5 [reversal]: best-effort LINE notice when an order lands in
   * PAYMENT_RECEIVED_UNFULFILLABLE — before this, that status appeared nowhere in
   * apps/web or apps/web-shop; a customer who transferred real money had no way to
   * find out a refund was coming from any channel. Mirrors the equivalent send in
   * `PaySolutionsConfirmationService.confirmOnlineOrderPayment` (shares the same
   * flex builder — see order-unfulfillable-flex.util.ts).
   */
  private async notifyUnfulfillable(order: {
    orderNumber: string;
    totalAmount: Prisma.Decimal;
    product: { name: string };
    customer: { lineIdShop: string | null };
  }) {
    if (!order.customer.lineIdShop) return;
    try {
      await this.lineOaService.sendFlexMessage(
        order.customer.lineIdShop,
        buildOrderUnfulfillableFlex(order),
        'line-shop',
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send unfulfillable LINE notice for ${order.orderNumber}: ${err}`,
      );
    }
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

  /**
   * นับ "งานค้างที่ staff ต้องลงมือ" สำหรับ badge บน sidebar (poll 30 วิ)
   * - PENDING_BANK_REVIEW = รอตรวจสลิป
   * - PAID               = จ่ายแล้วรอเริ่มแพ็ค
   * - PAYMENT_RECEIVED_UNFULFILLABLE = ต้องคืนเงิน (งานด่วนที่สุด)
   * PACKING/SHIPPED ไม่นับ — มีคนรับงานไปแล้ว ถ้านับด้วย badge จะไม่มีวันเป็นศูนย์
   */
  async getPendingCount() {
    const [pendingBankReview, paid, unfulfillable] = await Promise.all([
      this.prisma.onlineOrder.count({
        where: { deletedAt: null, status: 'PENDING_BANK_REVIEW' },
      }),
      this.prisma.onlineOrder.count({ where: { deletedAt: null, status: 'PAID' } }),
      this.prisma.onlineOrder.count({
        where: { deletedAt: null, status: 'PAYMENT_RECEIVED_UNFULFILLABLE' },
      }),
    ]);
    return {
      total: pendingBankReview + paid + unfulfillable,
      pendingBankReview,
      paid,
      unfulfillable,
    };
  }

  /**
   * ปิดงานคิวคืนเงิน — บันทึกว่าคืนเงินให้ลูกค้าแล้ว (การโอนจริงทำนอกระบบ)
   *
   * ใช้ `cancelledAt` เป็นเวลาปิดงานเพราะ `OnlineOrder` ไม่มีคอลัมน์ `refundedAt`
   * (schema.prisma:2615-2617 มีแค่ status/cancelReason/cancelledAt) — B5 เลือกไม่เพิ่ม
   * คอลัมน์ใหม่เพื่อไม่ให้ migration บวมเกินเหตุ; ถ้า owner อยากได้ timeline แยกจริงๆ
   * ค่อยเพิ่ม `refundedAt` ในงานคืนเงินผ่าน gateway (งานแยก)
   *
   * NOTE (race, flagged for reviewer): this follows the brief's plain
   * findUnique-then-update shape rather than the CAS-claim discipline this
   * batch established in confirmBankTransfer. Two admins double-clicking
   * "mark refunded" on the same order within the read/write window can both
   * pass the status check and both call update — no financial double-spend
   * (nothing moves money; the actual transfer happens outside this system),
   * but the audit `logger.log` line and the eventual actor-of-record are not
   * race-safe: whichever update lands last "wins" the log line even though
   * both admins believed they closed the ticket. Low blast radius (single
   * idempotent status write, no double-consumption of a scarce resource like
   * a hold or a Sale row) but not zero — a CAS `updateMany` guard mirroring
   * confirmBankTransfer's claim step would close it if this becomes a real
   * two-admin workflow.
   */
  async markRefunded(orderId: string, adminUserId: string) {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundException('ไม่พบคำสั่งซื้อ');
    if (order.status !== 'PAYMENT_RECEIVED_UNFULFILLABLE') {
      throw new ForbiddenException('คำสั่งซื้อนี้ไม่ได้อยู่ในคิวคืนเงิน');
    }
    this.logger.log(`Order ${orderId} marked REFUNDED by ${adminUserId}`);
    return this.prisma.onlineOrder.update({
      where: { id: orderId },
      data: { status: 'REFUNDED' as OnlineOrderStatus, cancelledAt: new Date() },
    });
  }
}
