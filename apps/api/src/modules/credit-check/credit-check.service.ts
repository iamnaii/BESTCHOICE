import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma, CreditCheckStatus } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCreditCheckDto, OverrideCreditCheckDto } from './dto/credit-check.dto';
import { IntegrationConfigService } from '../integrations/integration-config.service';

@Injectable()
export class CreditCheckService {
  private readonly logger = new Logger(CreditCheckService.name);
  private anthropic: Anthropic | null = null;

  constructor(
    private prisma: PrismaService,
    private integrationConfig: IntegrationConfigService,
  ) {}

  private async getAnthropicClient(): Promise<Anthropic | null> {
    const apiKey = ((await this.integrationConfig.getValue('claude-ai', 'apiKey')) || '').trim();
    if (!apiKey) return null;
    if (!this.anthropic) {
      this.anthropic = new Anthropic({ apiKey });
    }
    return this.anthropic;
  }

  async findAll(filters: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    checkedById?: string;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.customer = { name: { contains: filters.search, mode: 'insensitive' } };
    }
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) (where.createdAt as Record<string, Date>).gte = new Date(filters.startDate);
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        (where.createdAt as Record<string, Date>).lte = endDate;
      }
    }
    if (filters.branchId) {
      where.customer = {
        ...((where.customer as Record<string, unknown>) || {}),
        contracts: { some: { branchId: filters.branchId } },
      };
    }
    if (filters.checkedById) where.checkedById = filters.checkedById;

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);

    const [data, total, summaryData] = await Promise.all([
      this.prisma.creditCheck.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
          contract: { select: { id: true, contractNumber: true } },
          checkedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.creditCheck.count({ where }),
      this.prisma.creditCheck.findMany({
        where,
        select: { status: true, aiScore: true },
      }),
    ]);

    // Calculate summary stats
    const pendingAndReview = summaryData.filter((c) => c.status === 'PENDING' || c.status === 'MANUAL_REVIEW').length;
    const approved = summaryData.filter((c) => c.status === 'APPROVED').length;
    const rejected = summaryData.filter((c) => c.status === 'REJECTED').length;
    const scoredItems = summaryData.filter((c) => c.aiScore !== null);
    const avgScore = scoredItems.length > 0 ? Math.round(scoredItems.reduce((sum, c) => sum + (c.aiScore || 0), 0) / scoredItems.length) : 0;

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalCount: total,
        pendingCount: pendingAndReview,
        approvedCount: approved,
        rejectedCount: rejected,
        avgScore,
      },
    };
  }

  async findByContract(contractId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { contractId },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
    if (creditCheck?.deletedAt) return null;
    return creditCheck;
  }

  // === Customer-level credit check (ไม่ต้องมีสัญญา) ===
  async findByCustomer(customerId: string) {
    return this.prisma.creditCheck.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        contract: { select: { id: true, contractNumber: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async findLatestByCustomer(customerId: string) {
    return this.prisma.creditCheck.findFirst({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async createForCustomer(customerId: string, dto: CreateCreditCheckDto, _userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');

    const creditCheck = await this.prisma.creditCheck.create({
      data: {
        customerId,
        bankName: dto.bankName,
        statementFiles: dto.statementFiles,
        statementMonths: dto.statementMonths ?? 3,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });

    // Auto-calculate risk score in background (don't block creation)
    this.calculateRiskScore(creditCheck.id)
      .then(async (result) => {
        await this.prisma.creditCheck.update({
          where: { id: creditCheck.id },
          data: {
            aiScore: result.score,
            aiSummary: `คะแนนอัตโนมัติ: ${result.score}/100 (${result.riskLevel})`,
            aiRecommendation: result.recommendation,
            aiAnalysis: { autoScore: true, factors: result.factors },
          },
        });
      })
      .catch((err) => this.logger.warn(`Auto-score failed for ${creditCheck.id}: ${err.message}`));

    return creditCheck;
  }

  async analyzeForCustomer(creditCheckId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { id: creditCheckId },
      include: {
        contract: { select: { monthlyPayment: true, totalMonths: true, financedAmount: true } },
        customer: { select: { name: true, salary: true, occupation: true, occupationDetail: true } },
      },
    });
    if (!creditCheck || creditCheck.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    if (creditCheck.statementFiles.length === 0) {
      throw new BadRequestException('กรุณาอัปโหลด Statement ธนาคารก่อน');
    }

    const customerSalary = creditCheck.customer.salary ? Number(creditCheck.customer.salary) : 0;
    // If linked to a contract, use contract's monthly payment; otherwise estimate
    const monthlyPayment = creditCheck.contract ? Number(creditCheck.contract.monthlyPayment) : 0;

    const aiAnalysis = await this.performAIAnalysis({
      bankName: creditCheck.bankName,
      statementMonths: creditCheck.statementMonths,
      statementFileCount: creditCheck.statementFiles.length,
      statementFiles: creditCheck.statementFiles,
      monthlyPayment,
      customerSalary,
      customerOccupation: creditCheck.customer.occupation,
    });

    return this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        aiAnalysis: aiAnalysis.analysis,
        aiScore: aiAnalysis.score,
        aiSummary: aiAnalysis.summary,
        aiRecommendation: aiAnalysis.recommendation,
        status: aiAnalysis.score >= 60 ? 'APPROVED' : aiAnalysis.score >= 40 ? 'MANUAL_REVIEW' : 'REJECTED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async overrideById(creditCheckId: string, dto: OverrideCreditCheckDto, userId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({ where: { id: creditCheckId } });
    if (!creditCheck || creditCheck.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    const validStatuses = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
    if (!validStatuses.includes(dto.status)) {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }

    return this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        status: dto.status as CreditCheckStatus,
        reviewNotes: dto.reviewNotes,
        checkedById: userId,
        checkedAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async create(contractId: string, dto: CreateCreditCheckDto, _userId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { customer: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    // Check if credit check already exists
    const existing = await this.prisma.creditCheck.findUnique({ where: { contractId } });
    if (existing) {
      // Update existing
      return this.prisma.creditCheck.update({
        where: { contractId },
        data: {
          bankName: dto.bankName,
          statementFiles: dto.statementFiles,
          statementMonths: dto.statementMonths ?? 3,
          status: 'PENDING',
          aiAnalysis: Prisma.JsonNull,
          aiScore: null,
          aiSummary: null,
          aiRecommendation: null,
        },
        include: {
          customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
          checkedBy: { select: { id: true, name: true } },
        },
      });
    }

    const creditCheck = await this.prisma.creditCheck.create({
      data: {
        contractId,
        customerId: contract.customerId,
        bankName: dto.bankName,
        statementFiles: dto.statementFiles,
        statementMonths: dto.statementMonths ?? 3,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });

    // Auto-calculate risk score in background (don't block creation)
    this.calculateRiskScore(creditCheck.id)
      .then(async (result) => {
        await this.prisma.creditCheck.update({
          where: { id: creditCheck.id },
          data: {
            aiScore: result.score,
            aiSummary: `คะแนนอัตโนมัติ: ${result.score}/100 (${result.riskLevel})`,
            aiRecommendation: result.recommendation,
            aiAnalysis: { autoScore: true, factors: result.factors },
          },
        });
      })
      .catch((err) => this.logger.warn(`Auto-score failed for ${creditCheck.id}: ${err.message}`));

    return creditCheck;
  }

  async analyze(contractId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { contractId },
      include: {
        contract: {
          select: { monthlyPayment: true, totalMonths: true, financedAmount: true },
        },
        customer: {
          select: { name: true, salary: true, occupation: true, occupationDetail: true },
        },
      },
    });
    if (!creditCheck || creditCheck.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    if (creditCheck.statementFiles.length === 0) {
      throw new BadRequestException('กรุณาอัปโหลด Statement ธนาคารก่อน');
    }

    const monthlyPayment = creditCheck.contract ? Number(creditCheck.contract.monthlyPayment) : 0;
    const customerSalary = creditCheck.customer.salary ? Number(creditCheck.customer.salary) : 0;

    const aiAnalysis = await this.performAIAnalysis({
      bankName: creditCheck.bankName,
      statementMonths: creditCheck.statementMonths,
      statementFileCount: creditCheck.statementFiles.length,
      statementFiles: creditCheck.statementFiles,
      monthlyPayment,
      customerSalary,
      customerOccupation: creditCheck.customer.occupation,
    });

    const updatedCheck = await this.prisma.creditCheck.update({
      where: { contractId },
      data: {
        aiAnalysis: aiAnalysis.analysis,
        aiScore: aiAnalysis.score,
        aiSummary: aiAnalysis.summary,
        aiRecommendation: aiAnalysis.recommendation,
        status: aiAnalysis.score >= 60 ? 'APPROVED' : aiAnalysis.score >= 40 ? 'MANUAL_REVIEW' : 'REJECTED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });

    return updatedCheck;
  }

  async override(contractId: string, dto: OverrideCreditCheckDto, userId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({ where: { contractId } });
    if (!creditCheck || creditCheck.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    const validStatuses = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
    if (!validStatuses.includes(dto.status)) {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }

    return this.prisma.creditCheck.update({
      where: { contractId },
      data: {
        status: dto.status as CreditCheckStatus,
        reviewNotes: dto.reviewNotes,
        checkedById: userId,
        checkedAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

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
        const remaining = contract.totalMonths - paidCount;
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

  // === Update Credit Check with AI fields ===
  async updateWithAiFields(creditCheckId: string, data: {
    salaryVerified?: number;
    employerName?: string;
    salaryPayDay?: number;
    salarySlipFiles?: string[];
    statementBankName?: string;
    statementAvgIncome?: number;
    statementAvgExpense?: number;
    statementAvgBalance?: number;
  }) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { id: creditCheckId },
      select: { id: true, deletedAt: true, customerId: true },
    });
    if (!creditCheck || creditCheck.deletedAt) {
      throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');
    }

    const updateData: Record<string, unknown> = {};
    if (data.salaryVerified != null) updateData.salaryVerified = data.salaryVerified;
    if (data.employerName != null) updateData.employerName = data.employerName;
    if (data.salaryPayDay != null) updateData.salaryPayDay = data.salaryPayDay;
    if (data.salarySlipFiles != null) updateData.salarySlipFiles = data.salarySlipFiles;
    if (data.statementBankName != null) updateData.statementBankName = data.statementBankName;
    if (data.statementAvgIncome != null) updateData.statementAvgIncome = data.statementAvgIncome;
    if (data.statementAvgExpense != null) updateData.statementAvgExpense = data.statementAvgExpense;
    if (data.statementAvgBalance != null) updateData.statementAvgBalance = data.statementAvgBalance;

    const updated = await this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: updateData,
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });

    // Also update customer.salaryPayDay if provided
    if (data.salaryPayDay != null) {
      await this.prisma.customer.update({
        where: { id: creditCheck.customerId },
        data: { salaryPayDay: data.salaryPayDay },
      });
    }

    return updated;
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

  private async performAIAnalysis(params: {
    bankName: string | null;
    statementMonths: number;
    statementFileCount: number;
    statementFiles: string[];
    monthlyPayment: number;
    customerSalary: number;
    customerOccupation: string | null;
  }) {
    // Try Claude Vision API first, fallback to rule-based if unavailable
    const client = await this.getAnthropicClient();
    if (client && params.statementFiles.length > 0) {
      try {
        return await this.performClaudeAnalysis(params);
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Claude API analysis failed, falling back to rule-based: ${errMsg}`);
      }
    }

    return this.performRuleBasedAnalysis(params);
  }

  private async performClaudeAnalysis(params: {
    bankName: string | null;
    statementMonths: number;
    statementFiles: string[];
    monthlyPayment: number;
    customerSalary: number;
    customerOccupation: string | null;
  }) {
    const client = await this.getAnthropicClient();
    if (!client) {
      throw new InternalServerErrorException('Anthropic client not initialized');
    }

    const contentBlocks: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

    // Add statement images as content blocks (only accept base64 data URLs to prevent SSRF)
    for (const fileUrl of params.statementFiles.slice(0, 5)) {
      if (!fileUrl.startsWith('data:')) {
        this.logger.warn('Skipping non-data-URL statement file to prevent SSRF');
        continue;
      }
      const match = fileUrl.match(/^data:(image\/(jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (match) {
        const mediaType = match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: match[3] },
        });
      }
    }

    contentBlocks.push({
      type: 'text',
      text: `วิเคราะห์ Statement ธนาคาร${params.bankName ? ` (${params.bankName})` : ''} ของลูกค้าที่ต้องการผ่อนชำระสินค้า

ข้อมูลลูกค้า:
- อาชีพ: ${params.customerOccupation || 'ไม่ระบุ'}
- เงินเดือนที่แจ้ง: ${params.customerSalary > 0 ? `${params.customerSalary.toLocaleString()} บาท/เดือน` : 'ไม่ได้แจ้ง'}
- ค่างวดที่ต้องจ่าย: ${params.monthlyPayment > 0 ? `${params.monthlyPayment.toLocaleString()} บาท/เดือน` : 'ไม่ระบุ'}
- Statement ย้อนหลัง: ${params.statementMonths} เดือน

กรุณาวิเคราะห์และตอบเป็น JSON เท่านั้น ตามรูปแบบนี้:
{
  "score": <คะแนน 0-100>,
  "summary": "<สรุปผลภาษาไทย 2-3 ประโยค>",
  "recommendation": "<คำแนะนำ: แนะนำอนุมัติ / พิจารณาเพิ่มเติม / ไม่แนะนำอนุมัติ พร้อมเหตุผล>",
  "analysis": {
    "monthlyIncome": <รายได้ต่อเดือนโดยประมาณจาก statement>,
    "averageBalance": <ยอดเงินคงเหลือเฉลี่ย>,
    "monthlyPayment": ${params.monthlyPayment},
    "affordabilityRatio": <สัดส่วนค่างวดต่อรายได้ 0.0-1.0>,
    "incomeConsistency": "<stable/unstable/unknown>",
    "debtObligations": <ประมาณภาระหนี้อื่นต่อเดือน>,
    "riskFactors": [<รายการความเสี่ยง>],
    "positiveFactors": [<รายการจุดแข็ง>]
  }
}

เกณฑ์การให้คะแนน:
- 70-100: รายได้สม่ำเสมอ, ค่างวดไม่เกิน 30% ของรายได้, ยอดคงเหลือดี
- 40-69: มีความเสี่ยงบางอย่าง ควรพิจารณาเพิ่มเติม
- 0-39: ความเสี่ยงสูง รายได้ไม่เพียงพอหรือไม่สม่ำเสมอ

ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown code block`,
    });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: contentBlocks }],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new InternalServerErrorException('No text response from Claude');
    }

    // Parse JSON from response (handle possible markdown wrapping)
    let jsonText = textContent.text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonText);

    const score = Math.max(0, Math.min(100, Number(result.score) || 50));

    return {
      score,
      summary: result.summary || 'วิเคราะห์โดย AI',
      recommendation: result.recommendation || 'กรุณาตรวจสอบเพิ่มเติม',
      analysis: result.analysis || {},
    };
  }

  private performRuleBasedAnalysis(params: {
    monthlyPayment: number;
    customerSalary: number;
    statementFileCount?: number;
    customerOccupation: string | null;
  }) {
    const { monthlyPayment, customerSalary } = params;

    let score = 50;
    const riskFactors: string[] = [];
    const positiveFactors: string[] = [];

    if (customerSalary > 0) {
      const affordabilityRatio = monthlyPayment / customerSalary;
      if (affordabilityRatio <= 0.2) {
        score += 30;
        positiveFactors.push('ค่างวดไม่เกิน 20% ของรายได้');
      } else if (affordabilityRatio <= 0.3) {
        score += 20;
        positiveFactors.push('ค่างวดไม่เกิน 30% ของรายได้');
      } else if (affordabilityRatio <= 0.4) {
        score += 10;
        riskFactors.push('ค่างวดเกิน 30% ของรายได้');
      } else {
        score -= 10;
        riskFactors.push('ค่างวดเกิน 40% ของรายได้ - ความเสี่ยงสูง');
      }
    } else {
      score -= 10;
      riskFactors.push('ไม่มีข้อมูลรายได้');
    }

    const fileCount = params.statementFileCount ?? 0;
    if (fileCount >= 3) {
      score += 10;
      positiveFactors.push('มี Statement ครบ 3 เดือน');
    } else if (fileCount >= 1) {
      score += 5;
      riskFactors.push('Statement ไม่ครบ 3 เดือน');
    }

    if (params.customerOccupation) {
      score += 5;
      positiveFactors.push(`อาชีพ: ${params.customerOccupation}`);
    }

    score = Math.max(0, Math.min(100, score));

    const analysis = {
      monthlyIncome: customerSalary,
      monthlyPayment,
      affordabilityRatio: customerSalary > 0 ? Math.round((monthlyPayment / customerSalary) * 100) / 100 : null,
      riskFactors,
      positiveFactors,
      incomeConsistency: customerSalary > 0 ? 'มีรายได้' : 'ไม่มีข้อมูล',
    };

    let recommendation: string;
    if (score >= 70) {
      recommendation = 'แนะนำอนุมัติ - ลูกค้ามีความสามารถในการชำระเพียงพอ';
    } else if (score >= 50) {
      recommendation = 'พิจารณาเพิ่มเติม - ควรตรวจสอบข้อมูลเพิ่มเติม';
    } else {
      recommendation = 'ไม่แนะนำอนุมัติ - ความเสี่ยงสูง';
    }

    const summaryParts: string[] = [];
    if (customerSalary > 0) {
      summaryParts.push(`รายได้ ${customerSalary.toLocaleString()} บาท/เดือน`);
      summaryParts.push(`ค่างวด ${monthlyPayment.toLocaleString()} บาท/เดือน`);
      summaryParts.push(`สัดส่วน ${((monthlyPayment / customerSalary) * 100).toFixed(0)}% ของรายได้`);
    }
    if (positiveFactors.length > 0) summaryParts.push(`จุดแข็ง: ${positiveFactors.join(', ')}`);
    if (riskFactors.length > 0) summaryParts.push(`ความเสี่ยง: ${riskFactors.join(', ')}`);

    return {
      score,
      summary: summaryParts.join(' | '),
      recommendation,
      analysis,
    };
  }
}
