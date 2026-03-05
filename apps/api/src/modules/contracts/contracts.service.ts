import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';

@Injectable()
export class ContractsService {
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
    const limit = filters.limit || 50;

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

    // Require approved credit check for customer before creating contract
    const approvedCreditCheck = await this.prisma.creditCheck.findFirst({
      where: { customerId: dto.customerId, status: 'APPROVED', contractId: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!approvedCreditCheck) {
      throw new BadRequestException('ลูกค้าต้องผ่านการตรวจเครดิตก่อนทำสัญญา');
    }

    // Find interest config matching the product category
    const interestConfig = await this.prisma.interestConfig.findFirst({
      where: {
        isActive: true,
        productCategories: { has: product.category },
      },
    });

    // Get system configs as fallback
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: ['interest_rate', 'min_down_payment_pct', 'min_installment_months', 'max_installment_months'] } },
    });
    const getConfig = (key: string, def: number) => parseFloat(configs.find((c) => c.key === key)?.value || String(def));

    // Use interest config if found, otherwise fallback to system config
    const interestRate = dto.interestRate ?? (interestConfig ? Number(interestConfig.interestRate) : getConfig('interest_rate', 0.08));
    const minDownPct = interestConfig ? Number(interestConfig.minDownPaymentPct) : getConfig('min_down_payment_pct', 0.15);
    const minMonths = interestConfig ? interestConfig.minInstallmentMonths : getConfig('min_installment_months', 6);
    const maxMonths = interestConfig ? interestConfig.maxInstallmentMonths : getConfig('max_installment_months', 12);

    // Validations
    if (dto.downPayment >= dto.sellingPrice) {
      throw new BadRequestException('เงินดาวน์ต้องน้อยกว่าราคาขาย');
    }
    if (dto.downPayment < dto.sellingPrice * minDownPct) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(minDownPct * 100).toFixed(0)}% (${(dto.sellingPrice * minDownPct).toLocaleString()} บาท)`);
    }
    if (dto.totalMonths < minMonths || dto.totalMonths > maxMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${minMonths}-${maxMonths} เดือน`);
    }

    // Validate paymentDueDay
    if (dto.paymentDueDay !== undefined && (dto.paymentDueDay < 1 || dto.paymentDueDay > 28)) {
      throw new BadRequestException('วันที่ครบกำหนดชำระต้องอยู่ระหว่าง 1-28');
    }

    // Calculate installment
    const principal = dto.sellingPrice - dto.downPayment;
    const interestTotal = principal * interestRate * dto.totalMonths;
    const financedAmount = principal + interestTotal;
    const monthlyPayment = Math.ceil(financedAmount / dto.totalMonths);

    // Create contract + payment schedule in transaction with serializable isolation
    const contract = await this.prisma.$transaction(async (tx) => {
      // Generate contract number inside transaction using COUNT for robustness
      const totalContracts = await tx.contract.count();
      // Also check the highest existing number in case of gaps
      const lastContract = await tx.contract.findFirst({
        orderBy: { contractNumber: 'desc' },
        select: { contractNumber: true },
      });
      const lastNum = lastContract
        ? parseInt(lastContract.contractNumber.replace(/\D/g, '')) || 0
        : 0;
      const nextNum = Math.max(totalContracts, lastNum) + 1;
      const contractNumber = `CT${String(nextNum).padStart(6, '0')}`;

      const newContract = await tx.contract.create({
        data: {
          contractNumber,
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          planType: dto.planType as any,
          sellingPrice: dto.sellingPrice,
          downPayment: dto.downPayment,
          interestRate,
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

      // Create payment schedule with custom due day
      const now = new Date();
      const dueDay = dto.paymentDueDay || 1;
      const payments: Array<{
        contractId: string;
        installmentNo: number;
        dueDate: Date;
        amountDue: number;
        status: 'PENDING';
      }> = [];

      for (let i = 1; i <= dto.totalMonths; i++) {
        // JavaScript Date handles month overflow correctly (e.g. month 13 = next January)
        const dueDate = new Date(now.getFullYear(), now.getMonth() + i, dueDay);
        // Last installment adjusts for Math.ceil rounding to avoid overcharging
        const isLast = i === dto.totalMonths;
        const amount = isLast ? financedAmount - monthlyPayment * (dto.totalMonths - 1) : monthlyPayment;

        payments.push({
          contractId: newContract.id,
          installmentNo: i,
          dueDate,
          amountDue: amount,
          status: 'PENDING' as const,
        });
      }
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
    }, { isolationLevel: 'Serializable' });

    return this.findOne(contract.id);
  }

  // === UPDATE: แก้ไขรายละเอียดสัญญา (เฉพาะ CREATING/REJECTED) ===
  async update(id: string, dto: UpdateContractDto, userId: string) {
    const contract = await this.findOne(id);

    // Only allow editing when CREATING or REJECTED
    if (contract.workflowStatus !== 'CREATING' && contract.workflowStatus !== 'REJECTED') {
      throw new BadRequestException('แก้ไขได้เฉพาะสัญญาที่อยู่ในสถานะ กำลังสร้าง หรือ ถูกปฏิเสธ เท่านั้น');
    }

    // Only the creator can edit
    if (contract.salespersonId !== userId) {
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

    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: ['interest_rate', 'min_down_payment_pct', 'min_installment_months', 'max_installment_months'] } },
    });
    const getConfig = (key: string, def: number) => parseFloat(configs.find((c) => c.key === key)?.value || String(def));

    const interestRate = dto.interestRate ?? Number(contract.interestRate);
    const minDownPct = interestConfig ? Number(interestConfig.minDownPaymentPct) : getConfig('min_down_payment_pct', 0.15);
    const minMonths = interestConfig ? interestConfig.minInstallmentMonths : getConfig('min_installment_months', 6);
    const maxMonths = interestConfig ? interestConfig.maxInstallmentMonths : getConfig('max_installment_months', 12);

    // Validations
    if (downPayment >= sellingPrice) {
      throw new BadRequestException('เงินดาวน์ต้องน้อยกว่าราคาขาย');
    }
    if (downPayment < sellingPrice * minDownPct) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(minDownPct * 100).toFixed(0)}% (${(sellingPrice * minDownPct).toLocaleString()} บาท)`);
    }
    if (totalMonths < minMonths || totalMonths > maxMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${minMonths}-${maxMonths} เดือน`);
    }
    if (paymentDueDay !== undefined && paymentDueDay !== null && (paymentDueDay < 1 || paymentDueDay > 28)) {
      throw new BadRequestException('วันที่ครบกำหนดชำระต้องอยู่ระหว่าง 1-28');
    }

    // Recalculate financials
    const principal = sellingPrice - downPayment;
    const interestTotal = principal * interestRate * totalMonths;
    const financedAmount = principal + interestTotal;
    const monthlyPayment = Math.ceil(financedAmount / totalMonths);

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

      // Delete existing unpaid payments and recreate
      await tx.payment.deleteMany({
        where: { contractId: id, status: 'PENDING' },
      });

      const now = new Date();
      const dueDay = paymentDueDay || 1;
      const payments: Array<{
        contractId: string;
        installmentNo: number;
        dueDate: Date;
        amountDue: number;
        status: 'PENDING';
      }> = [];

      for (let i = 1; i <= totalMonths; i++) {
        const dueDate = new Date(now.getFullYear(), now.getMonth() + i, dueDay);
        const isLast = i === totalMonths;
        const amount = isLast ? financedAmount - monthlyPayment * (totalMonths - 1) : monthlyPayment;
        payments.push({
          contractId: id,
          installmentNo: i,
          dueDate,
          amountDue: amount,
          status: 'PENDING' as const,
        });
      }
      await tx.payment.createMany({ data: payments });
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
  async approveContract(id: string, userId: string, reviewNotes?: string) {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'PENDING_REVIEW') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ รอตรวจสอบ');
    }

    // Prevent self-approval: salesperson cannot approve their own contract
    if (contract.salespersonId === userId) {
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
  async rejectContract(id: string, userId: string, reviewNotes: string) {
    const contract = await this.findOne(id);

    if (contract.workflowStatus !== 'PENDING_REVIEW') {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ รอตรวจสอบ');
    }

    if (contract.salespersonId === userId) {
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
    const customerSigned = contract.signatures?.some((s: any) => s.signerType === 'CUSTOMER');
    const staffSigned = contract.signatures?.some((s: any) => s.signerType === 'STAFF');
    if (!customerSigned || !staffSigned) {
      throw new BadRequestException('ต้องลงนามครบทั้งลูกค้าและพนักงานก่อนเปิดใช้งานสัญญา');
    }

    await this.prisma.$transaction([
      this.prisma.contract.update({ where: { id }, data: { status: 'ACTIVE' } }),
      this.prisma.product.update({ where: { id: contract.productId }, data: { status: 'SOLD_INSTALLMENT' } }),
    ]);

    return this.findOne(id);
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
    if (!['ACTIVE', 'OVERDUE'].includes(contract.status)) {
      throw new BadRequestException('สัญญาต้องอยู่ในสถานะ ACTIVE หรือ OVERDUE');
    }

    const paidPayments = contract.payments.filter((p) => p.status === 'PAID');
    const remainingMonths = contract.totalMonths - paidPayments.length;
    const monthlyInterest = Number(contract.interestTotal) / contract.totalMonths;
    const monthlyPrincipal = (Number(contract.sellingPrice) - Number(contract.downPayment)) / contract.totalMonths;

    const remainingPrincipal = monthlyPrincipal * remainingMonths;
    const remainingInterest = monthlyInterest * remainingMonths;
    const discount = remainingInterest * 0.5;
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
            paymentMethod: paymentMethod as any,
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
