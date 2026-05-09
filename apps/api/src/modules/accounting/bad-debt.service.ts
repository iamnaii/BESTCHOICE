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

// CPA ECL v3.0 — NPAEs Ch.13 Aging-based (6 buckets B0-B5)
// Refs: docs/superpowers/specs/2026-05-09-cpa-policy-a-100-compliance-design.md
//       + สรุปการบันทึกรับชำระค่างวด.csv §6 ECL Provision
//
// Note: 0-day bucket (B0) handled implicitly = no provision created
//       (only installments WITH overdue days get a provision row).
const DEFAULT_PROVISION_RATES: Record<string, number> = {
  '1-30': 0.02,    // B1 ACTIVE
  '31-60': 0.15,   // B2 ACTIVE (alert 60d trigger)
  '61-90': 0.50,   // B3 → contract should be TERMINATED (manual)
  '91-180': 0.75,  // B4 TERMINATED
  '180+': 1.00,    // B5 TERMINATED (NPL)
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

  /** Determine aging bucket for a given number of overdue days (CPA ECL v3.0) */
  private getAgingBucket(daysOverdue: number): string {
    if (daysOverdue <= 30) return '1-30';     // B1
    if (daysOverdue <= 60) return '31-60';    // B2 (alert 60d)
    if (daysOverdue <= 90) return '61-90';    // B3 (TERMINATED)
    if (daysOverdue <= 180) return '91-180';  // B4 (TERMINATED)
    return '180+';                             // B5 (NPL)
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
   * Uses CPA ECL v3.0 (NPAEs Ch.13 Aging-based · 6 buckets B0-B5):
   *   B0: 0 days (ปกติ)    0%   ACTIVE (no provision row created)
   *   B1: 1-30 days        2%   ACTIVE
   *   B2: 31-60 days       15%  ACTIVE (alert 60d trigger)
   *   B3: 61-90 days       50%  → contract should be TERMINATED (manual)
   *   B4: 91-180 days      75%  TERMINATED
   *   B5: >180 days        100% TERMINATED (NPL)
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

    // Reverse existing ACTIVE provisions only for contracts in scope.
    // Wrap REVERSE + CREATE in a single $transaction — without it, a
    // failed createMany after the reverse would leave provisions REVERSED
    // with no replacement, dropping coverage on the balance sheet.
    const contractIdsInScope = [...contractOutstanding.keys()];

    // Pre-compute provision rows (Decimal — no Number cast in persisted values)
    type ProvisionRow = {
      contractId: string;
      provisionDate: Date;
      agingBucket: string;
      daysOverdue: number;
      outstandingAmount: Prisma.Decimal;
      provisionRate: Prisma.Decimal;
      provisionAmount: Prisma.Decimal;
    };
    const byBucket: Record<string, { count: number; amount: Decimal }> = {};
    const provisions: ProvisionRow[] = [];

    for (const [contractId, data] of contractOutstanding) {
      const daysOverdue = Math.floor(
        (now.getTime() - data.oldestDueDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      const bucket = this.getAgingBucket(daysOverdue);
      const rate = rates[bucket] || 0;
      const rateDec = new Decimal(rate);
      const outstandingDec = data.amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const provisionAmountDec = data.amount
        .mul(rateDec)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      provisions.push({
        contractId,
        provisionDate: now,
        agingBucket: bucket,
        daysOverdue,
        outstandingAmount: outstandingDec,
        provisionRate: rateDec,
        provisionAmount: provisionAmountDec,
      });

      if (!byBucket[bucket]) byBucket[bucket] = { count: 0, amount: new Decimal(0) };
      byBucket[bucket].count++;
      byBucket[bucket].amount = byBucket[bucket].amount.add(provisionAmountDec);
    }

    // Atomic REVERSE + CREATE — never leave the balance sheet without coverage
    const previousProvisionByContract = new Map<string, Prisma.Decimal>();
    await this.prisma.$transaction(async (tx) => {
      if (contractIdsInScope.length > 0) {
        const activeProvisions = await tx.badDebtProvision.findMany({
          where: { status: 'ACTIVE', contractId: { in: contractIdsInScope }, deletedAt: null },
          select: { contractId: true, provisionAmount: true },
        });
        for (const p of activeProvisions) {
          const prev = previousProvisionByContract.get(p.contractId) ?? new Prisma.Decimal(0);
          previousProvisionByContract.set(p.contractId, prev.add(p.provisionAmount));
        }

        await tx.badDebtProvision.updateMany({
          where: { status: 'ACTIVE', contractId: { in: contractIdsInScope }, deletedAt: null },
          data: { status: 'REVERSED' },
        });
      }

      if (provisions.length > 0) {
        await tx.badDebtProvision.createMany({ data: provisions });
      }
    });

    // Post delta-based provision JEs (non-blocking — a single JE failure must not abort the run)
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const period = `${year}-${String(month).padStart(2, '0')}`;

    for (const p of provisions) {
      const prev = previousProvisionByContract.get(p.contractId) ?? new Prisma.Decimal(0);
      const newAmount = p.provisionAmount;
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
      (sum, p) => sum.add(p.provisionAmount),
      new Decimal(0),
    );
    const totalProvision = totalProvisionDecimal.toNumber();
    // Convert byBucket Decimals to numbers for the response shape (display only)
    const byBucketResp: Record<string, { count: number; amount: number }> = {};
    for (const [bucket, agg] of Object.entries(byBucket)) {
      byBucketResp[bucket] = { count: agg.count, amount: agg.amount.toNumber() };
    }
    return { created: provisions.length, totalProvision, byBucket: byBucketResp };
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
