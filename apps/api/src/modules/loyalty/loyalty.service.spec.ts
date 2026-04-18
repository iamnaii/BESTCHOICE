import { Test, TestingModule } from '@nestjs/testing';
import { LoyaltyService } from './loyalty.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('LoyaltyService.awardReferralPoints — race-safe idempotency', () => {
  let service: LoyaltyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  // Shared tx mock so we can assert both updateMany + update in one transaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txUpdateMany: jest.Mock<any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txUpdate: jest.Mock<any, any>;

  beforeEach(async () => {
    txUpdateMany = jest.fn();
    txUpdate = jest.fn();

    prisma = {
      customer: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(
        async (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cb: (tx: any) => Promise<unknown>,
        ) => cb({ customer: { updateMany: txUpdateMany, update: txUpdate } }),
      ),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [LoyaltyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(LoyaltyService);
  });

  it('credits the referrer exactly once when called for the first time', async () => {
    prisma.customer.findUnique
      .mockResolvedValueOnce({
        id: 'referred-1',
        referredById: 'referrer-1',
        referralAwardedAt: null,
        deletedAt: null,
      })
      .mockResolvedValueOnce({ id: 'referrer-1', deletedAt: null });
    txUpdateMany.mockResolvedValue({ count: 1 }); // we won the race
    txUpdate.mockResolvedValue({ id: 'referrer-1' });

    await service.awardReferralPoints('referred-1');

    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { id: 'referred-1', referralAwardedAt: null },
      data: { referralAwardedAt: expect.any(Date) },
    });
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'referrer-1' },
        data: { loyaltyBalance: { increment: service.referralPoints } },
      }),
    );
  });

  it('does NOT credit again when referralAwardedAt is already set (fast path)', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({
      id: 'referred-1',
      referredById: 'referrer-1',
      referralAwardedAt: new Date('2026-01-01'),
      deletedAt: null,
    });

    await service.awardReferralPoints('referred-1');

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(txUpdateMany).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('does NOT credit when a concurrent caller already claimed the award (race loser)', async () => {
    // findUnique returns the row as still unclaimed (stale read), but by the
    // time we run the atomic UPDATE another caller has already claimed it —
    // simulated by count: 0 from updateMany.
    prisma.customer.findUnique
      .mockResolvedValueOnce({
        id: 'referred-1',
        referredById: 'referrer-1',
        referralAwardedAt: null,
        deletedAt: null,
      })
      .mockResolvedValueOnce({ id: 'referrer-1', deletedAt: null });
    txUpdateMany.mockResolvedValue({ count: 0 }); // someone else got there first

    await service.awardReferralPoints('referred-1');

    expect(txUpdateMany).toHaveBeenCalledTimes(1);
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('is a no-op when the customer has no referrer', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce({
      id: 'referred-1',
      referredById: null,
      referralAwardedAt: null,
      deletedAt: null,
    });

    await service.awardReferralPoints('referred-1');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is a no-op when the referrer has been soft-deleted', async () => {
    prisma.customer.findUnique
      .mockResolvedValueOnce({
        id: 'referred-1',
        referredById: 'referrer-1',
        referralAwardedAt: null,
        deletedAt: null,
      })
      .mockResolvedValueOnce({ id: 'referrer-1', deletedAt: new Date() });

    await service.awardReferralPoints('referred-1');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
