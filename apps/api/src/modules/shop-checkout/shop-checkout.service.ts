import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ShopShippingService } from '../shop-shipping/shop-shipping.service';
import { PaySolutionsService } from '../paysolutions/paysolutions.service';
import { SalesService } from '../sales/sales.service';
import { ValidatePromoDto } from './dto/validate-promo.dto';
import { PlaceOrderDto, PaymentChannel } from './dto/place-order.dto';
import { generateOrderNumber } from './order-number.util';
import type { OnlinePaymentChannel, OnlineShippingMethod } from '@prisma/client';

export interface ValidatePromoResult {
  valid: boolean;
  reason?: string;
  discountAmount: number;
  promotionId?: string;
}

@Injectable()
export class ShopCheckoutService {
  constructor(
    private prisma: PrismaService,
    private promotions: PromotionsService,
    private loyalty: LoyaltyService,
    private shipping: ShopShippingService,
    private paysolutions: PaySolutionsService,
    private sales: SalesService,
  ) {}

  private async loadActiveReservation(reservationId: string) {
    const r = await this.prisma.productReservation.findUnique({
      where: { id: reservationId },
      include: { product: true },
    });
    if (!r) throw new NotFoundException('ไม่พบรายการที่จองไว้');
    if (r.status !== 'ACTIVE' || r.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('reservation หมดอายุแล้ว — กรุณาเลือกสินค้าใหม่');
    }
    return r;
  }

  async validatePromoCode(dto: ValidatePromoDto): Promise<ValidatePromoResult> {
    const reservation = await this.loadActiveReservation(dto.reservationId);
    const promos = await this.promotions.findActivePromotions();
    const promo = (promos as any[]).find(
      (p: any) => p.code && p.code.toUpperCase() === dto.code.toUpperCase(),
    );
    if (!promo) {
      return { valid: false, reason: 'โค้ดส่วนลดไม่ถูกต้องหรือหมดอายุ', discountAmount: 0 };
    }
    if (promo.maxUsageCount && promo.currentUsageCount >= promo.maxUsageCount) {
      return { valid: false, reason: 'โค้ดนี้ถูกใช้เต็มจำนวนแล้ว', discountAmount: 0 };
    }
    if (reservation.product.cashPrice == null) {
      return { valid: false, reason: 'สินค้านี้ยังไม่ได้ตั้งราคาขาย', discountAmount: 0 };
    }
    // Price basis = retail cashPrice (web-shop = จ่ายเต็มผ่าน QR), NOT costPrice.
    // Money math in Prisma.Decimal (house rule — never JS number for เงิน).
    const price = new Prisma.Decimal(reservation.product.cashPrice);
    let discount = new Prisma.Decimal(0);
    if (promo.type === 'PERCENTAGE_DISCOUNT') {
      // whole-baht floor (preserves the prior Math.floor rounding)
      discount = price
        .times(new Prisma.Decimal(promo.value))
        .div(100)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
    } else if (promo.type === 'FIXED_DISCOUNT' || promo.type === 'FIXED_AMOUNT') {
      const fixed = new Prisma.Decimal(promo.value);
      discount = price.lessThan(fixed) ? price : fixed;
    } else {
      return { valid: false, reason: 'โค้ดนี้ใช้ในร้านออนไลน์ไม่ได้', discountAmount: 0 };
    }
    return { valid: true, discountAmount: discount.toNumber(), promotionId: promo.id };
  }

  async validateLoyaltyRedemption(
    dto: { reservationId: string; points: number },
    customerId: string,
  ): Promise<{ valid: boolean; reason?: string; discountAmount: number }> {
    await this.loadActiveReservation(dto.reservationId);
    const { balance } = await this.loyalty.getCustomerPoints(customerId);
    if (dto.points > balance) {
      return { valid: false, reason: 'แต้มสะสมของคุณไม่เพียงพอ', discountAmount: 0 };
    }
    if (dto.points > 5000) {
      return { valid: false, reason: 'แลกแต้มได้สูงสุด 5,000 แต้ม/วัน', discountAmount: 0 };
    }
    return { valid: true, discountAmount: dto.points };
  }

