import { Injectable, Logger, Optional, NotFoundException, BadRequestException, ForbiddenException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { StructuredLoggerService } from '../../common/logger';
import { PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { paginatedResponse } from '../../common/helpers/pagination.helper';

/** User context for branch-level access control */
export interface BranchAccessUser {
  id: string;
  role: string;
  branchId: string | null;
}
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';
import { calculateInstallment, generatePaymentSchedule } from '../../utils/installment.util';
import { loadInstallmentConfig, resolveInstallmentParams, resolveVatPctForBranch } from '../../utils/config.util';
import { generateContractNumber } from '../../utils/sequence.util';
import { d } from '../../utils/decimal.util';
import { WarrantyService } from '../warranty/warranty.service';
import {
  validateIMEI,
  validateThaiPhone,
  checkAgeEligibility,
  validateAddress,
  checkRequiredContractFields,
  checkRequiredDocuments,
  checkRequiredSignatures,
} from '../../utils/validation.util';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);
  private readonly structuredLogger = new StructuredLoggerService(ContractsService.name);
  constructor(
    private prisma: PrismaService,
    @Optional() private warrantyService?: WarrantyService,
  ) {}

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

    // 7. Check credit check status
    if (!contract.creditCheck || contract.creditCheck.status !== 'APPROVED') {
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

  async create(dto: CreateContractDto, salespersonId: string, salespersonRole?: string) {
    // Block if customer already has active contract(s), unless OWNER/BRANCH_MANAGER overrides
    const activeContracts = await this.prisma.contract.findMany({
      where: {
        customerId: dto.customerId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
      },
      select: { id: true, contractNumber: true, status: true },
    });
    if (activeContracts.length > 0) {
      const canOverride = salespersonRole === 'OWNER' || salespersonRole === 'BRANCH_MANAGER';
      if (!(canOverride && dto.overrideActiveContractCheck)) {
        throw new ConflictException({
          message: 'ลูกค้ายังมีสัญญาที่กำลังผ่อนอยู่ ไม่สามารถเปิดสัญญาใหม่ได้',
          code: 'CUSTOMER_HAS_ACTIVE_CONTRACT',
          activeContracts,
          canOverride,
        });
      }
    }

    // Try to find interest config by product category
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.deletedAt || product.status !== 'IN_STOCK') {
      throw new BadRequestException('สินค้าไม่พร้อมขาย');
    }

    // Validate IMEI is present (legal requirement)
    if (!product.imeiSerial) {
      throw new BadRequestException('สินค้าต้องมี IMEI/Serial Number (บังคับตามกฎหมาย)');
    }

    // Find interest config matching the product category
    const interestConfig = await this.prisma.interestConfig.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        productCategories: { has: product.category },
      },
    });

    // Load configs with shared utility
    const systemConfig = await loadInstallmentConfig(this.prisma);
    const baseParams = resolveInstallmentParams(interestConfig, systemConfig, dto.interestRate);
    // Override vatPct based on the selling branch's VAT registration status
    // BESTCHOICE SHOP (vatRegistered=false) → 0%, BESTCHOICE FINANCE → 7%
    const effectiveVatPct = await resolveVatPctForBranch(this.prisma, dto.branchId, baseParams.vatPct);
    const params = { ...baseParams, vatPct: effectiveVatPct };

    // Validations
    if (dto.downPayment < 0) {
      throw new BadRequestException('เงินดาวน์ต้องมากกว่าหรือเท่ากับ 0');
    }
    if (dto.downPayment >= dto.sellingPrice) {
      throw new BadRequestException('เงินดาวน์ต้องน้อยกว่าราคาขาย');
    }
    if (dto.downPayment < dto.sellingPrice * params.minDownPaymentPct) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(params.minDownPaymentPct * 100).toFixed(0)}% (${(dto.sellingPrice * params.minDownPaymentPct).toLocaleString()} บาท)`);
    }
    if (dto.totalMonths < params.minInstallmentMonths || dto.totalMonths > params.maxInstallmentMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${params.minInstallmentMonths}-${params.maxInstallmentMonths} เดือน`);
    }

    // Validate paymentDueDay
    if (dto.paymentDueDay !== undefined && (dto.paymentDueDay < 1 || (dto.paymentDueDay > 28 && dto.paymentDueDay !== 31))) {
      throw new BadRequestException('วันที่ครบกำหนดชำระต้องอยู่ระหว่าง 1-28 หรือ 31 (สิ้นเดือน)');
    }

    // Calculate installment using shared utility
    const calc = calculateInstallment(dto.sellingPrice, dto.downPayment, params.interestRate, dto.totalMonths, params.storeCommissionPct, params.vatPct);
    const { interestTotal, financedAmount, monthlyPayment } = calc;

    // Create contract + payment schedule in transaction
    // Retry up to 3 times on unique constraint / serialization errors
    const MAX_RETRIES = 3;
    let contract;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        contract = await this.prisma.$transaction(async (tx) => {
          // Verify credit check inside transaction for atomicity
          const approvedCreditCheck = await tx.creditCheck.findFirst({
            where: { customerId: dto.customerId, status: 'APPROVED', contractId: null },
            orderBy: { createdAt: 'desc' },
          });
          if (!approvedCreditCheck) {
            throw new BadRequestException('ลูกค้าต้องผ่านการตรวจเครดิตก่อนทำสัญญา');
          }

          // Verify product is still available inside transaction
          const currentProduct = await tx.product.findUnique({ where: { id: dto.productId } });
          if (!currentProduct || currentProduct.status !== 'IN_STOCK') {
            throw new BadRequestException('สินค้าไม่พร้อมขาย (อาจถูกจองแล้ว)');
          }

          // Fetch customer data for snapshot (isolation from future edits)
          const customerData = await tx.customer.findUnique({ where: { id: dto.customerId, deletedAt: null } });
          const customerSnapshot: Prisma.InputJsonValue | undefined = customerData ? {
            name: customerData.name,
            prefix: customerData.prefix,
            nickname: customerData.nickname,
            nationalId: customerData.nationalId,
            phone: customerData.phone,
            phoneSecondary: customerData.phoneSecondary,
            email: customerData.email,
            lineId: customerData.lineId,
            occupation: customerData.occupation,
            salary: customerData.salary ? customerData.salary.toString() : null,
            workplace: customerData.workplace,
            addressIdCard: customerData.addressIdCard,
            addressCurrent: customerData.addressCurrent,
            addressWork: customerData.addressWork,
            references: customerData.references,
            birthDate: customerData.birthDate,
            facebookLink: customerData.facebookLink,
            facebookName: customerData.facebookName,
            googleMapLink: customerData.googleMapLink,
          } : undefined;

          // Generate contract number
          const contractNumber = await generateContractNumber(tx);

          const newContract = await tx.contract.create({
            data: {
              contractNumber,
              customerId: dto.customerId,
              productId: dto.productId,
              branchId: dto.branchId,
              salespersonId,
              planType: (dto.planType || 'STORE_DIRECT') as PlanType,
              sellingPrice: dto.sellingPrice,
              downPayment: dto.downPayment,
              interestRate: params.interestRate,
              totalMonths: dto.totalMonths,
              interestTotal,
              financedAmount,
              storeCommission: calc.storeCommission,
              vatAmount: calc.vatAmount,
              vatPct: params.vatPct,
              monthlyPayment,
              status: 'DRAFT',
              workflowStatus: 'CREATING',
              notes: dto.notes,
              paymentDueDay: dto.paymentDueDay,
              interestConfigId: interestConfig?.id,
              customerSnapshot,
            },
          });

          // Create payment schedule using shared utility
          const payments = generatePaymentSchedule(
            newContract.id, dto.totalMonths, financedAmount, monthlyPayment, dto.paymentDueDay,
            { principal: calc.principal, interestTotal: calc.interestTotal, storeCommission: calc.storeCommission, vatAmount: calc.vatAmount },
          );
          await tx.payment.createMany({ data: payments });

          // Reserve product
          await tx.product.update({
            where: { id: dto.productId },
            data: { status: 'RESERVED' },
          });

          // Link the approved credit check to this contract
          await tx.creditCheck.update({
            where: { id: approvedCreditCheck.id },
            data: { contractId: newContract.id },
          });

          return newContract;
        }, { timeout: 15000 });
        break; // success — exit retry loop
      } catch (err: unknown) {
        // Retry on unique constraint (P2002) or serialization failure (P2034)
        const prismaErr = err instanceof Prisma.PrismaClientKnownRequestError ? err : null;
        const isRetryable = prismaErr?.code === 'P2002' || prismaErr?.code === 'P2034';
        if (isRetryable && attempt < MAX_RETRIES - 1) {
          continue;
        }
        // Re-throw BadRequestException / ForbiddenException as-is
        if (err instanceof BadRequestException || err instanceof ForbiddenException) {
          throw err;
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : undefined;
        this.logger.error(`Failed to create contract (attempt ${attempt + 1}/${MAX_RETRIES}): [${prismaErr?.code}] ${errMsg}`, errStack);

        // Provide specific error messages for known Prisma errors
        if (prismaErr) {
          switch (prismaErr.code) {
            case 'P2002':
              throw new BadRequestException('เลขสัญญาซ้ำ กรุณาลองใหม่อีกครั้ง');
            case 'P2003': {
              const field = (prismaErr.meta?.field_name as string) || '';
              if (field.includes('branch')) throw new BadRequestException('ไม่พบสาขาที่เลือก');
              if (field.includes('customer')) throw new BadRequestException('ไม่พบข้อมูลลูกค้า');
              if (field.includes('product')) throw new BadRequestException('ไม่พบสินค้าที่เลือก');
              if (field.includes('salesperson') || field.includes('user')) throw new BadRequestException('ไม่พบข้อมูลพนักงานขาย');
              // Don't expose internal field names to the client
              this.logger.error(`FK violation on field: ${field}`);
              throw new BadRequestException('ข้อมูลอ้างอิงไม่ถูกต้อง');
            }
            case 'P2025':
              throw new BadRequestException('ไม่พบข้อมูลที่ต้องการอัปเดต (อาจถูกลบแล้ว)');
            case 'P2028':
              throw new BadRequestException('การทำรายการหมดเวลา กรุณาลองใหม่อีกครั้ง');
          }
        }

        this.logger.error(`Contract creation failed: ${errMsg}`, errStack);
        throw new InternalServerErrorException('ไม่สามารถสร้างสัญญาได้ กรุณาลองใหม่อีกครั้ง');
      }
    }

    const created = await this.findOne(contract!.id);

    // Auto-set shop warranty for used phones (fire-and-forget)
    if (this.warrantyService) {
      this.warrantyService.setShopWarranty(created.id).catch((err) =>
        this.logger.error('Failed to set shop warranty', err),
      );
    }

    this.structuredLogger.log('contract.created', {
      contractId: created.id,
      contractNumber: created.contractNumber,
      customerId: created.customerId,
      productId: created.productId,
      branchId: created.branchId,
      sellingPrice: Number(created.sellingPrice),
      downPayment: Number(created.downPayment),
      financedAmount: Number(created.financedAmount),
      totalMonths: created.totalMonths,
      monthlyPayment: Number(created.monthlyPayment),
      salespersonId,
    });
    return created;
  }

  // === UPDATE: แก้ไขรายละเอียดสัญญา (เฉพาะ CREATING/REJECTED) ===
  async update(id: string, dto: UpdateContractDto, userId: string) {
    const contract = await this.findOne(id);

    // Only allow editing when CREATING or REJECTED
    if (contract.workflowStatus !== 'CREATING' && contract.workflowStatus !== 'REJECTED') {
      throw new BadRequestException('แก้ไขได้เฉพาะสัญญาที่อยู่ในสถานะ กำลังสร้าง หรือ ถูกปฏิเสธ เท่านั้น');
    }

    // Only the creator can edit (OWNER can edit any contract)
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (contract.salespersonId !== userId && user?.role !== 'OWNER') {
      throw new ForbiddenException('เฉพาะพนักงานที่สร้างสัญญาเท่านั้นที่สามารถแก้ไขได้');
    }

    // Determine final values
    const sellingPrice = dto.sellingPrice ?? d(contract.sellingPrice).toNumber();
    const downPayment = dto.downPayment ?? d(contract.downPayment).toNumber();
    const totalMonths = dto.totalMonths ?? contract.totalMonths;
    const paymentDueDay = dto.paymentDueDay ?? contract.paymentDueDay;

    // Get interest config
    const interestConfig = contract.interestConfigId
      ? await this.prisma.interestConfig.findUnique({ where: { id: contract.interestConfigId } })
      : null;

    const systemConfig = await loadInstallmentConfig(this.prisma);
    const baseParams = resolveInstallmentParams(interestConfig, systemConfig, dto.interestRate ?? d(contract.interestRate).toNumber());
    // Override vatPct based on the contract's branch VAT registration status
    const effectiveVatPct = await resolveVatPctForBranch(this.prisma, contract.branchId, baseParams.vatPct);
    const params = { ...baseParams, vatPct: effectiveVatPct };
    const { minDownPaymentPct, minInstallmentMonths, maxInstallmentMonths } = params;

    // Validations
    if (downPayment < 0) {
      throw new BadRequestException('เงินดาวน์ต้องมากกว่าหรือเท่ากับ 0');
    }
    if (downPayment >= sellingPrice) {
      throw new BadRequestException('เงินดาวน์ต้องน้อยกว่าราคาขาย');
    }
    if (downPayment < sellingPrice * minDownPaymentPct) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(minDownPaymentPct * 100).toFixed(0)}% (${(sellingPrice * minDownPaymentPct).toLocaleString()} บาท)`);
    }
    if (totalMonths < minInstallmentMonths || totalMonths > maxInstallmentMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${minInstallmentMonths}-${maxInstallmentMonths} เดือน`);
    }
    if (paymentDueDay !== undefined && paymentDueDay !== null && (paymentDueDay < 1 || (paymentDueDay > 28 && paymentDueDay !== 31))) {
      throw new BadRequestException('วันที่ครบกำหนดชำระต้องอยู่ระหว่าง 1-28 หรือ 31 (สิ้นเดือน)');
    }

    // Recalculate financials using shared utility
    const interestRate = params.interestRate;
    const calc = calculateInstallment(sellingPrice, downPayment, interestRate, totalMonths, params.storeCommissionPct, params.vatPct);
    const { interestTotal, financedAmount, monthlyPayment } = calc;

    // Update contract + recreate payment schedule
    await this.prisma.$transaction(async (tx) => {
      // T5-C4 — Any existing payment row (PAID/PARTIALLY_PAID/PENDING/OVERDUE)
      // means the installment schedule is contractually locked in. Editing
      // financial fields after that point would silently rewrite already-
      // committed amounts/due-dates. Only non-financial fields (notes, etc.)
      // remain mutable.
      const existingPaymentCount = await tx.payment.count({
        where: { contractId: id, deletedAt: null },
      });
      const paidOrPartialCount = await tx.payment.count({
        where: { contractId: id, status: { in: ['PAID', 'PARTIALLY_PAID'] } },
      });

      if (existingPaymentCount > 0) {
        const interestRateChanged =
          dto.interestRate !== undefined &&
          Number(dto.interestRate) !== Number(contract.interestRate);
        const financialsChanged =
          sellingPrice !== Number(contract.sellingPrice) ||
          downPayment !== Number(contract.downPayment) ||
          totalMonths !== contract.totalMonths ||
          interestRateChanged;

        if (financialsChanged) {
          throw new BadRequestException(
            'ไม่สามารถแก้ไขเงื่อนไขทางการเงินได้ เนื่องจากมีตารางผ่อนชำระแล้ว ' +
            `(งวดทั้งหมด ${existingPaymentCount} งวด) ` +
            'แก้ไขได้เฉพาะข้อมูลที่ไม่ใช่ตัวเงิน เช่น หมายเหตุ เท่านั้น กรุณาสร้างสัญญาใหม่แทน',
          );
        }
      }

      await tx.contract.update({
        where: { id },
        data: {
          sellingPrice,
          downPayment,
          totalMonths,
          interestRate,
          interestTotal,
          financedAmount,
          monthlyPayment,
          paymentDueDay,
          notes: dto.notes !== undefined ? dto.notes : contract.notes,
        },
      });

      // Only recreate schedule if no payments have been made and none are overdue.
      // T5-C4 — also skip recreation when no financial fields changed; there is
      // no reason to wipe PENDING rows (and their IDs) if the math is identical.
      if (paidOrPartialCount === 0 && existingPaymentCount === 0) {
        // Check for overdue payments — don't delete them as it would lose delinquency history
        const overdueCount = await tx.payment.count({
          where: { contractId: id, status: 'OVERDUE' },
        });
        if (overdueCount > 0) {
          throw new BadRequestException(
            `มีงวดค้างชำระ ${overdueCount} งวด ไม่สามารถคำนวณตารางผ่อนชำระใหม่ได้ กรุณาจัดการงวดค้างชำระก่อน`,
          );
        }

        await tx.payment.updateMany({
          where: { contractId: id, status: 'PENDING', deletedAt: null },
          data: { deletedAt: new Date() },
        });

        const payments = generatePaymentSchedule(
          id, totalMonths, financedAmount, monthlyPayment, paymentDueDay,
          { principal: calc.principal, interestTotal: calc.interestTotal, storeCommission: calc.storeCommission, vatAmount: calc.vatAmount },
        );
        await tx.payment.createMany({ data: payments });
      }
    });

    return this.findOne(id);
  }

  // === SOFT DELETE: ลบสัญญา (เฉพาะ CREATING/REJECTED, ห้ามลบสัญญาที่ลงนามแล้ว) ===
  async softDelete(id: string, userId: string) {
    const contract = await this.findOne(id);

    // T5-C2 — Explicit terminal-status lockdown. Once a contract leaves DRAFT
    // (activation, payoff, repossession, bad-debt close-out, etc.) it becomes
    // a legal/financial record and MUST NOT be deletable — even if workflow
    // drift left it in an unexpected state. Only DRAFT is mutable.
    const immutableStatuses: string[] = [
      'ACTIVE',
      'OVERDUE',
      'DEFAULT',
      'EARLY_PAYOFF',
      'COMPLETED',
      'EXCHANGED',
      'DEFECT_EXCHANGED',
      'CLOSED_BAD_DEBT',
    ];
    if (immutableStatuses.includes(contract.status)) {
      throw new BadRequestException(
        `ไม่สามารถลบสัญญาที่อยู่ในสถานะ ${contract.status} ได้ — ` +
        'สัญญาที่เปิดใช้งานหรือปิดรายการแล้วเป็นหลักฐานทางการเงินและทางกฎหมาย ห้ามลบเด็ดขาด',
      );
    }

    // Beyond the terminal-status check, still require workflow to be
    // CREATING/REJECTED (i.e. not already submitted/approved).
    if (contract.status !== 'DRAFT' ||
        (contract.workflowStatus !== 'CREATING' && contract.workflowStatus !== 'REJECTED')) {
      throw new BadRequestException(
        'ลบได้เฉพาะสัญญาที่อยู่ในสถานะ DRAFT + กำลังสร้าง/ถูกปฏิเสธ เท่านั้น ' +
        '(สัญญาที่ลงนามแล้วห้ามลบเด็ดขาด ใช้ soft delete เท่านั้น)',
      );
    }

    // Signatures on an ACTIVE/signed-but-pending contract are eIDAS evidence —
    // cannot be erased. BUT a REJECTED workflow means manager voided the
    // contract before activation; any signatures collected beforehand have no
    // legal force. Cascade soft-delete them (row retained for audit).
    const hasSignatures = contract.signatures && contract.signatures.length > 0;
    if (hasSignatures && contract.workflowStatus !== 'REJECTED') {
      throw new BadRequestException(
        'ไม่สามารถลบสัญญาที่มีลายเซ็นแล้ว — ' +
          'อนุญาตเฉพาะสัญญาที่ถูกปฏิเสธ (workflowStatus = REJECTED) เท่านั้น',
      );
    }

    const now = new Date();
    const cascadedSignatures = hasSignatures ? contract.signatures.length : 0;

    await this.prisma.$transaction([
      this.prisma.contract.update({ where: { id }, data: { deletedAt: now } }),
      // Cascade soft-delete signatures only when the contract is REJECTED.
      // No-op when there are no signatures (unsigned drafts).
      ...(cascadedSignatures > 0
        ? [
            this.prisma.signature.updateMany({
              where: { contractId: id, deletedAt: null },
              data: { deletedAt: now },
            }),
          ]
        : []),
      // Release the credit check back to the customer — unlinking from this
      // (now-deleted) contract lets them reuse the APPROVED decision for a
      // future contract. The gate at contracts.service.ts:332 filters on
      // `contractId: null`, so a stale link would trap the approval.
      this.prisma.creditCheck.updateMany({
        where: { contractId: id },
        data: { contractId: null },
      }),
      // KYC records captured for this contract (OTP + ID card photo) become
      // orphans otherwise. Soft-delete keeps the row for audit but marks it
      // as no-longer-tied-to-an-active-contract.
      this.prisma.kycVerification.updateMany({
        where: { contractId: id, deletedAt: null },
        data: { deletedAt: now },
      }),
      // Release reserved product back to IN_STOCK
      this.prisma.product.updateMany({
        where: { id: contract.productId, status: 'RESERVED' },
        data: { status: 'IN_STOCK' },
      }),
      this.prisma.auditLog.create({
        data: {
          userId,
          action: 'CONTRACT_DELETE',
          entity: 'contract',
          entityId: id,
          oldValue: {
            contractNumber: contract.contractNumber,
            status: contract.status,
            workflowStatus: contract.workflowStatus,
          },
          newValue: {
            cascadedSignatures,
          },
        },
      }),
    ]);

    return {
      message:
        cascadedSignatures > 0
          ? `ลบสัญญาเรียบร้อย (soft delete) พร้อมลายเซ็น ${cascadedSignatures} รายการ`
          : 'ลบสัญญาเรียบร้อย (soft delete)',
    };
  }

  /**
   * T4-C1 — Reassign salesperson after contract is created.
   *
   * Salesperson identity ties to commission payout and audit trail. Once a
   * contract is APPROVED or has any `Signature` row, the salesperson
   * attribution is effectively locked: changing it would rewrite a historical
   * fact (who sold what, who gets the commission, whose signature witnessed
   * the customer's). We therefore reject reassignment in those cases, with
   * an OWNER-only override (logged to AuditLog, commission recalc must be
   * scheduled separately).
   *
   * @param contractId      contract to update
   * @param newSalespersonId  user id of the new salesperson
   * @param actor           the user performing the change (with role)
   */
  async updateSalesperson(
    contractId: string,
    newSalespersonId: string,
    actor: { id: string; role: string },
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { signatures: { select: { id: true } } },
    });
    if (!contract || contract.deletedAt) {
      throw new NotFoundException('ไม่พบสัญญา');
    }

    // Verify the new salesperson exists and is active
    const newSalesperson = await this.prisma.user.findUnique({
      where: { id: newSalespersonId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!newSalesperson || newSalesperson.deletedAt) {
      throw new BadRequestException('ไม่พบพนักงานขายที่เลือก');
    }

    // No-op
    if (contract.salespersonId === newSalespersonId) {
      return { message: 'พนักงานขายเดิมอยู่แล้ว ไม่มีการเปลี่ยนแปลง', contractId };
    }

    const hasSignatures = (contract.signatures?.length ?? 0) > 0;
    const isApproved = contract.workflowStatus === 'APPROVED';
    const isLocked = isApproved || hasSignatures;

    if (isLocked && actor.role !== 'OWNER') {
      throw new ForbiddenException(
        'ไม่สามารถเปลี่ยนพนักงานขายได้ เนื่องจากสัญญาถูกอนุมัติหรือลงนามแล้ว ' +
        '(เฉพาะ OWNER เท่านั้นที่มีสิทธิ์แก้ไข)',
      );
    }

    const previousSalespersonId = contract.salespersonId;

    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: contractId },
        data: { salespersonId: newSalespersonId },
      });

      // Audit trail — required whenever a locked contract is overridden by OWNER,
      // and cheap/useful even for the unlocked DRAFT path.
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'UPDATE_SALESPERSON',
          entity: 'contract',
          entityId: contractId,
          oldValue: { salespersonId: previousSalespersonId },
          newValue: {
            salespersonId: newSalespersonId,
            overrideReason: isLocked ? 'OWNER_OVERRIDE_AFTER_LOCK' : 'PRE_APPROVAL_REASSIGN',
            workflowStatus: contract.workflowStatus,
            signatureCount: contract.signatures?.length ?? 0,
          },
        },
      });
    });

    this.structuredLogger.log('contract.salesperson.reassigned', {
      contractId,
      contractNumber: contract.contractNumber,
      previousSalespersonId,
      newSalespersonId,
      actorId: actor.id,
      actorRole: actor.role,
      wasLocked: isLocked,
    });

    // TODO(T4-C1): Commission recalculation is out of scope of this change.
    // When a locked contract's salesperson is reassigned by OWNER, any
    // already-posted commission attributions must be reversed on the
    // previous salesperson and re-accrued to the new salesperson.
    // Schedule this via CommissionService once the reconciliation flow is
    // designed (see docs/ceo-review/tier-8-fraud-heatmap-master.md §T4-C1).

    return this.findOne(contractId);
  }
}
