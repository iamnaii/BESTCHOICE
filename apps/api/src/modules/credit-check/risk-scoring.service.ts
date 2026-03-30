import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type RiskLevel = 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK';

export interface RiskScoreResult {
  customerId: string;
  customerName: string;
  score: number;
  riskLevel: RiskLevel;
  factors: RiskFactor[];
  breakdown: RiskBreakdown;
  calculatedAt: string;
}

export interface RiskFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  score: number;
  maxScore: number;
  detail: string;
}

export interface RiskBreakdown {
  paymentHistoryScore: number;
  overdueScore: number;
  affordabilityScore: number;
  tenureScore: number;
}

@Injectable()
export class RiskScoringService {
  constructor(private prisma: PrismaService) {}

  /**
   * Calculate risk score for a customer based on payment history and financial data.
   * Score 0-100: LOW_RISK (80+), MEDIUM_RISK (50-79), HIGH_RISK (<50)
   */
  async calculateRiskScore(customerId: string): Promise<RiskScoreResult> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        salary: true,
        contracts: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
            monthlyPayment: true,
            totalMonths: true,
            createdAt: true,
            payments: {
              select: {
                status: true,
                dueDate: true,
                paidDate: true,
                amountDue: true,
                amountPaid: true,
                lateFee: true,
              },
              orderBy: { installmentNo: 'asc' },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }

    const factors: RiskFactor[] = [];
    const allPayments = customer.contracts.flatMap((c) => c.payments);

    // ─── Factor 1: Payment History (on-time %) — max 35 points ───
    const paymentHistoryScore = this.scorePaymentHistory(allPayments, factors);

    // ─── Factor 2: Overdue Count — max 25 points ───
    const overdueScore = this.scoreOverdueCount(allPayments, customer.contracts, factors);

    // ─── Factor 3: Affordability (salary vs monthly payment) — max 25 points ───
    const affordabilityScore = this.scoreAffordability(customer.salary, customer.contracts, factors);

    // ─── Factor 4: Tenure (contract age) — max 15 points ───
    const tenureScore = this.scoreTenure(customer.contracts, factors);

    const totalScore = Math.max(0, Math.min(100,
      paymentHistoryScore + overdueScore + affordabilityScore + tenureScore,
    ));

    const riskLevel: RiskLevel =
      totalScore >= 80 ? 'LOW_RISK' :
      totalScore >= 50 ? 'MEDIUM_RISK' :
      'HIGH_RISK';

