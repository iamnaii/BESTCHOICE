import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { canAccess } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessResourceService } from './access-resource.service';
import {
  AccessAfterSalesSourceService,
  afterSalesActor,
  afterSalesSource,
} from './access-after-sales-source.service';
import { deriveStage } from '../after-sales/utils/after-sales-stage.util';
import { AccessRepairSourceService } from './access-repair-source.service';
import { currentDomainAccess } from './access-execution-context';
import { dropOffOutcome } from '../after-sales/utils/after-sales-outcomes.util';

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'];
/** Membership in the persisted case AND the canonical owned namespace are required.
 * A purchase copy never becomes an intake upload, even if a caller changes arrays. */
export function assertCaseIntakeKey(id: string, key: string) {
  if (
    !key.startsWith(`after-sales/${id}/`) ||
    !/^intake-[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp)$/.test(key.slice(`after-sales/${id}/`.length))
  )
    throw new ForbiddenException('ไม่พบแหล่งรูปที่ตรวจสอบได้');
}
@Injectable()
export class AccessAfterSalesStreams {
  constructor(
    private readonly base: PrismaService,
    private readonly resources: AccessResourceService,
    private readonly sources: AccessAfterSalesSourceService,
    private readonly repairs: AccessRepairSourceService,
  ) {}
  private async case(
    id: string,
    actorId: string,
    permission: 'after-sales.read' | 'after-sales.export',
  ) {
    const ctx = await afterSalesActor(this.base, actorId, currentDomainAccess()?.client);
    if (!ctx || ctx.scope.permission !== permission)
      throw new ForbiddenException('ต้องมีธุรกรรมเอกสารปัจจุบัน');
    const source = await afterSalesSource(ctx.client, id, true);
    for (const key of ['documents.read', permission] as const)
      if (!canAccess(ctx.snapshot, key, source))
        throw new ForbiddenException('ไม่มีสิทธิ์อ่านเอกสาร');
    return { ctx, row: await ctx.client.afterSalesCase.findUniqueOrThrow({ where: { id } }) };
  }
  async photo(id: string, actorId: string, selection: { index: number } | { angle: string }) {
    const { ctx, row } = await this.case(id, actorId, 'after-sales.read');
    if ('index' in selection) {
      if (!Number.isSafeInteger(selection.index) || selection.index < 0)
        throw new BadRequestException('ลำดับรูปไม่ถูกต้อง');
      const key = row.photoKeys[selection.index];
      if (!key) throw new NotFoundException('ไม่มีรูปที่เลือก');
      assertCaseIntakeKey(id, key);
      return key;
    }
    if (!ANGLES.includes(selection.angle)) throw new BadRequestException('มุมรูปไม่ถูกต้อง');
    // Case.productId is the ORIGINAL device, including after a MEMO/new-contract exchange.
    if (!row.productId) throw new ForbiddenException('ไม่พบแหล่งรูปที่ตรวจสอบได้');
    const source = await this.resources.product(ctx.client, row.productId, true);
    for (const key of ['products.read', 'documents.read'] as const)
      if (!canAccess(ctx.snapshot, key, source))
        throw new ForbiddenException('ไม่มีสิทธิ์อ่านรูปต้นทาง');
    const product = await ctx.client.product.findUniqueOrThrow({
      where: { id: row.productId },
      select: { imeiSerial: true },
    });
    if (!row.deviceImei || product.imeiSerial !== row.deviceImei)
      throw new ForbiddenException('ไม่พบแหล่งรูปที่ตรวจสอบได้');
    const prefix = `after-sales/${id}/purchase-${selection.angle}.`;
    const key = row.purchasePhotoKeys.find(
      (key) => key.startsWith(prefix) && /^(jpg|jpeg|png|webp)$/.test(key.slice(prefix.length)),
    );
    if (!key) throw new NotFoundException('ไม่มีรูปที่เลือก');
    return key;
  }
  async document(id: string, actorId: string, kind: 'RECEIPT' | 'HANDOVER') {
    const { ctx } = await this.case(id, actorId, 'after-sales.export');
    const facts = await this.sources.resolve(id, 'after-sales.export');
    // Export facts are NOT general read facts. No read grant is fabricated and no
    // query-maintenance reconciliation runs under export-only authority.
    if (!facts.stageVerified || (facts.row.replacementSaleId && !facts.replacementSaleAccess))
      throw new ForbiddenException('ไม่พบแหล่งเอกสารที่ตรวจสอบได้');
    const row = facts.row;
    if (
      (row.source === 'INSTALLMENT_CONTRACT' && !row.contractId) ||
      (row.source === 'CASH_SALE' && !row.saleId)
    )
      throw new ForbiddenException('ไม่พบแหล่งเอกสารที่ตรวจสอบได้');
    const tx = ctx.client;
    const ticket = row.repairTicketId
      ? await tx.repairTicket.findUniqueOrThrow({
          where: { id: row.repairTicketId },
          select: {
            status: true,
            deletedAt: true,
            payer: true,
            estimatedCostPayer: true,
            estimatedCost: true,
            actualCost: true,
            repairSupplierId: true,
            externalClaimNo: true,
            sentToRepairAt: true,
            repairedAt: true,
            returnedToCustomerAt: true,
          },
        })
      : null;
    // An unavailable supplier must not become a fabricated "repaired in shop".
    if (ticket?.repairSupplierId)
      await this.repairs.supplier(tx, ctx.snapshot, ticket.repairSupplierId, true);
    const repairSupplier = ticket?.repairSupplierId
      ? await tx.supplier.findUniqueOrThrow({
          where: { id: ticket.repairSupplierId },
          select: { name: true },
        })
      : null;
    if (kind === 'RECEIPT') for (const key of row.photoKeys) assertCaseIntakeKey(id, key);
    const events = await tx.afterSalesEvent.findMany({
      where: { caseId: id, kind: 'OUTCOME_SET' },
      select: { note: true },
    });
    const receiptOutcome = dropOffOutcome({
      outcome: row.outcome,
      repairTicketStatus: ticket?.status ?? null,
      outcomeNotes: events.map((e) => e.note),
    });
    const productSelect = {
      id: true,
      brand: true,
      model: true,
      storage: true,
      imeiSerial: true,
    } as const;
    const [customer, branch, receivedBy, product, replacementProduct, replacementContract] =
      await Promise.all([
        tx.customer.findUniqueOrThrow({
          where: { id: row.customerId },
          select: { name: true, phone: true, lineIdShop: true },
        }),
        tx.branch.findUniqueOrThrow({ where: { id: row.branchId }, select: { name: true } }),
        tx.user.findUniqueOrThrow({ where: { id: row.receivedById }, select: { name: true } }),
        row.productId
          ? tx.product.findUniqueOrThrow({ where: { id: row.productId }, select: productSelect })
          : null,
        row.replacementProductId
          ? tx.product.findUniqueOrThrow({
              where: { id: row.replacementProductId },
              select: productSelect,
            })
          : null,
        row.replacementContractId
          ? tx.contract.findUniqueOrThrow({
              where: { id: row.replacementContractId },
              select: { id: true, contractNumber: true, status: true },
            })
          : null,
      ]);
    const request = facts.exchangeAccess?.request;
    if (request?.newContractId && request.newContractId !== row.replacementContractId)
      throw new ForbiddenException('ไม่พบแหล่งเอกสารที่ตรวจสอบได้');
    const stage = deriveStage({
      outcome: row.outcome,
      cancelledAt: row.cancelledAt,
      closedAt: row.closedAt,
      repairStatus: ticket?.status ?? null,
      repairDeleted: !!ticket?.deletedAt,
      replacementContractId: row.replacementContractId,
      exchange: request
        ? {
            status: request.status,
            mode: request.mode,
            memoAppliedAt: request.memoAppliedAt,
            newContractStatus: replacementContract?.status ?? null,
          }
        : null,
    });
    // Internal typed composition input only. It is neither a public view nor a
    // capability to reload through another transaction. No payment/navigation data.
    const documentCase = {
      ...row,
      stage,
      branch,
      receivedBy,
      customer: { name: customer.name, phone: customer.phone },
      lineLinked: !!customer.lineIdShop,
      repairTicket: ticket ? { ...ticket, repairSupplier } : null,
      exchange: row.outcome?.includes('EXCHANGE')
        ? {
            mode: request?.mode ?? null,
            oldProduct: product,
            newProduct: replacementProduct,
            replacementContract,
          }
        : null,
      timeline: [] as Array<{ kind: string; note: string | null }>,
    };
    return { documentCase, receiptOutcome };
  }
}
export type AfterSalesDocumentCase = Awaited<
  ReturnType<AccessAfterSalesStreams['document']>
>['documentCase'];
