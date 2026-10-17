import { inventoryBranchWhere, inventorySaleScopeWhere, inventoryTransferWhere, stockCountScopeWhere } from './access-inventory-scope';
import { purchaseOrderScopeWhere, supplierScopeWhere } from './access-procurement-scope';
import { permissionScopes } from './access-context';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import { AccessSnapshot } from '@installment/shared';
import { PermissionKey } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionScope } from './access-policy.registry';
import { productScopeSql, productScopeWhere, scopeWhere, inspectionTemplateScopeWhere, inspectionScopeWhere } from './access-query-scope';

export interface DomainAccessExecution {
  readonly snapshot: AccessSnapshot;
  readonly scope: CollectionScope;
  readonly client: Prisma.TransactionClient;
  readonly scopeReads: boolean;
  readonly authorizedProductIds?: readonly string[];
  readonly domain?: 'procurement' | 'inventory' | 'adjustments' | 'trade-in';
  readonly receivingBranchId?: string;
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
  readonly effects?: { commit: Array<() => Promise<void>>; rollback: Array<() => Promise<void>> };
}
export const domainAccessExecution = new AsyncLocalStorage<DomainAccessExecution>();
export function currentDomainAccess(): DomainAccessExecution | undefined { return domainAccessExecution.getStore(); }
export function currentPermissionScope(permission: PermissionKey): CollectionScope | undefined {
  const ctx = currentDomainAccess();
  return ctx ? { ...ctx.scope, permission, tuples: permissionScopes({ id: ctx.snapshot.userId, access: ctx.snapshot }, permission, ctx.scope.company) } : undefined;
}
/** Independent product expansion/count predicate; never inherit the parent action. */
export function currentProductReadWhere(): Prisma.ProductWhereInput | undefined {
  const scope = currentPermissionScope('products.read');
  if (!scope) return undefined;
  const usable = scope.tuples.some(tuple => tuple.userId === scope.userId && (tuple.scope === 'COMPANY' || tuple.scope === 'BRANCHES' && tuple.branchIds.length > 0));
  return usable ? { deletedAt: null, AND: [productScopeWhere(scope)] } : { id: { in: [] } };
}

/** Effects are owned by the OUTER transaction attempt. Never run a success effect
 * after a nested callback has merely joined it. Callbacks run outside its context. */
export function onDomainCommit(effect: () => Promise<void>): void {
  const effects = currentDomainAccess()?.effects;
  if (!effects) throw new Error('Domain commit effect requires an owned execution');
  effects.commit.push(effect);
}
export function onDomainRollback(effect: () => Promise<void>): void {
  const effects = currentDomainAccess()?.effects;
  if (!effects) throw new Error('Domain rollback effect requires an owned execution');
  effects.rollback.push(effect);
}
export function currentProductScopeSql(alias: 'p' | 'p2' = 'p'): Prisma.Sql {
  const execution = currentDomainAccess();
  return execution ? productScopeSql(execution.scope, alias) : Prisma.sql`TRUE`;
}
export function transferScopeWhere(scope: CollectionScope): Prisma.StockTransferWhereInput {
  return { AND: [
    { product: productScopeWhere({ ...scope, tuples: [{ scope: 'COMPANY', branchIds: [], userId: scope.userId }] }) },
    scopeWhere<Prisma.StockTransferWhereInput>(scope, {
      company: () => ({ deletedAt: null }),
      branch: ids => ({ OR: [{ fromBranchId: { in: [...ids] } }, { toBranchId: { in: [...ids] } }] }),
    }) as Prisma.StockTransferWhereInput,
  ] };
}
/** Explicit domain-only client adapter. Other modules continue using their injected client.
 * The enclosing execution owns the transaction. Nested domain transactions join it; no
 * nested state machine may commit separately. Collection reads use the same predicates
 * for find/count/groupBy/aggregate. Raw SQL must opt in through currentProductScopeSql.
 */
