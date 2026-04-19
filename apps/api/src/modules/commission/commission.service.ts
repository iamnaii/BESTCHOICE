import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCommissionRuleDto, UpdateCommissionRuleDto } from './dto/commission.dto';
import { GeneratePayoutDto, ApprovePayoutDto } from './dto/commission-payout.dto';

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

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
    // Use Prisma.Decimal to avoid float rounding bugs (e.g. 0.1 * 0.1 !== 0.01).
    // Result is a Decimal so the database stores exact baht/satang values.
    const commissionAmount = new Prisma.Decimal(saleAmount)
      .mul(commissionRate)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

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
      take: 10000, // safety cap — prevent unbounded memory usage
      orderBy: { createdAt: 'desc' },
    });

    // Group by salesperson — use Prisma.Decimal for accumulators so adding
    // many records doesn't lose baht-level precision (Number() + Number()
    // would silently drift on portfolios with thousands of commissions).
    const grouped = new Map<
      string,
      {
        salesperson: { id: string; name: string };
        totalSales: Prisma.Decimal;
        totalCommission: Prisma.Decimal;
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
          totalSales: new Prisma.Decimal(0),
          totalCommission: new Prisma.Decimal(0),
          count: 0,
          approved: 0,
          pending: 0,
        });
      }
      const entry = grouped.get(key)!;
      entry.totalSales = entry.totalSales.add(c.saleAmount);
      entry.totalCommission = entry.totalCommission.add(c.commissionAmount);
      entry.count += 1;
      if (c.status === 'APPROVED' || c.status === 'PAID') entry.approved += 1;
      if (c.status === 'PENDING') entry.pending += 1;
    }

    // Serialize Decimal to string for JSON response (frontend uses parseFloat)
    return Array.from(grouped.values()).map((entry) => ({
      ...entry,
      totalSales: entry.totalSales.toString(),
      totalCommission: entry.totalCommission.toString(),
    }));
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

    // Segregation of Duties — salesperson who earns the commission must not
    // self-approve. Mirrors the same guard in approvePayout() below.
    if (commission.salespersonId === userId) {
      throw new ForbiddenException(
        'ผู้อนุมัติต้องไม่ใช่ผู้รับคอมมิชชัน (Segregation of Duties)',
      );
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
   * Clawback policy: how much of a commission to reverse based on how many
   * months were paid on the contract before it defaulted. First-payment
   * default is worst (sale never took); the further the contract
   * progressed, the less we claw back.
   */
  private clawbackPercentForMonthsPaid(monthsPaid: number): number {
    if (monthsPaid <= 1) return 100;
    if (monthsPaid <= 3) return 75;
    if (monthsPaid <= 6) return 50;
    if (monthsPaid <= 12) return 25;
    return 0;
  }

  /**
   * Reverse commissions tied to a contract that has defaulted / been
   * written off. Called by the contract or bad-debt flow; idempotent —
   * rows already clawed back are skipped via clawbackAt IS NULL.
   */
  async applyClawbackForContract(
    contractId: string,
    monthsPaid: number,
    reason: string,
  ): Promise<{ clawedBackCount: number; totalAmount: string; percent: number }> {
    if (!Number.isFinite(monthsPaid) || monthsPaid < 0) {
      throw new BadRequestException('monthsPaid ต้องเป็นจำนวนเต็มไม่ติดลบ');
    }

    const percent = this.clawbackPercentForMonthsPaid(monthsPaid);
    if (percent === 0) {
      return { clawedBackCount: 0, totalAmount: '0', percent };
    }

    const commissions = await this.prisma.salesCommission.findMany({
      where: {
        contractId,
        deletedAt: null,
        status: { in: ['APPROVED', 'PAID'] },
        clawbackAt: null,
      },
    });
    if (commissions.length === 0) {
      return { clawedBackCount: 0, totalAmount: '0', percent };
    }

    const now = new Date();
    const factor = new Prisma.Decimal(percent).div(100);
    let total = new Prisma.Decimal(0);

    await this.prisma.$transaction(async (tx) => {
      for (const c of commissions) {
        const amount = new Prisma.Decimal(c.commissionAmount)
          .mul(factor)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        total = total.add(amount);

        await tx.salesCommission.update({
          where: { id: c.id },
          data: {
            status: percent === 100 ? 'CLAWED_BACK' : 'PARTIALLY_CLAWED_BACK',
            clawbackAmount: amount,
            clawbackPercent: percent,
            clawbackAt: now,
            clawbackReason: reason,
            monthsPaidBeforeDefault: monthsPaid,
          },
        });
      }
    });

    return {
      clawedBackCount: commissions.length,
      totalAmount: total.toString(),
      percent,
    };
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
   * Update a commission rule.
   *
   * Two guardrails:
   *  - Block rate changes while PENDING commissions exist for the current
   *    period. Letting the rate move mid-cycle breaks the snapshot invariant
   *    that each SalesCommission row carries the rate in force when it was
   *    created.
   *  - Every update writes an AuditLog entry with before/after so a later
   *    "who changed the rate from X to Y?" question has an answer. The rate
   *    snapshot on SalesCommission is the source of truth for money paid;
   *    this audit log is the source of truth for _why_ that snapshot is
   *    what it is.
   */
  async updateRule(
    id: string,
    dto: UpdateCommissionRuleDto,
    userId?: string,
    actor: { role?: string; retroactiveApproval?: boolean } = {},
  ) {
    const rule = await this.prisma.commissionRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('ไม่พบกฎค่าคอมมิชชัน');

    if (dto.rate !== undefined && !rule.rate.equals(new Prisma.Decimal(dto.rate))) {
      const now = new Date();
      const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      // T2-C5 — block rate changes while PENDING commissions exist for the
      // current period (snapshot invariant on SalesCommission).
      const pending = await this.prisma.salesCommission.count({
        where: {
          commissionRuleId: id,
          period: currentPeriod,
          status: 'PENDING',
          deletedAt: null,
        },
      });
      if (pending > 0) {
        throw new ConflictException(
          `เปลี่ยนอัตราไม่ได้ — มี commission ที่รอดำเนินการ ${pending} รายการใน period ${currentPeriod} ปิด period ก่อนหรือรอเดือนหน้า`,
        );
      }

      // T2-C16 — block rate changes while APPROVED-but-not-PAID commissions
      // exist for the rule. APPROVED rows carry a rate snapshot, but a rate
      // change could be read as retroactive re-pricing by an auditor. Only
      // OWNER with an explicit X-Retroactive-Approval header may proceed.
      const unpaid = await this.prisma.salesCommission.count({
        where: {
          commissionRuleId: id,
          status: 'APPROVED',
          deletedAt: null,
        },
      });
      if (unpaid > 0) {
        const isOwner = actor.role === 'OWNER';
        const retroApproved = actor.retroactiveApproval === true;
        if (!(isOwner && retroApproved)) {
          throw new ForbiddenException(
            `เปลี่ยนอัตราไม่ได้ — มี commission อนุมัติแล้วแต่ยังไม่จ่าย ${unpaid} รายการ. ` +
              `ต้องให้ OWNER ส่ง header X-Retroactive-Approval: true เพื่อยืนยันการเปลี่ยนย้อนหลัง`,
          );
        }
      }
    }

    const updated = await this.prisma.commissionRule.update({
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

    if (userId) {
      await this.prisma.auditLog
        .create({
          data: {
            userId,
            action: 'COMMISSION_RULE_UPDATE',
            entity: 'CommissionRule',
            entityId: id,
            oldValue: {
              name: rule.name,
              ruleType: rule.ruleType,
              rate: rule.rate.toString(),
              fixedAmount: rule.fixedAmount?.toString() ?? null,
              minSaleAmount: rule.minSaleAmount?.toString() ?? null,
              maxSaleAmount: rule.maxSaleAmount?.toString() ?? null,
            },
            newValue: {
              name: updated.name,
              ruleType: updated.ruleType,
              rate: updated.rate.toString(),
              fixedAmount: updated.fixedAmount?.toString() ?? null,
              minSaleAmount: updated.minSaleAmount?.toString() ?? null,
              maxSaleAmount: updated.maxSaleAmount?.toString() ?? null,
            },
          },
        })
        .catch((err) =>
          this.logger.warn(
            `Audit log write failed for commission rule update: ${err.message}`,
          ),
        );
    }

    return updated;
  }

  // ============================================================
  // COMMISSION PAYOUTS (monthly aggregate per salesperson)
  // ============================================================

  /**
   * List payout records with optional filters
   */
  async findPayouts(filters: {
    userId?: string;
    status?: string;
    period?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 50, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.userId) where.salespersonId = filters.userId;
    if (filters.status) where.status = filters.status;
    if (filters.period) where.period = filters.period;

    const [data, total] = await Promise.all([
      this.prisma.commissionPayout.findMany({
        where,
        orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          salesperson: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          paidBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.commissionPayout.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Payout summary for a given month — grouped by salesperson
   */
  async getPayoutSummary(period: string) {
    const payouts = await this.prisma.commissionPayout.findMany({
      where: { period, deletedAt: null },
      include: {
        salesperson: { select: { id: true, name: true } },
      },
      orderBy: { totalCommission: 'desc' },
    });

    const totalAmount = payouts.reduce(
      (sum, p) => sum.add(p.totalCommission),
      new Prisma.Decimal(0),
    );

    return {
      period,
      payouts,
      totalPayouts: payouts.length,
      totalAmount: totalAmount.toString(),
      approved: payouts.filter((p) => p.status === 'APPROVED' || p.status === 'PAID').length,
      paid: payouts.filter((p) => p.status === 'PAID').length,
    };
  }

  /**
   * Generate payout records for a given month.
   * Aggregates all PENDING/APPROVED/PAID SalesCommissions for the period.
   * Idempotent: skips salespersons who already have a payout record for that period.
   */
  async generatePayouts(dto: GeneratePayoutDto) {
    const { period, notes } = dto;

    // Validate period format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new BadRequestException('รูปแบบเดือนต้องเป็น YYYY-MM');
    }

    // Get all commissions for the period
    const commissions = await this.prisma.salesCommission.findMany({
      where: { period, deletedAt: null },
      include: { salesperson: { select: { id: true, name: true } } },
    });

    if (commissions.length === 0) {
      return { created: 0, skipped: 0, message: 'ไม่พบคอมมิชชันในเดือนนี้' };
    }

    // Group by salesperson using Decimal for precision
    const grouped = new Map<
      string,
      { salespersonId: string; totalSales: Prisma.Decimal; totalCommission: Prisma.Decimal; count: number }
    >();

    for (const c of commissions) {
      if (!grouped.has(c.salespersonId)) {
        grouped.set(c.salespersonId, {
          salespersonId: c.salespersonId,
          totalSales: new Prisma.Decimal(0),
          totalCommission: new Prisma.Decimal(0),
          count: 0,
        });
      }
      const entry = grouped.get(c.salespersonId)!;
      entry.totalSales = entry.totalSales.add(c.saleAmount);
      entry.totalCommission = entry.totalCommission.add(c.commissionAmount);
      entry.count += 1;
    }

    let created = 0;
    let skipped = 0;

    for (const entry of grouped.values()) {
      // Upsert: if payout already exists for this salesperson+period, skip
      const existing = await this.prisma.commissionPayout.findUnique({
        where: {
          salespersonId_period: { salespersonId: entry.salespersonId, period },
        },
      });

      if (existing && existing.deletedAt === null) {
        skipped += 1;
        continue;
      }

      await this.prisma.commissionPayout.upsert({
        where: {
          salespersonId_period: { salespersonId: entry.salespersonId, period },
        },
        create: {
          salespersonId: entry.salespersonId,
          period,
          totalSales: entry.totalSales,
          totalCommission: entry.totalCommission,
          commissionCount: entry.count,
          status: 'DRAFT',
          notes: notes || null,
        },
        update: {
          // restore if soft-deleted
          deletedAt: null,
          totalSales: entry.totalSales,
          totalCommission: entry.totalCommission,
          commissionCount: entry.count,
          notes: notes || null,
        },
      });
      created += 1;
    }

    return { created, skipped, period, message: `สร้าง ${created} รายการ, ข้าม ${skipped} รายการ (มีอยู่แล้ว)` };
  }

  /**
   * Approve a payout (OWNER only)
   */
  async approvePayout(id: string, userId: string, dto: ApprovePayoutDto) {
    const payout = await this.prisma.commissionPayout.findFirst({
      where: { id, deletedAt: null },
    });
    if (!payout) throw new NotFoundException('ไม่พบใบจ่ายคอมมิชชัน');
    if (payout.status !== 'DRAFT') {
      throw new BadRequestException('สามารถอนุมัติได้เฉพาะรายการที่อยู่ในสถานะ DRAFT เท่านั้น');
    }

    // Segregation of Duties — salesperson who earns the payout must not
    // self-approve. Mirrors bad-debt write-off guard.
    if (payout.salespersonId === userId) {
      throw new ForbiddenException(
        'ผู้อนุมัติต้องไม่ใช่ผู้รับคอมมิชชัน (Segregation of Duties)',
      );
    }

    return this.prisma.commissionPayout.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        salesperson: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Mark a payout as paid (OWNER only)
   */
  async markPayoutPaid(id: string, userId: string) {
    const payout = await this.prisma.commissionPayout.findFirst({
      where: { id, deletedAt: null },
    });
    if (!payout) throw new NotFoundException('ไม่พบใบจ่ายคอมมิชชัน');
    if (payout.status !== 'APPROVED') {
      throw new BadRequestException('สามารถบันทึกการจ่ายได้เฉพาะรายการที่อนุมัติแล้วเท่านั้น');
    }

    return this.prisma.commissionPayout.update({
      where: { id },
      data: {
        status: 'PAID',
        paidById: userId,
        paidAt: new Date(),
      },
      include: {
        salesperson: { select: { id: true, name: true } },
        paidBy: { select: { id: true, name: true } },
      },
    });
  }
}
