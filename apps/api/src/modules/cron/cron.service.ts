import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Calculate late fees for all overdue payments ─────
  // SPEC: late_fee = MIN(days_overdue × 100, 200) per installment
  async calculateLateFees() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Get system config for late fee params
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: ['late_fee_per_day', 'late_fee_cap'] } },
    });
    const getConfig = (key: string, def: number) =>
      parseFloat(configs.find((c) => c.key === key)?.value || String(def));

    const feePerDay = getConfig('late_fee_per_day', 100);
    const feeCap = getConfig('late_fee_cap', 200);

    // Find all unpaid payments past due date on ACTIVE/OVERDUE contracts
    const overduePayments = await this.prisma.payment.findMany({
      where: {
        dueDate: { lt: now },
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        contract: { status: { in: ['ACTIVE', 'OVERDUE'] }, deletedAt: null },
      },
      include: {
        contract: { select: { id: true, status: true } },
      },
    });

    let updated = 0;
    for (const payment of overduePayments) {
      const dueDate = new Date(payment.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysOverdue <= 0) continue;

      const lateFee = Math.min(daysOverdue * feePerDay, feeCap);
      const currentFee = Number(payment.lateFee);

      // Only update if fee changed
      if (lateFee !== currentFee) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            lateFee,
            status: 'OVERDUE',
          },
        });
        updated++;
      }
    }

    this.logger.log(`Late fees calculated: ${updated} payments updated out of ${overduePayments.length} overdue`);
    return { processed: overduePayments.length, updated };
  }

  // ─── Update contract statuses based on payment state ──
  // - Late > 7 days on any payment → OVERDUE
  // - 2 consecutive unpaid installments → DEFAULT
  async updateContractStatuses() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Get system config for thresholds
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: ['overdue_days_threshold', 'default_consecutive_months'] } },
    });
    const getConfig = (key: string, def: number) =>
      parseInt(configs.find((c) => c.key === key)?.value || String(def), 10);

    const overdueDaysThreshold = getConfig('overdue_days_threshold', 7);
    const defaultConsecutiveMonths = getConfig('default_consecutive_months', 2);

    // Get all ACTIVE contracts (exclude soft-deleted)
    const activeContracts = await this.prisma.contract.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      include: {
        payments: { orderBy: { installmentNo: 'asc' } },
      },
    });

    let overdueCount = 0;
    let defaultCount = 0;

    for (const contract of activeContracts) {
      const unpaidPayments = contract.payments.filter(
        (p) => p.status !== 'PAID' && new Date(p.dueDate) < now,
      );

      if (unpaidPayments.length === 0) continue;

      // Check for DEFAULT: 2+ consecutive unpaid
      let consecutive = 0;
      let maxConsecutive = 0;
      const sortedPayments = contract.payments.sort((a, b) => a.installmentNo - b.installmentNo);

      for (const p of sortedPayments) {
        if (p.status !== 'PAID' && new Date(p.dueDate) < now) {
          consecutive++;
          maxConsecutive = Math.max(maxConsecutive, consecutive);
        } else {
          consecutive = 0;
        }
      }

      if (maxConsecutive >= defaultConsecutiveMonths) {
        await this.prisma.contract.update({
          where: { id: contract.id },
          data: { status: 'DEFAULT' },
        });
        defaultCount++;
        continue;
      }

      // Check for OVERDUE: any payment > threshold days late
      const oldestUnpaid = unpaidPayments[0];
      const dueDate = new Date(oldestUnpaid.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const daysLate = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysLate > overdueDaysThreshold) {
        await this.prisma.contract.update({
          where: { id: contract.id },
          data: { status: 'OVERDUE' },
        });
        overdueCount++;
      }
    }

    // Also check OVERDUE contracts for DEFAULT escalation
    const overdueContracts = await this.prisma.contract.findMany({
      where: { status: 'OVERDUE', deletedAt: null },
      include: {
        payments: { orderBy: { installmentNo: 'asc' } },
      },
    });

    for (const contract of overdueContracts) {
      let consecutive = 0;
      let maxConsecutive = 0;

      for (const p of contract.payments) {
        if (p.status !== 'PAID' && new Date(p.dueDate) < now) {
          consecutive++;
          maxConsecutive = Math.max(maxConsecutive, consecutive);
        } else {
          consecutive = 0;
        }
      }

      if (maxConsecutive >= defaultConsecutiveMonths) {
        await this.prisma.contract.update({
          where: { id: contract.id },
          data: { status: 'DEFAULT' },
        });
        defaultCount++;
      }
    }

    this.logger.log(`Contract status update: ${overdueCount} → OVERDUE, ${defaultCount} → DEFAULT`);
    return { overdueCount, defaultCount };
  }

  // ─── Run all cron tasks ───────────────────────────────
  async runDailyTasks() {
    const lateFeeResult = await this.calculateLateFees();
    const statusResult = await this.updateContractStatuses();
    return { lateFees: lateFeeResult, statuses: statusResult, runAt: new Date() };
  }
}
