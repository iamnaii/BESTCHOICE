import {
  syncClosedServiceWork,
  serviceCaseSelect,
  serviceCaseStage,
} from './chat-service-case-state';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type ChatServiceRequestStatus } from '@prisma/client';
import type { ChatWorkActor, WorkScope } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseBooleanFlag } from '../../../utils/config.util';
import { ChatWorkAccessService } from './chat-work-access.service';
import { ChatFollowUpService } from './chat-follow-up.service';
import {
  canonicalServiceCustomer,
  serviceBranchWhere,
  serviceCustomerFamily,
} from './chat-service-access';
import {
  CreateChatServiceRequestDto,
  UpdateChatServiceRequestDto,
} from '../dto/chat-service-request.dto';
export const serviceRequestTransitions: Record<
  ChatServiceRequestStatus,
  readonly ChatServiceRequestStatus[]
> = {
  OPEN: ['WAITING_CUSTOMER', 'LINKED', 'RESOLVED', 'CANCELLED'],
  WAITING_CUSTOMER: ['OPEN', 'LINKED', 'RESOLVED', 'CANCELLED'],
  LINKED: [],
  RESOLVED: [],
  CANCELLED: [],
};
const include = { todo: { include: { assignee: { select: { id: true, name: true } } } } } as const;
@Injectable()
export class ChatServiceRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatWorkAccessService,
    private readonly tasks: ChatFollowUpService,
  ) {}
  private async gate(tx: Prisma.TransactionClient) {
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
      throw new ForbiddenException('ยังไม่เปิดรับเรื่องหลังการขายจากแชท');
  }
  private symptom(value: string) {
    if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 5000)
      throw new BadRequestException('ระบุอาการ 5–5000 ตัวอักษร');
    return value.trim();
  }
  async assertRequest(
    id: string,
    actor: ChatWorkActor,
    scope: WorkScope,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    await this.gate(tx);
    const current = await this.access.currentActor(actor, tx);
    const room = await this.access.roomWhere(current, scope, tx);
    const request = await tx.chatServiceRequest.findFirst({
      where: { id, deletedAt: null, room, todo: { deletedAt: null, room } },
      include,
    });
    if (!request) throw new NotFoundException('ไม่พบใบรับเรื่องหรือไม่มีสิทธิ์');
    return { actor: current, request };
  }
  private async references(
    tx: Prisma.TransactionClient,
    roomCustomerId: string | null,
    input: CreateChatServiceRequestDto,
    actor: ChatWorkActor,
    scope: WorkScope,
  ) {
    const selected = !!(input.productId || input.contractId || input.saleId);
    if (!roomCustomerId) {
      if (selected) throw new BadRequestException('ผูกลูกค้าในห้องก่อนเลือกเครื่องหรือเอกสาร');
      return { customerId: null, requestedProductId: null, contractId: null, saleId: null };
    }
    const family = await serviceCustomerFamily(tx, roomCustomerId);
    const branch = serviceBranchWhere(actor, scope);
    const [contract, sale] = await Promise.all([
      input.contractId
        ? tx.contract.findFirst({
            where: {
              id: input.contractId,
              deletedAt: null,
              customerId: { in: family.ids },
              branch,
            },
          })
        : null,
      input.saleId
        ? tx.sale.findFirst({
            where: { id: input.saleId, deletedAt: null, customerId: { in: family.ids }, branch },
          })
        : null,
    ]);
    if ((input.contractId && !contract) || (input.saleId && !sale))
      throw new BadRequestException('เอกสารไม่ตรงกับลูกค้า บริษัท หรือสาขาที่เข้าถึงได้');
    if (sale && contract && sale.contractId !== contract.id)
      throw new BadRequestException('ใบขายกับสัญญาไม่ใช่รายการเดียวกัน');
    const productId = input.productId ?? contract?.productId ?? sale?.productId ?? null;
    if (productId) {
      if (!(await tx.product.count({ where: { id: productId, deletedAt: null } })))
        throw new NotFoundException('ไม่พบเครื่องที่เลือก');
      if (
        (contract && contract.productId !== productId) ||
        (sale && sale.productId !== productId && !sale.bundleProductIds.includes(productId))
      )
        throw new BadRequestException('เครื่องไม่ตรงกับเอกสารที่เลือก');
      if (!contract && !sale) {
        const proof = await Promise.all([
          tx.contract.count({
            where: { productId, deletedAt: null, customerId: { in: family.ids }, branch },
          }),
          tx.sale.count({
            where: {
              deletedAt: null,
              customerId: { in: family.ids },
              branch,
              OR: [{ productId }, { bundleProductIds: { has: productId } }],
            },
          }),
        ]);
        if (!proof.some(Boolean))
          throw new BadRequestException('ไม่พบหลักฐานว่าเครื่องเป็นของลูกค้าในขอบเขตนี้');
      }
    }
    return {
      customerId: family.root,
      requestedProductId: productId,
      contractId: input.contractId ?? null,
      saleId: input.saleId ?? null,
    };
  }
  async create(
    roomId: string,
    input: CreateChatServiceRequestDto,
    authenticated: ChatWorkActor,
    scope: WorkScope,
  ) {
    const symptom = this.symptom(input.symptom);
    const sourceIds = [...new Set(input.sourceMessageIds ?? [])].sort();
    if (
      !Array.isArray(input.sourceMessageIds ?? []) ||
      sourceIds.length > 10 ||
      sourceIds.length !== (input.sourceMessageIds?.length ?? 0)
    )
      throw new BadRequestException('เลือกข้อความไม่ซ้ำกันได้ไม่เกิน 10 รายการ');
    const due = new Date(input.dueAt);
    if (!Number.isFinite(due.getTime()) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.dueAt))
      throw new BadRequestException('กรุณาระบุวันเวลาและเขตเวลา');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          roomId,
          symptom,
          assigneeId: input.assigneeId,
          due: due.toISOString(),
          productId: input.productId ?? null,
          contractId: input.contractId ?? null,
          saleId: input.saleId ?? null,
          sourceIds,
        }),
      )
      .digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${roomId} FOR UPDATE`;
      await this.gate(tx);
      const actor = await this.access.currentActor(authenticated, tx);
      const room = await this.access.assertRoom(roomId, actor, scope, tx);
      const requestKey = `chat-service:${actor.id}:${input.clientRequestId}`;
      const existing = await tx.chatServiceRequest.findUnique({ where: { requestKey }, include });
      if (existing) {
        if (
          existing.roomId !== roomId ||
          existing.deletedAt ||
          existing.requestFingerprint !== fingerprint
        )
          throw new ConflictException('รหัสคำขอนี้ถูกใช้กับใบรับเรื่องอื่นแล้ว');
        return existing;
      }
      if (
        sourceIds.length !==
        (await tx.chatMessage.count({ where: { id: { in: sourceIds }, roomId, deletedAt: null } }))
      )
        throw new BadRequestException('ข้อความอ้างอิงถูกลบหรือไม่ได้อยู่ในห้องนี้');
      const references = await this.references(tx, room.customerId, input, actor, scope);
      const todo = await this.tasks.createInTx(
        tx,
        roomId,
        {
          clientRequestId: input.clientRequestId,
          title: `ติดตามหลังการขาย: ${symptom.slice(0, 210)}`,
          description: symptom,
          assigneeId: input.assigneeId,
          dueAt: input.dueAt,
        },
        actor,
        scope,
        'CHAT_SERVICE',
      );
      const request = await tx.chatServiceRequest.create({
        data: {
          roomId,
          ...references,
          symptom,
          todoId: todo.id,
          createdById: actor.id,
          requestKey,
          requestFingerprint: fingerprint,
          sources: { create: sourceIds.map((messageId) => ({ messageId })) },
        },
        include,
      });
      await tx.chatServiceRequestEvent.create({
        data: { requestId: request.id, kind: 'CREATE', toStatus: 'OPEN', actorId: actor.id },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CHAT_SERVICE_CREATED',
          entity: 'ChatServiceRequest',
          entityId: request.id,
          newValue: { roomId, todoId: todo.id, status: 'OPEN' },
        },
      });
      return request;
    });
  }
  async list(roomId: string, actor: ChatWorkActor, scope: WorkScope, page = 1, limit = 30) {
    await this.access.assertRoom(roomId, actor, scope);
    await syncClosedServiceWork(this.prisma, {
      AND: [await this.access.roomWhere(actor, scope), { id: roomId }],
    });
    return this.prisma.$transaction(
      async (tx) => {
        await this.gate(tx);
        await this.access.assertRoom(roomId, actor, scope, tx);
        const where = { roomId, deletedAt: null, todo: { deletedAt: null } };
        const [data, total] = await Promise.all([
          tx.chatServiceRequest.findMany({
            where,
            include,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
          }),
          tx.chatServiceRequest.count({ where }),
        ]);
        return { data, total, page, limit };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async get(id: string, actor: ChatWorkActor, scope: WorkScope) {
    await this.assertRequest(id, actor, scope);
    await syncClosedServiceWork(this.prisma, await this.access.roomWhere(actor, scope), id);
    return this.prisma.$transaction(async (tx) => {
      const { request, actor: currentActor } = await this.assertRequest(id, actor, scope, tx);
      const sources = await tx.chatServiceRequestSource.findMany({
        where: { requestId: id, message: { roomId: request.roomId, deletedAt: null } },
        select: { message: { select: { id: true, text: true, createdAt: true, role: true } } },
      });
      const room = await tx.chatRoom.findUniqueOrThrow({
        where: { id: request.roomId },
        select: { customerId: true },
      });
      const customerId = room.customerId
        ? await canonicalServiceCustomer(tx, room.customerId)
        : null;
      const linked = request.afterSalesCaseId
        ? await tx.afterSalesCase.findFirst({
            where: {
              id: request.afterSalesCaseId,
              deletedAt: null,
              branch: serviceBranchWhere(currentActor, scope),
            },
            select: serviceCaseSelect,
          })
        : null;
      const eligible =
        ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(currentActor.role) &&
        (currentActor.role !== 'SALES' ||
          request.createdById === currentActor.id ||
          request.todo.assigneeId === currentActor.id);
      const active = ['OPEN', 'WAITING_CUSTOMER'].includes(request.status);
      return {
        ...request,
        linkedCase: linked
          ? {
              id: linked.id,
              caseNumber: linked.caseNumber,
              stage: serviceCaseStage(linked),
              outcome: linked.outcome,
              deviceImei: linked.deviceImei,
            }
          : null,
        linkedCaseUnavailable: !!request.afterSalesCaseId && !linked,
        currentCustomerId: customerId,
        sourceMessages: sources.map((s) => s.message),
        canOpenCase: eligible && active && !!customerId,
        canLinkCase: eligible && active && !!customerId,
      };
    });
  }
  async update(
    id: string,
    input: UpdateChatServiceRequestDto,
    authenticated: ChatWorkActor,
    scope: WorkScope,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const initial = await this.assertRequest(id, authenticated, scope, tx);
      // Same room→request ordering as create, Todo writers and future case linking.
      await tx.$queryRaw`SELECT id FROM chat_rooms WHERE id = ${initial.request.roomId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM chat_service_requests WHERE id = ${id} FOR UPDATE`;
      const { request, actor } = await this.assertRequest(id, authenticated, scope, tx);
      if (input.expectedRevision !== request.revision)
        throw new ConflictException('ใบรับเรื่องมีการแก้ไขแล้ว กรุณาโหลดล่าสุด');
      const status = input.status ?? request.status;
      if (request.status === 'LINKED') {
        if (input.status !== undefined || input.symptom !== undefined)
          throw new ConflictException('รายละเอียดและสถานะซ่อมต้องดำเนินการผ่านเคสหลังการขาย');
        const c = request.afterSalesCaseId
          ? await tx.afterSalesCase.findFirst({
              where: { id: request.afterSalesCaseId, deletedAt: null },
              select: serviceCaseSelect,
            })
          : null;
        if (!c || ['CLOSED', 'CANCELLED'].includes(serviceCaseStage(c)))
          throw new ConflictException('เคสสิ้นสุดแล้ว ไม่สามารถเลื่อนงานติดตาม');
      }
      if (['RESOLVED', 'CANCELLED'].includes(request.status))
        throw new ConflictException('ใบรับเรื่องปิดแล้ว');
      if (
        (status === 'LINKED' && request.status !== 'LINKED') ||
        (status !== request.status && !serviceRequestTransitions[request.status].includes(status))
      )
        throw new BadRequestException('เปลี่ยนสถานะนี้ไม่ได้');
      const terminal = status === 'RESOLVED' || status === 'CANCELLED';
      if (terminal && (!input.reason?.trim() || input.reason.length > 1000))
        throw new BadRequestException('ระบุเหตุผลที่ปิดหรือยกเลิกเรื่อง');
      const symptom = input.symptom === undefined ? request.symptom : this.symptom(input.symptom);
      await this.tasks.updateInTx(
        tx,
        request.todoId,
        {
          expectedRevision: request.todo.revision,
          assigneeId: input.assigneeId,
          dueAt: input.dueAt,
          ...(input.symptom === undefined
            ? {}
            : { title: `ติดตามหลังการขาย: ${symptom.slice(0, 210)}`, description: symptom }),
          ...(terminal ? { status: status === 'RESOLVED' ? 'DONE' : 'CANCELLED' } : {}),
        },
        actor,
        scope,
        ['CHAT_SERVICE'],
      );
      const updated = await tx.chatServiceRequest.update({
        where: { id },
        data: { symptom, status, revision: { increment: 1 } },
        include,
      });
      await tx.chatServiceRequestEvent.create({
        data: {
          requestId: id,
          kind: status === request.status ? 'UPDATE' : 'STATUS',
          fromStatus: request.status,
          toStatus: status,
          actorId: actor.id,
          reason: input.reason?.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'CHAT_SERVICE_UPDATED',
          entity: 'ChatServiceRequest',
          entityId: id,
          oldValue: { status: request.status, revision: request.revision },
          newValue: {
            status,
            revision: updated.revision,
            ...(input.reason ? { reason: input.reason.trim() } : {}),
          },
        },
      });
      return updated;
    });
  }
}
