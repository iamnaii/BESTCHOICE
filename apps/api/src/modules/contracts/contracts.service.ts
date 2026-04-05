import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** User context for branch-level access control */
export interface BranchAccessUser {
  id: string;
  role: string;
  branchId: string | null;
}
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';
import { calculateInstallment, generatePaymentSchedule } from '../../utils/installment.util';
import { loadInstallmentConfig, resolveInstallmentParams } from '../../utils/config.util';
import { generateContractNumber } from '../../utils/sequence.util';
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
  constructor(
    private prisma: PrismaService,
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
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalContracts: total,
        activeContracts: totalActive,
        overdueContracts: totalOverdue,
        portfolioValue: Number(portfolioValue._sum.sellingPrice || 0),
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
        payments: { orderBy: { installmentNo: 'asc' } },
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
    if (user && user.role !== 'OWNER' && user.role !== 'ACCOUNTANT') {
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

  async create(dto: CreateContractDto, salespersonId: string) {
    // Try to find interest config by product category
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.status !== 'IN_STOCK') {
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
        productCategories: { has: product.category },
      },
    });

    // Load configs with shared utility
    const systemConfig = await loadInstallmentConfig(this.prisma);
    const params = resolveInstallmentParams(interestConfig, systemConfig, dto.interestRate);

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
          const customerData = await tx.customer.findUnique({ where: { id: dto.customerId } });
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

    return this.findOne(contract!.id);
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
    const sellingPrice = dto.sellingPrice ?? Number(contract.sellingPrice);
    const downPayment = dto.downPayment ?? Number(contract.downPayment);
    const totalMonths = dto.totalMonths ?? contract.totalMonths;
    const paymentDueDay = dto.paymentDueDay ?? contract.paymentDueDay;

    // Get interest config
    const interestConfig = contract.interestConfigId
      ? await this.prisma.interestConfig.findUnique({ where: { id: contract.interestConfigId } })
      : null;

    const systemConfig = await loadInstallmentConfig(this.prisma);
    const params = resolveInstallmentParams(interestConfig, systemConfig, dto.interestRate ?? Number(contract.interestRate));
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
      // Prevent schedule recalculation when any payments have been made
      const paidOrPartialCount = await tx.payment.count({
        where: { contractId: id, status: { in: ['PAID', 'PARTIALLY_PAID'] } },
      });

      if (paidOrPartialCount > 0) {
        // If payments exist, only allow updating notes/non-financial fields
        const financialsChanged =
          sellingPrice !== Number(contract.sellingPrice) ||
          downPayment !== Number(contract.downPayment) ||
          totalMonths !== contract.totalMonths;

        if (financialsChanged) {
          throw new BadRequestException(
            'ไม่สามารถแก้ไขเงื่อนไขทางการเงินได้ เนื่องจากมีการชำระเงินแล้ว ' +
            `(ชำระแล้ว ${paidOrPartialCount} งวด) กรุณาสร้างสัญญาใหม่แทน`,
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

      // Only recreate schedule if no payments have been made and none are overdue
      if (paidOrPartialCount === 0) {
        // Check for overdue payments — don't delete them as it would lose delinquency history
        const overdueCount = await tx.payment.count({
          where: { contractId: id, status: 'OVERDUE' },
        });
        if (overdueCount > 0) {
          throw new BadRequestException(
            `มีงวดค้างชำระ ${overdueCount} งวด ไม่สามารถคำนวณตารางผ่อนชำระใหม่ได้ กรุณาจัดการงวดค้างชำระก่อน`,
          );
        }

        await tx.payment.deleteMany({
          where: { contractId: id, status: 'PENDING' },
        });

        const payments = generatePaymentSchedule(id, totalMonths, financedAmount, monthlyPayment, paymentDueDay);
        await tx.payment.createMany({ data: payments });
      }
    });

    return this.findOne(id);
  }

  // === SOFT DELETE: ลบสัญญา (เฉพาะ CREATING/REJECTED, ห้ามลบสัญญาที่ลงนามแล้ว) ===
  async softDelete(id: string, userId: string) {
    const contract = await this.findOne(id);

    // ห้ามลบสัญญาที่สถานะ ACTIVE ขึ้นไป (Immutable Contract)
    if (!['DRAFT'].includes(contract.status) ||
        (contract.workflowStatus !== 'CREATING' && contract.workflowStatus !== 'REJECTED')) {
      throw new BadRequestException(
        'ลบได้เฉพาะสัญญาที่อยู่ในสถานะ DRAFT + กำลังสร้าง/ถูกปฏิเสธ เท่านั้น ' +
        '(สัญญาที่ลงนามแล้วห้ามลบเด็ดขาด ใช้ soft delete เท่านั้น)'
      );
    }

    // ถ้ามีลายเซ็นแล้ว ห้ามลบเด็ดขาด
    if (contract.signatures && contract.signatures.length > 0) {
      throw new BadRequestException('ไม่สามารถลบสัญญาที่มีลายเซ็นแล้ว');
    }

    await this.prisma.$transaction([
      this.prisma.contract.update({ where: { id }, data: { deletedAt: new Date() } }),
      // Release reserved product back to IN_STOCK
      this.prisma.product.updateMany({
        where: { id: contract.productId, status: 'RESERVED' },
        data: { status: 'IN_STOCK' },
      }),
    ]);

    return { message: 'ลบสัญญาเรียบร้อย (soft delete)' };
  }
}
