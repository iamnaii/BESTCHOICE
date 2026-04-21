import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    const price = Number(reservation.product.costPrice);
    let discount = 0;
    if (promo.type === 'PERCENTAGE_DISCOUNT') {
      discount = Math.floor((price * Number(promo.value)) / 100);
    } else if (promo.type === 'FIXED_DISCOUNT' || promo.type === 'FIXED_AMOUNT') {
      discount = Math.min(price, Number(promo.value));
    } else {
      return { valid: false, reason: 'โค้ดนี้ใช้ในร้านออนไลน์ไม่ได้', discountAmount: 0 };
    }
    return { valid: true, discountAmount: discount, promotionId: promo.id };
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
    const price = Number(reservation.product.costPrice);

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

    const totalAmount = Math.max(0, price + shippingQuote.fee - promoDiscount - loyaltyDiscount);
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

    const intent = await (this.paysolutions as any).createOnlineOrderIntent({
      onlineOrderId: order.id,
      amount: totalAmount,
      description: `ชำระเงินคำสั่งซื้อ ${orderNumber}`,
      channel: dto.paymentChannel,
    });

    await this.prisma.onlineOrder.update({
      where: { id: order.id },
      data: { paymentLinkId: intent.paymentLinkId },
    });

    return {
      orderNumber: order.orderNumber,
      orderId: order.id,
      totalAmount,
      paymentChannel: dto.paymentChannel,
      paymentUrl: intent.paymentUrl,
      paymentLinkId: intent.paymentLinkId,
    };
  }
}
