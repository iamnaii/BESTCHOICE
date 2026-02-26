import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContractDto } from './dto/contract.dto';

@Injectable()
export class ContractsService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: { status?: string; branchId?: string; customerId?: string; search?: string }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.search) {
      where.OR = [
        { contractNumber: { contains: filters.search, mode: 'insensitive' } },
        { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        product: { select: { id: true, name: true, brand: true, model: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        _count: { select: { payments: true } },
      },
    });
  }

  async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        customer: true,
        product: { include: { prices: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        payments: { orderBy: { installmentNo: 'asc' } },
        signatures: true,
        eDocuments: true,
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    return contract;
  }

  async create(dto: CreateContractDto, salespersonId: string) {
    // Get system configs
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: ['interest_rate', 'min_down_payment_pct', 'min_installment_months', 'max_installment_months'] } },
    });
    const getConfig = (key: string, def: number) => parseFloat(configs.find((c) => c.key === key)?.value || String(def));

    const interestRate = dto.interestRate ?? getConfig('interest_rate', 0.08);
    const minDownPct = getConfig('min_down_payment_pct', 0.15);
    const minMonths = getConfig('min_installment_months', 6);
    const maxMonths = getConfig('max_installment_months', 12);

    // Validations
    if (dto.downPayment < dto.sellingPrice * minDownPct) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(minDownPct * 100).toFixed(0)}% (${(dto.sellingPrice * minDownPct).toLocaleString()} บาท)`);
    }
    if (dto.totalMonths < minMonths || dto.totalMonths > maxMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${minMonths}-${maxMonths} เดือน`);
    }

    // Verify product is available
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.status !== 'IN_STOCK') {
      throw new BadRequestException('สินค้าไม่พร้อมขาย');
    }

    // Calculate installment (SPEC Section 3.3)
    const interestTotal = dto.sellingPrice * interestRate * dto.totalMonths;
    const financedAmount = (dto.sellingPrice - dto.downPayment) + interestTotal;
    const monthlyPayment = Math.ceil(financedAmount / dto.totalMonths);

    // Generate contract number
    const count = await this.prisma.contract.count();
    const contractNumber = `CT${String(count + 1).padStart(6, '0')}`;

    // Create contract + payment schedule in transaction
    const contract = await this.prisma.$transaction(async (tx) => {
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
          notes: dto.notes,
        },
      });

      // Create payment schedule
      const now = new Date();
      const payments: Array<{
        contractId: string;
        installmentNo: number;
        dueDate: Date;
        amountDue: number;
        status: 'PENDING';
      }> = [];
      for (let i = 1; i <= dto.totalMonths; i++) {
        const dueDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
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

  async activate(id: string) {
    const contract = await this.findOne(id);
    if (contract.status !== 'DRAFT') throw new BadRequestException('สัญญาต้องอยู่ในสถานะ DRAFT');

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
    const contract = await this.findOne(id);

    await this.prisma.$transaction(async (tx) => {
      // Mark all pending payments as paid
      await tx.payment.updateMany({
        where: { contractId: id, status: { not: 'PAID' } },
        data: { status: 'PAID', paidDate: new Date(), amountPaid: 0, paymentMethod: paymentMethod as any },
      });

      // Update contract status
      await tx.contract.update({
        where: { id },
        data: { status: 'EARLY_PAYOFF' },
      });
    });

    return { ...quote, status: 'EARLY_PAYOFF' };
  }
}
