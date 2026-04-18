import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { formatDateShort } from '../../../utils/thai-date.util';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Voucher Service — สร้างใบสำคัญจ่ายเงินเงิน (Expense Voucher) สำหรับรายการรับซื้อมือถือ (Trade-In)
 *
 * - เลขที่ใบสำคัญรูปแบบ: EXP-YYYYMMNNNNN  (เช่น EXP-20260300064)
 * - Reset เลขลำดับทุกเดือน เริ่ม 00001
 * - PDF render ด้วย puppeteer + อัปขึ้น S3 ผ่าน StorageService
 */
@Injectable()
export class TradeInVoucherService {
  private readonly logger = new Logger(TradeInVoucherService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ─── เลขที่ใบสำคัญ ────────────────────────────────────────
  private async generateVoucherNumber(tx: Prisma.TransactionClient): Promise<string> {
    const now = new Date();
    const prefix = `EXP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const last = await tx.tradeIn.findFirst({
      where: { voucherNumber: { startsWith: prefix } },
      orderBy: { voucherNumber: 'desc' },
      select: { voucherNumber: true },
    });
    const seq = last?.voucherNumber
      ? parseInt(last.voucherNumber.slice(prefix.length), 10) + 1
      : 1;
    return `${prefix}${String(seq).padStart(5, '0')}`;
  }

  // ─── Allocate voucher number (no PDF — render on-demand) ──
  async allocate(tradeInId: string): Promise<{
    voucherNumber: string;
    voucherDate: Date;
  }> {
    const tradeIn = await this.prisma.tradeIn.findUnique({
      where: { id: tradeInId },
      select: { id: true, status: true, deletedAt: true, voucherNumber: true, voucherDate: true, agreedPrice: true, offeredPrice: true },
    });
    if (!tradeIn || tradeIn.deletedAt) throw new NotFoundException('ไม่พบรายการรับซื้อ');
    if (tradeIn.status !== 'ACCEPTED' && tradeIn.status !== 'COMPLETED') {
      throw new BadRequestException('ใบสำคัญจ่ายเงินเงินสร้างได้เฉพาะรายการที่ ACCEPTED หรือ COMPLETED');
    }
    const amount = Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0);
    if (amount <= 0) throw new BadRequestException('ต้องระบุราคาที่ตกลงก่อนออกใบสำคัญ');

    // Idempotent: ถ้ามีเลขเดิมแล้วคืนเลย
    if (tradeIn.voucherNumber && tradeIn.voucherDate) {
      return { voucherNumber: tradeIn.voucherNumber, voucherDate: tradeIn.voucherDate };
    }

    // Race-safe: retry P2002 (unique collision) สูงสุด 5 ครั้ง
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const voucherNumber = await this.generateVoucherNumber(tx);
          const voucherDate = new Date();
          return tx.tradeIn.update({
            where: { id: tradeInId },
            data: { voucherNumber, voucherDate },
            select: { voucherNumber: true, voucherDate: true },
          });
        });
        return { voucherNumber: result.voucherNumber!, voucherDate: result.voucherDate! };
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code !== 'P2002') throw err;
        this.logger.warn(`Voucher number collision (attempt ${attempt + 1}), retrying`);
      }
    }
    throw new Error('Failed to allocate voucher number after retries');
  }

  // ─── Render PDF on-demand (no storage required) ───────────
  async renderPdf(tradeInId: string): Promise<{ buffer: Buffer; voucherNumber: string }> {
    const tradeIn = await this.prisma.tradeIn.findUnique({
      where: { id: tradeInId },
      include: {
        customer: true,
        branch: { include: { company: true } },
        appraisedBy: { select: { id: true, name: true, savedSignature: true } },
        idCardVerifiedBy: { select: { id: true, name: true, savedSignature: true } },
      },
    });
    if (!tradeIn || tradeIn.deletedAt) throw new NotFoundException('ไม่พบรายการรับซื้อ');
    if (!tradeIn.voucherNumber || !tradeIn.voucherDate) {
      throw new BadRequestException('ยังไม่ได้สร้างเลขที่ใบสำคัญ');
    }

    const amount = Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0);
    const sellerName = tradeIn.sellerName || tradeIn.customer?.name || '-';
    const sellerAddress = tradeIn.sellerAddress || tradeIn.customer?.addressIdCard || '-';
    const sellerPhone = tradeIn.sellerPhone || tradeIn.customer?.phone || '-';
    const sellerIdCard = tradeIn.sellerIdCardNumber || tradeIn.customer?.nationalId || '-';
    const issuer = tradeIn.idCardVerifiedBy || tradeIn.appraisedBy;
    const issuerName = issuer?.name || 'BESTCHOICE';
    const issuerSignature = issuer?.savedSignature || null;

    // ─── (สำเนา) detection: ครั้งแรกพิมพ์ → save voucherPrintedAt
    //     ครั้งถัดไป → ทำเครื่องหมาย "สำเนา"
    const isReprint = !!tradeIn.voucherPrintedAt;
    if (!tradeIn.voucherPrintedAt) {
      await this.prisma.tradeIn.update({
        where: { id: tradeInId },
        data: { voucherPrintedAt: new Date() },
      });
    }

    // ─── QR code: link ไปหน้า verify (ถ้ายังไม่มี endpoint ก็เป็น URL placeholder)
    const verifyUrl = `${process.env.PUBLIC_APP_URL || 'https://bestchoice.local'}/verify/voucher/${tradeIn.voucherNumber}`;
    const qrcode = await import('qrcode');
    const qrDataUrl = await qrcode.toDataURL(verifyUrl, { width: 220, margin: 0 });

    const html = this.buildHtml({
      voucherNumber: tradeIn.voucherNumber,
      voucherDate: tradeIn.voucherDate,
      isReprint,
      company: tradeIn.branch?.company ?? null,
      sellerName,
      sellerAddress,
      sellerPhone,
      sellerIdCard,
      sellerSignatureBase64: tradeIn.sellerSignatureBase64,
      issuerName,
      issuerSignatureBase64: issuerSignature,
      qrDataUrl,
      deviceLabel: this.buildDeviceLabel(tradeIn),
      amount,
      amountText: this.numberToThaiBahtText(amount),
      paymentMethod: (tradeIn.paymentMethod as 'CASH' | 'TRANSFER' | null) ?? 'CASH',
      transferBankName: tradeIn.transferBankName,
      transferAccountNumber: tradeIn.transferAccountNumber,
      transferAccountName: tradeIn.transferAccountName,
    });

    const buffer = await this.htmlToPdf(html);
    return { buffer, voucherNumber: tradeIn.voucherNumber };
  }

  /** Format date as DD/MM/YYYY (Christian year) */
  private formatDmy(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  /** Format date as Thai date "8 เมษายน 2569" (Buddhist year) */
  private formatThaiDate(d: Date): string {
    const months = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
    ];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
  }

  /** Lucide-style stroke icons inline (24×24 viewBox) — SVG เพื่อใช้ใน PDF */
  private icon(name: string, size = 14, color = '#6b7280'): string {
    const paths: Record<string, string> = {
      clipboard:
        '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
      'message-circle':
        '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
      'pen-tool':
        '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
      wallet:
        '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
      phone:
        '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
      mail:
        '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
      globe:
        '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
      user:
        '<circle cx="12" cy="7" r="4"/><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>',
      'banknote':
        '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    };
    const path = paths[name] || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle">${path}</svg>`;
  }

  /** BESTCHOICE logo SVG — อ่านจาก apps/web/public/logo.svg (cached) */
  private cachedLogoSvg: string | null = null;
  private logoSvg(): string {
    if (this.cachedLogoSvg) return this.cachedLogoSvg;
    const candidates = [
      path.join(process.cwd(), 'public', 'logo.svg'),
      path.join(__dirname, '..', '..', '..', '..', '..', 'public', 'logo.svg'),
      path.join(process.cwd(), '..', 'web', 'public', 'logo.svg'),
      path.join(__dirname, '..', '..', '..', '..', '..', 'web', 'public', 'logo.svg'),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) {
      const raw = fs.readFileSync(found, 'utf8');
      // ใส่ width/height ให้พอดีกับ header (ต้นฉบับ viewBox 710×425)
      this.cachedLogoSvg = raw.replace(
        /<svg\b([^>]*)>/,
        '<svg$1 style="width:160px;height:auto;display:block">',
      );
      return this.cachedLogoSvg;
    }
    // fallback — ถ้าหาไฟล์ไม่เจอ ใช้ text แทน (ไม่ใช่ SVG เทียม)
    this.cachedLogoSvg = `<div style="font-family:Arial,sans-serif;font-size:22pt;font-weight:800;letter-spacing:1px"><span style="color:#4D4D4D">BEST</span><span style="color:#1DA579">CHOICE</span></div>`;
    return this.cachedLogoSvg;
  }

  // ─── Helpers ──────────────────────────────────────────────
  private buildDeviceLabel(t: {
    deviceBrand: string;
    deviceModel: string;
    deviceStorage: string | null;
    deviceColor: string | null;
    imei: string | null;
  }): string {
    const main = [t.deviceBrand, t.deviceModel, t.deviceStorage].filter(Boolean).join(' ');
    const sub = [
      t.deviceColor ? `สี${t.deviceColor}` : null,
      t.imei ? `IMEI ${t.imei}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    return sub ? `${main}\n${sub}` : main;
  }

  /** เลขเป็นข้อความไทย เช่น 37,673.00 → "สามหมื่นเจ็ดพันหกร้อยเจ็ดสิบสามบาทถ้วน" */
  private numberToThaiBahtText(num: number): string {
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
        if (pos === 0 && d === 1 && len > 1) result += 'เอ็ด';
        else if (pos === 1 && d === 1) result += 'สิบ';
        else if (pos === 1 && d === 2) result += 'ยี่สิบ';
        else result += digits[d] + positions[pos];
      }
      return result;
    };
    const intPart = Math.floor(Math.abs(num));
    const decPart = Math.round((Math.abs(num) - intPart) * 100);
    let text = convertIntPart(intPart) + 'บาท';
    if (decPart > 0) text += convertIntPart(decPart) + 'สตางค์';
    else text += 'ถ้วน';
    return text;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }

  private formatBaht(n: number): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ─── HTML template ────────────────────────────────────────
  private buildHtml(data: {
    voucherNumber: string;
    voucherDate: Date;
    isReprint: boolean;
    company: {
      nameTh: string;
      address: string;
      taxId: string;
      phone?: string | null;
      logoUrl?: string | null;
    } | null;
    sellerName: string;
    sellerAddress: string;
    sellerPhone: string;
    sellerIdCard: string;
    sellerSignatureBase64: string | null;
    issuerName: string;
    issuerSignatureBase64: string | null;
    qrDataUrl: string;
    deviceLabel: string;
    amount: number;
    amountText: string;
    paymentMethod: 'CASH' | 'TRANSFER';
    transferBankName: string | null;
    transferAccountNumber: string | null;
    transferAccountName: string | null;
  }): string {
    const company = data.company ?? {
      nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      address:
        'เลขที่ 456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000',
      taxId: '0165568000050',
      phone: '063-134-6356',
      logoUrl: null,
    };

    return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ใบสำคัญจ่ายเงิน ${this.escapeHtml(data.voucherNumber)}</title>
  <style>
    @page { size: A4; margin: 14mm 16mm 16mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'TH Sarabun PSK', sans-serif;
      font-size: 12pt;
      color: #1f2937;
      margin: 0;
      line-height: 1.5;
      background: #fff;
    }
    .page { padding: 0; position: relative; }

    /* ─── Watermark "สำเนา" diagonal ─── */
    .watermark {
      position: fixed;
      top: 35%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-28deg);
      font-size: 110pt;
      font-weight: 900;
      color: rgba(220, 38, 38, 0.05);
      letter-spacing: 10px;
      z-index: 0;
      pointer-events: none;
      white-space: nowrap;
    }
    .content { position: relative; z-index: 1; }

    /* ─── Color tokens — match BESTCHOICE green palette ─── */
    :root {
      --green-50: #f0faf3;
      --green-100: #dcf5e3;
      --green-200: #b8e8c4;
      --green-500: #6dbe7a;
      --green-600: #4ea35f;
      --green-700: #2e7d32;
      --gray-700: #374151;
      --gray-500: #6b7280;
      --gray-400: #9ca3af;
    }

    /* ─── Top header — Logo ซ้าย / Title ขวา (2 cols only) ─── */
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .top-header .logo { display: flex; align-items: center; }
    .top-header .logo > svg { max-width: 170px; max-height: 70px; }
    .top-header .title-block { text-align: right; }
    .top-header .title {
      font-family: 'TH Sarabun PSK', sans-serif;
      font-size: 44pt;
      font-weight: 700;
      color: #6dbe7a;
      line-height: 1;
      letter-spacing: -0.5px;
    }
    .top-header .title-en {
      font-size: 11pt;
      color: #9ca3af;
      font-weight: 600;
      letter-spacing: 3px;
      margin-top: 4px;
    }
    .top-header::after {
      content: '';
      display: block;
      position: absolute;
      left: 0;
      right: 0;
      bottom: -8px;
      height: 1px;
      background: linear-gradient(to right, transparent, #d1d5db, transparent);
    }
    .top-header { position: relative; }
    .top-header .title-reprint {
      font-size: 12pt;
      color: #dc2626;
      font-weight: 600;
      text-align: right;
      margin-bottom: 4px;
    }

    /* ─── Info grid (2 rows × 2 cols) ─── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 260px;
      column-gap: 28px;
      row-gap: 10px;
      margin-bottom: 12px;
    }
    .info-block .row {
      display: flex;
      gap: 10px;
      font-size: 12pt;
      line-height: 1.6;
    }
    .info-block .label {
      color: #1f2937;
      font-weight: 700;
      min-width: 84px;
      flex-shrink: 0;
    }
    .info-block .value { color: #374151; flex: 1; }
    .info-block .value strong { font-weight: 700; color: #1f2937; }
    .info-block .contacts {
      display: flex;
      gap: 22px;
      flex-wrap: wrap;
      margin-top: 6px;
      margin-left: 94px;
      font-size: 11pt;
      color: #4b5563;
    }
    .info-block .contacts .ct { display: inline-flex; align-items: center; gap: 6px; }

    .info-right-block .doc-row {
      display: flex;
      gap: 10px;
      font-size: 12pt;
      padding: 4px 0;
    }
    .info-right-block .doc-label {
      color: #1f2937;
      font-weight: 700;
      min-width: 110px;
    }
    .info-right-block .doc-value { color: #374151; flex: 1; }
    .info-right-block .lbl {
      font-size: 12pt;
      color: #1f2937;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .info-right-block .ct {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11pt;
      color: #4b5563;
      padding: 3px 0;
    }

    /* ─── Items table ─── */
    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }
    table.items thead th {
      background: #dcf5e3;
      font-size: 11.5pt;
      font-weight: 700;
      color: #1f2937;
      padding: 13px 14px;
      text-align: left;
      border-top: 1px solid #b8e8c4;
      border-bottom: 1px solid #b8e8c4;
    }
    table.items thead th.right { text-align: right; }
    table.items thead th.center { text-align: center; }
    table.items tbody td {
      padding: 10px 14px;
      border-bottom: 1px solid #ebedf0;
      font-size: 12pt;
      vertical-align: top;
    }
    table.items tbody td.right { text-align: right; font-weight: 600; color: #1f2937; }
    table.items tbody td.center { text-align: center; }
    table.items tbody .item-main { color: #1f2937; font-weight: 700; font-size: 12.5pt; }
    table.items tbody .item-sub {
      color: #9ca3af;
      font-size: 11pt;
      margin-top: 2px;
    }
    .table-note {
      font-size: 10pt;
      color: #6b7280;
      padding: 8px 12px 0;
    }

    /* ─── Spacer ─── */
    .spacer { min-height: 0; }

    /* ─── Summary ─── */
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: 24px;
      margin-top: 10px;
    }
    .summary-left {
      display: grid;
      grid-template-columns: 26px 1fr 1fr;
      gap: 6px 14px;
      font-size: 12pt;
      align-items: start;
    }
    .summary-left .icon {
      grid-row: span 2;
      display: inline-flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 4px;
    }
    .summary-left .label {
      color: #1f2937;
      font-weight: 700;
      padding: 1px 0;
    }
    .summary-left .value {
      color: #1f2937;
      font-weight: 600;
      text-align: right;
      padding: 1px 0;
    }
    .summary-left .baht-text {
      grid-column: 2 / span 2;
      text-align: right;
      color: #6b7280;
      font-style: italic;
      font-size: 11pt;
      margin-top: -2px;
    }

    .summary-right .total-box {
      background: #dcf5e3;
      border-radius: 4px;
      padding: 18px 22px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .summary-right .total-box .total-label {
      font-size: 13pt;
      font-weight: 700;
      color: #1f2937;
    }
    .summary-right .total-box .total-amount {
      font-size: 24pt;
      font-weight: 800;
      color: #2e7d32;
      line-height: 1;
    }
    .summary-right .total-box .total-amount .unit {
      font-size: 11pt;
      font-weight: 600;
      color: #4b5563;
      margin-left: 4px;
    }
    .summary-right .extra-row {
      display: flex;
      justify-content: space-between;
      padding: 7px 20px;
      font-size: 11pt;
      color: #4b5563;
    }
    .summary-right .extra-row .value { color: #1f2937; font-weight: 600; }

    /* ─── Payment ─── */
    .payment-section {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #ebedf0;
      display: grid;
      grid-template-columns: 26px 1fr 1.5fr 150px;
      gap: 14px;
      font-size: 12pt;
    }
    .payment-section .icon {
      padding-top: 2px;
      display: flex;
      align-items: flex-start;
    }
    .payment-section .col {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .payment-section .col .icon-label {
      font-weight: 700;
      color: #1f2937;
      margin-bottom: 4px;
    }
    .payment-section .pay-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }
    .payment-section .pay-row .label { color: #4b5563; }
    .payment-section .pay-row .value { color: #1f2937; font-weight: 600; }
    .payment-section .bank-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 2px 0;
    }
    .payment-section .bank-icon {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #6dbe7a;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .payment-section .bank-info .bank-name {
      color: #1f2937;
      font-weight: 700;
      font-size: 12pt;
    }
    .payment-section .bank-info .acc-num {
      color: #1f2937;
      font-weight: 700;
      font-size: 11.5pt;
    }
    .payment-section .bank-info .acc-name {
      color: #4b5563;
      font-size: 11pt;
    }
    .payment-section .pay-amount {
      text-align: right;
      font-weight: 700;
      font-size: 12pt;
      color: #1f2937;
      padding-top: 26px;
    }

    /* ─── Note ─── */
    .note-section {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #ebedf0;
      display: grid;
      grid-template-columns: 26px 1fr;
      gap: 14px;
      align-items: center;
    }
    .note-section .icon { display: flex; align-items: center; }
    .note-section .label {
      font-weight: 700;
      color: #1f2937;
      font-size: 12pt;
    }

    /* ─── Signatures ─── */
    .sig-section {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #ebedf0;
      display: grid;
      grid-template-columns: 26px 220px 1fr;
      gap: 14px;
      align-items: flex-start;
    }
    .sig-section .icon { display: flex; align-items: flex-start; padding-top: 2px; }
    .sig-section .qr-col {
      text-align: center;
    }
    .sig-section .qr-col .qr-label {
      font-size: 11pt;
      color: #4b5563;
      margin-bottom: 6px;
    }
    .sig-section .qr-col .qr-box {
      width: 110px;
      height: 110px;
      background: repeating-linear-gradient(45deg, #1f2937 0 4px, transparent 4px 8px),
                  repeating-linear-gradient(-45deg, #1f2937 0 4px, transparent 4px 8px);
      background-color: #fff;
      border: 1px solid #1f2937;
      margin: 0 auto;
    }
    .sig-section .signer-col {
      padding-left: 16px;
    }
    .sig-section .signer-title {
      font-size: 12pt;
      color: #1f2937;
      font-weight: 700;
      margin-bottom: 14px;
    }
    .sig-section .signer-img {
      height: 42px;
      margin-bottom: 4px;
      display: inline-flex;
      align-items: flex-end;
      color: #9ca3af;
      font-size: 10pt;
      font-style: italic;
    }
    .sig-section .signer-line {
      width: 220px;
      border-top: 1px dotted #9ca3af;
      padding-top: 6px;
    }
    .sig-section .signer-name {
      font-size: 12pt;
      color: #1f2937;
      font-weight: 700;
    }
    .sig-section .signer-date {
      font-size: 11pt;
      color: #6b7280;
      margin-top: 2px;
    }

    /* ─── IMEI badge in items table ─── */
    table.items tbody .imei-badge {
      display: inline-block;
      margin-top: 6px;
      padding: 3px 10px;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      font-size: 10.5pt;
      font-weight: 600;
      color: #374151;
      font-family: 'TH Sarabun PSK', monospace;
    }
    table.items tbody .imei-badge .lbl {
      color: #6b7280;
      font-weight: 400;
      margin-right: 6px;
    }

    /* ─── Legal disclaimer ─── */
    .legal-disclaimer {
      margin-top: 14px;
      padding: 10px 14px;
      background: #fffbeb;
      border-left: 3px solid #f59e0b;
      border-radius: 3px;
      font-size: 10pt;
      color: #78350f;
      line-height: 1.5;
    }
    .legal-disclaimer .receiver {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #fcd34d;
      color: #78350f;
    }
    .legal-disclaimer .receiver strong { font-weight: 700; }

    /* ─── Dual signature columns ─── */
    .sig-section .dual-signers {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
    }
    .sig-section .dual-signers .signer {
      text-align: left;
    }

    /* ─── Page footer ─── */
    .page-footer {
      margin-top: 26px;
      padding-top: 10px;
      border-top: 1px solid #ebedf0;
      display: flex;
      justify-content: space-between;
      font-size: 9.5pt;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="page">
    ${data.isReprint ? '<div class="watermark">สำเนา</div>' : ''}
    <div class="content">
    <!-- Top header: logo ซ้าย / title ขวา -->
    <div class="top-header">
      <div class="logo">${this.logoSvg()}</div>
      <div class="title-block">
        <div class="title">ใบสำคัญจ่ายเงิน</div>
        <div class="title-en">PAYMENT VOUCHER</div>
      </div>
    </div>

    <!-- Info grid: 2 rows × 2 cols -->
    <div class="info-grid">
      <!-- Row 1: ผู้ซื้อ (BESTCHOICE) | เลขเอกสาร -->
      <div class="info-block">
        <div class="row">
          <span class="label">ผู้ซื้อ :</span>
          <span class="value"><strong>${this.escapeHtml(company.nameTh)}</strong></span>
        </div>
        <div class="row">
          <span class="label">ที่อยู่ :</span>
          <span class="value">${this.escapeHtml(company.address)}</span>
        </div>
        <div class="row">
          <span class="label">เลขที่ภาษี :</span>
          <span class="value">${this.escapeHtml(company.taxId)} (สำนักงานใหญ่)</span>
        </div>
        <div class="contacts">
          <span class="ct">${this.icon('phone', 13, '#9ca3af')} ${this.escapeHtml(company.phone || '063-134-6356')}</span>
          <span class="ct">${this.icon('mail', 13, '#9ca3af')} bestchoice2568@gmail.com</span>
        </div>
      </div>
      <div class="info-right-block">
        <div class="doc-row">
          <span class="doc-label">เลขที่เอกสาร :</span>
          <span class="doc-value">${this.escapeHtml(data.voucherNumber)}</span>
        </div>
        <div class="doc-row">
          <span class="doc-label">วันที่ออก :</span>
          <span class="doc-value">${this.escapeHtml(this.formatThaiDate(data.voucherDate))}</span>
        </div>
        <div class="doc-row">
          <span class="doc-label">อ้างอิง :</span>
          <span class="doc-value">-</span>
        </div>
      </div>

      <!-- Row 2: ผู้ขาย (walk-in) | ติดต่อกลับที่ -->
      <div class="info-block">
        <div class="row">
          <span class="label">ผู้ขาย :</span>
          <span class="value"><strong>${this.escapeHtml(data.sellerName)}</strong></span>
        </div>
        <div class="row">
          <span class="label">ที่อยู่ :</span>
          <span class="value">${this.escapeHtml(data.sellerAddress)}</span>
        </div>
        <div class="row">
          <span class="label">เลขบัตร ปชช. :</span>
          <span class="value">${this.escapeHtml(data.sellerIdCard)}</span>
        </div>
        <div class="contacts">
          <span class="ct">${this.icon('phone', 13, '#9ca3af')} ${this.escapeHtml(data.sellerPhone)}</span>
        </div>
      </div>
      <div class="info-right-block">
        <div class="lbl">ติดต่อกลับที่ :</div>
        <div class="ct">${this.icon('user', 14, '#9ca3af')} ${this.escapeHtml(data.issuerName)}</div>
        <div class="ct">${this.icon('phone', 14, '#9ca3af')} ${this.escapeHtml(company.phone || '063-134-6356')}</div>
        <div class="ct">${this.icon('mail', 14, '#9ca3af')} bestchoice2568@gmail.com</div>
      </div>
    </div>

    <!-- Items table -->
    <table class="items">
      <thead>
        <tr>
          <th class="center" style="width:60px">ลำดับ</th>
          <th>คำอธิบาย</th>
          <th class="center" style="width:90px">จำนวน</th>
          <th class="right" style="width:160px">จำนวนเงิน (฿)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="center">1</td>
          <td>
            ${this.renderItemLabel(data.deviceLabel)}
            ${this.renderImeiBadge(data.deviceLabel)}
          </td>
          <td class="center">1</td>
          <td class="right">${this.formatBaht(data.amount)}</td>
        </tr>
      </tbody>
    </table>

    <div class="spacer"></div>

    <!-- Summary -->
    <div class="summary-grid">
      <div class="summary-left">
        <div class="icon">${this.icon('clipboard', 18, '#4b5563')}</div>
        <div class="label">รวมเป็นเงิน</div>
        <div class="value">${this.formatBaht(data.amount)} บาท</div>
        <div class="baht-text">(${this.escapeHtml(data.amountText)})</div>
      </div>
      <div class="summary-right">
        <div class="total-box">
          <span class="total-label">จำนวนเงินทั้งสิ้น</span>
          <span class="total-amount">${this.formatBaht(data.amount)}<span class="unit">บาท</span></span>
        </div>
      </div>
    </div>

    <!-- Legal disclaimer -->
    <div class="legal-disclaimer">
      <div>ผู้ขายรับรองว่าเป็นเจ้าของเครื่องโดยชอบด้วยกฎหมาย และยินยอมให้บริษัทตรวจสอบที่มาของเครื่อง หากพบว่าเป็นทรัพย์สินที่ได้มาโดยมิชอบ ผู้ขายยินยอมให้ดำเนินคดีตามกฎหมาย</div>
      <div class="receiver"><strong>ผู้รับซื้อ:</strong> ${this.escapeHtml(data.issuerName)}</div>
    </div>

    <!-- Payment -->
    <div class="payment-section">
      <div class="icon">${this.icon('wallet', 18, '#4b5563')}</div>
      <div class="col">
        <div class="icon-label">ชำระเงิน</div>
        <div class="pay-row"><span class="label">วันที่ชำระ :</span><span class="value">${this.escapeHtml(this.formatThaiDate(data.voucherDate))}</span></div>
        <div class="pay-row"><span class="label">วิธีชำระ :</span><span class="value">${data.paymentMethod === 'CASH' ? 'เงินสด' : 'โอนเงิน'}</span></div>
      </div>
      <div class="col">
        ${
          data.paymentMethod === 'TRANSFER'
            ? `<div class="bank-row">
                 <span class="bank-icon">${this.icon('wallet', 14, '#fff')}</span>
                 <div class="bank-info">
                   <div class="bank-name">${this.escapeHtml(data.transferBankName || '-')}</div>
                   <div class="acc-num">${this.escapeHtml(data.transferAccountNumber || '-')}</div>
                   <div class="acc-name">${this.escapeHtml(data.transferAccountName || '-')}</div>
                 </div>
               </div>`
            : `<div class="bank-row">
                 <span class="bank-icon">${this.icon('banknote', 14, '#fff')}</span>
                 <div class="bank-info">
                   <div class="bank-name">รับเงินสด</div>
                   <div class="acc-name">โดย ${this.escapeHtml(data.issuerName)}</div>
                 </div>
               </div>`
        }
      </div>
      <div class="pay-amount">${this.formatBaht(data.amount)} บาท</div>
    </div>


    <!-- Signature: QR + Dual signers -->
    <div class="sig-section">
      <div class="icon">${this.icon('pen-tool', 18, '#4b5563')}</div>
      <div class="qr-col">
        <div class="qr-label">สแกนเพื่อตรวจสอบเอกสาร</div>
        <img src="${data.qrDataUrl}" alt="QR" style="width:100px;height:100px;display:block;margin:0 auto" />
      </div>
      <div class="signer-col">
        <div class="dual-signers">
          <!-- ผู้ออก (บริษัท) -->
          <div class="signer">
            <div class="signer-title">ผู้ออกใบสำคัญจ่ายเงิน</div>
            ${
              data.issuerSignatureBase64
                ? `<img src="${data.issuerSignatureBase64}" alt="signature" style="height:42px;display:block;margin-bottom:2px;object-fit:contain" />`
                : `<div class="signer-img">(รอลายเซ็น)</div>`
            }
            <div class="signer-line">
              <div class="signer-name">${this.escapeHtml(data.issuerName)}</div>
              <div class="signer-date">${this.escapeHtml(this.formatThaiDate(data.voucherDate))}</div>
            </div>
          </div>
          <!-- ผู้รับเงิน (ผู้ขาย) -->
          <div class="signer">
            <div class="signer-title">ผู้รับเงิน (ผู้ขาย)</div>
            ${
              data.sellerSignatureBase64
                ? `<img src="${data.sellerSignatureBase64}" alt="seller signature" style="height:42px;display:block;margin-bottom:2px;object-fit:contain" />`
                : `<div class="signer-img">(รอลายเซ็น)</div>`
            }
            <div class="signer-line">
              <div class="signer-name">${this.escapeHtml(data.sellerName)}</div>
              <div class="signer-date">${this.escapeHtml(this.formatThaiDate(data.voucherDate))}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Page footer -->
    <div class="page-footer">
      <span>${this.escapeHtml(data.voucherNumber)}</span>
      <span>ออกโดยระบบ BESTCHOICE</span>
      <span>หน้า 1 / 1</span>
    </div>
    </div><!-- /.content -->
  </div>
</body>
</html>`;
  }

  /** แยกบรรทัดหลัก/รอง ของ deviceLabel — แสดงเฉพาะข้อมูลที่ไม่ใช่ IMEI (IMEI แสดงเป็น badge แยก) */
  private renderItemLabel(label: string): string {
    const parts = label.split('\n');
    const main = parts[0] || '';
    // เอา IMEI ออกจาก sub line (จะแสดงเป็น badge แยก)
    const sub = parts.slice(1).join(' ').replace(/IMEI\s+\d+/, '').trim();
    return `<div class="item-main">${this.escapeHtml(main)}</div>${sub ? `<div class="item-sub">${this.escapeHtml(sub)}</div>` : ''}`;
  }

  /** Render IMEI เป็น badge เด่น (ถ้ามีใน deviceLabel) */
  private renderImeiBadge(label: string): string {
    const m = label.match(/IMEI\s+(\d+)/);
    if (!m) return '';
    return `<div class="imei-badge"><span class="lbl">IMEI</span>${this.escapeHtml(m[1])}</div>`;
  }

  // ─── Font cache (base64) — โหลด TTF ครั้งเดียว ใช้ทุกครั้ง ──
  private cachedFontCss: string | null | undefined;
  private resolveFontCss(): string | null {
    if (this.cachedFontCss !== undefined) return this.cachedFontCss;
    try {
      const fontPaths = [
        path.join(process.cwd(), 'public', 'fonts'),
        path.join(__dirname, '..', '..', '..', '..', '..', 'public', 'fonts'),
        path.join(process.cwd(), '..', 'web', 'public', 'fonts'),
      ];
      const fontsDir = fontPaths.find((p) =>
        fs.existsSync(path.join(p, 'THSarabunPSK-Regular.ttf')),
      );
      if (!fontsDir) {
        this.cachedFontCss = null;
        return null;
      }
      const reg = path.join(fontsDir, 'THSarabunPSK-Regular.ttf');
      const bold = path.join(fontsDir, 'THSarabunPSK-Bold.ttf');
      let css = '';
      if (fs.existsSync(reg)) {
        css += `@font-face{font-family:'TH Sarabun PSK';src:url(data:font/truetype;base64,${fs
          .readFileSync(reg)
          .toString('base64')}) format('truetype');font-weight:400;font-style:normal;}`;
      }
      if (fs.existsSync(bold)) {
        css += `@font-face{font-family:'TH Sarabun PSK';src:url(data:font/truetype;base64,${fs
          .readFileSync(bold)
          .toString('base64')}) format('truetype');font-weight:700;font-style:normal;}`;
      }
      this.cachedFontCss = css || null;
      return this.cachedFontCss;
    } catch (err) {
      this.logger.warn(`Font preload failed: ${err instanceof Error ? err.message : err}`);
      this.cachedFontCss = null;
      return null;
    }
  }

  // ─── Shared browser (singleton) — ลดเวลา launch Chromium ลง ──
  private static sharedBrowser: Promise<unknown> | null = null;
  private async getBrowser() {
    const puppeteer = await import('puppeteer');
    if (!TradeInVoucherService.sharedBrowser) {
      TradeInVoucherService.sharedBrowser = puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    }
    try {
      const browser = (await TradeInVoucherService.sharedBrowser) as {
        newPage: () => Promise<unknown>;
        connected?: boolean;
        process?: () => unknown;
      };
      if (browser.connected === false || !browser.process?.()) {
        TradeInVoucherService.sharedBrowser = puppeteer.default.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        return (await TradeInVoucherService.sharedBrowser) as {
          newPage: () => Promise<unknown>;
        };
      }
      return browser as { newPage: () => Promise<unknown> };
    } catch {
      TradeInVoucherService.sharedBrowser = puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      return (await TradeInVoucherService.sharedBrowser) as {
        newPage: () => Promise<unknown>;
      };
    }
  }

  // ─── PDF render (puppeteer) ───────────────────────────────
  private async htmlToPdf(html: string): Promise<Buffer> {
    // Inject fonts เข้า <head> ของ HTML ก่อนส่งให้ Chromium
    // (ก่อนหน้านี้ใช้ addStyleTag หลัง setContent — ฟอนต์มาช้า text render ไม่ทัน)
    const fontCss = this.resolveFontCss();
    const htmlWithFonts = fontCss
      ? html.replace('</head>', `<style>${fontCss}</style></head>`)
      : html;

    const browser = await this.getBrowser();
    const page = (await browser.newPage()) as {
      setContent: (html: string, opts: { waitUntil: string; timeout: number }) => Promise<void>;
      evaluateHandle: (fn: string) => Promise<unknown>;
      pdf: (opts: {
        format: string;
        printBackground: boolean;
        preferCSSPageSize: boolean;
      }) => Promise<Uint8Array>;
      close: () => Promise<void>;
    };
    try {
      // domcontentloaded + รอ fonts ready — เร็วกว่า networkidle0 มาก
      // เพราะเนื้อหาเป็น self-contained HTML ไม่มี external network call
      await page.setContent(htmlWithFonts, { waitUntil: 'domcontentloaded', timeout: 15000 });
      try {
        await page.evaluateHandle('document.fonts.ready');
      } catch {
        // fonts API อาจไม่พร้อม — ไม่ block PDF
      }

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
