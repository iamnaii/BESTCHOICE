/* eslint-disable max-len */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Generates A4 letter PDFs (RETURN_DEVICE_45D / CONTRACT_TERMINATION_60D)
 * via Puppeteer + HTML templates — mirrors the architecture used by
 * ContractDocumentsService for hire-purchase contracts.
 *
 * Benefits over the previous jsPDF client-side renderer:
 *   • Browser handles pagination natively (CSS @page + page-break)
 *   • TH Sarabun PSK fonts embedded as base64 — guaranteed rendering
 *   • Single template = single source of truth across single + bulk flows
 *   • Layout edits = HTML/CSS only, no canvas math
 */
@Injectable()
export class LetterPdfService {
  private readonly logger = new Logger(LetterPdfService.name);
  constructor(private prisma: PrismaService) {}

  /** Generate a single letter PDF as a Buffer (no S3 upload). */
  async generatePdfBuffer(letterId: string): Promise<Buffer> {
    const letter = await this.prisma.contractLetter.findFirst({
      where: { id: letterId, deletedAt: null },
      include: {
        contract: {
          include: {
            customer: true,
            product: true,
            payments: { where: { deletedAt: null }, orderBy: { installmentNo: 'asc' } },
          },
        },
      },
    });
    if (!letter) throw new NotFoundException('ไม่พบจดหมาย');

    const company = await this.prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException('ไม่พบข้อมูลบริษัท FINANCE — โปรดตั้งค่า CompanyInfo ก่อน');
    }

    const configs = await this.prisma.systemConfig.findMany({
      where: {
        key: {
          in: ['letter_coordinator_name', 'letter_coordinator_phone', 'letter_signature_url', 'letter_letterhead_url'],
        },
      },
    });
    const cfg = new Map(configs.map((c) => [c.key, c.value]));

