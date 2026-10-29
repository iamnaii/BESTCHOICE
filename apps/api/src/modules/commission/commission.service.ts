import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCommissionRuleDto, UpdateCommissionRuleDto } from './dto/commission.dto';
import { GeneratePayoutDto, ApprovePayoutDto } from './dto/commission-payout.dto';
import { computeCommissionAmount } from '../../utils/commission.util';
import {
  COMMISSION_PAY_VIA_PAYROLL_CODE,
  COMMISSION_PAY_VIA_PAYROLL_MSG,
  STATUS_CHANGED_MSG,
  clawBackCommissions,
} from './commission-clawback.util';

/**
 * D4 Part 2 (P2-R11): commissions are paid only through payroll. The old per-row pay, payout
 * generation and payout pay paths keep their routes (decorators unchanged, access manifest unchanged)
 * but answer 410 with a code, before any database read.
 */
const payViaPayroll = () =>
  new GoneException({ message: COMMISSION_PAY_VIA_PAYROLL_MSG, code: COMMISSION_PAY_VIA_PAYROLL_CODE });

/**
 * D4 Part 2 (Task 6) — the payroll items a commission list row shows: live items only (`releasedAt` null — the
 * same predicate as the partial index and the payroll compute; a voided or deleted payroll has released its
 * items), in the order they were written, each with its payroll document.
 */
const COMMISSION_PAYROLL_LINKS_SELECT = {
  where: { releasedAt: null },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  select: {
    kind: true,
    amount: true,
    payrollLine: { select: { payroll: { select: { document: { select: { id: true, number: true, status: true } } } } } },
  },
} satisfies Prisma.SalesCommission$payrollItemsArgs;

export interface CommissionPayrollLink {
  documentId: string;
  documentNumber: string;
  status: string;
  kind: 'PAY' | 'CLAWBACK';
}

type LinkItem = {
  kind: 'PAY' | 'CLAWBACK';
  amount: Prisma.Decimal;
  payrollLine: { payroll: { document: { id: string; number: string; status: string } } };
};

/**
 * One list row as the commissions page reads it (P2-R19.7):
 * - `payrollLinks` — one entry per live item (PAY = "อยู่ในใบเงินเดือน {no} · {status}", CLAWBACK = "หักคืนในใบ {no}").
 * - `clawbackOutstanding` — what the next payroll still deducts, only for a commission the payroll compute deducts:
 *   clawed back, `paidAt` set and a live PAY item in a POSTED payroll (paid outside payroll → null, the payroll shows
 *   CLAWBACK_PAID_OUTSIDE_PAYROLL instead). Value = clawbackAmount − Σ live CLAWBACK items in any document status
 *   (the same subtraction the gate uses), floored at 0, 2 dp.
 * - `salespersonResigned` — `resignedDate ≤ now`; the resigned date itself is not sent.
 */
function withPayrollView<
  T extends {
    status: string;
    paidAt: Date | null;
    clawbackAmount: Prisma.Decimal | null;
    salesperson?: { id: string; name: string; employeeProfile?: { resignedDate: Date | null } | null } | null;
    payrollItems?: LinkItem[];
  },
