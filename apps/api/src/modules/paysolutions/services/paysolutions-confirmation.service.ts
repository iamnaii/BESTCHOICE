import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import type { PartialPaymentLink } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { FlexMessagePayload } from '../../line-oa/flex-messages/base-template';
import { OnlineOrderSaleAdapter } from '../../shop-orders/online-order-sale.adapter';
import { PaymentsService } from '../../payments/payments.service';

export interface PaymentStatusResult {
  paymentId: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  gatewayRef?: string;
  gatewayStatus?: string;
  amount: number;
  paidAt?: Date;
}

/**
 * Owns the THREE non-installment webhook confirm flows plus the public status
 * read. None of these post a regulated JE directly (the partial path routes to
 * PaymentsService.recordPayment, which owns its own ledger pipeline). Reached
 * from {@link PaySolutionsWebhookService}'s routing branches BEFORE/OUTSIDE any
 * transaction. Constructed internally by {@link PaySolutionsService}; the
 * forwardRef'd PaymentsService is threaded through from the facade ctor.
 */
@Injectable()
export class PaySolutionsConfirmationService {
  private readonly logger = new Logger(PaySolutionsConfirmationService.name);

  constructor(
    private prisma: PrismaService,
    private lineOaService: LineOaService,
    private saleAdapter: OnlineOrderSaleAdapter,
    private paymentsService: PaymentsService,
  ) {}

  /**
   * ดึงสถานะ payment สำหรับ frontend polling
   */
  async getPaymentStatus(paymentId: string): Promise<PaymentStatusResult> {
    // ลองหาจาก Payment ID ก่อน
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (payment) {
      return {
        paymentId: payment.id,
        status: payment.status === 'PAID' ? 'PAID' : payment.gatewayStatus === 'FAILED' ? 'FAILED' : 'PENDING',
        gatewayRef: payment.gatewayRef || undefined,
        gatewayStatus: payment.gatewayStatus || undefined,
        amount: Number(payment.amountDue),
        paidAt: payment.paidAt || undefined,
      };
    }

    // ลองหาจาก PaymentLink token (กรณี order reference)
    const link = await this.prisma.paymentLink.findFirst({
      where: { token: paymentId },
      include: { payment: true },
    });

    if (!link) {
      throw new NotFoundException('ไม่พบรายการชำระเงิน');
    }

    if (link.status === 'USED' && link.payment?.status === 'PAID') {
      return {
        paymentId: link.payment.id,
        status: 'PAID',
        gatewayRef: link.payment.gatewayRef || undefined,
        gatewayStatus: link.payment.gatewayStatus || undefined,
        amount: Number(link.amount),
        paidAt: link.payment.paidAt || undefined,
      };
    }

    if (link.status === 'EXPIRED') {
      return {
        paymentId: link.id,
        status: 'FAILED',
        amount: Number(link.amount),
      };
    }

    return {
      paymentId: link.id,
      status: 'PENDING',
      amount: Number(link.amount),
    };
  }

