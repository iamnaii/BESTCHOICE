import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_RECEIPT_WARRANTY_TERMS, RECEIPT_WARRANTY_TERMS_KEY } from '@installment/shared';
import * as puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { embeddedDocumentFonts } from '../../../assets/fonts/document-fonts';
import { PrismaService } from '../../../prisma/prisma.service';
import type { SalesReadActor } from '../sales-read.types';
import { bookingReceipt, bookingReceiptSelect } from './booking-receipt';
import { buildSaleReceiptHtml, toSaleReceiptModel, type SaleForReceipt } from './sale-receipt-html';
import { SaleReceiptTokenService } from './sale-receipt-token.service';
import { salesBranchWhere } from './sales-read-policy';
import { SALE_TENDERS_SELECT } from './sales-query.service';

export const INSTALLMENT_RECEIPT_MSG = 'ใบขายผ่อนชำระใช้ใบเสร็จของสัญญา';

/** ข้อความเงื่อนไขประกันร้านท้ายใบเสร็จ — แก้ได้ที่ ตั้งค่า › สินค้า & การขาย › ใบเสร็จขายสด */
export async function loadReceiptTerms(prisma: PrismaService): Promise<string> {
  const row = await prisma.systemConfig.findUnique({ where: { key: RECEIPT_WARRANTY_TERMS_KEY } });
  return row?.value?.trim() || DEFAULT_RECEIPT_WARRANTY_TERMS;
}

const RECEIPT_SALE_INCLUDE = {
  customer: { select: { name: true, phone: true, legacyMemberCode: true } },
  product: { select: { name: true, brand: true, model: true, storage: true, imeiSerial: true, serialNumber: true, category: true } },
  branch: { select: { name: true } },
  salesperson: { select: { name: true } },
  shopTenders: SALE_TENDERS_SELECT,
  booking: { select: bookingReceiptSelect },
} satisfies Prisma.SaleInclude;

/**
 * ใบเสร็จรับเงินขายสด (ก้อน 4 · 2026-10-23) — เรนเดอร์สดจาก `Sale` ทุกครั้ง ไม่สร้างแถว `Receipt`
 * (`Receipt.contractId` บังคับ) แบบเดียวกับใบเสร็จรายได้อื่น (`other-income/services/receipt-pdf.service.ts`).
 *
 * - `actor` มี = เส้นทางพนักงาน: ขอบเขตสาขาเดิมของ `/sales` (`salesBranchWhere`) · ใบยกเลิกเปิดได้พร้อมลายน้ำ
 * - `actor` null = เส้นทางสาธารณะผ่าน token: ใบยกเลิก = ไม่พบ
 * - ออก/ต่ออายุ token ทุกครั้ง เพราะ QR บนกระดาษชี้ลิงก์สาธารณะ
 */
@Injectable()
export class SaleReceiptPdfService {
  private readonly logger = new Logger(SaleReceiptPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SaleReceiptTokenService,
  ) {}

  async generate(saleId: string, actor: SalesReadActor | null): Promise<{ pdf: Buffer; saleNumber: string; voided: boolean }> {
    const where: Prisma.SaleWhereInput = actor
      ? { AND: [{ id: saleId }, salesBranchWhere(actor)] }
      : { id: saleId, deletedAt: null };
    const sale = await this.prisma.sale.findFirst({ where, include: RECEIPT_SALE_INCLUDE });
    if (!sale) throw new NotFoundException('ไม่พบใบขาย');
    if (sale.saleType !== 'CASH' && sale.saleType !== 'EXTERNAL_FINANCE') {
      throw new BadRequestException(INSTALLMENT_RECEIPT_MSG);
    }

    const [bundleProducts, company, terms, { token }] = await Promise.all([
      sale.bundleProductIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: sale.bundleProductIds } },
            select: { name: true, imeiSerial: true, legacyProductCode: true },
          })
        : Promise.resolve([]),
      this.prisma.companyInfo.findFirst({ where: { companyCode: 'SHOP' } }),
      loadReceiptTerms(this.prisma),
      this.tokens.ensureToken(sale.id),
    ]);

    const qrDataUrl = await QRCode.toDataURL(this.tokens.publicUrl(token), {
      margin: 0,
      width: 220,
      color: { dark: '#172b25', light: '#ffffff' },
    });

    const input: SaleForReceipt = { ...sale, bundleProducts, receiptBreakdown: bookingReceipt(sale) };
    const model = toSaleReceiptModel(input, {
      company: company ? { nameTh: company.nameTh, address: company.address, taxId: company.taxId, phone: company.phone } : null,
      terms,
      qrDataUrl,
    });
    const html = buildSaleReceiptHtml(model, embeddedDocumentFonts());

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      // ฟอนต์ฝังเป็น data: URI ทั้งหมด — ไม่มี request ออกนอก จึงรอแค่ parse เอกสาร
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      await page.evaluate('document.fonts.ready');
      const pdf = await page.pdf({ format: 'A4', margin: { top: '0', right: '0', bottom: '0', left: '0' }, printBackground: true });
      return { pdf: Buffer.from(pdf), saleNumber: sale.saleNumber, voided: !!sale.deletedAt };
    } finally {
      try {
        await browser.close();
      } catch (err) {
        this.logger.warn(`[sale-receipt] browser.close failed: ${String(err)}`);
      }
    }
  }
}
