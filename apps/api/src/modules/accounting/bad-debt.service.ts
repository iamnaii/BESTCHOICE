import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { BadDebtProvisionTemplate } from '../journal/cpa-templates/bad-debt-provision.template';
import { BadDebtWriteOffTemplate } from '../journal/cpa-templates/bad-debt-writeoff.template';

const DEFAULT_PROVISION_RATES: Record<string, number> = {
  '1-30': 0.02,
  '31-60': 0.10,
  '61-90': 0.25,
  '91-180': 0.50,
  '181-360': 0.75,
  '360+': 1.00,
};

@Injectable()
export class BadDebtService {
  private readonly logger = new Logger(BadDebtService.name);

  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
    private badDebtProvisionTemplate: BadDebtProvisionTemplate,
    private badDebtWriteOffTemplate: BadDebtWriteOffTemplate,
  ) {}

  /** Load provision rates from system config or use defaults */
  private async getProvisionRates(): Promise<Record<string, number>> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'bad_debt_provision_rates' },
    });
    if (config) {
      try {
        return JSON.parse(config.value);
      } catch {
        /* fall through to defaults */
      }
    }
    return DEFAULT_PROVISION_RATES;
  }

  /** Determine aging bucket for a given number of overdue days */
  private getAgingBucket(daysOverdue: number): string {
    if (daysOverdue <= 30) return '1-30';
    if (daysOverdue <= 60) return '31-60';
    if (daysOverdue <= 90) return '61-90';
    if (daysOverdue <= 180) return '91-180';
    if (daysOverdue <= 360) return '181-360';
    return '360+';
  }

  /**
   * Helper for outstanding calculation (DRY) — Decimal precision (TFRS 9 / v4 mandate).
   * Replaces Number() casts which lose precision on Prisma.Decimal fields.
   */
  private computeOutstanding(
    p: { amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal },
    lateFee: Prisma.Decimal | number = 0,
  ): Decimal {
    return new Decimal(p.amountDue.toString())
      .sub(new Decimal(p.amountPaid.toString()))
      .add(new Decimal(lateFee.toString()));
  }

  /**
   * Calculate Bad Debt provisions per TFRS for NPAEs Chapter 13.
   *
   * Uses simplified aging-based approach (NOT TFRS 9 full ECL 3-stage model):
   *   1-30 days overdue:   2%   provision
   *   31-60 days overdue:  10%  provision
   *   61-90 days overdue:  25%  provision
   *   91-180 days overdue: 50%  provision
   *   181-360 days overdue: 75% provision
   *   360+ days overdue:   100% provision
   *
   * Approved NPAEs simplification per Ch.13 — forward-looking macro factors
   * not required at NPAEs level. Rates are configurable via
   * SystemConfig key `bad_debt_provision_rates`; if unset the defaults above
   * apply.
   *
   * Reverses existing ACTIVE provisions for in-scope contracts before
   * creating fresh ones, so re-running is idempotent. Posts a delta JE
   * per contract via BadDebtProvisionTemplate (Phase A.5a).
   *
   * Refs: docs/accounting/audit-report.html (Wave 4 T1, TFRS 9 W-1/W-2)
   */
  async calculateProvisions(calculatedById: string, branchId?: string): Promise<{
    created: number;
    totalProvision: number;
    byBucket: Record<string, { count: number; amount: number }>;
  }> {
    const rates = await this.getProvisionRates();
    const now = new Date();
    const branchFilter = branchId ? { branchId } : {};

    // Find all overdue payments from active contracts
    // Aging is based on the oldest UNPAID overdue installment per contract.
    // Paid installments are excluded (status filter), so if installments 1-4 are paid
    // and installment 5 (due 100 days ago) is unpaid, aging = 100 days. This is correct.
    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
        dueDate: { lt: now },
        contract: {
          deletedAt: null,
          status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
          ...branchFilter,
        },
      },
      include: {
        contract: { select: { id: true, status: true } },
      },
      take: 10000, // safety cap — prevent unbounded memory usage
      orderBy: { dueDate: 'asc' },
    });

    // Group by contract and calculate total outstanding per contract (Decimal arithmetic)
    const contractOutstanding = new Map<
      string,
      { amount: Decimal; oldestDueDate: Date }
    >();
    for (const p of overduePayments) {
      const existing = contractOutstanding.get(p.contract.id);
      const unpaidLateFee = !p.lateFeeWaived ? new Decimal(p.lateFee.toString()) : new Decimal(0);
      const remaining = this.computeOutstanding(p, unpaidLateFee);
      if (existing) {
        existing.amount = existing.amount.add(remaining);
      } else {
        contractOutstanding.set(p.contract.id, {
          amount: remaining,
          oldestDueDate: p.dueDate,
        });
      }
    }

    // Reverse existing ACTIVE provisions only for contracts in scope
    const contractIdsInScope = [...contractOutstanding.keys()];

    // Capture previous provision amounts BEFORE reversing, to compute delta for JE
    const previousProvisionByContract = new Map<string, Prisma.Decimal>();
    if (contractIdsInScope.length > 0) {
      const activeProvisions = await this.prisma.badDebtProvision.findMany({
        where: { status: 'ACTIVE', contractId: { in: contractIdsInScope }, deletedAt: null },
        select: { contractId: true, provisionAmount: true },
      });
      for (const p of activeProvisions) {
        const prev = previousProvisionByContract.get(p.contractId) ?? new Prisma.Decimal(0);
        previousProvisionByContract.set(p.contractId, prev.add(p.provisionAmount));
      }

      await this.prisma.badDebtProvision.updateMany({
        where: { status: 'ACTIVE', contractId: { in: contractIdsInScope }, deletedAt: null },
        data: { status: 'REVERSED' },
      });
    }

    // Create new provisions
    const byBucket: Record<string, { count: number; amount: number }> = {};
    const provisions: Array<{
      contractId: string;
      provisionDate: Date;
      agingBucket: string;
      daysOverdue: number;
      outstandingAmount: number;
      provisionRate: number;
      provisionAmount: number;
    }> = [];

    for (const [contractId, data] of contractOutstanding) {
      const daysOverdue = Math.floor(
        (now.getTime() - data.oldestDueDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const bucket = this.getAgingBucket(daysOverdue);
      const rate = rates[bucket] || 0;
      // Decimal precision: ROUND_HALF_UP to 2 d.p. (was Math.round which used banker's rounding edge cases)
      const provisionAmountDecimal = data.amount
        .mul(new Decimal(rate))
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const provisionAmount = provisionAmountDecimal.toNumber();
      const outstandingAmount = data.amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

      provisions.push({
        contractId,
        provisionDate: now,
        agingBucket: bucket,
        daysOverdue,
        outstandingAmount,
        provisionRate: rate,
        provisionAmount,
      });

      if (!byBucket[bucket]) byBucket[bucket] = { count: 0, amount: 0 };
      byBucket[bucket].count++;
      byBucket[bucket].amount += provisionAmount;
    }

    if (provisions.length > 0) {
      await this.prisma.badDebtProvision.createMany({ data: provisions });
    }

    // Post delta-based provision JEs (non-blocking — a single JE failure must not abort the run)
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const period = `${year}-${String(month).padStart(2, '0')}`;

    for (const p of provisions) {
      const prev = previousProvisionByContract.get(p.contractId) ?? new Prisma.Decimal(0);
      const newAmount = new Prisma.Decimal(p.provisionAmount);
      const delta = newAmount.sub(prev);
      if (delta.eq(0)) continue;

      // Phase A.5a: post provision JE (non-blocking — a single JE failure must not abort the run)
      try {
        await this.badDebtProvisionTemplate.execute({
          contractId: p.contractId,
          provisionAmount: delta,
          period,
        });
      } catch (err) {
        Sentry.captureException(err, { extra: { contractId: p.contractId, period } });
        this.logger.error(
          `[A.5a] Bad debt provision JE failed for contract ${p.contractId} period ${period}: ${(err as Error).message}`,
        );
      }
    }

    // Decimal sum for total provision (TFRS 9 / v4 mandate — avoid float drift on aggregation)
    const totalProvisionDecimal = provisions.reduce(
      (sum, p) => sum.add(new Decimal(p.provisionAmount)),
      new Decimal(0),
    );
    const totalProvision = totalProvisionDecimal.toNumber();
    return { created: provisions.length, totalProvision, byBucket };
  }

  /**
   * Get provision summary (current ACTIVE provisions)
   */
  async getProvisionSummary() {
    const provisions = await this.prisma.badDebtProvision.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      include: {
        contract: {
          select: {
            contractNumber: true,
            customerId: true,
            customer: { select: { name: true } },
          },
        },
      },
      orderBy: { daysOverdue: 'desc' },
    });

    // Decimal accumulation (TFRS 9 / v4 mandate — avoid float drift on aggregation)
    let totalOutstandingDec = new Decimal(0);
    let totalProvisionDec = new Decimal(0);
    const bucketDec = new Map<
      string,
      { count: number; outstanding: Decimal; provision: Decimal; rate: number }
    >();

    for (const p of provisions) {
      const outstandingDec = new Decimal(p.outstandingAmount.toString());
      const provisionDec = new Decimal(p.provisionAmount.toString());
      totalOutstandingDec = totalOutstandingDec.add(outstandingDec);
      totalProvisionDec = totalProvisionDec.add(provisionDec);

      const bucket = p.agingBucket;
      const entry = bucketDec.get(bucket);
      if (!entry) {
        bucketDec.set(bucket, {
          count: 1,
          outstanding: outstandingDec,
          provision: provisionDec,
          rate: Number(p.provisionRate),
        });
      } else {
        entry.count++;
        entry.outstanding = entry.outstanding.add(outstandingDec);
        entry.provision = entry.provision.add(provisionDec);
      }
    }

    const byBucket: Record<
      string,
      { count: number; outstanding: number; provision: number; rate: number }
    > = {};
    for (const [bucket, entry] of bucketDec) {
      byBucket[bucket] = {
        count: entry.count,
        outstanding: entry.outstanding.toNumber(),
        provision: entry.provision.toNumber(),
        rate: entry.rate,
      };
    }

    const summary = {
      totalOutstanding: totalOutstandingDec.toNumber(),
      totalProvision: totalProvisionDec.toNumber(),
      byBucket,
      details: provisions.map((p) => ({
        contractId: p.contractId,
        contractNumber: p.contract.contractNumber,
        customerName: p.contract.customer?.name,
        agingBucket: p.agingBucket,
        daysOverdue: p.daysOverdue,
        outstandingAmount: new Decimal(p.outstandingAmount.toString()).toNumber(),
        provisionRate: Number(p.provisionRate),
        provisionAmount: new Decimal(p.provisionAmount.toString()).toNumber(),
      })),
    };

    return summary;
  }

  /**
   * Write off a bad debt (ตัดหนี้สูญ)
   *
   * T3-C6 — amount-based approval tiers (phone-shop pricing reality):
   *   0-10,000฿:  writer BM/ACCT/FM/OWNER,  approver must be BM/FM/OWNER
   *   10,000-30,000฿: approver must be FM or OWNER
   *   30,000฿+:  approver must be OWNER, writer must be FM or OWNER
   *
   * Writer and approver must always be different people (Segregation of Duties
   * — pre-existing rule).
   */
  private assertWriteOffTierPermitted(
    outstandingAmount: number,
    writerRole: string,
    approverRole: string,
  ): void {
    const approverAllowedByTier =
      outstandingAmount <= 10_000
        ? ['BRANCH_MANAGER', 'FINANCE_MANAGER', 'OWNER']
        : outstandingAmount <= 30_000
          ? ['FINANCE_MANAGER', 'OWNER']
          : ['OWNER'];

    if (!approverAllowedByTier.includes(approverRole)) {
      throw new ForbiddenException(
        `ตัดหนี้สูญ ${outstandingAmount.toLocaleString()} บาท ต้องอนุมัติโดย ${approverAllowedByTier.join(' หรือ ')} (ปัจจุบัน: ${approverRole})`,
      );
    }

    // Top tier (>30k) also constrains who can _originate_ the request so the
    // OWNER isn't paired with a low-privilege writer who might not
    // understand what they are signing off on.
    if (outstandingAmount > 30_000) {
      const writerAllowed = ['FINANCE_MANAGER', 'OWNER'];
      if (!writerAllowed.includes(writerRole)) {
        throw new ForbiddenException(
          `ตัดหนี้สูญ > 30,000 บาท ผู้ขอต้องเป็น FINANCE_MANAGER หรือ OWNER (ปัจจุบัน: ${writerRole})`,
        );
      }
    }
  }

  async writeOffBadDebt(
    contractId: string,
    writtenOffById: string,
    approvedById: string,
    notes?: string,
  ) {
    if (writtenOffById === approvedById) {
      throw new BadRequestException('ผู้ตัดหนี้สูญต้องไม่ใช่ผู้อนุมัติ');
    }

    // Resolve both users' roles up front so we can apply the T3-C6 tier
    // rules before any write.
    const [writer, approver] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: writtenOffById },
        select: { id: true, role: true, isActive: true, deletedAt: true },
      }),
      this.prisma.user.findUnique({
        where: { id: approvedById },
        select: { id: true, role: true, isActive: true, deletedAt: true },
      }),
    ]);
    if (!writer || !writer.isActive || writer.deletedAt) {
      throw new NotFoundException('ไม่พบผู้ขอตัดหนี้สูญ หรือถูกปิดการใช้งาน');
    }
    if (!approver || !approver.isActive || approver.deletedAt) {
      throw new NotFoundException('ไม่พบผู้อนุมัติ หรือถูกปิดการใช้งาน');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    if (contract.status === 'CLOSED_BAD_DEBT') {
      throw new BadRequestException('สัญญานี้ถูกตัดหนี้สูญไปแล้ว');
    }

    return this.prisma.$transaction(async (tx) => {
      // Calculate outstanding amount from unpaid/partial payments (Decimal arithmetic)
      const unpaidPayments = await tx.payment.findMany({
        where: {
          contractId,
          status: { in: ['PENDING', 'PARTIALLY_PAID'] },
          deletedAt: null,
        },
        select: { amountDue: true, amountPaid: true, lateFee: true, lateFeeWaived: true },
      });
      const outstandingDec = unpaidPayments.reduce((sum, p) => {
        const unpaidLateFee = !p.lateFeeWaived ? new Decimal(p.lateFee.toString()) : new Decimal(0);
        return sum.add(this.computeOutstanding(p, unpaidLateFee));
      }, new Decimal(0));
      const outstandingAmount = outstandingDec.toNumber();

      // T3-C6 — enforce amount-tier approval rule before any write.
      this.assertWriteOffTierPermitted(outstandingAmount, writer.role, approver.role);

      // Capture total active provision amount before updating status (Decimal sum)
      const activeProvisions = await tx.badDebtProvision.findMany({
        where: { contractId, status: 'ACTIVE', deletedAt: null },
        select: { provisionAmount: true },
      });
      const existingProvisionDec = activeProvisions.reduce(
        (sum, p) => sum.add(new Decimal(p.provisionAmount.toString())),
        new Decimal(0),
      );
      const existingProvisionAmount = existingProvisionDec.toNumber();

      // Update contract status to CLOSED_BAD_DEBT
      await tx.contract.update({
        where: { id: contractId },
        data: { status: 'CLOSED_BAD_DEBT' },
      });

      // Update active provisions to WRITTEN_OFF
      await tx.badDebtProvision.updateMany({
        where: { contractId, status: 'ACTIVE', deletedAt: null },
        data: {
          status: 'WRITTEN_OFF',
          writtenOffAt: new Date(),
          writtenOffById,
          approvedById,
          approvedAt: new Date(),
          notes,
        },
      });

      // Phase A.5a + Wave 1 Task 5: write-off JE inside same $transaction.
      // Template now accepts tx parameter (Task 1) — JE failure rolls back the whole
      // write-off. No more silent fail / orphan AR (TFRS 9 Critical 1).
      await this.badDebtWriteOffTemplate.execute(
        {
          contractId,
          writeOffReason: notes ?? undefined,
        },
        tx,
      );

      // T1-C7: Immutable audit log inside the same transaction. Captures
      // both parties' roles at write-off time (role can change later, the
      // snapshot cannot). Insertion failure = whole write-off rolls back.
      await tx.badDebtWriteOffAuditLog.create({
        data: {
          contractId: contract.id,
          contractNumber: contract.contractNumber,
          outstandingAmount,
          provisionAmount: existingProvisionAmount,
          writtenOffById,
          writtenOffByRole: writer.role,
          approvedById,
          approvedByRole: approver.role,
          notes,
        },
      });

      return { contractId, status: 'CLOSED_BAD_DEBT', writtenOffAt: new Date() };
    });
  }
}
