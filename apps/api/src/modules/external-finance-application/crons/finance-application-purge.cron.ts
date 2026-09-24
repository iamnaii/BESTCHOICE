import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

export const PURGE_AFTER_DAYS = 90;
const BATCH = 50;

/** ลบไฟล์ของใบยื่นที่ปิดครบ 90 วัน (D6 — เจ้าของเคาะ 2026-09-24) · เก็บแถว/เหตุการณ์ไว้ ลบเฉพาะ object ใน storage */
@Injectable()
export class FinanceApplicationPurgeCron {
  private readonly logger = new Logger(FinanceApplicationPurgeCron.name);
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Bangkok' })
  async run() {
    try {
      const r = await this.tick();
      if (r.purgedApplications) this.logger.log(`purged ${r.purgedFiles} files across ${r.purgedApplications} applications`);
    } catch (err) {
      this.logger.error('finance-application-purge failed', err as Error);
      Sentry.captureException(err);
    }
  }

  async tick() {
    const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 86400000);
    const apps = await this.prisma.externalFinanceApplication.findMany({
      where: { status: { in: ['APPROVED', 'REJECTED', 'CANCELLED'] }, closedAt: { lte: cutoff }, filesPurgedAt: null, deletedAt: null },
      select: { id: true, closedAt: true, files: { where: { deletedAt: null, storageKey: { not: null } }, select: { id: true, storageKey: true } } },
      take: BATCH,
    });
    let purgedFiles = 0;
    for (const app of apps) {
      for (const file of app.files) {
        try {
          await this.storage.delete(file.storageKey!);
        } catch (err) {
          this.logger.warn(`delete ${file.storageKey} failed: ${(err as Error).message}`);
        }
        purgedFiles += 1;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.externalFinanceApplicationFile.updateMany({ where: { applicationId: app.id }, data: { storageKey: null } });
        await tx.externalFinanceApplication.update({ where: { id: app.id }, data: { filesPurgedAt: new Date(), shareRevokedAt: new Date() } });
        await tx.externalFinanceApplicationEvent.create({ data: { applicationId: app.id, kind: 'FILES_PURGED', actorType: 'SYSTEM', meta: { fileCount: app.files.length } } });
      });
    }
    return { purgedApplications: apps.length, purgedFiles };
  }
}
