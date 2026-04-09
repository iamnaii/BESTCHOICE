import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService } from '../journal/journal-auto.service';

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
  constructor(
    private prisma: PrismaService,
    private journalAutoService: JournalAutoService,
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
   * Calculate provisions for all overdue contracts.
   * Reverses existing ACTIVE provisions and creates fresh ones.
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
      orderBy: { dueDate: 'asc' },
    });

    // Group by contract and calculate total outstanding per contract
    const contractOutstanding = new Map<
      string,
      { amount: number; oldestDueDate: Date }
    >();
    for (const p of overduePayments) {
      const existing = contractOutstanding.get(p.contract.id);
      const unpaidLateFee = !p.lateFeeWaived ? Number(p.lateFee) : 0;
      const remaining = Number(p.amountDue) - Number(p.amountPaid) + unpaidLateFee;
      if (existing) {
        existing.amount += remaining;
      } else {
        contractOutstanding.set(p.contract.id, {
          amount: remaining,
          oldestDueDate: p.dueDate,
        });
      }
    }

    // Reverse existing ACTIVE provisions only for contracts in scope
    const contractIdsInScope = [...contractOutstanding.keys()];
    if (contractIdsInScope.length > 0) {
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
      const provisionAmount = Math.round(data.amount * rate * 100) / 100;

      provisions.push({
        contractId,
        provisionDate: now,
        agingBucket: bucket,
        daysOverdue,
        outstandingAmount: data.amount,
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

    const totalProvision = provisions.reduce((sum, p) => sum + p.provisionAmount, 0);
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

    const summary = {
      totalOutstanding: 0,
      totalProvision: 0,
      byBucket: {} as Record<
        string,
        { count: number; outstanding: number; provision: number; rate: number }
      >,
      details: provisions.map((p) => ({
        contractId: p.contractId,
        contractNumber: p.contract.contractNumber,
        customerName: p.contract.customer?.name,
        agingBucket: p.agingBucket,
        daysOverdue: p.daysOverdue,
        outstandingAmount: Number(p.outstandingAmount),
        provisionRate: Number(p.provisionRate),
        provisionAmount: Number(p.provisionAmount),
      })),
    };

    for (const p of provisions) {
      summary.totalOutstanding += Number(p.outstandingAmount);
      summary.totalProvision += Number(p.provisionAmount);
      const bucket = p.agingBucket;
      if (!summary.byBucket[bucket]) {
        summary.byBucket[bucket] = {
          count: 0,
          outstanding: 0,
          provision: 0,
          rate: Number(p.provisionRate),
        };
      }
      summary.byBucket[bucket].count++;
      summary.byBucket[bucket].outstanding += Number(p.outstandingAmount);
      summary.byBucket[bucket].provision += Number(p.provisionAmount);
    }

    return summary;
  }

  /**
   * Write off a bad debt (ตัดหนี้สูญ)
   * Requires OWNER approval — writer and approver must be different persons
   */
  async writeOffBadDebt(
    contractId: string,
    writtenOffById: string,
    approvedById: string,
    notes?: string,
  ) {
    if (writtenOffById === approvedById) {
      throw new BadRequestException('ผู้ตัดหนี้สูญต้องไม่ใช่ผู้อนุมัติ');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, deletedAt: null },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');
    if (contract.status === 'CLOSED_BAD_DEBT') {
      throw new BadRequestException('สัญญานี้ถูกตัดหนี้สูญไปแล้ว');
    }

    return this.prisma.$transaction(async (tx) => {
      // Calculate outstanding amount from unpaid/partial payments
      const unpaidPayments = await tx.payment.findMany({
        where: {
          contractId,
          status: { in: ['PENDING', 'PARTIALLY_PAID'] },
          deletedAt: null,
        },
        select: { amountDue: true, amountPaid: true, lateFee: true, lateFeeWaived: true },
      });
      const outstandingAmount = unpaidPayments.reduce((sum, p) => {
        const unpaidLateFee = !p.lateFeeWaived ? Number(p.lateFee) : 0;
        return sum + Number(p.amountDue) - Number(p.amountPaid) + unpaidLateFee;
      }, 0);

      // Capture total active provision amount before updating status
      const activeProvisions = await tx.badDebtProvision.findMany({
        where: { contractId, status: 'ACTIVE', deletedAt: null },
        select: { provisionAmount: true },
      });
      const existingProvisionAmount = activeProvisions.reduce(
        (sum, p) => sum + Number(p.provisionAmount),
        0,
      );

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

      // Create double-entry journal for the write-off
      await this.journalAutoService.createBadDebtWriteOffJournal(tx, {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        writeOffAmount: outstandingAmount,
        provisionAmount: existingProvisionAmount,
        createdById: approvedById,
      });

      return { contractId, status: 'CLOSED_BAD_DEBT', writtenOffAt: new Date() };
    });
  }
}
