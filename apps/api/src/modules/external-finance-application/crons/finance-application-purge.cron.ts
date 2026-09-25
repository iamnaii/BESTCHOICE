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
      if (r.purgedApplications || r.failedFiles)
        this.logger.log(`purged ${r.purgedFiles} files across ${r.purgedApplications} applications (${r.failedFiles} failed, will retry)`);
    } catch (err) {
      this.logger.error('finance-application-purge failed', err as Error);
      Sentry.captureException(err);
    }
  }

  /**
   * ลบ object ก่อนแล้วค่อย null คอลัมน์ — ถ้า `storage.delete` ล้มเหลวสำหรับไฟล์ใดไฟล์หนึ่งของใบยื่น
   * ต้อง**ไม่**ทำเหมือนสำเร็จ: คงไว้ทั้ง `storageKey` (รอบถัดไปจะเลือกไฟล์นั้นมาลองใหม่ — คิวรีกรอง
   * `storageKey: { not: null }`) และ `filesPurgedAt` (ยังคง null ⇒ ใบยื่นทั้งใบยังเข้าคิวรอบถัดไปด้วย)
   * ส่วน `shareRevokedAt` ยังตั้งเสมอไม่ว่าจะลบ object สำเร็จครบหรือไม่ — ใบยื่นแก่พอจะถูกพิจารณาลบแล้ว
   * ลิงก์สาธารณะของมันต้องถูกปิดทันที ไม่ต้องรอให้ storage cleanup เสร็จสมบูรณ์ก่อน (fix round 1)
   */
  async tick() {
    const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 86400000);
    const apps = await this.prisma.externalFinanceApplication.findMany({
      where: { status: { in: ['APPROVED', 'REJECTED', 'CANCELLED'] }, closedAt: { lte: cutoff }, filesPurgedAt: null, deletedAt: null },
      select: { id: true, closedAt: true, files: { where: { deletedAt: null, storageKey: { not: null } }, select: { id: true, storageKey: true } } },
      take: BATCH,
    });
    let purgedApplications = 0;
    let purgedFiles = 0;
    let failedFiles = 0;
    for (const app of apps) {
      const succeededFileIds: string[] = [];
      let failedCount = 0;
      for (const file of app.files) {
        try {
          await this.storage.delete(file.storageKey!);
          succeededFileIds.push(file.id);
        } catch (err) {
          failedCount += 1;
          this.logger.warn(`delete ${file.storageKey} failed: ${(err as Error).message}`);
          Sentry.captureMessage('finance-application-purge: object delete failed, retry scheduled', {
            level: 'warning',
            tags: { subsystem: 'finance-application-purge' },
            extra: { applicationId: app.id, storageKey: file.storageKey },
          });
        }
      }
      purgedFiles += succeededFileIds.length;
      failedFiles += failedCount;
      const fullyPurged = failedCount === 0;
      await this.prisma.$transaction(async (tx) => {
        if (succeededFileIds.length) {
          await tx.externalFinanceApplicationFile.updateMany({ where: { id: { in: succeededFileIds } }, data: { storageKey: null } });
        }
        await tx.externalFinanceApplication.update({
          where: { id: app.id },
          data: fullyPurged ? { filesPurgedAt: new Date(), shareRevokedAt: new Date() } : { shareRevokedAt: new Date() },
        });
        if (fullyPurged) {
          await tx.externalFinanceApplicationEvent.create({ data: { applicationId: app.id, kind: 'FILES_PURGED', actorType: 'SYSTEM', meta: { fileCount: succeededFileIds.length } } });
        }
      });
      if (fullyPurged) purgedApplications += 1;
    }
    return { purgedApplications, purgedFiles, failedFiles };
  }
}
