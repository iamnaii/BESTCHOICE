import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsAgingService } from './analytics-aging.service';

const mockPrisma = {
  $queryRawUnsafe: jest.fn(),
};

describe('AnalyticsAgingService', () => {
  let service: AnalyticsAgingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsAgingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AnalyticsAgingService);
  });

  it('returns all 5 buckets even when DB returns nothing', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.bucket)).toEqual(['1-7', '8-30', '31-60', '61-90', '90+']);
    expect(result.every((r) => r.count === 0 && r.outstanding === 0)).toBe(true);
  });

  it('maps DB rows into the bucket order', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      { bucket: '8-30', cnt: BigInt(3), outstanding: '4500.50' },
      { bucket: '90+', cnt: BigInt(1), outstanding: '12000' },
    ]);
    const result = await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(result.find((r) => r.bucket === '8-30')).toEqual({
      bucket: '8-30',
      count: 3,
      outstanding: 4500.5,
    });
    expect(result.find((r) => r.bucket === '90+')).toEqual({
      bucket: '90+',
      count: 1,
      outstanding: 12000,
    });
    expect(result.find((r) => r.bucket === '1-7')?.count).toBe(0);
  });

  it('caches result on second call (same scope)', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('separate cache key per branch scope (BRANCH_MANAGER different branch = miss)', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    await service.getAgingBuckets({ userRole: 'BRANCH_MANAGER', userBranchId: 'b1' });
    await service.getAgingBuckets({ userRole: 'BRANCH_MANAGER', userBranchId: 'b2' });
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('returns zero buckets on DB error (no throw)', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('boom'));
    const result = await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(result).toHaveLength(5);
    expect(result.every((r) => r.count === 0)).toBe(true);
  });
});
