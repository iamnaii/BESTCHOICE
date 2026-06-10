import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma, ContractDocumentType } from '@prisma/client';
import { formatDateLong } from '../../../utils/thai-date.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationCategory } from '../../notifications/notification-category.enum';
import { ContractTemplateService } from './contract-template.service';
import { DocumentRenderingService } from './document-rendering.service';
import { escapeHtml, isSafeImageDataUrl } from './contract-document-format.util';
import * as crypto from 'crypto';

/**
 * DocumentPersistenceService — orchestrates fetch-contract → render → pdf → S3 →
 * EDocument/ContractDocument rows. Extracted VERBATIM from DocumentsService.
 *
 * The ensureSignedContractDocument $transaction (ContractDocument + DocumentAuditLog
 * created atomically) is moved WHOLE — never split. The fire-and-forget
 * signContract → ensureSignedContractDocument hook lives in ContractSignatureService
 * and resolves this service through the facade at call time.
 */
@Injectable()
export class DocumentPersistenceService {
  private readonly logger = new Logger(DocumentPersistenceService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private notificationsService: NotificationsService,
    private templateService: ContractTemplateService,
    private rendering: DocumentRenderingService,
  ) {}

  // ─── Stateless format helpers (delegate to contract-document-format.util) ───
  private escapeHtml(str: string): string {
    return escapeHtml(str);
  }

  private isSafeImageDataUrl(url: string): boolean {
    return isSafeImageDataUrl(url);
  }