    return {
      customerId: customer.id,
      customerName: customer.name,
      score: totalScore,
      riskLevel,
      factors,
      breakdown: {
        paymentHistoryScore,
        overdueScore,
        affordabilityScore,
        tenureScore,
      },
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Factor 1: On-time payment percentage (max 35 points)
   */
  private scorePaymentHistory(
    payments: { status: string; dueDate: Date; paidDate: Date | null }[],
    factors: RiskFactor[],
  ): number {
    const completedPayments = payments.filter((p) => p.status === 'PAID');
    if (completedPayments.length === 0) {
      factors.push({
        name: 'ประวัติการชำระ',
        impact: 'neutral',
        score: 15,
        maxScore: 35,
        detail: 'ยังไม่มีประวัติการชำระ — ให้คะแนนกลาง',
      });
      return 15;
    }

    const onTimeCount = completedPayments.filter((p) => {
      if (!p.paidDate) return false;
      return new Date(p.paidDate) <= new Date(p.dueDate);
    }).length;

    const onTimePercent = (onTimeCount / completedPayments.length) * 100;
    let score: number;

    if (onTimePercent >= 90) {
      score = 35;
    } else if (onTimePercent >= 75) {
      score = 28;
    } else if (onTimePercent >= 60) {
      score = 20;
    } else if (onTimePercent >= 40) {
      score = 12;
    } else {
      score = 5;
    }

    factors.push({
      name: 'ประวัติการชำระ',
      impact: onTimePercent >= 75 ? 'positive' : onTimePercent >= 50 ? 'neutral' : 'negative',
      score,
      maxScore: 35,
      detail: `ชำระตรงเวลา ${onTimePercent.toFixed(0)}% (${onTimeCount}/${completedPayments.length} งวด)`,
    });

    return score;
  }

  /**
   * Factor 2: Current overdue count (max 25 points)
   */
  private scoreOverdueCount(
    payments: { status: string; dueDate: Date }[],
    contracts: { status: string }[],
    factors: RiskFactor[],
  ): number {
    const overduePayments = payments.filter(
      (p) => p.status === 'OVERDUE' || (p.status === 'PENDING' && new Date(p.dueDate) < new Date()),
    );
    const overdueContracts = contracts.filter(
      (c) => c.status === 'OVERDUE' || c.status === 'DEFAULT',
    );

    let score: number;
    if (overduePayments.length === 0) {
      score = 25;
    } else if (overduePayments.length <= 1) {
      score = 18;
    } else if (overduePayments.length <= 3) {
      score = 10;
    } else {
      score = 3;
    }

    // Extra penalty for DEFAULT contracts
    if (overdueContracts.some((c) => c.status === 'DEFAULT')) {
      score = Math.max(0, score - 5);
    }

    factors.push({
      name: 'จำนวนค้างชำระ',
      impact: overduePayments.length === 0 ? 'positive' : 'negative',
      score,
      maxScore: 25,
      detail: overduePayments.length === 0
        ? 'ไม่มีงวดค้างชำระ'
        : `ค้างชำระ ${overduePayments.length} งวด${overdueContracts.length > 0 ? `, สัญญาค้าง ${overdueContracts.length} สัญญา` : ''}`,
    });

    return score;
  }

  /**
   * Factor 3: Salary vs monthly payment ratio (max 25 points)
   */
  private scoreAffordability(
    salary: Prisma.Decimal | null,
    contracts: { monthlyPayment: Prisma.Decimal; status: string }[],
    factors: RiskFactor[],
  ): number {
    const decSalary = salary ? new Prisma.Decimal(salary) : null;
    const activeContracts = contracts.filter(
      (c) => ['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(c.status),
    );
    const totalMonthlyPayment = activeContracts.reduce(
      (sum, c) => sum.add(new Prisma.Decimal(c.monthlyPayment)),
      new Prisma.Decimal(0),
    );

    if (!decSalary || decSalary.lessThanOrEqualTo(0)) {
      factors.push({
        name: 'ความสามารถในการชำระ',
        impact: 'neutral',
        score: 10,
        maxScore: 25,
        detail: 'ไม่มีข้อมูลรายได้ — ไม่สามารถประเมินได้',
      });
      return 10;
    }

    const ratio = totalMonthlyPayment.div(decSalary).toNumber();
    let score: number;

    if (ratio <= 0.2) {
      score = 25;
    } else if (ratio <= 0.3) {
      score = 20;
    } else if (ratio <= 0.4) {
      score = 14;
    } else if (ratio <= 0.5) {
      score = 8;
    } else {
      score = 3;
    }

    factors.push({
      name: 'ความสามารถในการชำระ',
      impact: ratio <= 0.3 ? 'positive' : ratio <= 0.4 ? 'neutral' : 'negative',
      score,
      maxScore: 25,
      detail: `ค่างวดรวม ${totalMonthlyPayment.toNumber().toLocaleString()} บาท / รายได้ ${decSalary.toNumber().toLocaleString()} บาท (${(ratio * 100).toFixed(0)}%)`,
    });

    return score;
  }

  /**
   * Factor 4: Contract tenure (max 15 points)
   * Longer history with good standing = more reliable
   */
  private scoreTenure(
    contracts: { createdAt: Date; totalMonths: number; status: string }[],
    factors: RiskFactor[],
  ): number {
    if (contracts.length === 0) {
      factors.push({
        name: 'อายุสัญญา',
        impact: 'neutral',
        score: 5,
        maxScore: 15,
        detail: 'ลูกค้าใหม่ — ยังไม่มีสัญญา',
      });
      return 5;
    }

    const oldestContract = contracts.reduce((oldest, c) =>
      new Date(c.createdAt) < new Date(oldest.createdAt) ? c : oldest,
    );
    const monthsSinceFirst = Math.floor(
      (Date.now() - new Date(oldestContract.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30),
    );
    const completedContracts = contracts.filter((c) => c.status === 'COMPLETED').length;

    let score: number;
    if (monthsSinceFirst >= 12 && completedContracts >= 1) {
      score = 15;
    } else if (monthsSinceFirst >= 6) {
      score = 11;
    } else if (monthsSinceFirst >= 3) {
      score = 8;
    } else {
      score = 5;
    }

    factors.push({
      name: 'อายุสัญญา',
      impact: monthsSinceFirst >= 6 ? 'positive' : 'neutral',
      score,
      maxScore: 15,
      detail: `ลูกค้ามา ${monthsSinceFirst} เดือน, สัญญา ${contracts.length} ฉบับ (สำเร็จ ${completedContracts})`,
    });

    return score;
  }

  /**
   * Batch risk scores for multiple customers (dashboard use)
   */
  async batchRiskScores(customerIds: string[]): Promise<RiskScoreResult[]> {
    const results: RiskScoreResult[] = [];
    for (const id of customerIds) {
      try {
        results.push(await this.calculateRiskScore(id));
      } catch {
        // Skip customers that don't exist
      }
    }
    return results;
  }

  /**
   * Portfolio-level risk distribution
   */
  async getPortfolioRiskDistribution(branchId?: string) {
    const branchFilter = branchId ? { branchId } : {};

    const activeContracts = await this.prisma.contract.findMany({
      where: {
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
        deletedAt: null,
        ...branchFilter,
      },
      select: { customerId: true },
      distinct: ['customerId'],
    });

    const customerIds = activeContracts.map((c) => c.customerId);
    const scores = await this.batchRiskScores(customerIds);

    const distribution = {
      LOW_RISK: { count: 0, customerIds: [] as string[] },
      MEDIUM_RISK: { count: 0, customerIds: [] as string[] },
      HIGH_RISK: { count: 0, customerIds: [] as string[] },
    };

    for (const s of scores) {
      distribution[s.riskLevel].count++;
      distribution[s.riskLevel].customerIds.push(s.customerId);
    }

    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length)
      : 0;

    return {
      totalCustomers: scores.length,
      averageScore: avgScore,
      distribution,
    };
  }
}
