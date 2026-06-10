import { NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCreditCheckDto } from '../dto/credit-check.dto';
import { CreditCheckRiskService } from './credit-check-risk.service';

/**
 * CRUD sub-service for credit-check. Plain class (NOT @Injectable) —
 * instantiated internally by the CreditCheckService facade. Depends on
 * CreditCheckRiskService for the background auto-score on create.
 *
 * Owns: findAll, findByContract, findByCustomer, findLatestByCustomer,
 * createForCustomer, create, updateWithAiFields.
 */
export class CreditCheckCrudService {
  private readonly logger = new Logger(CreditCheckCrudService.name);

  constructor(
    private prisma: PrismaService,
    private risk: CreditCheckRiskService,
  ) {}

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
    const include = {
      customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
      checkedBy: { select: { id: true, name: true } },
    };

    // Prefer the latest FULL check (real credit assessment: statement + AI
    // analysis + explicit manager decision) over PRE checks (preliminary
    // tier-based intake decisions). PRE checks are noise for contract gating —
    // a customer intake PRE=MANUAL_REVIEW shouldn't override an earlier
    // FULL=APPROVED that a manager signed off on.
    const latestFull = await this.prisma.creditCheck.findFirst({
      where: { customerId, deletedAt: null, checkType: 'FULL' },
      orderBy: { createdAt: 'desc' },
      include,
    });
    if (latestFull) return latestFull;

    // No FULL check yet — fall back to latest PRE (covers GOLD-tier
    // auto-approve via pre-check flow).
    return this.prisma.creditCheck.findFirst({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include,
    });
  }

  async createForCustomer(customerId: string, dto: CreateCreditCheckDto, _userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');

    // Idempotency: if an identical submission just landed (double-click, retry
    // after slow network, two tabs), return the existing record instead of
    // creating a duplicate. Window is short (30s) so legitimate re-checks on
    // the same day are still allowed.
    const recentCutoff = new Date(Date.now() - 30_000);
    const recentDuplicate = await this.prisma.creditCheck.findFirst({
      where: {
        customerId,
        deletedAt: null,
        createdAt: { gte: recentCutoff },
        bankName: dto.bankName ?? null,
        statementMonths: dto.statementMonths ?? 3,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
    if (recentDuplicate) return recentDuplicate;

    const creditCheck = await this.prisma.creditCheck.create({
      data: {
        customerId,
        bankName: dto.bankName,
        statementFiles: dto.statementFiles,
        statementMonths: dto.statementMonths ?? 3,
        reviewNotes: dto.reviewNotes,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });

    // Auto-calculate risk score in background (don't block creation)
    this.risk.calculateRiskScore(creditCheck.id)
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
    this.risk.calculateRiskScore(creditCheck.id)
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
}
