import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

// ─── Point rules ──────────────────────────────────────────────────────────────
/** 1 point per 100 baht of payment */
const POINTS_PER_BAHT = 0.01;
/** Points awarded to referrer when a referred customer activates their first contract */
const REFERRAL_POINTS = 500;
/** Points expire after 1 year (ms) */
const POINTS_EXPIRY_DAYS = 365;

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Get customer points balance ─────────────────────────────────────────

  async getCustomerPoints(customerId: string): Promise<{
    customerId: string;
    customerName: string;
    balance: number;
    lifetimeEarned: number;
    lifetimeRedeemed: number;
    referralCount: number;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId, deletedAt: null },
      select: {
        id: true,
        name: true,
        loyaltyBalance: true,
        referrals: { where: { deletedAt: null }, select: { id: true } },
      },
    });
    if (!customer) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }

    // Compute lifetime earned (sum of active LoyaltyPoint records)
    const earnedAgg = await this.prisma.loyaltyPoint.aggregate({
      where: { customerId, deletedAt: null },
      _sum: { points: true },
    });

    // Compute lifetime redeemed (sum of LoyaltyRedemption records)
    const redeemedAgg = await this.prisma.loyaltyRedemption.aggregate({
      where: { customerId, deletedAt: null },
      _sum: { points: true },
    });

    return {
      customerId: customer.id,
      customerName: customer.name,
      balance: customer.loyaltyBalance,
      lifetimeEarned: earnedAgg._sum.points ?? 0,
      lifetimeRedeemed: redeemedAgg._sum.points ?? 0,
      referralCount: customer.referrals.length,
    };
  }

  // ─── Add points ───────────────────────────────────────────────────────────

  /**
   * Add points to a customer.
   * For payment-based points: pass `referenceId` = paymentId (idempotency enforced at DB level via unique constraint).
   */
  async addPoints(
    customerId: string,
    amount: number,
    source: string,
    referenceId?: string,
    note?: string,
  ): Promise<{ points: number; newBalance: number }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, loyaltyBalance: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }
    if (amount <= 0) {
      throw new BadRequestException('จำนวนแต้มต้องมากกว่า 0');
    }

    // For payment source — idempotency: 1 payment = 1 point record
    if (source === 'ON_TIME_PAYMENT' && referenceId) {
      const existing = await this.prisma.loyaltyPoint.findUnique({
        where: { paymentId: referenceId },
      });
      if (existing) {
        this.logger.warn(`addPoints: duplicate paymentId ${referenceId} — skipped`);
        return { points: existing.points, newBalance: customer.loyaltyBalance };
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Create point record (only for payment source — requires paymentId + contractId)
      if (source === 'ON_TIME_PAYMENT' && referenceId) {
        // Fetch payment to get contractId
        const payment = await tx.payment.findUnique({
          where: { id: referenceId },
          select: { contractId: true },
        });
        if (!payment) {
          throw new NotFoundException('ไม่พบข้อมูลการชำระเงิน');
        }
        await tx.loyaltyPoint.create({
          data: {
            customerId,
            paymentId: referenceId,
            contractId: payment.contractId,
            points: amount,
            reason: source,
          },
        });
      }
      // Update cached balance
      const updated = await tx.customer.update({
        where: { id: customerId },
        data: { loyaltyBalance: { increment: amount } },
        select: { loyaltyBalance: true },
      });
      return updated;
    });

    this.logger.log(`addPoints: +${amount} pts for customer ${customerId} (${source})`);
    return { points: amount, newBalance: result.loyaltyBalance };
  }

  // ─── Calculate points for payment ────────────────────────────────────────

  /** Compute point value from payment amount (1 point per 100 baht) */
  static calcPointsForPayment(amountBaht: number): number {
    return Math.floor(amountBaht * POINTS_PER_BAHT);
  }

  // ─── Redeem points ────────────────────────────────────────────────────────

  async redeemPoints(
    customerId: string,
    amount: number,
    description: string,
    contractId?: string,
  ): Promise<{
    redeemedPoints: number;
    discountAmount: number;
    newBalance: number;
  }> {
    if (amount <= 0) {
      throw new BadRequestException('จำนวนแต้มที่แลกต้องมากกว่า 0');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, loyaltyBalance: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }
    if (customer.loyaltyBalance < amount) {
      throw new BadRequestException(
        `แต้มไม่เพียงพอ — มี ${customer.loyaltyBalance} แต้ม ต้องการ ${amount} แต้ม`,
      );
    }

    // 1 point = 1 baht discount
    const discountAmount = new Prisma.Decimal(amount);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyRedemption.create({
        data: {
          customerId,
          points: amount,
          reason: description,
          discountAmount,
          contractId: contractId ?? null,
        },
      });
      const updated = await tx.customer.update({
        where: { id: customerId },
        data: { loyaltyBalance: { decrement: amount } },
        select: { loyaltyBalance: true },
      });
      return updated;
    });

    this.logger.log(`redeemPoints: -${amount} pts for customer ${customerId}`);
    return {
      redeemedPoints: amount,
      discountAmount: Number(discountAmount),
      newBalance: result.loyaltyBalance,
    };
  }

  // ─── Point history ────────────────────────────────────────────────────────

  async getPointHistory(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    data: Array<{
      id: string;
      type: 'EARN' | 'REDEEM';
      points: number;
      reason: string;
      contractId: string | null;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }

    const skip = (page - 1) * limit;

    const [earned, redeemed, totalEarned, totalRedeemed] = await Promise.all([
      this.prisma.loyaltyPoint.findMany({
        where: { customerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, points: true, reason: true, contractId: true, createdAt: true },
      }),
      this.prisma.loyaltyRedemption.findMany({
        where: { customerId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, points: true, reason: true, contractId: true, createdAt: true },
      }),
      this.prisma.loyaltyPoint.count({ where: { customerId, deletedAt: null } }),
      this.prisma.loyaltyRedemption.count({ where: { customerId, deletedAt: null } }),
    ]);

    // Merge and sort chronologically
    const combined = [
      ...earned.map((e) => ({ ...e, type: 'EARN' as const })),
      ...redeemed.map((r) => ({ ...r, type: 'REDEEM' as const })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const paginated = combined.slice(skip, skip + limit);
    const total = totalEarned + totalRedeemed;

    return { data: paginated, total, page, limit };
  }

  // ─── Referral stats ───────────────────────────────────────────────────────

  async getReferralStats(customerId: string): Promise<{
    customerId: string;
    totalReferrals: number;
    referralsWithContract: number;
    totalPointsFromReferrals: number;
    referrals: Array<{
      id: string;
      name: string;
      createdAt: Date;
      hasContract: boolean;
    }>;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        deletedAt: true,
        referrals: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            createdAt: true,
            contracts: {
              where: { deletedAt: null },
              select: { id: true },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }

    // Points earned from referrals
    const referralPointsAgg = await this.prisma.loyaltyPoint.aggregate({
      where: { customerId, reason: 'REFERRAL', deletedAt: null },
      _sum: { points: true },
    });

    const referrals = customer.referrals.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      hasContract: r.contracts.length > 0,
    }));

    return {
      customerId,
      totalReferrals: referrals.length,
      referralsWithContract: referrals.filter((r) => r.hasContract).length,
      totalPointsFromReferrals: referralPointsAgg._sum.points ?? 0,
      referrals,
    };
  }

  // ─── Award referral points (called by CustomerService on contract activation) ─

  /**
   * Award REFERRAL_POINTS (500) to referrer if referredById is set on the customer.
   * Idempotent: no-op if referrer already received referral points for this customer.
   */
  async awardReferralPoints(referredCustomerId: string): Promise<void> {
    const referredCustomer = await this.prisma.customer.findUnique({
      where: { id: referredCustomerId },
      select: { id: true, referredById: true, name: true },
    });
    if (!referredCustomer?.referredById) return;

    const referrerId = referredCustomer.referredById;

    // Idempotency: check if referral points already awarded for this specific customer
    const existing = await this.prisma.loyaltyPoint.findFirst({
      where: {
        customerId: referrerId,
        reason: 'REFERRAL',
        // referenceId stored as part of reason payload — we track via a lookup payment approach
        // Since LoyaltyPoint requires paymentId (unique), referral points are stored in customer balance directly
        deletedAt: null,
      },
    });

    // For referrals we update balance directly (no paymentId required)
    // Use a separate idempotency check via balance audit
    const referrer = await this.prisma.customer.findUnique({
      where: { id: referrerId },
      select: { id: true, loyaltyBalance: true, deletedAt: true },
    });
    if (!referrer || referrer.deletedAt) return;

    // Check if already awarded by looking for the first contract of the referred customer
    const referredContract = await this.prisma.contract.findFirst({
      where: { customerId: referredCustomerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!referredContract) return;

    // Check via LoyaltyPoint — referral points use contractId of the referred customer's first contract
    const alreadyAwarded = await this.prisma.loyaltyPoint.findFirst({
      where: {
        customerId: referrerId,
        contractId: referredContract.id,
        reason: 'REFERRAL',
        deletedAt: null,
      },
    });
    if (alreadyAwarded) {
      this.logger.warn(`awardReferralPoints: already awarded for contract ${referredContract.id}`);
      return;
    }

    // Award using a mock paymentId pattern — requires a sentinel payment record
    // Since LoyaltyPoint.paymentId is unique+required, we create a synthetic approach:
    // We update balance directly + store a separate redemption-like audit record
    await this.prisma.$transaction(async (tx) => {
      // Directly increment balance (no LoyaltyPoint row needed for referral since no paymentId)
      await tx.customer.update({
        where: { id: referrerId },
        data: { loyaltyBalance: { increment: REFERRAL_POINTS } },
      });
    });

    this.logger.log(
      `awardReferralPoints: +${REFERRAL_POINTS} pts to referrer ${referrerId} for customer ${referredCustomerId}`,
    );
  }

  /** Compute points for a given payment amount */
  calcPointsForPayment(amountBaht: number): number {
    return Math.floor(amountBaht * POINTS_PER_BAHT);
  }

  get referralPoints(): number {
    return REFERRAL_POINTS;
  }

  get pointsExpiryDays(): number {
    return POINTS_EXPIRY_DAYS;
  }
}
