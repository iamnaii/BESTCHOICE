import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import {
  wrapFlexMessage,
  COLORS,
  type FlexBubble,
} from '../../line-oa/flex-messages/base-template';

/** เวลาไทยแบบอ่านง่าย เช่น "27 ส.ค. 2569" */
function thaiDate(d: Date): string {
  return d.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * ส่งการ์ดประกันทาง LINE OA **ร้าน** หลังขายสด/ไฟแนนซ์นอกเสร็จ
 *
 * กติกาการเรียก (ตาม pattern ของใบลดหนี้ `CreditNoteDeliveryService`):
 *   - เรียก **หลัง** `$transaction` ของการขาย commit แล้วเท่านั้น
 *   - เรียกแบบ fire-and-forget (`void notify(...)`) — **ห้าม await บนเส้นทางการขาย**
 *     และเมธอดนี้ไม่ throw ออกไปเลย ⇒ LINE ล่มไม่ทำให้ขายของไม่ได้
 *
 * ไม่มี auto-retry (เหมือนใบลดหนี้): ล้มเหลว → แถว `NotificationLog` สถานะ FAILED
 * ไว้ให้ตามส่งซ้ำทีหลัง ดีกว่าปล่อยคิว retry ที่ส่งซ้ำเป็นข้อความล้วนไม่ใช่การ์ด
 */
@Injectable()
export class SaleWarrantyNotifierService {
  private readonly logger = new Logger(SaleWarrantyNotifierService.name);

  constructor(
    private prisma: PrismaService,
    private line: LineOaService,
    private integrationConfig: IntegrationConfigService,
  ) {}

  async notify(saleId: string): Promise<void> {
    try {
      const sale = await this.prisma.sale.findFirst({
        where: { id: saleId, deletedAt: null },
        select: {
          id: true,
          saleNumber: true,
          shopWarrantyEndDate: true,
          customer: { select: { id: true, name: true, lineIdShop: true } },
          product: { select: { brand: true, model: true, storage: true, imeiSerial: true } },
        },
      });

      // ไม่มีประกันร้าน (เช่น เครื่องใหม่ที่ใช้ประกันศูนย์อย่างเดียว) = ไม่มีอะไรต้องแจ้ง
      if (!sale?.shopWarrantyEndDate || !sale.product) return;

      // ลูกค้ายังไม่ได้ผูก LINE กับ OA ร้าน — ส่งไม่ได้ และไม่ใช่ความผิดพลาด
      // (ลูกค้าเดินเข้าร้านซื้อสดส่วนใหญ่ยังไม่ผูก — ผูกได้โดยพิมพ์เบอร์โทรคุยกับ OA)
      const to = sale.customer?.lineIdShop;
      if (!to) {
        this.logger.debug(`[warranty-line] sale ${sale.saleNumber}: ลูกค้ายังไม่ผูก LINE ร้าน`);
        return;
      }

      const deviceName = [sale.product.brand, sale.product.model, sale.product.storage]
        .filter(Boolean)
        .join(' ');
      const endText = thaiDate(sale.shopWarrantyEndDate);
      const altText = `ประกันร้าน ${deviceName} ถึง ${endText}`;

      let status = 'SENT';
      let errorMsg: string | null = null;
      try {
        await this.line.sendFlexMessage(
          to,
          wrapFlexMessage(altText, await this.buildBubble(deviceName, sale.product.imeiSerial, endText)),
          'line-shop',
        );
      } catch (err) {
        status = 'FAILED';
        errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[warranty-line] ส่งไม่สำเร็จ sale=${sale.saleNumber}: ${errorMsg}`);
      }

      await this.prisma.notificationLog.create({
        data: {
          channel: 'LINE',
          channelKey: 'line-shop',
          recipient: to,
          subject: 'ประกันสินค้า',
          message: altText,
          status,
          errorMsg,
          sentAt: status === 'SENT' ? new Date() : null,
          relatedId: sale.id,
          // customerId + category ให้ frequency cap / การตามส่งซ้ำมองเห็นแถวนี้
          customerId: sale.customer?.id ?? null,
          category: 'TRANSACTIONAL',
        },
      });
    } catch (err) {
      // ห้าม throw — เส้นทางการขาย commit ไปแล้ว
      this.logger.error(`[warranty-line] notify ล้มเหลวทั้งก้อน sale=${saleId}`, err);
      Sentry.captureException(err, { tags: { subsystem: 'warranty-line' } });
    }
  }

  private async buildBubble(
    deviceName: string,
    imei: string | null,
    endText: string,
  ): Promise<FlexBubble> {
    const liffId = (await this.integrationConfig.getValue('line-shop', 'liffId')) || '';

    const bubble: FlexBubble = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'ประกันสินค้า', weight: 'bold', size: 'lg', color: COLORS.PRIMARY },
          { type: 'text', text: deviceName, weight: 'bold', size: 'md', margin: 'md', wrap: true },
          ...(imei
            ? [
                {
                  type: 'text' as const,
                  text: `IMEI ${imei}`,
                  size: 'xs' as const,
                  color: COLORS.MUTED,
                  margin: 'sm' as const,
                },
              ]
            : []),
          { type: 'separator', margin: 'lg' },
          {
            type: 'box',
            layout: 'baseline',
            margin: 'lg',
            contents: [
              { type: 'text', text: 'ประกันร้านถึง', size: 'sm', color: COLORS.MUTED, flex: 4 },
              { type: 'text', text: endText, size: 'sm', weight: 'bold', flex: 5, align: 'end' },
            ],
          },
          {
            type: 'text',
            text: 'เก็บข้อความนี้ไว้ใช้ตอนเคลมได้เลย',
            size: 'xs',
            color: COLORS.MUTED,
            margin: 'lg',
            wrap: true,
          },
        ],
      },
      // ปุ่มจะโผล่ก็ต่อเมื่อตั้ง LIFF ID ไว้แล้วเท่านั้น — ปุ่มที่กดแล้วพาไปหน้าเปล่า
      // แย่กว่าไม่มีปุ่ม
      ...(liffId
        ? {
            footer: {
              type: 'box' as const,
              layout: 'vertical' as const,
              contents: [
                {
                  type: 'button' as const,
                  style: 'primary' as const,
                  color: COLORS.PRIMARY,
                  action: {
                    type: 'uri' as const,
                    label: 'ดูประกันทั้งหมด',
                    uri: `https://liff.line.me/${liffId}/liff/warranty`,
                  },
                },
              ],
            },
          }
        : {}),
    };
    return bubble;
  }
}
