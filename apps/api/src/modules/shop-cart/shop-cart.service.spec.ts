import { Test } from '@nestjs/testing';
import { ShopCartService } from './shop-cart.service';
import { PrismaService } from '../../prisma/prisma.service';

const prismaMock = {
  productReservation: { findMany: jest.fn() },
};

describe('ShopCartService', () => {
  let service: ShopCartService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [ShopCartService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(ShopCartService);
  });

  it('returns active reservations for session with product joined', async () => {
    prismaMock.productReservation.findMany.mockResolvedValue([
      {
        id: 'r1',
        productId: 'p1',
        sessionId: 's1',
        expiresAt: new Date(Date.now() + 10 * 60000),
        status: 'ACTIVE',
        product: {
          id: 'p1',
          name: 'iPhone 13',
          costPrice: 12500,
          gallery: ['u1'],
          conditionGrade: 'A',
        },
      },
    ]);
    const items = await service.listForSession('s1');
    expect(items).toHaveLength(1);
    expect(items[0].product.name).toBe('iPhone 13');
    expect(items[0].product.sellingPrice).toBe(12500);
    expect(items[0].secondsRemaining).toBeGreaterThan(0);
  });

  it('filters out expired reservations even if still ACTIVE in DB', async () => {
    prismaMock.productReservation.findMany.mockResolvedValue([
      {
        id: 'r2',
        productId: 'p2',
        sessionId: 's1',
        expiresAt: new Date(Date.now() - 1000),
        status: 'ACTIVE',
        product: {
          id: 'p2',
          name: 'iPhone 14',
          costPrice: 18000,
          gallery: [],
          conditionGrade: null,
        },
      },
    ]);
    const items = await service.listForSession('s1');
    expect(items).toHaveLength(0);
  });
});
