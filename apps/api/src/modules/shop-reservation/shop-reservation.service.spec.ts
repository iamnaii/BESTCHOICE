import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ShopReservationService } from './shop-reservation.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopReservationService', () => {
  let service: ShopReservationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn() },
      productReservation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      // Fix round 1/5 (Minor): readBoolFlag('shop_hide_demo_products') reads this — most
      // tests leave it unmocked (undefined → readRawValue catches → default false).
      systemConfig: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [ShopReservationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopReservationService);
  });

  describe('reserve', () => {
    it('creates 15-min reservation for available product', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.findFirst.mockResolvedValue(null);
      prisma.productReservation.create.mockResolvedValue({ id: 'r1', expiresAt: new Date(Date.now() + 900_000) });

      const result = await service.reserve({ productId: 'p1', sessionId: 's1' });

      expect(prisma.productReservation.create).toHaveBeenCalled();
      const data = prisma.productReservation.create.mock.calls[0][0].data;
      expect(data.productId).toBe('p1');
      expect(data.sessionId).toBe('s1');
      expect(data.status).toBe('ACTIVE');
      expect(new Date(data.expiresAt).getTime() - Date.now()).toBeGreaterThan(890_000);
      expect(new Date(data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(900_000);
    });

    it('rejects if product not found', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(NotFoundException);
    });

    it('rejects (404) เมื่อเครื่องไม่ผ่าน readiness — ขายแล้ว / ปิดจากเว็บ / ไม่มีราคา / ไม่มีรูป', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(
        'สินค้านี้ไม่พร้อมจำหน่ายบนเว็บ',
      );
      // fragment ถูกส่งเข้า query จริง (ไม่ได้จองเครื่องไม่มีราคาได้อีก)
      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ cashPrice: { gt: 0 } }]));
    });

    it('Fix round 1/5 (Minor): กรอง [DEMO] เมื่อเปิด flag shop_hide_demo_products — จองเครื่อง [DEMO] ไม่ได้ (404)', async () => {
      prisma.systemConfig.findFirst.mockResolvedValue({ value: 'true' });
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.reserve({ productId: 'demo-1', sessionId: 's1' })).rejects.toThrow(
        'สินค้านี้ไม่พร้อมจำหน่ายบนเว็บ',
      );
      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({ NOT: { name: { startsWith: '[DEMO]' } } });
    });

    it('rejects if already reserved by another session', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.findFirst.mockResolvedValue({
        id: 'r-existing',
        sessionId: 'other-session',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600_000),
      });
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(ConflictException);
    });

    it('extends existing reservation if same session re-reserves', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'p1', status: 'IN_STOCK' });
      prisma.productReservation.findFirst.mockResolvedValue({
        id: 'r-existing',
        sessionId: 's1',
        status: 'ACTIVE',
      });
      prisma.productReservation.update.mockResolvedValue({ id: 'r-existing', expiresAt: new Date() });

      await service.reserve({ productId: 'p1', sessionId: 's1' });

      expect(prisma.productReservation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'r-existing' } })
      );
      expect(prisma.productReservation.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('marks reservation as CANCELLED when sessionId matches the active hold', async () => {
      prisma.productReservation.updateMany.mockResolvedValue({ count: 1 });
      await service.cancel('r1', 's1');
      expect(prisma.productReservation.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', sessionId: 's1', status: 'ACTIVE' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
    });

    it('throws NotFound when sessionId does not own the reservation (IDOR guard)', async () => {
      prisma.productReservation.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.cancel('r1', 'wrong-session')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest when sessionId is missing', async () => {
      await expect(service.cancel('r1', '')).rejects.toThrow(BadRequestException);
      expect(prisma.productReservation.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('expireOldReservations', () => {
    it('updates all expired ACTIVE reservations to EXPIRED', async () => {
      prisma.productReservation.updateMany.mockResolvedValue({ count: 5 });
      const count = await service.expireOldReservations();
      expect(count).toBe(5);
      expect(prisma.productReservation.updateMany).toHaveBeenCalled();
    });
  });
});
