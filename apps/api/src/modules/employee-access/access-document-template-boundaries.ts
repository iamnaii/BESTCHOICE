import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessSnapshot, Company, PermissionKey, PlanType } from '@installment/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { AccessResourceService, retryable } from './access-resource.service';
import { AccessSnapshotService, lockEmployeeAccess } from './access-snapshot.service';
import { currentDomainAccess, domainAccessExecution } from './access-execution-context';
import { permissionScopes } from './access-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { safeReferenceError } from './access-shared-reference';
import { accessTransaction, AccessTransactionDeadline } from './access-transaction-deadline';
import {
  TEMPLATE_OPERATIONS,
  TemplateOperation,
  templateRequest,
} from './access-document-template-context';

type TemplateRequest = {
  user?: { id?: string };
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  headers?: Record<string, unknown>;
};
const read = (operation: TemplateOperation) =>
  operation === 'findAllTemplates' || operation === 'findOneTemplate';
const permission = (operation: TemplateOperation): PermissionKey =>
  read(operation) ? 'contract-templates.read' : 'settings.documents.manage';
const deny = () => new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเทมเพลต');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DOCUMENT_TEMPLATE_ROUTES = TEMPLATE_OPERATIONS.map(
  (operation) => `DocumentsController.${operation}`,
);

