import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { SignerType, Prisma } from '@prisma/client';
import { formatDateShort, formatDateMedium, formatDateLong, getThaiDateParts } from '../../utils/thai-date.util';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/document.dto';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private notificationsService: NotificationsService,
    private settingsService: SettingsService,
  ) {}

  // ─── Contract Templates ──────────────────────────────
  async findAllTemplates(type?: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const where: Record<string, unknown> = { isActive: true };
    if (type) where.type = type;
    const [data, total] = await Promise.all([
      this.prisma.contractTemplate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.contractTemplate.count({ where }),
    ]);
    return { data, total, page, limit: safeLimit };
  }

  async findOneTemplate(id: string) {
    const template = await this.prisma.contractTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('ไม่พบเทมเพลต');
    return template;
  }

  async createTemplate(dto: CreateTemplateDto) {
    // Sanitize HTML to prevent stored XSS
    const sanitizedHtml = this.sanitizeTemplateHtml(dto.contentHtml);
    const placeholders = dto.placeholders || this.extractPlaceholders(sanitizedHtml);
    return this.prisma.contractTemplate.create({
      data: {
        name: dto.name,
        type: dto.type || 'STORE_DIRECT',
        contentHtml: sanitizedHtml,
        placeholders,
        blocks: dto.blocks ?? [],
        settings: (dto.settings ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto) {
    await this.findOneTemplate(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.contentHtml !== undefined) {
      const sanitizedHtml = this.sanitizeTemplateHtml(dto.contentHtml);
      data.contentHtml = sanitizedHtml;
      data.placeholders = dto.placeholders || this.extractPlaceholders(sanitizedHtml);
    }
    if (dto.blocks !== undefined) data.blocks = dto.blocks;
    if (dto.settings !== undefined) data.settings = dto.settings;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.contractTemplate.update({ where: { id }, data });
  }

  async deleteTemplate(id: string) {
    await this.findOneTemplate(id);
    return this.prisma.contractTemplate.update({ where: { id }, data: { isActive: false } });
  }

  // ─── E-Signature (พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544) ────
  async signContract(
    contractId: string,
    signatureImage: string,
    signerType: string,
    req: { ip?: string; userAgent?: string },
    options?: {
      signatureSvg?: string;
      signerName?: string;
      screenSize?: string;
      gpsLatitude?: number;
      gpsLongitude?: number;
      staffUserId?: string;
    },
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { signatures: { where: { deletedAt: null } }, product: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    // Allow signing during CREATING, REJECTED, PENDING_REVIEW, and APPROVED (not after activation)
    const allowedWorkflow = ['CREATING', 'REJECTED', 'PENDING_REVIEW', 'APPROVED'];
    if (!allowedWorkflow.includes(contract.workflowStatus)) {
      throw new BadRequestException('ไม่สามารถลงนามได้ในสถานะปัจจุบัน');
    }

    // Normalize STAFF to COMPANY for backward compatibility
    const normalizedType = signerType === 'STAFF' ? 'COMPANY' : signerType;

    // Check if already signed by this signer type
    const existing = contract.signatures.find((s) => {
      const existingNormalized = s.signerType === 'STAFF' ? 'COMPANY' : s.signerType;
      return existingNormalized === normalizedType;
    });
    if (existing) throw new BadRequestException(`${signerType} ลงนามไปแล้ว กรุณาเซ็นใหม่โดยลบลายเซ็นเดิมก่อน`);

    // Generate SHA-256 hash of contract content at signing time (พิสูจน์ว่าเอกสารไม่ถูกแก้ไขหลังเซ็น)
    const contractContent = JSON.stringify({
      contractNumber: contract.contractNumber,
      customerId: contract.customerId,
      productId: contract.productId,
      sellingPrice: contract.sellingPrice,
      downPayment: contract.downPayment,
      totalMonths: contract.totalMonths,
      monthlyPayment: contract.monthlyPayment,
      imei: contract.product?.imeiSerial,
    });
    const contractHash = crypto.createHash('sha256').update(contractContent).digest('hex');

    const signature = await this.prisma.signature.create({
      data: {
        contractId,
        signerType: signerType as SignerType,
        signatureImage,
        signatureSvg: options?.signatureSvg || null,
        signerName: options?.signerName || null,
        ipAddress: req.ip || null,
        deviceInfo: req.userAgent || null,
        screenSize: options?.screenSize || null,
        gpsLatitude: options?.gpsLatitude ?? null,
        gpsLongitude: options?.gpsLongitude ?? null,
        staffUserId: options?.staffUserId || null,
        contractHash,
      },
    });

    return signature;
  }

  // ─── Delete Signature (ลบลายเซ็นเพื่อเซ็นใหม่, เฉพาะก่อน ACTIVE) ───
  async deleteSignature(contractId: string, signerType: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { signatures: { where: { deletedAt: null } } },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    if (contract.status !== 'DRAFT') {
      throw new BadRequestException('ไม่สามารถลบลายเซ็นหลังจากสัญญา ACTIVE แล้ว');
    }

    const sig = contract.signatures.find((s) => s.signerType === signerType);
    if (!sig) throw new NotFoundException('ไม่พบลายเซ็นที่ต้องการลบ');

    await this.prisma.signature.update({
      where: { id: sig.id },
      data: { deletedAt: new Date() },
    });
    return { message: `ลบลายเซ็น ${signerType} สำเร็จ` };
  }

  async getSignatures(contractId: string, page = 1, limit = 50) {
    const safeLimit = Math.min(limit, 100);
    const where = { contractId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.signature.findMany({
        where,
        orderBy: { signedAt: 'asc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.signature.count({ where }),
    ]);
    return { data, total, page, limit: safeLimit };
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
      const template = await this.findOneTemplate(templateId);
      htmlContent = template.contentHtml;
      templateSettings = template.settings;
    } else {
      const resolved = await this.resolveTemplate(contract.planType || 'STORE_DIRECT', documentType);
      htmlContent = resolved.html;
      templateSettings = resolved.settings;
    }

    // Replace placeholders and wrap with A4 styling
    const lessorSig = await this.getSystemLessorSignature();
    const renderedHtml = this.wrapWithA4Styles(await this.replacePlaceholders(htmlContent, contract, lessorSig), templateSettings, contract.contractNumber);

    // Generate PDF from HTML via Puppeteer (if available), otherwise store HTML
    let fileUrl: string;
    let fileHash: string;
    let pdfGenerated = false;

    try {
      const pdfBuffer = await this.htmlToPdf(renderedHtml, contract.contractNumber);
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

    const { html: htmlContent, settings: templateSettings } = await this.resolveTemplate(
      contract.planType || 'STORE_DIRECT', 'CONTRACT',
    );
    const lessorSig = await this.getSystemLessorSignature();
    const renderedHtml = this.wrapWithA4Styles(
      await this.replacePlaceholders(htmlContent, contract, lessorSig),
      templateSettings,
      contract.contractNumber,
    );
    return this.htmlToPdf(renderedHtml, contract.contractNumber);
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

    let htmlContent = template?.contentHtml || this.getDefaultTemplate('PDPA_CONSENT');

    // Replace standard placeholders
    const lessorSigPdpa = await this.getSystemLessorSignature();
    htmlContent = await this.replacePlaceholders(htmlContent, contract, lessorSigPdpa);

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

    const renderedHtml = this.wrapWithA4Styles(htmlContent, template?.settings, contract.contractNumber);
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
    const results: { contract?: Awaited<ReturnType<DocumentsService['generateDocument']>>; pdpa?: Awaited<ReturnType<DocumentsService['generatePdpaDocument']>>; errors?: string[] } = {};
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
      if (contract?.customer?.lineId) {
        const signatureCount = contract.signatures?.length || 0;
        await this.notificationsService.send({
          channel: 'LINE',
          recipient: contract.customer.lineId,
          message: `สัญญาเลขที่ ${contract.contractNumber} เซ็นเรียบร้อยแล้ว (${signatureCount} ลายเซ็น)\nสินค้า: ${contract.product?.name || '-'}\nดาวน์โหลดเอกสารผ่าน LINE`,
          relatedId: contractId,
        });
        this.logger.log(`Sent contract-signed notification to LINE: ${contract.customer.lineId}`);
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
      const template = await this.findOneTemplate(templateId);
      htmlContent = template.contentHtml;
      templateSettings = template.settings;
    } else {
      const resolved = await this.resolveTemplate(contract.planType || 'STORE_DIRECT', 'CONTRACT');
      htmlContent = resolved.html;
      templateSettings = resolved.settings;
    }

    const lessorSigPreview = await this.getSystemLessorSignature();
    const bodyHtml = await this.replacePlaceholders(htmlContent, contract, lessorSigPreview);
    return { html: this.wrapWithA4Styles(bodyHtml, templateSettings, contract.contractNumber) };
  }

  // ─── Helpers ──────────────────────────────────────────

  /** Sanitize template HTML: remove script tags, event handlers, and dangerous content */
  private sanitizeTemplateHtml(html: string): string {
    return html
      // Remove script tags and their content
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      // Remove event handler attributes (onclick, onerror, onload, etc.)
      .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      // Remove javascript: protocol in href/src/action attributes
      .replace(/(href|src|action)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '$1=""')
      // Remove data: protocol in src (except for images which are handled separately)
      .replace(/src\s*=\s*(?:"data:(?!image\/)[^"]*"|'data:(?!image\/)[^']*')/gi, 'src=""')
      // Remove iframe, object, embed, form tags
      .replace(/<(iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<(iframe|object|embed|form)\b[^>]*\/?>/gi, '')
      // Remove base tag (can redirect all relative URLs)
      .replace(/<base\b[^>]*\/?>/gi, '');
  }

  private extractPlaceholders(html: string): string[] {
    // Support both old {placeholder} and new {{= VARIABLE}} syntax
    const oldMatches = html.match(/\{[a-z_]+\}/g) || [];
    const newMatches = html.match(/\{\{=\s*[A-Z_][A-Z0-9_.]*\s*(?:\|[^}]*)?\}\}/g) || [];
    return [...new Set([...oldMatches, ...newMatches])];
  }

  /** Escape HTML special characters to prevent XSS */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Parse JSON address string and format as readable Thai address */
  private formatAddress(jsonStr: string | null | undefined): string {
    if (!jsonStr) return '-';
    try {
      const addr = JSON.parse(jsonStr);
      if (typeof addr !== 'object' || addr === null) return jsonStr;
      // If it has a raw field (fallback from OCR), use it
      if (addr.raw && !addr.province) return addr.raw;
      const parts: string[] = [];
      if (addr.houseNo) parts.push(addr.houseNo);
      if (addr.moo) parts.push(`หมู่ ${addr.moo}`);
      if (addr.village) parts.push(`หมู่บ้าน ${addr.village}`);
      if (addr.soi) parts.push(`ซอย ${addr.soi}`);
      if (addr.road) parts.push(`ถนน ${addr.road}`);
      if (addr.subdistrict) parts.push(addr.subdistrict);
      if (addr.district) parts.push(addr.district);
      if (addr.province) parts.push(addr.province);
      if (addr.postalCode) parts.push(addr.postalCode);
      return parts.length > 0 ? parts.join(' ') : '-';
    } catch {
      return jsonStr;
    }
  }

  /** Mask national ID: show first 1 and last 4 digits only */
  private maskNationalId(id: string): string {
    if (!id || id.length < 5) return id;
    return id[0] + '-xxxx-xxxxx-' + id.slice(-4);
  }

  /** Convert number to Thai baht text */
  private numberToThaiText(num: number): string {
    const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
    const positions = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

    const convertIntPart = (n: number): string => {
      if (n === 0) return 'ศูนย์';
      let result = '';
      const str = String(n);
      const len = str.length;
      for (let i = 0; i < len; i++) {
        const d = Number(str[i]);
        const pos = len - i - 1;
        if (d === 0) continue;
        if (pos === 0 && d === 1 && len > 1) {
          result += 'เอ็ด';
        } else if (pos === 1 && d === 1) {
          result += 'สิบ';
        } else if (pos === 1 && d === 2) {
          result += 'ยี่สิบ';
        } else {
          result += digits[d] + positions[pos];
        }
      }
      return result;
    };

    const intPart = Math.floor(Math.abs(num));
    const decPart = Math.round((Math.abs(num) - intPart) * 100);

    let text = convertIntPart(intPart) + 'บาท';
    if (decPart > 0) {
      text += convertIntPart(decPart) + 'สตางค์';
    } else {
      text += 'ถ้วน';
    }
    return text;
  }

  /** Convert number to Thai text (no currency) */
  private numberToThaiCountText(num: number): string {
    const digits = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ', 'สิบเอ็ด', 'สิบสอง'];
    if (num >= 0 && num <= 12) return digits[num];
    return String(num);
  }

  /** Convert an S3 file URL/key to a base64 data URL for embedding in PDF */
  private async fileUrlToBase64DataUrl(fileUrl: string): Promise<string> {
    try {
      // Already a data URL — return as-is
      if (fileUrl.startsWith('data:')) return fileUrl;

      // S3 must be configured to download files
      if (!this.storageService.configured) {
        this.logger.warn(`S3 not configured, cannot embed image: ${fileUrl}`);
        return fileUrl;
      }

      // Extract S3 key from full URL or use as-is if it's a key
      const key = fileUrl.replace(/^https?:\/\/[^/]+\//, '');
      const stream = await this.storageService.getStream(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      // Detect MIME type from file extension or default to jpeg
      const ext = key.split('.').pop()?.toLowerCase() || '';
      const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
      const mime = mimeMap[ext] || 'image/jpeg';

      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (err) {
      this.logger.warn(`Failed to convert file to base64: ${fileUrl}`, err instanceof Error ? err.message : err);
      return fileUrl; // Fallback to original URL
    }
  }

  /** Validate that a data URL is a safe image format */
  private isSafeImageDataUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    // Check prefix is a valid image data URL, and ensure no HTML/script injection
    return /^data:image\/(png|jpeg|gif|webp);base64,/.test(url) && !/<|>|javascript:/i.test(url);
  }

  /** Wrap rendered HTML with A4 page styles and page numbering */
  private wrapWithA4Styles(bodyHtml: string, templateSettings?: Prisma.JsonValue, contractNumber?: string): string {
    // Use template settings if available, otherwise fallback to defaults
    const settings = templateSettings as Record<string, unknown> | null | undefined;
    const margins = (settings?.margins as Record<string, number>) || { top: 25.4, bottom: 25.4, left: 19.1, right: 19.1 };
    const fontSize = (settings?.fontSize as Record<string, string>) || { body: '16pt', heading: '18pt', footer: '10pt' };
    const letterhead = (settings?.letterhead as string) || 'none';
    // Build letterhead HTML
    let letterheadHtml = '';
    if (letterhead === 'bestchoice') {
      letterheadHtml = `
        <div style="text-align:center;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #059669">
          <h1 style="font-size:20px;font-weight:700;color:#059669;letter-spacing:1px;margin:0 0 4px">BESTCHOICEPHONE Co., Ltd.</h1>
          <p style="font-size:14px;color:#4a4a4a;margin:0 0 2px">บริษัท เบสท์ช้อยส์โฟน จำกัด | เลขประจำตัวผู้เสียภาษี 0165568000050</p>
          <p style="font-size:12px;color:#888;margin:0">456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000</p>
        </div>`;
    }

    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet"/>
<style>
  /* TH Sarabun PSK — local font files (matches template editor) */
  @font-face {
    font-family: 'TH Sarabun PSK';
    src: url('/fonts/THSarabunPSK-Regular.ttf') format('truetype');
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: 'TH Sarabun PSK';
    src: url('/fonts/THSarabunPSK-Bold.ttf') format('truetype');
    font-weight: 700;
    font-style: normal;
    font-display: swap;
  }
</style>
<style>
  @page {
    size: A4;
    margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'TH Sarabun PSK', 'Sarabun', 'Noto Sans Thai', sans-serif;
    font-size: ${fontSize.body};
    line-height: 1.5;
    color: #1a1a1a;
  }
  .a4-page {
    width: 100%;
    min-height: 250mm;
    margin: 0 auto;
    padding: 0;
  }
  table { border-collapse: collapse; }
  /* Page break helpers that templates can use */
  .page-break { page-break-after: always; break-after: page; }
  .no-break { page-break-inside: avoid; break-inside: avoid; }

  @media print {
    body { margin: 0; padding: 0; }
    .a4-page { width: 100%; min-height: auto; page-break-after: always; break-after: page; }
    .a4-page:last-child { page-break-after: avoid; break-after: avoid; }
  }
  /* Screen preview: simulate A4 pages */
  @media screen {
    body { background: #e5e7eb; padding: 20px 0; }
    .a4-page {
      background: #fff;
      width: 210mm;
      min-height: 297mm;
      padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
      margin: 0 auto 40px auto;
      box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08);
    }
  }
</style>
</head>
<body>
${(() => {
  const pages = bodyHtml.split(/<!--\s*PAGE_BREAK\s*-->/);
  return pages.map((pageContent, i) => {
    const header = i === 0 ? letterheadHtml : '';
    return `<div class="a4-page">${header}${pageContent}</div>`;
  }).join('\n');
})()}
</body>
</html>`;
  }

  /**
   * Resolve which template HTML to use:
   * - If active DB template exists for this planType, always use it (admin-configured)
   * - Otherwise fall back to file template or inline default
   */
  private async resolveTemplate(planType: string, documentType: string): Promise<{ html: string; settings: Prisma.JsonValue }> {
    const template = await this.prisma.contractTemplate.findFirst({
      where: { type: planType, isActive: true, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });

    if (template) {
      return { html: template.contentHtml, settings: template.settings };
    }

    // No DB template for this planType — use file template or inline fallback
    const fileHtml = this.getDefaultTemplate(documentType);
    return {
      html: fileHtml || '',
      settings: null,
    };
  }

  private async getSystemLessorSignature(): Promise<{ image: string; name: string } | null> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: ['lessor_signature_image', 'lessor_signer_name'] } },
    });
    const image = rows.find(r => r.key === 'lessor_signature_image')?.value || '';
    const name = rows.find(r => r.key === 'lessor_signer_name')?.value || '';
    if (image && name) return { image, name };
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async replacePlaceholders(html: string, contract: any, lessorSig?: { image: string; name: string } | null): Promise<string> {
    // Load configurable settings with hardcoded fallbacks
    const configMap: Record<string, string> = {};
    try {
      const allSettings = await this.settingsService.findAll();
      for (const s of allSettings) configMap[s.key] = s.value;
    } catch (err) {
      this.logger.warn('Settings not available, using defaults', err instanceof Error ? err.message : err);
    }
    const cfg = (key: string, fallback: string) => configMap[key] || fallback;
    const esc = this.escapeHtml.bind(this);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payments: any[] = contract.payments || [];

    // Fallback: generate display-only rows from contract metadata when payments are missing
    if (payments.length === 0 && contract.totalMonths > 0) {
      const startDate = new Date(contract.createdAt);
      const dueDay = contract.paymentDueDay || startDate.getDate();
      for (let i = 1; i <= contract.totalMonths; i++) {
        const due = new Date(startDate);
        due.setMonth(due.getMonth() + i);
        if (dueDay <= 28) due.setDate(dueDay);
        payments.push({
          installmentNo: i,
          dueDate: due,
          amountDue: Number(contract.monthlyPayment),
        });
      }
    }

    const tblCell = 'padding:4px 16px;border:1px solid #000;font-size:16pt';
    const paymentScheduleRows = payments
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) =>
          `<tr><td style="text-align:center;${tblCell}">${p.installmentNo}</td><td style="text-align:center;${tblCell}">${esc(formatDateMedium(p.dueDate))}</td><td style="text-align:right;${tblCell}">${Number(p.amountDue).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`,
      )
      .join('');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customerSig = contract.signatures?.find((s: any) => s.signerType === 'CUSTOMER');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let staffSig = contract.signatures?.find((s: any) => s.signerType === 'STAFF' || s.signerType === 'COMPANY');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const witness1Sig = contract.signatures?.find((s: any) => s.signerType === 'WITNESS_1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const witness2Sig = contract.signatures?.find((s: any) => s.signerType === 'WITNESS_2');

    // Fallback to system settings lessor signature if no COMPANY/STAFF signature on contract
    if (!staffSig && lessorSig) {
      staffSig = { signatureImage: lessorSig.image, signerName: lessorSig.name, signerType: 'COMPANY' };
    }

    // Validate signature images are safe data URLs before embedding
    const customerSigSafe = customerSig && this.isSafeImageDataUrl(customerSig.signatureImage);
    const staffSigSafe = staffSig && this.isSafeImageDataUrl(staffSig.signatureImage);
    const witness1SigSafe = witness1Sig && this.isSafeImageDataUrl(witness1Sig.signatureImage);
    const witness2SigSafe = witness2Sig && this.isSafeImageDataUrl(witness2Sig.signatureImage);

    // Format contract date in Thai
    const contractDate = new Date(contract.createdAt);
    const contractDateParts = getThaiDateParts(contractDate);
    const thaiDate = contractDateParts.full;
    const thaiDay = contractDateParts.day;
    const thaiMonth = contractDateParts.month;
    const thaiYear = contractDateParts.year;

    // Build guarantor/references as numbered list (matching contract format)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const references: any[] = contract.customer?.references || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const referencesHtml = references.map((r: any, i: number) =>
      `<p style="margin-left:3em">${i + 1}. ชื่อ-นามสกุล <u>&nbsp;&nbsp;${esc(r.prefix || '')}${esc(r.firstName || '')} ${esc(r.lastName || '')}&nbsp;&nbsp;</u> เบอร์โทรศัพท์ <u>&nbsp;&nbsp;${esc(r.phone || '')}&nbsp;&nbsp;</u> ความสัมพันธ์ <u>&nbsp;&nbsp;${esc(r.relationship || '')}&nbsp;&nbsp;</u></p>`
    ).join('');

    // Compute first and last payment dates
    const firstPayment = payments.length > 0 ? new Date(payments[0].dueDate) : contractDate;
    const lastPayment = payments.length > 0 ? new Date(payments[payments.length - 1].dueDate) : contractDate;
    const firstPaymentParts = getThaiDateParts(firstPayment);
    const firstPaymentDue = firstPaymentParts.medium;
    const firstPaymentDay = firstPaymentParts.day;
    const firstPaymentMonth = firstPaymentParts.month;
    const firstPaymentYear = firstPaymentParts.year;
    const lastPaymentDue = getThaiDateParts(lastPayment).medium;

    const replacements: Record<string, string> = {
      '{contract_number}': esc(contract.contractNumber || ''),
      '{contract_date}': thaiDate,
      '{contract_date_day}': thaiDay,
      '{contract_date_month}': thaiMonth,
      '{contract_date_year}': thaiYear,
      '{customer_name}': esc(contract.customer?.name || ''),
      '{customer_prefix}': esc(contract.customer?.prefix || ''),
      '{national_id}': esc(this.maskNationalId(contract.customer?.nationalId || '')),
      '{customer_phone}': esc(contract.customer?.phone || ''),
      '{customer_phone_secondary}': esc(contract.customer?.phoneSecondary || '-'),
      '{customer_address}': esc(this.formatAddress(contract.customer?.addressCurrent || contract.customer?.addressIdCard)),
      '{customer_address_id_card}': esc(this.formatAddress(contract.customer?.addressIdCard)),
      '{customer_address_current}': esc(this.formatAddress(contract.customer?.addressCurrent)),
      '{customer_zipcode}': esc(contract.customer?.zipcode || contract.customer?.postalCode || ''),
      '{customer_line_id}': esc(contract.customer?.lineId || '-'),
      '{customer_facebook}': esc(contract.customer?.facebookLink || contract.customer?.facebookName || '-'),
      '{customer_occupation}': esc(contract.customer?.occupation || '-'),
      '{customer_salary}': contract.customer?.salary ? Number(contract.customer.salary).toLocaleString() : '-',
      '{customer_workplace}': esc(contract.customer?.workplace || '-'),
      '{customer_address_work}': esc(this.formatAddress(contract.customer?.addressWork)),
      '{customer_references}': referencesHtml,
      '{product_name}': esc(contract.product?.name || ''),
      '{brand}': esc(contract.product?.brand || ''),
      '{model}': esc(contract.product?.model || ''),
      '{imei}': esc(contract.product?.imeiSerial || '-'),
      '{serial_number}': esc(contract.product?.serialNumber || '-'),
      '{product_color}': esc(contract.product?.color || '-'),
      '{product_storage}': esc(contract.product?.storage || '-'),
      '{product_category}': contract.product?.category === 'PHONE_NEW' ? 'มือ1' : contract.product?.category === 'PHONE_USED' ? 'มือ2' : esc(contract.product?.category || ''),
      '{selling_price}': Number(contract.sellingPrice).toLocaleString(),
      '{down_payment}': Number(contract.downPayment).toLocaleString(),
      '{down_payment_text}': this.numberToThaiText(Number(contract.downPayment)),
      '{monthly_payment}': Number(contract.monthlyPayment).toLocaleString(),
      '{monthly_payment_text}': this.numberToThaiText(Number(contract.monthlyPayment)),
      '{total_months}': String(contract.totalMonths),
      '{interest_rate}': `${(Number(contract.interestRate) * 100).toFixed(1)}%`,
      '{interest_total}': Number(contract.interestTotal).toLocaleString(),
      '{financed_amount}': Number(contract.financedAmount).toLocaleString(),
      '{financed_amount_text}': this.numberToThaiText(Number(contract.financedAmount)),
      '{total_months_text}': this.numberToThaiCountText(contract.totalMonths) + 'เดือน',
      '{first_payment_due}': firstPaymentDue,
      '{first_payment_day}': firstPaymentDay,
      '{first_payment_month}': firstPaymentMonth,
      '{first_payment_year}': firstPaymentYear,
      '{last_payment_due}': lastPaymentDue,
      '{branch_name}': esc(contract.branch?.name || ''),
      '{branch_address}': esc(contract.branch?.location || ''),
      '{branch_phone}': esc(contract.branch?.phone || ''),
      '{salesperson_name}': esc(contract.salesperson?.name || ''),
      '{witness1_name}': witness1Sig?.signerName ? esc(witness1Sig.signerName) : (references[0] ? esc(`${references[0].prefix || ''}${references[0].firstName || ''} ${references[0].lastName || ''}`.trim()) : ''),
      '{witness2_name}': witness2Sig?.signerName ? esc(witness2Sig.signerName) : (references[1] ? esc(`${references[1].prefix || ''}${references[1].firstName || ''} ${references[1].lastName || ''}`.trim()) : ''),
      '{staff_signer_name}': esc(contract.salesperson?.name || ''),
      '{date}': formatDateShort(new Date()),
      '{payment_schedule_table}': `<table style="border-collapse:collapse;width:70%;margin:10px auto;page-break-inside:auto"><thead><tr style="background:#f5f5f5"><th style="text-align:center;${tblCell};font-weight:bold">งวดที่</th><th style="text-align:center;${tblCell};font-weight:bold">วันที่ครบกำหนดชำระ</th><th style="text-align:center;${tblCell};font-weight:bold">จำนวนเงิน</th></tr></thead><tbody>${paymentScheduleRows}</tbody></table>`,
      '{customer_signature}': customerSigSafe ? `<img src="${customerSig.signatureImage}" style="max-height:60px;display:inline-block;vertical-align:middle;margin:0 4px"/>` : '<span style="display:inline-block;width:150px;border-bottom:1px solid #000;vertical-align:middle;margin:0 4px">&nbsp;</span>',
      '{staff_signature}': staffSigSafe ? `<img src="${staffSig.signatureImage}" style="max-height:60px;display:inline-block;vertical-align:middle;margin:0 4px"/>` : '<span style="display:inline-block;width:150px;border-bottom:1px solid #000;vertical-align:middle;margin:0 4px">&nbsp;</span>',
      '{witness1_signature}': witness1SigSafe ? `<img src="${witness1Sig.signatureImage}" style="max-height:60px;display:inline-block;vertical-align:middle;margin:0 4px"/>` : '<span style="display:inline-block;width:150px;border-bottom:1px solid #000;vertical-align:middle;margin:0 4px">&nbsp;</span>',
      '{witness2_signature}': witness2SigSafe ? `<img src="${witness2Sig.signatureImage}" style="max-height:60px;display:inline-block;vertical-align:middle;margin:0 4px"/>` : '<span style="display:inline-block;width:150px;border-bottom:1px solid #000;vertical-align:middle;margin:0 4px">&nbsp;</span>',
      // Company director info (from system settings)
      '{company_director_name}': esc(cfg('company_director', 'เอกนรินทร์ คงเดช')),
      '{company_director_id}': esc(cfg('company_director_id', '1-1601-00452-40-7')),
      '{company_director_address}': esc(cfg('company_director_address', '517 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000')),
      '{company_name}': esc(cfg('company_name_th', 'บริษัท เบสท์ช้อยส์โฟน จำกัด')),
      '{company_tax_id}': esc(cfg('company_tax_id', '0165568000050')),
      // Full national ID for signed contract PDF (no masking)
      '{national_id_full}': esc(contract.customer?.nationalId || ''),
    };

    // Device photos grid for page 6 — query DEVICE_PHOTO documents
    if (html.includes('{device_photos_grid}')) {
      const devicePhotos = await this.prisma.contractDocument.findMany({
        where: { contractId: contract.id, documentType: 'DEVICE_PHOTO', deletedAt: null, isLatest: true },
        orderBy: { createdAt: 'asc' },
        take: 6,
      });

      let photosGridHtml = '';
      if (devicePhotos.length > 0) {
        // Convert S3 URLs to base64 data URLs so Puppeteer can render them in PDF
        const base64Urls = await Promise.all(
          devicePhotos.map((p) => this.fileUrlToBase64DataUrl(p.fileUrl)),
        );
        const photoRows: string[] = [];
        for (let i = 0; i < devicePhotos.length; i += 2) {
          const leftUrl = base64Urls[i];
          const rightUrl = base64Urls[i + 1];
          photoRows.push(`<tr>
            <td style="width:50%;padding:8px;text-align:center;vertical-align:middle">
              <img src="${leftUrl}" style="max-width:90%;max-height:200px;object-fit:contain"/>
            </td>
            ${rightUrl ? `<td style="width:50%;padding:8px;text-align:center;vertical-align:middle">
              <img src="${rightUrl}" style="max-width:90%;max-height:200px;object-fit:contain"/>
            </td>` : '<td></td>'}
          </tr>`);
        }
        photosGridHtml = `<table style="width:100%;border-collapse:collapse">${photoRows.join('')}</table>`;
      } else {
        photosGridHtml = '<div style="text-align:center;padding:40px;color:#999;border:2px dashed #ddd;border-radius:8px">ยังไม่มีรูปถ่ายโทรศัพท์</div>';
      }
      replacements['{device_photos_grid}'] = photosGridHtml;
    }

    let result = html;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    // Build EMERGENCY_CONTACTS array with NAME/TEL/RELATION structure for new syntax
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emergencyContacts = references.map((r: any) => ({
      NAME: `${r.prefix || ''}${r.firstName || ''} ${r.lastName || ''}`.trim(),
      TEL: r.phone || '',
      RELATION: r.relationship || '',
    }));

    // Support new {{= VARIABLE}} syntax — maps to same contract data
    const newSyntaxMap: Record<string, string> = {
      // === Contract ===
      'CONTRACT.NUMBER': replacements['{contract_number}'],
      'CONTRACT.DATE': replacements['{contract_date}'],
      'CONTRACT.DATE_DAY': thaiDay,
      'CONTRACT.DATE_MONTH': thaiMonth,
      'CONTRACT.DATE_YEAR': thaiYear,
      'CONTRACT.TOTAL_AMOUNT': Number(contract.financedAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 }),
      'CONTRACT.TOTAL_AMOUNT_TEXT': this.numberToThaiText(Number(contract.financedAmount)),
      'CONTRACT.DOWN_PAYMENT': Number(contract.downPayment).toLocaleString('th-TH', { minimumFractionDigits: 2 }),
      'CONTRACT.SELLING_PRICE': Number(contract.sellingPrice).toLocaleString('th-TH', { minimumFractionDigits: 2 }),
      'CONTRACT.MONTHLY_PAYMENT': Number(contract.monthlyPayment).toLocaleString('th-TH', { minimumFractionDigits: 2 }),
      'CONTRACT.MONTHLY_PAYMENT_TEXT': this.numberToThaiText(Number(contract.monthlyPayment)),
      'CONTRACT.TOTAL_MONTHS': String(contract.totalMonths),
      'CONTRACT.TOTAL_MONTHS_TEXT': this.numberToThaiCountText(contract.totalMonths) + 'เดือน',
      'CONTRACT.INTEREST_RATE': replacements['{interest_rate}'],
      'CONTRACT.INTEREST_TOTAL': replacements['{interest_total}'],
      'CONTRACT.PAYMENT_DUE_DAY': firstPaymentDay,
      'CONTRACT.FIRST_PAYMENT_DATE': firstPaymentDue,
      'CONTRACT.LAST_PAYMENT_DATE': lastPaymentDue,
      'CONTRACT.PENALTY_RATE': cfg('contract_penalty_rate', '100'),
      'CONTRACT.WARRANTY_DAYS': cfg('contract_warranty_days', '30'),
      'CONTRACT.EARLY_DISCOUNT': cfg('contract_early_discount', '50'),
      'CONTRACT.MIN_MONTHS_EARLY': cfg('contract_min_months_early', '6'),
      'CONTRACT.NOTES': esc(contract.notes || ''),

      // === Company (configurable via Settings) ===
      'COMPANY.NAME_TH': esc(cfg('company_name_th', 'บริษัท เบสท์ช้อยส์โฟน จำกัด')),
      'COMPANY.NAME_EN': esc(cfg('company_name_en', 'BESTCHOICE PHONE Co.,Ltd.')),
      'COMPANY.TAX_ID': esc(cfg('company_tax_id', '0165568000050')),
      'COMPANY.ADDRESS': esc(cfg('company_address', 'เลขที่ 456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000')),
      'COMPANY.DIRECTOR': esc(cfg('company_director', 'เอกนรินทร์ คงเดช')),
      'COMPANY.DIRECTOR_ID': esc(cfg('company_director_id', '1-1601-00452-40-7')),
      'COMPANY.DIRECTOR_ADDRESS': esc(cfg('company_director_address', '517 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000')),

      // === Customer ===
      'CUSTOMER.NAME': replacements['{customer_name}'],
      'CUSTOMER.PREFIX': replacements['{customer_prefix}'],
      'CUSTOMER.IDCARD': replacements['{national_id}'],
      'CUSTOMER.IDCARD_FULL': replacements['{national_id_full}'],
      'CUSTOMER.BIRTHDATE': contract.customer?.birthdate ? formatDateLong(contract.customer.birthdate) : '-',
      'CUSTOMER.NICKNAME': esc(contract.customer?.nickname || '-'),
      'CUSTOMER.TEL': replacements['{customer_phone}'],
      'CUSTOMER.TEL_SECONDARY': replacements['{customer_phone_secondary}'],
      'CUSTOMER.EMAIL': esc(contract.customer?.email || '-'),
      'CUSTOMER.ADDRESS_ID': replacements['{customer_address_id_card}'],
      'CUSTOMER.ADDRESS_CONTACT': replacements['{customer_address_current}'],
      'CUSTOMER.ADDRESS_WORK': replacements['{customer_address_work}'],
      'CUSTOMER.LINE_ID': replacements['{customer_line_id}'],
      'CUSTOMER.FACEBOOK': replacements['{customer_facebook}'],
      'CUSTOMER.OCCUPATION': replacements['{customer_occupation}'],
      'CUSTOMER.OCCUPATION_DETAIL': esc(contract.customer?.occupationDetail || '-'),
      'CUSTOMER.SALARY': replacements['{customer_salary}'],
      'CUSTOMER.WORKPLACE': replacements['{customer_workplace}'],

      // === Phone ===
      'PHONE.NAME': esc(contract.product?.name || `${contract.product?.brand || ''} ${contract.product?.model || ''}`.trim()),
      'PHONE.BRAND': replacements['{brand}'],
      'PHONE.MODEL': replacements['{model}'],
      'PHONE.STORAGE': replacements['{product_storage}'],
      'PHONE.COLOR': replacements['{product_color}'],
      'PHONE.CONDITION': replacements['{product_category}'],
      'PHONE.IMEI': replacements['{imei}'],
      'PHONE.SERIAL': replacements['{serial_number}'],
      'PHONE.BATTERY_HEALTH': esc(contract.product?.batteryHealth ? `${contract.product.batteryHealth}%` : '-'),
      'PHONE.WARRANTY_EXPIRE': contract.product?.warrantyExpireDate ? formatDateMedium(contract.product.warrantyExpireDate) : '-',

      // === Branch / Staff ===
      'BRANCH.NAME': replacements['{branch_name}'],
      'BRANCH.ADDRESS': replacements['{branch_address}'],
      'BRANCH.PHONE': replacements['{branch_phone}'],
      'SALESPERSON.NAME': replacements['{salesperson_name}'],

      // === Aliases ===
      'CUSTOMER.FULLNAME': replacements['{customer_name}'],
    };

    // Handle date format pipes for new syntax (MUST run before general replacement)
    const contractDate2 = new Date(contract.createdAt);
    const startDate = payments.length > 0 ? new Date(payments[0].dueDate) : contractDate2;
    const endDate = payments.length > 0 ? new Date(payments[payments.length - 1].dueDate) : contractDate2;

    const dateMap: Record<string, Date> = {
      'CONTRACT.DATE': contractDate2,
      'CONTRACT.START_DATE': startDate,
      'CONTRACT.END_DATE': endDate,
    };

    // Apply date formatting for {{= VAR | date:X }}
    result = result.replace(/\{\{=\s*(CONTRACT\.\w+)\s*\|\s*date:(\w+)\s*\}\}/g, (_match, key: string, fmt: string) => {
      const d = dateMap[key];
      if (!d) return newSyntaxMap[key] ?? _match;
      switch (fmt) {
        case 's': return formatDateShort(d);
        case 'm': return formatDateMedium(d);
        case 'l': return formatDateLong(d);
        default: return newSyntaxMap[key] ?? _match;
      }
    });

    // Handle {{= VAR | num:2 }} for numeric formatting
    result = result.replace(/\{\{=\s*([A-Z_][A-Z0-9_.]*)\s*\|\s*num(?::(\d+))?\s*\}\}/g, (_match, key: string, decimals: string) => {
      const val = newSyntaxMap[key];
      if (!val) return _match;
      const n = parseFloat(val.replace(/,/g, ''));
      if (isNaN(n)) return val;
      const dec = decimals ? parseInt(decimals) : 0;
      return n.toLocaleString('th-TH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    });

    // Handle EMERGENCY_CONTACTS block rendering
    if (result.includes('EMERGENCY_CONTACTS')) {
      // Handle {{for CONTACT in EMERGENCY_CONTACTS}}...{{/for}} loop syntax
      result = result.replace(
        /\{\{for\s+(\w+)\s+in\s+EMERGENCY_CONTACTS\s*\}\}([\s\S]*?)\{\{\/for\}\}/g,
        (_match, itemVar: string, bodyTemplate: string) => {
          if (emergencyContacts.length === 0) return '';
          return emergencyContacts.map((c, i) => {
            let row = bodyTemplate;
            row = row.replace(new RegExp(`\\{\\{=\\s*@index1\\s*\\}\\}`, 'g'), String(i + 1));
            row = row.replace(new RegExp(`\\{\\{=\\s*@index\\s*\\}\\}`, 'g'), String(i));
            row = row.replace(new RegExp(`\\{\\{=\\s*${itemVar}\\.NAME\\s*\\}\\}`, 'g'), esc(c.NAME));
            row = row.replace(new RegExp(`\\{\\{=\\s*${itemVar}\\.TEL\\s*\\}\\}`, 'g'), esc(c.TEL));
            row = row.replace(new RegExp(`\\{\\{=\\s*${itemVar}\\.RELATION\\s*\\}\\}`, 'g'), esc(c.RELATION));
            return row;
          }).join('');
        },
      );
      // Fallback: handle {{= EMERGENCY_CONTACTS}} as a single block replacement
      const contactsHtml = emergencyContacts.map((c, i) =>
        `<tr><td style="padding:2px 8px 2px 0;width:24px">${i + 1}.</td><td style="padding:2px 8px">ชื่อ-นามสกุล ${esc(c.NAME)}</td><td style="padding:2px 8px">เบอร์โทร ${esc(c.TEL)}</td><td style="padding:2px 8px">ความสัมพันธ์ ${esc(c.RELATION)}</td></tr>`
      ).join('');
      const contactsTable = `<table style="width:100%;border-collapse:collapse;margin-left:2em"><tbody>${contactsHtml}</tbody></table>`;
      result = result.replace(/\{\{=\s*EMERGENCY_CONTACTS\s*\}\}/g, contactsTable);
    }

    // Handle INSTALLMENTS block rendering
    if (result.includes('INSTALLMENTS')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const installmentsRows = payments.map((p: any) => {
        const dateStr = formatDateMedium(p.dueDate);
        return `<tr><td style="text-align:center;padding:4px 12px;border:1px solid #9ca3af">${p.installmentNo}</td><td style="text-align:center;padding:4px 12px;border:1px solid #9ca3af">${dateStr}</td><td style="text-align:right;padding:4px 12px;border:1px solid #9ca3af">${Number(p.amountDue).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`;
      }).join('');
      // Match PaymentTable.tsx: 75% width, centered, border-gray-400, matching column headers
      const installmentsTable = `<table style="width:75%;margin:12px auto;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f9fafb"><th style="padding:6px 12px;border:1px solid #9ca3af;text-align:center;width:64px">งวดที่</th><th style="padding:6px 12px;border:1px solid #9ca3af;text-align:center">วันที่ครบกำหนดชำระ</th><th style="padding:6px 12px;border:1px solid #9ca3af;text-align:right;width:112px">จำนวนเงิน</th></tr></thead><tbody>${installmentsRows}</tbody></table>`;
      result = result.replace(/\{\{=\s*INSTALLMENTS\s*\}\}/g, installmentsTable);
    }

    // Replace remaining {{= KEY}} patterns (general catch-all, runs AFTER format-specific replacements)
    result = result.replace(/\{\{=\s*([A-Z_][A-Z0-9_.]*)\s*(?:\|\s*[^}]*)?\s*\}\}/g, (_match, key: string) => {
      return newSyntaxMap[key] ?? _match;
    });

    // Post-process: fill empty signature names for templates that lack variables in signature section
    const sigStaffName = esc(contract.salesperson?.name || 'เอกนรินทร์ คงเดช');
    const sigCustomerName = esc(contract.customer?.name || '');
    const sigWitness1Name = witness1Sig?.signerName ? esc(witness1Sig.signerName) : '';
    const sigWitness2Name = witness2Sig?.signerName ? esc(witness2Sig.signerName) : '';

    // Match: "ลงชื่อ...ผู้ให้เช่าซื้อ" followed (within nearby HTML) by "(" whitespace-only ")"
    result = result.replace(
      /(ลงชื่อ[\s\S]{0,200}?ผู้ให้เช่าซื้อ[\s\S]{0,300}?)\(\s{0,50}\)/,
      `$1( ${sigStaffName} )`,
    );
    result = result.replace(
      /(ลงชื่อ[\s\S]{0,200}?ผู้เช่าซื้อ[\s\S]{0,300}?)\(\s{0,50}\)/,
      `$1( ${sigCustomerName} )`,
    );

    // Fill witness names in parentheses near "พยาน" text
    if (sigWitness1Name) {
      result = result.replace(
        /(ลงชื่อ[\s\S]{0,200}?พยาน[\s\S]{0,300}?)\(\s{0,50}\)/,
        `$1( ${sigWitness1Name} )`,
      );
    }
    if (sigWitness2Name) {
      // Match the second occurrence of witness pattern
      let witnessCount = 0;
      result = result.replace(
        /(ลงชื่อ[\s\S]{0,200}?พยาน[\s\S]{0,300}?)\(\s{0,50}\)/g,
        (match, p1) => {
          witnessCount++;
          if (witnessCount === 2) return `${p1}( ${sigWitness2Name} )`;
          return match;
        },
      );
    }

    // Post-process: inject real signature images for templates that lack placeholders
    // Replaces the dots between "ลงชื่อ" and role text with the signature image
    const hadStaffPlaceholder = html.includes('{staff_signature}');
    const hadCustomerPlaceholder = html.includes('{customer_signature}');
    const hadWitness1Placeholder = html.includes('{witness1_signature}');
    const hadWitness2Placeholder = html.includes('{witness2_signature}');
    const sigImgStyle = 'max-height:50px;display:block;margin:0 auto';

    // Signature image injection style — inline image replaces dots
    const sigInlineImg = (src: string) => `<img src="${src}" style="${sigImgStyle};display:inline-block;vertical-align:middle"/>`;

    if (staffSigSafe && !hadStaffPlaceholder) {
      result = result.replace(
        /(ลงชื่อ)[.…]{3,}(ผู้ให้เช่าซื้อ)/,
        `$1 ${sigInlineImg(staffSig.signatureImage)} $2`,
      );
    }
    if (customerSigSafe && !hadCustomerPlaceholder) {
      result = result.replace(
        /(ลงชื่อ)[.…]{3,}(ผู้เช่าซื้อ)/,
        `$1 ${sigInlineImg(customerSig.signatureImage)} $2`,
      );
    }
    // Inject witness signatures into "ลงชื่อ...พยาน" patterns
    if (witness1SigSafe && !hadWitness1Placeholder) {
      result = result.replace(
        /(ลงชื่อ)[.…]{3,}(พยาน)/,
        `$1 ${sigInlineImg(witness1Sig.signatureImage)} $2`,
      );
    }
    if (witness2SigSafe && !hadWitness2Placeholder) {
      // Match the second "ลงชื่อ...พยาน" pattern
      let witnessImgCount = 0;
      result = result.replace(
        /(ลงชื่อ)[.…]{3,}(พยาน)/g,
        (match, p1, p2) => {
          witnessImgCount++;
          if (witnessImgCount === (witness1SigSafe && !hadWitness1Placeholder ? 1 : 2)) {
            return `${p1} ${sigInlineImg(witness2Sig.signatureImage)} ${p2}`;
          }
          return match;
        },
      );
    }

    return result;
  }

  private getDefaultTemplate(documentType: string): string {
    if (documentType === 'CONTRACT') {
      // Try to load the full hire-purchase contract template from file
      try {
        const templatePath = path.join(__dirname, 'templates', 'hire-purchase-contract.html');
        if (fs.existsSync(templatePath)) {
          return fs.readFileSync(templatePath, 'utf-8');
        }
      } catch {
        this.logger.warn('Failed to read hire-purchase-contract.html, using inline fallback');
      }
      // Fallback: inline default template (simplified version of hire-purchase-contract.html)
      return `
<div>
  <h1 style="text-align:center;margin:0 0 4px">สัญญาผ่อนชำระ</h1>
  <p style="text-align:center;margin:0 0 2px">เลขที่สัญญา: <strong>{contract_number}</strong></p>
  <p style="text-align:center;margin:0 0 16px;color:#666">สาขา: {branch_name} | วันที่: {contract_date}</p>
  <hr style="border:none;border-top:1px solid #ccc;margin:0 0 16px"/>

  <div class="no-break">
    <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">ผู้ให้เช่าซื้อ</h3>
    <table style="width:100%;margin-bottom:12px;font-size:13px">
      <tr><td style="width:160px;color:#666">บริษัท</td><td><strong>{company_name}</strong></td></tr>
      <tr><td style="color:#666">ผู้มีอำนาจ</td><td>{company_director_name}</td></tr>
      <tr><td style="color:#666">เลขประจำตัวผู้เสียภาษี</td><td>{company_tax_id}</td></tr>
    </table>
  </div>

  <div class="no-break">
    <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">ข้อมูลลูกค้า</h3>
    <table style="width:100%;margin-bottom:12px;font-size:13px">
      <tr><td style="width:120px;color:#666">ชื่อ-นามสกุล</td><td><strong>{customer_name}</strong></td></tr>
      <tr><td style="color:#666">เลขบัตร ปชช.</td><td>{national_id_full}</td></tr>
      <tr><td style="color:#666">เบอร์โทร</td><td>{customer_phone}</td></tr>
      <tr><td style="color:#666">ที่อยู่ (บัตร)</td><td>{customer_address_id_card}</td></tr>
      <tr><td style="color:#666">ที่อยู่ปัจจุบัน</td><td>{customer_address_current}</td></tr>
      <tr><td style="color:#666">อาชีพ</td><td>{customer_occupation}</td></tr>
      <tr><td style="color:#666">ที่ทำงาน</td><td>{customer_workplace}</td></tr>
    </table>
  </div>

  <div class="no-break">
    <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">บุคคลอ้างอิง</h3>
    <div style="margin-bottom:12px;font-size:13px">{customer_references}</div>
  </div>

  <div class="no-break">
    <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">ข้อมูลสินค้า</h3>
    <table style="width:100%;margin-bottom:12px;font-size:13px">
      <tr><td style="width:120px;color:#666">สินค้า</td><td><strong>{brand} {model}</strong></td></tr>
      <tr><td style="color:#666">ประเภท</td><td>{product_category}</td></tr>
      <tr><td style="color:#666">สี</td><td>{product_color}</td></tr>
      <tr><td style="color:#666">ความจุ</td><td>{product_storage}</td></tr>
      <tr><td style="color:#666">IMEI</td><td>{imei}</td></tr>
      <tr><td style="color:#666">S/N</td><td>{serial_number}</td></tr>
    </table>
  </div>

  <div class="no-break">
    <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">เงื่อนไขการผ่อนชำระ</h3>
    <table style="width:100%;margin-bottom:16px;font-size:13px">
      <tr><td style="width:160px;color:#666">ราคาขาย</td><td><strong>{selling_price} บาท</strong></td></tr>
      <tr><td style="color:#666">เงินดาวน์</td><td>{down_payment} บาท</td></tr>
      <tr><td style="color:#666">ยอดผ่อน</td><td><strong>{financed_amount} บาท</strong> ({financed_amount_text})</td></tr>
      <tr><td style="color:#666">อัตราดอกเบี้ย</td><td>{interest_rate}</td></tr>
      <tr><td style="color:#666">จำนวนงวด</td><td>{total_months} เดือน ({total_months_text})</td></tr>
      <tr><td style="color:#666">ค่างวดต่อเดือน</td><td><strong>{monthly_payment} บาท</strong></td></tr>
      <tr><td style="color:#666">ดอกเบี้ยรวม</td><td>{interest_total} บาท</td></tr>
      <tr><td style="color:#666">งวดแรก</td><td>{first_payment_due}</td></tr>
      <tr><td style="color:#666">งวดสุดท้าย</td><td>{last_payment_due}</td></tr>
    </table>
  </div>

  <!-- PAGE_BREAK -->

  <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">ตารางผ่อนชำระ</h3>
  {payment_schedule_table}

  <div class="no-break" style="margin-top:40px">
    <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">ลงนาม</h3>
    <div style="display:flex;justify-content:space-around;margin-top:20px">
      <div style="text-align:center">
        <p style="margin:0;font-size:13px">ลงชื่อ {staff_signature} ผู้ให้เช่าซื้อ</p>
        <p style="margin:4px 0 0;font-size:13px">({salesperson_name})</p>
      </div>
      <div style="text-align:center">
        <p style="margin:0;font-size:13px">ลงชื่อ {customer_signature} ผู้เช่าซื้อ</p>
        <p style="margin:4px 0 0;font-size:13px">({customer_name})</p>
      </div>
    </div>
    <div style="display:flex;justify-content:space-around;margin-top:30px">
      <div style="text-align:center">
        <p style="margin:0;font-size:13px">ลงชื่อ {witness1_signature} พยาน</p>
        <p style="margin:4px 0 0;font-size:13px">({witness1_name})</p>
      </div>
      <div style="text-align:center">
        <p style="margin:0;font-size:13px">ลงชื่อ {witness2_signature} พยาน</p>
        <p style="margin:4px 0 0;font-size:13px">({witness2_name})</p>
      </div>
    </div>
  </div>

  <!-- PAGE_BREAK -->

  <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">รูปถ่ายโทรศัพท์</h3>
  {device_photos_grid}
  <div style="margin-top:20px">
    <p style="font-size:13px">ชื่อ ........................................................... ผู้เช่าซื้อ วันที่ .............. เดือน .............................. พ.ศ ....................</p>
  </div>
</div>`;
    }
    if (documentType === 'PDPA_CONSENT') {
      return `
<div>
  <h1 style="text-align:center;margin:0 0 4px;font-size:18px">หนังสือยินยอมให้เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคล</h1>
  <p style="text-align:center;margin:0 0 2px;font-size:13px;color:#666">ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)</p>
  <p style="text-align:center;margin:0 0 16px;font-size:13px;color:#666">สัญญาเลขที่: <strong>{contract_number}</strong> | วันที่: {contract_date}</p>
  <hr style="border:none;border-top:1px solid #ccc;margin:0 0 16px"/>

  <div style="margin-bottom:16px;font-size:14px;line-height:1.8">
    <p style="text-indent:2em;margin:0 0 8px">ข้าพเจ้า <strong>{customer_name}</strong> เลขบัตรประชาชน <strong>{national_id}</strong></p>
    <p style="text-indent:2em;margin:0 0 8px">ที่อยู่ {customer_address}</p>
    <p style="text-indent:2em;margin:0 0 8px">เบอร์โทรศัพท์ {customer_phone}</p>
  </div>

  <div style="margin-bottom:16px;font-size:14px;line-height:1.8">
    <p style="text-indent:2em;margin:0 0 8px">ได้อ่านและเข้าใจประกาศความเป็นส่วนตัว (Privacy Notice) ของ <strong>บริษัท เบสท์ช้อยส์โฟน จำกัด</strong> แล้ว จึงให้ความยินยอมในการเก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของข้าพเจ้า ตามวัตถุประสงค์ดังต่อไปนี้:</p>
  </div>

  <div style="margin-bottom:16px;font-size:13px;line-height:1.8">
    <p style="font-weight:bold;margin:0 0 8px">วัตถุประสงค์ในการเก็บรวบรวมและใช้ข้อมูล:</p>
    <ol style="margin:0 0 12px;padding-left:2em">
      <li>เพื่อการทำสัญญาผ่อนชำระสินค้า และการบริหารจัดการสัญญา</li>
      <li>เพื่อการติดตามหนี้ การเรียกเก็บเงินค่าผ่อนชำระ และการบังคับตามสัญญา</li>
      <li>เพื่อการจัดทำเอกสารทางกฎหมายที่เกี่ยวข้อง</li>
      <li>เพื่อการติดต่อสื่อสารเกี่ยวกับสัญญา รวมถึงการแจ้งเตือนกำหนดชำระ</li>
      <li>เพื่อการตรวจสอบตัวตนและการยืนยันข้อมูล (KYC)</li>
    </ol>

    <p style="font-weight:bold;margin:0 0 8px">ข้อมูลส่วนบุคคลที่เก็บรวบรวม:</p>
    <ul style="margin:0 0 12px;padding-left:2em">
      <li>ชื่อ-นามสกุล, คำนำหน้าชื่อ, วันเดือนปีเกิด</li>
      <li>เลขบัตรประชาชน, สำเนาบัตรประชาชน</li>
      <li>ที่อยู่ตามบัตรประชาชน, ที่อยู่ปัจจุบัน, ที่อยู่ที่ทำงาน</li>
      <li>หมายเลขโทรศัพท์, อีเมล, LINE ID, บัญชี Facebook</li>
      <li>ข้อมูลอาชีพ, สถานที่ทำงาน, รายได้</li>
      <li>ข้อมูลบุคคลอ้างอิง/ผู้ค้ำประกัน</li>
      <li>รูปถ่ายลูกค้าถือบัตรประชาชน (KYC Selfie)</li>
      <li>ข้อมูลสินค้า (IMEI, Serial Number)</li>
      <li>ลายมือชื่ออิเล็กทรอนิกส์</li>
    </ul>

    <p style="font-weight:bold;margin:0 0 8px">การเปิดเผยข้อมูล:</p>
    <p style="text-indent:2em;margin:0 0 12px">บริษัทอาจเปิดเผยข้อมูลส่วนบุคคลของท่านให้แก่บุคคลหรือหน่วยงานดังต่อไปนี้ เท่าที่จำเป็น:</p>
    <ul style="margin:0 0 12px;padding-left:2em">
      <li>พนักงานของบริษัทที่เกี่ยวข้องกับการบริหารสัญญา</li>
      <li>หน่วยงานบังคับใช้กฎหมาย หากมีคำสั่งศาลหรือกฎหมายกำหนด</li>
      <li>สำนักงานทนายความ ในกรณีดำเนินคดีตามกฎหมาย</li>
    </ul>

    <p style="font-weight:bold;margin:0 0 8px">ระยะเวลาการเก็บรักษาข้อมูล:</p>
    <p style="text-indent:2em;margin:0 0 12px">ตลอดอายุสัญญา และ 5 ปีภายหลังสิ้นสุดสัญญา (ตามอายุความทางกฎหมาย)</p>

    <p style="font-weight:bold;margin:0 0 8px">สิทธิของเจ้าของข้อมูล:</p>
    <p style="text-indent:2em;margin:0 0 12px">ท่านมีสิทธิเข้าถึง แก้ไข ลบ ระงับการใช้ ขอรับสำเนาข้อมูล หรือถอนความยินยอมได้ทุกเมื่อ โดยติดต่อบริษัทที่สาขา {branch_name} หรือโทร {branch_phone}</p>
  </div>

  <div style="margin-top:8px;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:13px;background:#f9fafb">
    <p style="margin:0 0 4px"><strong>ข้าพเจ้ายินยอม</strong> ให้บริษัท เบสท์ช้อยส์โฟน จำกัด เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของข้าพเจ้าตามวัตถุประสงค์ที่ระบุข้างต้น</p>
  </div>

  <div class="no-break" style="margin-top:30px">
    <div style="display:flex;justify-content:space-around;margin-top:20px">
      <div style="text-align:center">
        <p style="margin:0;font-size:13px">ลงชื่อ {pdpa_signature} ผู้ให้ความยินยอม</p>
        <p style="margin:4px 0 0;font-size:13px">({customer_name})</p>
        <p style="margin:2px 0 0;font-size:11px;color:#666">วันที่ {pdpa_consent_date}</p>
      </div>
      <div style="text-align:center">
        <p style="margin:0;font-size:13px">ลงชื่อ {staff_signature} ผู้รับความยินยอม</p>
        <p style="margin:4px 0 0;font-size:13px">({salesperson_name})</p>
      </div>
    </div>
  </div>
</div>`;
    }
    return '<div>{contract_number}</div>';
  }

  // ─── PDF Generation (Puppeteer) ──────────────────────
  private async htmlToPdf(html: string, contractNumber?: string): Promise<Buffer> {
    // Dynamic import — uses puppeteer-core with system Chromium
    const puppeteer = await import('puppeteer-core');
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });

      // Embed TH Sarabun PSK fonts as base64 so Puppeteer can render them
      // (relative /fonts/ URLs don't resolve in setContent context)
      let fontCss = '';
      try {
        // Try multiple font paths (dev: src/../public, prod: dist/../public)
        const fontPaths = [
          path.join(process.cwd(), 'public', 'fonts'),
          path.join(__dirname, '..', '..', '..', '..', 'public', 'fonts'),
          path.join(process.cwd(), '..', 'web', 'public', 'fonts'),
        ];
        const fontsDir = fontPaths.find(p => fs.existsSync(path.join(p, 'THSarabunPSK-Regular.ttf'))) || fontPaths[0];
        this.logger.log(`Font directory: ${fontsDir} (exists: ${fs.existsSync(fontsDir)})`);
        const regularPath = path.join(fontsDir, 'THSarabunPSK-Regular.ttf');
        const boldPath = path.join(fontsDir, 'THSarabunPSK-Bold.ttf');
        if (fs.existsSync(regularPath)) {
          const regularB64 = fs.readFileSync(regularPath).toString('base64');
          fontCss += `@font-face { font-family: 'TH Sarabun PSK'; src: url(data:font/truetype;base64,${regularB64}) format('truetype'); font-weight: 400; font-style: normal; }`;
        }
        if (fs.existsSync(boldPath)) {
          const boldB64 = fs.readFileSync(boldPath).toString('base64');
          fontCss += `@font-face { font-family: 'TH Sarabun PSK'; src: url(data:font/truetype;base64,${boldB64}) format('truetype'); font-weight: 700; font-style: normal; }`;
        }
      } catch (err) {
        this.logger.warn('Could not embed TH Sarabun PSK fonts', err instanceof Error ? err.message : err);
      }

      // Embed fonts + reset screen-mode CSS for clean PDF output
      await page.addStyleTag({
        content: `${fontCss}
          body { background: #fff !important; padding: 0 !important; margin: 0 !important; }
          .a4-page { box-shadow: none !important; margin: 0 !important; min-height: auto !important; padding: 0 !important; width: 100% !important; }
          .a4-page + .a4-page { page-break-before: always !important; break-before: page !important; }
          html, body, div, p, td, th, span, strong, u, h1, h2, h3 { font-family: 'TH Sarabun PSK', sans-serif !important; }
        `,
      });

      const footerLeft = this.escapeHtml(`สัญญาเช่าซื้อเลขที่ ${contractNumber || ''}`);
      // Build footer with embedded font
      const footerFontCss = fontCss ? `<style>${fontCss}</style>` : '';
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '19mm', bottom: '20mm', left: '19mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `${footerFontCss}<div style="width:100%;padding:0 19mm;font-family:'TH Sarabun PSK',sans-serif;font-size:16px;color:#000;display:flex;justify-content:space-between;align-items:center"><span>${footerLeft}</span><span>หน้าที่ <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ─── Document Download ───────────────────────────────
  async getDocumentStream(id: string): Promise<{ stream: import('stream').Readable; filename: string; contentType: string }> {
    const doc = await this.prisma.eDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');

    const isPdf = doc.fileUrl.endsWith('.pdf');
    const filename = doc.fileUrl.split('/').pop() || `${doc.documentType}_${doc.id}.${isPdf ? 'pdf' : 'html'}`;

    if (isPdf && this.storageService.configured) {
      const stream = await this.storageService.getStream(doc.fileUrl);
      return { stream, filename, contentType: 'application/pdf' };
    }

    // Fallback: return HTML content as stream
    const { Readable } = await import('stream');
    const htmlStream = Readable.from([doc.fileUrl]);
    return { stream: htmlStream, filename, contentType: 'text/html' };
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
