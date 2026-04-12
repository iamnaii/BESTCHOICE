import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustomerTier } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

/**
 * CustomerScoringService — calculates customer scores and tiers.
 *
 * Score components (0-100 each):
 * - paymentScore: % on-time payments
 * - engagementScore: chat response speed
 * - valueScore: total contract value relative to max
 * - riskScore: 100 - (overdue_days * 5)
 *
 * Total = weighted average (payment 40%, risk 30%, value 20%, engagement 10%)
 * Tier: VIP >= 80, STANDARD 50-79, AT_RISK < 50, NEW = no history
 */
@Injectable()
export class CustomerScoringService {
  private readonly logger = new Logger(CustomerScoringService.name);

  constructor(private prisma: PrismaService) {}

  /** Recalculate scores for all customers with contracts */
  @Cron('0 3 * * *', { timeZone: 'Asia/Bangkok' }) // Daily at 3 AM
  async recalculateAll(): Promise<void> {
    try {
      const customers = await this.prisma.customer.findMany({
        where: { deletedAt: null, contracts: { some: {} } },
        select: { id: true },
      });

      let updated = 0;
      for (const customer of customers) {
        await this.calculateAndSave(customer.id);
        updated++;
      }

      this.logger.log(`[CustomerScoring] Recalculated ${updated} scores`);
    } catch (err) {
      this.logger.error(`[CustomerScoring] Recalculation failed: ${err}`);
      Sentry.captureException(err, {
        tags: { module: 'crm', action: 'customer_scoring_cron' },
      });
    }
  }

  /** Calculate and save score for a single customer */
  async calculateAndSave(customerId: string) {
    const paymentScore = await this.calcPaymentScore(customerId);
    const engagementScore = 50; // Default — chat analytics integration later
    const valueScore = await this.calcValueScore(customerId);
    const riskScore = await this.calcRiskScore(customerId);

    // Weighted average
    const totalScore = Math.round(
      paymentScore * 0.4 +
      riskScore * 0.3 +
      valueScore * 0.2 +
      engagementScore * 0.1,
    );

    // Determine tier
    let tier: CustomerTier;
    const hasHistory = paymentScore !== 50 || valueScore !== 50;
    if (!hasHistory) {
      tier = CustomerTier.NEW;
    } else if (totalScore >= 80) {
      tier = CustomerTier.VIP;
    } else if (totalScore >= 50) {
      tier = CustomerTier.STANDARD;
    } else {
      tier = CustomerTier.AT_RISK;
    }

    await this.prisma.customerScore.upsert({
      where: { customerId },
      create: {
        customerId,
        paymentScore,
        engagementScore,
        valueScore,
        riskScore,
        totalScore,
        tier,
      },
      update: {
        paymentScore,
        engagementScore,
        valueScore,
        riskScore,
        totalScore,
        tier,
        lastCalculatedAt: new Date(),
      },
    });
  }

  private async calcPaymentScore(customerId: string): Promise<number> {
    const payments = await this.prisma.payment.findMany({
      where: { contract: { customerId }, deletedAt: null },
      select: { paidAt: true, dueDate: true },
    });

    if (payments.length === 0) return 50;

    const onTime = payments.filter(
      (p) => p.paidAt && p.dueDate && p.paidAt <= p.dueDate,
    ).length;

    return Math.round((onTime / payments.length) * 100);
  }

  private async calcValueScore(customerId: string): Promise<number> {
    const result = await this.prisma.contract.aggregate({
      where: { customerId, deletedAt: null },
      _sum: { financedAmount: true },
    });

    const value = Number(result._sum?.financedAmount ?? 0);
    if (value === 0) return 50;

    // Max value baseline: 100,000 THB
    const maxBaseline = 100000;
    return Math.min(100, Math.round((value / maxBaseline) * 100));
  }

  private async calcRiskScore(customerId: string): Promise<number> {
    const overdueContracts = await this.prisma.contract.findMany({
      where: {
        customerId,
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    if (overdueContracts.length === 0) return 80;

    // Check for overdue payments
    const now = new Date();
    const overduePayments = await this.prisma.payment.count({
      where: {
        contract: { customerId },
        dueDate: { lt: now },
        paidAt: null,
        deletedAt: null,
      },
    });

    return Math.max(0, 100 - overduePayments * 15);
  }

  /** Get score for a customer */
  async getScore(customerId: string) {
    return this.prisma.customerScore.findUnique({
      where: { customerId },
    });
  }
}
