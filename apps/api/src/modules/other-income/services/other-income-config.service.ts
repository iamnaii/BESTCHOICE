import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

/**
 * OtherIncome SystemConfig reads/writes: Maker-Checker flag + attachment
 * threshold + pending-ready count. Plain class — constructed internally by the
 * OtherIncomeService facade. The Lifecycle service injects this for its
 * isMakerCheckerEnabled / getAttachmentThreshold gates.
 */
@Injectable()
export class OtherIncomeConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Read OTHER_INCOME_MAKER_CHECKER_ENABLED from SystemConfig. Default false. */
  async isMakerCheckerEnabled(): Promise<boolean> {
    try {
      const row = await this.prisma.systemConfig.findUnique({
        where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      });
      return row?.value === 'true';
    } catch {
      return false;
    }
  }

  /** OWNER: toggle OTHER_INCOME_MAKER_CHECKER_ENABLED and emit CONFIG_CHANGED audit. */
  async setMakerCheckerEnabled(enabled: boolean, userId: string): Promise<{ success: true; enabled: boolean }> {
    await this.prisma.systemConfig.upsert({
      where: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED' },
      update: { value: enabled ? 'true' : 'false' },
      create: { key: 'OTHER_INCOME_MAKER_CHECKER_ENABLED', value: enabled ? 'true' : 'false' },
    });

    try {
      await this.audit.log({
        userId,
        action: 'CONFIG_CHANGED',
        entity: 'system_config',
        entityId: 'OTHER_INCOME_MAKER_CHECKER_ENABLED',
        newValue: { enabled },
      });
    } catch (err) {
      Sentry.captureException(err);
    }

    return { success: true, enabled };
  }

  /** OWNER: count OtherIncome docs with status=READY that are not soft-deleted. */
  async pendingReadyCount(): Promise<{ count: number }> {
    const count = await this.prisma.otherIncome.count({
      where: { status: 'READY', deletedAt: null },
    });
    return { count };
  }

  /** Read OTHER_INCOME_ATTACHMENT_THRESHOLD from SystemConfig. Falls back to 50_000. */
  async getAttachmentThreshold(): Promise<number> {
    try {
      const row = await this.prisma.systemConfig.findUnique({
        where: { key: 'OTHER_INCOME_ATTACHMENT_THRESHOLD' },
      });
      if (row) {
        const val = Number(row.value);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch {
      // key doesn't exist yet — use fallback
    }
    return 50_000;
  }
}
