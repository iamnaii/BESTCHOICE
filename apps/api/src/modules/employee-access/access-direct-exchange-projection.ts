import { ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { AccessExchangeSourceService } from './access-exchange-source.service';
import { AccessResourceService } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { contractNavigation } from './access-contract-read-scope';

/** Public direct API only. Canonical exchange results remain internal financial inputs. */
export async function directExchangeProjection(
  id: string,
  exchanges: AccessExchangeSourceService,
  resources: AccessResourceService,
  acknowledgement = false,
) {
  const ctx = currentDomainAccess()!;
  const tx = ctx.client;
  const row = await tx.contractExchangeRequest.findUniqueOrThrow({ where: { id } });
  const ack = { id: row.id, status: row.status };
  try {
    await exchanges.request(id, 'contract-exchanges.read');
  } catch (error) {
    // Cancellation may legitimately retire its replacement Contract. A successful
    // action grants only this structural acknowledgement, never linked read rights.
    if (acknowledgement && error instanceof ForbiddenException) return ack;
    throw error;
  }
  const product = async (productId: string) => {
    const source = await resources.product(tx, productId, true);
    if (!canAccess(ctx.snapshot, 'products.read', source)) return null;
    const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    return {
      id: p.id,
      name: p.name,
      brand: p.brand,
      model: p.model,
      storage: p.storage,
      status: p.status,
      costPrice: canAccess(ctx.snapshot, 'sensitive.cost.read', source) ? p.costPrice : null,
    };
  };
  const old = await tx.contract.findUniqueOrThrow({
    where: { id: row.oldContractId },
    select: { customerId: true },
  });
  // sources() has independently proved current Customer authority and held its lock.
  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: old.customerId },
    select: { id: true, name: true },
  });
  return {
    ...ack,
    mode: row.mode,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    approvalTier: row.approvalTier,
    oldContract: await contractNavigation(row.oldContractId),
    newContract: row.newContractId ? await contractNavigation(row.newContractId) : null,
    customer,
    oldProduct: await product(row.oldProductId),
    newProduct: await product(row.newProductId),
    financial: {
      buybackPrice: row.buybackPrice,
      ncv: row.ncvSnapshot,
      newTotalMonths: row.newTotalMonths,
      newInterestRate: row.newInterestRate,
      newMonthlyPayment: row.newMonthlyPayment,
      newInterestTotal: row.newInterestTotal,
      newVatAmount: row.newVatAmount,
      newStoreCommission: row.newStoreCommission,
    },
  };
}
