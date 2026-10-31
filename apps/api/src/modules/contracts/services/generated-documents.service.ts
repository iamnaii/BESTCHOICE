import {
  SignatureAuthority,
  assertSignatureAuthority,
} from '../../employee-access/access-signatures-boundaries';
import { verifiedSignatureIdentities } from './signature-identity';
import { canonicalSignatureHash } from './signature-capture';
import { canAccess } from '@installment/shared';
import {
  currentDomainAccess,
  onDomainCommit,
} from '../../employee-access/access-execution-context';
import { uploadedDocumentRequest } from '../../employee-access/access-contract-files-context';
import { VerifiedContractDocumentBuffer } from './verified-contract-document';
import { DocumentsService } from '../documents.service';
import { embeddedDocumentFonts } from '../../../assets/fonts/document-fonts';
import { preparationSourceWhere } from '../../employee-access/access-contract-preparation-source';
import { currentFinanceReadWhere } from '../../employee-access/access-contract-read-scope';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { GeneratedDocumentIdentity, Prisma } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import {
  GeneratedContractDocumentAcknowledgement,
  GeneratedContractDocumentReference,
  GeneratedSignedDocumentsResult,
  GeneratedContractDocumentList,
  AuthenticatedGeneratedDocumentDelivery,
} from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { findFinanceLineRecipient } from '../../line-oa/services/otp-verified-customer';
import { StorageService } from '../../storage/storage.service';
import { SettingsService } from '../../settings/settings.service';
import {
  AccessGeneratedDocumentsBoundaries,
  GeneratedAuthority,
  generatedDenied,
} from '../../employee-access/access-generated-documents-boundaries';
import {
  GeneratedDocumentOperation,
  GeneratedRequest,
} from '../../employee-access/access-generated-documents-context';
import { ContractTemplateService } from './contract-template.service';
import { DocumentRenderingService } from './document-rendering.service';
import {
  GeneratedEffectBudget,
  GENERATED_PDF_LIMIT,
  inertGeneratedHtml,
  safeEmbeddedImage,
} from './generated-document-effects';
import {
  assertGeneratedSourceSize,
  GENERATED_CONFIG_KEYS,
  GeneratedType,
  TemplateChoice,
  prepareGeneratedSource,
  parseGeneratedManifest,
  PreparedGeneratedDocument,
} from './generated-document-source';
import { documentSourceRevision, DOCUMENT_SOURCE_INCLUDE } from './document-source.util';
import { contractSignatureRequirements } from '../../../utils/validation.util';
import { formatDateLong } from '../../../utils/thai-date.util';
import { escapeHtml } from './contract-document-format.util';
import { matchesDocumentMime } from './document-mime.util';
type ProductionInput = { kind: 'signature-event'; eventId: string; choice: TemplateChoice };
type GenerationInput = GeneratedRequest | ProductionInput;
const isProduction = (input: GenerationInput): input is ProductionInput =>
  'kind' in input && input.kind === 'signature-event';