    const data = this.buildTemplateData(letter, company, cfg);
    const html = this.renderHtml(data);
    return this.htmlToPdf(html, letter.letterNumber);
  }

  // ─── Template data assembly ─────────────────────────────────────────────

  private buildTemplateData(
    letter: any,
    company: any,
    cfg: Map<string, string | null>,
  ): TemplateData {
    const payments = (letter.contract.payments ?? []).filter((p: any) =>
      ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status),
    );

    const principalDec = payments.reduce(
      (sum: Decimal, p: any) =>
        sum.plus(new Decimal(p.amountDue ?? '0')).minus(new Decimal(p.amountPaid ?? '0')),
      new Decimal(0),
    );
    const lateFeeDec = payments.reduce(
      (sum: Decimal, p: any) => sum.plus(new Decimal(p.lateFee ?? '0')),
      new Decimal(0),
    );
    const principal = principalDec.toNumber();
    const lateFee = lateFeeDec.toNumber();
    const outstanding = principalDec.plus(lateFeeDec).toNumber();

    const now = new Date();
    const overdueMonths = Array.from(
      new Set(
        payments
          .map((p: any) => new Date(p.dueDate))
          .filter((d: Date) => d.getTime() < now.getTime())
          .sort((a: Date, b: Date) => a.getTime() - b.getTime())
          .map((d: Date) => `${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`),
      ),
    ) as string[];
    const overdueInstallments = payments.filter(
      (p: any) => new Date(p.dueDate).getTime() < now.getTime(),
    ).length;

    const allPayments = letter.contract.payments ?? [];
    const firstInstallment = allPayments.find((p: any) => p.installmentNo === 1) ?? allPayments[0];

    const product = letter.contract.product;

    return {
      letterType: letter.letterType,
      letterNumber: letter.letterNumber,
      letterDate: formatThaiDateLong(new Date()),
      company: {
        nameTh: company.nameTh,
        address: company.address,
        directorName: company.directorName,
        directorPosition: company.directorPosition ?? null,
        logoUrl: cfg.get('letter_letterhead_url') ?? company.logoUrl ?? null,
        signatureUrl: cfg.get('letter_signature_url') ?? null,
      },
      customer: {
        name: letter.contract.customer.name,
      },
      contract: {
        contractNumber: letter.contract.contractNumber,
        contractDateThai: letter.contract.createdAt
          ? formatThaiDateLong(new Date(letter.contract.createdAt))
          : '',
        totalMonths: Number(letter.contract.totalMonths ?? 0),
        monthlyPayment: Number(letter.contract.monthlyPayment ?? 0),
        paymentDueDay: letter.contract.paymentDueDay ?? null,
        firstDueDateThai: firstInstallment?.dueDate
          ? formatThaiDateLong(new Date(firstInstallment.dueDate))
          : '',
      },
      product: product
        ? {
            brand: product.brand ?? '',
            model: product.model ?? '',
            storage: product.storage ?? null,
            color: product.color ?? null,
            imei: product.imeiSerial ?? null,
          }
        : null,
      overdue: {
        firstMonth: overdueMonths[0] ?? '',
        monthsJoined: overdueMonths.join(', '),
        installments: overdueInstallments,
        principal,
        lateFee,
        total: outstanding,
        totalWords: numberToThaiBahtText(outstanding),
      },
      coordinator: {
        name: cfg.get('letter_coordinator_name') ?? null,
        phone: cfg.get('letter_coordinator_phone') ?? null,
      },
    };
  }

  // ─── HTML rendering ─────────────────────────────────────────────────────

  private renderHtml(d: TemplateData): string {
    const productDesc = d.product
      ? `ยี่ห้อ ${esc(d.product.brand)} รุ่น ${esc(d.product.model)}` +
        (d.product.storage ? ` ${esc(d.product.storage)}` : '') +
        (d.product.color ? ` สี${esc(d.product.color)}` : '') +
        (d.product.imei ? ` หมายเลข IMEI ${esc(d.product.imei)}` : '')
      : 'ทรัพย์สินที่เช่าซื้อ';

    const scheduleDesc =
      d.contract.totalMonths > 0
        ? ` จำนวน ${d.contract.totalMonths} งวด งวดละ ${fmtMoney(d.contract.monthlyPayment)} บาท` +
          (d.contract.paymentDueDay ? ` ทุกวันที่ ${d.contract.paymentDueDay} ของเดือน` : '') +
          (d.contract.firstDueDateThai
            ? ` โดยเริ่มชำระงวดแรกในวันที่ ${esc(d.contract.firstDueDateThai)}`
            : '')
        : '';

    const subjectText =
      d.letterType === 'RETURN_DEVICE_45D'
        ? 'แจ้งเตือนให้ชำระค่าเช่าซื้อที่ค้างชำระ และ/หรือ ส่งมอบโทรศัพท์มือถือที่เช่าซื้อคืน'
        : 'บอกเลิกสัญญาเช่าซื้อ และขอให้ส่งคืนทรัพย์สินที่เช่าซื้อพร้อมชำระหนี้ค้างชำระ';

    const body =
      d.letterType === 'RETURN_DEVICE_45D'
        ? this.renderReturnDeviceBody(d, productDesc, scheduleDesc)
        : this.renderTerminationBody(d, productDesc, scheduleDesc);

    const logoImg = d.company.logoUrl
      ? `<img src="${esc(d.company.logoUrl)}" alt="logo" class="logo"/>`
      : '';

    const sigImg = d.company.signatureUrl
      ? `<img src="${esc(d.company.signatureUrl)}" alt="signature" class="sig-img"/>`
      : `<div class="sig-line">(...........................................)</div>`;

    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8"/>
<title>${esc(d.letterNumber)}</title>
<style>
  @page { size: A4; margin: 18mm 22mm 22mm 22mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: 'TH Sarabun PSK', sans-serif; font-size: 16pt; line-height: 1.55; color: #000; }
  .header { display: flex; align-items: center; gap: 14mm; padding-bottom: 8px; border-bottom: 1.5px solid #555; }
  .header img.logo { width: 22mm; height: 22mm; object-fit: contain; }
  .header .company { display: flex; flex-direction: column; gap: 2px; }
  .header .company-name { font-size: 18pt; font-weight: 700; }
  .header .company-addr { font-size: 13pt; }
  .date-line { text-align: right; margin: 12px 0 10px; }
  .subject { font-weight: 700; margin-bottom: 8px; }
  .field { margin: 4px 0; }
  .field .label { font-weight: 700; }
  .body p { margin: 6px 0; text-indent: 24px; text-align: justify; }
  .body p.indent-none { text-indent: 0; }
  ol.demand { padding-left: 24px; margin: 8px 0; }
  ol.demand li { margin: 4px 0; }
  .section-heading { font-weight: 700; margin: 14px 0 6px; }
  ol.legal { padding-left: 24px; margin: 6px 0; }
  ol.legal li { margin: 4px 0; }
  ol.legal li .legal-title { font-weight: 700; }
  ul.bullets { padding-left: 28px; margin: 8px 0; list-style-type: none; }
  ul.bullets li { margin: 6px 0; position: relative; }
  ul.bullets li::before { content: '•'; position: absolute; left: -16px; font-weight: 700; }
  ul.bullets li .bullet-label { font-weight: 700; }
  .coord-line { margin: 14px 0 6px; text-indent: 24px; }
  .coord-line .strong { font-weight: 700; }
  .closing { font-weight: 700; margin: 12px 0 24px; text-indent: 24px; }
  .signature { text-align: center; margin-top: 8px; }
  .signature .salutation { margin-bottom: 6px; }
  .signature .sig-line { letter-spacing: 1px; }
  .signature img.sig-img { width: 50mm; height: 22mm; object-fit: contain; }
  .signature .director { font-weight: 700; margin-top: 4px; }
  .signature .position { font-size: 14pt; }
  .signature .company-foot { font-size: 14pt; }
  /* keep header inside top of every page so demand list never starts orphaned */
  .keep-together { page-break-inside: avoid; break-inside: avoid; }
</style>
</head>
<body>
  <div class="header">
    ${logoImg}
    <div class="company">
      <div class="company-name">${esc(d.company.nameTh)}</div>
      <div class="company-addr">${esc(d.company.address)}</div>
    </div>
  </div>
  <div class="date-line">วันที่ ${esc(d.letterDate)}</div>
  <div class="subject"><span class="label">เรื่อง</span>&nbsp;&nbsp;${esc(subjectText)}</div>
  <div class="field"><span class="label">เรียน</span>&nbsp;&nbsp;${esc(d.customer.name)}</div>
  <div class="field"><span class="label">อ้างถึง</span>&nbsp;&nbsp;สัญญาเช่าซื้อโทรศัพท์มือถือ เลขที่ ${esc(d.contract.contractNumber)}${d.contract.contractDateThai ? ' ลงวันที่ ' + esc(d.contract.contractDateThai) : ''}</div>
  <div class="body">
    ${body}
  </div>
  <div class="signature">
    <div class="salutation">ขอแสดงความนับถือ</div>
    ${sigImg}
    <div class="director">[ ${esc(d.company.directorName)} ]</div>
    ${d.company.directorPosition ? `<div class="position">${esc(d.company.directorPosition)}</div>` : ''}
    <div class="company-foot">${esc(d.company.nameTh)}</div>
  </div>
</body>
</html>`;
  }

  private renderReturnDeviceBody(
    d: TemplateData,
    productDesc: string,
    scheduleDesc: string,
  ): string {
    const overdueMonthsText = d.overdue.monthsJoined || `${d.overdue.installments} วัน`;
    const overdueCountText = d.overdue.installments
      ? `ติดต่อกันเป็นจำนวน ${d.overdue.installments} งวด `
      : '';

    const coord =
      d.coordinator.name && d.coordinator.phone
        ? `<div class="coord-line">หากท่านต้องการติดต่อเพื่อดำเนินการดังกล่าว หรือมีข้อสงสัยประการใด โปรดติดต่อ <span class="strong">คุณ ${esc(d.coordinator.name)}</span> เจ้าหน้าที่ประสานงาน ได้ที่หมายเลขโทรศัพท์ <span class="strong">${esc(d.coordinator.phone)}</span></div>`
        : '';

    return `
<p>ตามที่ท่านได้ทำสัญญาเช่าซื้อโทรศัพท์มือถือ ${productDesc} (ต่อไปนี้เรียกว่า "ทรัพย์สินที่เช่าซื้อ") กับ ${esc(d.company.nameTh)} ("บริษัทฯ") โดยท่านตกลงที่จะชำระค่าเช่าซื้อเป็นรายเดือน${scheduleDesc} ตามรายละเอียดที่ปรากฏในสัญญานั้น</p>

<p>ปรากฏว่า บัดนี้ท่านได้ผิดนัดชำระค่าเช่าซื้องวดประจำเดือน ${esc(overdueMonthsText)} ${overdueCountText}อันเป็นการผิดสัญญาเช่าซื้อในข้อ 8 (การผิดนัดชำระหนี้/ผิดเงื่อนไขสัญญา) และ ข้อ 20 (การผิดสัญญาและการสิ้นสุดของสัญญา)</p>

<p>บริษัทฯ จึงขอให้ท่านดำเนินการอย่างหนึ่งอย่างใด ดังต่อไปนี้</p>

<ol class="demand">
  <li>ชำระค่าเช่าซื้อที่ค้างชำระทั้งหมด จำนวน ${fmtMoney(d.overdue.principal)} บาท พร้อมเบี้ยปรับ ${fmtMoney(d.overdue.lateFee)} บาท รวมเป็นเงินทั้งสิ้น ${fmtMoney(d.overdue.total)} บาท (${esc(d.overdue.totalWords)}) ภายใน 7 วัน นับตั้งแต่วันที่ท่านได้รับจดหมายฉบับนี้</li>
  <li>หรือ หากท่านไม่สามารถชำระค่าเช่าซื้อที่ค้างได้ ขอให้ท่าน ส่งมอบทรัพย์สินที่เช่าซื้อคืน แก่บริษัทฯ ณ ที่ทำการของบริษัทฯ หรือ ตามที่อยู่ ${esc(d.company.nameTh)} ${esc(d.company.address)} ภายใน 7 วันนับแต่วันที่ได้รับจดหมายฉบับนี้ ในสภาพที่สมบูรณ์ตามสมควร</li>
</ol>

<div class="section-heading keep-together">การดำเนินการทางกฎหมายหากท่านเพิกเฉย</div>

<p>หากพ้นกำหนดเวลาดังกล่าวแล้ว ท่านยังคงเพิกเฉยไม่ดำเนินการชำระหนี้ หรือไม่ส่งมอบทรัพย์สินที่เช่าซื้อคืน บริษัทฯ มีความจำเป็นต้องดำเนินการตามสิทธิ์ในสัญญาและตามกฎหมายอย่างเด็ดขาด ดังนี้</p>

<ol class="legal">
  <li><span class="legal-title">การบอกเลิกสัญญา</span> บริษัทฯ จะใช้สิทธิ์บอกเลิกสัญญาเช่าซื้อฉบับนี้ทันที ตามที่ระบุไว้ในสัญญา ข้อ 20 (การผิดสัญญาและการสิ้นสุดของสัญญา) ข้อ 3</li>
  <li><span class="legal-title">การยึดคืนทรัพย์สิน</span> บริษัทฯ มีสิทธิ์กลับเข้าครอบครองและยึดคืนทรัพย์สินที่เช่าซื้อจากท่านทันที ไม่ว่าทรัพย์สินนั้นจะอยู่ที่ใดก็ตาม (ตามสัญญา ข้อ 20 และ ข้อ 21)</li>
  <li><span class="legal-title">การดำเนินคดีทางแพ่ง</span> บริษัทฯ จะฟ้องร้องดำเนินคดีต่อศาล เพื่อเรียกร้องให้ท่านส่งคืนทรัพย์สิน และ/หรือ ชำระหนี้ค่าเช่าซื้อที่ค้างอยู่ทั้งหมด หากนำทรัพย์สินออกขายทอดตลาดแล้วได้เงินไม่เพียงพอ ท่านยังคงต้องรับผิดชอบในส่วนต่างที่ขาดอยู่ พร้อมทั้งค่าเสียหาย ค่าใช้จ่ายในการติดตามทวงถาม และค่าฤชาธรรมเนียมศาล (ตามสัญญา ข้อ 21)</li>
  <li><span class="legal-title">การดำเนินคดีทางอาญา</span> หากท่านไม่ส่งมอบทรัพย์สินคืน หรือนำทรัพย์สินไปซุกซ่อน จำหน่ายจ่ายโอน หรือทำให้เสียหาย การกระทำดังกล่าวอาจเข้าข่ายเป็น ความผิดอาญาฐานยักยอกทรัพย์ ซึ่งบริษัทฯ จะดำเนินคดีตามกฎหมายจนถึงที่สุด</li>
</ol>

${coord}

<div class="closing">จึงเรียนมาเพื่อโปรดดำเนินการโดยเร่งด่วน</div>
`;
  }

  private renderTerminationBody(
    d: TemplateData,
    productDesc: string,
    scheduleDesc: string,
  ): string {
    const startMonth = d.overdue.firstMonth
      ? `ตั้งแต่งวดประจำเดือน ${esc(d.overdue.firstMonth)} เป็นต้นมา `
      : '';

    const coord =
      d.coordinator.name && d.coordinator.phone
        ? `<p class="indent-none coord-line">หากท่านมีข้อสงสัยหรือประสงค์จะนัดหมายส่งคืนเครื่อง โปรดติดต่อ <span class="strong">คุณ ${esc(d.coordinator.name)}</span> โทร <span class="strong">${esc(d.coordinator.phone)}</span> โดยด่วน</p>`
        : '';

    return `
<p>ตามที่ท่านได้ทำสัญญาเช่าซื้อโทรศัพท์มือถือ ${productDesc} ("ทรัพย์สินที่เช่าซื้อ") จากกับ ${esc(d.company.nameTh)} ("บริษัทฯ")${scheduleDesc.replace('จำนวน', 'จำนวน').replace(' จำนวน ', ' โดยตกลงชำระค่าเช่าซื้อเป็นรายเดือน เดือนละ ' + fmtMoney(d.contract.monthlyPayment) + ' บาท จำนวน ').replace(/งวดละ [\d,.]+ บาท/, '').replace(/  +/g, ' ')} นั้น</p>

<p>ปรากฏว่าท่านได้ผิดนัดชำระค่าเช่าซื้อ${startMonth}จนถึงปัจจุบันท่านมียอดค้างชำระสะสมรวมทั้งสิ้น ${fmtMoney(d.overdue.total)} บาท ซึ่งบริษัทฯ ได้เคยมีจดหมายแจ้งเตือนให้ท่านชำระหนี้แล้ว แต่ท่านยังคงเพิกเฉยอันเป็นการผิดนัดสัญญาข้อ 5 และ ข้อ 20 นั้น</p>

<p>โดยจดหมายฉบับนี้ บริษัทฯ ในฐานะผู้ให้เช่าซื้อ จึงขอบอกเลิกสัญญาเช่าซื้อฉบับดังกล่าวกับท่านทันที และขอให้ท่านดำเนินการดังต่อไปนี้ภายใน 7 วัน นับแต่วันที่ท่านได้รับจดหมายฉบับนี้:</p>

<ul class="bullets">
  <li><span class="bullet-label">ส่งมอบทรัพย์สินที่เช่าซื้อคืน</span>: ให้ท่านนำโทรศัพท์มือถือเครื่องดังกล่าวส่งมอบคืนแก่บริษัทฯ ณ ที่ทำการของบริษัทฯ ในสภาพที่สมบูรณ์พร้อมใช้งาน</li>
  <li><span class="bullet-label">ชำระหนี้ค้างชำระและค่าเสียหาย</span>: ให้ท่านชำระค่าเช่าซื้อที่ค้างชำระพร้อมเบี้ยปรับ และค่าขาดประโยชน์จากการใช้ทรัพย์ เป็นเงินจำนวน ${fmtMoney(d.overdue.total)} บาท (${esc(d.overdue.totalWords)})</li>
</ul>

<p>หากท่านเพิกเฉยไม่ดำเนินการภายในกำหนดเวลาข้างต้น บริษัทฯ มีความจำเป็นต้องดำเนินการตามกฎหมายอย่างเด็ดขาด ทั้งในคดีแพ่งเพื่อเรียกค่าเสียหายและค่าขาดประโยชน์จนถึงที่สุด และ ในคดีอาญา ในความผิดฐานยักยอกทรัพย์ ตามประมวลกฎหมายอาญา ซึ่งมีโทษจำคุกไม่เกิน 3 ปี หรือปรับไม่เกิน 60,000 บาท หรือทั้งจำทั้งปรับ ตามที่ระบุไว้ในสัญญาข้อ 13 และ ข้อ 21</p>

${coord}

<div class="closing">จึงเรียนมาเพื่อโปรดดำเนินการ</div>
`;
  }

  // ─── Puppeteer PDF ──────────────────────────────────────────────────────

  private async htmlToPdf(html: string, letterNumber: string): Promise<Buffer> {
    const puppeteer = await import('puppeteer-core');
    const executablePath = this.resolveChromiumPath();
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });

      const fontCss = this.buildEmbeddedFontCss();
      if (fontCss) {
        await page.addStyleTag({ content: fontCss });
      }

      const footerLeft = escapeHtmlAttr(`เลขที่ ${letterNumber}`);
      const footerFontCss = fontCss ? `<style>${fontCss}</style>` : '';
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '18mm', right: '22mm', bottom: '22mm', left: '22mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `${footerFontCss}<div style="width:100%;padding:0 22mm;font-family:'TH Sarabun PSK',sans-serif;font-size:10pt;color:#666;display:flex;justify-content:space-between;align-items:center"><span>${footerLeft}</span><span>หน้า <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private resolveChromiumPath(): string {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
    const candidates = [
      '/usr/bin/chromium-browser', // linux/docker
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS dev
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
  }

  private buildEmbeddedFontCss(): string {
    const fontDirCandidates = [
      path.join(process.cwd(), 'public', 'fonts'),
      path.join(process.cwd(), '..', 'web', 'public', 'fonts'),
      path.join(__dirname, '..', '..', '..', '..', 'public', 'fonts'),
    ];
    const fontsDir = fontDirCandidates.find((p) =>
      fs.existsSync(path.join(p, 'THSarabunPSK-Regular.ttf')),
    );
    if (!fontsDir) {
      this.logger.warn(`TH Sarabun PSK fonts not found — checked: ${fontDirCandidates.join(', ')}`);
      return '';
    }
    const regular = fs.readFileSync(path.join(fontsDir, 'THSarabunPSK-Regular.ttf')).toString('base64');
    const bold = fs.existsSync(path.join(fontsDir, 'THSarabunPSK-Bold.ttf'))
      ? fs.readFileSync(path.join(fontsDir, 'THSarabunPSK-Bold.ttf')).toString('base64')
      : '';
    return (
      `@font-face { font-family: 'TH Sarabun PSK'; src: url(data:font/truetype;base64,${regular}) format('truetype'); font-weight: 400; }` +
      (bold
        ? `@font-face { font-family: 'TH Sarabun PSK'; src: url(data:font/truetype;base64,${bold}) format('truetype'); font-weight: 700; }`
        : '') +
      `html, body, div, p, span, ol, ul, li, strong { font-family: 'TH Sarabun PSK', sans-serif !important; }`
    );
  }
}

// ─── Helper types + functions ─────────────────────────────────────────────

type TemplateData = {
  letterType: 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';
  letterNumber: string;
  letterDate: string;
  company: {
    nameTh: string;
    address: string;
    directorName: string;
    directorPosition: string | null;
    logoUrl: string | null;
    signatureUrl: string | null;
  };
  customer: { name: string };
  contract: {
    contractNumber: string;
    contractDateThai: string;
    totalMonths: number;
    monthlyPayment: number;
    paymentDueDay: number | null;
    firstDueDateThai: string;
  };
  product: {
    brand: string;
    model: string;
    storage: string | null;
    color: string | null;
    imei: string | null;
  } | null;
  overdue: {
    firstMonth: string;
    monthsJoined: string;
    installments: number;
    principal: number;
    lateFee: number;
    total: number;
    totalWords: string;
  };
  coordinator: {
    name: string | null;
    phone: string | null;
  };
};

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function formatThaiDateLong(d: Date): string {
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(s: string): string {
  return esc(s).replace(/'/g, '&#39;');
}

function numberToThaiBahtText(num: number): string {
  if (!num || num === 0) return 'ศูนย์บาทถ้วน';
  const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const places = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const readGroup = (n: number): string => {
    if (n === 0) return '';
    let s = '';
    const str = String(Math.floor(n));
    const len = str.length;
    for (let i = 0; i < len; i++) {
      const d = parseInt(str[i], 10);
      const place = len - i - 1;
      if (d === 0) continue;
      if (place === 1 && d === 1) s += 'สิบ';
      else if (place === 1 && d === 2) s += 'ยี่สิบ';
      else if (place === 0 && d === 1 && len > 1) s += 'เอ็ด';
      else s += digits[d] + places[place];
    }
    return s;
  };
  let text = '';
  let remaining = Math.floor(num);
  if (remaining >= 1000000) {
    const millions = Math.floor(remaining / 1000000);
    text += readGroup(millions) + 'ล้าน';
    remaining = remaining - millions * 1000000;
  }
  if (remaining > 0) text += readGroup(remaining);
  text += 'บาท';
  const satang = Math.round((num - Math.floor(num)) * 100);
  if (satang === 0) text += 'ถ้วน';
  else text += readGroup(satang) + 'สตางค์';
  return text;
}
