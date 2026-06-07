import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { PrismaService } from '../../prisma/prisma.service';

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
