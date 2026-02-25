import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';

@Injectable()
export class ContractsService {
  constructor(private prisma: PrismaService) {}

  private generateContractNumber(): string {
    const now = new Date();
    const y = now.getFullYear().toString().slice(-2);
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `BC${y}${m}-${rand}`;
  }

  async findAll(user: { role: string; branchId: string | null }, query: { status?: string; search?: string }) {
    const where: any = { deletedAt: null };

    if (user.role !== 'OWNER' && user.role !== 'ACCOUNTANT' && user.branchId) {
      where.branchId = user.branchId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.OR = [
        { contractNumber: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { phone: { contains: query.search } } },
      ];
    }

    return this.prisma.contract.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        product: { select: { id: true, name: true, brand: true, model: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        _count: { select: { payments: true } },
      },
      orderBy: { createdAt: 'desc' },
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
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    return contract;
  }

  async create(dto: CreateContractDto, salespersonId: string) {
    // Verify product exists and is available
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');
    if (product.status !== 'IN_STOCK' && product.status !== 'RESERVED') {
      throw new BadRequestException('สินค้าไม่พร้อมขาย');
    }

    // Verify customer exists
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

    // Calculate financials
    const financedAmount = dto.sellingPrice - dto.downPayment;
    const interestTotal = financedAmount * dto.interestRate * dto.totalMonths;
    const totalWithInterest = financedAmount + interestTotal;
    const monthlyPayment = Math.ceil(totalWithInterest / dto.totalMonths);

    // Create contract + payment schedule in transaction
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          contractNumber: this.generateContractNumber(),
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          planType: dto.planType as any,
          sellingPrice: dto.sellingPrice,
          downPayment: dto.downPayment,
          interestRate: dto.interestRate,
          totalMonths: dto.totalMonths,
          interestTotal,
          financedAmount,
          monthlyPayment,
          status: 'ACTIVE',
          notes: dto.notes,
        },
      });

      // Generate payment schedule
      const payments: { contractId: string; installmentNo: number; dueDate: Date; amountDue: number; status: 'PENDING' }[] = [];
      const startDate = new Date();
      for (let i = 1; i <= dto.totalMonths; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        payments.push({
          contractId: contract.id,
          installmentNo: i,
          dueDate,
          amountDue: monthlyPayment,
          status: 'PENDING',
        });
      }

      await tx.payment.createMany({ data: payments });

      // Update product status
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_INSTALLMENT' },
      });

      return tx.contract.findUnique({
        where: { id: contract.id },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, brand: true, model: true } },
          payments: { orderBy: { installmentNo: 'asc' } },
        },
      });
    });
  }

  async update(id: string, dto: UpdateContractDto) {
    await this.findOne(id);
    return this.prisma.contract.update({
      where: { id },
      data: dto as any,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        product: { select: { id: true, name: true, brand: true, model: true } },
      },
    });
  }
}
