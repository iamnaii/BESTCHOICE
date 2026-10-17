import { permissionScopes } from './access-context';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import { AccessSnapshot } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionScope } from './access-policy.registry';
import { productScopeSql, productScopeWhere, scopeWhere, inspectionTemplateScopeWhere, inspectionScopeWhere } from './access-query-scope';

export interface DomainAccessExecution {
  readonly snapshot: AccessSnapshot;
  readonly scope: CollectionScope;
  readonly client: Prisma.TransactionClient;
  readonly scopeReads: boolean;
  readonly authorizedProductIds?: readonly string[];
}
export const domainAccessExecution = new AsyncLocalStorage<DomainAccessExecution>();
export function currentDomainAccess(): DomainAccessExecution | undefined { return domainAccessExecution.getStore(); }
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
export function domainAccessClient(base: PrismaService): PrismaService {
  const execution = currentDomainAccess();
  if (!execution) return base;
  const tx = execution.client;
  const scope = execution.scope;
  const product = { AND: [productScopeWhere(scope), execution.authorizedProductIds ? { id: { in: [...execution.authorizedProductIds] } } : {}] };
  const procurement = productScopeWhere({ ...scope, permission: 'purchase-orders.read', tuples: permissionScopes({ id: scope.userId, access: execution.snapshot }, 'purchase-orders.read', scope.company) });
  const readOperations = new Set(['findMany', 'findFirst', 'findUnique', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
  const scopedPredicates = {
    product,
    inspectionTemplate: inspectionTemplateScopeWhere(scope),
    stockTransfer: transferScopeWhere(scope),
    inspection: inspectionScopeWhere(scope, product),
    branch: { products: { some: product } },
    purchaseOrder: { products: { some: procurement, every: procurement }, goodsReceivings: { every: { items: { every: { product: { is: procurement } } } } } },
    supplier: { products: { some: product } },
  } satisfies {
    product: Prisma.ProductWhereInput;
    inspectionTemplate: Prisma.InspectionTemplateWhereInput;
    stockTransfer: Prisma.StockTransferWhereInput;
    inspection: Prisma.InspectionWhereInput;
    branch: Prisma.BranchWhereInput;
    purchaseOrder: Prisma.PurchaseOrderWhereInput;
    supplier: Prisma.SupplierWhereInput;
  };
  const predicates: Record<string, unknown> = execution.scopeReads ? scopedPredicates : {};
  return new Proxy(tx as unknown as PrismaService, {
    get(target, key) {
      if (key === '$transaction') return async (work: unknown) => {
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
}
