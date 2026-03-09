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
        blocks: dto.blocks ?? [],
        settings: dto.settings ?? null,
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

    // Replace placeholders and wrap with A4 styling
    const renderedHtml = this.wrapWithA4Styles(this.replacePlaceholders(htmlContent, contract));

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

    const bodyHtml = this.replacePlaceholders(htmlContent, contract);
    return { html: this.wrapWithA4Styles(bodyHtml) };
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

  /** Validate that a data URL is a safe image format */
  private isSafeImageDataUrl(url: string): boolean {
    return /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(url);
  }

  /** Wrap rendered HTML with A4 page styles and page numbering */
  private wrapWithA4Styles(bodyHtml: string): string {
    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<style>
  @page {
    size: A4;
    margin: 20mm 18mm 25mm 18mm;
    @bottom-center {
      content: counter(page) "/" counter(pages);
      font-size: 10px;
      color: #999;
      font-family: 'Sarabun', sans-serif;
    }
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Sarabun', 'Noto Sans Thai', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #222;
  }
  .a4-page {
    width: 170mm;
    min-height: 250mm;
    margin: 0 auto;
    padding: 0;
  }
  table { border-collapse: collapse; }
  /* Page break helpers that templates can use */
  .page-break { page-break-after: always; break-after: page; }
  .no-break { page-break-inside: avoid; break-inside: avoid; }
  /* Print styles */
  @media print {
    body { margin: 0; padding: 0; }
    .a4-page { width: 100%; min-height: auto; }
  }
  /* Screen preview: simulate A4 pages */
  @media screen {
    body { background: #e5e7eb; padding: 20px 0; }
    .a4-page {
      background: #fff;
      width: 210mm;
      min-height: 297mm;
      padding: 20mm 18mm 25mm 18mm;
      margin: 0 auto 20px auto;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
  }
</style>
</head>
<body>
<div class="a4-page">
${bodyHtml}
</div>
</body>
</html>`;
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

    // Build guarantor/references as numbered list (matching contract format)
    const references: any[] = contract.customer?.references || [];
    const referencesHtml = references.map((r: any, i: number) =>
      `<p style="margin-left:3em">${i + 1}. ชื่อ-นามสกุล <u>&nbsp;&nbsp;${esc(r.prefix || '')}${esc(r.firstName || '')} ${esc(r.lastName || '')}&nbsp;&nbsp;</u> เบอร์โทรศัพท์ <u>&nbsp;&nbsp;${esc(r.phone || '')}&nbsp;&nbsp;</u> ความสัมพันธ์ <u>&nbsp;&nbsp;${esc(r.relationship || '')}&nbsp;&nbsp;</u></p>`
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
      '{date}': new Date().toLocaleDateString('th-TH'),
      '{payment_schedule_table}': `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;margin:10px auto"><thead><tr style="background:#f5f5f5"><th style="text-align:center">งวดที่</th><th style="text-align:center">วันที่ครบกำหนดชำระ</th><th style="text-align:center">จำนวนเงิน</th></tr></thead><tbody>${paymentScheduleRows}</tbody></table>`,
      '{customer_signature}': customerSigSafe ? `<img src="${customerSig.signatureImage}" style="max-height:60px"/>` : '<div style="border-bottom:1px solid #000;width:200px;height:60px"></div>',
      '{staff_signature}': staffSigSafe ? `<img src="${staffSig.signatureImage}" style="max-height:60px"/>` : '<div style="border-bottom:1px solid #000;width:200px;height:60px"></div>',
    };

    let result = html;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    // Support new {{= VARIABLE}} syntax — maps to same contract data
    const newSyntaxMap: Record<string, string> = {
      'CONTRACT.NUMBER': replacements['{contract_number}'],
      'CONTRACT.DATE': replacements['{contract_date}'],
      'CUSTOMER.NAME': replacements['{customer_name}'],
      'CUSTOMER.IDCARD': replacements['{national_id}'],
      'CUSTOMER.TEL': replacements['{customer_phone}'],
      'CUSTOMER.ADDRESS_ID': replacements['{customer_address_id_card}'],
      'CUSTOMER.ADDRESS_CONTACT': replacements['{customer_address_current}'],
      'CUSTOMER.LINE_ID': replacements['{customer_line_id}'],
      'CUSTOMER.FACEBOOK': replacements['{customer_facebook}'],
      'CUSTOMER.OCCUPATION': replacements['{customer_occupation}'],
      'CUSTOMER.SALARY': replacements['{customer_salary}'],
      'CUSTOMER.WORKPLACE': replacements['{customer_workplace}'],
      'PHONE.BRAND': replacements['{brand}'],
      'PHONE.MODEL': replacements['{model}'],
      'PHONE.STORAGE': replacements['{product_storage}'],
      'PHONE.COLOR': replacements['{product_color}'],
      'PHONE.CONDITION': replacements['{product_category}'],
      'PHONE.IMEI': replacements['{imei}'],
      'PHONE.SERIAL': replacements['{serial_number}'],
      'COMPANY.NAME_TH': esc('บริษัท เบสท์ช้อยส์โฟน จำกัด'),
      'COMPANY.NAME_EN': esc('BESTCHOICEPHONE Co., Ltd.'),
      'COMPANY.TAX_ID': esc('0165568000050'),
      'COMPANY.ADDRESS': esc('456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000'),
      'COMPANY.DIRECTOR': esc('เอกนรินทร์ คงเดช'),
      'COMPANY.DIRECTOR_ID': esc('1-1601-00452-40-7'),
      'COMPANY.DIRECTOR_ADDRESS': esc('517 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000'),
      'CONTRACT.TOTAL_AMOUNT': Number(contract.financedAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 }),
      'CONTRACT.TOTAL_AMOUNT_TEXT': this.numberToThaiText(Number(contract.financedAmount)),
      'CONTRACT.DOWN_PAYMENT': Number(contract.downPayment).toLocaleString('th-TH', { minimumFractionDigits: 2 }),
      'CONTRACT.MONTHLY_PAYMENT': Number(contract.monthlyPayment).toLocaleString('th-TH', { minimumFractionDigits: 2 }),
      'CONTRACT.MONTHLY_PAYMENT_TEXT': this.numberToThaiText(Number(contract.monthlyPayment)),
      'CONTRACT.TOTAL_MONTHS': String(contract.totalMonths),
      'CONTRACT.PENALTY_RATE': '100',
      'CONTRACT.WARRANTY_DAYS': '30',
      'CONTRACT.EARLY_DISCOUNT': '50',
      'CONTRACT.MIN_MONTHS_EARLY': '6',
      'BRANCH.NAME': replacements['{branch_name}'],
      'BRANCH.ADDRESS': replacements['{branch_address}'],
      'BRANCH.PHONE': replacements['{branch_phone}'],
      'SALESPERSON.NAME': replacements['{salesperson_name}'],
    };

    // Replace {{= KEY}} patterns (with optional format pipe)
    result = result.replace(/\{\{=\s*([A-Z_][A-Z0-9_.]*)\s*(?:\|\s*[^}]*)?\s*\}\}/g, (_match, key: string) => {
      return newSyntaxMap[key] ?? _match;
    });

    // Handle date format pipes for new syntax
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
        case 's': return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`;
        case 'm': {
          const monthsShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
          return `${d.getDate()} ${monthsShort[d.getMonth()]} ${d.getFullYear() + 543}`;
        }
        case 'l': {
          const monthsFull = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
          return `${d.getDate()} เดือน ${monthsFull[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
        }
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

    return result;
  }

  private getDefaultTemplate(documentType: string): string {
    if (documentType === 'CONTRACT') {
      return `
<div>
  <h1 style="text-align:center;margin:0 0 4px">สัญญาผ่อนชำระ</h1>
  <p style="text-align:center;margin:0 0 2px">เลขที่สัญญา: <strong>{contract_number}</strong></p>
  <p style="text-align:center;margin:0 0 16px;color:#666">สาขา: {branch_name} | วันที่: {contract_date}</p>
  <hr style="border:none;border-top:1px solid #ccc;margin:0 0 16px"/>

  <div class="no-break">
    <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">ข้อมูลลูกค้า</h3>
    <table style="width:100%;margin-bottom:12px;font-size:13px">
      <tr><td style="width:120px;color:#666">ชื่อ-นามสกุล</td><td><strong>{customer_name}</strong></td></tr>
      <tr><td style="color:#666">เลขบัตร ปชช.</td><td>{national_id}</td></tr>
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

  <div class="page-break"></div>

  <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">ตารางผ่อนชำระ</h3>
  {payment_schedule_table}

  <div class="no-break" style="margin-top:40px">
    <h3 style="margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:4px">ลงนาม</h3>
    <div style="display:flex;justify-content:space-around;margin-top:20px">
      <div style="text-align:center">
        <p style="margin:0 0 4px;font-size:12px;color:#666">ผู้ซื้อ (ลูกค้า)</p>
        {customer_signature}
        <p style="margin:8px 0 0;font-size:13px">({customer_name})</p>
      </div>
      <div style="text-align:center">
        <p style="margin:0 0 4px;font-size:12px;color:#666">ผู้ขาย (พนักงาน)</p>
        {staff_signature}
        <p style="margin:8px 0 0;font-size:13px">({salesperson_name})</p>
      </div>
    </div>
  </div>
</div>`;
    }
    return '<div>{contract_number}</div>';
  }
}
