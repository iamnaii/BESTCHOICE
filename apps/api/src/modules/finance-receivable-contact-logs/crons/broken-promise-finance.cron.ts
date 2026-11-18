import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { bangkokStartOfDay } from '../../../utils/date.util';

@Injectable()
export class BrokenPromiseFinanceCron {
  private readonly logger = new Logger(BrokenPromiseFinanceCron.name);

  constructor(private prisma: PrismaService) {}

  // Daily at 02:00 Asia/Bangkok
  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async handleCron(): Promise<number> {
    try {
      // นัดที่ "เลยวันนัดแล้ว" = วันนัด (ปฏิทินไทย) ก่อนวันนี้ (ปฏิทินไทย) ⇔ promised_date < 00:00 น. ไทยของวันนี้ (2026-11-18)
      // เดิม CURRENT_DATE ตาม TZ ของ session (prod = UTC) ⇒ รอบ 02:00 น. ไทยได้ "เมื่อวาน" ⇒ ตัดผิดนัดช้าไป 1 วัน
      // ส่งเป็นข้อความ ISO แล้ว ::timestamp เทียบกับ promised_date (timestamp เก็บ UTC) ตรง ๆ ไม่ผ่าน TZ ของ session
      const todayStart = bangkokStartOfDay();
      const affected = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE finance_receivable_contact_logs
        SET promised_broken_at = now()
        WHERE promised_date < ${todayStart.toISOString()}::timestamp
          AND promised_broken_at IS NULL
          AND promised_kept_at IS NULL
          AND result = 'PROMISED'
          AND deleted_at IS NULL
          AND finance_receivable_id IN (
            SELECT id FROM finance_receivables
            WHERE status NOT IN ('RECEIVED', 'PARTIALLY_RECEIVED')
              AND deleted_at IS NULL
          )
      `);
      this.logger.log(`broken-promise-finance: marked ${affected} logs as broken`);
      return Number(affected);
    } catch (err) {
      this.logger.error(
        `broken-promise-finance cron failed: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'broken-promise-finance' } });
      return 0;
    }
  }
}
