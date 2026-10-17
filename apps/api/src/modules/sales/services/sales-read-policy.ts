import { currentDomainAccess } from '../../employee-access/access-execution-context';
import { ForbiddenException } from '@nestjs/common';
import { getBranchScope } from '../../auth/branch-access.util';
import { maskNationalId } from '../../../utils/pii.util';
import type { SalesReadActor } from '../sales-read.types';

/** Common fields on Sale and User, so salesperson suggestions use the same scope. */
export function salesBranchWhere(
  actor: SalesReadActor,
  branchId?: string,
): { branchId?: string; id?: { in: string[] } } {
  if (currentDomainAccess()) return branchId ? { branchId } : {};
  const scope = getBranchScope(actor);
  if (scope.all) return branchId ? { branchId } : {};
  if (!scope.branchId) return { id: { in: [] } };
  if (branchId && branchId !== scope.branchId) {
    throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงสาขานี้');
  }
  return { branchId: scope.branchId };
}

export function projectSaleForActor<T extends {
  costSnapshot?: { mainProductCost: unknown } | null;
  product: { costPrice?: unknown };
  customer: { id: string; nationalId?: string | null };
}>(sale: T, actor: SalesReadActor) {
  if (currentDomainAccess()) return { ...sale, costPriceSnapshot: sale.costSnapshot?.mainProductCost ?? null, customer: actor.role === 'SALES' && sale.customer.nationalId ? { ...sale.customer, nationalId: maskNationalId(sale.customer.nationalId) } : sale.customer };
  const productWithoutCost = { ...sale.product };
  delete productWithoutCost.costPrice;
  const customer = actor.role === 'SALES' && sale.customer.nationalId
    ? { ...sale.customer, nationalId: maskNationalId(sale.customer.nationalId) }
    : sale.customer;
  const { costSnapshot, ...safeSale } = sale;
  return { ...safeSale, ...(actor.role === 'OWNER' ? { costPriceSnapshot: costSnapshot?.mainProductCost ?? null } : {}), customer, product: actor.role === 'OWNER' ? sale.product : productWithoutCost };
}
