import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto } from '../dto/document.dto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ContractTemplateService — ContractTemplate CRUD + template resolution +
 * the embedded default-template HTML. Extracted VERBATIM from DocumentsService
 * during the Template/Signature/Rendering/Persistence decomposition.
 *
 * The default-template file path uses `__dirname/../templates` because this
 * service now lives one directory deeper (services/) than the original
 * documents.service.ts — the templates/ asset directory is unchanged.
 */
@Injectable()
export class ContractTemplateService {
  constructor(private prisma: PrismaService) {}

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

  /**
   * Resolve which template HTML to use:
   * - If active DB template exists for this planType, always use it (admin-configured)
   * - Otherwise fall back to file template or inline default
   */
  async resolveTemplate(planType: string, documentType: string): Promise<{ html: string; settings: Prisma.JsonValue }> {
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

  getDefaultTemplate(documentType: string): string {
    if (documentType === 'CONTRACT') {
      // Critical: must load full hire-purchase contract template from file
      // No fallback — fail fast if missing (build verification should catch this)
      const templatePath = path.join(__dirname, '..', 'templates', 'hire-purchase-contract.html');
      if (!fs.existsSync(templatePath)) {
        throw new Error(
          `Critical: hire-purchase-contract.html template missing at ${templatePath}. ` +
          `Check nest-cli.json assets configuration.`
        );
      }
      return fs.readFileSync(templatePath, 'utf-8');
    }
    // Legacy fallback for non-CONTRACT document types (kept for safety)
    if (documentType === '__UNUSED__') {
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
    // End of dead-code branch (kept above as __UNUSED__ guard prevents execution)
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
}
