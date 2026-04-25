import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsLeaderboardService } from './analytics-leaderboard.service';

const mockPrisma = {
  $queryRawUnsafe: jest.fn(),
};

describe('AnalyticsLeaderboardService', () => {
  let service: AnalyticsLeaderboardService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsLeaderboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AnalyticsLeaderboardService);
  });

  it('returns empty array when no collectors qualify', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await service.getLeaderboard();
    expect(result).toEqual([]);
  });

  it('maps DB rows + computes promiseKeptPercent', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        collector_id: 'u1',
        name: 'แนน',
        assigned_count: BigInt(10),
        promise_kept: BigInt(7),
        promise_total: BigInt(10),
        avg_days_to_first_contact: 1.5,
        recovery_this_month: '15000.50',
      },
    ]);
    const result = await service.getLeaderboard();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      collectorId: 'u1',
      name: 'แนน',
      assignedCount: 10,
      promiseKeptPercent: 70,
      avgDaysToFirstContact: 1.5,
      recoveryThisMonth: 15000.5,
    });
  });

  it('promiseKeptPercent = 0 when no promises', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        collector_id: 'u1',
        name: 'A',
        assigned_count: BigInt(5),
        promise_kept: BigInt(0),
        promise_total: BigInt(0),
        avg_days_to_first_contact: 0,
        recovery_this_month: 0,
      },
    ]);
    const result = await service.getLeaderboard();
    expect(result[0].promiseKeptPercent).toBe(0);
  });

  it('caches result on second call', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    await service.getLeaderboard();
    await service.getLeaderboard();
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('returns empty list on DB error (no throw)', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('boom'));
    const result = await service.getLeaderboard();
    expect(result).toEqual([]);
  });
});
