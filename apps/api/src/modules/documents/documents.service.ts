import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/document.dto';
import * as crypto from 'crypto';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  // ─── Contract Templates ──────────────────────────────
  async findAllTemplates(type?: string) {
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    return this.prisma.contractTemplate.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  async findOneTemplate(id: string) {
    const template = await this.prisma.contractTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('ไม่พบเทมเพลต');
    return template;
  }

  async createTemplate(dto: CreateTemplateDto) {
    // Auto-extract placeholders from contentHtml
    const placeholders = dto.placeholders || this.extractPlaceholders(dto.contentHtml);
    return this.prisma.contractTemplate.create({
      data: {
        name: dto.name,
        type: dto.type,
        contentHtml: dto.contentHtml,
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
      data.contentHtml = dto.contentHtml;
      data.placeholders = dto.placeholders || this.extractPlaceholders(dto.contentHtml);
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
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

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
        signerType: signerType as any,
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
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    // Get template
    let htmlContent = '';
    if (templateId) {
      const template = await this.findOneTemplate(templateId);
      htmlContent = template.contentHtml;
    } else {
      // Find active template by contract type
      const template = await this.prisma.contractTemplate.findFirst({
        where: { type: contract.planType, isActive: true },
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
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    let htmlContent = '';
    if (templateId) {
      const template = await this.findOneTemplate(templateId);
      htmlContent = template.contentHtml;
    } else {
      const template = await this.prisma.contractTemplate.findFirst({
        where: { type: contract.planType, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      htmlContent = template?.contentHtml || this.getDefaultTemplate('CONTRACT');
    }

    return { html: this.replacePlaceholders(htmlContent, contract) };
  }

  // ─── Helpers ──────────────────────────────────────────
  private extractPlaceholders(html: string): string[] {
    const matches = html.match(/\{[a-z_]+\}/g) || [];
    return [...new Set(matches)];
  }

  private replacePlaceholders(html: string, contract: any): string {
    const paymentScheduleRows = (contract.payments || [])
      .map(
        (p: any) =>
          `<tr><td>${p.installmentNo}</td><td>${new Date(p.dueDate).toLocaleDateString('th-TH')}</td><td>${Number(p.amountDue).toLocaleString()} ฿</td><td>${p.status === 'PAID' ? 'ชำระแล้ว' : 'รอชำระ'}</td></tr>`,
      )
      .join('');

    const customerSig = contract.signatures?.find((s: any) => s.signerType === 'CUSTOMER');
    const staffSig = contract.signatures?.find((s: any) => s.signerType === 'STAFF');

    const replacements: Record<string, string> = {
      '{contract_number}': contract.contractNumber,
      '{customer_name}': contract.customer?.name || '',
      '{national_id}': contract.customer?.nationalId || '',
      '{customer_phone}': contract.customer?.phone || '',
      '{customer_address}': contract.customer?.addressCurrent || contract.customer?.addressIdCard || '',
      '{product_name}': contract.product?.name || '',
      '{brand}': contract.product?.brand || '',
      '{model}': contract.product?.model || '',
      '{imei}': contract.product?.imeiSerial || '-',
      '{serial_number}': contract.product?.serialNumber || '-',
      '{selling_price}': Number(contract.sellingPrice).toLocaleString(),
      '{down_payment}': Number(contract.downPayment).toLocaleString(),
      '{monthly_payment}': Number(contract.monthlyPayment).toLocaleString(),
      '{total_months}': String(contract.totalMonths),
      '{interest_rate}': `${(Number(contract.interestRate) * 100).toFixed(1)}%`,
      '{interest_total}': Number(contract.interestTotal).toLocaleString(),
      '{financed_amount}': Number(contract.financedAmount).toLocaleString(),
      '{branch_name}': contract.branch?.name || '',
      '{salesperson_name}': contract.salesperson?.name || '',
      '{date}': new Date().toLocaleDateString('th-TH'),
      '{payment_schedule_table}': `<table border="1" cellpadding="4" style="border-collapse:collapse;width:100%"><thead><tr><th>งวดที่</th><th>วันครบกำหนด</th><th>จำนวนเงิน</th><th>สถานะ</th></tr></thead><tbody>${paymentScheduleRows}</tbody></table>`,
      '{customer_signature}': customerSig ? `<img src="${customerSig.signatureImage}" style="max-height:60px"/>` : '<div style="border-bottom:1px solid #000;width:200px;height:60px"></div>',
      '{staff_signature}': staffSig ? `<img src="${staffSig.signatureImage}" style="max-height:60px"/>` : '<div style="border-bottom:1px solid #000;width:200px;height:60px"></div>',
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
