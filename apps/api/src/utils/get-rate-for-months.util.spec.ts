import { Prisma, PrismaClient } from '@prisma/client';
import { getRateForMonths } from './get-rate-for-months.util';

const mockPrisma = {
  interestConfigRate: {
    findUnique: jest.fn(),
  },
  interestConfig: {
    findUnique: jest.fn(),
  },
} as unknown as PrismaClient;

describe('getRateForMonths', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => { delete process.env.USE_NEW_RATE_LOOKUP; });

  it('returns ratePct from InterestConfigRate when feature flag ON and row exists', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'true';
    (mockPrisma.interestConfigRate.findUnique as jest.Mock).mockResolvedValue({
      ratePct: new Prisma.Decimal('0.50'),
    });
    const rate = await getRateForMonths(mockPrisma, 'config-1', 12);
    expect(rate.toString()).toBe('0.5');
  });

  it('falls back to interestRate × months when feature flag OFF', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'false';
    (mockPrisma.interestConfig.findUnique as jest.Mock).mockResolvedValue({
      interestRate: new Prisma.Decimal('0.04166667'),
    });
    const rate = await getRateForMonths(mockPrisma, 'config-1', 12);
    expect(rate.toFixed(4)).toBe('0.5000');
  });

  it('throws when row missing and flag ON', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'true';
    (mockPrisma.interestConfigRate.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getRateForMonths(mockPrisma, 'config-1', 9)).rejects.toThrow(/ไม่พบอัตรา/);
  });

  it('throws when row soft-deleted and flag ON', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'true';
    (mockPrisma.interestConfigRate.findUnique as jest.Mock).mockResolvedValue({
      ratePct: new Prisma.Decimal('0.50'),
      deletedAt: new Date(),
    });
    await expect(getRateForMonths(mockPrisma, 'config-1', 12)).rejects.toThrow(/ไม่พบอัตรา/);
  });

  it('throws when InterestConfig missing and flag OFF', async () => {
    process.env.USE_NEW_RATE_LOOKUP = 'false';
    (mockPrisma.interestConfig.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getRateForMonths(mockPrisma, 'config-1', 12)).rejects.toThrow(/ไม่พบ InterestConfig/);
  });
});
