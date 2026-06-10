import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Risk-scoring sub-service for credit-check. Plain class (NOT @Injectable) —
 * instantiated internally by the CreditCheckService facade so the existing
 * 2-arg construction sites + module providers stay untouched.
 *
 * Owns: calculateRiskScore (rule-based auto score), getAutoScore (persisted
 * wrapper), calculateDtiRiskScore (salary-based DTI), and getCustomerHistory
 * (public AND an internal dependency of calculateDtiRiskScore — kept here, the
 * facade re-exposes it).
 */
export class CreditCheckRiskService {
  constructor(private prisma: PrismaService) {}

  // === Customer History ===
  async getCustomerHistory(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, addressCurrentType: true, salaryPayDay: true },
    });
    if (!customer || (customer as { deletedAt?: Date }).deletedAt) {
      throw new NotFoundException('ไม่พบลูกค้า');
    }

    const contracts = await this.prisma.contract.findMany({
      where: { customerId, deletedAt: null },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        totalMonths: true,
        monthlyPayment: true,
        payments: {
          select: { status: true },
        },
      },
    });

    const totalContracts = contracts.length;
    const completedContracts = contracts.filter(
      (c) => c.status === 'COMPLETED' || c.status === 'EARLY_PAYOFF',
    ).length;
    const activeContracts = contracts.filter(
      (c) => c.status === 'ACTIVE' || c.status === 'OVERDUE',
    ).length;

    // Calculate outstanding from active contracts
    let currentOutstanding = 0;
    for (const contract of contracts) {
      if (contract.status === 'ACTIVE' || contract.status === 'OVERDUE') {
        const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;
        // Floor at 0: a contract with more PAID rows than totalMonths (data drift,
        // re-runs) must not subtract from outstanding — it has nothing left to owe.
        const remaining = Math.max(0, contract.totalMonths - paidCount);
        currentOutstanding += remaining * Number(contract.monthlyPayment);
      }
    }

    // Payment history across all contracts
    let onTimePayments = 0;
    let latePayments = 0;
    for (const contract of contracts) {
      for (const payment of contract.payments) {
        if (payment.status === 'PAID') {
          onTimePayments++;
        } else if (payment.status === 'OVERDUE') {
          latePayments++;
        }
      }
    }

    const totalPayments = onTimePayments + latePayments;
    const onTimeRate = totalPayments > 0 ? Math.round((onTimePayments / totalPayments) * 100) / 100 : 0;
    const isReturningCustomer = totalContracts > 0;

    return {
      customerId,
      totalContracts,
      completedContracts,
      activeContracts,
      currentOutstanding: Math.round(currentOutstanding * 100) / 100,
      onTimePayments,
      latePayments,
      onTimeRate,
      isReturningCustomer,
      contracts: contracts.map((c) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        status: c.status,
        totalMonths: c.totalMonths,
        paidPayments: c.payments.filter((p) => p.status === 'PAID').length,
        overduePayments: c.payments.filter((p) => p.status === 'OVERDUE').length,
      })),
    };
  }

  // === DTI Risk Score (salary-based) ===
  async calculateDtiRiskScore(creditCheckId: string, data: {
    salaryVerified?: number;
    monthlyPayment?: number;
    addressCurrentType?: string;
  }) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { id: creditCheckId },
      include: {
        customer: {
          select: {
            id: true,
            salary: true,
            addressCurrentType: true,
            salaryPayDay: true,
          },
        },
        contract: {
          select: { monthlyPayment: true },
        },
      },
    });
    if (!creditCheck || creditCheck.deletedAt) {
      throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');
    }

    // Determine salary and monthly payment
    const salary = data.salaryVerified
      || (creditCheck.salaryVerified ? Number(creditCheck.salaryVerified) : 0)
      || (creditCheck.customer.salary ? Number(creditCheck.customer.salary) : 0);
    const monthlyPayment = data.monthlyPayment
      || (creditCheck.contract ? Number(creditCheck.contract.monthlyPayment) : 0);
    const addressType = data.addressCurrentType
      || creditCheck.customer.addressCurrentType
      || null;

    if (salary <= 0) {
      throw new BadRequestException('ไม่มีข้อมูลรายได้ ไม่สามารถคำนวณความเสี่ยงได้');
    }

    // Debt-to-income ratio
    const debtToIncomeRatio = monthlyPayment > 0 ? Math.round((monthlyPayment / salary) * 10000) / 10000 : 0;

    // Base risk from DTI
    let riskPoints = 0;
    if (debtToIncomeRatio < 0.3) {
      riskPoints = 0; // LOW
    } else if (debtToIncomeRatio <= 0.5) {
      riskPoints = 1; // MEDIUM
    } else {
      riskPoints = 2; // HIGH
    }

    // Address factor
    if (addressType === 'บ้านตัวเอง' || addressType === 'OWN') {
      riskPoints -= 1;
    } else if (addressType === 'เช่าอาศัย' || addressType === 'RENT') {
      riskPoints += 1;
    }

    // Customer history factor
    const history = await this.getCustomerHistory(creditCheck.customer.id);
    if (history.isReturningCustomer) {
      if (history.completedContracts > 0) {
        riskPoints -= 1; // Good returning customer
      }
      if (history.onTimeRate > 0.8) {
        riskPoints -= 1; // Excellent payment history
      }
      if (history.latePayments > history.onTimePayments) {
        riskPoints += 1; // More late than on-time
      }
    }

    // Map points to risk level
    let riskScore: 'LOW' | 'MEDIUM' | 'HIGH';
    let recommendation: string;
    if (riskPoints <= 0) {
      riskScore = 'LOW';
      recommendation = 'แนะนำอนุมัติ — ความเสี่ยงต่ำ สัดส่วนหนี้ต่อรายได้ดี';
    } else if (riskPoints <= 2) {
      riskScore = 'MEDIUM';
      recommendation = 'ควรพิจารณาเพิ่มเติม — ความเสี่ยงปานกลาง';
    } else {
      riskScore = 'HIGH';
      recommendation = 'ไม่แนะนำอนุมัติ — ความเสี่ยงสูง สัดส่วนหนี้ต่อรายได้สูงเกินไป';
    }

    // Suggest due day based on salary pay day
    const suggestedDueDay = creditCheck.customer.salaryPayDay
      ? Math.min(28, creditCheck.customer.salaryPayDay + 5) // 5 days after payday
      : null;

    // Persist risk assessment to credit check
    await this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        riskScore,
        debtToIncomeRatio,
        riskNote: `DTI: ${(debtToIncomeRatio * 100).toFixed(1)}% | ${recommendation}`,
      },
    });

    return {
      riskScore,
      debtToIncomeRatio,
      recommendation,
      suggestedDueDay,
      details: {
        salaryVerified: salary,
        monthlyPayment,
        addressCurrentType: addressType,
        customerHistory: {
          isReturningCustomer: history.isReturningCustomer,
          completedContracts: history.completedContracts,
          onTimeRate: history.onTimeRate,
        },
        riskPoints,
      },
    };
  }

  // === Automated Risk Score (rule-based, no AI needed) ===
  async calculateRiskScore(creditCheckId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { id: creditCheckId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            birthDate: true,
            salary: true,
            occupation: true,
            workplace: true,
            references: true,
          },
        },
        contract: {
          select: { id: true, monthlyPayment: true },
        },
      },
    });
    if (!creditCheck || creditCheck.deletedAt) {
      throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');
    }

    const customer = creditCheck.customer;
    const monthlyPayment = creditCheck.contract ? Number(creditCheck.contract.monthlyPayment) : 0;
    const monthlySalary = customer.salary ? Number(customer.salary) : 0;

    const factors: { name: string; weight: number; score: number; detail: string }[] = [];

    // 1. Income ratio (30%)
    let incomeScore = 0;
    if (monthlySalary > 0 && monthlyPayment > 0) {
      const ratio = monthlySalary / monthlyPayment; // higher = better
      if (ratio >= 5) incomeScore = 100;
      else if (ratio >= 4) incomeScore = 90;
      else if (ratio >= 3) incomeScore = 75;
      else if (ratio >= 2.5) incomeScore = 60;
      else if (ratio >= 2) incomeScore = 45;
      else if (ratio >= 1.5) incomeScore = 30;
      else incomeScore = 10;
      factors.push({
        name: 'สัดส่วนรายได้ต่อค่างวด',
        weight: 30,
        score: incomeScore,
        detail: `รายได้ ${monthlySalary.toLocaleString()} บาท / ค่างวด ${monthlyPayment.toLocaleString()} บาท (${ratio.toFixed(1)}x)`,
      });
    } else {
      incomeScore = 20;
      factors.push({
        name: 'สัดส่วนรายได้ต่อค่างวด',
        weight: 30,
        score: incomeScore,
        detail: monthlySalary <= 0 ? 'ไม่มีข้อมูลรายได้' : 'ไม่มีข้อมูลค่างวด',
      });
    }

    // 2. Age factor (15%)
    let ageScore = 50; // default if no birthDate
    if (customer.birthDate) {
      const now = new Date();
      const age = Math.floor((now.getTime() - new Date(customer.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age >= 25 && age <= 55) {
        ageScore = 100;
      } else if (age >= 20 && age < 25) {
        ageScore = 70;
      } else if (age > 55 && age <= 65) {
        ageScore = 65;
      } else if (age >= 18 && age < 20) {
        ageScore = 40;
      } else {
        ageScore = 25;
      }
      factors.push({
        name: 'อายุ',
        weight: 15,
        score: ageScore,
        detail: `อายุ ${age} ปี`,
      });
    } else {
      factors.push({
        name: 'อายุ',
        weight: 15,
        score: ageScore,
        detail: 'ไม่มีข้อมูลวันเกิด',
      });
    }

    // 3. Employment (15%)
    let employmentScore = 0;
    const hasOccupation = !!customer.occupation;
    const hasWorkplace = !!customer.workplace;
    if (hasOccupation && hasWorkplace) {
      employmentScore = 100;
    } else if (hasOccupation) {
      employmentScore = 60;
    } else {
      employmentScore = 15;
    }
    factors.push({
      name: 'ข้อมูลอาชีพและที่ทำงาน',
      weight: 15,
      score: employmentScore,
      detail: hasOccupation
        ? `${customer.occupation}${hasWorkplace ? ` (${customer.workplace})` : ' (ไม่ระบุที่ทำงาน)'}`
        : 'ไม่มีข้อมูลอาชีพ',
    });

    // 4. References (10%)
    let referencesScore = 0;
    let refCount = 0;
    if (customer.references) {
      try {
        const refs = Array.isArray(customer.references) ? customer.references : [];
        refCount = refs.length;
      } catch {
        refCount = 0;
      }
    }
    if (refCount >= 3) referencesScore = 100;
    else if (refCount === 2) referencesScore = 75;
    else if (refCount === 1) referencesScore = 40;
    else referencesScore = 0;
    factors.push({
      name: 'ผู้ค้ำประกัน/บุคคลอ้างอิง',
      weight: 10,
      score: referencesScore,
      detail: refCount > 0 ? `${refCount} คน` : 'ไม่มีบุคคลอ้างอิง',
    });

    // 5. Customer history (30%)
    const contracts = await this.prisma.contract.findMany({
      where: { customerId: customer.id, deletedAt: null },
      select: { status: true },
    });
    let historyScore = 50; // default for first-time customers
    if (contracts.length > 0) {
      const completed = contracts.filter((c) => c.status === 'COMPLETED' || c.status === 'EARLY_PAYOFF').length;
      const defaulted = contracts.filter((c) => c.status === 'DEFAULT' || c.status === 'CLOSED_BAD_DEBT').length;
      const total = contracts.length;
      if (defaulted > 0) {
        historyScore = Math.max(0, 30 - defaulted * 20);
      } else if (completed > 0) {
        historyScore = Math.min(100, 60 + completed * 15);
      } else {
        historyScore = 50; // only active/draft contracts
      }
      factors.push({
        name: 'ประวัติสัญญา',
        weight: 30,
        score: historyScore,
        detail: `ทั้งหมด ${total} สัญญา, สำเร็จ ${completed}, ผิดนัด ${defaulted}`,
      });
    } else {
      factors.push({
        name: 'ประวัติสัญญา',
        weight: 30,
        score: historyScore,
        detail: 'ลูกค้าใหม่ — ไม่มีประวัติ',
      });
    }

    // Calculate weighted score
    const totalScore = Math.round(
      factors.reduce((sum, f) => sum + (f.score * f.weight) / 100, 0),
    );
    const score = Math.max(0, Math.min(100, totalScore));

    // Map score to risk level and recommendation
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    let recommendation: string;
    if (score >= 80) {
      riskLevel = 'LOW';
      recommendation = 'แนะนำอนุมัติ — ความเสี่ยงต่ำ';
    } else if (score >= 60) {
      riskLevel = 'MEDIUM';
      recommendation = 'ควรพิจารณาเพิ่มเติม — ความเสี่ยงปานกลาง';
    } else {
      riskLevel = 'HIGH';
      recommendation = 'ไม่แนะนำอนุมัติ — ความเสี่ยงสูง';
    }

    return { score, riskLevel, recommendation, factors };
  }

  async getAutoScore(creditCheckId: string) {
    const result = await this.calculateRiskScore(creditCheckId);

    // Store the auto-calculated score
    await this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        aiScore: result.score,
        aiSummary: `คะแนนอัตโนมัติ: ${result.score}/100 (${result.riskLevel})`,
        aiRecommendation: result.recommendation,
        aiAnalysis: { autoScore: true, factors: result.factors },
      },
    });

    return result;
  }
}
