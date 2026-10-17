import { ForbiddenException, Injectable } from '@nestjs/common';
import { currentDomainAccess } from './access-execution-context';
import {
  assertAfterSalesCurrentFacts,
  AccessAfterSalesSourceService,
  AfterSalesSourceFacts,
} from './access-after-sales-source.service';
import { AccessRepairProjectionService } from './access-repair-projection.service';
import { contractWarrantySelect } from './access-repair-scope';
import {
  RECONCILE_SELECT,
  reconcileStage,
} from '../after-sales/services/after-sales-stage-reconcile';
import { stageSince, isStale } from '../after-sales/utils/after-sales-stage.util';

/** Source-specific renderer/query inputs. Never expose raw IDs as a substitute for a denied child. */
@Injectable()
export class AccessAfterSalesProjectionService {
  constructor(
    private readonly sources: AccessAfterSalesSourceService,
    private readonly repairs: AccessRepairProjectionService,
  ) {}
  async project(id: string, facts?: AfterSalesSourceFacts) {
    const ctx = currentDomainAccess();
    if (!ctx) throw new ForbiddenException('ต้องมีธุรกรรมตรวจสิทธิ์ปัจจุบัน');
    const tx = ctx.client;
    const f = facts ?? (await this.sources.resolve(id));
    assertAfterSalesCurrentFacts(f, id);
    let row = f.row;
    if (f.stageVerified) {
      const input = await tx.afterSalesCase.findUniqueOrThrow({
        where: { id },
        select: RECONCILE_SELECT,
      });
      const reconciled = await reconcileStage(tx, input, f);
      row = {
        ...row,
        stage: reconciled.stage,
        closedAt: reconciled.closedAt,
        cancelledAt: reconciled.cancelledAt,
      };
    }
    const customer = f.customer
      ? await tx.customer.findFirst({
          where: { id: row.customerId, deletedAt: null },
          select: { id: true, name: true, phone: true, lineIdShop: true },
        })
      : null;
    const productSelect = {
      id: true,
      brand: true,
      model: true,
      storage: true,
      imeiSerial: true,
    } as const;
    const product =
      row.productId && f.productSource
        ? await tx.product.findUnique({ where: { id: row.productId }, select: productSelect })
        : null;
    const replacementProduct =
      row.replacementProductId && f.replacementProductSource
        ? await tx.product.findUnique({
            where: { id: row.replacementProductId },
            select: productSelect,
          })
        : null;
    const contract =
      row.contractId && f.contractSource
        ? await tx.contract.findUnique({
            where: { id: row.contractId },
            select: contractWarrantySelect,
          })
        : null;
    const replacementContract =
      row.replacementContractId && f.replacementContractSource
        ? await tx.contract.findUnique({
            where: { id: row.replacementContractId },
            select: contractWarrantySelect,
          })
        : null;
    const rawTicket =
      row.repairTicketId && f.repairAccess
        ? await tx.repairTicket.findUnique({
            where: { id: row.repairTicketId },
            include: {
              repairSupplier: { select: { id: true, name: true } },
              statusLogs: {
                orderBy: { createdAt: 'asc' },
                include: { changedBy: { select: { name: true } } },
              },
            },
          })
        : null;
    const repairTicket = rawTicket
      ? {
          ...(await this.repairs.project(rawTicket, rawTicket.id)),
          customerId: f.customer ? rawTicket.customerId : null,
          productId: f.productSource ? rawTicket.productId : null,
          contractId: f.contractSource ? rawTicket.contractId : null,
          replacementContractId:
            f.replacementContractSource &&
            rawTicket.replacementContractId === row.replacementContractId
              ? rawTicket.replacementContractId
              : null,
        }
      : null;
    const exchangeRequest = f.exchangeAccess
      ? {
          status: f.exchangeAccess.request.status,
          mode: f.exchangeAccess.request.mode,
          approvalTier: f.exchangeAccess.request.approvalTier,
          buybackPrice: f.exchangeAccess.request.buybackPrice,
          ncvSnapshot: f.exchangeAccess.request.ncvSnapshot,
          memoAppliedAt: f.exchangeAccess.request.memoAppliedAt,
        }
      : null;
    const since = f.stageVerified
      ? stageSince(row.stage, rawTicket, row.receivedAt, row.approvedAt)
      : null;
    const events = await tx.afterSalesEvent.findMany({
      where: { caseId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, createdAt: true, actorId: true },
    });
    const branch = await tx.branch.findUnique({
      where: { id: row.branchId },
      select: { id: true, name: true },
    });
    const receivedBy = await tx.user.findUnique({
      where: { id: row.receivedById },
      select: { id: true, name: true },
    });
    const snapshot = row.warrantySnapshot;
    const warrantySnapshot =
      snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? Object.fromEntries(
            [
              'status',
              'daysRemainingIn7Day',
              'purchasedAt',
              'shopWarrantyEndDate',
              'manufacturerWarrantyEndDate',
              'checkedAt',
              'within7Days',
            ]
              .filter((key) => key in snapshot)
              .map((key) => [key, snapshot[key]]),
          )
        : null;
    const exchange = row.outcome?.includes('EXCHANGE')
      ? {
          kind: row.outcome === 'PRICED_EXCHANGE' ? 'PRICED' : 'SAME_MODEL',
          mode: exchangeRequest?.mode ?? null,
          approvalTier: exchangeRequest?.approvalTier ?? null,
          requestStatus: exchangeRequest?.status ?? null,
          buybackPrice: exchangeRequest?.buybackPrice?.toFixed(2) ?? null,
          ncvSnapshot: exchangeRequest?.ncvSnapshot?.toFixed(2) ?? null,
          oldProduct: product,
          newProduct: replacementProduct,
          replacementContract,
          requestedBy: receivedBy,
        }
      : null;
    return {
      ...row,
      customerId: customer?.id ?? null,
      customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
      contractId: contract?.id ?? null,
      contract,
      saleId: f.saleAccess ? row.saleId : null,
      productId: product?.id ?? null,
      product,
      replacementProductId: replacementProduct?.id ?? null,
      replacementContractId: replacementContract?.id ?? null,
      replacementSaleId: f.replacementSaleAccess ? row.replacementSaleId : null,
      repairTicketId: repairTicket?.id ?? null,
      repairTicket,
      exchangeRequestId: f.exchangeAccess ? row.exchangeRequestId : null,
      exchangeRequest,
      exchange,
      branch,
      receivedBy,
      symptom: row.symptom,
      accessories: row.accessories,
      cancelReason: null,
      warrantySnapshot: contract || f.saleAccess ? warrantySnapshot : null,
      photoKeys: undefined,
      purchasePhotoKeys: undefined,
      photoCount: row.photoKeys.length,
      purchasePhotoAngles: f.productSource
        ? row.purchasePhotoKeys.map((key) => /purchase-([a-z]+)\./.exec(key)?.[1] ?? '')
        : [],
      stageVerified: f.stageVerified,
      stageSince: since,
      stale: since ? isStale(row.stage, since) : null,
      daysInStage: since ? Math.floor((Date.now() - since.getTime()) / 86400000) : null,
      lineLinked: customer ? !!customer.lineIdShop : null,
      lineEvents: [],
      events: events.map((event) => ({ ...event, note: null })),
      timeline: events.map((event) => ({ at: event.createdAt, kind: event.kind, note: null })),
    };
  }
}
export type AfterSalesReadView = Awaited<ReturnType<AccessAfterSalesProjectionService['project']>>;