  async placeOrder(dto: PlaceOrderDto, customerId: string) {
    const reservation = await this.loadActiveReservation(dto.reservationId);
    if (reservation.customerId && reservation.customerId !== customerId) {
      throw new BadRequestException('reservation นี้ไม่ใช่ของคุณ');
    }

    const shippingQuote = this.shipping.quote(dto.shippingMethod as any, dto.shippingAddress.province);
    if (reservation.product.cashPrice == null) {
      throw new BadRequestException('สินค้านี้ยังไม่ได้ตั้งราคาขาย');
    }
    // Retail cashPrice (web-shop = จ่ายเต็มผ่าน QR), in Prisma.Decimal — all the
    // money math below stays Decimal (house rule), converting to number only at
    // the OnlineOrder write + PaySolutions/response boundary.
    const price = new Prisma.Decimal(reservation.product.cashPrice);

    let promoDiscount = 0;
    let promotionId: string | undefined;
    if (dto.promoCode) {
      const p = await this.validatePromoCode({ code: dto.promoCode, reservationId: dto.reservationId });
      if (!p.valid) throw new BadRequestException(p.reason ?? 'โค้ดส่วนลดใช้ไม่ได้');
      promoDiscount = p.discountAmount;
      promotionId = p.promotionId;
    }

    let loyaltyDiscount = 0;
    if (dto.loyaltyPointsRedeemed && dto.loyaltyPointsRedeemed > 0) {
      const l = await this.validateLoyaltyRedemption(
        { reservationId: dto.reservationId, points: dto.loyaltyPointsRedeemed },
        customerId,
      );
      if (!l.valid) throw new BadRequestException(l.reason ?? 'ใช้แต้มไม่ได้');
      loyaltyDiscount = l.discountAmount;
    }

    // Decimal arithmetic end-to-end; clamp ≥0; convert to number only here for
    // the OnlineOrder write + PaySolutions amount + API response (all 2-dp exact).
    const rawTotal = price
      .plus(shippingQuote.fee)
      .minus(promoDiscount)
      .minus(loyaltyDiscount);
    const totalAmount = (rawTotal.lessThan(0) ? new Prisma.Decimal(0) : rawTotal).toNumber();
    const orderNumber = generateOrderNumber();

    const order = await this.prisma.onlineOrder.create({
      data: {
        orderNumber,
        customerId,
        productId: reservation.productId,
        reservationId: reservation.id,
        productPrice: price,
        shippingFee: shippingQuote.fee,
        promoCode: dto.promoCode,
        promoDiscount,
        promotionUsageId: promotionId,
        loyaltyPointsUsed: dto.loyaltyPointsRedeemed ?? 0,
        loyaltyDiscount,
        totalAmount,
        shippingMethod: dto.shippingMethod as unknown as OnlineShippingMethod,
        shippingAddress: dto.shippingAddress as any,
        paymentChannel: dto.paymentChannel as unknown as OnlinePaymentChannel,
        status: 'PENDING_PAYMENT',
      },
    });

    if (dto.paymentChannel === PaymentChannel.BANK_TRANSFER) {
      return {
        orderNumber: order.orderNumber,
        orderId: order.id,
        totalAmount,
        paymentChannel: dto.paymentChannel,
      };
    }

    // The PaySolutions intent is an external HTTP round-trip, so it must run
    // OUTSIDE any $transaction (house rule: never hold a DB tx across a network
    // call). If it throws, the OnlineOrder created above (PENDING_PAYMENT) and
    // the still-ACTIVE ProductReservation would be orphaned — an order the
    // customer can never pay + a stuck stock hold that nothing reconciles.
    // Compensate: cancel the order, release the reservation, alarm, re-throw.
    try {
      const intent = await (this.paysolutions as any).createOnlineOrderIntent({
        onlineOrderId: order.id,
        amount: totalAmount,
        description: `ชำระเงินคำสั่งซื้อ ${orderNumber}`,
        channel: dto.paymentChannel,
      });

      // createOnlineOrderIntent already persists paymentLinkId on the order (and
      // emits its own orphan alarm on DB failure), so no second update is needed.
      return {
        orderNumber: order.orderNumber,
        orderId: order.id,
        totalAmount,
        paymentChannel: dto.paymentChannel,
        paymentUrl: intent.paymentUrl,
        paymentLinkId: intent.paymentLinkId,
      };
    } catch (err) {
      await this.prisma.$transaction(async (tx) => {
        await tx.onlineOrder.update({
          where: { id: order.id },
          data: {
            status: 'CANCELLED',
            cancelReason: 'สร้างรายการชำระเงินไม่สำเร็จ',
            cancelledAt: new Date(),
          },
        });
        await tx.productReservation.updateMany({
          where: { id: reservation.id, status: 'ACTIVE' },
          data: { status: 'CANCELLED' },
        });
      });
      Sentry.captureException(err, {
        level: 'error',
        tags: { critical: 'shop-checkout-orphan-order' },
        extra: {
          orderId: order.id,
          orderNumber,
          reservationId: reservation.id,
          channel: dto.paymentChannel,
        },
      });
      throw err;
    }
  }
}