@Injectable()
export class AccessDocumentTemplateBoundaries implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: AccessResourceService,
    private readonly snapshots: AccessSnapshotService,
  ) {}
  onModuleInit() {
    for (const operation of TEMPLATE_OPERATIONS) {
      ACCESS_BOUNDARIES.set(`DocumentsController.${operation}`, async (req) => ({
        kind: 'reference',
        company: requestedAccessCompany(req),
        execute: (handler) => this.enter(operation, req, handler),
      }));
    }
  }
  /** The compatibility controller entrance is explicit; internal rendering never enters here. */
  async enter<T>(
    operation: TemplateOperation,
    req: TemplateRequest,
    handler: () => Promise<T>,
  ): Promise<T> {
    const actorId = req.user?.id;
    if (!actorId) throw deny();
    const existing = templateRequest.getStore();
    if (existing) {
      if (existing.actorId !== actorId || existing.operation !== operation) throw deny();
      return handler();
    }
    const company = requestedAccessCompany(req),
      eventId = randomUUID();
    const run = async <R>(
      work: (snapshot: AccessSnapshot) => Promise<R>,
      deadline?: AccessTransactionDeadline,
    ) =>
      this.current(
        actorId,
        operation,
        company,
        async (snapshot) => {
          this.validate(req, operation, snapshot.isOwner);
          return work(snapshot);
        },
        deadline,
      );
    if (operation === 'generateTemplateFromFile') {
      return templateRequest.run(
        {
          actorId,
          operation,
          stage: async (stage, deadline) =>
            run(async () => {
              deadline.check();
              if (stage !== 'PREPARE')
                await this.audit(
                  operation,
                  actorId,
                  company,
                  stage === 'ADMITTED'
                    ? 'CONTRACT_TEMPLATE_OCR_ADMITTED'
                    : 'CONTRACT_TEMPLATE_OCR_COMPLETED',
                  eventId,
                );
              deadline.check();
            }, deadline),
        },
        handler,
      );
    }
    return run((snapshot) =>
      templateRequest.run({ actorId, operation, snapshot }, async () => {
        const tx = currentDomainAccess()!.client;
        if (req.params?.id) {
          await tx.$queryRaw`SELECT id FROM contract_templates WHERE id=${req.params.id} FOR UPDATE`;
        }
        const result = await handler();
        const id = operation === 'createTemplate' ? (result as { id: string }).id : req.params?.id;
        await this.audit(
          operation,
          actorId,
          company,
          read(operation) ? 'CONTRACT_TEMPLATE_READ' : 'CONTRACT_TEMPLATE_CHANGED',
          id,
        );
        return result;
      }),
    );
  }
  private async audit(
    operation: TemplateOperation,
    actor: string,
    company: Company,
    action: string,
    id?: string,
  ) {
    await currentDomainAccess()!.client.auditLog.create({
      data: {
        userId: actor,
        entity: 'contract_template',
        entityId: id ?? 'global',
        action,
        newValue: {
          route: `DocumentsController.${operation}`,
          operation,
          company,
          ...(read(operation) ? {} : { affectedCompanies: ['SHOP', 'FINANCE'] }),
        },
      },
    });
  }
  private validate(req: TemplateRequest, operation: TemplateOperation, owner: boolean) {
    const query = req.query ?? {};
    const keys =
      operation === 'findAllTemplates' ? ['company', 'type', 'page', 'limit'] : ['company'];
    if (
      Object.entries(query).some(([key, value]) => !keys.includes(key) || typeof value !== 'string')
    )
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    for (const [key, max] of [
      ['page', 1000000],
      ['limit', 100],
    ] as const) {
      const value = query[key];
      if (value !== undefined && (!/^[1-9]\d*$/.test(String(value)) || Number(value) > max))
        throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
    }
    if (
      query.type !== undefined &&
      (String(query.type).length > 128 ||
        !String(query.type).trim() ||
        (!owner &&
          !Object.values(PlanType).includes(
            query.type as (typeof PlanType)[keyof typeof PlanType],
          )))
    )
      throw new BadRequestException('ประเภทเทมเพลตไม่ถูกต้อง');
    if (req.params?.id && !uuid.test(req.params.id))
      throw new BadRequestException('รหัสเทมเพลตไม่ถูกต้อง');
  }
  private async current<T>(
    actor: string,
    operation: TemplateOperation,
    company: Company,
    handler: (snapshot: AccessSnapshot) => Promise<T>,
    deadline?: AccessTransactionDeadline,
  ): Promise<T> {
    const work = async () => {
      const ctx = currentDomainAccess()!,
        snapshot = ctx.snapshot;
      if (!snapshot.isOwner && !read(operation)) throw deny();
      if (
        snapshot.managed &&
        !permissionScopes({ id: actor, access: snapshot }, permission(operation), company).some(
          (tuple) =>
            tuple.scope === 'COMPANY' || (tuple.scope === 'BRANCHES' && tuple.branchIds.length),
        )
      )
        throw deny();
      if (
        !(await ctx.client.companyInfo.count({
          where: { companyCode: company, isActive: true, deletedAt: null },
        }))
      )
        throw deny();
      return handler(snapshot);
    };
    try {
      const lookup = (tx: Prisma.TransactionClient) =>
        tx.user.findUnique({
          where: { id: actor },
          select: { accessManaged: true },
        });
      const actorRow = deadline
        ? await accessTransaction(this.prisma, lookup, { timeout: 30000 }, deadline)
        : await lookup(this.prisma);
      if (!actorRow) throw deny();
      if (actorRow.accessManaged)
        return (
          await this.resources.execute(
            actor,
            permission(operation),
            company,
            undefined,
            work,
            false,
            { isolationLevel: 'Serializable', maxAttempts: 3, deadline },
          )
        ).result;
      for (let attempt = 1; ; attempt++) {
        deadline?.check();
        try {
          return await accessTransaction(
            this.prisma,
            async (tx) => {
              await lockEmployeeAccess(tx);
              await tx.$queryRaw`SELECT id FROM users WHERE id=${actor} FOR SHARE`;
              await tx.$queryRaw`SELECT id FROM company_info WHERE company_code=${company} FOR SHARE`;
              const snapshot = deadline
                ? await this.snapshots.forOwnerInTransaction(tx, actor)
                : await this.snapshots.forUserInTransaction(tx, actor);
              const user = await tx.user.findUniqueOrThrow({ where: { id: actor } });
              if (
                snapshot.managed ||
                (!snapshot.isOwner &&
                  (!read(operation) ||
                    !['BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'].includes(
                      user.role,
                    )))
              )
                throw deny();
              return domainAccessExecution.run(
                {
                  client: tx,
                  snapshot,
                  scope: { userId: actor, company, permission: permission(operation), tuples: [] },
                  scopeReads: false,
                  isolationLevel: 'Serializable',
                },
                work,
              );
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 },
            deadline,
          );
        } catch (error) {
          if (attempt < 3 && retryable(error, false)) continue;
          throw error;
        }
      }
    } catch (error) {
      throw safeReferenceError(error);
    }
  }
}
