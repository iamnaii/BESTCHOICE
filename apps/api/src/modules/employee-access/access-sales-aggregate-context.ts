import { Prisma } from '@prisma/client';

// Server-only object identity links a computed summary to its exact SQL contributor
// predicate. Nothing is serialized or accepted from the caller. Attempt-local
// response objects fall out of this WeakMap after rollback/retry or response disposal.
const aggregateWhere = new WeakMap<object, Prisma.SaleWhereInput>();
export function setSaleAggregateWhere(summary: object, where: Prisma.SaleWhereInput): void {
  aggregateWhere.set(summary, where);
}
export function saleAggregateWhere(summary: object): Prisma.SaleWhereInput | undefined {
  return aggregateWhere.get(summary);
}
