import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { computeCostUsd } from './ai-pricing';

export interface UsageRecord {
  service: string;
  method?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  userId?: string;
  status: 'success' | 'error';
  errorKind?: string;
}

/**
 * Centralized logger for every Claude API call. Kept fire-and-forget so
 * audit logging never blocks or fails a customer-facing AI call. The hourly
 * cron reads from this table to compute running daily spend.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: UsageRecord): Promise<void> {
    try {
      const costUsd = computeCostUsd(entry.model, entry.inputTokens, entry.outputTokens);
      await this.prisma.aiUsageLog.create({
        data: {
          service: entry.service,
          method: entry.method ?? null,
          model: entry.model,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          costUsd: new Prisma.Decimal(costUsd),
          userId: entry.userId ?? null,
          status: entry.status,
          errorKind: entry.errorKind ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist AI usage for ${entry.service}: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, { tags: { module: 'ai-usage', action: 'record' } });
    }
  }
}
