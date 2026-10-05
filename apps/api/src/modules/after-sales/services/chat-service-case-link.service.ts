import { RECONCILE_SELECT, type ReconcilableCase } from './after-sales-stage-reconcile';
import { serviceCaseStage } from '../../staff-chat/services/chat-service-case-state';
import { serviceCustomerFamily } from '../../staff-chat/services/chat-service-access';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AfterSalesCase, Prisma } from '@prisma/client';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseBooleanFlag } from '../../../utils/config.util';
import { ChatWorkAccessService } from '../../staff-chat/services/chat-work-access.service';
import {
  canonicalServiceCustomer,
  serviceBranchWhere,
} from '../../staff-chat/services/chat-service-access';
import type { CreateCaseResult } from './after-sales-case.service';
export interface ServiceCaseCandidate {
  branchId: string;
  customerId: string;
  productId: string | null;
  contractId: string | null;
  saleId: string | null;
  deviceImei: string | null;
}
const requestInclude = {
  todo: true,
  requestedProduct: { select: { imeiSerial: true } },
  room: { select: { customerId: true, channel: true } },
} as const;
type ServiceRequest = Prisma.ChatServiceRequestGetPayload<{ include: typeof requestInclude }>;
export function serviceCaseBrief(row: AfterSalesCase & ReconcilableCase): CreateCaseResult {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    repairTicketId: row.repairTicketId,
    outcome: row.outcome!,
    exchangeRequestId: row.exchangeRequestId,
    stage: serviceCaseStage(row),
  };
}
@Injectable()
export class ChatServiceCaseLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
  ) {}
  async lockRequest(
    tx: Prisma.TransactionClient,
    id: string,
    authenticated: Pick<ChatWorkActor, 'id'>,
    selected?: WorkScope,
  ) {
    const initial = await tx.chatServiceRequest.findUnique({
      where: { id },
      select: { roomId: true },
    });
    if (!initial) throw new NotFoundException('ไม่พบใบรับเรื่อง');
    await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${initial.roomId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM chat_service_requests WHERE id = ${id} FOR UPDATE`;
    const actor = await this.access.currentActor(authenticated, tx);
    if (!['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(actor.role))
      throw new ForbiddenException('ไม่มีสิทธิ์เปิดหรือผูกเคสหลังการขาย');
    if (
      !parseBooleanFlag(
        (
          await tx.systemConfig.findFirst({
            where: { key: 'chat_service_requests_enabled', deletedAt: null },
          })
        )?.value,
        false,
      )
    )
      throw new ForbiddenException('ยังไม่เปิดรับเรื่องจากแชท');
    const request = await tx.chatServiceRequest.findFirst({
      where: { id, deletedAt: null, todo: { deletedAt: null } },
      include: requestInclude,
    });
    if (!request) throw new NotFoundException('ไม่พบใบรับเรื่อง');
    const scope = selected ?? {
      company: request.room.channel === 'LINE_FINANCE' ? ('FINANCE' as const) : ('SHOP' as const),
    };
    await this.access.assertRoom(request.roomId, actor, scope, tx);
    if (
      actor.role === 'SALES' &&
      request.createdById !== actor.id &&
      request.todo.assigneeId !== actor.id
    )
      throw new ForbiddenException('เฉพาะผู้รับเรื่อง ผู้รับงาน หรือผู้จัดการ');
    if (!['OPEN', 'WAITING_CUSTOMER', 'LINKED'].includes(request.status))
      throw new ConflictException('ใบรับเรื่องปิดแล้ว');
    return { request, actor, scope };
  }
  private async validateCandidate(
    tx: Prisma.TransactionClient,
    request: ServiceRequest,
    candidate: ServiceCaseCandidate,
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    if (!request.room.customerId) throw new BadRequestException('ผูกลูกค้าในห้องก่อนเชื่อมเคสจริง');
    const canonical = await canonicalServiceCustomer(tx, request.room.customerId);
    if (canonical !== (await canonicalServiceCustomer(tx, candidate.customerId)))
      throw new BadRequestException('ลูกค้าในเคสไม่ตรงกับห้องแชท');
    if (
      request.customerId &&
      canonical !== (await canonicalServiceCustomer(tx, request.customerId))
    )
      throw new ConflictException('ลูกค้าของห้องเปลี่ยนจากใบรับเรื่อง กรุณาตรวจข้อมูล');
    if (
      !(await tx.branch.count({
        where: { AND: [serviceBranchWhere(actor, scope), { id: candidate.branchId }] },
      }))
    )
      throw new ForbiddenException('ไม่มีสิทธิ์เคสในบริษัทหรือสาขานี้');
    if (request.requestedProductId && request.requestedProductId !== candidate.productId)
      throw new BadRequestException('เครื่องไม่ตรงกับใบรับเรื่อง');
    if (request.contractId && request.contractId !== candidate.contractId)
      throw new BadRequestException('สัญญาไม่ตรงกับใบรับเรื่อง');
    if (request.saleId && request.saleId !== candidate.saleId)
      throw new BadRequestException('ใบขายไม่ตรงกับใบรับเรื่อง');
    const imei = request.requestedProduct?.imeiSerial?.trim();
    if (imei && imei !== candidate.deviceImei?.trim())
      throw new BadRequestException('IMEI ในเคสไม่ตรงกับเครื่องที่รับเรื่อง');
  }
  async creationInTx(
    tx: Prisma.TransactionClient,
    requestId: string,
    actor: Pick<ChatWorkActor, 'id'>,
  ) {
    const context = await this.lockRequest(tx, requestId, actor);
    if (!context.request.afterSalesCaseId) return null;
    const c = await this.caseInScope(
      tx,
      context.request.afterSalesCaseId,
      context.actor,
      context.scope,
    );
    await this.validateCandidate(tx, context.request, c, context.actor, context.scope);
    return serviceCaseBrief(c);
  }
  async existingForCreation(requestId: string, actor: Pick<ChatWorkActor, 'id'>) {
    return this.prisma.$transaction((tx) => this.creationInTx(tx, requestId, actor));
  }
  async candidateForCreation(
    requestId: string,
    candidate: ServiceCaseCandidate,
    actor: Pick<ChatWorkActor, 'id'>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.lockRequest(tx, requestId, actor);
      await this.validateCandidate(tx, context.request, candidate, context.actor, context.scope);
    });
  }
  private async caseInScope(
    tx: Prisma.TransactionClient,
    caseId: string,
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    const c = await tx.afterSalesCase.findFirst({
      where: { id: caseId, deletedAt: null, branch: serviceBranchWhere(actor, scope) },
      include: {
        repairTicket: RECONCILE_SELECT.repairTicket,
        exchangeRequest: RECONCILE_SELECT.exchangeRequest,
      },
    });
    if (!c) throw new NotFoundException('ไม่พบเคสหรือไม่มีสิทธิ์');
    return c;
  }
  async linkInTx(
    tx: Prisma.TransactionClient,
    input: {
      requestId: string;
      caseId: string;
      actor: Pick<ChatWorkActor, 'id'>;
      expectedRevision?: number;
      scope?: WorkScope;
    },
  ) {
    const { request, actor, scope } = await this.lockRequest(
      tx,
      input.requestId,
      input.actor,
      input.scope,
    );
    await tx.$queryRaw`SELECT id FROM after_sales_cases WHERE id = ${input.caseId} FOR UPDATE`;
    const c = await this.caseInScope(tx, input.caseId, actor, scope);
    await this.validateCandidate(tx, request, c, actor, scope);
    if (request.afterSalesCaseId) {
      if (request.afterSalesCaseId !== c.id)
        throw new ConflictException('ใบรับเรื่องเชื่อมกับเคสอื่นแล้ว');
      return request;
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== request.revision)
      throw new ConflictException('ใบรับเรื่องมีการแก้ไขแล้ว กรุณาโหลดล่าสุด');
    if (await tx.chatServiceRequest.count({ where: { afterSalesCaseId: c.id } }))
      throw new ConflictException('เคสนี้เชื่อมกับใบรับเรื่องอื่นแล้ว');
    const linked = await tx.chatServiceRequest.update({
      where: { id: request.id },
      data: { afterSalesCaseId: c.id, status: 'LINKED', revision: { increment: 1 } },
      include: requestInclude,
    });
    await tx.chatServiceRequestEvent.create({
      data: {
        requestId: request.id,
        kind: 'LINK_CASE',
        fromStatus: request.status,
        toStatus: 'LINKED',
        actorId: actor.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: 'CHAT_SERVICE_CASE_LINKED',
        entity: 'ChatServiceRequest',
        entityId: request.id,
        newValue: { caseId: c.id, caseNumber: c.caseNumber },
      },
    });
    return linked;
  }
  async prefill(id: string, authenticated: ChatWorkActor, scope: WorkScope) {
    return this.prisma.$transaction(async (tx) => {
      const { request, actor } = await this.lockRequest(tx, id, authenticated, scope);
      if (!request.room.customerId) throw new BadRequestException('ผูกลูกค้าในห้องก่อนเปิดเคส');
      const customerId = await canonicalServiceCustomer(tx, request.room.customerId);
      if (
        request.customerId &&
        customerId !== (await canonicalServiceCustomer(tx, request.customerId))
      )
        throw new ConflictException('ลูกค้าของห้องเปลี่ยน กรุณาตรวจใบรับเรื่อง');
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: customerId },
        select: { id: true, name: true },
      });
      return {
        serviceRequestId: request.id,
        revision: request.revision,
        customer,
        symptom: request.symptom,
        imei: request.requestedProduct?.imeiSerial ?? '',
        branchId: actor.branchId,
        linkedCaseId: request.afterSalesCaseId,
      };
    });
  }
  async options(
    id: string,
    authenticated: ChatWorkActor,
    scope: WorkScope,
    search = '',
    page = 1,
    limit = 20,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const { request, actor } = await this.lockRequest(tx, id, authenticated, scope);
      if (!request.room.customerId) throw new BadRequestException('ผูกลูกค้าในห้องก่อนเลือกเคส');
      const family = await serviceCustomerFamily(tx, request.room.customerId);
      const where: Prisma.AfterSalesCaseWhereInput = {
        deletedAt: null,
        branch: serviceBranchWhere(actor, scope),
        customerId: { in: family.ids },
        chatServiceRequest: null,
        ...(request.requestedProductId ? { productId: request.requestedProductId } : {}),
        ...(request.requestedProduct?.imeiSerial
          ? { deviceImei: request.requestedProduct.imeiSerial }
          : {}),
        ...(request.contractId ? { contractId: request.contractId } : {}),
        ...(request.saleId ? { saleId: request.saleId } : {}),
        ...(search.trim()
          ? {
              OR: [
                { caseNumber: { contains: search.trim(), mode: 'insensitive' } },
                { deviceImei: { contains: search.trim() } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.afterSalesCase.findMany({
          where,
          select: {
            ...RECONCILE_SELECT,
            caseNumber: true,
            deviceImei: true,
            deviceBrand: true,
            deviceModel: true,
          },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
        }),
        tx.afterSalesCase.count({ where }),
      ]);
      return {
        data: rows.map((c) => ({
          id: c.id,
          caseNumber: c.caseNumber,
          deviceImei: c.deviceImei,
          deviceBrand: c.deviceBrand,
          deviceModel: c.deviceModel,
          stage: serviceCaseStage(c),
        })),
        total,
        page,
        limit,
      };
    });
  }
  link(
    id: string,
    input: { caseId: string; expectedRevision: number },
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    return this.prisma.$transaction((tx) =>
      this.linkInTx(tx, {
        requestId: id,
        caseId: input.caseId,
        expectedRevision: input.expectedRevision,
        actor,
        scope,
      }),
    );
  }
}