  // ─── Auto-save signed contract PDF as ContractDocument ───
  // Called after all 4 required signatures are in place. Generates the
  // contract PDF (reusing the existing eDocument pipeline, which handles
  // template resolution + placeholder substitution + puppeteer + S3), then
  // creates a ContractDocument row pointing at the same S3 file so the
  // reviewer checklist sees SIGNED_CONTRACT as present.
  async ensureSignedContractDocument(contractId: string, uploadedByUserId: string) {
    const existing = await this.prisma.contractDocument.findFirst({
      where: {
        contractId,
        documentType: ContractDocumentType.SIGNED_CONTRACT,
        isLatest: true,
        deletedAt: null,
      },
    });
    if (existing) {
      this.logger.log(`SIGNED_CONTRACT already exists for contract ${contractId} — skipping auto-save`);
      return existing;
    }

    const edoc = await this.generateDocument(contractId, uploadedByUserId, 'CONTRACT');
    if (!edoc.pdfGenerated) {
      this.logger.warn(
        `Auto-save SIGNED_CONTRACT for ${contractId}: PDF generation fell back to HTML — not saving as ContractDocument`,
      );
      return null;
    }

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { contractNumber: true },
    });
    const fileName = `${contract?.contractNumber || contractId}_signed.pdf`;

    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contractDocument.create({
        data: {
          contractId,
          documentType: ContractDocumentType.SIGNED_CONTRACT,
          fileName,
          originalName: fileName,
          fileUrl: edoc.fileUrl,
          fileHash: edoc.fileHash,
          mimeType: 'application/pdf',
          version: 1,
          isLatest: true,
          isImmutable: false,
          uploadedById: uploadedByUserId,
        },
      });
      await tx.documentAuditLog.create({
        data: {
          documentId: created.id,
          contractId,
          action: 'UPLOAD',
          userId: uploadedByUserId,
          details: { source: 'auto-signed-contract', fileName, fileHash: edoc.fileHash } as Prisma.InputJsonValue,
        },
      });
      return created;
    });

    this.logger.log(`Auto-saved SIGNED_CONTRACT document ${doc.id} for contract ${contractId}`);
    return doc;
  }

  // ─── E-Document Generation ────────────────────────────
  async generateDocument(contractId: string, createdById: string, documentType: string, templateId?: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: true,
        product: true,
        branch: true,
        salesperson: true,
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        signatures: { where: { deletedAt: null } },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    // Get template
    let htmlContent = '';
    let templateSettings: Prisma.JsonValue = null;
    if (templateId) {
      const template = await this.templateService.findOneTemplate(templateId);
      htmlContent = template.contentHtml;
      templateSettings = template.settings;
    } else {
      const resolved = await this.templateService.resolveTemplate(contract.planType || 'STORE_DIRECT', documentType);
      htmlContent = resolved.html;
      templateSettings = resolved.settings;
    }

    // Replace placeholders and wrap with A4 styling
    const lessorSig = await this.rendering.getSystemLessorSignature();
    const renderedHtml = this.rendering.wrapWithA4Styles(await this.rendering.replacePlaceholders(htmlContent, contract, lessorSig), templateSettings, contract.contractNumber);

    // Generate PDF from HTML via Puppeteer (if available), otherwise store HTML
    let fileUrl: string;
    let fileHash: string;
    let pdfGenerated = false;

    try {
      const pdfBuffer = await this.rendering.htmlToPdf(renderedHtml, contract.contractNumber);
      fileHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
      const s3Key = `contracts/${new Date().getFullYear()}/${contract.contractNumber}/${documentType}_${Date.now()}.pdf`;
      fileUrl = await this.storageService.upload(s3Key, pdfBuffer, 'application/pdf');
      pdfGenerated = true;
      this.logger.log(`PDF generated and uploaded: ${fileUrl} (${pdfBuffer.length} bytes)`);
    } catch (err) {
      // Fallback to HTML storage if Puppeteer is not available
      this.logger.warn(`PDF generation failed, storing HTML: ${err instanceof Error ? err.message : err}`);
      fileHash = crypto.createHash('sha256').update(renderedHtml).digest('hex');
      fileUrl = `documents/${contract.contractNumber}_${documentType}_${Date.now()}.html`;
    }

    const doc = await this.prisma.eDocument.create({
      data: {
        contractId,
        documentType,
        fileUrl,
        fileHash,
        createdById,
      },
    });

    return { ...doc, renderedHtml, pdfGenerated };
  }

  /** Generate PDF buffer directly (no S3 upload) for download */
  async generatePdfBuffer(contractId: string, userId: string): Promise<Buffer> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: true, product: true, branch: true, salesperson: true,
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        signatures: { where: { deletedAt: null } },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    const { html: htmlContent, settings: templateSettings } = await this.templateService.resolveTemplate(
      contract.planType || 'STORE_DIRECT', 'CONTRACT',
    );
    const lessorSig = await this.rendering.getSystemLessorSignature();
    const renderedHtml = this.rendering.wrapWithA4Styles(
      await this.rendering.replacePlaceholders(htmlContent, contract, lessorSig),
      templateSettings,
      contract.contractNumber,
    );
    return this.rendering.htmlToPdf(renderedHtml, contract.contractNumber);
  }

  /** Get contract number by ID */
  async getContractNumber(contractId: string): Promise<string> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { contractNumber: true },
    });
    return contract?.contractNumber || '';
  }

  async getDocuments(contractId: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const where = { contractId };
    const [data, total] = await Promise.all([
      this.prisma.eDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.eDocument.count({ where }),
    ]);
    return { data, total, page, limit: safeLimit };
  }

  async getDocument(id: string) {
    const doc = await this.prisma.eDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    return doc;
  }

  // ─── PDPA Consent Document Generation ─────────────────
  async generatePdpaDocument(contractId: string, createdById: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: true,
        product: true,
        branch: true,
        salesperson: true,
        signatures: { where: { deletedAt: null } },
        pdpaConsent: true,
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');
    if (!contract.pdpaConsent) throw new BadRequestException('ยังไม่มีความยินยอม PDPA');

    // Get PDPA template or use default
    const template = await this.prisma.contractTemplate.findFirst({
      where: { type: 'PDPA_CONSENT', isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    let htmlContent = template?.contentHtml || this.templateService.getDefaultTemplate('PDPA_CONSENT');

    // Replace standard placeholders
    const lessorSigPdpa = await this.rendering.getSystemLessorSignature();
    htmlContent = await this.rendering.replacePlaceholders(htmlContent, contract, lessorSigPdpa);

    // Replace PDPA-specific placeholders
    const pdpaSignature = contract.pdpaConsent.signatureImage && this.isSafeImageDataUrl(contract.pdpaConsent.signatureImage)
      ? `<img src="${contract.pdpaConsent.signatureImage}" style="max-height:80px;display:block;margin:0 auto"/>`
      : '<div style="border-bottom:1px solid #000;width:200px;height:80px"></div>';

    const consentDate = contract.pdpaConsent.grantedAt
      ? formatDateLong(contract.pdpaConsent.grantedAt)
      : formatDateLong(new Date());

    htmlContent = htmlContent
      .replace(/\{pdpa_signature\}/g, pdpaSignature)
      .replace(/\{pdpa_consent_date\}/g, this.escapeHtml(consentDate));

    const renderedHtml = this.rendering.wrapWithA4Styles(htmlContent, template?.settings, contract.contractNumber);
    const fileHash = crypto.createHash('sha256').update(renderedHtml).digest('hex');
    const fileUrl = `documents/${contract.contractNumber}_PDPA_${Date.now()}.html`;

    const doc = await this.prisma.eDocument.create({
      data: {
        contractId,
        documentType: 'PDPA_CONSENT',
        fileUrl,
        fileHash,
        createdById,
      },
    });

    return { ...doc, renderedHtml };
  }

  // ─── Auto-generate documents after all signatures ────
  async generateSignedDocuments(contractId: string, createdById: string) {
    const results: { contract?: Awaited<ReturnType<DocumentPersistenceService['generateDocument']>>; pdpa?: Awaited<ReturnType<DocumentPersistenceService['generatePdpaDocument']>>; errors?: string[] } = {};
    const errors: string[] = [];

    // Generate contract document
    try {
      results.contract = await this.generateDocument(contractId, createdById, 'CONTRACT');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error('Failed to auto-generate contract document:', msg);
      errors.push(`สัญญา: ${msg}`);
    }

    // Generate PDPA document
    try {
      results.pdpa = await this.generatePdpaDocument(contractId, createdById);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error('Failed to auto-generate PDPA document:', msg);
      errors.push(`PDPA: ${msg}`);
    }

    if (errors.length > 0) results.errors = errors;

    // Send LINE notification to customer after document generation
    try {
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        include: { customer: true, product: true, signatures: { where: { deletedAt: null } } },
      });
      if (contract?.customer?.lineIdFinance) {
        const signatureCount = contract.signatures?.length || 0;
        await this.notificationsService.send({
          channel: 'LINE',
          channelKey: 'line-finance',
          recipient: contract.customer.lineIdFinance,
          message: `สัญญาเลขที่ ${contract.contractNumber} เซ็นเรียบร้อยแล้ว (${signatureCount} ลายเซ็น)\nสินค้า: ${contract.product?.name || '-'}\nดาวน์โหลดเอกสารผ่าน LINE`,
          relatedId: contractId,
          customerId: contract.customer.id,
          category: NotificationCategory.TRANSACTIONAL,
        });
        this.logger.log(`Sent contract-signed notification to LINE: ${contract.customer.lineIdFinance}`);
      }
    } catch (notifyErr) {
      this.logger.warn(`Failed to send contract-signed notification: ${notifyErr instanceof Error ? notifyErr.message : notifyErr}`);
    }

    // Audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: createdById,
          action: 'CONTRACT_SIGNED',
          entity: 'contract',
          entityId: contractId,
          newValue: { documentCount: (results.contract ? 1 : 0) + (results.pdpa ? 1 : 0), errors: errors.length },
        },
      });
    } catch (auditErr) {
      this.logger.warn(`Failed to create audit log: ${auditErr instanceof Error ? auditErr.message : auditErr}`);
    }

    return results;
  }

  /**
   * Bulk-regenerate CONTRACT PDFs for contracts that have a CUSTOMER signature.
   * Use this after template changes (e.g. lessor name correction) to refresh already-signed
   * contracts. Old PDFs remain in S3 as legal evidence — new rows are appended to EDocument.
   */
  async regenerateSignedContractPdfs(createdById: string, limit = 500) {
    const contracts = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        signatures: { some: { signerType: 'CUSTOMER', deletedAt: null } },
      },
      select: { id: true, contractNumber: true },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    const success: string[] = [];
    const failed: { contractNumber: string; error: string }[] = [];

    for (const c of contracts) {
      try {
        await this.generateDocument(c.id, createdById, 'CONTRACT');
        success.push(c.contractNumber);
      } catch (err) {
        failed.push({
          contractNumber: c.contractNumber,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger.log(`Regenerated ${success.length}/${contracts.length} signed contract PDFs (${failed.length} failed)`);
    return { total: contracts.length, success: success.length, failed };
  }

  // ─── Preview ──────────────────────────────────────────
  async previewContract(contractId: string, templateId?: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        customer: true,
        product: true,
        branch: true,
        salesperson: true,
        payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
        signatures: { where: { deletedAt: null } },
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    let htmlContent = '';
    let templateSettings: Prisma.JsonValue = null;
    if (templateId) {
      const template = await this.templateService.findOneTemplate(templateId);
      htmlContent = template.contentHtml;
      templateSettings = template.settings;
    } else {
      const resolved = await this.templateService.resolveTemplate(contract.planType || 'STORE_DIRECT', 'CONTRACT');
      htmlContent = resolved.html;
      templateSettings = resolved.settings;
    }

    const lessorSigPreview = await this.rendering.getSystemLessorSignature();
    const bodyHtml = await this.rendering.replacePlaceholders(htmlContent, contract, lessorSigPreview);
    return { html: this.rendering.wrapWithA4Styles(bodyHtml, templateSettings, contract.contractNumber) };
  }

  // ─── Document Download ───────────────────────────────
  async getDocumentStream(id: string): Promise<{ stream: import('stream').Readable; filename: string; contentType: string }> {
    const doc = await this.prisma.eDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');

    const isPdf = doc.fileUrl.endsWith('.pdf');
    const isHtml = doc.fileUrl.endsWith('.html') || doc.fileUrl.endsWith('.htm');
    const filename = doc.fileUrl.split('/').pop() || `${doc.documentType}_${doc.id}.${isPdf ? 'pdf' : 'html'}`;

    // Storage-backed: fileUrl is a bucket key pointing at the real asset.
    // Stream it regardless of type — previously the HTML branch emitted
    // the PATH string as the response body (visible to the customer as a
    // blank page showing only the filename), which is the bug this fixes.
    if (this.storageService.configured && (isPdf || isHtml)) {
      const stream = await this.storageService.getStream(doc.fileUrl);
      const contentType = isPdf ? 'application/pdf' : 'text/html; charset=utf-8';
      return { stream, filename, contentType };
    }

    // Legacy inline HTML: fileUrl field actually contains the HTML markup
    // itself (no storage backend). Emit it directly.
    if (!this.storageService.configured && doc.fileUrl.trim().startsWith('<')) {
      const { Readable } = await import('stream');
      const htmlStream = Readable.from([doc.fileUrl]);
      return { stream: htmlStream, filename, contentType: 'text/html; charset=utf-8' };
    }

    throw new BadRequestException('เอกสารนี้ไม่สามารถดาวน์โหลดได้ กรุณาติดต่อพนักงาน');
  }

  async getDocumentSignedUrl(id: string): Promise<{ url: string; expiresIn: number }> {
    const doc = await this.prisma.eDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');

    if (!doc.fileUrl.endsWith('.pdf') || !this.storageService.configured) {
      throw new BadRequestException('เอกสารนี้ไม่มีไฟล์ PDF ให้ดาวน์โหลด');
    }

    const expiresIn = 3600;
    const url = await this.storageService.getSignedDownloadUrl(doc.fileUrl, expiresIn);
    return { url, expiresIn };
  }
}
