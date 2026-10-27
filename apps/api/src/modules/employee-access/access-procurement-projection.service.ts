import { Injectable } from '@nestjs/common';
import { AccessResource, PermissionKey, canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { currentDomainAccess, currentProductReadWhere } from './access-execution-context';
import { permissionScopes } from './access-context';
import { purchaseOrderScopeWhere, supplierScopeWhere } from './access-procurement-scope';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessResourceService } from './access-resource.service';

const COST_FIELDS = new Set(['costPrice', 'costPriceMax', 'unitPrice', 'receivedCost', 'receivedVat', 'totalAmount', 'netAmount', 'vatAmount', 'discount', 'discountAfterVat', 'paidAmount', 'remaining', 'amount', 'debit', 'credit', 'balance', 'opening', 'receipts', 'payments', 'closing', 'depositsOutstanding', 'payableByAccount', 'totalPayable', 'totalPaid', 'totalOutstanding', 'totalNet', 'totalRemaining', 'grandTotal', 'totalCost', 'depositApplied', 'bookedAmount', 'paidTotal', 'remainingOnPo', 'payableOutstanding', 'depositOutstanding', 'dueWithin7Days', 'payableIncrease', 'payableDecrease', 'depositChange', 'running']);
const COST_FILES = new Set(['attachments', 'slipUrl', 'taxInvoicePhotoKey', 'photoUrl']);
@Injectable()
export class AccessProcurementProjectionService {
  constructor(private readonly sources: AccessProcurementSourceService, private readonly resources: AccessResourceService) {}
  async permitsPO(id: string, permission: PermissionKey): Promise<boolean> {
    const ctx = currentDomainAccess();
    if (!ctx) return false;
    const scope = { ...ctx.scope, permission, tuples: permissionScopes({ id: ctx.snapshot.userId, access: ctx.snapshot }, permission, ctx.scope.company) };
    return await ctx.client.purchaseOrder.count({ where: { id, ...purchaseOrderScopeWhere(scope) } }) > 0;
  }
  async receivingItem(id: string): Promise<unknown> {
    const ctx = currentDomainAccess();
    if (!ctx) return null;
    const item = await ctx.client.goodsReceivingItem.findFirst({ where: { id, deletedAt: null }, include: { receiving: true, poItem: true } });
    if (!item || !await this.permitsPO(item.receiving.poId, 'stock-receiving.read')) return null;
    return this.project(item);
  }
  async project<T>(input: T): Promise<T> {
    const ctx = currentDomainAccess();
    if (!ctx) return input;
    const costScope = { ...ctx.scope, permission: 'sensitive.cost.read' as const, tuples: permissionScopes({ id: ctx.snapshot.userId, access: ctx.snapshot }, 'sensitive.cost.read', ctx.scope.company) };
    const aggregateCost = costScope.tuples.length > 0 && await ctx.client.purchaseOrder.count({ where: { AND: [purchaseOrderScopeWhere(ctx.scope), { NOT: purchaseOrderScopeWhere(costScope) }] } }) === 0;
    const productWhere = currentProductReadWhere() ?? { id: { in: [] } };
    const readableProducts = new Map<string, boolean>();
    const permitsProduct = async (id: unknown): Promise<boolean> => {
      if (typeof id !== 'string') return false;
      if (!readableProducts.has(id)) readableProducts.set(id, await ctx.client.product.count({ where: { AND: [{ id }, productWhere] } }) > 0);
      return readableProducts.get(id) ?? false;
    };
    const cache = new Map<string, readonly AccessResource[] | null>();
    const poSource = async (id: string) => {
      if (!cache.has(id)) {
        try { cache.set(id, (await this.sources.po(ctx.client, id, ctx.scope.company)).resources); }
        catch { cache.set(id, null); }
      }
      return cache.get(id) ?? undefined;
    };
    const visit = async (value: any, inherited?: readonly AccessResource[]): Promise<any> => {
      if (value === null || typeof value !== 'object' || value instanceof Date || Prisma.Decimal.isDecimal(value) || Buffer.isBuffer(value)) return value;
      if (Array.isArray(value)) return Promise.all(value.map(item => visit(item, inherited)));
      let own = inherited;
      if (typeof value.poId === 'string') own = await poSource(value.poId) ?? own;
      if (typeof value.id === 'string') own = await poSource(value.id) ?? own;
      if (typeof value.receivingId === 'string') {
        const gr = await ctx.client.goodsReceiving.findUnique({ where: { id: value.receivingId }, select: { poId: true } });
        if (gr) own = await poSource(gr.poId) ?? own;
      }
      if (typeof value.productId === 'string' || (typeof value.id === 'string' && 'costPrice' in value)) {
        try { own = [await this.resources.product(ctx.client, value.productId ?? value.id)]; } catch { own = []; }
      }
      const cost = own ? own.length > 0 && own.every(resource => canAccess(ctx.snapshot, 'sensitive.cost.read', resource)) : aggregateCost;
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        if ((COST_FIELDS.has(key) || COST_FILES.has(key)) && !(key === 'remaining' && 'totalOrdered' in value) && !(key === 'payments' && Array.isArray(entry)) && !cost) { out[key] = Array.isArray(entry) ? [] : null; continue; }
        if (key === 'products' && Array.isArray(entry)) {
          const allowed: unknown[] = [];
          for (const product of entry) if (await permitsProduct(product?.id)) allowed.push(await visit(product, own));
          out[key] = allowed;
          continue;
        }
        if (key === 'product' && entry && typeof entry === 'object' && 'id' in entry && !await permitsProduct(entry.id)) { out[key] = null; continue; }
        if (key === 'supplier' && entry && typeof (entry as { id?: unknown }).id === 'string') {
          const scope = { ...ctx.scope, permission: 'suppliers.read' as const, tuples: permissionScopes({ id: ctx.snapshot.userId, access: ctx.snapshot }, 'suppliers.read', ctx.scope.company) };
          if (!await ctx.client.supplier.count({ where: { id: (entry as { id: string }).id, ...supplierScopeWhere(scope) } })) { out[key] = null; continue; }
        }
        if ((key === 'overdue' && 'dueWithin7Days' in value || key === 'description' && 'entryNumber' in value) && !cost) { out[key] = null; continue; }
        if (key === 'repossession' && !ctx.snapshot.isOwner) { out[key] = null; continue; }
        if (key === 'receivingItems' && (!own?.length || !own.every(resource => canAccess(ctx.snapshot, 'stock-receiving.read', resource)))) { out[key] = []; continue; }
        if (key === 'claimed' && !ctx.snapshot.isOwner) { out[key] = []; continue; }
        if (key === 'po' && entry && typeof (entry as { id?: unknown }).id === 'string' && !await this.permitsPO((entry as { id: string }).id, 'purchase-orders.read')) { out[key] = null; continue; }
        if (key === 'goodsReceivings' && typeof value.id === 'string' && !await this.permitsPO(value.id, 'stock-receiving.read')) { out[key] = []; continue; }
        out[key] = await visit(entry, own);
      }
      return out;
    };
    return visit(input);
  }
}