>(row: T, now: Date) {
  const { payrollItems, salesperson, ...rest } = row;
  const items = payrollItems ?? [];
  const payrollLinks: CommissionPayrollLink[] = items.map((i) => ({
    documentId: i.payrollLine.payroll.document.id,
    documentNumber: i.payrollLine.payroll.document.number,
    status: i.payrollLine.payroll.document.status,
    kind: i.kind,
  }));
  const clawedBack = row.status === 'CLAWED_BACK' || row.status === 'PARTIALLY_CLAWED_BACK';
  const paidThroughPayroll =
    row.paidAt !== null && items.some((i) => i.kind === 'PAY' && i.payrollLine.payroll.document.status === 'POSTED');
  const deducted = items
    .filter((i) => i.kind === 'CLAWBACK')
    .reduce((s, i) => s.add(i.amount), new Prisma.Decimal(0));
  const clawbackOutstanding =
    clawedBack && paidThroughPayroll && row.clawbackAmount !== null
      ? Prisma.Decimal.max(0, new Prisma.Decimal(row.clawbackAmount).sub(deducted)).toFixed(2)
      : null;
  const resignedDate = salesperson?.employeeProfile?.resignedDate ?? null;
  return {
    ...rest,
    salesperson: salesperson ? { id: salesperson.id, name: salesperson.name } : salesperson,
    payrollLinks,
    clawbackOutstanding,
    salespersonResigned: resignedDate !== null && resignedDate.getTime() <= now.getTime(),
  };
}

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a sales commission record for a sale.
   *
   * T5-C19: if a commissionRuleId is provided we snapshot the rule's current
   * updatedAt timestamp into ruleVersionId. At approve() time we re-read the
   * rule and reject if rate drifted — protecting against the case where a
   * manager retroactively bumps a rule while PENDING commissions still
   * reference the old rate snapshot.
   *
   * T4-C10: snapshots contract.salespersonId at creation time into
   * SalesCommission.snapshotSalespersonId. If the contract salesperson is
   * reassigned later (via admin), the commission stays tied to whoever
   * actually closed the deal. The snapshot falls back to `salespersonId` so
   * cash sales and contracts with mismatched pointers still get a deterministic
   * value to query payouts from.
   */
  async createCommissionForSale(
    saleId: string,
    salespersonId: string,
    saleAmount: number,
    commissionRate: number,
    contractId?: string,
    commissionRuleId?: string,
  ) {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Shared exact-Decimal helper (ROUND_HALF_UP) — same as sales.service uses,
    // so both commission code paths round identically. Avoids float rounding bugs.
    const commissionAmount = computeCommissionAmount(saleAmount, commissionRate);

    // T5-C19: capture rule version for audit + approve-time re-validation.
    let ruleVersionId: string | null = null;
    if (commissionRuleId) {
      const rule = await this.prisma.commissionRule.findFirst({
        where: { id: commissionRuleId, deletedAt: null },
        select: { updatedAt: true },
      });
      if (rule) {
        ruleVersionId = rule.updatedAt.toISOString();
      }
    }

    // T4-C10: lock in the original earner. Read the contract's current
    // salespersonId (if a contract is attached) so a later reassignment
    // doesn't retroactively move the commission to someone else.
    let snapshotSalespersonId = salespersonId;
    if (contractId) {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        select: { salespersonId: true },
      });
      if (contract?.salespersonId) {
        snapshotSalespersonId = contract.salespersonId;
      }
    }

    return this.prisma.salesCommission.create({
      data: {
        salespersonId,
        snapshotSalespersonId,
        contractId: contractId || null,
        saleId,
        commissionRuleId: commissionRuleId || null,
        ruleVersionId,
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

    const [rows, total] = await Promise.all([
      this.prisma.salesCommission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          salesperson: { select: { id: true, name: true, employeeProfile: { select: { resignedDate: true } } } },
          contract: { select: { id: true, contractNumber: true } },
          sale: { select: { id: true, saleNumber: true } },
          approvedBy: { select: { id: true, name: true } },
          payrollItems: COMMISSION_PAYROLL_LINKS_SELECT,
        },
      }),
      this.prisma.salesCommission.count({ where }),
    ]);

    const now = new Date();
    const data = rows.map((row) => withPayrollView(row, now));
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
   * Approve a pending commission.
   *
   * T5-C19: re-read the linked CommissionRule and reject if the current rate
   * differs from the snapshotted commissionRate on this row. Prevents the
   * scenario where a rule is edited after a commission was created —
   * approving the stale snapshot would silently pay the wrong amount.
   * T2-C5 already blocks rule rate changes while PENDING commissions exist
   * for the current period, but this is belt-and-suspenders for cross-period
   * or soft-deleted-rule edge cases.
   *
   * D4 Part 2 (P2-R28): payroll pulls APPROVED commissions automatically, so the
   * write is a CAS on (id, status PENDING) — a clawback that lands between the
   * read and the write (sale void / cron / contract cancellation) must not be
   * overwritten back to APPROVED and paid. Count ≠ 1 → 409, nothing written.
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

    // T5-C19: rate snapshot validation. Only when the commission carries a
    // rule reference — legacy rows without commissionRuleId are approved
    // using their snapshotted rate (unchanged behaviour).
    if (commission.commissionRuleId) {
      const rule = await this.prisma.commissionRule.findFirst({
        where: { id: commission.commissionRuleId, deletedAt: null },
        select: { rate: true },
      });
      if (rule && !rule.rate.equals(new Prisma.Decimal(commission.commissionRate))) {
        throw new ConflictException(
          `อัตราคอมมิชชันในกฎถูกแก้ไขหลังสร้างรายการนี้ (snapshot ${commission.commissionRate.toString()} → ปัจจุบัน ${rule.rate.toString()}) — กรุณาคำนวณใหม่ก่อนอนุมัติ`,
        );
      }
    }

    const { count } = await this.prisma.salesCommission.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
    if (count !== 1) throw new ConflictException(STATUS_CHANGED_MSG);
    return this.prisma.salesCommission.findUniqueOrThrow({ where: { id } });
  }

  /**
   * 410 — a commission is marked paid only by a posted payroll (`POST /commissions/:id/pay` is closed).
   */
  async markPaid(_id: string): Promise<never> {
    throw payViaPayroll();
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
   *
   * Writes through `clawBackCommissions` (the one clawback helper): a paid row records
   * `clawbackAmount = paidAmount × percent` (deducted by the next payroll), an unpaid APPROVED row
   * records `commissionAmount × percent` below 100% and null at 100%. `totalAmount` keeps its old
   * meaning for the cron log — Σ HALF_UP(commissionAmount × percent, 2) over the rows touched (P2-R8).
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
    const total = commissions.reduce(
      (sum, c) =>
        sum.add(new Prisma.Decimal(c.commissionAmount).mul(factor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
      new Prisma.Decimal(0),
    );

    await this.prisma.$transaction((tx) =>
      clawBackCommissions(tx, commissions, { reason, now, percent, monthsPaidBeforeDefault: monthsPaid }),
    );

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
   * 410 — monthly payout rounds are no longer generated (`POST /commissions/payouts/generate` is
   * closed); payroll pulls approved commissions itself. Existing rounds stay readable, and
   * `approvePayout` stays live (spec §6 lists only these three paths).
   */
  async generatePayouts(_dto: GeneratePayoutDto): Promise<never> {
    throw payViaPayroll();
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
   * 410 — a payout round is never marked paid again (`PATCH /commissions/payouts/:id/paid` is closed).
   */
  async markPayoutPaid(_id: string, _userId: string): Promise<never> {
    throw payViaPayroll();
  }
}
