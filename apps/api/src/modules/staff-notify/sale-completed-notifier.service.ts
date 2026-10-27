import { Injectable, Logger, Optional } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { StaffNotifyService } from './staff-notify.service';

/**
 * ก้อน 7 (A16) — "ขายสดสำเร็จ" ใช้ร่วมกันระหว่างหน้าขาย (SaleCreationService) และแปลงใบจองเป็นใบขาย (BookingsService)
 * เรียกหลัง commit แบบ fire-and-forget · โหลดใบขายเองเพื่อไม่ให้ผู้เรียกต้องรู้รูปข้อความ · ไม่ throw
 */
@Injectable()
export class SaleCompletedNotifier {
  private readonly logger = new Logger(SaleCompletedNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly staffNotify?: StaffNotifyService,
  ) {}

  async notify(saleId: string): Promise<void> {
    if (!this.staffNotify) return;
    try {
      const sale = (await this.prisma.sale.findUnique({
        where: { id: saleId },
        select: {
          id: true,
          saleNumber: true,
          netAmount: true,
          branchId: true,
          branch: { select: { name: true } },
          product: { select: { brand: true, model: true, storage: true } },
          salesperson: { select: { name: true } },
        },
      })) as {
        id: string;
        saleNumber: string;
        netAmount: unknown;
        branchId: string;
        branch: { name: string } | null;
        product: { brand: string | null; model: string | null; storage: string | null } | null;
        salesperson: { name: string } | null;
      } | null;
      if (!sale) return;
      const productLabel = [sale.product?.brand, sale.product?.model, sale.product?.storage].filter(Boolean).join(' ') || 'สินค้า';
      const amount = Number(sale.netAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      await this.staffNotify.notify('sale.completed', {
        title: `ขายสดสำเร็จ ${sale.saleNumber}`,
        lines: [`สาขา ${sale.branch?.name ?? '—'}`, `${productLabel} · ${amount} บาท`, `โดย ${sale.salesperson?.name ?? '—'}`],
        link: '/sales', // หน้า /sales/:id ไม่มี (รีวิว I5)
        branchId: sale.branchId,
        dedupeKey: sale.id,
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { subsystem: 'staff-notify', event: 'sale.completed' }, extra: { saleId } });
      this.logger.warn(`[sale.completed] notify failed for ${saleId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
