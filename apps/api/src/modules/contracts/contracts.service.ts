import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { PaymentMethod, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';
import { calculateInstallment, generatePaymentSchedule } from '../../utils/installment.util';
import { loadInstallmentConfig, resolveInstallmentParams, BUSINESS_RULES } from '../../utils/config.util';
import { generateContractNumber } from '../../utils/sequence.util';

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

  async create(dto: CreateContractDto, salespersonId: string) {
    // Try to find interest config by product category
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.status !== 'IN_STOCK') {
      throw new BadRequestException('สินค้าไม่พร้อมขาย');
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

  // === WORKFLOW: ส่งตรวจสอบ ===
  async submitForReview(id: string, userId: string) {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'CREATING' && contract.workflowStatus !== 'REJECTED') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ กำลังสร้าง หรือ ปฏิเสธ เท่านั้น');
    }

    // Only the salesperson who created it can submit
    if (contract.salespersonId !== userId) {
      throw new ForbiddenException('เฉพาะพนักงานที่สร้างสัญญาเท่านั้นที่สามารถส่งตรวจสอบ');
    }

    await this.prisma.contract.update({
      where: { id },
      data: { workflowStatus: 'PENDING_REVIEW' },
    });

    return this.findOne(id);
  }

  // === WORKFLOW: อนุมัติสัญญา ===
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

    // Require both signatures before activation
    const customerSigned = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'CUSTOMER');
    const staffSigned = contract.signatures?.some((s: { signerType: string }) => s.signerType === 'STAFF');
    if (!customerSigned || !staffSigned) {
      throw new BadRequestException('ต้องลงนามครบทั้งลูกค้าและพนักงานก่อนเปิดใช้งานสัญญา');
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
      await tx.contract.update({ where: { id }, data: { status: 'ACTIVE' } });
      await tx.product.update({ where: { id: contract.productId }, data: { status: 'SOLD_INSTALLMENT' } });
    });

    return this.findOne(id);
  }

  // === SOFT DELETE: ลบสัญญา (เฉพาะ CREATING/REJECTED) ===
  async softDelete(id: string, userId: string) {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'CREATING' && contract.workflowStatus !== 'REJECTED') {
      throw new BadRequestException('ลบได้เฉพาะสัญญาที่อยู่ในสถานะ กำลังสร้าง หรือ ถูกปฏิเสธ เท่านั้น');
    }

    await this.prisma.$transaction([
      this.prisma.contract.update({ where: { id }, data: { deletedAt: new Date() } }),
      // Release reserved product back to IN_STOCK
      this.prisma.product.updateMany({
        where: { id: contract.productId, status: 'RESERVED' },
        data: { status: 'IN_STOCK' },
      }),
    ]);

    return { message: 'ลบสัญญาเรียบร้อย' };
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
}
