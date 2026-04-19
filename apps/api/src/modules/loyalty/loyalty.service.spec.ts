import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

// ─── T3-C3: Redemption anti-fraud guards ─────────────────────────────────
// 1. Daily cap (5,000 pts per customer)
// 2. Owner override for >10,000 pts in a single call
// 3. posTransactionId required (audit linkage)
describe('LoyaltyService.redeemPoints — T3-C3 anti-fraud', () => {
  let service: LoyaltyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cust-1',
          loyaltyBalance: 50000,
          deletedAt: null,
        }),
        update: jest.fn().mockResolvedValue({ loyaltyBalance: 45000 }),
      },
      user: {
        findUnique: jest.fn(),
      },
      loyaltyRedemption: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { points: 0 } }),
        create: jest.fn(),
      },
      $transaction: jest.fn(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (cb: (tx: any) => Promise<unknown>) =>
          cb({
            loyaltyRedemption: { create: jest.fn() },
            customer: { update: jest.fn().mockResolvedValue({ loyaltyBalance: 45000 }) },
          }),
      ),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [LoyaltyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(LoyaltyService);
  });

  it('allows redemption under the daily cap with posTransactionId', async () => {
    prisma.loyaltyRedemption.aggregate.mockResolvedValue({ _sum: { points: 2000 } });

    const res = await service.redeemPoints('cust-1', 1000, 'ส่วนลดงวด', 'POS-123');
    expect(res.redeemedPoints).toBe(1000);
    expect(res.newBalance).toBe(45000);
  });

  it('rejects when today + requested exceeds REDEMPTION_DAILY_CAP (5,000)', async () => {
    // Already redeemed 4,000 today — another 2,000 would push to 6,000.
    prisma.loyaltyRedemption.aggregate.mockResolvedValue({ _sum: { points: 4000 } });

    await expect(
      service.redeemPoints('cust-1', 2000, 'ส่วนลดงวด', 'POS-124'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects >10,000 pts redemption without an OWNER approverId', async () => {
    await expect(
      service.redeemPoints('cust-1', 12000, 'ส่วนลดใหญ่', 'POS-125'),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects >10,000 pts when approver is not OWNER', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'mgr-1',
      role: 'FINANCE_MANAGER',
      isActive: true,
      deletedAt: null,
    });

    await expect(
      service.redeemPoints('cust-1', 12000, 'ส่วนลดใหญ่', 'POS-125', undefined, 'mgr-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when posTransactionId is missing (internal caller bypass defense)', async () => {
    await expect(
      service.redeemPoints('cust-1', 500, 'ส่วนลด', ''),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when approver does not exist for high-value redemption', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.redeemPoints('cust-1', 12000, 'ส่วนลดใหญ่', 'POS-125', undefined, 'ghost'),
    ).rejects.toThrow(NotFoundException);
  });
});
