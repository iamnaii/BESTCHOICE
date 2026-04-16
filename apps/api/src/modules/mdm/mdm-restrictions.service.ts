import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { MdmService } from './mdm.service';

export interface AutoRestrictionsResult {
  applied: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class MdmRestrictionsService {
  private readonly logger = new Logger(MdmRestrictionsService.name);

  constructor(
    private prisma: PrismaService,
    private mdmService: MdmService,
  ) {}

  async getSettings(): Promise<{
    enabled: boolean;
    profile: Record<string, number>;
  }> {
    const keys = ['mdm.autoRestrictionsEnabled', 'mdm.autoRestrictionsProfile'];
    const rows = await this.prisma.systemConfig.findMany({
      where: { key: { in: keys }, deletedAt: null },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    let profile: Record<string, number> = {
      allowCamera: 1,
      allowScreenCapture: 0,
      allowAppInstallation: 0,
      allowSafari: 1,
    };

    try {
      const raw = map.get('mdm.autoRestrictionsProfile');
      if (raw) profile = JSON.parse(raw);
    } catch {
      this.logger.warn('Invalid mdm.autoRestrictionsProfile JSON — using defaults');
    }

    return {
      enabled: map.get('mdm.autoRestrictionsEnabled') === 'true',
      profile,
    };
  }

  private async getProcessedDeviceIds(): Promise<Set<number>> {
    const record = await this.prisma.systemConfig.findFirst({
      where: { key: 'mdm.restrictedDevices', deletedAt: null },
    });
    if (!record?.value) return new Set();
    try {
      const ids: number[] = JSON.parse(record.value);
      return new Set(ids);
    } catch {
      return new Set();
    }
  }

  private async saveProcessedDeviceIds(ids: Set<number>): Promise<void> {
    const value = JSON.stringify([...ids]);
    await this.prisma.systemConfig.upsert({
      where: { key: 'mdm.restrictedDevices' },
      create: { key: 'mdm.restrictedDevices', value, label: 'MDM: auto-restricted device IDs' },
      update: { value, deletedAt: null },
    });
  }

  async autoApplyRestrictions(): Promise<AutoRestrictionsResult> {
    const settings = await this.getSettings();

    if (!settings.enabled) {
      this.logger.debug('MDM auto-restrictions disabled — skipping');
      return { applied: 0, skipped: 0, failed: 0 };
    }

    if (!(await this.mdmService.isConfigured())) {
      this.logger.debug('MDM not configured — skipping auto-restrictions');
      return { applied: 0, skipped: 0, failed: 0 };
    }

    const { devices } = await this.mdmService.listDevices({
      status: 1,
      pageSize: 100,
    });

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentDevices = devices.filter((d) => {
      if (!d.lastTime) return false;
      return new Date(d.lastTime).getTime() >= cutoff;
    });

    const processedIds = await this.getProcessedDeviceIds();
    const newDevices = recentDevices.filter((d) => !processedIds.has(d.id));

    if (newDevices.length === 0) {
      return { applied: 0, skipped: recentDevices.length, failed: 0 };
    }

    let applied = 0;
    let failed = 0;

    const batch = newDevices.slice(0, 40);

    for (const device of batch) {
      try {
        if (applied + failed > 0) {
          await new Promise((r) => setTimeout(r, 1000));
        }

        const result = await this.mdmService.installRestrictions(device.id, settings.profile);

        if (result?.code === 200) {
          processedIds.add(device.id);
          applied++;
          this.logger.log(
            `MDM auto-restrictions: applied to device ${device.id} (${device.deviceId})`,
          );
        } else {
          failed++;
          this.logger.warn(
            `MDM auto-restrictions: failed for device ${device.id} — ${result?.msg}`,
          );
        }
      } catch (err) {
        failed++;
        this.logger.error(`MDM auto-restrictions: error for device ${device.id}`, err);
        Sentry.captureException(err, {
          tags: { kind: 'mdm-auto-restrictions' },
          extra: { deviceId: device.id },
        });
      }
    }

    await this.saveProcessedDeviceIds(processedIds);
    return { applied, skipped: recentDevices.length - batch.length, failed };
  }
}
