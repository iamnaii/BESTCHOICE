import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type DraftType = 'QUOTE' | 'CONTRACT' | 'EXPENSE' | 'OTHER_INCOME';

export interface DraftRow {
  type: DraftType;
  id: string;
  number: string;
  customerName: string | null;
  branchName: string | null;
  amount: number;
  createdBy: string | null;
  createdAt: Date;
  link: string;
}

const DRAFT_TYPES: ReadonlySet<DraftType> = new Set([
  'QUOTE',
  'CONTRACT',
  'EXPENSE',
  'OTHER_INCOME',
]);

/**
 * SP5 — Drafts hub.
 *
 * Federated read-only listing of DRAFT-status documents across 4 source
 * tables (Quote / Contract / ExpenseDocument / OtherIncome). Returns a
 * unified `DraftRow` shape so the UI can render a single tabbed table.
 *
 * Branch scoping: ExpenseDocument has `branchId`, but Quote/Contract/Sale
 * keep branch on related rows. OtherIncome scopes by `companyId` (FINANCE
 * only) — branch filter is N/A and we surface them all when no branch is
 * requested. When a `branchId` filter is set, OtherIncome rows are EXCLUDED
 * (they aren't branch-scoped at all).
 */
@Injectable()
export class DraftsService {
  constructor(private prisma: PrismaService) {}

  async findAll(opts: {
    type?: string;
    branchId?: string;
    search?: string;
    limit?: number;
  }): Promise<{ data: DraftRow[]; total: number }> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
    const filterType =
      opts.type && DRAFT_TYPES.has(opts.type as DraftType) ? (opts.type as DraftType) : null;
    const search = opts.search?.trim().toLowerCase();
    const includeQuote = !filterType || filterType === 'QUOTE';
    const includeContract = !filterType || filterType === 'CONTRACT';
    const includeExpense = !filterType || filterType === 'EXPENSE';
    const includeOtherIncome = !filterType || filterType === 'OTHER_INCOME';

    const rows: DraftRow[] = [];

    // Run all four queries in parallel for the requested types
    const promises: Promise<DraftRow[]>[] = [];
    if (includeQuote) promises.push(this.queryQuotes(opts.branchId, limit));
    if (includeContract) promises.push(this.queryContracts(opts.branchId, limit));
    if (includeExpense) promises.push(this.queryExpenses(opts.branchId, limit));
    // OtherIncome has no branchId. If caller specifies branch, skip OI entirely.
    if (includeOtherIncome && !opts.branchId) {
      promises.push(this.queryOtherIncome(limit));
    }

    const results = await Promise.all(promises);
    for (const set of results) rows.push(...set);

    // Apply search filter post-federation (low volume, simple)
    const filtered = search
      ? rows.filter(
          (r) =>
            r.number.toLowerCase().includes(search) ||
            (r.customerName ?? '').toLowerCase().includes(search),
        )
      : rows;

    // Sort newest first
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return { data: filtered.slice(0, limit), total: filtered.length };
  }

  private async queryQuotes(branchId: string | undefined, limit: number): Promise<DraftRow[]> {
    const where: Prisma.QuoteWhereInput = { deletedAt: null, status: 'DRAFT' };
    if (branchId) where.branchId = branchId;
    const quotes = await this.prisma.quote.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });
    return quotes.map((q) => ({
      type: 'QUOTE' as const,
      id: q.id,
      number: q.quoteNumber,
      customerName: q.customer?.name ?? null,
      branchName: q.branch?.name ?? null,
      amount: Number(q.total),
      createdBy: q.createdBy?.name ?? null,
      createdAt: q.createdAt,
      link: `/quotes/${q.id}`,
    }));
  }

  private async queryContracts(branchId: string | undefined, limit: number): Promise<DraftRow[]> {
    const where: Prisma.ContractWhereInput = { deletedAt: null, status: 'DRAFT' };
    if (branchId) where.branchId = branchId;
    const contracts = await this.prisma.contract.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        salesperson: { select: { name: true } },
      },
    });
    return contracts.map((c) => ({
      type: 'CONTRACT' as const,
      id: c.id,
      number: c.contractNumber,
      customerName: c.customer?.name ?? null,
      branchName: c.branch?.name ?? null,
      amount: Number(c.financedAmount),
      createdBy: c.salesperson?.name ?? null,
      createdAt: c.createdAt,
      link: `/contracts/${c.id}`,
    }));
  }

  private async queryExpenses(branchId: string | undefined, limit: number): Promise<DraftRow[]> {
    const where: Prisma.ExpenseDocumentWhereInput = { deletedAt: null, status: 'DRAFT' };
    if (branchId) where.branchId = branchId;
    const expenses = await this.prisma.expenseDocument.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });
    return expenses.map((e) => ({
      type: 'EXPENSE' as const,
      id: e.id,
      number: e.number,
      customerName: e.vendorName ?? null,
      branchName: e.branch?.name ?? null,
      amount: Number(e.totalAmount),
      createdBy: e.createdBy?.name ?? null,
      createdAt: e.createdAt,
      link: `/expenses/${e.id}`,
    }));
  }

  private async queryOtherIncome(limit: number): Promise<DraftRow[]> {
    const incomes = await this.prisma.otherIncome.findMany({
      where: { deletedAt: null, status: 'DRAFT' },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true } },
      },
    });
    return incomes.map((oi) => ({
      type: 'OTHER_INCOME' as const,
      id: oi.id,
      number: oi.docNumber,
      customerName: oi.customer?.name ?? oi.counterpartyName ?? null,
      branchName: null,
      amount: Number(oi.totalAmount),
      createdBy: null,
      createdAt: oi.createdAt,
      link: `/other-income/${oi.id}`,
    }));
  }
}
