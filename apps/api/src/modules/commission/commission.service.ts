import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCommissionRuleDto, UpdateCommissionRuleDto } from './dto/commission.dto';

@Injectable()
export class CommissionService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a sales commission record for a sale
   */
  async createCommissionForSale(
    saleId: string,
    salespersonId: string,
    saleAmount: number,
    commissionRate: number,
    contractId?: string,
  ) {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const commissionAmount = Math.round(saleAmount * commissionRate * 100) / 100;

    return this.prisma.salesCommission.create({
      data: {
        salespersonId,
        contractId: contractId || null,
        saleId,
        period,
        saleAmount,
        commissionRate,
        commissionAmount,
        status: 'PENDING',
      },
    });
  }

  /**
   * List commissions with filters, pagination, and includes
   */
  async findAll(filters: {
    salespersonId?: string;
    period?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.salespersonId) where.salespersonId = filters.salespersonId;
    if (filters.period) where.period = filters.period;
    if (filters.status) where.status = filters.status;

    const [data, total] = await Promise.all([
      this.prisma.salesCommission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          salesperson: { select: { id: true, name: true } },
          contract: { select: { id: true, contractNumber: true } },
          sale: { select: { id: true, saleNumber: true } },
          approvedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.salesCommission.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Monthly summary grouped by salesperson
   */
  async getSummary(period?: string, salespersonId?: string) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (period) where.period = period;
    if (salespersonId) where.salespersonId = salespersonId;

    const commissions = await this.prisma.salesCommission.findMany({
      where,
      include: {
        salesperson: { select: { id: true, name: true } },
      },
    });

    // Group by salesperson
    const grouped = new Map<
      string,
      {
        salesperson: { id: string; name: string };
        totalSales: number;
        totalCommission: number;
        count: number;
        approved: number;
        pending: number;
      }
    >();

    for (const c of commissions) {
      const key = c.salespersonId;
      if (!grouped.has(key)) {
        grouped.set(key, {
          salesperson: c.salesperson,
          totalSales: 0,
          totalCommission: 0,
          count: 0,
          approved: 0,
          pending: 0,
        });
      }
      const entry = grouped.get(key)!;
      entry.totalSales += Number(c.saleAmount);
      entry.totalCommission += Number(c.commissionAmount);
      entry.count += 1;
      if (c.status === 'APPROVED' || c.status === 'PAID') entry.approved += 1;
      if (c.status === 'PENDING') entry.pending += 1;
    }

    return Array.from(grouped.values());
  }

  /**
   * Approve a pending commission
   */
  async approve(id: string, userId: string) {
    const commission = await this.prisma.salesCommission.findFirst({
      where: { id, deletedAt: null },
    });
    if (!commission) throw new NotFoundException('ไม่พบข้อมูลค่าคอมมิชชัน');
    if (commission.status !== 'PENDING') {
      throw new BadRequestException('สามารถอนุมัติได้เฉพาะรายการที่รอดำเนินการเท่านั้น');
    }

    return this.prisma.salesCommission.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
  }

  /**
   * Mark an approved commission as paid
   */
  async markPaid(id: string) {
    const commission = await this.prisma.salesCommission.findFirst({
      where: { id, deletedAt: null },
    });
    if (!commission) throw new NotFoundException('ไม่พบข้อมูลค่าคอมมิชชัน');
    if (commission.status !== 'APPROVED') {
      throw new BadRequestException('สามารถจ่ายได้เฉพาะรายการที่อนุมัติแล้วเท่านั้น');
    }

    return this.prisma.salesCommission.update({
      where: { id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paidAmount: commission.commissionAmount,
      },
    });
  }

  /**
   * List active commission rules
   */
  async findAllRules() {
    return this.prisma.commissionRule.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Create a commission rule
   */
  async createRule(dto: CreateCommissionRuleDto) {
    return this.prisma.commissionRule.create({
      data: {
        name: dto.name,
        description: dto.description,
        ruleType: dto.ruleType,
        rate: dto.rate,
        fixedAmount: dto.fixedAmount,
        minSaleAmount: dto.minSaleAmount,
        maxSaleAmount: dto.maxSaleAmount,
      },
    });
  }

  /**
   * Update a commission rule
   */
  async updateRule(id: string, dto: UpdateCommissionRuleDto) {
    const rule = await this.prisma.commissionRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('ไม่พบกฎค่าคอมมิชชัน');

    return this.prisma.commissionRule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.ruleType !== undefined && { ruleType: dto.ruleType }),
        ...(dto.rate !== undefined && { rate: dto.rate }),
        ...(dto.fixedAmount !== undefined && { fixedAmount: dto.fixedAmount }),
        ...(dto.minSaleAmount !== undefined && { minSaleAmount: dto.minSaleAmount }),
        ...(dto.maxSaleAmount !== undefined && { maxSaleAmount: dto.maxSaleAmount }),
      },
    });
  }
}
