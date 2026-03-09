import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SignerType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/document.dto';
import * as crypto from 'crypto';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  // ─── Contract Templates ──────────────────────────────
  async findAllTemplates(type?: string) {
    const where: Record<string, unknown> = { isActive: true };
    if (type) where.type = type;
    return this.prisma.contractTemplate.findMany({ where, orderBy: { createdAt: 'desc' } });
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
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.contractTemplate.update({ where: { id }, data });
  }

  async deleteTemplate(id: string) {
    await this.findOneTemplate(id);
    return this.prisma.contractTemplate.update({ where: { id }, data: { isActive: false } });
  }

  // ─── E-Signature ──────────────────────────────────────
  async signContract(contractId: string, signatureImage: string, signerType: string, req: { ip?: string; userAgent?: string }) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { signatures: true },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    // Must be APPROVED before signing
    if (contract.workflowStatus !== 'APPROVED') {
      throw new BadRequestException('สัญญาต้องได้รับการอนุมัติก่อนจึงจะลงนามได้');
    }

    // Check if already signed by this signer type
    const existing = contract.signatures.find((s) => s.signerType === signerType);
    if (existing) throw new BadRequestException(`${signerType} ลงนามไปแล้ว`);

    return this.prisma.signature.create({
      data: {
        contractId,
        signerType: signerType as SignerType,
        signatureImage,
        ipAddress: req.ip || null,
        deviceInfo: req.userAgent || null,
      },
    });
  }

  async getSignatures(contractId: string) {
    return this.prisma.signature.findMany({
      where: { contractId },
      orderBy: { signedAt: 'asc' },
    });
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
        payments: { orderBy: { installmentNo: 'asc' } },
        signatures: true,
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    // Get template
    let htmlContent = '';
    if (templateId) {
      const template = await this.findOneTemplate(templateId);
      htmlContent = template.contentHtml;
    } else {
      // Find active template (single plan type: STORE_DIRECT)
      const template = await this.prisma.contractTemplate.findFirst({
        where: { type: 'STORE_DIRECT', isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      htmlContent = template?.contentHtml || this.getDefaultTemplate(documentType);
    }

    // Replace placeholders
    const renderedHtml = this.replacePlaceholders(htmlContent, contract);

    // Generate file hash
    const fileHash = crypto.createHash('sha256').update(renderedHtml).digest('hex');

    // Store as HTML document (production would use Puppeteer for PDF)
    const fileUrl = `documents/${contract.contractNumber}_${documentType}_${Date.now()}.html`;

    const doc = await this.prisma.eDocument.create({
      data: {
        contractId,
        documentType,
        fileUrl,
        fileHash,
        createdById,
      },
    });

    return { ...doc, renderedHtml };
  }

  async getDocuments(contractId: string) {
    return this.prisma.eDocument.findMany({
      where: { contractId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDocument(id: string) {
    const doc = await this.prisma.eDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    return doc;
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
        payments: { orderBy: { installmentNo: 'asc' } },
        signatures: true,
      },
    });
    if (!contract || contract.deletedAt) throw new NotFoundException('ไม่พบสัญญา');

    let htmlContent = '';
    if (templateId) {
      const template = await this.findOneTemplate(templateId);
      htmlContent = template.contentHtml;
    } else {
      const template = await this.prisma.contractTemplate.findFirst({
        where: { type: 'STORE_DIRECT', isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      htmlContent = template?.contentHtml || this.getDefaultTemplate('CONTRACT');
    }

    return { html: this.replacePlaceholders(htmlContent, contract) };
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
    const matches = html.match(/\{[a-z_]+\}/g) || [];
    return [...new Set(matches)];
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

  /** Mask national ID: show first 1 and last 4 digits only */
  private maskNationalId(id: string): string {
    if (!id || id.length < 5) return id;
    return id[0] + '-xxxx-xxxxx-' + id.slice(-4);
  }

  /** Validate that a data URL is a safe image format */
  private isSafeImageDataUrl(url: string): boolean {
    return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(url);
  }

  private replacePlaceholders(html: string, contract: any): string {
    const esc = this.escapeHtml.bind(this);

    const payments = contract.payments || [];
    const paymentScheduleRows = payments
      .map(
        (p: any) =>
          `<tr><td style="text-align:center">${p.installmentNo}</td><td style="text-align:center">${esc(new Date(p.dueDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }))}</td><td style="text-align:right">${Number(p.amountDue).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`,
      )
      .join('');

    const customerSig = contract.signatures?.find((s: any) => s.signerType === 'CUSTOMER');
    const staffSig = contract.signatures?.find((s: any) => s.signerType === 'STAFF');

    // Validate signature images are safe data URLs before embedding
    const customerSigSafe = customerSig && this.isSafeImageDataUrl(customerSig.signatureImage);
    const staffSigSafe = staffSig && this.isSafeImageDataUrl(staffSig.signatureImage);

    // Format contract date in Thai
    const contractDate = new Date(contract.createdAt);
    const thaiDate = contractDate.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const thaiDay = contractDate.toLocaleDateString('th-TH', { day: 'numeric' });
    const thaiMonth = contractDate.toLocaleDateString('th-TH', { month: 'long' });
    const thaiYear = contractDate.toLocaleDateString('th-TH', { year: 'numeric' }).replace(/[^\d]/g, '');

    // Build guarantor/references rows
    const references: any[] = contract.customer?.references || [];
    const referencesHtml = references.map((r: any, i: number) =>
      `<tr><td>${i + 1}</td><td>${esc(r.prefix || '')}${esc(r.firstName || '')} ${esc(r.lastName || '')}</td><td>${esc(r.phone || '')}</td><td>${esc(r.relationship || '')}</td></tr>`
    ).join('');

    // Compute first and last payment dates
    const firstPayment = payments.length > 0 ? new Date(payments[0].dueDate) : contractDate;
    const lastPayment = payments.length > 0 ? new Date(payments[payments.length - 1].dueDate) : contractDate;
    const firstPaymentDue = firstPayment.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
    const firstPaymentDay = firstPayment.toLocaleDateString('th-TH', { day: 'numeric' });
    const firstPaymentMonth = firstPayment.toLocaleDateString('th-TH', { month: 'long' });
    const firstPaymentYear = firstPayment.toLocaleDateString('th-TH', { year: 'numeric' }).replace(/[^\d]/g, '');
    const lastPaymentDue = lastPayment.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });

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
      '{customer_address}': esc(contract.customer?.addressCurrent || contract.customer?.addressIdCard || ''),
      '{customer_address_id_card}': esc(contract.customer?.addressIdCard || ''),
      '{customer_address_current}': esc(contract.customer?.addressCurrent || ''),
      '{customer_zipcode}': esc(contract.customer?.zipcode || contract.customer?.postalCode || ''),
      '{customer_line_id}': esc(contract.customer?.lineId || '-'),
      '{customer_facebook}': esc(contract.customer?.facebookLink || contract.customer?.facebookName || '-'),
      '{customer_occupation}': esc(contract.customer?.occupation || '-'),
      '{customer_salary}': contract.customer?.salary ? Number(contract.customer.salary).toLocaleString() : '-',
      '{customer_workplace}': esc(contract.customer?.workplace || '-'),
      '{customer_address_work}': esc(contract.customer?.addressWork || '-'),
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
      '{monthly_payment}': Number(contract.monthlyPayment).toLocaleString(),
      '{total_months}': String(contract.totalMonths),
      '{interest_rate}': `${(Number(contract.interestRate) * 100).toFixed(1)}%`,
      '{interest_total}': Number(contract.interestTotal).toLocaleString(),
      '{financed_amount}': Number(contract.financedAmount).toLocaleString(),
      '{first_payment_due}': firstPaymentDue,
      '{first_payment_day}': firstPaymentDay,
      '{first_payment_month}': firstPaymentMonth,
      '{first_payment_year}': firstPaymentYear,
      '{last_payment_due}': lastPaymentDue,
      '{branch_name}': esc(contract.branch?.name || ''),
      '{branch_address}': esc(contract.branch?.location || ''),
      '{branch_phone}': esc(contract.branch?.phone || ''),
      '{salesperson_name}': esc(contract.salesperson?.name || ''),
      '{date}': new Date().toLocaleDateString('th-TH'),
      '{payment_schedule_table}': `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;margin:10px auto"><thead><tr style="background:#f5f5f5"><th style="text-align:center">งวดที่</th><th style="text-align:center">วันที่ครบกำหนดชำระ</th><th style="text-align:center">จำนวนเงิน</th></tr></thead><tbody>${paymentScheduleRows}</tbody></table>`,
      '{customer_signature}': customerSigSafe ? `<img src="${customerSig.signatureImage}" style="max-height:60px"/>` : '<div style="border-bottom:1px solid #000;width:200px;height:60px"></div>',
      '{staff_signature}': staffSigSafe ? `<img src="${staffSig.signatureImage}" style="max-height:60px"/>` : '<div style="border-bottom:1px solid #000;width:200px;height:60px"></div>',
    };

    let result = html;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    return result;
  }

  private getDefaultTemplate(documentType: string): string {
    if (documentType === 'CONTRACT') {
      return `
        <div style="font-family:'Sarabun',sans-serif;max-width:800px;margin:0 auto;padding:20px">
          <h1 style="text-align:center">สัญญาผ่อนชำระ</h1>
          <p style="text-align:center">เลขที่สัญญา: <strong>{contract_number}</strong></p>
          <p style="text-align:center">สาขา: {branch_name} | วันที่: {date}</p>
          <hr/>
          <h3>ข้อมูลลูกค้า</h3>
          <p>ชื่อ: {customer_name}<br/>เลขบัตร ปชช.: {national_id}<br/>เบอร์โทร: {customer_phone}<br/>ที่อยู่: {customer_address}</p>
          <h3>ข้อมูลสินค้า</h3>
          <p>สินค้า: {brand} {model}<br/>IMEI: {imei}<br/>S/N: {serial_number}</p>
          <h3>เงื่อนไขการผ่อนชำระ</h3>
          <table style="width:100%">
            <tr><td>ราคาขาย</td><td><strong>{selling_price} บาท</strong></td></tr>
            <tr><td>เงินดาวน์</td><td>{down_payment} บาท</td></tr>
            <tr><td>อัตราดอกเบี้ย</td><td>{interest_rate}</td></tr>
            <tr><td>จำนวนงวด</td><td>{total_months} เดือน</td></tr>
            <tr><td>ค่างวดต่อเดือน</td><td><strong>{monthly_payment} บาท</strong></td></tr>
            <tr><td>ดอกเบี้ยรวม</td><td>{interest_total} บาท</td></tr>
            <tr><td>ยอดผ่อนรวม</td><td>{financed_amount} บาท</td></tr>
          </table>
          <h3>ตารางผ่อนชำระ</h3>
          {payment_schedule_table}
          <div style="margin-top:40px;display:flex;justify-content:space-between">
            <div style="text-align:center"><p>ลงนามลูกค้า</p>{customer_signature}<p>{customer_name}</p></div>
            <div style="text-align:center"><p>ลงนามพนักงาน</p>{staff_signature}<p>{salesperson_name}</p></div>
          </div>
        </div>
      `;
    }
    return '<div>{contract_number}</div>';
  }
}
