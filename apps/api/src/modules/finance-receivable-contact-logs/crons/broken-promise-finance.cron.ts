import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { addBkkDays, bangkokStartOfDay } from '../../../utils/date.util';

@Injectable()
export class BrokenPromiseFinanceCron {
  private readonly logger = new Logger(BrokenPromiseFinanceCron.name);

  constructor(private prisma: PrismaService) {}

  // Daily at 02:00 Asia/Bangkok
  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async handleCron(): Promise<number> {
    try {
      // ตัด "ผิดนัด" เมื่อวันนัด (ปฏิทินไทย) ผ่านไปเต็มหนึ่งวันแล้ว ⇔ promised_date < 00:00 น. ไทยของเมื่อวาน (2026-11-18)
      // = จังหวะเดิมบน prod (CURRENT_DATE ของ session UTC ตอน 02:00 น. ไทย = เมื่อวาน) แต่เขียนให้ชัดและไม่ขึ้นกับ TZ ของ session
      // ตั้งใจเว้นหนึ่งวัน: รับเงินตามนัดแล้วพนักงานบันทึกเช้าวันถัดไปยังนับว่า "รักษานัด" (finance-receivable.service
      // ตั้ง kept เฉพาะเมื่อยังไม่ถูกตัดผิดนัด) — ตัดเร็วขึ้นจะทำให้นัดนั้นค้างเป็นผิดนัดถาวร (รีวิวรวมแผน ง ข้อ Important 2)
      // ส่งเป็นข้อความ ISO แล้ว ::timestamp เทียบกับ promised_date (timestamp เก็บ UTC) ตรง ๆ
      const cutoff = addBkkDays(bangkokStartOfDay(), -1);
      const affected = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE finance_receivable_contact_logs
        SET promised_broken_at = now()
        WHERE promised_date < ${cutoff.toISOString()}::timestamp
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
