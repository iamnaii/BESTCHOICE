import { contractNavigation } from './access-contract-read-scope';
import { saleAggregateWhere } from './access-sales-aggregate-context';
import { Injectable } from '@nestjs/common';
import { AccessResource, canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { currentDomainAccess } from './access-execution-context';
import { AccessResourceService } from './access-resource.service';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { saleSource, bookingSource } from './access-sales-scope';
import { tradeInSource } from './access-trade-in-scope';

@Injectable()
export class AccessSalesProjectionService {
  constructor(
    private readonly resources: AccessResourceService,
    private readonly parties: AccessTradeInProjectionService,
  ) {}
  async project<T>(value: T, kind: 'sale' | 'booking', sourceId?: string): Promise<T> {
    const ctx = currentDomainAccess();
    if (!ctx) return value;
    const source = async (id: string, type: 'sale' | 'booking') =>
      (type === 'sale' ? saleSource(ctx.client, id) : bookingSource(ctx.client, id)).catch(
        () => null,
      );
    const product = async (id: string) => this.resources.product(ctx.client, id).catch(() => null);
    const walk = async (input: unknown, origin: AccessResource | null = null): Promise<unknown> => {
      if (Array.isArray(input)) return Promise.all(input.map((v) => walk(v, origin)));
      if (
        !input ||
        typeof input !== 'object' ||
        input instanceof Date ||
        input instanceof Prisma.Decimal
      )
        return input;
      const row = input as Record<string, unknown>,
        out = { ...row };
      if (typeof row.id === 'string' && (row.saleNumber || row.bookingNumber))
        origin = await source(row.id, row.saleNumber ? 'sale' : 'booking');
      const permits = (p: 'sensitive.cost.read' | 'sensitive.profit.read') =>
        !!origin && canAccess(ctx.snapshot, p, origin);
      if (!permits('sensitive.cost.read'))
        for (const key of ['costSnapshot', 'costPriceSnapshot', 'mainProductCost', 'costPrice'])
          if (key in out) out[key] = null;
      if (!permits('sensitive.profit.read') || !permits('sensitive.cost.read'))
        for (const key of ['totalProfit', 'profit', 'margin', 'missingCostCount'])
          if (key in out) out[key] = null;
      // A link needs independent current FINANCE authority, preserving SHOP source.
      if ('contractId' in out || 'contract' in out) {
        const persisted = typeof row.id === 'string' && row.saleNumber
          ? await ctx.client.sale.findUnique({ where: { id: row.id }, select: { contractId: true } })
          : null;
        const linked = persisted?.contractId ? await contractNavigation(persisted.contractId) : null;
        out.contractId = linked?.id ?? null;
        out.contract = linked;
      }
      // Other links still belong to independently owned consumer boundaries.
      for (const key of [
        'financeReceivable',
        'commissions',
        'sourceRoomId',
        'onlineOrderId',
        'onlineOrder',
      ])
        if (key in out) out[key] = null;
      delete out._loyaltyRedemptionFailed;
      if (
        typeof row.customerId === 'string' &&
        !(await this.parties.partyAllows(
          ctx.client,
          ctx.snapshot,
          row.customerId,
          'customerId',
          'customers.read',
        ))
      ) {
        out.customerId = null;
        out.customer = null;
      }
      for (const key of ['productId', 'lockedProductId'])
        if (typeof row[key] === 'string') {
          const own = await product(row[key] as string);
          if (!own || !canAccess(ctx.snapshot, 'products.read', own)) {
            out[key] = null;
            if (key === 'productId') out.product = null;
          }
        }
      if (Array.isArray(row.bundleProductIds))
        out.bundleProductIds = (
          await Promise.all(
            row.bundleProductIds.map(async (id) => {
              if (typeof id !== 'string') return null;
              const own = await product(id);
              return own && canAccess(ctx.snapshot, 'products.read', own) ? id : null;
            }),
          )
        ).filter(Boolean);
      if (out.product && typeof out.product === 'object') {
        const p = out.product as Record<string, unknown>;
        const id =
          typeof row.productId === 'string'
            ? row.productId
            : typeof p.id === 'string'
              ? p.id
              : undefined;
        const own = id ? await product(id) : null;
        out.product =
          own && canAccess(ctx.snapshot, 'products.read', own) ? await walk(p, own) : null;
      }
      if (out.tradeInCreditSnapshot && typeof out.tradeInCreditSnapshot === 'object') {
        const credit = out.tradeInCreditSnapshot as Record<string, unknown>;
        const own =
          typeof credit.tradeInId === 'string'
            ? await tradeInSource(ctx.client, credit.tradeInId).catch(() => null)
            : null;
        out.tradeInCreditSnapshot =
          own && canAccess(ctx.snapshot, 'trade-in.read', own)
            ? await this.parties.project(credit, credit.tradeInId as string)
            : null;
        if (
          out.tradeInCreditSnapshot &&
          own &&
          !canAccess(ctx.snapshot, 'sensitive.cost.read', own)
        ) {
          const hidden = out.tradeInCreditSnapshot as Record<string, unknown>;
          for (const key of ['baseAmount', 'bonusAmount', 'cashDownAmount', 'totalDownAmount'])
            hidden[key] = null;
        }
      }
      if (out.booking && typeof out.booking === 'object') {
        const id = (out.booking as { id?: string }).id;
        const own = id ? await source(id, 'booking') : null;
        if (!own || !canAccess(ctx.snapshot, 'bookings.read', own)) {
          out.booking = null;
          out.receiptBreakdown = null;
        }
      }
      if (typeof row.convertedToSaleId === 'string') {
        const own = await source(row.convertedToSaleId, 'sale');
        if (!own || !canAccess(ctx.snapshot, 'sales.read', own)) {
          out.convertedToSaleId = null;
          out.convertedToSale = null;
        }
      }
      // Audit JSON can contain old customer/product IDs. It is not a source grant.
      if (Array.isArray(out.events))
        out.events = out.events.map((event) => ({ ...(event as object), data: null }));
      for (const key of ['data', 'sales', 'sale', 'items'])
        if (out[key]) out[key] = await walk(out[key], origin);
      if (out.summary && typeof out.summary === 'object') {
        const summary = { ...(out.summary as Record<string, unknown>) };
        const where = saleAggregateWhere(out.summary);
        const rows = where ? await ctx.client.sale.findMany({ where, select: { id: true } }) : [];
        // Missing query-owned context cannot authorize a monetary aggregate.
        let allowed = !!where;
        for (const row of rows) {
          const own = await source(row.id, 'sale');
          if (
            !own ||
            !canAccess(ctx.snapshot, 'sensitive.cost.read', own) ||
            !canAccess(ctx.snapshot, 'sensitive.profit.read', own)
          ) {
            allowed = false;
            break;
          }
        }
        if (!allowed) {
          summary.totalProfit = null;
          summary.missingCostCount = null;
        }
        out.summary = summary;
      }
      return out;
    };
    // POS suggestions are current product records, not sale provenance.
    if (
      Array.isArray(value) &&
      value.some((v) => v && typeof v === 'object' && 'count' in v && 'id' in v)
    ) {
      const filtered: Array<{ id: string }> = [];
      for (const row of value as Array<{ id: string }>) {
        const own = await product(row.id);
        if (own && canAccess(ctx.snapshot, 'products.read', own)) filtered.push(row);
      }
      return filtered as T;
    }
    return (await walk(value, sourceId ? await source(sourceId, kind) : null)) as T;
  }
}
