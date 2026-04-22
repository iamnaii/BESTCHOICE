import { Test } from '@nestjs/testing';
import { ShopCheckoutService } from './shop-checkout.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ShopShippingService } from '../shop-shipping/shop-shipping.service';
import { PaySolutionsService } from '../paysolutions/paysolutions.service';
import { SalesService } from '../sales/sales.service';

const prismaMock: any = {
  productReservation: { findUnique: jest.fn() },
  onlineOrder: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
};
const promotionsMock: any = { findActivePromotions: jest.fn() };
const loyaltyMock: any = { getCustomerPoints: jest.fn() };
const shippingMock: any = { quote: jest.fn() };
const paysolutionsMock: any = { createOnlineOrderIntent: jest.fn() };
const salesMock: any = {};

describe('ShopCheckoutService', () => {
  let service: ShopCheckoutService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ShopCheckoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PromotionsService, useValue: promotionsMock },
        { provide: LoyaltyService, useValue: loyaltyMock },
        { provide: ShopShippingService, useValue: shippingMock },
        { provide: PaySolutionsService, useValue: paysolutionsMock },
        { provide: SalesService, useValue: salesMock },
      ],
    }).compile();
    service = mod.get(ShopCheckoutService);
  });

  describe('validatePromoCode', () => {
    it('validates a percentage promo and returns discount', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
        product: { costPrice: 10000 },
      });
      promotionsMock.findActivePromotions.mockResolvedValue([
        { id: 'promo1', code: 'SAVE10', type: 'PERCENTAGE_DISCOUNT', value: 10, maxUsageCount: 100, currentUsageCount: 5 },
      ]);
      const result = await service.validatePromoCode({ code: 'SAVE10', reservationId: 'r1' });
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(1000);
      expect(result.promotionId).toBe('promo1');
    });

    it('rejects expired reservation', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'EXPIRED', expiresAt: new Date(Date.now() - 60000),
        product: { costPrice: 10000 },
      });
      await expect(
        service.validatePromoCode({ code: 'SAVE10', reservationId: 'r1' })
      ).rejects.toThrow();
    });

    it('rejects unknown promo code', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
        product: { costPrice: 10000 },
      });
      promotionsMock.findActivePromotions.mockResolvedValue([]);
      const result = await service.validatePromoCode({ code: 'INVALID', reservationId: 'r1' });
      expect(result.valid).toBe(false);
    });
  });

  describe('validateLoyaltyRedemption', () => {
    it('allows redemption within balance + daily cap', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
        product: { costPrice: 10000 },
      });
      loyaltyMock.getCustomerPoints.mockResolvedValue({ balance: 2000 });
      const result = await service.validateLoyaltyRedemption({ reservationId: 'r1', points: 500 }, 'cust-1');
      expect(result.valid).toBe(true);
      expect(result.discountAmount).toBe(500);
    });

    it('rejects redemption exceeding balance', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
        product: { costPrice: 10000 },
      });
      loyaltyMock.getCustomerPoints.mockResolvedValue({ balance: 100 });
      const result = await service.validateLoyaltyRedemption({ reservationId: 'r1', points: 500 }, 'cust-1');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/ไม่เพียงพอ/);
    });

    it('rejects redemption exceeding daily cap (5000)', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
        product: { costPrice: 10000 },
      });
      loyaltyMock.getCustomerPoints.mockResolvedValue({ balance: 10000 });
      const result = await service.validateLoyaltyRedemption({ reservationId: 'r1', points: 5001 }, 'cust-1');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/5,?000/);
    });
  });

  describe('placeOrder', () => {
    const dto: any = {
      reservationId: 'r1',
      shippingMethod: 'KERRY',
      shippingAddress: {
        recipientName: 'บีม', phone: '0812345678',
        line1: '123 ม.1', subDistrict: 'ในเมือง', district: 'เมือง',
        province: 'ลพบุรี', postalCode: '15000',
      },
      paymentChannel: 'PROMPTPAY_QR',
    };

    it('creates OnlineOrder in PENDING_PAYMENT with PaySolutions intent for QR', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
        productId: 'p1', customerId: 'cust-1',
        product: { id: 'p1', costPrice: 12500, name: 'iPhone 13' },
      });
      shippingMock.quote.mockReturnValue({ method: 'KERRY', fee: 60, label: 'Kerry', etaDays: '1-2', available: true });
      prismaMock.onlineOrder.create.mockResolvedValue({ id: 'order-1', orderNumber: 'BC-260421-111111' });
      prismaMock.onlineOrder.update.mockResolvedValue({});
      paysolutionsMock.createOnlineOrderIntent.mockResolvedValue({ paymentLinkId: 'pl1', paymentUrl: 'https://pay/...' });

      const result = await service.placeOrder(dto, 'cust-1');
      expect(result.orderNumber).toMatch(/^BC-/);
      expect(result.paymentUrl).toBe('https://pay/...');
      expect(prismaMock.onlineOrder.create).toHaveBeenCalled();
    });

    it('for BANK_TRANSFER, does NOT call PaySolutions and returns without paymentUrl', async () => {
      prismaMock.productReservation.findUnique.mockResolvedValue({
        id: 'r1', status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000),
        productId: 'p1', customerId: 'cust-1',
        product: { id: 'p1', costPrice: 12500, name: 'iPhone 13' },
      });
      shippingMock.quote.mockReturnValue({ method: 'KERRY', fee: 60, label: 'Kerry', etaDays: '1-2', available: true });
      prismaMock.onlineOrder.create.mockResolvedValue({ id: 'order-2', orderNumber: 'BC-260421-222222' });

      const result = await service.placeOrder({ ...dto, paymentChannel: 'BANK_TRANSFER' } as any, 'cust-1');
      expect(result.paymentUrl).toBeUndefined();
      expect(paysolutionsMock.createOnlineOrderIntent).not.toHaveBeenCalled();
    });
  });
});
