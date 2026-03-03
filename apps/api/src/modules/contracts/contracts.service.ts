import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContractDto } from './dto/contract.dto';

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

    // Create contract + payment schedule in transaction
    const contract = await this.prisma.$transaction(async (tx) => {
      // Generate contract number inside transaction
      const lastContract = await tx.contract.findFirst({
        orderBy: { contractNumber: 'desc' },
        select: { contractNumber: true },
      });
      const nextNum = lastContract
        ? parseInt(lastContract.contractNumber.replace(/\D/g, '')) + 1
        : 1;
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
        // Calculate due date: use paymentDueDay if specified, otherwise 1st of each month
        const dueMonth = now.getMonth() + i;
        const dueYear = now.getFullYear() + Math.floor(dueMonth / 12);
        const adjustedMonth = dueMonth % 12;
        const dueDate = new Date(dueYear, adjustedMonth, dueDay);

        payments.push({
          contractId: newContract.id,
          installmentNo: i,
          dueDate,
          amountDue: monthlyPayment,
          status: 'PENDING' as const,
        });
      }
      await tx.payment.createMany({ data: payments });

      // Reserve product
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'RESERVED' },
      });

      return newContract;
    });

    return this.findOne(contract.id);
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