export interface VerifiedGeneratedDocument {
  kind: 'verified-generated';
  bytes: Buffer;
  filename: string;
  contentType: 'application/pdf';
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
@Injectable()
export class GeneratedDocumentsService {
  private readonly logger = new Logger(GeneratedDocumentsService.name);
  private readonly attachments = new WeakMap<GeneratedDocumentIdentity, Buffer | null>();
  private readonly templates: ContractTemplateService;
  private readonly rendering: DocumentRenderingService;
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    settings: SettingsService,
    private readonly access: AccessGeneratedDocumentsBoundaries,
    private readonly legacy: DocumentsService,
  ) {
    this.templates = new ContractTemplateService(prisma);
    this.rendering = new DocumentRenderingService(prisma, storage, settings);
  }
  private async authority<T>(
    operation: GeneratedDocumentOperation,
    input: GenerationInput,
    work: (proof: GeneratedAuthority) => Promise<T>,
    contractId?: string,
  ): Promise<T> {
    if (!isProduction(input)) return this.access.current(operation, input, work, contractId);
    return this.access.currentEvent(input.eventId, async (proof, event) => {
      const pair = await this.prepareSignaturePair(proof, input.choice);
      if (
        pair.contract.sourceRevision !== event.sourceRevision ||
        pair.contract.dependencyRevision !== event.contractDependencyRevision ||
        pair.pdpa.dependencyRevision !== event.pdpaDependencyRevision ||
        documentSourceRevision(pair.contract.manifest) !==
          documentSourceRevision(event.contractManifest) ||
        documentSourceRevision(pair.pdpa.manifest) !== documentSourceRevision(event.pdpaManifest) ||
        documentSourceRevision([...event.signatureIds].sort()) !==
          documentSourceRevision(pair.contract.source.signatures.map((s) => s.id).sort())
      )
        throw generatedDenied();
      return work(proof);
    });
  }
  private async prepareSignaturePair(proof: GeneratedAuthority, choice: TemplateChoice) {
    if (!proof.parent) throw generatedDenied();
    if (
      proof.snapshot &&
      !canAccess(proof.snapshot, 'documents.read', {
        company: proof.company,
        branchId: proof.parent.branchId,
      })
    )
      throw generatedDenied();
    const contract = await prepareGeneratedSource(
      proof,
      this.access,
      this.templates,
      'CONTRACT',
      choice,
    );
    const pdpa = await prepareGeneratedSource(
      proof,
      this.access,
      this.templates,
      'PDPA_CONSENT',
      choice,
    );
    if (!contractSignatureRequirements(contract.source).complete) throw generatedDenied();
    const identities = await verifiedSignatureIdentities(
      proof.tx,
      contract.source,
      contract.source.signatures,
      {
        contractHash: canonicalSignatureHash(contract.source),
        productIds: [...new Set([contract.source.productId, ...contract.source.bundleProductIds])],
      },
    );
    if (!identities) throw generatedDenied();
    for (const identity of identities) {
      if (
        !(await this.access.inputs(proof, {
          products: identity.productIds,
          payments: [],
          signatures: [identity.signatureId],
          consent: null,
          salesperson: identity.capturedById,
        }))
      )
        throw generatedDenied();
    }
    return { contract, pdpa };
  }
  /** Only the live canonical capture boundary can mint. The proof is request-local,
   * registered by that boundary and bound to its current owned transaction. */
  async mintSignatureEvent(
    proof: SignatureAuthority,
    choice: TemplateChoice,
  ): Promise<string | null> {
    assertSignatureAuthority(proof);
    let pair: Awaited<ReturnType<GeneratedDocumentsService['prepareSignaturePair']>>;
    try {
      pair = await this.access.signatureProducer(proof, (authority) =>
        this.prepareSignaturePair(authority, choice),
      );
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException) return null;
      throw error;
    }
    const event = await proof.tx.signedDocumentProductionEvent.create({
      data: {
        contractId: proof.parent.id,
        sourceRevision: pair.contract.sourceRevision,
        signatureIds: pair.contract.source.signatures.map((s) => s.id).sort(),
        contractManifest: pair.contract.manifest as unknown as Prisma.InputJsonValue,
        pdpaManifest: pair.pdpa.manifest as unknown as Prisma.InputJsonValue,
        contractDependencyRevision: pair.contract.dependencyRevision,
        pdpaDependencyRevision: pair.pdpa.dependencyRevision,
        producerKind: 'CANONICAL_SIGNATURE_COMPLETION',
        initiatorUserId: proof.actorId,
        initiatorChannel: proof.managed ? 'MANAGED_STAFF' : 'LEGACY_STAFF',
        selectedCompany: proof.managed ? proof.company : null,
        templateChoice: choice as Prisma.InputJsonValue,
      },
    });
    return event.id;
  }
  async consumeSignatureEvent(
    eventId: string,
  ): Promise<'SUCCESS' | 'PARTIAL' | 'FAILED' | 'PENDING'> {
    // A retained bound event is required to claim. Current source and initiator
    // are independently verified before effects; an eventId/plan is not a grant.
    const event = await this.prisma.signedDocumentProductionEvent.findUnique({
      where: { id: eventId },
    });
    if (
      !event?.templateChoice ||
      !event.initiatorUserId ||
      !['MANAGED_STAFF', 'LEGACY_STAFF'].includes(event.initiatorChannel ?? '') ||
      (event.initiatorChannel === 'MANAGED_STAFF'
        ? !['SHOP', 'FINANCE'].includes(event.selectedCompany ?? '')
        : event.selectedCompany !== null) ||
      typeof event.templateChoice !== 'object' ||
      Array.isArray(event.templateChoice)
    )
      throw generatedDenied();
    const choice = event.templateChoice as TemplateChoice;
    const input: ProductionInput = { kind: 'signature-event', eventId, choice };
    const claim = await this.prisma.signedDocumentProductionConsumption.createMany({
      data: { eventId, status: 'RUNNING' },
      skipDuplicates: true,
    });
    if (!claim.count) {
      const previous = await this.prisma.signedDocumentProductionConsumption.findUniqueOrThrow({
        where: { eventId },
      });
      return previous.status === 'RUNNING'
        ? 'PENDING'
        : (previous.status as 'SUCCESS' | 'PARTIAL' | 'FAILED');
    }
    let status: 'SUCCESS' | 'PARTIAL' | 'FAILED' = 'FAILED';
    try {
      status = (await this.signed(input)).status;
    } catch {
      /* signature already committed */
    }
    await this.prisma.signedDocumentProductionConsumption.update({
      where: { eventId },
      data: { status, completedAt: new Date() },
    });
    return status;
  }
  async execute(operation: GeneratedDocumentOperation, req: GeneratedRequest): Promise<unknown> {
    if (operation === 'getDocuments' || operation === 'getDocument')
      return this.references(operation, req);
    if (operation === 'getSignedUrl') return this.descriptor(req);
    if (operation === 'downloadDocument') return this.download(req);
    if (operation === 'regenerateSignedContractPdfs') return this.batch(req);
    if (operation === 'generateSignedDocuments') return this.signed(req);
    if (operation === 'previewContract' || operation === 'downloadPdf')
      return this.fresh(operation, req);
    const type =
      operation === 'generatePdpaDocument'
        ? 'PDPA_CONSENT'
        : (req.body?.documentType ?? 'CONTRACT');
    if (!['CONTRACT', 'PDPA_CONSENT'].includes(type)) return this.legacyUnknown(req, type);
    return (await this.generate(operation, req, type, new GeneratedEffectBudget())).ack;
  }
  private choice(req: GenerationInput, operation: GeneratedDocumentOperation): TemplateChoice {
    if (isProduction(req)) return req.choice;
    const input = ['previewContract', 'downloadPdf'].includes(operation)
      ? req.query
      : (req.body ?? {});
    if (
      (input.templateSource !== undefined && input.templateSource !== 'BUILTIN') ||
      (input.templateId !== undefined &&
        (typeof input.templateId !== 'string' || !/^[-0-9a-f]{36}$/i.test(input.templateId))) ||
      (input.templateId && input.templateSource)
    )
      throw new BadRequestException('ตัวเลือกแม่แบบไม่ถูกต้อง');
    return {
      templateSource: input.templateSource as 'BUILTIN' | undefined,
      templateId: input.templateId as string | undefined,
    };
  }
  private async rendered(prepared: PreparedGeneratedDocument, type: string) {
    const lessor =
      prepared.config.lessor_signature_image && prepared.config.lessor_signer_name
        ? {
            image: prepared.config.lessor_signature_image,
            name: prepared.config.lessor_signer_name,
          }
        : null;
    let html = await this.rendering.replacePlaceholders(prepared.html, prepared.source, lessor, {
      config: prepared.config,
      photos: prepared.photos,
    });
    if (type === 'PDPA_CONSENT') {
      const consent = prepared.source.pdpaConsent!;
      const signature =
        consent.signatureImage && safeEmbeddedImage(consent.signatureImage)
          ? `<img src="${consent.signatureImage}" style="max-height:80px"/>`
          : '<div style="border-bottom:1px solid #000;width:200px;height:80px"></div>';
      html = html
        .replace(/\{pdpa_signature\}/g, signature)
        .replace(
          /\{pdpa_consent_date\}/g,
          escapeHtml(formatDateLong(consent.grantedAt ?? new Date())),
        );
    }
    html = this.rendering.wrapWithA4Styles(
      inertGeneratedHtml(html),
      prepared.settings,
      prepared.source.contractNumber,
    );
    if (Buffer.byteLength(html) > 32 * 1024 * 1024)
      throw new BadRequestException('เอกสารใหญ่เกินไป');
    return html;
  }
  private async prepare(
    operation: GeneratedDocumentOperation,
    req: GenerationInput,
    type: GeneratedType,
    contractId?: string,
  ) {
    return this.authority(
      operation,
      req,
      (proof) =>
        prepareGeneratedSource(
          proof,
          this.access,
          this.templates,
          type,
          this.choice(req, operation),
        ),
      contractId,
    );
  }
  private current(prepared: PreparedGeneratedDocument, current: PreparedGeneratedDocument) {
    if (
      prepared.sourceRevision !== current.sourceRevision ||
      prepared.dependencyRevision !== current.dependencyRevision
    )
      throw new BadRequestException('SOURCE_CHANGED');
  }
  private async cleanup(key: string, token: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.storage.deleteOwned(key, token),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 1500);
          timer.unref();
        }),
      ]);
      if (!result || result.status === 'retained')
        this.logger.warn({
          event: 'GENERATED_STAGING_RETAINED',
          reason: result?.status === 'retained' ? result.reason : 'cleanup-timeout',
        });
    } catch {
      this.logger.warn({ event: 'GENERATED_STAGING_RETAINED', reason: 'cleanup-failed' });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async generate(
    operation: GeneratedDocumentOperation,
    req: GenerationInput,
    type: GeneratedType,
    budget: GeneratedEffectBudget,
    contractId?: string,
  ): Promise<{
    ack: GeneratedContractDocumentAcknowledgement;
    identity: GeneratedDocumentIdentity;
  }> {
    const prepared = await this.prepare(operation, req, type, contractId);
    budget.check();
    const html = await this.rendered(prepared, type);
    budget.check();
    const bytes = await budget.wait(() =>
      this.rendering.htmlToPdf(html, prepared.source.contractNumber, budget),
    );
    if (
      !bytes.length ||
      bytes.length > GENERATED_PDF_LIMIT ||
      !matchesDocumentMime(bytes, 'application/pdf')
    )
      throw new BadRequestException('ผลลัพธ์ PDF ไม่ถูกต้อง');
    if (!this.storage.configured) throw new ServiceUnavailableException('ยังไม่พร้อมจัดเก็บเอกสาร');
    if (isProduction(req)) await this.authority(operation, req, async () => undefined);
    const token = randomUUID(),
      key = `generated-contracts/${randomUUID()}.pdf`;
    let committed = false;
    try {
      await budget.wait(
        () =>
          this.storage.uploadOwned(key, bytes, 'application/pdf', token, budget.controller.signal),
        () => this.cleanup(key, token),
      );
      budget.check();
      const identity = await this.authority(
        operation,
        req,
        async (proof) => {
          budget.check();
          const current = await prepareGeneratedSource(
            proof,
            this.access,
            this.templates,
            type,
            this.choice(req, operation),
          );
          this.current(prepared, current);
          const doc = await proof.tx.eDocument.create({
            data: {
              contractId: prepared.source.id,
              documentType: type,
              fileUrl: key,
              fileHash: digest(bytes),
              createdById: proof.actorId,
            },
          });
          const identity = await proof.tx.generatedDocumentIdentity.create({
            data: {
              documentId: doc.id,
              signatureEventId: isProduction(req) ? req.eventId : null,
              contractId: doc.contractId,
              customerId: prepared.source.customerId,
              branchId: prepared.source.branchId,
              producerKind: proof.managed ? 'MANAGED_SOURCE' : 'LEGACY_CURRENT_ROLE',
              creationCompany: proof.managed ? proof.company : null,
              operationToken: token,
              storageKey: key,
              mimeType: 'application/pdf',
              fileSize: bytes.length,
              fileHash: doc.fileHash,
              sourceRevision: prepared.sourceRevision,
              dependencyRevision: prepared.dependencyRevision,
              documentType: type,
              sourceComplete: contractSignatureRequirements(prepared.source).complete,
              manifest: prepared.manifest as unknown as Prisma.InputJsonValue,
            },
          });
          await this.access.evidence(proof, 'GENERATED_DOCUMENT_CREATED', doc.id);
          budget.check();
          return identity;
        },
        contractId,
      );
      committed = true;
      return {
        identity,
        ack: {
          id: identity.documentId,
          documentType: type,
          pdfGenerated: true,
          templateSource: prepared.manifest.template.kind,
        },
      };
    } finally {
      if (!committed) await this.cleanup(key, token);
    }
  }
  private async fresh(operation: 'previewContract' | 'downloadPdf', req: GeneratedRequest) {
    const prepared = await this.prepare(operation, req, 'CONTRACT'),
      budget = new GeneratedEffectBudget();
    const html = await this.rendered(prepared, 'CONTRACT');
    const bytes =
      operation === 'downloadPdf'
        ? await budget.wait(() =>
            this.rendering.htmlToPdf(html, prepared.source.contractNumber, budget),
          )
        : undefined;
    if (
      bytes &&
      (!bytes.length ||
        bytes.length > GENERATED_PDF_LIMIT ||
        !matchesDocumentMime(bytes, 'application/pdf'))
    )
      throw new BadRequestException('ผลลัพธ์ PDF ไม่ถูกต้อง');
    await this.authority(operation, req, async (proof) => {
      const current = await prepareGeneratedSource(
        proof,
        this.access,
        this.templates,
        'CONTRACT',
        this.choice(req, operation),
      );
      this.current(prepared, current);
      budget.check();
      await this.access.evidence(
        proof,
        bytes ? 'GENERATED_CONTENT_RELEASE_AUTHORIZED' : 'GENERATED_PREVIEW_AUTHORIZED',
        prepared.source.id,
      );
    });
    return bytes
      ? ({
          kind: 'verified-generated',
          bytes,
          filename: 'contract.pdf',
          contentType: 'application/pdf',
        } satisfies VerifiedGeneratedDocument)
      : {
          html: inertGeneratedHtml(html).replace(
            '</head>',
            `<style>${embeddedDocumentFonts()}</style></head>`,
          ),
          templateSource: prepared.manifest.template.kind,
        };
  }
  private async identity(
    proof: GeneratedAuthority,
    id: string,
  ): Promise<GeneratedDocumentIdentity> {
    const parent = proof.parent;
    if (!parent || !proof.visible) throw generatedDenied();
    const identity = await proof.tx.generatedDocumentIdentity.findUnique({
      where: { documentId: id },
    });
    if (
      !identity ||
      identity.contractId !== parent.id ||
      identity.customerId !== parent.customerId ||
      identity.branchId !== parent.branchId
    )
      throw generatedDenied();
    const manifest = parseGeneratedManifest(identity.manifest);
    if (proof.managed && manifest.template.kind === 'CUSTOM' && !proof.owner)
      throw generatedDenied();
    if (!(await this.identitySourcesVisible(proof, identity))) throw generatedDenied();
    const doc = await proof.tx.eDocument.findUnique({
      where: { id, contractId: parent.id, deletedAt: null },
      select: { fileUrl: true, fileHash: true, documentType: true },
    });
    if (
      !doc ||
      doc.fileUrl !== identity.storageKey ||
      doc.fileHash !== identity.fileHash ||
      doc.documentType !== identity.documentType ||
      identity.mimeType !== 'application/pdf' ||
      identity.fileSize > GENERATED_PDF_LIMIT
    )
      throw generatedDenied();

    return identity;
  }
  private async identitySourcesVisible(
    proof: GeneratedAuthority,
    identity: GeneratedDocumentIdentity,
  ): Promise<boolean> {
    const parent = proof.parent;
    if (
      !parent ||
      identity.contractId !== parent.id ||
      identity.customerId !== parent.customerId ||
      identity.branchId !== parent.branchId
    )
      throw generatedDenied();
    const manifest = parseGeneratedManifest(identity.manifest);
    const visible = await this.access.inputs(proof, manifest);
    for (const photo of manifest.photos) {
      const original = await proof.tx.uploadedContractDocumentIdentity.findUnique({
        where: { id: photo.identityId },
        include: { document: { select: { contractId: true, deletedAt: true } } },
      });
      if (
        !original ||
        original.documentId !== photo.documentId ||
        original.contractId !== parent.id ||
        original.customerId !== parent.customerId ||
        original.branchId !== parent.branchId ||
        original.document.deletedAt ||
        original.document.contractId !== parent.id
      )
        throw generatedDenied();
    }
    return visible;
  }
  /** Identifiable shared references/counts need every retained original source,
   * including rows outside the requested page. Raw custom bytes remain owner-only. */
  async uploadedReferencesVisible(contractId: string, includeDeleted = false): Promise<boolean> {
    const ctx = currentDomainAccess(),
      request = uploadedDocumentRequest.getStore();
    if (
      !ctx ||
      !request?.proof ||
      request.proof.contractId !== contractId ||
      !['findByContract', 'getDocumentChecklist', 'getDocumentAuditTrail'].includes(
        request.operation,
      ) ||
      request.actorId !== ctx.snapshot.userId ||
      ctx.isolationLevel !== 'Serializable'
    )
      throw generatedDenied();
    const parent = await ctx.client.contract.findUniqueOrThrow({
      where: { id: contractId, deletedAt: null },
      select: { id: true, customerId: true, branchId: true, productId: true, salespersonId: true },
    });
    const links = await ctx.client.generatedContractDocumentLink.findMany({
      where: { document: { contractId, ...(includeDeleted ? {} : { deletedAt: null }) } },
      include: { identity: true },
      orderBy: { documentId: 'asc' },
      take: 1001,
    });
    if (links.length > 1000) throw generatedDenied();
    const proof: GeneratedAuthority = {
      tx: ctx.client,
      actorId: request.actorId,
      managed: true,
      owner: ctx.snapshot.isOwner,
      company: request.proof.company,
      parent,
      visible: request.proof.visible,
      snapshot: ctx.snapshot,
    };
    let visible = proof.visible;
    for (const link of links)
      if (!(await this.identitySourcesVisible(proof, link.identity))) visible = false;
    return visible;
  }
  private async references(
    operation: 'getDocuments' | 'getDocument',
    req: GeneratedRequest,
  ): Promise<
    | GeneratedContractDocumentList
    | {
        availability: 'available' | 'unavailable';
        document: GeneratedContractDocumentReference | null;
      }
  > {
    return this.authority(operation, req, async (proof) => {
      const page = Number(req.query.page ?? 1),
        limit = Number(req.query.limit ?? 50);
      const unavailable = () =>
        operation === 'getDocument'
          ? { availability: 'unavailable' as const, document: null }
          : { availability: 'unavailable' as const, data: [], total: null, page, limit };
      if (!proof.visible) return unavailable();
      // Inspect a finite retained contributor set before reporting a complete count.
      const rows = await proof.tx.eDocument.findMany({
        where: {
          contractId: proof.parent!.id,
          deletedAt: null,
          ...(operation === 'getDocument' ? { id: proof.documentId } : {}),
        },
        select: {
          id: true,
          documentType: true,
          createdAt: true,
          generatedDocumentIdentities: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 1001,
      });
      if (rows.length > 1000) throw new BadRequestException('กรุณาระบุเอกสารโดยตรง');
      if (rows.some((row) => !row.generatedDocumentIdentities.length)) {
        const parent = proof.parent!;
        const payments = await proof.tx.payment.findMany({
          where: { contractId: parent.id, deletedAt: null },
          select: { id: true },
          take: 601,
        });
        const signatures = await proof.tx.signature.findMany({
          where: { contractId: parent.id, deletedAt: null },
          select: { id: true },
          take: 21,
        });
        const contract = await proof.tx.contract.findUniqueOrThrow({
          where: { id: parent.id },
          select: { pdpaConsentId: true },
        });
        if (payments.length > 600 || signatures.length > 20) throw generatedDenied();
        if (
          !(await this.access.inputs(proof, {
            products: [parent.productId],
            payments: payments.map((p) => p.id),
            signatures: signatures.map((s) => s.id),
            consent: contract.pdpaConsentId,
            salesperson: parent.salespersonId,
          }))
        )
          return unavailable();
      }
      const refs: GeneratedContractDocumentReference[] = [];
      for (const row of rows) {
        const identity = row.generatedDocumentIdentities[0];
        if (identity && !(await this.identitySourcesVisible(proof, identity))) return unavailable();
        if (
          identity &&
          (identity.contractId !== proof.parent!.id ||
            identity.customerId !== proof.parent!.customerId ||
            identity.branchId !== proof.parent!.branchId)
        )
          throw generatedDenied();
        refs.push({
          id: row.id,
          documentType:
            row.documentType === 'CONTRACT' || row.documentType === 'PDPA_CONSENT'
              ? row.documentType
              : null,
          createdAt: row.createdAt.toISOString(),
          contentStatus: identity ? 'VERIFIED_GENERATED' : 'UNVERIFIED',
          templateSource: identity ? parseGeneratedManifest(identity.manifest).template.kind : null,
        });
      }
      await this.access.evidence(proof, 'GENERATED_REFERENCES_READ', proof.parent!.id);
      return operation === 'getDocument'
        ? { availability: 'available', document: refs[0] ?? null }
        : {
            availability: 'available',
            data: refs.slice((page - 1) * limit, page * limit),
            total: refs.length,
            page,
            limit,
          };
    });
  }
  private async descriptor(req: GeneratedRequest): Promise<AuthenticatedGeneratedDocumentDelivery> {
    return this.authority('getSignedUrl', req, async (proof) => {
      if (proof.managed) await this.identity(proof, proof.documentId!);
      await this.access.evidence(proof, 'GENERATED_DELIVERY_DESCRIPTOR', proof.documentId!);
      return {
        kind: 'authenticated',
        url: `/documents/${proof.documentId}/download?company=${proof.company}`,
        expiresIn: 0,
      };
    });
  }
  private async download(
    req: GeneratedRequest,
  ): Promise<
    | VerifiedGeneratedDocument
    | { kind: 'legacy-generated'; bytes: Buffer; filename: string; contentType: string }
  > {
    const legacy = await this.authority('downloadDocument', req, async (proof) =>
      !proof.managed
        ? proof.tx.eDocument.findUniqueOrThrow({
            where: { id: proof.documentId! },
            select: { id: true, fileUrl: true, fileHash: true },
          })
        : null,
    );
    if (legacy) {
      const budget = new GeneratedEffectBudget(),
        file = await budget.wait(
          () => this.legacy.getDocumentStream(legacy.id),
          (late) => {
            late.stream.destroy();
          },
        );
      // Same contract as main's pipeDocumentStream: a storage read that fails after the
      // document was authorized is a retryable 503, not an internal error.
      const bytes = await budget.buffer(file.stream).catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        throw new ServiceUnavailableException('ดาวน์โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่');
      });
      await this.authority('downloadDocument', req, async (proof) => {
        if (proof.managed) throw generatedDenied();
        const current = await proof.tx.eDocument.findUniqueOrThrow({
          where: { id: legacy.id, deletedAt: null },
          select: { fileUrl: true, fileHash: true },
        });
        if (current.fileUrl !== legacy.fileUrl || current.fileHash !== legacy.fileHash)
          throw generatedDenied();
        await this.access.evidence(proof, 'GENERATED_CONTENT_RELEASE_AUTHORIZED', legacy.id);
      });
      return {
        kind: 'legacy-generated',
        bytes,
        filename: 'document',
        contentType: file.contentType,
      };
    }
    const prepared = await this.authority('downloadDocument', req, (proof) =>
      this.identity(proof, proof.documentId!),
    );
    const budget = new GeneratedEffectBudget();
    const stream = await budget.wait(
      () => this.storage.getStream(prepared.storageKey, budget.controller.signal),
      (late) => {
        late.destroy();
      },
    );
    const bytes = await budget.buffer(stream);
    if (
      bytes.length !== prepared.fileSize ||
      digest(bytes) !== prepared.fileHash ||
      !matchesDocumentMime(bytes, prepared.mimeType)
    )
      throw generatedDenied();
    await this.authority('downloadDocument', req, async (proof) => {
      const current = await this.identity(proof, proof.documentId!);
      if (current.id !== prepared.id) throw generatedDenied();
      budget.check();
      await this.access.evidence(proof, 'GENERATED_CONTENT_RELEASE_AUTHORIZED', current.documentId);
    });
    return {
      kind: 'verified-generated',
      bytes,
      filename: 'document.pdf',
      contentType: 'application/pdf',
    };
  }
  private async signed(req: GenerationInput): Promise<GeneratedSignedDocumentsResult> {
    await this.prepare('generateSignedDocuments', req, 'CONTRACT');
    const budget = new GeneratedEffectBudget();
    const result: GeneratedSignedDocumentsResult = { status: 'FAILED' },
      errors: NonNullable<GeneratedSignedDocumentsResult['errors']> = [];
    let contract: Awaited<ReturnType<GeneratedDocumentsService['generate']>> | undefined,
      pdpa: typeof contract;
    for (const type of ['CONTRACT', 'PDPA_CONSENT'] as const) {
      try {
        const value = await this.generate('generateSignedDocuments', req, type, budget);
        if (type === 'CONTRACT') {
          contract = value;
          result.contract = value.ack;
          await this.attach(req, value.identity);
        } else {
          pdpa = value;
          result.pdpa = value.ack;
        }
      } catch {
        errors.push('GENERATION_FAILED');
      }
    }
    if (contract && pdpa && !errors.length)
      try {
        await this.authority('generateSignedDocuments', req, async (proof) => {
          const current = await prepareGeneratedSource(
            proof,
            this.access,
            this.templates,
            'CONTRACT',
            this.choice(req, 'generateSignedDocuments'),
          );
          const currentPdpa = await prepareGeneratedSource(
            proof,
            this.access,
            this.templates,
            'PDPA_CONSENT',
            this.choice(req, 'generateSignedDocuments'),
          );
          if (
            current.sourceRevision !== contract!.identity.sourceRevision ||
            current.dependencyRevision !== contract!.identity.dependencyRevision ||
            currentPdpa.sourceRevision !== pdpa!.identity.sourceRevision ||
            currentPdpa.dependencyRevision !== pdpa!.identity.dependencyRevision ||
            !contractSignatureRequirements(current.source).complete
          )
            throw generatedDenied();
          // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
          const financeLineId = await findFinanceLineRecipient(proof.tx, current.source.customerId);
          if (
            financeLineId &&
            !(await proof.tx.notificationLog.count({
              where: {
                relatedId: current.source.id,
                subject: 'CONTRACT_DOCUMENTS_READY',
                deletedAt: null,
                status: { not: 'CANCELLED' },
              },
            }))
          )
            await proof.tx.notificationLog.create({
              data: {
                channel: 'LINE',
                channelKey: 'line-finance',
                recipient: financeLineId,
                subject: 'CONTRACT_DOCUMENTS_READY',
                message: `เอกสารสัญญาเลขที่ ${current.source.contractNumber} พร้อมดาวน์โหลดผ่าน LINE`,
                relatedId: current.source.id,
                customerId: current.source.customerId,
                category: 'TRANSACTIONAL',
                status: 'DELAYED',
                nextRetryAt: new Date(),
              },
            });
          await this.access.evidence(proof, 'GENERATED_SIGNED_DOCUMENTS_READY', current.source.id);
        });
      } catch {
        errors.push('SOURCE_CHANGED');
      }
    result.status = errors.length ? (contract || pdpa ? 'PARTIAL' : 'FAILED') : 'SUCCESS';
    if (errors.length) result.errors = errors;
    return result;
  }
  private async attach(req: GenerationInput, identity: GeneratedDocumentIdentity) {
    return this.authority('generateSignedDocuments', req, async (proof) => {
      const current = await prepareGeneratedSource(
        proof,
        this.access,
        this.templates,
        'CONTRACT',
        this.choice(req, 'generateSignedDocuments'),
      );
      if (
        current.sourceRevision !== identity.sourceRevision ||
        current.dependencyRevision !== identity.dependencyRevision ||
        !identity.sourceComplete ||
        !contractSignatureRequirements(current.source).complete
      )
        throw generatedDenied();
      const existing = await proof.tx.contractDocument.findFirst({
        where: {
          contractId: identity.contractId,
          documentType: 'SIGNED_CONTRACT',
          isLatest: true,
          deletedAt: null,
        },
      });
      if (existing) {
        const link = await proof.tx.generatedContractDocumentLink.findUnique({
          where: { documentId: existing.id },
          include: { identity: true },
        });
        if (
          link &&
          link.identity.sourceRevision === identity.sourceRevision &&
          link.identity.dependencyRevision === identity.dependencyRevision &&
          link.identity.sourceComplete &&
          existing.fileHash === link.identity.fileHash &&
          existing.fileUrl === link.identity.storageKey
        )
          return;
        await proof.tx.contractDocument.update({
          where: { id: existing.id },
          data: { isLatest: false },
        });
      }
      const previous = await proof.tx.contractDocument.findFirst({
        where: { contractId: identity.contractId, documentType: 'SIGNED_CONTRACT' },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const doc = await proof.tx.contractDocument.create({
        data: {
          contractId: identity.contractId,
          documentType: 'SIGNED_CONTRACT',
          fileName: 'signed-contract.pdf',
          originalName: 'signed-contract.pdf',
          fileUrl: identity.storageKey,
          fileHash: identity.fileHash,
          fileSize: identity.fileSize,
          mimeType: identity.mimeType,
          uploadedById: proof.actorId,
          version: (previous?.version ?? 0) + 1,
          isLatest: true,
          isImmutable: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'COMPLETED', 'EARLY_PAYOFF'].includes(
            current.source.status,
          ),
        },
      });
      await proof.tx.generatedContractDocumentLink.create({
        data: { documentId: doc.id, identityId: identity.id },
      });
      await proof.tx.documentAuditLog.create({
        data: {
          documentId: doc.id,
          contractId: identity.contractId,
          userId: proof.actorId,
          action: 'UPLOAD',
        },
      });
      await this.access.evidence(proof, 'GENERATED_SIGNED_ATTACHMENT_CREATED', doc.id);
    });
  }
  private async batch(req: GeneratedRequest) {
    const ids = await this.authority('regenerateSignedContractPdfs', req, async (proof) => {
      const scoped = proof.snapshot
        ? proof.company === 'SHOP'
          ? preparationSourceWhere(proof.snapshot, ['contracts.read', 'contracts.update'])
          : { AND: await currentFinanceReadWhere('contracts.read') }
        : {};
      return (
        await proof.tx.contract.findMany({
          where: {
            AND: scoped,
            deletedAt: null,
            signatures: { some: { signerType: 'CUSTOMER', deletedAt: null } },
          },
          select: { id: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 11,
        })
      ).map((r) => r.id);
    });
    const budget = new GeneratedEffectBudget(120000),
      results: Array<{ id: string; status: 'SUCCESS' | 'FAILED' | 'NOT_ATTEMPTED' }> = [];
    let stopped = false;
    for (const id of ids.slice(0, 10)) {
      if (stopped) {
        results.push({ id, status: 'NOT_ATTEMPTED' });
        continue;
      }
      try {
        budget.check();
        await this.generate(
          'regenerateSignedContractPdfs',
          req,
          'CONTRACT',
          new GeneratedEffectBudget(Math.min(45000, budget.expiresAt - Date.now())),
          id,
        );
        results.push({ id, status: 'SUCCESS' });
      } catch {
        results.push({ id, status: 'FAILED' });
        try {
          await this.access.preflight('regenerateSignedContractPdfs', req);
          budget.check();
        } catch {
          stopped = true;
        }
      }
    }
    return {
      total: results.length,
      success: results.filter((r) => r.status === 'SUCCESS').length,
      hasMore: ids.length > 10,
      results,
    };
  }
  async prepareUploadedAttachment(
    contractId: string,
    documentId: string,
  ): Promise<GeneratedDocumentIdentity | null> {
    const ctx = currentDomainAccess(),
      request = uploadedDocumentRequest.getStore();
    if (!ctx?.snapshot.managed) return null;
    if (
      request?.operation !== 'content' ||
      !request.proof?.visible ||
      request.proof.contractId !== contractId ||
      request.actorId !== ctx.snapshot.userId
    )
      throw generatedDenied();
    const link = await ctx.client.generatedContractDocumentLink.findUnique({
      where: { documentId },
      include: {
        document: {
          select: {
            contractId: true,
            deletedAt: true,
            fileUrl: true,
            fileHash: true,
            fileSize: true,
            mimeType: true,
          },
        },
        identity: true,
      },
    });
    if (!link) return null;
    if (
      link.document.contractId !== contractId ||
      link.document.deletedAt ||
      link.document.fileUrl !== link.identity.storageKey ||
      link.document.fileHash !== link.identity.fileHash ||
      link.document.fileSize !== link.identity.fileSize ||
      link.document.mimeType !== link.identity.mimeType
    )
      throw generatedDenied();
    const parent = await ctx.client.contract.findUniqueOrThrow({
      where: { id: contractId, deletedAt: null },
      select: { id: true, customerId: true, branchId: true, productId: true, salespersonId: true },
    });
    const identity = await this.identity(
      {
        tx: ctx.client,
        actorId: ctx.snapshot.userId,
        managed: true,
        owner: ctx.snapshot.isOwner,
        company: request.proof.company,
        parent,
        visible: request.proof.visible,
        snapshot: ctx.snapshot,
      },
      link.identity.documentId,
    );
    this.attachments.set(identity, null);
    return identity;
  }
  async acquireGeneratedBytes(identity: GeneratedDocumentIdentity): Promise<Buffer> {
    if (!this.attachments.has(identity) || this.attachments.get(identity) !== null)
      throw generatedDenied();
    const budget = new GeneratedEffectBudget();
    const stream = await budget.wait(
      () => this.storage.getStream(identity.storageKey, budget.controller.signal),
      (late) => {
        late.destroy();
      },
    );
    const bytes = await budget.buffer(stream);
    if (
      bytes.length !== identity.fileSize ||
      digest(bytes) !== identity.fileHash ||
      !matchesDocumentMime(bytes, identity.mimeType)
    )
      throw generatedDenied();
    this.attachments.set(identity, bytes);
    return bytes;
  }
  async releaseUploadedAttachment(
    contractId: string,
    documentId: string,
    staged: GeneratedDocumentIdentity,
    bytes: Buffer,
  ): Promise<VerifiedContractDocumentBuffer> {
    if (this.attachments.get(staged) !== bytes) throw generatedDenied();
    const identity = await this.prepareUploadedAttachment(contractId, documentId),
      ctx = currentDomainAccess(),
      proof = uploadedDocumentRequest.getStore()?.proof;
    if (
      !identity ||
      identity.id !== staged.id ||
      !ctx ||
      !proof ||
      bytes.length !== identity.fileSize ||
      digest(bytes) !== identity.fileHash
    )
      throw generatedDenied();
    await ctx.client.documentAuditLog.create({
      data: {
        contractId,
        documentId,
        userId: ctx.snapshot.userId,
        action: 'CONTENT_RELEASE_AUTHORIZED',
      },
    });
    // Request adapter enforces one release invocation; retry attempts retain
    // the exact acquired bytes until the outer evidence transaction commits.
    onDomainCommit(async () => {
      this.attachments.delete(staged);
    });
    return {
      kind: 'verified-generated',
      source: {
        documentId,
        contractId,
        customerId: proof.customerId,
        branchId: proof.branchId,
        currentCompany: proof.company,
        identityId: identity.id,
      },
      bytes,
      contentType: 'application/pdf',
      filename: 'signed-contract.pdf',
    };
  }
  private async legacyUnknown(req: GeneratedRequest, type: unknown) {
    if (typeof type !== 'string' || type.length > 100)
      throw new BadRequestException('ประเภทเอกสารไม่รองรับ');
    const prepared = await this.authority('generateDocument', req, (proof) => {
      if (proof.managed) throw new BadRequestException('ประเภทเอกสารไม่รองรับ');
      return prepareGeneratedSource(
        proof,
        this.access,
        this.templates,
        type,
        this.choice(req, 'generateDocument'),
      );
    });
    const budget = new GeneratedEffectBudget(),
      html = await this.rendered(prepared, type);
    const bytes = await budget.wait(() =>
      this.rendering.htmlToPdf(html, prepared.source.contractNumber, budget),
    );
    if (
      !bytes.length ||
      bytes.length > GENERATED_PDF_LIMIT ||
      !matchesDocumentMime(bytes, 'application/pdf')
    )
      throw new BadRequestException('ผลลัพธ์ PDF ไม่ถูกต้อง');
    const token = randomUUID(),
      key = `generated-contracts/${randomUUID()}.pdf`;
    let committed = false;
    try {
      await budget.wait(
        () =>
          this.storage.uploadOwned(key, bytes, 'application/pdf', token, budget.controller.signal),
        () => this.cleanup(key, token),
      );
      const doc = await this.authority('generateDocument', req, async (proof) => {
        if (proof.managed) throw generatedDenied();
        const current = await prepareGeneratedSource(
          proof,
          this.access,
          this.templates,
          type,
          this.choice(req, 'generateDocument'),
        );
        this.current(prepared, current);
        budget.check();
        const row = await proof.tx.eDocument.create({
          data: {
            contractId: prepared.source.id,
            documentType: type,
            fileUrl: key,
            fileHash: digest(bytes),
            createdById: proof.actorId,
          },
        });
        await this.access.evidence(proof, 'GENERATED_DOCUMENT_CREATED', row.id);
        return row;
      });
      committed = true;
      return { id: doc.id, documentType: null, contentStatus: 'UNVERIFIED', pdfGenerated: true };
    } finally {
      if (!committed) await this.cleanup(key, token);
    }
  }
  /** No production minting entry point exists in this child. Task4 must insert
   * the immutable event in its genuinely authorized completed-signature tx. */
  async verifyCommittedSignatureEvent(eventId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const event = await tx.signedDocumentProductionEvent.findUnique({ where: { id: eventId } });
        if (!event || event.producerKind !== 'CANONICAL_SIGNATURE_COMPLETION')
          throw generatedDenied();
        await tx.$queryRaw`SELECT id FROM contracts WHERE id=${event.contractId} FOR SHARE`;
        const parent = await tx.contract.findUnique({
          where: { id: event.contractId, deletedAt: null },
          select: {
            id: true,
            customerId: true,
            branchId: true,
            productId: true,
            salespersonId: true,
            pdpaConsentId: true,
            totalMonths: true,
          },
        });
        if (
          !parent ||
          parent.totalMonths > 600 ||
          (await tx.payment.count({ where: { contractId: parent.id, deletedAt: null } })) > 600 ||
          (await tx.signature.count({ where: { contractId: parent.id, deletedAt: null } })) > 20
        )
          throw generatedDenied();
        await assertGeneratedSourceSize(tx, parent, parent.pdpaConsentId);
        const source = await tx.contract.findUnique({
          where: { id: event.contractId, deletedAt: null },
          include: DOCUMENT_SOURCE_INCLUDE,
        });
        if (
          !source ||
          !contractSignatureRequirements(source).complete ||
          documentSourceRevision(source) !== event.sourceRevision ||
          documentSourceRevision(source.signatures.map((s) => s.id).sort()) !==
            documentSourceRevision([...event.signatureIds].sort())
        )
          throw generatedDenied();
        // A retained event is necessary but never a staff/userId capability. Raw
        // custom terms remain unavailable until child4 proves current owner authority.
        for (const [type, value, revision] of [
          ['CONTRACT', event.contractManifest, event.contractDependencyRevision],
          ['PDPA_CONSENT', event.pdpaManifest, event.pdpaDependencyRevision],
        ] as const) {
          const manifest = parseGeneratedManifest(value);
          if (manifest.template.kind !== 'BUILTIN' || manifest.template.id !== null)
            throw generatedDenied();
          const originals = {
            products: [source.productId],
            payments: source.payments.map((p) => p.id).sort(),
            signatures: source.signatures.map((s) => s.id).sort(),
            consent: source.pdpaConsentId,
            salesperson: source.salespersonId,
          };
          if (
            documentSourceRevision(originals) !==
            documentSourceRevision({
              products: manifest.products,
              payments: [...manifest.payments].sort(),
              signatures: [...manifest.signatures].sort(),
              consent: manifest.consent,
              salesperson: manifest.salesperson,
            })
          )
            throw generatedDenied();
          const html = this.templates.getDefaultTemplate(type);
          if (manifest.template.revision !== documentSourceRevision({ html, settings: null }))
            throw generatedDenied();
          const [configSize] = await tx.$queryRaw<
            Array<{ bytes: bigint }>
          >`SELECT COALESCE(sum(octet_length(value)),0)::bigint AS bytes FROM system_config WHERE key=ANY(${[...GENERATED_CONFIG_KEYS]}::text[]) AND deleted_at IS NULL`;
          if (configSize.bytes > BigInt(2 * 1024 * 1024)) throw generatedDenied();
          const configRows = await tx.systemConfig.findMany({
            where: { key: { in: [...GENERATED_CONFIG_KEYS] }, deletedAt: null },
            select: { id: true, key: true, value: true },
            orderBy: { key: 'asc' },
          });
          const config = configRows.map((c) => ({
            id: c.id,
            key: c.key,
            revision: digest(Buffer.from(c.value)),
          }));
          const photos = html.includes('{device_photos_grid}')
            ? await tx.contractDocument.findMany({
                where: {
                  contractId: source.id,
                  documentType: 'DEVICE_PHOTO',
                  isLatest: true,
                  deletedAt: null,
                },
                include: { uploadIdentity: true },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                take: 6,
              })
            : [];
          if (
            photos.some(
              (p) =>
                !p.uploadIdentity ||
                p.uploadIdentity.contractId !== source.id ||
                p.uploadIdentity.customerId !== source.customerId ||
                p.uploadIdentity.branchId !== source.branchId ||
                p.uploadIdentity.inlineValueHash !== digest(Buffer.from(p.fileUrl)) ||
                !safeEmbeddedImage(p.fileUrl),
            )
          )
            throw generatedDenied();
          const currentManifest = {
            ...manifest,
            config,
            photos: photos.map((p) => ({ documentId: p.id, identityId: p.uploadIdentity!.id })),
          };
          if (
            documentSourceRevision({
              manifest: currentManifest,
              photos: photos.map((p) => p.fileUrl),
              config: configRows,
            }) !== revision
          )
            throw generatedDenied();
        }
        return {
          kind: 'committed-signature-production' as const,
          eventId: event.id,
          contractId: event.contractId,
          sourceRevision: event.sourceRevision,
          templateSource: 'BUILTIN' as const,
          contractDependencyRevision: event.contractDependencyRevision,
          pdpaDependencyRevision: event.pdpaDependencyRevision,
        };
      },
      { timeout: 30000, isolationLevel: 'Serializable' },
    );
  }
}
