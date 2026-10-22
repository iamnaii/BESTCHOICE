import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PermissionKey, canAccess } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessResourceService } from './access-resource.service';
import { lockEmployeeAccess } from './access-snapshot.service';
import { AccessPartySourceService } from './access-party-source.service';
import { currentDomainAccess } from './access-execution-context';
import { currentPreparationSource } from './access-contract-preparation-source';
import { currentFinanceReadWhere } from './access-contract-read-scope';
import { requestedAccessCompany } from './access-shop-boundaries';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { ACCESS_RESOURCE_EXECUTE } from './access-policy';
import { calculateAgeInYears } from '../../utils/date.util';
import { safeReferenceError } from './access-shared-reference';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import {
  UPLOADED_DOCUMENT_OPERATIONS,
  UploadedDocumentOperation,
  uploadedDocumentRequest,
} from './access-contract-files-context';

type FileRequest = {
  user?: { id?: string; role?: string; branchId?: string | null };
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  [ACCESS_RESOURCE_EXECUTE]?: (handler: () => Promise<unknown>) => Promise<unknown>;
};
export const uploadedDocumentPermission = (operation: UploadedDocumentOperation): PermissionKey =>
  operation === 'upload'
    ? 'contract-documents.create'
    : operation === 'remove'
      ? 'contract-documents.update'
      : ['content', 'recordDownload'].includes(operation)
        ? 'contract-documents.export'
        : 'contract-documents.read';
const sensitive: PermissionKey[] = [
  'sensitive.customer-identity.read',
  'sensitive.cost.read',
  'sensitive.profit.read',
  'sensitive.salary.read',
  'sensitive.seller-bank.read',
];
const deny = () => new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสาร');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const legacyRoles: Record<UploadedDocumentOperation, readonly string[]> = {
  findByContract: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'],
  getDocumentChecklist: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'],
  getDocumentAuditTrail: ['OWNER', 'BRANCH_MANAGER'],
  upload: ['OWNER', 'BRANCH_MANAGER', 'SALES'],
  recordView: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'],
  content: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'],
  recordDownload: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'],
  remove: ['OWNER', 'BRANCH_MANAGER'],
};

