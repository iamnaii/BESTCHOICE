import { Injectable } from '@nestjs/common';
import { AccessResource, PermissionKey, canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { currentDomainAccess } from './access-execution-context';
import { AccessResourceService } from './access-resource.service';
import { productScopeWhere } from './access-query-scope';
import { permissionScopes } from './access-context';

/** Field classifications belong to their source adapter, never to a position name.
 * Salary is deliberately absent: Customer.salary is income, not employee payroll.
 */
export const PRODUCT_COST_FIELDS = new Set(['costPrice', 'costPriceMax', 'lastCost', 'totalValue', 'value', 'totalCost', 'unitPrice', 'purchasePrice']);
export const PRODUCT_PROFIT_FIELDS = new Set(['margin', 'profit', 'totalMargin', 'avgMarginPct', 'avgMarginPerUnit', 'marginOverview']);
@Injectable()
export class AccessSensitiveService {
  constructor(private readonly resources: AccessResourceService) {}
  /** Aggregate values/order can be disclosed only if every contributing source is visible.
   * Checks the entire authorized query domain, conservatively including extra filters.
   */
  async permitsProductAggregate(permission: PermissionKey, filter: Prisma.ProductWhereInput = {}): Promise<boolean> {
    const ctx = currentDomainAccess();
    if (!ctx) return false;
    if (ctx.snapshot.isOwner) return true;
    const sensitive = { ...ctx.scope, permission, tuples: permissionScopes({ id: ctx.snapshot.userId, access: ctx.snapshot }, permission, ctx.scope.company) };
    if (!sensitive.tuples.some(tuple => tuple.scope === 'COMPANY' || (tuple.scope === 'BRANCHES' && tuple.branchIds.length))) return false;
    return await ctx.client.product.count({ where: { AND: [filter, productScopeWhere(ctx.scope), { NOT: productScopeWhere(sensitive) }] } }) === 0;
  }
  async projectProductResult<T>(input: T, source?: AccessResource): Promise<T> {
    const ctx = currentDomainAccess();
    if (!ctx || ctx.snapshot.isOwner) return input;
    const aggregateCost = await this.permitsProductAggregate('sensitive.cost.read');
    const aggregateProfit = await this.permitsProductAggregate('sensitive.profit.read');
    const sources = new Map<string, AccessResource | null>();
    const resolve = async (id: string) => {
      if (!sources.has(id)) {
        try { sources.set(id, await this.resources.product(ctx.client, id)); } catch { sources.set(id, null); }
      }
      return sources.get(id) ?? undefined;
    };
    const visit = async (value: any, inherited?: AccessResource): Promise<any> => {
      if (value === null || typeof value !== 'object' || value instanceof Date || Prisma.Decimal.isDecimal(value) || Buffer.isBuffer(value)) return value;
      if (Array.isArray(value)) return Promise.all(value.map(item => visit(item, inherited)));
      let own = inherited;
      if (typeof value.branch?.id === 'string') own = { company: ctx.scope.company, branchId: value.branch.id };
      if (typeof value.id === 'string') own = await resolve(value.id) ?? inherited;
      if (typeof value.productId === 'string') own = await resolve(value.productId) ?? own;
      const cost = own ? canAccess(ctx.snapshot, 'sensitive.cost.read', own) : aggregateCost;
      const profit = own ? canAccess(ctx.snapshot, 'sensitive.profit.read', own) : aggregateProfit;
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (PRODUCT_COST_FIELDS.has(key) && !cost) { out[key] = null; continue; }
        if (PRODUCT_PROFIT_FIELDS.has(key) && !profit) { out[key] = null; continue; }
        // Independently scoped source details are provided by later domain adapters.
        // Do not infer FINANCE contract/booking/PO authority from product access.
        if (key === 'po' && entry && typeof (entry as any).id === 'string') {
          const products = await ctx.client.product.findMany({ where: { poId: (entry as any).id }, select: { id: true } });
          const origins = await Promise.all(products.map(product => resolve(product.id)));
          if (origins.length && origins.every(origin => origin && canAccess(ctx.snapshot, 'purchase-orders.read', origin))) {
            out[key] = await visit(entry, own);
            continue;
          }
        }
        if (['activeContract', 'lockedByBookings', 'po', 'receivingItem'].includes(key)) {
          out[key] = Array.isArray(entry) ? [] : null;
          continue;
        }
        out[key] = await visit(entry, own);
      }
      return out;
    };
    const result = await visit(input, source);
    // Avoid exposing cost ranking after masking the values used to order it.
    if (!aggregateCost && Array.isArray(result?.valueByStatus)) result.valueByStatus.sort((a: any, b: any) => String(a.status).localeCompare(String(b.status)));
    return result;
  }
}
