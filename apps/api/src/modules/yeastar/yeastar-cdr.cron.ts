import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { CallDirection } from '@prisma/client';
import { YeastarService } from './yeastar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';

@Injectable()
export class YeastarCdrCron {
  private readonly logger = new Logger(YeastarCdrCron.name);

  constructor(
    private readonly yeastar: YeastarService,
    private readonly prisma: PrismaService,
    private readonly configService: IntegrationConfigService,
  ) {}

  /** ดึง CDR ทุก 15 นาที — fallback ถ้า webhook พลาด */
  @Cron('*/15 * * * *', { timeZone: 'Asia/Bangkok' })
  async pullCdr(): Promise<void> {
    const configured = await this.configService.isConfigured('yeastar');
    if (!configured) return;

    try {
      const now = Math.floor(Date.now() / 1000);
      const from = now - 20 * 60; // ย้อนหลัง 20 นาที (overlap 5 นาที)

      const records = await this.yeastar.queryCdr(from, now);
      let processed = 0;

      for (const cdr of records) {
        const saved = await this.processCdr(cdr);
        if (saved) processed++;
      }

      if (processed > 0) {
        this.logger.log(`[YeastarCdrCron] processed ${processed}/${records.length} CDR records`);
      }

      await this.retryPendingRecordings();
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'YeastarCdrCron' } });
      this.logger.error('[YeastarCdrCron] failed', err);
    }
  }

  async processCdr(cdr: {
    id: string;
    callFrom: string;
    callTo: string;
    callType: string;
    startTime: string;
    duration?: number;
    talkDuration?: number;
    recordingFile?: string;
  }): Promise<boolean> {
    const direction: CallDirection =
      cdr.callType === 'Inbound' ? CallDirection.INBOUND : CallDirection.OUTBOUND;

    const customerPhone = direction === CallDirection.INBOUND ? cdr.callFrom : cdr.callTo;

    const customer = await this.prisma.customer.findFirst({
      where: { phone: customerPhone, deletedAt: null },
      select: { id: true },
    });
    if (!customer) return false;

    const contract = await this.prisma.contract.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ['ACTIVE', 'OVERDUE'] },
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!contract) return false;

    const agentExtension = direction === CallDirection.INBOUND ? cdr.callTo : cdr.callFrom;
    const agentUser = await this.prisma.user.findFirst({
      where: { yeastarExtension: agentExtension, deletedAt: null },
      select: { id: true },
    });

    await this.prisma.callLog.upsert({
      where: { yeastarCallId: cdr.id },
      create: {
        contractId: contract.id,
        callerId: agentUser?.id ?? 'system',
        calledAt: new Date(cdr.startTime),
        result: 'AUTO_LOGGED',
        yeastarCallId: cdr.id,
        callDirection: direction,
        duration: cdr.talkDuration ?? cdr.duration ?? 0,
        yeastarRecordingPath: cdr.recordingFile ?? null,
        autoLogged: true,
      },
      update: {
        duration: cdr.talkDuration ?? cdr.duration ?? 0,
        yeastarRecordingPath: cdr.recordingFile ?? null,
      },
    });

    return true;
  }

  private async retryPendingRecordings(): Promise<void> {
    const pending = await this.prisma.callLog.findMany({
      where: {
        yeastarRecordingPath: { not: null },
        recordingUrl: null,
        deletedAt: null,
      },
      select: { id: true, contractId: true, yeastarRecordingPath: true },
      take: 10,
    });

    for (const log of pending) {
      try {
        const buffer = await this.yeastar.downloadRecording(log.yeastarRecordingPath!);
        this.logger.debug(
          `[YeastarCdrCron] Downloaded recording for CallLog ${log.id} (${buffer.length} bytes)`,
        );
        // GCS upload will be wired in when StorageService is integrated
      } catch (err) {
        Sentry.captureException(err, { extra: { callLogId: log.id } });
      }
    }
  }
}
