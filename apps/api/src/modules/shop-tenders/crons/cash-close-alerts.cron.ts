import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { bangkokDateString } from '../../../utils/date.util';
import { StaffNotifyService } from '../../staff-notify/staff-notify.service';
import { findUnclosedYesterday, staleAwaitingConfirmWhere } from '../shop-cash-close.service';

/**
 * ก้อน 7 A16 — เตือน LINE พนักงานเรื่องเงินสดหน้าร้าน วันละครั้ง 10:00 ไทย (คำตัดสินผม — spec §13.6 ข้อ 8):
 *  - `cash_close.missed`  สาขาที่เมื่อวานมีเงินสดเข้าแต่ไม่มีใบปิดยอด (สูตรเดียวกับแถบเตือนบนหน้าขาย — `findUnclosedYesterday`)
 *    ถึงเจ้าของ + ผจก.สาขานั้น (rule มี branchScoped) · กันซ้ำ สาขา:วันที่
 *  - `cash_close.awaiting` ยอดที่นับแล้วแต่รอยืนยันรับเงินเกิน 1 วัน (`staleAwaitingConfirmWhere`) · ครั้งเดียวต่อวัน
 * ไม่ล็อกการขาย ไม่ throw — cron พังต้องไม่ล้ม scheduler (Sentry อย่างเดียว)
 */
@Injectable()
export class CashCloseAlertsCron {
  private readonly logger = new Logger(CashCloseAlertsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly staffNotify?: StaffNotifyService,
  ) {}

  @Cron('0 10 * * *', { timeZone: 'Asia/Bangkok' })
  async handle(): Promise<void> {
    await this.tick();
  }

  async tick(now: Date = new Date()): Promise<{ missed: number; awaiting: number }> {
    try {
      const unclosed = await findUnclosedYesterday(this.prisma, now);
      for (const { branchId, branchName, date, cashIn } of unclosed) {
        await this.staffNotify?.notify('cash_close.missed', {
          title: `${branchName} ยังไม่ปิดยอดเงินสดของเมื่อวาน`,
          lines: [`${date} เงินสดเข้า ${cashIn.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท แต่ไม่มีใบปิดยอด`],
          link: `/shop/daily-cash?branch=${branchId}`,
          branchId,
          dedupeKey: `${branchId}:${date}`,
        });
      }

      const awaiting = await this.prisma.shopCashClose.count({ where: staleAwaitingConfirmWhere(now) });
      if (awaiting > 0) {
        await this.staffNotify?.notify('cash_close.awaiting', {
          title: `มี ${awaiting} ยอดเงินสดที่นับแล้ว รอยืนยันรับเงินเกิน 1 วัน`,
          lines: [],
          link: '/shop/daily-cash',
          dedupeKey: bangkokDateString(now),
        });
      }

      this.logger.log(`cash-close alerts: missed=${unclosed.length} awaiting=${awaiting}`);
      return { missed: unclosed.length, awaiting };
    } catch (err) {
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'cash-close-alerts' } });
      this.logger.error(`cash-close alerts cron failed: ${(err as Error).message}`);
      return { missed: 0, awaiting: 0 };
    }
  }
}
