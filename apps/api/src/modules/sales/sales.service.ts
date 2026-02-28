import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSaleDto } from './dto/sale.dto';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: { saleType?: string; branchId?: string; search?: string; page?: number; limit?: number }) {
    const { saleType, branchId, search, page = 1, limit = 50 } = filters;
    const where: Record<string, unknown> = {};

    if (saleType) where.saleType = saleType;
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true } },
          branch: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true, nationalId: true } },
        product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, costPrice: true } },
        branch: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        contract: true,
      },
    });
    if (!sale) throw new BadRequestException('ไม่พบใบขาย');
    return sale;
  }

  async create(dto: CreateSaleDto, salespersonId: string) {
    const discount = dto.discount || 0;
    const netAmount = dto.sellingPrice - discount;

    switch (dto.saleType) {
      case 'CASH':
        return this.createCashSale(dto, salespersonId, netAmount, discount);
      case 'INSTALLMENT':
        return this.createInstallmentSale(dto, salespersonId, netAmount, discount);
      case 'EXTERNAL_FINANCE':
        return this.createExternalFinanceSale(dto, salespersonId, netAmount, discount);
      default:
        throw new BadRequestException('ประเภทการขายไม่ถูกต้อง');
    }
  }

  /** Check product availability inside transaction to prevent race conditions */
  private async verifyProductInStock(tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0], productId: string) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.status !== 'IN_STOCK') {
      throw new BadRequestException('สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว');
    }
    return product;
  }

  private async createCashSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
    if (!dto.paymentMethod) throw new BadRequestException('กรุณาเลือกวิธีชำระเงิน');

    return this.prisma.$transaction(async (tx) => {
      await this.verifyProductInStock(tx, dto.productId);
      const saleNumber = await this.generateSaleNumber(tx);

      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'CASH',
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          sellingPrice: dto.sellingPrice,
          discount,
          netAmount,
          paymentMethod: dto.paymentMethod as any,
          amountReceived: dto.amountReceived || netAmount,
          notes: dto.notes,
        },
      });

      // Update product status to SOLD_CASH
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_CASH' },
      });

      return sale;
    });
  }

  private async createInstallmentSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
    if (!dto.planType) throw new BadRequestException('กรุณาเลือกแผนผ่อนชำระ');
    if (!dto.downPayment && dto.downPayment !== 0) throw new BadRequestException('กรุณาใส่เงินดาวน์');
    if (!dto.totalMonths) throw new BadRequestException('กรุณาเลือกจำนวนงวด');

    // Get system configs
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: ['interest_rate', 'min_down_payment_pct', 'min_installment_months', 'max_installment_months'] } },
    });
    const getConfig = (key: string, def: number) => parseFloat(configs.find((c) => c.key === key)?.value || String(def));

    const interestRate = dto.interestRate ?? getConfig('interest_rate', 0.08);
    const minDownPct = getConfig('min_down_payment_pct', 0.15);
    const minMonths = getConfig('min_installment_months', 6);
    const maxMonths = getConfig('max_installment_months', 12);

    if (dto.downPayment < netAmount * minDownPct) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(minDownPct * 100).toFixed(0)}%`);
    }
    if (dto.totalMonths < minMonths || dto.totalMonths > maxMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${minMonths}-${maxMonths} เดือน`);
    }

    // Calculate installment
    const principal = netAmount - dto.downPayment;
    const interestTotal = principal * interestRate * dto.totalMonths;
    const financedAmount = principal + interestTotal;
    const monthlyPayment = Math.ceil(financedAmount / dto.totalMonths);

    return this.prisma.$transaction(async (tx) => {
      await this.verifyProductInStock(tx, dto.productId);
      const saleNumber = await this.generateSaleNumber(tx);

      // Generate contract number
      const lastContract = await tx.contract.findFirst({
        orderBy: { contractNumber: 'desc' },
        select: { contractNumber: true },
      });
      const nextNum = lastContract ? parseInt(lastContract.contractNumber.replace(/\D/g, '')) + 1 : 1;
      const contractNumber = `CT${String(nextNum).padStart(6, '0')}`;

      // Create contract
      const contract = await tx.contract.create({
        data: {
          contractNumber,
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          planType: dto.planType as any,
          sellingPrice: netAmount,
          downPayment: dto.downPayment!,
          interestRate,
          totalMonths: dto.totalMonths!,
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
      for (let i = 1; i <= dto.totalMonths!; i++) {
        payments.push({
          contractId: contract.id,
          installmentNo: i,
          dueDate: new Date(now.getFullYear(), now.getMonth() + i, 1),
          amountDue: monthlyPayment,
          status: 'PENDING' as const,
        });
      }
      await tx.payment.createMany({ data: payments });

      // Create sale record linked to contract
      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'INSTALLMENT',
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          sellingPrice: dto.sellingPrice,
          discount,
          netAmount,
          paymentMethod: dto.paymentMethod as any,
          amountReceived: dto.downPayment,
          contractId: contract.id,
          notes: dto.notes,
        },
      });

      // Reserve product
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'RESERVED' },
      });

      return sale;
    });
  }

  private async createExternalFinanceSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
    if (!dto.financeCompany) throw new BadRequestException('กรุณาใส่ชื่อบริษัทไฟแนนซ์');

    return this.prisma.$transaction(async (tx) => {
      await this.verifyProductInStock(tx, dto.productId);
      const saleNumber = await this.generateSaleNumber(tx);

      const sale = await tx.sale.create({
        data: {
          saleNumber,
          saleType: 'EXTERNAL_FINANCE',
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          sellingPrice: dto.sellingPrice,
          discount,
          netAmount,
          paymentMethod: dto.paymentMethod as any,
          amountReceived: dto.financeAmount || netAmount,
          financeCompany: dto.financeCompany,
          financeRefNumber: dto.financeRefNumber,
          financeAmount: dto.financeAmount,
          notes: dto.notes,
        },
      });

      // Update product status
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_INSTALLMENT' },
      });

      return sale;
    });
  }

  private async generateSaleNumber(tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0]) {
    const lastSale = await tx.sale.findFirst({
      orderBy: { saleNumber: 'desc' },
      select: { saleNumber: true },
    });
    const nextNum = lastSale ? parseInt(lastSale.saleNumber.replace(/\D/g, '')) + 1 : 1;
    return `SO${String(nextNum).padStart(6, '0')}`;
  }

  async getDailySummary(date: string, branchId?: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const where: Record<string, unknown> = {
      createdAt: { gte: startOfDay, lte: endOfDay },
    };
    if (branchId) where.branchId = branchId;

    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        customer: { select: { name: true } },
        product: { select: { name: true, brand: true, model: true } },
        salesperson: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const summary = {
      totalSales: sales.length,
      cashSales: sales.filter(s => s.saleType === 'CASH').length,
      installmentSales: sales.filter(s => s.saleType === 'INSTALLMENT').length,
      externalFinanceSales: sales.filter(s => s.saleType === 'EXTERNAL_FINANCE').length,
      totalRevenue: sales.reduce((sum, s) => sum + Number(s.netAmount), 0),
      sales,
    };

    return summary;
  }
}
