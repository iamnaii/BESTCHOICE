import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DashboardService cache graceful degrade', () => {
  let service: DashboardService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cache: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    cache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    // Minimal prisma mock — _computeKPIs uses contract.count, product.count,
    // payment.aggregate, payment.count. Return 0 for counts and empty aggregates.
    prisma = {
      contract: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
      },
      product: { count: jest.fn().mockResolvedValue(0) },
      payment: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { amountDue: 0, amountPaid: 0, lateFee: 0 },
        }),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();
    service = mod.get(DashboardService);
  });

  it('returns cached value on hit without hitting DB', async () => {
    cache.get.mockResolvedValue({ totalContracts: 99 });
    const result = await service.getKPIs();
    expect(result).toEqual({ totalContracts: 99 });
    expect(prisma.contract.count).not.toHaveBeenCalled();
  });

  it('falls through and computes on cache miss', async () => {
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);
    await service.getKPIs();
    expect(prisma.contract.count).toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalled();
  });

  it('computes + returns when cache.get throws (Redis down)', async () => {
    cache.get.mockRejectedValue(new Error('ECONNREFUSED'));
    cache.set.mockResolvedValue(undefined);
    // Should NOT throw — must degrade gracefully
    await expect(service.getKPIs()).resolves.toBeDefined();
    expect(prisma.contract.count).toHaveBeenCalled();
  });

  it('returns computed value when cache.set throws (Redis down)', async () => {
    cache.get.mockResolvedValue(undefined);
    cache.set.mockRejectedValue(new Error('EPIPE'));
    // Should NOT throw — compute succeeded, cache write is best-effort
    await expect(service.getKPIs()).resolves.toBeDefined();
  });
});
