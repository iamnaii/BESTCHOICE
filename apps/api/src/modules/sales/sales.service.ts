import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSaleDto } from './dto/sale.dto';
import { calculateInstallment, generatePaymentSchedule } from '../../utils/installment.util';
import { loadInstallmentConfig, resolveInstallmentParams } from '../../utils/config.util';
import { generateContractNumber, generateSaleNumber } from '../../utils/sequence.util';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: {
    saleType?: string;
    branchId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    paymentMethod?: string;
    salespersonId?: string;
    contractStatus?: string;
    page?: number;
    limit?: number;
    userRole?: string;
  }) {
    const { saleType, branchId, search, startDate, endDate, paymentMethod, salespersonId, contractStatus, page = 1, limit = 50, userRole } = filters;
    const where: Record<string, unknown> = {};

    if (saleType) where.saleType = saleType;
    if (branchId) where.branchId = branchId;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (salespersonId) where.salespersonId = salespersonId;
    if (contractStatus) where.contract = { status: contractStatus };

    // Date range filter
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { financeCompany: { contains: search, mode: 'insensitive' } },
        { financeRefNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total, agg, groupBySaleType] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, brand: true, model: true, imeiSerial: true, serialNumber: true, costPrice: true } },
          branch: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
          contract: { select: { id: true, contractNumber: true, status: true, monthlyPayment: true, totalMonths: true } },
        },
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({
        where,
        _sum: { netAmount: true, discount: true },
      }),
      this.prisma.sale.groupBy({
        by: ['saleType'],
        where,
        _count: true,
        _sum: { netAmount: true },
      }),
    ]);

    // Build summary from aggregate + groupBy
    const getGroup = (type: string) => groupBySaleType.find(g => g.saleType === type);
    let totalProfit = 0;

    if (userRole === 'OWNER' && total > 0) {
      // Use Prisma to resolve complex filters into IDs, then single raw SQL for cross-table profit
      const matchingIds = await this.prisma.sale.findMany({
        where,
        select: { id: true },
      });
      if (matchingIds.length > 0) {
        const ids = matchingIds.map(s => s.id);
        const profitResult = await this.prisma.$queryRaw<[{ total_profit: string }]>(
          Prisma.sql`
            SELECT COALESCE(SUM(s.net_amount - COALESCE(p.cost_price, 0)), 0)::text as total_profit
            FROM sales s
            LEFT JOIN products p ON s.product_id = p.id
            WHERE s.id IN (${Prisma.join(ids)})
          `,
        );
        totalProfit = new Prisma.Decimal(profitResult[0].total_profit).toNumber();
      }
    }

    const decSum = (val: Prisma.Decimal | null) => new Prisma.Decimal(val || 0).toNumber();
    const summary = {
      totalAmount: decSum(agg._sum.netAmount),
      totalDiscount: decSum(agg._sum.discount),
      totalProfit,
      cashCount: getGroup('CASH')?._count || 0,
      cashAmount: decSum(getGroup('CASH')?._sum.netAmount ?? null),
      installmentCount: getGroup('INSTALLMENT')?._count || 0,
      installmentAmount: decSum(getGroup('INSTALLMENT')?._sum.netAmount ?? null),
      financeCount: getGroup('EXTERNAL_FINANCE')?._count || 0,
      financeAmount: decSum(getGroup('EXTERNAL_FINANCE')?._sum.netAmount ?? null),
    };

    // Strip costPrice from response for non-OWNER roles
    const responseData = userRole === 'OWNER'
      ? data
      : data.map(s => {
          const { costPrice: _, ...productWithoutCost } = s.product;
          return { ...s, product: productWithoutCost };
        });

    return { data: responseData, total, page, limit, totalPages: Math.ceil(total / limit), summary };
  }

  async getSalespersons(user: { role: string; branchId?: string }) {
    const where: Record<string, unknown> = { isActive: true, deletedAt: null };
    if (user.role === 'BRANCH_MANAGER' && user.branchId) {
      where.branchId = user.branchId;
    }
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
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
    if (!sale) throw new NotFoundException('ไม่พบใบขาย');
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

  /** Mark bundle (freebie) products as SOLD_CASH */
  private async markBundleProductsSold(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    bundleProductIds: string[],
  ) {
    if (!bundleProductIds.length) return;
    // Verify all bundle products are IN_STOCK
    const products = await tx.product.findMany({
      where: { id: { in: bundleProductIds } },
      select: { id: true, status: true, name: true },
    });
    for (const p of products) {
      if (p.status !== 'IN_STOCK') {
        throw new BadRequestException(`ของแถม "${p.name}" ไม่พร้อมขาย`);
      }
    }
    if (products.length !== bundleProductIds.length) {
      throw new BadRequestException('ไม่พบสินค้าของแถมบางรายการ');
    }
    // Update all bundle products to SOLD_CASH
    await tx.product.updateMany({
      where: { id: { in: bundleProductIds } },
      data: { status: 'SOLD_CASH' },
    });
  }

  private async createCashSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
    if (!dto.paymentMethod) throw new BadRequestException('กรุณาเลือกวิธีชำระเงิน');

    return this.prisma.$transaction(async (tx) => {
      await this.verifyProductInStock(tx, dto.productId);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || []);
      const saleNumber = await generateSaleNumber(tx);

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
          paymentMethod: dto.paymentMethod as PaymentMethod,
          amountReceived: dto.amountReceived || netAmount,
          bundleProductIds: dto.bundleProductIds || [],
          notes: dto.notes,
        },
      });

      // Update product status to SOLD_CASH
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_CASH' },
      });

      return sale;
    }, { isolationLevel: 'Serializable' });
  }

  private async createInstallmentSale(dto: CreateSaleDto, salespersonId: string, netAmount: number, discount: number) {
    // Default planType to STORE_DIRECT (single plan type)
    if (!dto.planType) dto.planType = 'STORE_DIRECT';
    if (!dto.downPayment && dto.downPayment !== 0) throw new BadRequestException('กรุณาใส่เงินดาวน์');
    if (!dto.totalMonths) throw new BadRequestException('กรุณาเลือกจำนวนงวด');

    // Look up product to find matching InterestConfig
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    const interestConfig = product
      ? await this.prisma.interestConfig.findFirst({
          where: { isActive: true, productCategories: { has: product.category } },
        })
      : null;

    const systemConfig = await loadInstallmentConfig(this.prisma);
    const params = resolveInstallmentParams(interestConfig, systemConfig, dto.interestRate);

    if (dto.downPayment < netAmount * params.minDownPaymentPct) {
      throw new BadRequestException(`เงินดาวน์ขั้นต่ำ ${(params.minDownPaymentPct * 100).toFixed(0)}%`);
    }
    if (dto.totalMonths < params.minInstallmentMonths || dto.totalMonths > params.maxInstallmentMonths) {
      throw new BadRequestException(`จำนวนงวดต้องอยู่ระหว่าง ${params.minInstallmentMonths}-${params.maxInstallmentMonths} เดือน`);
    }

    const calc = calculateInstallment(netAmount, dto.downPayment, params.interestRate, dto.totalMonths, params.storeCommissionPct, params.vatPct);

    return this.prisma.$transaction(async (tx) => {
      await this.verifyProductInStock(tx, dto.productId);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || []);
      const saleNumber = await generateSaleNumber(tx);

      // Use provided contract number or auto-generate
      let contractNumber = dto.contractNumber;
      if (!contractNumber) {
        contractNumber = await generateContractNumber(tx);
      }

      // Create contract
      const contract = await tx.contract.create({
        data: {
          contractNumber,
          customerId: dto.customerId,
          productId: dto.productId,
          branchId: dto.branchId,
          salespersonId,
          planType: dto.planType as PlanType,
          sellingPrice: netAmount,
          downPayment: dto.downPayment!,
          interestRate: params.interestRate,
          totalMonths: dto.totalMonths!,
          interestTotal: calc.interestTotal,
          financedAmount: calc.financedAmount,
          monthlyPayment: calc.monthlyPayment,
          status: 'DRAFT',
          workflowStatus: 'CREATING',
          paymentDueDay: dto.paymentDueDay,
          interestConfigId: interestConfig?.id,
          notes: dto.notes,
        },
      });

      // Create payment schedule
      const payments = generatePaymentSchedule(
        contract.id, dto.totalMonths!, calc.financedAmount, calc.monthlyPayment, dto.paymentDueDay,
      );
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
          paymentMethod: dto.paymentMethod as PaymentMethod,
          amountReceived: dto.downPayment,
          downPaymentAmount: dto.downPayment,
          contractId: contract.id,
          bundleProductIds: dto.bundleProductIds || [],
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

    const downPayment = dto.downPayment || 0;
    const financeAmount = dto.financeAmount || (netAmount - downPayment);

    return this.prisma.$transaction(async (tx) => {
      await this.verifyProductInStock(tx, dto.productId);
      await this.markBundleProductsSold(tx, dto.bundleProductIds || []);
      const saleNumber = await generateSaleNumber(tx);

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
          paymentMethod: dto.paymentMethod as PaymentMethod,
          amountReceived: downPayment > 0 ? downPayment : financeAmount,
          downPaymentAmount: downPayment,
          financeCompany: dto.financeCompany,
          financeRefNumber: dto.contractNumber || dto.financeRefNumber,
          financeAmount,
          bundleProductIds: dto.bundleProductIds || [],
          notes: dto.notes,
        },
      });

      // Update product status
      await tx.product.update({
        where: { id: dto.productId },
        data: { status: 'SOLD_INSTALLMENT' },
      });

      return sale;
    }, { isolationLevel: 'Serializable' });
  }

  async getPosConfig() {
    return loadInstallmentConfig(this.prisma);
  }

  async getTopSellingProducts(limit = 6) {
    const results = await this.prisma.sale.groupBy({
      by: ['productId'],
      _count: { productId: true },
      orderBy: { _count: { productId: 'desc' } },
      take: limit,
    });

    if (results.length === 0) return [];

    const products = await this.prisma.product.findMany({
      where: { id: { in: results.map(r => r.productId) } },
      select: { id: true, name: true, brand: true, model: true },
    });

    const productMap = new Map(products.map(p => [p.id, p]));
    return results
      .map(r => {
        const p = productMap.get(r.productId);
        return p ? { ...p, count: r._count.productId } : null;
      })
      .filter(Boolean);
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
      totalRevenue: sales.reduce((sum, s) => sum.add(new Prisma.Decimal(s.netAmount)), new Prisma.Decimal(0)).toNumber(),
      sales,
    };

    return summary;
  }
}
