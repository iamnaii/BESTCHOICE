import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AttendanceDeviceService } from '../attendance-device.service';
import { AttendanceSettingsService } from '../attendance-settings.service';

/**
 * งานดูแลรายวัน 03:30 เวลาไทย (ก้อน 10 D3 · สเปก §4.4 §10)
 * - รูปพนักงาน (PII) เกินอายุเก็บ (ค่าเริ่มต้น 365 วัน) → ลบจาก storage แล้วตั้ง photoKey = null (แถวตอกคงอยู่) ทีละ ≤ 500
 * - แคชคำตอบต่อ requestId เกิน 1 วัน → ลบ
 * - เครื่อง ACTIVE ที่ไม่ส่ง heartbeat เกิน 24 ชม. → event OFFLINE + Todo ถึงเจ้าของ (ครั้งเดียวต่อ 24 ชม.)
 */
const DAY_MS = 24 * 3600_000;
const PHOTO_BATCH = 500;

export interface RetentionResult {
  photosDeleted: number;
  requestsDeleted: number;
  offlineDevices: number;
}

@Injectable()
export class AttendanceRetentionCron {
  private readonly logger = new Logger(AttendanceRetentionCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: AttendanceSettingsService,
    private readonly devices: AttendanceDeviceService,
  ) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<void> {
    await this.run(new Date());
  }

  async run(now: Date = new Date()): Promise<RetentionResult> {
    const result: RetentionResult = { photosDeleted: 0, requestsDeleted: 0, offlineDevices: 0 };
    try {
      const retentionDays = await this.settings.getPhotoRetentionDays();
      const expired = await this.prisma.attendancePunch.findMany({
        where: { photoKey: { not: null }, at: { lt: new Date(now.getTime() - retentionDays * DAY_MS) } },
        select: { id: true, photoKey: true },
        take: PHOTO_BATCH,
      });
      for (const punch of expired) {
        if (!punch.photoKey) continue;
        try {
          await this.storage.delete(punch.photoKey);
          await this.prisma.attendancePunch.update({ where: { id: punch.id }, data: { photoKey: null } });
          result.photosDeleted++;
        } catch (err) {
          // ลบไม่สำเร็จ = คง key ไว้ลองรอบหน้า (ห้ามตั้ง null ก่อน ไม่งั้นไฟล์ค้างใน storage โดยไม่มีใครรู้)
          this.logger.warn(`[attendance-retention] delete failed for punch ${punch.id}: ${(err as Error).message}`);
        }
      }

      const requests = await this.prisma.attendanceDeviceRequest.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DAY_MS) } } });
      result.requestsDeleted = requests.count;

      const silent = await this.prisma.attendanceDevice.findMany({
        where: { status: 'ACTIVE', deletedAt: null, lastSeenAt: { lt: new Date(now.getTime() - DAY_MS) } },
        include: { branch: { select: { name: true } } },
      });
      for (const device of silent) {
        const alreadyFlagged = await this.prisma.attendanceDeviceEvent.findFirst({ where: { deviceId: device.id, kind: 'OFFLINE', createdAt: { gte: new Date(now.getTime() - DAY_MS) } }, select: { id: true } });
        if (alreadyFlagged) continue;
        await this.prisma.attendanceDeviceEvent.create({ data: { deviceId: device.id, kind: 'OFFLINE', detail: { lastSeenAt: device.lastSeenAt?.toISOString() ?? null } } });
        await this.devices.createOwnerTodo({
          title: `เครื่องตอกบัตร "${device.name}" ไม่ติดต่อเซิร์ฟเวอร์เกิน 24 ชั่วโมง`,
          description: `สาขา ${device.branch?.name ?? device.branchId} · ติดต่อล่าสุด ${device.lastSeenAt?.toISOString() ?? '-'} · ตรวจว่าแท็บเล็ตเปิดอยู่ ต่อเน็ต และหน้าตอกบัตรยังเปิดค้าง · deviceId: ${device.id}`,
          priority: 'MEDIUM',
        });
        result.offlineDevices++;
      }
      this.logger.log(`[attendance-retention] photos ${result.photosDeleted} · requests ${result.requestsDeleted} · offline ${result.offlineDevices}`);
    } catch (err) {
      this.logger.error(`[attendance-retention] tick failed: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { subsystem: 'attendance', cron: 'retention', scope: 'tick' } });
    }
    return result;
  }
}
