import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { AttendanceDeviceService } from '../attendance-device.service';
import { dbDate, workDateOf, workDateString } from '../attendance-rules';
import { FLAG_DEVICE_UNAVAILABLE } from '../attendance.service';
import { FLAG_MISSING_OUT } from '../kiosk-punch.service';

/**
 * ปิดวัน 00:05 เวลาไทย (ก้อน 10 D3 · สเปก §5 §10) — วันเป้าหมาย = วันไทยก่อนหน้า
 * 1. แถวที่ IN แล้วไม่ OUT → ธง MISSING_OUT · OT/ชั่วโมงทำงาน = 0 (ผจก.แก้พร้อมเหตุผลได้)
 * 2. สาขาที่ไม่มีการตอกเลยทั้งวัน (เครื่องล็อก/ดับ/ไม่มีเน็ต) → ไม่นับใครขาด · ติดธง DEVICE_UNAVAILABLE ให้คนไม่มีแถว · Todo ถึงเจ้าของ
 * 3. สาขาปกติ → พนักงานที่มีรหัสตอกบัตรแต่ไม่มีแถว = แถว WORK ไม่มีเวลา (ขาด) · คนที่ยังไม่มีรหัสไม่ถูกนับ · แถวที่มีอยู่ (วันหยุด/ลา) ไม่แตะ
 * idempotent: รันซ้ำไม่สร้างซ้ำ · ไม่โยน error ออกจาก tick (Sentry)
 */
export interface CloseDayResult {
  targetDate: string;
  closed: number;
  absent: number;
  unavailableBranches: string[];
}

@Injectable()
export class AttendanceCloseDayCron {
  private readonly logger = new Logger(AttendanceCloseDayCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: AttendanceDeviceService,
  ) {}

  @Cron('5 0 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<void> {
    await this.run(new Date());
  }

  async run(now: Date = new Date()): Promise<CloseDayResult> {
    const target = workDateOf(new Date(workDateOf(now).getTime() - 60_000)); // เที่ยงคืนไทยของเมื่อวาน
    const key = dbDate(target);
    const targetDate = workDateString(target);
    const result: CloseDayResult = { targetDate, closed: 0, absent: 0, unavailableBranches: [] };
    try {
      const closed = await this.prisma.attendanceDay.updateMany({
        where: { workDate: key, deletedAt: null, clockIn: { not: null }, clockOut: null, NOT: { flags: { has: FLAG_MISSING_OUT } } },
        data: { flags: { push: FLAG_MISSING_OUT }, otHours: 0, workedMinutes: 0 },
      });
      result.closed = closed.count;

      const branches = await this.prisma.branch.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true } });
      const dayStart = target;
      const dayEnd = new Date(target.getTime() + 24 * 3600_000);
      for (const branch of branches) {
        try {
          const staff = (
            await this.prisma.user.findMany({
              where: { branchId: branch.id, deletedAt: null, isActive: true, isSystemUser: false, attendancePinHash: { not: null } },
              select: { id: true, branchId: true, attendancePinHash: true },
            })
          ).filter((u) => !!u.attendancePinHash); // คนที่ยังไม่มีรหัสตอกบัตร = ยังไม่เริ่มใช้ระบบ ไม่ถูกนับขาด
          if (!staff.length) continue;
          const existing = await this.prisma.attendanceDay.findMany({ where: { workDate: key, deletedAt: null, userId: { in: staff.map((u) => u.id) } }, select: { userId: true } });
          const haveRow = new Set(existing.map((r) => r.userId));
          const missing = staff.filter((u) => !haveRow.has(u.id));
          if (!missing.length) continue;

          const punches = await this.prisma.attendancePunch.count({ where: { branchId: branch.id, at: { gte: dayStart, lt: dayEnd } } });
          const unavailable = punches === 0;
          for (const u of missing) {
            await this.prisma.attendanceDay.create({ data: { userId: u.id, branchId: branch.id, workDate: key, dayKind: 'WORK', flags: unavailable ? [FLAG_DEVICE_UNAVAILABLE] : [] } });
            if (!unavailable) result.absent++;
          }
          if (unavailable) {
            result.unavailableBranches.push(branch.id);
            await this.devices.createOwnerTodo({
              title: `สาขา ${branch.name} ไม่มีการตอกบัตรวันที่ ${targetDate}`,
              description: `ไม่มีรายการตอกเข้า/ออกเลยทั้งวัน (เครื่องตอกบัตรอาจดับ ล็อก หรือไม่มีเน็ต) — ระบบไม่นับใครขาด แถวของวันติดธง "เครื่องใช้ไม่ได้" ให้ ผจก.บันทึกย้อนหลังพร้อมเหตุผลที่เมนู ลงเวลา › แก้ไข`,
              priority: 'MEDIUM',
            });
          }
        } catch (err) {
          this.logger.error(`[attendance-close-day] branch ${branch.id}: ${(err as Error).message}`);
          Sentry.captureException(err, { tags: { subsystem: 'attendance', cron: 'close-day', scope: 'branch' }, extra: { branchId: branch.id, targetDate } });
        }
      }
      this.logger.log(`[attendance-close-day] ${targetDate}: closed ${result.closed} · absent ${result.absent} · unavailable ${result.unavailableBranches.length}`);
    } catch (err) {
      this.logger.error(`[attendance-close-day] tick failed: ${(err as Error).message}`);
      Sentry.captureException(err, { tags: { subsystem: 'attendance', cron: 'close-day', scope: 'tick' }, extra: { targetDate } });
    }
    return result;
  }
}
