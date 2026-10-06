import { Prisma } from '@prisma/client';
/** Shared with the ordinary sales list/report. Void is filtered by the caller. */
export const completedSaleWhere: Prisma.SaleWhereInput = {
  OR: [{ contractId: null }, { contract: { is: { status: { not: 'DRAFT' }, deletedAt: null } } }],
};
/** Fixed aliases s (sale) and k (its linked contract). */
export const completedSaleSql = Prisma.sql`(s.contract_id IS NULL OR (k.status <> 'DRAFT' AND k.deleted_at IS NULL))`;
