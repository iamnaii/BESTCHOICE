import { ForbiddenException, Injectable } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { loadAfterSalesActionCase } from './access-after-sales-action';
import { currentDomainAccess } from './access-execution-context';
import { AccessExchangeSourceService } from './access-exchange-source.service';
import { AccessRepairSourceService } from './access-repair-source.service';
import { repairSource } from './access-repair-scope';
import { classifyAfterSalesStage } from '../after-sales/services/after-sales-stage-reconcile';

export type ExchangeCaseOperation = 'confirm' | 'deliver' | 'approve' | 'reject' | 'cancel';
/** Exact action inputs only. Never serialize these child models or treat a denied
 * child as absent. Each call refreshes current identity in the owned transaction. */
@Injectable()
export class AccessAfterSalesExchangeActionService {
  constructor(
    private readonly exchanges: AccessExchangeSourceService,
    private readonly repairs: AccessRepairSourceService,
  ) {}

  async load(
    base: PrismaService,
    id: string,
    userId: string,
    operation: ExchangeCaseOperation,
    replacementProductId?: string,
  ) {
    const row = await loadAfterSalesActionCase(base, id, userId, 'after-sales.update');
    const ctx = currentDomainAccess()!;
    const tx = ctx.client;
    const denied = () => new ForbiddenException('แหล่งเปลี่ยนเครื่องไม่ตรงกับเคส');
    let repairTicket: Awaited<ReturnType<typeof tx.repairTicket.findUniqueOrThrow>> | null = null;
    let exchangeRequest:
      | (Awaited<ReturnType<typeof tx.contractExchangeRequest.findUniqueOrThrow>> & {
          newContract: { status: string } | null;
        })
      | null = null;
    let replacementContract: { status: string } | null = null;
    if (operation === 'confirm' || operation === 'deliver') {
      const nextId = row.outcome === 'REPAIR' ? replacementProductId : row.replacementProductId;
      if (!row.contractId || !row.productId || !nextId) throw denied();
      if (operation === 'confirm') {
        const sources = await this.exchanges.sources({
          oldContractId: row.contractId,
          oldProductId: row.productId,
          newProductId: nextId,
        });
        this.exchanges.assert('defect-exchanges.create', sources);
        this.exchanges.assert('defect-exchanges.approve', sources);
      } else {
        if (!row.replacementContractId) throw denied();
        await this.repairs.linked(
          tx,
          ctx.snapshot,
          {
            customerId: row.customerId,
            contractId: row.contractId,
            productId: row.productId,
            replacementContractId: row.replacementContractId,
          },
          true,
        );
      }
      const original = await tx.contract.findUniqueOrThrow({
        where: { id: row.contractId },
        select: { customerId: true, productId: true },
      });
      if (original.customerId !== row.customerId || original.productId !== row.productId)
        throw denied();
      if (operation === 'deliver') {
        const next = await tx.contract.findUniqueOrThrow({
          where: { id: row.replacementContractId! },
          select: { status: true, customerId: true, productId: true, parentContractId: true },
        });
        if (
          next.customerId !== row.customerId ||
          next.productId !== nextId ||
          next.parentContractId !== row.contractId
        )
          throw denied();
        replacementContract = { status: next.status };
      }
      if (operation === 'confirm' && row.repairTicketId) {
        const source = await repairSource(tx, row.repairTicketId, true);
        if (
          !canAccess(ctx.snapshot, 'defect-exchanges.create', source) ||
          !canAccess(ctx.snapshot, 'defect-exchanges.approve', source)
        )
          throw denied();
        repairTicket = await tx.repairTicket.findUniqueOrThrow({
          where: { id: row.repairTicketId },
        });
        if (
          repairTicket.customerId !== row.customerId ||
          repairTicket.productId !== row.productId ||
          repairTicket.contractId !== row.contractId
        )
          throw denied();
      }
      if (row.outcome === 'REPAIR' && !repairTicket) throw denied();
    } else {
      if (!row.exchangeRequestId) throw denied();
      const permission =
        operation === 'approve' ? 'contract-exchanges.approve' : 'contract-exchanges.update';
      const { request } = await this.exchanges.request(row.exchangeRequestId, permission);
      if (
        request.oldContractId !== row.contractId ||
        request.oldProductId !== row.productId ||
        request.newProductId !== row.replacementProductId
      )
        throw denied();
      const old = await tx.contract.findUniqueOrThrow({
        where: { id: request.oldContractId },
        select: { customerId: true, productId: true },
      });
      const expected =
        request.mode === 'MEMO' && request.status === 'APPROVED' && request.memoAppliedAt
          ? request.newProductId
          : request.oldProductId;
      if (old.customerId !== row.customerId || old.productId !== expected) throw denied();
      if (request.newContractId) {
        const next = await tx.contract.findUniqueOrThrow({
          where: { id: request.newContractId },
          select: {
            status: true,
            customerId: true,
            productId: true,
            exchangedFromContractId: true,
          },
        });
        if (
          next.customerId !== row.customerId ||
          next.productId !== request.newProductId ||
          next.exchangedFromContractId !== request.oldContractId
        )
          throw denied();
        replacementContract = { status: next.status };
      }
      if (row.replacementContractId && row.replacementContractId !== request.newContractId)
        throw denied();
      exchangeRequest = { ...request, newContract: replacementContract };
    }
    const result = { ...row, repairTicket, exchangeRequest, replacementContract };
    return { ...result, stage: classifyAfterSalesStage(result) };
  }
}
