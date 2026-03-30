import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface RiskFeatures {
  avgDaysLate: number;
  latePaymentRatio: number;
  maxConsecutiveLate: number;
  paymentConsistency: number;
  recentTrend: number;
  totalAmountRatio: number;
  contractAge: number;
}

interface PredictionResult {
  customerId: string;
  customerName: string;
  predictedDefaultProbability: number;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  features: RiskFeatures;
  recommendation: string;
  suggestedActions: string[];
}

@Injectable()
export class PredictiveRiskService {
  constructor(private prisma: PrismaService) {}

  async calculateFeatures(customerId: string): Promise<RiskFeatures> {
    const contracts = await this.prisma.contract.findMany({
      where: { customerId, deletedAt: null },
      select: {
        id: true,
        createdAt: true,
        payments: {
          select: {
            amountDue: true,
            amountPaid: true,
            dueDate: true,
            paidDate: true,
            status: true,
          },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    if (contracts.length === 0) {
      return {
        avgDaysLate: 0,
        latePaymentRatio: 0,
        maxConsecutiveLate: 0,
        paymentConsistency: 1,
        recentTrend: 0.5,
        totalAmountRatio: 0,
        contractAge: 0,
      };
    }

    const allPayments = contracts.flatMap((c) => c.payments);
    const paidPayments = allPayments.filter((p) => p.paidDate);

    // Average days late
    const daysLateList = paidPayments.map((p) => {
      const diff = (new Date(p.paidDate!).getTime() - new Date(p.dueDate).getTime()) / (1000 * 60 * 60 * 24);
      return Math.max(0, diff);
    });
    const avgDaysLate = daysLateList.length > 0
      ? daysLateList.reduce((s, d) => s + d, 0) / daysLateList.length
      : 0;

    // Late payment ratio
    const latePayments = paidPayments.filter((p) => {
      return new Date(p.paidDate!).getTime() > new Date(p.dueDate).getTime() + 24 * 60 * 60 * 1000;
    });
    const latePaymentRatio = paidPayments.length > 0
      ? latePayments.length / paidPayments.length
      : 0;

    // Max consecutive late
    let maxConsecutiveLate = 0;
    let currentStreak = 0;
    for (const p of paidPayments) {
      if (new Date(p.paidDate!).getTime() > new Date(p.dueDate).getTime() + 24 * 60 * 60 * 1000) {
        currentStreak++;
        maxConsecutiveLate = Math.max(maxConsecutiveLate, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    // Payment consistency (0 = inconsistent, 1 = consistent)
    let paymentConsistency = 1;
    if (daysLateList.length > 1) {
      const mean = daysLateList.reduce((s, d) => s + d, 0) / daysLateList.length;
      const variance = daysLateList.reduce((s, d) => s + Math.pow(d - mean, 2), 0) / daysLateList.length;
      const stdDev = Math.sqrt(variance);
      paymentConsistency = Math.max(0, 1 - stdDev / 30);
    }

    // Recent trend (compare last 3 vs first 3 payments)
    let recentTrend = 0.5;
    if (daysLateList.length >= 6) {
      const first3Avg = daysLateList.slice(0, 3).reduce((s, d) => s + d, 0) / 3;
      const last3Avg = daysLateList.slice(-3).reduce((s, d) => s + d, 0) / 3;
      if (first3Avg > 0) {
        recentTrend = Math.max(0, Math.min(1, 1 - (last3Avg - first3Avg) / first3Avg));
      } else {
        recentTrend = last3Avg === 0 ? 1 : 0.3;
      }
    }

    // Total amount ratio (paid / due)
    const totalDue = allPayments.reduce(
      (s, p) => s.add(new Prisma.Decimal(p.amountDue)),
      new Prisma.Decimal(0),
    );
    const totalPaid = allPayments.reduce(
      (s, p) => s.add(new Prisma.Decimal(p.amountPaid)),
      new Prisma.Decimal(0),
    );
    const totalAmountRatio = totalDue.gt(0) ? totalPaid.div(totalDue).toNumber() : 0;

    // Contract age in months
    const oldestContract = contracts.reduce((oldest, c) =>
      c.createdAt < oldest.createdAt ? c : oldest,
    );
    const contractAge = (Date.now() - oldestContract.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30);

    return {
      avgDaysLate: Math.round(avgDaysLate * 10) / 10,
      latePaymentRatio: Math.round(latePaymentRatio * 100) / 100,
      maxConsecutiveLate,
      paymentConsistency: Math.round(paymentConsistency * 100) / 100,
      recentTrend: Math.round(recentTrend * 100) / 100,
      totalAmountRatio: Math.round(totalAmountRatio * 100) / 100,
      contractAge: Math.round(contractAge * 10) / 10,
    };
  }

  async predictDefaultRisk(customerId: string): Promise<PredictionResult> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

    const features = await this.calculateFeatures(customerId);

    // Weighted scoring model
    let score = 0;
    score += (1 - features.latePaymentRatio) * 30;
    score += Math.max(0, 1 - features.avgDaysLate / 30) * 20;
    score += Math.max(0, 1 - features.maxConsecutiveLate / 5) * 15;
    score += features.paymentConsistency * 10;
    score += features.recentTrend * 15;
    score += Math.min(features.contractAge / 12, 1) * 10;

    score = Math.round(Math.max(0, Math.min(100, score)));

    const defaultProb = Math.round(100 - score);
    const riskLevel: PredictionResult['riskLevel'] =
      score >= 80 ? 'LOW' : score >= 60 ? 'MEDIUM' : score >= 40 ? 'HIGH' : 'CRITICAL';

    const recommendations: Record<string, string> = {
      LOW: 'ลูกค้าชำระเงินตรงเวลา สามารถอนุมัติสินเชื่อเพิ่มได้',
      MEDIUM: 'ลูกค้ามีประวัติชำระล่าช้าบ้าง ควรตรวจสอบเพิ่มเติม',
      HIGH: 'ลูกค้ามีความเสี่ยงสูง ควรเพิ่มเงินดาวน์หรือลดวงเงิน',
      CRITICAL: 'ลูกค้ามีความเสี่ยงวิกฤต ไม่แนะนำให้อนุมัติสินเชื่อเพิ่ม',
    };

    const suggestedActions: Record<string, string[]> = {
      LOW: ['พิจารณาอนุมัติสินเชื่อเพิ่ม', 'เสนอโปรโมชั่นลูกค้าชั้นดี'],
      MEDIUM: ['เพิ่มเงินดาวน์ 5-10%', 'ลดจำนวนงวดผ่อน', 'ติดตามชำระเงินใกล้ชิด'],
      HIGH: ['เพิ่มเงินดาวน์ 20%+', 'จำกัดวงเงินสินเชื่อ', 'ต้องมีผู้ค้ำประกัน', 'ติดตามหนี้ทุกสัปดาห์'],
      CRITICAL: ['ไม่อนุมัติสินเชื่อเพิ่ม', 'เร่งเก็บหนี้คงค้าง', 'ส่งเรื่องฝ่ายกฎหมาย'],
    };

    return {
      customerId: customer.id,
      customerName: customer.name,
      predictedDefaultProbability: defaultProb,
      riskScore: score,
      riskLevel,
      features,
      recommendation: recommendations[riskLevel],
      suggestedActions: suggestedActions[riskLevel],
    };
  }

  async batchScorePortfolio() {
    const customers = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        contracts: { some: { status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] }, deletedAt: null } },
      },
      select: { id: true, name: true },
    });

    const results = [];
    for (const customer of customers) {
      try {
        const prediction = await this.predictDefaultRisk(customer.id);
        results.push({
          customerId: customer.id,
          customerName: customer.name,
          riskScore: prediction.riskScore,
          riskLevel: prediction.riskLevel,
          defaultProbability: prediction.predictedDefaultProbability,
        });
      } catch {
        // Skip customers with errors
      }
    }

    const totalCustomers = results.length;
    const riskBreakdown = {
      LOW: results.filter((r) => r.riskLevel === 'LOW').length,
      MEDIUM: results.filter((r) => r.riskLevel === 'MEDIUM').length,
      HIGH: results.filter((r) => r.riskLevel === 'HIGH').length,
      CRITICAL: results.filter((r) => r.riskLevel === 'CRITICAL').length,
    };
    const avgScore = totalCustomers > 0
      ? Math.round(results.reduce((s, r) => s + r.riskScore, 0) / totalCustomers)
      : 0;

    return {
      totalCustomers,
      avgScore,
      riskBreakdown,
      customers: results.sort((a, b) => a.riskScore - b.riskScore),
      generatedAt: new Date().toISOString(),
    };
  }
}
