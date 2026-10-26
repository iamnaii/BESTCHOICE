import { assertSignatureAuthority, SignatureAuthority } from './access-signatures-boundaries';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AccessSnapshot, canAccess, PermissionKey } from '@installment/shared';
import { Prisma, SignedDocumentProductionEvent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessResourceService } from './access-resource.service';
import { AccessPartySourceService } from './access-party-source.service';
import { currentPreparationSource } from './access-contract-preparation-source';
import { currentFinanceReadWhere } from './access-contract-read-scope';
import { currentDomainAccess } from './access-execution-context';
import { requestedAccessCompany } from './access-shop-boundaries';
import { lockEmployeeAccess } from './access-snapshot.service';
import { ACCESS_BOUNDARIES } from './access-policy.registry';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { PartyQueryPlan } from './access-party-query-plan';
import { lockContractStaffSources } from './access-contract-staff-source';
import {
  GENERATED_DOCUMENT_OPERATIONS,
  GeneratedDocumentOperation,
  GeneratedRequest,
  generatedPermission,
  generationOperation,
  generatedSensitive,
} from './access-generated-documents-context';

export const generatedDenied = () => new ForbiddenException('ไม่มีสิทธิ์เข้าถึงเอกสาร');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface GeneratedAuthority {
  tx: Prisma.TransactionClient;
  actorId: string;
  managed: boolean;
  owner: boolean;
  company: 'SHOP' | 'FINANCE';
  parent: {
    id: string;
    customerId: string;
    branchId: string;
    productId: string;
    salespersonId: string;
  } | null;
  documentId?: string;
  visible: boolean;
  snapshot?: AccessSnapshot;
}
export interface GeneratedOriginalSources {
  products: string[];
  payments: string[];
  signatures: string[];
  consent: string | null;
  salesperson: string;
}
@Injectable()
export class AccessGeneratedDocumentsBoundaries implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resources: AccessResourceService,
    private readonly parties: AccessPartySourceService,
  ) {}
  onModuleInit() {
    for (const operation of GENERATED_DOCUMENT_OPERATIONS)
      ACCESS_BOUNDARIES.set(`DocumentsController.${operation}`, async (req) => ({
        kind: 'selection',
        company: requestedAccessCompany(req),
        // Staged canonical service owns its initial/final transactions. In particular
        // @Res is never invoked inside the transaction/retry callback.
        execute: (handler) => handler(),
      }));
  }
  async preflight(operation: GeneratedDocumentOperation, req: GeneratedRequest) {
    return this.current(operation, req, async (proof) => proof.managed);
  }
  async current<T>(
    operation: GeneratedDocumentOperation,
    req: GeneratedRequest,
    work: (proof: GeneratedAuthority) => Promise<T>,
    contractId?: string,
  ): Promise<T> {
    this.validate(operation, req);
    return this.withPrincipal(
      operation,
      {
        actorId: req.user?.id,
        company: requestedAccessCompany(req),
        recordId: String(req.params.id),
      },
      work,
      contractId,
    );
  }
  async signatureProducer<T>(
    proof: SignatureAuthority,
    work: (proof: GeneratedAuthority) => Promise<T>,
  ) {
    assertSignatureAuthority(proof);
    if (proof.operation !== 'signContract') throw generatedDenied();
    return this.withPrincipal(
      'generateSignedDocuments',
      {
        actorId: proof.actorId,
        company: proof.company,
        recordId: proof.parent.id,
        channel: proof.managed ? 'MANAGED_STAFF' : 'LEGACY_STAFF',
      },
      work,
      undefined,
      proof,
    );
  }
  async currentEvent<T>(
    eventId: string,
    work: (proof: GeneratedAuthority, event: SignedDocumentProductionEvent) => Promise<T>,
  ) {
    const event = await this.prisma.signedDocumentProductionEvent.findUnique({
      where: { id: eventId },
    });
    if (
      !event ||
      event.producerKind !== 'CANONICAL_SIGNATURE_COMPLETION' ||
      !event.initiatorUserId ||
      !['MANAGED_STAFF', 'LEGACY_STAFF'].includes(event.initiatorChannel ?? '') ||
      !event.templateChoice
    )
      throw generatedDenied();
    let company: 'SHOP' | 'FINANCE';
    if (event.initiatorChannel === 'MANAGED_STAFF') {
      if (event.selectedCompany !== 'SHOP' && event.selectedCompany !== 'FINANCE')
        throw generatedDenied();
      company = event.selectedCompany;
    } else {
      if (event.selectedCompany !== null) throw generatedDenied();
      const parent = await this.prisma.contract.findUnique({
        where: { id: event.contractId },
        select: { branch: { select: { company: { select: { companyCode: true } } } } },
      });
      const actual = parent?.branch.company?.companyCode;
      if (actual !== 'SHOP' && actual !== 'FINANCE') throw generatedDenied();
      company = actual; // Actual source only; not a selected-work or permission grant.
    }
    return this.withPrincipal(
      'generateSignedDocuments',
      {
        actorId: event.initiatorUserId,
        company,
        recordId: event.contractId,
        channel: event.initiatorChannel!,
      },
      (proof) => work(proof, event),
    );
  }

  private async withPrincipal<T>(
    operation: GeneratedDocumentOperation,
    principal: {
      actorId?: string;
      company: 'SHOP' | 'FINANCE';
      recordId: string;
      channel?: string;
    },
    work: (proof: GeneratedAuthority) => Promise<T>,
    contractId?: string,
    existing?: SignatureAuthority,
  ): Promise<T> {
    const actorId = principal.actorId;
    if (!actorId) throw generatedDenied();
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: {
        id: true,
        accessManaged: true,
        isActive: true,
        deletedAt: true,
        isSystemUser: true,
      },
    });
    if (!actor?.isActive || actor.deletedAt || actor.isSystemUser) throw generatedDenied();
    if (
      principal.channel &&
      principal.channel !== (actor.accessManaged ? 'MANAGED_STAFF' : 'LEGACY_STAFF')
    )
      throw generatedDenied();
    const company = principal.company;
    const run = async (tx: Prisma.TransactionClient, snapshot?: AccessSnapshot): Promise<T> => {
      let owner = !!snapshot?.isOwner;
      let legacyActor: { role: string; branchId: string | null } | undefined;
      if (!snapshot) {
        await lockEmployeeAccess(tx);
        await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId} FOR SHARE`;
        const live = await tx.user.findUniqueOrThrow({
          where: { id: actorId },
          select: {
            role: true,
            branchId: true,
            accessManaged: true,
            isActive: true,
            deletedAt: true,
            isSystemUser: true,
          },
        });
        if (live.accessManaged || !live.isActive || live.deletedAt || live.isSystemUser)
          throw generatedDenied();
        const roles = generationOperation(operation)
          ? ['OWNER', 'BRANCH_MANAGER', 'SALES']
          : ['OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT'];
        if (!roles.includes(live.role)) throw generatedDenied();
        legacyActor = live;
        owner = live.role === 'OWNER';
      }
      if (operation === 'regenerateSignedContractPdfs' && !owner) throw generatedDenied();
      const base: GeneratedAuthority = {
        tx,
        actorId,
        managed: !!snapshot,
        owner,
        company,
        parent: null,
        visible: true,
        snapshot,
      };
      if (operation === 'regenerateSignedContractPdfs' && !contractId) return work(base);
      const documentRoute = ['getDocument', 'downloadDocument', 'getSignedUrl'].includes(operation);
      let parentId = contractId ?? principal.recordId;
      if (documentRoute && !contractId) {
        const document = await tx.eDocument.findUnique({
          where: { id: principal.recordId, deletedAt: null },
          select: { contractId: true },
        });
        if (!document) throw new NotFoundException('ไม่พบเอกสาร');
        parentId = document.contractId;
        base.documentId = principal.recordId;
      }
      await tx.$queryRaw`SELECT id FROM contracts WHERE id=${parentId} FOR UPDATE`;
      const parent = await tx.contract.findUnique({
        where: { id: parentId, deletedAt: null },
        select: {
          id: true,
          customerId: true,
          branchId: true,
          productId: true,
          salespersonId: true,
        },
      });
      if (!parent) throw new NotFoundException('ไม่พบสัญญา');
      base.parent = parent;
      if (!snapshot) {
        if (!hasCrossBranchAccess(legacyActor!) && legacyActor?.branchId !== parent.branchId)
          throw generatedDenied();
      } else {
        const mutation = generationOperation(operation);
        const source =
          company === 'SHOP'
            ? (
                await currentPreparationSource(
                  parent.id,
                  mutation ? ['contracts.read', 'contracts.update'] : ['contracts.read'],
                )
              ).source
            : await this.parties.financeContract(tx, parent.id, true);
        if (company === 'FINANCE')
          for (const key of mutation
            ? (['contracts.read', 'contracts.update'] as const)
            : (['contracts.read'] as const))
            if (
              !(await tx.contract.count({
                where: { id: parent.id, AND: await currentFinanceReadWhere(key) },
              }))
            )
              throw generatedDenied();
        const keys: PermissionKey[] = [generatedPermission(operation)];
        if (
          [
            'downloadPdf',
            'downloadDocument',
            'getSignedUrl',
            'regenerateSignedContractPdfs',
          ].includes(operation)
        )
          keys.push('documents.read');
        if (operation === 'regenerateSignedContractPdfs') keys.push('documents.create');
        if (keys.some((key) => !canAccess(snapshot, key, source))) throw generatedDenied();
        const customerSources = await this.parties.customer(
          tx,
          parent.customerId,
          true,
          false,
          true,
        );
        if (company === 'FINANCE') customerSources.push(source);
        if (!customerSources.some((s) => canAccess(snapshot, 'customers.read', s))) {
          if (generationOperation(operation)) throw generatedDenied();
          base.visible = false;
        }
        base.visible =
          base.visible &&
          generatedSensitive.every((k) => canAccess(snapshot, k, source)) &&
          customerSources.some(
            (s) =>
              canAccess(snapshot, 'customers.read', s) &&
              generatedSensitive.every((k) => canAccess(snapshot, k, s)),
          );
      }
      if (base.documentId) {
        await tx.$queryRaw`SELECT id FROM e_documents WHERE id=${base.documentId} FOR SHARE`;
        if (
          !(await tx.eDocument.count({
            where: { id: base.documentId, contractId: parent.id, deletedAt: null },
          }))
        )
          throw generatedDenied();
      }
      return work(base);
    };
    if (existing) return run(existing.tx, existing.managed ? existing.snapshot : undefined);
    if (!actor.accessManaged)
      return this.prisma.$transaction((tx) => run(tx), {
        timeout: 30000,
        isolationLevel: 'Serializable',
      });
    return (
      await this.resources.execute(
        actorId,
        generatedPermission(operation),
        company,
        undefined,
        () => run(currentDomainAccess()!.client, currentDomainAccess()!.snapshot),
        false,
        { domain: 'parties', isolationLevel: 'Serializable', maxAttempts: 3 },
      )
    ).result;
  }
  /** Check original contributors, never replace them with today's Contract graph. */
  async inputs(proof: GeneratedAuthority, sources: GeneratedOriginalSources): Promise<boolean> {
    const { tx, parent, snapshot } = proof;
    if (!parent) throw generatedDenied();
    let visible = proof.visible;
    for (const id of [...new Set(sources.products)].sort()) {
      const source = await this.resources.product(tx, id, true);
      if (
        snapshot &&
        (!canAccess(snapshot, 'products.read', source) ||
          generatedSensitive.some((k) => !canAccess(snapshot, k, source)))
      )
        visible = false;
    }
    if (sources.payments.length) {
      await tx.$queryRaw`SELECT id FROM payments WHERE id=ANY(${sources.payments}::text[]) ORDER BY id FOR SHARE`;
      if (
        (await tx.payment.count({
          where: { id: { in: sources.payments }, contractId: parent.id, deletedAt: null },
        })) !== sources.payments.length
      )
        throw generatedDenied();
      const source = await this.parties.financeContract(tx, parent.id, true);
      if (snapshot && !canAccess(snapshot, 'payments.read', source)) visible = false;
    }
    if (sources.signatures.length) {
      await tx.$queryRaw`SELECT id FROM signatures WHERE id=ANY(${sources.signatures}::text[]) ORDER BY id FOR SHARE`;
      if (
        (await tx.signature.count({
          where: { id: { in: sources.signatures }, contractId: parent.id, deletedAt: null },
        })) !== sources.signatures.length
      )
        throw generatedDenied();
      const source =
        proof.company === 'FINANCE'
          ? await this.parties.financeContract(tx, parent.id, true)
          : { company: 'SHOP' as const, branchId: parent.branchId };
      if (snapshot && !canAccess(snapshot, 'documents.read', source)) visible = false;
    }
    if (sources.consent) {
      await tx.$queryRaw`SELECT id FROM pdpa_consents WHERE id=${sources.consent} FOR SHARE`;
      if (
        !(await tx.pDPAConsent.count({
          where: { id: sources.consent, customerId: parent.customerId, deletedAt: null },
        }))
      )
        throw generatedDenied();
    }
    const originalStaff = await tx.user.findUnique({
      where: { id: sources.salesperson },
      select: { deletedAt: true, isSystemUser: true },
    });
    if (!originalStaff || originalStaff.deletedAt || originalStaff.isSystemUser)
      throw generatedDenied();
    if (snapshot) {
      const plan = await PartyQueryPlan.create(tx, this.parties);
      const where = await lockContractStaffSources(plan, [sources.salesperson]);
      if (!(await tx.user.count({ where }))) visible = false;
    } else {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${sources.salesperson} FOR SHARE`;
      if (
        !(await tx.user.count({
          where: { id: sources.salesperson, deletedAt: null, isSystemUser: false },
        }))
      )
        throw generatedDenied();
    }
    return visible;
  }
  async evidence(proof: GeneratedAuthority, operation: string, id: string) {
    await proof.tx.auditLog.create({
      data: {
        userId: proof.actorId,
        entity: 'generated_document',
        entityId: id,
        action: operation,
        newValue: { outcome: 'SUCCESS', company: proof.company },
      },
    });
  }
  private validate(operation: GeneratedDocumentOperation, req: GeneratedRequest) {
    if (operation !== 'regenerateSignedContractPdfs' && !uuid.test(String(req.params.id)))
      throw new BadRequestException('รหัสเอกสารไม่ถูกต้อง');
    const allowed =
      operation === 'getDocuments'
        ? ['company', 'page', 'limit']
        : ['previewContract', 'downloadPdf'].includes(operation)
          ? ['company', 'templateId', 'templateSource']
          : ['company'];
    if (
      Object.entries(req.query ?? {}).some(
        ([k, v]) => !allowed.includes(k) || typeof v !== 'string',
      )
    )
      throw new BadRequestException('ตัวกรองไม่ถูกต้อง');
    for (const [key, max] of [
      ['page', 1000000],
      ['limit', 100],
    ] as const)
      if (
        req.query[key] !== undefined &&
        (!/^[1-9]\d*$/.test(String(req.query[key])) || Number(req.query[key]) > max)
      )
        throw new BadRequestException('หน้าหรือจำนวนรายการไม่ถูกต้อง');
  }
}
