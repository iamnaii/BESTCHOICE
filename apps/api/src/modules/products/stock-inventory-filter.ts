import { Prisma } from '@prisma/client';
import type { StockInventoryScope } from '@installment/shared';

export function stockInventoryWhere(scope: StockInventoryScope = 'all'): Prisma.ProductWhereInput {
  if (scope === 'devices') return { category: { in: ['PHONE_NEW', 'PHONE_USED', 'TABLET'] } };
  if (scope === 'accessories') return { category: 'ACCESSORY' };
  return {};
}

export function stockInventorySql(scope: StockInventoryScope = 'all'): Prisma.Sql {
  if (scope === 'devices') return Prisma.sql`p.category::text IN ('PHONE_NEW', 'PHONE_USED', 'TABLET')`;
  if (scope === 'accessories') return Prisma.sql`p.category::text = 'ACCESSORY'`;
  return Prisma.sql`TRUE`;
}

function over90Cutoff(asOf: Date): Date { return new Date(asOf.getTime() - 91 * 86_400_000); }
export function stockOver90Where(asOf: Date): Prisma.ProductWhereInput {
  const lte = over90Cutoff(asOf);
  return { OR: [{ stockInDate: { lte } }, { stockInDate: null, createdAt: { lte } }] };
}
export function stockOver90Sql(asOf: Date): Prisma.Sql {
  // Prisma stores these timestamp-without-time-zone columns as UTC. Bind UTC text
  // explicitly; a timestamptz bind would compare in the database session timezone.
  return Prisma.sql`COALESCE(p.stock_in_date, p.created_at) <= ${over90Cutoff(asOf).toISOString()}::timestamp`;
}
