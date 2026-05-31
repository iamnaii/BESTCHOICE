import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class BrokenPromiseFinanceCron {
  private readonly logger = new Logger(BrokenPromiseFinanceCron.name);

  constructor(private prisma: PrismaService) {}

  // Daily at 02:00 Asia/Bangkok
  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async handleCron(): Promise<number> {
    const affected = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE finance_receivable_contact_logs
      SET promised_broken_at = now()
      WHERE promised_date < CURRENT_DATE
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
  }
}
