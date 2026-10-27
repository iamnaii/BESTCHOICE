import { lockFinanceContractReadSource } from './access-party-source.service';
import { Prisma } from '@prisma/client';
import { PermissionKey } from '@installment/shared';
import { currentDomainAccess } from './access-execution-context';
import { permissionScopes } from './access-context';
import { financeContractReadWhere } from './access-party-scope';

/** Independent FINANCE authority inside an owned SHOP or FINANCE read. Never
 * switch the selected work context or borrow the SHOP tuple's branches. */
export async function currentFinanceReadWhere(
  permission: PermissionKey = 'contracts.read',
): Promise<Prisma.ContractWhereInput> {
  const ctx = currentDomainAccess();
  if (!ctx) throw new Error('FINANCE read requires owned execution');
  const live = await ctx.client.companyInfo.count({
    where: { companyCode: 'FINANCE', isActive: true, deletedAt: null },
  });
  return live
    ? financeContractReadWhere({
        userId: ctx.snapshot.userId,
        company: 'FINANCE',
        permission,
        tuples: permissionScopes(
          { id: ctx.snapshot.userId, access: ctx.snapshot },
          permission,
          'FINANCE',
        ),
      })
    : { id: { in: [] } };
}
export async function contractNavigation(id: string) {
  const ctx = currentDomainAccess();
  if (!ctx) return null;
  await lockFinanceContractReadSource(ctx.client, id);
  const row = await ctx.client.contract.findFirst({
    where: { id, AND: await currentFinanceReadWhere() },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      monthlyPayment: true,
      totalMonths: true,
    },
  });
  if (!row) return null;
  const payments = await ctx.client.contract.count({
    where: { id, AND: await currentFinanceReadWhere('payments.read') },
  });
  return { ...row, status: payments ? row.status : null };
}
