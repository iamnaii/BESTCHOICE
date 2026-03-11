import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PaymentMethod, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';
import { calculateInstallment, generatePaymentSchedule } from '../../utils/installment.util';
import { loadInstallmentConfig, resolveInstallmentParams, BUSINESS_RULES } from '../../utils/config.util';
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
import * as crypto from 'crypto';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);
  constructor(private prisma: PrismaService) {}

  async findAll(filters: {
    status?: string;
    workflowStatus?: string;
    branchId?: string;
    customerId?: string;
    search?: string;
    page?: number;
    limit?: number;
    salespersonId?: string;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.workflowStatus) where.workflowStatus = filters.workflowStatus;
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.salespersonId) where.salespersonId = filters.salespersonId;
    if (filters.search) {
      where.OR = [
        { contractNumber: { contains: filters.search, mode: 'insensitive' } },
        { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);

    const [data, total] = await Promise.all([
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
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
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
      references: customer?.references as any[],
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
    const refs = (customer?.references as any[]) || [];
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
      } catch (err: any) {
        // Retry on unique constraint (P2002) or serialization failure (P2034)
        const isRetryable = err?.code === 'P2002' || err?.code === 'P2034';
        if (isRetryable && attempt < MAX_RETRIES - 1) {
          continue;
        }
        // Re-throw BadRequestException / ForbiddenException as-is
        if (err instanceof BadRequestException || err instanceof ForbiddenException) {
          throw err;
        }

        this.logger.error(`Failed to create contract (attempt ${attempt + 1}/${MAX_RETRIES}): [${err?.code}] ${err?.message}`, err?.stack);

        // Provide specific error messages for known Prisma errors
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          switch (err.code) {
            case 'P2002':
              throw new BadRequestException('เลขสัญญาซ้ำ กรุณาลองใหม่อีกครั้ง');
            case 'P2003': {
              const field = (err.meta as any)?.field_name || '';
              if (field.includes('branch')) throw new BadRequestException('ไม่พบสาขาที่เลือก');
              if (field.includes('customer')) throw new BadRequestException('ไม่พบข้อมูลลูกค้า');
              if (field.includes('product')) throw new BadRequestException('ไม่พบสินค้าที่เลือก');
              if (field.includes('salesperson') || field.includes('user')) throw new BadRequestException('ไม่พบข้อมูลพนักงานขาย');
              throw new BadRequestException(`ข้อมูลอ้างอิงไม่ถูกต้อง (${field})`);
            }
            case 'P2025':
              throw new BadRequestException('ไม่พบข้อมูลที่ต้องการอัปเดต (อาจถูกลบแล้ว)');
            case 'P2028':
              throw new BadRequestException('การทำรายการหมดเวลา กรุณาลองใหม่อีกครั้ง');
          }
        }

        this.logger.error(`Contract creation failed: ${err?.message}`, err?.stack);
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

      // Delete only PENDING payments (preserve PAID and PARTIALLY_PAID history)
      const paidCount = await tx.payment.count({
        where: { contractId: id, status: { in: ['PAID', 'PARTIALLY_PAID'] } },
      });

      await tx.payment.deleteMany({
        where: { contractId: id, status: { in: ['PENDING', 'OVERDUE'] } },
      });

      const remainingMonths = totalMonths - paidCount;
      if (remainingMonths > 0) {
        const payments = generatePaymentSchedule(id, remainingMonths, financedAmount - (monthlyPayment * paidCount), monthlyPayment, paymentDueDay);
        // Offset installment numbers to continue after paid ones
        const offsetPayments = payments.map((p) => ({
          ...p,
          installmentNo: p.installmentNo + paidCount,
        }));
        await tx.payment.createMany({ data: offsetPayments });
      }
    });

    return this.findOne(id);
  }

  // === WORKFLOW: ส่งตรวจสอบ (ตรวจ Validation ทั้งหมดก่อนส่ง) ===
  async submitForReview(id: string, userId: string) {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'CREATING' && contract.workflowStatus !== 'REJECTED') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ กำลังสร้าง หรือ ปฏิเสธ เท่านั้น');
    }

    // Only the salesperson who created it can submit
    if (contract.salespersonId !== userId) {
      throw new ForbiddenException('เฉพาะพนักงานที่สร้างสัญญาเท่านั้นที่สามารถส่งตรวจสอบ');
    }

    // Enforce mandatory steps before submit
    // Step 1: Credit check must be approved
    if (!contract.creditCheck || contract.creditCheck.status !== 'APPROVED') {
      throw new BadRequestException('ต้องผ่านการตรวจเครดิตก่อนส่งตรวจสอบ (ขั้นตอนที่ 1)');
    }

    // Step 2: Required fields validation
    const customer = contract.customer;
    const product = contract.product;
    const missingFields = checkRequiredContractFields({
      customerName: customer?.name,
      customerNationalId: customer?.nationalId,
      customerPhone: customer?.phone,
      customerAddressIdCard: customer?.addressIdCard,
      customerAddressCurrent: customer?.addressCurrent,
      references: customer?.references as any[],
      productName: product?.name,
      productImei: product?.imeiSerial,
      sellingPrice: Number(contract.sellingPrice),
      downPayment: Number(contract.downPayment),
      totalMonths: contract.totalMonths,
      monthlyPayment: Number(contract.monthlyPayment),
    });
    if (missingFields.length > 0) {
      throw new BadRequestException(`ข้อมูลสัญญาไม่ครบ: ${missingFields.join(', ')} (ขั้นตอนที่ 2)`);
    }

    // Step 3: PDPA consent
    if (!contract.pdpaConsentId) {
      throw new BadRequestException('ต้องได้รับความยินยอม PDPA จากลูกค้าก่อน (ขั้นตอนที่ 3)');
    }

    // Step 5: Signatures (at minimum customer + company)
    const customerSigned = contract.signatures?.some((s: { signerType: string }) =>
      s.signerType === 'CUSTOMER'
    );
    const companySigned = contract.signatures?.some((s: { signerType: string }) =>
      s.signerType === 'COMPANY' || s.signerType === 'STAFF'
    );
    if (!customerSigned || !companySigned) {
      throw new BadRequestException('ต้องลงนามครบทั้งลูกค้าและผู้ขายก่อนส่งตรวจสอบ (ขั้นตอนที่ 5)');
    }

    // Generate contract hash for integrity
    const contractData = JSON.stringify({
      contractNumber: contract.contractNumber,
      customerId: contract.customerId,
      productId: contract.productId,
      sellingPrice: contract.sellingPrice,
      downPayment: contract.downPayment,
      totalMonths: contract.totalMonths,
      monthlyPayment: contract.monthlyPayment,
    });
    const contractHash = crypto.createHash('sha256').update(contractData).digest('hex');

    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'PENDING_REVIEW',
        contractHash,
        // Set legal clause flags
        hasOwnershipClause: true,
        hasRepossessionClause: true,
        hasEarlyPayoffClause: true,
        hasNoTransferClause: true,
        hasAcknowledgement: true,
      },
    });

    return this.findOne(id);
  }

  // === WORKFLOW: อนุมัติสัญญา (ตรวจเอกสารครบก่อนอนุมัติ) ===
  async approveContract(id: string, userId: string, userRole: string, reviewNotes?: string) {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'PENDING_REVIEW') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ รอตรวจสอบ');
    }

    // Prevent self-approval: salesperson cannot approve their own contract
    // Exception: OWNER can always approve (for small business where owner is also salesperson)
    if (contract.salespersonId === userId && userRole !== 'OWNER') {
      throw new ForbiddenException('ไม่สามารถอนุมัติสัญญาที่ตัวเองสร้างได้');
    }

    // Check age for guardian requirement
    let requiresGuardian = false;
    if (contract.customer?.birthDate) {
      const ageCheck = checkAgeEligibility(new Date(contract.customer.birthDate));
      requiresGuardian = ageCheck.requiresGuardian;
    }

    // Step 7: Manager ตรวจสอบเอกสารครบ
    const docCheck = checkRequiredDocuments(
      contract.contractDocuments || [],
      requiresGuardian,
    );
    if (!docCheck.complete) {
      const missing = docCheck.checklist
        .filter((c) => !c.present)
        .map((c) => c.label);
      throw new BadRequestException(`เอกสารไม่ครบ ไม่สามารถอนุมัติได้: ${missing.join(', ')}`);
    }

    // Check signatures completeness
    const sigCheck = checkRequiredSignatures(
      contract.signatures || [],
      requiresGuardian,
    );
    if (!sigCheck.complete) {
      const missing = sigCheck.checklist
        .filter((c) => !c.signed)
        .map((c) => c.label);
      throw new BadRequestException(`ลายเซ็นไม่ครบ ไม่สามารถอนุมัติได้: ${missing.join(', ')}`);
    }

    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'APPROVED',
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNotes,
      },
    });

    return this.findOne(id);
  }

  // === WORKFLOW: ปฏิเสธสัญญา ===
  async rejectContract(id: string, userId: string, userRole: string, reviewNotes: string) {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'PENDING_REVIEW') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ รอตรวจสอบ');
    }

    // OWNER can always reject (for small business where owner is also salesperson)
    if (contract.salespersonId === userId && userRole !== 'OWNER') {
      throw new ForbiddenException('ไม่สามารถปฏิเสธสัญญาที่ตัวเองสร้างได้');
    }

    await this.prisma.contract.update({
      where: { id },
      data: {
        workflowStatus: 'REJECTED',
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNotes,
      },
    });

    return this.findOne(id);
  }

  async activate(id: string) {
    const contract = await this.findOne(id);

    // Must be APPROVED workflow and DRAFT status
    if (contract.workflowStatus !== 'APPROVED') {
      throw new BadRequestException('สัญญาต้องได้รับการอนุมัติก่อนเปิดใช้งาน');
    }
    if (contract.status !== 'DRAFT') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ DRAFT');
    }

    // Verify PDPA consent exists (compliance: พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562)
    if (!contract.pdpaConsentId) {
      throw new BadRequestException('ต้องได้รับความยินยอม PDPA ก่อนเปิดใช้งานสัญญา');
    }

    // Require all required signatures (customer + company + 2 witnesses)
    const customerSigned = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'CUSTOMER');
    const companySigned = contract.signatures?.some((s: { signerType: string }) =>
      s.signerType === 'COMPANY' || s.signerType === 'STAFF'
    );
    const witness1Signed = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'WITNESS_1');
    const witness2Signed = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'WITNESS_2');

    if (!customerSigned || !companySigned) {
      throw new BadRequestException('ต้องลงนามครบทั้งผู้ซื้อและผู้ขายก่อนเปิดใช้งานสัญญา');
    }
    if (!witness1Signed || !witness2Signed) {
      throw new BadRequestException('ต้องมีพยานลงนามครบ 2 คนก่อนเปิดใช้งานสัญญา');
    }

    // Check guardian signature if required
    if (contract.customer?.birthDate) {
      const ageCheck = checkAgeEligibility(new Date(contract.customer.birthDate));
      if (ageCheck.requiresGuardian) {
        const guardianSigned = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'GUARDIAN');
        if (!guardianSigned) {
          throw new BadRequestException('ลูกค้าอายุต่ำกว่า 20 ปี ต้องมีผู้ปกครองลงนาม');
        }
      }
    }

    // Verify product is still reserved for this contract
    const product = await this.prisma.product.findUnique({ where: { id: contract.productId } });
    if (!product || (product.status !== 'RESERVED' && product.status !== 'IN_STOCK')) {
      throw new BadRequestException('สินค้าไม่พร้อมสำหรับเปิดสัญญา (อาจถูกขายหรือลบไปแล้ว)');
    }

    await this.prisma.$transaction(async (tx) => {
      // Re-check product status inside transaction to prevent race condition
      const prod = await tx.product.findUnique({ where: { id: contract.productId } });
      if (!prod || (prod.status !== 'RESERVED' && prod.status !== 'IN_STOCK')) {
        throw new BadRequestException('สินค้าไม่พร้อมสำหรับเปิดสัญญา (อาจถูกขายหรือลบไปแล้ว)');
      }
      // Step 8: สถานะเปลี่ยนเป็น ACTIVE → เริ่มนับงวด
      await tx.contract.update({ where: { id }, data: { status: 'ACTIVE' } });
      await tx.product.update({ where: { id: contract.productId }, data: { status: 'SOLD_INSTALLMENT' } });
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

  async getSchedule(id: string) {
    await this.findOne(id);
    return this.prisma.payment.findMany({
      where: { contractId: id },
      orderBy: { installmentNo: 'asc' },
    });
  }

  async getEarlyPayoffQuote(id: string) {
    const contract = await this.findOne(id);
    if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contract.status)) {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ ACTIVE, OVERDUE หรือ DEFAULT');
    }

    const paidPayments = contract.payments.filter((p) => p.status === 'PAID');
    const remainingMonths = contract.totalMonths - paidPayments.length;
    const monthlyInterest = Number(contract.interestTotal) / contract.totalMonths;
    // Use financedAmount (includes commission + VAT) minus interest for true principal
    const truePrincipal = Number(contract.financedAmount) - Number(contract.interestTotal);
    const monthlyPrincipal = truePrincipal / contract.totalMonths;

    const remainingPrincipal = monthlyPrincipal * remainingMonths;
    const remainingInterest = monthlyInterest * remainingMonths;
    const discount = remainingInterest * BUSINESS_RULES.EARLY_PAYOFF_DISCOUNT;
    const totalPayoff = remainingPrincipal + (remainingInterest - discount);

    // Add any unpaid late fees
    const unpaidLateFees = contract.payments
      .filter((p) => p.status !== 'PAID')
      .reduce((sum, p) => sum + Number(p.lateFee), 0);

    return {
      remainingMonths,
      remainingPrincipal: Math.round(remainingPrincipal),
      remainingInterest: Math.round(remainingInterest),
      discount: Math.round(discount),
      unpaidLateFees,
      totalPayoff: Math.round(totalPayoff + unpaidLateFees),
    };
  }

  async earlyPayoff(id: string, userId: string, paymentMethod: string) {
    const quote = await this.getEarlyPayoffQuote(id);

    await this.prisma.$transaction(async (tx) => {
      const unpaidPayments = await tx.payment.findMany({
        where: { contractId: id, status: { not: 'PAID' } },
        orderBy: { installmentNo: 'asc' },
      });

      let remainingPayoff = quote.totalPayoff;
      for (const payment of unpaidPayments) {
        const owed = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);
        const payAmount = Math.min(remainingPayoff, owed);
        remainingPayoff -= payAmount;

        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            paidDate: new Date(),
            amountPaid: Number(payment.amountPaid) + payAmount,
            paymentMethod: paymentMethod as PaymentMethod,
            recordedById: userId,
          },
        });
      }

      await tx.contract.update({
        where: { id },
        data: { status: 'EARLY_PAYOFF' },
      });
    });

    return { ...quote, status: 'EARLY_PAYOFF' };
  }

  // ─── Document Dashboard for Manager/Admin ──────────────
  async getDocumentDashboard(branchId?: string) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (branchId) where.branchId = branchId;

    // Get all active contracts with their documents and signatures
    const contracts = await this.prisma.contract.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        customer: { select: { name: true } },
        eDocuments: { select: { id: true, documentType: true } },
        signatures: { select: { id: true, signerType: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const REQUIRED_DOCS = ['ID_CARD_COPY', 'KYC_SELFIE', 'DEVICE_PHOTO', 'DEVICE_IMEI_PHOTO', 'DOWN_PAYMENT_RECEIPT', 'PDPA_CONSENT'];
    const REQUIRED_SIGS = ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'];

    let fullyDocumented = 0;
    let pendingDocuments = 0;
    let pendingSignatures = 0;
    let pendingApproval = 0;
    let overdueContracts = 0;

    const branchMap = new Map<string, { branchId: string; branchName: string; total: number; documented: number; pendingDocs: number; pendingSigs: number }>();

    for (const c of contracts) {
      const docTypes = new Set(c.eDocuments.map((d) => d.documentType));
      const sigTypes = new Set(c.signatures.map((s) => s.signerType as string));
      const hasAllDocs = REQUIRED_DOCS.every((d) => docTypes.has(d));
      const hasAllSigs = REQUIRED_SIGS.every((s) => sigTypes.has(s));

      if (hasAllDocs && hasAllSigs) fullyDocumented++;
      if (!hasAllDocs) pendingDocuments++;
      if (!hasAllSigs) pendingSignatures++;
      if (c.workflowStatus === 'PENDING_REVIEW' || c.workflowStatus === 'CREATING') pendingApproval++;
      if (c.status === 'OVERDUE' || c.status === 'DEFAULT') overdueContracts++;

      // By branch
      const bId = c.branchId || 'unknown';
      const bName = c.branch?.name || 'ไม่ระบุ';
      if (!branchMap.has(bId)) {
        branchMap.set(bId, { branchId: bId, branchName: bName, total: 0, documented: 0, pendingDocs: 0, pendingSigs: 0 });
      }
      const b = branchMap.get(bId)!;
      b.total++;
      if (hasAllDocs && hasAllSigs) b.documented++;
      if (!hasAllDocs) b.pendingDocs++;
      if (!hasAllSigs) b.pendingSigs++;
    }

    // SLA alerts: contracts waiting for approval > 24h
    const slaAlerts = contracts
      .filter((c) => ['PENDING_REVIEW', 'CREATING'].includes(c.workflowStatus || ''))
      .map((c) => {
        const hoursWaiting = Math.round((Date.now() - new Date(c.updatedAt).getTime()) / (1000 * 60 * 60));
        return {
          id: c.id,
          contractNumber: c.contractNumber,
          customerName: c.customer?.name || '',
          workflowStatus: c.workflowStatus,
          hoursWaiting,
          branchName: c.branch?.name || '',
        };
      })
      .filter((a) => a.hoursWaiting >= 24)
      .sort((a, b) => b.hoursWaiting - a.hoursWaiting)
      .slice(0, 20);

    // Recent document activity from audit log
    let recentActivity: Array<{ id: string; contractNumber: string; customerName: string; action: string; createdAt: string; branchName: string }> = [];
    try {
      const audits = await this.prisma.documentAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      // Look up contract details for each audit entry
      for (const a of audits) {
        const contract = await this.prisma.contract.findUnique({
          where: { id: a.contractId },
          select: {
            contractNumber: true,
            customer: { select: { name: true } },
            branch: { select: { name: true } },
          },
        });
        recentActivity.push({
          id: a.id,
          contractNumber: contract?.contractNumber || '',
          customerName: contract?.customer?.name || '',
          action: a.action,
          createdAt: a.createdAt.toISOString(),
          branchName: contract?.branch?.name || '',
        });
      }
    } catch {
      // DocumentAuditLog might not exist yet
    }

    return {
      totalContracts: contracts.length,
      fullyDocumented,
      pendingDocuments,
      pendingSignatures,
      pendingApproval,
      overdueContracts,
      byBranch: Array.from(branchMap.values()),
      recentActivity,
      slaAlerts,
    };
  }

  // ─── QR Code Verification ────────────────────────────
  async verifyContract(id: string, hash?: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      select: {
        id: true,
        contractNumber: true,
        contractHash: true,
        status: true,
        workflowStatus: true,
        createdAt: true,
        totalMonths: true,
        monthlyPayment: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        signatures: {
          select: { signerType: true, signerName: true, signedAt: true },
        },
      },
    });

    if (!contract || !contract.contractHash) {
      return { verified: false, reason: 'ไม่พบสัญญาหรือสัญญายังไม่ได้ยืนยัน' };
    }

    const isHashValid = hash ? contract.contractHash === hash : true;
    const signerSummary = contract.signatures.map((s) => ({
      type: s.signerType,
      name: s.signerName,
      signedAt: s.signedAt,
    }));

    return {
      verified: isHashValid,
      reason: isHashValid ? 'สัญญาได้รับการยืนยันแล้ว' : 'Hash ไม่ตรงกัน สัญญาอาจถูกแก้ไข',
      contract: {
        contractNumber: contract.contractNumber,
        status: contract.status,
        workflowStatus: contract.workflowStatus,
        customerName: contract.customer?.name || '',
        branchName: contract.branch?.name || '',
        createdAt: contract.createdAt,
        totalMonths: contract.totalMonths,
        monthlyPayment: contract.monthlyPayment,
      },
      signatures: signerSummary,
      hash: contract.contractHash,
    };
  }

  async getQrData(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      select: { id: true, contractNumber: true, contractHash: true },
    });

    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    // QR code content: verification URL with contract ID and hash
    const verifyUrl = `/api/contracts/${contract.id}/verify?hash=${contract.contractHash || ''}`;

    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      contractHash: contract.contractHash,
      verifyUrl,
      qrContent: JSON.stringify({
        type: 'BESTCHOICE_CONTRACT',
        id: contract.id,
        number: contract.contractNumber,
        hash: contract.contractHash,
        verifyUrl,
      }),
    };
  }

  /** Record PDPA consent and link to contract */
  async recordPdpaConsent(
    contractId: string,
    signatureImage: string,
    req: { ip?: string; userAgent?: string },
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { customer: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    if (contract.pdpaConsentId) throw new BadRequestException('สัญญานี้มี PDPA consent แล้ว');

    // Get privacy notice version
    const versionConfig = await this.prisma.systemConfig.findUnique({
      where: { key: 'pdpa_privacy_notice_version' },
    });

    const consent = await this.prisma.pDPAConsent.create({
      data: {
        customerId: contract.customerId,
        consentVersion: versionConfig?.value || '1.0',
        privacyNoticeText: 'ยินยอมตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562',
        purposes: [
          'สัญญาผ่อนชำระสินค้า',
          'ติดตามหนี้และบริหารสัญญา',
          'จัดทำเอกสารทางกฎหมาย',
          'ติดต่อสื่อสารเกี่ยวกับสัญญา',
        ],
        status: 'GRANTED',
        grantedAt: new Date(),
        ipAddress: req.ip || null,
        deviceInfo: req.userAgent || null,
        signatureImage: signatureImage || null,
      },
    });

    // Link consent to contract
    await this.prisma.contract.update({
      where: { id: contractId },
      data: { pdpaConsentId: consent.id },
    });

    return consent;
  }

  /** Get PDPA consent for contract */
  async getPdpaConsent(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { pdpaConsentId: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    if (!contract.pdpaConsentId) return null;

    return this.prisma.pDPAConsent.findUnique({
      where: { id: contract.pdpaConsentId },
    });
  }
}
