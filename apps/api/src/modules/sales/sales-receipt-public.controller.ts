import { Controller, Get, Logger, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SaleReceiptPdfService } from './services/sale-receipt-pdf.service';
import { SaleReceiptTokenService } from './services/sale-receipt-token.service';

export const PUBLIC_RECEIPT_NOT_FOUND_MSG = 'ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว';

/**
 * ลิงก์สาธารณะของใบเสร็จขายสด (ก้อน 4 · 2026-10-23) — ปุ่ม "เปิดใบเสร็จ" ใน LINE / QR บนกระดาษ / ลิงก์ที่พนักงานคัดลอกส่ง.
 *
 * แยก controller เพราะ `SalesController` มี `JwtAuthGuard`/`RolesGuard`/`BranchGuard` ระดับ class.
 * สิทธิ์ = token อย่างเดียว (256-bit random · อายุ 30 วัน ต่ออายุทุกครั้งที่ออกเอกสาร · ใบยกเลิก = ไม่พบ)
 * ไม่รู้จัก/หมดอายุ/ยกเลิก ตอบ 404 ข้อความเดียวกัน · throttle 10/นาที · อ่านอย่างเดียว · ไม่ log token.
 * ดู `.claude/rules/security.md` รายการ `sales-receipt-public`.
 */
@ApiTags('Sales')
@Controller('sales/receipt/public')
export class SalesReceiptPublicController {
  private readonly logger = new Logger(SalesReceiptPublicController.name);

  constructor(
    private readonly tokens: SaleReceiptTokenService,
    private readonly receiptPdf: SaleReceiptPdfService,
  ) {}

  @Get(':token/pdf')
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  async getPublicPdf(@Param('token') token: string, @Res() res: Response) {
    const saleId = await this.tokens.findSaleIdByToken(token);
    if (!saleId) throw new NotFoundException(PUBLIC_RECEIPT_NOT_FOUND_MSG);

    this.logger.log(`[sales-receipt-public] serving receipt PDF — saleId=${saleId}`);
    const { pdf, saleNumber } = await this.receiptPdf.generate(saleId, null);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(`ใบเสร็จ-${saleNumber}`)}.pdf"`,
      'Cache-Control': 'private, no-store',
      'Content-Length': pdf.length.toString(),
    });
    res.send(pdf);
  }
}
