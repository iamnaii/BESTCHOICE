import { ForbiddenException } from '@nestjs/common';
import { Company, PermissionKey, canAccess } from '@installment/shared';
import { Prisma } from '@prisma/client';
import {
  currentDomainAccess,
  isCurrentDomainClient,
} from '../employee-access/access-execution-context';
import { permissionScopes } from '../employee-access/access-context';
import {
  customerPartyWhere,
  financeContractReadWhere,
} from '../employee-access/access-party-scope';
import { productScopeWhere } from '../employee-access/access-query-scope';
import { exchangeContractSource } from '../employee-access/access-exchange-source.service';

export function namedExecution(actorId?: string, client?: object) {
  const ctx = currentDomainAccess();
  if (
    !ctx ||
    ctx.scopeReads ||
    ctx.isolationLevel !== 'Serializable' ||
    (actorId && actorId !== ctx.snapshot.userId) ||
    (client && !isCurrentDomainClient(client))
  ) {
    throw new ForbiddenException('โปรโมชันสัญญาต้องตรวจสิทธิ์ปัจจุบันในธุรกรรมเดียวกัน');
  }
  return ctx;
}
export function namedScope(permission: PermissionKey, company: Company) {
  const ctx = currentDomainAccess()!;
  return {
    userId: ctx.snapshot.userId,
    company,
    permission,
    tuples: permissionScopes(
      { id: ctx.snapshot.userId, access: ctx.snapshot },
      permission,
      company,
    ),
  };
}
export function namedCustomerWhere(): Prisma.CustomerWhereInput {
  return {
    OR: (['SHOP', 'FINANCE'] as const).map((c) =>
      customerPartyWhere(namedScope('customers.read', c)),
    ),
  };
}
export function namedProductWhere(): Prisma.ProductWhereInput {
  return {
    deletedAt: null,
    OR: (['SHOP', 'FINANCE'] as const).map((c) =>
      productScopeWhere(namedScope('products.read', c)),
    ),
  };
}
export function namedContractReadWhere(): Prisma.ContractWhereInput {
  return financeContractReadWhere(namedScope('contracts.read', 'FINANCE'));
}
export async function assertNamedSources(
  input: { customerId: string; productId: string; branchId: string; bundleProductIds?: string[] },
  requireShop = true,
) {
  const { client: tx } = namedExecution();
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${input.customerId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM branches WHERE id = ${input.branchId} FOR SHARE`;
  const branch = await tx.branch.findFirst({
    where: {
      id: input.branchId,
      isActive: true,
      deletedAt: null,
      company: { companyCode: 'SHOP', isActive: true, deletedAt: null },
    },
  });
  if (
    !branch ||
    !(await tx.customer.count({ where: { id: input.customerId, AND: namedCustomerWhere() } }))
  ) {
    throw new ForbiddenException('ไม่มีสิทธิ์อ่านลูกค้าหรือสาขาต้นทาง');
  }
  const ids = [...new Set([input.productId, ...(input.bundleProductIds ?? [])])].sort();
  for (const id of ids) await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
  const where = requireShop
    ? productScopeWhere(namedScope('products.read', 'SHOP'))
    : namedProductWhere();
  const count = await tx.product.count({
    where: { id: { in: ids }, branchId: input.branchId, deletedAt: null, AND: where },
  });
  if (count !== ids.length) throw new ForbiddenException('ไม่มีสิทธิ์อ่านสินค้าต้นทาง');
}
export async function assertNamedContractAction(
  contractId: string,
  permission: 'contracts.approve' | 'contracts.activate' | 'contracts.read',
) {
  const ctx = namedExecution();
  const source = await exchangeContractSource(ctx.client, contractId, true);
  if (!canAccess(ctx.snapshot, permission, source))
    throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการสัญญาการเงิน');
}

/** Preparation authority does not confer underwriting or execution authority. */
export async function assertNamedPreparation(
  contract: {
    customerId: string;
    productId: string;
    branchId: string;
    bundleProductIds: string[];
    salespersonId: string;
  },
  actorId?: string,
) {
  const ctx = namedExecution(actorId);
  if (
    !canAccess(ctx.snapshot, 'contracts.update', { company: 'SHOP', branchId: contract.branchId })
  ) {
    throw new ForbiddenException('ไม่มีสิทธิ์เตรียมสัญญาในสาขานี้');
  }
  if (contract.salespersonId !== ctx.snapshot.userId && !ctx.snapshot.isOwner) {
    throw new ForbiddenException('เฉพาะผู้สร้างสัญญาหรือเจ้าของปัจจุบัน');
  }
  await assertNamedSources(contract);
}
