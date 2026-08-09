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
          costPrice: 9999,
          cashPrice: 15900,
          installmentPrice: 16900,
          gallery: ['u1'],
          conditionGrade: 'A',
        },
      },
    ]);
    const items = await service.listForSession('s1');
    expect(items).toHaveLength(1);
    expect(items[0].product.name).toBe('iPhone 13');
    expect(items[0].product.sellingPrice).toBe(15900);
    expect(items[0].secondsRemaining).toBeGreaterThan(0);
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain('9999');
  });

  it('falls back to installmentPrice when cashPrice is not set', async () => {
    prismaMock.productReservation.findMany.mockResolvedValue([
      {
        id: 'r3',
        productId: 'p3',
        sessionId: 's1',
        expiresAt: new Date(Date.now() + 10 * 60000),
        status: 'ACTIVE',
        product: {
          id: 'p3',
          name: 'iPhone 15',
          costPrice: 20000,
          cashPrice: null,
          installmentPrice: 14000,
          gallery: [],
          conditionGrade: null,
        },
      },
    ]);
    const items = await service.listForSession('s1');
    expect(items).toHaveLength(1);
    expect(items[0].product.sellingPrice).toBe(14000);
  });

  it('B0 (fix round 1/5, Important 2): filters out a reservation whose product has no price at all (cashPrice + installmentPrice both null) — a stale hold from before B0', async () => {
    // Mutation-testing gap the reviewer found: without this test, deleting the
    // `.filter((r) => Number(r.product.cashPrice ?? r.product.installmentPrice ?? 0) > 0)`
    // line in shop-cart.service.ts still left all 43 tests green.
    prismaMock.productReservation.findMany.mockResolvedValue([
      {
        id: 'r4',
        productId: 'p4',
        sessionId: 's1',
        expiresAt: new Date(Date.now() + 10 * 60000),
        status: 'ACTIVE',
        product: {
          id: 'p4',
          name: 'iPhone 16',
          costPrice: 21000,
          cashPrice: null,
          installmentPrice: null,
          gallery: [],
          conditionGrade: null,
        },
      },
    ]);
    const items = await service.listForSession('s1');
    expect(items).toHaveLength(0);
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
          cashPrice: 22000,
          installmentPrice: 23000,
          gallery: [],
          conditionGrade: null,
        },
      },
    ]);
    const items = await service.listForSession('s1');
    expect(items).toHaveLength(0);
  });
});
