import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { VoucherNumberService } from './voucher/voucher-number.service';
import { VoucherHtmlBuilder } from './voucher/voucher-html.builder';
import { VoucherPdfRenderer } from './voucher/voucher-pdf.renderer';

/**
 * Voucher Service — สร้างใบสำคัญจ่ายเงินเงิน (Expense Voucher) สำหรับรายการรับซื้อมือถือ (Trade-In)
 *
 * - เลขที่ใบสำคัญรูปแบบ: EXP-YYYYMMNNNNN  (เช่น EXP-20260300064)
 * - Reset เลขลำดับทุกเดือน เริ่ม 00001
 * - PDF render ด้วย puppeteer + อัปขึ้น S3 ผ่าน StorageService
 *
 * Facade — keeps the public surface (allocate / renderPdf) + the (prisma, storage)
 * constructor stable while delegating to three internally-constructed sub-services:
 *  - VoucherNumberService  (EXP-YYYYMMNNNNN sequence + tx + P2002 retry + idempotency)
 *  - VoucherHtmlBuilder    (pure inline HTML/CSS template + presentation helpers)
 *  - VoucherPdfRenderer    (puppeteer htmlToPdf + cross-instance shared-browser singleton)
 */
@Injectable()
export class TradeInVoucherService {
  private readonly numbers: VoucherNumberService;
  private readonly builder: VoucherHtmlBuilder;
  private readonly renderer: VoucherPdfRenderer;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {
    this.numbers = new VoucherNumberService(prisma);
    this.builder = new VoucherHtmlBuilder();
    this.renderer = new VoucherPdfRenderer();
  }

  // ─── Allocate voucher number (no PDF — render on-demand) ──
  async allocate(tradeInId: string): Promise<{
    voucherNumber: string;
    voucherDate: Date;
  }> {
    return this.numbers.allocate(tradeInId);
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

    const html = this.builder.buildHtml({
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
      deviceLabel: this.builder.buildDeviceLabel(tradeIn),
      amount,
      amountText: this.builder.numberToThaiBahtText(amount),
      paymentMethod: (tradeIn.paymentMethod as 'CASH' | 'TRANSFER' | null) ?? 'CASH',
      transferBankName: tradeIn.transferBankName,
      transferAccountNumber: tradeIn.transferAccountNumber,
      transferAccountName: tradeIn.transferAccountName,
    });

    const buffer = await this.renderer.htmlToPdf(html);
    return { buffer, voucherNumber: tradeIn.voucherNumber };
  }
}
