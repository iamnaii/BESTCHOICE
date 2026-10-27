import type { ContractExportRead } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readJoinedExportSnapshot } from '../../common/helpers/export-snapshot';
import { currentDomainAccess } from './access-execution-context';
import { PartyQueryPlan } from './access-party-query-plan';
import { derivedLabels } from './access-contract-derived-children';

export async function contractDerivedExport(
  plan: PartyQueryPlan,
  where: Prisma.ContractWhereInput,
): Promise<Omit<ContractExportRead, 'scope'>> {
  return readJoinedExportSnapshot(plan.db, async () => {
    const rows = await plan.db.contract.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        contractNumber: true,
        customerId: true,
        productId: true,
        salespersonId: true,
        sellingPrice: true,
        monthlyPayment: true,
        status: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
      },
    });
    const labels = await derivedLabels(plan, rows);
    const paymentIds = new Set(
      (
        await plan.db.contract.findMany({
          where: { AND: [where ?? {}, plan.finance('payments.read')] },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    return {
      total: rows.length,
      data: rows.map((row) => {
        const customer = labels.customers.get(row.customerId) ?? null;
        const product = labels.products.get(row.productId) ?? null;
        const salesperson = labels.staff.get(row.salespersonId) ?? null;
        return {
          id: row.id,
          contractNumber: row.contractNumber,
          customer,
          product,
          salesperson,
          sellingPrice: row.sellingPrice.toString(),
          monthlyPayment: row.monthlyPayment.toString(),
          status: paymentIds.has(row.id) ? row.status : null,
          branch: row.branch,
          createdAt: row.createdAt.toISOString(),
          availability: {
            customer: customer ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
            product: product ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
            salesperson: salesperson ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
            payments: paymentIds.has(row.id) ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
          },
        };
      }),
    };
  });
}
type Result = Awaited<ReturnType<typeof contractDerivedExport>> & { scope: 'authorized-sources' };
const exportContext = new AsyncLocalStorage<{ client: object; result: Result }>();
export function withContractDerivedExport<T>(result: Result, handler: () => Promise<T>) {
  return exportContext.run({ client: currentDomainAccess()!.client, result }, handler);
}
/** Only the owned export adapter can supply this result to the actual service wrapper. */
export function currentContractDerivedExport() {
  const ctx = exportContext.getStore();
  if (ctx && ctx.client !== currentDomainAccess()?.client)
    throw new Error('Export escaped its owned transaction');
  return ctx?.result;
}
