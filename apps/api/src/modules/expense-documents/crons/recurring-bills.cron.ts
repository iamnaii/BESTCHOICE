import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { RecurringBillsService, type RunDailyResult } from '../recurring-bills/recurring-bills.service';

/**
 * ก้อน 6 — บิลประจำ (D5): รอบตรวจรายวัน 08:05 เวลาไทย (แทน `expense-recurring.cron.ts` เดิมที่สร้างร่างเงียบ ๆ
 * และข้ามวันที่ 29–31 ในเดือนสั้น). ตรรกะทั้งหมดอยู่ใน `RecurringBillsService.runDaily` — cron เป็นแค่ผู้เรียก
 * พร้อมล็อกกันหลาย instance: Cloud Run รัน scheduler ทุก instance (min 1 / max 10) จึงขอ
 * `pg_try_advisory_xact_lock` ใน transaction เดียว (ล็อกระดับ session ใช้ไม่ได้กับ connection pool —
 * unlock อาจไปลงคนละ connection) แล้วทำงานด้วย root prisma ระหว่างที่ tx ถือล็อกอยู่.
 * ห้าม throw ออกจาก tick — scheduler ต้องไม่ตาย.
 */
@Injectable()
export class RecurringBillsCron {
  private readonly logger = new Logger(RecurringBillsCron.name);
  static readonly LOCK_KEY = 'recurring-bills:tick';
  /** เวลาสูงสุดที่ถือล็อก/connection — รอบปกติจบในหลักวินาที */
  static readonly LOCK_TIMEOUT_MS = 10 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: RecurringBillsService,
  ) {}

  @Cron('5 8 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<RunDailyResult | null> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${RecurringBillsCron.LOCK_KEY})) AS locked`;
          if (!rows?.[0]?.locked) {
            this.logger.log('[recurring-bills] instance อื่นถือล็อกรอบนี้อยู่ — ข้าม');
            return null;
          }
          return this.service.runDaily(new Date());
        },
        { timeout: RecurringBillsCron.LOCK_TIMEOUT_MS },
      );
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'recurring-bills', scope: 'tick' } });
      this.logger.error(`[recurring-bills] tick failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
