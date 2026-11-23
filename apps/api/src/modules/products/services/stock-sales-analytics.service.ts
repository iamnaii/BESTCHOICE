import { completedSaleWhere } from '../../sales/services/completed-sale-policy';
import { salesBranchWhere } from '../../sales/services/sales-read-policy';
import { Prisma } from '@prisma/client';
import type { StockInventoryScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { readSaleOrigins } from '../../../cli/tooltify-cutover/plan-targets';
import { bkkYearMonth } from '../../../utils/date.util';
import {
  currentProductReadWhere,
  currentDomainAccess,
  currentPermissionScope,
} from '../../employee-access/access-execution-context';
import {
  importedCompanyAllows,
  assertImportedSource,
} from '../../employee-access/access-imported-source';
import { inventorySaleScopeWhere } from '../../employee-access/access-inventory-scope';

const importedDevices = new Set([
  'iPhone มือ 1',
  'iPhone มือ 2',
  'iPhone มือ 2 (เครื่องนอก)',
  'iPad มือ 1',
]);
type Kind = 'devices' | 'accessories' | 'unknown';
type Event = {
  source: 'native' | 'imported';
  date: Date;
  kind: Kind;
  name: string | null;
  amount: Prisma.Decimal;
  gift: boolean;
};
const nativeKind = (category: string): Kind =>
  ['PHONE_NEW', 'PHONE_USED', 'TABLET'].includes(category)
    ? 'devices'
    : category === 'ACCESSORY'
      ? 'accessories'
      : 'unknown';
const importedKind = (category: string): Kind =>
  importedDevices.has(category.trim())
    ? 'devices'
    : category.trim() === 'Accessories'
      ? 'accessories'
      : 'unknown';

export type StockSalesActor = {
  id?: string;
  role: string;
  branchId?: string | null;
  access?: { managed: boolean };
};
export function stockAnalyticsWindow(asOf: Date) {
  const key = bkkYearMonth(asOf);
  const [year, month] = key.split('-').map(Number);
  return {
    key,
    year,
    month,
    start: new Date(Date.UTC(year, month - 6, 1) - 7 * 3600000),
    startMonth: new Date(Date.UTC(year, month - 1, 1) - 7 * 3600000),
  };
}
/** Read-only sales events, never Product.updatedAt: one device can be sold repeatedly. */
export class StockSalesAnalyticsService {
  constructor(private readonly base: PrismaService) {}

  async read(
    branchId: string | undefined,
    scope: StockInventoryScope,
    asOf: Date,
    actor?: StockSalesActor,
  ) {
    const ctx = currentDomainAccess();
    const db = ctx?.client ?? this.base;
    const nativeScope = currentPermissionScope('sales.read');
    // No domain context is also a real legacy HTTP path. Never treat it as an owner.
    const legacy = !ctx && actor && !actor.access?.managed ? actor : undefined;
    const nativeIncluded = ctx
      ? !!nativeScope?.tuples.length && ctx.scope.company === 'SHOP'
      : !!legacy &&
        ['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'SALES'].includes(legacy.role);
    const importedIncluded = ctx
      ? importedCompanyAllows('imported-sales.read')
      : !!legacy && ['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER'].includes(legacy.role);
    const { key, year, month, start, startMonth } = stockAnalyticsWindow(asOf);
    const previousKey = bkkYearMonth(new Date(startMonth.getTime() - 1));
    const events: Event[] = [];
    if (nativeIncluded) {
      const sales = await db.sale.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: start, lte: asOf },
          ...(ctx
            ? branchId
              ? { branchId }
              : {}
            : salesBranchWhere({ ...legacy!, id: legacy?.id ?? '' }, branchId)),
          AND: [
            completedSaleWhere,
            ...(ctx
              ? [inventorySaleScopeWhere(ctx.scope), inventorySaleScopeWhere(nativeScope!)]
              : []),
          ],
        },
        select: {
          id: true,
          createdAt: true,
          netAmount: true,
          bundleProductIds: true,
          product: { select: { id: true, category: true } },
        },
      });
      const bundleIds = [...new Set(sales.flatMap((s) => s.bundleProductIds))];
      // These product references are reached through authorized historical sale records.
      // Their current branch/status may have changed; never use current stock to scope a sale.
      const bundles = bundleIds.length
        ? await db.product.findMany({
            where: { id: { in: bundleIds } },
            select: { id: true, category: true },
          })
        : [];
      const productIds = [...new Set([...sales.map((s) => s.product.id), ...bundleIds])];
      const visibleProducts = productIds.length
        ? await db.product.findMany({
            where: {
              id: { in: productIds },
              deletedAt: null,
              AND: currentProductReadWhere() ?? {},
            },
            select: { id: true, brand: true, model: true, name: true },
          })
        : [];
      const visibleById = new Map(visibleProducts.map((p) => [p.id, p]));
      const byId = new Map(bundles.map((p) => [p.id, p]));
      for (const sale of sales) {
        const kind = nativeKind(sale.product.category);
        events.push({
          source: 'native',
          date: sale.createdAt,
          kind,
          name: visibleById.has(sale.product.id)
            ? `${visibleById.get(sale.product.id)!.brand} ${visibleById.get(sale.product.id)!.model}`
            : null,
          amount: sale.netAmount,
          gift: kind === 'accessories' && sale.netAmount.isZero(),
        });
        for (const id of new Set(sale.bundleProductIds)) {
          const product = byId.get(id);
          events.push({
            source: 'native',
            date: sale.createdAt,
            kind: product ? nativeKind(product.category) : 'unknown',
            name: visibleById.get(id)?.name ?? null,
            amount: new Prisma.Decimal(0),
            gift: true,
          });
        }
      }
    }
    let unattributedCount = 0;
    if (importedIncluded) {
      if (ctx) await assertImportedSource();
      const rows = await db.importedSale.findMany({
        where: { source: 'TOOLTIFY', soldAt: { gte: start, lte: asOf } },
        select: {
          id: true,
          barcode: true,
          orderNumber: true,
          importBatch: true,
          sourceOccurrence: true,
          soldAt: true,
          category: true,
          productName: true,
          salePrice: true,
        },
      });
      const origins = await readSaleOrigins(db, rows);
      const branchTuples = ctx?.scope.tuples.filter((t) => t.userId === ctx.scope.userId) ?? [];
      const companyAccess = !ctx || branchTuples.some((t) => t.scope === 'COMPANY');
      const permittedBranches = new Set(
        branchTuples.flatMap((t) => (t.scope === 'BRANCHES' ? [...t.branchIds] : [])),
      );
      const liveBranches = await db.branch.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
        },
        select: { id: true },
      });
      const validBranches = new Set(liveBranches.map((b) => b.id));
      for (const row of rows) {
        const origin = origins.get(row.id);
        if (!origin) {
          if (companyAccess && !branchId) unattributedCount++;
          continue;
        }
        if (
          !validBranches.has(origin.branchId) ||
          (branchId && origin.branchId !== branchId) ||
          (!companyAccess && !permittedBranches.has(origin.branchId))
        )
          continue;
        const kind = importedKind(row.category);
        events.push({
          source: 'imported',
          date: row.soldAt,
          kind,
          name: row.productName,
          amount: row.salePrice,
          gift: kind === 'accessories' && row.salePrice.isZero(),
        });
      }
    }
    // The cutover writer writes ONLY ImportedSale, never Sale; distinct events are
    // identified by their source row, not their barcode (including sourceOccurrence).
    const selected = events
      .filter((e) => scope === 'all' || e.kind === scope)
      .map((e) => ({ ...e, monthKey: bkkYearMonth(e.date) }));
    const summarize = (monthKey: string) => {
      const rows = selected.filter((e) => e.monthKey === monthKey);
      return {
        count: rows.length,
        nativeCount: rows.filter((e) => e.source === 'native').length,
        importedCount: rows.filter((e) => e.source === 'imported').length,
        giftCount: rows.filter((e) => e.gift).length,
        unknownCount: rows.filter((e) => e.kind === 'unknown').length,
        revenue: rows.reduce((total, e) => total.plus(e.amount), new Prisma.Decimal(0)).toString(),
      };
    };
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const date = new Date(Date.UTC(year, month - 6 + i, 1) - 7 * 3600000);
      const monthKey = bkkYearMonth(date);
      return { key: monthKey, ...summarize(monthKey) };
    });
    const sellers = new Map<string, number>();
    for (const e of selected)
      if (e.name !== null) sellers.set(e.name, (sellers.get(e.name) ?? 0) + 1);
    return {
      asOf: asOf.toISOString(),
      month: key,
      startDate: startMonth.toISOString(),
      nativeIncluded,
      importedIncluded,
      unattributedCount,
      current: summarize(key),
      previous: summarize(previousKey),
      monthly,
      topSellers: [...sellers]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }
}
