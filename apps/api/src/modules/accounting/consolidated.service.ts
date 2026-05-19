import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingService } from './accounting.service';

/**
 * SP7.6 — Cross-entity (SHOP+FINANCE) consolidated reports for OWNER + ACCOUNTANT.
 *
 * For now operates on a single Prisma DB (both companies still co-exist).
 * Post-cutover (SP7.7+) this will fan-out to both PrismaService + PrismaFinanceService
 * and combine results in-memory.
 *
 * getTrialBalance returns { sections, grandDrTotal, grandCrTotal } per scope.
 * getProfitLossFromJournal returns { revenue, expenses, netIncome, perScope, ... } per scope.
 * ConsolidatedService uses scope='ALL' (single-call) or two scoped calls and merges.
 */
@Injectable()
export class ConsolidatedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  /**
   * Combined trial balance — SHOP + FINANCE accounts merged by code, Dr/Cr summed.
   * Uses scope='ALL' (single DB call) and returns flat account list suitable for
   * OWNER cross-entity view.
   */
  async getConsolidatedTrialBalance(asOfDate?: Date) {
    const tb = await this.accounting.getTrialBalance(asOfDate, 'ALL');

    // Flatten sections → per-account map → merge duplicates (shouldn't exist with
    // code-prefix partitioning but guard against misposted JEs)
    const merged = new Map<
      string,
      {
        code: string;
        name: string;
        type: string;
        normalBalance: string;
        drBalance: Prisma.Decimal;
        crBalance: Prisma.Decimal;
        netBalance: Prisma.Decimal;
        codePrefix: string;
      }
    >();

    for (const section of tb.sections) {
      for (const row of section.rows) {
        const existing = merged.get(row.code);
        if (existing) {
          existing.drBalance = existing.drBalance.add(row.drBalance);
          existing.crBalance = existing.crBalance.add(row.crBalance);
          existing.netBalance = existing.netBalance.add(row.netBalance);
        } else {
          merged.set(row.code, {
            code: row.code,
            name: row.name,
            type: row.type,
            normalBalance: row.normalBalance,
            drBalance: new Prisma.Decimal(row.drBalance),
            crBalance: new Prisma.Decimal(row.crBalance),
            netBalance: new Prisma.Decimal(row.netBalance),
            codePrefix: section.codePrefix,
          });
        }
      }
    }

    const accounts = Array.from(merged.values()).sort((a, b) =>
      a.code.localeCompare(b.code),
    );

    // Recompute grand totals from merged accounts (tb.grandDrTotal / tb.grandCrTotal
    // already include both scopes, but recompute for consistency)
    let grandDrTotal = new Prisma.Decimal(0);
    let grandCrTotal = new Prisma.Decimal(0);
    for (const acc of accounts) {
      grandDrTotal = grandDrTotal.add(acc.drBalance);
      grandCrTotal = grandCrTotal.add(acc.crBalance);
    }

    return {
      scope: 'CONSOLIDATED' as const,
      asOfDate: asOfDate ?? new Date(),
      accounts,
      grandDrTotal,
      grandCrTotal,
      isBalanced: grandDrTotal.sub(grandCrTotal).abs().lte(new Prisma.Decimal('0.01')),
    };
  }

  /**
   * Consolidated P&L with eliminating entries to avoid double-counting intercompany.
   *
   * Uses scope='ALL' (single-call) which already sums SHOP + FINANCE codes.
   * Elimination rule (v1): subtract intercompany commission (totalAmount) from
   * `inter_company_transactions` to prevent SHOP commission income / FINANCE
   * commission expense being double-counted in consolidated view.
   */
  async getConsolidatedProfitLoss(start: Date, end: Date) {
    // Single call with scope='ALL' — includes both SHOP and FINANCE accounts.
    // perScope sub-totals give the per-entity breakdown without a second query.
    const pl = await this.accounting.getProfitLossFromJournal(start, end, undefined, 'ALL');

    const eliminations = await this.calcIntercompanyEliminations(start, end);

    // Consolidated net = combined netIncome minus eliminations (avoid double-count)
    const consolidatedNetIncome = pl.netIncome.sub(eliminations.amount);

    return {
      scope: 'CONSOLIDATED' as const,
      periodStart: start,
      periodEnd: end,
      // Full merged P&L (both entities combined)
      revenue: pl.revenue,
      expenses: pl.expenses,
      netIncome: pl.netIncome,
      // Per-entity breakdown from perScope subtotals
      perEntity: {
        shop: pl.perScope.shop,
        finance: pl.perScope.finance,
      },
      // Eliminating entries (intercompany commission flows)
      eliminations,
      // Consolidated bottom line after eliminations
      consolidatedNetIncome,
    };
  }

  /**
   * Combined dashboard KPIs for current month.
   * Returns MTD P&L per entity + consolidated net.
   */
  async getConsolidatedDashboard(asOfDate?: Date) {
    const now = asOfDate ?? new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const pl = await this.accounting
      .getProfitLossFromJournal(monthStart, now, undefined, 'ALL')
      .catch(() => null);

    const eliminations = await this.calcIntercompanyEliminations(monthStart, now);

    return {
      asOf: now.toISOString(),
      periodStart: monthStart.toISOString(),
      monthToDate: pl
        ? {
            shop: pl.perScope.shop,
            finance: pl.perScope.finance,
            combinedNetIncome: pl.netIncome,
            eliminations,
            consolidatedNetIncome: pl.netIncome.sub(eliminations.amount),
          }
        : null,
    };
  }

  /**
   * Returns net intercompany amount to eliminate in consolidation.
   * Source of truth = `inter_company_transactions` (created at contract activation).
   * Elimination = sum of `totalAmount` (principal + commission that Finance pays Shop).
   */
  private async calcIntercompanyEliminations(start: Date, end: Date) {
    const txs = await this.prisma.interCompanyTransaction
      .findMany({
        where: {
          createdAt: { gte: start, lte: end },
          deletedAt: null,
        },
        select: { id: true, totalAmount: true, commission: true, principal: true },
      })
      .catch(() => [] as { id: string; totalAmount: Prisma.Decimal; commission: Prisma.Decimal; principal: Prisma.Decimal }[]);

    let totalAmount = new Prisma.Decimal(0);
    let commissionTotal = new Prisma.Decimal(0);
    for (const tx of txs) {
      totalAmount = totalAmount.add(new Prisma.Decimal(tx.totalAmount ?? 0));
      commissionTotal = commissionTotal.add(new Prisma.Decimal(tx.commission ?? 0));
    }

    return {
      amount: commissionTotal, // commission is the intercompany flow to eliminate
      totalTransferred: totalAmount,
      count: txs.length,
      note: 'ค่าคอมมิชชั่น SHOP↔FINANCE — ตัดรายการระหว่างกันเพื่อป้องกัน double-count',
    };
  }
}
