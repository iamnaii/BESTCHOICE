import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { TestModeService } from '../../test-mode/test-mode.service';
import {
  validateIMEI,
  validateThaiPhone,
  checkAgeEligibility,
  validateAddress,
  checkRequiredContractFields,
  checkRequiredDocuments,
  checkRequiredSignatures,
} from '../../../utils/validation.util';

/** User context for branch-level access control */
export interface BranchAccessUser {
  id: string;
  role: string;
  branchId: string | null;
}

/**
 * ContractQueryService — read-side of contracts: list, single-fetch,
 * pre-submit validation, dashboard milestones. Owns the shared `findOne`
 * and the `isTestModeEnabled()` test-mode bypass used by the lifecycle /
 * cancellation services.
 */
@Injectable()
export class ContractQueryService {
  constructor(
    private prisma: PrismaService,
    private testMode?: TestModeService,
  ) {}

  /**
   * Whether the OWNER test-mode bypass is currently enabled. Fail-safe to
   * false: if TestModeService isn't wired in (e.g. a narrow unit test) or the
   * toggle read throws, the real credit-check gates stay active.
   */
  async isTestModeEnabled(): Promise<boolean> {
    if (!this.testMode) return false;
    return this.testMode.isEnabled();
  }

  async findAll(filters: {
    status?: string;
    workflowStatus?: string;
    branchId?: string;
    customerId?: string;
    search?: string;
    page?: number;
    limit?: number;
    salespersonId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.workflowStatus) where.workflowStatus = filters.workflowStatus;
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.salespersonId) where.salespersonId = filters.salespersonId;
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) (where.createdAt as Record<string, Date>).gte = new Date(filters.startDate);
      if (filters.endDate) (where.createdAt as Record<string, Date>).lte = new Date(new Date(filters.endDate).getTime() + 86400000 - 1);
    }
    if (filters.search) {
      where.OR = [
        { contractNumber: { contains: filters.search, mode: 'insensitive' } },
        { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);

    const [data, total, totalActive, totalOverdue, portfolioValue] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, brand: true, model: true, category: true } },
          branch: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
          signatures: { select: { signerType: true } },
          _count: { select: { payments: true, contractDocuments: true } },
        },
      }),
      this.prisma.contract.count({ where }),
      this.prisma.contract.count({
        where: { ...where, status: 'ACTIVE', deletedAt: null },
      }),
      this.prisma.contract.count({
        where: { ...where, status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null },
      }),
      this.prisma.contract.aggregate({
        where: { ...where, deletedAt: null },
        _sum: { sellingPrice: true },
      }),
    ]);

    return {
      ...paginatedResponse(data, total, page, limit),
      summary: {
        totalContracts: total,
        activeContracts: totalActive,
        overdueContracts: totalOverdue,
        portfolioValue: new Prisma.Decimal(portfolioValue._sum.sellingPrice ?? 0).toNumber(),
      },
    };
  }

  /**
   * Find a single contract by ID.
   * @param user — optional: when provided, enforces branch-level access.
   *   OWNER/ACCOUNTANT can access any branch; others are restricted to their own.
   */
  async findOne(id: string, user?: BranchAccessUser) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        customer: true,
        product: { include: { prices: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        interestConfig: true,
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        signatures: true,
        eDocuments: true,
        contractDocuments: {
          orderBy: { createdAt: 'desc' },
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
        creditCheck: {
          include: {
            checkedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    // Enforce branch-level access when user context is provided
    if (user && !hasCrossBranchAccess(user)) {
      if (user.branchId && contract.branchId !== user.branchId) {
        throw new ForbiddenException('ไม่สามารถเข้าถึงสัญญาข้ามสาขาได้');
      }
    }

    return contract;
  }

  /**
   * Validate contract completeness before submit (legal compliance check)
   * ตรวจสอบความครบถ้วนของสัญญาตามกฎหมาย
   */
  async validateForSubmit(id: string) {
    const contract = await this.findOne(id);
    const customer = contract.customer;
    const product = contract.product;

    const errors: string[] = [];

    // 1. Check required contract fields (ป.พ.พ. ม.572)
    const missingFields = checkRequiredContractFields({
      customerName: customer?.name,
      customerNationalId: customer?.nationalId,
      customerPhone: customer?.phone,
      customerAddressIdCard: customer?.addressIdCard,
      customerAddressCurrent: customer?.addressCurrent,
      references: (customer?.references ?? []) as Prisma.JsonArray,
      productName: product?.name,
      productImei: product?.imeiSerial,
      sellingPrice: Number(contract.sellingPrice),
      downPayment: Number(contract.downPayment),
      totalMonths: contract.totalMonths,
      monthlyPayment: Number(contract.monthlyPayment),
    });
    if (missingFields.length > 0) {
      errors.push(`ข้อมูลไม่ครบ: ${missingFields.join(', ')}`);
    }

    // 2. Validate IMEI format
    if (product?.imeiSerial && !validateIMEI(product.imeiSerial)) {
      errors.push('IMEI ไม่ถูกต้อง (ต้อง 15 หลัก ตรง Luhn algorithm)');
    }

    // 3. Validate customer phone
    if (customer?.phone && !validateThaiPhone(customer.phone)) {
      errors.push('เบอร์โทรศัพท์ไม่ถูกต้อง (ต้อง 10 หลัก ขึ้นต้นด้วย 0)');
    }

    // 4. Validate customer address
    if (!validateAddress(customer?.addressIdCard)) {
      errors.push('ที่อยู่ตามบัตรประชาชนไม่ครบถ้วน');
    }
    if (!validateAddress(customer?.addressCurrent)) {
      errors.push('ที่อยู่ปัจจุบันไม่ครบถ้วน');
    }

    // 5. Check age eligibility
    let requiresGuardian = false;
    if (customer?.birthDate) {
      const ageCheck = checkAgeEligibility(new Date(customer.birthDate));
      if (!ageCheck.eligible) {
        errors.push(ageCheck.message!);
      }
      requiresGuardian = ageCheck.requiresGuardian;
      if (requiresGuardian && !customer.guardianName) {
        errors.push('ลูกค้าอายุต่ำกว่า 20 ปี ต้องกรอกข้อมูลผู้ปกครอง');
      }
    }

    // 6. Check references (ผู้ค้ำประกัน/ผู้ติดต่อฉุกเฉิน)
    const refs = (customer?.references as Prisma.JsonArray) || [];
    if (refs.length === 0) {
      errors.push('ต้องมีบุคคลค้ำประกัน/ผู้ติดต่อฉุกเฉิน อย่างน้อย 1 คน');
    }

    // 7. Check credit check status (test-mode bypass honored)
    if (
      (!contract.creditCheck || contract.creditCheck.status !== 'APPROVED') &&
      !(await this.isTestModeEnabled())
    ) {
      errors.push('ต้องผ่านการตรวจเครดิตก่อน');
    }

    // 8. Check PDPA consent
    if (!contract.pdpaConsentId) {
      errors.push('ต้องได้รับความยินยอม PDPA ก่อน');
    }

    // 9. Check signatures
    const sigCheck = checkRequiredSignatures(
      contract.signatures || [],
      requiresGuardian,
    );

    // 10. Check documents
    const docCheck = checkRequiredDocuments(
      contract.contractDocuments || [],
      requiresGuardian,
    );

    return {
      valid: errors.length === 0,
      errors,
      signatureStatus: sigCheck,
      documentStatus: docCheck,
      requiresGuardian,
    };
  }

  /**
   * P4-SP5: Dashboard milestones summary.
   * Returns new contracts this month, contracts completing this month,
   * and top 5 recent new contracts + top 20 final installments.
   */
  async getMilestonesSummary() {
    const now = new Date();
    // Current month bounds (UTC — server stores UTC but created_at/due_date are aligned to BKK days)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // --- newThisMonth: contracts created this month (ACTIVE or later = signed & activated) ---
    const newContracts = await this.prisma.contract.findMany({
      where: {
        createdAt: { gte: monthStart, lte: monthEnd },
        status: { notIn: ['DRAFT', 'CANCELED'] },
        deletedAt: null,
      },
      select: {
        id: true,
        contractNumber: true,
        financedAmount: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const newThisMonthCount = newContracts.length;
    const newThisMonthSum = newContracts.reduce(
      (acc, c) => acc + Number(c.financedAmount),
      0,
    );
    const recentNewContracts = newContracts.slice(0, 5).map((c) => ({
      id: c.id,
      contractNumber: c.contractNumber,
      customerName: c.customer.name,
      financedAmount: Number(c.financedAmount),
      createdAt: c.createdAt,
    }));

    // --- completingThisMonth: ACTIVE contracts where last installment dueDate is this month ---
    // Find max dueDate per contract among PENDING/OVERDUE payments, check if in this month
    const lastInstallmentsRaw = await this.prisma.payment.findMany({
      where: {
        dueDate: { gte: monthStart, lte: monthEnd },
        status: { in: ['PENDING', 'OVERDUE'] },
        deletedAt: null,
        contract: {
          status: 'ACTIVE',
          deletedAt: null,
        },
      },
      select: {
        id: true,
        contractId: true,
        dueDate: true,
        amountDue: true,
        amountPaid: true,
        installmentNo: true,
        contract: {
          select: {
            id: true,
            contractNumber: true,
            totalMonths: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Keep only the max installmentNo per contract to identify "last" installment
    const contractMaxInstallment = new Map<string, number>();
    for (const p of lastInstallmentsRaw) {
      const existing = contractMaxInstallment.get(p.contractId) ?? 0;
      if (p.installmentNo > existing) {
        contractMaxInstallment.set(p.contractId, p.installmentNo);
      }
    }

    // Also get actual max installmentNo for each contract (to find truly last installment)
    const contractIds = [...new Set(lastInstallmentsRaw.map((p) => p.contractId))];
    const maxInstallments = await this.prisma.payment.groupBy({
      by: ['contractId'],
      where: { contractId: { in: contractIds }, deletedAt: null },
      _max: { installmentNo: true },
    });
    const contractTotalInstallments = new Map(
      maxInstallments.map((m) => [m.contractId, m._max.installmentNo ?? 0]),
    );

    // Filter to payments that are the final installment for their contract
    const finalInstallmentsThisMonth = lastInstallmentsRaw
      .filter((p) => p.installmentNo === contractTotalInstallments.get(p.contractId))
      .slice(0, 20)
      .map((p) => ({
        paymentId: p.id,
        contractId: p.contractId,
        contractNumber: p.contract.contractNumber,
        customerName: p.contract.customer.name,
        dueDate: p.dueDate,
        amountDue: Number(p.amountDue),
        installmentNo: p.installmentNo,
        totalMonths: p.contract.totalMonths,
      }));

    const completingThisMonthCount = new Set(finalInstallmentsThisMonth.map((p) => p.contractId)).size;
    const completingThisMonthSum = finalInstallmentsThisMonth.reduce(
      (acc, p) => acc + p.amountDue,
      0,
    );

    return {
      newThisMonth: {
        count: newThisMonthCount,
        totalAmount: newThisMonthSum,
      },
      completingThisMonth: {
        count: completingThisMonthCount,
        totalAmount: completingThisMonthSum,
      },
      recentNewContracts,
      finalInstallmentsThisMonth: finalInstallmentsThisMonth.slice(0, 5),
    };
  }
}