  /**
   * Webhook callback for cashier-initiated partial-payment QR.
   *
   * Idempotent — duplicate calls (PaySolutions retries) short-circuit when the
   * link is no longer ACTIVE. On success we mark the link PAID *first* so
   * recordPayment's auto-cancel hook (which targets ACTIVE links) sees nothing
   * to do. Failure paths just flip the link to CANCELLED — the underlying
   * Payment row stays untouched, cashier can re-send or fall back to manual.
   */
  async handlePartialPaymentCallback(
    link: PartialPaymentLink,
    webhookData: Record<string, string>,
  ): Promise<void> {
    const { refno, result_code, transaction_id } = webhookData;

    // Idempotent: PaySolutions retries up to 3x. After the first successful
    // callback link.status flips to PAID — subsequent invocations no-op.
    if (link.status !== 'ACTIVE') {
      this.logger.log(
        `Duplicate partial-payment webhook for refno=${refno} (status=${link.status}, idempotent skip)`,
      );
      return;
    }

    if (result_code !== '00') {
      // Customer cancelled / payment failed at the gateway.
      await this.prisma.partialPaymentLink.update({
        where: { id: link.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      this.logger.log(
        `Partial-payment FAILED: refno=${refno}, result_code=${result_code}`,
      );
      return;
    }

    // Mark PAID before recordPayment so its auto-cancel hook leaves us alone.
    await this.prisma.partialPaymentLink.update({
      where: { id: link.id },
      data: { status: 'PAID', paidAt: new Date(), gatewayRef: transaction_id ?? link.gatewayRef },
    });

    // Resolve a system OWNER + the QR-default cash account for the auto-record.
    const systemUser = await this.prisma.user.findFirst({
      where: { role: 'OWNER', deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!systemUser) {
      Sentry.captureMessage('Partial-payment webhook: no OWNER user for auto-record', {
        level: 'fatal',
        tags: { critical: 'paysolutions-partial-no-owner', refno },
        extra: { paymentId: link.paymentId },
      });
      return;
    }

    const qrDefault = await this.prisma.paymentMethodConfig.findFirst({
      where: { method: 'QR', isDefault: true, enabled: true, deletedAt: null },
      select: { accountCode: true },
    });
    const depositAccountCode = qrDefault?.accountCode ?? '11-1201';

    // Look up installmentNo so recordPayment can find the right Payment row
    // (it keys on contractId + installmentNo, not paymentId).
    const payment = await this.prisma.payment.findUnique({
      where: { id: link.paymentId },
      select: { contractId: true, installmentNo: true },
    });
    if (!payment) {
      Sentry.captureMessage('Partial-payment webhook: payment not found', {
        level: 'fatal',
        tags: { critical: 'paysolutions-partial-orphan', refno },
        extra: { paymentId: link.paymentId },
      });
      return;
    }

    try {
      await this.paymentsService.recordPayment(
        payment.contractId,
        payment.installmentNo,
        Number(link.amount),
        'ONLINE_GATEWAY',
        systemUser.id,
        undefined, // evidenceUrl — webhook log is the audit trail
        `ชำระผ่าน Pay Solutions (${transaction_id || refno})`,
        refno, // transactionRef
        depositAccountCode,
        undefined, // toleranceApproverId
        'PARTIAL',
      );
      this.logger.log(
        `Partial-payment auto-recorded: refno=${refno}, payment=${link.paymentId}, amount=${link.amount}`,
      );
    } catch (err) {
      this.logger.error(
        `Partial-payment auto-record FAILED: refno=${refno}, payment=${link.paymentId}, err=${err}`,
      );
      Sentry.captureException(err, {
        level: 'fatal',
        tags: { critical: 'paysolutions-partial-record-fail', refno },
        extra: { paymentId: link.paymentId, amount: Number(link.amount) },
      });
      // Don't throw — return 200 to PaySolutions so they don't retry forever.
      // Ops will reconcile from Sentry alert.
    }
  }

  async confirmOnlineOrderPayment(
    onlineOrderId: string,
    webhookData: Record<string, string>,
  ): Promise<void> {
    const order = await this.prisma.onlineOrder.findUnique({
      where: { id: onlineOrderId },
      include: { customer: true, product: true, reservation: true },
    });
    if (!order) {
      this.logger.warn(`confirmOnlineOrderPayment: order ${onlineOrderId} not found`);
      return;
    }
    if (
      order.status === 'PAID' ||
      order.status === 'PACKING' ||
      order.status === 'SHIPPED'
    ) {
      this.logger.log(
        `Order ${order.orderNumber} already confirmed — idempotent skip`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.onlineOrder.update({
        where: { id: onlineOrderId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentRef: webhookData.transaction_id || webhookData.refno || null,
        },
      });
      await tx.productReservation.update({
        where: { id: order.reservationId },
        data: { status: 'CONSUMED', consumedById: order.id },
      });
    });

    // Create a Sale record for the paid online order. Adapter moves product to
    // SOLD_CASH, applies loyalty redemption, and transitions the OnlineOrder to
    // PACKING. Failures are logged (not re-thrown) — webhook must still return
    // 200 so PaySolutions doesn't retry, and admin can reconcile manually.
    try {
      await this.saleAdapter.createForOnlineOrder(order.id);
    } catch (err) {
      this.logger.error(
        `Failed to create Sale for online order ${order.orderNumber}: ${err}`,
      );
      Sentry.captureException(err, {
        level: 'error',
        tags: { critical: 'online-order-sale-failed', orderNumber: order.orderNumber },
      });
      // Don't re-throw — Sale can be created manually by admin if needed
    }

    if (order.customer.lineIdShop) {
      try {
        await this.lineOaService.sendFlexMessage(
          order.customer.lineIdShop,
          this.buildOrderPaidFlex(order),
          'line-shop',
        );
      } catch (err) {
        this.logger.warn(
          `Failed to send LINE notification for order ${order.orderNumber}: ${err}`,
        );
      }
    }
  }

  /**
   * สร้าง flex message แจ้งยืนยันชำระเงิน online order สำเร็จ
   */
  private buildOrderPaidFlex(order: {
    orderNumber: string;
    totalAmount: Prisma.Decimal;
    product: { name: string };
  }): FlexMessagePayload {
    return {
      type: 'flex',
      altText: `ชำระเงินคำสั่งซื้อ ${order.orderNumber} สำเร็จ`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: 'ชำระเงินสำเร็จ', weight: 'bold', size: 'lg' },
            {
              type: 'text',
              text: `คำสั่งซื้อ ${order.orderNumber}`,
              size: 'md',
              margin: 'md',
            },
            { type: 'text', text: order.product.name, size: 'sm', color: '#666666' },
            { type: 'separator', margin: 'md' },
            {
              type: 'text',
              text: `ยอดรวม ฿${Number(order.totalAmount).toLocaleString()}`,
              size: 'md',
              margin: 'md',
              weight: 'bold',
            },
            {
              type: 'text',
              text: 'ทางร้านจะจัดส่งภายใน 1 วันทำการ',
              size: 'xs',
              color: '#888888',
              margin: 'md',
              wrap: true,
            },
          ],
        },
      },
    };
  }

  /**
   * ยืนยันชำระเงินงวดออมดาวน์ — idempotent
   * — สร้าง SavingPlanPayment record
   * — อัปเดต totalSaved + nextPaymentDueAt + status (COMPLETED ถ้าครบเป้า)
   * — ส่ง LINE notification
   */
  async confirmSavingPlanPayment(
    savingPlanId: string,
    paymentLinkId: string,
    webhookData: Record<string, string>,
  ): Promise<void> {
    const plan = await this.prisma.savingPlan.findUnique({
      where: { id: savingPlanId },
      include: { customer: true, payments: true },
    });
    if (!plan) {
      this.logger.warn(`confirmSavingPlanPayment: plan ${savingPlanId} not found`);
      return;
    }
    const existing = await this.prisma.savingPlanPayment.findFirst({
      where: { paymentLinkId },
    });
    if (existing) {
      this.logger.log(
        `Saving-plan payment already recorded for paymentLinkId=${paymentLinkId} — idempotent skip`,
      );
      return;
    }

    const totalRaw = webhookData.total;
    const amount =
      totalRaw && !isNaN(Number(totalRaw)) ? new Prisma.Decimal(totalRaw) : new Prisma.Decimal(0);

    await this.prisma.$transaction(async (tx) => {
      await tx.savingPlanPayment.create({
        data: {
          savingPlanId,
          amount,
          paidAt: new Date(),
          paymentMethod: 'PROMPTPAY',
          paymentRef: webhookData.transaction_id || webhookData.refno || null,
          paymentLinkId,
        },
      });
      const newTotal = new Prisma.Decimal(plan.totalSaved).plus(amount);
      const completed = newTotal.gte(plan.targetAmount);
      const next = plan.nextPaymentDueAt ? new Date(plan.nextPaymentDueAt) : new Date();
      next.setMonth(next.getMonth() + 1);
      await tx.savingPlan.update({
        where: { id: savingPlanId },
        data: {
          totalSaved: newTotal,
          nextPaymentDueAt: completed ? null : next,
          status: completed ? 'COMPLETED' : 'ACTIVE',
          completedAt: completed ? new Date() : null,
        },
      });
    });

    if (plan.customer.lineIdShop) {
      try {
        const newTotal = new Prisma.Decimal(plan.totalSaved).plus(amount);
        await this.lineOaService.sendFlexMessage(
          plan.customer.lineIdShop,
          {
            type: 'flex',
            altText: 'ชำระออมดาวน์สำเร็จ',
            contents: {
              type: 'bubble',
              body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'ชำระออมดาวน์สำเร็จ', weight: 'bold', size: 'lg' },
                  { type: 'text', text: plan.planNumber, margin: 'md' },
                  {
                    type: 'text',
                    text: `ยอดสะสม ฿${Number(newTotal).toLocaleString()}`,
                    weight: 'bold',
                    margin: 'md',
                    color: '#1DB446',
                  },
                ],
              },
            },
          },
          'line-shop',
        );
      } catch (err) {
        this.logger.warn(
          `Failed to send LINE notification for saving plan ${plan.planNumber}: ${err}`,
        );
      }
    }
  }
}
