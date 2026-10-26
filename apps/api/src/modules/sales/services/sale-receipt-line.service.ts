import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { fmtMoney } from '../../../utils/document-format.util';
import { LineOaService } from '../../line-oa/line-oa.service';
import { COLORS, wrapFlexMessage, type FlexBubble, type FlexMessagePayload } from '../../line-oa/flex-messages/base-template';
import type { SalesReadActor } from '../sales-read.types';
import { INSTALLMENT_RECEIPT_MSG } from './sale-receipt-pdf.service';
import { SaleReceiptTokenService } from './sale-receipt-token.service';
import { salesBranchWhere } from './sales-read-policy';

export type SaleReceiptLineResult = { delivered: true } | { delivered: false; reason: 'NO_LINE_LINK' | 'PUSH_FAILED' };

export function buildSaleReceiptFlex(input: {
  saleNumber: string;
  deviceName: string;
  amountLabel: string;
  amountText: string;
  url: string;
}): FlexMessagePayload {
  const bubble: FlexBubble = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'ใบเสร็จรับเงิน', weight: 'bold', size: 'lg', color: COLORS.PRIMARY },
        { type: 'text', text: input.deviceName, weight: 'bold', size: 'md', margin: 'md', wrap: true },
        { type: 'text', text: `เลขที่ ${input.saleNumber}`, size: 'sm', color: COLORS.MUTED, margin: 'sm' },
        { type: 'separator', margin: 'lg' },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'lg',
          contents: [
            { type: 'text', text: input.amountLabel, size: 'sm', color: COLORS.MUTED, flex: 4 },
            { type: 'text', text: input.amountText, size: 'sm', weight: 'bold', flex: 5, align: 'end' },
          ],
        },
        { type: 'text', text: 'ลิงก์ใช้ได้ 30 วัน', size: 'xs', color: COLORS.MUTED, margin: 'lg', wrap: true },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLORS.PRIMARY,
          action: { type: 'uri', label: 'เปิดใบเสร็จ', uri: input.url },
        },
      ],
    },
  };
  return wrapFlexMessage(`ใบเสร็จรับเงิน ${input.saleNumber}`, bubble);
}

/**
 * ส่งลิงก์ใบเสร็จขายสดเข้า LINE OA ร้าน (ก้อน 4 · 2026-10-23) — ผู้เรียกคือปุ่ม "ส่ง LINE" ของพนักงาน
 * จึง **ไม่ throw** เมื่อส่งไม่ได้: คืนเหตุผลให้หน้าจอบอกทางออก (คัดลอกลิงก์แทน) และบันทึก NotificationLog
 * ทุกครั้งแบบเดียวกับ `sale-warranty-notifier.service.ts`. ไม่ gate PDPA — เอกสารการเงินของธุรกรรมที่ลูกค้าทำเอง.
 */
@Injectable()
export class SaleReceiptLineService {
  private readonly logger = new Logger(SaleReceiptLineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly line: LineOaService,
    private readonly tokens: SaleReceiptTokenService,
  ) {}

  async send(saleId: string, actor: SalesReadActor): Promise<SaleReceiptLineResult> {
    const sale = await this.prisma.sale.findFirst({
      where: { AND: [{ id: saleId }, salesBranchWhere(actor)] },
      select: {
        id: true,
        saleNumber: true,
        saleType: true,
        netAmount: true,
        downPaymentAmount: true,
        deletedAt: true,
        customer: { select: { id: true, lineIdShop: true } },
        product: { select: { brand: true, model: true, storage: true } },
      },
    });
    if (!sale) throw new NotFoundException('ไม่พบใบขาย');
    if (sale.saleType !== 'CASH' && sale.saleType !== 'EXTERNAL_FINANCE') {
      throw new BadRequestException(INSTALLMENT_RECEIPT_MSG);
    }
    if (sale.deletedAt) throw new BadRequestException('ใบขายนี้ถูกยกเลิกแล้ว');

    const altText = `ใบเสร็จรับเงิน ${sale.saleNumber}`;
    const to = sale.customer?.lineIdShop;
    if (!to) {
      await this.log(sale.id, sale.customer?.id ?? null, null, altText, 'FAILED', 'ลูกค้ายังไม่ผูก LINE ร้าน');
      return { delivered: false, reason: 'NO_LINE_LINK' };
    }

    const { token } = await this.tokens.ensureToken(sale.id);
    const isFinance = sale.saleType === 'EXTERNAL_FINANCE';
    const amount = isFinance ? sale.downPaymentAmount ?? sale.netAmount : sale.netAmount;
    const flex = buildSaleReceiptFlex({
      saleNumber: sale.saleNumber,
      deviceName: [sale.product?.brand, sale.product?.model, sale.product?.storage].filter(Boolean).join(' ') || 'สินค้า',
      amountLabel: isFinance ? 'เงินดาวน์' : 'ยอดสุทธิ',
      amountText: `${fmtMoney(new Prisma.Decimal(amount ?? 0).toNumber())} บาท`,
      url: this.tokens.publicUrl(token),
    });

    try {
      await this.line.sendFlexMessage(to, flex, 'line-shop');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[sale-receipt-line] ส่งไม่สำเร็จ sale=${sale.saleNumber}: ${message}`);
      await this.log(sale.id, sale.customer?.id ?? null, to, altText, 'FAILED', message);
      return { delivered: false, reason: 'PUSH_FAILED' };
    }
    await this.log(sale.id, sale.customer?.id ?? null, to, altText, 'SENT', null);
    return { delivered: true };
  }

  private async log(
    saleId: string,
    customerId: string | null,
    recipient: string | null,
    message: string,
    status: 'SENT' | 'FAILED',
    errorMsg: string | null,
  ): Promise<void> {
    try {
      await this.prisma.notificationLog.create({
        data: {
          channel: 'LINE',
          channelKey: 'line-shop',
          recipient: recipient ?? '',
          subject: 'ใบเสร็จรับเงิน',
          message,
          status,
          errorMsg,
          sentAt: status === 'SENT' ? new Date() : null,
          relatedId: saleId,
          customerId,
          category: 'TRANSACTIONAL',
        },
      });
    } catch (err) {
      // บันทึก log ล้มต้องไม่ทำให้ผลการส่งเพี้ยน — เงินและเอกสารไม่เกี่ยวกับแถวนี้
      this.logger.error(`[sale-receipt-line] notificationLog.create ล้มเหลว sale=${saleId}`, err as Error);
    }
  }
}
