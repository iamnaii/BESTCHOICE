import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
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

  /** advisory lock แบบ RecurringBillsCron — Cloud Run รัน scheduler ทุก instance (รีวิว I4) · ล็อกระดับ tx เพราะ connection pool */
  static readonly LOCK_KEY = 'cash-close-alerts:tick';
  static readonly LOCK_TIMEOUT_MS = 5 * 60_000;

  async tick(now: Date = new Date()): Promise<{ missed: number; awaiting: number } | null> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${CashCloseAlertsCron.LOCK_KEY})) AS locked`;
          if (!rows?.[0]?.locked) {
            this.logger.log('[cash-close-alerts] instance อื่นถือล็อกรอบนี้อยู่ — ข้าม');
            return null;
          }
          return this.run(tx, now);
        },
        { timeout: CashCloseAlertsCron.LOCK_TIMEOUT_MS },
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'cash-close-alerts' } });
      this.logger.error(`cash-close alerts cron failed: ${(err as Error).message}`);
      return { missed: 0, awaiting: 0 };
    }
  }

  private async run(db: Prisma.TransactionClient, now: Date): Promise<{ missed: number; awaiting: number }> {
    const unclosed = await findUnclosedYesterday(db, now);
    for (const { branchId, branchName, date, cashIn } of unclosed) {
      await this.staffNotify?.notify('cash_close.missed', {
        title: `${branchName} ยังไม่ปิดยอดเงินสดของเมื่อวาน`,
        lines: [`${date} เงินสดเข้า ${cashIn.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท แต่ไม่มีใบปิดยอด`],
        link: '/shop/daily-cash', // หน้าไม่อ่าน ?branch= (รีวิว I5)
        branchId,
        dedupeKey: `${branchId}:${date}`,
      });
    }

    const awaiting = await db.shopCashClose.count({ where: staleAwaitingConfirmWhere(now) });
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
  }
}
