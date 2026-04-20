import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ShopReservationService } from './shop-reservation.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopReservationService', () => {
  let service: ShopReservationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      productReservation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [ShopReservationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopReservationService);
  });

  describe('reserve', () => {
    it('creates 15-min reservation for available product', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'IN_STOCK', isOnlineVisible: true });
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
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(NotFoundException);
    });

    it('rejects if product not in stock', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'SOLD' });
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(ConflictException);
    });

    it('rejects if product not online visible', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'IN_STOCK', isOnlineVisible: false });
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(NotFoundException);
    });

    it('rejects if already reserved by another session', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'IN_STOCK', isOnlineVisible: true });
      prisma.productReservation.findFirst.mockResolvedValue({
        id: 'r-existing',
        sessionId: 'other-session',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600_000),
      });
      await expect(service.reserve({ productId: 'p1', sessionId: 's1' })).rejects.toThrow(ConflictException);
    });

    it('extends existing reservation if same session re-reserves', async () => {
      prisma.product.findUnique.mockResolvedValue({ id: 'p1', status: 'IN_STOCK', isOnlineVisible: true });
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
    it('marks reservation as CANCELLED', async () => {
      prisma.productReservation.update.mockResolvedValue({});
      await service.cancel('r1', 's1');
      expect(prisma.productReservation.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
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
