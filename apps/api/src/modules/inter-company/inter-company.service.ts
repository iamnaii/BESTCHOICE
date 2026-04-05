import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInterCompanyTransactionDto } from './dto/inter-company.dto';
import { Prisma, InterCompanyTransactionStatus } from '@prisma/client';

@Injectable()
export class InterCompanyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create inter-company transaction from sale data.
   * Called automatically when an installment sale is created.
   */
  async createFromSale(dto: CreateInterCompanyTransactionDto) {
    return this.prisma.interCompanyTransaction.create({
      data: {
        saleId: dto.saleId,
        contractId: dto.contractId,
        branchId: dto.branchId,
        type: 'FINANCE_PURCHASE',
        fromEntity: dto.fromEntity,
        toEntity: dto.toEntity,
        principal: dto.principal,
        commission: dto.commission,
        commissionPct: dto.commissionPct,
        vatAmount: dto.vatAmount,
        vatPct: dto.vatPct,
        totalAmount: dto.totalAmount,
        interestTotal: dto.interestTotal,
        costPrice: dto.costPrice,
        downPayment: dto.downPayment,
        sellingPrice: dto.sellingPrice,
        shopProfit: dto.shopProfit,
        financeProfit: dto.financeProfit,
        note: dto.note,
      },
    });
  }

  /**
   * Create inter-company transaction within an existing Prisma transaction.
   */
  async createFromSaleInTx(
    tx: Prisma.TransactionClient,
    data: {
      saleId: string;
      contractId?: string;
      branchId: string;
      principal: number;
      commission: number;
      commissionPct: number;
      vatAmount: number;
      vatPct: number;
      totalAmount: number;
      interestTotal: number;
      costPrice: number;
      downPayment: number;
      sellingPrice: number;
      shopProfit: number;
      financeProfit: number;
    },
  ) {
    return tx.interCompanyTransaction.create({
      data: {
        saleId: data.saleId,
        contractId: data.contractId,
        branchId: data.branchId,
        type: 'FINANCE_PURCHASE',
        fromEntity: 'BESTCHOICE FINANCE',
        toEntity: 'BESTCHOICE SHOP',
        principal: data.principal,
        commission: data.commission,
        commissionPct: data.commissionPct,
        vatAmount: data.vatAmount,
        vatPct: data.vatPct,
        totalAmount: data.totalAmount,
        interestTotal: data.interestTotal,
        costPrice: data.costPrice,
        downPayment: data.downPayment,
        sellingPrice: data.sellingPrice,
        shopProfit: data.shopProfit,
        financeProfit: data.financeProfit,
      },
    });
  }

  async findAll(params: {
    branchId?: string;
    status?: string;
    type?: string;
    entity?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const where: Record<string, unknown> = { deletedAt: null };

    if (params.branchId) where.branchId = params.branchId;
    if (params.status) where.status = params.status;
    if (params.type) where.type = params.type;
    if (params.entity) {
      where.OR = [
        { fromEntity: params.entity },
        { toEntity: params.entity },
      ];
    }
    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(params.startDate);
      if (params.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(params.endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.interCompanyTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sale: {
            select: { saleNumber: true, saleType: true, customer: { select: { name: true } } },
          },
          contract: { select: { contractNumber: true, status: true } },
          branch: { select: { name: true } },
        },
      }),
      this.prisma.interCompanyTransaction.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const record = await this.prisma.interCompanyTransaction.findFirst({
      where: { id, deletedAt: null },
      include: {
        sale: {
          select: {
            saleNumber: true,
            saleType: true,
            customer: { select: { name: true, phone: true } },
            product: { select: { name: true, imeiSerial: true } },
          },
        },
        contract: { select: { contractNumber: true, status: true, totalMonths: true, monthlyPayment: true } },
        branch: { select: { name: true } },
      },
    });
    if (!record) throw new NotFoundException('ไม่พบรายการ Inter-Company Transaction');
    return record;
  }

  /**
   * Reconcile a transaction (mark as confirmed after verification)
   */
  async reconcile(id: string) {
    const record = await this.prisma.interCompanyTransaction.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('ไม่พบรายการ');

    return this.prisma.interCompanyTransaction.update({
      where: { id },
      data: {
        status: 'RECONCILED' as InterCompanyTransactionStatus,
        reconciledAt: new Date(),
      },
    });
  }

  /**
   * Get profit summary grouped by entity (SHOP vs FINANCE)
   */
  async getProfitSummary(params: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (params.branchId) where.branchId = params.branchId;
    if (params.startDate || params.endDate) {
      where.createdAt = {};
      if (params.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(params.startDate);
      if (params.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(params.endDate);
    }

    const transactions = await this.prisma.interCompanyTransaction.findMany({
      where,
      select: {
        principal: true,
        commission: true,
        vatAmount: true,
        totalAmount: true,
        interestTotal: true,
        costPrice: true,
        downPayment: true,
        sellingPrice: true,
        shopProfit: true,
        financeProfit: true,
      },
    });

    const summary = {
      transactionCount: transactions.length,
      shop: {
        totalRevenue: 0,
        totalCost: 0,
        totalCommission: 0,
        totalProfit: 0,
      },
      finance: {
        totalInterest: 0,
        totalCommissionPaid: 0,
        totalProfit: 0,
      },
      combined: {
        totalVat: 0,
        totalProfit: 0,
      },
    };

    for (const t of transactions) {
      const shopProfit = Number(t.shopProfit);
      const financeProfit = Number(t.financeProfit);
      const commission = Number(t.commission);
      const interestTotal = Number(t.interestTotal);
      const costPrice = Number(t.costPrice);
      const vatAmount = Number(t.vatAmount);
      const downPayment = Number(t.downPayment);
      const principal = Number(t.principal);

      // Shop: downPayment + principal + commission - costPrice
      summary.shop.totalRevenue += downPayment + principal + commission;
      summary.shop.totalCost += costPrice;
      summary.shop.totalCommission += commission;
      summary.shop.totalProfit += shopProfit;

      // Finance: interestTotal - commission
      summary.finance.totalInterest += interestTotal;
      summary.finance.totalCommissionPaid += commission;
      summary.finance.totalProfit += financeProfit;

      summary.combined.totalVat += vatAmount;
      summary.combined.totalProfit += shopProfit + financeProfit;
    }

    return summary;
  }

  async remove(id: string) {
    const record = await this.prisma.interCompanyTransaction.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) throw new NotFoundException('ไม่พบรายการ');

    return this.prisma.interCompanyTransaction.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
