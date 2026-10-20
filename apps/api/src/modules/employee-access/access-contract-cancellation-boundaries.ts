import { ConflictException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, retryable } from './access-resource.service';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { currentFinanceReadWhere } from './access-contract-read-scope';
import { financeContractReadWhere } from './access-party-scope';
import { permissionScopes } from './access-context';
import { lockFinanceContractReadSource } from './access-party-source.service';
import { PreparationReadProjection } from './access-contract-preparation-projection';
import { payoffJournalReadable } from './access-payoff-journal-source';
import { settledPayoutByContract } from '../contracts/services/contract-cancellation.service';

export const CONTRACT_CANCELLATION_ROUTES = [
  'softDelete',
  'listPendingCancellations',
  'requestCancellation',
  'approveCancellation',
  'rejectCancellation',
].map((method) => `ContractsController.${method}`);
@Injectable()
export class AccessContractCancellationBoundaries implements OnModuleInit {
  constructor(private readonly resources: AccessResourceService) {}
  onModuleInit() {
    for (const route of CONTRACT_CANCELLATION_ROUTES)
      ACCESS_BOUNDARIES.set(route, async (req, snapshot, permission) => {
        const company = route.endsWith('.softDelete') ? 'SHOP' : 'FINANCE';
        if (requestedAccessCompany(req) !== company)
          throw new ForbiddenException('คำขอนี้อยู่คนละส่วนงาน');
        const execute = async (handler?: () => Promise<unknown>) => {
          try {
            return (
              await this.resources.execute(
                snapshot.userId,
                permission,
                company,
                undefined,
                async () => {
                  const ctx = currentDomainAccess()!;
                  req.user = { ...req.user, id: ctx.snapshot.userId, access: ctx.snapshot };
                  if (!handler) return pendingQueue();
                  const result = await handler();
                  return route.endsWith('.approveCancellation')
                    ? { cancellationId: String(req.params?.id ?? ''), status: 'APPROVED' }
                    : result;
                },
                false,
                { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
              )
            ).result;
          } catch (error) {
            if (retryable(error, false))
              throw new ConflictException('มีการเปลี่ยนแปลงพร้อมกัน กรุณาลองใหม่');
            throw error;
          }
        };
        return route.endsWith('.listPendingCancellations')
          ? { kind: 'collection' as const, company, execute: () => execute() }
          : { kind: 'selection' as const, company, execute: (handler) => execute(handler) };
      });
  }
}
async function pendingQueue() {
  const ctx = currentDomainAccess()!,
    tx = ctx.client;
  const requestScope = {
    userId: ctx.snapshot.userId,
    company: 'FINANCE' as const,
    permission: 'sales.cancel.request' as const,
    tuples: permissionScopes(
      { id: ctx.snapshot.userId, access: ctx.snapshot },
      'sales.cancel.request',
      'FINANCE',
    ).filter((t) => t.scope !== 'ASSIGNED'),
  };
  const where: Prisma.ContractWhereInput = {
    AND: [await currentFinanceReadWhere('contracts.read'), financeContractReadWhere(requestScope)],
    cancellations: { some: { status: 'PENDING', deletedAt: null } },
  };
  const sources = await tx.contract.findMany({
    where,
    select: { id: true },
    orderBy: { id: 'asc' },
    take: 10001,
  });
  if (sources.length > 10000) throw new ForbiddenException('กรุณาระบุตัวกรองให้แคบลง');
  for (const { id } of sources) await lockFinanceContractReadSource(tx, id);
  const ids = sources.map((c) => c.id);
  if (ids.length) {
    await tx.$queryRaw`SELECT id FROM contract_cancellations WHERE contract_id=ANY(${ids}::text[]) AND status='PENDING' AND deleted_at IS NULL ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM customers WHERE id IN (SELECT customer_id FROM contracts WHERE id=ANY(${ids}::text[])) ORDER BY id FOR SHARE`;
  }
  const projection = await new PreparationReadProjection().initialize();
  const paymentsWhere = await currentFinanceReadWhere('payments.read');
  const rows = await tx.contractCancellation.findMany({
    where: { status: 'PENDING', deletedAt: null, contract: { id: { in: ids }, AND: where } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      contractId: true,
      reason: true,
      refundAmount: true,
      requestedById: true,
      status: true,
      createdAt: true,
      requestSnapshotVersion: true,
      contract: {
        select: {
          id: true,
          contractNumber: true,
          status: true,
          customer: { select: { id: true, name: true } },
        },
      },
    },
  });
  const result: Array<{
    id: string;
    contractId: string;
    status: string;
    createdAt: Date;
    evidence: string;
    reason: string | null;
    refundAmount: string | null;
    requestedBy: { id: string } | null;
    contract: {
      id: string;
      contractNumber: string;
      status: string | null;
      customer: { id: string; name: string } | null;
    };
    availability: { financial: string; customer: string; settlement: string };
    settledInBatch: boolean | null;
    recallAmount: string | null;
  }> = [];
  for (const row of rows) {
    const money = !!(await tx.contract.count({
      where: { id: row.contractId, AND: paymentsWhere },
    }));
    const identity = !!(await tx.contract.count({
      where: { id: row.contractId, AND: projection.customerWhere() },
    }));
    let settlement: { settledInBatch: boolean; recallAmount: string | null } | null = null;
    if (
      money &&
      (await payoffJournalReadable(row.contractId)) &&
      (await settlementSourcesReadable(tx, row.contractId))
    ) {
      const settled = (await settledPayoutByContract(tx, [row.contractId])).get(row.contractId);
      const paid = !!settled?.settledTotal.gt(0);
      settlement = {
        settledInBatch: paid,
        recallAmount: paid
          ? settled!.settledTotal.minus(settled!.settledDeductions).toFixed(2)
          : null,
      };
    }
    result.push({
      id: row.id,
      contractId: row.contractId,
      status: row.status,
      createdAt: row.createdAt,
      evidence: row.requestSnapshotVersion === 1 ? 'RECORDED' : 'UNPROVEN',
      reason: money ? row.reason : null,
      refundAmount: money ? row.refundAmount.toString() : null,
      requestedBy: money ? { id: row.requestedById } : null,
      contract: {
        id: row.contractId,
        contractNumber: row.contract.contractNumber,
        status: money ? row.contract.status : null,
        customer: identity ? row.contract.customer : null,
      },
      availability: {
        financial: money ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
        customer: identity ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
        settlement: settlement ? 'VISIBLE_CURRENT' : 'UNAVAILABLE',
      },
      settledInBatch: settlement?.settledInBatch ?? null,
      recallAmount: settlement?.recallAmount ?? null,
    });
  }
  return result;
}
async function settlementSourcesReadable(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM inter_co_settlement_items WHERE contract_id=${id} ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM inter_co_settlement_batches WHERE id IN (SELECT batch_id FROM inter_co_settlement_items WHERE contract_id=${id}) ORDER BY id FOR SHARE`;
  const items = await tx.interCoSettlementItem.findMany({
    where: {
      contractId: id,
      deletedAt: null,
      itemType: 'SETTLEMENT',
      batch: { status: 'POSTED', deletedAt: null },
    },
    select: {
      shopFinancedGl: true,
      shopCommissionGl: true,
      batch: { select: { financeJournalEntryId: true, shopJournalEntryId: true } },
    },
    take: 10001,
  });
  if (items.length > 10000) throw new ForbiddenException('ไม่สามารถอ่านชุดข้อมูลนี้');
  for (const item of items)
    for (const [companyCode, jeId, required] of [
      ['FINANCE', item.batch.financeJournalEntryId, true],
      [
        'SHOP',
        item.batch.shopJournalEntryId,
        item.shopFinancedGl.plus(item.shopCommissionGl).gt(0),
      ],
    ] as const) {
      if (!jeId) {
        if (required) return false;
        continue;
      }
      await tx.$queryRaw`SELECT id FROM journal_entries WHERE id=${jeId} FOR SHARE`;
      if (
        !(await tx.journalEntry.count({
          where: {
            id: jeId,
            status: 'POSTED',
            deletedAt: null,
            company: { companyCode, isActive: true, deletedAt: null },
          },
        }))
      )
        return false;
    }
  return true;
}