@Injectable()
export class AccessContractFilesBoundaries implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: AccessResourceService,
    private readonly parties: AccessPartySourceService,
  ) {}
  onModuleInit() {
    for (const operation of UPLOADED_DOCUMENT_OPERATIONS)
      ACCESS_BOUNDARIES.set(`ContractDocumentsController.${operation}`, async (req) => ({
        kind: 'selection',
        company: requestedAccessCompany(req),
        execute: (handler) => this.enter(operation, req, handler),
      }));
  }
  /** Called only for exact uploaded-controller handlers by the genuine guard.
   * The final execution repeats every predicate after its own current locks. */
  async preflight(operation: UploadedDocumentOperation, req: FileRequest): Promise<boolean> {
    const actor = await this.actor(req);
    if (!actor.accessManaged) {
      await this.current(operation, req, async () => undefined, false);
      return false;
    }
    await this.current(operation, req, async () => undefined, false);
    return true;
  }
  attach(operation: UploadedDocumentOperation, req: FileRequest) {
    req[ACCESS_RESOURCE_EXECUTE] = (handler) => this.enter(operation, req, handler);
  }
  private async actor(req: FileRequest) {
    if (!req.user?.id) throw deny();
    const actor = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        accessManaged: true,
        isActive: true,
        deletedAt: true,
        isSystemUser: true,
      },
    });
    if (!actor?.isActive || actor.deletedAt || actor.isSystemUser) throw deny();
    return actor;
  }
  private async enter<T>(
    operation: UploadedDocumentOperation,
    req: FileRequest,
    handler: () => Promise<T>,
  ): Promise<T> {
    // @Res must run outside the transaction. Its service invokes release exactly
    // once; only the committed verified result reaches the response writer.
    if (operation === 'content') {
      let used = false;
      return uploadedDocumentRequest.run(
        {
          actorId: req.user!.id!,
          operation,
          release: (work) => {
            if (used) throw deny();
            used = true;
            return this.current(operation, req, work);
          },
        },
        handler,
      );
    }
    return this.current(operation, req, handler);
  }
  private async current<T>(
    operation: UploadedDocumentOperation,
    req: FileRequest,
    handler: () => Promise<T>,
    evidence = true,
  ): Promise<T> {
    const actor = await this.actor(req);
    try {
      if (!actor.accessManaged) {
        return await this.prisma.$transaction(async (tx) => {
          await lockEmployeeAccess(tx);
          await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.id} FOR SHARE`;
          const live = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
          if (live.accessManaged || !live.isActive || live.deletedAt || live.isSystemUser)
            throw deny();
          if (!legacyRoles[operation].includes(live.role)) throw deny();
          req.user = { ...req.user, id: live.id, role: live.role, branchId: live.branchId };
          await tx.$queryRaw`SELECT id FROM contracts WHERE id=${req.params!.contractId} FOR UPDATE`;
          const parent = await tx.contract.findUnique({
            where: { id: req.params!.contractId },
            select: { branchId: true, deletedAt: true },
          });
          if (!parent || parent.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
          if (
            !hasCrossBranchAccess(req.user!) &&
            (!req.user?.branchId || req.user.branchId !== parent.branchId)
          )
            throw deny();
          if (
            req.params?.docId &&
            !(await tx.contractDocument.count({
              where: { id: req.params.docId, contractId: req.params.contractId, deletedAt: null },
            }))
          )
            throw new NotFoundException('ไม่พบเอกสารของสัญญานี้');
          return uploadedDocumentRequest.run(
            { actorId: actor.id, operation, legacyClient: tx },
            handler,
          );
        });
      }
      const company = requestedAccessCompany(req);
      return (
        await this.resources.execute(
          actor.id,
          uploadedDocumentPermission(operation),
          company,
          undefined,
          async () => {
            this.validate(operation, req);
            const ctx = currentDomainAccess()!,
              tx = ctx.client;
            await tx.$queryRaw`SELECT id FROM contracts WHERE id=${req.params!.contractId} FOR UPDATE`;
            const mutation = operation === 'upload' || operation === 'remove';
            let source: {
              company: 'SHOP' | 'FINANCE';
              branchId?: string | null;
              assignedUserIds?: readonly string[];
            };
            if (company === 'SHOP') {
              const row = await currentPreparationSource(
                req.params!.contractId,
                mutation ? ['contracts.read', 'contracts.update'] : ['contracts.read'],
              );
              source = row.source;
            } else {
              source = await this.parties.financeContract(tx, req.params!.contractId, true);
              for (const permission of mutation
                ? (['contracts.read', 'contracts.update'] as const)
                : (['contracts.read'] as const))
                if (
                  !(await tx.contract.count({
                    where: {
                      id: req.params!.contractId,
                      AND: await currentFinanceReadWhere(permission),
                    },
                  }))
                )
                  throw deny();
            }
            const required: PermissionKey[] = [uploadedDocumentPermission(operation)];
            if (['content', 'recordDownload', 'remove'].includes(operation))
              required.push('contract-documents.read');
            if (required.some((key) => !canAccess(ctx.snapshot, key, source))) throw deny();
            const parent = await tx.contract.findUniqueOrThrow({
              where: { id: req.params!.contractId },
              select: { id: true, customerId: true, branchId: true },
            });
            const customerSources = await this.parties.customer(
              tx,
              parent.customerId,
              true,
              false,
              true,
            );
            // Reviewed read-only Customer proof from this exact authorized case;
            // current case assignment is never shared-identity mutation authority.
            if (company === 'FINANCE') customerSources.push(source);
            const customerRead = customerSources.some((s) =>
              canAccess(ctx.snapshot, 'customers.read', s),
            );
            const identityRead = customerSources.some(
              (s) =>
                canAccess(ctx.snapshot, 'customers.read', s) &&
                canAccess(ctx.snapshot, 'sensitive.customer-identity.read', s),
            );
            const visible =
              sensitive.every((key) => canAccess(ctx.snapshot, key, source)) &&
              customerSources.some(
                (s) =>
                  canAccess(ctx.snapshot, 'customers.read', s) &&
                  sensitive.every((key) => canAccess(ctx.snapshot, key, s)),
              );
            if (mutation && !customerRead) throw deny();
            if (
              ['content', 'recordView', 'recordDownload', 'remove'].includes(operation) &&
              !visible
            )
              throw deny();
            if (req.params!.docId) {
              await tx.$queryRaw`SELECT id FROM contract_documents WHERE id=${req.params!.docId} FOR UPDATE`;
              if (
                !(await tx.contractDocument.count({
                  where: { id: req.params!.docId, contractId: parent.id, deletedAt: null },
                }))
              )
                throw new NotFoundException('ไม่พบเอกสารของสัญญานี้');
            }
            const customer = identityRead
              ? await tx.customer.findUniqueOrThrow({
                  where: { id: parent.customerId },
                  select: { birthDate: true },
                })
              : null;
            const age = customer?.birthDate ? calculateAgeInYears(customer.birthDate) : null;
            const proof = {
              contractId: parent.id,
              customerId: parent.customerId,
              branchId: parent.branchId,
              company,
              visible,
              requiresGuardian: age === null ? null : age >= 17 && age < 20,
            };
            const result = await uploadedDocumentRequest.run(
              { actorId: actor.id, operation, proof },
              handler,
            );
            if (evidence)
              await tx.auditLog.create({
                data: {
                  userId: actor.id,
                  entity: 'contract_document',
                  entityId: req.params!.docId ?? parent.id,
                  action: 'CONTRACT_DOCUMENT_' + operation.toUpperCase(),
                  newValue: { operation, company, outcome: 'SUCCESS' },
                },
              });
            return result;
          },
          false,
          { isolationLevel: 'Serializable', maxAttempts: 3 },
        )
      ).result;
    } catch (error) {
      throw safeReferenceError(error);
    }
  }
  private validate(operation: UploadedDocumentOperation, req: FileRequest) {
    if (
      !uuid.test(req.params?.contractId ?? '') ||
      (req.params?.docId && !uuid.test(req.params.docId))
    )
      throw new BadRequestException('รหัสเอกสารไม่ถูกต้อง');
    const query = req.query ?? {};
    const keys = operation === 'findByContract' ? ['company', 'page', 'limit'] : ['company'];
    if (
      Object.entries(query).some(([key, value]) => !keys.includes(key) || typeof value !== 'string')
    )
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    for (const [key, max] of [
      ['page', 1000000],
      ['limit', 100],
    ] as const)
      if (
        query[key] !== undefined &&
        (!/^[1-9]\d*$/.test(String(query[key])) || Number(query[key]) > max)
      )
        throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
  }
}
