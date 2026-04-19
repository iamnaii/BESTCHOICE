import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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

/**
 * T3-C3: Per-customer daily redemption cap. Prevents a compromised account
 * or a colluding staff member from draining a loyalty balance in one go.
 * 5,000 points = 5,000 baht discount, which is ~1 full-month installment.
 */
const REDEMPTION_DAILY_CAP = 5000;

/**
 * T3-C3: High-value redemption threshold. Any single call above this requires
 * an OWNER to co-sign via `approverId`. 10,000 points = 10,000 baht — well
 * above a normal goodwill discount, so a manager override is appropriate.
 */
const REDEMPTION_OWNER_OVERRIDE_THRESHOLD = 10000;

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

  /**
   * T3-C3: Redeem points with anti-fraud guards.
   *
   * Guards:
   *   (1) `posTransactionId` is required — every redemption must point to a
   *       concrete POS/sale/contract event for audit.
   *   (2) Cumulative redemptions for a customer in the current day cannot
   *       exceed REDEMPTION_DAILY_CAP (5,000 pts). Protects against
   *       drain-in-one-go attacks.
   *   (3) A single call above REDEMPTION_OWNER_OVERRIDE_THRESHOLD (10,000
   *       pts) requires an `approverId` that belongs to an OWNER.
   */
  async redeemPoints(
    customerId: string,
    amount: number,
    description: string,
    posTransactionId: string,
    contractId?: string,
    approverId?: string,
  ): Promise<{
    redeemedPoints: number;
    discountAmount: number;
    newBalance: number;
  }> {
    if (amount <= 0) {
      throw new BadRequestException('จำนวนแต้มที่แลกต้องมากกว่า 0');
    }
    // (1) posTransactionId is mandatory — validated at DTO level too, but
    // defense-in-depth for internal callers bypassing the controller.
    if (!posTransactionId || !posTransactionId.trim()) {
      throw new BadRequestException('กรุณาระบุเลขที่ธุรกรรม POS');
    }

    // (3) OWNER override for high-value redemptions.
    if (amount > REDEMPTION_OWNER_OVERRIDE_THRESHOLD) {
      if (!approverId) {
        throw new ForbiddenException(
          `การแลกแต้มเกิน ${REDEMPTION_OWNER_OVERRIDE_THRESHOLD.toLocaleString()} แต้ม ต้องมีผู้อนุมัติระดับ OWNER`,
        );
      }
      const approver = await this.prisma.user.findUnique({
        where: { id: approverId },
        select: { id: true, role: true, isActive: true, deletedAt: true },
      });
      if (!approver || !approver.isActive || approver.deletedAt) {
        throw new NotFoundException('ไม่พบผู้อนุมัติ หรือผู้อนุมัติถูกปิดการใช้งาน');
      }
      if (approver.role !== 'OWNER') {
        throw new ForbiddenException(
          `ผู้อนุมัติต้องมีสิทธิ์ OWNER (role ปัจจุบัน: ${approver.role})`,
        );
      }
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

    // (2) Daily cap — sum redemptions since start-of-day (local server time).
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const dayAgg = await this.prisma.loyaltyRedemption.aggregate({
      where: {
        customerId,
        deletedAt: null,
        createdAt: { gte: startOfDay },
      },
      _sum: { points: true },
    });
    const alreadyRedeemedToday = dayAgg._sum.points ?? 0;
    if (alreadyRedeemedToday + amount > REDEMPTION_DAILY_CAP) {
      throw new BadRequestException(
        `เกินโควต้าแลกแต้มต่อวัน (ใช้ไปแล้ว ${alreadyRedeemedToday.toLocaleString()} แต้ม, ` +
          `สูงสุด ${REDEMPTION_DAILY_CAP.toLocaleString()} แต้ม/วัน)`,
      );
    }

    // 1 point = 1 baht discount
    const discountAmount = new Prisma.Decimal(amount);

    // Persist posTransactionId + approver (when present) in `reason` for
    // audit without touching the schema. Format is easy to grep for and
    // compatible with existing dashboards.
    const reasonParts = [description, `pos:${posTransactionId}`];
    if (approverId) reasonParts.push(`approver:${approverId}`);
    const reasonWithRefs = reasonParts.join(' | ');

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyRedemption.create({
        data: {
          customerId,
          points: amount,
          reason: reasonWithRefs,
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

    this.logger.log(
      `redeemPoints: -${amount} pts for customer ${customerId} ` +
        `pos=${posTransactionId}${approverId ? ` approver=${approverId}` : ''}`,
    );
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
   * Award REFERRAL_POINTS (500) to the referrer if referredById is set on the
   * customer. The atomic idempotency guarantee comes from the `updateMany`
   * compare-and-swap inside `$transaction` (run at Serializable isolation to
   * match the rest of the money-sensitive flows in this codebase). The outer
   * `findUnique` calls are non-atomic fast-path optimizations only — two
   * concurrent callers can both pass them; exactly one will then win the
   * updateMany race and credit the referrer.
   */
  async awardReferralPoints(referredCustomerId: string): Promise<void> {
    const referredCustomer = await this.prisma.customer.findUnique({
      where: { id: referredCustomerId },
      select: {
        id: true,
        referredById: true,
        referralAwardedAt: true,
        deletedAt: true,
      },
    });
    if (!referredCustomer || referredCustomer.deletedAt) return;
    if (!referredCustomer.referredById) return;
    if (referredCustomer.referralAwardedAt) return; // fast path — already awarded

    const referrerId = referredCustomer.referredById;

    const referrer = await this.prisma.customer.findUnique({
      where: { id: referrerId },
      select: { id: true, deletedAt: true },
    });
    if (!referrer || referrer.deletedAt) return;

    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.customer.updateMany({
          where: { id: referredCustomerId, referralAwardedAt: null },
          data: { referralAwardedAt: new Date() },
        });
        if (claimed.count === 0) return; // lost the race — someone else awarded

        await tx.customer.update({
          where: { id: referrerId },
          data: { loyaltyBalance: { increment: REFERRAL_POINTS } },
        });

        this.logger.log(
          `awardReferralPoints: +${REFERRAL_POINTS} pts to referrer ${referrerId} for customer ${referredCustomerId}`,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
