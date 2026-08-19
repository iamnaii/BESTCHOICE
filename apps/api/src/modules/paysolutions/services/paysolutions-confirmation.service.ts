import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import type { PartialPaymentLink } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { FlexMessagePayload } from '../../line-oa/flex-messages/base-template';
import { OnlineOrderSaleAdapter } from '../../shop-orders/online-order-sale.adapter';
import { PaymentsService } from '../../payments/payments.service';
import { consumeOrderHoldInTx } from '../../shop-orders/consume-order-hold.util';
import { buildOrderUnfulfillableFlex } from '../../shop-orders/order-unfulfillable-flex.util';

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
        status:
          payment.status === 'PAID'
            ? 'PAID'
            : payment.gatewayStatus === 'FAILED'
              ? 'FAILED'
              : 'PENDING',
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
      // Review W2 (2026-07-02): a SUCCESS callback landing on an EXPIRED link means
      // the customer's money reached the gateway but nothing was recorded (the
      // hourly cron expired the link first). Alarm — ops must reconcile manually.
      if (link.status === 'EXPIRED' && result_code === '00') {
        // fatal — same class as the sibling partial-orphan/reschedule-exec-fail
        // alarms: customer's money reached the gateway but nothing was recorded.
        Sentry.captureMessage(
          'PaySolutions success webhook on EXPIRED link — money captured but unrecorded',
          {
            level: 'fatal',
            tags: { critical: 'paysolutions-expired-paid', refno },
            extra: {
              linkId: link.id,
              paymentId: link.paymentId,
              purpose: link.purpose,
              amount: link.amount.toString(),
            },
          },
        );
      }
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
      this.logger.log(`Partial-payment FAILED: refno=${refno}, result_code=${result_code}`);
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

    // ── ปรับดิว QR (purpose=RESCHEDULE) — เงินเข้าแล้ว ค่อยเลื่อนดิว ─────────────
    // Books the quote frozen at QR creation (link.metadata) and shifts the due
    // dates in ONE atom via rescheduleWithCollect. A fee that grew between QR
    // creation and payment is forgiven (the 24h link expiry bounds the drift).
    if (link.purpose === 'RESCHEDULE') {
      const meta = (link.metadata ?? {}) as {
        daysToShift?: number;
        splitMode?: 'SINGLE' | 'SPLIT';
        rescheduleFee?: string;
        lateFee?: string;
        collectAmount?: string;
      };
      try {
        if (!meta.daysToShift || !meta.splitMode) {
          throw new Error(`RESCHEDULE link ${refno} missing metadata (daysToShift/splitMode)`);
        }
        await this.paymentsService.rescheduleWithCollect({
          contractId: payment.contractId,
          installmentNo: payment.installmentNo,
          daysToShift: meta.daysToShift,
          splitMode: meta.splitMode,
          amount: Number(link.amount),
          paymentMethod: 'ONLINE_GATEWAY',
          recordedById: systemUser.id,
          transactionRef: refno,
          depositAccountCode,
          fixedQuote: {
            rescheduleFee: meta.rescheduleFee ?? '0',
            lateFee: meta.lateFee ?? '0',
            collectAmount: meta.collectAmount ?? link.amount.toString(),
          },
        });
        this.logger.log(
          `Reschedule auto-executed after QR paid: refno=${refno}, payment=${link.paymentId}, +${meta.daysToShift}d (${meta.splitMode})`,
        );
      } catch (err) {
        this.logger.error(
          `Reschedule-after-QR FAILED: refno=${refno}, payment=${link.paymentId}, err=${err}`,
        );
        Sentry.captureException(err, {
          level: 'fatal',
          tags: { critical: 'paysolutions-reschedule-exec-fail', refno },
          extra: { paymentId: link.paymentId, metadata: meta, amount: Number(link.amount) },
        });
        // Return 200 to PaySolutions (no infinite retry) — ops reconciles from
        // Sentry: the money IS at the gateway, the reschedule needs a manual replay.
      }
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
        true, // consumeAdvance
        undefined, // paidDate
        undefined, // lateFeeWaiverAmount
        undefined, // lateFeeWaiverReasonCode
        undefined, // waiverApproverId
        // ห้ามข้ามงวด — BYPASS here: the customer already paid at the gateway;
        // refusing to record would strand real money (this handler returns 200 to
        // PaySolutions with no retry). Sequence is enforced at QR-SEND time
        // (POST /payments/:id/partial-qr) where refusal is still safe.
        false,
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
      order.status === 'SHIPPED' ||
      order.status === 'PAYMENT_RECEIVED_UNFULFILLABLE' ||
      order.status === 'REFUNDED' ||
      // fix round 1/5 [Important 3]: a late-arriving webhook on an order that already
      // reached the customer (DELIVERED/COMPLETED) must NOT re-enter the lock-miss path —
      // that would flip it to PAYMENT_RECEIVED_UNFULFILLABLE and tell a customer holding
      // the device that we're refunding them. Pre-B5 this silently no-op'd via the same
      // gap; post-B5 the same gap actively lies to the customer, so it's closed here.
      order.status === 'DELIVERED' ||
      order.status === 'COMPLETED'
    ) {
      this.logger.log(`Order ${order.orderNumber} already confirmed — idempotent skip`);
      return;
    }

    // B5: จุดนี้คือ "เงินเข้าจริง" — ต้อง re-check ว่าเครื่องยังอยู่ใน tx เดียวกับที่ consume hold
    // เครื่องหลุดมือไปแล้ว (โดนขายหน้าร้าน/เข้าสัญญา) → เงินรับไปแล้วแต่ส่งของไม่ได้ = คิวคืนเงิน
    //
    // F2 (B5 final-review forward-flag, closed here): the already-confirmed status
    // check above reads via a plain findUnique OUTSIDE this tx — 2 concurrent gateway
    // webhooks for the SAME order (PaySolutions retries the callback up to 3x, or two
    // webhook deliveries racing) can both pass it. Mirrors ShopOrdersService
    // .confirmBankTransfer's CAS claim (shop-orders.service.ts ~103): CAS-claim it
    // here FIRST — whichever tx's claim loses (count=0) stops immediately, must NOT
    // touch the hold or overwrite the winner's PAID with UNFULFILLABLE. (Same proven
    // race as confirmBankTransfer: the winner's tx flips the SAME reservation row to
    // CONSUMED; the loser's consumeOrderHoldInTx legitimately count=0's on that row,
    // and without this CAS the loser would then write UNFULFILLABLE straight over the
    // winner's PAID while the winner's Sale creation is still in flight.)
    //
    // Claim predicate: status must still be PENDING_PAYMENT — the ONLY status a
    // gateway-channel order legitimately sits at when this webhook fires
    // (shop-checkout.service.ts always creates an OnlineOrder at PENDING_PAYMENT
    // regardless of channel; PENDING_BANK_REVIEW only exists for BANK_TRANSFER orders
    // via uploadBankSlip and is structurally unreachable here — a BANK_TRANSFER order
    // never receives a paymentLinkId, so paysolutions-webhook.service.ts's
    // `onlineOrder.findFirst({where:{paymentLinkId}})` routing can never resolve one
    // into this method at all). paymentChannel is scoped to the 2 gateway channels as
    // belt-and-suspenders — mirrors confirmBankTransfer's own paymentChannel guard in
    // reverse, blocking this path from ever claiming a BANK_TRANSFER order.
    const claim = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.onlineOrder.updateMany({
        where: {
          id: onlineOrderId,
          status: { in: ['PENDING_PAYMENT'] },
          paymentChannel: { in: ['PROMPTPAY_QR', 'CREDIT_DEBIT_CARD'] },
        },
        data: { updatedAt: new Date() },
      });
      if (claimed.count === 0) {
        // Fix round 1 (reviewer Important finding on the F2 review, closed here):
        // distinguish WHY the claim was lost before deciding whether this is an
        // ordinary duplicate or a signal that needs an alarm. Re-read the order's
        // CURRENT status inside this SAME tx, immediately after the failed claim —
        // the failed updateMany above matched 0 rows, so it never acquired a row
        // lock on this order; a plain SELECT here vs. a plain SELECT taken right
        // after this tx commits would see the identical value under READ COMMITTED
        // unless something else mutates the row in that gap, so reading it here
        // (zero elapsed time, same round-trip) minimizes that window to the
        // smallest possible instead of adding a second query after commit.
        const current = await tx.onlineOrder.findUnique({
          where: { id: onlineOrderId },
          select: { status: true },
        });
        return { claimed: false as const, currentStatus: current?.status ?? null };
      }

      const hold = await consumeOrderHoldInTx(tx, {
        orderId: order.id,
        productId: order.productId,
        reservationId: order.reservationId,
      });
      await tx.onlineOrder.update({
        where: { id: onlineOrderId },
        data: {
          status: hold.fulfillable ? 'PAID' : 'PAYMENT_RECEIVED_UNFULFILLABLE',
          paidAt: new Date(),
          paymentRef: webhookData.transaction_id || webhookData.refno || null,
          ...(hold.fulfillable
            ? {}
            : { cancelReason: 'เครื่องถูกจำหน่ายก่อนเงินเข้า — ต้องคืนเงินลูกค้า' }),
        },
      });
      return { claimed: true as const, fulfillable: hold.fulfillable };
    });

    if (!claim.claimed) {
      // Fix round 1: CANCELLED is the ONLY reachable non-payment-bearing status here
      // (status audit — see the doc-comment above the claim). Pre-F2, this same
      // scenario (a late successful webhook after the customer cancelled) fell
      // through into the unconditional tx and got a Sentry alarm + LINE refund
      // notice, even though it also wrongly clobbered CANCELLED with
      // PAYMENT_RECEIVED_UNFULFILLABLE. The F2 CAS claim correctly stops that
      // overwrite, but without this branch the "money captured on a dead order"
      // signal would vanish entirely — a real ops hole (captured payment, no alarm,
      // no refund-queue visibility). Alarm ONLY — do NOT touch the order row (that
      // would resurrect the status-overwrite bug F2 just closed).
      if (claim.currentStatus === 'CANCELLED') {
        const paymentRef = webhookData.transaction_id || webhookData.refno || 'unknown';
        this.logger.error(
          `Order ${order.orderNumber} payment captured by gateway AFTER cancellation — refund needed (paymentRef=${paymentRef})`,
        );
        Sentry.captureException(
          new Error(`Online order ${order.orderNumber} payment captured on a CANCELLED order`),
          {
            level: 'error',
            tags: {
              critical: 'payment-captured-on-cancelled-order',
              orderNumber: order.orderNumber,
            },
            extra: { orderId: order.id, paymentRef },
          },
        );
        return;
      }
      // Ordinary claim-loser: an already-confirmed/terminal status
      // (PAID/PACKING/SHIPPED/DELIVERED/COMPLETED/PAYMENT_RECEIVED_UNFULFILLABLE/
      // REFUNDED) — the routine idempotent-duplicate-webhook case. No alarm needed;
      // this order's outcome was already accounted for by whichever tx claimed it.
      this.logger.log(
        `Order ${order.orderNumber} already confirmed — idempotent skip (CAS claim lost)`,
      );
      return;
    }
    const fulfillable = claim.fulfillable;

    if (!fulfillable) {
      this.logger.error(
        `Order ${order.orderNumber} paid but product ${order.productId} no longer available — refund required`,
      );
      Sentry.captureException(
        new Error(`Online order ${order.orderNumber} paid but unfulfillable`),
        {
          level: 'error',
          tags: { critical: 'online-order-unfulfillable', orderNumber: order.orderNumber },
          extra: {
            orderId: order.id,
            productId: order.productId,
            reservationId: order.reservationId,
          },
        },
      );
      if (order.customer.lineIdShop) {
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
      return;
    }

    // Create a Sale record for the paid online order. Adapter moves product to
    // SOLD_CASH, applies loyalty redemption, and transitions the OnlineOrder to
    // PACKING. Failures are logged (not re-thrown) — webhook must still return
    // 200 so PaySolutions doesn't retry, and admin can reconcile manually.
    let markedUnfulfillableInCatch = false;
    try {
      await this.saleAdapter.createForOnlineOrder(order.id);
    } catch (err) {
      this.logger.error(`Failed to create Sale for online order ${order.orderNumber}: ${err}`);
      Sentry.captureException(err, {
        level: 'error',
        tags: { critical: 'online-order-sale-failed', orderNumber: order.orderNumber },
      });
      // B5: ห้ามปล่อยให้ออเดอร์ค้าง PAID เงียบๆ — แท็บ "ต้องคืนเงิน" ของแอดมิน (จะมาใน Task 11)
      // จะกรองด้วย PAYMENT_RECEIVED_UNFULFILLABLE เท่านั้น ถ้าไม่ย้ายสถานะ staff จะไม่มีวัน
      // เห็นงานนี้ (เห็นแค่ Sentry) ทั้งที่เงินลูกค้าอยู่ในมือร้านแล้ว
      try {
        // fix round 1/5 [Important 1]: SalesService.create commits Sale + product→SOLD_CASH
        // in ITS OWN tx (sale-writer.service.ts). But online-order-sale.adapter.ts then runs
        // 2 MORE statements OUTSIDE that tx (sale.update saleSource/onlineOrderId, then
        // onlineOrder.update saleId/PACKING) — if either of those throws, the Sale + SOLD_CASH
        // flip already committed for THIS customer. A bare product.status re-check can't tell
        // "sold to this order's own customer" apart from "sold to someone else / hit the
        // shop floor" — both read as `status !== 'IN_STOCK'`. Check for the Sale itself first.
        const existingSale = await this.prisma.sale.findFirst({
          where: {
            productId: order.productId,
            customerId: order.customerId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existingSale) {
          // Fulfilled — the device really did go to this customer. Only the post-sale
          // linkback (saleId/status/saleSource on the OnlineOrder+Sale rows) failed.
          // Leave the order PAID (already set in the tx above); alarm so admin
          // reconciles the linkback manually — do NOT queue a refund for a sale that
          // already happened.
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
            await this.prisma.onlineOrder.update({
              where: { id: onlineOrderId },
              data: {
                status: 'PAYMENT_RECEIVED_UNFULFILLABLE',
                cancelReason: 'สร้างรายการขายไม่สำเร็จและเครื่องหลุดมือแล้ว — ต้องคืนเงินลูกค้า',
              },
            });
            Sentry.captureException(
              new Error(`Online order ${order.orderNumber} paid but sale failed & product gone`),
              {
                level: 'error',
                tags: {
                  critical: 'online-order-unfulfillable',
                  orderNumber: order.orderNumber,
                },
              },
            );
            markedUnfulfillableInCatch = true;
          }
        }
      } catch (e2) {
        this.logger.error(`Failed to queue refund for ${order.orderNumber}: ${e2}`);
        Sentry.captureException(e2);
      }
      // Don't re-throw — Sale can be created manually by admin if needed
    }

    // fix round 1/5 [Important 2]: when the catch block above just moved the order to
    // PAYMENT_RECEIVED_UNFULFILLABLE, sending the "จะจัดส่งภายใน 1 วันทำการ" paid-flex
    // right after would contradict the refund notice the customer just got. Pick the
    // flex that matches what actually happened to the order.
    if (markedUnfulfillableInCatch) {
      if (order.customer.lineIdShop) {
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
      return;
    }

    if (order.customer.lineIdShop) {
      try {
        await this.lineOaService.sendFlexMessage(
          order.customer.lineIdShop,
          this.buildOrderPaidFlex(order),
          'line-shop',
        );
      } catch (err) {
        this.logger.warn(`Failed to send LINE notification for order ${order.orderNumber}: ${err}`);
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

  // buildOrderUnfulfillableFlex extracted to
  // ../../shop-orders/order-unfulfillable-flex.util.ts (B5 fix round 1/5 [reversal]) —
  // shared with ShopOrdersService.confirmBankTransfer, which sends the same notice.

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