const joinedClients = new WeakMap<object, Prisma.TransactionClient>();
export function isCurrentDomainClient(client: object): boolean {
  const ctx = currentDomainAccess();
  return !!ctx && (client === ctx.client || joinedClients.get(client) === ctx.client);
}
export function domainAccessClient(base: PrismaService): PrismaService {
  const execution = currentDomainAccess();
  if (!execution) return base;
  const tx = execution.client;
  const scope = execution.scope;
  const product = { AND: [productScopeWhere(scope), execution.authorizedProductIds ? { id: { in: [...execution.authorizedProductIds] } } : {}] };
  const procurement = purchaseOrderScopeWhere(execution.domain === 'procurement' ? scope : { ...scope, permission: 'purchase-orders.read', tuples: permissionScopes({ id: scope.userId, access: execution.snapshot }, 'purchase-orders.read', scope.company) });
  const readOperations = new Set(['findMany', 'findFirst', 'findUnique', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
  const scopedPredicates = {
    product,
    inspectionTemplate: inspectionTemplateScopeWhere(scope),
    stockTransfer: execution.domain === 'inventory' ? inventoryTransferWhere(scope) : transferScopeWhere(scope),
    inspection: inspectionScopeWhere(scope, product),
    branch: execution.domain === 'inventory' ? { isActive: true, deletedAt: null } : { products: { some: product } },
    ...(execution.domain === 'inventory' ? { stockCount: stockCountScopeWhere(scope), reorderPoint: inventoryBranchWhere(scope), stockAlert: inventoryBranchWhere(scope), branchReceiving: { deletedAt: null, transfer: inventoryTransferWhere(scope) }, sale: inventorySaleScopeWhere(scope) } : {}),
    purchaseOrder: procurement,
    ...(execution.domain === 'procurement' ? { goodsReceiving: { po: procurement }, goodsReceivingItem: { receiving: { po: procurement } }, purchaseOrderPayment: { purchaseOrder: procurement } } : {}),
    supplier: execution.domain === 'procurement' ? supplierScopeWhere(scope) : { products: { some: product } },
  } satisfies {
    product: Prisma.ProductWhereInput;
    inspectionTemplate: Prisma.InspectionTemplateWhereInput;
    stockTransfer: Prisma.StockTransferWhereInput;
    inspection: Prisma.InspectionWhereInput;
    branch: Prisma.BranchWhereInput;
    purchaseOrder: Prisma.PurchaseOrderWhereInput;
    supplier: Prisma.SupplierWhereInput;
    stockCount?: Prisma.StockCountWhereInput;
    reorderPoint?: Prisma.ReorderPointWhereInput;
    stockAlert?: Prisma.StockAlertWhereInput;
    branchReceiving?: Prisma.BranchReceivingWhereInput;
    sale?: Prisma.SaleWhereInput;
    goodsReceiving?: Prisma.GoodsReceivingWhereInput;
    goodsReceivingItem?: Prisma.GoodsReceivingItemWhereInput;
    purchaseOrderPayment?: Prisma.PurchaseOrderPaymentWhereInput;
  };
  const predicates: Record<string, unknown> = execution.scopeReads ? scopedPredicates : {};
  const proxy = new Proxy(tx as unknown as PrismaService, {
    get(target, key) {
      if (key === '$transaction') return async (work: unknown, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => {
        const levels: Record<Prisma.TransactionIsolationLevel, number> = { ReadUncommitted: 0, ReadCommitted: 1, RepeatableRead: 2, Serializable: 3 };
        if (options?.isolationLevel && levels[options.isolationLevel] > levels[execution.isolationLevel ?? 'ReadCommitted']) throw new Error('Nested transaction requires stronger isolation than its outer execution');
        if (typeof work === 'function') return work(domainAccessClient(base));
        // Existing domain code uses interactive transactions only. Do not silently
        // accept a future array of already-started operations as an atomic boundary.
        throw new Error('Domain access requires an interactive transaction');
      };
      const value = Reflect.get(target, key);
      if (typeof key === 'string' && predicates[key]) {
        return new Proxy(value, { get(delegate, operation) {
          const method = Reflect.get(delegate, operation);
          if (typeof method !== 'function') return method;
          if (!readOperations.has(String(operation))) return method.bind(delegate);
          return (args: { where?: Record<string, unknown>; [key: string]: unknown } = {}) => method.call(delegate, {
            ...args,
            where: { ...args.where, AND: [...(Array.isArray(args.where?.AND) ? args.where.AND : [args.where?.AND ?? {}]), predicates[key]] },
          });
        } });
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  joinedClients.set(proxy, tx);
  return proxy;
}
